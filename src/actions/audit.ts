"use server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  queryAuditLogs,
  generateAuditLogsCsv,
  logAuditEvent,
} from "@/lib/audit/auditLogger";
import type { AuditLogFilters, AuditPaginationParams, AuditLogsQueryResult } from "@/types/audit";

/**
 * Server action: Fetch paginated audit logs for administrators
 */
export async function fetchAdminAuditLogs(
  filters: AuditLogFilters = {},
  pagination: AuditPaginationParams = {}
): Promise<{ success: boolean; data?: AuditLogsQueryResult; error?: string }> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Unauthorized: Please sign in." };
    }

    // Authoritative role check from user_roles
    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError || !roleRow) {
      return { success: false, error: "Forbidden: Account has no assigned role." };
    }

    const role = roleRow.role?.toLowerCase();
    const isApproved = roleRow.account_status === "Approved";

    if (role !== "admin" || !isApproved) {
      // Log unauthorized access attempt
      await logAuditEvent({
        category: "SECURITY",
        action: "UNAUTHORIZED_ACCESS_DENIED",
        outcome: "DENIED",
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: role || "unknown",
        targetType: "system",
        targetId: "/admin/audit-logs",
        targetLabel: "Audit Logs Module",
        reason: "Non-admin user attempted to access administrator audit logs.",
      });

      return {
        success: false,
        error: "Forbidden: Only approved administrators can access audit logs.",
      };
    }

    const adminContext = {
      schoolId: roleRow.school_id,
      isSuperAdmin: !roleRow.school_id, // If school_id is null, system-wide admin
    };

    const result = await queryAuditLogs(filters, pagination, adminContext);
    return { success: true, data: result };
  } catch (err: any) {
    console.error("[fetchAdminAuditLogs] Error:", err);
    return { success: false, error: err?.message || "Failed to query audit logs." };
  }
}

/**
 * Server action: Export audit logs to CSV
 */
export async function exportAdminAuditLogsCsv(
  filters: AuditLogFilters = {}
): Promise<{ success: boolean; csv?: string; filename?: string; error?: string }> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Unauthorized: Please sign in." };
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow || roleRow.role?.toLowerCase() !== "admin" || roleRow.account_status !== "Approved") {
      return {
        success: false,
        error: "Forbidden: Only approved administrators can export audit logs.",
      };
    }

    // Query up to 1000 events matching the current filters for export
    const adminContext = {
      schoolId: roleRow.school_id,
      isSuperAdmin: !roleRow.school_id,
    };

    const queryResult = await queryAuditLogs(
      filters,
      { page: 1, pageSize: 1000 },
      adminContext
    );

    const csvData = generateAuditLogsCsv(queryResult.logs);
    const dateStamp = new Date().toISOString().split("T")[0];
    const filename = `tris_audit_logs_${dateStamp}.csv`;

    // Log the export action itself for accountability
    await logAuditEvent({
      category: "REPORT",
      action: "AUDIT_LOGS_EXPORTED",
      outcome: "SUCCESS",
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: "admin",
      actorSchoolId: roleRow.school_id,
      targetType: "report",
      targetId: filename,
      targetLabel: `Audit Logs Export (${queryResult.logs.length} records)`,
      reason: "Administrator initiated audit log CSV export.",
      details: {
        exportedRecordCount: queryResult.logs.length,
        filtersApplied: filters,
      },
    });

    return { success: true, csv: csvData, filename };
  } catch (err: any) {
    console.error("[exportAdminAuditLogsCsv] Error:", err);
    return { success: false, error: err?.message || "Failed to export audit logs." };
  }
}

/**
 * Server action: Log SF9/SF10 comparison outcome
 */
export async function logComparisonEvent(params: {
  isSameLearner: boolean;
  hasDiscrepancies: boolean;
  summaryMetrics: any;
  learnerLrn?: string;
  learnerName?: string;
}) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data: roleRow } = user
      ? await supabase
          .from("user_roles")
          .select("role, school_id")
          .eq("user_id", user.id)
          .maybeSingle()
      : { data: null };

    const action = !params.isSameLearner
      ? "COMPARISON_DISCREPANCY_FLAGGED"
      : params.hasDiscrepancies
      ? "COMPARISON_DISCREPANCY_FLAGGED"
      : "COMPARISON_COMPLETED";

    const outcome = !params.isSameLearner
      ? "DENIED"
      : params.hasDiscrepancies
      ? "WARNING"
      : "SUCCESS";

    await logAuditEvent({
      category: "COMPARISON",
      action,
      outcome,
      actorUserId: user?.id || null,
      actorEmail: user?.email || null,
      actorRole: roleRow?.role || "teacher",
      actorSchoolId: roleRow?.school_id || null,
      targetType: "comparison",
      targetId: params.learnerLrn || null,
      targetLabel: params.learnerName
        ? `Comparison: ${params.learnerName}`
        : "SF9/SF10 Comparison",
      reason: !params.isSameLearner
        ? "Comparison blocked: Learner reference numbers do not match"
        : params.hasDiscrepancies
        ? "Comparison identified academic or identity discrepancies"
        : "All verified academic and identity fields matched",
      details: {
        totalCompared: params.summaryMetrics?.totalAcademicFieldsCompared,
        matchingCount: params.summaryMetrics?.matchingFieldsCount,
        discrepanciesCount: params.summaryMetrics?.discrepanciesCount,
        missingOrUnverifiedCount: params.summaryMetrics?.missingOrUnverifiedCount,
        identityStatus: params.summaryMetrics?.identityStatus,
      },
    });

    return { success: true };
  } catch (err: any) {
    console.warn("[logComparisonEvent] Notice: Comparison audit event deferred:", err?.message);
    return { success: false };
  }
}


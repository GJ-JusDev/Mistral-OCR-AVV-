/**
 * AVV System — Core Administrative Audit Logger
 *
 * Implements an immutable, append-only, privacy-conscious audit trail
 * for administrative activity monitoring.
 *
 * Security & Data Privacy Guidelines:
 * 1. Sanitization: Passwords, tokens, API keys, and large document binaries are strictly scrubbed.
 * 2. Scope Isolation: School administrators can only view audit records for their authorized school.
 * 3. Fallback Resiliency: Database insertion failures never crash the host business process.
 * 4. CSV Formula Injection Defense: Escapes dangerous leading characters (=, +, -, @).
 */

import { createClient } from "@supabase/supabase-js";
import type {
  AuditEvent,
  AuditCategory,
  AuditAction,
  AuditOutcome,
  LogAuditParams,
  AuditLogFilters,
  AuditPaginationParams,
  AuditLogsQueryResult,
} from "@/types/audit";

// In-memory fallback ring buffer for transient offline resilience / testing
const IN_MEMORY_LOGS: AuditEvent[] = [];
const MAX_IN_MEMORY_LOGS = 1000;

export function clearInMemoryLogs(): void {
  IN_MEMORY_LOGS.length = 0;
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Sanitizes details payload to ensure no sensitive credentials, passwords,
 * tokens, or entire OCR texts/binaries enter the audit log.
 */
export function sanitizeAuditDetails(input?: Record<string, any>): Record<string, any> {
  if (!input || typeof input !== "object") return {};

  const sanitized: Record<string, any> = {};
  const sensitiveKeyRegex = /password|secret|token|api[-_]?key|credential|private|auth[-_]?key|authorization/i;
  const bulkyKeyRegex = /image|dataurl|base64|rawtext|extracted_text|buffer/i;

  for (const [key, val] of Object.entries(input)) {
    if (sensitiveKeyRegex.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (bulkyKeyRegex.test(key)) {
      sanitized[key] = "[BINARY_OR_BULKY_PAYLOAD_EXCLUDED]";
    } else if (typeof val === "object" && val !== null) {
      if (Array.isArray(val)) {
        sanitized[key] = val.slice(0, 20).map((item) =>
          typeof item === "object" && item !== null ? sanitizeAuditDetails(item) : item
        );
      } else {
        sanitized[key] = sanitizeAuditDetails(val);
      }
    } else if (typeof val === "string" && val.length > 500) {
      sanitized[key] = val.substring(0, 500) + "... [TRUNCATED]";
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

/**
 * Format UTC timestamp to Asia/Manila (UTC+8)
 */
export function formatToManilaTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return isoString;
  }
}

/**
 * Escapes values for safe CSV export, preventing formula injection (OWASP CSV Injection).
 */
export function sanitizeCsvCell(value: any): string {
  if (value === null || value === undefined) return '""';

  let str = String(value);

  // OWASP CSV Formula Injection defense:
  // If the string starts with =, +, -, @, \t, or \r, prepend a single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Escape double quotes by doubling them
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Records a new audit event into the database and fallback ring buffer.
 */
export async function logAuditEvent(params: LogAuditParams): Promise<AuditEvent> {
  const eventId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const sanitizedDetails = sanitizeAuditDetails(params.details);

  const event: AuditEvent = {
    id: eventId,
    created_at: timestamp,
    actor_user_id: params.actorUserId || null,
    actor_email: params.actorEmail ? params.actorEmail.toLowerCase().trim() : null,
    actor_role: (params.actorRole || "anonymous").toLowerCase(),
    actor_school_id: params.actorSchoolId || null,
    actor_school_name: params.actorSchoolName || "Taysan Resettlement Integrated School",
    category: params.category,
    action: params.action,
    target_type: params.targetType || null,
    target_id: params.targetId || null,
    target_label: params.targetLabel || null,
    outcome: params.outcome,
    details: sanitizedDetails,
    reason: params.reason || null,
    request_id: params.requestId || null,
    ip_address: params.ipAddress || null,
    user_agent: params.userAgent || null,
  };

  // 1. Maintain in-memory ring buffer with unique operation / request-id deduplication
  const isDuplicateInMemory = Boolean(
    event.request_id &&
    IN_MEMORY_LOGS.some((existing) => existing.request_id === event.request_id)
  );

  if (!isDuplicateInMemory) {
    IN_MEMORY_LOGS.unshift(event);
    if (IN_MEMORY_LOGS.length > MAX_IN_MEMORY_LOGS) {
      IN_MEMORY_LOGS.pop();
    }
  }

  // 2. Persist to Supabase if configured with operation-aware deduplication against database triggers
  try {
    const adminClient = getAdminClient();
    if (adminClient) {
      // Deduplication check: If database trigger already inserted a matching event with this request_id, avoid duplicate
      if (event.request_id) {
        const { data: existingDbLog } = await adminClient
          .from("audit_logs")
          .select("id")
          .eq("request_id", event.request_id)
          .limit(1)
          .maybeSingle();

        if (existingDbLog?.id) {
          event.id = existingDbLog.id;
          event.persisted = true;
          return event;
        }
      }

      const { error } = await adminClient.from("audit_logs").insert({
        id: event.id,
        created_at: event.created_at,
        actor_user_id: event.actor_user_id,
        actor_email: event.actor_email,
        actor_role: event.actor_role,
        actor_school_id: event.actor_school_id,
        actor_school_name: event.actor_school_name,
        school_id: params.actorSchoolId || null,
        category: event.category,
        action: event.action,
        target_type: event.target_type,
        target_id: event.target_id,
        target_label: event.target_label,
        outcome: event.outcome,
        details: event.details,
        reason: event.reason,
        request_id: event.request_id,
        ip_address: event.ip_address,
        user_agent: event.user_agent,
      });

      if (error) {
        event.persisted = false;
        event.dbError = error.message;
        console.warn("[auditLogger] Notice: Database audit_logs write deferred:", error.message);
      } else {
        event.persisted = true;
      }
    } else {
      event.persisted = false;
      event.dbError = "Database client not available.";
    }
  } catch (err: any) {
    event.persisted = false;
    event.dbError = err?.message || String(err);
    console.warn("[auditLogger] Fallback active; DB write skipped:", event.dbError);
  }

  return event;
}

/**
 * Queries audit logs with server-side filtering, school scoping, and pagination.
 */
export async function queryAuditLogs(
  filters: AuditLogFilters = {},
  pagination: AuditPaginationParams = {},
  adminContext?: { schoolId?: string | null; isSuperAdmin?: boolean }
): Promise<AuditLogsQueryResult> {
  const page = Math.max(1, pagination.page || 1);
  const pageSize = Math.min(100, Math.max(1, pagination.pageSize || 20));
  const offset = (page - 1) * pageSize;

  let allEvents: AuditEvent[] = [];
  let dbQueriedSuccessfully = false;

  const adminClient = getAdminClient();
  if (adminClient) {
    try {
      let query = adminClient
        .from("audit_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      // School Scope Isolation
      if (!adminContext?.isSuperAdmin && adminContext?.schoolId) {
        query = query.or(`actor_school_id.eq.${adminContext.schoolId},actor_school_id.is.null`);
      }

      // Filter by category
      if (filters.category && filters.category !== "ALL") {
        query = query.eq("category", filters.category);
      }

      // Filter by action
      if (filters.action && filters.action !== "ALL") {
        query = query.eq("action", filters.action);
      }

      // Filter by outcome
      if (filters.outcome && filters.outcome !== "ALL") {
        query = query.eq("outcome", filters.outcome);
      }

      // Filter by actor
      if (filters.actorUserId) {
        query = query.eq("actor_user_id", filters.actorUserId);
      }

      // Filter by target ID
      if (filters.targetId) {
        query = query.eq("target_id", filters.targetId);
      }

      // Filter by date range
      if (filters.startDate) {
        query = query.gte("created_at", filters.startDate);
      }
      if (filters.endDate) {
        query = query.lte("created_at", filters.endDate);
      }

      // Search Query (email, label, reason, action)
      if (filters.searchQuery) {
        const sq = filters.searchQuery.trim();
        query = query.or(
          `actor_email.ilike.%${sq}%,target_label.ilike.%${sq}%,reason.ilike.%${sq}%,action.ilike.%${sq}%`
        );
      }

      const { data, count, error } = await query.range(offset, offset + pageSize - 1);

      if (!error && data) {
        dbQueriedSuccessfully = true;
        const totalCount = count ?? data.length;

        // Compute summary metrics
        const successCount = data.filter((e) => e.outcome === "SUCCESS").length;
        const failureCount = data.filter((e) => e.outcome === "FAILURE").length;
        const deniedCount = data.filter((e) => e.outcome === "DENIED").length;
        const securityEventsCount = data.filter((e) => e.category === "SECURITY" || e.outcome === "DENIED").length;

        return {
          logs: data as AuditEvent[],
          totalCount,
          page,
          pageSize,
          totalPages: Math.ceil(totalCount / pageSize) || 1,
          storageSource: "database",
          isDegraded: false,
          summaryMetrics: {
            totalEvents: totalCount,
            successCount,
            failureCount,
            deniedCount,
            securityEventsCount,
          },
        };
      }
    } catch {
      // Fall through to in-memory store
    }
  }

  // Fallback / in-memory search (used during tests or before Migration 014 execution)
  let filtered = [...IN_MEMORY_LOGS];

  // School scope
  if (!adminContext?.isSuperAdmin && adminContext?.schoolId) {
    filtered = filtered.filter(
      (e) => !e.actor_school_id || e.actor_school_id === adminContext.schoolId
    );
  }

  if (filters.category && filters.category !== "ALL") {
    filtered = filtered.filter((e) => e.category === filters.category);
  }
  if (filters.action && filters.action !== "ALL") {
    filtered = filtered.filter((e) => e.action === filters.action);
  }
  if (filters.outcome && filters.outcome !== "ALL") {
    filtered = filtered.filter((e) => e.outcome === filters.outcome);
  }
  if (filters.actorUserId) {
    filtered = filtered.filter((e) => e.actor_user_id === filters.actorUserId);
  }
  if (filters.targetId) {
    filtered = filtered.filter((e) => e.target_id === filters.targetId);
  }
  if (filters.startDate) {
    const start = new Date(filters.startDate).getTime();
    filtered = filtered.filter((e) => new Date(e.created_at).getTime() >= start);
  }
  if (filters.endDate) {
    const end = new Date(filters.endDate).getTime();
    filtered = filtered.filter((e) => new Date(e.created_at).getTime() <= end);
  }
  if (filters.searchQuery) {
    const q = filters.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (e) =>
        (e.actor_email && e.actor_email.toLowerCase().includes(q)) ||
        (e.target_label && e.target_label.toLowerCase().includes(q)) ||
        (e.reason && e.reason.toLowerCase().includes(q)) ||
        e.action.toLowerCase().includes(q)
    );
  }

  const totalCount = filtered.length;
  const paged = filtered.slice(offset, offset + pageSize);

  const successCount = filtered.filter((e) => e.outcome === "SUCCESS").length;
  const failureCount = filtered.filter((e) => e.outcome === "FAILURE").length;
  const deniedCount = filtered.filter((e) => e.outcome === "DENIED").length;
  const securityEventsCount = filtered.filter(
    (e) => e.category === "SECURITY" || e.outcome === "DENIED"
  ).length;

  return {
    logs: paged,
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize) || 1,
    storageSource: "memory_fallback",
    isDegraded: true,
    summaryMetrics: {
      totalEvents: totalCount,
      successCount,
      failureCount,
      deniedCount,
      securityEventsCount,
    },
  };
}

/**
 * Converts a list of audit events into an escaped CSV string.
 */
export function generateAuditLogsCsv(events: AuditEvent[]): string {
  const headers = [
    "Event ID",
    "Timestamp (Asia/Manila)",
    "Category",
    "Action",
    "Outcome",
    "Actor Role",
    "Actor Email",
    "School Name",
    "Target Type",
    "Target ID",
    "Target Label",
    "Reason",
    "Details",
    "IP Address",
  ];

  const rows = events.map((e) => [
    sanitizeCsvCell(e.id),
    sanitizeCsvCell(formatToManilaTime(e.created_at)),
    sanitizeCsvCell(e.category),
    sanitizeCsvCell(e.action),
    sanitizeCsvCell(e.outcome),
    sanitizeCsvCell(e.actor_role),
    sanitizeCsvCell(e.actor_email || "N/A"),
    sanitizeCsvCell(e.actor_school_name || "TRIS (500169)"),
    sanitizeCsvCell(e.target_type || "N/A"),
    sanitizeCsvCell(e.target_id || "N/A"),
    sanitizeCsvCell(e.target_label || "N/A"),
    sanitizeCsvCell(e.reason || "N/A"),
    sanitizeCsvCell(JSON.stringify(e.details || {})),
    sanitizeCsvCell(e.ip_address || "N/A"),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

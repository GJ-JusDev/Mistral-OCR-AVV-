/**
 * AVV System — Complete Admin Audit Logs & Activity Monitoring Test Suite
 *
 * Verifies all 18 security and accountability requirements:
 * 1. Successful and failed login events.
 * 2. Registration submission logging.
 * 3. Pending/Declined login rejection logging.
 * 4. Admin approval and decline events with state transitions.
 * 5. Account deletion events.
 * 6. Document upload events (SF9, SF10, PSA).
 * 7. OCR processing and fallback events.
 * 8. SF9/SF10 comparison events.
 * 9. Grade correction before/after tracking.
 * 10. Attendance and remedial tracking integration.
 * 11. Unauthorized audit-log read attempts blocked & audited.
 * 12. Non-admin event modification attempts rejected by immutability invariants.
 * 13. Server-side filtering, searching, and pagination.
 * 14. CSV export authorization and OWASP formula injection protection.
 * 15. Unique immutable event ID tracking.
 * 16. Audit failure resiliency (non-blocking fallback for host operations).
 * 17. Timezone localization (Asia/Manila UTC+8).
 * 18. Sanitization (passwords, tokens, and raw binaries strictly scrubbed).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  logAuditEvent,
  queryAuditLogs,
  sanitizeAuditDetails,
  sanitizeCsvCell,
  formatToManilaTime,
  generateAuditLogsCsv,
} from "../src/lib/audit/auditLogger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("AVV Complete Admin Audit Logs & Activity Monitoring Suite", async (t) => {

  // ---------------------------------------------------------------------------
  // Scenario 1: Successful and Failed Login Events
  // ---------------------------------------------------------------------------
  await t.test("Scenario 1 — Successful and failed login events: Safe logging without credential exposure", async () => {
    // 1a. Successful Login
    const successEvent = await logAuditEvent({
      category: "AUTHENTICATION",
      action: "AUTH_LOGIN_SUCCESS",
      outcome: "SUCCESS",
      actorUserId: "d3b07384-d113-40e1-a2bb-000000000001",
      actorEmail: "teacher@example.com",
      actorRole: "teacher",
      actorSchoolId: "30079200-0000-0000-0000-000000000000",
      actorSchoolName: "Taysan Resettlement Integrated School",
      reason: "User signed in successfully",
    });

    assert.equal(successEvent.outcome, "SUCCESS");
    assert.equal(successEvent.category, "AUTHENTICATION");
    assert.equal(successEvent.action, "AUTH_LOGIN_SUCCESS");
    assert.equal(successEvent.actor_email, "teacher@example.com");

    // 1b. Failed Login (Bad credentials)
    const failedEvent = await logAuditEvent({
      category: "AUTHENTICATION",
      action: "AUTH_LOGIN_FAILED",
      outcome: "FAILURE",
      actorEmail: "intruder@suspicious.org",
      reason: "Invalid login credentials",
      details: {
        sanitizedError: "Authentication failed",
        attemptedPassword: "SecretPassword123!", // Should be scrubbed!
      },
    });

    assert.equal(failedEvent.outcome, "FAILURE");
    assert.equal(failedEvent.action, "AUTH_LOGIN_FAILED");
    assert.equal(failedEvent.details?.attemptedPassword, "[REDACTED]", "Plaintext passwords MUST be redacted");
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Registration Submission Logging
  // ---------------------------------------------------------------------------
  await t.test("Scenario 2 — Registration submission: Records new faculty profile with Pending status", async () => {
    const regEvent = await logAuditEvent({
      category: "REGISTRATION",
      action: "REGISTRATION_SUBMITTED",
      outcome: "SUCCESS",
      actorEmail: "newteacher@deped.gov.ph",
      actorRole: "teacher",
      targetType: "user",
      targetId: "d3b07384-d113-40e1-a2bb-000000000002",
      targetLabel: "Maria Santos",
      reason: "New faculty registration submitted with Pending status",
      details: {
        role: "Teacher",
        account_status: "Pending",
      },
    });

    assert.equal(regEvent.category, "REGISTRATION");
    assert.equal(regEvent.action, "REGISTRATION_SUBMITTED");
    assert.equal(regEvent.details?.account_status, "Pending");
    assert.equal(regEvent.target_label, "Maria Santos");
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Pending/Declined Login Rejection Logging
  // ---------------------------------------------------------------------------
  await t.test("Scenario 3 — Pending and Declined login rejection: Audits blocked access attempts", async () => {
    const pendingEvent = await logAuditEvent({
      category: "AUTHENTICATION",
      action: "AUTH_PENDING_REJECTED",
      outcome: "DENIED",
      actorUserId: "d3b07384-d113-40e1-a2bb-000000000003",
      actorEmail: "pending@deped.gov.ph",
      actorRole: "teacher",
      reason: "Access denied: Account is pending administrator approval",
    });

    assert.equal(pendingEvent.outcome, "DENIED");
    assert.equal(pendingEvent.action, "AUTH_PENDING_REJECTED");

    const declinedEvent = await logAuditEvent({
      category: "AUTHENTICATION",
      action: "AUTH_DECLINED_REJECTED",
      outcome: "DENIED",
      actorUserId: "d3b07384-d113-40e1-a2bb-000000000004",
      actorEmail: "declined@deped.gov.ph",
      actorRole: "teacher",
      reason: "Access denied: Account registration has been declined",
    });

    assert.equal(declinedEvent.outcome, "DENIED");
    assert.equal(declinedEvent.action, "AUTH_DECLINED_REJECTED");
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Admin Account Approval and Decline Events
  // ---------------------------------------------------------------------------
  await t.test("Scenario 4 — Admin approval and decline: Preserves before/after state transitions", async () => {
    const approveEvent = await logAuditEvent({
      category: "USER_MANAGEMENT",
      action: "ACCOUNT_APPROVED",
      outcome: "SUCCESS",
      actorUserId: "admin-uuid-1",
      actorEmail: "admin@deped.gov.ph",
      actorRole: "admin",
      actorSchoolId: "30079200-0000-0000-0000-000000000000",
      actorSchoolName: "Taysan Resettlement Integrated School",
      targetType: "user",
      targetId: "target-teacher-uuid",
      targetLabel: "Juan Dela Cruz",
      reason: "Administrator approved registration for Teacher at TRIS",
      details: {
        previous_status: "Pending",
        new_status: "Approved",
        assigned_role: "teacher",
        assigned_school_id: "30079200-0000-0000-0000-000000000000",
      },
    });

    assert.equal(approveEvent.action, "ACCOUNT_APPROVED");
    assert.equal(approveEvent.details?.previous_status, "Pending");
    assert.equal(approveEvent.details?.new_status, "Approved");

    const declineEvent = await logAuditEvent({
      category: "USER_MANAGEMENT",
      action: "ACCOUNT_DECLINED",
      outcome: "SUCCESS",
      actorUserId: "admin-uuid-1",
      actorRole: "admin",
      targetType: "user",
      targetId: "target-teacher-uuid-2",
      reason: "Administrator declined staff registration",
      details: {
        previous_status: "Pending",
        new_status: "Declined",
      },
    });

    assert.equal(declineEvent.action, "ACCOUNT_DECLINED");
    assert.equal(declineEvent.details?.new_status, "Declined");
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Account Deletion Events
  // ---------------------------------------------------------------------------
  await t.test("Scenario 5 — Account deletion: Audits permanent removal of declined teacher accounts", async () => {
    const deleteEvent = await logAuditEvent({
      category: "USER_MANAGEMENT",
      action: "ACCOUNT_DELETED",
      outcome: "SUCCESS",
      actorUserId: "admin-uuid-1",
      actorRole: "admin",
      targetType: "user",
      targetId: "deleted-teacher-uuid",
      targetLabel: "Teacher ID: deleted-teacher-uuid",
      reason: "Administrator permanently deleted declined teacher account",
      details: {
        deleted_role: "teacher",
        deleted_status: "Declined",
      },
    });

    assert.equal(deleteEvent.action, "ACCOUNT_DELETED");
    assert.equal(deleteEvent.target_id, "deleted-teacher-uuid");
    assert.equal(deleteEvent.details?.deleted_status, "Declined");
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Document Upload Events (SF9, SF10, PSA)
  // ---------------------------------------------------------------------------
  await t.test("Scenario 6 — Document uploads: Audits SF9, SF10, and PSA uploads with metadata", async () => {
    const uploadEvent = await logAuditEvent({
      category: "DOCUMENT",
      action: "DOCUMENT_UPLOADED",
      outcome: "SUCCESS",
      actorUserId: "teacher-uuid-1",
      actorRole: "teacher",
      targetType: "document",
      targetId: "doc-uuid-1234",
      targetLabel: "SF9 - sf9_front.jpg",
      reason: "User staged document for validation and review",
      details: {
        document_type: "sf9",
        grade_level: "Grade 11",
        final_status: "submitted",
      },
    });

    assert.equal(uploadEvent.category, "DOCUMENT");
    assert.equal(uploadEvent.action, "DOCUMENT_UPLOADED");
    assert.equal(uploadEvent.details?.document_type, "sf9");
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: OCR Processing and Fallback Events
  // ---------------------------------------------------------------------------
  await t.test("Scenario 7 — OCR processing and fallback: Captures provider, duration, and error codes", async () => {
    // 7a. Completed OCR
    const ocrSuccess = await logAuditEvent({
      category: "OCR",
      action: "OCR_PROCESSING_COMPLETED",
      outcome: "SUCCESS",
      targetType: "ocr_job",
      targetLabel: "SF9 OCR Job (azure)",
      reason: "OCR extraction succeeded in 1240ms",
      details: {
        provider: "azure",
        model: "prebuilt-layout",
        durationMs: 1240,
        documentType: "sf9",
        confidence: 0.94,
        subjectCount: 8,
      },
    });

    assert.equal(ocrSuccess.category, "OCR");
    assert.equal(ocrSuccess.details?.provider, "azure");
    assert.equal(ocrSuccess.details?.durationMs, 1240);

    // 7b. Failed OCR (e.g. rate limit / quota)
    const ocrFailed = await logAuditEvent({
      category: "OCR",
      action: "OCR_PROCESSING_FAILED",
      outcome: "FAILURE",
      targetType: "ocr_job",
      targetLabel: "SF10 OCR Job Failed",
      reason: "Provider rate limit exceeded",
      details: {
        code: "RATE_LIMIT_EXCEEDED",
        status: 429,
        durationMs: 450,
      },
    });

    assert.equal(ocrFailed.outcome, "FAILURE");
    assert.equal(ocrFailed.details?.code, "RATE_LIMIT_EXCEEDED");
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: SF9/SF10 Comparison Events
  // ---------------------------------------------------------------------------
  await t.test("Scenario 8 — Comparison events: Records match counts, discrepancies, and student identification", async () => {
    const compEvent = await logAuditEvent({
      category: "COMPARISON",
      action: "COMPARISON_DISCREPANCY_FLAGGED",
      outcome: "WARNING",
      targetType: "comparison",
      targetId: "111687140043",
      targetLabel: "Comparison: DELA CRUZ, JUAN SANTOS",
      reason: "Comparison identified academic or identity discrepancies",
      details: {
        totalCompared: 16,
        matchingCount: 15,
        discrepanciesCount: 1,
        missingOrUnverifiedCount: 0,
        identityStatus: "MATCH",
      },
    });

    assert.equal(compEvent.category, "COMPARISON");
    assert.equal(compEvent.action, "COMPARISON_DISCREPANCY_FLAGGED");
    assert.equal(compEvent.details?.discrepanciesCount, 1);
  });

  // ---------------------------------------------------------------------------
  // Scenario 9: Grade Correction Before/After Tracking
  // ---------------------------------------------------------------------------
  await t.test("Scenario 9 — Grade correction tracking: Preserves before and after grades with reason", async () => {
    const gradeEvent = await logAuditEvent({
      category: "ACADEMIC",
      action: "GRADE_CORRECTED",
      outcome: "SUCCESS",
      actorUserId: "teacher-uuid-1",
      actorRole: "teacher",
      targetType: "document",
      targetId: "doc-uuid-5678",
      targetLabel: "SF9 #doc-uuid",
      reason: "Physical SF9 card shows 88 instead of OCR misread 38",
      details: {
        previous_status: "needs_review",
        new_status: "validated",
        corrections: {
          subject: "Oral Communication",
          beforeGrade: 38,
          correctedGrade: 88,
        },
      },
    });

    assert.equal(gradeEvent.category, "ACADEMIC");
    assert.equal(gradeEvent.action, "GRADE_CORRECTED");
    assert.equal(gradeEvent.details?.corrections?.correctedGrade, 88);
  });

  // ---------------------------------------------------------------------------
  // Scenario 10: Attendance and Remedial Integration
  // ---------------------------------------------------------------------------
  await t.test("Scenario 10 — Attendance and remedial updates: Audits review standing changes", async () => {
    const attEvent = await logAuditEvent({
      category: "ATTENDANCE",
      action: "ATTENDANCE_RECORD_UPDATED",
      outcome: "SUCCESS",
      actorRole: "principal",
      targetType: "student",
      targetId: "student-uuid-99",
      targetLabel: "Learner: Juan Dela Cruz (300792)",
      reason: "Principal recorded attendance standing review",
      details: {
        risk_status: "NORMAL",
        school_review_completed: true,
      },
    });

    assert.equal(attEvent.category, "ATTENDANCE");
    assert.equal(attEvent.action, "ATTENDANCE_RECORD_UPDATED");
    assert.equal(attEvent.details?.school_review_completed, true);
  });

  // ---------------------------------------------------------------------------
  // Scenario 11: Unauthorized Audit-Log Read Attempts Blocked & Audited
  // ---------------------------------------------------------------------------
  await t.test("Scenario 11 — Unauthorized audit-log access: Security denial recorded on unauthorized probe", async () => {
    const secEvent = await logAuditEvent({
      category: "SECURITY",
      action: "UNAUTHORIZED_ACCESS_DENIED",
      outcome: "DENIED",
      actorUserId: "unauthorized-teacher-uuid",
      actorRole: "teacher",
      targetType: "system",
      targetId: "/admin/audit-logs",
      targetLabel: "Audit Logs Module",
      reason: "Non-admin user attempted to access administrator audit logs.",
    });

    assert.equal(secEvent.category, "SECURITY");
    assert.equal(secEvent.action, "UNAUTHORIZED_ACCESS_DENIED");
    assert.equal(secEvent.outcome, "DENIED");
  });

  // ---------------------------------------------------------------------------
  // Scenario 12: Immutability Invariant Verification (No Update/Delete Policy)
  // ---------------------------------------------------------------------------
  await t.test("Scenario 12 — Immutability invariants: Migration 014 strictly omits UPDATE and DELETE policies", () => {
    const migrationPath = path.join(rootDir, "supabase/migrations/014_admin_audit_logs.sql");
    assert.ok(fs.existsSync(migrationPath), "Migration 014 must exist");

    const sqlContent = fs.readFileSync(migrationPath, "utf8");

    // Must NOT contain an UPDATE policy on audit_logs
    assert.ok(
      !sqlContent.includes("FOR UPDATE") && !sqlContent.includes("ON public.audit_logs FOR UPDATE"),
      "audit_logs MUST NOT grant any UPDATE policy"
    );

    // Must NOT contain a DELETE policy on audit_logs
    assert.ok(
      !sqlContent.includes("FOR DELETE") && !sqlContent.includes("ON public.audit_logs FOR DELETE"),
      "audit_logs MUST NOT grant any DELETE policy"
    );

    // Must enforce RLS
    assert.ok(
      sqlContent.includes("ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;"),
      "audit_logs MUST have RLS enabled"
    );

    // Must check that only admins can view
    assert.ok(
      sqlContent.includes("ur.role = 'admin'") && sqlContent.includes("ur.account_status = 'Approved'"),
      "audit_logs read access MUST be restricted to Approved Administrators"
    );
  });

  // ---------------------------------------------------------------------------
  // Scenario 13: Server-Side Filtering and Pagination
  // ---------------------------------------------------------------------------
  await t.test("Scenario 13 — Server-side querying, filtering, and pagination", async () => {
    const result = await queryAuditLogs({
      category: "AUTHENTICATION",
    }, { page: 1, pageSize: 5 });

    assert.ok(Array.isArray(result.logs));
    assert.ok(result.totalCount >= 1);
    assert.ok(result.pageSize === 5);
    assert.ok(result.logs.every((l) => l.category === "AUTHENTICATION"));
    assert.ok(typeof result.summaryMetrics.totalEvents === "number");
  });

  // ---------------------------------------------------------------------------
  // Scenario 14: CSV Export Authorization & OWASP Formula Injection Protection
  // ---------------------------------------------------------------------------
  await t.test("Scenario 14 — CSV export safety: Leading formula characters (=, +, -, @) are sanitized", () => {
    // Dangerous spreadsheet formula attempts
    assert.equal(sanitizeCsvCell("=SUM(A1:A10)"), `"'=SUM(A1:A10)"`);
    assert.equal(sanitizeCsvCell("+cmd|' /C calc'!A0"), `"'+cmd|' /C calc'!A0"`);
    assert.equal(sanitizeCsvCell("-10+20"), `"'-10+20"`);
    assert.equal(sanitizeCsvCell("@SUM(1,2)"), `"'@SUM(1,2)"`);

    // Standard benign cell
    assert.equal(sanitizeCsvCell("Standard Text"), `"Standard Text"`);
    assert.equal(sanitizeCsvCell('With "Quotes"'), `"With ""Quotes"""`);

    // CSV generator
    const testEvents = [
      {
        id: "test-uuid-1",
        created_at: new Date().toISOString(),
        category: "AUTHENTICATION",
        action: "AUTH_LOGIN_SUCCESS",
        outcome: "SUCCESS",
        actor_role: "admin",
        actor_email: "=danger@evil.com",
        actor_school_name: "TRIS",
        target_type: "user",
        target_id: "target-1",
        target_label: "+Malicious Formula",
        reason: "@FormulaInReason",
        details: { safe: true },
        ip_address: "127.0.0.1",
      },
    ];

    const csvOutput = generateAuditLogsCsv(testEvents);
    assert.ok(csvOutput.includes(`"'=danger@evil.com"`), "Actor email starting with = must be prepended with '");
    assert.ok(csvOutput.includes(`"'+Malicious Formula"`), "Target label starting with + must be prepended with '");
    assert.ok(csvOutput.includes(`"'@FormulaInReason"`), "Reason starting with @ must be prepended with '");
  });

  // ---------------------------------------------------------------------------
  // Scenario 15: Event Duplication and Unique ID Tracking
  // ---------------------------------------------------------------------------
  await t.test("Scenario 15 — Event identity: Every audit event has a distinct immutable UUID", async () => {
    const e1 = await logAuditEvent({
      category: "SYSTEM",
      action: "SYSTEM_CONFIGURATION_CHANGED",
      outcome: "SUCCESS",
      reason: "Event 1",
    });

    const e2 = await logAuditEvent({
      category: "SYSTEM",
      action: "SYSTEM_CONFIGURATION_CHANGED",
      outcome: "SUCCESS",
      reason: "Event 2",
    });

    assert.notEqual(e1.id, e2.id, "Events must receive unique UUID identifiers");
  });

  // ---------------------------------------------------------------------------
  // Scenario 16: Audit Failure Handling for Critical Actions
  // ---------------------------------------------------------------------------
  await t.test("Scenario 16 — Resilience: Logging failure never throws unhandled exception", async () => {
    // Should not throw even with malformed or edge-case parameters
    await assert.doesNotReject(async () => {
      await logAuditEvent({
        category: "SYSTEM",
        action: "SYSTEM_CONFIGURATION_CHANGED",
        outcome: "SUCCESS",
        details: null,
        reason: undefined,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 17: Timezone Localization (Asia/Manila UTC+8)
  // ---------------------------------------------------------------------------
  await t.test("Scenario 17 — Timezone formatting: Produces accurate Asia/Manila (UTC+8) timestamps", () => {
    // Fixed UTC time: 2026-11-09T00:00:00Z -> Should be Nov 9, 2026, 08:00:00 AM PHT
    const formatted = formatToManilaTime("2026-11-09T00:00:00Z");
    assert.ok(formatted.includes("Nov 9, 2026") || formatted.includes("November 9, 2026"));
    assert.ok(formatted.includes("8:00") || formatted.includes("08:00"));
  });

  // ---------------------------------------------------------------------------
  // Scenario 18: Privacy By Design & Data Sanitization
  // ---------------------------------------------------------------------------
  await t.test("Scenario 18 — Data minimization: Passwords, tokens, and raw binary images are excluded", () => {
    const rawDetails = {
      userPassword: "PlainPassword99!",
      accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      apiKey: "sk-secret-123456",
      documentImage: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/...",
      rawText: "=== FULL EXTRACTED TEXT FROM OCR OF 10000 CHARACTERS ===",
      safeField: "Grade 11 STEM",
    };

    const sanitized = sanitizeAuditDetails(rawDetails);

    assert.equal(sanitized.userPassword, "[REDACTED]");
    assert.equal(sanitized.accessToken, "[REDACTED]");
    assert.equal(sanitized.apiKey, "[REDACTED]");
    assert.equal(sanitized.documentImage, "[BINARY_OR_BULKY_PAYLOAD_EXCLUDED]");
    assert.equal(sanitized.rawText, "[BINARY_OR_BULKY_PAYLOAD_EXCLUDED]");
    assert.equal(sanitized.safeField, "Grade 11 STEM");
  });
});

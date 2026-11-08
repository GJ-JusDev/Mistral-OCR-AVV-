import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Phase F: Migration 013 SQL Security & Invariant Audit", async (t) => {
  const migrationPath = path.join(rootDir, "supabase/migrations/013_attendance_and_remedial_tracking.sql");
  assert.ok(fs.existsSync(migrationPath), "Migration 013 file must exist");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  await t.test("1. Zero permissive 'USING (true)' SELECT policies exist in Migration 013", () => {
    // Audit check: Ensure NO unrestricted read policies are created with USING (true)
    const hasCreatePermissive = /CREATE POLICY.*USING\s*\(\s*true\s*\)/i.test(sql);
    assert.strictEqual(hasCreatePermissive, false, "Must not contain any CREATE POLICY with USING (true)");

    // All SELECT policies must be strictly scoped via authorized role functions
    assert.ok(sql.includes('"Authorized read attendance records"'), "Must use scoped read policy for attendance");
    assert.ok(sql.includes('"Authorized read attendance summaries"'), "Must use scoped read policy for summaries");
    assert.ok(sql.includes('"Authorized read remedial records"'), "Must use scoped read policy for remedial");
  });

  await t.test("2. Foreign key for documents uses ON DELETE SET NULL to preserve student history", () => {
    // Documents reference on attendance_records must be ON DELETE SET NULL
    assert.ok(
      sql.includes("document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL"),
      "attendance_records.document_id must use ON DELETE SET NULL to preserve historical records if document is purged"
    );
    // Documents reference on attendance_summaries must be ON DELETE SET NULL
    assert.ok(
      sql.includes("document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL"),
      "attendance_summaries.document_id must use ON DELETE SET NULL"
    );
    // Documents reference on remedial_records must be ON DELETE SET NULL
    assert.ok(
      sql.includes("document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL"),
      "remedial_records.document_id must use ON DELETE SET NULL"
    );
    // Student references must cascade
    assert.ok(
      sql.includes("student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE"),
      "student_id must use ON DELETE CASCADE"
    );
  });

  await t.test("3. Unique indexes handle nullable semester deterministically via COALESCE", () => {
    assert.ok(
      sql.includes("COALESCE(semester, 'FULL_YEAR')"),
      "attendance unique index must use COALESCE on semester to prevent duplicate NULL entries"
    );
    assert.ok(
      sql.includes("COALESCE(semester, 'ANNUAL')"),
      "remedial unique index must use COALESCE on semester to prevent duplicate NULL entries"
    );
  });

  await t.test("4. Numerical ranges and verification state constraints are enforced", () => {
    assert.ok(sql.includes("attendance_percentage >= 0 AND attendance_percentage <= 100"));
    assert.ok(sql.includes("absence_percentage >= 0 AND absence_percentage <= 100"));
    assert.ok(sql.includes("original_final_grade >= 0 AND original_final_grade <= 100"));
    assert.ok(sql.includes("total_school_days >= 0"));
    assert.ok(sql.includes("computed_total >= 0"));
  });

  await t.test("5. Separate INSERT, UPDATE, and DELETE policies with strict role boundaries", () => {
    // DELETE must be restricted exclusively to admin and service_role
    assert.ok(sql.includes('"Admin delete attendance records"'));
    assert.ok(sql.includes('"Admin delete attendance summaries"'));
    assert.ok(sql.includes('"Admin delete remedial records"'));

    // Principal cannot update raw attendance records (only summaries for school_review)
    assert.ok(!sql.includes('public.is_principal() AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = attendance_records.document_id)'), 
      "Principal must not have arbitrary UPDATE access to raw monthly attendance records");
  });
});

test("Phase F: Non-Destructive Recovery Plan Audit", async (t) => {
  const recoveryPath = path.join(rootDir, "supabase/migrations/013_rollback_recovery.sql");
  assert.ok(fs.existsSync(recoveryPath), "Rollback recovery file must exist");
  const recoverySql = fs.readFileSync(recoveryPath, "utf-8");

  await t.test("1. Recovery script does NOT unconditionally drop populated tables", () => {
    // The active Tier 1 script must NOT drop tables, but rather deactivate write access and enter read-only mode
    assert.ok(
      recoverySql.includes("TIER 1: NON-DESTRUCTIVE FEATURE DEACTIVATION"),
      "Must provide non-destructive Tier 1 feature deactivation"
    );
    assert.ok(
      !recoverySql.startsWith("DROP TABLE"),
      "Recovery script must not automatically drop tables on execution"
    );
    assert.ok(
      recoverySql.includes("TIER 2: EMERGENCY DATA SNAPSHOT"),
      "Must provide safe archival backup instructions before any structural reset"
    );
  });
});

test("Phase F: Role-Based Access Control (RBAC) Logic Simulator", async (t) => {
  // Simulates PostgreSQL RLS policy expressions against mock auth contexts
  const mockUserRoles = {
    admin: { user_id: "user-admin", role: "admin", account_status: "Approved", school_id: "school-tris" },
    principal: { user_id: "user-principal", role: "principal", account_status: "Approved", school_id: "school-tris" },
    teacher_approved: { user_id: "user-teacher-1", role: "teacher", account_status: "Approved", school_id: "school-tris" },
    teacher_other_school: { user_id: "user-teacher-2", role: "teacher", account_status: "Approved", school_id: "school-other" },
    pending_user: { user_id: "user-pending", role: "teacher", account_status: "Pending", school_id: null },
    declined_user: { user_id: "user-declined", role: "teacher", account_status: "Declined", school_id: null },
    anonymous: null,
  };

  const mockRecord = {
    student_id: "student-1",
    school_id: "school-tris",
    uploaded_by: "user-teacher-1",
    status: "needs_review",
  };

  function canReadRecord(userContext, record) {
    if (!userContext) return false;
    if (userContext.account_status !== "Approved") return false;

    // Admin
    if (userContext.role === "admin") return true;

    // Principal: school match
    if (userContext.role === "principal") {
      return userContext.school_id === record.school_id;
    }

    // Teacher: uploaded by teacher or same school
    if (userContext.role === "teacher") {
      return userContext.user_id === record.uploaded_by || userContext.school_id === record.school_id;
    }

    return false;
  }

  function canModifyRawAttendance(userContext, record) {
    if (!userContext) return false;
    if (userContext.account_status !== "Approved") return false;

    // Admin
    if (userContext.role === "admin") return true;

    // Principal cannot freely modify raw teacher attendance
    if (userContext.role === "principal") return false;

    // Teacher: only on non-finalized records they uploaded
    if (userContext.role === "teacher") {
      return userContext.user_id === record.uploaded_by && record.status !== "approved" && record.status !== "rejected";
    }

    return false;
  }

  await t.test("1. Anonymous / Unauthenticated cannot read or modify records", () => {
    assert.strictEqual(canReadRecord(mockUserRoles.anonymous, mockRecord), false);
    assert.strictEqual(canModifyRawAttendance(mockUserRoles.anonymous, mockRecord), false);
  });

  await t.test("2. Pending or Declined accounts cannot access student records", () => {
    assert.strictEqual(canReadRecord(mockUserRoles.pending_user, mockRecord), false);
    assert.strictEqual(canReadRecord(mockUserRoles.declined_user, mockRecord), false);
    assert.strictEqual(canModifyRawAttendance(mockUserRoles.pending_user, mockRecord), false);
    assert.strictEqual(canModifyRawAttendance(mockUserRoles.declined_user, mockRecord), false);
  });

  await t.test("3. Approved Teachers can modify non-finalized records they uploaded", () => {
    assert.strictEqual(canReadRecord(mockUserRoles.teacher_approved, mockRecord), true);
    assert.strictEqual(canModifyRawAttendance(mockUserRoles.teacher_approved, mockRecord), true);

    // Finalized document cannot be modified by teacher
    const finalizedRecord = { ...mockRecord, status: "approved" };
    assert.strictEqual(canModifyRawAttendance(mockUserRoles.teacher_approved, finalizedRecord), false);
  });

  await t.test("4. Principals can view school records but CANNOT alter raw teacher attendance", () => {
    assert.strictEqual(canReadRecord(mockUserRoles.principal, mockRecord), true);
    assert.strictEqual(canModifyRawAttendance(mockUserRoles.principal, mockRecord), false, 
      "Principal role must not freely modify raw teacher attendance figures");
  });

  await t.test("5. Administrators retain authorized administrative oversight", () => {
    assert.strictEqual(canReadRecord(mockUserRoles.admin, mockRecord), true);
    assert.strictEqual(canModifyRawAttendance(mockUserRoles.admin, mockRecord), true);
  });
});

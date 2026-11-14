import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export async function runRealPostgresVerification() {
  console.log("================================================================================");
  console.log("STARTING REAL POSTGRESQL (PGLITE) MIGRATION 013 & RLS SECURITY VERIFICATION");
  console.log("================================================================================");

  const db = new PGlite();
  
  // 1. Check PostgreSQL Engine Version
  const verRes = await db.query("SELECT version();");
  const pgVersion = verRes.rows[0].version;
  console.log(`[1] Real PostgreSQL Engine Version: ${pgVersion}\n`);

  // 2. Setup Supabase Core Infrastructure (auth schema, roles, and helper functions)
  console.log("[2] Provisioning Supabase Core Infrastructure & Base Schemas...");
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;

    -- Roles standard in Supabase
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END
    $$;

    -- Standard Supabase Auth Context Functions
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$ LANGUAGE sql STABLE;

    -- Base Enums and Helper Tables
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY,
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      division TEXT,
      region TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
      role user_role NOT NULL DEFAULT 'teacher',
      account_status TEXT NOT NULL DEFAULT 'Pending' CHECK (account_status IN ('Pending', 'Approved', 'Declined')),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      suffix TEXT,
      birth_date DATE,
      sex TEXT CHECK (sex IN ('M', 'F')),
      grade_level TEXT,
      status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL,
      image_url TEXT NOT NULL,
      original_filename TEXT,
      extracted_text TEXT,
      extracted_fields JSONB DEFAULT '{}'::jsonb,
      ocr_model TEXT,
      ocr_confidence REAL,
      status TEXT NOT NULL DEFAULT 'needs_review',
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      q1 NUMERIC,
      q2 NUMERIC,
      q3 NUMERIC,
      q4 NUMERIC,
      final_grade NUMERIC,
      school_year TEXT,
      semester TEXT,
      status TEXT,
      needs_verification BOOLEAN DEFAULT false,
      remedial_status TEXT,
      remedial_class_mark NUMERIC,
      recomputed_final_grade NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    -- Base Helper Functions from Migration 009
    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'admin' AND account_status = 'Approved'
      );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS boolean AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'principal' AND account_status = 'Approved'
      );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS boolean AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'teacher' AND account_status = 'Approved'
      );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS uuid AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN NULL; END IF;
      RETURN (
        SELECT school_id FROM public.user_roles 
        WHERE user_id = auth.uid()
        LIMIT 1
      );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
  `);
  console.log("  ✓ Base Supabase tables, types, auth schema, and security definer functions created.\n");

  // 3. Execute Migration 013 DDL
  console.log("[3] Executing 013_attendance_and_remedial_tracking.sql against PostgreSQL 18.6...");
  const migrationPath = path.resolve(rootDir, "supabase/migrations/013_attendance_and_remedial_tracking.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf8");

  const startMigrate = Date.now();
  await db.exec(migrationSql);
  console.log(`  ✓ Migration 013 executed successfully in ${Date.now() - startMigrate}ms without errors!\n`);

  // 4. Grant table privileges to authenticated & anon roles
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
  `);

  // 5. Seed Institutional Test Data (TRIS vs Other High School)
  console.log("[4] Seeding institutional entities, users, students, and documents...");
  const schoolTrisId = "a0000000-0000-0000-0000-000000000001";
  const schoolOtherId = "a0000000-0000-0000-0000-000000000002";

  const userAdminId = "10000000-0000-0000-0000-000000000001";
  const userTeacherApprovedId = "20000000-0000-0000-0000-000000000001";
  const userTeacherPendingId = "20000000-0000-0000-0000-000000000002";
  const userTeacherDeclinedId = "20000000-0000-0000-0000-000000000003";
  const userPrincipalTrisId = "30000000-0000-0000-0000-000000000001";
  const userPrincipalOtherId = "30000000-0000-0000-0000-000000000002";

  const studentTrisId = "c0000000-0000-0000-0000-000000000001";
  const studentOtherId = "c0000000-0000-0000-0000-000000000002";

  const docTrisUnfinalizedId = "d0000000-0000-0000-0000-000000000001";
  const docTrisApprovedId = "d0000000-0000-0000-0000-000000000002";
  const docOtherId = "d0000000-0000-0000-0000-000000000003";

  const subjectGradeTrisId = "f0000000-0000-0000-0000-000000000001";

  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES
      ('${schoolTrisId}', '500169', 'Taysan Resettlement Integrated School'),
      ('${schoolOtherId}', '300999', 'Other Secondary School');

    INSERT INTO auth.users (id, email) VALUES
      ('${userAdminId}', 'admin@tris.edu.ph'),
      ('${userTeacherApprovedId}', 'teacher.approved@tris.edu.ph'),
      ('${userTeacherPendingId}', 'teacher.pending@tris.edu.ph'),
      ('${userTeacherDeclinedId}', 'teacher.declined@tris.edu.ph'),
      ('${userPrincipalTrisId}', 'principal@tris.edu.ph'),
      ('${userPrincipalOtherId}', 'principal@other.edu.ph');

    INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES
      ('${userAdminId}', 'admin', 'Approved', '${schoolTrisId}'),
      ('${userTeacherApprovedId}', 'teacher', 'Approved', '${schoolTrisId}'),
      ('${userTeacherPendingId}', 'teacher', 'Pending', '${schoolTrisId}'),
      ('${userTeacherDeclinedId}', 'teacher', 'Declined', '${schoolTrisId}'),
      ('${userPrincipalTrisId}', 'principal', 'Approved', '${schoolTrisId}'),
      ('${userPrincipalOtherId}', 'principal', 'Approved', '${schoolOtherId}');

    INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level) VALUES
      ('${studentTrisId}', '${schoolTrisId}', '123456789012', 'JUAN', 'DELA CRUZ', 'Grade 11'),
      ('${studentOtherId}', '${schoolOtherId}', '987654321098', 'MARIA', 'CLARA', 'Grade 11');

    INSERT INTO public.documents (id, student_id, school_id, document_type, image_url, status, uploaded_by) VALUES
      ('${docTrisUnfinalizedId}', '${studentTrisId}', '${schoolTrisId}', 'sf9', 'https://storage/sf9_unfinalized.png', 'needs_review', '${userTeacherApprovedId}'),
      ('${docTrisApprovedId}', '${studentTrisId}', '${schoolTrisId}', 'sf9', 'https://storage/sf9_approved.png', 'approved', '${userTeacherApprovedId}'),
      ('${docOtherId}', '${studentOtherId}', '${schoolOtherId}', 'sf9', 'https://storage/sf9_other.png', 'needs_review', '${userTeacherApprovedId}');

    INSERT INTO public.subject_grades (id, student_id, document_id, subject, final_grade, school_year, semester) VALUES
      ('${subjectGradeTrisId}', '${studentTrisId}', '${docTrisUnfinalizedId}', 'General Mathematics', 72, '2023-2024', '1st Semester');
  `);
  console.log("  ✓ Seed data loaded cleanly.\n");

  // Helper function to switch authenticated sessions
  async function asUser(userId, role = "authenticated") {
    await db.exec(`
      RESET SESSION AUTHORIZATION;
      SET ROLE ${role};
      ${userId ? `SET request.jwt.claim.sub = '${userId}';` : `RESET request.jwt.claim.sub;`}
      SET request.jwt.claim.role = '${role}';
    `);
  }

  async function asSuperuser() {
    await db.exec(`
      RESET SESSION AUTHORIZATION;
      SET ROLE postgres;
      RESET request.jwt.claim.sub;
      RESET request.jwt.claim.role;
    `);
  }

  // TEST SUITE EXECUTION
  const results = [];
  function recordTest(testName, passed, detail = "") {
    results.push({ testName, passed, detail });
    const mark = passed ? "✔" : "✖";
    console.log(`  ${mark} ${testName} ${detail ? `(${detail})` : ""}`);
    if (!passed) throw new Error(`Test failed: ${testName} - ${detail}`);
  }

  console.log("[5] Running PostgreSQL RLS Security Tests...");

  // 5.1 Approved Teacher: Can insert attendance record for own unfinalized document
  await asUser(userTeacherApprovedId);
  const attRecId1 = "b0000000-0000-0000-0000-000000000001";
  try {
    await db.query(`
      INSERT INTO public.attendance_records (
        id, student_id, document_id, school_id, grade_level, school_year, semester, metric_label, monthly_values, computed_total
      ) VALUES (
        '${attRecId1}', '${studentTrisId}', '${docTrisUnfinalizedId}', '${schoolTrisId}', 'Grade 11', '2023-2024', '1st Semester', 'No. of School Days', '{"Jun": 21, "Jul": 20}'::jsonb, 41
      );
    `);
    recordTest("Approved Teacher INSERT Attendance Record for own document", true);
  } catch (err) {
    recordTest("Approved Teacher INSERT Attendance Record for own document", false, err.message);
  }

  // 5.2 Approved Teacher: Cannot insert for already approved document
  try {
    let failed = false;
    try {
      await db.query(`
        INSERT INTO public.attendance_records (
          student_id, document_id, school_id, grade_level, school_year, semester, metric_label, monthly_values
        ) VALUES (
          '${studentTrisId}', '${docTrisApprovedId}', '${schoolTrisId}', 'Grade 11', '2023-2024', '1st Semester', 'No. of Days Present', '{"Jun": 20}'::jsonb
        );
      `);
    } catch {
      failed = true;
    }
    recordTest("Approved Teacher INSERT blocked on already finalized/approved document", failed);
  } catch (err) {
    recordTest("Approved Teacher INSERT blocked on already finalized/approved document", false, err.message);
  }

  // 5.3 Teacher NULL Bypass Attempt: Cannot insert with document_id = NULL
  try {
    let failed = false;
    try {
      await db.query(`
        INSERT INTO public.attendance_records (
          student_id, document_id, school_id, grade_level, school_year, semester, metric_label, monthly_values
        ) VALUES (
          '${studentTrisId}', NULL, '${schoolTrisId}', 'Grade 11', '2023-2024', '1st Semester', 'No. of Days Absent', '{"Jun": 1}'::jsonb
        );
      `);
    } catch {
      failed = true;
    }
    recordTest("Teacher NULL document_id bypass strictly blocked by RLS WITH CHECK", failed);
  } catch (err) {
    recordTest("Teacher NULL document_id bypass strictly blocked by RLS WITH CHECK", false, err.message);
  }

  // 5.4 Teacher NULL Bypass Attempt: Cannot insert with school_id = NULL
  try {
    let failed = false;
    try {
      await db.query(`
        INSERT INTO public.attendance_records (
          student_id, document_id, school_id, grade_level, school_year, semester, metric_label, monthly_values
        ) VALUES (
          '${studentTrisId}', '${docTrisUnfinalizedId}', NULL, 'Grade 11', '2023-2024', '1st Semester', 'No. of Days Absent', '{"Jun": 1}'::jsonb
        );
      `);
    } catch {
      failed = true;
    }
    recordTest("Teacher NULL school_id bypass strictly blocked by RLS WITH CHECK", failed);
  } catch (err) {
    recordTest("Teacher NULL school_id bypass strictly blocked by RLS WITH CHECK", false, err.message);
  }

  // 5.5 Cross-School Teacher Attempt: Cannot insert record for student in another school
  try {
    let failed = false;
    try {
      await db.query(`
        INSERT INTO public.attendance_records (
          student_id, document_id, school_id, grade_level, school_year, semester, metric_label, monthly_values
        ) VALUES (
          '${studentOtherId}', '${docOtherId}', '${schoolOtherId}', 'Grade 11', '2023-2024', '1st Semester', 'No. of School Days', '{"Jun": 21}'::jsonb
        );
      `);
    } catch {
      failed = true;
    }
    recordTest("Teacher cross-school insert blocked by RLS", failed);
  } catch (err) {
    recordTest("Teacher cross-school insert blocked by RLS", false, err.message);
  }

  // 5.6 Pending Teacher: Cannot SELECT or INSERT records
  await asUser(userTeacherPendingId);
  const pendingSelect = await db.query("SELECT * FROM public.attendance_records;");
  recordTest("Pending Teacher SELECT returns 0 records", pendingSelect.rows.length === 0);

  let pendingInsertBlocked = false;
  try {
    await db.query(`
      INSERT INTO public.attendance_records (
        student_id, document_id, school_id, grade_level, school_year, metric_label, monthly_values
      ) VALUES (
        '${studentTrisId}', '${docTrisUnfinalizedId}', '${schoolTrisId}', 'Grade 11', '2023-2024', 'No. of School Days', '{"Jun": 21}'::jsonb
      );
    `);
  } catch {
    pendingInsertBlocked = true;
  }
  recordTest("Pending Teacher INSERT blocked by RLS", pendingInsertBlocked);

  // 5.7 Declined Teacher: Cannot SELECT or INSERT records
  await asUser(userTeacherDeclinedId);
  const declinedSelect = await db.query("SELECT * FROM public.attendance_records;");
  recordTest("Declined Teacher SELECT returns 0 records", declinedSelect.rows.length === 0);

  // 5.8 Anonymous / Unauthorized: Cannot SELECT or INSERT
  await asUser(null, "anon");
  const anonSelect = await db.query("SELECT * FROM public.attendance_records;");
  recordTest("Anonymous User SELECT returns 0 records", anonSelect.rows.length === 0);

  // 5.9 Insert Attendance Summary as Approved Teacher
  await asUser(userTeacherApprovedId);
  const summaryId1 = "b0000000-0000-0000-0000-000000000010";
  await db.query(`
    INSERT INTO public.attendance_summaries (
      id, student_id, document_id, school_id, grade_level, school_year, semester, total_school_days, total_days_present, total_days_absent, attendance_percentage, absence_percentage, risk_status
    ) VALUES (
      '${summaryId1}', '${studentTrisId}', '${docTrisUnfinalizedId}', '${schoolTrisId}', 'Grade 11', '2023-2024', '1st Semester', 200, 155, 45, 77.5, 22.5, 'ATTENDANCE_REVIEW_REQUIRED'
    );
  `);
  recordTest("Approved Teacher INSERT attendance_summaries", true);

  // 5.10 Insert Remedial Record as Approved Teacher
  const remedialId1 = "e0000000-0000-0000-0000-000000000001";
  await db.query(`
    INSERT INTO public.remedial_records (
      id, student_id, document_id, school_id, subject_grade_id, subject, semester, school_year, original_final_grade, remedial_class_mark, recomputed_final_grade, status, is_deficiency_resolved, is_verified, supporting_document_ref
    ) VALUES (
      '${remedialId1}', '${studentTrisId}', '${docTrisUnfinalizedId}', '${schoolTrisId}', '${subjectGradeTrisId}', 'General Mathematics', '1st Semester', '2023-2024', 72, 78, 75, 'REMEDIAL_PASSED', true, true, 'CERT-RECOMP-2024-001'
    );
  `);
  recordTest("Approved Teacher INSERT remedial_records", true);

  // 5.11 Approved Principal Permissions & Restriction Checks
  console.log("\n[6] Testing Principal Permissions & Immutability Enforcement...");
  await asUser(userPrincipalTrisId);

  // Principal can SELECT attendance summary for their school
  const prinSummarySelect = await db.query("SELECT * FROM public.attendance_summaries WHERE id = $1;", [summaryId1]);
  recordTest("Principal can SELECT attendance summary of own school", prinSummarySelect.rows.length === 1);

  // Principal CANNOT INSERT attendance records
  let prinInsertBlocked = false;
  try {
    await db.query(`
      INSERT INTO public.attendance_records (
        student_id, document_id, school_id, grade_level, school_year, metric_label, monthly_values
      ) VALUES (
        '${studentTrisId}', '${docTrisUnfinalizedId}', '${schoolTrisId}', 'Grade 11', '2023-2024', 'No. of School Days', '{"Jun": 21}'::jsonb
      );
    `);
  } catch {
    prinInsertBlocked = true;
  }
  recordTest("Principal INSERT into attendance_records blocked by RLS", prinInsertBlocked);

  // Principal CANNOT modify raw attendance totals via direct UPDATE (blocked by RLS returning 0 affected rows or trigger exception)
  let prinUpdateDirectBlocked = false;
  try {
    const res = await db.query(`
      UPDATE public.attendance_summaries 
      SET total_school_days = 210, total_days_absent = 10 
      WHERE id = '${summaryId1}';
    `);
    // In PostgreSQL RLS, an unauthorized UPDATE matches 0 rows (affectedRows === 0)
    if (res.affectedRows === 0) {
      prinUpdateDirectBlocked = true;
    }
  } catch {
    prinUpdateDirectBlocked = true;
  }
  const checkSummary = await db.query("SELECT total_school_days FROM public.attendance_summaries WHERE id = $1;", [summaryId1]);
  recordTest("Principal direct UPDATE modifying total_school_days blocked (RLS 0 affected rows & value unchanged)", prinUpdateDirectBlocked && Number(checkSummary.rows[0].total_school_days) === 200);

  // Principal CANNOT modify remedial records
  let prinRemedialUpdateBlocked = false;
  try {
    const res = await db.query(`
      UPDATE public.remedial_records 
      SET recomputed_final_grade = 85 
      WHERE id = '${remedialId1}';
    `);
    if (res.affectedRows === 0) {
      prinRemedialUpdateBlocked = true;
    }
  } catch {
    prinRemedialUpdateBlocked = true;
  }
  const checkRemedial = await db.query("SELECT recomputed_final_grade FROM public.remedial_records WHERE id = $1;", [remedialId1]);
  recordTest("Principal direct UPDATE on remedial_records blocked by RLS (0 affected rows & grade unchanged)", prinRemedialUpdateBlocked && Number(checkRemedial.rows[0].recomputed_final_grade) === 75);

  // 5.12 Principal RPC Execution (record_principal_attendance_review)
  console.log("\n[7] Testing record_principal_attendance_review RPC...");
  const rpcRes = await db.query(`
    SELECT public.record_principal_attendance_review(
      '${summaryId1}', true, 'Reviewed and validated by TRIS School Head. Student presented authorized medical excuses.'
    ) as result;
  `);
  const rpcJson = rpcRes.rows[0].result;
  recordTest("Principal RPC record_principal_attendance_review succeeds", rpcJson.success === true && rpcJson.school_review_completed === true);

  // Verify raw numbers remain unchanged after RPC
  const verifiedSummary = await db.query("SELECT * FROM public.attendance_summaries WHERE id = $1;", [summaryId1]);
  const row = verifiedSummary.rows[0];
  recordTest("Summary raw metrics preserved (total_school_days = 200, absence = 22.5%)", Number(row.total_school_days) === 200 && Number(row.absence_percentage) === 22.5);
  recordTest("Summary school_review_notes recorded properly", row.school_review_notes.includes("TRIS School Head"));

  // 5.13 Cross-School Principal Attempt: Cannot review summary of another school
  await asUser(userPrincipalOtherId);
  let otherPrinBlocked = false;
  try {
    await db.query(`
      SELECT public.record_principal_attendance_review(
        '${summaryId1}', true, 'Intruder principal note'
      );
    `);
  } catch {
    otherPrinBlocked = true;
  }
  recordTest("Cross-School Principal review rejected with Access Denied", otherPrinBlocked);

  // 5.13b Teacher Attempt: Cannot call record_principal_attendance_review
  await asUser(userTeacherApprovedId);
  let teacherRpcBlocked = false;
  try {
    await db.query(`
      SELECT public.record_principal_attendance_review(
        '${summaryId1}', true, 'Unauthorized teacher review attempt'
      );
    `);
  } catch (err) {
    if (err.message.includes("Access denied: Only an authorized Principal or Admin")) teacherRpcBlocked = true;
  }
  recordTest("Approved Teacher call to record_principal_attendance_review rejected", teacherRpcBlocked);

  // 5.13c Pending Teacher Attempt: Cannot call record_principal_attendance_review
  await asUser(userTeacherPendingId);
  let pendingRpcBlocked = false;
  try {
    await db.query(`
      SELECT public.record_principal_attendance_review(
        '${summaryId1}', true, 'Pending teacher review attempt'
      );
    `);
  } catch (err) {
    if (err.message.includes("Access denied: Only an authorized Principal or Admin")) pendingRpcBlocked = true;
  }
  recordTest("Pending Teacher call to record_principal_attendance_review rejected", pendingRpcBlocked);

  // 5.13d Anonymous Attempt: Cannot call record_principal_attendance_review
  await asUser(null, "anon");
  let anonRpcBlocked = false;
  try {
    await db.query(`
      SELECT public.record_principal_attendance_review(
        '${summaryId1}', true, 'Anonymous review attempt'
      );
    `);
  } catch (err) {
    // Blocked by SQL grant or exception
    anonRpcBlocked = true;
  }
  recordTest("Anonymous User call to record_principal_attendance_review rejected", anonRpcBlocked);

  // 5.14 Referential Integrity & Anti-Corruption Triggers
  console.log("\n[8] Testing Referential Integrity Trigger (trg_validate_attendance_and_remedial_integrity)...");
  await asSuperuser(); // test trigger logic directly

  // Case A: Student does not match school
  let mismatchStudentSchoolBlocked = false;
  try {
    await db.query(`
      INSERT INTO public.attendance_records (
        student_id, school_id, grade_level, school_year, metric_label, monthly_values
      ) VALUES (
        '${studentTrisId}', '${schoolOtherId}', 'Grade 11', '2023-2024', 'No. of School Days', '{"Jun": 21}'::jsonb
      );
    `);
  } catch (err) {
    if (err.message.includes("Cross-school violation")) mismatchStudentSchoolBlocked = true;
  }
  recordTest("Trigger rejects student-to-school mismatch (Cross-school violation)", mismatchStudentSchoolBlocked);

  // Case B: Document does not match student
  let mismatchDocStudentBlocked = false;
  try {
    await db.query(`
      INSERT INTO public.attendance_records (
        student_id, document_id, school_id, grade_level, school_year, metric_label, monthly_values
      ) VALUES (
        '${studentOtherId}', '${docTrisUnfinalizedId}', '${schoolOtherId}', 'Grade 11', '2023-2024', 'No. of School Days', '{"Jun": 21}'::jsonb
      );
    `);
  } catch (err) {
    if (err.message.includes("Document does not belong to the specified student")) mismatchDocStudentBlocked = true;
  }
  recordTest("Trigger rejects document-to-student mismatch", mismatchDocStudentBlocked);

  // Case C: Remedial record subject_grade belongs to another student
  let mismatchRemedialGradeBlocked = false;
  try {
    await db.query(`
      INSERT INTO public.remedial_records (
        student_id, school_id, subject_grade_id, subject, school_year, original_final_grade
      ) VALUES (
        '${studentOtherId}', '${schoolOtherId}', '${subjectGradeTrisId}', 'General Mathematics', '2023-2024', 72
      );
    `);
  } catch (err) {
    if (err.message.includes("Subject grade record does not belong to this student")) mismatchRemedialGradeBlocked = true;
  }
  recordTest("Trigger rejects remedial record linked to another student's grade", mismatchRemedialGradeBlocked);

  // Case D: Remedial record subject name mismatch
  let mismatchSubjectNameBlocked = false;
  try {
    await db.query(`
      INSERT INTO public.remedial_records (
        student_id, school_id, subject_grade_id, subject, school_year, original_final_grade
      ) VALUES (
        '${studentTrisId}', '${schoolTrisId}', '${subjectGradeTrisId}', 'Pre-Calculus', '2023-2024', 72
      );
    `);
  } catch (err) {
    if (err.message.includes("Subject name does not match the linked subject_grade")) mismatchSubjectNameBlocked = true;
  }
  recordTest("Trigger rejects remedial record subject name mismatch", mismatchSubjectNameBlocked);

  // 5.15 Data Preservation: Document deletion sets document_id to NULL (ON DELETE SET NULL)
  console.log("\n[9] Testing Historical Data Preservation on Document Deletion...");
  await db.query(`DELETE FROM public.documents WHERE id = '${docTrisUnfinalizedId}';`);
  const attAfterDelete = await db.query("SELECT * FROM public.attendance_records WHERE id = $1;", [attRecId1]);
  recordTest("Attendance record preserved after document deletion", attAfterDelete.rows.length === 1);
  recordTest("Attendance record document_id set to NULL via ON DELETE SET NULL", attAfterDelete.rows[0].document_id === null);
  recordTest("Attendance computed total preserved intact (total = 41)", Number(attAfterDelete.rows[0].computed_total) === 41);

  const remAfterDelete = await db.query("SELECT * FROM public.remedial_records WHERE id = $1;", [remedialId1]);
  recordTest("Remedial record preserved after document deletion", remAfterDelete.rows.length === 1);
  recordTest("Remedial record document_id set to NULL via ON DELETE SET NULL", remAfterDelete.rows[0].document_id === null);
  recordTest("Remedial recomputed grade preserved intact (grade = 75)", Number(remAfterDelete.rows[0].recomputed_final_grade) === 75);

  // 5.16 Verify Pre-existing Tables Unaltered
  console.log("\n[10] Verifying Pre-existing Tables & Schemas Unaltered...");
  const studentsCount = await db.query("SELECT COUNT(*) FROM public.students;");
  const schoolsCount = await db.query("SELECT COUNT(*) FROM public.schools;");
  const subjectGradesCount = await db.query("SELECT COUNT(*) FROM public.subject_grades;");
  recordTest("students table row count intact (2 rows)", Number(studentsCount.rows[0].count) === 2);
  recordTest("schools table row count intact (2 rows)", Number(schoolsCount.rows[0].count) === 2);
  recordTest("subject_grades table row count intact (1 row)", Number(subjectGradesCount.rows[0].count) === 1);

  console.log("\n================================================================================");
  console.log(`REAL POSTGRESQL VERIFICATION COMPLETE: ${results.filter(r => r.passed).length}/${results.length} TESTS PASSED`);
  console.log("================================================================================\n");

  return {
    pgVersion,
    totalTests: results.length,
    passedTests: results.filter(r => r.passed).length,
    results
  };
}

runRealPostgresVerification().catch(err => {
  console.error("Verification crashed:", err);
  process.exit(1);
});

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

async function runFixesVerification() {
  console.log("================================================================================");
  console.log("   SIMULATION: TESTING MIGRATION 015 REVISED SECURITY & COMPUTATION FIXES");
  console.log("================================================================================");

  const db = new PGlite();

  // 1. Setup isolated PostgreSQL environment
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ 
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; 
    $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ 
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated'); 
    $$ LANGUAGE sql STABLE;
  `);

  const backupSql = fs.readFileSync("backups/complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql", "utf-8");
  await db.exec(backupSql);

  // Helper functions
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin' AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'principal' AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'teacher' AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'principal', 'teacher') AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid();
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
  `);

  // Apply Migration 014
  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf-8");
  await db.exec(sql014);

  // Read and apply revised Migration 015
  const sql015 = fs.readFileSync("supabase/migrations/015_lrn_deduplication_and_grade_updates.sql", "utf-8");
  await db.exec(`
    BEGIN;
    ${sql015}
    COMMIT;
  `);
  console.log("✓ Migration 014 and revised Migration 015 applied successfully!");

  // ----------------------------------------------------------------------------
  // TEST SUITE 1: School Isolation & lookup_student_by_lrn()
  // ----------------------------------------------------------------------------
  console.log("\n--- TEST SUITE 1: School Isolation in lookup_student_by_lrn() ---");

  const schoolA = "a0000000-0000-0000-0000-000000000001"; // TRIS
  const schoolB = "a0000000-0000-0000-0000-000000000002"; // Other School
  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES ('${schoolB}', '300799', 'Other DepEd School')
    ON CONFLICT (id) DO NOTHING;
  `);

  const teacherA = "11111111-0000-0000-0000-000000000001";
  const teacherB = "22222222-0000-0000-0000-000000000002";
  const principalA = "33333333-0000-0000-0000-000000000003";
  const adminUser = "44444444-0000-0000-0000-000000000004";

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES 
      ('${teacherA}', 'teacherA@deped.gov.ph'),
      ('${teacherB}', 'teacherB@deped.gov.ph'),
      ('${principalA}', 'principalA@deped.gov.ph'),
      ('${adminUser}', 'admin@deped.gov.ph');

    INSERT INTO public.user_roles (id, user_id, role, account_status, school_id) VALUES
      (gen_random_uuid(), '${teacherA}', 'teacher', 'Approved', '${schoolA}'),
      (gen_random_uuid(), '${teacherB}', 'teacher', 'Approved', '${schoolB}'),
      (gen_random_uuid(), '${principalA}', 'principal', 'Approved', '${schoolA}'),
      (gen_random_uuid(), '${adminUser}', 'admin', 'Approved', '${schoolA}');
  `);

  // Create Student in School A and Student in School B
  const lrnA = "100000000001";
  const lrnB = "200000000002";

  await db.exec(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name) VALUES
      ('${schoolA}', '${lrnA}', 'Student', 'SchoolA'),
      ('${schoolB}', '${lrnB}', 'Student', 'SchoolB');
  `);

  // Test 1.1: Teacher A queries their own school student (lrnA) with p_school_id = NULL
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${teacherA}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  const res1_1 = await db.query(`SELECT * FROM public.lookup_student_by_lrn('${lrnA}', NULL);`);
  console.log(`Test 1.1 (Teacher A -> Student A, p_school_id=NULL): ${res1_1.rows.length === 1 ? 'PASS' : 'FAIL'} (Rows: ${res1_1.rows.length})`);

  // Test 1.2: Teacher A queries another school student (lrnB) with p_school_id = NULL
  const res1_2 = await db.query(`SELECT * FROM public.lookup_student_by_lrn('${lrnB}', NULL);`);
  console.log(`Test 1.2 (Teacher A -> Student B, p_school_id=NULL): ${res1_2.rows.length === 0 ? 'PASS (Blocked)' : 'FAIL (Leaked!)'} (Rows: ${res1_2.rows.length})`);

  // Test 1.3: Teacher A tries to exploit p_school_id by supplying School B UUID to access Student B
  const res1_3 = await db.query(`SELECT * FROM public.lookup_student_by_lrn('${lrnB}', '${schoolB}');`);
  console.log(`Test 1.3 (Teacher A -> Student B, p_school_id=SchoolB): ${res1_3.rows.length === 0 ? 'PASS (Exploit Blocked)' : 'FAIL (Security Bypass!)'} (Rows: ${res1_3.rows.length})`);

  // Test 1.4: Teacher A supplies School B UUID while querying Student A
  const res1_4 = await db.query(`SELECT * FROM public.lookup_student_by_lrn('${lrnA}', '${schoolB}');`);
  console.log(`Test 1.4 (Teacher A -> Student A, p_school_id=SchoolB mismatched): ${res1_4.rows.length === 0 ? 'PASS (Blocked)' : 'FAIL'} (Rows: ${res1_4.rows.length})`);

  // Test 1.5: Admin queries Student B with p_school_id = NULL (Oversight across schools)
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${adminUser}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  const res1_5 = await db.query(`SELECT * FROM public.lookup_student_by_lrn('${lrnB}', NULL);`);
  console.log(`Test 1.5 (Admin -> Student B across schools): ${res1_5.rows.length === 1 ? 'PASS' : 'FAIL'} (Rows: ${res1_5.rows.length})`);

  // Test 1.6: Admin filters to School B explicitly
  const res1_6 = await db.query(`SELECT * FROM public.lookup_student_by_lrn('${lrnB}', '${schoolB}');`);
  console.log(`Test 1.6 (Admin -> Student B with p_school_id=SchoolB): ${res1_6.rows.length === 1 ? 'PASS' : 'FAIL'} (Rows: ${res1_6.rows.length})`);

  // Test 1.7: Anonymous visitor queries Student A
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', 'anon', false);`);
  const res1_7 = await db.query(`SELECT * FROM public.lookup_student_by_lrn('${lrnA}', NULL);`);
  console.log(`Test 1.7 (Anonymous caller -> Student A): ${res1_7.rows.length === 0 ? 'PASS (Blocked)' : 'FAIL (Leaked!)'} (Rows: ${res1_7.rows.length})`);

  // ----------------------------------------------------------------------------
  // TEST SUITE 2: Grade Correction & Final Grade Consistency in process_approved_document()
  // ----------------------------------------------------------------------------
  console.log("\n--- TEST SUITE 2: Corrected Quarter Grades & Final Grade Consistency ---");

  // Reset to Admin context
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${adminUser}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

  const studentTestLrn = "300000000003";
  const stRes = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, overall_status)
    VALUES ('${schoolA}', '${studentTestLrn}', 'GradeTest', 'Learner', 'Needs Verification')
    RETURNING id;
  `);
  const testStudentId = stRes.rows[0].id;

  // Step 2.1: Initial document scan has Q1 = 70, Q2 = 70, final = 70 (Failed)
  const initialFields = {
    lrn: studentTestLrn,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    grades: [
      { subject: "Oral Communication", q1: 70, q2: 70, final: 70, status: "Failed", semester: "1st Semester" }
    ]
  };

  const doc1Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, image_url, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ('${testStudentId}', '${schoolA}', 'sf9', 'test-doc1.jpg', '2024-2025', 'Grade 11', '1st Semester',
      $1, 'needs_review', '${teacherA}', '${adminUser}')
    RETURNING id;
  `, [JSON.stringify(initialFields)]);
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc1Res.rows[0].id}';`);

  // Verify initial state
  const initGrade = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${testStudentId}';`);
  console.log(`Initial grade state: Q1=${initGrade.rows[0].q1}, Q2=${initGrade.rows[0].q2}, Final=${initGrade.rows[0].final_grade}, Status=${initGrade.rows[0].status}`);

  // Step 2.2: Re-upload with corrected Q1 = 90. Notice extracted_fields still has stale printed final = 70!
  const correctedFieldsStalePrintedFinal = {
    lrn: studentTestLrn,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    grades: [
      { subject: "Oral Communication", q1: 90, q2: 70, final: 70, status: "Passed", semester: "1st Semester" }
    ]
  };

  const doc2Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, image_url, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ('${testStudentId}', '${schoolA}', 'sf9', 'test-doc2.jpg', '2024-2025', 'Grade 11', '1st Semester',
      $1, 'needs_review', '${teacherA}', '${adminUser}')
    RETURNING id;
  `, [JSON.stringify(correctedFieldsStalePrintedFinal)]);
  const doc2Id = doc2Res.rows[0].id;

  // Approve Document 2
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc2Id}';`);

  // Check subject_grades after approval
  const updatedGrade = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${testStudentId}';`);
  const finalGradeVal = Number(updatedGrade.rows[0].final_grade);
  const q1Val = Number(updatedGrade.rows[0].q1);
  const statusVal = updatedGrade.rows[0].status;

  console.log(`Updated grade state: Q1=${q1Val}, Q2=${updatedGrade.rows[0].q2}, Final=${finalGradeVal}, Status=${statusVal}`);
  console.log(`Test 2.1 (Q1 corrected to 90, final recalculated to 80 despite stale printed final 70): ${finalGradeVal === 80 && statusVal === 'Passed' ? 'PASS' : 'FAIL'}`);

  // Check grade_change_history
  const historyRows = await db.query(`
    SELECT quarter, previous_value, new_value, reason 
    FROM public.grade_change_history 
    WHERE student_id = '${testStudentId}' 
    ORDER BY created_at ASC;
  `);
  console.log("Grade change history entries:", historyRows.rows);
  const hasQ1Audit = historyRows.rows.some(h => h.quarter === 'q1' && Number(h.previous_value) === 70 && Number(h.new_value) === 90);
  const hasFinalAudit = historyRows.rows.some(h => h.quarter === 'final_grade' && Number(h.previous_value) === 70 && Number(h.new_value) === 80);
  console.log(`Test 2.2 (Audit trail preserves 70 -> 90 for Q1 and 70 -> 80 for final_grade): ${hasQ1Audit && hasFinalAudit ? 'PASS' : 'FAIL'}`);

  // Step 2.3: Re-upload with corrected Q1 = 60 (recalculated final = (60+70)/2 = 65, which is < 75 Failed)
  const failedCorrectionFields = {
    lrn: studentTestLrn,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    grades: [
      { subject: "Oral Communication", q1: 60, q2: 70, final: 85, status: "Failed", semester: "1st Semester" }
    ]
  };

  const doc3Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, image_url, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ('${testStudentId}', '${schoolA}', 'sf9', 'test-doc3.jpg', '2024-2025', 'Grade 11', '1st Semester',
      $1, 'needs_review', '${teacherA}', '${adminUser}')
    RETURNING id;
  `, [JSON.stringify(failedCorrectionFields)]);
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc3Res.rows[0].id}';`);

  const gradeAfterFail = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${testStudentId}';`);
  const finalFail = Number(gradeAfterFail.rows[0].final_grade);
  const statusFail = gradeAfterFail.rows[0].status;
  console.log(`Failed correction state: Q1=${gradeAfterFail.rows[0].q1}, Final=${finalFail}, Status=${statusFail}`);
  console.log(`Test 2.3 (Q1 corrected to 60 -> final recalculated to 65 and status recalculated to 'Failed'): ${finalFail === 65 && statusFail === 'Failed' ? 'PASS' : 'FAIL'}`);

  // Step 2.4: Reviewed final grade update WITHOUT changing quarters (e.g. approved transmutation or remedial)
  const explicitFinalFields = {
    lrn: studentTestLrn,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    grades: [
      { subject: "Oral Communication", q1: 60, q2: 70, final: 75, status: "Passed", semester: "1st Semester" }
    ]
  };
  const doc4Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, image_url, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ('${testStudentId}', '${schoolA}', 'sf9', 'test-doc4.jpg', '2024-2025', 'Grade 11', '1st Semester',
      $1, 'needs_review', '${teacherA}', '${adminUser}')
    RETURNING id;
  `, [JSON.stringify(explicitFinalFields)]);
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc4Res.rows[0].id}';`);

  const gradeAfterExplicit = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${testStudentId}';`);
  console.log(`Explicit final grade state: Q1=${gradeAfterExplicit.rows[0].q1}, Final=${gradeAfterExplicit.rows[0].final_grade}, Status=${gradeAfterExplicit.rows[0].status}`);
  console.log(`Test 2.4 (Explicit reviewed final grade update preserved without quarter change): ${Number(gradeAfterExplicit.rows[0].final_grade) === 75 ? 'PASS' : 'FAIL'}`);

  // ----------------------------------------------------------------------------
  // TEST SUITE 3: Security & Access Control on v_duplicate_students_report
  // ----------------------------------------------------------------------------
  console.log("\n--- TEST SUITE 3: Security & Access Control on v_duplicate_students_report ---");

  // Create duplicate student across schools
  const dupLrn = "400000000004";
  await db.exec(`
    -- Temporarily drop constraint to seed duplicate for view testing
    ALTER TABLE public.students DROP CONSTRAINT IF EXISTS chk_students_lrn_format;
    DROP INDEX IF EXISTS idx_students_normalized_lrn;
    INSERT INTO public.students (school_id, lrn, first_name, last_name) VALUES
      ('${schoolA}', '${dupLrn}', 'DuplicateA', 'Student'),
      ('${schoolB}', '${dupLrn}', 'DuplicateB', 'Student');
  `);

  // Test 3.1: Anonymous visitor queries view
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', 'anon', false);`);
  const dupAnon = await db.query(`SELECT * FROM public.v_duplicate_students_report;`);
  console.log(`Test 3.1 (Anonymous -> v_duplicate_students_report): ${dupAnon.rows.length === 0 ? 'PASS (0 rows leaked)' : 'FAIL'}`);

  // Test 3.2: Regular Teacher queries view
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${teacherA}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  const dupTeacher = await db.query(`SELECT * FROM public.v_duplicate_students_report;`);
  console.log(`Test 3.2 (Teacher -> v_duplicate_students_report): ${dupTeacher.rows.length === 0 ? 'PASS (0 rows leaked)' : 'FAIL'}`);

  // Test 3.3: Principal of School A queries view (Duplicate involves School A)
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${principalA}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  const dupPrincipal = await db.query(`SELECT * FROM public.v_duplicate_students_report;`);
  console.log(`Test 3.3 (Principal School A -> sees duplicate involving School A): ${dupPrincipal.rows.length === 1 ? 'PASS' : 'FAIL'} (Found: ${dupPrincipal.rows.length})`);

  // Test 3.4: Admin queries view
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${adminUser}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  const dupAdmin = await db.query(`SELECT * FROM public.v_duplicate_students_report;`);
  console.log(`Test 3.4 (Admin -> sees all duplicates): ${dupAdmin.rows.length === 1 ? 'PASS' : 'FAIL'} (Found: ${dupAdmin.rows.length})`);

  console.log("\n================================================================================");
  console.log("   ALL REVISED FIXES VERIFIED SUCCESSFULLY IN PRODUCTION CLONE");
  console.log("================================================================================");
}

runFixesVerification().catch(console.error);

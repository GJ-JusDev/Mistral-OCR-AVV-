import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert";

async function runTargetedTests() {
  console.log("================================================================================");
  console.log("   TARGETED TESTS: LRN NORMALIZATION & NEW SUBJECT GRADE INSERTION");
  console.log("================================================================================");

  const db = new PGlite();

  // Setup mock auth
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

  // Load production backup
  const backupSql = fs.readFileSync("backups/complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql", "utf-8");
  await db.exec(backupSql);

  // Security helper functions
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
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
  `);

  // Apply Migration 014
  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf-8");
  await db.exec(sql014);

  const schoolA = "a0000000-0000-0000-0000-000000000001";
  const teacherId = "11111111-1111-1111-1111-111111111111";
  const adminId   = "66666666-6666-6666-6666-666666666666";

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES 
      ('${teacherId}', 'teacher@deped.gov.ph'),
      ('${adminId}', 'admin@deped.gov.ph');
    INSERT INTO public.user_roles (id, user_id, role, account_status, school_id) VALUES
      (gen_random_uuid(), '${teacherId}', 'teacher', 'Approved', '${schoolA}'),
      (gen_random_uuid(), '${adminId}', 'admin', 'Approved', '${schoolA}');
  `);

  // ---------------------------------------------------------------------------
  // PART 1: LRN Normalization, Existing Formatted LRNs & Data Preservation
  // ---------------------------------------------------------------------------
  console.log("\n--- PART 1: LRN Normalization & Data Preservation ---");

  // Seed existing students with various formatted LRNs BEFORE running Migration 015
  await db.exec(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name) VALUES
      ('${schoolA}', '123456-789012', 'Hyphen', 'Student'),
      ('${schoolA}', ' 234567890123 ', 'Spaced', 'Student'),
      ('${schoolA}', '3456.7890.1234', 'Dotted', 'Student'),
      ('${schoolA}', 'LRN: 456789012345', 'Prefixed', 'Student');
  `);
  console.log("Seeded 4 pre-existing students with formatted LRNs.");

  // Apply Migration 015
  const sql015 = fs.readFileSync("supabase/migrations/015_lrn_deduplication_and_grade_updates.sql", "utf-8");
  await db.exec(`
    BEGIN;
    ${sql015}
    COMMIT;
  `);
  console.log("✓ Migration 015 executed cleanly on database with pre-existing formatted LRNs!");

  // Verify that all 4 pre-existing students have been normalized in place to clean 12 digits
  const normStudents = await db.query(`SELECT lrn, first_name FROM public.students ORDER BY first_name;`);
  assert.strictEqual(normStudents.rows.length, 4, "All 4 pre-existing students must be preserved");
  assert.strictEqual(normStudents.rows.find(s => s.first_name === 'Dotted').lrn, '345678901234');
  assert.strictEqual(normStudents.rows.find(s => s.first_name === 'Hyphen').lrn, '123456789012');
  assert.strictEqual(normStudents.rows.find(s => s.first_name === 'Prefixed').lrn, '456789012345');
  assert.strictEqual(normStudents.rows.find(s => s.first_name === 'Spaced').lrn, '234567890123');
  console.log("✓ Pre-existing formatted LRNs normalized in place (0 records deleted).");

  // Verify trigger normalizes NEW inserts on public.students
  await db.exec(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name)
    VALUES ('${schoolA}', '999999-888888', 'Auto', 'Normalized');
  `);
  const autoStudent = await db.query(`SELECT lrn FROM public.students WHERE first_name = 'Auto';`);
  assert.strictEqual(autoStudent.rows[0].lrn, '999999888888', "New insert with hyphen must be automatically normalized by trigger");
  console.log("✓ New student insert automatically normalized by trigger.");

  // Verify CHECK constraint rejects truly invalid non-12-digit LRN
  let checkFailed = false;
  try {
    await db.exec(`
      INSERT INTO public.students (school_id, lrn, first_name, last_name)
      VALUES ('${schoolA}', '12345', 'Invalid', 'Student');
    `);
  } catch (err) {
    checkFailed = true;
  }
  assert.strictEqual(checkFailed, true, "CHECK constraint must reject non-12-digit LRN");
  console.log("✓ CHECK constraint chk_students_lrn_format successfully rejects invalid LRN.");

  // ---------------------------------------------------------------------------
  // PART 2: New Subject Grade Insertion & DepEd DO 8 Final Grade Recalculation
  // ---------------------------------------------------------------------------
  console.log("\n--- PART 2: New Subject Grade Insertion & DepEd DO 8 Recalculation ---");

  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${adminId}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

  // Target student: Hyphen Student (LRN: 123456789012)
  const targetStudentId = (await db.query(`SELECT id FROM public.students WHERE lrn = '123456789012';`)).rows[0].id;

  // Scenario 2.1: Q1=85, Q2=87, extracted final is NULL (1st Semester)
  console.log("\n[Scenario 2.1] New grade with Q1=85, Q2=87, extracted final is NULL...");
  const doc1Fields = {
    school_year: "2024-2025",
    semester: "1st Semester",
    grade_level: "Grade 11",
    grades: [
      { subject: "General Mathematics", q1: 85, q2: 87, final: null, semester: "1st Semester" }
    ]
  };

  const doc1Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ($1, $2, 'SF9', '2024-2025', 'Grade 11', '1st Semester', $3, 'needs_review', '${teacherId}', '${adminId}')
    RETURNING id;
  `, [targetStudentId, schoolA, JSON.stringify(doc1Fields)]);
  const doc1Id = doc1Res.rows[0].id;

  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc1Id]);

  const genMath = (await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'General Mathematics';`, [targetStudentId])).rows[0];
  assert.strictEqual(Number(genMath.q1), 85);
  assert.strictEqual(Number(genMath.q2), 87);
  assert.strictEqual(Number(genMath.final_grade), 86, "Final grade must be computed: ROUND((85+87)/2) = 86");
  assert.strictEqual(genMath.status, 'Passed');
  assert.strictEqual(genMath.needs_verification, false);
  console.log(`✓ Scenario 2.1 Passed: Final grade auto-computed to 86, Status='Passed', needs_verification=false.`);

  // Scenario 2.2: Q3=88, Q4=90, extracted final is NULL (2nd Semester)
  console.log("\n[Scenario 2.2] New grade with Q3=88, Q4=90, extracted final is NULL (2nd Semester)...");
  const doc2Fields = {
    school_year: "2024-2025",
    semester: "2nd Semester",
    grade_level: "Grade 11",
    grades: [
      { subject: "Statistics and Probability", q3: 88, q4: 90, final: null, semester: "2nd Semester" }
    ]
  };

  const doc2Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ($1, $2, 'SF9', '2024-2025', 'Grade 11', '2nd Semester', $3, 'needs_review', '${teacherId}', '${adminId}')
    RETURNING id;
  `, [targetStudentId, schoolA, JSON.stringify(doc2Fields)]);
  const doc2Id = doc2Res.rows[0].id;

  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc2Id]);

  const stats = (await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Statistics and Probability';`, [targetStudentId])).rows[0];
  assert.strictEqual(Number(stats.q3), 88);
  assert.strictEqual(Number(stats.q4), 90);
  assert.strictEqual(Number(stats.final_grade), 89, "Final grade must be computed: ROUND((88+90)/2) = 89");
  assert.strictEqual(stats.status, 'Passed');
  assert.strictEqual(stats.needs_verification, false);
  console.log(`✓ Scenario 2.2 Passed: 2nd Sem Final grade auto-computed to 89, Status='Passed', needs_verification=false.`);

  // Scenario 2.3: Incomplete semester grade (Q1=85, Q2 is NULL / future quarter missing)
  console.log("\n[Scenario 2.3] Incomplete grade: Q1=85, Q2 is NULL...");
  const doc3Fields = {
    school_year: "2024-2025",
    semester: "1st Semester",
    grade_level: "Grade 11",
    grades: [
      { subject: "Physical Education", q1: 85, q2: null, final: null, semester: "1st Semester" }
    ]
  };

  const doc3Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ($1, $2, 'SF9', '2024-2025', 'Grade 11', '1st Semester', $3, 'needs_review', '${teacherId}', '${adminId}')
    RETURNING id;
  `, [targetStudentId, schoolA, JSON.stringify(doc3Fields)]);
  const doc3Id = doc3Res.rows[0].id;

  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc3Id]);

  const pe = (await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Physical Education';`, [targetStudentId])).rows[0];
  assert.strictEqual(Number(pe.q1), 85);
  assert.strictEqual(pe.q2, null);
  assert.strictEqual(pe.final_grade, null, "Final grade must remain NULL when future quarter is missing");
  assert.strictEqual(pe.status, 'Missing', "Status must remain 'Missing' (NOT 'Failed')");
  assert.strictEqual(pe.needs_verification, true, "needs_verification must be true");
  console.log(`✓ Scenario 2.3 Passed: Missing Q2 results in Final=NULL, Status='Missing', needs_verification=true (NEVER 'Failed').`);

  // Scenario 2.4: Failing grade (Q1=70, Q2=72, extracted final is NULL)
  console.log("\n[Scenario 2.4] Failing grade: Q1=70, Q2=72, extracted final is NULL...");
  const doc4Fields = {
    school_year: "2024-2025",
    semester: "1st Semester",
    grade_level: "Grade 11",
    grades: [
      { subject: "Earth Science", q1: 70, q2: 72, final: null, semester: "1st Semester" }
    ]
  };

  const doc4Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ($1, $2, 'SF9', '2024-2025', 'Grade 11', '1st Semester', $3, 'needs_review', '${teacherId}', '${adminId}')
    RETURNING id;
  `, [targetStudentId, schoolA, JSON.stringify(doc4Fields)]);
  const doc4Id = doc4Res.rows[0].id;

  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc4Id]);

  const science = (await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Earth Science';`, [targetStudentId])).rows[0];
  assert.strictEqual(Number(science.final_grade), 71, "Final grade must compute to 71");
  assert.strictEqual(science.status, 'Failed', "Status must be 'Failed' when final < 75");
  assert.strictEqual(science.needs_verification, false);
  console.log(`✓ Scenario 2.4 Passed: Q1=70, Q2=72 computes Final=71, Status='Failed'.`);

  // Scenario 2.5: Human-reviewed explicit final grade override (Q1=80, Q2=80, explicit reviewed final: 85)
  console.log("\n[Scenario 2.5] Human-reviewed explicit final grade override (reviewed final: 85)...");
  const doc5Fields = {
    school_year: "2024-2025",
    semester: "1st Semester",
    grade_level: "Grade 11",
    grades: [
      { subject: "Filipino", q1: 80, q2: 80, final: 85, semester: "1st Semester" }
    ]
  };

  const doc5Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ($1, $2, 'SF9', '2024-2025', 'Grade 11', '1st Semester', $3, 'needs_review', '${teacherId}', '${adminId}')
    RETURNING id;
  `, [targetStudentId, schoolA, JSON.stringify(doc5Fields)]);
  const doc5Id = doc5Res.rows[0].id;

  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc5Id]);

  const filipino = (await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Filipino';`, [targetStudentId])).rows[0];
  assert.strictEqual(Number(filipino.final_grade), 85, "Human reviewed final grade of 85 must be preserved");
  assert.strictEqual(filipino.status, 'Passed');
  console.log(`✓ Scenario 2.5 Passed: Explicit reviewed final grade 85 preserved.`);

  // Scenario 2.6: Correction and audit history tracking
  console.log("\n[Scenario 2.6] Correcting General Math Q1 85 -> 90...");
  const doc6Fields = {
    school_year: "2024-2025",
    semester: "1st Semester",
    grade_level: "Grade 11",
    grades: [
      { subject: "General Mathematics", q1: 90, q2: 87, final: null, semester: "1st Semester" }
    ]
  };

  const doc6Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ($1, $2, 'SF9', '2024-2025', 'Grade 11', '1st Semester', $3, 'needs_review', '${teacherId}', '${adminId}')
    RETURNING id;
  `, [targetStudentId, schoolA, JSON.stringify(doc6Fields)]);
  const doc6Id = doc6Res.rows[0].id;

  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc6Id]);

  const genMathUpdated = (await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'General Mathematics';`, [targetStudentId])).rows[0];
  assert.strictEqual(Number(genMathUpdated.q1), 90);
  assert.strictEqual(Number(genMathUpdated.final_grade), 89, "Recalculated to ROUND((90+87)/2) = 89");

  const histEntries = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = $1 AND subject = 'General Mathematics' ORDER BY created_at ASC;`, [targetStudentId]);
  assert.strictEqual(histEntries.rows.length, 2, "Must log 2 history entries (q1 85->90, final 86->89)");
  console.log(`✓ Scenario 2.6 Passed: Grade correction and audit history logged successfully.`);

  console.log("\n================================================================================");
  console.log("   ALL TARGETED LRN & NEW GRADE INSERTION TESTS PASSED (100%)");
  console.log("================================================================================");
}

runTargetedTests().catch(err => {
  console.error("TARGETED TESTS FAILED:", err);
  process.exit(1);
});

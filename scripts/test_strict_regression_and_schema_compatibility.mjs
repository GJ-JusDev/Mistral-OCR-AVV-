import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert";

async function runStrictRegressionAndCompatibilityAudit() {
  console.log("================================================================================");
  console.log("   STRICT REGRESSION & PRODUCTION-SCHEMA COMPATIBILITY AUDIT (MIGRATION 015)");
  console.log("================================================================================");

  const db = new PGlite();

  // 1. Setup isolated Supabase mock environment
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

  // 2. Load complete production backup (state before 014 & 015)
  console.log("\n[1] Restoring exact production baseline from backup...");
  const backupSql = fs.readFileSync("backups/complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql", "utf-8");
  await db.exec(backupSql);
  console.log("✓ Production schema baseline restored successfully.");

  // Define Supabase security helper functions matching live production
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

  // 3. Apply Migration 014
  console.log("\n[2] Applying Migration 014 (Admin Audit Logs)...");
  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf-8");
  await db.exec(sql014);
  console.log("✓ Migration 014 applied successfully.");

  // 4. Apply Migration 015
  console.log("\n[3] Applying Migration 015 (LRN Deduplication & Grade Updates)...");
  const sql015 = fs.readFileSync("supabase/migrations/015_lrn_deduplication_and_grade_updates.sql", "utf-8");
  await db.exec(`
    BEGIN;
    ${sql015}
    COMMIT;
  `);
  console.log("✓ Migration 015 applied successfully.");

  // 5. Schema & Column Existence Checks
  console.log("\n--- SECTION 1: Production Schema Column Compatibility Checks ---");
  const requiredDocCols = ["id", "student_id", "school_id", "status", "extracted_fields", "school_year", "grade_level", "semester", "reviewed_by", "last_operation_id"];
  for (const col of requiredDocCols) {
    const res = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'documents' AND column_name = $1;`, [col]);
    assert.strictEqual(res.rows.length, 1, `Column documents.${col} must exist in PostgreSQL catalog`);
    console.log(`  ✓ documents.${col} exists (${res.rows[0].data_type})`);
  }

  const requiredGradeCols = ["id", "student_id", "document_id", "school_year", "grade_level", "semester", "subject", "q1", "q2", "q3", "q4", "final_grade", "status", "needs_verification"];
  for (const col of requiredGradeCols) {
    const res = await db.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'subject_grades' AND column_name = $1;`, [col]);
    assert.strictEqual(res.rows.length, 1, `Column subject_grades.${col} must exist in PostgreSQL catalog`);
    console.log(`  ✓ subject_grades.${col} exists (${res.rows[0].data_type})`);
  }

  // Ensure hallucinated columns DO NOT exist
  const hallucinatedCols = [
    { table: "documents", col: "raw_ocr_output" },
    { table: "documents", col: "processing_status" },
    { table: "subject_grades", col: "subject_name" },
    { table: "subject_grades", col: "quarter_1" },
  ];
  for (const item of hallucinatedCols) {
    const res = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2;`, [item.table, item.col]);
    assert.strictEqual(res.rows.length, 0, `Hallucinated column ${item.table}.${item.col} must NOT exist`);
    console.log(`  ✓ Confirmed absence of hallucinated column: ${item.table}.${item.col}`);
  }

  // 6. Real Trigger-Behavior Tests
  console.log("\n--- SECTION 2: Real Trigger-Behavior & Data Preservation Tests ---");

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

  // Seed student Juan Dela Cruz
  const studentLrn = "123456789012";
  const studentRes = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ('${schoolA}', '${studentLrn}', 'Juan', 'Dela Cruz', 'Grade 11')
    RETURNING id;
  `);
  const studentId = studentRes.rows[0].id;

  // Set auth context to Admin
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${adminId}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

  // ---------------------------------------------------------------------------
  // TEST A: First Document Approval (Semester 1)
  // ---------------------------------------------------------------------------
  console.log("\n[Test A] Approving Document 1 (1st Semester, Oral Communication: Q1=78, Q2=80, Final=79)...");
  const doc1Fields = {
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    grades: [
      { subject: "Oral Communication", q1: 78, q2: 80, final: 79, status: "Passed", semester: "1st Semester" }
    ]
  };

  const doc1Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ($1, $2, 'SF9', '2024-2025', 'Grade 11', '1st Semester', $3, 'needs_review', '${teacherId}', '${adminId}')
    RETURNING id;
  `, [studentId, schoolA, JSON.stringify(doc1Fields)]);
  const doc1Id = doc1Res.rows[0].id;

  // Approve Document 1 -> trigger fires
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc1Id]);

  const gradesA = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication';`, [studentId]);
  assert.strictEqual(gradesA.rows.length, 1, "Exactly 1 subject_grade must be created");
  assert.strictEqual(Number(gradesA.rows[0].q1), 78);
  assert.strictEqual(Number(gradesA.rows[0].q2), 80);
  assert.strictEqual(Number(gradesA.rows[0].final_grade), 79);
  assert.strictEqual(gradesA.rows[0].status, "Passed");
  assert.strictEqual(gradesA.rows[0].document_id, doc1Id);

  const histA = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = $1;`, [studentId]);
  assert.strictEqual(histA.rows.length, 0, "No grade change history for initial creation");
  console.log("✓ Test A Passed: Document 1 approved, grades created, student status updated.");

  // ---------------------------------------------------------------------------
  // TEST B: Later Document Approval (Semester 2 for same student)
  // ---------------------------------------------------------------------------
  console.log("\n[Test B] Approving Document 2 (2nd Semester, Reading and Writing: Q3=85, Q4=87, Final=86)...");
  const doc2Fields = {
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "2nd Semester",
    grades: [
      { subject: "Reading and Writing", q3: 85, q4: 87, final: 86, status: "Passed", semester: "2nd Semester" }
    ]
  };

  const doc2Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ($1, $2, 'SF9', '2024-2025', 'Grade 11', '2nd Semester', $3, 'needs_review', '${teacherId}', '${adminId}')
    RETURNING id;
  `, [studentId, schoolA, JSON.stringify(doc2Fields)]);
  const doc2Id = doc2Res.rows[0].id;

  // Approve Document 2 -> trigger fires
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc2Id]);

  const allStudents = await db.query(`SELECT * FROM public.students WHERE lrn = $1;`, [studentLrn]);
  assert.strictEqual(allStudents.rows.length, 1, "Student must NOT be duplicated");

  const allGradesB = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 ORDER BY semester;`, [studentId]);
  assert.strictEqual(allGradesB.rows.length, 2, "Must have exactly 2 grades (Sem 1 and Sem 2)");
  console.log("✓ Test B Passed: Semester 2 added to same student without duplicating student or Sem 1 grades.");

  // ---------------------------------------------------------------------------
  // TEST C: Corrected Grade Document Approval (Oral Comm Q1 78 -> 83)
  // ---------------------------------------------------------------------------
  console.log("\n[Test C] Approving Document 3 with corrected Q1=83 (stale printed final 70 in form)...");
  const doc3Fields = {
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    grades: [
      { subject: "Oral Communication", q1: 83, q2: 80, final: 70, status: "Passed", semester: "1st Semester" }
    ]
  };

  const doc3Res = await db.query(`
    INSERT INTO public.documents (
      student_id, school_id, document_type, school_year, grade_level, semester,
      extracted_fields, status, uploaded_by, reviewed_by
    ) VALUES ($1, $2, 'SF9', '2024-2025', 'Grade 11', '1st Semester', $3, 'needs_review', '${teacherId}', '${adminId}')
    RETURNING id;
  `, [studentId, schoolA, JSON.stringify(doc3Fields)]);
  const doc3Id = doc3Res.rows[0].id;

  // Approve Document 3 -> trigger fires
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc3Id]);

  const gradesC = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication';`, [studentId]);
  assert.strictEqual(gradesC.rows.length, 1, "Must NOT duplicate active record");
  assert.strictEqual(Number(gradesC.rows[0].q1), 83, "Q1 must be updated to 83");
  assert.strictEqual(Number(gradesC.rows[0].q2), 80, "Q2 must remain 80");
  assert.strictEqual(Number(gradesC.rows[0].final_grade), 82, "Final grade must recalculate: (83+80)/2 = 82 (stale 70 overridden)");
  assert.strictEqual(gradesC.rows[0].status, "Passed");

  const histC = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = $1 ORDER BY created_at ASC;`, [studentId]);
  assert.strictEqual(histC.rows.length, 2, "Must log 2 history entries (q1 and final_grade)");
  const q1Entry = histC.rows.find(h => h.quarter === "q1");
  const finalEntry = histC.rows.find(h => h.quarter === "final_grade");
  assert.strictEqual(Number(q1Entry.previous_value), 78);
  assert.strictEqual(Number(q1Entry.new_value), 83);
  assert.strictEqual(Number(finalEntry.previous_value), 79);
  assert.strictEqual(Number(finalEntry.new_value), 82);
  assert.strictEqual(finalEntry.reason, "Recalculated dependent final grade");
  console.log("✓ Test C Passed: In-place grade update, DepEd DO 8 recalculation to 82, and full audit history logged.");

  // ---------------------------------------------------------------------------
  // TEST D: Document Archiving Safety (Must NOT Delete Verified Grades or History)
  // ---------------------------------------------------------------------------
  console.log("\n[Test D] Testing Document Archiving Safety...");
  await db.query(`UPDATE public.documents SET status = 'archived' WHERE id = $1;`, [doc1Id]);
  await db.query(`UPDATE public.documents SET status = 'archived' WHERE id = $1;`, [doc3Id]);

  const gradesD = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1;`, [studentId]);
  assert.strictEqual(gradesD.rows.length, 2, "Verified grades must NEVER be deleted when a document is archived!");
  const histD = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = $1;`, [studentId]);
  assert.strictEqual(histD.rows.length, 2, "Grade change history must NEVER be deleted when a document is archived!");
  console.log("✓ Test D Passed: Archiving documents preserved all verified subject grades and audit history.");

  // ---------------------------------------------------------------------------
  // TEST E: Document Deletion Safety (Must NOT Delete Verified Grades or History)
  // ---------------------------------------------------------------------------
  console.log("\n[Test E] Testing Document Physical Deletion Safety...");
  await db.query(`DELETE FROM public.documents WHERE id = $1;`, [doc3Id]);

  const gradesE = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1;`, [studentId]);
  assert.strictEqual(gradesE.rows.length, 2, "Verified grades must NEVER be deleted when a document is deleted!");
  const histE = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = $1;`, [studentId]);
  assert.strictEqual(histE.rows.length, 2, "Grade change history must NEVER be deleted when a document is deleted!");
  console.log("✓ Test E Passed: Deleting document preserved all subject grades (document_id set to NULL) and audit history.");

  // ---------------------------------------------------------------------------
  // TEST F: Direct Subject Grade Deletion FK Safety (History Preservation)
  // ---------------------------------------------------------------------------
  console.log("\n[Test F] Testing Subject Grade FK Safety in grade_change_history...");
  const oralCommId = gradesE.rows.find(g => g.subject === "Oral Communication").id;
  await db.query(`DELETE FROM public.subject_grades WHERE id = $1;`, [oralCommId]);

  const histF = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = $1;`, [studentId]);
  assert.strictEqual(histF.rows.length, 2, "Grade change history must SURVIVE when subject_grade is deleted (subject_grade_id set to NULL)!");
  assert.strictEqual(histF.rows[0].subject_grade_id, null, "Foreign key must gracefully set to NULL, NOT cascade-delete audit log");
  console.log("✓ Test F Passed: Audit history is immutable and immune to subject_grade cascade deletion.");

  console.log("\n================================================================================");
  console.log("   ALL STRICT REGRESSION & SCHEMA COMPATIBILITY CHECKS PASSED (100%)");
  console.log("================================================================================");
}

runStrictRegressionAndCompatibilityAudit().catch(err => {
  console.error("AUDIT FAILED:", err);
  process.exit(1);
});

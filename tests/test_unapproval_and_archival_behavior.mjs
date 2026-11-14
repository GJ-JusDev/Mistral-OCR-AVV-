import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function createIsolatedProductionClone() {
  const db = new PGlite();

  // 1. Initialize auth and role stubs
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ 
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''), '135baa53-7e1e-4c1f-b76a-f32a915b5f21')::uuid; 
    $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ 
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated'); 
    $$ LANGUAGE sql STABLE;
  `);

  // 2. Load the complete production backup
  const backupSqlPath = path.join(rootDir, "backups", "complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql");
  const backupSql = fs.readFileSync(backupSqlPath, "utf-8");
  await db.exec(backupSql);

  // Populate auth.users with all users referenced in user_roles and admin user
  await db.exec(`
    INSERT INTO auth.users (id, email)
    SELECT user_id, 'user_' || substr(user_id::text, 1, 8) || '@example.com'
    FROM public.user_roles
    ON CONFLICT DO NOTHING;
    INSERT INTO auth.users (id, email)
    VALUES ('135baa53-7e1e-4c1f-b76a-f32a915b5f21', 'admin@deped.gov.ph')
    ON CONFLICT DO NOTHING;
  `);

  // 3. Define helper functions present in Supabase environment
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

  // 4. Apply Migration 014
  const sql014Path = path.join(rootDir, "supabase", "migrations", "014_admin_audit_logs.sql");
  const sql014 = fs.readFileSync(sql014Path, "utf-8");
  await db.exec(sql014);

  // 5. Apply Migration 015
  const sql015Path = path.join(rootDir, "supabase", "migrations", "015_lrn_deduplication_and_grade_updates.sql");
  const sql015 = fs.readFileSync(sql015Path, "utf-8");
  await db.exec(`
    BEGIN;
    ${sql015}
    COMMIT;
  `);

  return db;
}

test("PostgreSQL Behavioral Verification of process_approved_document() on Production Clone", async (t) => {
  const db = await createIsolatedProductionClone();

  // Query default school & user from restored backup
  const schoolRes = await db.query("SELECT id FROM public.schools LIMIT 1;");
  const schoolId = schoolRes.rows[0].id;
  const userRes = await db.query("SELECT user_id FROM public.user_roles WHERE role = 'admin' AND account_status = 'Approved' LIMIT 1;");
  const adminUserId = userRes.rows[0].user_id;

  await db.query(`SELECT set_config('request.jwt.claim.sub', '${adminUserId}', false);`);
  await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);

  console.log("✓ Isolated Production Clone successfully initialized with Migration 014 and 015.");

  // ---------------------------------------------------------------------------
  // REQUIREMENT 1: Behavior when the LAST approved document is rejected/needs_review
  // ---------------------------------------------------------------------------
  await t.test("Req 1: When LAST approved document becomes rejected/needs_review, subject_grades are deleted but history & verified standings are preserved", async (t) => {
    // 1A. Create Student A with a single approved document
    const studentAId = "a1111111-1111-1111-1111-111111111111";
    await db.query(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, overall_status)
      VALUES ('${studentAId}', '${schoolId}', '111111111111', 'Juan', 'Dela Cruz', '11', 'Needs Verification');
    `);

    const docAId = "da111111-1111-1111-1111-111111111111";
    const docAFields = {
      school_year: "2022-2023",
      semester: "1st Semester",
      grade_level: "11",
      grades: [
        { subject: "Oral Communication", q1: 88, q2: 90, final_grade: 89, status: "Passed" },
        { subject: "General Mathematics", q1: 84, q2: 86, final_grade: 85, status: "Passed" }
      ]
    };

    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${docAId}', '${studentAId}', '${schoolId}', 'SF9', '2022-2023', '1st Semester', '11', 'needs_review', $1::jsonb, '${adminUserId}');
    `, [JSON.stringify(docAFields)]);

    // Approve Doc A
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${docAId}';`);

    // Verify grades populated
    const gradesAfterApproval = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${studentAId}';`);
    assert.strictEqual(gradesAfterApproval.rows.length, 2, "2 active grades must be inserted upon approval");
    assert.strictEqual(gradesAfterApproval.rows[0].status, "Passed");

    // Verify student status updated to Passed
    const studentAfterApp = await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentAId}';`);
    assert.strictEqual(studentAfterApp.rows[0].overall_status, "Passed");

    // Verify academic standing history recorded
    const standHist1 = await db.query(`SELECT * FROM public.academic_standing_history WHERE student_id = '${studentAId}' ORDER BY created_at ASC;`);
    assert.strictEqual(standHist1.rows.length, 1);
    assert.strictEqual(standHist1.rows[0].new_status, "Passed");
    assert.strictEqual(standHist1.rows[0].decision_source, "automated_trigger");

    // NOW UNAPPROVE: Change Doc A status to 'needs_review' (it is the LAST / ONLY approved document)
    await db.query(`UPDATE public.documents SET status = 'needs_review' WHERE id = '${docAId}';`);

    // 1. Verify subject_grades for Student A are deleted
    const gradesAfterUnapproval = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${studentAId}';`);
    assert.strictEqual(gradesAfterUnapproval.rows.length, 0, "All active subject_grades must be deleted because no approved document supports them");

    // 2. Prove raw document and extracted fields are preserved
    const docAfterUnapproval = await db.query(`SELECT status, extracted_fields FROM public.documents WHERE id = '${docAId}';`);
    assert.strictEqual(docAfterUnapproval.rows[0].status, "needs_review");
    assert.ok(docAfterUnapproval.rows[0].extracted_fields.grades.length === 2, "Extracted OCR fields remain intact in document JSON");

    // 3. Verify academic_standing_history recorded unapproval and reverted to Needs Verification
    const standHist2 = await db.query(`SELECT * FROM public.academic_standing_history WHERE student_id = '${studentAId}' ORDER BY created_at ASC;`);
    assert.strictEqual(standHist2.rows.length, 2, "academic_standing_history must contain 2 entries (initial approval + unapproval revert)");
    assert.strictEqual(standHist2.rows[1].previous_status, "Passed");
    assert.strictEqual(standHist2.rows[1].new_status, "Needs Verification");
    assert.ok(standHist2.rows[1].confirmation_notes.includes("Document reverted or un-approved"));

    // 4. Verify student overall status reverted to Needs Verification
    const studentAfterUnapp = await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentAId}';`);
    assert.strictEqual(studentAfterUnapp.rows[0].overall_status, "Needs Verification");

    // 1B. Prove independently verified records (Principal / Registrar manual review) CANNOT be lost
    const studentBId = "b2222222-2222-2222-2222-222222222222";
    await db.query(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, overall_status)
      VALUES ('${studentBId}', '${schoolId}', '222222222222', 'Maria', 'Santos', '11', 'Needs Verification');
    `);

    // Insert an independent Principal Confirmation in academic_standing_history
    await db.query(`
      INSERT INTO public.academic_standing_history (
        student_id, school_year, grade_level, previous_status, new_status, decision_source, confirmation_notes
      ) VALUES (
        '${studentBId}', '2022-2023', '11', 'Needs Verification', 'Passed', 'school_head_review', 'Principal confirmed complete academic standing independently.'
      );
    `);
    await db.query(`UPDATE public.students SET overall_status = 'Passed' WHERE id = '${studentBId}';`);

    const docBId = "db222222-2222-2222-2222-222222222222";
    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${docBId}', '${studentBId}', '${schoolId}', 'SF9', '2022-2023', '1st Semester', '11', 'needs_review', $1::jsonb, '${adminUserId}');
    `, [JSON.stringify(docAFields)]);

    // Approve Doc B
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${docBId}';`);

    // Now unapprove Doc B (the LAST approved document for Student B)
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = '${docBId}';`);

    // Verify: grades deleted because document was rejected, BUT student overall_status retains Principal confirmed standing!
    const gradesB = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${studentBId}';`);
    assert.strictEqual(gradesB.rows.length, 0, "Unapproved document's grades are removed from active table");

    const studentB = await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentBId}';`);
    assert.strictEqual(studentB.rows[0].overall_status, "Passed", "Principal confirmed standing MUST NOT be lost when document is rejected");

    const standHistB = await db.query(`SELECT * FROM public.academic_standing_history WHERE student_id = '${studentBId}' ORDER BY created_at DESC LIMIT 1;`);
    assert.ok(standHistB.rows[0].confirmation_notes.includes("preserved confirmed student standing (Passed) without automated overwrite"),
      "Confirmation notes must explicitly show principal standing was preserved");
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 2: Document Archival Behavior in process_approved_document()
  // ---------------------------------------------------------------------------
  await t.test("Req 2: When an approved document becomes archived, verify active grades, historical preservation, and academic standing impact", async (t) => {
    const studentCId = "c3333333-3333-3333-3333-333333333333";
    await db.query(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, overall_status)
      VALUES ('${studentCId}', '${schoolId}', '333333333333', 'Crispin', 'Basilio', '11', 'Needs Verification');
    `);

    const docCId = "dc333333-3333-3333-3333-333333333333";
    const docCFields = {
      school_year: "2021-2022",
      semester: "1st Semester",
      grade_level: "11",
      grades: [
        { subject: "Komunikasyon at Pananaliksik", q1: 90, q2: 92, final_grade: 91, status: "Passed" },
        { subject: "General Mathematics", q1: 85, q2: 87, final_grade: 86, status: "Passed" }
      ]
    };

    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${docCId}', '${studentCId}', '${schoolId}', 'SF9', '2021-2022', '1st Semester', '11', 'needs_review', $1::jsonb, '${adminUserId}');
    `, [JSON.stringify(docCFields)]);

    // Approve Doc C
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${docCId}';`);

    const gradesCBeforeArchive = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${studentCId}';`);
    assert.strictEqual(gradesCBeforeArchive.rows.length, 2);
    const standingCBeforeArchive = await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentCId}';`);
    assert.strictEqual(standingCBeforeArchive.rows[0].overall_status, "Passed");

    const historyCountBeforeArchive = await db.query(`SELECT count(*) FROM public.academic_standing_history WHERE student_id = '${studentCId}';`);

    // Transition Doc C from 'approved' to 'archived'
    await db.query(`UPDATE public.documents SET status = 'archived' WHERE id = '${docCId}';`);

    // Verify early return behavior:
    // A) Grades remain active in subject_grades (essential for DepEd SF10 permanent records)
    const gradesCAfterArchive = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${studentCId}' ORDER BY subject ASC;`);
    assert.strictEqual(gradesCAfterArchive.rows.length, 2, "Grades MUST remain in subject_grades when document is archived");
    assert.strictEqual(gradesCAfterArchive.rows[0].subject, "General Mathematics");
    assert.strictEqual(gradesCAfterArchive.rows[1].subject, "Komunikasyon at Pananaliksik");
    assert.strictEqual(gradesCAfterArchive.rows[0].document_id, docCId, "document_id link is preserved");

    // B) Student overall status is NOT modified by archiving
    const standingCAfterArchive = await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentCId}';`);
    assert.strictEqual(standingCAfterArchive.rows[0].overall_status, "Passed", "Archiving does NOT revert standing");

    // C) No spurious academic_standing_history added
    const historyCountAfterArchive = await db.query(`SELECT count(*) FROM public.academic_standing_history WHERE student_id = '${studentCId}';`);
    assert.strictEqual(historyCountAfterArchive.rows[0].count, historyCountBeforeArchive.rows[0].count, "Early return emits no spurious history");

    // Now test Chronological Archival Exclusion when processing an older document
    // Student C now gets a NEWER document (SY 2022-2023, Grade 12) approved
    const docC2Id = "dc333333-3333-3333-3333-333333333334";
    const docC2Fields = {
      school_year: "2022-2023",
      semester: "1st Semester",
      grade_level: "12",
      grades: [
        { subject: "Practical Research 2", q1: 72, q2: 74, final_grade: 73, status: "Failed" }
      ]
    };
    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${docC2Id}', '${studentCId}', '${schoolId}', 'SF9', '2022-2023', '1st Semester', '12', 'needs_review', $1::jsonb, '${adminUserId}');
    `, [JSON.stringify(docC2Fields)]);

    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${docC2Id}';`);

    // Student standing should reflect newer SY 2022-2023 (Failed -> Needs Verification)
    const standingCYear2 = await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentCId}';`);
    assert.strictEqual(standingCYear2.rows[0].overall_status, "Needs Verification", "Newer SY 2022-2023 document determines current standing");

    // Now approve an OLDER historical document (SY 2020-2021 Grade 10)
    const docC0Id = "dc333333-3333-3333-3333-333333333335";
    const docC0Fields = {
      school_year: "2020-2021",
      semester: "full year",
      grade_level: "10",
      grades: [
        { subject: "Junior High English", q1: 95, q2: 95, q3: 95, q4: 95, final_grade: 95, status: "Passed" }
      ]
    };
    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${docC0Id}', '${studentCId}', '${schoolId}', 'SF9', '2020-2021', 'full year', '10', 'needs_review', $1::jsonb, '${adminUserId}');
    `, [JSON.stringify(docC0Fields)]);

    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${docC0Id}';`);

    // 1) Grades ARE added to subject_grades for permanent record
    const allCGrades = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${studentCId}';`);
    assert.strictEqual(allCGrades.rows.length, 4, "Historical Grade 10 subject must be added to subject_grades");

    // 2) But student overall_status is PRESERVED at Needs Verification (NOT overwritten by older Grade 10 passing record)
    const standingCAfterOlderDoc = await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentCId}';`);
    assert.strictEqual(standingCAfterOlderDoc.rows[0].overall_status, "Needs Verification", "Older archived document must NOT overwrite current academic standing");

    // 3) academic_standing_history notes explicitly record that older doc was treated as archived
    const lastHistEntry = await db.query(`
      SELECT confirmation_notes FROM public.academic_standing_history 
      WHERE student_id = '${studentCId}' AND document_id = '${docC0Id}'
      ORDER BY created_at DESC LIMIT 1;
    `);
    assert.ok(lastHistEntry.rows[0].confirmation_notes.includes("Archived document processed for school year 2020-2021; preserved current student status"),
      "Must record archived document note in academic_standing_history");
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 3: Multiple School Years, Semesters, Corrections, and Reapproval
  // ---------------------------------------------------------------------------
  await t.test("Req 3: Multiple school years, multiple semesters, grade corrections, and reapproval", async (t) => {
    const studentDId = "d4444444-4444-4444-4444-444444444444";
    await db.query(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, overall_status)
      VALUES ('${studentDId}', '${schoolId}', '444444444444', 'Simoun', 'Ibarra', '11', 'Needs Verification');
    `);

    // Year 1, Sem 1 (2021-2022)
    const doc1Id = "d4444444-4444-4444-4444-444444444401";
    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${doc1Id}', '${studentDId}', '${schoolId}', 'SF9', '2021-2022', '1st Semester', '11', 'needs_review', $1::jsonb, '${adminUserId}');
    `, [JSON.stringify({
      school_year: "2021-2022", semester: "1st Semester", grade_level: "11",
      grades: [
        { subject: "Oral Communication", q1: 85, q2: 87, final_grade: 86, status: "Passed" },
        { subject: "General Mathematics", q1: 82, q2: 84, final_grade: 83, status: "Passed" }
      ]
    })]);
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc1Id}';`);

    // Year 1, Sem 2 (2021-2022)
    const doc2Id = "d4444444-4444-4444-4444-444444444402";
    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${doc2Id}', '${studentDId}', '${schoolId}', 'SF9', '2021-2022', '2nd Semester', '11', 'needs_review', $1::jsonb, '${adminUserId}');
    `, [JSON.stringify({
      school_year: "2021-2022", semester: "2nd Semester", grade_level: "11",
      grades: [
        { subject: "Reading and Writing", q3: 88, q4: 90, final_grade: 89, status: "Passed" },
        { subject: "Statistics and Probability", q3: 84, q4: 86, final_grade: 85, status: "Passed" }
      ]
    })]);
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc2Id}';`);

    // Year 2, Sem 1 (2022-2023)
    const doc3Id = "d4444444-4444-4444-4444-444444444403";
    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${doc3Id}', '${studentDId}', '${schoolId}', 'SF9', '2022-2023', '1st Semester', '12', 'needs_review', $1::jsonb, '${adminUserId}');
    `, [JSON.stringify({
      school_year: "2022-2023", semester: "1st Semester", grade_level: "12",
      grades: [
        { subject: "Physical Science", q1: 78, q2: 76, final_grade: 77, status: "Passed" },
        { subject: "Media and Information Literacy", q1: 89, q2: 91, final_grade: 90, status: "Passed" }
      ]
    })]);
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc3Id}';`);

    // Verify 6 active grades across 2 school years and 3 semesters
    const gradesTotal = await db.query(`SELECT count(*) FROM public.subject_grades WHERE student_id = '${studentDId}';`);
    assert.strictEqual(Number(gradesTotal.rows[0].count), 6, "Must have exactly 6 distinct active subject grades");

    // Test Correction: Update Doc 3 grades (Physical Science Q1 was OCR misread as 78, corrected to 88; Q2 was 76, corrected to 86)
    const correctedDoc3Fields = {
      school_year: "2022-2023", semester: "1st Semester", grade_level: "12",
      grades: [
        { subject: "Physical Science", q1: 88, q2: 86, final_grade: 87, status: "Passed" },
        { subject: "Media and Information Literacy", q1: 89, q2: 91, final_grade: 90, status: "Passed" }
      ]
    };
    await db.query(`
      UPDATE public.documents 
      SET extracted_fields = $1::jsonb 
      WHERE id = '${doc3Id}';
    `, [JSON.stringify(correctedDoc3Fields)]);

    // Check Physical Science grade row in subject_grades
    const physSci = await db.query(`
      SELECT q1, q2, final_grade FROM public.subject_grades 
      WHERE student_id = '${studentDId}' AND subject = 'Physical Science';
    `);
    assert.strictEqual(Number(physSci.rows[0].q1), 88, "Q1 must be updated to 88");
    assert.strictEqual(Number(physSci.rows[0].q2), 86, "Q2 must be updated to 86");
    assert.strictEqual(Number(physSci.rows[0].final_grade), 87, "final_grade must be recalculated to 87 under DO 8");

    // Confirm total active grades is STILL 6 (in-place update, NO duplicate records)
    const gradesAfterCorrection = await db.query(`SELECT count(*) FROM public.subject_grades WHERE student_id = '${studentDId}';`);
    assert.strictEqual(Number(gradesAfterCorrection.rows[0].count), 6, "No duplicates created on correction");

    // Test Unapproval and Reapproval of Doc 3:
    // Unapprove Doc 3 (set to 'needs_review')
    await db.query(`UPDATE public.documents SET status = 'needs_review' WHERE id = '${doc3Id}';`);

    // Active grades for Doc 3 should be removed; Doc 1 and Doc 2 grades (4 grades) MUST remain active!
    const gradesRemaining = await db.query(`
      SELECT school_year, semester, subject FROM public.subject_grades WHERE student_id = '${studentDId}' ORDER BY school_year, semester, subject;
    `);
    assert.strictEqual(gradesRemaining.rows.length, 4, "Doc 1 and Doc 2 grades (4 grades) must remain active");
    assert.strictEqual(gradesRemaining.rows[0].school_year, "2021-2022");
    assert.strictEqual(gradesRemaining.rows[3].school_year, "2021-2022");

    // Reapprove Doc 3
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc3Id}';`);

    // All 6 grades are restored cleanly!
    const gradesRestored = await db.query(`SELECT count(*) FROM public.subject_grades WHERE student_id = '${studentDId}';`);
    assert.strictEqual(Number(gradesRestored.rows[0].count), 6, "All 6 grades must be active after re-approval");

    const restoredPhysSci = await db.query(`
      SELECT q1, q2, final_grade FROM public.subject_grades 
      WHERE student_id = '${studentDId}' AND subject = 'Physical Science';
    `);
    assert.strictEqual(Number(restoredPhysSci.rows[0].q1), 88);
    assert.strictEqual(Number(restoredPhysSci.rows[0].final_grade), 87);
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 4: Accuracy of grade_change_history & academic_standing_history
  // ---------------------------------------------------------------------------
  await t.test("Req 4: Verify grade_change_history and academic_standing_history accuracy and audit trail preservation", async (t) => {
    const studentEId = "e5555555-5555-5555-5555-555555555555";
    await db.query(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, overall_status)
      VALUES ('${studentEId}', '${schoolId}', '555555555555', 'Elias', 'Alvarez', '11', 'Needs Verification');
    `);

    const docEId = "de555555-5555-5555-5555-555555555555";
    const initialFields = {
      school_year: "2022-2023", semester: "1st Semester", grade_level: "11",
      grades: [
        { subject: "Empowerment Technologies", q1: 80, q2: 82, final_grade: 81, status: "Passed" }
      ]
    };

    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${docEId}', '${studentEId}', '${schoolId}', 'SF9', '2022-2023', '1st Semester', '11', 'needs_review', $1::jsonb, '${adminUserId}');
    `, [JSON.stringify(initialFields)]);

    // Approve initial document
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${docEId}';`);

    // Verify 0 grade changes logged initially (inserting fresh grades does NOT log a modification)
    const changesInitial = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = '${studentEId}';`);
    assert.strictEqual(changesInitial.rows.length, 0, "Initial insertion must not create grade_change_history");

    // Perform an approved grade update (Teacher reviews and corrects OCR mistake in Q2 from 82 to 92)
    const correctedFields = {
      school_year: "2022-2023", semester: "1st Semester", grade_level: "11",
      grades: [
        { subject: "Empowerment Technologies", q1: 80, q2: 92, final_grade: 86, status: "Passed" }
      ]
    };

    await db.query(`
      UPDATE public.documents 
      SET extracted_fields = $1::jsonb 
      WHERE id = '${docEId}';
    `, [JSON.stringify(correctedFields)]);

    // Verify grade_change_history has exact records for Q2 and recalculated final_grade
    const changesAfterReview = await db.query(`
      SELECT quarter, previous_value, new_value, reason, changed_by 
      FROM public.grade_change_history 
      WHERE student_id = '${studentEId}'
      ORDER BY quarter ASC;
    `);

    assert.strictEqual(changesAfterReview.rows.length, 2, "Must record exactly 2 changes: q2 and dependent final_grade");

    const finalChange = changesAfterReview.rows.find(r => r.quarter === "final_grade");
    assert.strictEqual(Number(finalChange.previous_value), 81);
    assert.strictEqual(Number(finalChange.new_value), 86);
    assert.strictEqual(finalChange.reason, "Recalculated dependent final grade");
    assert.strictEqual(finalChange.changed_by, adminUserId);

    const q2Change = changesAfterReview.rows.find(r => r.quarter === "q2");
    assert.strictEqual(Number(q2Change.previous_value), 82);
    assert.strictEqual(Number(q2Change.new_value), 92);
    assert.strictEqual(q2Change.reason, "Approved grade update via document review");
    assert.strictEqual(q2Change.changed_by, adminUserId);

    // Verify NULL fields in subsequent update do NOT overwrite and do NOT create bogus history entries
    const partialFields = {
      school_year: "2022-2023", semester: "1st Semester", grade_level: "11",
      grades: [
        { subject: "Empowerment Technologies", q1: null, q2: null, final_grade: null }
      ]
    };
    await db.query(`UPDATE public.documents SET extracted_fields = $1::jsonb WHERE id = '${docEId}';`, [JSON.stringify(partialFields)]);

    const changesAfterNull = await db.query(`SELECT count(*) FROM public.grade_change_history WHERE student_id = '${studentEId}';`);
    assert.strictEqual(Number(changesAfterNull.rows[0].count), 2, "NULL fields must not create new grade_change_history entries");

    // Unapprove Doc E and confirm grade_change_history is NOT CASCADE-DELETED!
    await db.query(`UPDATE public.documents SET status = 'needs_review' WHERE id = '${docEId}';`);

    const changesAfterUnapprove = await db.query(`
      SELECT id, subject_grade_id, quarter, previous_value, new_value 
      FROM public.grade_change_history 
      WHERE student_id = '${studentEId}';
    `);
    assert.strictEqual(changesAfterUnapprove.rows.length, 2, "grade_change_history MUST be preserved after document unapproval");
    assert.strictEqual(changesAfterUnapprove.rows[0].subject_grade_id, null, "subject_grade_id is SET NULL when subject_grade is deleted");

    // Verify academic_standing_history accuracy throughout lifecycle
    const allStandingHistory = await db.query(`
      SELECT previous_status, new_status, decision_source, confirmation_notes 
      FROM public.academic_standing_history 
      WHERE student_id = '${studentEId}'
      ORDER BY created_at ASC;
    `);
    // 4 transitions occurred:
    // 1. Initial approval: Needs Verification -> Passed
    // 2. Grade correction edit: Passed -> Passed ('All extracted subject marks meet passing threshold.')
    // 3. Partial fields update: Passed -> Passed
    // 4. Unapproval to needs_review: Passed -> Needs Verification ('Document reverted or un-approved')
    assert.strictEqual(allStandingHistory.rows.length, 4, "Must have 4 standing history entries tracing full lifecycle");
    assert.strictEqual(allStandingHistory.rows[0].new_status, "Passed");
    assert.strictEqual(allStandingHistory.rows[0].decision_source, "automated_trigger");
    assert.strictEqual(allStandingHistory.rows[1].new_status, "Passed");
    assert.strictEqual(allStandingHistory.rows[2].new_status, "Passed");
    assert.strictEqual(allStandingHistory.rows[3].previous_status, "Passed");
    assert.strictEqual(allStandingHistory.rows[3].new_status, "Needs Verification");
    assert.strictEqual(allStandingHistory.rows[3].decision_source, "automated_trigger");
    assert.ok(allStandingHistory.rows[3].confirmation_notes.includes("Document reverted or un-approved"));
  });

  // ---------------------------------------------------------------------------
  // REQUIREMENT 5: Correcting Document Rejection Reversion to Prior Approved Doc
  // ---------------------------------------------------------------------------
  await t.test("Req 5: Rejection of a correcting document safely reverts active grades to prior approved document with audit history", async (t) => {
    const studentFId = "f7777777-7777-7777-7777-777777777777";
    await db.query(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, overall_status)
      VALUES ('${studentFId}', '${schoolId}', '777777777778', 'Tarsilo', 'Alasigan', '11', 'Needs Verification');
    `);

    // Doc 1 (Original Form): SY 2022-2023 1st Sem - General Mathematics (Q1=80, Q2=82, Final=81)
    const doc1Id = "df777777-7777-7777-7777-777777777701";
    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${doc1Id}', '${studentFId}', '${schoolId}', 'SF9', '2022-2023', '1st Semester', '11', 'needs_review',
        '{"school_year":"2022-2023","semester":"1st Semester","grade_level":"11","grades":[{"subject":"General Mathematics","q1":80,"q2":82,"final_grade":81,"status":"Passed"}]}'::jsonb,
        '${adminUserId}');
    `);
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc1Id}';`);

    const initialGrade = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${studentFId}' AND subject = 'General Mathematics';`);
    assert.strictEqual(initialGrade.rows[0].document_id, doc1Id);
    assert.strictEqual(Number(initialGrade.rows[0].final_grade), 81);

    // Doc 2 (Correcting / Re-scanned Form): SY 2022-2023 1st Sem - General Mathematics (Q1=90, Q2=92, Final=91)
    const doc2Id = "df777777-7777-7777-7777-777777777702";
    await db.query(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
      VALUES ('${doc2Id}', '${studentFId}', '${schoolId}', 'SF9', '2022-2023', '1st Semester', '11', 'needs_review',
        '{"school_year":"2022-2023","semester":"1st Semester","grade_level":"11","grades":[{"subject":"General Mathematics","q1":90,"q2":92,"final_grade":91,"status":"Passed"}]}'::jsonb,
        '${adminUserId}');
    `);
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc2Id}';`);

    // Verify Doc 2 updated the existing active grade in-place
    const updatedGrade = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${studentFId}' AND subject = 'General Mathematics';`);
    assert.strictEqual(updatedGrade.rows[0].document_id, doc2Id);
    assert.strictEqual(Number(updatedGrade.rows[0].final_grade), 91);

    // Now REJECT Doc 2 (e.g., administrator discovers Doc 2 had unauthorized alterations or fraudulent scan)
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = '${doc2Id}';`);

    // VERIFY: The grade is NOT deleted! It safely reverts to Doc 1's approved grades!
    const revertedGrade = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = '${studentFId}' AND subject = 'General Mathematics';`);
    assert.strictEqual(revertedGrade.rows.length, 1, "Grade row must NOT be deleted because prior approved Doc 1 exists");
    assert.strictEqual(revertedGrade.rows[0].document_id, doc1Id, "document_id reverted to prior approved doc");
    assert.strictEqual(Number(revertedGrade.rows[0].q1), 80, "Q1 reverted to Doc 1");
    assert.strictEqual(Number(revertedGrade.rows[0].q2), 82, "Q2 reverted to Doc 1");
    assert.strictEqual(Number(revertedGrade.rows[0].final_grade), 81, "final_grade reverted to Doc 1");

    // VERIFY: grade_change_history logged the reversion
    const revertHistory = await db.query(`
      SELECT quarter, previous_value, new_value, reason 
      FROM public.grade_change_history 
      WHERE student_id = '${studentFId}' AND reason LIKE '%reverted to prior approved%'
      ORDER BY quarter ASC;
    `);
    assert.ok(revertHistory.rows.length > 0, "Must record reversion in grade_change_history");
    const q1Revert = revertHistory.rows.find(r => r.quarter === "q1");
    assert.strictEqual(Number(q1Revert.previous_value), 90);
    assert.strictEqual(Number(q1Revert.new_value), 80);
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeLrn, isValidLrn } from "../src/lib/validation/patterns.ts";
import { evaluateStudentIdentity, verifyStudentCollision } from "../src/lib/validation/studentMatcher.ts";
import { 
  compareScannedGradesWithExisting, 
  normalizeSubjectName, 
  normalizeSemester 
} from "../src/lib/validation/gradeComparator.ts";
import { computeSemesterFinalGrade } from "../src/lib/validation/gradeUtils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("AVV System — LRN Deduplication & Controlled Grade Update Test Suite", async (t) => {
  // ---------------------------------------------------------------------------
  // Unit & Pure Logic Tests: LRN Formatting & Normalization
  // ---------------------------------------------------------------------------
  await t.test("Unit: LRN normalization trims whitespace and permitted formatting characters", () => {
    // 12-digit clean
    assert.strictEqual(normalizeLrn("123456789012"), "123456789012");
    // Spaces between digit groups
    assert.strictEqual(normalizeLrn(" 1234 5678 9012 "), "123456789012");
    // Hyphens
    assert.strictEqual(normalizeLrn("1234-5678-9012"), "123456789012");
    // Dots
    assert.strictEqual(normalizeLrn("1234.5678.9012"), "123456789012");
    // Common DepEd LRN prefix
    assert.strictEqual(normalizeLrn("LRN: 123456789012"), "123456789012");
    assert.strictEqual(normalizeLrn("LRN - 1234-5678-9012"), "123456789012");
    assert.strictEqual(normalizeLrn("Learner Reference Number: 1234 5678 9012"), "123456789012");

    // Validity checking
    assert.strictEqual(isValidLrn("123456789012"), true);
    assert.strictEqual(isValidLrn("1234-5678-9012"), true);
    assert.strictEqual(isValidLrn(" 1234 5678 9012 "), true);
    assert.strictEqual(isValidLrn("LRN: 123456789012"), true);

    // Invalid LRNs (rejected, never truncated or padded)
    assert.strictEqual(isValidLrn("12345"), false, "Fails if under 12 digits");
    assert.strictEqual(isValidLrn("123456789012345"), false, "Fails if over 12 digits");
    assert.strictEqual(isValidLrn("ABC123456789"), false, "Fails if non-numeric");
    assert.strictEqual(isValidLrn(""), false);
    assert.strictEqual(isValidLrn(null), false);
    assert.strictEqual(isValidLrn(undefined), false);
  });

  // ---------------------------------------------------------------------------
  // End-to-End Database & Workflow Scenarios against PostgreSQL (PGlite)
  // ---------------------------------------------------------------------------
  const db = new PGlite();

  // Setup PostgreSQL schema
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$ LANGUAGE sql STABLE;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY, school_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      division TEXT, region TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
      END IF;
    END $$;

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
      lrn TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, middle_name TEXT, last_name TEXT NOT NULL,
      suffix TEXT, grade_level TEXT, sex TEXT, status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification',
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL, image_url TEXT NOT NULL,
      school_year TEXT, grade_level TEXT, semester TEXT,
      curriculum_id TEXT, source_form_version TEXT, grading_policy_version TEXT, grading_period_scheme TEXT,
      general_average_printed NUMERIC,
      extracted_fields JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'needs_review', uploaded_by TEXT, reviewed_by UUID,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      school_year TEXT, grade_level TEXT, semester TEXT,
      source_section TEXT, subject_track TEXT, subject_category TEXT, subject_code TEXT, grading_period_scheme TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
      t1 NUMERIC, t2 NUMERIC, t3 NUMERIC,
      sem1_final_grade NUMERIC, sem2_final_grade NUMERIC, units NUMERIC, failed_final_grade NUMERIC,
      remedial_class_mark NUMERIC, recomputed_final_grade NUMERIC, remedial_sem1_recomputed NUMERIC, remedial_sem2_recomputed NUMERIC,
      final_grade NUMERIC, action_taken TEXT, remark TEXT,
      status TEXT, needs_verification BOOLEAN DEFAULT false,
      curriculum_id TEXT, source_form_version TEXT, grading_policy_version TEXT,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.review_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      previous_status TEXT, new_status TEXT, comment TEXT, reviewed_by UUID,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin' AND account_status = 'Approved');
    END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS boolean AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'principal' AND account_status = 'Approved');
    END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS boolean AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher' AND account_status = 'Approved');
    END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS boolean AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND account_status = 'Approved');
    END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS uuid AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN NULL; END IF;
      RETURN (SELECT school_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1);
    END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
  `);

  // Execute Migration 015 against PGlite
  const migrationPath = path.resolve(rootDir, "supabase/migrations/015_lrn_deduplication_and_grade_updates.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  await db.exec(migrationSql);

  // Setup Trigger on documents table
  await db.exec(`
    DROP TRIGGER IF EXISTS trigger_process_approved_document ON public.documents;
    CREATE TRIGGER trigger_process_approved_document
      AFTER UPDATE ON public.documents
      FOR EACH ROW
      EXECUTE FUNCTION public.process_approved_document();
  `);

  // Seed School and Admin User
  const schoolId = "a0000000-0000-0000-0000-000000000001";
  const adminId = "b0000000-0000-0000-0000-000000000001";
  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES ('${schoolId}', '500169', 'Taysan Resettlement Integrated School');
    INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'admin@deped.gov.ph');
    INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES ('${adminId}', 'admin', 'Approved', '${schoolId}');
  `);

  // Set auth context to Admin
  await db.exec(`
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);
  `);

  // ---------------------------------------------------------------------------
  // Requirement 1: First scan creates one verified student
  // ---------------------------------------------------------------------------
  let student1Id;
  await t.test("Scenario 1: First scan creates one verified student", async () => {
    const rawFields = {
      lrn: "1234-5678-9012",
      first_name: "JUAN",
      middle_name: "MIGUEL",
      last_name: "DELA CRUZ",
      grade_level: "Grade 11",
      school_year: "2024-2025",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", q1: 78, q2: 80, final: 79, status: "Passed", semester: "1st Semester" },
        { subject: "General Mathematics", q1: 85, q2: 87, final: 86, status: "Passed", semester: "1st Semester" }
      ]
    };

    const identity = evaluateStudentIdentity(rawFields);
    assert.strictEqual(identity.isValidLrn, true);
    assert.strictEqual(identity.normalizedLrn, "123456789012");
    assert.strictEqual(identity.canAutoCreate, true);

    // Initial student insertion
    const stRes = await db.query(`
      INSERT INTO public.students (school_id, lrn, first_name, middle_name, last_name, grade_level)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, lrn;
    `, [schoolId, identity.normalizedLrn, identity.firstName, identity.middleName, identity.lastName, rawFields.grade_level]);

    assert.strictEqual(stRes.rows.length, 1);
    student1Id = stRes.rows[0].id;
    assert.strictEqual(stRes.rows[0].lrn, "123456789012");

    // Insert Document 1 and approve it
    const docRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, grade_level, semester,
        extracted_fields, status, uploaded_by, reviewed_by
      ) VALUES ($1, $2, 'sf9', 'uploaded-doc-1.jpg', $3, $4, $5, $6, 'needs_review', 'teacher-1', $7)
      RETURNING id;
    `, [student1Id, schoolId, rawFields.school_year, rawFields.grade_level, rawFields.semester, JSON.stringify(rawFields), adminId]);

    const doc1Id = docRes.rows[0].id;

    // Approve Document 1 (triggers trigger_process_approved_document)
    await db.query(`
      UPDATE public.documents SET status = 'approved' WHERE id = $1;
    `, [doc1Id]);

    // Verify exactly 2 active subject grades created
    const sgRows = await db.query(`
      SELECT * FROM public.subject_grades WHERE student_id = $1 ORDER BY subject ASC;
    `, [student1Id]);

    assert.strictEqual(sgRows.rows.length, 2);
    assert.strictEqual(sgRows.rows[0].subject, "General Mathematics");
    assert.strictEqual(Number(sgRows.rows[0].final_grade), 86);
    assert.strictEqual(sgRows.rows[1].subject, "Oral Communication");
    assert.strictEqual(Number(sgRows.rows[1].q1), 78);
    assert.strictEqual(Number(sgRows.rows[1].final_grade), 79);
  });

  // ---------------------------------------------------------------------------
  // Requirement 2: Second scan with same LRN reuses existing student
  // ---------------------------------------------------------------------------
  let doc2Id;
  await t.test("Scenario 2: Second scan with the same LRN reuses existing student ID", async () => {
    const scan2Fields = {
      lrn: " 1234 5678 9012 ", // formatted with whitespace
      last_name: "DELA CRUZ",
      first_name: "JUAN",
      school_year: "2024-2025",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", q1: 78, q2: 80, final: 79, status: "Passed", semester: "1st Semester" }
      ]
    };

    const identity = evaluateStudentIdentity(scan2Fields);
    assert.strictEqual(identity.normalizedLrn, "123456789012");

    // Lookup existing student by normalized LRN
    const found = await db.query(`
      SELECT id, first_name, last_name FROM public.students WHERE lrn = $1;
    `, [identity.normalizedLrn]);

    assert.strictEqual(found.rows.length, 1);
    const existingStudent = found.rows[0];
    assert.strictEqual(existingStudent.id, student1Id);

    // Collision check
    const collision = verifyStudentCollision(identity.lastName, existingStudent);
    assert.strictEqual(collision.hasConflict, false);

    // Document 2 is linked directly to existing student1Id
    const doc2Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status, uploaded_by, reviewed_by
      ) VALUES ($1, $2, 'sf9', 'uploaded-doc-2.jpg', '2024-2025', '1st Semester', $3, 'needs_review', 'teacher-2', $4)
      RETURNING id, student_id;
    `, [existingStudent.id, schoolId, JSON.stringify(scan2Fields), adminId]);

    doc2Id = doc2Res.rows[0].id;
    assert.strictEqual(doc2Res.rows[0].student_id, student1Id);

    // Assert students count remains exactly 1
    const totalStudents = await db.query(`SELECT COUNT(*) FROM public.students;`);
    assert.strictEqual(Number(totalStudents.rows[0].count), 1, "Must NOT create duplicate student profile");
  });

  // ---------------------------------------------------------------------------
  // Requirement 3: Same grade scanned twice causes no duplicate
  // ---------------------------------------------------------------------------
  await t.test("Scenario 3: Same grade scanned twice causes zero duplicate active records", async () => {
    // Approve Document 2 which contains identical grades for Oral Communication
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc2Id]);

    const grades = await db.query(`
      SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication';
    `, [student1Id]);

    assert.strictEqual(grades.rows.length, 1, "Must have exactly 1 active grade record for Oral Communication");
    assert.strictEqual(Number(grades.rows[0].q1), 78);
    assert.strictEqual(Number(grades.rows[0].final_grade), 79);

    // Grade change history must have 0 records because values were identical
    const history = await db.query(`
      SELECT * FROM public.grade_change_history WHERE student_id = $1;
    `, [student1Id]);
    assert.strictEqual(history.rows.length, 0, "Identical scan must produce ZERO grade change history entries");
  });

  // ---------------------------------------------------------------------------
  // Requirement 4: Changed Q1 grade 78 -> 83 produces a pending review
  // ---------------------------------------------------------------------------
  let doc3Id;
  await t.test("Scenario 4: Changed Q1 grade 78 -> 83 produces pending review diff", async () => {
    const doc3Fields = {
      lrn: "123456789012",
      last_name: "DELA CRUZ",
      first_name: "JUAN",
      school_year: "2024-2025",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", q1: 83, q2: 80, final: 82, status: "Passed", semester: "1st Semester" }
      ]
    };

    // Active existing grades
    const existing = await db.query(`
      SELECT * FROM public.subject_grades WHERE student_id = $1;
    `, [student1Id]);

    const comparison = compareScannedGradesWithExisting({
      existingGrades: existing.rows,
      scannedGrades: doc3Fields.grades,
      schoolYear: "2024-2025",
      semester: "1st Semester",
      studentId: student1Id,
    });

    assert.strictEqual(comparison.hasAnyProposedChanges, true);
    assert.strictEqual(comparison.proposedUpdateCount, 1);
    assert.strictEqual(comparison.unchangedCount, 0);

    const oralComm = comparison.subjects.find(s => s.subject === "Oral Communication");
    assert.ok(oralComm);
    assert.strictEqual(oralComm.status, "PROPOSED_UPDATE");
    assert.strictEqual(oralComm.proposedFinalGrade, 82);
    assert.strictEqual(oralComm.proposedStatus, "Passed");

    const q1Diff = oralComm.quarterDiffs.find(d => d.quarter === "q1");
    assert.ok(q1Diff);
    assert.strictEqual(q1Diff.hasChange, true);
    assert.strictEqual(q1Diff.existingValue, 78);
    assert.strictEqual(q1Diff.scannedValue, 83);

    // Staged in documents as needs_review
    const doc3Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status, uploaded_by, reviewed_by
      ) VALUES ($1, $2, 'sf9', 'uploaded-doc-3.jpg', '2024-2025', '1st Semester', $3, 'needs_review', 'teacher-1', $4)
      RETURNING id, status;
    `, [student1Id, schoolId, JSON.stringify(doc3Fields), adminId]);

    doc3Id = doc3Res.rows[0].id;
    assert.strictEqual(doc3Res.rows[0].status, "needs_review");
  });

  // ---------------------------------------------------------------------------
  // Requirement 5: Approved update changes the active grade to 83 & recalculates final
  // ---------------------------------------------------------------------------
  await t.test("Scenario 5: Approved update changes active grade to 83, logs 78 in audit history, and recalculates final", async () => {
    // Approve Document 3
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc3Id]);

    // Active record in subject_grades must be 83, final 82
    const grades = await db.query(`
      SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication';
    `, [student1Id]);

    assert.strictEqual(grades.rows.length, 1, "Must still have exactly ONE active record");
    assert.strictEqual(Number(grades.rows[0].q1), 83, "Active Q1 must now be 83");
    assert.strictEqual(Number(grades.rows[0].q2), 80);
    assert.strictEqual(Number(grades.rows[0].final_grade), 82, "Final must be recalculated (83 + 80)/2 = 82");
    assert.strictEqual(grades.rows[0].status, "Passed");

    // History record must preserve previous grade of 78
    const hist = await db.query(`
      SELECT * FROM public.grade_change_history WHERE student_id = $1 AND subject = 'Oral Communication' AND quarter = 'q1';
    `, [student1Id]);

    assert.strictEqual(hist.rows.length, 1);
    assert.strictEqual(Number(hist.rows[0].previous_value), 78, "Previous grade of 78 must be preserved in audit history");
    assert.strictEqual(Number(hist.rows[0].new_value), 83);
  });

  // ---------------------------------------------------------------------------
  // Requirement 6: Rejected update retains 78 (or existing verified grade)
  // ---------------------------------------------------------------------------
  await t.test("Scenario 6: Rejected update retains existing verified grade without overwriting", async () => {
    // Stage Document 4 with unverified Q1 = 95
    const doc4Fields = {
      lrn: "123456789012",
      last_name: "DELA CRUZ",
      first_name: "JUAN",
      school_year: "2024-2025",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", q1: 95, q2: 80, final: 88, status: "Passed", semester: "1st Semester" }
      ]
    };

    const doc4Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status, uploaded_by
      ) VALUES ($1, $2, 'sf9', 'uploaded-doc-4.jpg', '2024-2025', '1st Semester', $3, 'needs_review', 'teacher-1')
      RETURNING id;
    `, [student1Id, schoolId, JSON.stringify(doc4Fields)]);

    const doc4Id = doc4Res.rows[0].id;

    // Administrator REJECTS Document 4
    await db.query(`
      UPDATE public.documents SET status = 'rejected', reviewed_by = $1 WHERE id = $2;
    `, [adminId, doc4Id]);

    // Active record must remain 83 (not 95)
    const grades = await db.query(`
      SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication';
    `, [student1Id]);

    assert.strictEqual(Number(grades.rows[0].q1), 83, "Active grade must remain 83 after rejection");
    assert.strictEqual(Number(grades.rows[0].final_grade), 82);

    // No new history entry for rejected value 95
    const hist95 = await db.query(`
      SELECT * FROM public.grade_change_history WHERE student_id = $1 AND new_value = 95;
    `, [student1Id]);
    assert.strictEqual(hist95.rows.length, 0, "Rejected proposed grade must NOT be recorded in active history");
  });

  // ---------------------------------------------------------------------------
  // Requirement 7: Missing LRN triggers manual review
  // ---------------------------------------------------------------------------
  await t.test("Scenario 7: Missing LRN triggers manual review and prevents auto-creation", () => {
    const missingLrnFields = {
      lrn: "",
      first_name: "JUAN",
      last_name: "DELA CRUZ",
      school_year: "2024-2025",
    };

    const identity = evaluateStudentIdentity(missingLrnFields);
    assert.strictEqual(identity.isValidLrn, false);
    assert.strictEqual(identity.canAutoCreate, false);
    assert.strictEqual(identity.canAutoLink, false);
    assert.strictEqual(identity.requiresManualReview, true);
    assert.ok(identity.reasons.some(r => r.includes("missing")));
  });

  // ---------------------------------------------------------------------------
  // Requirement 8: Invalid LRN does not create a student
  // ---------------------------------------------------------------------------
  await t.test("Scenario 8: Invalid LRN format does not create a student record", async () => {
    const invalidLrnFields = {
      lrn: "12345", // Only 5 digits
      first_name: "PEDRO",
      last_name: "PENDUKO",
      school_year: "2024-2025",
    };

    const identity = evaluateStudentIdentity(invalidLrnFields);
    assert.strictEqual(identity.isValidLrn, false);
    assert.strictEqual(identity.canAutoCreate, false);

    // Database check constraint rejects invalid LRN
    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.students (school_id, lrn, first_name, last_name)
        VALUES ($1, $2, $3, $4);
      `, [schoolId, "12345", "PEDRO", "PENDUKO"]);
    }, /chk_students_lrn_format/);
  });

  // ---------------------------------------------------------------------------
  // Requirement 9: Different LRNs do not merge automatically
  // ---------------------------------------------------------------------------
  await t.test("Scenario 9: Different LRNs do not merge automatically even with same name", async () => {
    const studentBFields = {
      lrn: "987654321098", // Different LRN
      first_name: "JUAN",
      last_name: "DELA CRUZ", // Same name as student 1
      school_year: "2024-2025",
    };

    const identity = evaluateStudentIdentity(studentBFields);
    assert.strictEqual(identity.isValidLrn, true);

    // Look up existing student by LRN
    const found = await db.query(`
      SELECT id FROM public.students WHERE lrn = $1;
    `, [identity.normalizedLrn]);

    assert.strictEqual(found.rows.length, 0, "Must not find student1 when searching by student2 LRN");

    // Creating student 2
    const st2Res = await db.query(`
      INSERT INTO public.students (school_id, lrn, first_name, last_name)
      VALUES ($1, $2, $3, $4)
      RETURNING id, lrn;
    `, [schoolId, identity.normalizedLrn, identity.firstName, identity.lastName]);

    assert.strictEqual(st2Res.rows.length, 1);
    assert.notStrictEqual(st2Res.rows[0].id, student1Id, "Must create a distinct student record for different LRN");

    const totalStudents = await db.query(`SELECT COUNT(*) FROM public.students;`);
    assert.strictEqual(Number(totalStudents.rows[0].count), 2);
  });

  // ---------------------------------------------------------------------------
  // Requirement 10: Concurrent scans cannot create duplicate students
  // ---------------------------------------------------------------------------
  await t.test("Scenario 10: Database unique constraint prevents concurrent duplicate student creation", async () => {
    // Attempting to insert another student with student1's LRN
    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.students (school_id, lrn, first_name, last_name)
        VALUES ($1, '123456789012', 'JUAN', 'DELA CRUZ');
      `, [schoolId]);
    }, /unique|duplicate/i);

    // Attempting with spaces
    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.students (school_id, lrn, first_name, last_name)
        VALUES ($1, ' 123456789012 ', 'JUAN', 'DELA CRUZ');
      `, [schoolId]);
    }, /chk_students_lrn_format|idx_students_normalized_lrn|unique/i);
  });

  // ---------------------------------------------------------------------------
  // Requirement 11: Other semesters, quarters, and school years remain unaffected
  // ---------------------------------------------------------------------------
  await t.test("Scenario 11: Other semesters, quarters, and school years remain completely unaffected", async () => {
    // Add Grade 11 Semester 2 grades for Student 1
    const sem2Fields = {
      lrn: "123456789012",
      school_year: "2024-2025",
      semester: "2nd Semester",
      grades: [
        { subject: "Oral Communication", q3: 88, q4: 90, final: 89, status: "Passed", semester: "2nd Semester" }
      ]
    };

    const docSem2Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status, uploaded_by, reviewed_by
      ) VALUES ($1, $2, 'sf9', 'sem2-doc.jpg', '2024-2025', '2nd Semester', $3, 'needs_review', 'teacher-1', $4)
      RETURNING id;
    `, [student1Id, schoolId, JSON.stringify(sem2Fields), adminId]);

    // Approve Semester 2
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [docSem2Res.rows[0].id]);

    // Check Semester 1 Oral Communication: Must still have Q1 = 83, Q2 = 80, final = 82
    const sem1Grades = await db.query(`
      SELECT * FROM public.subject_grades WHERE student_id = $1 AND semester ILIKE '%1st%' AND subject = 'Oral Communication';
    `, [student1Id]);
    assert.strictEqual(Number(sem1Grades.rows[0].q1), 83);
    assert.strictEqual(Number(sem1Grades.rows[0].final_grade), 82);

    // Check Semester 2 Oral Communication: Must have Q3 = 88, Q4 = 90, final = 89
    const sem2Grades = await db.query(`
      SELECT * FROM public.subject_grades WHERE student_id = $1 AND semester ILIKE '%2nd%';
    `, [student1Id]);
    assert.strictEqual(Number(sem2Grades.rows[0].q3), 88);
    assert.strictEqual(Number(sem2Grades.rows[0].final_grade), 89);
  });

  // ---------------------------------------------------------------------------
  // Requirement 12: Controlled Duplicate Students Reporting View
  // ---------------------------------------------------------------------------
  await t.test("Scenario 12: v_duplicate_students_report view functions correctly", async () => {
    const report = await db.query(`SELECT * FROM public.v_duplicate_students_report;`);
    // Currently 0 duplicates exist
    assert.strictEqual(report.rows.length, 0);
  });
});

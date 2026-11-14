import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function setupDatabase() {
  const db = new PGlite();

  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

    CREATE SCHEMA IF NOT EXISTS auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      created_at timestamptz DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$ LANGUAGE sql STABLE;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

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
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      suffix TEXT,
      gender TEXT,
      birthdate DATE,
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
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      curriculum_id TEXT,
      source_form_version TEXT,
      grading_policy_version TEXT,
      grading_period_scheme TEXT,
      general_average_printed NUMERIC,
      extracted_fields JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'needs_review',
      uploaded_by TEXT,
      reviewed_by UUID,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      source_section TEXT,
      subject_track TEXT,
      subject_category TEXT,
      subject_code TEXT,
      grading_period_scheme TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC,
      q2 NUMERIC,
      q3 NUMERIC,
      q4 NUMERIC,
      t1 NUMERIC,
      t2 NUMERIC,
      t3 NUMERIC,
      sem1_final_grade NUMERIC,
      sem2_final_grade NUMERIC,
      units NUMERIC,
      failed_final_grade NUMERIC,
      remedial_class_mark NUMERIC,
      recomputed_final_grade NUMERIC,
      remedial_sem1_recomputed NUMERIC,
      remedial_sem2_recomputed NUMERIC,
      final_grade NUMERIC,
      action_taken TEXT,
      remark TEXT,
      status TEXT,
      needs_verification BOOLEAN DEFAULT false,
      curriculum_id TEXT,
      source_form_version TEXT,
      grading_policy_version TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
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

  const m015Sql = fs.readFileSync(path.join(rootDir, "supabase", "migrations", "015_lrn_deduplication_and_grade_updates.sql"), "utf8");
  await db.exec(m015Sql);

  return db;
}

test("Three Data-Integrity Scenarios: First-Time Student Creation, Grade Uniqueness, and Grade Preservation", async (t) => {
  const db = await setupDatabase();

  const schoolA = "a0000000-0000-0000-0000-000000000001";
  const schoolB = "b0000000-0000-0000-0000-000000000002";
  const adminId = "10000000-0000-0000-0000-000000000001";

  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES
      ('${schoolA}', '500169', 'Taysan Resettlement Integrated School'),
      ('${schoolB}', '300793', 'Alternative High School');

    INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'admin@deped.gov.ph');
    INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES ('${adminId}', 'admin', 'Approved', '${schoolA}');
  `);

  await db.exec(`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${adminId}', false);
    SELECT set_config('request.jwt.claim.role', 'authenticated', false);
  `);

  // ===========================================================================
  // ISSUE 1: FIRST-TIME STUDENT CREATION
  // ===========================================================================
  let createdStudentId;
  await t.test("Issue 1: First-time student creation on approval when no student record exists", async () => {
    // Stage an SF9 document with student_id = NULL
    const sf9Fields = {
      student: {
        lrn: "123456789999",
        first_name: "CRISPIN",
        last_name: "BASILIO",
        middle_name: "DE DIOS",
        gender: "Male",
        grade_level: "Grade 11"
      },
      school_year: "2024-2025",
      semester: "1st Semester",
      grades: [
        { subject: "Earth and Life Science", q1: 85, q2: 87, final: 86, status: "Passed", semester: "1st Semester" }
      ]
    };

    const docRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, grade_level, semester,
        extracted_fields, status, uploaded_by
      ) VALUES (
        NULL, '${schoolA}', 'sf9', 'sf9-crispin-sem1.jpg', '2024-2025', 'Grade 11', '1st Semester',
        $1, 'needs_review', 'teacher-1'
      ) RETURNING id, student_id;
    `, [JSON.stringify(sf9Fields)]);

    const doc1Id = docRes.rows[0].id;
    assert.strictEqual(docRes.rows[0].student_id, null, "Document starts with student_id NULL");

    // Verify 0 students exist initially
    const preCount = await db.query(`SELECT COUNT(*) FROM public.students WHERE lrn = '123456789999';`);
    assert.strictEqual(Number(preCount.rows[0].count), 0);

    // APPROVE Document 1 (triggers link_document_student_before and process_approved_document)
    await db.query(`UPDATE public.documents SET status = 'approved', reviewed_by = '${adminId}' WHERE id = $1;`, [doc1Id]);

    // 1. Verify student record created exactly once
    const postStudent = await db.query(`SELECT * FROM public.students WHERE lrn = '123456789999';`);
    assert.strictEqual(postStudent.rows.length, 1, "Exactly one student record must be created");
    assert.strictEqual(postStudent.rows[0].first_name, "CRISPIN");
    assert.strictEqual(postStudent.rows[0].last_name, "BASILIO");
    assert.strictEqual(postStudent.rows[0].school_id, schoolA, "Preserves school isolation");
    createdStudentId = postStudent.rows[0].id;

    // 2. Verify document is linked to newly created student
    const updatedDoc = await db.query(`SELECT student_id FROM public.documents WHERE id = $1;`, [doc1Id]);
    assert.strictEqual(updatedDoc.rows[0].student_id, createdStudentId);

    // 3. Verify grades were processed for newly created student
    const createdGrades = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1;`, [createdStudentId]);
    assert.strictEqual(createdGrades.rows.length, 1);
    assert.strictEqual(createdGrades.rows[0].subject, "Earth and Life Science");
    assert.strictEqual(Number(createdGrades.rows[0].final_grade), 86);

    // 4. Test repeated upload of same SF9: Must NOT create duplicate student
    const repeatDocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status
      ) VALUES (
        NULL, '${schoolA}', 'sf9', 'sf9-repeat.jpg', '2024-2025', '1st Semester',
        $1, 'needs_review'
      ) RETURNING id, student_id;
    `, [JSON.stringify(sf9Fields)]);

    // Trigger should immediately link existing student on insert
    assert.strictEqual(repeatDocRes.rows[0].student_id, createdStudentId);

    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [repeatDocRes.rows[0].id]);
    const totalStudentsAfterRepeat = await db.query(`SELECT COUNT(*) FROM public.students WHERE lrn = '123456789999';`);
    assert.strictEqual(Number(totalStudentsAfterRepeat.rows[0].count), 1, "Repeated SF9 must NOT create duplicate student");

    // 5. Test Semester 2 upload for same student: Must NOT create duplicate student
    const sem2Fields = {
      student: { lrn: "123456789999", first_name: "CRISPIN", last_name: "BASILIO" },
      school_year: "2024-2025",
      semester: "2nd Semester",
      grades: [
        { subject: "Physical Science", q3: 88, q4: 90, final: 89, status: "Passed", semester: "2nd Semester" }
      ]
    };

    const sem2DocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status
      ) VALUES (
        NULL, '${schoolA}', 'sf9', 'sf9-sem2.jpg', '2024-2025', '2nd Semester',
        $1, 'needs_review'
      ) RETURNING id, student_id;
    `, [JSON.stringify(sem2Fields)]);

    assert.strictEqual(sem2DocRes.rows[0].student_id, createdStudentId);

    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [sem2DocRes.rows[0].id]);

    const totalStudentsAfterSem2 = await db.query(`SELECT COUNT(*) FROM public.students WHERE lrn = '123456789999';`);
    assert.strictEqual(Number(totalStudentsAfterSem2.rows[0].count), 1, "Semester 2 must reuse existing student record");

    // Both Sem 1 and Sem 2 grades belong to the exact same student
    const allStudentGrades = await db.query(`SELECT subject, semester FROM public.subject_grades WHERE student_id = $1 ORDER BY semester ASC;`, [createdStudentId]);
    assert.strictEqual(allStudentGrades.rows.length, 2);
  });

  // ===========================================================================
  // ISSUE 2: SUBJECT GRADE UNIQUENESS
  // ===========================================================================
  await t.test("Issue 2: Subject grade composite uniqueness is verified in PostgreSQL catalog & prevents duplicates", async () => {
    // Verify in pg_index that idx_subject_grades_composite_active is a true unique index
    const indexCatalog = await db.query(`
      SELECT 
        i.relname AS index_name,
        idx.indisunique AS is_unique
      FROM pg_index idx
      JOIN pg_class i ON i.oid = idx.indexrelid
      WHERE i.relname = 'idx_subject_grades_composite_active';
    `);

    assert.strictEqual(indexCatalog.rows.length, 1);
    assert.strictEqual(indexCatalog.rows[0].is_unique, true, "Index MUST be verified as unique in PostgreSQL catalog");

    // Attempt to insert duplicate active subject grade (student_id, school_year, semester, subject)
    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.subject_grades (
          student_id, school_year, semester, subject, q1, q2, final_grade
        ) VALUES (
          $1, '2024-2025', '1st Semester', 'Earth and Life Science', 99, 99, 99
        );
      `, [createdStudentId]);
    }, /unique|idx_subject_grades_composite_active/i);
  });

  // ===========================================================================
  // ISSUE 3: VERIFIED GRADE PRESERVATION & REVERSAL AUDIT
  // ===========================================================================
  await t.test("Issue 3: Reversing/unapproving documents preserves verified grades and accurately audits reversals", async () => {
    // Setup Student 2
    const st2Res = await db.query(`
      INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
      VALUES ('${schoolA}', '555555555555', 'BASILIO', 'VALENTIN', 'Grade 11')
      RETURNING id;
    `);
    const student2Id = st2Res.rows[0].id;

    // Step 1: Approve Document 1 (Oral Communication: Q1 = 78, Q2 = 80, Final = 79)
    const doc1Fields = {
      school_year: "2024-2025",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", q1: 78, q2: 80, final: 79, status: "Passed", semester: "1st Semester" }
      ]
    };

    const doc1Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status
      ) VALUES ($1, '${schoolA}', 'sf9', 'valentin-doc1.jpg', '2024-2025', '1st Semester', $2, 'needs_review')
      RETURNING id;
    `, [student2Id, JSON.stringify(doc1Fields)]);
    const doc1Id = doc1Res.rows[0].id;

    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc1Id]);

    const grades1 = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication';`, [student2Id]);
    assert.strictEqual(Number(grades1.rows[0].q1), 78);
    assert.strictEqual(Number(grades1.rows[0].final_grade), 79);
    assert.strictEqual(grades1.rows[0].document_id, doc1Id);

    // Step 2: Approve Document 2 correcting Oral Communication Q1 to 83 (Final -> 82)
    const doc2Fields = {
      school_year: "2024-2025",
      semester: "1st Semester",
      grades: [
        { subject: "Oral Communication", q1: 83, q2: 80, status: "Passed", semester: "1st Semester" }
      ]
    };

    const doc2Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status
      ) VALUES ($1, '${schoolA}', 'sf9', 'valentin-doc2-corrected.jpg', '2024-2025', '1st Semester', $2, 'needs_review')
      RETURNING id;
    `, [student2Id, JSON.stringify(doc2Fields)]);
    const doc2Id = doc2Res.rows[0].id;

    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc2Id]);

    // Active grade is updated to 83, Final 82, document_id = doc2Id
    const grades2 = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication';`, [student2Id]);
    assert.strictEqual(Number(grades2.rows[0].q1), 83);
    assert.strictEqual(Number(grades2.rows[0].final_grade), 82);
    assert.strictEqual(grades2.rows[0].document_id, doc2Id);

    // Correction history is logged
    const hist2 = await db.query(`SELECT quarter, previous_value, new_value FROM public.grade_change_history WHERE student_id = $1 ORDER BY quarter ASC;`, [student2Id]);
    assert.strictEqual(hist2.rows.length, 2);
    assert.strictEqual(hist2.rows[0].quarter, "final_grade");
    assert.strictEqual(Number(hist2.rows[0].previous_value), 79);
    assert.strictEqual(Number(hist2.rows[0].new_value), 82);
    assert.strictEqual(hist2.rows[1].quarter, "q1");
    assert.strictEqual(Number(hist2.rows[1].previous_value), 78);
    assert.strictEqual(Number(hist2.rows[1].new_value), 83);

    // Step 3: Reject Document 2 (the correcting document) while Document 1 remains approved
    // Active grade must legitimately revert back to Document 1's values (78), with reversal logged in history
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = $1;`, [doc2Id]);

    const gradesAfterDoc2Reject = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication';`, [student2Id]);
    assert.strictEqual(gradesAfterDoc2Reject.rows.length, 1);
    assert.strictEqual(Number(gradesAfterDoc2Reject.rows[0].q1), 78, "Active grade must revert to remaining approved Document 1 (78)");
    assert.strictEqual(Number(gradesAfterDoc2Reject.rows[0].final_grade), 79);
    assert.strictEqual(gradesAfterDoc2Reject.rows[0].document_id, doc1Id);

    // Verify reversal was audited in grade_change_history
    const historyAfterReversal = await db.query(`
      SELECT quarter, previous_value, new_value, reason
      FROM public.grade_change_history
      WHERE student_id = $1
      ORDER BY id ASC;
    `, [student2Id]);

    // 4 entries: Q1 78->83, Final 79->82, Q1 83->78 (reversal), Final 82->79 (reversal)
    assert.strictEqual(historyAfterReversal.rows.length, 4);

    const reversals = historyAfterReversal.rows.filter(h => h.reason.includes("reverted"));
    assert.strictEqual(reversals.length, 2);
    const q1Rev = reversals.find(h => h.quarter === "q1");
    const finalRev = reversals.find(h => h.quarter === "final_grade");
    assert.strictEqual(Number(q1Rev.previous_value), 83);
    assert.strictEqual(Number(q1Rev.new_value), 78);
    assert.strictEqual(Number(finalRev.previous_value), 82);
    assert.strictEqual(Number(finalRev.new_value), 79);

    // Step 4: Re-approve Document 2 (restoring corrected grade 83), then reject Document 1 (the older document)
    // Document 2 is STILL APPROVED and verified. Rejection of Document 1 must NOT touch Document 2's grades!
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc2Id]);
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = $1;`, [doc1Id]);

    const gradesAfterDoc1Reject = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication';`, [student2Id]);
    assert.strictEqual(gradesAfterDoc1Reject.rows.length, 1);
    assert.strictEqual(Number(gradesAfterDoc1Reject.rows[0].q1), 83, "Active grade MUST remain 83 from approved Document 2");
    assert.strictEqual(Number(gradesAfterDoc1Reject.rows[0].final_grade), 82);
    assert.strictEqual(gradesAfterDoc1Reject.rows[0].document_id, doc2Id);
  });
});

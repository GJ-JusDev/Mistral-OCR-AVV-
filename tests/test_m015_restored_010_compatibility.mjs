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

  // Create roles
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
      division TEXT,
      region TEXT,
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

  // Apply Migration 015
  const m015Sql = fs.readFileSync(path.join(rootDir, "supabase", "migrations", "015_lrn_deduplication_and_grade_updates.sql"), "utf8");
  await db.exec(m015Sql);

  return db;
}

test("Migration 015: Restored Migration 010 Compatibility & Regression Prevention Suite", async (t) => {
  const db = await setupDatabase();

  const schoolA = "a0000000-0000-0000-0000-000000000001";
  const schoolB = "b0000000-0000-0000-0000-000000000002";

  const adminId = "10000000-0000-0000-0000-000000000001";
  const teacherAId = "20000000-0000-0000-0000-000000000001";
  const pendingTeacherAId = "20000000-0000-0000-0000-000000000002";
  const declinedTeacherAId = "20000000-0000-0000-0000-000000000003";
  const principalAId = "30000000-0000-0000-0000-000000000001";
  const pendingPrincipalAId = "30000000-0000-0000-0000-000000000002";
  const teacherBId = "40000000-0000-0000-0000-000000000001";

  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES
      ('${schoolA}', '500169', 'Taysan Resettlement Integrated School'),
      ('${schoolB}', '300793', 'Alternative High School');

    INSERT INTO auth.users (id, email) VALUES
      ('${adminId}', 'admin@deped.gov.ph'),
      ('${teacherAId}', 'teacherA@deped.gov.ph'),
      ('${pendingTeacherAId}', 'pendingA@deped.gov.ph'),
      ('${declinedTeacherAId}', 'declinedA@deped.gov.ph'),
      ('${principalAId}', 'principalA@deped.gov.ph'),
      ('${pendingPrincipalAId}', 'pendingPrincipalA@deped.gov.ph'),
      ('${teacherBId}', 'teacherB@deped.gov.ph');

    INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES
      ('${adminId}', 'admin', 'Approved', '${schoolA}'),
      ('${teacherAId}', 'teacher', 'Approved', '${schoolA}'),
      ('${pendingTeacherAId}', 'teacher', 'Pending', '${schoolA}'),
      ('${declinedTeacherAId}', 'teacher', 'Declined', '${schoolA}'),
      ('${principalAId}', 'principal', 'Approved', '${schoolA}'),
      ('${pendingPrincipalAId}', 'principal', 'Pending', '${schoolA}'),
      ('${teacherBId}', 'teacher', 'Approved', '${schoolB}');
  `);

  function setAuth(userId, role = "authenticated") {
    if (role === "anon") {
      return db.exec(`
        SET ROLE anon;
        SELECT set_config('request.jwt.claim.sub', '', false);
        SELECT set_config('request.jwt.claim.role', 'anon', false);
      `);
    }
    return db.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${userId}', false);
      SELECT set_config('request.jwt.claim.role', '${role}', false);
    `);
  }

  // ---------------------------------------------------------------------------
  // Check 1: Compatibility with original Migration 010 (lowercase 'approved' & extracted_fields.grades)
  // ---------------------------------------------------------------------------
  let student1Id;
  await t.test("Directive 1: Full compatibility with lowercase 'approved' status and extracted_fields.grades", async () => {
    await setAuth(adminId);

    const stRes = await db.query(`
      INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
      VALUES ('${schoolA}', '123456789012', 'JUAN', 'DELA CRUZ', 'Grade 11')
      RETURNING id;
    `);
    student1Id = stRes.rows[0].id;

    // Real Migration 010 payload format with extracted_fields.grades & full SHS metadata
    const doc1Fields = {
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      curriculum_id: "SHS_STRENGTHENED_2026",
      source_form_version: "SSHSSF102026",
      grading_policy_version: "DO_015_2026",
      grading_period_scheme: "two_semester",
      general_average: 84.5,
      grades: [
        {
          subject: "Oral Communication",
          q1: 80,
          q2: 82,
          final: 81,
          status: "Passed",
          semester: "1st Semester",
          subject_track: "Academic",
          subject_category: "Core",
          subject_code: "ENG101",
          units: 4,
          needsVerification: false
        },
        {
          subject: "General Mathematics",
          q1: 85,
          q2: 87,
          final: 86,
          status: "Passed",
          semester: "1st Semester",
          subject_track: "Academic",
          subject_category: "Core",
          units: 4,
          needsVerification: false
        }
      ]
    };

    const doc1Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, grade_level, semester,
        curriculum_id, source_form_version, grading_policy_version, grading_period_scheme, general_average_printed,
        extracted_fields, status, uploaded_by, reviewed_by
      ) VALUES (
        $1, $2, 'sf9', 'uploaded-doc-1.jpg', $3, $4, $5, $6, $7, $8, $9, $10, $11, 'needs_review', 'teacher-1', $12
      ) RETURNING id;
    `, [
      student1Id, schoolA, doc1Fields.school_year, doc1Fields.grade_level, doc1Fields.semester,
      doc1Fields.curriculum_id, doc1Fields.source_form_version, doc1Fields.grading_policy_version,
      doc1Fields.grading_period_scheme, doc1Fields.general_average, JSON.stringify(doc1Fields), adminId
    ]);

    const doc1Id = doc1Res.rows[0].id;

    // Approve using lowercase 'approved' (as in 010 and review.ts)
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [doc1Id]);

    // Verify subject grades created with full SHS metadata
    const grades = await db.query(`
      SELECT * FROM public.subject_grades WHERE student_id = $1 ORDER BY subject ASC;
    `, [student1Id]);

    assert.strictEqual(grades.rows.length, 2);
    assert.strictEqual(grades.rows[0].subject, "General Mathematics");
    assert.strictEqual(Number(grades.rows[0].final_grade), 86);
    assert.strictEqual(grades.rows[0].curriculum_id, "SHS_STRENGTHENED_2026");
    assert.strictEqual(grades.rows[0].source_form_version, "SSHSSF102026");
    assert.strictEqual(grades.rows[0].grading_policy_version, "DO_015_2026");

    assert.strictEqual(grades.rows[1].subject, "Oral Communication");
    assert.strictEqual(Number(grades.rows[1].q1), 80);
    assert.strictEqual(Number(grades.rows[1].q2), 82);
    assert.strictEqual(Number(grades.rows[1].final_grade), 81);
    assert.strictEqual(grades.rows[1].subject_track, "Academic");
    assert.strictEqual(grades.rows[1].subject_code, "ENG101");
    assert.strictEqual(Number(grades.rows[1].units), 4);

    // Verify student overall_status updated to Passed
    const student = await db.query(`SELECT overall_status FROM public.students WHERE id = $1;`, [student1Id]);
    assert.strictEqual(student.rows[0].overall_status, "Passed");
  });

  // ---------------------------------------------------------------------------
  // Check 2: Safe, Non-Recursive Student Linking Trigger
  // ---------------------------------------------------------------------------
  await t.test("Directive 2: Student linking happens via safe BEFORE trigger without recursive document update", async () => {
    await setAuth(adminId);

    // Staging document without student_id
    const docNoStudentRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status,
        extracted_fields
      ) VALUES (
        NULL, '${schoolA}', 'sf9', 'staged-no-student.jpg', 'needs_review',
        '{"student":{"lrn":"1234-5678-9012","first_name":"JUAN","last_name":"DELA CRUZ"}}'::jsonb
      ) RETURNING id, student_id;
    `);

    const docId = docNoStudentRes.rows[0].id;
    // BEFORE trigger automatically resolves and links the student ID on INSERT
    assert.strictEqual(docNoStudentRes.rows[0].student_id, student1Id);

    // Updating status = 'approved' does NOT cause recursive UPDATE
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [docId]);

    // Verify student_id remains linked cleanly on document
    const linkedDoc = await db.query(`SELECT student_id FROM public.documents WHERE id = $1;`, [docId]);
    assert.strictEqual(linkedDoc.rows[0].student_id, student1Id);
  });

  // ---------------------------------------------------------------------------
  // Check 3: NULL OCR fields must NEVER be interpreted as grade corrections
  // ---------------------------------------------------------------------------
  await t.test("Directive 3: NULL OCR fields do NOT overwrite active grades and do NOT create history", async () => {
    await setAuth(adminId);

    // Re-scan where Q1 is blank/NULL in the form, but Q2 is still 82
    const docNullQ1Fields = {
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      grades: [
        {
          subject: "Oral Communication",
          q1: null, // OCR did not see Q1
          q2: 82,
          final: 81,
          status: "Passed",
          semester: "1st Semester"
        }
      ]
    };

    const docRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status, reviewed_by
      ) VALUES (
        $1, '${schoolA}', 'sf9', 'rescan-null-q1.jpg', '2024-2025', '1st Semester',
        $2, 'needs_review', '${adminId}'
      ) RETURNING id;
    `, [student1Id, JSON.stringify(docNullQ1Fields)]);

    // Approve the rescan
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [docRes.rows[0].id]);

    // Active Q1 must STILL be 80 (not NULL!)
    const active = await db.query(`
      SELECT q1, q2, final_grade FROM public.subject_grades
      WHERE student_id = $1 AND subject = 'Oral Communication';
    `, [student1Id]);
    assert.strictEqual(Number(active.rows[0].q1), 80, "Active Q1 must NOT be overwritten by NULL OCR field");

    // History must have ZERO entries for Oral Communication
    const history = await db.query(`
      SELECT * FROM public.grade_change_history WHERE student_id = $1 AND subject = 'Oral Communication';
    `, [student1Id]);
    assert.strictEqual(history.rows.length, 0, "NULL OCR field must NOT create phantom grade change history");

    // Now submit an actual non-NULL reviewed grade correction: Q1 corrected from 80 -> 88
    const docCorrectionFields = {
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      grades: [
        {
          subject: "Oral Communication",
          q1: 88, // Actual non-null change!
          q2: 82,
          status: "Passed",
          semester: "1st Semester"
        }
      ]
    };

    const docCorrRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status, reviewed_by
      ) VALUES (
        $1, '${schoolA}', 'sf9', 'correction-q1.jpg', '2024-2025', '1st Semester',
        $2, 'needs_review', '${adminId}'
      ) RETURNING id;
    `, [student1Id, JSON.stringify(docCorrectionFields)]);

    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [docCorrRes.rows[0].id]);

    // Active Q1 must now be 88, and final_grade must be recalculated to ROUND((88+82)/2) = 85
    const updated = await db.query(`
      SELECT q1, q2, final_grade FROM public.subject_grades
      WHERE student_id = $1 AND subject = 'Oral Communication';
    `, [student1Id]);
    assert.strictEqual(Number(updated.rows[0].q1), 88);
    assert.strictEqual(Number(updated.rows[0].final_grade), 85);

    // Grade change history must have recorded Q1 80 -> 88 AND final_grade 81 -> 85
    const corHist = await db.query(`
      SELECT quarter, previous_value, new_value, reason
      FROM public.grade_change_history
      WHERE student_id = $1 AND subject = 'Oral Communication'
      ORDER BY quarter ASC;
    `, [student1Id]);
    assert.strictEqual(corHist.rows.length, 2);
    assert.strictEqual(corHist.rows[0].quarter, "final_grade");
    assert.strictEqual(Number(corHist.rows[0].previous_value), 81);
    assert.strictEqual(Number(corHist.rows[0].new_value), 85);
    assert.strictEqual(corHist.rows[1].quarter, "q1");
    assert.strictEqual(Number(corHist.rows[1].previous_value), 80);
    assert.strictEqual(Number(corHist.rows[1].new_value), 88);
  });

  // ---------------------------------------------------------------------------
  // Check 4: Database-Enforced Unique Composite Index for Active Subject Grades
  // ---------------------------------------------------------------------------
  await t.test("Directive 4: Unique composite index prevents duplicate active subject grades", async () => {
    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.subject_grades (
          student_id, school_year, semester, subject, q1, q2, final_grade
        ) VALUES (
          '${student1Id}', '2024-2025', '1st Semester', 'Oral Communication', 90, 90, 90
        );
      `);
    }, /idx_subject_grades_composite_active|unique/i);
  });

  // ---------------------------------------------------------------------------
  // Check 5: Preserve Migration 010 SHS Chronological Dominance & Academic Standing
  // ---------------------------------------------------------------------------
  await t.test("Directive 5: Older historical documents are safely marked as archived without overwriting standing", async () => {
    await setAuth(adminId);

    // Approve an older school year document (2023-2024 Grade 10)
    const oldDocFields = {
      school_year: "2023-2024",
      grade_level: "Grade 10",
      semester: "1st Semester",
      grades: [
        { subject: "English 10", q1: 65, q2: 65, final: 65, status: "Failed", semester: "1st Semester" }
      ]
    };

    const oldDocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, grade_level, semester,
        extracted_fields, status, reviewed_by
      ) VALUES (
        $1, '${schoolA}', 'sf10', 'older-doc.jpg', '2023-2024', 'Grade 10', '1st Semester',
        $2, 'needs_review', '${adminId}'
      ) RETURNING id;
    `, [student1Id, JSON.stringify(oldDocFields)]);

    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [oldDocRes.rows[0].id]);

    // Student's overall status must REMAIN 'Passed' from 2024-2025 document (not overwritten to Needs Verification by 2023-2024 failing doc!)
    const st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1;`, [student1Id]);
    assert.strictEqual(st.rows[0].overall_status, "Passed");

    // History in academic_standing_history must record preserved standing
    const standingHist = await db.query(`
      SELECT * FROM public.academic_standing_history
      WHERE student_id = $1 AND document_id = $2;
    `, [student1Id, oldDocRes.rows[0].id]);
    assert.strictEqual(standingHist.rows.length, 1);
    assert.ok(standingHist.rows[0].confirmation_notes.includes("Archived document processed"));
  });

  // ---------------------------------------------------------------------------
  // Check 6: Multi-Role Authorization & RLS for grade_change_history
  // ---------------------------------------------------------------------------
  await t.test("Directive 6: grade_change_history RLS excludes Pending, Declined, and cross-school users", async () => {
    // 6.1 Approved Teacher (School A) can read School A student's grade change history
    await setAuth(teacherAId);
    const tA = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = '${student1Id}';`);
    assert.ok(tA.rows.length > 0, "Approved teacher A must read School A student history");

    // 6.2 Pending Teacher (School A) is denied (0 rows)
    await setAuth(pendingTeacherAId);
    const pendT = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = '${student1Id}';`);
    assert.strictEqual(pendT.rows.length, 0, "Pending teacher must be denied (0 rows)");

    // 6.3 Declined Teacher (School A) is denied (0 rows)
    await setAuth(declinedTeacherAId);
    const decT = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = '${student1Id}';`);
    assert.strictEqual(decT.rows.length, 0, "Declined teacher must be denied (0 rows)");

    // 6.4 Pending Principal (School A) is denied (0 rows)
    await setAuth(pendingPrincipalAId);
    const pendP = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = '${student1Id}';`);
    assert.strictEqual(pendP.rows.length, 0, "Pending principal must be denied (0 rows)");

    // 6.5 Approved Principal (School A) can read School A history
    await setAuth(principalAId);
    const prinA = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = '${student1Id}';`);
    assert.ok(prinA.rows.length > 0, "Approved principal A must read School A student history");

    // 6.6 Approved Teacher (School B) CANNOT read School A history (0 rows)
    await setAuth(teacherBId);
    const tB = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = '${student1Id}';`);
    assert.strictEqual(tB.rows.length, 0, "Cross-school teacher must be denied (0 rows)");

    // 6.7 Anonymous is denied (0 rows)
    await setAuth(null, "anon");
    const anonRes = await db.query(`SELECT * FROM public.grade_change_history;`);
    assert.strictEqual(anonRes.rows.length, 0, "Anon visitor must be denied (0 rows)");

    // 6.8 System Admin can read history across schools
    await setAuth(adminId);
    const adm = await db.query(`SELECT * FROM public.grade_change_history WHERE student_id = '${student1Id}';`);
    assert.ok(adm.rows.length > 0, "Admin must have full access");
  });

  // ---------------------------------------------------------------------------
  // Check 7: LRN Normalization & New-Grade DepEd DO 8 Recalculation
  // ---------------------------------------------------------------------------
  await t.test("Directive 7: LRN normalization and new-grade DepEd DO 8 recalculations work cleanly", async () => {
    await setAuth(adminId);

    // Formatted LRN is automatically normalized by trigger
    const newSt = await db.query(`
      INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
      VALUES ('${schoolA}', ' 2345-6789-0123 ', 'MARIA', 'SANTOS', 'Grade 11')
      RETURNING id, lrn;
    `);
    assert.strictEqual(newSt.rows[0].lrn, "234567890123");

    // Adding Semester 1 with complete quarters (Q1=85, Q2=87) but missing final grade
    const newDocFields = {
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      grades: [
        { subject: "Physical Science", q1: 85, q2: 87, final: null, semester: "1st Semester" },
        { subject: "Disaster Readiness", q1: 80, q2: null, final: null, semester: "1st Semester" }
      ]
    };

    const docNewRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, school_year, semester,
        extracted_fields, status, reviewed_by
      ) VALUES (
        $1, '${schoolA}', 'sf9', 'new-grades-doc.jpg', '2024-2025', '1st Semester',
        $2, 'needs_review', '${adminId}'
      ) RETURNING id;
    `, [newSt.rows[0].id, JSON.stringify(newDocFields)]);

    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [docNewRes.rows[0].id]);

    const newGrades = await db.query(`
      SELECT subject, q1, q2, final_grade, status, needs_verification
      FROM public.subject_grades WHERE student_id = $1 ORDER BY subject ASC;
    `, [newSt.rows[0].id]);

    // Disaster Readiness (incomplete quarter Q2 missing): final remains NULL, status Missing, needs_verification true (NEVER Failed!)
    assert.strictEqual(newGrades.rows[0].subject, "Disaster Readiness");
    assert.strictEqual(newGrades.rows[0].final_grade, null);
    assert.strictEqual(newGrades.rows[0].status, "Missing");
    assert.strictEqual(newGrades.rows[0].needs_verification, true);

    // Physical Science (complete quarters): final auto-computed to 86, status Passed
    assert.strictEqual(newGrades.rows[1].subject, "Physical Science");
    assert.strictEqual(Number(newGrades.rows[1].final_grade), 86);
    assert.strictEqual(newGrades.rows[1].status, "Passed");
    assert.strictEqual(newGrades.rows[1].needs_verification, false);
  });
});

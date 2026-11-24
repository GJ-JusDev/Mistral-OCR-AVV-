import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import {
  buildAssignmentConfirmationMessage,
  categorizeTeacherAssignments,
  evaluateTeacherScanAuthorization,
  validateSubjectTeacherGradeEdits,
} from "../src/lib/teacher/assignments.ts";
import {
  authorizeTeacherDocumentEdit,
  evaluateOcrRouteAuthorization,
} from "../src/lib/teacher/serverAuth.ts";
import {
  compareDocumentContextWithAssignment,
  evaluateTwoSidedSf9Identity,
} from "../src/lib/teacher/sectionScanner.ts";
import {
  evaluateStudentIdentity,
  matchStudentIdentityMatrix,
} from "../src/lib/validation/studentMatcher.ts";
import { mergeAcademicGrades } from "../src/lib/validation/gradeMerger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const MIGRATION_022_PATH = path.join(
  rootDir,
  "supabase",
  "migrations",
  "022_teacher_assignments_and_section_scanning.sql"
);
const ROLLBACK_022_PATH = path.join(
  rootDir,
  "supabase",
  "rollbacks",
  "022_rollback_recovery.sql"
);

const SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";
const ADMIN_ID = "10000000-0000-0000-0000-000000000001";
const PRINCIPAL_ID = "20000000-0000-0000-0000-000000000002";
const ADVISER_A_ID = "30000000-0000-0000-0000-000000000003";
const SUBJECT_TEACHER_ID = "40000000-0000-0000-0000-000000000004";
const UNASSIGNED_TEACHER_ID = "50000000-0000-0000-0000-000000000005";
const ADVISER_B_ID = "60000000-0000-0000-0000-000000000006";

async function bootstrapPGliteWithMigration022() {
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.role', true), ''),
        NULLIF(current_setting('role', true), '')
      );
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION public.normalize_student_lrn()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.lrn IS NOT NULL THEN
        NEW.lrn := REGEXP_REPLACE(REGEXP_REPLACE(TRIM(NEW.lrn), '^[Ll][Rr][Nn][:\s\-]*', ''), '[\s\-–—\.]', '', 'g');
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION public.normalize_shs_grade_level(raw_grade TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
    DECLARE
      cleaned TEXT := LOWER(BTRIM(COALESCE(raw_grade, '')));
    BEGIN
      IF cleaned = '' THEN RETURN NULL; END IF;
      IF cleaned IN ('11', 'g11', 'grade 11', 'gr. 11') OR cleaned LIKE '%grade 11%' THEN
        RETURN 'Grade 11';
      ELSIF cleaned IN ('12', 'g12', 'grade 12', 'gr. 12') OR cleaned LIKE '%grade 12%' THEN
        RETURN 'Grade 12';
      END IF;
      RETURN BTRIM(raw_grade);
    END;
    $$;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY,
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('teacher', 'admin', 'principal')),
      account_status TEXT NOT NULL DEFAULT 'Approved',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, school_id)
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      suffix TEXT,
      grade_level TEXT,
      sex TEXT,
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
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      canonical_lrn TEXT,
      file_hash TEXT,
      last_operation_id UUID,
      extracted_fields JSONB DEFAULT '{}'::JSONB,
      status TEXT NOT NULL DEFAULT 'needs_review',
      uploaded_by TEXT,
      reviewed_by UUID,
      archived_at TIMESTAMPTZ,
      archived_by UUID,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    -- Preserve exact final M021 canonical uniqueness constraints (never forked by section/strand)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_canonical_sf9_active
      ON public.documents (school_id, canonical_lrn, document_type, school_year, grade_level)
      WHERE status NOT IN ('archived', 'rejected')
        AND document_type = 'sf9'
        AND canonical_lrn IS NOT NULL
        AND school_year IS NOT NULL
        AND grade_level IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_canonical_sf9_student_active
      ON public.documents (school_id, student_id, document_type, school_year, grade_level)
      WHERE status NOT IN ('archived', 'rejected')
        AND document_type = 'sf9'
        AND student_id IS NOT NULL
        AND school_year IS NOT NULL
        AND grade_level IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_canonical_sf10_active
      ON public.documents (school_id, canonical_lrn, document_type)
      WHERE status NOT IN ('archived', 'rejected')
        AND document_type = 'sf10'
        AND canonical_lrn IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_unresolved_file_hash_active
      ON public.documents (school_id, document_type, file_hash)
      WHERE status NOT IN ('archived', 'rejected')
        AND file_hash IS NOT NULL;

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC,
      q2 NUMERIC,
      q3 NUMERIC,
      q4 NUMERIC,
      final_grade NUMERIC,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.document_scans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      scan_version INTEGER NOT NULL DEFAULT 1,
      file_path TEXT,
      file_hash TEXT,
      image_url TEXT NOT NULL,
      back_image_url TEXT,
      original_filename TEXT,
      detected_quarters TEXT[],
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'admin' AND account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'principal' AND account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'teacher' AND account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.subject_grades ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.document_scans ENABLE ROW LEVEL SECURITY;

    -- Baseline policies that Migration 022 replaces cleanly
    CREATE POLICY "Authorized read documents" ON public.documents FOR SELECT TO authenticated USING (true);
    CREATE POLICY "Authorized insert documents" ON public.documents FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY "Authorized update documents" ON public.documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY "Authorized read students" ON public.students FOR SELECT TO authenticated USING (true);
    CREATE POLICY "Authorized insert students" ON public.students FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY "Authorized update students" ON public.students FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

    INSERT INTO public.schools (id, school_id, name)
    VALUES ('${SCHOOL_ID}', '500169', 'Taysan Resettlement Integrated School');

    INSERT INTO auth.users (id, email) VALUES
      ('${ADMIN_ID}', 'admin@tris.edu.ph'),
      ('${PRINCIPAL_ID}', 'principal@tris.edu.ph'),
      ('${ADVISER_A_ID}', 'adviser.a@tris.edu.ph'),
      ('${SUBJECT_TEACHER_ID}', 'subject.t@tris.edu.ph'),
      ('${UNASSIGNED_TEACHER_ID}', 'unassigned@tris.edu.ph'),
      ('${ADVISER_B_ID}', 'adviser.b@tris.edu.ph');

    INSERT INTO public.user_roles (user_id, school_id, role, account_status) VALUES
      ('${ADMIN_ID}', '${SCHOOL_ID}', 'admin', 'Approved'),
      ('${PRINCIPAL_ID}', '${SCHOOL_ID}', 'principal', 'Approved'),
      ('${ADVISER_A_ID}', '${SCHOOL_ID}', 'teacher', 'Approved'),
      ('${SUBJECT_TEACHER_ID}', '${SCHOOL_ID}', 'teacher', 'Approved'),
      ('${UNASSIGNED_TEACHER_ID}', '${SCHOOL_ID}', 'teacher', 'Approved'),
      ('${ADVISER_B_ID}', '${SCHOOL_ID}', 'teacher', 'Approved');
  `);

  // Apply Migration 022 verbatim against real PostgreSQL engine
  const m022Sql = fs.readFileSync(MIGRATION_022_PATH, "utf8");
  await db.exec(m022Sql);

  // Grant schema/table access to authenticated role so SET LOCAL ROLE authenticated exercises RLS
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
  `);

  return db;
}

async function asUser(db, userId, fn) {
  await db.exec("BEGIN;");
  try {
    await db.exec("SET LOCAL ROLE authenticated;");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true);", [userId]);
    await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true);");
    const res = await fn();
    await db.exec("COMMIT;");
    return res;
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  }
}

test("AVV Teacher Module (Phases 1-7): Unit, Authorization, RLS, Conflict, & Concurrency Suite", async (t) => {
  const db = await bootstrapPGliteWithMigration022();

  let adviserRizalAssignmentId;
  let subjectMathRizalAssignmentId;
  let subjectScienceRizalAssignmentId;
  let multiSectionAdviserBonifacioId;
  let inactiveAssignmentId;
  let adviserMabiniAssignmentId;

  await t.test("Phase 1 setup & Scenario 1: Admin creates assignments; teacher self-assignment blocked; one advisory class", async () => {
    // Teacher cannot self-assign (blocked by trigger and/or PostgreSQL RLS)
    await assert.rejects(
      asUser(db, UNASSIGNED_TEACHER_ID, async () => {
        await db.query(
          `INSERT INTO public.teacher_assignments (teacher_user_id, school_id, school_year, grade_level, section, strand_or_track, assignment_type, assignment_status)
           VALUES ($1, $2, '2026-2027', 'Grade 11', 'Rizal', 'STEM', 'class_adviser', 'active')`,
          [UNASSIGNED_TEACHER_ID, SCHOOL_ID]
        );
      }),
      /Only administrators|row-level security policy/i
    );

    // Admin creates canonical assignments
    const { rows } = await asUser(db, ADMIN_ID, async () => {
      return await db.query(
        `INSERT INTO public.teacher_assignments (teacher_user_id, school_id, school_year, grade_level, section, strand_or_track, subject_taught, semester, assignment_type, assignment_status, created_by)
         VALUES
           ($1, $4, '2026-2027', 'Grade 11', 'Rizal', 'STEM', NULL, NULL, 'class_adviser', 'active', $5),
           ($2, $4, '2026-2027', 'Grade 11', 'Rizal', 'STEM', 'General Mathematics', '1st Semester', 'subject_teacher', 'active', $5),
           ($2, $4, '2026-2027', 'Grade 11', 'Rizal', 'STEM', 'Earth and Life Science', '1st Semester', 'subject_teacher', 'active', $5),
           ($1, $4, '2026-2027', 'Grade 12', 'Bonifacio', 'STEM', NULL, NULL, 'class_adviser', 'active', $5),
           ($2, $4, '2026-2027', 'Grade 11', 'Mabini', 'ABM', 'Business Math', '1st Semester', 'subject_teacher', 'inactive', $5),
           ($3, $4, '2026-2027', 'Grade 11', 'Mabini', 'ABM', NULL, NULL, 'class_adviser', 'active', $5)
         RETURNING id, teacher_user_id, grade_level, section, subject_taught, assignment_type, assignment_status`,
        [ADVISER_A_ID, SUBJECT_TEACHER_ID, ADVISER_B_ID, SCHOOL_ID, ADMIN_ID]
      );
    });

    adviserRizalAssignmentId = rows[0].id;
    subjectMathRizalAssignmentId = rows[1].id;
    subjectScienceRizalAssignmentId = rows[2].id;
    multiSectionAdviserBonifacioId = rows[3].id;
    inactiveAssignmentId = rows[4].id;
    adviserMabiniAssignmentId = rows[5].id;

    // Exact Phase 3 confirmation prompt
    const prompt = buildAssignmentConfirmationMessage({
      grade_level: "Grade 11",
      section: "Rizal",
      strand_or_track: "STEM",
      school_year: "2026-2027",
    });
    assert.equal(
      prompt,
      "You are about to scan academic records for Grade 11 — Rizal — STEM, School Year 2026-2027. Please confirm that the document belongs to this assigned class."
    );

    // Scenario 1: Single advisory class summary & DB RPC
    const oneAdvisory = categorizeTeacherAssignments([
      {
        id: adviserRizalAssignmentId,
        teacher_user_id: ADVISER_A_ID,
        school_id: SCHOOL_ID,
        school_year: "2026-2027",
        grade_level: "Grade 11",
        section: "Rizal",
        strand_or_track: "STEM",
        subject_taught: null,
        semester: null,
        assignment_type: "class_adviser",
        assignment_status: "active",
      },
    ]);
    assert.equal(oneAdvisory.advisoryClasses.length, 1);
    assert.equal(oneAdvisory.subjectAssignments.length, 0);
    assert.equal(oneAdvisory.assignedSections.length, 1);
    assert.equal(oneAdvisory.canScanAny, true);

    const dbAssigned = await asUser(db, ADVISER_B_ID, async () => {
      return await db.query("SELECT * FROM public.get_teacher_authorized_assignments()");
    });
    assert.equal(dbAssigned.rows.length, 1);
    assert.equal(dbAssigned.rows[0].section, "Mabini");
    assert.equal(dbAssigned.rows[0].assignment_type, "class_adviser");
  });

  await t.test("Scenario 2: Teacher with multiple subject assignments & permanent Class Adviser-only scanning lock", async () => {
    const dbSubj = await asUser(db, SUBJECT_TEACHER_ID, async () => {
      return await db.query("SELECT * FROM public.get_teacher_authorized_assignments()");
    });
    // Inactive Mabini assignment must NOT appear
    assert.equal(dbSubj.rows.length, 2);
    assert.deepEqual(
      dbSubj.rows.map((r) => r.subject_taught).sort(),
      ["Earth and Life Science", "General Mathematics"]
    );
    assert.equal(dbSubj.rows[0].allow_subject_teacher_scanning, false);

    // Even if a caller injects allow_subject_teacher_scanning: true, Subject Teachers must never gain scan permission
    const summary = categorizeTeacherAssignments(dbSubj.rows, {
      allow_subject_teacher_scanning: true,
    });
    assert.equal(summary.subjectAssignments.length, 2);
    assert.equal(summary.assignedSections.length, 1);
    assert.equal(summary.canScanAny, false);
    assert.equal(summary.allowSubjectTeacherScanning, false);

    const deniedAuth = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: SUBJECT_TEACHER_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: dbSubj.rows[0],
      policy: { allow_subject_teacher_scanning: false },
      assignmentConfirmed: true,
    });
    assert.equal(deniedAuth.allowed, false);
    assert.equal(deniedAuth.statusCode, 403);
    assert.equal(deniedAuth.code, "CLASS_ADVISER_REQUIRED");

    // Policy toggle attempt in application logic still strictly denies Subject Teachers
    const policyBypassAuth = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: SUBJECT_TEACHER_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: dbSubj.rows[0],
      policy: { allow_subject_teacher_scanning: true },
      assignmentConfirmed: true,
    });
    assert.equal(policyBypassAuth.allowed, false);
    assert.equal(policyBypassAuth.statusCode, 403);
    assert.equal(policyBypassAuth.code, "CLASS_ADVISER_REQUIRED");

    // Postgres CHECK + trigger must permanently block enabling allow_subject_teacher_scanning = TRUE
    await assert.rejects(
      asUser(db, ADMIN_ID, async () => {
        await db.query(
          `INSERT INTO public.teacher_module_policies (school_id, allow_subject_teacher_scanning, updated_by)
           VALUES ($1, TRUE, $2)
           ON CONFLICT (school_id) DO UPDATE SET allow_subject_teacher_scanning = TRUE, updated_by = EXCLUDED.updated_by`,
          [SCHOOL_ID, ADMIN_ID]
        );
      }),
      /permanently disabled|chk_teacher_module_policies_adviser_only/i
    );

    // Postgres RPC can_teacher_scan_with_assignment strictly allows active Class Advisers only
    const subjRpc = await asUser(db, SUBJECT_TEACHER_ID, async () => {
      return await db.query(
        `SELECT public.can_teacher_scan_with_assignment($1) AS allowed`,
        [subjectMathRizalAssignmentId]
      );
    });
    assert.equal(subjRpc.rows[0].allowed, false);

    const adviserRpc = await asUser(db, ADVISER_A_ID, async () => {
      return await db.query(
        `SELECT public.can_teacher_scan_with_assignment($1) AS allowed`,
        [adviserRizalAssignmentId]
      );
    });
    assert.equal(adviserRpc.rows[0].allowed, true);

    // Postgres RLS blocks Subject Teacher INSERT into documents even with their own active subject_teacher assignment ID
    await assert.rejects(
      asUser(db, SUBJECT_TEACHER_ID, async () => {
        await db.query(
          `INSERT INTO public.documents (
            school_id, document_type, image_url, school_year, grade_level, section, strand_or_track, teacher_assignment_id, status, uploaded_by
          ) VALUES (
            $1, 'sf9', 'https://local/subj_bypass.jpg', '2026-2027', 'Grade 11', 'Rizal', 'STEM', $2, 'needs_review', $3
          )`,
          [SCHOOL_ID, subjectMathRizalAssignmentId, SUBJECT_TEACHER_ID]
        );
      }),
      /row-level security policy/i
    );
  });

  await t.test("Scenario 3: Teacher assigned to multiple sections (Rizal & Bonifacio)", async () => {
    const dbAdviserA = await asUser(db, ADVISER_A_ID, async () => {
      return await db.query("SELECT * FROM public.get_teacher_authorized_assignments()");
    });
    assert.equal(dbAdviserA.rows.length, 2);

    const summary = categorizeTeacherAssignments(dbAdviserA.rows, {
      allow_subject_teacher_scanning: false,
    });
    assert.equal(summary.assignedSections.length, 2);
    assert.deepEqual(
      summary.assignedSections.map((s) => `${s.grade_level}:${s.section}`).sort(),
      ["Grade 11:Rizal", "Grade 12:Bonifacio"]
    );
  });

  await t.test("Scenario 4 & 5: Teacher with no active assignment & Unauthorized section scanning (app + Postgres RLS)", async () => {
    // Scenario 4: Unassigned teacher
    const emptyRows = await asUser(db, UNASSIGNED_TEACHER_ID, async () => {
      return await db.query("SELECT * FROM public.get_teacher_authorized_assignments()");
    });
    assert.equal(emptyRows.rows.length, 0);

    const noAssignmentAuth = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: UNASSIGNED_TEACHER_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null,
      policy: { allow_subject_teacher_scanning: false },
      assignmentConfirmed: true,
    });
    assert.equal(noAssignmentAuth.allowed, false);
    assert.equal(noAssignmentAuth.statusCode, 403);
    assert.equal(noAssignmentAuth.code, "ASSIGNMENT_REQUIRED");

    // Scenario 5a: Using another teacher's assignment ID
    const stolenAuth = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: ADVISER_A_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: {
        id: adviserMabiniAssignmentId,
        teacher_user_id: ADVISER_B_ID,
        school_id: SCHOOL_ID,
        school_year: "2026-2027",
        grade_level: "Grade 11",
        section: "Mabini",
        strand_or_track: "ABM",
        subject_taught: null,
        semester: null,
        assignment_type: "class_adviser",
        assignment_status: "active",
      },
      assignmentConfirmed: true,
    });
    assert.equal(stolenAuth.allowed, false);
    assert.equal(stolenAuth.statusCode, 403);
    assert.equal(stolenAuth.code, "ASSIGNMENT_NOT_OWNED");

    // Scenario 5b: Inactive assignment rejected
    const inactiveAuth = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: SUBJECT_TEACHER_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: {
        id: inactiveAssignmentId,
        teacher_user_id: SUBJECT_TEACHER_ID,
        school_id: SCHOOL_ID,
        school_year: "2026-2027",
        grade_level: "Grade 11",
        section: "Mabini",
        strand_or_track: "ABM",
        subject_taught: "Business Math",
        semester: "1st Semester",
        assignment_type: "subject_teacher",
        assignment_status: "inactive",
      },
      policy: { allow_subject_teacher_scanning: true },
      assignmentConfirmed: true,
    });
    assert.equal(inactiveAuth.allowed, false);
    assert.equal(inactiveAuth.statusCode, 403);
    assert.equal(inactiveAuth.code, "ASSIGNMENT_INACTIVE");

    // Scenario 5c: Real PostgreSQL RLS rejects unauthorized document insert with stolen/unassigned section
    await assert.rejects(
      asUser(db, ADVISER_A_ID, async () => {
        await db.query(
          `INSERT INTO public.documents (school_id, document_type, image_url, school_year, grade_level, section, strand_or_track, teacher_assignment_id, status, uploaded_by)
           VALUES ($1, 'sf9', 'https://local/unauth.jpg', '2026-2027', 'Grade 11', 'Mabini', 'ABM', $2, 'needs_review', $3)`,
          [SCHOOL_ID, adviserMabiniAssignmentId, ADVISER_A_ID]
        );
      }),
      /row-level security policy/i
    );

    // Unassigned teacher cannot insert documents either
    await assert.rejects(
      asUser(db, UNASSIGNED_TEACHER_ID, async () => {
        await db.query(
          `INSERT INTO public.documents (school_id, document_type, image_url, school_year, grade_level, section, status, uploaded_by)
           VALUES ($1, 'sf9', 'https://local/unauth2.jpg', '2026-2027', 'Grade 11', 'Rizal', 'needs_review', $2)`,
          [SCHOOL_ID, UNASSIGNED_TEACHER_ID]
        );
      }),
      /row-level security policy/i
    );
  });

  await t.test("Scenario 6: Wrong strand or grade level detected against confirmed assignment", async () => {
    const cmp = compareDocumentContextWithAssignment({
      assignment: {
        school_year: "2026-2027",
        grade_level: "Grade 11",
        section: "Rizal",
        strand_or_track: "STEM",
      },
      documentType: "sf9",
      extractedFields: {
        school_year: "2026-2027",
        grade_level: "Grade 12",
        section: "Mabini",
        strand: "Accountancy, Business and Management (ABM)",
      },
    });

    assert.equal(cmp.matchesAssignment, false);
    assert.ok(cmp.conflictTypes.includes("GRADE_LEVEL_MISMATCH"));
    assert.ok(cmp.conflictTypes.includes("SECTION_MISMATCH"));
    assert.ok(cmp.conflictTypes.includes("STRAND_MISMATCH"));
    assert.ok(cmp.flags.includes("assignment_grade_level_mismatch"));
    assert.ok(cmp.flags.includes("assignment_strand_mismatch"));
  });

  let canonicalStudentId;

  await t.test("Scenario 7, 9, 10, & 11: Canonical identity matching, same LRN+name, same LRN+conflict name, diff LRN+same name", async () => {
    // Seed canonical student Juan Dela Cruz (LRN 114200100001) enrolled in Grade 11 - Rizal (STEM)
    const inserted = await db.query(
      `INSERT INTO public.students (school_id, lrn, first_name, middle_name, last_name, grade_level, status)
       VALUES ($1, '114200100001', 'Juan', 'Santos', 'Dela Cruz', 'Grade 11', 'active')
       RETURNING id`,
      [SCHOOL_ID]
    );
    canonicalStudentId = inserted.rows[0].id;

    // Enroll Juan in Rizal (p_student_id, p_school_id, sy, grade, section, strand, adviser, source_doc)
    await asUser(db, ADMIN_ID, async () => {
      await db.query(
        `SELECT public.upsert_student_enrollment_history($1, $2, '2026-2027', 'Grade 11', 'Rizal', 'STEM', $3, NULL)`,
        [canonicalStudentId, SCHOOL_ID, ADVISER_A_ID]
      );
    });

    // Scenario 7 & 9: Another teacher (Adviser B in Mabini) looks up existing student via school-scoped RPC -> reuses canonical student
    const rpcSame = await asUser(db, ADVISER_B_ID, async () => {
      return await db.query(
        `SELECT public.lookup_or_quarantine_student_identity($1, '114200100001', 'Juan', 'Dela Cruz') AS res`,
        [SCHOOL_ID]
      );
    });
    assert.equal(rpcSame.rows[0].res.outcome, "MATCHED_LRN_AND_NAME");
    assert.equal(rpcSame.rows[0].res.student_id, canonicalStudentId);
    assert.equal(rpcSame.rows[0].res.current_enrollment.section, "Rizal");

    const extSame = evaluateStudentIdentity({
      lrn: "114200100001",
      first_name: "Juan",
      last_name: "Dela Cruz",
    });
    const matrixSame = matchStudentIdentityMatrix({
      extracted: extSame,
      existingStudentByLrn: {
        id: canonicalStudentId,
        lrn: "114200100001",
        first_name: "Juan",
        middle_name: "Santos",
        last_name: "Dela Cruz",
      },
    });
    assert.equal(matrixSame.matchType, "SAME_LRN_SAME_NAME");
    assert.equal(matrixSame.canAutoLink, true);
    assert.equal(matrixSame.studentId, canonicalStudentId);

    // Scenario 10: Same LRN with conflicting name (Pedro Penduko) -> blocked & quarantined
    const rpcConflict = await asUser(db, ADVISER_A_ID, async () => {
      return await db.query(
        `SELECT public.lookup_or_quarantine_student_identity($1, '114200100001', 'Pedro', 'Penduko') AS res`,
        [SCHOOL_ID]
      );
    });
    assert.equal(rpcConflict.rows[0].res.outcome, "SAME_LRN_CONFLICT_NAME");

    const extConflict = evaluateStudentIdentity({
      lrn: "114200100001",
      first_name: "Pedro",
      last_name: "Penduko",
    });
    const matrixConflict = matchStudentIdentityMatrix({
      extracted: extConflict,
      existingStudentByLrn: {
        id: canonicalStudentId,
        lrn: "114200100001",
        first_name: "Juan",
        last_name: "Dela Cruz",
      },
    });
    assert.equal(matrixConflict.matchType, "SAME_LRN_CONFLICT_NAME");
    assert.equal(matrixConflict.canAutoLink, false);
    assert.equal(matrixConflict.requiresManualReview, true);

    // Scenario 11: Different LRN (999888777666) with matching name (Juan Dela Cruz) -> quarantined
    const rpcDiffLrn = await asUser(db, ADVISER_A_ID, async () => {
      return await db.query(
        `SELECT public.lookup_or_quarantine_student_identity($1, '999888777666', 'Juan', 'Dela Cruz') AS res`,
        [SCHOOL_ID]
      );
    });
    assert.equal(rpcDiffLrn.rows[0].res.outcome, "DIFF_LRN_SAME_NAME");

    const extDiffLrn = evaluateStudentIdentity({
      lrn: "999888777666",
      first_name: "Juan",
      last_name: "Dela Cruz",
    });
    const matrixDiffLrn = matchStudentIdentityMatrix({
      extracted: extDiffLrn,
      existingStudentByLrn: null,
      existingStudentByNameDiffLrn: {
        id: canonicalStudentId,
        lrn: "114200100001",
        first_name: "Juan",
        last_name: "Dela Cruz",
      },
    });
    assert.equal(matrixDiffLrn.matchType, "DIFF_LRN_SAME_NAME");
    assert.equal(matrixDiffLrn.canAutoLink, false);
    assert.equal(matrixDiffLrn.canAutoCreate, false);
    assert.equal(matrixDiffLrn.requiresManualReview, true);

    // Confirm admin conflict resolution (including document_id + JSONB lrn_conflict_verified update)
    const { rows: stagedConflictDoc } = await db.query(
      `INSERT INTO public.documents (school_id, document_type, image_url, school_year, grade_level, status, extracted_fields)
       VALUES ($1, 'sf9', 'https://local/conflict_doc.jpg', '2026-2027', 'Grade 11', 'needs_review', '{"lrn":"114200100001","name":"Penduko, Pedro","identity_conflict":true}'::jsonb)
       RETURNING id`,
      [SCHOOL_ID]
    );
    const { rows: conflictRows } = await db.query(
      `INSERT INTO public.student_identity_conflicts (school_id, document_id, conflict_type, existing_student_id, extracted_lrn, extracted_name, status)
       VALUES ($1, $2, 'SAME_LRN_CONFLICT_NAME', $3, '114200100001', 'Pedro Penduko', 'pending')
       RETURNING id`,
      [SCHOOL_ID, stagedConflictDoc[0].id, canonicalStudentId]
    );
    await assert.rejects(
      asUser(db, ADVISER_A_ID, async () => {
        await db.query(
          `SELECT public.resolve_section_or_identity_conflict($1, 'dismissed', 'Attempt by teacher')`,
          [conflictRows[0].id]
        );
      }),
      /Only administrators/i
    );

    const resolvedRes = await asUser(db, ADMIN_ID, async () => {
      return await db.query(
        `SELECT public.resolve_section_or_identity_conflict($1, 'resolved', 'Verified by registrar', $2) AS ok`,
        [conflictRows[0].id, canonicalStudentId]
      );
    });
    assert.equal(resolvedRes.rows[0].ok, true);

    const { rows: [resolvedDocRow] } = await db.query(
      `SELECT student_id, canonical_lrn, extracted_fields FROM public.documents WHERE id = $1`,
      [stagedConflictDoc[0].id]
    );
    assert.equal(resolvedDocRow.student_id, canonicalStudentId);
    assert.equal(resolvedDocRow.canonical_lrn, "114200100001");
    assert.equal(resolvedDocRow.extracted_fields.lrn_conflict_verified, true);
    assert.equal(resolvedDocRow.extracted_fields.identity_conflict, false);
    // Clean up staged doc so canonical index test uses main SF9 cleanly
    await db.query(`UPDATE public.documents SET status = 'archived' WHERE id = $1`, [stagedConflictDoc[0].id]);
  });

  await t.test("Scenario 8: Student transfer between sections preserves single canonical student & tracks history", async () => {
    const transferRes = await asUser(db, ADMIN_ID, async () => {
      return await db.query(
        `SELECT public.upsert_student_enrollment_history($1, $2, '2026-2027', 'Grade 11', 'Mabini', 'ABM', $3, NULL) AS res`,
        [canonicalStudentId, SCHOOL_ID, ADVISER_B_ID]
      );
    });
    assert.equal(transferRes.rows[0].res.status, "transferred");
    assert.equal(transferRes.rows[0].res.transferred, true);

    const { rows: history } = await db.query(
      `SELECT section, strand_or_track, enrollment_status, is_current, effective_to
       FROM public.student_enrollments
       WHERE student_id = $1 AND school_year = '2026-2027'
       ORDER BY effective_from ASC, created_at ASC`,
      [canonicalStudentId]
    );
    assert.equal(history.length, 2);
    assert.equal(history[0].section, "Rizal");
    assert.equal(history[0].enrollment_status, "transferred");
    assert.equal(history[0].is_current, false);
    assert.ok(history[0].effective_to !== null);

    assert.equal(history[1].section, "Mabini");
    assert.equal(history[1].enrollment_status, "active");
    assert.equal(history[1].is_current, true);

    const { rows: studentCount } = await db.query(
      `SELECT COUNT(*)::INT AS c FROM public.students WHERE lrn = '114200100001'`
    );
    assert.equal(studentCount[0].c, 1);
  });

  let canonicalSf9Id;

  await t.test("Scenario 12, 13, & 16: Canonical SF9 incremental quarterly merge, SF10 multi-year record, & approved grade / Subject Teacher edit protection", async () => {
    // Adviser B (Mabini, Juan's new section) creates initial Q1 SF9 document for Juan
    const insDoc = await asUser(db, ADVISER_B_ID, async () => {
      return await db.query(
        `INSERT INTO public.documents (
          student_id, school_id, document_type, image_url, school_year, grade_level, canonical_lrn,
          section, strand_or_track, teacher_assignment_id, status, uploaded_by, extracted_fields
        ) VALUES (
          $1, $2, 'sf9', 'https://local/sf9_q1.jpg', '2026-2027', 'Grade 11', '114200100001',
          'Mabini', 'ABM', $3, 'needs_review', $4, $5::jsonb
        ) RETURNING id`,
        [
          canonicalStudentId,
          SCHOOL_ID,
          adviserMabiniAssignmentId,
          ADVISER_B_ID,
          JSON.stringify({
            lrn: "114200100001",
            name: "Dela Cruz, Juan Santos",
            grades: [
              { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
              { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
            ],
          }),
        ]
      );
    });
    canonicalSf9Id = insDoc.rows[0].id;

    // Principal/Admin approves Q1 SF9
    await asUser(db, ADMIN_ID, async () => {
      await db.query(
        `UPDATE public.documents SET status = 'approved', reviewed_by = $1 WHERE id = $2`,
        [ADMIN_ID, canonicalSf9Id]
      );
    });

    // Scenario 12a: Identical duplicate Q1 SF9 merge detection
    const dupMerge = mergeAcademicGrades({
      existingGrades: [
        { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
        { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
      ],
      incomingGrades: [
        { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
        { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
      ],
      isExistingApproved: true,
    });
    assert.equal(dupMerge.isIdentical, true);
    assert.equal(dupMerge.hasNewGrades, false);

    // Scenario 12b + 16: Incremental Q2 update preserves approved Q1 & protects against conflicting Q1 alteration
    const q2Merge = mergeAcademicGrades({
      existingGrades: [
        { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
        { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
      ],
      incomingGrades: [
        { subject: "General Mathematics", semester: "1st Semester", q1: 70, q2: 90 }, // conflicting Q1=70 must NOT overwrite 88!
        { subject: "Oral Communication", semester: "1st Semester", q1: 91, q2: 93 },
      ],
      isExistingApproved: true,
    });
    assert.equal(q2Merge.hasNewGrades, true);
    assert.equal(q2Merge.conflicts.length, 1);
    const genMathMerged = q2Merge.mergedGrades.find((g) => g.subject === "General Mathematics");
    assert.equal(genMathMerged.q1, 88);
    assert.equal(genMathMerged.q2, 90);
    assert.equal(genMathMerged.final, 89);

    // Also re-enrol Juan temporarily into Rizal too? No, keep Mabini, test M022 + M021 approved-doc requeue trigger!
    // Transfer back to Rizal so Subject Teacher in Rizal can access Rizal doc, OR insert a Rizal-linked doc for a Rizal student.
    // Let's test Subject Teacher grade edit restrictions directly using Rizal student + Rizal doc!
    const { rows: [rizalStudent] } = await db.query(
      `INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
       VALUES ($1, '114200100099', 'Clara', 'Mendoza', 'Grade 11') RETURNING id`,
      [SCHOOL_ID]
    );
    await asUser(db, ADMIN_ID, async () => {
      await db.query(
        `SELECT public.upsert_student_enrollment_history($1, $2, '2026-2027', 'Grade 11', 'Rizal', 'STEM', $3, NULL)`,
        [rizalStudent.id, SCHOOL_ID, ADVISER_A_ID]
      );
    });
    const { rows: [rizalDoc] } = await asUser(db, ADVISER_A_ID, async () => {
      return await db.query(
        `INSERT INTO public.documents (
          student_id, school_id, document_type, image_url, school_year, grade_level, canonical_lrn,
          section, strand_or_track, teacher_assignment_id, status, uploaded_by, extracted_fields
        ) VALUES (
          $1, $2, 'sf9', 'https://local/clara_sf9.jpg', '2026-2027', 'Grade 11', '114200100099',
          'Rizal', 'STEM', $3, 'needs_review', $4, $5::jsonb
        ) RETURNING id`,
        [
          rizalStudent.id,
          SCHOOL_ID,
          adviserRizalAssignmentId,
          ADVISER_A_ID,
          JSON.stringify({
            lrn: "114200100099",
            name: "Mendoza, Clara",
            grades: [
              { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
              { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
            ],
          }),
        ]
      );
    });

    // App-level Subject Teacher edit validator: allowed for General Mathematics, forbidden for Oral Communication
    const subjAllow = validateSubjectTeacherGradeEdits({
      isClassAdviser: false,
      authorizedSubjectNames: ["General Mathematics", "Earth and Life Science"],
      previousGrades: [
        { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
        { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
      ],
      nextGrades: [
        { subject: "General Mathematics", semester: "1st Semester", q1: 88, q2: 90 },
        { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
      ],
    });
    assert.equal(subjAllow.allowed, true);

    const subjDeny = validateSubjectTeacherGradeEdits({
      isClassAdviser: false,
      authorizedSubjectNames: ["General Mathematics", "Earth and Life Science"],
      previousGrades: [
        { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
        { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
      ],
      nextGrades: [
        { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
        { subject: "Oral Communication", semester: "1st Semester", q1: 95 },
      ],
    });
    assert.equal(subjDeny.allowed, false);
    assert.ok(subjDeny.unauthorizedSubjects.includes("Oral Communication"));

    // DB trigger enforces the exact same rule in Postgres!
    // 1. Subject Teacher modifying Oral Communication -> rejected by DB trigger
    await assert.rejects(
      asUser(db, SUBJECT_TEACHER_ID, async () => {
        await db.query(
          `UPDATE public.documents
           SET extracted_fields = $1::jsonb
           WHERE id = $2`,
          [
            JSON.stringify({
              lrn: "114200100099",
              name: "Mendoza, Clara",
              grades: [
                { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
                { subject: "Oral Communication", semester: "1st Semester", q1: 99 },
              ],
            }),
            rizalDoc.id,
          ]
        );
      }),
      /not authorized to modify grades for subject "Oral Communication"/i
    );

    // 2. Subject Teacher modifying General Mathematics -> succeeds
    await asUser(db, SUBJECT_TEACHER_ID, async () => {
      await db.query(
        `UPDATE public.documents
         SET extracted_fields = $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            lrn: "114200100099",
            name: "Mendoza, Clara",
            grades: [
              { subject: "General Mathematics", semester: "1st Semester", q1: 88, q2: 90 },
              { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
            ],
          }),
          rizalDoc.id,
        ]
      );
    });

    // 2b. Subject Teacher altering student identity metadata directly in SQL -> rejected by DB trigger
    await assert.rejects(
      asUser(db, SUBJECT_TEACHER_ID, async () => {
        await db.query(
          `UPDATE public.documents
           SET extracted_fields = $1::jsonb
           WHERE id = $2`,
          [
            JSON.stringify({
              lrn: "114200100099",
              name: "Tampered, Student Name",
              grades: [
                { subject: "General Mathematics", semester: "1st Semester", q1: 88, q2: 90 },
                { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
              ],
            }),
            rizalDoc.id,
          ]
        );
      }),
      /cannot alter student identity metadata/i
    );

    // 2c. Subject Teacher attempting OCR reprocessing via incremental_update_summary or image_url overwrite -> rejected by DB trigger
    await assert.rejects(
      asUser(db, SUBJECT_TEACHER_ID, async () => {
        await db.query(
          `UPDATE public.documents
           SET image_url = 'https://local/reprocessed_hack.jpg',
               extracted_fields = extracted_fields || '{"incremental_update_summary": {"added_count": 1}}'::jsonb
           WHERE id = $1`,
          [rizalDoc.id]
        );
      }),
      /Subject teachers cannot upload or reprocess scanned document images|Subject teachers cannot run OCR reprocessing/i
    );

    await assert.rejects(
      asUser(db, SUBJECT_TEACHER_ID, async () => {
        await db.query(
          `UPDATE public.documents
           SET extracted_fields = extracted_fields || '{"incremental_update_summary": {"added_count": 1}}'::jsonb
           WHERE id = $1`,
          [rizalDoc.id]
        );
      }),
      /Subject teachers cannot run OCR reprocessing/i
    );

    // 3. Teacher directly setting document status to 'approved' -> rejected by trigger and/or RLS WITH CHECK
    await assert.rejects(
      asUser(db, ADVISER_A_ID, async () => {
        await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [rizalDoc.id]);
      }),
      /Teachers cannot approve or reject|row-level security policy/i
    );

    // 4. Class Adviser incremental update on previously approved SF9 -> succeeds ONLY with incremental_update_summary!
    await asUser(db, ADVISER_B_ID, async () => {
      await db.query(
        `UPDATE public.documents
         SET status = 'needs_review',
             extracted_fields = extracted_fields || '{"incremental_update_summary": {"added_count": 2}}'::jsonb
         WHERE id = $1`,
        [canonicalSf9Id]
      );
    });

    // Scenario 13: SF10 permanent record multi-year preservation (single canonical sf10 per student)
    const { rows: [sf10Doc] } = await asUser(db, ADVISER_B_ID, async () => {
      return await db.query(
        `INSERT INTO public.documents (
          student_id, school_id, document_type, image_url, school_year, grade_level, canonical_lrn,
          section, strand_or_track, teacher_assignment_id, status, uploaded_by, extracted_fields
        ) VALUES (
          $1, $2, 'sf10', 'https://local/sf10_p1.jpg', '2026-2027', 'Grade 11', '114200100001',
          'Mabini', 'ABM', $3, 'approved', $4, $5::jsonb
        ) RETURNING id`,
        [
          canonicalStudentId,
          SCHOOL_ID,
          adviserMabiniAssignmentId,
          ADVISER_B_ID,
          JSON.stringify({
            lrn: "114200100001",
            grades: [{ subject: "General Mathematics", semester: "1st Semester", school_year: "2025-2026", q1: 85, q2: 87, final: 86 }],
          }),
        ]
      );
    });

    const sf10MultiYearMerge = mergeAcademicGrades({
      existingGrades: [{ subject: "General Mathematics", semester: "1st Semester", q1: 85, q2: 87, final: 86 }],
      incomingGrades: [{ subject: "Applied Economics", semester: "1st Semester", q1: 90, q2: 92, final: 91 }],
      isExistingApproved: true,
    });
    assert.equal(sf10MultiYearMerge.mergedGrades.length, 2);
    assert.ok(sf10Doc.id);

    // Attempting a SECOND active SF10 for the same student under another section/year must violate partial unique index
    await assert.rejects(
      db.query(
        `INSERT INTO public.documents (
          student_id, school_id, document_type, image_url, school_year, grade_level, canonical_lrn,
          section, strand_or_track, status
        ) VALUES (
          $1, $2, 'sf10', 'https://local/sf10_dup.jpg', '2027-2028', 'Grade 12', '114200100001',
          'Bonifacio', 'STEM', 'needs_review'
        )`,
        [canonicalStudentId, SCHOOL_ID]
      ),
      /duplicate key value violates unique constraint/i
    );
  });

  await t.test("Scenario 14: Mixed-student front/back SF9 scans flagged & quarantined", async () => {
    const crossCheck = evaluateTwoSidedSf9Identity({
      frontFields: {
        lrn: "114200100001",
        last_name: "Dela Cruz",
        first_name: "Juan",
        grades: [{ subject: "General Mathematics", semester: "1st Semester", q1: 88 }],
      },
      backFields: {
        lrn: "114200200002",
        last_name: "Clara",
        first_name: "Maria",
        grades: [{ subject: "General Mathematics", semester: "1st Semester", q2: 94 }],
      },
    });

    assert.equal(crossCheck.isSameStudent, false);
    assert.equal(crossCheck.hasMixedStudentConflict, true);
    assert.equal(crossCheck.mergedFields.mixed_student_front_back, true);
    assert.equal(crossCheck.mergedFields.identity_conflict, true);
    assert.ok(crossCheck.mergedFields.flags?.includes("mixed_student_front_back"));
  });

  await t.test("Scenario 15: Concurrent duplicate upload & enrollment history race safety", async () => {
    // 1. Concurrent SF9 insert attempt for existing active canonical SF9 (same school, student, 'sf9', SY, Grade 11)
    // must deterministically allow zero duplicate rows via unique partial index
    await assert.rejects(
      db.query(
        `INSERT INTO public.documents (
          student_id, school_id, document_type, image_url, school_year, grade_level, canonical_lrn,
          section, strand_or_track, status
        ) VALUES (
          $1, $2, 'sf9', 'https://local/sf9_race_dup.jpg', '2026-2027', 'Grade 11', '114200100001',
          'Bonifacio', 'STEM', 'needs_review'
        )`,
        [canonicalStudentId, SCHOOL_ID]
      ),
      /duplicate key value violates unique constraint/i
    );

    const { rows: sf9Counts } = await db.query(
      `SELECT COUNT(*)::INT AS c FROM public.documents
       WHERE student_id = $1 AND document_type = 'sf9' AND school_year = '2026-2027' AND grade_level = 'Grade 11' AND status NOT IN ('archived', 'rejected')`,
      [canonicalStudentId]
    );
    assert.equal(sf9Counts[0].c, 1);

    // 2. Concurrent enrollment upserts in parallel promises stay serialized by pg_advisory_xact_lock
    // leaving strictly 1 active current enrollment row per school_year
    await db.exec("SET ROLE service_role;");
    try {
      await Promise.all([
        db.query(
          `SELECT public.upsert_student_enrollment_history($1, $2, '2026-2027', 'Grade 11', 'Rizal', 'STEM', $3, NULL)`,
          [canonicalStudentId, SCHOOL_ID, ADVISER_A_ID]
        ),
        db.query(
          `SELECT public.upsert_student_enrollment_history($1, $2, '2026-2027', 'Grade 11', 'Mabini', 'ABM', $3, NULL)`,
          [canonicalStudentId, SCHOOL_ID, ADVISER_B_ID]
        ),
      ]);
    } finally {
      await db.exec("RESET ROLE;");
    }

    const { rows: activeEnrollments } = await db.query(
      `SELECT COUNT(*)::INT AS c FROM public.student_enrollments
       WHERE school_id = $1 AND student_id = $2 AND school_year = '2026-2027' AND is_current = TRUE AND enrollment_status = 'active'`,
      [SCHOOL_ID, canonicalStudentId]
    );
    assert.equal(activeEnrollments[0].c, 1);
  });

  await t.test("Section-isolation RLS: Mabini adviser cannot read Rizal-only documents; Admin accesses legacy documents", async () => {
    const mabiniVisible = await asUser(db, ADVISER_B_ID, async () => {
      return await db.query(
        `SELECT canonical_lrn, section FROM public.documents`
      );
    });
    const visibleLrns = mabiniVisible.rows.map((r) => r.canonical_lrn);
    assert.ok(!visibleLrns.includes("114200100099"), "Adviser B must not see Rizal-only student Clara's document");

    // Seed a legacy pre-M022 production document (NULL teacher_assignment_id, NULL section)
    const { rows: [legacyDoc] } = await db.query(
      `INSERT INTO public.documents (school_id, document_type, image_url, school_year, grade_level, canonical_lrn, status)
       VALUES ($1, 'sf9', 'https://local/legacy_pre_m022.jpg', '2024-2025', 'Grade 11', '114200000001', 'approved')
       RETURNING id`,
      [SCHOOL_ID]
    );

    const adminLegacyRead = await asUser(db, ADMIN_ID, async () => {
      return await db.query(`SELECT id, status FROM public.documents WHERE id = $1`, [legacyDoc.id]);
    });
    assert.equal(adminLegacyRead.rows.length, 1);

    await asUser(db, ADMIN_ID, async () => {
      await db.query(`UPDATE public.documents SET original_filename = 'legacy_verified.jpg' WHERE id = $1`, [legacyDoc.id]);
    });

    const unassignedVisible = await asUser(db, UNASSIGNED_TEACHER_ID, async () => {
      return await db.query(`SELECT id FROM public.documents WHERE id = $1`, [legacyDoc.id]);
    });
    assert.equal(unassignedVisible.rows.length, 0, "Unassigned teacher must not see legacy school documents");
  });

  await t.test("Strict Class Adviser-only OCR & Anti-Bypass Regression Suite (API / Server Auth / Reprocessing)", async () => {
    const subjectAssignment = {
      id: subjectMathRizalAssignmentId,
      teacher_user_id: SUBJECT_TEACHER_ID,
      school_id: SCHOOL_ID,
      school_year: "2026-2027",
      grade_level: "Grade 11",
      section: "Rizal",
      strand_or_track: "STEM",
      subject_taught: "General Mathematics",
      semester: "1st Semester",
      assignment_type: "subject_teacher",
      assignment_status: "active",
    };
    const adviserAssignment = {
      id: adviserRizalAssignmentId,
      teacher_user_id: ADVISER_A_ID,
      school_id: SCHOOL_ID,
      school_year: "2026-2027",
      grade_level: "Grade 11",
      section: "Rizal",
      strand_or_track: "STEM",
      subject_taught: null,
      semester: null,
      assignment_type: "class_adviser",
      assignment_status: "active",
    };

    // 1. Direct API OCR request from a Subject Teacher with their own active subject assignment -> 403
    const subjOcr = evaluateOcrRouteAuthorization({
      userId: SUBJECT_TEACHER_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: subjectAssignment,
      assignmentConfirmed: true,
      selectedSchoolYear: "2026-2027",
      selectedGradeLevel: "Grade 11",
      selectedSection: "Rizal",
      selectedStrand: "STEM",
    });
    assert.equal(subjOcr.allowed, false);
    assert.equal(subjOcr.statusCode, 403);
    assert.equal(subjOcr.code, "CLASS_ADVISER_REQUIRED");

    // 2. Subject Teacher passing another teacher's active Class Adviser assignment ID -> 403 ASSIGNMENT_NOT_OWNED
    const stolenOcr = evaluateOcrRouteAuthorization({
      userId: SUBJECT_TEACHER_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: adviserAssignment,
      assignmentConfirmed: true,
    });
    assert.equal(stolenOcr.allowed, false);
    assert.equal(stolenOcr.statusCode, 403);
    assert.equal(stolenOcr.code, "ASSIGNMENT_NOT_OWNED");

    // 3. Direct API OCR call omitting assignment ID -> 403 ASSIGNMENT_REQUIRED
    const noAssignOcr = evaluateOcrRouteAuthorization({
      userId: SUBJECT_TEACHER_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null,
      assignmentConfirmed: true,
    });
    assert.equal(noAssignOcr.allowed, false);
    assert.equal(noAssignOcr.statusCode, 403);
    assert.equal(noAssignOcr.code, "ASSIGNMENT_REQUIRED");

    // 4. Class Adviser sending mismatched section or unconfirmed scan -> blocked
    const mismatchOcr = evaluateOcrRouteAuthorization({
      userId: ADVISER_A_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: adviserAssignment,
      assignmentConfirmed: true,
      selectedSection: "Mabini",
    });
    assert.equal(mismatchOcr.allowed, false);
    assert.equal(mismatchOcr.statusCode, 403);
    assert.equal(mismatchOcr.code, "ASSIGNMENT_PARAMETER_MISMATCH");

    const unconfirmedOcr = evaluateOcrRouteAuthorization({
      userId: ADVISER_A_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: adviserAssignment,
      assignmentConfirmed: false,
    });
    assert.equal(unconfirmedOcr.allowed, false);
    assert.equal(unconfirmedOcr.statusCode, 400);
    assert.equal(unconfirmedOcr.code, "ASSIGNMENT_CONFIRMATION_REQUIRED");

    // 5. Active Class Adviser with valid confirmed assignment & matching section -> allowed
    const validAdviserOcr = evaluateOcrRouteAuthorization({
      userId: ADVISER_A_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: adviserAssignment,
      assignmentConfirmed: true,
      selectedSchoolYear: "2026-2027",
      selectedGradeLevel: "Grade 11",
      selectedSection: "Rizal",
      selectedStrand: "STEM",
    });
    assert.equal(validAdviserOcr.allowed, true);
    assert.equal(validAdviserOcr.statusCode, 200);

    // 6. Principal and Admin blocked from scanning/uploading (Teacher-only upload enforcement)
    const principalOcr = evaluateOcrRouteAuthorization({
      userId: PRINCIPAL_ID,
      userRole: "principal",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null,
      assignmentConfirmed: false,
    });
    assert.equal(principalOcr.allowed, false);
    assert.equal(principalOcr.statusCode, 403);
    assert.equal(principalOcr.code, "PRINCIPAL_READ_ONLY");

    const adminOcr = evaluateOcrRouteAuthorization({
      userId: ADMIN_ID,
      userRole: "admin",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null,
      assignmentConfirmed: false,
    });
    assert.equal(adminOcr.allowed, false);
    assert.equal(adminOcr.statusCode, 403);
    assert.equal(adminOcr.code, "ADMIN_CANNOT_UPLOAD");

    // 7. Subject Teacher blocked from OCR reprocessing or image overwrite via PATCH /api/documents/[id] guard
    const fakeSubjSupabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  eq: async () => ({ data: [subjectAssignment] }),
                };
              },
            };
          },
        };
      },
    };
    const existingRizalDoc = {
      id: "doc-rizal-1",
      school_id: SCHOOL_ID,
      school_year: "2026-2027",
      grade_level: "Grade 11",
      section: "Rizal",
      status: "needs_review",
      extracted_fields: {
        lrn: "114200100099",
        name: "Mendoza, Clara",
        grades: [
          { subject: "General Mathematics", semester: "1st Semester", q1: 88 },
          { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
        ],
      },
    };

    const reprocessImgBlock = await authorizeTeacherDocumentEdit({
      supabase: fakeSubjSupabase,
      userId: SUBJECT_TEACHER_ID,
      doc: existingRizalDoc,
      nextBody: { image_url: "https://local/reprocessed.jpg" },
      nextExtractedFields: existingRizalDoc.extracted_fields,
    });
    assert.equal(reprocessImgBlock.allowed, false);
    assert.match(reprocessImgBlock.error, /image_url/i);

    const reprocessIncBlock = await authorizeTeacherDocumentEdit({
      supabase: fakeSubjSupabase,
      userId: SUBJECT_TEACHER_ID,
      doc: existingRizalDoc,
      nextExtractedFields: {
        ...existingRizalDoc.extracted_fields,
        incremental_update_summary: { added_count: 1 },
      },
    });
    assert.equal(reprocessIncBlock.allowed, false);
    assert.match(reprocessIncBlock.error, /OCR reprocessing/i);

    const authorizedGradeEdit = await authorizeTeacherDocumentEdit({
      supabase: fakeSubjSupabase,
      userId: SUBJECT_TEACHER_ID,
      doc: existingRizalDoc,
      nextExtractedFields: {
        ...existingRizalDoc.extracted_fields,
        grades: [
          { subject: "General Mathematics", semester: "1st Semester", q1: 88, q2: 92 },
          { subject: "Oral Communication", semester: "1st Semester", q1: 91 },
        ],
      },
    });
    assert.equal(authorizedGradeEdit.allowed, true);
    assert.equal(authorizedGradeEdit.isClassAdviser, false);
  });

  await t.test("Migration 022 rollback verification restores clean state", async () => {
    const rollbackSql = fs.readFileSync(ROLLBACK_022_PATH, "utf8");
    await db.exec(rollbackSql);

    const { rows: leftovers } = await db.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('teacher_assignments', 'teacher_module_policies', 'student_enrollments', 'student_identity_conflicts')
    `);
    assert.equal(leftovers.length, 0);
  });

  await db.close();
});

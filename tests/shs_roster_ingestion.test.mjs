import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import { ingestRosterDocument } from "../src/lib/upload/rosterIngestion.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const MIGRATION_022_PATH = path.resolve(rootDir, "supabase", "migrations", "022_teacher_assignments_and_section_scanning.sql");
const MIGRATION_023_PATH = path.resolve(rootDir, "supabase", "migrations", "023_shs_roster_documents_and_multi_learner_child_tables.sql");
const MIGRATION_024_PATH = path.resolve(rootDir, "supabase", "migrations", "024_shs_cross_document_validation_engine.sql");
const MIGRATION_025_PATH = path.resolve(rootDir, "supabase", "migrations", "025_shs_roster_security_and_rls_hardening.sql");

const SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";
const TEACHER_ID = "30000000-0000-0000-0000-000000000003";

async function setupTestDb() {
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT NULL::UUID; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT 'authenticated'; $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION public.normalize_shs_grade_level(raw_grade TEXT)
    RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
    BEGIN
      IF LOWER(COALESCE(raw_grade, '')) LIKE '%11%' THEN RETURN 'Grade 11'; END IF;
      IF LOWER(COALESCE(raw_grade, '')) LIKE '%12%' THEN RETURN 'Grade 12'; END IF;
      RETURN BTRIM(raw_grade);
    END; $$;

    CREATE TABLE IF NOT EXISTS public.schools (id UUID PRIMARY KEY, school_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
      role TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'Approved'
    );
    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      grade_level TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
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
      section TEXT,
      track TEXT,
      strand TEXT,
      semester TEXT,
      reporting_month TEXT,
      extracted_fields JSONB DEFAULT '{}'::JSONB,
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
      final_grade NUMERIC
    );

    CREATE TABLE IF NOT EXISTS public.document_scans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
      scan_version INTEGER DEFAULT 1,
      image_url TEXT NOT NULL
    );

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$ SELECT '${SCHOOL_ID}'::UUID; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$ SELECT false; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$ SELECT false; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS BOOLEAN AS $$ SELECT true; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS BOOLEAN AS $$ SELECT true; $$ LANGUAGE sql STABLE;

    INSERT INTO public.schools (id, school_id, name) VALUES ('${SCHOOL_ID}', '500169', 'Taysan Resettlement Integrated School');
    INSERT INTO auth.users (id, email) VALUES ('${TEACHER_ID}', 'teacher@tris.edu.ph');
    INSERT INTO public.user_roles (user_id, school_id, role, account_status) VALUES ('${TEACHER_ID}', '${SCHOOL_ID}', 'teacher', 'Approved');
  `);

  // Apply migrations 022-025
  await db.exec(fs.readFileSync(MIGRATION_022_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_023_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_024_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_025_PATH, "utf8"));

  return db;
}

test("SHS Multi-Learner Roster Ingestion & Pipeline Suite", async (t) => {
  const db = await setupTestDb();

  // Seed two existing learners in the database
  // 1. Juan Dela Cruz (LRN: 109345000001) - Matching learner
  // 2. Kenneth Latonero (LRN: 109345000002) - Target for collision test
  const s1Res = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000001', 'Juan', 'Dela Cruz', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const s1Id = s1Res.rows[0].id;

  await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000002', 'Kenneth', 'Latonero', 'Grade 11');
  `, [SCHOOL_ID]);

  await t.test("1. Ingest SF1 School Register: Matching, Collision Quarantine & Candidate Staging", async () => {
    // Create parent SF1 document
    const docRes = await db.query(`
      INSERT INTO public.documents (school_id, document_type, image_url, status, uploaded_by)
      VALUES ($1, 'sf1', 'https://storage.local/sf1_raw.jpg', 'needs_review', $2)
      RETURNING id;
    `, [SCHOOL_ID, TEACHER_ID]);
    const sf1DocId = docRes.rows[0].id;

    // SF1 text with 3 learners:
    // - 109345000001: Dela Cruz, Juan (Matches existing s1Id) -> Case A
    // - 109345000002: Gomez, Justin (Same LRN as Latonero, conflicting name) -> Case C Collision!
    // - 109345000003: Reyes, Maria Clara (Brand new LRN) -> Case E New Candidate
    const sf1OcrText = `
      Republic of the Philippines - Department of Education
      School Form 1 (SF1) School Register
      School ID: 500169
      School Name: Taysan Resettlement Integrated School
      School Year: 2026-2027
      Grade Level: Grade 11
      Section: Rizal
      Track: Academic Track
      Strand: STEM
      Semester: 1st Semester

      MALE
      109345000001 | Dela Cruz, Juan | M | 2009-06-15 | 17
      109345000002 | Gomez, Justin | M | 2009-07-20 | 17

      FEMALE
      109345000003 | Reyes, Maria Clara | F | 2009-04-10 | 17
    `;

    const result = await ingestRosterDocument({
      db,
      documentId: sf1DocId,
      schoolId: SCHOOL_ID,
      documentType: "sf1",
      extractedText: sf1OcrText,
      ocrProvider: "azure",
      ocrConfidence: 0.98,
    });

    assert.equal(result.success, true);
    assert.equal(result.totalLearners, 3);
    assert.equal(result.matchedCount, 1, "Exactly 1 learner (Juan Dela Cruz) should match");
    assert.equal(result.conflictCount, 1, "Exactly 1 collision (Justin Gomez vs Kenneth Latonero) must be quarantined");
    assert.equal(result.newCandidatesCount, 1, "Exactly 1 new candidate (Maria Clara Reyes)");

    // Verify parent document student_id is NULL
    const parentDoc = await db.query(`SELECT student_id, section, track FROM public.documents WHERE id = $1;`, [sf1DocId]);
    assert.equal(parentDoc.rows[0].student_id, null, "Parent SF1 document must have student_id = NULL");
    assert.equal(parentDoc.rows[0].section, "Rizal");

    // Verify child entries in public.sf1_roster_entries
    const entries = await db.query(`
      SELECT lrn, last_name, student_id, review_status
      FROM public.sf1_roster_entries
      WHERE document_id = $1
      ORDER BY row_index ASC;
    `, [sf1DocId]);
    assert.equal(entries.rows.length, 3);

    // Entry 1: Juan Dela Cruz -> student_id = s1Id
    assert.equal(entries.rows[0].lrn, "109345000001");
    assert.equal(entries.rows[0].student_id, s1Id);

    // Entry 2: Justin Gomez -> student_id = NULL, review_status = 'FLAGGED'
    assert.equal(entries.rows[1].lrn, "109345000002");
    assert.equal(entries.rows[1].student_id, null);
    assert.equal(entries.rows[1].review_status, "FLAGGED");

    // Verify conflict quarantined in public.student_identity_conflicts
    const conflicts = await db.query(`
      SELECT conflict_type, extracted_lrn, extracted_name, status
      FROM public.student_identity_conflicts
      WHERE document_id = $1;
    `, [sf1DocId]);
    assert.equal(conflicts.rows.length, 1);
    assert.equal(conflicts.rows[0].conflict_type, "SAME_LRN_CONFLICT_NAME");
    assert.equal(conflicts.rows[0].extracted_lrn, "109345000002");
    assert.ok(conflicts.rows[0].extracted_name.includes("Gomez"));
    assert.equal(conflicts.rows[0].status, "pending");

    // Verify field extraction trace
    const traces = await db.query(`SELECT COUNT(*) as cnt FROM public.field_extraction_traces WHERE document_id = $1;`, [sf1DocId]);
    assert.ok(Number(traces.rows[0].cnt) >= 3);
  });

  await t.test("2. Ingest SF2 Daily Attendance Report", async () => {
    const docRes = await db.query(`
      INSERT INTO public.documents (school_id, document_type, image_url, status, uploaded_by)
      VALUES ($1, 'sf2', 'https://storage.local/sf2_raw.jpg', 'needs_review', $2)
      RETURNING id;
    `, [SCHOOL_ID, TEACHER_ID]);
    const sf2DocId = docRes.rows[0].id;

    const sf2OcrText = `
      Republic of the Philippines - Department of Education
      School Form 2 (SF2) Daily Attendance Report of Learners
      School ID: 500169
      School Year: 2026-2027
      Grade Level: Grade 11
      Section: Rizal
      For the month of: September
      Total School Days: 22

      Dela Cruz, Juan Miguel 21 1 0
      Reyes, Maria Clara 20 2 0
    `;

    const result = await ingestRosterDocument({
      db,
      documentId: sf2DocId,
      schoolId: SCHOOL_ID,
      documentType: "sf2",
      extractedText: sf2OcrText,
      ocrProvider: "azure",
    });

    assert.equal(result.success, true);
    assert.equal(result.totalLearners, 2);

    const entries = await db.query(`SELECT * FROM public.sf2_attendance_entries WHERE document_id = $1;`, [sf2DocId]);
    assert.equal(entries.rows.length, 2);
    assert.equal(Number(entries.rows[0].days_present), 21);
    assert.equal(Number(entries.rows[0].days_absent), 1);
  });

  await t.test("3. Ingest SF5 Promotion & Deficiency Report", async () => {
    const docRes = await db.query(`
      INSERT INTO public.documents (school_id, document_type, image_url, status, uploaded_by)
      VALUES ($1, 'sf5', 'https://storage.local/sf5_raw.jpg', 'needs_review', $2)
      RETURNING id;
    `, [SCHOOL_ID, TEACHER_ID]);
    const sf5DocId = docRes.rows[0].id;

    const sf5OcrText = `
      School Form 5A (SF5A-SHS)
      End of Semester and School Year Learner Status
      School ID: 500169
      School Year: 2026-2027
      Grade Level: Grade 11
      Section: Rizal
      Semester: 1st Semester
      Track: Academic Track
      Strand: STEM

      109345000001 Dela Cruz, Juan 92.5 COMPLETE
      109345000003 Reyes, Maria Clara 73.0 INCOMPLETE
    `;

    const result = await ingestRosterDocument({
      db,
      documentId: sf5DocId,
      schoolId: SCHOOL_ID,
      documentType: "sf5",
      extractedText: sf5OcrText,
      ocrProvider: "azure",
    });

    assert.equal(result.success, true);
    assert.equal(result.totalLearners, 2);

    const entries = await db.query(`SELECT * FROM public.sf5_promotion_entries WHERE document_id = $1 ORDER BY row_index ASC;`, [sf5DocId]);
    assert.equal(entries.rows.length, 2);
    assert.equal(entries.rows[0].action_taken, "COMPLETE");
    assert.equal(entries.rows[0].proficiency_level, "OUTSTANDING");
    assert.equal(entries.rows[1].action_taken, "INCOMPLETE");
    assert.equal(entries.rows[1].proficiency_level, "DID_NOT_MEET_EXPECTATIONS");
  });
});

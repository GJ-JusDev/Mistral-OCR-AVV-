import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { buildPersistedValidationResponse } from "../src/lib/validation/studentCrossDocumentValidation.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const MIGRATION_022_PATH = path.resolve(rootDir, "supabase", "migrations", "022_teacher_assignments_and_section_scanning.sql");
const MIGRATION_023_PATH = path.resolve(rootDir, "supabase", "migrations", "023_shs_roster_documents_and_multi_learner_child_tables.sql");
const MIGRATION_024_PATH = path.resolve(rootDir, "supabase", "migrations", "024_shs_cross_document_validation_engine.sql");
const MIGRATION_025_PATH = path.resolve(rootDir, "supabase", "migrations", "025_shs_roster_security_and_rls_hardening.sql");
const MIGRATION_031_PATH = path.resolve(rootDir, "supabase", "migrations", "031_avv_validation_context_and_atomic_persistence.sql");
const MIGRATION_032_PATH = path.resolve(rootDir, "supabase", "migrations", "032_avv_null_context_and_batch_persistence.sql");

const SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";
const ADMIN_ID = "10000000-0000-0000-0000-000000000001";
const TEACHER_ID = "30000000-0000-0000-0000-000000000003";

async function createDisposableDatabase() {
  const db = new PGlite();

  // 1. Core Supabase Roles, Schema and Functions
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
      updated_at TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT documents_document_type_check CHECK (document_type IN ('sf9', 'sf10'))
    );

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
  `);

  // Seed baseline school and users
  await db.query(`INSERT INTO public.schools (id, school_id, name) VALUES ($1, '500169', 'Taysan Resettlement Integrated School');`, [SCHOOL_ID]);
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'admin@tris.edu.ph'), ($2, 'teacher@tris.edu.ph');`, [ADMIN_ID, TEACHER_ID]);
  await db.query(`INSERT INTO public.user_roles (user_id, school_id, role, account_status) VALUES ($1, $2, 'admin', 'Approved'), ($3, $2, 'teacher', 'Approved');`, [ADMIN_ID, SCHOOL_ID, TEACHER_ID]);

  // Replay prerequisite migrations: 022 -> 023 -> 024 -> 025
  await db.exec(fs.readFileSync(MIGRATION_022_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_023_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_024_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_025_PATH, "utf8"));

  return db;
}

test("1. Migration sequence replay (022 -> 023 -> 024 -> 025 -> 031 -> 032) in disposable database", async () => {
  const db = await createDisposableDatabase();
  const v = await db.query("SELECT version();");
  assert.ok(v.rows[0].version.includes("PostgreSQL"));

  // Replay 031 and 032
  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8"));

  // Verify columns added by 031
  const cols = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cross_document_validations'
      AND column_name IN ('section', 'persistence_key', 'source_signature');
  `);
  assert.equal(cols.rows.length, 3, "Migration 031 columns must be present.");

  // Verify RPCs exist
  const rpcs = await db.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name IN ('persist_cross_document_validation', 'persist_cross_document_validation_batch');
  `);
  assert.equal(rpcs.rows.length, 2, "Both validation persistence RPCs must exist.");
});

test("2. Incomplete or blank academic context does not receive an invalid persistence key", async () => {
  const db = await createDisposableDatabase();

  const studentRes = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000001', 'Juan', 'Dela Cruz', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = studentRes.rows[0].id;

  // Insert historical records with missing or blank contexts before migration
  const rNullGrade = await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, semester, validation_type, status
    ) VALUES ($1, $2, '2024-2025', NULL, '1st Semester', 'SF1_SF2', 'NEEDS_VERIFICATION')
    RETURNING id;
  `, [studentId, SCHOOL_ID]);

  const rBlankYear = await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, semester, validation_type, status
    ) VALUES ($1, $2, '   ', 'Grade 11', '1st Semester', 'SF1_SF2', 'NEEDS_VERIFICATION')
    RETURNING id;
  `, [studentId, SCHOOL_ID]);

  // Apply migrations 031 and 032
  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8"));

  const checked = await db.query(`
    SELECT id, persistence_key
    FROM public.cross_document_validations
    WHERE id IN ($1, $2);
  `, [rNullGrade.rows[0].id, rBlankYear.rows[0].id]);

  for (const row of checked.rows) {
    assert.equal(row.persistence_key, null, "Incomplete academic context must NOT receive a persistence key.");
  }
});

test("3. Ambiguous historical records are preserved without guessing", async () => {
  const db = await createDisposableDatabase();

  const studentRes = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000002', 'Maria', 'Clara', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = studentRes.rows[0].id;

  // Ambiguous enrollments: learner enrolled in two sections in the same school year & grade (e.g. transferred sections)
  await db.query(`
    INSERT INTO public.student_enrollments (
      student_id, school_id, school_year, grade_level, section, enrollment_status, is_current
    ) VALUES
      ($1, $2, '2024-2025', 'Grade 11', 'Diamond', 'transferred', false),
      ($1, $2, '2024-2025', 'Grade 11', 'Emerald', 'active', true);
  `, [studentId, SCHOOL_ID]);

  const historicalVal = await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, semester, validation_type, status
    ) VALUES ($1, $2, '2024-2025', 'Grade 11', '1st Semester', 'SF1_SF2', 'NEEDS_VERIFICATION')
    RETURNING id;
  `, [studentId, SCHOOL_ID]);

  // Replay migration 031 and 032
  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8"));

  const preserved = await db.query(`
    SELECT section, persistence_key
    FROM public.cross_document_validations
    WHERE id = $1;
  `, [historicalVal.rows[0].id]);

  assert.equal(preserved.rows[0].section, null, "Ambiguous section must NOT be guessed.");
  assert.equal(preserved.rows[0].persistence_key, null, "Record with ambiguous section must have NULL persistence_key.");
});

test("4. Duplicate scoped persistence keys cause a safe failure without deleting historical data", async () => {
  const db = await createDisposableDatabase();

  const studentRes = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000003', 'Crisostomo', 'Ibarra', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = studentRes.rows[0].id;

  await db.query(`
    INSERT INTO public.student_enrollments (
      student_id, school_id, school_year, grade_level, section, enrollment_status
    ) VALUES ($1, $2, '2024-2025', 'Grade 11', 'Diamond', 'active');
  `, [studentId, SCHOOL_ID]);

  // Create duplicate pre-migration historical records in the same context
  await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, semester, validation_type, status
    ) VALUES
      ($1, $2, '2024-2025', 'Grade 11', '1st Semester', 'SF1_SF2', 'NEEDS_VERIFICATION'),
      ($1, $2, '2024-2025', 'Grade 11', '1st Semester', 'SF1_SF2', 'NEEDS_VERIFICATION');
  `, [studentId, SCHOOL_ID]);

  // Migration 031 must abort
  await assert.rejects(
    () => db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8")),
    /Duplicate scoped validation keys exist/
  );
  await db.exec("ROLLBACK;");

  // Verify historical records were preserved and not deleted
  const count = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM public.cross_document_validations
    WHERE student_id = $1;
  `, [studentId]);
  assert.equal(count.rows[0].count, 2, "Historical duplicate records must be completely preserved.");
});

test("5. Batch persistence is atomic: a failed item rolls back the entire batch", async () => {
  const db = await createDisposableDatabase();
  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8"));

  const studentRes = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000004', 'Basilio', 'Sisa', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = studentRes.rows[0].id;

  const validPayload1 = {
    student_id: studentId,
    school_id: SCHOOL_ID,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    section: "Diamond",
    semester: "1st Semester",
    validation_type: "SF1_SF2",
    persistence_key: "PAIR|SF1_SF2|1st Semester||",
    comparison_results: [],
    discrepancy_details: [],
    status: "MATCH",
    needs_human_review: false,
  };

  // Item 2 has mismatched academic context (section "Emerald" instead of "Diamond")
  const invalidPayload2 = {
    ...validPayload1,
    section: "Emerald",
    validation_type: "SF1_SF5",
    persistence_key: "PAIR|SF1_SF5|1st Semester||",
  };

  await assert.rejects(
    () => db.query(
      "SELECT public.persist_cross_document_validation_batch($1::jsonb);",
      [JSON.stringify([validPayload1, invalidPayload2])]
    ),
    /All validation batch items must use one learner and academic context/
  );

  // Assert rollback: validPayload1 was NOT saved
  const countRes = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM public.cross_document_validations
    WHERE student_id = $1;
  `, [studentId]);
  assert.equal(countRes.rows[0].count, 0, "Atomic batch rollback must leave zero rows committed.");
});

test("6. Valid records persist correctly and match application expected response structure", async () => {
  const db = await createDisposableDatabase();
  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8"));

  const studentRes = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000005', 'Elias', 'Piloto', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = studentRes.rows[0].id;

  const pairwisePayload = {
    student_id: studentId,
    school_id: SCHOOL_ID,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    section: "Diamond",
    semester: "1st Semester",
    validation_type: "SF1_SF2",
    source_doc1_id: null,
    source_doc2_id: null,
    persistence_key: "PAIR|SF1_SF2|1st Semester||",
    comparison_results: [{ field: "attendance", status: "MATCH" }],
    discrepancy_details: [],
    status: "MATCH",
    needs_human_review: false,
  };

  const consolidatedPayload = {
    student_id: studentId,
    school_id: SCHOOL_ID,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    section: "Diamond",
    semester: "Full Year",
    validation_type: "CONSOLIDATED_SHS",
    source_doc1_id: null,
    source_doc2_id: null,
    source_signature: "sf1-doc|sf2-doc",
    persistence_key: "CONSOLIDATED|sf1-doc|sf2-doc",
    comparison_results: [{ field: "first_name", status: "MATCH" }],
    discrepancy_details: [],
    status: "MATCH",
    needs_human_review: false,
  };

  const batchRes = await db.query(
    "SELECT public.persist_cross_document_validation_batch($1::jsonb) AS result;",
    [JSON.stringify([pairwisePayload, consolidatedPayload])]
  );

  const result = batchRes.rows[0].result;
  assert.equal(result.success, true);
  assert.equal(result.persistedCount, 2);
  assert.equal(result.validations.length, 2);

  // Retrieve saved rows and test against TypeScript buildPersistedValidationResponse
  const savedRowsRes = await db.query(`
    SELECT * FROM public.cross_document_validations
    WHERE student_id = $1
    ORDER BY validation_type;
  `, [studentId]);

  const appResponse = buildPersistedValidationResponse(savedRowsRes.rows);
  assert.ok(appResponse.consolidated);
  assert.equal(appResponse.consolidated.validation_type, "CONSOLIDATED_SHS");
  assert.equal(appResponse.consolidated.status, "MATCH");
  assert.deepEqual(appResponse.matrix, [{ field: "first_name", status: "MATCH" }]);
  assert.equal(appResponse.pairwiseResults.length, 1);
  assert.equal(appResponse.pairwiseResults[0].validationType, "SF1_SF2");
});

test("7. Resolved historical records remain preserved across repeat writes", async () => {
  const db = await createDisposableDatabase();
  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8"));

  const studentRes = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000006', 'Isagani', 'Student', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = studentRes.rows[0].id;

  const payload = {
    student_id: studentId,
    school_id: SCHOOL_ID,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    section: "Diamond",
    semester: "1st Semester",
    validation_type: "SF1_SF2",
    persistence_key: "PAIR|SF1_SF2|1st Semester||",
    comparison_results: [{ initial: true }],
    discrepancy_details: [],
    status: "MISMATCH",
    needs_human_review: true,
  };

  // Initial insert
  await db.query(
    "SELECT public.persist_cross_document_validation_batch($1::jsonb);",
    [JSON.stringify([payload])]
  );

  // Teacher resolves the issue
  await db.query(`
    UPDATE public.cross_document_validations
    SET status = 'RESOLVED',
        resolved_by = $2,
        resolved_at = TIMESTAMPTZ '2026-02-01 10:00:00+00',
        resolution_notes = 'Adviser confirmed manual attendance ledger'
    WHERE student_id = $1 AND persistence_key = $3;
  `, [studentId, TEACHER_ID, payload.persistence_key]);

  // Subsequent batch write with updated status MISMATCH
  await db.query(
    "SELECT public.persist_cross_document_validation_batch($1::jsonb);",
    [JSON.stringify([{
      ...payload,
      status: "MISMATCH",
      comparison_results: [{ overwritten: false }],
    }])]
  );

  const afterWrite = await db.query(`
    SELECT status, comparison_results, resolved_by, resolved_at, resolution_notes
    FROM public.cross_document_validations
    WHERE student_id = $1 AND persistence_key = $2;
  `, [studentId, payload.persistence_key]);

  assert.equal(afterWrite.rows[0].status, "RESOLVED", "RESOLVED status must not be overwritten.");
  assert.equal(afterWrite.rows[0].resolved_by, TEACHER_ID);
  assert.equal(afterWrite.rows[0].resolution_notes, "Adviser confirmed manual attendance ledger");
  assert.deepEqual(afterWrite.rows[0].comparison_results, [{ initial: true }]);
});

test("8. Multiple SF9/SF10 records remain correctly separated by semester and academic context", async () => {
  const db = await createDisposableDatabase();
  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8"));

  const studentRes = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000007', 'Paulita', 'Gomez', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = studentRes.rows[0].id;

  const doc1 = "d1000000-0000-0000-0000-000000000001";
  const doc2 = "d2000000-0000-0000-0000-000000000002";
  const doc3 = "d3000000-0000-0000-0000-000000000003";
  const doc4 = "d4000000-0000-0000-0000-000000000004";

  await db.query(`
    INSERT INTO public.documents (id, student_id, school_id, document_type, image_url, original_filename, school_year, grade_level)
    VALUES
      ($1, $5, $6, 'sf9', 'http://example.com/1', 'sf9_sem1.pdf', '2024-2025', 'Grade 11'),
      ($2, $5, $6, 'sf10', 'http://example.com/2', 'sf10_sem1.pdf', '2024-2025', 'Grade 11'),
      ($3, $5, $6, 'sf9', 'http://example.com/3', 'sf9_sem2.pdf', '2024-2025', 'Grade 11'),
      ($4, $5, $6, 'sf10', 'http://example.com/4', 'sf10_sem2.pdf', '2024-2025', 'Grade 11');
  `, [doc1, doc2, doc3, doc4, studentId, SCHOOL_ID]);

  const sem1Payload = {
    student_id: studentId,
    school_id: SCHOOL_ID,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    section: "Diamond",
    semester: "1st Semester",
    validation_type: "SF9_SF10",
    source_doc1_id: doc1,
    source_doc2_id: doc2,
    persistence_key: `PAIR|SF9_SF10|1st Semester|${doc1}|${doc2}`,
    comparison_results: [{ subject: "Oral Communication", grade: 90 }],
    discrepancy_details: [],
    status: "MATCH",
    needs_human_review: false,
  };

  const sem2Payload = {
    ...sem1Payload,
    semester: "2nd Semester",
    source_doc1_id: doc3,
    source_doc2_id: doc4,
    persistence_key: `PAIR|SF9_SF10|2nd Semester|${doc3}|${doc4}`,
    comparison_results: [{ subject: "Reading and Writing", grade: 88 }],
  };

  const batchRes = await db.query(
    "SELECT public.persist_cross_document_validation_batch($1::jsonb) AS result;",
    [JSON.stringify([sem1Payload, sem2Payload])]
  );
  assert.equal(batchRes.rows[0].result.persistedCount, 2);

  const rows = await db.query(`
    SELECT semester, persistence_key, comparison_results
    FROM public.cross_document_validations
    WHERE student_id = $1 AND validation_type = 'SF9_SF10'
    ORDER BY semester;
  `, [studentId]);

  assert.equal(rows.rows.length, 2);
  assert.equal(rows.rows[0].semester, "1st Semester");
  assert.equal(rows.rows[1].semester, "2nd Semester");
  assert.notEqual(rows.rows[0].persistence_key, rows.rows[1].persistence_key);
});

test("9. Invalid LRN records cannot be persisted as validated learner records", async () => {
  const db = await createDisposableDatabase();
  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8"));

  const nonExistentStudentId = "99999999-9999-9999-9999-999999999999";
  const invalidStudentPayload = {
    student_id: nonExistentStudentId,
    school_id: SCHOOL_ID,
    school_year: "2024-2025",
    grade_level: "Grade 11",
    section: "Diamond",
    semester: "Full Year",
    validation_type: "CONSOLIDATED_SHS",
    persistence_key: "CONSOLIDATED|",
    status: "MATCH",
  };

  // Rejection in database layer via student existence check
  await assert.rejects(
    () => db.query(
      "SELECT public.persist_cross_document_validation_batch($1::jsonb);",
      [JSON.stringify([invalidStudentPayload])]
    ),
    /missing or invalid context or payload fields/i
  );
});

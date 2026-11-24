import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import { ingestRosterDocument } from "../src/lib/upload/rosterIngestion.ts";
import {
  createStagingDocument,
  cleanupStagingDocument,
} from "../src/lib/upload/createStagingDocument.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const MIGRATION_023_PATH = path.resolve(
  rootDir,
  "supabase",
  "migrations",
  "023_shs_roster_documents_and_multi_learner_child_tables.sql"
);
const MIGRATION_024_PATH = path.resolve(
  rootDir,
  "supabase",
  "migrations",
  "024_shs_cross_document_validation_engine.sql"
);
const MIGRATION_028_PATH = path.resolve(
  rootDir,
  "supabase",
  "migrations",
  "028_sf9_learners_observed_values_schema.sql"
);
const MIGRATION_029_PATH = path.resolve(
  rootDir,
  "supabase",
  "migrations",
  "029_reconcile_retry_segment_records.sql"
);

const SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";
const TEACHER_USER_ID = "30000000-0000-0000-0000-000000000003";
const ADMIN_USER_ID = "10000000-0000-0000-0000-000000000001";
const PRINCIPAL_USER_ID = "20000000-0000-0000-0000-000000000002";
const OTHER_TEACHER_ID = "30000000-0000-0000-0000-000000000099";

const ASSIGNMENT_ID = "b0000000-0000-0000-0000-000000000001";
const OTHER_ASSIGNMENT_ID = "b0000000-0000-0000-0000-000000000002";
const TARGET_DOC_ID = "d0000000-0000-0000-0000-000000000001";
const OTHER_DOC_ID = "d0000000-0000-0000-0000-000000000002";
const STUDENT_ID = "c0000000-0000-0000-0000-000000000001";

/**
 * Initializes a real PostgreSQL (PGlite) database using the actual SQL migration
 * definitions from Migration 001, 005, 014, 022, 023, 024, 026, 028, and 029.
 */
async function createRealMigrationDb() {
  const db = new PGlite();

  // 1. Auth Schema, Roles & Session Claims
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated')::TEXT;
    $$ LANGUAGE sql STABLE;

    GRANT SELECT ON TABLE auth.users TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC, anon, authenticated, service_role;

    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION public.normalize_shs_grade_level(raw_grade TEXT)
    RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
    BEGIN
      IF LOWER(COALESCE(raw_grade, '')) LIKE '%11%' THEN RETURN 'Grade 11'; END IF;
      IF LOWER(COALESCE(raw_grade, '')) LIKE '%12%' THEN RETURN 'Grade 12'; END IF;
      RETURN BTRIM(raw_grade);
    END;
    $$;
  `);

  // 2. Base Tables matching Migrations 001, 005, 014, 021a, 022
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
      role TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'Approved'
    );

    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND LOWER(role) IN ('admin', 'administrator') AND account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE TABLE IF NOT EXISTS public.teacher_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      teacher_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
      school_year TEXT NOT NULL,
      grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
      section TEXT NOT NULL,
      strand TEXT,
      assignment_type TEXT NOT NULL DEFAULT 'class_adviser' CHECK (assignment_type IN ('class_adviser', 'subject_teacher')),
      assignment_status TEXT NOT NULL DEFAULT 'active' CHECK (assignment_status IN ('active', 'inactive')),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      grade_level TEXT,
      section TEXT,
      school_year TEXT,
      overall_status TEXT DEFAULT 'Needs Verification',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    -- public.documents with uploaded_by TEXT matching Migration 001 & Migration 026
    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
      teacher_assignment_id UUID REFERENCES public.teacher_assignments(id) ON DELETE SET NULL,
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      document_type TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      storage_path TEXT,
      original_filename TEXT,
      extracted_text TEXT,
      extracted_fields JSONB DEFAULT '{}'::jsonb,
      ocr_model TEXT DEFAULT 'azure-prebuilt-read',
      ocr_confidence NUMERIC DEFAULT 0.95,
      status TEXT NOT NULL DEFAULT 'needs_review' CHECK (
        status IN ('submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected', 'archived')
      ),
      school_year TEXT,
      grade_level TEXT,
      section TEXT,
      track TEXT,
      strand TEXT,
      semester TEXT,
      reporting_month TEXT,
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.document_scans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      scan_version INTEGER NOT NULL DEFAULT 1,
      image_url TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Migration 001 validation_results schema
    CREATE TABLE IF NOT EXISTS public.validation_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
      rule_name TEXT NOT NULL,
      field_name TEXT,
      passed BOOLEAN NOT NULL DEFAULT true,
      expected_value TEXT,
      actual_value TEXT,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Migration 005 / 027 subject_grades schema
    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      q1 NUMERIC,
      q2 NUMERIC,
      q3 NUMERIC,
      q4 NUMERIC,
      final_grade NUMERIC,
      status TEXT CHECK (status IN ('Passed', 'Failed', 'Missing')),
      needs_verification BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    -- Migration 022 student_identity_conflicts schema
    CREATE TABLE IF NOT EXISTS public.student_identity_conflicts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      assignment_id UUID REFERENCES public.teacher_assignments(id) ON DELETE SET NULL,
      conflict_type TEXT NOT NULL CHECK (
        conflict_type IN (
          'SAME_LRN_CONFLICT_NAME',
          'DIFF_LRN_SAME_NAME',
          'SECTION_MISMATCH',
          'STRAND_MISMATCH',
          'GRADE_LEVEL_MISMATCH',
          'MIXED_FRONT_BACK_IDENTITY',
          'OTHER'
        )
      ),
      extracted_lrn TEXT,
      extracted_name TEXT,
      existing_student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      expected_context JSONB NOT NULL DEFAULT '{}'::jsonb,
      extracted_context JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
      resolution_notes TEXT,
      resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      resolved_at TIMESTAMPTZ,
      created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_student_identity_conflicts_open_doc_type
      ON public.student_identity_conflicts (document_id, conflict_type)
      WHERE document_id IS NOT NULL AND status = 'pending';

    -- Migration 014 / 026 authoritative public.audit_logs schema
    CREATE TABLE IF NOT EXISTS public.audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      transaction_id BIGINT DEFAULT txid_current(),
      actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      actor_email TEXT,
      actor_role TEXT NOT NULL DEFAULT 'anonymous',
      actor_school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      actor_school_name TEXT,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      target_label TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED', 'WARNING')),
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      reason TEXT,
      request_id TEXT,
      ip_address TEXT,
      user_agent TEXT
    );
  `);

  // 3. Execute REAL Migration 023, Migration 024, Migration 028, and Migration 029 SQL files
  await db.exec(fs.readFileSync(MIGRATION_023_PATH, "utf-8"));
  await db.exec(fs.readFileSync(MIGRATION_024_PATH, "utf-8"));
  await db.exec(fs.readFileSync(MIGRATION_028_PATH, "utf-8"));

  // 4. Enforce Migration 026 Data Access Control (DAC) Table Grants & Revokes
  await db.exec(`
    -- Base table grants
    GRANT SELECT ON TABLE public.schools, public.user_roles, public.teacher_assignments, public.students TO authenticated, service_role;
    GRANT ALL ON TABLE public.schools, public.user_roles, public.teacher_assignments, public.students TO service_role;

    -- 8.1 public.documents: Revoke hard DELETE from authenticated users
    REVOKE ALL ON TABLE public.documents FROM PUBLIC, anon;
    REVOKE DELETE ON TABLE public.documents FROM authenticated;
    GRANT SELECT, INSERT, UPDATE ON TABLE public.documents TO authenticated;
    GRANT ALL ON TABLE public.documents TO service_role;

    -- 8.2 Child Roster & Validation Tables: Revoke all writes from authenticated users; SELECT only
    REVOKE ALL ON TABLE public.sf1_roster_entries FROM PUBLIC, anon;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.sf1_roster_entries FROM authenticated;
    GRANT SELECT ON TABLE public.sf1_roster_entries TO authenticated;
    GRANT ALL ON TABLE public.sf1_roster_entries TO service_role;

    REVOKE ALL ON TABLE public.sf2_attendance_entries FROM PUBLIC, anon;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.sf2_attendance_entries FROM authenticated;
    GRANT SELECT ON TABLE public.sf2_attendance_entries TO authenticated;
    GRANT ALL ON TABLE public.sf2_attendance_entries TO service_role;

    REVOKE ALL ON TABLE public.sf5_promotion_entries FROM PUBLIC, anon;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.sf5_promotion_entries FROM authenticated;
    GRANT SELECT ON TABLE public.sf5_promotion_entries TO authenticated;
    GRANT ALL ON TABLE public.sf5_promotion_entries TO service_role;

    REVOKE ALL ON TABLE public.psa_identity_records FROM PUBLIC, anon;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.psa_identity_records FROM authenticated;
    GRANT SELECT ON TABLE public.psa_identity_records TO authenticated;
    GRANT ALL ON TABLE public.psa_identity_records TO service_role;

    REVOKE ALL ON TABLE public.cross_document_validations FROM PUBLIC, anon;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.cross_document_validations FROM authenticated;
    GRANT SELECT ON TABLE public.cross_document_validations TO authenticated;
    GRANT ALL ON TABLE public.cross_document_validations TO service_role;

    REVOKE ALL ON TABLE public.field_extraction_traces FROM PUBLIC, anon;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.field_extraction_traces FROM authenticated;
    GRANT SELECT ON TABLE public.field_extraction_traces TO authenticated;
    GRANT ALL ON TABLE public.field_extraction_traces TO service_role;

    -- 8.3 public.audit_logs: ZERO INSERT/UPDATE/DELETE for authenticated users
    REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon;
    REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM authenticated;
    GRANT SELECT ON TABLE public.audit_logs TO authenticated;
    GRANT ALL ON TABLE public.audit_logs TO service_role;
  `);

  // 5. Execute REAL Migration 029 SQL
  await db.exec(fs.readFileSync(MIGRATION_029_PATH, "utf-8"));

  return db;
}

/**
 * Resets and seeds baseline TRIS fixture data before each test so all tests
 * run isolated transactions against the real migration-defined schema.
 */
async function resetAndSeedFixture(db) {
  await db.exec(`
    SET ROLE postgres;
    SET request.jwt.claim.role = 'service_role';
    TRUNCATE TABLE
      public.audit_logs,
      public.cross_document_validations,
      public.field_extraction_traces,
      public.student_identity_conflicts,
      public.learner_observed_values,
      public.sf9_grading_scale_legends,
      public.validation_results,
      public.subject_grades,
      public.psa_identity_records,
      public.sf5_promotion_entries,
      public.sf2_attendance_entries,
      public.sf1_roster_entries,
      public.document_scans,
      public.documents,
      public.students,
      public.teacher_assignments,
      public.user_roles,
      public.schools,
      auth.users
    RESTART IDENTITY CASCADE;

    INSERT INTO auth.users (id, email) VALUES
      ('${TEACHER_USER_ID}', 'teacher@tris.deped.gov.ph'),
      ('${ADMIN_USER_ID}', 'admin@tris.deped.gov.ph'),
      ('${PRINCIPAL_USER_ID}', 'principal@tris.deped.gov.ph'),
      ('${OTHER_TEACHER_ID}', 'other_teacher@tris.deped.gov.ph');

    INSERT INTO public.schools (id, school_id, name) VALUES
      ('${SCHOOL_ID}', '500169', 'Taysan Resettlement Integrated School');

    INSERT INTO public.user_roles (user_id, school_id, role, account_status) VALUES
      ('${TEACHER_USER_ID}', '${SCHOOL_ID}', 'teacher', 'Approved'),
      ('${ADMIN_USER_ID}', '${SCHOOL_ID}', 'admin', 'Approved'),
      ('${PRINCIPAL_USER_ID}', '${SCHOOL_ID}', 'principal', 'Approved'),
      ('${OTHER_TEACHER_ID}', '${SCHOOL_ID}', 'teacher', 'Approved');

    INSERT INTO public.teacher_assignments (
      id, teacher_user_id, school_id, school_year, grade_level, section, assignment_type, assignment_status
    ) VALUES
      ('${ASSIGNMENT_ID}', '${TEACHER_USER_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', 'Diamond', 'class_adviser', 'active'),
      ('${OTHER_ASSIGNMENT_ID}', '${OTHER_TEACHER_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 12', 'Emerald', 'class_adviser', 'active');

    INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level) VALUES
      ('${STUDENT_ID}', '${SCHOOL_ID}', '100000000001', 'Juan', 'Dela Cruz', 'Grade 11');

    INSERT INTO public.documents (
      id, school_id, teacher_assignment_id, document_type, image_url, storage_path,
      original_filename, extracted_text, extracted_fields, school_year, grade_level, section, uploaded_by, status
    ) VALUES
      (
        '${TARGET_DOC_ID}', '${SCHOOL_ID}', '${ASSIGNMENT_ID}', 'sf1',
        'https://supabase.co/storage/v1/object/sign/documents/old.pdf?token=expired',
        'teacher/assignment/SF1_Diamond.pdf',
        'SF1_Diamond.pdf',
        'Initial SF1 Content',
        '{"batch_id": "b1", "segment_id": "seg1"}'::jsonb,
        '2024-2025', 'Grade 11', 'Diamond', '${TEACHER_USER_ID}', 'needs_review'
      ),
      (
        '${OTHER_DOC_ID}', '${SCHOOL_ID}', '${ASSIGNMENT_ID}', 'sf2',
        'https://supabase.co/storage/v1/object/sign/documents/sf2.pdf?token=valid',
        'teacher/assignment/SF2_Diamond.pdf',
        'SF2_Diamond.pdf',
        'Initial SF2 Content',
        '{"batch_id": "b1", "segment_id": "seg2"}'::jsonb,
        '2024-2025', 'Grade 11', 'Diamond', '${TEACHER_USER_ID}', 'needs_review'
      );
  `);
}

async function setAuthContext(db, userId, jwtRole = "authenticated", enforcePgRole = false) {
  const pgRoleStmt = enforcePgRole ? `SET ROLE ${jwtRole};` : `SET ROLE postgres;`;
  await db.exec(`
    ${pgRoleStmt}
    SET request.jwt.claim.sub = '${userId}';
    SET request.jwt.claim.role = '${jwtRole}';
  `);
}

test("AVV Migration 029 — Real Schema, DAC Permissions & Atomic Retry Verification Suite", async (t) => {
  const db = await createRealMigrationDb();

  // ===========================================================================
  // SECTION 1: PROTECTED FIELD TRIGGER & GUC SPOOFING PROTECTION
  // ===========================================================================

  await t.test("T1. Direct UPDATE on protected fields and manual GUC spoofing are BLOCKED by trigger", async () => {
    await resetAndSeedFixture(db);
    await setAuthContext(db, TEACHER_USER_ID, "authenticated");

    // 1a. Direct image_url modification blocked
    await assert.rejects(
      async () => {
        await db.query(`
          UPDATE public.documents
          SET image_url = 'https://malicious.com/tampered.pdf'
          WHERE id = '${TARGET_DOC_ID}';
        `);
      },
      /Cannot alter protected field image_url on an existing document/i
    );

    // 1b. Manual GUC spoofing outside reconcile_retry_segment_document is blocked via PG_CONTEXT
    await assert.rejects(
      async () => {
        await db.exec(`
          SELECT set_config('avv.retry_reconciliation_authorized', '${TARGET_DOC_ID}', false);
          UPDATE public.documents
          SET image_url = 'https://malicious.com/guc_bypass.pdf'
          WHERE id = '${TARGET_DOC_ID}';
        `);
      },
      /Cannot alter protected field image_url on an existing document/i,
      "GUC alone must not bypass trigger outside reconcile_retry_segment_document stack context"
    );

    // 1c. Direct school_year / section modification blocked
    await assert.rejects(
      async () => {
        await db.query(`
          UPDATE public.documents
          SET section = 'TamperedSection'
          WHERE id = '${TARGET_DOC_ID}';
        `);
      },
      /Cannot alter protected field section on an existing document/i
    );
  });

  await t.test("T2. Authorized retry RPC updates image_url through trigger and preserves document ID", async () => {
    await resetAndSeedFixture(db);
    await setAuthContext(db, TEACHER_USER_ID, "authenticated");

    const freshSignedUrl = "https://supabase.co/storage/v1/object/sign/documents/fresh.pdf?token=fresh_1h";
    const res = await db.query(`
      SELECT public.reconcile_retry_segment_document(
        '${TARGET_DOC_ID}'::uuid,
        'Updated SF1 Content'::text,
        '{"batch_id": "b1", "segment_id": "seg1", "retried": true}'::jsonb,
        0.98::numeric,
        'teacher/assignment/SF1_Diamond.pdf'::text,
        '${freshSignedUrl}'::text
      ) AS result;
    `);

    assert.equal(res.rows[0].result.success, true);
    assert.equal(res.rows[0].result.document_id, TARGET_DOC_ID);

    const docRes = await db.query(
      `SELECT id, image_url, status, extracted_text FROM public.documents WHERE id = '${TARGET_DOC_ID}';`
    );
    assert.equal(docRes.rows[0].id, TARGET_DOC_ID);
    assert.equal(docRes.rows[0].image_url, freshSignedUrl);
    assert.equal(docRes.rows[0].status, "needs_review");
    assert.equal(docRes.rows[0].extracted_text, "Updated SF1 Content");
  });

  await t.test("T3. Retry with NO image_url change executes cleanly", async () => {
    await resetAndSeedFixture(db);
    await setAuthContext(db, TEACHER_USER_ID, "authenticated");

    const res = await db.query(`
      SELECT public.reconcile_retry_segment_document(
        '${TARGET_DOC_ID}'::uuid,
        'Same Image SF1'::text,
        '{"batch_id": "b1"}'::jsonb,
        0.95::numeric,
        'teacher/assignment/SF1_Diamond.pdf'::text,
        NULL::text
      ) AS result;
    `);

    assert.equal(res.rows[0].result.success, true);
  });

  // ===========================================================================
  // SECTION 2: ROLE & ADVISORY ASSIGNMENT RESTRICTIONS
  // ===========================================================================

  await t.test("T4. Admin and Principal roles are BLOCKED from executing retry and staging cleanup RPCs", async () => {
    await resetAndSeedFixture(db);

    await setAuthContext(db, ADMIN_USER_ID, "authenticated");
    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.reconcile_retry_segment_document(
            '${TARGET_DOC_ID}'::uuid, 'Admin Try'::text, '{}'::jsonb
          );
        `);
      },
      /Administrator role cannot modify or scan student documents/i
    );

    await setAuthContext(db, PRINCIPAL_USER_ID, "authenticated");
    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.reconcile_retry_segment_document(
            '${TARGET_DOC_ID}'::uuid, 'Principal Try'::text, '{}'::jsonb
          );
        `);
      },
      /Principal role is monitoring-only/i
    );
  });

  await t.test("T5. Unassigned teacher cannot retry another section's document", async () => {
    await resetAndSeedFixture(db);
    await setAuthContext(db, OTHER_TEACHER_ID, "authenticated");

    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.reconcile_retry_segment_document(
            '${TARGET_DOC_ID}'::uuid, 'Unauthorized Teacher Try'::text, '{}'::jsonb
          );
        `);
      },
      /officially assigned active advisory section/i
    );
  });

  // ===========================================================================
  // SECTION 3: MIGRATION 024 CROSS-DOCUMENT VALIDATIONS SCHEMA & RESOLUTION PRESERVATION
  // ===========================================================================

  await t.test("T6. cross_document_validations: cleans unresolved rows on source_doc1_id or source_doc2_id while preserving RESOLVED rows", async () => {
    await resetAndSeedFixture(db);

    const thirdDocId = "d0000000-0000-0000-0000-000000000003";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, teacher_assignment_id, document_type, image_url,
        school_year, grade_level, section, uploaded_by, status
      ) VALUES (
        '${thirdDocId}', '${SCHOOL_ID}', '${ASSIGNMENT_ID}', 'sf5', 'https://storage/sf5.pdf',
        '2024-2025', 'Grade 11', 'Diamond', '${TEACHER_USER_ID}', 'needs_review'
      );

      -- 1. Unresolved row where TARGET_DOC_ID is source_doc1_id -> MUST BE CLEANED
      INSERT INTO public.cross_document_validations (
        id, student_id, school_id, school_year, grade_level, semester,
        validation_type, source_doc1_id, source_doc2_id, status, needs_human_review
      ) VALUES (
        'f0000000-0000-0000-0000-000000000001', '${STUDENT_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', '1st Semester',
        'SF1_SF2', '${TARGET_DOC_ID}', '${OTHER_DOC_ID}', 'MISMATCH', true
      );

      -- 2. Unresolved row where TARGET_DOC_ID is source_doc2_id -> MUST BE CLEANED
      INSERT INTO public.cross_document_validations (
        id, student_id, school_id, school_year, grade_level, semester,
        validation_type, source_doc1_id, source_doc2_id, status, needs_human_review
      ) VALUES (
        'f0000000-0000-0000-0000-000000000002', '${STUDENT_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', '1st Semester',
        'PSA_SF1', '${OTHER_DOC_ID}', '${TARGET_DOC_ID}', 'NEEDS_VERIFICATION', true
      );

      -- 3. Teacher-RESOLVED row involving TARGET_DOC_ID -> MUST BE PRESERVED WITH METADATA
      INSERT INTO public.cross_document_validations (
        id, student_id, school_id, school_year, grade_level, semester,
        validation_type, source_doc1_id, source_doc2_id, status, needs_human_review,
        resolved_by, resolved_at, resolution_notes
      ) VALUES (
        'f0000000-0000-0000-0000-000000000003', '${STUDENT_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', '1st Semester',
        'SF1_SF5', '${TARGET_DOC_ID}', '${thirdDocId}', 'RESOLVED', false,
        '${TEACHER_USER_ID}', now(), 'Verified by Class Adviser against physicalPSA birth record'
      );

      -- 4. Unrelated validation row between OTHER_DOC_ID and thirdDocId -> MUST BE PRESERVED
      INSERT INTO public.cross_document_validations (
        id, student_id, school_id, school_year, grade_level, semester,
        validation_type, source_doc1_id, source_doc2_id, status, needs_human_review
      ) VALUES (
        'f0000000-0000-0000-0000-000000000004', '${STUDENT_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', '1st Semester',
        'SF5_SF9', '${OTHER_DOC_ID}', '${thirdDocId}', 'MATCH', false
      );
    `);

    await setAuthContext(db, TEACHER_USER_ID, "authenticated");

    await db.query(`
      SELECT public.reconcile_retry_segment_document(
        '${TARGET_DOC_ID}'::uuid,
        'Retried SF1 Content'::text,
        '{"batch_id": "b1", "segment_id": "seg1"}'::jsonb
      );
    `);

    const remainingVals = await db.query(`
      SELECT id, validation_type, status, resolved_by, resolution_notes
      FROM public.cross_document_validations
      ORDER BY id;
    `);

    assert.equal(remainingVals.rows.length, 2, "Only the resolved row and unrelated row must remain");
    assert.equal(remainingVals.rows[0].id, "f0000000-0000-0000-0000-000000000003");
    assert.equal(remainingVals.rows[0].status, "RESOLVED");
    assert.equal(remainingVals.rows[0].resolved_by, TEACHER_USER_ID);
    assert.match(remainingVals.rows[0].resolution_notes, /Verified by Class Adviser/);
    assert.equal(remainingVals.rows[1].id, "f0000000-0000-0000-0000-000000000004");
  });

  // ===========================================================================
  // SECTION 4: STAGING DOCUMENT OWNERSHIP & AUTHORIZATION SECURITY
  // ===========================================================================

  await t.test("T7a. Rejects teacher attempting to use another teacher's staging document", async () => {
    await resetAndSeedFixture(db);

    const otherTeacherStagingId = "d0000000-0000-0000-0000-000000000071";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, teacher_assignment_id, document_type, image_url, status,
        school_year, grade_level, section, uploaded_by, extracted_fields
      ) VALUES (
        '${otherTeacherStagingId}', '${SCHOOL_ID}', '${ASSIGNMENT_ID}', 'sf1', '', 'extracted',
        '2024-2025', 'Grade 11', 'Diamond', '${OTHER_TEACHER_ID}',
        '{"is_retry_staging": true, "retry_target_document_id": "${TARGET_DOC_ID}"}'::jsonb
      );
    `);

    await setAuthContext(db, TEACHER_USER_ID, "authenticated");

    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.reconcile_retry_segment_document(
            '${TARGET_DOC_ID}'::uuid,
            'Hijack Attempt'::text,
            '{}'::jsonb,
            0.95::numeric,
            NULL::text,
            NULL::text,
            '${otherTeacherStagingId}'::uuid
          );
        `);
      },
      /Staging document does not belong to the authenticated teacher/i
    );

    // Ensure other teacher's document was NOT deleted
    const checkDoc = await db.query(`SELECT COUNT(*) FROM public.documents WHERE id = '${otherTeacherStagingId}';`);
    assert.equal(Number(checkDoc.rows[0].count), 1, "Other teacher's document must not be deleted");
  });

  await t.test("T7b. Rejects teacher attempting to use a legitimate non-staging document as staging", async () => {
    await resetAndSeedFixture(db);

    // Seed a legitimate same-teacher, same-section SF1 document with child records
    const legitimateDocId = "d0000000-0000-0000-0000-000000000072";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, teacher_assignment_id, document_type, image_url, status,
        school_year, grade_level, section, uploaded_by, extracted_fields
      ) VALUES (
        '${legitimateDocId}', '${SCHOOL_ID}', '${ASSIGNMENT_ID}', 'sf1', 'https://storage/legit.pdf', 'needs_review',
        '2024-2025', 'Grade 11', 'Diamond', '${TEACHER_USER_ID}',
        '{"batch_id": "b1", "segment_id": "seg-legit"}'::jsonb
      );

      INSERT INTO public.sf1_roster_entries (
        document_id, school_id, school_year, grade_level, section, track, strand, semester,
        lrn, last_name, first_name, sex, row_index, page_number
      ) VALUES (
        '${legitimateDocId}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', 'Diamond', 'Academic', 'STEM', '1st Semester',
        '109999999999', 'Legitimate', 'Learner', 'M', 1, 1
      );
    `);

    await setAuthContext(db, TEACHER_USER_ID, "authenticated");

    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.reconcile_retry_segment_document(
            '${TARGET_DOC_ID}'::uuid,
            'Attempt to cannibalize legitimate doc'::text,
            '{}'::jsonb,
            0.95::numeric,
            NULL::text,
            NULL::text,
            '${legitimateDocId}'::uuid
          );
        `);
      },
      /not a valid temporary retry staging record/i
    );

    // Ensure legitimate document and its child rows remain untouched
    const docCount = await db.query(`SELECT COUNT(*) FROM public.documents WHERE id = '${legitimateDocId}';`);
    const childCount = await db.query(`SELECT COUNT(*) FROM public.sf1_roster_entries WHERE document_id = '${legitimateDocId}';`);
    assert.equal(Number(docCount.rows[0].count), 1, "Legitimate document must not be deleted");
    assert.equal(Number(childCount.rows[0].count), 1, "Legitimate document's child rows must not be stolen");
  });

  await t.test("T7c. Rejects staging document from a different advisory assignment", async () => {
    await resetAndSeedFixture(db);

    const wrongSectionStagingId = "d0000000-0000-0000-0000-000000000073";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, teacher_assignment_id, document_type, image_url, status,
        school_year, grade_level, section, uploaded_by, extracted_fields
      ) VALUES (
        '${wrongSectionStagingId}', '${SCHOOL_ID}', '${OTHER_ASSIGNMENT_ID}', 'sf1', '', 'extracted',
        '2024-2025', 'Grade 12', 'Emerald', '${TEACHER_USER_ID}',
        '{"is_retry_staging": true, "retry_target_document_id": "${TARGET_DOC_ID}"}'::jsonb
      );
    `);

    await setAuthContext(db, TEACHER_USER_ID, "authenticated");

    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.reconcile_retry_segment_document(
            '${TARGET_DOC_ID}'::uuid,
            'Wrong Assignment Staging'::text,
            '{}'::jsonb,
            0.95::numeric,
            NULL::text,
            NULL::text,
            '${wrongSectionStagingId}'::uuid
          );
        `);
      },
      /Staging document advisory assignment context .* does not match target document/i
    );
  });

  await t.test("T7d. Rejects staging document with an incompatible document type", async () => {
    await resetAndSeedFixture(db);

    const wrongTypeStagingId = "d0000000-0000-0000-0000-000000000074";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, teacher_assignment_id, document_type, image_url, status,
        school_year, grade_level, section, uploaded_by, extracted_fields
      ) VALUES (
        '${wrongTypeStagingId}', '${SCHOOL_ID}', '${ASSIGNMENT_ID}', 'sf2', '', 'extracted',
        '2024-2025', 'Grade 11', 'Diamond', '${TEACHER_USER_ID}',
        '{"is_retry_staging": true, "retry_target_document_id": "${TARGET_DOC_ID}"}'::jsonb
      );
    `);

    await setAuthContext(db, TEACHER_USER_ID, "authenticated");

    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.reconcile_retry_segment_document(
            '${TARGET_DOC_ID}'::uuid,
            'Wrong Document Type Staging'::text,
            '{}'::jsonb,
            0.95::numeric,
            NULL::text,
            NULL::text,
            '${wrongTypeStagingId}'::uuid
          );
        `);
      },
      /incompatible with target document type/i
    );
  });

  // ===========================================================================
  // SECTION 5: MIGRATION 026 DAC ENFORCEMENT & SERVER-SIDE AUTHORIZED INGESTION
  // ===========================================================================

  await t.test("T8a. Authenticated child insertion and direct document DELETE are DENIED by Migration 026 DAC", async () => {
    await resetAndSeedFixture(db);

    const stagingDocId = await createStagingDocument({
      db,
      targetDocumentId: TARGET_DOC_ID,
      assignmentId: ASSIGNMENT_ID,
      schoolId: SCHOOL_ID,
      teacherId: TEACHER_USER_ID,
      docType: "sf1",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      extractedText: "SF1 Staging",
      extractedFields: { batch_id: "b1" },
    });

    // Enforce actual PostgreSQL role = 'authenticated'
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);

    // 1. Direct DELETE on public.documents as authenticated is denied
    await assert.rejects(
      async () => {
        await db.query(`DELETE FROM public.documents WHERE id = $1;`, [stagingDocId]);
      },
      /permission denied for table documents/i
    );

    // 2. Calling ingestRosterDocument with an unprivileged authenticated connection fails and is NOT silently ignored
    const sf1Text = `
      School Form 1 (SF1) School Register
      School ID: 500169
      School Year: 2024-2025
      Grade Level: Grade 11
      Section: Diamond
      Track: Academic
      Strand: STEM
      Semester: 1st Semester
      MALE
      100000000001 | Dela Cruz, Juan | M | 2008-05-10 | 16
    `;

    const unprivIngestRes = await ingestRosterDocument({
      db,
      documentId: stagingDocId,
      schoolId: SCHOOL_ID,
      documentType: "sf1",
      extractedText: sf1Text,
      isStaging: true,
      verifiedContext: { schoolYear: "2024-2025", gradeLevel: "Grade 11", section: "Diamond" },
    });

    assert.equal(unprivIngestRes.success, false, "Unprivileged authenticated child insert must fail");
    assert.match(unprivIngestRes.error || "", /permission denied for table sf1_roster_entries/i);

    // 3. Even as ROLE authenticated, cleanupStagingDocument succeeds via SECURITY DEFINER RPC cleanup_failed_retry_staging_document
    const cleanupRes = await cleanupStagingDocument({
      db,
      stagingDocumentId: stagingDocId,
      targetDocumentId: TARGET_DOC_ID,
    });
    assert.equal(cleanupRes.cleaned, true, "Authorized cleanup RPC must remove failed staging document");
  });

  await t.test("T8b. Server-side authorized ingestion preserves verified assignment fields despite conflicting OCR headers", async () => {
    await resetAndSeedFixture(db);
    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);

    const stagingDocId = await createStagingDocument({
      db,
      targetDocumentId: TARGET_DOC_ID,
      assignmentId: ASSIGNMENT_ID,
      schoolId: SCHOOL_ID,
      teacherId: TEACHER_USER_ID,
      docType: "sf1",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      extractedText: "SF1 Text",
      extractedFields: { batch_id: "b1" },
    });

    // OCR text contains conflicting/noisy header values ('2020-2021', 'Grade 12', 'WrongSection')
    const conflictingHeaderOcrText = `
      School Form 1 (SF1) School Register
      School ID: 500169
      School Year: 2020-2021
      Grade Level: Grade 12
      Section: WrongOCRSection
      Track: Academic
      Strand: STEM
      Semester: 1st Semester
      MALE
      100000000001 | Dela Cruz, Juan | M | 2008-05-10 | 16
    `;

    const privIngestRes = await ingestRosterDocument({
      db,
      documentId: stagingDocId,
      schoolId: SCHOOL_ID,
      documentType: "sf1",
      extractedText: conflictingHeaderOcrText,
      isStaging: true,
      verifiedContext: {
        schoolYear: "2024-2025",
        gradeLevel: "Grade 11",
        section: "Diamond",
      },
    });

    assert.equal(privIngestRes.success, true, "Server-side authorized ingestion must succeed");
    assert.equal(privIngestRes.totalLearners, 1);

    // Verify staging document retained verified assignment routing fields and status = 'extracted'
    const docCheck = await db.query(
      `SELECT school_year, grade_level, section, status FROM public.documents WHERE id = $1;`,
      [stagingDocId]
    );
    assert.equal(docCheck.rows[0].school_year, "2024-2025", "Verified school_year preserved");
    assert.equal(docCheck.rows[0].grade_level, "Grade 11", "Verified grade_level preserved");
    assert.equal(docCheck.rows[0].section, "Diamond", "Verified section preserved");
    assert.equal(docCheck.rows[0].status, "extracted", "Staging status preserved");

    // Verify child row also received verified assignment routing fields
    const childCheck = await db.query(
      `SELECT school_year, grade_level, section FROM public.sf1_roster_entries WHERE document_id = $1;`,
      [stagingDocId]
    );
    assert.equal(childCheck.rows.length, 1);
    assert.equal(childCheck.rows[0].school_year, "2024-2025");
    assert.equal(childCheck.rows[0].grade_level, "Grade 11");
    assert.equal(childCheck.rows[0].section, "Diamond");
  });

  // ===========================================================================
  // SECTION 6: FAILED INGESTION PRESERVATION & OBSERVABLE CLEANUP FAILURE
  // ===========================================================================

  await t.test("T9. Failed ingestion preserves existing target child records, and cleanup failures remain observable", async () => {
    await resetAndSeedFixture(db);

    // Seed original valid child records on TARGET_DOC_ID
    await db.exec(`
      INSERT INTO public.sf1_roster_entries (
        document_id, student_id, school_id, school_year, grade_level, section,
        track, strand, semester, lrn, last_name, first_name, sex, row_index, page_number
      ) VALUES (
        '${TARGET_DOC_ID}', '${STUDENT_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', 'Diamond',
        'Academic', 'STEM', '1st Semester', '100000000001', 'Dela Cruz', 'Juan', 'M', 1, 1
      );
    `);

    const stagingDocId = await createStagingDocument({
      db,
      targetDocumentId: TARGET_DOC_ID,
      assignmentId: ASSIGNMENT_ID,
      schoolId: SCHOOL_ID,
      teacherId: TEACHER_USER_ID,
      docType: "sf1",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      extractedText: "Failed Retry Attempt",
      extractedFields: { batch_id: "b1" },
    });

    // Simulate failed ingestion under unprivileged role
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    const failedIngest = await ingestRosterDocument({
      db,
      documentId: stagingDocId,
      schoolId: SCHOOL_ID,
      documentType: "sf1",
      extractedText: "MALE\n100000000001 | Dela Cruz, Juan | M | 2008-05-10 | 16",
      isStaging: true,
    });
    assert.equal(failedIngest.success, false);

    // Target document's existing child records must remain 100% intact
    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);
    const targetChildren = await db.query(
      `SELECT lrn, last_name FROM public.sf1_roster_entries WHERE document_id = '${TARGET_DOC_ID}';`
    );
    assert.equal(targetChildren.rows.length, 1, "Original target child records preserved on failed ingestion");
    assert.equal(targetChildren.rows[0].lrn, "100000000001");

    // Verify cleanup failure observability when both RPC and fallback fail
    const failingDbMock = {
      from() {
        return {
          delete() {
            return {
              eq() {
                return Promise.resolve({ error: { message: "Simulated storage/DB lock timeout" } });
              },
            };
          },
        };
      },
      rpc() {
        return Promise.resolve({ data: null, error: { message: "Simulated RPC connection drop" } });
      },
    };

    const failedCleanupRes = await cleanupStagingDocument({
      db: failingDbMock,
      privilegedDb: failingDbMock,
      stagingDocumentId: stagingDocId,
      targetDocumentId: TARGET_DOC_ID,
    });

    assert.equal(failedCleanupRes.cleaned, false, "Failed cleanup must report cleaned = false");
    assert.match(failedCleanupRes.error || "", /Simulated RPC connection drop/);
    assert.match(failedCleanupRes.error || "", /Simulated storage\/DB lock timeout/);
  });

  // ===========================================================================
  // SECTION 7: SUCCESSFUL STAGING RETRY & TRACE RELATIONSHIP PRESERVATION
  // ===========================================================================

  await t.test("T10. Successful retry transfers staged child records and field_extraction_traces and removes only its own staging doc", async () => {
    await resetAndSeedFixture(db);
    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);

    // Seed old SF1 child row on TARGET_DOC_ID
    await db.exec(`
      INSERT INTO public.sf1_roster_entries (
        document_id, school_id, school_year, grade_level, section,
        track, strand, semester, lrn, last_name, first_name, sex, row_index, page_number
      ) VALUES (
        '${TARGET_DOC_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', 'Diamond',
        'Academic', 'STEM', '1st Semester', '100000000099', 'Old', 'Record', 'M', 1, 1
      );
    `);

    // Create genuine staging document via helper
    const stagingDocId = await createStagingDocument({
      db,
      targetDocumentId: TARGET_DOC_ID,
      assignmentId: ASSIGNMENT_ID,
      schoolId: SCHOOL_ID,
      teacherId: TEACHER_USER_ID,
      docType: "sf1",
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      extractedText: "Replacement SF1 Text",
      extractedFields: { batch_id: "b1", segment_id: "seg1" },
    });

    const replacementOcrText = `
      School Form 1 (SF1) School Register
      School ID: 500169
      School Year: 2024-2025
      Grade Level: Grade 11
      Section: Diamond
      Track: Academic
      Strand: STEM
      Semester: 1st Semester
      MALE
      100000000001 | Dela Cruz, Juan | M | 2008-05-10 | 16
      FEMALE
      100000000002 | Santos, Maria | F | 2008-08-22 | 16
    `;

    const ingestRes = await ingestRosterDocument({
      db,
      documentId: stagingDocId,
      schoolId: SCHOOL_ID,
      documentType: "sf1",
      extractedText: replacementOcrText,
      isStaging: true,
      verifiedContext: { schoolYear: "2024-2025", gradeLevel: "Grade 11", section: "Diamond" },
    });
    assert.equal(ingestRes.success, true);
    assert.equal(ingestRes.totalLearners, 2);

    // Execute reconciliation RPC as authenticated teacher
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    const rpcRes = await db.query(
      `
      SELECT public.reconcile_retry_segment_document(
        $1::uuid,
        'Replacement SF1 Text'::text,
        '{"batch_id": "b1", "segment_id": "seg1"}'::jsonb,
        0.99::numeric,
        'teacher/assignment/SF1_Diamond.pdf'::text,
        'https://supabase.co/storage/v1/object/sign/documents/new.pdf?token=fresh'::text,
        $2::uuid
      ) AS result;
      `,
      [TARGET_DOC_ID, stagingDocId]
    );
    assert.equal(rpcRes.rows[0].result.success, true);

    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);

    // 1. Only the staging document was removed; TARGET_DOC_ID and OTHER_DOC_ID remain
    const stagingExists = await db.query(`SELECT COUNT(*) FROM public.documents WHERE id = $1;`, [stagingDocId]);
    const targetExists = await db.query(`SELECT id, extracted_fields FROM public.documents WHERE id = $1;`, [TARGET_DOC_ID]);
    const otherExists = await db.query(`SELECT COUNT(*) FROM public.documents WHERE id = $1;`, [OTHER_DOC_ID]);

    assert.equal(Number(stagingExists.rows[0].count), 0, "Staging document removed");
    assert.equal(targetExists.rows.length, 1, "Target document preserved");
    assert.equal(targetExists.rows[0].extracted_fields.is_retry_staging, undefined, "Staging marker stripped from target document");
    assert.equal(Number(otherExists.rows[0].count), 1, "Other document untouched");

    // 2. Staged SF1 rows transferred to TARGET_DOC_ID, old row gone
    const newSf1Rows = await db.query(
      `SELECT id, lrn, last_name FROM public.sf1_roster_entries WHERE document_id = $1 ORDER BY lrn;`,
      [TARGET_DOC_ID]
    );
    assert.equal(newSf1Rows.rows.length, 2);
    assert.equal(newSf1Rows.rows[0].lrn, "100000000001");
    assert.equal(newSf1Rows.rows[1].lrn, "100000000002");

    // 3. field_extraction_traces transferred to TARGET_DOC_ID and their record_id matches the transferred sf1_roster_entries.id!
    const traces = await db.query(
      `SELECT record_id, extracted_value FROM public.field_extraction_traces WHERE document_id = $1 ORDER BY extracted_value;`,
      [TARGET_DOC_ID]
    );
    assert.equal(traces.rows.length, 2, "Both extraction traces transferred");
    assert.equal(traces.rows[0].record_id, newSf1Rows.rows[0].id, "Trace 1 record_id relationship preserved");
    assert.equal(traces.rows[1].record_id, newSf1Rows.rows[1].id, "Trace 2 record_id relationship preserved");
  });

  // ===========================================================================
  // SECTION 8: FULL CHILD COVERAGE, ROLLBACK ATOMICITY & AUTHORITATIVE AUDIT LOGS
  // ===========================================================================

  await t.test("T11. Direct child replacement, mid-transaction rollback atomicity, and Migration 014/026 audit log verification", async () => {
    await resetAndSeedFixture(db);

    // Seed initial grades, observed values, legends, and validation_results
    await db.exec(`
      INSERT INTO public.subject_grades (document_id, subject, q1, q2, final_grade) VALUES
        ('${TARGET_DOC_ID}', 'Original Subject 1', 85, 85, 85),
        ('${TARGET_DOC_ID}', 'Original Subject 2', 88, 88, 88);

      INSERT INTO public.learner_observed_values (
        document_id, school_id, core_value, core_value_index, behavior_statement, quarter, original_mark, normalized_rating
      ) VALUES (
        '${TARGET_DOC_ID}', '${SCHOOL_ID}', 'Maka-Diyos', 1, 'Expresses spiritual beliefs', 'Q1', 'SO', 'SO'
      );

      INSERT INTO public.sf9_grading_scale_legends (document_id, descriptor, grading_scale, remarks) VALUES
        ('${TARGET_DOC_ID}', 'Satisfactory', '80-84', 'Passed');

      INSERT INTO public.validation_results (document_id, rule_name, passed, message) VALUES
        ('${TARGET_DOC_ID}', 'GRADE_RANGE_CHECK', true, 'All grades valid');
    `);

    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);

    // 1. Mid-transaction failure rolls back completely without losing original records
    const corruptGrades = JSON.stringify([
      { subject: "Valid Subject", q1: 90, q2: 90, final_grade: 90 },
      { subject: "Corrupted Subject", q1: "NOT_A_NUMBER", q2: 90, final_grade: 90 },
    ]);

    await assert.rejects(
      async () => {
        await db.query(`
          SELECT public.reconcile_retry_segment_document(
            '${TARGET_DOC_ID}'::uuid,
            'Corrupted Attempt'::text,
            '{}'::jsonb,
            0.95::numeric,
            NULL::text,
            NULL::text,
            NULL::uuid,
            '${corruptGrades}'::jsonb
          );
        `);
      },
      /invalid input syntax for type numeric/i
    );

    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);
    const gradesAfterRollback = await db.query(
      `SELECT subject FROM public.subject_grades WHERE document_id = '${TARGET_DOC_ID}' ORDER BY subject;`
    );
    assert.equal(gradesAfterRollback.rows.length, 2, "Original grades preserved after rollback");
    assert.equal(gradesAfterRollback.rows[0].subject, "Original Subject 1");

    // 2. Valid retry replaces grades, observed values, and legends, clears validation_results, and records audit log
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    const validGrades = JSON.stringify([
      { subject: "General Mathematics", q1: 94, q2: 96, final_grade: 95 },
    ]);
    const validObservedValues = JSON.stringify([
      {
        core_value: "Makabansa",
        core_value_index: 4,
        behavior_statement: "Demonstrates pride in being a Filipino",
        quarter: "Q1",
        original_mark: "AO",
        normalized_rating: "AO",
      },
    ]);
    const validLegends = JSON.stringify([
      { descriptor: "Outstanding", grading_scale: "90-100", remarks: "Passed" },
    ]);

    await db.query(`
      SELECT public.reconcile_retry_segment_document(
        '${TARGET_DOC_ID}'::uuid,
        'Clean SF9 Retry'::text,
        '{"batch_id": "b1"}'::jsonb,
        0.99::numeric,
        NULL::text,
        NULL::text,
        NULL::uuid,
        '${validGrades}'::jsonb,
        NULL::jsonb,
        '${validObservedValues}'::jsonb,
        '${validLegends}'::jsonb
      );
    `);

    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);
    const finalGrades = await db.query(`SELECT subject, final_grade FROM public.subject_grades WHERE document_id = '${TARGET_DOC_ID}';`);
    const finalOv = await db.query(`SELECT core_value, normalized_rating FROM public.learner_observed_values WHERE document_id = '${TARGET_DOC_ID}';`);
    const finalLeg = await db.query(`SELECT descriptor FROM public.sf9_grading_scale_legends WHERE document_id = '${TARGET_DOC_ID}';`);
    const finalVal = await db.query(`SELECT COUNT(*) FROM public.validation_results WHERE document_id = '${TARGET_DOC_ID}';`);
    const auditLogs = await db.query(
      `SELECT actor_user_id, actor_role, school_id, category, action, outcome, target_id, details FROM public.audit_logs WHERE target_id = '${TARGET_DOC_ID}';`
    );

    assert.equal(finalGrades.rows.length, 1);
    assert.equal(finalGrades.rows[0].subject, "General Mathematics");
    assert.equal(finalOv.rows.length, 1);
    assert.equal(finalOv.rows[0].core_value, "Makabansa");
    assert.equal(finalLeg.rows.length, 1);
    assert.equal(finalLeg.rows[0].descriptor, "Outstanding");
    assert.equal(Number(finalVal.rows[0].count), 0);

    assert.equal(auditLogs.rows.length, 1, "Authoritative Migration 014/026 audit log entry recorded");
    assert.equal(auditLogs.rows[0].actor_user_id, TEACHER_USER_ID);
    assert.equal(auditLogs.rows[0].actor_role, "teacher");
    assert.equal(auditLogs.rows[0].action, "RETRY_DOCUMENT_SEGMENT");
    assert.equal(auditLogs.rows[0].outcome, "SUCCESS");
  });

  // ===========================================================================
  // SECTION 8b: STRICT ASSIGNMENT MATCHING, NULL-SAFE STAGING VALIDATION,
  //             CLEANUP RPC AUTHORIZATION & RESOLVED VALIDATION PRESERVATION
  //             (all executed against the real Migration 029 SQL in PGlite)
  // ===========================================================================

  const STAGING_ID = "d0000000-0000-0000-0000-000000000081";

  /** Inserts a staging row as postgres/service_role with optional overrides (raw SQL literals). */
  async function insertStagingRow(overrides = {}) {
    const v = {
      id: `'${STAGING_ID}'`,
      teacher_assignment_id: `'${ASSIGNMENT_ID}'`,
      document_type: `'sf1'`,
      status: `'extracted'`,
      school_year: `'2024-2025'`,
      grade_level: `'Grade 11'`,
      section: `'Diamond'`,
      uploaded_by: `'${TEACHER_USER_ID}'`,
      extracted_fields: `'{"is_retry_staging": true, "retry_target_document_id": "${TARGET_DOC_ID}"}'::jsonb`,
      ...overrides,
    };
    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, teacher_assignment_id, document_type, image_url, status,
        school_year, grade_level, section, uploaded_by, extracted_fields
      ) VALUES (
        ${v.id}, '${SCHOOL_ID}', ${v.teacher_assignment_id}, ${v.document_type}, '', ${v.status},
        ${v.school_year}, ${v.grade_level}, ${v.section}, ${v.uploaded_by}, ${v.extracted_fields}
      );
    `);
  }

  async function callRetryWithStaging(stagingId = STAGING_ID) {
    return db.query(`
      SELECT public.reconcile_retry_segment_document(
        '${TARGET_DOC_ID}'::uuid,
        'Staged Retry'::text,
        '{"batch_id": "b1"}'::jsonb,
        0.95::numeric,
        NULL::text,
        NULL::text,
        '${stagingId}'::uuid
      ) AS result;
    `);
  }

  async function callCleanup(stagingId = STAGING_ID, targetId = TARGET_DOC_ID) {
    return db.query(
      `SELECT public.cleanup_failed_retry_staging_document($1::uuid, $2::uuid) AS result;`,
      [stagingId, targetId]
    );
  }

  async function countDoc(id) {
    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);
    const r = await db.query(`SELECT COUNT(*) FROM public.documents WHERE id = $1;`, [id]);
    return Number(r.rows[0].count);
  }

  async function setTargetAssignmentNull() {
    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);
    await db.exec(`UPDATE public.documents SET teacher_assignment_id = NULL WHERE id = '${TARGET_DOC_ID}';`);
  }

  await t.test("T13a. Target assignment ID set + staging assignment ID NULL is REJECTED", async () => {
    await resetAndSeedFixture(db);
    await insertStagingRow({ teacher_assignment_id: "NULL" });
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    await assert.rejects(() => callRetryWithStaging(), /teacher_assignment_id does not match target document/i);
    assert.equal(await countDoc(STAGING_ID), 1, "Rejected staging row untouched");
    assert.equal(await countDoc(TARGET_DOC_ID), 1, "Target untouched");
  });

  await t.test("T13b. Target assignment ID NULL + staging assignment ID set is REJECTED", async () => {
    await resetAndSeedFixture(db);
    await setTargetAssignmentNull();
    await insertStagingRow({ teacher_assignment_id: `'${ASSIGNMENT_ID}'` });
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    await assert.rejects(() => callRetryWithStaging(), /teacher_assignment_id does not match target document/i);
    assert.equal(await countDoc(STAGING_ID), 1);
  });

  await t.test("T13c. Both assignment IDs set but different (same advisory context) is REJECTED", async () => {
    await resetAndSeedFixture(db);
    await insertStagingRow({ teacher_assignment_id: `'${OTHER_ASSIGNMENT_ID}'` });
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    await assert.rejects(() => callRetryWithStaging(), /teacher_assignment_id does not match target document/i);
    assert.equal(await countDoc(STAGING_ID), 1);
  });

  await t.test("T13d. Both assignment IDs equal is ACCEPTED and only the staging row is removed", async () => {
    await resetAndSeedFixture(db);
    await insertStagingRow();
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    const res = await callRetryWithStaging();
    assert.equal(res.rows[0].result.success, true);
    assert.equal(await countDoc(STAGING_ID), 0, "Staging removed");
    assert.equal(await countDoc(TARGET_DOC_ID), 1, "Target preserved");
    assert.equal(await countDoc(OTHER_DOC_ID), 1, "Unrelated document preserved");
  });

  await t.test("T13e. Both assignment IDs NULL: accepted only with valid caller assignment context", async () => {
    await resetAndSeedFixture(db);
    await setTargetAssignmentNull();
    await insertStagingRow({ teacher_assignment_id: "NULL" });

    // Teacher without a matching active Diamond / Grade 11 / 2024-2025 assignment is rejected
    await setAuthContext(db, OTHER_TEACHER_ID, "authenticated", true);
    await assert.rejects(() => callRetryWithStaging(), /officially assigned active advisory section/i);
    assert.equal(await countDoc(STAGING_ID), 1);

    // Assigned Class Adviser with matching advisory context is accepted
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    const res = await callRetryWithStaging();
    assert.equal(res.rows[0].result.success, true);
    assert.equal(await countDoc(STAGING_ID), 0);
    assert.equal(await countDoc(TARGET_DOC_ID), 1);
  });

  await t.test("T14a. NULL staging status is explicitly REJECTED by retry and cleanup RPCs (schema-drift simulation)", async () => {
    await resetAndSeedFixture(db);
    // public.documents.status is NOT NULL in Migration 001; drop it temporarily to prove the
    // RPCs do not rely on `NOT IN` (which yields NULL, i.e. a silent pass, for NULL status).
    await db.exec(`SET ROLE postgres; ALTER TABLE public.documents ALTER COLUMN status DROP NOT NULL;`);
    try {
      await insertStagingRow({ status: "NULL" });

      await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
      await assert.rejects(() => callRetryWithStaging(), /status is NULL/i);
      await assert.rejects(() => callCleanup(), /not a temporary retry staging record/i);
      assert.equal(await countDoc(STAGING_ID), 1, "NULL-status row must not be consumed or deleted");
      assert.equal(await countDoc(TARGET_DOC_ID), 1);
    } finally {
      await db.exec(`
        SET ROLE postgres;
        DELETE FROM public.documents WHERE status IS NULL;
        ALTER TABLE public.documents ALTER COLUMN status SET NOT NULL;
      `);
    }
  });

  await t.test("T14b. Missing or false retry marker is REJECTED", async () => {
    await resetAndSeedFixture(db);
    await insertStagingRow({
      extracted_fields: `'{"retry_target_document_id": "${TARGET_DOC_ID}"}'::jsonb`,
    });
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    await assert.rejects(() => callRetryWithStaging(), /not a valid temporary retry staging record/i);
    await assert.rejects(() => callCleanup(), /not a temporary retry staging record/i);
    assert.equal(await countDoc(STAGING_ID), 1);

    await resetAndSeedFixture(db);
    await insertStagingRow({
      extracted_fields: `'{"is_retry_staging": false, "retry_target_document_id": "${TARGET_DOC_ID}"}'::jsonb`,
    });
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    await assert.rejects(() => callRetryWithStaging(), /not a valid temporary retry staging record/i);
    assert.equal(await countDoc(STAGING_ID), 1);
  });

  await t.test("T14c. Wrong retry target ID is REJECTED by retry and cleanup RPCs", async () => {
    await resetAndSeedFixture(db);
    await insertStagingRow({
      extracted_fields: `'{"is_retry_staging": true, "retry_target_document_id": "${OTHER_DOC_ID}"}'::jsonb`,
    });
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    await assert.rejects(() => callRetryWithStaging(), /not a valid temporary retry staging record/i);
    await assert.rejects(() => callCleanup(STAGING_ID, TARGET_DOC_ID), /not a temporary retry staging record/i);
    assert.equal(await countDoc(STAGING_ID), 1);
    assert.equal(await countDoc(TARGET_DOC_ID), 1);
  });

  await t.test("T14d. Missing / empty staging document_type is REJECTED", async () => {
    // Defense layer 1: the real Migration 023 CHECK constraints (documents_document_type_check,
    // chk_documents_roster_student_null) already refuse empty / whitespace document_type at INSERT.
    await resetAndSeedFixture(db);
    await assert.rejects(
      () => insertStagingRow({ document_type: "''" }),
      /violates check constraint "(documents_document_type_check|chk_documents_roster_student_null)"/i
    );

    // Defense layer 2: simulate schema drift (constraints + NOT NULL absent) and prove the
    // Migration 029 RPC independently rejects empty, whitespace, and NULL document_type.
    await db.exec(`
      SET ROLE postgres;
      ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_roster_student_null;
      ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
      ALTER TABLE public.documents ALTER COLUMN document_type DROP NOT NULL;
    `);
    try {
      for (const emptyType of ["''", "'   '", "NULL"]) {
        await resetAndSeedFixture(db);
        await insertStagingRow({ document_type: emptyType });
        await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
        await assert.rejects(
          () => callRetryWithStaging(),
          /staging document: document_type is missing or empty/i,
          `document_type ${emptyType} must be rejected`
        );
        assert.equal(await countDoc(STAGING_ID), 1);
        assert.equal(await countDoc(TARGET_DOC_ID), 1);
      }
    } finally {
      await db.exec(`
        SET ROLE postgres;
        DELETE FROM public.documents WHERE document_type IS NULL OR BTRIM(document_type) = '';
        ALTER TABLE public.documents ALTER COLUMN document_type SET NOT NULL;
        ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
          CHECK (document_type IN ('sf1', 'sf2', 'sf5', 'sf9', 'sf10', 'birth_cert'));
        ALTER TABLE public.documents ADD CONSTRAINT chk_documents_roster_student_null
          CHECK (
            (document_type IN ('sf1', 'sf2', 'sf5') AND student_id IS NULL)
            OR (document_type IN ('sf9', 'sf10', 'birth_cert'))
          );
      `);
    }
  });

  await t.test("T15a. Different teacher cannot clean up another teacher's staging document", async () => {
    await resetAndSeedFixture(db);
    await insertStagingRow();
    await setAuthContext(db, OTHER_TEACHER_ID, "authenticated", true);
    await assert.rejects(() => callCleanup(), /Staging document does not belong to the authenticated teacher/i);
    assert.equal(await countDoc(STAGING_ID), 1);
  });

  await t.test("T15b. Admin cannot call cleanup RPC", async () => {
    await resetAndSeedFixture(db);
    await insertStagingRow();
    await setAuthContext(db, ADMIN_USER_ID, "authenticated", true);
    await assert.rejects(() => callCleanup(), /Only authorized Teachers may clean up retry staging documents/i);
    assert.equal(await countDoc(STAGING_ID), 1);
  });

  await t.test("T15c. Principal cannot call cleanup RPC", async () => {
    await resetAndSeedFixture(db);
    await insertStagingRow();
    await setAuthContext(db, PRINCIPAL_USER_ID, "authenticated", true);
    await assert.rejects(() => callCleanup(), /Only authorized Teachers may clean up retry staging documents/i);
    assert.equal(await countDoc(STAGING_ID), 1);
  });

  await t.test("T15d. Cleanup RPC refuses to delete a legitimate (non-staging) target document", async () => {
    await resetAndSeedFixture(db);
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    await assert.rejects(() => callCleanup(TARGET_DOC_ID, TARGET_DOC_ID), /not a temporary retry staging record/i);
    assert.equal(await countDoc(TARGET_DOC_ID), 1);
  });

  await t.test("T16. Successful staged retry preserves resolved cross_document_validations rows and all resolution metadata", async () => {
    await resetAndSeedFixture(db);
    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);
    await db.exec(`
      INSERT INTO public.cross_document_validations (
        id, student_id, school_id, school_year, grade_level, semester,
        validation_type, source_doc1_id, source_doc2_id, status, needs_human_review,
        resolved_by, resolved_at, resolution_notes
      ) VALUES
      (
        'f0000000-0000-0000-0000-000000000011', '${STUDENT_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', '1st Semester',
        'SF1_SF2', '${TARGET_DOC_ID}', '${OTHER_DOC_ID}', 'RESOLVED', false,
        '${TEACHER_USER_ID}', '2024-09-01T08:00:00Z', 'Resolved: target as source_doc1'
      ),
      (
        'f0000000-0000-0000-0000-000000000012', '${STUDENT_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', '1st Semester',
        'PSA_SF1', '${OTHER_DOC_ID}', '${TARGET_DOC_ID}', 'RESOLVED', false,
        '${TEACHER_USER_ID}', '2024-09-02T08:00:00Z', 'Resolved: target as source_doc2'
      );

      INSERT INTO public.cross_document_validations (
        id, student_id, school_id, school_year, grade_level, semester,
        validation_type, source_doc1_id, source_doc2_id, status, needs_human_review
      ) VALUES (
        'f0000000-0000-0000-0000-000000000013', '${STUDENT_ID}', '${SCHOOL_ID}', '2024-2025', 'Grade 11', '1st Semester',
        'SF1_SF5', '${TARGET_DOC_ID}', '${OTHER_DOC_ID}', 'MISMATCH', true
      );
    `);

    const snapshotSql = `
      SELECT id, status, resolved_by, resolved_at, resolution_notes, source_doc1_id, source_doc2_id, updated_at
      FROM public.cross_document_validations
      WHERE status = 'RESOLVED'
      ORDER BY id;
    `;
    const before = await db.query(snapshotSql);
    assert.equal(before.rows.length, 2);

    await insertStagingRow();
    await setAuthContext(db, TEACHER_USER_ID, "authenticated", true);
    const res = await callRetryWithStaging();
    assert.equal(res.rows[0].result.success, true);

    await setAuthContext(db, TEACHER_USER_ID, "service_role", false);
    const after = await db.query(snapshotSql);
    assert.deepEqual(after.rows, before.rows, "Resolved rows and all resolution metadata must be byte-identical");

    const unresolved = await db.query(
      `SELECT COUNT(*) FROM public.cross_document_validations WHERE id = 'f0000000-0000-0000-0000-000000000013';`
    );
    assert.equal(Number(unresolved.rows[0].count), 0, "Stale unresolved row involving target is invalidated");
    assert.equal(await countDoc(STAGING_ID), 0);
  });

  // ===========================================================================
  // SECTION 9: SIGNED URL FAILURE RECOVERY & PERMANENT URL SECURITY
  // ===========================================================================

  await t.test("T12. Storage URL Recovery: private URLs rejected, expired rejected, placeholder triggered", () => {
    const classifyFallbackUrl = (url) => {
      if (!url || typeof url !== "string") return "";
      const isSignedWithToken = url.includes("/object/sign/") || url.includes("token=");
      const isBase64 = url.startsWith("data:");
      const isPrivateStorage =
        url.includes("/storage/v1/object/documents/") ||
        url.includes("/storage/v1/object/authenticated/documents/");
      const isPermanentHttpUrl =
        (url.startsWith("http://") || url.startsWith("https://")) &&
        !isSignedWithToken &&
        !isPrivateStorage;
      return isPermanentHttpUrl && !isBase64 ? url : "";
    };

    assert.equal(
      classifyFallbackUrl("https://xyz.supabase.co/storage/v1/object/documents/teacher-01/SF1.pdf"),
      "",
      "Private direct storage URL must be rejected"
    );
    assert.equal(
      classifyFallbackUrl("https://xyz.supabase.co/storage/v1/object/authenticated/documents/teacher-01/SF1.pdf"),
      "",
      "Private authenticated storage URL must be rejected"
    );
    assert.equal(
      classifyFallbackUrl("https://xyz.supabase.co/storage/v1/object/sign/documents/SF1.pdf?token=expired"),
      "",
      "Expired signed URL must be rejected"
    );
    assert.equal(
      classifyFallbackUrl("https://deped.gov.ph/templates/sf1_standard.png"),
      "https://deped.gov.ph/templates/sf1_standard.png",
      "Legitimate external public URL is allowed"
    );
  });
});

/**
 * AVV System — Migration 026: Admin Document Restrictions & Storage Hardening Verification Suite
 *
 * Verifies all 9 targeted security and regression requirements:
 * 1. Storage policy inventory: Unrelated storage buckets (e.g., 'avatars') retain their policies;
 *    only policies affecting the 'documents' bucket are cleaned up.
 * 2. Strict metadata verification: NULL school year, grade level, or section denies authorization
 *    in can_teacher_access_document() and archive_review_document().
 * 3. Enrollment-based access bypass: se.adviser_user_id = auth.uid() cannot grant access if
 *    the teacher's assignment is expired or inactive.
 * 4. Child-table access: SELECT on all 6 child tables requires matching the exact active
 *    assignment including school_year. Document association alone cannot bypass assignment rules.
 * 5. Audit log integrity: Authenticated users (Admin, Teachers) cannot directly insert into
 *    public.audit_logs (permission denied). Only service_role and trusted RPCs write audit events.
 * 6. Storage object association: Fuzzy matching is eliminated. Canonical exact path matching
 *    (storage_path = name, image_url = name, or /documents/<name>) is strictly enforced.
 * 7. Protected document fields: BEFORE UPDATE trigger prevents altering routing fields and student_id.
 * 8. Role invariants: Admin and Principal cannot insert, update, or delete documents or storage objects;
 *    Admin can read audit logs and documents; Principal has school-scoped read-only access.
 * 9. Legitimate workflows: Class Advisers can scan, update review fields, and archive assigned documents;
 *    service_role can write OCR child table entries.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const SCHOOL_TRIS_ID = "a0000000-0000-0000-0000-000000000001";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const PRINCIPAL_ID = "22222222-2222-2222-2222-222222222222";
const TEACHER_EINSTEIN_ID = "33333333-3333-3333-3333-333333333333";
const TEACHER_NEWTON_ID = "44444444-4444-4444-4444-444444444444";
const TEACHER_EXPIRED_ID = "55555555-5555-5555-5555-555555555555";

async function setupTestDb() {
  const db = new PGlite();

  // 1. Auth and System Schema Setup
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    ALTER ROLE service_role BYPASSRLS;

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

    CREATE TABLE IF NOT EXISTS storage.buckets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public BOOLEAN DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT REFERENCES storage.buckets(id),
      name TEXT NOT NULL,
      owner UUID REFERENCES auth.users(id),
      metadata JSONB DEFAULT '{}'::jsonb,
      user_metadata JSONB DEFAULT '{}'::jsonb,
      last_accessed_at TIMESTAMPTZ DEFAULT now(),
      version TEXT,
      owner_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION storage.foldername(name text)
    RETURNS text[]
    LANGUAGE plpgsql
    AS $$
    DECLARE
      parts text[];
    BEGIN
      parts := string_to_array(name, '/');
      IF array_length(parts, 1) > 1 THEN
        RETURN parts[1:array_length(parts, 1) - 1];
      ELSE
        RETURN ARRAY[]::text[];
      END IF;
    END;
    $$;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'Approved',
      UNIQUE (user_id, school_id)
    );

    CREATE TABLE IF NOT EXISTS public.teacher_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      teacher_user_id UUID REFERENCES auth.users(id) NOT NULL,
      school_id UUID REFERENCES public.schools(id) NOT NULL,
      assignment_type TEXT NOT NULL CHECK (assignment_type IN ('class_adviser', 'subject_teacher')),
      school_year TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      section TEXT NOT NULL,
      strand_or_track TEXT,
      assignment_status TEXT NOT NULL DEFAULT 'active',
      teacher_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id),
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS public.student_enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      school_id UUID REFERENCES public.schools(id),
      school_year TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      section TEXT NOT NULL,
      adviser_user_id UUID REFERENCES auth.users(id),
      enrollment_status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      school_id UUID REFERENCES public.schools(id),
      document_type TEXT NOT NULL,
      image_url TEXT NOT NULL,
      storage_path TEXT,
      original_filename TEXT,
      school_year TEXT,
      grade_level TEXT,
      section TEXT,
      teacher_assignment_id UUID REFERENCES public.teacher_assignments(id),
      status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (status IN ('submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected', 'archived')),
      uploaded_by TEXT,
      reviewed_by UUID,
      archived_at TIMESTAMPTZ,
      archived_by UUID,
      extracted_fields JSONB DEFAULT '{}'::jsonb,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.sf1_roster_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      school_id UUID REFERENCES public.schools(id),
      school_year TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      section TEXT NOT NULL,
      lrn TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.sf2_attendance_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      school_id UUID REFERENCES public.schools(id),
      school_year TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      section TEXT NOT NULL,
      month TEXT,
      lrn TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.sf5_promotion_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      school_id UUID REFERENCES public.schools(id),
      school_year TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      section TEXT NOT NULL,
      lrn TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.psa_identity_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      student_id UUID REFERENCES public.students(id),
      school_id UUID REFERENCES public.schools(id),
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.cross_document_validations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id),
      student_id UUID REFERENCES public.students(id),
      source_doc1_id UUID REFERENCES public.documents(id),
      source_doc2_id UUID REFERENCES public.documents(id),
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.field_extraction_traces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor_user_id UUID REFERENCES auth.users(id),
      actor_email TEXT,
      actor_role TEXT NOT NULL DEFAULT 'anonymous',
      actor_school_id UUID REFERENCES public.schools(id),
      actor_school_name TEXT,
      school_id UUID REFERENCES public.schools(id),
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      target_label TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED', 'WARNING')),
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      reason TEXT
    );

    -- Helper functions
    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role IN ('admin', 'administrator') AND account_status = 'Approved'
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

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    -- Setup Initial Storage Buckets: 'documents' and unrelated 'avatars', 'badges'
    INSERT INTO storage.buckets (id, name, public) VALUES
      ('documents', 'documents', false),
      ('avatars', 'avatars', true),
      ('badges', 'badges', true)
    ON CONFLICT (id) DO NOTHING;

    -- Enable RLS
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.sf1_roster_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.sf2_attendance_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.sf5_promotion_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.psa_identity_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cross_document_validations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.field_extraction_traces ENABLE ROW LEVEL SECURITY;

    -- Grants
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA storage TO authenticated, service_role;

    -- Create test storage policies to verify precise cleanup vs preservation
    CREATE POLICY "Public read avatars bucket"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars');

    CREATE POLICY "Authenticated insert avatars bucket"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');

    CREATE POLICY "Unrelated multi-bucket in"
      ON storage.objects FOR SELECT
      USING (bucket_id IN ('avatars', 'badges'));

    CREATE POLICY "Unrelated multi-bucket or"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars' OR bucket_id = 'badges');

    CREATE POLICY "Global unconstrained objects policy"
      ON storage.objects FOR SELECT
      USING (auth.role() = 'authenticated');

    CREATE POLICY "Global true objects policy"
      ON storage.objects FOR SELECT
      USING (true);

    CREATE POLICY "Give public access to documents bucket"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'documents');

    CREATE POLICY "Authenticated Users Upload Documents"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'documents' AND auth.role() = 'authenticated');

    CREATE POLICY "Old custom documents policy"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'documents');
  `);

  // Seed Users & Institutions
  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES
      ('${SCHOOL_TRIS_ID}', '500169', 'Taysan Resettlement Integrated School')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO auth.users (id, email) VALUES
      ('${ADMIN_ID}', 'admin@tris.edu.ph'),
      ('${PRINCIPAL_ID}', 'principal@tris.edu.ph'),
      ('${TEACHER_EINSTEIN_ID}', 'teacher.einstein@tris.edu.ph'),
      ('${TEACHER_NEWTON_ID}', 'teacher.newton@tris.edu.ph'),
      ('${TEACHER_EXPIRED_ID}', 'teacher.expired@tris.edu.ph')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, school_id, role, account_status) VALUES
      ('${ADMIN_ID}', '${SCHOOL_TRIS_ID}', 'admin', 'Approved'),
      ('${PRINCIPAL_ID}', '${SCHOOL_TRIS_ID}', 'principal', 'Approved'),
      ('${TEACHER_EINSTEIN_ID}', '${SCHOOL_TRIS_ID}', 'teacher', 'Approved'),
      ('${TEACHER_NEWTON_ID}', '${SCHOOL_TRIS_ID}', 'teacher', 'Approved'),
      ('${TEACHER_EXPIRED_ID}', '${SCHOOL_TRIS_ID}', 'teacher', 'Approved')
    ON CONFLICT (user_id, school_id) DO NOTHING;

    -- Teacher Einstein is active Class Adviser of Grade 11 - Einstein (2024-2025)
    -- Teacher Newton is active Class Adviser of Grade 12 - Newton (2024-2025)
    -- Teacher Expired has an EXPIRED/INACTIVE assignment (status = 'inactive')
    INSERT INTO public.teacher_assignments (id, teacher_user_id, school_id, assignment_type, school_year, grade_level, section, assignment_status, teacher_name)
    VALUES
      ('a1111111-0000-0000-0000-000000000001', '${TEACHER_EINSTEIN_ID}', '${SCHOOL_TRIS_ID}', 'class_adviser', '2024-2025', 'Grade 11', 'Einstein', 'active', 'Prof. Einstein'),
      ('a2222222-0000-0000-0000-000000000002', '${TEACHER_NEWTON_ID}', '${SCHOOL_TRIS_ID}', 'class_adviser', '2024-2025', 'Grade 12', 'Newton', 'active', 'Prof. Newton'),
      ('a5555555-0000-0000-0000-000000000005', '${TEACHER_EXPIRED_ID}', '${SCHOOL_TRIS_ID}', 'class_adviser', '2023-2024', 'Grade 11', 'Galileo', 'inactive', 'Prof. Expired')
    ON CONFLICT (id) DO NOTHING;
    -- Seed standard baseline document for testing
    INSERT INTO public.documents (
      id, school_id, document_type, image_url, status, section, school_year, grade_level, teacher_assignment_id, uploaded_by
    ) VALUES (
      'd1000000-0000-0000-0000-000000000001', '${SCHOOL_TRIS_ID}', 'sf9', 'https://example.com/einstein.jpg', 'needs_review',
      'Einstein', '2024-2025', 'Grade 11', 'a1111111-0000-0000-0000-000000000001', '${TEACHER_EINSTEIN_ID}'
    ) ON CONFLICT (id) DO NOTHING;
  `);

  // 2. Apply Migration 026
  const migration026Path = path.join(
    rootDir,
    "supabase",
    "migrations",
    "026_admin_document_restrictions_and_storage_hardening.sql"
  );
  const migrationSql = fs.readFileSync(migration026Path, "utf8");
  await db.exec(migrationSql);

  return db;
}

// Helper to run query as a specific user under RLS
async function asUser(db, userId, callback) {
  await db.exec(`
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '${userId}';
    SET request.jwt.claim.role = 'authenticated';
  `);
  try {
    return await callback();
  } finally {
    await db.exec(`
      RESET ROLE;
      RESET request.jwt.claim.sub;
      RESET request.jwt.claim.role;
    `);
  }
}

// Helper to test Migration 026 behavior with specific custom storage policies
async function testMigrationWithCustomStoragePolicy(policySql) {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT NULL::UUID; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT 'authenticated'; $$ LANGUAGE sql STABLE;
    CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN DEFAULT false);
    CREATE TABLE IF NOT EXISTS storage.objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id TEXT REFERENCES storage.buckets(id),
      name TEXT NOT NULL,
      owner UUID REFERENCES auth.users(id),
      metadata JSONB DEFAULT '{}'::jsonb,
      user_metadata JSONB DEFAULT '{}'::jsonb,
      last_accessed_at TIMESTAMPTZ DEFAULT now(),
      version TEXT,
      owner_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    INSERT INTO storage.buckets (id, name) VALUES ('documents', 'documents'), ('avatars', 'avatars');
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    ${policySql}
  `);

  const migration026Path = path.join(
    rootDir,
    "supabase",
    "migrations",
    "026_admin_document_restrictions_and_storage_hardening.sql"
  );
  const migrationSql = fs.readFileSync(migration026Path, "utf8");
  return {
    db,
    runMigration: async () => {
      try {
        await db.exec(migrationSql);
      } catch (err) {
        await db.exec("ROLLBACK;");
        throw err;
      }
    }
  };
}

test("Migration 026: Targeted Security & Regression Verification Suite", async (t) => {
  const db = await setupTestDb();

  // ---------------------------------------------------------------------------
  // 1. Storage policy inventory: Legacy and global policies dropped; unrelated & ambiguous policies preserved
  // ---------------------------------------------------------------------------
  await t.test("1a: Legacy documents policies are removed", async () => {
    const res = await db.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname IN (
        'Give public access to documents bucket',
        'Authenticated Users Upload Documents',
        'Old custom documents policy'
      );
    `);
    assert.equal(res.rows.length, 0, "Legacy documents storage policies must be removed");
  });

  await t.test("1b: Global unrestricted policies are dropped", async () => {
    const res = await db.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname IN (
        'Global unconstrained objects policy',
        'Global true objects policy'
      );
    `);
    assert.equal(res.rows.length, 0, "Global unrestricted storage policies must be dropped");
  });

  await t.test("1c: Avatars-only policies are preserved", async () => {
    const res = await db.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname IN (
        'Public read avatars bucket',
        'Authenticated insert avatars bucket'
      );
    `);
    assert.equal(res.rows.length, 2, "Avatars-only storage policies must be preserved");
  });

  await t.test("1d: Unrelated multi-bucket policies with IN are preserved", async () => {
    const res = await db.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Unrelated multi-bucket in';
    `);
    assert.equal(res.rows.length, 1, "Unrelated multi-bucket policies with IN must be preserved");
  });

  await t.test("1e: Unrelated multi-bucket policies with OR are preserved", async () => {
    const res = await db.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Unrelated multi-bucket or';
    `);
    assert.equal(res.rows.length, 1, "Unrelated multi-bucket policies with OR must be preserved");
  });

  await t.test("1f: Dynamic function returning a bucket name causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE OR REPLACE FUNCTION public.current_bucket() RETURNS text AS $$ SELECT 'avatars'; $$ LANGUAGE sql;
      CREATE POLICY "Dynamic function bucket policy"
        ON storage.objects FOR SELECT
        USING (bucket_id = public.current_bucket());
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Dynamic function bucket policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Dynamic function in bucket_id comparison must fail-closed"
    );
  });

  await t.test("1g: current_setting() bucket expression causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE POLICY "Dynamic setting bucket policy"
        ON storage.objects FOR SELECT
        USING (bucket_id = current_setting('app.bucket_id', true));
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Dynamic setting bucket policy" on storage\.objects cannot be proven safe for documents bucket/,
      "current_setting() in bucket_id comparison must fail-closed"
    );
  });

  await t.test("1h: COALESCE-based bucket expression causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE OR REPLACE FUNCTION public.current_bucket() RETURNS text AS $$ SELECT 'avatars'; $$ LANGUAGE sql;
      CREATE POLICY "Dynamic COALESCE bucket policy"
        ON storage.objects FOR SELECT
        USING (bucket_id = COALESCE(public.current_bucket(), 'avatars'));
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Dynamic COALESCE bucket policy" on storage\.objects cannot be proven safe for documents bucket/,
      "COALESCE in bucket_id comparison must fail-closed"
    );
  });

  await t.test("1i: Dynamic ANY function call causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE OR REPLACE FUNCTION public.allowed_buckets() RETURNS text[] AS $$ SELECT ARRAY['avatars']; $$ LANGUAGE sql;
      CREATE POLICY "Dynamic ANY function policy"
        ON storage.objects FOR SELECT
        USING (bucket_id = ANY (public.allowed_buckets()));
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Dynamic ANY function policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Dynamic function in = ANY bucket comparison must fail-closed"
    );
  });

  await t.test("1j: Nested OR expressions cause migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE POLICY "Nested OR with auth policy"
        ON storage.objects FOR SELECT
        USING ((bucket_id = 'avatars' OR auth.role() = 'authenticated') OR bucket_id = 'badges');
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Nested OR with auth policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Nested OR disjunction with unconstrained branches must fail-closed"
    );
  });

  await t.test("1k: AND/OR precedence ambiguity causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE POLICY "Ambiguous AND OR precedence policy"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'avatars' OR auth.role() = 'authenticated' AND bucket_id = 'badges');
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Ambiguous AND OR precedence policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Ambiguous AND/OR precedence must fail-closed"
    );
  });

  await t.test("1l: Owner-restricted policy without bucket_id causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE POLICY "Owner only storage policy"
        ON storage.objects FOR SELECT
        USING (auth.uid() = owner);
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Owner only storage policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Owner-restricted policy without bucket_id condition must fail-closed for manual review"
    );
  });

  await t.test("1l-b: Policy referencing user_metadata without bucket_id causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE POLICY "User metadata storage policy"
        ON storage.objects FOR SELECT
        USING ((user_metadata->>'dept') = 'science');
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "User metadata storage policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Policy referencing user_metadata without bucket_id condition must fail-closed for manual review"
    );
  });

  await t.test("1l-c: Function-based policy without bucket_id causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE OR REPLACE FUNCTION public.is_allowed_storage_user() RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql;
      CREATE POLICY "Custom access policy"
        ON storage.objects FOR SELECT
        USING (public.is_allowed_storage_user());
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Custom access policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Function-based policy without bucket_id condition must fail-closed for manual review"
    );
  });

  await t.test("1l-d: Function comparison policy without bucket_id causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE OR REPLACE FUNCTION public.get_storage_owner() RETURNS uuid AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql;
      CREATE POLICY "Owner function policy"
        ON storage.objects FOR SELECT
        USING (auth.uid() = public.get_storage_owner());
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Owner function policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Function comparison policy without bucket_id condition must fail-closed for manual review"
    );
  });

  await t.test("1l-e: Function with arguments policy without bucket_id causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE OR REPLACE FUNCTION public.can_access_bucket(u uuid) RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql;
      CREATE POLICY "Can access bucket policy"
        ON storage.objects FOR SELECT
        USING (public.can_access_bucket(auth.uid()));
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Can access bucket policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Function with arguments policy without bucket_id condition must fail-closed for manual review"
    );
  });

  await t.test("1l-f: Setting-based policy without bucket_id causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE POLICY "Setting based storage policy"
        ON storage.objects FOR SELECT
        USING (current_setting('app.storage_access', true) = 'enabled');
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Setting based storage policy" on storage\.objects cannot be proven safe for documents bucket/,
      "Setting-based policy without bucket_id condition must fail-closed for manual review"
    );
  });

  await t.test("1m: Negative bucket condition (bucket_id <> 'avatars') causes migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE POLICY "Negative check not equal avatars"
        ON storage.objects FOR SELECT
        USING (bucket_id <> 'avatars');
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Negative check not equal avatars" on storage\.objects cannot be proven safe for documents bucket/,
      "Negative bucket condition (<>) must fail-closed"
    );
  });

  await t.test("1n: CASE expressions that cannot be proven safe cause migration to fail safely", async () => {
    const { runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE POLICY "Ambiguous case expression"
        ON storage.objects FOR SELECT
        USING (CASE WHEN bucket_id = 'avatars' THEN true ELSE false END);
    `);
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Ambiguous case expression" on storage\.objects cannot be proven safe for documents bucket/,
      "Complex CASE expression must fail-closed"
    );
  });

  await t.test("1o: A failed policy review does not leave a partially applied migration", async () => {
    const { db: rollbackDb, runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE TABLE IF NOT EXISTS public.documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status TEXT DEFAULT 'needs_review'
      );
      ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Preexisting doc policy" ON public.documents FOR SELECT USING (true);
      CREATE POLICY "Ambiguous negative policy" ON storage.objects FOR SELECT USING (bucket_id != 'avatars');
    `);

    // Verify migration aborts
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\)/,
      "Migration must abort transaction on ambiguous policy"
    );

    // Verify transaction rollback: pre-existing policy on public.documents was NOT dropped
    const docPolicies = await rollbackDb.query(`
      SELECT policyname FROM pg_policies WHERE tablename = 'documents' AND policyname = 'Preexisting doc policy';
    `);
    assert.equal(docPolicies.rows.length, 1, "Pre-existing public table policy must remain intact after rollback");

    // Verify transaction rollback: migration functions were not committed
    const fnCheck = await rollbackDb.query(`
      SELECT proname FROM pg_proc WHERE proname = 'guard_document_protected_fields';
    `);
    assert.equal(fnCheck.rows.length, 0, "Migration functions must not exist in database after rollback");
  });

  await t.test("1o-b: An ambiguous function-only policy causes abort and rolls back preceding migration changes", async () => {
    const { db: rollbackDb, runMigration } = await testMigrationWithCustomStoragePolicy(`
      CREATE TABLE IF NOT EXISTS public.documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status TEXT DEFAULT 'needs_review'
      );
      ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Preexisting doc policy 2" ON public.documents FOR SELECT USING (true);
      CREATE OR REPLACE FUNCTION public.is_allowed_storage_user() RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql;
      CREATE POLICY "Ambiguous function storage policy" ON storage.objects FOR SELECT USING (public.is_allowed_storage_user());
    `);

    // Verify migration aborts
    await assert.rejects(
      runMigration,
      /MIGRATION ABORTED \(FAIL-CLOSED\): Policy "Ambiguous function storage policy"/,
      "Migration must abort transaction on ambiguous function-only policy"
    );

    // Verify transaction rollback: pre-existing policy on public.documents was NOT dropped
    const docPolicies = await rollbackDb.query(`
      SELECT policyname FROM pg_policies WHERE tablename = 'documents' AND policyname = 'Preexisting doc policy 2';
    `);
    assert.equal(docPolicies.rows.length, 1, "Pre-existing public table policy must remain intact after rollback");

    // Verify transaction rollback: migration functions were not committed
    const fnCheck = await rollbackDb.query(`
      SELECT proname FROM pg_proc WHERE proname = 'guard_document_protected_fields';
    `);
    assert.equal(fnCheck.rows.length, 0, "Migration functions must not exist in database after rollback");
  });

  await t.test("1p: Documents bucket upload restrictions remain enforced", async () => {
    // 1. Authorized Teacher Einstein uploading to own assignment folder succeeds
    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      const allowedPath = `${TEACHER_EINSTEIN_ID}/a1111111-0000-0000-0000-000000000001/doc_upload.jpg`;
      const res = await db.query(`
        INSERT INTO storage.objects (bucket_id, name, owner)
        VALUES ('documents', '${allowedPath}', '${TEACHER_EINSTEIN_ID}')
        RETURNING id;
      `);
      assert.equal(res.rows.length, 1, "Teacher can upload to their active assignment path");
    });

    // 2. Teacher Einstein uploading to another teacher's folder or another assignment path fails
    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      const forbiddenPath = `${TEACHER_NEWTON_ID}/a2222222-0000-0000-0000-000000000002/evil.jpg`;
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO storage.objects (bucket_id, name, owner)
            VALUES ('documents', '${forbiddenPath}', '${TEACHER_EINSTEIN_ID}');
          `);
        },
        /violates row-level security policy/,
        "Teacher cannot upload to another teacher's or assignment's path"
      );
    });

    // 3. Admin cannot upload to documents bucket
    await asUser(db, ADMIN_ID, async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO storage.objects (bucket_id, name, owner)
            VALUES ('documents', '${ADMIN_ID}/admin_upload.jpg', '${ADMIN_ID}');
          `);
        },
        /violates row-level security policy/,
        "Admin cannot upload to documents bucket"
      );
    });

    // 4. Principal cannot upload to documents bucket
    await asUser(db, PRINCIPAL_ID, async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO storage.objects (bucket_id, name, owner)
            VALUES ('documents', '${PRINCIPAL_ID}/principal_upload.jpg', '${PRINCIPAL_ID}');
          `);
        },
        /violates row-level security policy/,
        "Principal cannot upload to documents bucket"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Strict metadata verification: NULL school_year / grade_level / section is denied
  // ---------------------------------------------------------------------------
  await t.test("2a: can_teacher_access_document denies document with NULL school_year or grade_level", async () => {
    const docNullSyId = "d8000000-0000-0000-0000-000000000008";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, document_type, image_url, status, section, school_year, grade_level
      ) VALUES (
        '${docNullSyId}', '${SCHOOL_TRIS_ID}', 'sf9', 'https://example.com/null_sy.jpg', 'needs_review',
        'Einstein', NULL, 'Grade 11'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      const res = await db.query(`SELECT public.can_teacher_access_document('${docNullSyId}') as allowed;`);
      assert.equal(res.rows[0].allowed, false, "NULL school_year must not be treated as an authorization match");
    });
  });

  await t.test("2b: archive_review_document raises verification error when metadata is incomplete", async () => {
    const docNullSyId = "d8000000-0000-0000-0000-000000000008";
    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      await assert.rejects(
        async () => {
          await db.query(`SELECT public.archive_review_document('${docNullSyId}', 'I am deleting this');`);
        },
        /Verification error: Document metadata \(school_year, grade_level, section\) is incomplete/,
        "Incomplete metadata must trigger verification error in archive RPC"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Enrollment-based access bypass: Expired assignment cannot access documents
  // ---------------------------------------------------------------------------
  await t.test("3: Teacher with expired assignment is denied even if listed as enrollment adviser", async () => {
    const studentGalileoId = "c1000000-0000-0000-0000-000000000001";
    const docGalileoId = "d9000000-0000-0000-0000-000000000009";

    await db.exec(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name)
      VALUES ('${studentGalileoId}', '${SCHOOL_TRIS_ID}', '111122223333', 'Galileo', 'Student')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.student_enrollments (student_id, school_id, school_year, grade_level, section, adviser_user_id, enrollment_status)
      VALUES ('${studentGalileoId}', '${SCHOOL_TRIS_ID}', '2023-2024', 'Grade 11', 'Galileo', '${TEACHER_EXPIRED_ID}', 'active')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.documents (
        id, student_id, school_id, document_type, image_url, status, section, school_year, grade_level
      ) VALUES (
        '${docGalileoId}', '${studentGalileoId}', '${SCHOOL_TRIS_ID}', 'sf9', 'https://example.com/galileo.jpg', 'needs_review',
        'Galileo', '2023-2024', 'Grade 11'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    await asUser(db, TEACHER_EXPIRED_ID, async () => {
      // SELECT must return 0 rows
      const selectRes = await db.query(`SELECT id FROM public.documents WHERE id = '${docGalileoId}';`);
      assert.equal(selectRes.rows.length, 0, "Teacher with inactive assignment cannot select document");

      // UPDATE must affect 0 rows
      const updateRes = await db.query(`UPDATE public.documents SET notes = 'Unauthorized update' WHERE id = '${docGalileoId}';`);
      assert.equal(updateRes.rowCount, 0, "Teacher with inactive assignment cannot update document");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Child-table access: Limited to exact active assignment including school_year
  // ---------------------------------------------------------------------------
  await t.test("4a: Teacher cannot select child roster entries from another section", async () => {
    const docNewtonId = "d5000000-0000-0000-0000-000000000005";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, document_type, image_url, status, section, school_year, grade_level, teacher_assignment_id, uploaded_by
      ) VALUES (
        '${docNewtonId}', '${SCHOOL_TRIS_ID}', 'sf1', 'https://example.com/sf1_newton.jpg', 'needs_review',
        'Newton', '2024-2025', 'Grade 12', 'a2222222-0000-0000-0000-000000000002', '${TEACHER_NEWTON_ID}'
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.sf1_roster_entries (document_id, school_id, school_year, grade_level, section, lrn, first_name, last_name)
      VALUES ('${docNewtonId}', '${SCHOOL_TRIS_ID}', '2024-2025', 'Grade 12', 'Newton', '999888777666', 'Isaac', 'Newton')
      ON CONFLICT DO NOTHING;
    `);

    // Teacher Einstein queries sf1_roster_entries for Newton
    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      const res = await db.query(`SELECT id FROM public.sf1_roster_entries WHERE section = 'Newton';`);
      assert.equal(res.rows.length, 0, "Teacher Einstein cannot see Section Newton roster entries");
    });

    // Teacher Newton can see their own section entries
    await asUser(db, TEACHER_NEWTON_ID, async () => {
      const res = await db.query(`SELECT id FROM public.sf1_roster_entries WHERE section = 'Newton';`);
      assert.equal(res.rows.length, 1, "Teacher Newton can see Section Newton roster entries");
    });
  });

  await t.test("4b: Teacher with inactive assignment cannot select child roster entries", async () => {
    const docOldId = "d4000000-0000-0000-0000-000000000004";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, document_type, image_url, status, section, school_year, grade_level
      ) VALUES (
        '${docOldId}', '${SCHOOL_TRIS_ID}', 'sf1', 'https://example.com/old_galileo.jpg', 'needs_review',
        'Galileo', '2023-2024', 'Grade 11'
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.sf1_roster_entries (document_id, school_id, school_year, grade_level, section, lrn, first_name, last_name)
      VALUES ('${docOldId}', '${SCHOOL_TRIS_ID}', '2023-2024', 'Grade 11', 'Galileo', '555444333222', 'Old', 'Learner')
      ON CONFLICT DO NOTHING;
    `);

    await asUser(db, TEACHER_EXPIRED_ID, async () => {
      const res = await db.query(`SELECT id FROM public.sf1_roster_entries WHERE section = 'Galileo';`);
      assert.equal(res.rows.length, 0, "Teacher with inactive assignment cannot read child roster entries");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Audit log integrity: Authenticated users cannot fabricate audit records
  // ---------------------------------------------------------------------------
  await t.test("5: Admin and Teacher cannot directly insert into public.audit_logs", async () => {
    await asUser(db, ADMIN_ID, async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO public.audit_logs (actor_user_id, category, action, outcome)
            VALUES ('${ADMIN_ID}', 'SECURITY', 'FAKE_EVENT', 'SUCCESS');
          `);
        },
        /permission denied for table audit_logs/,
        "Admin direct insert into audit_logs must be denied by table grant"
      );
    });

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO public.audit_logs (actor_user_id, category, action, outcome)
            VALUES ('${TEACHER_EINSTEIN_ID}', 'DOCUMENT', 'FAKE_DELETE', 'SUCCESS');
          `);
        },
        /permission denied for table audit_logs/,
        "Teacher direct insert into audit_logs must be denied by table grant"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Storage object association: Fuzzy matching is rejected; canonical path required
  // ---------------------------------------------------------------------------
  await t.test("6: Fuzzy storage object matching is rejected", async () => {
    const docId = "d1000000-0000-0000-0000-000000000001";
    // Object that contains document ID somewhere, but does NOT match canonical storage path
    const fuzzyObjectName = `${TEACHER_EINSTEIN_ID}/random_folder/prefix_${docId}_fuzzy.jpg`;

    await db.exec(`
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('documents', '${fuzzyObjectName}', '${TEACHER_EINSTEIN_ID}')
      ON CONFLICT DO NOTHING;
    `);

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      const res = await db.query(`SELECT id FROM storage.objects WHERE name = '${fuzzyObjectName}';`);
      assert.equal(res.rows.length, 0, "Fuzzy matching by document ID must be rejected");
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Protected document fields: student_id cannot be forged or altered directly
  // ---------------------------------------------------------------------------
  await t.test("7a: Direct teacher update from NULL to a student ID is rejected", async () => {
    const student1Id = "c1000000-0000-0000-0000-000000000001";
    const docNullStudentId = "d1000000-0000-0000-0000-000000000001";

    // Ensure baseline document has student_id = NULL
    await db.exec(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name)
      VALUES ('${student1Id}', '${SCHOOL_TRIS_ID}', '111122223333', 'Source', 'Student')
      ON CONFLICT (id) DO NOTHING;

      UPDATE public.documents SET student_id = NULL WHERE id = '${docNullStudentId}';
    `);

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            UPDATE public.documents
            SET student_id = '${student1Id}'
            WHERE id = '${docNullStudentId}';
          `);
        },
        /Forbidden: Cannot reassign student_id on an existing document directly/,
        "Direct teacher update from NULL to a student ID must be rejected"
      );
    });
  });

  await t.test("7b: Direct teacher update from one student ID to another is rejected", async () => {
    const student1Id = "c1000000-0000-0000-0000-000000000001";
    const student2Id = "c2000000-0000-0000-0000-000000000002";
    const docId = "d1000000-0000-0000-0000-000000000001";

    // Use service_role (trusted OCR/ingestion) to seed initial student_id
    await db.exec(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name)
      VALUES ('${student2Id}', '${SCHOOL_TRIS_ID}', '222233334444', 'Target', 'Student')
      ON CONFLICT (id) DO NOTHING;

      SET ROLE service_role;
      SET request.jwt.claim.role = 'service_role';
      UPDATE public.documents SET student_id = '${student1Id}' WHERE id = '${docId}';
      RESET ROLE;
      RESET request.jwt.claim.role;
    `);

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            UPDATE public.documents
            SET student_id = '${student2Id}'
            WHERE id = '${docId}';
          `);
        },
        /Forbidden: Cannot reassign student_id on an existing document directly/,
        "Direct teacher update from one student ID to another must be rejected"
      );
    });
  });

  await t.test("7c: Forged GUC does not bypass the trigger", async () => {
    const student2Id = "c2000000-0000-0000-0000-000000000002";
    const docId = "d1000000-0000-0000-0000-000000000001";

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      // Attempt forgery: manually set GUC
      await db.query(`SELECT set_config('avv.conflict_resolution_authorized', '${docId}', false);`);

      try {
        // Attempt direct update with forged GUC
        await assert.rejects(
          async () => {
            await db.query(`
              UPDATE public.documents
              SET student_id = '${student2Id}'
              WHERE id = '${docId}';
            `);
          },
          /Forbidden: Cannot reassign student_id on an existing document directly. Use authorized identity verification workflow./,
          "Forging GUC outside resolve_document_identity_conflict must be rejected"
        );
      } finally {
        await db.query(`SELECT set_config('avv.conflict_resolution_authorized', '', false);`);
      }
    });
  });

  await t.test("7d: Legitimate authorized RPC still succeeds and clears GUC (single-use)", async () => {
    const docId = "d1000000-0000-0000-0000-000000000001";
    const targetLrn = "222233334444"; // Matches student2 seeded earlier

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      const res = await db.query(`
        SELECT public.resolve_document_identity_conflict(
          '${docId}',
          '${targetLrn}',
          'Target',
          'Student',
          NULL,
          'Verified with official DepEd PSA birth record matches learner profile',
          'VERIFY_LRN_AND_IDENTITY'
        ) as result;
      `);
      assert.equal(res.rows[0].result.status, "SUCCESS");

      // Verify GUC was cleared immediately and cannot be reused
      const gucCheck = await db.query(`SELECT current_setting('avv.conflict_resolution_authorized', true) as guc;`);
      assert.equal(gucCheck.rows[0].guc || "", "", "Authorization GUC must be cleared immediately after use");
    });

    // Check DOCUMENT_IDENTITY_CONFLICT_RESOLVED in audit_logs
    const auditCheck = await db.query(`
      SELECT action, outcome FROM public.audit_logs
      WHERE action = 'DOCUMENT_IDENTITY_CONFLICT_RESOLVED' AND target_id = '${docId}';
    `);
    assert.equal(auditCheck.rows.length, 1, "Exactly one identity resolution audit log must be written");
    assert.equal(auditCheck.rows[0].outcome, "SUCCESS");
  });

  await t.test("7e: Admin and Principal cannot modify student_id", async () => {
    const student1Id = "c1000000-0000-0000-0000-000000000001";
    const docId = "d1000000-0000-0000-0000-000000000001";

    // 1. Admin cannot modify student_id (RLS UPDATE matches 0 rows)
    await asUser(db, ADMIN_ID, async () => {
      const res = await db.query(`
        UPDATE public.documents
        SET student_id = '${student1Id}'
        WHERE id = '${docId}';
      `);
      assert.equal(res.rowCount, 0, "Admin cannot update student_id (RLS matches 0 rows)");
    });

    // 2. Principal cannot modify student_id (RLS UPDATE matches 0 rows)
    await asUser(db, PRINCIPAL_ID, async () => {
      const res = await db.query(`
        UPDATE public.documents
        SET student_id = '${student1Id}'
        WHERE id = '${docId}';
      `);
      assert.equal(res.rowCount, 0, "Principal cannot update student_id (RLS matches 0 rows)");
    });
  });

  await t.test("7f: Conflict resolution authorization cannot be reused for another document in the same transaction", async () => {
    const docReuse1 = "da000000-0000-0000-0000-000000000001";
    const docReuse2 = "da000000-0000-0000-0000-000000000002";
    const studentReuse1 = "ca000000-0000-0000-0000-000000000001";
    const studentReuse2 = "ca000000-0000-0000-0000-000000000002";

    await db.exec(`
      INSERT INTO public.students (id, school_id, lrn, first_name, last_name)
      VALUES
        ('${studentReuse1}', '${SCHOOL_TRIS_ID}', '333344445555', 'Learner3', 'Student'),
        ('${studentReuse2}', '${SCHOOL_TRIS_ID}', '444455556666', 'Learner4', 'Student')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.documents (
        id, school_id, student_id, document_type, image_url, status, section, school_year, grade_level, teacher_assignment_id, uploaded_by
      ) VALUES
        ('${docReuse1}', '${SCHOOL_TRIS_ID}', '${studentReuse1}', 'sf9', 'https://example.com/doc_reuse1.jpg', 'needs_review',
        'Einstein', '2024-2025', 'Grade 11', 'a1111111-0000-0000-0000-000000000001', '${TEACHER_EINSTEIN_ID}'),
        ('${docReuse2}', '${SCHOOL_TRIS_ID}', '${studentReuse1}', 'sf9', 'https://example.com/doc_reuse2.jpg', 'needs_review',
        'Einstein', '2024-2025', 'Grade 11', 'a1111111-0000-0000-0000-000000000001', '${TEACHER_EINSTEIN_ID}')
      ON CONFLICT (id) DO NOTHING;
    `);

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      await db.exec("BEGIN;");
      try {
        // Step 1: Legitimate resolution of docReuse1
        const res = await db.query(`
          SELECT public.resolve_document_identity_conflict(
            '${docReuse1}',
            '444455556666',
            'Learner4',
            'Student',
            NULL,
            'Verified official PSA record matches profile exactly',
            'VERIFY_LRN_AND_IDENTITY'
          ) as result;
        `);
        assert.equal(res.rows[0].result.status, "SUCCESS");

        // Step 2: Confirm GUC is now cleared inside the transaction
        const gucRes = await db.query(`SELECT current_setting('avv.conflict_resolution_authorized', true) as guc;`);
        assert.equal(gucRes.rows[0].guc || "", "", "GUC must be empty after consumption");

        // Step 3: Attempt to tamper with another document's student_id in the same transaction
        await assert.rejects(
          async () => {
            await db.query(`
              UPDATE public.documents
              SET student_id = '${studentReuse2}'
              WHERE id = '${docReuse2}';
            `);
          },
          /Forbidden: Cannot reassign student_id on an existing document directly. Use authorized identity verification workflow./,
          "Reusing authorization in same transaction must be blocked"
        );
      } finally {
        await db.exec("COMMIT;");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Role Invariants: Admin and Principal cannot modify documents
  // ---------------------------------------------------------------------------
  await t.test("8a: Admin direct operations on public.documents are blocked", async () => {
    await asUser(db, ADMIN_ID, async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO public.documents (school_id, document_type, image_url, status)
            VALUES ('${SCHOOL_TRIS_ID}', 'sf9', 'https://example.com/admin.jpg', 'submitted');
          `);
        },
        /violates row-level security policy/,
        "Admin direct insert must be blocked by RLS"
      );

      const upd = await db.query(`UPDATE public.documents SET notes = 'Admin mod' WHERE id = 'd1000000-0000-0000-0000-000000000001';`);
      assert.equal(upd.rowCount, 0, "Admin update must match 0 rows under RLS");

      await assert.rejects(
        async () => {
          await db.query(`DELETE FROM public.documents WHERE id = 'd1000000-0000-0000-0000-000000000001';`);
        },
        /permission denied for table documents/,
        "Admin delete must be denied by table-level grant"
      );
    });
  });

  await t.test("8b: Principal direct operations on public.documents are blocked", async () => {
    await asUser(db, PRINCIPAL_ID, async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO public.documents (school_id, document_type, image_url, status)
            VALUES ('${SCHOOL_TRIS_ID}', 'sf9', 'https://example.com/principal.jpg', 'submitted');
          `);
        },
        /violates row-level security policy/,
        "Principal direct insert must be blocked by RLS"
      );

      const upd = await db.query(`UPDATE public.documents SET notes = 'Principal mod' WHERE id = 'd1000000-0000-0000-0000-000000000001';`);
      assert.equal(upd.rowCount, 0, "Principal update must match 0 rows under RLS");

      await assert.rejects(
        async () => {
          await db.query(`DELETE FROM public.documents WHERE school_id = '${SCHOOL_TRIS_ID}';`);
        },
        /permission denied for table documents/,
        "Principal delete must be denied by table-level grant"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Legitimate workflows: Archive review document & OCR processing work
  // ---------------------------------------------------------------------------
  await t.test("9a: Authorized Class Adviser can archive assigned document, logging DOCUMENT_ARCHIVED", async () => {
    const validDocId = "d2000000-0000-0000-0000-000000000002";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, document_type, image_url, status, section, school_year, grade_level, teacher_assignment_id, uploaded_by
      ) VALUES (
        '${validDocId}', '${SCHOOL_TRIS_ID}', 'sf9', 'https://example.com/einstein_valid.jpg', 'needs_review',
        'Einstein', '2024-2025', 'Grade 11', 'a1111111-0000-0000-0000-000000000001', '${TEACHER_EINSTEIN_ID}'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      const res = await db.query(`SELECT public.archive_review_document('${validDocId}', 'I am deleting this') as result;`);
      assert.equal(res.rows[0].result.success, true);
      assert.equal(res.rows[0].result.new_status, "archived");
    });

    // Check status in documents table
    const docCheck = await db.query(`SELECT status FROM public.documents WHERE id = '${validDocId}';`);
    assert.equal(docCheck.rows[0].status, "archived");

    // Check DOCUMENT_ARCHIVED in audit_logs: exactly 1 event
    const auditCheck = await db.query(`SELECT action, target_id FROM public.audit_logs WHERE target_id = '${validDocId}';`);
    assert.equal(auditCheck.rows.length, 1, "Exactly one DOCUMENT_ARCHIVED audit event must be logged");
    assert.equal(auditCheck.rows[0].action, "DOCUMENT_ARCHIVED");
  });

  await t.test("9b: Direct teacher UPDATE setting status = 'archived' is BLOCKED by RLS and trigger", async () => {
    const directDocId = "d3000000-0000-0000-0000-000000000003";
    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, document_type, image_url, status, section, school_year, grade_level, teacher_assignment_id, uploaded_by
      ) VALUES (
        '${directDocId}', '${SCHOOL_TRIS_ID}', 'sf9', 'https://example.com/direct_archive.jpg', 'needs_review',
        'Einstein', '2024-2025', 'Grade 11', 'a1111111-0000-0000-0000-000000000001', '${TEACHER_EINSTEIN_ID}'
      ) ON CONFLICT (id) DO NOTHING;
    `);

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      // 1. Direct update without GUC
      await assert.rejects(
        async () => {
          await db.query(`
            UPDATE public.documents
            SET status = 'archived'
            WHERE id = '${directDocId}';
          `);
        },
        /violates row-level security policy|Forbidden: Documents cannot be directly transitioned to archived status/,
        "Direct update to archived must be rejected by RLS WITH CHECK"
      );

      // 2. Direct update with forged GUC
      await db.query(`SELECT set_config('avv.document_archival_authorized', '${directDocId}', false);`);
      await assert.rejects(
        async () => {
          await db.query(`
            UPDATE public.documents
            SET status = 'archived'
            WHERE id = '${directDocId}';
          `);
        },
        /violates row-level security policy|Forbidden: Documents cannot be directly transitioned to archived status/,
        "Direct update to archived with forged GUC must be rejected"
      );
    });

    // Verify document was NOT archived
    const docCheck = await db.query(`SELECT status FROM public.documents WHERE id = '${directDocId}';`);
    assert.equal(docCheck.rows[0].status, "needs_review", "Document status must remain needs_review");
  });

  await t.test("9c: Archival authorization cannot be reused for another document in the same transaction", async () => {
    const docArchiveTx1 = "db000000-0000-0000-0000-000000000001";
    const docArchiveTx2 = "db000000-0000-0000-0000-000000000002";

    await db.exec(`
      INSERT INTO public.documents (
        id, school_id, document_type, image_url, status, section, school_year, grade_level, teacher_assignment_id, uploaded_by
      ) VALUES
        ('${docArchiveTx1}', '${SCHOOL_TRIS_ID}', 'sf9', 'https://example.com/tx1.jpg', 'needs_review', 'Einstein', '2024-2025', 'Grade 11', 'a1111111-0000-0000-0000-000000000001', '${TEACHER_EINSTEIN_ID}'),
        ('${docArchiveTx2}', '${SCHOOL_TRIS_ID}', 'sf9', 'https://example.com/tx2.jpg', 'needs_review', 'Einstein', '2024-2025', 'Grade 11', 'a1111111-0000-0000-0000-000000000001', '${TEACHER_EINSTEIN_ID}')
      ON CONFLICT (id) DO NOTHING;
    `);

    await asUser(db, TEACHER_EINSTEIN_ID, async () => {
      await db.exec("BEGIN;");
      try {
        // Step 1: Legitimate archival of docArchiveTx1
        const res = await db.query(`SELECT public.archive_review_document('${docArchiveTx1}', 'I am deleting this') as result;`);
        assert.equal(res.rows[0].result.success, true);

        // Step 2: Confirm GUC is now cleared inside the transaction
        const gucRes = await db.query(`SELECT current_setting('avv.document_archival_authorized', true) as guc;`);
        assert.equal(gucRes.rows[0].guc || "", "", "Archival GUC must be empty after consumption");

        // Step 3: Attempt to directly archive docArchiveTx2 in the same transaction
        await assert.rejects(
          async () => {
            await db.query(`
              UPDATE public.documents
              SET status = 'archived'
              WHERE id = '${docArchiveTx2}';
            `);
          },
          /violates row-level security policy|Forbidden: Documents cannot be directly transitioned to archived status/,
          "Reusing archival authorization on another document must be blocked"
        );
      } finally {
        await db.exec("COMMIT;");
      }
    });
  });

  await t.test("9d: Trusted OCR pipeline (service_role) can insert child roster entries", async () => {
    await db.exec(`
      SET ROLE service_role;
      SET request.jwt.claim.role = 'service_role';
    `);
    try {
      const res = await db.query(`
        INSERT INTO public.sf1_roster_entries (
          document_id, school_id, school_year, grade_level, section, lrn, first_name, last_name
        ) VALUES (
          'd1000000-0000-0000-0000-000000000001', '${SCHOOL_TRIS_ID}', '2024-2025', 'Grade 11', 'Einstein', '111222333444', 'OCR', 'Learner'
        ) RETURNING id;
      `);
      assert.equal(res.rows.length, 1, "service_role can insert OCR child entries");
    } finally {
      await db.exec(`
        RESET ROLE;
        RESET request.jwt.claim.role;
      `);
    }
  });
});

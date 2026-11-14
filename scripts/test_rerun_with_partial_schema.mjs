import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

async function testRerunWithPartial() {
  const db = new PGlite();

  // Create full baseline
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT 'authenticated'; $$ LANGUAGE sql STABLE;
    CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      school_id TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      role user_role NOT NULL DEFAULT 'teacher',
      account_status TEXT NOT NULL DEFAULT 'Pending',
      school_id UUID REFERENCES public.schools(id)
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id),
      lrn TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification'
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      school_id UUID REFERENCES public.schools(id),
      document_type TEXT NOT NULL DEFAULT 'SF9',
      status TEXT NOT NULL DEFAULT 'needs_review',
      extracted_fields JSONB DEFAULT '{}'::jsonb,
      reviewed_by UUID REFERENCES auth.users(id) -- ALREADY PRESENT IN PARTIAL SCHEMA!
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      document_id UUID REFERENCES public.documents(id),
      school_year TEXT,
      semester TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
      final_grade NUMERIC,
      status TEXT DEFAULT 'Missing'
    );

    CREATE TABLE IF NOT EXISTS public.eligibility_approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES public.students(id),
      school_id UUID REFERENCES public.schools(id),
      status TEXT DEFAULT 'pending',
      decision TEXT DEFAULT 'APPROVED',
      eligibility_type TEXT DEFAULT 'SHS_ENROLLMENT',
      grade_level TEXT,
      school_year TEXT
    );

    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$ SELECT true; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$ SELECT false; $$ LANGUAGE sql STABLE;
  `);

  console.log("Partial schema initialized (documents.reviewed_by already exists).");

  console.log("\n[1] Executing Migration 014 (014_admin_audit_logs.sql)...");
  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf-8");
  await db.exec(sql014);
  console.log("  ✓ Migration 014 executed cleanly with zero errors!");

  console.log("\n[2] Executing Migration 015 (015_lrn_deduplication_and_grade_updates.sql)...");
  const sql015 = fs.readFileSync("supabase/migrations/015_lrn_deduplication_and_grade_updates.sql", "utf-8");
  await db.exec(sql015);
  console.log("  ✓ Migration 015 executed cleanly with zero errors!");

  // Verify all objects exist
  const res = await db.query(`
    SELECT 'audit_logs' AS tbl, to_regclass('public.audit_logs') IS NOT NULL AS exists
    UNION ALL
    SELECT 'grade_change_history', to_regclass('public.grade_change_history') IS NOT NULL
    UNION ALL
    SELECT 'v_duplicate_students_report', to_regclass('public.v_duplicate_students_report') IS NOT NULL
    UNION ALL
    SELECT 'idx_students_normalized_lrn', to_regclass('public.idx_students_normalized_lrn') IS NOT NULL
    UNION ALL
    SELECT 'idx_subject_grades_composite_active', to_regclass('public.idx_subject_grades_composite_active') IS NOT NULL
  `);
  console.log("\nPost-execution object verification:");
  console.table(res.rows);

  console.log("\n[3] Testing Idempotency: Re-running 014 and 015 a SECOND time...");
  await db.exec(sql014);
  console.log("  ✓ Migration 014 rerun successful (100% idempotent).");
  await db.exec(sql015);
  console.log("  ✓ Migration 015 rerun successful (100% idempotent).");
}

testRerunWithPartial().catch(console.error);

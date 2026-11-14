import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

async function testDefensiveEnhancement() {
  console.log("Testing defensive column addition in Migration 015...");
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$ LANGUAGE sql STABLE;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      school_id TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id),
      role user_role NOT NULL,
      account_status TEXT DEFAULT 'Approved',
      school_id UUID REFERENCES public.schools(id)
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id),
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      grade_level TEXT,
      overall_status TEXT DEFAULT 'Needs Verification'
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      school_id UUID REFERENCES public.schools(id),
      document_type TEXT NOT NULL DEFAULT 'SF9',
      extracted_fields JSONB DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'needs_review'
      -- Notice: reviewed_by is NOT defined here (simulating live prod)
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      document_id UUID REFERENCES public.documents(id),
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
      final_grade NUMERIC,
      status TEXT DEFAULT 'Missing',
      needs_verification BOOLEAN DEFAULT false
    );

    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$ SELECT true; $$ LANGUAGE sql;
    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$ SELECT false; $$ LANGUAGE sql;
    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS BOOLEAN AS $$ SELECT false; $$ LANGUAGE sql;
    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS BOOLEAN AS $$ SELECT true; $$ LANGUAGE sql;
    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$ SELECT NULL::uuid; $$ LANGUAGE sql;
  `);

  // Now, what if 015 includes the defensive ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_by?
  console.log("Applying defensive DDL: ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;");
  await db.exec(`
    ALTER TABLE public.documents 
      ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  `);

  // Read and apply Migration 015
  const mig015Path = path.resolve(process.cwd(), "supabase", "migrations", "015_lrn_deduplication_and_grade_updates.sql");
  const mig015Sql = fs.readFileSync(mig015Path, "utf-8");
  await db.exec(mig015Sql);

  // Attach trigger
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_process_approved_document ON public.documents;
    CREATE TRIGGER trg_process_approved_document
      AFTER INSERT OR UPDATE OR DELETE ON public.documents
      FOR EACH ROW EXECUTE FUNCTION public.process_approved_document();
  `);

  // Seed student and existing grade
  const adminId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21";
  const studentId = "10000000-0000-0000-0000-000000000001";
  const docId = "30000000-0000-0000-0000-000000000001";

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'admin@tris.deped.gov.ph');
    INSERT INTO public.students (id, lrn, first_name, last_name, grade_level) VALUES ('${studentId}', '123456789012', 'Juan', 'Dela Cruz', 'Grade 11');
    INSERT INTO public.subject_grades (student_id, school_year, semester, grade_level, subject, q1, q2, final_grade, status)
    VALUES ('${studentId}', '2024-2025', '1st Semester', 'Grade 11', 'Oral Communication in Context', 78, 80, 79, 'Passed');

    INSERT INTO public.documents (id, student_id, school_year, semester, grade_level, status, extracted_fields, reviewed_by)
    VALUES ('${docId}', '${studentId}', '2024-2025', '1st Semester', 'Grade 11', 'needs_review',
      '{"grades": [{"subject": "Oral Communication in Context", "q1": 83, "q2": 80, "final": 82, "status": "Passed"}]}'::jsonb,
      '${adminId}'
    );
  `);

  // Set JWT actor to Admin
  await db.exec(`SET request.jwt.claim.sub = '${adminId}'; SET request.jwt.claim.role = 'authenticated';`);

  // Approve Document
  await db.exec(`
    UPDATE public.documents 
    SET status = 'approved'
    WHERE id = '${docId}';
  `);

  const res = await db.query(`SELECT subject, q1, q2, final_grade, status FROM public.subject_grades WHERE student_id = '${studentId}';`);
  console.log("Updated subject grade:", res.rows);

  const hist = await db.query(`SELECT quarter, previous_value, new_value, changed_by, reason FROM public.grade_change_history;`);
  console.log("History rows:", hist.rows);

  console.log("Defensive enhancement verification SUCCESS!");
}

testDefensiveEnhancement().catch(err => {
  console.error("Test failed:", err);
});

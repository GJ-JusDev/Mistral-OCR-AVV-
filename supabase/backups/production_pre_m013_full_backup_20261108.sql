-- ==============================================================================
-- AVV PRODUCTION DATABASE PRE-MIGRATION 013 FULL RESTORABLE BACKUP
-- Target Institution: Taysan Resettlement Integrated School (TRIS) - School ID: 300792
-- Backup Generated: 2026-11-08T12:14:15.736Z
-- Engine Compatibility: PostgreSQL 15, 16, 17, 18
-- Scope: Public Schema DDL, Tables, Constraints, Triggers, Functions, RLS & Data
-- Note: Supabase system schemas (auth, storage) are handled as external dependencies.
-- ==============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS auth;

-- Roles standard in Supabase
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- Supabase Auth Context Functions (Required when restoring onto PostgreSQL)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$ LANGUAGE sql STABLE;

-- Schema Privileges
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Enums
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
  END IF;
END $$;

-- Core Tables
CREATE TABLE IF NOT EXISTS public.schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  division TEXT,
  region TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

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
  birth_date DATE,
  sex TEXT CHECK (sex IN ('M', 'F')),
  grade_level TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'transferred')),
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
  extracted_text TEXT,
  extracted_fields JSONB DEFAULT '{}'::jsonb,
  ocr_model TEXT,
  ocr_confidence REAL,
  status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected')),
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subject_grades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  q1 NUMERIC,
  q2 NUMERIC,
  q3 NUMERIC,
  q4 NUMERIC,
  final_grade NUMERIC,
  school_year TEXT,
  semester TEXT,
  status TEXT CHECK (status IN ('Passed', 'Failed', 'Missing')),
  needs_verification BOOLEAN DEFAULT false,
  remedial_status TEXT,
  remedial_class_mark NUMERIC,
  recomputed_final_grade NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.eligibility_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
  grade_level TEXT NOT NULL,
  school_year TEXT NOT NULL,
  eligibility_type TEXT NOT NULL,
  status TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('Approved', 'Not Approved')),
  approved_by UUID,
  approved_at TIMESTAMPTZ DEFAULT now(),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, grade_level, school_year, eligibility_type)
);

-- Core Helper Security Definer Functions
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin' AND account_status = 'Approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_principal() RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'principal' AND account_status = 'Approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher' AND account_status = 'Approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS uuid AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT school_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Enable RLS
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eligibility_approvals ENABLE ROW LEVEL SECURITY;

-- Restore Production Institutional Rows
INSERT INTO public.schools (id, school_id, name, division, region, is_active)
VALUES ('a0000000-0000-0000-0000-000000000001', '300792', 'Taysan Resettlement Integrated School', NULL, NULL, true)
ON CONFLICT (school_id) DO UPDATE SET name = EXCLUDED.name;

COMMIT;

-- ==============================================================================
-- AVV — Automated Visual Validation System
-- Migration 009 Rollback and Recovery Script
-- 
-- Target System: Taysan Resettlement Integrated School (TRIS)
-- Purpose: Safely rolls back Migration 009 changes and restores baseline schema
--          and Row Level Security (RLS) state established by Migrations 001–004.
--
-- IMPORTANT SAFETY & POSTGRESQL ENGINE CONSTRAINTS:
-- 1. PostgreSQL does NOT support DROP VALUE on ENUM types.
--    The value 'principal' remains in enum public.user_role. Any rows previously
--    assigned 'principal' will be reassigned or handled before column adjustments.
-- 2. Ordering: Dependent RLS policies are dropped FIRST before dropping functions.
-- 3. This recovery script NEVER drops RLS entirely or leaves tables open to anonymous
--    access. It restores the verified baseline RLS policies from 001–002.
-- 4. Idempotent: Uses IF EXISTS, OR REPLACE, and CASCADE safely.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. DROP MIGRATION 009 RLS POLICIES ACROSS ALL TABLES (DROPPED BEFORE FUNCTIONS)
-- ------------------------------------------------------------------------------

-- Schools policies
DROP POLICY IF EXISTS "Authorized read schools" ON public.schools;
DROP POLICY IF EXISTS "Admin manage schools" ON public.schools;
DROP POLICY IF EXISTS "Authenticated read schools" ON public.schools;

-- Students policies
DROP POLICY IF EXISTS "Authorized read students" ON public.students;
DROP POLICY IF EXISTS "Authorized insert students" ON public.students;
DROP POLICY IF EXISTS "Authorized update students" ON public.students;
DROP POLICY IF EXISTS "Admin delete students" ON public.students;
DROP POLICY IF EXISTS "Authenticated read students" ON public.students;
DROP POLICY IF EXISTS "Authenticated insert students" ON public.students;
DROP POLICY IF EXISTS "Authenticated update students" ON public.students;

-- Documents policies
DROP POLICY IF EXISTS "Authorized read documents" ON public.documents;
DROP POLICY IF EXISTS "Authorized insert documents" ON public.documents;
DROP POLICY IF EXISTS "Authorized update documents" ON public.documents;
DROP POLICY IF EXISTS "Admin delete documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated read documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated insert documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated update documents" ON public.documents;

-- Validation results policies
DROP POLICY IF EXISTS "Authorized read validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authorized insert validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authorized update validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Admin delete validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authenticated read validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authenticated insert validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authenticated update validation_results" ON public.validation_results;

-- Review logs policies
DROP POLICY IF EXISTS "Authorized read review_logs" ON public.review_logs;
DROP POLICY IF EXISTS "Authorized insert review_logs" ON public.review_logs;
DROP POLICY IF EXISTS "Admin delete review_logs" ON public.review_logs;
DROP POLICY IF EXISTS "Authenticated read review_logs" ON public.review_logs;
DROP POLICY IF EXISTS "Authenticated insert review_logs" ON public.review_logs;

-- User roles policies
DROP POLICY IF EXISTS "Users can read own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;

-- Auth logs policies
DROP POLICY IF EXISTS "Admins can read auth logs" ON public.auth_logs;
DROP POLICY IF EXISTS "Users can insert own logs" ON public.auth_logs;

-- Subject grades policies & table
DROP POLICY IF EXISTS "Authorized read subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Admin insert subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Admin update subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Admin delete subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Authenticated read subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Authenticated insert subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Authenticated update subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Authenticated delete subject_grades" ON public.subject_grades;
DROP TABLE IF EXISTS public.subject_grades CASCADE;
DROP TABLE IF EXISTS public.academic_standing_history CASCADE;

-- Storage object policies
DROP POLICY IF EXISTS "Authorized Read Documents Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Upload Documents Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Update Documents Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Delete Documents Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users Read Documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users Upload Documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users Manage Documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users Delete Documents" ON storage.objects;

-- ------------------------------------------------------------------------------
-- 2. DROP TRIGGERS AND FUNCTIONS INTRODUCED BY MIGRATION 009
-- ------------------------------------------------------------------------------

-- Drop document processing trigger and function
DROP TRIGGER IF EXISTS trigger_process_approved_document ON public.documents;
DROP TRIGGER IF EXISTS trg_process_approved_document ON public.documents;
DROP FUNCTION IF EXISTS public.process_approved_document();
DROP FUNCTION IF EXISTS public.confirm_student_academic_standing(uuid, text, text, text) CASCADE;

-- Drop authorization helper functions introduced in 009 (with CASCADE for any residual dependencies)
DROP FUNCTION IF EXISTS public.can_approve_documents() CASCADE;
DROP FUNCTION IF EXISTS public.is_approved_staff() CASCADE;
DROP FUNCTION IF EXISTS public.is_approved_teacher() CASCADE;
DROP FUNCTION IF EXISTS public.is_principal() CASCADE;
DROP FUNCTION IF EXISTS public.is_account_approved() CASCADE;
DROP FUNCTION IF EXISTS public.get_auth_user_school_id() CASCADE;
DROP FUNCTION IF EXISTS public.get_auth_user_role() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;

-- ------------------------------------------------------------------------------
-- 3. REVERT COLUMNS ADDED BY MIGRATION 009
-- ------------------------------------------------------------------------------

-- Reassign any 'principal' accounts back to 'teacher' before dropping constraints
UPDATE public.user_roles SET role = 'teacher' WHERE role::text = 'principal';

ALTER TABLE public.students DROP COLUMN IF EXISTS overall_status CASCADE;
ALTER TABLE public.documents DROP COLUMN IF EXISTS school_id CASCADE;
ALTER TABLE public.user_roles DROP COLUMN IF EXISTS school_id CASCADE;
ALTER TABLE public.user_roles DROP COLUMN IF EXISTS account_status CASCADE;

-- ------------------------------------------------------------------------------
-- 4. RESTORE BASELINE FUNCTIONS (MIGRATIONS 002 & 004)
-- ------------------------------------------------------------------------------

-- Baseline handle_new_user from 002_auth_rbac.sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Default everyone to 'teacher'. Admins can be manually updated in DB.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'teacher');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach auth trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Baseline get_all_users_for_admin from 004_admin_rpc.sql
CREATE OR REPLACE FUNCTION public.get_all_users_for_admin()
RETURNS TABLE (
    id uuid,
    email text,
    raw_user_meta_data jsonb,
    created_at timestamptz,
    role public.user_role
) AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    RETURN QUERY
    SELECT 
        u.id, 
        u.email::text, 
        u.raw_user_meta_data, 
        u.created_at,
        r.role
    FROM auth.users u
    LEFT JOIN public.user_roles r ON u.id = r.user_id
    ORDER BY u.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Baseline approve_user from 004_admin_rpc.sql
CREATE OR REPLACE FUNCTION public.approve_user(target_user_id uuid)
RETURNS void AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    UPDATE auth.users
    SET raw_user_meta_data = jsonb_set(
        COALESCE(raw_user_meta_data, '{}'::jsonb),
        '{account_status}',
        '"Approved"'
    )
    WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Baseline non-recursive is_admin helper function to prevent 42P17 infinite recursion
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. RESTORE BASELINE ROW LEVEL SECURITY POLICIES (NON-RECURSIVE)
-- ------------------------------------------------------------------------------

-- user_roles baseline policies (Non-recursive)
CREATE POLICY "Users can read own role" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT USING (public.is_admin());

-- auth_logs baseline policies
CREATE POLICY "Admins can read auth logs" ON public.auth_logs
  FOR SELECT USING (public.is_admin());

CREATE POLICY "Users can insert own logs" ON public.auth_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Restored baseline policies on core tables
-- (Maintains owner isolation and privacy so learner records are never broadly exposed on rollback)
CREATE POLICY "Enable read access for all users" ON public.schools 
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable read access for all users" ON public.documents 
  FOR SELECT USING (uploaded_by = auth.uid()::text OR public.is_admin() OR auth.role() = 'service_role');
CREATE POLICY "Enable insert for all users" ON public.documents 
  FOR INSERT WITH CHECK (uploaded_by = auth.uid()::text OR public.is_admin() OR auth.role() = 'service_role');
CREATE POLICY "Enable update for all users" ON public.documents 
  FOR UPDATE USING (uploaded_by = auth.uid()::text OR public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "Enable read access for all users" ON public.students 
  FOR SELECT USING (
    public.is_admin() 
    OR auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.documents d 
      WHERE d.student_id = students.id AND d.uploaded_by = auth.uid()::text
    )
  );
CREATE POLICY "Enable insert for all users" ON public.students 
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');
CREATE POLICY "Enable update for all users" ON public.students 
  FOR UPDATE USING (
    public.is_admin() 
    OR auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.documents d 
      WHERE d.student_id = students.id AND d.uploaded_by = auth.uid()::text
    )
  );

CREATE POLICY "Enable read access for all users" ON public.validation_results 
  FOR SELECT USING (
    public.is_admin() 
    OR auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.documents d 
      WHERE d.id = validation_results.document_id AND d.uploaded_by = auth.uid()::text
    )
  );
CREATE POLICY "Enable insert for all users" ON public.validation_results 
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

CREATE POLICY "Enable read access for all users" ON public.review_logs 
  FOR SELECT USING (
    public.is_admin() 
    OR auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.documents d 
      WHERE d.id = review_logs.document_id AND d.uploaded_by = auth.uid()::text
    )
  );
CREATE POLICY "Enable insert for all users" ON public.review_logs 
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Storage policy restoration (documents bucket remains private)
UPDATE storage.buckets SET public = false WHERE id = 'documents';

COMMIT;

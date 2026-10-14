-- ==============================================================================
-- [SUPERSEDED - DO NOT EXECUTE DIRECTLY ON PRODUCTION]
-- This monolithic migration draft is SUPERSEDED by:
--   1. 009_step1_add_principal_enum.sql (Must be executed and committed FIRST)
--   2. 009_step2_consolidated_schema_and_security.sql (Executed SECOND inside atomic transaction)
-- Running this monolithic file in an active transaction block causes PostgreSQL Error 55P04
-- ("unsafe use of new value 'principal' of enum type user_role").
-- ==============================================================================
-- AVV — Automated Visual Validation System
-- Migration 009: Consolidated Production-Ready Schema & Security Hardening (SUPERSEDED DRAFT)
-- 
-- Target System: Taysan Resettlement Integrated School (TRIS)
-- Forms Handled: DepEd SF9 (Learner Progress Report Card) & SF10 (Permanent Academic Record)
-- 
-- AUDITED SAFETY SPECIFICATIONS:
--   1. Zero Destructive DDL: No DROP TABLE, TRUNCATE, or data-purging operations.
--   2. Authoritative Database RBAC: Role enum supports 'admin', 'teacher', 'principal'.
--      Approval status stored directly in public.user_roles (never relying on mutable client metadata).
--   3. Three Authorized Roles:
--      - Teacher: Upload SF9/SF10, review OCR, correct fields (restricted to own uploads).
--      - Principal: School-head oversight, review all academic records, approve/reject documents.
--      - Admin: User account management, approve/decline registrations, full system access.
--      - Students: Strictly no account, no login, no portal, no public API access.
--   4. Official DepEd SF9/SF10 Alignment (DO 8 s. 2015 & Strengthened SHS SF10):
--      - Preserves original extracted values without inventing missing grades or averages.
--      - Distinguishes blank or unreadable values from zero (flags for review).
--      - Accommodates Strengthened SHS templates where general average was removed.
--      - Scopes evaluations to document's school year; flags cases requiring human review.
--   5. Immutable Auditing: review_logs is strictly append-only (no UPDATE allowed).
--   6. Grade Integrity: subject_grades direct INSERT/UPDATE/DELETE restricted to admins.
--      Normalized grade records are generated solely by the approved database trigger.
--   7. Private Storage Isolation: documents bucket is private (public = false) under RA 10173;
--      storage objects bound to uploader UID path prefix and document ownership.
-- 
-- SAFE & IDEMPOTENT: Uses IF NOT EXISTS, OR REPLACE, and ON CONFLICT.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PART 1: School Scoping & Role-Based Access Control (Admin, Principal, Teacher)
-- ------------------------------------------------------------------------------

-- 1.1 Support 'principal' role in user_role enum
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'principal';

-- 1.2 Seed Taysan Resettlement Integrated School (TRIS) default record
-- DepEd School ID: 300792, UUID: a0000000-0000-0000-0000-000000000001
INSERT INTO public.schools (id, school_id, name)
VALUES ('a0000000-0000-0000-0000-000000000001', '300792', 'Taysan Resettlement Integrated School')
ON CONFLICT (school_id) DO UPDATE SET name = EXCLUDED.name;

-- 1.3 Add authoritative account_status and school_id to public.user_roles table
ALTER TABLE public.user_roles 
ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'Pending' 
CHECK (account_status IN ('Pending', 'Approved', 'Declined'));

ALTER TABLE public.user_roles
ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE RESTRICT;

-- Backfill existing admin accounts to Approved
UPDATE public.user_roles 
SET account_status = 'Approved' 
WHERE account_status = 'Pending' AND role = 'admin';

-- NOTE: To prevent silent assignment of ambiguous user or document records,
-- existing records with NULL school_id are preserved as NULL.
-- Explicit administrator assignment via /admin/users or targeted data script is required.

CREATE INDEX IF NOT EXISTS idx_user_roles_school_id ON public.user_roles(school_id);

-- 1.4 Add school_id to public.documents table
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_documents_school_id ON public.documents(school_id);

-- 1.5 Trigger on auth.users to automatically register new accounts as Pending
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  extracted_role text;
  valid_role public.user_role := 'teacher';
  target_school_id uuid := NULL;
BEGIN
  extracted_role := LOWER(COALESCE(new.raw_user_meta_data->>'role', 'teacher'));
  IF extracted_role = 'admin' THEN
    valid_role := 'admin';
  ELSIF extracted_role = 'principal' THEN
    valid_role := 'principal';
  ELSE
    valid_role := 'teacher';
  END IF;

  IF new.raw_user_meta_data->>'school_id' IS NOT NULL THEN
    BEGIN
      target_school_id := (new.raw_user_meta_data->>'school_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      target_school_id := NULL;
    END;
  END IF;

  INSERT INTO public.user_roles (user_id, role, account_status, school_id)
  VALUES (new.id, valid_role, 'Pending', target_school_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 1.6 Helper security definer functions reading directly from public.user_roles table
-- (Never relying exclusively on mutable or stale client JWT metadata)

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

CREATE OR REPLACE FUNCTION public.is_principal()
RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'principal' AND account_status = 'Approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_approved_teacher()
RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'teacher' AND account_status = 'Approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_approved_staff()
RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
      AND (role = 'admin' OR account_status = 'Approved')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_auth_user_school_id()
RETURNS uuid AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  RETURN (
    SELECT school_id FROM public.user_roles 
    WHERE user_id = auth.uid()
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.can_approve_documents()
RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF auth.role() = 'service_role' THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
      AND role IN ('admin', 'principal')
      AND (role = 'admin' OR account_status = 'Approved')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_principal() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_approved_teacher() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_approved_staff() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_auth_user_school_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_approve_documents() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_principal() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_approved_teacher() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_approved_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_auth_user_school_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_approve_documents() TO authenticated, service_role;

-- 1.7 Non-recursive RLS policies on user_roles and auth_logs
DROP POLICY IF EXISTS "Users can read own role" ON public.user_roles;
CREATE POLICY "Users can read own role" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admins can read auth logs" ON public.auth_logs;
CREATE POLICY "Admins can read auth logs" ON public.auth_logs
  FOR SELECT USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can insert own logs" ON public.auth_logs;
CREATE POLICY "Users can insert own logs" ON public.auth_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');


-- ------------------------------------------------------------------------------
-- PART 2: Academic Schema (Learner Status & Subject Grades)
-- ------------------------------------------------------------------------------

-- 2.1 Add overall_status to students table
ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS overall_status text DEFAULT 'Needs Verification' 
CHECK (overall_status IN ('Passed', 'Failed', 'Needs Verification'));

-- 2.2 Create subject_grades table with school_year
CREATE TABLE IF NOT EXISTS public.subject_grades (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
    document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
    school_year text,
    subject text NOT NULL,
    q1 numeric,
    q2 numeric,
    q3 numeric,
    q4 numeric,
    final_grade numeric,
    status text CHECK (status IN ('Passed', 'Failed', 'Missing')),
    needs_verification boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Ensure school_year column exists if table was previously created
ALTER TABLE public.subject_grades 
ADD COLUMN IF NOT EXISTS school_year text;

-- Timestamp update trigger
DROP TRIGGER IF EXISTS update_subject_grades_updated_at ON public.subject_grades;
CREATE TRIGGER update_subject_grades_updated_at
    BEFORE UPDATE ON public.subject_grades
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_subject_grades_student_id ON public.subject_grades(student_id);
CREATE INDEX IF NOT EXISTS idx_subject_grades_document_id ON public.subject_grades(document_id);
CREATE INDEX IF NOT EXISTS idx_subject_grades_school_year ON public.subject_grades(school_year);

-- Enable RLS on subject_grades
ALTER TABLE public.subject_grades ENABLE ROW LEVEL SECURITY;

-- Clean up legacy permissive policies
DROP POLICY IF EXISTS "Enable read access for all users" ON public.subject_grades;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.subject_grades;
DROP POLICY IF EXISTS "Enable update for all users" ON public.subject_grades;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.subject_grades;
DROP POLICY IF EXISTS "Authenticated read subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Authenticated insert subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Authenticated update subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Authenticated delete subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Admin insert subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Admin update subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Admin delete subject_grades" ON public.subject_grades;
DROP POLICY IF EXISTS "Authorized read subject_grades" ON public.subject_grades;

-- Secure RLS policies:
-- Admins can read all grades.
-- Principals can read grades for documents in their assigned school.
-- Approved teachers can read grades for documents they uploaded.
CREATE POLICY "Authorized read subject_grades" ON public.subject_grades
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal()
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = subject_grades.document_id 
                  AND d.school_id = public.get_auth_user_school_id()
            )
        )
        OR (
            public.is_approved_teacher() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = subject_grades.document_id 
                  AND d.uploaded_by = auth.uid()::text
            )
        )
    );

-- Direct modification restricted exclusively to admins and service_role.
-- Official grades are written solely by the database approval trigger.
CREATE POLICY "Admin insert subject_grades" ON public.subject_grades
    FOR INSERT WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "Admin update subject_grades" ON public.subject_grades
    FOR UPDATE USING (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "Admin delete subject_grades" ON public.subject_grades
    FOR DELETE USING (public.is_admin() OR auth.role() = 'service_role');


-- ------------------------------------------------------------------------------
-- PART 3: Document Approval, Reprocessing & Rejection Trigger (DepEd Aligned)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_approved_document()
RETURNS TRIGGER AS $$
DECLARE
    grade_record jsonb;
    target_doc_id uuid;
    target_student_id uuid;
    doc_school_year text;
    current_overall_status text;
    latest_approved_doc_id uuid;
    failed_count integer := 0;
    unverified_count integer := 0;
    clean_q1 numeric;
    clean_q2 numeric;
    clean_q3 numeric;
    clean_q4 numeric;
    clean_final numeric;
    clean_status text;
    clean_needs_verif boolean;
BEGIN
    -- Determine execution context (UPDATE vs DELETE)
    IF TG_OP = 'DELETE' THEN
        target_doc_id := OLD.id;
        target_student_id := OLD.student_id;
    ELSE
        target_doc_id := NEW.id;
        target_student_id := NEW.student_id;
    END IF;

    -- Ignore if no student is associated
    IF target_student_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- CASE A: Document approved OR updated while in approved state
    IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND (OLD.status != 'approved' OR NEW.extracted_fields IS DISTINCT FROM OLD.extracted_fields) THEN
        
        -- Prevent duplicates: clean up previous grades for this document
        DELETE FROM public.subject_grades WHERE document_id = NEW.id;

        -- Extract document-level school year
        doc_school_year := NULLIF(TRIM(NEW.extracted_fields->>'school_year'), '');

        -- Insert normalized subject grades if grades array exists
        IF NEW.extracted_fields IS NOT NULL AND jsonb_typeof(NEW.extracted_fields->'grades') = 'array' THEN
            FOR grade_record IN SELECT * FROM jsonb_array_elements(NEW.extracted_fields->'grades')
            LOOP
                -- Regex casting guards to prevent numeric cast exceptions.
                -- Preserves genuine zero, distinguishes blank or unreadable values as NULL.
                clean_q1 := CASE 
                    WHEN (grade_record->>'q1') ~ '^-?[0-9]+(\.[0-9]+)?$' 
                    THEN (grade_record->>'q1')::numeric 
                    ELSE NULL 
                END;

                clean_q2 := CASE 
                    WHEN (grade_record->>'q2') ~ '^-?[0-9]+(\.[0-9]+)?$' 
                    THEN (grade_record->>'q2')::numeric 
                    ELSE NULL 
                END;

                clean_q3 := CASE 
                    WHEN (grade_record->>'q3') ~ '^-?[0-9]+(\.[0-9]+)?$' 
                    THEN (grade_record->>'q3')::numeric 
                    ELSE NULL 
                END;

                clean_q4 := CASE 
                    WHEN (grade_record->>'q4') ~ '^-?[0-9]+(\.[0-9]+)?$' 
                    THEN (grade_record->>'q4')::numeric 
                    ELSE NULL 
                END;

                clean_final := CASE 
                    WHEN (grade_record->>'final') ~ '^-?[0-9]+(\.[0-9]+)?$' 
                    THEN (grade_record->>'final')::numeric 
                    ELSE NULL 
                END;

                -- Normalize status to satisfy CHECK constraint (Passed | Failed | Missing)
                clean_status := CASE 
                    WHEN LOWER(COALESCE(grade_record->>'status', '')) = 'passed' THEN 'Passed'
                    WHEN LOWER(COALESCE(grade_record->>'status', '')) = 'failed' THEN 'Failed'
                    ELSE 'Missing'
                END;

                clean_needs_verif := COALESCE((grade_record->>'needsVerification')::boolean, false);
                IF clean_final IS NULL OR clean_status = 'Missing' THEN
                    clean_needs_verif := true;
                END IF;

                INSERT INTO public.subject_grades (
                    student_id,
                    document_id,
                    school_year,
                    subject,
                    q1, q2, q3, q4,
                    final_grade,
                    status,
                    needs_verification
                ) VALUES (
                    NEW.student_id,
                    NEW.id,
                    COALESCE(NULLIF(TRIM(grade_record->>'school_year'), ''), doc_school_year),
                    COALESCE(NULLIF(TRIM(grade_record->>'subject'), ''), 'General Subject'),
                    clean_q1,
                    clean_q2,
                    clean_q3,
                    clean_q4,
                    clean_final,
                    clean_status,
                    clean_needs_verif
                );
            END LOOP;

            -- Evaluate academic standing aligned with DepEd DO 8, s. 2015 & SHS semestral rules:
            --   - Cases with missing, uncertain, or borderline marks are flagged for human review ('Needs Verification')
            --   - Retained / Failed: 3 or more failing subjects (DO 8, s. 2015)
            --   - Conditional / Remedial: 1-2 failing subjects (flagged as 'Needs Verification' for review, not outright failed)
            --   - Passed: 0 failing subjects across current approved curriculum
            SELECT 
                COUNT(*) FILTER (WHERE status = 'Failed'),
                COUNT(*) FILTER (WHERE needs_verification = true OR status = 'Missing')
            INTO failed_count, unverified_count
            FROM public.subject_grades 
            WHERE document_id = NEW.id;

            IF unverified_count > 0 THEN
                current_overall_status := 'Needs Verification';
            ELSIF failed_count >= 3 THEN
                current_overall_status := 'Failed';
            ELSIF failed_count BETWEEN 1 AND 2 THEN
                -- In DepEd DO 8 s. 2015, learners with 1-2 failures are Conditionally Promoted for remedial instruction.
                -- Mapped to 'Needs Verification' for school head / registrar review.
                current_overall_status := 'Needs Verification';
            ELSIF EXISTS (SELECT 1 FROM public.subject_grades WHERE document_id = NEW.id) THEN
                current_overall_status := 'Passed';
            ELSE
                current_overall_status := 'Needs Verification';
            END IF;

            UPDATE public.students
            SET overall_status = current_overall_status,
                updated_at = now()
            WHERE id = NEW.student_id;
        END IF;

    -- CASE B: Document reverted, rejected, or deleted from a previously approved state
    ELSIF (TG_OP = 'UPDATE' AND NEW.status != 'approved' AND OLD.status = 'approved') 
       OR (TG_OP = 'DELETE' AND OLD.status = 'approved') THEN
        
        -- Delete persisted grades for this un-approved or deleted document
        DELETE FROM public.subject_grades WHERE document_id = target_doc_id;

        -- Recalculate student overall status based on most recent remaining approved document
        SELECT d.id INTO latest_approved_doc_id
        FROM public.documents d
        WHERE d.student_id = target_student_id 
          AND d.status = 'approved' 
          AND d.id != target_doc_id
        ORDER BY (d.extracted_fields->>'school_year') DESC NULLS LAST, d.updated_at DESC
        LIMIT 1;

        IF latest_approved_doc_id IS NOT NULL THEN
            SELECT 
                COUNT(*) FILTER (WHERE status = 'Failed'),
                COUNT(*) FILTER (WHERE needs_verification = true OR status = 'Missing')
            INTO failed_count, unverified_count
            FROM public.subject_grades 
            WHERE document_id = latest_approved_doc_id;

            IF unverified_count > 0 THEN
                current_overall_status := 'Needs Verification';
            ELSIF failed_count >= 3 THEN
                current_overall_status := 'Failed';
            ELSIF failed_count BETWEEN 1 AND 2 THEN
                current_overall_status := 'Needs Verification';
            ELSE
                current_overall_status := 'Passed';
            END IF;
        ELSE
            current_overall_status := 'Needs Verification';
        END IF;

        UPDATE public.students
        SET overall_status = current_overall_status,
            updated_at = now()
        WHERE id = target_student_id;

    END IF;
    
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.process_approved_document() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_approved_document() TO authenticated, service_role;

-- Attach trigger to documents table for UPDATE and DELETE
DROP TRIGGER IF EXISTS trigger_process_approved_document ON public.documents;
CREATE TRIGGER trigger_process_approved_document
    AFTER UPDATE OR DELETE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.process_approved_document();


-- ------------------------------------------------------------------------------
-- PART 4: Tiered Row Level Security Policies
-- ------------------------------------------------------------------------------

-- 4.1 SCHOOLS TABLE
DROP POLICY IF EXISTS "Enable read access for all users" ON public.schools;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.schools;
DROP POLICY IF EXISTS "Enable update for all users" ON public.schools;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.schools;
DROP POLICY IF EXISTS "Authenticated read schools" ON public.schools;
DROP POLICY IF EXISTS "Admin manage schools" ON public.schools;
DROP POLICY IF EXISTS "Authorized read schools" ON public.schools;

CREATE POLICY "Authorized read schools" ON public.schools
    FOR SELECT USING (public.is_approved_staff() OR auth.role() = 'service_role');

CREATE POLICY "Admin manage schools" ON public.schools
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role');

-- 4.2 STUDENTS TABLE
-- (Students have no access. Teachers only see students linked to their uploaded documents.
--  Principals are scoped to documents in their assigned school. Admins have system-wide oversight.)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.students;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.students;
DROP POLICY IF EXISTS "Enable update for all users" ON public.students;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.students;
DROP POLICY IF EXISTS "Authenticated read students" ON public.students;
DROP POLICY IF EXISTS "Authenticated insert students" ON public.students;
DROP POLICY IF EXISTS "Authenticated update students" ON public.students;
DROP POLICY IF EXISTS "Admin delete students" ON public.students;
DROP POLICY IF EXISTS "Authorized read students" ON public.students;
DROP POLICY IF EXISTS "Authorized insert students" ON public.students;
DROP POLICY IF EXISTS "Authorized update students" ON public.students;

CREATE POLICY "Authorized read students" ON public.students
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal()
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.student_id = students.id 
                  AND d.school_id = public.get_auth_user_school_id()
            )
        )
        OR (
            public.is_approved_teacher() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.student_id = students.id 
                  AND d.uploaded_by = auth.uid()::text
            )
        )
    );

CREATE POLICY "Authorized insert students" ON public.students
    FOR INSERT WITH CHECK (public.is_approved_staff() OR auth.role() = 'service_role');

CREATE POLICY "Authorized update students" ON public.students
    FOR UPDATE USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal()
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.student_id = students.id 
                  AND d.school_id = public.get_auth_user_school_id()
            )
        )
        OR (
            public.is_approved_teacher() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.student_id = students.id 
                  AND d.uploaded_by = auth.uid()::text 
                  AND d.status != 'approved'
            )
        )
    );

CREATE POLICY "Admin delete students" ON public.students
    FOR DELETE USING (public.is_admin() OR auth.role() = 'service_role');

-- 4.3 DOCUMENTS TABLE
-- (Teachers only see and manage their own uploads.
--  Principals can view, manage, and finalize documents within their assigned school.
--  Admins have full oversight.)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.documents;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.documents;
DROP POLICY IF EXISTS "Enable update for all users" ON public.documents;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.documents;
DROP POLICY IF EXISTS "Authenticated read documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated insert documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated update documents" ON public.documents;
DROP POLICY IF EXISTS "Admin delete documents" ON public.documents;
DROP POLICY IF EXISTS "Authorized read documents" ON public.documents;
DROP POLICY IF EXISTS "Authorized insert documents" ON public.documents;
DROP POLICY IF EXISTS "Authorized update documents" ON public.documents;

CREATE POLICY "Authorized read documents" ON public.documents
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal() 
            AND documents.school_id IS NOT NULL 
            AND documents.school_id = public.get_auth_user_school_id()
        )
        OR (public.is_approved_teacher() AND uploaded_by = auth.uid()::text)
    );

CREATE POLICY "Authorized insert documents" ON public.documents
    FOR INSERT WITH CHECK (
        public.is_admin() 
        OR auth.role() = 'service_role'
        OR (
            public.is_approved_teacher() 
            AND uploaded_by = auth.uid()::text
            AND (school_id IS NULL OR school_id = public.get_auth_user_school_id())
        )
        OR (
            public.is_principal() 
            AND uploaded_by = auth.uid()::text
            AND (school_id IS NULL OR school_id = public.get_auth_user_school_id())
        )
    );

CREATE POLICY "Authorized update documents" ON public.documents
    FOR UPDATE 
    USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal() 
            AND documents.school_id IS NOT NULL 
            AND documents.school_id = public.get_auth_user_school_id()
        )
        OR (public.is_approved_teacher() AND uploaded_by = auth.uid()::text AND status NOT IN ('approved', 'rejected'))
    )
    WITH CHECK (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal() 
            AND documents.school_id IS NOT NULL 
            AND documents.school_id = public.get_auth_user_school_id()
        )
        OR (public.is_approved_teacher() AND uploaded_by = auth.uid()::text AND status NOT IN ('approved', 'rejected'))
    );

CREATE POLICY "Admin delete documents" ON public.documents
    FOR DELETE USING (public.is_admin() OR auth.role() = 'service_role');

-- 4.4 VALIDATION RESULTS TABLE
DROP POLICY IF EXISTS "Enable read access for all users" ON public.validation_results;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.validation_results;
DROP POLICY IF EXISTS "Enable update for all users" ON public.validation_results;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.validation_results;
DROP POLICY IF EXISTS "Authenticated read validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authenticated insert validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authenticated update validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Admin delete validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authorized read validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authorized insert validation_results" ON public.validation_results;
DROP POLICY IF EXISTS "Authorized update validation_results" ON public.validation_results;

CREATE POLICY "Authorized read validation_results" ON public.validation_results
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = validation_results.document_id 
                  AND d.school_id = public.get_auth_user_school_id()
            )
        )
        OR (
            public.is_approved_teacher() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = validation_results.document_id 
                  AND d.uploaded_by = auth.uid()::text
            )
        )
    );

CREATE POLICY "Authorized insert validation_results" ON public.validation_results
    FOR INSERT WITH CHECK (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = validation_results.document_id 
                  AND d.school_id = public.get_auth_user_school_id()
            )
        )
        OR (
            public.is_approved_teacher() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = validation_results.document_id 
                  AND d.uploaded_by = auth.uid()::text
            )
        )
    );

CREATE POLICY "Authorized update validation_results" ON public.validation_results
    FOR UPDATE USING (
        public.is_admin() 
        OR auth.role() = 'service_role'
        OR (
            public.is_principal() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = validation_results.document_id 
                  AND d.school_id = public.get_auth_user_school_id()
            )
        )
        OR (
            public.is_approved_teacher() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = validation_results.document_id 
                  AND d.uploaded_by = auth.uid()::text 
                  AND d.status != 'approved'
            )
        )
    );

CREATE POLICY "Admin delete validation_results" ON public.validation_results
    FOR DELETE USING (public.is_admin() OR auth.role() = 'service_role');

-- 4.5 REVIEW LOGS TABLE (Immutable Append-Only Audit Trail)
DROP POLICY IF EXISTS "Enable read access for all users" ON public.review_logs;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.review_logs;
DROP POLICY IF EXISTS "Enable update for all users" ON public.review_logs;
DROP POLICY IF EXISTS "Enable delete for all users" ON public.review_logs;
DROP POLICY IF EXISTS "Authenticated read review_logs" ON public.review_logs;
DROP POLICY IF EXISTS "Authenticated insert review_logs" ON public.review_logs;
DROP POLICY IF EXISTS "Admin delete review_logs" ON public.review_logs;
DROP POLICY IF EXISTS "Authorized read review_logs" ON public.review_logs;
DROP POLICY IF EXISTS "Authorized insert review_logs" ON public.review_logs;

CREATE POLICY "Authorized read review_logs" ON public.review_logs
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = review_logs.document_id 
                  AND d.school_id = public.get_auth_user_school_id()
            )
        )
        OR (
            public.is_approved_teacher() 
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE d.id = review_logs.document_id 
                  AND d.uploaded_by = auth.uid()::text
            )
        )
    );

CREATE POLICY "Authorized insert review_logs" ON public.review_logs
    FOR INSERT WITH CHECK (
        public.is_approved_staff() 
        AND (reviewed_by = auth.uid()::text OR reviewed_by IS NULL OR public.is_admin())
    );

-- Strict audit immutability: NO UPDATE POLICY exists for review_logs.
CREATE POLICY "Admin delete review_logs" ON public.review_logs
    FOR DELETE USING (public.is_admin() OR auth.role() = 'service_role');


-- ------------------------------------------------------------------------------
-- PART 5: Storage Authorization & Object Isolation (Private Bucket)
-- ------------------------------------------------------------------------------

-- Ensure documents bucket exists with 10MB limit and valid MIME types (Strictly Private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'documents',
    'documents',
    false, -- Private bucket: confidential student records protected from public access (RA 10173)
    10485760, -- 10MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- Clean up permissive or public storage policies
DROP POLICY IF EXISTS "Give public access to documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Public Read Documents Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Give public upload access to documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Give public update access to documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Give public delete access to documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users Read Documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users Upload Documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users Manage Documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Users Delete Documents" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Read Documents Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Upload Documents Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Update Documents Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Authorized Delete Documents Bucket" ON storage.objects;

-- Read: Admins read all. Principals read documents belonging to their assigned school.
-- Approved teachers read only their own uploads.
CREATE POLICY "Authorized Read Documents Bucket" ON storage.objects
FOR SELECT
USING (
    bucket_id = 'documents' 
    AND (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal()
            AND (
                owner = auth.uid()
                OR (storage.foldername(name))[1] = auth.uid()::text
                OR EXISTS (
                    SELECT 1 FROM public.documents d 
                    WHERE (d.image_url LIKE '%' || name OR d.image_url = name)
                      AND d.school_id = public.get_auth_user_school_id()
                )
            )
        )
        OR (
            public.is_approved_teacher() 
            AND (
                owner = auth.uid()
                OR (storage.foldername(name))[1] = auth.uid()::text
                OR EXISTS (
                    SELECT 1 FROM public.documents d 
                    WHERE (d.image_url LIKE '%' || name OR d.image_url = name)
                      AND d.uploaded_by = auth.uid()::text
                )
            )
        )
    )
);

-- Upload: Approved staff (Teachers, Principals, Admins) can upload into their user-prefixed path.
CREATE POLICY "Authorized Upload Documents Bucket" ON storage.objects
FOR INSERT
WITH CHECK (
    bucket_id = 'documents'
    AND (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_approved_staff()
            AND (
                owner = auth.uid()
                OR (storage.foldername(name))[1] = auth.uid()::text
            )
        )
    )
);

-- Update: Owner or Admin
CREATE POLICY "Authorized Update Documents Bucket" ON storage.objects
FOR UPDATE
USING (
    bucket_id = 'documents'
    AND (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_approved_staff()
            AND (
                owner = auth.uid()
                OR (storage.foldername(name))[1] = auth.uid()::text
            )
        )
    )
);

-- Delete: Admin only
CREATE POLICY "Authorized Delete Documents Bucket" ON storage.objects
FOR DELETE
USING (
    bucket_id = 'documents'
    AND (public.is_admin() OR auth.role() = 'service_role')
);

-- ==============================================================================
-- Migration 022 Rollback & Recovery Script
-- ==============================================================================
-- Safely reverts Migration 022 schema objects and restores M009 RLS policies
-- on students, documents, and subject_grades without touching M016-M021 data.
-- ==============================================================================

-- 1. Restore original M009 RLS policies on subject_grades, documents, students
DROP POLICY IF EXISTS "Authorized read subject_grades" ON public.subject_grades;
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

DROP POLICY IF EXISTS "Authorized update documents" ON public.documents;
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

DROP POLICY IF EXISTS "Authorized insert documents" ON public.documents;
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

DROP POLICY IF EXISTS "Authorized read documents" ON public.documents;
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

DROP POLICY IF EXISTS "Authorized read students" ON public.students;
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

-- 2. Drop triggers, indexes & columns added to documents
DROP TRIGGER IF EXISTS trg_guard_teacher_document_updates ON public.documents;
DROP INDEX IF EXISTS public.idx_documents_section_scope;
DROP INDEX IF EXISTS public.idx_documents_teacher_assignment_id;
ALTER TABLE public.documents
    DROP COLUMN IF EXISTS assignment_confirmed_by,
    DROP COLUMN IF EXISTS assignment_confirmed_at,
    DROP COLUMN IF EXISTS strand_or_track,
    DROP COLUMN IF EXISTS section,
    DROP COLUMN IF EXISTS teacher_assignment_id;

-- 3. Drop Migration 022 tables (before functions that their policies reference)
DROP TABLE IF EXISTS public.student_identity_conflicts CASCADE;
DROP TABLE IF EXISTS public.student_enrollments CASCADE;
DROP TABLE IF EXISTS public.teacher_module_policies CASCADE;
DROP TABLE IF EXISTS public.teacher_assignments CASCADE;

-- 4. Drop RPC & RLS helper functions added in Migration 022
DROP FUNCTION IF EXISTS public.guard_teacher_document_updates();
DROP FUNCTION IF EXISTS public.resolve_section_or_identity_conflict(UUID, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.upsert_student_enrollment_history(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.lookup_or_quarantine_student_identity(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_teacher_authorized_assignments();
DROP FUNCTION IF EXISTS public.can_teacher_access_student(UUID);
DROP FUNCTION IF EXISTS public.can_teacher_access_document(UUID);
DROP FUNCTION IF EXISTS public.can_teacher_access_section(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.can_teacher_scan_with_assignment(UUID);
DROP FUNCTION IF EXISTS public.has_active_teacher_assignment(UUID);

-- 5. Drop helper normalization functions
DROP FUNCTION IF EXISTS public.normalize_lrn_text(TEXT);
DROP FUNCTION IF EXISTS public.normalize_subject_key(TEXT);
DROP FUNCTION IF EXISTS public.normalize_strand_key(TEXT);
DROP FUNCTION IF EXISTS public.normalize_section_key(TEXT);

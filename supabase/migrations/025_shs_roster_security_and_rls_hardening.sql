-- ==============================================================================
-- MIGRATION 025: SENIOR HIGH SCHOOL ROSTER SECURITY & RLS HARDENING
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 500169
-- Academic Scope: Exclusively Senior High School (Grades 11 & 12)
-- ==============================================================================
-- Objectives:
--   1. Enable Row Level Security (RLS) on all child roster and validation tables.
--   2. Establish non-recursive RLS policies for:
--      - Administrator: Full access (SELECT, INSERT, UPDATE, DELETE).
--      - Principal: Read-only access (SELECT) across TRIS school records.
--      - Teacher (Class Adviser): Section-scoped access (SELECT, INSERT, UPDATE)
--        strictly restricted to their assigned Senior High School section or own uploads.
--   3. Apply heightened privacy protection to PSA birth certificate records under
--      Republic Act No. 10173 (Data Privacy Act of 2012).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Enable RLS on New Tables
-- ------------------------------------------------------------------------------

ALTER TABLE public.sf1_roster_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sf2_attendance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sf5_promotion_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.psa_identity_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cross_document_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_extraction_traces ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. RLS Policies: public.sf1_roster_entries
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admin full access on sf1_roster_entries" ON public.sf1_roster_entries;
CREATE POLICY "Admin full access on sf1_roster_entries"
    ON public.sf1_roster_entries FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Principal read-only on sf1_roster_entries" ON public.sf1_roster_entries;
CREATE POLICY "Principal read-only on sf1_roster_entries"
    ON public.sf1_roster_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.school_id = sf1_roster_entries.school_id
              AND ur.role = 'principal'
              AND ur.account_status = 'Approved'
        )
    );

DROP POLICY IF EXISTS "Teacher access on sf1_roster_entries" ON public.sf1_roster_entries;
CREATE POLICY "Teacher access on sf1_roster_entries"
    ON public.sf1_roster_entries FOR SELECT
    TO authenticated
    USING (
        public.can_teacher_access_document(document_id)
        OR EXISTS (
            SELECT 1 FROM public.teacher_assignments ta
            WHERE ta.teacher_user_id = auth.uid()
              AND ta.school_id = sf1_roster_entries.school_id
              AND ta.assignment_status = 'active'
              AND ta.grade_level = sf1_roster_entries.grade_level
              AND public.normalize_section_key(ta.section) = public.normalize_section_key(sf1_roster_entries.section)
        )
    );

DROP POLICY IF EXISTS "Teacher insert/update on sf1_roster_entries" ON public.sf1_roster_entries;
CREATE POLICY "Teacher insert/update on sf1_roster_entries"
    ON public.sf1_roster_entries FOR INSERT
    TO authenticated
    WITH CHECK (
        public.can_teacher_access_document(document_id)
        OR EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = sf1_roster_entries.document_id
              AND (d.uploaded_by = auth.uid()::text OR d.uploaded_by IS NULL)
        )
    );

DROP POLICY IF EXISTS "Teacher update on sf1_roster_entries" ON public.sf1_roster_entries;
CREATE POLICY "Teacher update on sf1_roster_entries"
    ON public.sf1_roster_entries FOR UPDATE
    TO authenticated
    USING (
        public.can_teacher_access_document(document_id)
    )
    WITH CHECK (
        public.can_teacher_access_document(document_id)
    );

-- ------------------------------------------------------------------------------
-- 3. RLS Policies: public.sf2_attendance_entries
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admin full access on sf2_attendance_entries" ON public.sf2_attendance_entries;
CREATE POLICY "Admin full access on sf2_attendance_entries"
    ON public.sf2_attendance_entries FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Principal read-only on sf2_attendance_entries" ON public.sf2_attendance_entries;
CREATE POLICY "Principal read-only on sf2_attendance_entries"
    ON public.sf2_attendance_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.school_id = sf2_attendance_entries.school_id
              AND ur.role = 'principal'
              AND ur.account_status = 'Approved'
        )
    );

DROP POLICY IF EXISTS "Teacher access on sf2_attendance_entries" ON public.sf2_attendance_entries;
CREATE POLICY "Teacher access on sf2_attendance_entries"
    ON public.sf2_attendance_entries FOR SELECT
    TO authenticated
    USING (
        public.can_teacher_access_document(document_id)
        OR EXISTS (
            SELECT 1 FROM public.teacher_assignments ta
            WHERE ta.teacher_user_id = auth.uid()
              AND ta.school_id = sf2_attendance_entries.school_id
              AND ta.assignment_status = 'active'
              AND ta.grade_level = sf2_attendance_entries.grade_level
              AND public.normalize_section_key(ta.section) = public.normalize_section_key(sf2_attendance_entries.section)
        )
    );

DROP POLICY IF EXISTS "Teacher insert/update on sf2_attendance_entries" ON public.sf2_attendance_entries;
CREATE POLICY "Teacher insert/update on sf2_attendance_entries"
    ON public.sf2_attendance_entries FOR INSERT
    TO authenticated
    WITH CHECK (
        public.can_teacher_access_document(document_id)
        OR EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = sf2_attendance_entries.document_id
              AND (d.uploaded_by = auth.uid()::text OR d.uploaded_by IS NULL)
        )
    );

DROP POLICY IF EXISTS "Teacher update on sf2_attendance_entries" ON public.sf2_attendance_entries;
CREATE POLICY "Teacher update on sf2_attendance_entries"
    ON public.sf2_attendance_entries FOR UPDATE
    TO authenticated
    USING (
        public.can_teacher_access_document(document_id)
    )
    WITH CHECK (
        public.can_teacher_access_document(document_id)
    );

-- ------------------------------------------------------------------------------
-- 4. RLS Policies: public.sf5_promotion_entries
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admin full access on sf5_promotion_entries" ON public.sf5_promotion_entries;
CREATE POLICY "Admin full access on sf5_promotion_entries"
    ON public.sf5_promotion_entries FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Principal read-only on sf5_promotion_entries" ON public.sf5_promotion_entries;
CREATE POLICY "Principal read-only on sf5_promotion_entries"
    ON public.sf5_promotion_entries FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.school_id = sf5_promotion_entries.school_id
              AND ur.role = 'principal'
              AND ur.account_status = 'Approved'
        )
    );

DROP POLICY IF EXISTS "Teacher access on sf5_promotion_entries" ON public.sf5_promotion_entries;
CREATE POLICY "Teacher access on sf5_promotion_entries"
    ON public.sf5_promotion_entries FOR SELECT
    TO authenticated
    USING (
        public.can_teacher_access_document(document_id)
        OR EXISTS (
            SELECT 1 FROM public.teacher_assignments ta
            WHERE ta.teacher_user_id = auth.uid()
              AND ta.school_id = sf5_promotion_entries.school_id
              AND ta.assignment_status = 'active'
              AND ta.grade_level = sf5_promotion_entries.grade_level
              AND public.normalize_section_key(ta.section) = public.normalize_section_key(sf5_promotion_entries.section)
        )
    );

DROP POLICY IF EXISTS "Teacher insert/update on sf5_promotion_entries" ON public.sf5_promotion_entries;
CREATE POLICY "Teacher insert/update on sf5_promotion_entries"
    ON public.sf5_promotion_entries FOR INSERT
    TO authenticated
    WITH CHECK (
        public.can_teacher_access_document(document_id)
        OR EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = sf5_promotion_entries.document_id
              AND (d.uploaded_by = auth.uid()::text OR d.uploaded_by IS NULL)
        )
    );

DROP POLICY IF EXISTS "Teacher update on sf5_promotion_entries" ON public.sf5_promotion_entries;
CREATE POLICY "Teacher update on sf5_promotion_entries"
    ON public.sf5_promotion_entries FOR UPDATE
    TO authenticated
    USING (
        public.can_teacher_access_document(document_id)
    )
    WITH CHECK (
        public.can_teacher_access_document(document_id)
    );

-- ------------------------------------------------------------------------------
-- 5. RLS Policies: public.psa_identity_records (Strict RA 10173 Privacy)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admin full access on psa_identity_records" ON public.psa_identity_records;
CREATE POLICY "Admin full access on psa_identity_records"
    ON public.psa_identity_records FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Principal read-only on psa_identity_records" ON public.psa_identity_records;
CREATE POLICY "Principal read-only on psa_identity_records"
    ON public.psa_identity_records FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.school_id = psa_identity_records.school_id
              AND ur.role = 'principal'
              AND ur.account_status = 'Approved'
        )
    );

DROP POLICY IF EXISTS "Teacher read on psa_identity_records" ON public.psa_identity_records;
CREATE POLICY "Teacher read on psa_identity_records"
    ON public.psa_identity_records FOR SELECT
    TO authenticated
    USING (
        public.can_teacher_access_document(document_id)
        OR (
            student_id IS NOT NULL
            AND public.can_teacher_access_student(student_id)
        )
    );

DROP POLICY IF EXISTS "Teacher insert on psa_identity_records" ON public.psa_identity_records;
CREATE POLICY "Teacher insert on psa_identity_records"
    ON public.psa_identity_records FOR INSERT
    TO authenticated
    WITH CHECK (
        public.can_teacher_access_document(document_id)
        OR EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = psa_identity_records.document_id
              AND (d.uploaded_by = auth.uid()::text OR d.uploaded_by IS NULL)
        )
    );

-- ------------------------------------------------------------------------------
-- 6. RLS Policies: public.cross_document_validations
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admin full access on cross_document_validations" ON public.cross_document_validations;
CREATE POLICY "Admin full access on cross_document_validations"
    ON public.cross_document_validations FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Principal read on cross_document_validations" ON public.cross_document_validations;
CREATE POLICY "Principal read on cross_document_validations"
    ON public.cross_document_validations FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.school_id = cross_document_validations.school_id
              AND ur.role = 'principal'
              AND ur.account_status = 'Approved'
        )
    );

DROP POLICY IF EXISTS "Teacher read on cross_document_validations" ON public.cross_document_validations;
CREATE POLICY "Teacher read on cross_document_validations"
    ON public.cross_document_validations FOR SELECT
    TO authenticated
    USING (
        public.can_teacher_access_student(student_id)
        OR (source_doc1_id IS NOT NULL AND public.can_teacher_access_document(source_doc1_id))
        OR (source_doc2_id IS NOT NULL AND public.can_teacher_access_document(source_doc2_id))
    );

DROP POLICY IF EXISTS "Teacher update resolution on cross_document_validations" ON public.cross_document_validations;
CREATE POLICY "Teacher update resolution on cross_document_validations"
    ON public.cross_document_validations FOR UPDATE
    TO authenticated
    USING (
        public.can_teacher_access_student(student_id)
    )
    WITH CHECK (
        public.can_teacher_access_student(student_id)
    );

-- ------------------------------------------------------------------------------
-- 7. RLS Policies: public.field_extraction_traces
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admin full access on field_extraction_traces" ON public.field_extraction_traces;
CREATE POLICY "Admin full access on field_extraction_traces"
    ON public.field_extraction_traces FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Authenticated users read field_extraction_traces" ON public.field_extraction_traces;
CREATE POLICY "Authenticated users read field_extraction_traces"
    ON public.field_extraction_traces FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR public.can_teacher_access_document(document_id)
        OR EXISTS (
            SELECT 1 FROM public.documents d
            JOIN public.user_roles ur ON ur.school_id = d.school_id AND ur.user_id = auth.uid()
            WHERE d.id = field_extraction_traces.document_id
              AND ur.role = 'principal'
              AND ur.account_status = 'Approved'
        )
    );

COMMIT;

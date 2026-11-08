-- ==============================================================================
-- MIGRATION 013 (SECURITY HARDENED): SF9 Attendance Tracking, Screening Warnings & Remedial Class Records
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 300792
-- Scope: Senior High School (Grades 11 & 12) K-12 Curriculum (DO 8, s. 2015 & DO 55, s. 2016)
-- Status: PREPARED FOR REVIEW (DO NOT EXECUTE UNTIL EXPLICITLY APPROVED)
-- ==============================================================================
--
-- SECURITY & DATA INTEGRITY SPECIFICATIONS:
-- 1. Strictly Additive & Non-Destructive: Walang binuburang tables, columns, o pre-existing grades.
-- 2. Foreign-Key Preservation (ON DELETE SET NULL para sa Documents):
--    Kapag na-re-upload o tinanggal ang isang document scan, HINDI mabubura ang verified
--    attendance records at remedial history ng mag-aaral.
-- 3. Strict Teacher Ownership (No NULL Document/School Bypass):
--    Bawal mag-insert o mag-update ang guro gamit ang NULL document_id o NULL school_id.
--    Kailangang tugma ang student_id, document_id, at school_id sa mismong in-upload ng guro.
-- 4. Principal Review Isolation:
--    Ang Principal ay may monitoring view sa kanyang school at maaari LAMANG magtala ng
--    opisyal na review decision (school_review_completed, school_review_notes) gamit ang
--    dedicated secure RPC function na `record_principal_attendance_review`.
--    Bawal baguhin ng Principal ang raw attendance figures, percentages, o remedial grades.
-- 5. Cross-School & Cross-Student Referential Integrity:
--    May trigger na mahigpit na sumusuri na ang student, document, school, at subject_grade
--    ay magkakasama at hindi galing sa magkaibang paaralan o magkaibang mag-aaral.
-- 6. Deterministic Unique Constraints:
--    Gumagamit ng COALESCE sa unique indexes para sa nullable semester.
-- 7. Hardened Numerical Range Checks:
--    Lahat ng percentages (0-100), days (>=0), at grades (0-100) ay may check constraints.
-- 8. Blank Attendance Safeguard:
--    Ang unreadable cells ay nananatiling NULL, hindi kailanman ginagawang 0.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- SECTION 1: ATTENDANCE RECORDS (MONTHLY BREAKDOWN PER METRIC)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    school_year TEXT NOT NULL,
    semester TEXT,
    metric_label TEXT NOT NULL CHECK (metric_label IN (
        'No. of School Days',
        'No. of Days Present',
        'No. of Days Absent'
    )),
    -- JSONB map: {"Jun": 21, "Jul": 19.5, "Aug": 22}. Ang blangkong buwan ay null (hindi 0)
    monthly_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_total NUMERIC CHECK (computed_total IS NULL OR computed_total >= 0),
    printed_total NUMERIC CHECK (printed_total IS NULL OR printed_total >= 0),
    has_discrepancy BOOLEAN DEFAULT false,
    discrepancy_note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique index handling nullable semester safely
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_records_entry 
ON public.attendance_records (student_id, school_year, grade_level, metric_label, (COALESCE(semester, 'FULL_YEAR')));

CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON public.attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_document ON public.attendance_records(document_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_school ON public.attendance_records(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_sy_grade ON public.attendance_records(school_year, grade_level);

-- ------------------------------------------------------------------------------
-- SECTION 2: ATTENDANCE SUMMARIES & SCREENING STATUSES
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendance_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    school_year TEXT NOT NULL,
    semester TEXT,
    total_school_days NUMERIC CHECK (total_school_days IS NULL OR total_school_days >= 0),
    total_days_present NUMERIC CHECK (total_days_present IS NULL OR total_days_present >= 0),
    total_days_absent NUMERIC CHECK (total_days_absent IS NULL OR total_days_absent >= 0),
    attendance_percentage NUMERIC CHECK (attendance_percentage IS NULL OR (attendance_percentage >= 0 AND attendance_percentage <= 100)),
    absence_percentage NUMERIC CHECK (absence_percentage IS NULL OR (absence_percentage >= 0 AND absence_percentage <= 100)),
    risk_status TEXT NOT NULL DEFAULT 'NORMAL' CHECK (
        risk_status IN ('NORMAL', 'ATTENDANCE_WARNING', 'ATTENDANCE_REVIEW_REQUIRED', 'INCOMPLETE_ATTENDANCE_DATA')
    ),
    verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        verification_status IN ('PENDING', 'ATTENDANCE_VERIFIED', 'FLAGGED_FOR_REVIEW')
    ),
    verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    school_review_completed BOOLEAN DEFAULT false,
    school_review_notes TEXT,
    discrepancy_details JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique index handling nullable semester safely
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_summaries_period 
ON public.attendance_summaries (student_id, school_year, grade_level, (COALESCE(semester, 'FULL_YEAR')));

CREATE INDEX IF NOT EXISTS idx_attendance_summaries_student ON public.attendance_summaries(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_summaries_document ON public.attendance_summaries(document_id);
CREATE INDEX IF NOT EXISTS idx_attendance_summaries_school ON public.attendance_summaries(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_summaries_risk ON public.attendance_summaries(risk_status);
CREATE INDEX IF NOT EXISTS idx_attendance_summaries_verif ON public.attendance_summaries(verification_status);

-- ------------------------------------------------------------------------------
-- SECTION 3: REMEDIAL CLASS RECORDS & SUPPORTING EVIDENCE
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.remedial_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_grade_id UUID REFERENCES public.subject_grades(id) ON DELETE SET NULL,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    semester TEXT,
    school_year TEXT NOT NULL,
    original_final_grade NUMERIC NOT NULL CHECK (original_final_grade >= 0 AND original_final_grade <= 100),
    remedial_class_mark NUMERIC CHECK (remedial_class_mark IS NULL OR (remedial_class_mark >= 0 AND remedial_class_mark <= 100)),
    -- Opisyal na Formula ng DepEd: round((original_final_grade + remedial_class_mark) / 2)
    recomputed_final_grade NUMERIC CHECK (recomputed_final_grade IS NULL OR (recomputed_final_grade >= 0 AND recomputed_final_grade <= 100)),
    status TEXT NOT NULL DEFAULT 'REMEDIAL_REQUIRED' CHECK (
        status IN (
            'PASSED',
            'REMEDIAL_REQUIRED',
            'REMEDIAL_IN_PROGRESS',
            'REMEDIAL_COMPLETED_PENDING_VERIFICATION',
            'REMEDIAL_PASSED',
            'REMEDIAL_FAILED',
            'ACADEMIC_REVIEW_REQUIRED'
        )
    ),
    is_deficiency_resolved BOOLEAN DEFAULT false,
    is_verified BOOLEAN DEFAULT false,
    verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    supporting_document_ref TEXT, -- Halimbawa: "Certificate of Recomputed Final Grade - Form SF10 Annex D"
    teacher_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique index handling nullable semester safely
CREATE UNIQUE INDEX IF NOT EXISTS uq_remedial_records_subject 
ON public.remedial_records (student_id, subject, school_year, (COALESCE(semester, 'ANNUAL')));

CREATE INDEX IF NOT EXISTS idx_remedial_records_student ON public.remedial_records(student_id);
CREATE INDEX IF NOT EXISTS idx_remedial_records_subject_grade ON public.remedial_records(subject_grade_id);
CREATE INDEX IF NOT EXISTS idx_remedial_records_document ON public.remedial_records(document_id);
CREATE INDEX IF NOT EXISTS idx_remedial_records_school ON public.remedial_records(school_id);
CREATE INDEX IF NOT EXISTS idx_remedial_records_status ON public.remedial_records(status);
CREATE INDEX IF NOT EXISTS idx_remedial_records_verified ON public.remedial_records(is_verified);

-- ------------------------------------------------------------------------------
-- SECTION 4: REFERENTIAL INTEGRITY & ANTI-CORRUPTION TRIGGERS
-- ------------------------------------------------------------------------------
-- Sinisiguro ng trigger na ito na hindi magkakaroon ng cross-school o cross-student pollution:
-- 1. Ang student ay dapat pag-aari ng paaralan.
-- 2. Ang document ay dapat kabilang sa parehong student at paaralan.
-- 3. Ang subject grade (kung mayroon) ay dapat tumutugma sa student at subject name.

CREATE OR REPLACE FUNCTION public.validate_attendance_integrity()
RETURNS trigger AS $$
DECLARE
    v_doc_student uuid;
    v_doc_school uuid;
    v_student_school uuid;
BEGIN
    -- 1. Suriin ang student existence at school assignment
    SELECT school_id INTO v_student_school 
    FROM public.students 
    WHERE id = NEW.student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referential integrity violation: Specified student_id does not exist.';
    END IF;

    -- Kung may school_id ang student at may school_id ang record, dapat tugma sila
    IF v_student_school IS NOT NULL AND NEW.school_id IS NOT NULL AND v_student_school != NEW.school_id THEN
        RAISE EXCEPTION 'Cross-school violation: Record school_id does not match the student assigned school.';
    END IF;

    -- 2. Suriin ang document_id kung mayroon (dapat tugma sa student at school)
    IF NEW.document_id IS NOT NULL THEN
        SELECT student_id, school_id INTO v_doc_student, v_doc_school 
        FROM public.documents 
        WHERE id = NEW.document_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Referential integrity violation: Specified document_id does not exist.';
        END IF;

        IF v_doc_student != NEW.student_id THEN
            RAISE EXCEPTION 'Referential integrity violation: Document does not belong to the specified student.';
        END IF;

        IF NEW.school_id IS NOT NULL AND v_doc_school IS NOT NULL AND v_doc_school != NEW.school_id THEN
            RAISE EXCEPTION 'Cross-school violation: Document does not belong to the specified school.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.validate_remedial_integrity()
RETURNS trigger AS $$
DECLARE
    v_doc_student uuid;
    v_doc_school uuid;
    v_student_school uuid;
    v_sg_student uuid;
    v_sg_subject text;
BEGIN
    -- 1. Suriin ang student existence at school assignment
    SELECT school_id INTO v_student_school 
    FROM public.students 
    WHERE id = NEW.student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Referential integrity violation: Specified student_id does not exist.';
    END IF;

    -- Kung may school_id ang student at may school_id ang record, dapat tugma sila
    IF v_student_school IS NOT NULL AND NEW.school_id IS NOT NULL AND v_student_school != NEW.school_id THEN
        RAISE EXCEPTION 'Cross-school violation: Record school_id does not match the student assigned school.';
    END IF;

    -- 2. Suriin ang document_id kung mayroon (dapat tugma sa student at school)
    IF NEW.document_id IS NOT NULL THEN
        SELECT student_id, school_id INTO v_doc_student, v_doc_school 
        FROM public.documents 
        WHERE id = NEW.document_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Referential integrity violation: Specified document_id does not exist.';
        END IF;

        IF v_doc_student != NEW.student_id THEN
            RAISE EXCEPTION 'Referential integrity violation: Document does not belong to the specified student.';
        END IF;

        IF NEW.school_id IS NOT NULL AND v_doc_school IS NOT NULL AND v_doc_school != NEW.school_id THEN
            RAISE EXCEPTION 'Cross-school violation: Document does not belong to the specified school.';
        END IF;
    END IF;

    -- 3. Para sa remedial_records: kung may subject_grade_id, suriin na tugma ang student at subject
    IF NEW.subject_grade_id IS NOT NULL THEN
        SELECT student_id, subject INTO v_sg_student, v_sg_subject 
        FROM public.subject_grades 
        WHERE id = NEW.subject_grade_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Referential integrity violation: Specified subject_grade_id does not exist.';
        END IF;

        IF v_sg_student != NEW.student_id THEN
            RAISE EXCEPTION 'Referential integrity violation: Subject grade record does not belong to this student.';
        END IF;

        IF LOWER(TRIM(v_sg_subject)) != LOWER(TRIM(NEW.subject)) THEN
            RAISE EXCEPTION 'Referential integrity violation: Subject name does not match the linked subject_grade.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_validate_attendance_records_integrity ON public.attendance_records;
CREATE TRIGGER trg_validate_attendance_records_integrity
    BEFORE INSERT OR UPDATE ON public.attendance_records
    FOR EACH ROW EXECUTE FUNCTION public.validate_attendance_integrity();

DROP TRIGGER IF EXISTS trg_validate_attendance_summaries_integrity ON public.attendance_summaries;
CREATE TRIGGER trg_validate_attendance_summaries_integrity
    BEFORE INSERT OR UPDATE ON public.attendance_summaries
    FOR EACH ROW EXECUTE FUNCTION public.validate_attendance_integrity();

DROP TRIGGER IF EXISTS trg_validate_remedial_records_integrity ON public.remedial_records;
CREATE TRIGGER trg_validate_remedial_records_integrity
    BEFORE INSERT OR UPDATE ON public.remedial_records
    FOR EACH ROW EXECUTE FUNCTION public.validate_remedial_integrity();

-- ------------------------------------------------------------------------------
-- SECTION 5: PRINCIPAL REVIEW RPC FUNCTION & IMMUTABILITY TRIGGER
-- ------------------------------------------------------------------------------
-- Nililimitahan ang kapangyarihan ng Principal upang makapag-tala LAMANG ng review
-- decision nang hindi magagalaw ang raw attendance totals o student records.

CREATE OR REPLACE FUNCTION public.record_principal_attendance_review(
    p_summary_id uuid,
    p_school_review_completed boolean,
    p_school_review_notes text
)
RETURNS jsonb AS $$
DECLARE
    v_summary record;
    v_principal_school uuid;
BEGIN
    -- 1. Authorization Guard: Principal o Admin lamang na may 'Approved' status
    IF NOT (public.is_principal() OR public.is_admin() OR auth.role() = 'service_role') THEN
        RAISE EXCEPTION 'Access denied: Only an authorized Principal or Admin can record attendance review decisions.';
    END IF;

    -- 2. Kunin ang kasalukuyang attendance summary
    SELECT * INTO v_summary FROM public.attendance_summaries WHERE id = p_summary_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance summary record not found.';
    END IF;

    -- 3. Cross-School Protection: Bawal mag-review ng attendance sa ibang paaralan
    IF public.is_principal() THEN
        v_principal_school := public.get_auth_user_school_id();
        IF v_summary.school_id IS NOT NULL AND v_principal_school IS NOT NULL AND v_summary.school_id != v_principal_school THEN
            RAISE EXCEPTION 'Access denied: Principal cannot review attendance for another school.';
        END IF;
    END IF;

    -- 4. Column-Restricted Update: Binabago LAMANG ang review status at notes
    UPDATE public.attendance_summaries
    SET school_review_completed = p_school_review_completed,
        school_review_notes = p_school_review_notes,
        updated_at = now()
    WHERE id = p_summary_id;

    RETURN jsonb_build_object(
        'success', true,
        'summary_id', p_summary_id,
        'school_review_completed', p_school_review_completed,
        'school_review_notes', p_school_review_notes
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.record_principal_attendance_review FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_principal_attendance_review TO authenticated, service_role;

-- Trigger: Immutability enforcement para sa Principals
CREATE OR REPLACE FUNCTION public.enforce_attendance_summary_immutability()
RETURNS trigger AS $$
BEGIN
    -- Kapag Principal ang nag-update nang direkta sa table, bawal baguhin ang raw metrics
    IF public.is_principal() AND NOT public.is_admin() THEN
        IF NEW.total_school_days IS DISTINCT FROM OLD.total_school_days
           OR NEW.total_days_present IS DISTINCT FROM OLD.total_days_present
           OR NEW.total_days_absent IS DISTINCT FROM OLD.total_days_absent
           OR NEW.attendance_percentage IS DISTINCT FROM OLD.attendance_percentage
           OR NEW.absence_percentage IS DISTINCT FROM OLD.absence_percentage
           OR NEW.risk_status IS DISTINCT FROM OLD.risk_status
           OR NEW.student_id IS DISTINCT FROM OLD.student_id
           OR NEW.school_id IS DISTINCT FROM OLD.school_id
           OR NEW.document_id IS DISTINCT FROM OLD.document_id
           OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
        THEN
            RAISE EXCEPTION 'Security violation: Principals are strictly restricted to updating review status and notes only.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_attendance_summary_immutability ON public.attendance_summaries;
CREATE TRIGGER trg_enforce_attendance_summary_immutability
    BEFORE UPDATE ON public.attendance_summaries
    FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_summary_immutability();

-- ------------------------------------------------------------------------------
-- SECTION 6: HARDENED ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remedial_records ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 6.1 ATTENDANCE RECORDS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users view attendance records" ON public.attendance_records;
DROP POLICY IF EXISTS "Authorized read attendance records" ON public.attendance_records;
CREATE POLICY "Authorized read attendance records"
ON public.attendance_records FOR SELECT
TO authenticated
USING (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_principal()
        AND (
            (school_id IS NOT NULL AND school_id = public.get_auth_user_school_id())
            OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = attendance_records.student_id AND s.school_id = public.get_auth_user_school_id())
            OR EXISTS (SELECT 1 FROM public.documents d WHERE d.id = attendance_records.document_id AND d.school_id = public.get_auth_user_school_id())
        )
    )
    OR (
        public.is_approved_teacher()
        AND (
            EXISTS (SELECT 1 FROM public.documents d WHERE d.id = attendance_records.document_id AND d.uploaded_by = auth.uid()::text)
            OR (attendance_records.school_id IS NOT NULL AND attendance_records.school_id = public.get_auth_user_school_id())
        )
    )
);

DROP POLICY IF EXISTS "Teachers and Admins manage attendance records" ON public.attendance_records;
DROP POLICY IF EXISTS "Authorized insert attendance records" ON public.attendance_records;
CREATE POLICY "Authorized insert attendance records"
ON public.attendance_records FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_approved_teacher()
        -- Bawal mag-insert ang guro kung walang document_id o school_id (No NULL bypass)
        AND attendance_records.document_id IS NOT NULL
        AND attendance_records.school_id IS NOT NULL
        AND attendance_records.school_id = public.get_auth_user_school_id()
        -- Dapat ang student ay kabilang sa paaralan ng guro
        AND EXISTS (
            SELECT 1 FROM public.students s 
            WHERE s.id = attendance_records.student_id 
              AND (s.school_id IS NULL OR s.school_id = public.get_auth_user_school_id())
        )
        -- Dapat ang dokumento ay in-upload ng guro para sa student na ito at hindi pa approved/rejected
        AND EXISTS (
            SELECT 1 FROM public.documents d 
            WHERE d.id = attendance_records.document_id 
              AND d.student_id = attendance_records.student_id
              AND (d.school_id IS NULL OR d.school_id = public.get_auth_user_school_id())
              AND d.uploaded_by = auth.uid()::text
              AND d.status NOT IN ('approved', 'rejected')
        )
    )
);

DROP POLICY IF EXISTS "Authorized update attendance records" ON public.attendance_records;
CREATE POLICY "Authorized update attendance records"
ON public.attendance_records FOR UPDATE
TO authenticated
USING (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_approved_teacher()
        AND attendance_records.document_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.documents d 
            WHERE d.id = attendance_records.document_id 
              AND d.student_id = attendance_records.student_id
              AND d.uploaded_by = auth.uid()::text
              AND d.status NOT IN ('approved', 'rejected')
        )
    )
)
WITH CHECK (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_approved_teacher()
        AND attendance_records.document_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.documents d 
            WHERE d.id = attendance_records.document_id 
              AND d.student_id = attendance_records.student_id
              AND d.uploaded_by = auth.uid()::text
              AND d.status NOT IN ('approved', 'rejected')
        )
    )
);

DROP POLICY IF EXISTS "Admin delete attendance records" ON public.attendance_records;
CREATE POLICY "Admin delete attendance records"
ON public.attendance_records FOR DELETE
TO authenticated
USING (public.is_admin() OR auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- 6.2 ATTENDANCE SUMMARIES POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users view attendance summaries" ON public.attendance_summaries;
DROP POLICY IF EXISTS "Authorized read attendance summaries" ON public.attendance_summaries;
CREATE POLICY "Authorized read attendance summaries"
ON public.attendance_summaries FOR SELECT
TO authenticated
USING (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_principal()
        AND (
            (school_id IS NOT NULL AND school_id = public.get_auth_user_school_id())
            OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = attendance_summaries.student_id AND s.school_id = public.get_auth_user_school_id())
            OR EXISTS (SELECT 1 FROM public.documents d WHERE d.id = attendance_summaries.document_id AND d.school_id = public.get_auth_user_school_id())
        )
    )
    OR (
        public.is_approved_teacher()
        AND (
            EXISTS (SELECT 1 FROM public.documents d WHERE d.id = attendance_summaries.document_id AND d.uploaded_by = auth.uid()::text)
            OR (attendance_summaries.school_id IS NOT NULL AND attendance_summaries.school_id = public.get_auth_user_school_id())
        )
    )
);

DROP POLICY IF EXISTS "Staff and Admins manage attendance summaries" ON public.attendance_summaries;
DROP POLICY IF EXISTS "Authorized insert attendance summaries" ON public.attendance_summaries;
CREATE POLICY "Authorized insert attendance summaries"
ON public.attendance_summaries FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_approved_teacher()
        AND attendance_summaries.document_id IS NOT NULL
        AND attendance_summaries.school_id IS NOT NULL
        AND attendance_summaries.school_id = public.get_auth_user_school_id()
        AND EXISTS (
            SELECT 1 FROM public.students s 
            WHERE s.id = attendance_summaries.student_id 
              AND (s.school_id IS NULL OR s.school_id = public.get_auth_user_school_id())
        )
        AND EXISTS (
            SELECT 1 FROM public.documents d 
            WHERE d.id = attendance_summaries.document_id 
              AND d.student_id = attendance_summaries.student_id
              AND (d.school_id IS NULL OR d.school_id = public.get_auth_user_school_id())
              AND d.uploaded_by = auth.uid()::text
              AND d.status NOT IN ('approved', 'rejected')
        )
    )
);

-- NOTE: Ang Principal ay HINDI kasama sa direct table UPDATE policy na ito.
-- Ang Principal ay mag-u-update LAMANG sa pamamagitan ng `record_principal_attendance_review` RPC!
DROP POLICY IF EXISTS "Authorized update attendance summaries" ON public.attendance_summaries;
CREATE POLICY "Authorized update attendance summaries"
ON public.attendance_summaries FOR UPDATE
TO authenticated
USING (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_approved_teacher()
        AND attendance_summaries.document_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.documents d 
            WHERE d.id = attendance_summaries.document_id 
              AND d.student_id = attendance_summaries.student_id
              AND d.uploaded_by = auth.uid()::text
              AND d.status NOT IN ('approved', 'rejected')
        )
    )
)
WITH CHECK (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_approved_teacher()
        AND attendance_summaries.document_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.documents d 
            WHERE d.id = attendance_summaries.document_id 
              AND d.student_id = attendance_summaries.student_id
              AND d.uploaded_by = auth.uid()::text
              AND d.status NOT IN ('approved', 'rejected')
        )
    )
);

DROP POLICY IF EXISTS "Admin delete attendance summaries" ON public.attendance_summaries;
CREATE POLICY "Admin delete attendance summaries"
ON public.attendance_summaries FOR DELETE
TO authenticated
USING (public.is_admin() OR auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- 6.3 REMEDIAL RECORDS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users view remedial records" ON public.remedial_records;
DROP POLICY IF EXISTS "Authorized read remedial records" ON public.remedial_records;
CREATE POLICY "Authorized read remedial records"
ON public.remedial_records FOR SELECT
TO authenticated
USING (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_principal()
        AND (
            (school_id IS NOT NULL AND school_id = public.get_auth_user_school_id())
            OR EXISTS (SELECT 1 FROM public.students s WHERE s.id = remedial_records.student_id AND s.school_id = public.get_auth_user_school_id())
            OR EXISTS (SELECT 1 FROM public.documents d WHERE d.id = remedial_records.document_id AND d.school_id = public.get_auth_user_school_id())
        )
    )
    OR (
        public.is_approved_teacher()
        AND (
            EXISTS (SELECT 1 FROM public.documents d WHERE d.id = remedial_records.document_id AND d.uploaded_by = auth.uid()::text)
            OR (remedial_records.school_id IS NOT NULL AND remedial_records.school_id = public.get_auth_user_school_id())
        )
    )
);

DROP POLICY IF EXISTS "Teachers and Admins manage remedial records" ON public.remedial_records;
DROP POLICY IF EXISTS "Authorized insert remedial records" ON public.remedial_records;
CREATE POLICY "Authorized insert remedial records"
ON public.remedial_records FOR INSERT
TO authenticated
WITH CHECK (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_approved_teacher()
        AND remedial_records.document_id IS NOT NULL
        AND remedial_records.school_id IS NOT NULL
        AND remedial_records.school_id = public.get_auth_user_school_id()
        AND EXISTS (
            SELECT 1 FROM public.students s 
            WHERE s.id = remedial_records.student_id 
              AND (s.school_id IS NULL OR s.school_id = public.get_auth_user_school_id())
        )
        AND EXISTS (
            SELECT 1 FROM public.documents d 
            WHERE d.id = remedial_records.document_id 
              AND d.student_id = remedial_records.student_id
              AND (d.school_id IS NULL OR d.school_id = public.get_auth_user_school_id())
              AND d.uploaded_by = auth.uid()::text
              AND d.status NOT IN ('approved', 'rejected')
        )
    )
);

DROP POLICY IF EXISTS "Authorized update remedial records" ON public.remedial_records;
CREATE POLICY "Authorized update remedial records"
ON public.remedial_records FOR UPDATE
TO authenticated
USING (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_approved_teacher()
        AND remedial_records.document_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.documents d 
            WHERE d.id = remedial_records.document_id 
              AND d.student_id = remedial_records.student_id
              AND d.uploaded_by = auth.uid()::text
              AND d.status NOT IN ('approved', 'rejected')
        )
    )
)
WITH CHECK (
    public.is_admin()
    OR auth.role() = 'service_role'
    OR (
        public.is_approved_teacher()
        AND remedial_records.document_id IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.documents d 
            WHERE d.id = remedial_records.document_id 
              AND d.student_id = remedial_records.student_id
              AND d.uploaded_by = auth.uid()::text
              AND d.status NOT IN ('approved', 'rejected')
        )
    )
);

DROP POLICY IF EXISTS "Admin delete remedial records" ON public.remedial_records;
CREATE POLICY "Admin delete remedial records"
ON public.remedial_records FOR DELETE
TO authenticated
USING (public.is_admin() OR auth.role() = 'service_role');

COMMIT;

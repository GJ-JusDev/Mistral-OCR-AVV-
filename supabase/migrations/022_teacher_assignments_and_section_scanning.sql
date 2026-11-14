-- ==============================================================================
-- Migration 022: Teacher Assignment Management, Section-Based Scanning,
-- Student Enrollment History & Identity Conflict Quarantine
-- ==============================================================================
-- Safety Notes:
-- - Additive & idempotent where possible; does NOT modify migrations 016-021.
-- - Preserves canonical academic record partial unique indexes on `documents` (M021):
--     idx_documents_canonical_sf9_active        (school_id, canonical_lrn, document_type, school_year, grade_level)
--     idx_documents_canonical_sf9_student_active(school_id, student_id, document_type, school_year, grade_level)
--     idx_documents_canonical_sf10_active       (school_id, canonical_lrn, document_type)
--     idx_documents_unresolved_file_hash_active (school_id, document_type, file_hash)
--   Section and strand NEVER fork or duplicate a canonical student or SF9/SF10 record.
-- - Preserves approved grade protection via process_approved_document() and M021 triggers.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PART 1: Normalization Helpers
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_section_key(raw_text TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT LOWER(REGEXP_REPLACE(BTRIM(COALESCE(raw_text, '')), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.normalize_strand_key(raw_text TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT UPPER(REGEXP_REPLACE(BTRIM(COALESCE(raw_text, '')), '\s+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.normalize_subject_key(raw_text TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT TRIM(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(
                        REGEXP_REPLACE(
                            LOWER(BTRIM(COALESCE(raw_text, ''))),
                            '^\d+[\.\)]\s*', ''
                        ),
                        '\s*&\s*', ' and ', 'g'
                    ),
                    '\bgen(?:\.?|\s+)?math\b', 'general mathematics', 'g'
                ),
                '[^a-z0-9\s]', ' ', 'g'
            ),
            '\s+', ' ', 'g'
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.normalize_lrn_text(raw_text TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT NULLIF(REGEXP_REPLACE(COALESCE(raw_text, ''), '[^0-9]', '', 'g'), '');
$$;

-- ------------------------------------------------------------------------------
-- PART 2: Teacher Assignments & Module Permission Policy Tables
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teacher_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    school_year TEXT NOT NULL,
    grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    section TEXT NOT NULL,
    strand_or_track TEXT,
    subject_taught TEXT,
    semester TEXT CHECK (semester IS NULL OR semester IN ('1st Semester', '2nd Semester', 'Full Year')),
    assignment_type TEXT NOT NULL CHECK (assignment_type IN ('class_adviser', 'subject_teacher')),
    assignment_status TEXT NOT NULL DEFAULT 'active' CHECK (assignment_status IN ('active', 'inactive')),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_teacher_assignments_section_nonempty
        CHECK (BTRIM(section) <> ''),
    CONSTRAINT chk_teacher_assignments_sy_format
        CHECK (BTRIM(school_year) ~ '^\d{4}\s*-\s*\d{4}$'),
    CONSTRAINT chk_teacher_assignments_subject_rule
        CHECK (
            assignment_type = 'class_adviser'
            OR (assignment_type = 'subject_teacher' AND subject_taught IS NOT NULL AND BTRIM(subject_taught) <> '')
        )
);

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_active
    ON public.teacher_assignments (teacher_user_id, assignment_status, school_year);

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_school_lookup
    ON public.teacher_assignments (school_id, school_year, grade_level, public.normalize_section_key(section));

-- Prevent duplicate active identical assignments
CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_assignments_active_identity
    ON public.teacher_assignments (
        teacher_user_id,
        school_id,
        BTRIM(school_year),
        grade_level,
        public.normalize_section_key(section),
        public.normalize_strand_key(strand_or_track),
        assignment_type,
        public.normalize_subject_key(subject_taught),
        COALESCE(semester, '')
    )
    WHERE assignment_status = 'active';

DROP TRIGGER IF EXISTS update_teacher_assignments_updated_at ON public.teacher_assignments;
CREATE TRIGGER update_teacher_assignments_updated_at
    BEFORE UPDATE ON public.teacher_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Enforce admin-only mutations & school consistency on teacher_assignments
CREATE OR REPLACE FUNCTION public.enforce_teacher_assignment_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT := COALESCE(current_setting('role', true), '');
BEGIN
    -- Block non-admin JWT callers (even if somehow bypassing RLS)
    IF auth.uid() IS NOT NULL AND v_role <> 'service_role' AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can create or modify teacher assignments.';
    END IF;

    -- Verify teacher belongs to target school (when user_roles record exists)
    IF NOT EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = NEW.teacher_user_id
          AND ur.school_id = NEW.school_id
          AND ur.role::text = 'teacher'
    ) THEN
        RAISE EXCEPTION 'Invalid teacher assignment: target user must have role teacher in the specified school.';
    END IF;

    -- Normalize trimmed text columns cleanly
    NEW.school_year := REGEXP_REPLACE(BTRIM(NEW.school_year), '\s+', '', 'g');
    NEW.section := REGEXP_REPLACE(BTRIM(NEW.section), '\s+', ' ', 'g');
    IF NEW.strand_or_track IS NOT NULL THEN
        NEW.strand_or_track := NULLIF(REGEXP_REPLACE(BTRIM(NEW.strand_or_track), '\s+', ' ', 'g'), '');
    END IF;
    IF NEW.subject_taught IS NOT NULL THEN
        NEW.subject_taught := NULLIF(REGEXP_REPLACE(BTRIM(NEW.subject_taught), '\s+', ' ', 'g'), '');
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_teacher_assignment_integrity ON public.teacher_assignments;
CREATE TRIGGER trg_enforce_teacher_assignment_integrity
    BEFORE INSERT OR UPDATE ON public.teacher_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_teacher_assignment_integrity();

-- Legacy per-school policy table retained strictly locked to Class Adviser-only scanning
-- Subject Teacher scanning is permanently disabled by CHECK constraint and trigger.
CREATE TABLE IF NOT EXISTS public.teacher_module_policies (
    school_id UUID PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
    allow_subject_teacher_scanning BOOLEAN NOT NULL DEFAULT FALSE
        CONSTRAINT chk_teacher_module_policies_adviser_only CHECK (allow_subject_teacher_scanning = FALSE),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE public.teacher_module_policies
SET allow_subject_teacher_scanning = FALSE,
    updated_at = NOW()
WHERE allow_subject_teacher_scanning IS TRUE;

ALTER TABLE public.teacher_module_policies
    DROP CONSTRAINT IF EXISTS chk_teacher_module_policies_adviser_only;
ALTER TABLE public.teacher_module_policies
    ADD CONSTRAINT chk_teacher_module_policies_adviser_only
    CHECK (allow_subject_teacher_scanning = FALSE);

CREATE OR REPLACE FUNCTION public.enforce_adviser_only_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE(NEW.allow_subject_teacher_scanning, FALSE) = TRUE THEN
        RAISE EXCEPTION 'Forbidden: Subject teacher scanning is permanently disabled. Only active Class Advisers may scan SF9/SF10 documents.';
    END IF;
    NEW.allow_subject_teacher_scanning := FALSE;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_adviser_only_policy ON public.teacher_module_policies;
CREATE TRIGGER trg_enforce_adviser_only_policy
    BEFORE INSERT OR UPDATE ON public.teacher_module_policies
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_adviser_only_policy();

DROP TRIGGER IF EXISTS update_teacher_module_policies_updated_at ON public.teacher_module_policies;
CREATE TRIGGER update_teacher_module_policies_updated_at
    BEFORE UPDATE ON public.teacher_module_policies
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Seed Class Adviser-only policy (Subject Teacher scanning permanently disabled) for TRIS if present
INSERT INTO public.teacher_module_policies (school_id, allow_subject_teacher_scanning)
SELECT id, FALSE
FROM public.schools
WHERE id = 'a0000000-0000-0000-0000-000000000001'
ON CONFLICT (school_id) DO UPDATE
SET allow_subject_teacher_scanning = FALSE;

-- ------------------------------------------------------------------------------
-- PART 3: Student Enrollment History & Identity Conflict Quarantine
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.student_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    school_year TEXT NOT NULL,
    grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    section TEXT NOT NULL,
    strand_or_track TEXT,
    adviser_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    enrollment_status TEXT NOT NULL DEFAULT 'active'
        CHECK (enrollment_status IN ('active', 'transferred', 'completed')),
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_student_enrollments_section_nonempty CHECK (BTRIM(section) <> ''),
    CONSTRAINT chk_student_enrollments_sy_format CHECK (BTRIM(school_year) ~ '^\d{4}\s*-\s*\d{4}$')
);

-- At most one current enrollment row per student per school year (race-safe)
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_enrollments_current_per_sy
    ON public.student_enrollments (student_id, BTRIM(school_year))
    WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_student_enrollments_section_roster
    ON public.student_enrollments (school_id, school_year, grade_level, public.normalize_section_key(section), is_current);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_student
    ON public.student_enrollments (student_id, school_year, effective_from DESC);

DROP TRIGGER IF EXISTS update_student_enrollments_updated_at ON public.student_enrollments;
CREATE TRIGGER update_student_enrollments_updated_at
    BEFORE UPDATE ON public.student_enrollments
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Identity & Section/Context Conflict Quarantine Table
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

CREATE INDEX IF NOT EXISTS idx_student_identity_conflicts_school_status
    ON public.student_identity_conflicts (school_id, status, created_at DESC);

DROP TRIGGER IF EXISTS update_student_identity_conflicts_updated_at ON public.student_identity_conflicts;
CREATE TRIGGER update_student_identity_conflicts_updated_at
    BEFORE UPDATE ON public.student_identity_conflicts
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------------------------
-- PART 4: Additive Assignment Context Columns on documents
-- (Canonical unique indexes from M021 are intentionally untouched!)
-- ------------------------------------------------------------------------------

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS teacher_assignment_id UUID REFERENCES public.teacher_assignments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS section TEXT,
    ADD COLUMN IF NOT EXISTS strand_or_track TEXT,
    ADD COLUMN IF NOT EXISTS assignment_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS assignment_confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_teacher_assignment_id
    ON public.documents (teacher_assignment_id, school_id, status);

CREATE INDEX IF NOT EXISTS idx_documents_section_scope
    ON public.documents (school_id, school_year, grade_level, public.normalize_section_key(section))
    WHERE section IS NOT NULL;

-- ------------------------------------------------------------------------------
-- PART 5: Assignment, Scanning & Enrollment SECURITY DEFINER RPCs
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_active_teacher_assignment(p_assignment_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.teacher_assignments ta
        JOIN public.user_roles ur
          ON ur.user_id = ta.teacher_user_id
         AND ur.school_id = ta.school_id
        WHERE ta.id = p_assignment_id
          AND ta.teacher_user_id = auth.uid()
          AND ta.assignment_status = 'active'
          AND ur.role = 'teacher'
          AND ur.account_status = 'Approved'
    );
$$;

REVOKE EXECUTE ON FUNCTION public.has_active_teacher_assignment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_teacher_assignment(UUID) TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.can_teacher_scan_with_assignment(p_assignment_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        public.is_admin()
        OR EXISTS (
            SELECT 1
            FROM public.teacher_assignments ta
            JOIN public.user_roles ur
              ON ur.user_id = ta.teacher_user_id
             AND ur.school_id = ta.school_id
            WHERE ta.id = p_assignment_id
              AND ta.teacher_user_id = auth.uid()
              AND ta.assignment_status = 'active'
              AND ta.assignment_type = 'class_adviser'
              AND ur.role = 'teacher'
              AND ur.account_status = 'Approved'
        );
$$;

REVOKE EXECUTE ON FUNCTION public.can_teacher_scan_with_assignment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_teacher_scan_with_assignment(UUID) TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.can_teacher_access_section(
    p_school_id UUID,
    p_school_year TEXT,
    p_grade_level TEXT,
    p_section TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.teacher_assignments ta
        JOIN public.user_roles ur
          ON ur.user_id = ta.teacher_user_id
         AND ur.school_id = ta.school_id
        WHERE ta.teacher_user_id = auth.uid()
          AND ta.school_id = p_school_id
          AND ta.assignment_status = 'active'
          AND ur.role = 'teacher'
          AND ur.account_status = 'Approved'
          AND REGEXP_REPLACE(BTRIM(ta.school_year), '\s+', '', 'g') = REGEXP_REPLACE(BTRIM(COALESCE(p_school_year, '')), '\s+', '', 'g')
          AND ta.grade_level = public.normalize_shs_grade_level(p_grade_level)
          AND public.normalize_section_key(ta.section) = public.normalize_section_key(p_section)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_teacher_access_section(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_teacher_access_section(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_teacher_access_document(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.documents d
        JOIN public.teacher_assignments ta
          ON ta.teacher_user_id = auth.uid()
         AND ta.school_id = d.school_id
         AND ta.assignment_status = 'active'
        JOIN public.user_roles ur
          ON ur.user_id = ta.teacher_user_id
         AND ur.school_id = ta.school_id
         AND ur.role = 'teacher'
         AND ur.account_status = 'Approved'
        WHERE d.id = p_document_id
          AND (
              d.teacher_assignment_id = ta.id
              OR (
                  REGEXP_REPLACE(BTRIM(ta.school_year), '\s+', '', 'g') = REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(d.school_year, ''), d.extracted_fields->>'school_year', '')), '\s+', '', 'g')
                  AND ta.grade_level = public.normalize_shs_grade_level(COALESCE(NULLIF(d.grade_level, ''), d.extracted_fields->>'grade_level'))
                  AND public.normalize_section_key(ta.section) = public.normalize_section_key(COALESCE(NULLIF(d.section, ''), d.extracted_fields->>'section', ''))
                  AND public.normalize_section_key(ta.section) <> ''
              )
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_teacher_access_document(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_teacher_access_document(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_teacher_access_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        EXISTS (
            SELECT 1
            FROM public.documents d
            WHERE d.student_id = p_student_id
              AND (
                  d.uploaded_by = auth.uid()::text
                  OR public.can_teacher_access_document(d.id)
              )
        )
        OR EXISTS (
            SELECT 1
            FROM public.student_enrollments se
            WHERE se.student_id = p_student_id
              AND (
                  se.adviser_user_id = auth.uid()
                  OR public.can_teacher_access_section(se.school_id, se.school_year, se.grade_level, se.section)
              )
        );
$$;

REVOKE EXECUTE ON FUNCTION public.can_teacher_access_student(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_teacher_access_student(UUID) TO authenticated, service_role;

-- Returns caller's active authorized assignments
CREATE OR REPLACE FUNCTION public.get_teacher_authorized_assignments()
RETURNS TABLE (
    id UUID,
    teacher_user_id UUID,
    school_id UUID,
    school_year TEXT,
    grade_level TEXT,
    section TEXT,
    strand_or_track TEXT,
    subject_taught TEXT,
    semester TEXT,
    assignment_type TEXT,
    assignment_status TEXT,
    allow_subject_teacher_scanning BOOLEAN
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        ta.id,
        ta.teacher_user_id,
        ta.school_id,
        ta.school_year,
        ta.grade_level,
        ta.section,
        ta.strand_or_track,
        ta.subject_taught,
        ta.semester,
        ta.assignment_type,
        ta.assignment_status,
        FALSE AS allow_subject_teacher_scanning
    FROM public.teacher_assignments ta
    JOIN public.user_roles ur
      ON ur.user_id = ta.teacher_user_id
     AND ur.school_id = ta.school_id
    WHERE ta.teacher_user_id = auth.uid()
      AND ta.assignment_status = 'active'
      AND ur.role = 'teacher'
      AND ur.account_status = 'Approved'
    ORDER BY ta.school_year DESC, ta.grade_level ASC, ta.section ASC, ta.assignment_type ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_teacher_authorized_assignments() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_teacher_authorized_assignments() TO authenticated, service_role;

-- School-scoped student identity lookup bypassing section-only RLS safely
CREATE OR REPLACE FUNCTION public.lookup_or_quarantine_student_identity(
    p_school_id UUID,
    p_lrn TEXT,
    p_first_name TEXT,
    p_last_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_norm_lrn TEXT := public.normalize_lrn_text(p_lrn);
    v_norm_first TEXT := LOWER(REGEXP_REPLACE(BTRIM(COALESCE(p_first_name, '')), '[^a-zA-Z0-9\s]', '', 'g'));
    v_norm_last TEXT := LOWER(REGEXP_REPLACE(BTRIM(COALESCE(p_last_name, '')), '[^a-zA-Z0-9\s]', '', 'g'));
    v_lrn_student public.students%ROWTYPE;
    v_name_student public.students%ROWTYPE;
    v_enrollment JSONB;
    v_lrn_last TEXT;
BEGIN
    -- Caller authorization check (approved staff of same school, admin, or service_role)
    IF COALESCE(current_setting('role', true), '') <> 'service_role' THEN
        IF NOT public.is_approved_staff() THEN
            RAISE EXCEPTION 'Forbidden: Approved staff role required.';
        END IF;
        IF NOT public.is_admin() AND public.get_auth_user_school_id() IS DISTINCT FROM p_school_id THEN
            RAISE EXCEPTION 'Forbidden: Cannot lookup student identities outside your assigned school.';
        END IF;
    END IF;

    -- 1. Search by normalized 12-digit LRN within school
    IF v_norm_lrn IS NOT NULL AND LENGTH(v_norm_lrn) = 12 THEN
        SELECT *
        INTO v_lrn_student
        FROM public.students s
        WHERE s.school_id = p_school_id
          AND public.normalize_lrn_text(s.lrn) = v_norm_lrn
        LIMIT 1;

        IF v_lrn_student.id IS NOT NULL THEN
            SELECT jsonb_build_object(
                'id', se.id,
                'school_year', se.school_year,
                'grade_level', se.grade_level,
                'section', se.section,
                'strand_or_track', se.strand_or_track,
                'enrollment_status', se.enrollment_status
            )
            INTO v_enrollment
            FROM public.student_enrollments se
            WHERE se.student_id = v_lrn_student.id
              AND se.is_current = TRUE
            ORDER BY se.effective_from DESC
            LIMIT 1;

            v_lrn_last := LOWER(REGEXP_REPLACE(BTRIM(COALESCE(v_lrn_student.last_name, '')), '[^a-zA-Z0-9\s]', '', 'g'));

            IF v_norm_last <> '' AND v_lrn_last <> '' AND v_lrn_last <> v_norm_last THEN
                RETURN jsonb_build_object(
                    'outcome', 'SAME_LRN_CONFLICT_NAME',
                    'student_id', v_lrn_student.id,
                    'matched_lrn', v_lrn_student.lrn,
                    'matched_name', BTRIM(COALESCE(v_lrn_student.first_name, '') || ' ' || COALESCE(v_lrn_student.last_name, '')),
                    'first_name', v_lrn_student.first_name,
                    'last_name', v_lrn_student.last_name,
                    'current_enrollment', COALESCE(v_enrollment, 'null'::jsonb)
                );
            END IF;

            RETURN jsonb_build_object(
                'outcome', 'MATCHED_LRN_AND_NAME',
                'student_id', v_lrn_student.id,
                'matched_lrn', v_lrn_student.lrn,
                'matched_name', BTRIM(COALESCE(v_lrn_student.first_name, '') || ' ' || COALESCE(v_lrn_student.last_name, '')),
                'first_name', v_lrn_student.first_name,
                'last_name', v_lrn_student.last_name,
                'current_enrollment', COALESCE(v_enrollment, 'null'::jsonb)
            );
        END IF;
    END IF;

    -- 2. Search by normalized First + Last Name within school (detect DIFF_LRN_SAME_NAME)
    IF v_norm_first <> '' AND v_norm_last <> '' THEN
        SELECT *
        INTO v_name_student
        FROM public.students s
        WHERE s.school_id = p_school_id
          AND LOWER(REGEXP_REPLACE(BTRIM(COALESCE(s.first_name, '')), '[^a-zA-Z0-9\s]', '', 'g')) = v_norm_first
          AND LOWER(REGEXP_REPLACE(BTRIM(COALESCE(s.last_name, '')), '[^a-zA-Z0-9\s]', '', 'g')) = v_norm_last
        LIMIT 1;

        IF v_name_student.id IS NOT NULL THEN
            IF v_norm_lrn IS NOT NULL AND v_name_student.lrn IS NOT NULL
               AND public.normalize_lrn_text(v_name_student.lrn) <> v_norm_lrn THEN
                RETURN jsonb_build_object(
                    'outcome', 'DIFF_LRN_SAME_NAME',
                    'student_id', v_name_student.id,
                    'matched_lrn', v_name_student.lrn,
                    'matched_name', BTRIM(COALESCE(v_name_student.first_name, '') || ' ' || COALESCE(v_name_student.last_name, '')),
                    'first_name', v_name_student.first_name,
                    'last_name', v_name_student.last_name,
                    'current_enrollment', 'null'::jsonb
                );
            END IF;

            RETURN jsonb_build_object(
                'outcome', 'MATCHED_NAME_ONLY',
                'student_id', v_name_student.id,
                'matched_lrn', v_name_student.lrn,
                'matched_name', BTRIM(COALESCE(v_name_student.first_name, '') || ' ' || COALESCE(v_name_student.last_name, '')),
                'first_name', v_name_student.first_name,
                'last_name', v_name_student.last_name,
                'current_enrollment', 'null'::jsonb
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'outcome', 'NO_MATCH',
        'student_id', NULL,
        'matched_lrn', NULL,
        'matched_name', NULL,
        'current_enrollment', 'null'::jsonb
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_or_quarantine_student_identity(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_or_quarantine_student_identity(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- Race-safe enrollment history upsert (never duplicates student row; logs transfers chronologically)
CREATE OR REPLACE FUNCTION public.upsert_student_enrollment_history(
    p_student_id UUID,
    p_school_id UUID,
    p_school_year TEXT,
    p_grade_level TEXT,
    p_section TEXT,
    p_strand_or_track TEXT DEFAULT NULL,
    p_adviser_user_id UUID DEFAULT NULL,
    p_source_document_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sy TEXT := REGEXP_REPLACE(BTRIM(COALESCE(p_school_year, '')), '\s+', '', 'g');
    v_grade TEXT := public.normalize_shs_grade_level(p_grade_level);
    v_section TEXT := REGEXP_REPLACE(BTRIM(COALESCE(p_section, '')), '\s+', ' ', 'g');
    v_strand TEXT := NULLIF(REGEXP_REPLACE(BTRIM(COALESCE(p_strand_or_track, '')), '\s+', ' ', 'g'), '');
    v_existing public.student_enrollments%ROWTYPE;
    v_new_id UUID;
BEGIN
    IF COALESCE(current_setting('role', true), '') <> 'service_role' THEN
        IF NOT public.is_approved_staff() THEN
            RAISE EXCEPTION 'Forbidden: Approved staff required to update student enrollment history.';
        END IF;
        IF NOT public.is_admin() AND public.get_auth_user_school_id() IS DISTINCT FROM p_school_id THEN
            RAISE EXCEPTION 'Forbidden: Cannot update enrollments outside your assigned school.';
        END IF;
    END IF;

    IF v_section = '' OR v_sy = '' OR v_grade IS NULL THEN
        RETURN jsonb_build_object('status', 'skipped', 'reason', 'incomplete_enrollment_context');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('student_enrollment:' || p_student_id::text || ':' || v_sy));

    SELECT *
    INTO v_existing
    FROM public.student_enrollments se
    WHERE se.student_id = p_student_id
      AND BTRIM(se.school_year) = v_sy
      AND se.is_current = TRUE
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        IF v_existing.grade_level = v_grade
           AND public.normalize_section_key(v_existing.section) = public.normalize_section_key(v_section)
           AND public.normalize_strand_key(v_existing.strand_or_track) = public.normalize_strand_key(v_strand) THEN
            UPDATE public.student_enrollments
            SET adviser_user_id = COALESCE(p_adviser_user_id, adviser_user_id),
                source_document_id = COALESCE(p_source_document_id, source_document_id),
                updated_at = NOW()
            WHERE id = v_existing.id;

            RETURN jsonb_build_object(
                'status', 'unchanged',
                'enrollment_id', v_existing.id,
                'transferred', false
            );
        END IF;

        -- Close prior section/strand record cleanly as historical transfer
        UPDATE public.student_enrollments
        SET is_current = FALSE,
            enrollment_status = 'transferred',
            effective_to = NOW(),
            updated_at = NOW()
        WHERE id = v_existing.id;
    END IF;

    INSERT INTO public.student_enrollments (
        student_id,
        school_id,
        school_year,
        grade_level,
        section,
        strand_or_track,
        adviser_user_id,
        source_document_id,
        enrollment_status,
        is_current,
        created_by
    ) VALUES (
        p_student_id,
        p_school_id,
        v_sy,
        v_grade,
        v_section,
        v_strand,
        p_adviser_user_id,
        p_source_document_id,
        'active',
        TRUE,
        auth.uid()
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'status', CASE WHEN v_existing.id IS NOT NULL THEN 'transferred' ELSE 'created' END,
        'enrollment_id', v_new_id,
        'transferred', (v_existing.id IS NOT NULL),
        'previous_section', v_existing.section,
        'previous_strand', v_existing.strand_or_track
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_student_enrollment_history(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_student_enrollment_history(UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID) TO authenticated, service_role;

-- Admin-only conflict resolution RPC
CREATE OR REPLACE FUNCTION public.resolve_section_or_identity_conflict(
    p_conflict_id UUID,
    p_resolution_status TEXT,
    p_resolution_notes TEXT,
    p_link_student_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_conflict public.student_identity_conflicts%ROWTYPE;
    v_linked_lrn TEXT;
BEGIN
    IF NOT public.is_admin() AND COALESCE(current_setting('role', true), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can resolve section or identity conflicts.';
    END IF;

    IF p_resolution_status NOT IN ('resolved', 'dismissed') THEN
        RAISE EXCEPTION 'Invalid resolution status: %', p_resolution_status;
    END IF;

    SELECT * INTO v_conflict
    FROM public.student_identity_conflicts
    WHERE id = p_conflict_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conflict record not found.';
    END IF;

    UPDATE public.student_identity_conflicts
    SET status = p_resolution_status,
        resolution_notes = NULLIF(BTRIM(p_resolution_notes), ''),
        resolved_by = auth.uid(),
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_conflict_id;

    IF p_link_student_id IS NOT NULL AND v_conflict.document_id IS NOT NULL AND p_resolution_status = 'resolved' THEN
        SELECT lrn INTO v_linked_lrn
        FROM public.students
        WHERE id = p_link_student_id;

        PERFORM set_config('avv.conflict_resolution_authorized', v_conflict.document_id::text, true);
        UPDATE public.documents
        SET student_id = p_link_student_id,
            canonical_lrn = COALESCE(v_linked_lrn, canonical_lrn),
            extracted_fields = COALESCE(extracted_fields, '{}'::jsonb) || jsonb_build_object(
                'lrn_conflict_verified', true,
                'identity_conflict', false,
                'manual_lrn_verification_required', false,
                'section_conflict_resolved', true
            ),
            updated_at = NOW()
        WHERE id = v_conflict.document_id;
    ELSIF v_conflict.document_id IS NOT NULL AND p_resolution_status = 'resolved' THEN
        UPDATE public.documents
        SET extracted_fields = COALESCE(extracted_fields, '{}'::jsonb) || jsonb_build_object(
                'identity_conflict', false,
                'section_conflict_resolved', true
            ),
            updated_at = NOW()
        WHERE id = v_conflict.document_id;
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_section_or_identity_conflict(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_section_or_identity_conflict(UUID, TEXT, TEXT, UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- PART 6: Database-Layer Guard for Subject Teacher Grade Editing Scope
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_teacher_document_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role_name TEXT;
    v_db_role TEXT := COALESCE(current_setting('role', true), '');
    v_is_adviser BOOLEAN := FALSE;
    v_allowed_subjects TEXT[];
    v_old_grades JSONB := COALESCE(OLD.extracted_fields->'grades', '[]'::jsonb);
    v_new_grades JSONB := COALESCE(NEW.extracted_fields->'grades', '[]'::jsonb);
    v_old_elem JSONB;
    v_new_elem JSONB;
    v_old_map JSONB := '{}'::jsonb;
    v_subj_key TEXT;
    v_old_norm JSONB;
    v_new_norm JSONB;
BEGIN
    IF auth.uid() IS NULL OR v_db_role = 'service_role' THEN
        RETURN NEW;
    END IF;

    SELECT role INTO v_role_name
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND account_status = 'Approved'
    LIMIT 1;

    IF v_role_name IN ('admin', 'principal') THEN
        RETURN NEW;
    END IF;

    -- Teachers can never self-approve or self-reject documents directly
    IF v_role_name = 'teacher' THEN
        IF NEW.status IN ('approved', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Forbidden: Teachers cannot approve or reject documents.';
        END IF;

        IF OLD.status = 'rejected' THEN
            RAISE EXCEPTION 'Forbidden: Rejected documents cannot be altered by teachers.';
        END IF;

        -- Check if caller is an active Class Adviser for this document or its section
        SELECT EXISTS (
            SELECT 1
            FROM public.teacher_assignments ta
            WHERE ta.teacher_user_id = auth.uid()
              AND ta.school_id = OLD.school_id
              AND ta.assignment_status = 'active'
              AND ta.assignment_type = 'class_adviser'
              AND (
                  OLD.teacher_assignment_id = ta.id
                  OR (
                      REGEXP_REPLACE(BTRIM(ta.school_year), '\s+', '', 'g') = REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(OLD.school_year, ''), OLD.extracted_fields->>'school_year', '')), '\s+', '', 'g')
                      AND ta.grade_level = public.normalize_shs_grade_level(COALESCE(NULLIF(OLD.grade_level, ''), OLD.extracted_fields->>'grade_level'))
                      AND public.normalize_section_key(ta.section) = public.normalize_section_key(COALESCE(NULLIF(OLD.section, ''), OLD.extracted_fields->>'section', ''))
                  )
              )
        ) INTO v_is_adviser;

        IF OLD.status = 'approved' THEN
            IF NOT v_is_adviser THEN
                RAISE EXCEPTION 'Forbidden: Approved documents cannot be modified or reprocessed by Subject Teachers.';
            END IF;
            IF NOT (NEW.status = 'needs_review' AND (NEW.extracted_fields ? 'incremental_update_summary')) THEN
                RAISE EXCEPTION 'Forbidden: Approved documents cannot be modified directly by teachers.';
            END IF;
        END IF;

        IF v_is_adviser THEN
            RETURN NEW;
        END IF;

        -- Subject teacher path: limit grade edits strictly to authorized subject(s)
        -- Allow authorized M021 conflict-resolution RPC if transaction-local GUC matches
        IF COALESCE(current_setting('avv.conflict_resolution_authorized', true), '') = NEW.id::text THEN
            RETURN NEW;
        END IF;

        IF NEW.image_url IS DISTINCT FROM OLD.image_url THEN
            RAISE EXCEPTION 'Forbidden: Subject teachers cannot upload or reprocess scanned document images.';
        END IF;

        IF (
            (OLD.extracted_fields->'incremental_update_summary') IS DISTINCT FROM (NEW.extracted_fields->'incremental_update_summary')
            OR (OLD.extracted_fields->'scan_history') IS DISTINCT FROM (NEW.extracted_fields->'scan_history')
            OR (OLD.extracted_fields->'ocr_provider') IS DISTINCT FROM (NEW.extracted_fields->'ocr_provider')
        ) THEN
            RAISE EXCEPTION 'Forbidden: Subject teachers cannot run OCR reprocessing or incremental scan updates.';
        END IF;

        IF (
            NEW.student_id IS DISTINCT FROM OLD.student_id
            OR NEW.canonical_lrn IS DISTINCT FROM OLD.canonical_lrn
            OR NEW.document_type IS DISTINCT FROM OLD.document_type
            OR NEW.school_id IS DISTINCT FROM OLD.school_id
            OR NEW.school_year IS DISTINCT FROM OLD.school_year
            OR NEW.grade_level IS DISTINCT FROM OLD.grade_level
            OR NEW.section IS DISTINCT FROM OLD.section
            OR NEW.strand_or_track IS DISTINCT FROM OLD.strand_or_track
            OR NEW.teacher_assignment_id IS DISTINCT FROM OLD.teacher_assignment_id
        ) THEN
            RAISE EXCEPTION 'Forbidden: Subject teachers cannot alter student identity or class assignment context.';
        END IF;

        IF (
            (OLD.extracted_fields->>'lrn') IS DISTINCT FROM (NEW.extracted_fields->>'lrn')
            OR (OLD.extracted_fields->>'first_name') IS DISTINCT FROM (NEW.extracted_fields->>'first_name')
            OR (OLD.extracted_fields->>'middle_name') IS DISTINCT FROM (NEW.extracted_fields->>'middle_name')
            OR (OLD.extracted_fields->>'last_name') IS DISTINCT FROM (NEW.extracted_fields->>'last_name')
            OR (OLD.extracted_fields->>'name') IS DISTINCT FROM (NEW.extracted_fields->>'name')
        ) THEN
            RAISE EXCEPTION 'Forbidden: Subject teachers may only modify grades for their assigned subjects and cannot alter student identity metadata.';
        END IF;

        SELECT ARRAY_AGG(public.normalize_subject_key(ta.subject_taught))
        INTO v_allowed_subjects
        FROM public.teacher_assignments ta
        WHERE ta.teacher_user_id = auth.uid()
          AND ta.school_id = OLD.school_id
          AND ta.assignment_status = 'active'
          AND ta.assignment_type = 'subject_teacher'
          AND ta.subject_taught IS NOT NULL
          AND (
              OLD.teacher_assignment_id = ta.id
              OR (
                  REGEXP_REPLACE(BTRIM(ta.school_year), '\s+', '', 'g') = REGEXP_REPLACE(BTRIM(COALESCE(NULLIF(OLD.school_year, ''), OLD.extracted_fields->>'school_year', '')), '\s+', '', 'g')
                  AND ta.grade_level = public.normalize_shs_grade_level(COALESCE(NULLIF(OLD.grade_level, ''), OLD.extracted_fields->>'grade_level'))
                  AND public.normalize_section_key(ta.section) = public.normalize_section_key(COALESCE(NULLIF(OLD.section, ''), OLD.extracted_fields->>'section', ''))
              )
          );

        IF v_allowed_subjects IS NULL OR ARRAY_LENGTH(v_allowed_subjects, 1) IS NULL THEN
            RAISE EXCEPTION 'Forbidden: You do not have an active assignment covering this document.';
        END IF;

        -- Only grades edits are permitted for Subject Teachers on non-adviser documents when grades change
        IF jsonb_typeof(v_old_grades) = 'array' AND jsonb_typeof(v_new_grades) = 'array' THEN
            FOR v_old_elem IN SELECT * FROM jsonb_array_elements(v_old_grades)
            LOOP
                v_subj_key := public.normalize_subject_key(v_old_elem->>'subject') || '|' || LOWER(COALESCE(v_old_elem->>'semester', ''));
                v_old_map := jsonb_set(v_old_map, ARRAY[v_subj_key], v_old_elem, true);
            END LOOP;

            FOR v_new_elem IN SELECT * FROM jsonb_array_elements(v_new_grades)
            LOOP
                v_subj_key := public.normalize_subject_key(v_new_elem->>'subject') || '|' || LOWER(COALESCE(v_new_elem->>'semester', ''));
                v_old_norm := v_old_map->v_subj_key;
                IF v_old_norm IS DISTINCT FROM v_new_elem THEN
                    IF NOT (public.normalize_subject_key(v_new_elem->>'subject') = ANY(v_allowed_subjects)) THEN
                        RAISE EXCEPTION 'Forbidden: Subject teacher is not authorized to modify grades for subject "%".', COALESCE(v_new_elem->>'subject', 'unknown');
                    END IF;
                END IF;
            END LOOP;

            -- Also block deleting an unauthorized subject row
            FOR v_old_elem IN SELECT * FROM jsonb_array_elements(v_old_grades)
            LOOP
                IF NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(v_new_grades) ne
                    WHERE public.normalize_subject_key(ne->>'subject') || '|' || LOWER(COALESCE(ne->>'semester', ''))
                        = public.normalize_subject_key(v_old_elem->>'subject') || '|' || LOWER(COALESCE(v_old_elem->>'semester', ''))
                ) THEN
                    IF NOT (public.normalize_subject_key(v_old_elem->>'subject') = ANY(v_allowed_subjects)) THEN
                        RAISE EXCEPTION 'Forbidden: Subject teacher is not authorized to modify grades for subject "%".', COALESCE(v_old_elem->>'subject', 'unknown');
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_teacher_document_updates ON public.documents;
CREATE TRIGGER trg_guard_teacher_document_updates
    BEFORE UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_teacher_document_updates();

-- ------------------------------------------------------------------------------
-- PART 7: Row Level Security Policies (New Tables + Assignment-Scoped Updates)
-- ------------------------------------------------------------------------------

ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_module_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_identity_conflicts ENABLE ROW LEVEL SECURITY;

-- 7.1 teacher_assignments policies
DROP POLICY IF EXISTS "Authorized read teacher_assignments" ON public.teacher_assignments;
DROP POLICY IF EXISTS "Admin insert teacher_assignments" ON public.teacher_assignments;
DROP POLICY IF EXISTS "Admin update teacher_assignments" ON public.teacher_assignments;
DROP POLICY IF EXISTS "Admin delete teacher_assignments" ON public.teacher_assignments;

CREATE POLICY "Authorized read teacher_assignments" ON public.teacher_assignments
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (public.is_principal() AND school_id = public.get_auth_user_school_id())
        OR (public.is_approved_teacher() AND teacher_user_id = auth.uid())
    );

CREATE POLICY "Admin insert teacher_assignments" ON public.teacher_assignments
    FOR INSERT WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "Admin update teacher_assignments" ON public.teacher_assignments
    FOR UPDATE USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "Admin delete teacher_assignments" ON public.teacher_assignments
    FOR DELETE USING (public.is_admin() OR auth.role() = 'service_role');

-- 7.2 teacher_module_policies policies
DROP POLICY IF EXISTS "Authorized read teacher_module_policies" ON public.teacher_module_policies;
DROP POLICY IF EXISTS "Admin manage teacher_module_policies" ON public.teacher_module_policies;

CREATE POLICY "Authorized read teacher_module_policies" ON public.teacher_module_policies
    FOR SELECT USING (
        auth.role() = 'service_role'
        OR public.is_admin()
        OR (public.is_approved_staff() AND school_id = public.get_auth_user_school_id())
    );

CREATE POLICY "Admin manage teacher_module_policies" ON public.teacher_module_policies
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- 7.3 student_enrollments policies
DROP POLICY IF EXISTS "Authorized read student_enrollments" ON public.student_enrollments;
DROP POLICY IF EXISTS "Admin manage student_enrollments" ON public.student_enrollments;

CREATE POLICY "Authorized read student_enrollments" ON public.student_enrollments
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (public.is_principal() AND school_id = public.get_auth_user_school_id())
        OR (
            public.is_approved_teacher()
            AND (
                adviser_user_id = auth.uid()
                OR public.can_teacher_access_section(school_id, school_year, grade_level, section)
            )
        )
    );

CREATE POLICY "Admin manage student_enrollments" ON public.student_enrollments
    FOR ALL USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- 7.4 student_identity_conflicts policies
DROP POLICY IF EXISTS "Authorized read student_identity_conflicts" ON public.student_identity_conflicts;
DROP POLICY IF EXISTS "Authorized insert student_identity_conflicts" ON public.student_identity_conflicts;
DROP POLICY IF EXISTS "Admin update student_identity_conflicts" ON public.student_identity_conflicts;
DROP POLICY IF EXISTS "Admin delete student_identity_conflicts" ON public.student_identity_conflicts;

CREATE POLICY "Authorized read student_identity_conflicts" ON public.student_identity_conflicts
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (public.is_principal() AND school_id = public.get_auth_user_school_id())
        OR (public.is_approved_teacher() AND created_by = auth.uid())
    );

CREATE POLICY "Authorized insert student_identity_conflicts" ON public.student_identity_conflicts
    FOR INSERT WITH CHECK (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_approved_teacher()
            AND school_id = public.get_auth_user_school_id()
            AND created_by = auth.uid()
            AND EXISTS (
                SELECT 1
                FROM public.teacher_assignments ta
                WHERE ta.teacher_user_id = auth.uid()
                  AND ta.school_id = student_identity_conflicts.school_id
                  AND ta.assignment_status = 'active'
                  AND ta.assignment_type = 'class_adviser'
            )
        )
    );

CREATE POLICY "Admin update student_identity_conflicts" ON public.student_identity_conflicts
    FOR UPDATE USING (public.is_admin() OR auth.role() = 'service_role')
    WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

CREATE POLICY "Admin delete student_identity_conflicts" ON public.student_identity_conflicts
    FOR DELETE USING (public.is_admin() OR auth.role() = 'service_role');

-- 7.5 Update students policies to support assigned section rosters without cross-school leakage
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
            AND public.can_teacher_access_student(students.id)
        )
    );

-- 7.6 Update documents policies to enforce active assignment + scanning policy
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
        OR (
            public.is_approved_teacher()
            AND (
                uploaded_by = auth.uid()::text
                OR public.can_teacher_access_document(documents.id)
                OR (
                    documents.student_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.student_enrollments se
                        WHERE se.student_id = documents.student_id
                          AND se.school_id = documents.school_id
                          AND (
                              se.adviser_user_id = auth.uid()
                              OR public.can_teacher_access_section(se.school_id, se.school_year, se.grade_level, se.section)
                          )
                    )
                )
            )
        )
    );

DROP POLICY IF EXISTS "Authorized insert documents" ON public.documents;
CREATE POLICY "Authorized insert documents" ON public.documents
    FOR INSERT WITH CHECK (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_approved_teacher()
            AND uploaded_by = auth.uid()::text
            AND school_id = public.get_auth_user_school_id()
            AND teacher_assignment_id IS NOT NULL
            AND public.can_teacher_scan_with_assignment(teacher_assignment_id)
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
        OR (
            public.is_approved_teacher()
            AND status NOT IN ('rejected', 'archived')
            AND (
                (uploaded_by = auth.uid()::text AND (teacher_assignment_id IS NULL OR public.has_active_teacher_assignment(teacher_assignment_id)))
                OR public.can_teacher_access_document(documents.id)
                OR (
                    documents.student_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.student_enrollments se
                        WHERE se.student_id = documents.student_id
                          AND se.school_id = documents.school_id
                          AND (
                              se.adviser_user_id = auth.uid()
                              OR public.can_teacher_access_section(se.school_id, se.school_year, se.grade_level, se.section)
                          )
                    )
                )
            )
        )
    )
    WITH CHECK (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal()
            AND documents.school_id IS NOT NULL
            AND documents.school_id = public.get_auth_user_school_id()
        )
        OR (
            public.is_approved_teacher()
            AND status NOT IN ('approved', 'rejected', 'archived')
            AND (
                (uploaded_by = auth.uid()::text AND (teacher_assignment_id IS NULL OR public.has_active_teacher_assignment(teacher_assignment_id)))
                OR public.can_teacher_access_document(documents.id)
                OR (
                    documents.student_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.student_enrollments se
                        WHERE se.student_id = documents.student_id
                          AND se.school_id = documents.school_id
                          AND (
                              se.adviser_user_id = auth.uid()
                              OR public.can_teacher_access_section(se.school_id, se.school_year, se.grade_level, se.section)
                          )
                    )
                )
            )
        )
    );

-- 7.7 Update subject_grades SELECT policy so assigned advisers/subject teachers can view section student grades
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
            AND (
                (subject_grades.document_id IS NOT NULL AND public.can_teacher_access_document(subject_grades.document_id))
                OR (subject_grades.student_id IS NOT NULL AND public.can_teacher_access_student(subject_grades.student_id))
                OR EXISTS (
                    SELECT 1 FROM public.documents d
                    WHERE d.id = subject_grades.document_id
                      AND d.uploaded_by = auth.uid()::text
                )
            )
        )
    );

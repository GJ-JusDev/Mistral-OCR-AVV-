-- ==============================================================================
-- Migration 015: LRN-Based Student Deduplication and Controlled Grade Updates
-- ==============================================================================
-- Purpose:
--   1. Enforces strict DepEd 12-digit Learner Reference Number (LRN) validation
--      and uniqueness at the database level with automatic trigger normalization.
--   2. Restores database-enforced uniqueness for active subject grades using a
--      composite unique index (student_id, school_year, semester, subject).
--   3. Ensures public.academic_standing_history table exists with RLS for full
--      Migration 010 SHS curriculum, metadata, and standing preservation.
--   4. Creates public.grade_change_history to audit manual/approved grade corrections,
--      protected by RLS excluding Pending, Declined, and cross-school access.
--   5. Provides authorized v_duplicate_students_report view with privacy filtering.
--   6. Hardens lookup_student_by_lrn() against cross-school bypass & unapproved users.
--   7. Provides safe, non-recursive BEFORE trigger for student linking on documents.
--   8. Preserves the FULL Migration 010 process_approved_document() logic (including
--      SHS curriculum, tracks, terms, remedial marks, general average, chronological
--      school-year dominance, lowercase status matching, and extracted_fields.grades)
--      while integrating controlled grade updates, DepEd DO 8, s. 2015 semestral final
--      grade recalculations, and strict non-NULL grade-change history protection.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. LRN Normalization Function, Trigger, and Defensive Constraints
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_student_lrn()
RETURNS trigger AS $$
BEGIN
    IF NEW.lrn IS NOT NULL THEN
        NEW.lrn := REGEXP_REPLACE(REGEXP_REPLACE(TRIM(NEW.lrn), '^[Ll][Rr][Nn][:\s\-]*', ''), '[\s\-–—\.]', '', 'g');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_student_lrn ON public.students;
CREATE TRIGGER trg_normalize_student_lrn
    BEFORE INSERT OR UPDATE OF lrn ON public.students
    FOR EACH ROW
    EXECUTE FUNCTION public.normalize_student_lrn();

-- In-place normalization of existing formatted LRNs (spaces, hyphens, prefixes)
UPDATE public.students
SET lrn = REGEXP_REPLACE(REGEXP_REPLACE(TRIM(lrn), '^[Ll][Rr][Nn][:\s\-]*', ''), '[\s\-–—\.]', '', 'g')
WHERE lrn IS NOT NULL AND lrn ~ '[\s\-–—\.]|^[Ll][Rr][Nn]';

DO $$
DECLARE
    dup_count integer;
    malformed_count integer;
BEGIN
    SELECT COUNT(*) INTO malformed_count
    FROM public.students
    WHERE lrn IS NOT NULL AND lrn !~ '^[0-9]{12}$';

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_students_lrn_format') THEN
        IF malformed_count = 0 THEN
            ALTER TABLE public.students
                ADD CONSTRAINT chk_students_lrn_format CHECK (lrn ~ '^[0-9]{12}$');
        ELSE
            ALTER TABLE public.students
                ADD CONSTRAINT chk_students_lrn_format CHECK (lrn ~ '^[0-9]{12}$') NOT VALID;
            RAISE NOTICE 'Added chk_students_lrn_format as NOT VALID due to % non-conforming legacy record(s).', malformed_count;
        END IF;
    END IF;

    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT lrn
        FROM public.students
        WHERE lrn IS NOT NULL
        GROUP BY lrn
        HAVING COUNT(*) > 1
    ) dups;

    IF dup_count = 0 THEN
        DROP INDEX IF EXISTS public.idx_students_normalized_lrn;
        CREATE UNIQUE INDEX idx_students_normalized_lrn
            ON public.students (lrn);
    ELSE
        RAISE EXCEPTION 'Cannot apply Migration 015: % duplicate LRN group(s) detected in public.students. Resolving duplicates is required to enforce unique LRN guarantees. Run: SELECT lrn, COUNT(*) FROM public.students GROUP BY lrn HAVING COUNT(*) > 1; to inspect and remediate conflicting records before reapplying.', dup_count
            USING ERRCODE = '23505';
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Database-Enforced Unique Composite Index for Active Subject Grades
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_subject_grade_uniqueness()
RETURNS trigger AS $$
BEGIN
    IF NEW.student_id IS NOT NULL AND NEW.school_year IS NOT NULL AND NEW.semester IS NOT NULL AND NEW.subject IS NOT NULL THEN
        -- Acquire a row-level lock on the parent student record to serialize concurrent grade writes for this student
        PERFORM 1 FROM public.students WHERE id = NEW.student_id FOR UPDATE;

        IF EXISTS (
            SELECT 1 FROM public.subject_grades
            WHERE student_id = NEW.student_id
              AND school_year = NEW.school_year
              AND semester = NEW.semester
              AND subject = NEW.subject
              AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        ) THEN
            RAISE EXCEPTION 'duplicate key value violates unique active grade constraint (student_id, school_year, semester, subject): (%, %, %, %)',
                NEW.student_id, NEW.school_year, NEW.semester, NEW.subject
                USING ERRCODE = 'unique_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_subject_grade_uniqueness ON public.subject_grades;
CREATE TRIGGER trg_check_subject_grade_uniqueness
    BEFORE INSERT OR UPDATE ON public.subject_grades
    FOR EACH ROW
    EXECUTE FUNCTION public.check_subject_grade_uniqueness();

DO $$
DECLARE
    dup_sg_count integer;
BEGIN
    SELECT COUNT(*) INTO dup_sg_count
    FROM (
        SELECT student_id, school_year, semester, subject
        FROM public.subject_grades
        WHERE student_id IS NOT NULL AND school_year IS NOT NULL AND semester IS NOT NULL AND subject IS NOT NULL
        GROUP BY student_id, school_year, semester, subject
        HAVING COUNT(*) > 1
    ) dups;

    IF dup_sg_count = 0 THEN
        DROP INDEX IF EXISTS public.idx_subject_grades_composite_active;
        CREATE UNIQUE INDEX idx_subject_grades_composite_active
            ON public.subject_grades (student_id, school_year, semester, subject);
    ELSE
        RAISE EXCEPTION 'Cannot apply Migration 015: % duplicate active subject grade group(s) detected in public.subject_grades. Resolving duplicate grades is required to enforce uniqueness. Run: SELECT student_id, school_year, semester, subject, COUNT(*) FROM public.subject_grades GROUP BY student_id, school_year, semester, subject HAVING COUNT(*) > 1; to inspect conflicting records before reapplying.', dup_sg_count
            USING ERRCODE = '23505';
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Academic Standing History Table & RLS (Preserves Migration 010 Invariants)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.academic_standing_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
    document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
    school_year text,
    grade_level text,
    curriculum text,
    source_form_version text,
    grading_policy_version text,
    general_average_printed numeric,
    previous_status text,
    new_status text NOT NULL CHECK (new_status IN ('Passed', 'Failed', 'Needs Verification')),
    decision_source text NOT NULL CHECK (decision_source IN ('automated_trigger', 'school_head_review', 'registrar_manual')),
    confirmed_by uuid,
    confirmation_notes text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academic_standing_history_student ON public.academic_standing_history(student_id);
CREATE INDEX IF NOT EXISTS idx_academic_standing_history_doc ON public.academic_standing_history(document_id);

ALTER TABLE public.academic_standing_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authorized read academic standing history" ON public.academic_standing_history;
CREATE POLICY "Authorized read academic standing history" ON public.academic_standing_history
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal()
            AND student_id IN (
                SELECT s.id FROM public.students s
                WHERE s.school_id = public.get_auth_user_school_id()
            )
        )
    );

-- ------------------------------------------------------------------------------
-- 4. Controlled Grade Change History Table & Hardened RLS Policies
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grade_change_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    subject_grade_id UUID REFERENCES public.subject_grades(id) ON DELETE SET NULL,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    school_year TEXT,
    semester TEXT,
    grade_level TEXT,
    subject TEXT NOT NULL,
    quarter TEXT NOT NULL, -- 'q1', 'q2', 'q3', 'q4', 'final_grade'
    previous_value NUMERIC,
    new_value NUMERIC,
    reason TEXT,
    changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_grade_change_hist_student ON public.grade_change_history(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grade_change_hist_doc ON public.grade_change_history(document_id);
CREATE INDEX IF NOT EXISTS idx_grade_change_hist_subject ON public.grade_change_history(student_id, subject);

ALTER TABLE public.grade_change_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authorized read grade_change_history" ON public.grade_change_history;
CREATE POLICY "Authorized read grade_change_history" ON public.grade_change_history
    FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_approved_staff()
            AND student_id IN (
                SELECT s.id FROM public.students s
                WHERE s.school_id = public.get_auth_user_school_id()
            )
        )
    );

-- ------------------------------------------------------------------------------
-- 5. Authorized Duplicate Students Reporting View
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_duplicate_students_report CASCADE;

CREATE VIEW public.v_duplicate_students_report AS
WITH grouped_students AS (
    SELECT 
        REGEXP_REPLACE(TRIM(s.lrn), '[\s\-–—\.]', '', 'g') AS normalized_lrn,
        COUNT(*) AS record_count,
        ARRAY_AGG(s.id) FILTER (WHERE public.is_admin() OR auth.role() = 'service_role' OR s.school_id = public.get_auth_user_school_id()) AS student_ids,
        ARRAY_AGG(s.first_name || ' ' || s.last_name) FILTER (WHERE public.is_admin() OR auth.role() = 'service_role' OR s.school_id = public.get_auth_user_school_id()) AS student_names,
        ARRAY_AGG(s.school_id) FILTER (WHERE public.is_admin() OR auth.role() = 'service_role' OR s.school_id = public.get_auth_user_school_id()) AS school_ids,
        MIN(s.created_at) FILTER (WHERE public.is_admin() OR auth.role() = 'service_role' OR s.school_id = public.get_auth_user_school_id()) AS first_created_at,
        MAX(s.created_at) FILTER (WHERE public.is_admin() OR auth.role() = 'service_role' OR s.school_id = public.get_auth_user_school_id()) AS last_created_at,
        BOOL_OR(s.school_id = public.get_auth_user_school_id()) AS belongs_to_user_school
    FROM public.students s
    WHERE s.lrn IS NOT NULL
    GROUP BY REGEXP_REPLACE(TRIM(s.lrn), '[\s\-–—\.]', '', 'g')
    HAVING COUNT(*) > 1
)
SELECT 
    normalized_lrn,
    record_count,
    student_ids,
    student_names,
    school_ids,
    first_created_at,
    last_created_at
FROM grouped_students
WHERE public.is_admin()
   OR auth.role() = 'service_role'
   OR (public.is_principal() AND belongs_to_user_school = true);

REVOKE ALL ON public.v_duplicate_students_report FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.v_duplicate_students_report FROM anon; END IF; END $$;
GRANT SELECT ON public.v_duplicate_students_report TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. Hardened LRN Student Lookup Function
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_student_by_lrn(
    p_lrn TEXT,
    p_school_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    lrn TEXT,
    first_name TEXT,
    last_name TEXT,
    school_id UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    clean_lrn TEXT;
    auth_school_id UUID;
BEGIN
    clean_lrn := REGEXP_REPLACE(REGEXP_REPLACE(TRIM(p_lrn), '^[Ll][Rr][Nn][:\s\-]*', ''), '[\s\-–—\.]', '', 'g');
    
    IF clean_lrn IS NULL OR clean_lrn = '' THEN
        RETURN;
    END IF;

    IF public.is_admin() OR auth.role() = 'service_role' THEN
        RETURN QUERY
        SELECT s.id, s.lrn, s.first_name, s.last_name, s.school_id, s.created_at, s.updated_at
        FROM public.students s
        WHERE REGEXP_REPLACE(TRIM(s.lrn), '[\s\-–—\.]', '', 'g') = clean_lrn
          AND (p_school_id IS NULL OR s.school_id = p_school_id)
        ORDER BY s.created_at ASC
        LIMIT 1;
        RETURN;
    ELSIF public.is_approved_staff() THEN
        SELECT ur.school_id INTO auth_school_id
        FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.account_status = 'Approved'
        LIMIT 1;

        IF auth_school_id IS NULL THEN
            RETURN;
        END IF;

        IF p_school_id IS NOT NULL AND p_school_id <> auth_school_id THEN
            RETURN;
        END IF;

        RETURN QUERY
        SELECT s.id, s.lrn, s.first_name, s.last_name, s.school_id, s.created_at, s.updated_at
        FROM public.students s
        WHERE REGEXP_REPLACE(TRIM(s.lrn), '[\s\-–—\.]', '', 'g') = clean_lrn
          AND s.school_id = auth_school_id
        ORDER BY s.created_at ASC
        LIMIT 1;
        RETURN;
    ELSE
        RETURN;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.lookup_student_by_lrn(TEXT, UUID) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE EXECUTE ON FUNCTION public.lookup_student_by_lrn(TEXT, UUID) FROM anon; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.lookup_student_by_lrn(TEXT, UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. Safe, Non-Recursive Student Linking & First-Time Creation Trigger
-- ------------------------------------------------------------------------------
-- Eliminates recursive UPDATE statements on public.documents from trigger context.
-- On approval, links existing student or safely creates verified student exactly once.
CREATE OR REPLACE FUNCTION public.link_document_student_before()
RETURNS trigger AS $$
DECLARE
    clean_lrn text;
    matched_student_id uuid;
    matched_student_school_id uuid;
    doc_school_id uuid;
BEGIN
    IF NEW.student_id IS NULL AND NEW.extracted_fields IS NOT NULL THEN
        clean_lrn := REGEXP_REPLACE(REGEXP_REPLACE(TRIM(COALESCE(
            NEW.extracted_fields->'student'->>'lrn',
            NEW.extracted_fields->>'lrn'
        )), '^[Ll][Rr][Nn][:\s\-]*', ''), '[\s\-–—\.]', '', 'g');

        IF clean_lrn ~ '^[0-9]{12}$' THEN
            -- Determine effective school_id for this document
            doc_school_id := NEW.school_id;
            IF doc_school_id IS NULL THEN
                SELECT school_id INTO doc_school_id
                FROM public.user_roles
                WHERE user_id = auth.uid()
                LIMIT 1;
            END IF;

            -- Check if a student with this LRN already exists
            SELECT id, school_id INTO matched_student_id, matched_student_school_id
            FROM public.students
            WHERE lrn = clean_lrn
            ORDER BY created_at ASC
            LIMIT 1;

            IF matched_student_id IS NOT NULL THEN
                -- Existing student found: enforce school isolation
                IF matched_student_school_id = doc_school_id THEN
                    -- Same school: safe to link
                    NEW.student_id := matched_student_id;
                ELSE
                    -- Cross-school conflict: LRN belongs to a different school
                    -- Prevent silent cross-school linking
                    IF LOWER(NEW.status) = 'approved' THEN
                        RAISE EXCEPTION 'Cross-school student conflict: LRN % is already registered to another school (School ID: %). Cross-school student linking or duplicate creation is prohibited without official transfer or administrative resolution.',
                            clean_lrn, matched_student_school_id
                            USING ERRCODE = '23505';
                    ELSE
                        -- In needs_review or pending, do not link to the other school
                        NEW.student_id := NULL;
                    END IF;
                END IF;

            ELSIF LOWER(NEW.status) = 'approved' THEN
                -- First-time student creation on human approval
                INSERT INTO public.students (
                    school_id,
                    lrn,
                    first_name,
                    last_name,
                    middle_name,
                    suffix,
                    grade_level,
                    status,
                    overall_status
                ) VALUES (
                    doc_school_id,
                    clean_lrn,
                    COALESCE(NULLIF(TRIM(NEW.extracted_fields->'student'->>'first_name'), ''), NULLIF(TRIM(NEW.extracted_fields->>'first_name'), ''), 'UNKNOWN'),
                    COALESCE(NULLIF(TRIM(NEW.extracted_fields->'student'->>'last_name'), ''), NULLIF(TRIM(NEW.extracted_fields->>'last_name'), ''), 'UNKNOWN'),
                    COALESCE(NULLIF(TRIM(NEW.extracted_fields->'student'->>'middle_name'), ''), NULLIF(TRIM(NEW.extracted_fields->>'middle_name'), '')),
                    COALESCE(NULLIF(TRIM(NEW.extracted_fields->'student'->>'suffix'), ''), NULLIF(TRIM(NEW.extracted_fields->>'suffix'), '')),
                    COALESCE(NULLIF(TRIM(NEW.extracted_fields->'student'->>'grade_level'), ''), NULLIF(TRIM(NEW.grade_level), ''), NULLIF(TRIM(NEW.extracted_fields->>'grade_level'), '')),
                    'active',
                    'Passed'
                )
                ON CONFLICT (lrn) DO NOTHING
                RETURNING id INTO matched_student_id;

                -- If conflict occurred (concurrent approval race), retrieve existing id
                IF matched_student_id IS NULL THEN
                    SELECT id, school_id INTO matched_student_id, matched_student_school_id
                    FROM public.students
                    WHERE lrn = clean_lrn
                    LIMIT 1;

                    IF matched_student_school_id = doc_school_id THEN
                        NEW.student_id := matched_student_id;
                    ELSE
                        RAISE EXCEPTION 'Cross-school student conflict: LRN % was registered by another school during concurrent processing.', clean_lrn
                            USING ERRCODE = '23505';
                    END IF;
                ELSE
                    NEW.student_id := matched_student_id;
                END IF;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_link_document_student_before ON public.documents;
CREATE TRIGGER trg_link_document_student_before
    BEFORE INSERT OR UPDATE OF student_id, extracted_fields, status ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.link_document_student_before();

-- ------------------------------------------------------------------------------
-- 8. Restored Full Migration 010 process_approved_document() with DepEd DO 8
--    Controlled Updates & Strict Non-NULL Grade Correction Protection
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_approved_document()
RETURNS TRIGGER AS $$
DECLARE
    grade_record jsonb;
    grades_array jsonb;
    target_doc_id uuid;
    target_student_id uuid;
    doc_school_year text;
    doc_grade_level text;
    doc_semester text;
    doc_curriculum_id text;
    doc_source_form_version text;
    doc_grading_policy_version text;
    doc_grading_period_scheme text;
    doc_gen_ave_printed numeric;
    doc_sy_match text[];
    doc_sy_start integer;
    doc_period_norm text;
    doc_period_family text;
    doc_period_order integer;
    existing_doc record;
    existing_hist record;
    existing_raw_sy text;
    existing_sy_match text[];
    existing_sy_start integer;
    existing_raw_sem text;
    existing_period_norm text;
    existing_period_family text;
    existing_period_order integer;
    principal_confirmed_status text;
    hist_sy_start integer;
    current_overall_status text;
    old_overall_status text;
    is_archived_doc boolean := false;
    latest_approved_doc_id uuid;
    failed_count integer := 0;
    unverified_count integer := 0;
    clean_q1 numeric;
    clean_q2 numeric;
    clean_q3 numeric;
    clean_q4 numeric;
    clean_t1 numeric;
    clean_t2 numeric;
    clean_t3 numeric;
    clean_sem1_final numeric;
    clean_sem2_final numeric;
    clean_units numeric;
    clean_failed_final numeric;
    clean_remedial_mark numeric;
    clean_recomputed_final numeric;
    clean_rem_sem1 numeric;
    clean_rem_sem2 numeric;
    clean_final numeric;
    clean_status text;
    clean_needs_verif boolean;
    clean_grade_level text;
    clean_semester text;
    clean_source_section text;
    clean_subject_track text;
    clean_subject_category text;
    clean_subject_code text;
    clean_scheme text;
    clean_action_taken text;
    clean_remark text;
    clean_curriculum_id text;
    clean_source_form_version text;
    clean_grading_policy_version text;
    clean_subj text;
    clean_sy text;
    clean_gl text;
    clean_sem text;
    existing_grade record;
    computed_final numeric;
    quarters_changed boolean;
    prior_approved_doc record;
    prior_doc_grade jsonb;
    prior_doc_id uuid;
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

    -- ==========================================================================
    -- CASE A: Document approved OR updated while in approved state
    -- Supports both lowercase 'approved' (Migration 010) and 'Approved'
    -- ==========================================================================
    IF TG_OP = 'UPDATE' AND LOWER(NEW.status) = 'approved' AND (LOWER(OLD.status) != 'approved' OR NEW.extracted_fields IS DISTINCT FROM OLD.extracted_fields) THEN

        -- Extract document-level metadata without inventing defaults (Migration 010 standard)
        doc_school_year := COALESCE(
            NULLIF(TRIM(NEW.school_year), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'school_year'), '')
        );
        doc_grade_level := COALESCE(
            NULLIF(TRIM(NEW.grade_level), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'grade_level'), '')
        );
        doc_semester := COALESCE(
            NULLIF(TRIM(NEW.semester), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'semester'), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'term'), '')
        );
        doc_curriculum_id := COALESCE(
            NULLIF(TRIM(NEW.curriculum_id), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'curriculum_id'), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'curriculum'), '')
        );
        doc_source_form_version := COALESCE(
            NULLIF(TRIM(NEW.source_form_version), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'source_form_version'), '')
        );
        doc_grading_policy_version := COALESCE(
            NULLIF(TRIM(NEW.grading_policy_version), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'grading_policy_version'), '')
        );
        doc_grading_period_scheme := COALESCE(
            NULLIF(TRIM(NEW.grading_period_scheme), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'grading_period_scheme'), '')
        );
        doc_gen_ave_printed := COALESCE(
            NEW.general_average_printed,
            CASE
                WHEN (NEW.extracted_fields->>'general_average') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN (NEW.extracted_fields->>'general_average')::numeric
                ELSE NULL
            END
        );

        -- Capture student's existing overall status
        SELECT overall_status INTO old_overall_status FROM public.students WHERE id = NEW.student_id;

        -- Chronological dominance checks (Migration 010 standard)
        doc_sy_match := regexp_match(doc_school_year, '^(?:[Ss]\.?[Yy]\.?\s*)?(20[0-9]{2})\s*[-–/]\s*(20[0-9]{2})$');
        IF doc_sy_match IS NOT NULL AND (doc_sy_match[2])::integer = (doc_sy_match[1])::integer + 1 THEN
            doc_sy_start := (doc_sy_match[1])::integer;
        ELSE
            doc_sy_start := NULL;
        END IF;

        doc_period_norm := LOWER(REGEXP_REPLACE(COALESCE(doc_semester, ''), '\s+', ' ', 'g'));
        IF doc_period_norm IN ('1st semester', 'first semester', 'sem: first', 'semester 1', 'sem 1', '1st sem', 'first sem', 'first', '1st') THEN
            doc_period_family := 'semester';
            doc_period_order := 1;
        ELSIF doc_period_norm IN ('2nd semester', 'second semester', 'sem: second', 'semester 2', 'sem 2', '2nd sem', 'second sem', 'second', '2nd') THEN
            doc_period_family := 'semester';
            doc_period_order := 2;
        ELSIF doc_period_norm IN ('term 1', '1st term', 'first term', 'term: 1', 'unang termino', 'term 1 (unang termino)') THEN
            doc_period_family := 'three_term';
            doc_period_order := 1;
        ELSIF doc_period_norm IN ('term 2', '2nd term', 'second term', 'term: 2', 'ikalawang termino', 'term 2 (ikalawang termino)') THEN
            doc_period_family := 'three_term';
            doc_period_order := 2;
        ELSIF doc_period_norm IN ('term 3', '3rd term', 'third term', 'term: 3', 'ikatlong termino', 'term 3 (ikatlong termino)') THEN
            doc_period_family := 'three_term';
            doc_period_order := 3;
        ELSIF doc_period_norm IN ('summary', 'summary of final grades', 'full year', 'annual') THEN
            doc_period_family := 'summary';
            doc_period_order := 1;
        ELSE
            doc_period_family := NULL;
            doc_period_order := NULL;
        END IF;

        FOR existing_doc IN
            SELECT d.id, d.school_year, d.semester, d.extracted_fields
            FROM public.documents d
            WHERE d.student_id = NEW.student_id
              AND LOWER(d.status) = 'approved'
              AND d.id != NEW.id
        LOOP
            existing_raw_sy := COALESCE(
                NULLIF(TRIM(existing_doc.school_year), ''),
                NULLIF(TRIM(existing_doc.extracted_fields->>'school_year'), '')
            );
            existing_sy_match := regexp_match(existing_raw_sy, '^(?:[Ss]\.?[Yy]\.?\s*)?(20[0-9]{2})\s*[-–/]\s*(20[0-9]{2})$');
            IF existing_sy_match IS NOT NULL AND (existing_sy_match[2])::integer = (existing_sy_match[1])::integer + 1 THEN
                existing_sy_start := (existing_sy_match[1])::integer;
            ELSE
                existing_sy_start := NULL;
            END IF;

            existing_raw_sem := COALESCE(
                NULLIF(TRIM(existing_doc.semester), ''),
                NULLIF(TRIM(existing_doc.extracted_fields->>'semester'), ''),
                NULLIF(TRIM(existing_doc.extracted_fields->>'term'), '')
            );
            existing_period_norm := LOWER(REGEXP_REPLACE(COALESCE(existing_raw_sem, ''), '\s+', ' ', 'g'));
            IF existing_period_norm IN ('1st semester', 'first semester', 'sem: first', 'semester 1', 'sem 1', '1st sem', 'first sem', 'first', '1st') THEN
                existing_period_family := 'semester';
                existing_period_order := 1;
            ELSIF existing_period_norm IN ('2nd semester', 'second semester', 'sem: second', 'semester 2', 'sem 2', '2nd sem', 'second sem', 'second', '2nd') THEN
                existing_period_family := 'semester';
                existing_period_order := 2;
            ELSIF existing_period_norm IN ('term 1', '1st term', 'first term', 'term: 1', 'unang termino', 'term 1 (unang termino)') THEN
                existing_period_family := 'three_term';
                existing_period_order := 1;
            ELSIF existing_period_norm IN ('term 2', '2nd term', 'second term', 'term: 2', 'ikalawang termino', 'term 2 (ikalawang termino)') THEN
                existing_period_family := 'three_term';
                existing_period_order := 2;
            ELSIF existing_period_norm IN ('term 3', '3rd term', 'third term', 'term: 3', 'ikatlong termino', 'term 3 (ikatlong termino)') THEN
                existing_period_family := 'three_term';
                existing_period_order := 3;
            ELSIF existing_period_norm IN ('summary', 'summary of final grades', 'full year', 'annual') THEN
                existing_period_family := 'summary';
                existing_period_order := 1;
            ELSE
                existing_period_family := NULL;
                existing_period_order := NULL;
            END IF;

            IF existing_sy_start IS NOT NULL THEN
                IF doc_sy_start IS NULL THEN
                    is_archived_doc := true;
                ELSIF doc_sy_start < existing_sy_start THEN
                    is_archived_doc := true;
                ELSIF doc_sy_start = existing_sy_start THEN
                    IF doc_period_family IS NOT NULL AND existing_period_family IS NOT NULL THEN
                        IF doc_period_family IN ('semester', 'three_term')
                           AND existing_period_family = doc_period_family
                           AND doc_period_order < existing_period_order THEN
                            is_archived_doc := true;
                        ELSIF existing_period_family = 'summary'
                              AND doc_period_family IN ('semester', 'three_term') THEN
                            is_archived_doc := true;
                        END IF;
                    END IF;
                END IF;
            END IF;
        END LOOP;

        -- Check Principal / Registrar confirmations in academic_standing_history
        principal_confirmed_status := NULL;
        hist_sy_start := NULL;
        SELECT
            h.new_status,
            CASE
                WHEN sy.m IS NOT NULL AND (sy.m[2])::integer = (sy.m[1])::integer + 1
                THEN (sy.m[1])::integer
                ELSE NULL
            END
        INTO principal_confirmed_status, hist_sy_start
        FROM public.academic_standing_history h
        CROSS JOIN LATERAL (
            SELECT regexp_match(
                NULLIF(TRIM(h.school_year), ''),
                '^(?:[Ss]\.?[Yy]\.?\s*)?(20[0-9]{2})\s*[-–/]\s*(20[0-9]{2})$'
            ) AS m
        ) sy
        WHERE h.student_id = NEW.student_id
          AND h.decision_source IN ('school_head_review', 'registrar_manual')
        ORDER BY
            CASE
                WHEN sy.m IS NOT NULL AND (sy.m[2])::integer = (sy.m[1])::integer + 1
                THEN (sy.m[1])::integer
                ELSE NULL
            END DESC NULLS LAST,
            h.created_at DESC,
            h.id DESC
        LIMIT 1;

        IF principal_confirmed_status IS NOT NULL THEN
            IF hist_sy_start IS NULL OR doc_sy_start IS NULL OR doc_sy_start <= hist_sy_start THEN
                is_archived_doc := true;
            END IF;
        END IF;

        -- Determine grades array from extracted_fields (supporting both 'grades' and 'subjects')
        grades_array := CASE
            WHEN NEW.extracted_fields IS NOT NULL AND jsonb_typeof(NEW.extracted_fields->'grades') = 'array' THEN NEW.extracted_fields->'grades'
            WHEN NEW.extracted_fields IS NOT NULL AND jsonb_typeof(NEW.extracted_fields->'subjects') = 'array' THEN NEW.extracted_fields->'subjects'
            ELSE NULL
        END;

        IF grades_array IS NOT NULL THEN
            FOR grade_record IN SELECT * FROM jsonb_array_elements(grades_array)
            LOOP
                clean_subj := TRIM(COALESCE(grade_record->>'subject', grade_record->>'subject_name'));
                IF clean_subj IS NULL OR clean_subj = '' THEN
                    CONTINUE;
                END IF;

                clean_q1 := CASE WHEN (grade_record->>'q1') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'q1')::numeric ELSE NULL END;
                clean_q2 := CASE WHEN (grade_record->>'q2') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'q2')::numeric ELSE NULL END;
                clean_q3 := CASE WHEN (grade_record->>'q3') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'q3')::numeric ELSE NULL END;
                clean_q4 := CASE WHEN (grade_record->>'q4') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'q4')::numeric ELSE NULL END;
                clean_t1 := CASE WHEN (grade_record->>'t1') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'t1')::numeric ELSE NULL END;
                clean_t2 := CASE WHEN (grade_record->>'t2') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'t2')::numeric ELSE NULL END;
                clean_t3 := CASE WHEN (grade_record->>'t3') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'t3')::numeric ELSE NULL END;
                clean_sem1_final := CASE WHEN (grade_record->>'sem1_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'sem1_final_grade')::numeric ELSE NULL END;
                clean_sem2_final := CASE WHEN (grade_record->>'sem2_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'sem2_final_grade')::numeric ELSE NULL END;
                clean_units := CASE WHEN (grade_record->>'units') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'units')::numeric ELSE NULL END;
                clean_failed_final := CASE WHEN (grade_record->>'failed_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'failed_final_grade')::numeric ELSE NULL END;
                clean_remedial_mark := CASE WHEN (grade_record->>'remedial_class_mark') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'remedial_class_mark')::numeric ELSE NULL END;
                clean_recomputed_final := CASE WHEN (grade_record->>'recomputed_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'recomputed_final_grade')::numeric ELSE NULL END;
                clean_rem_sem1 := CASE WHEN (grade_record->>'remedial_sem1_recomputed') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'remedial_sem1_recomputed')::numeric ELSE NULL END;
                clean_rem_sem2 := CASE WHEN (grade_record->>'remedial_sem2_recomputed') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'remedial_sem2_recomputed')::numeric ELSE NULL END;
                
                clean_final := CASE
                    WHEN (grade_record->>'final') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'final')::numeric
                    WHEN (grade_record->>'final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'final_grade')::numeric
                    ELSE NULL
                END;

                clean_action_taken := NULLIF(TRIM(grade_record->>'action_taken'), '');
                clean_remark := NULLIF(TRIM(grade_record->>'remark'), '');

                clean_status := CASE
                    WHEN LOWER(COALESCE(grade_record->>'status', '')) = 'passed' THEN 'Passed'
                    WHEN LOWER(COALESCE(grade_record->>'status', '')) = 'failed' THEN 'Failed'
                    ELSE NULL
                END;

                clean_needs_verif := COALESCE(
                    (grade_record->>'needsVerification')::boolean,
                    (grade_record->>'needs_verification')::boolean,
                    false
                );

                clean_grade_level := COALESCE(NULLIF(TRIM(grade_record->>'grade_level'), ''), doc_grade_level);
                clean_semester := COALESCE(NULLIF(TRIM(grade_record->>'semester'), ''), doc_semester);
                clean_source_section := NULLIF(TRIM(grade_record->>'source_section'), '');
                clean_subject_track := COALESCE(
                    NULLIF(TRIM(grade_record->>'subject_track'), ''),
                    NULLIF(TRIM(grade_record->>'track'), '')
                );
                clean_subject_category := COALESCE(
                    NULLIF(TRIM(grade_record->>'subject_category'), ''),
                    NULLIF(TRIM(grade_record->>'category'), '')
                );
                clean_subject_code := NULLIF(TRIM(grade_record->>'subject_code'), '');
                clean_scheme := COALESCE(
                    NULLIF(TRIM(grade_record->>'grading_period_scheme'), ''),
                    doc_grading_period_scheme
                );
                clean_curriculum_id := COALESCE(
                    NULLIF(TRIM(grade_record->>'curriculum_id'), ''),
                    doc_curriculum_id
                );
                clean_source_form_version := COALESCE(
                    NULLIF(TRIM(grade_record->>'source_form_version'), ''),
                    doc_source_form_version
                );
                clean_grading_policy_version := COALESCE(
                    NULLIF(TRIM(grade_record->>'grading_policy_version'), ''),
                    doc_grading_policy_version
                );

                clean_sy := doc_school_year;
                clean_gl := clean_grade_level;
                clean_sem := clean_semester;

                -- Check if active grade record exists for this student, year, sem, and subject
                SELECT * INTO existing_grade
                FROM public.subject_grades
                WHERE student_id = NEW.student_id
                  AND school_year = clean_sy
                  AND semester = clean_sem
                  AND subject = clean_subj
                LIMIT 1;

                IF existing_grade.id IS NOT NULL THEN
                    -- Only non-NULL reviewed values count as actual changes
                    quarters_changed := (clean_q1 IS NOT NULL AND clean_q1 IS DISTINCT FROM existing_grade.q1)
                                     OR (clean_q2 IS NOT NULL AND clean_q2 IS DISTINCT FROM existing_grade.q2)
                                     OR (clean_q3 IS NOT NULL AND clean_q3 IS DISTINCT FROM existing_grade.q3)
                                     OR (clean_q4 IS NOT NULL AND clean_q4 IS DISTINCT FROM existing_grade.q4);

                    computed_final := NULL;
                    IF clean_sem IN ('1st', '1st Semester', 'First Semester', 'sem 1', 'semester 1') THEN
                        IF COALESCE(clean_q1, existing_grade.q1) IS NOT NULL AND COALESCE(clean_q2, existing_grade.q2) IS NOT NULL THEN
                            computed_final := ROUND((COALESCE(clean_q1, existing_grade.q1) + COALESCE(clean_q2, existing_grade.q2)) / 2.0);
                        END IF;
                    ELSIF clean_sem IN ('2nd', '2nd Semester', 'Second Semester', 'sem 2', 'semester 2') THEN
                        IF COALESCE(clean_q3, existing_grade.q3) IS NOT NULL AND COALESCE(clean_q4, existing_grade.q4) IS NOT NULL THEN
                            computed_final := ROUND((COALESCE(clean_q3, existing_grade.q3) + COALESCE(clean_q4, existing_grade.q4)) / 2.0);
                        END IF;
                    END IF;

                    IF quarters_changed THEN
                        clean_final := COALESCE(computed_final, clean_final, existing_grade.final_grade);
                    ELSE
                        clean_final := COALESCE(clean_final, existing_grade.final_grade);
                    END IF;

                    clean_status := CASE 
                        WHEN clean_final IS NOT NULL AND clean_final >= 75 THEN 'Passed'
                        WHEN clean_final IS NOT NULL AND clean_final < 75 THEN 'Failed'
                        ELSE COALESCE(clean_status, existing_grade.status, 'Missing')
                    END;

                    clean_needs_verif := CASE
                        WHEN clean_final IS NOT NULL THEN false
                        ELSE COALESCE(clean_needs_verif, existing_grade.needs_verification, true)
                    END;

                    -- Record grade_change_history ONLY for actual non-NULL reviewed changes
                    IF clean_q1 IS NOT NULL AND clean_q1 IS DISTINCT FROM existing_grade.q1 THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, NEW.student_id, NEW.id, clean_sy, clean_sem, COALESCE(clean_gl, existing_grade.grade_level),
                            clean_subj, 'q1', existing_grade.q1, clean_q1, 'Approved grade update via document review', auth.uid()
                        );
                    END IF;

                    IF clean_q2 IS NOT NULL AND clean_q2 IS DISTINCT FROM existing_grade.q2 THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, NEW.student_id, NEW.id, clean_sy, clean_sem, COALESCE(clean_gl, existing_grade.grade_level),
                            clean_subj, 'q2', existing_grade.q2, clean_q2, 'Approved grade update via document review', auth.uid()
                        );
                    END IF;

                    IF clean_q3 IS NOT NULL AND clean_q3 IS DISTINCT FROM existing_grade.q3 THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, NEW.student_id, NEW.id, clean_sy, clean_sem, COALESCE(clean_gl, existing_grade.grade_level),
                            clean_subj, 'q3', existing_grade.q3, clean_q3, 'Approved grade update via document review', auth.uid()
                        );
                    END IF;

                    IF clean_q4 IS NOT NULL AND clean_q4 IS DISTINCT FROM existing_grade.q4 THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, NEW.student_id, NEW.id, clean_sy, clean_sem, COALESCE(clean_gl, existing_grade.grade_level),
                            clean_subj, 'q4', existing_grade.q4, clean_q4, 'Approved grade update via document review', auth.uid()
                        );
                    END IF;

                    IF clean_final IS NOT NULL AND clean_final IS DISTINCT FROM existing_grade.final_grade THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, NEW.student_id, NEW.id, clean_sy, clean_sem, COALESCE(clean_gl, existing_grade.grade_level),
                            clean_subj, 'final_grade', existing_grade.final_grade, clean_final,
                            CASE WHEN quarters_changed THEN 'Recalculated dependent final grade' ELSE 'Approved grade update via document review' END,
                            auth.uid()
                        );
                    END IF;

                    UPDATE public.subject_grades
                    SET document_id = NEW.id,
                        grade_level = COALESCE(clean_gl, existing_grade.grade_level),
                        q1 = COALESCE(clean_q1, existing_grade.q1),
                        q2 = COALESCE(clean_q2, existing_grade.q2),
                        q3 = COALESCE(clean_q3, existing_grade.q3),
                        q4 = COALESCE(clean_q4, existing_grade.q4),
                        t1 = COALESCE(clean_t1, existing_grade.t1),
                        t2 = COALESCE(clean_t2, existing_grade.t2),
                        t3 = COALESCE(clean_t3, existing_grade.t3),
                        sem1_final_grade = COALESCE(clean_sem1_final, existing_grade.sem1_final_grade),
                        sem2_final_grade = COALESCE(clean_sem2_final, existing_grade.sem2_final_grade),
                        units = COALESCE(clean_units, existing_grade.units),
                        failed_final_grade = COALESCE(clean_failed_final, existing_grade.failed_final_grade),
                        remedial_class_mark = COALESCE(clean_remedial_mark, existing_grade.remedial_class_mark),
                        recomputed_final_grade = COALESCE(clean_recomputed_final, existing_grade.recomputed_final_grade),
                        remedial_sem1_recomputed = COALESCE(clean_rem_sem1, existing_grade.remedial_sem1_recomputed),
                        remedial_sem2_recomputed = COALESCE(clean_rem_sem2, existing_grade.remedial_sem2_recomputed),
                        final_grade = clean_final,
                        action_taken = COALESCE(clean_action_taken, existing_grade.action_taken),
                        remark = COALESCE(clean_remark, existing_grade.remark),
                        status = clean_status,
                        needs_verification = clean_needs_verif,
                        curriculum_id = COALESCE(clean_curriculum_id, existing_grade.curriculum_id),
                        source_form_version = COALESCE(clean_source_form_version, existing_grade.source_form_version),
                        grading_policy_version = COALESCE(clean_grading_policy_version, existing_grade.grading_policy_version),
                        updated_at = now()
                    WHERE id = existing_grade.id;

                ELSE
                    -- New subject grade insertion: compute final grade under DepEd DO 8 if missing from form
                    IF clean_final IS NULL THEN
                        IF clean_q1 IS NOT NULL AND clean_q2 IS NOT NULL AND (clean_sem IN ('1st', '1st Semester', 'First Semester', 'sem 1', 'semester 1') OR clean_sem IS NULL) THEN
                            clean_final := ROUND((clean_q1 + clean_q2) / 2.0);
                        ELSIF clean_q3 IS NOT NULL AND clean_q4 IS NOT NULL AND (clean_sem IN ('2nd', '2nd Semester', 'Second Semester', 'sem 2', 'semester 2')) THEN
                            clean_final := ROUND((clean_q3 + clean_q4) / 2.0);
                        ELSIF clean_q1 IS NOT NULL AND clean_q2 IS NOT NULL AND clean_q3 IS NOT NULL AND clean_q4 IS NOT NULL THEN
                            clean_final := ROUND((clean_q1 + clean_q2 + clean_q3 + clean_q4) / 4.0);
                        END IF;
                    END IF;

                    IF clean_final IS NOT NULL THEN
                        IF clean_final >= 75 THEN
                            clean_status := 'Passed';
                            clean_needs_verif := false;
                        ELSE
                            clean_status := 'Failed';
                            clean_needs_verif := false;
                        END IF;
                    ELSE
                        clean_status := COALESCE(clean_status, 'Missing');
                        clean_needs_verif := true;
                    END IF;

                    INSERT INTO public.subject_grades (
                        student_id, document_id, school_year, grade_level, semester,
                        source_section, subject_track, subject_category, subject_code, grading_period_scheme,
                        subject, q1, q2, q3, q4, t1, t2, t3,
                        sem1_final_grade, sem2_final_grade, units, failed_final_grade,
                        remedial_class_mark, recomputed_final_grade, remedial_sem1_recomputed, remedial_sem2_recomputed,
                        final_grade, action_taken, remark, status, needs_verification,
                        curriculum_id, source_form_version, grading_policy_version
                    ) VALUES (
                        NEW.student_id, NEW.id, clean_sy, clean_gl, clean_sem,
                        clean_source_section, clean_subject_track, clean_subject_category, clean_subject_code, clean_scheme,
                        clean_subj, clean_q1, clean_q2, clean_q3, clean_q4, clean_t1, clean_t2, clean_t3,
                        clean_sem1_final, clean_sem2_final, clean_units, clean_failed_final,
                        clean_remedial_mark, clean_recomputed_final, clean_rem_sem1, clean_rem_sem2,
                        clean_final, clean_action_taken, clean_remark, clean_status, clean_needs_verif,
                        clean_curriculum_id, clean_source_form_version, clean_grading_policy_version
                    );
                END IF;

            END LOOP;

            -- Calculate academic standing (Migration 010 standard)
            SELECT 
                COUNT(*) FILTER (WHERE status = 'Failed'),
                COUNT(*) FILTER (WHERE needs_verification = true OR status = 'Missing')
            INTO failed_count, unverified_count
            FROM public.subject_grades 
            WHERE student_id = NEW.student_id;

            IF unverified_count > 0 OR failed_count > 0 THEN
                current_overall_status := 'Needs Verification';
            ELSIF EXISTS (SELECT 1 FROM public.subject_grades WHERE student_id = NEW.student_id) THEN
                current_overall_status := 'Passed';
            ELSE
                current_overall_status := 'Needs Verification';
            END IF;

            IF is_archived_doc THEN
                INSERT INTO public.academic_standing_history (
                    student_id, document_id, school_year, grade_level, curriculum,
                    source_form_version, grading_policy_version, general_average_printed,
                    previous_status, new_status, decision_source, confirmation_notes
                ) VALUES (
                    NEW.student_id, NEW.id, doc_school_year, doc_grade_level, doc_curriculum_id,
                    doc_source_form_version, doc_grading_policy_version, doc_gen_ave_printed,
                    old_overall_status, current_overall_status, 'automated_trigger',
                    'Archived document processed for school year ' || COALESCE(doc_school_year, 'UNKNOWN') || '; preserved current student status (' || COALESCE(old_overall_status, 'Needs Verification') || ') without overwriting.'
                );
            ELSE
                UPDATE public.students
                SET overall_status = current_overall_status,
                    updated_at = now()
                WHERE id = NEW.student_id;

                INSERT INTO public.academic_standing_history (
                    student_id, document_id, school_year, grade_level, curriculum,
                    source_form_version, grading_policy_version, general_average_printed,
                    previous_status, new_status, decision_source, confirmation_notes
                ) VALUES (
                    NEW.student_id, NEW.id, doc_school_year, doc_grade_level, doc_curriculum_id,
                    doc_source_form_version, doc_grading_policy_version, doc_gen_ave_printed,
                    old_overall_status, current_overall_status, 'automated_trigger',
                    CASE
                        WHEN failed_count > 0 THEN 'Contains ' || failed_count || ' failing subject(s); held at Needs Verification pending official DepEd remedial/retention review.'
                        WHEN unverified_count > 0 THEN 'Contains incomplete or unverified marks; held at Needs Verification.'
                        ELSE 'All extracted subject marks meet passing threshold.'
                    END
                );
            END IF;
        END IF;

    -- ==========================================================================
    -- CASE B: Document reverted, rejected, or deleted from an approved state
    -- Archiving (status = 'archived') and row deletion preserve verified grades.
    -- Rejection of a correcting document safely reverts active grades to prior
    -- approved document with audit history logging.
    -- ==========================================================================
    ELSIF (TG_OP = 'UPDATE' AND LOWER(NEW.status) IN ('rejected', 'needs_review', 'unapproved') AND LOWER(OLD.status) = 'approved')
       OR (TG_OP = 'DELETE' AND LOWER(OLD.status) = 'approved') THEN

        IF TG_OP = 'UPDATE' AND LOWER(NEW.status) IN ('rejected', 'needs_review', 'unapproved') THEN
            FOR existing_grade IN
                SELECT * FROM public.subject_grades WHERE document_id = target_doc_id
            LOOP
                prior_doc_grade := NULL;
                prior_doc_id := NULL;

                -- Search remaining approved documents for prior verified grades for this subject
                FOR prior_approved_doc IN
                    SELECT d.id, d.extracted_fields
                    FROM public.documents d
                    WHERE d.student_id = target_student_id
                      AND LOWER(d.status) = 'approved'
                      AND d.id != target_doc_id
                    ORDER BY d.updated_at DESC, d.created_at DESC
                LOOP
                    grades_array := CASE
                        WHEN prior_approved_doc.extracted_fields IS NOT NULL AND jsonb_typeof(prior_approved_doc.extracted_fields->'grades') = 'array' THEN prior_approved_doc.extracted_fields->'grades'
                        WHEN prior_approved_doc.extracted_fields IS NOT NULL AND jsonb_typeof(prior_approved_doc.extracted_fields->'subjects') = 'array' THEN prior_approved_doc.extracted_fields->'subjects'
                        ELSE NULL
                    END;

                    IF grades_array IS NOT NULL THEN
                        FOR grade_record IN SELECT * FROM jsonb_array_elements(grades_array)
                        LOOP
                            IF TRIM(COALESCE(grade_record->>'subject', grade_record->>'subject_name')) = existing_grade.subject THEN
                                prior_doc_grade := grade_record;
                                prior_doc_id := prior_approved_doc.id;
                                EXIT;
                            END IF;
                        END LOOP;
                    END IF;
                    IF prior_doc_grade IS NOT NULL THEN EXIT; END IF;
                END LOOP;

                IF prior_doc_grade IS NOT NULL THEN
                    clean_q1 := CASE WHEN (prior_doc_grade->>'q1') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (prior_doc_grade->>'q1')::numeric ELSE NULL END;
                    clean_q2 := CASE WHEN (prior_doc_grade->>'q2') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (prior_doc_grade->>'q2')::numeric ELSE NULL END;
                    clean_q3 := CASE WHEN (prior_doc_grade->>'q3') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (prior_doc_grade->>'q3')::numeric ELSE NULL END;
                    clean_q4 := CASE WHEN (prior_doc_grade->>'q4') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (prior_doc_grade->>'q4')::numeric ELSE NULL END;
                    clean_final := CASE
                        WHEN (prior_doc_grade->>'final') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (prior_doc_grade->>'final')::numeric
                        WHEN (prior_doc_grade->>'final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (prior_doc_grade->>'final_grade')::numeric
                        ELSE NULL
                    END;

                    IF clean_final IS NULL THEN
                        IF clean_q1 IS NOT NULL AND clean_q2 IS NOT NULL THEN
                            clean_final := ROUND((clean_q1 + clean_q2) / 2.0);
                        ELSIF clean_q3 IS NOT NULL AND clean_q4 IS NOT NULL THEN
                            clean_final := ROUND((clean_q3 + clean_q4) / 2.0);
                        END IF;
                    END IF;

                    IF clean_q1 IS NOT NULL AND clean_q1 IS DISTINCT FROM existing_grade.q1 THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, target_student_id, prior_doc_id, existing_grade.school_year, existing_grade.semester, existing_grade.grade_level,
                            existing_grade.subject, 'q1', existing_grade.q1, clean_q1, 'Document review unapproved: reverted to prior approved document grades', auth.uid()
                        );
                    END IF;

                    IF clean_q2 IS NOT NULL AND clean_q2 IS DISTINCT FROM existing_grade.q2 THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, target_student_id, prior_doc_id, existing_grade.school_year, existing_grade.semester, existing_grade.grade_level,
                            existing_grade.subject, 'q2', existing_grade.q2, clean_q2, 'Document review unapproved: reverted to prior approved document grades', auth.uid()
                        );
                    END IF;

                    IF clean_q3 IS NOT NULL AND clean_q3 IS DISTINCT FROM existing_grade.q3 THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, target_student_id, prior_doc_id, existing_grade.school_year, existing_grade.semester, existing_grade.grade_level,
                            existing_grade.subject, 'q3', existing_grade.q3, clean_q3, 'Document review unapproved: reverted to prior approved document grades', auth.uid()
                        );
                    END IF;

                    IF clean_q4 IS NOT NULL AND clean_q4 IS DISTINCT FROM existing_grade.q4 THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, target_student_id, prior_doc_id, existing_grade.school_year, existing_grade.semester, existing_grade.grade_level,
                            existing_grade.subject, 'q4', existing_grade.q4, clean_q4, 'Document review unapproved: reverted to prior approved document grades', auth.uid()
                        );
                    END IF;

                    IF clean_final IS NOT NULL AND clean_final IS DISTINCT FROM existing_grade.final_grade THEN
                        INSERT INTO public.grade_change_history (
                            subject_grade_id, student_id, document_id, school_year, semester, grade_level,
                            subject, quarter, previous_value, new_value, reason, changed_by
                        ) VALUES (
                            existing_grade.id, target_student_id, prior_doc_id, existing_grade.school_year, existing_grade.semester, existing_grade.grade_level,
                            existing_grade.subject, 'final_grade', existing_grade.final_grade, clean_final, 'Document review unapproved: reverted to prior approved document grades', auth.uid()
                        );
                    END IF;

                    UPDATE public.subject_grades
                    SET document_id = prior_doc_id,
                        q1 = clean_q1,
                        q2 = clean_q2,
                        q3 = clean_q3,
                        q4 = clean_q4,
                        final_grade = clean_final,
                        status = CASE
                            WHEN clean_final IS NOT NULL AND clean_final >= 75 THEN 'Passed'
                            WHEN clean_final IS NOT NULL AND clean_final < 75 THEN 'Failed'
                            ELSE existing_grade.status
                        END,
                        updated_at = now()
                    WHERE id = existing_grade.id;
                ELSE
                    DELETE FROM public.subject_grades WHERE id = existing_grade.id;
                END IF;
            END LOOP;
        END IF;

        SELECT overall_status INTO old_overall_status FROM public.students WHERE id = target_student_id;

        latest_approved_doc_id := NULL;
        existing_sy_start := NULL;

        WITH remaining_docs AS (
            SELECT
                d.id,
                d.updated_at,
                d.created_at,
                CASE
                    WHEN sy.m IS NOT NULL AND (sy.m[2])::integer = (sy.m[1])::integer + 1
                    THEN (sy.m[1])::integer
                    ELSE NULL
                END AS sy_start,
                CASE
                    WHEN sem.norm IN ('1st semester', 'first semester', 'sem: first', 'semester 1', 'sem 1', '1st sem', 'first sem', 'first', '1st',
                                      '2nd semester', 'second semester', 'sem: second', 'semester 2', 'sem 2', '2nd sem', 'second sem', 'second', '2nd')
                    THEN 'semester'
                    WHEN sem.norm IN ('term 1', '1st term', 'first term', 'term: 1', 'unang termino', 'term 1 (unang termino)',
                                      'term 2', '2nd term', 'second term', 'term: 2', 'ikalawang termino', 'term 2 (ikalawang termino)',
                                      'term 3', '3rd term', 'third term', 'term: 3', 'ikatlong termino', 'term 3 (ikatlong termino)')
                    THEN 'three_term'
                    WHEN sem.norm IN ('summary', 'summary of final grades', 'full year', 'annual')
                    THEN 'summary'
                    ELSE NULL
                END AS period_family,
                CASE
                    WHEN sem.norm IN ('1st semester', 'first semester', 'sem: first', 'semester 1', 'sem 1', '1st sem', 'first sem', 'first', '1st') THEN 1
                    WHEN sem.norm IN ('2nd semester', 'second semester', 'sem: second', 'semester 2', 'sem 2', '2nd sem', 'second sem', 'second', '2nd') THEN 2
                    WHEN sem.norm IN ('term 1', '1st term', 'first term', 'term: 1', 'unang termino', 'term 1 (unang termino)') THEN 1
                    WHEN sem.norm IN ('term 2', '2nd term', 'second term', 'term: 2', 'ikalawang termino', 'term 2 (ikalawang termino)') THEN 2
                    WHEN sem.norm IN ('term 3', '3rd term', 'third term', 'term: 3', 'ikatlong termino', 'term 3 (ikatlong termino)') THEN 3
                    WHEN sem.norm IN ('summary', 'summary of final grades', 'full year', 'annual') THEN 1
                    ELSE NULL
                END AS period_order
            FROM public.documents d
            CROSS JOIN LATERAL (
                SELECT regexp_match(
                    COALESCE(NULLIF(TRIM(d.school_year), ''), NULLIF(TRIM(d.extracted_fields->>'school_year'), '')),
                    '^(?:[Ss]\.?[Yy]\.?\s*)?(20[0-9]{2})\s*[-–/]\s*(20[0-9]{2})$'
                ) AS m
            ) sy
            CROSS JOIN LATERAL (
                SELECT LOWER(REGEXP_REPLACE(
                    COALESCE(
                        NULLIF(TRIM(d.semester), ''),
                        NULLIF(TRIM(d.extracted_fields->>'semester'), ''),
                        NULLIF(TRIM(d.extracted_fields->>'term'), ''),
                        ''
                    ),
                    '\s+', ' ', 'g'
                )) AS norm
            ) sem
            WHERE d.student_id = target_student_id
              AND LOWER(d.status) = 'approved'
              AND d.id != target_doc_id
        )
        SELECT a.id, a.sy_start
        INTO latest_approved_doc_id, existing_sy_start
        FROM remaining_docs a
        WHERE NOT EXISTS (
            SELECT 1
            FROM remaining_docs b
            WHERE b.id != a.id
              AND b.sy_start IS NOT NULL
              AND (
                  a.sy_start IS NULL
                  OR a.sy_start < b.sy_start
                  OR (
                      a.sy_start = b.sy_start
                      AND (
                          (
                              a.period_family IN ('semester', 'three_term')
                              AND b.period_family = a.period_family
                              AND a.period_order < b.period_order
                          )
                          OR (
                              b.period_family = 'summary'
                              AND a.period_family IN ('semester', 'three_term')
                          )
                      )
                  )
              )
        )
        ORDER BY a.sy_start DESC NULLS LAST, a.updated_at DESC, a.created_at DESC, a.id DESC
        LIMIT 1;

        principal_confirmed_status := NULL;
        hist_sy_start := NULL;
        SELECT
            h.new_status,
            CASE
                WHEN sy.m IS NOT NULL AND (sy.m[2])::integer = (sy.m[1])::integer + 1
                THEN (sy.m[1])::integer
                ELSE NULL
            END
        INTO principal_confirmed_status, hist_sy_start
        FROM public.academic_standing_history h
        CROSS JOIN LATERAL (
            SELECT regexp_match(
                NULLIF(TRIM(h.school_year), ''),
                '^(?:[Ss]\.?[Yy]\.?\s*)?(20[0-9]{2})\s*[-–/]\s*(20[0-9]{2})$'
            ) AS m
        ) sy
        WHERE h.student_id = target_student_id
          AND h.decision_source IN ('school_head_review', 'registrar_manual')
        ORDER BY
            CASE
                WHEN sy.m IS NOT NULL AND (sy.m[2])::integer = (sy.m[1])::integer + 1
                THEN (sy.m[1])::integer
                ELSE NULL
            END DESC NULLS LAST,
            h.created_at DESC,
            h.id DESC
        LIMIT 1;

        IF principal_confirmed_status IS NOT NULL
           AND (hist_sy_start IS NULL OR existing_sy_start IS NULL OR hist_sy_start >= existing_sy_start) THEN
            current_overall_status := principal_confirmed_status;
        ELSIF latest_approved_doc_id IS NOT NULL THEN
            SELECT
                COUNT(*) FILTER (WHERE status = 'Failed'),
                COUNT(*) FILTER (WHERE needs_verification = true OR status = 'Missing')
            INTO failed_count, unverified_count
            FROM public.subject_grades
            WHERE document_id = latest_approved_doc_id;

            IF unverified_count > 0 OR failed_count > 0 THEN
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

        INSERT INTO public.academic_standing_history (
            student_id,
            document_id,
            previous_status,
            new_status,
            decision_source,
            confirmation_notes
        ) VALUES (
            target_student_id,
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE target_doc_id END,
            old_overall_status,
            current_overall_status,
            'automated_trigger',
            CASE
                WHEN principal_confirmed_status IS NOT NULL
                     AND (hist_sy_start IS NULL OR existing_sy_start IS NULL OR hist_sy_start >= existing_sy_start)
                THEN 'Document reverted or un-approved; preserved confirmed student standing (' || current_overall_status || ') without automated overwrite.'
                ELSE 'Document reverted or un-approved; recalculated student standing based on remaining records.'
            END
        );

    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.process_approved_document() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_approved_document() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. Authoritative Document Approval Trigger
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_process_approved_document ON public.documents;
DROP TRIGGER IF EXISTS trg_process_approved_document ON public.documents;
CREATE TRIGGER trg_process_approved_document
    AFTER UPDATE OR DELETE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.process_approved_document();

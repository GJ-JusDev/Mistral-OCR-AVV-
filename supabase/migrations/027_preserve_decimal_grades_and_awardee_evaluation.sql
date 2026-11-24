-- ==============================================================================
-- MIGRATION 027: PRESERVE DECIMAL GRADES IN DATABASE FOR AWARDEE EVALUATION
-- ==============================================================================
-- PROPOSED MIGRATION (AWAITING ADMINISTRATOR APPROVAL — DO NOT RUN WITHOUT APPROVAL)
--
-- Compliance References:
-- - DepEd Order No. 36, s. 2016: Policy Guidelines on Awards and Recognition for K to 12
-- - DepEd Memorandum No. 030, s. 2021: Non-hierarchical, alphabetical awardee presentation
-- - DepEd Order No. 015, s. 2026: Revised Guidelines on Assessment and Awards (Provisional)
--
-- Purpose & Guarantees:
-- 1. Dual Grade Representations:
--    - PRECISE COMPUTED GRADE: Stored in database with decimal precision (NUMERIC).
--    - DISPLAYED GRADE: Whole number rounded grade (.50+ up, <.50 down) for regular SF9 cards.
-- 2. Precision Preservation in Trigger:
--    - Modifies public.process_approved_document() trigger to replace premature ROUND()
--      with exact decimal computation (q1 + q2) / 2.0.
-- 3. Strict Safety & Zero Regression:
--    - Preserves 100% of audit logging to public.grade_change_history.
--    - Preserves 100% of history tracking to public.academic_standing_history.
--    - Preserves 100% of document unapproval, rejection, and deletion rollback (CASE B).
--    - Preserves PostgreSQL search_path security configuration (SET search_path = public).
-- 4. DepEd Award Policy Support:
--    - Tables and constraints support DO 36, s. 2016 and DO 015, s. 2026 without hardcoded ranking.
--    - Enforces alphabetical presentation; removes numerical rank columns.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ADD DISTINCT GRADE REPRESENTATION COLUMNS TO subject_grades
-- ------------------------------------------------------------------------------
ALTER TABLE public.subject_grades
    ADD COLUMN IF NOT EXISTS printed_final_grade NUMERIC,
    ADD COLUMN IF NOT EXISTS ocr_final_grade NUMERIC,
    ADD COLUMN IF NOT EXISTS precise_computed_grade NUMERIC,
    ADD COLUMN IF NOT EXISTS displayed_final_grade NUMERIC,
    ADD COLUMN IF NOT EXISTS computation_formula TEXT DEFAULT 'arithmetic_quarter_mean: (qA + qB) / 2';

COMMENT ON COLUMN public.subject_grades.printed_final_grade IS 'Original final grade printed/written on physical SF9 document.';
COMMENT ON COLUMN public.subject_grades.ocr_final_grade IS 'Raw OCR extraction recognition output before edits or calculations.';
COMMENT ON COLUMN public.subject_grades.precise_computed_grade IS 'Exact unrounded computed grade preserving full decimal precision.';
COMMENT ON COLUMN public.subject_grades.displayed_final_grade IS 'DepEd whole-number rounded grade for regular SF9 student report output.';
COMMENT ON COLUMN public.subject_grades.computation_formula IS 'Grading policy reference and computation formula.';

-- ------------------------------------------------------------------------------
-- 2. ADD PRECISE & DISPLAYED GENERAL AVERAGE COLUMNS TO documents
-- ------------------------------------------------------------------------------
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS precise_general_average NUMERIC,
    ADD COLUMN IF NOT EXISTS displayed_general_average NUMERIC;

COMMENT ON COLUMN public.documents.precise_general_average IS 'Precise unrounded academic general average preserving decimal precision for award evaluation and transcripts.';
COMMENT ON COLUMN public.documents.displayed_general_average IS 'Whole-number general average for regular student-facing SF9 display.';

-- ------------------------------------------------------------------------------
-- 3. CREATE academic_award_evaluations TABLE FOR OFFICIAL DEPED AWARDEE PRESENTATION
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.academic_award_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    school_year TEXT NOT NULL,
    grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    semester TEXT CHECK (semester IN ('1st Semester', '2nd Semester', 'Full Year') OR semester IS NULL),
    precise_general_average NUMERIC NOT NULL,
    displayed_general_average NUMERIC NOT NULL,
    award_category TEXT NOT NULL CHECK (award_category IN (
        'With Highest Honors',
        'With High Honors',
        'With Honors',
        'Academic Excellence Award',
        'None'
    )),
    presentation_order TEXT NOT NULL DEFAULT 'alphabetical',
    is_eligible BOOLEAN NOT NULL DEFAULT true,
    disqualification_reasons JSONB DEFAULT '[]'::jsonb,
    evaluation_reference TEXT NOT NULL DEFAULT 'DepEd Order No. 36, s. 2016 / DM 030, s. 2021',
    policy_version TEXT NOT NULL DEFAULT 'DO_36_S_2016',
    is_provisional BOOLEAN NOT NULL DEFAULT false,
    evaluated_by UUID REFERENCES auth.users(id),
    verified_by UUID REFERENCES auth.users(id),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Performance and lookup indexes
CREATE INDEX IF NOT EXISTS idx_award_eval_school_year_grade ON public.academic_award_evaluations(school_year, grade_level);
CREATE INDEX IF NOT EXISTS idx_award_eval_student_id ON public.academic_award_evaluations(student_id);
CREATE INDEX IF NOT EXISTS idx_award_eval_award_category ON public.academic_award_evaluations(award_category);

-- Enable RLS
ALTER TABLE public.academic_award_evaluations ENABLE ROW LEVEL SECURITY;

-- Security Policies: School Staff and Principal read access; Admin/Principal write access
DROP POLICY IF EXISTS "Authorized read academic_award_evaluations" ON public.academic_award_evaluations;
CREATE POLICY "Authorized read academic_award_evaluations" ON public.academic_award_evaluations
    FOR SELECT TO authenticated
    USING (
        public.is_admin()
        OR public.is_principal()
        OR public.is_approved_teacher()
    );

DROP POLICY IF EXISTS "Authorized write academic_award_evaluations" ON public.academic_award_evaluations;
CREATE POLICY "Authorized write academic_award_evaluations" ON public.academic_award_evaluations
    FOR ALL TO authenticated
    USING (public.is_admin() OR public.is_principal())
    WITH CHECK (public.is_admin() OR public.is_principal());

-- ------------------------------------------------------------------------------
-- 4. SURGICALLY UPDATE process_approved_document() TRIGGER TO PREVENT PREMATURE ROUNDING
-- ------------------------------------------------------------------------------
-- Preserves 100% of audit logging (grade_change_history), academic_standing_history,
-- document unapproval rollback (CASE B), and search_path = public from Migration 021a.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_approved_document()
RETURNS trigger AS $$
DECLARE
    grades_array jsonb;
    grade_record jsonb;
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
    clean_precise_computed numeric;
    clean_displayed numeric;
    clean_printed numeric;
    clean_ocr numeric;
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
    is_incremental_requeue boolean := false;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_doc_id := OLD.id;
        target_student_id := OLD.student_id;
    ELSE
        target_doc_id := NEW.id;
        target_student_id := COALESCE(NEW.student_id, OLD.student_id);
        IF NEW.extracted_fields IS NOT NULL THEN
            is_incremental_requeue := COALESCE(NEW.extracted_fields ? 'incremental_update_summary', false)
                                   OR COALESCE(NEW.extracted_fields ? 'previous_approval', false);
        END IF;
    END IF;

    IF target_student_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- ==========================================================================
    -- CASE A: Document transitions to approved OR its grades are updated while approved
    -- ==========================================================================
    IF TG_OP = 'UPDATE' AND LOWER(NEW.status) = 'approved' AND (
        LOWER(OLD.status) != 'approved'
        OR (NEW.extracted_fields->'grades') IS DISTINCT FROM (OLD.extracted_fields->'grades')
        OR (NEW.extracted_fields->'subjects') IS DISTINCT FROM (OLD.extracted_fields->'subjects')
    ) THEN

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

        SELECT overall_status INTO old_overall_status FROM public.students WHERE id = NEW.student_id;

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

                clean_printed := CASE WHEN (grade_record->>'printed_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'printed_final_grade')::numeric ELSE NULL END;
                clean_ocr := CASE WHEN (grade_record->>'ocr_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'ocr_final_grade')::numeric ELSE NULL END;
                clean_precise_computed := CASE WHEN (grade_record->>'precise_computed_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'precise_computed_grade')::numeric ELSE NULL END;
                clean_displayed := CASE WHEN (grade_record->>'displayed_grade') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (grade_record->>'displayed_grade')::numeric ELSE NULL END;

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

                SELECT * INTO existing_grade
                FROM public.subject_grades
                WHERE student_id = NEW.student_id
                  AND school_year = clean_sy
                  AND semester = clean_sem
                  AND subject = clean_subj
                LIMIT 1;

                IF existing_grade.id IS NOT NULL THEN
                    quarters_changed := (clean_q1 IS NOT NULL AND clean_q1 IS DISTINCT FROM existing_grade.q1)
                                     OR (clean_q2 IS NOT NULL AND clean_q2 IS DISTINCT FROM existing_grade.q2)
                                     OR (clean_q3 IS NOT NULL AND clean_q3 IS DISTINCT FROM existing_grade.q3)
                                     OR (clean_q4 IS NOT NULL AND clean_q4 IS DISTINCT FROM existing_grade.q4);

                    computed_final := NULL;
                    -- PRESERVE DECIMAL PRECISION: Do NOT execute ROUND() to an integer!
                    IF clean_sem IN ('1st', '1st Semester', 'First Semester', 'sem 1', 'semester 1') THEN
                        IF COALESCE(clean_q1, existing_grade.q1) IS NOT NULL AND COALESCE(clean_q2, existing_grade.q2) IS NOT NULL THEN
                            computed_final := (COALESCE(clean_q1, existing_grade.q1) + COALESCE(clean_q2, existing_grade.q2)) / 2.0;
                        END IF;
                    ELSIF clean_sem IN ('2nd', '2nd Semester', 'Second Semester', 'sem 2', 'semester 2') THEN
                        IF COALESCE(clean_q3, existing_grade.q3) IS NOT NULL AND COALESCE(clean_q4, existing_grade.q4) IS NOT NULL THEN
                            computed_final := (COALESCE(clean_q3, existing_grade.q3) + COALESCE(clean_q4, existing_grade.q4)) / 2.0;
                        END IF;
                    END IF;

                    IF quarters_changed THEN
                        clean_final := COALESCE(computed_final, clean_final, existing_grade.final_grade);
                        clean_precise_computed := COALESCE(computed_final, clean_precise_computed);
                        clean_displayed := CASE WHEN clean_final IS NOT NULL THEN ROUND(clean_final) ELSE NULL END;
                    ELSE
                        clean_final := COALESCE(clean_final, existing_grade.final_grade);
                        clean_precise_computed := COALESCE(clean_precise_computed, existing_grade.precise_computed_grade, clean_final);
                        clean_displayed := COALESCE(clean_displayed, existing_grade.displayed_final_grade, CASE WHEN clean_final IS NOT NULL THEN ROUND(clean_final) ELSE NULL END);
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

                    -- AUDIT LOGGING: Preserve 100% of grade_change_history audit tracking
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
                        precise_computed_grade = clean_precise_computed,
                        displayed_final_grade = clean_displayed,
                        printed_final_grade = COALESCE(clean_printed, existing_grade.printed_final_grade),
                        ocr_final_grade = COALESCE(clean_ocr, existing_grade.ocr_final_grade),
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
                    -- PRESERVE DECIMAL PRECISION: Do NOT execute ROUND() to an integer!
                    IF clean_final IS NULL THEN
                        IF clean_q1 IS NOT NULL AND clean_q2 IS NOT NULL AND (clean_sem IN ('1st', '1st Semester', 'First Semester', 'sem 1', 'semester 1') OR clean_sem IS NULL) THEN
                            clean_final := (clean_q1 + clean_q2) / 2.0;
                        ELSIF clean_q3 IS NOT NULL AND clean_q4 IS NOT NULL AND (clean_sem IN ('2nd', '2nd Semester', 'Second Semester', 'sem 2', 'semester 2')) THEN
                            clean_final := (clean_q3 + clean_q4) / 2.0;
                        ELSIF clean_q1 IS NOT NULL AND clean_q2 IS NOT NULL AND clean_q3 IS NOT NULL AND clean_q4 IS NOT NULL THEN
                            clean_final := (clean_q1 + clean_q2 + clean_q3 + clean_q4) / 4.0;
                        END IF;
                    END IF;

                    clean_precise_computed := COALESCE(clean_precise_computed, clean_final);
                    clean_displayed := CASE WHEN clean_final IS NOT NULL THEN ROUND(clean_final) ELSE NULL END;

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
                        final_grade, precise_computed_grade, displayed_final_grade, printed_final_grade, ocr_final_grade,
                        action_taken, remark, status, needs_verification,
                        curriculum_id, source_form_version, grading_policy_version
                    ) VALUES (
                        NEW.student_id, NEW.id, clean_sy, clean_gl, clean_sem,
                        clean_source_section, clean_subject_track, clean_subject_category, clean_subject_code, clean_scheme,
                        clean_subj, clean_q1, clean_q2, clean_q3, clean_q4, clean_t1, clean_t2, clean_t3,
                        clean_sem1_final, clean_sem2_final, clean_units, clean_failed_final,
                        clean_remedial_mark, clean_recomputed_final, clean_rem_sem1, clean_rem_sem2,
                        clean_final, clean_precise_computed, clean_displayed, clean_printed, clean_ocr,
                        clean_action_taken, clean_remark, clean_status, clean_needs_verif,
                        clean_curriculum_id, clean_source_form_version, clean_grading_policy_version
                    );
                END IF;
            END LOOP;

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

            -- ACADEMIC STANDING HISTORY: Preserve 100% of historical tracking
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
    -- CASE B: Document explicitly rejected, unapproved, or deleted from approved
    -- NOTE: Preserves 100% of rollback handling from Migration 021a!
    -- ==========================================================================
    ELSIF (
        TG_OP = 'UPDATE'
        AND LOWER(OLD.status) = 'approved'
        AND (
            LOWER(NEW.status) IN ('rejected', 'unapproved')
            OR (LOWER(NEW.status) = 'needs_review' AND NOT is_incremental_requeue)
        )
    )
    OR (TG_OP = 'DELETE' AND LOWER(OLD.status) = 'approved') THEN

        IF TG_OP = 'UPDATE' THEN
            FOR existing_grade IN
                SELECT * FROM public.subject_grades WHERE document_id = target_doc_id
            LOOP
                prior_doc_grade := NULL;
                prior_doc_id := NULL;

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

                    -- PRESERVE DECIMAL PRECISION in Prior Doc Rollback
                    IF clean_final IS NULL THEN
                        IF clean_q1 IS NOT NULL AND clean_q2 IS NOT NULL THEN
                            clean_final := (clean_q1 + clean_q2) / 2.0;
                        ELSIF clean_q3 IS NOT NULL AND clean_q4 IS NOT NULL THEN
                            clean_final := (clean_q3 + clean_q4) / 2.0;
                        END IF;
                    END IF;

                    UPDATE public.subject_grades
                    SET document_id = prior_doc_id,
                        q1 = clean_q1,
                        q2 = clean_q2,
                        q3 = clean_q3,
                        q4 = clean_q4,
                        final_grade = clean_final,
                        precise_computed_grade = COALESCE(clean_final, existing_grade.precise_computed_grade),
                        displayed_final_grade = CASE WHEN clean_final IS NOT NULL THEN ROUND(clean_final) ELSE existing_grade.displayed_final_grade END,
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

        SELECT d.id INTO latest_approved_doc_id
        FROM public.documents d
        WHERE d.student_id = target_student_id
          AND LOWER(d.status) = 'approved'
          AND d.id != target_doc_id
        ORDER BY d.updated_at DESC, d.created_at DESC
        LIMIT 1;

        IF latest_approved_doc_id IS NOT NULL THEN
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
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------------------------
-- 5. SAFE IDEMPOTENT BACKFILL STRATEGY FOR EXISTING RECORDS
-- ------------------------------------------------------------------------------
-- Backfills displayed_final_grade and precise_computed_grade for existing
-- verified rows without modifying official printed grades or altering final_grade.
-- ------------------------------------------------------------------------------
UPDATE public.subject_grades
SET displayed_final_grade = ROUND(final_grade),
    precise_computed_grade = final_grade
WHERE displayed_final_grade IS NULL
  AND final_grade IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 6. SAFE ROLLBACK STRATEGY (DOCUMENTED DOWN-MIGRATION)
-- ------------------------------------------------------------------------------
-- If rollback is required:
-- 1. DROP TABLE IF EXISTS public.academic_award_evaluations;
-- 2. ALTER TABLE public.documents DROP COLUMN IF EXISTS precise_general_average, DROP COLUMN IF EXISTS displayed_general_average;
-- 3. ALTER TABLE public.subject_grades
--      DROP COLUMN IF EXISTS printed_final_grade,
--      DROP COLUMN IF EXISTS ocr_final_grade,
--      DROP COLUMN IF EXISTS precise_computed_grade,
--      DROP COLUMN IF EXISTS displayed_final_grade,
--      DROP COLUMN IF EXISTS computation_formula;
-- 4. Re-execute the original process_approved_document() trigger definition from Migration 021a.
-- ==============================================================================

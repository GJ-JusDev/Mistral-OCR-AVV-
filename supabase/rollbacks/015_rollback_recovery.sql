-- ==============================================================================
-- Migration 015 Rollback: Revert LRN Deduplication & Grade Update Changes
-- ==============================================================================
-- Purpose:
--   Safely reverts Migration 015 changes back to Migration 010/014 state without
--   data corruption or dropping pre-existing core tables.
-- ==============================================================================

BEGIN;

-- 1. Drop duplicate students reporting view
DROP VIEW IF EXISTS public.v_duplicate_students_report;

-- 2. Drop lookup_student_by_lrn function
DROP FUNCTION IF EXISTS public.lookup_student_by_lrn(text, uuid);

-- 3. Drop grade_change_history table
DROP TABLE IF EXISTS public.grade_change_history CASCADE;

-- 4. Drop composite unique index on subject_grades
DROP INDEX IF EXISTS public.idx_subject_grades_composite_active;

-- 5. Drop normalized unique index on students
DROP INDEX IF EXISTS public.idx_students_normalized_lrn;

-- 6. Drop LRN check constraint on students
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS chk_students_lrn_format;

-- 7. Restore Migration 010 process_approved_document() trigger function

CREATE OR REPLACE FUNCTION public.process_approved_document()
RETURNS TRIGGER AS $$
DECLARE
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

        -- Extract document-level metadata without inventing defaults
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

        -- Validate school year strictly against AVV's supported DepEd pattern:
        -- Optional 'SY'/'S.Y.' prefix, 4-digit start year (2000-2099), separator (-, –, /),
        -- and consecutive 4-digit end year (end = start + 1).
        -- Null, blank, or malformed strings evaluate to NULL without throwing exceptions
        -- and are never silently treated as a valid year.
        doc_sy_match := regexp_match(
            doc_school_year,
            '^(?:[Ss]\.?[Yy]\.?\s*)?(20[0-9]{2})\s*[-–/]\s*(20[0-9]{2})$'
        );
        IF doc_sy_match IS NOT NULL AND (doc_sy_match[2])::integer = (doc_sy_match[1])::integer + 1 THEN
            doc_sy_start := (doc_sy_match[1])::integer;
        ELSE
            doc_sy_start := NULL;
        END IF;

        -- Parse explicit grading period family and ordinal from stored semester/term metadata.
        -- Do not assume a single calendar across schools: 'semester' and 'three_term' are kept
        -- in distinct families and only compared when both documents share a compatible family
        -- (or when an existing document is a full-year 'summary').
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

        -- Compare against all other approved documents for this student
        FOR existing_doc IN
            SELECT id, school_year, semester, extracted_fields
            FROM public.documents
            WHERE student_id = NEW.student_id
              AND status = 'approved'
              AND id != NEW.id
        LOOP
            existing_raw_sy := COALESCE(
                NULLIF(TRIM(existing_doc.school_year), ''),
                NULLIF(TRIM(existing_doc.extracted_fields->>'school_year'), '')
            );
            existing_sy_match := regexp_match(
                existing_raw_sy,
                '^(?:[Ss]\.?[Yy]\.?\s*)?(20[0-9]{2})\s*[-–/]\s*(20[0-9]{2})$'
            );
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
                    -- A document with missing/malformed school year must not overwrite an existing valid-year approved record
                    is_archived_doc := true;
                ELSIF doc_sy_start < existing_sy_start THEN
                    -- Strictly older school year
                    is_archived_doc := true;
                ELSIF doc_sy_start = existing_sy_start THEN
                    -- Same school year: check explicit period ordering only when both have compatible metadata
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

        -- Also check Principal / Registrar authoritative confirmations in academic_standing_history:
        -- 1. Valid DepEd school years sort ahead of missing/malformed school years (NULLS LAST)
        --    so malformed metadata is never inferred to be a newer school year.
        -- 2. Among valid school years, the latest school year (hist_sy_start DESC) wins;
        --    ties break by most recent confirmation (created_at DESC, id DESC).
        -- 3. Confirmed standing is preserved unless the newly approved document has a strictly
        --    newer validated school year (doc_sy_start > hist_sy_start).
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

        -- Insert normalized subject grades if grades array exists
        IF NEW.extracted_fields IS NOT NULL AND jsonb_typeof(NEW.extracted_fields->'grades') = 'array' THEN
            FOR grade_record IN SELECT * FROM jsonb_array_elements(NEW.extracted_fields->'grades')
            LOOP
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

                clean_t1 := CASE
                    WHEN (grade_record->>'t1') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'t1')::numeric
                    ELSE NULL
                END;

                clean_t2 := CASE
                    WHEN (grade_record->>'t2') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'t2')::numeric
                    ELSE NULL
                END;

                clean_t3 := CASE
                    WHEN (grade_record->>'t3') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'t3')::numeric
                    ELSE NULL
                END;

                clean_sem1_final := CASE
                    WHEN (grade_record->>'sem1_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'sem1_final_grade')::numeric
                    ELSE NULL
                END;

                clean_sem2_final := CASE
                    WHEN (grade_record->>'sem2_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'sem2_final_grade')::numeric
                    ELSE NULL
                END;

                clean_units := CASE
                    WHEN (grade_record->>'units') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'units')::numeric
                    ELSE NULL
                END;

                clean_failed_final := CASE
                    WHEN (grade_record->>'failed_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'failed_final_grade')::numeric
                    ELSE NULL
                END;

                clean_remedial_mark := CASE
                    WHEN (grade_record->>'remedial_class_mark') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'remedial_class_mark')::numeric
                    ELSE NULL
                END;

                clean_recomputed_final := CASE
                    WHEN (grade_record->>'recomputed_final_grade') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'recomputed_final_grade')::numeric
                    ELSE NULL
                END;

                clean_rem_sem1 := CASE
                    WHEN (grade_record->>'remedial_sem1_recomputed') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'remedial_sem1_recomputed')::numeric
                    ELSE NULL
                END;

                clean_rem_sem2 := CASE
                    WHEN (grade_record->>'remedial_sem2_recomputed') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'remedial_sem2_recomputed')::numeric
                    ELSE NULL
                END;

                clean_final := CASE
                    WHEN (grade_record->>'final') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (grade_record->>'final')::numeric
                    ELSE NULL
                END;

                clean_action_taken := NULLIF(TRIM(grade_record->>'action_taken'), '');
                clean_remark := NULLIF(TRIM(grade_record->>'remark'), '');

                clean_status := CASE
                    WHEN LOWER(COALESCE(grade_record->>'status', '')) = 'passed' THEN 'Passed'
                    WHEN LOWER(COALESCE(grade_record->>'status', '')) = 'failed' THEN 'Failed'
                    ELSE 'Missing'
                END;

                clean_needs_verif := COALESCE((grade_record->>'needsVerification')::boolean, false);
                IF clean_final IS NULL OR clean_status = 'Missing' THEN
                    clean_needs_verif := true;
                END IF;

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
                clean_subject_code := COALESCE(
                    NULLIF(TRIM(grade_record->>'subject_code'), ''),
                    NULLIF(TRIM(grade_record->>'row_code'), '')
                );
                clean_scheme := COALESCE(
                    NULLIF(TRIM(grade_record->>'grading_period_scheme'), ''),
                    doc_grading_period_scheme
                );
                IF clean_scheme NOT IN ('quarterly_semestral', 'three_term', 'quarterly') THEN
                    clean_scheme := NULL;
                END IF;

                INSERT INTO public.subject_grades (
                    student_id,
                    document_id,
                    school_year,
                    grade_level,
                    semester,
                    source_section,
                    subject_track,
                    subject_category,
                    subject_code,
                    grading_period_scheme,
                    subject,
                    q1, q2, q3, q4,
                    t1, t2, t3,
                    sem1_final_grade,
                    sem2_final_grade,
                    units,
                    failed_final_grade,
                    remedial_class_mark,
                    recomputed_final_grade,
                    remedial_sem1_recomputed,
                    remedial_sem2_recomputed,
                    final_grade,
                    action_taken,
                    remark,
                    status,
                    needs_verification,
                    curriculum_id,
                    source_form_version,
                    grading_policy_version
                ) VALUES (
                    NEW.student_id,
                    NEW.id,
                    COALESCE(NULLIF(TRIM(grade_record->>'school_year'), ''), doc_school_year),
                    clean_grade_level,
                    clean_semester,
                    clean_source_section,
                    clean_subject_track,
                    clean_subject_category,
                    clean_subject_code,
                    clean_scheme,
                    COALESCE(NULLIF(TRIM(grade_record->>'subject'), ''), 'General Subject'),
                    clean_q1,
                    clean_q2,
                    clean_q3,
                    clean_q4,
                    clean_t1,
                    clean_t2,
                    clean_t3,
                    clean_sem1_final,
                    clean_sem2_final,
                    clean_units,
                    clean_failed_final,
                    clean_remedial_mark,
                    clean_recomputed_final,
                    clean_rem_sem1,
                    clean_rem_sem2,
                    clean_final,
                    clean_action_taken,
                    clean_remark,
                    clean_status,
                    clean_needs_verif,
                    COALESCE(NULLIF(TRIM(grade_record->>'curriculum_id'), ''), doc_curriculum_id),
                    COALESCE(NULLIF(TRIM(grade_record->>'source_form_version'), ''), doc_source_form_version),
                    COALESCE(NULLIF(TRIM(grade_record->>'grading_policy_version'), ''), doc_grading_policy_version)
                );
            END LOOP;

            -- Evaluate academic standing:
            -- SAFETY INVARIANT:
            -- 1. Automatic authoritative 'Failed' is REMOVED. In DepEd, failing grades require remedial
            --    instruction ("Certificate of Recomputed Final Grade") or subject repeating.
            -- 2. Any document with failing marks (failed_count > 0) or incomplete/unverified marks
            --    is held at 'Needs Verification' pending explicit school official / registrar decision.
            -- 3. Only documents with 100% clean passing marks across all evaluated learning areas
            --    qualify for automated tentative 'Passed' standing.
            SELECT
                COUNT(*) FILTER (WHERE status = 'Failed'),
                COUNT(*) FILTER (WHERE needs_verification = true OR status = 'Missing')
            INTO failed_count, unverified_count
            FROM public.subject_grades
            WHERE document_id = NEW.id;

            IF unverified_count > 0 OR failed_count > 0 THEN
                current_overall_status := 'Needs Verification';
            ELSIF EXISTS (SELECT 1 FROM public.subject_grades WHERE document_id = NEW.id) THEN
                current_overall_status := 'Passed';
            ELSE
                current_overall_status := 'Needs Verification';
            END IF;

            -- Prevent archived/older documents from silently overwriting student's current standing
            IF is_archived_doc THEN
                INSERT INTO public.academic_standing_history (
                    student_id,
                    document_id,
                    school_year,
                    grade_level,
                    curriculum,
                    source_form_version,
                    grading_policy_version,
                    general_average_printed,
                    previous_status,
                    new_status,
                    decision_source,
                    confirmation_notes
                ) VALUES (
                    NEW.student_id,
                    NEW.id,
                    doc_school_year,
                    doc_grade_level,
                    doc_curriculum_id,
                    doc_source_form_version,
                    doc_grading_policy_version,
                    doc_gen_ave_printed,
                    old_overall_status,
                    current_overall_status,
                    'automated_trigger',
                    'Archived document processed for school year ' || COALESCE(doc_school_year, 'UNKNOWN') || '; preserved current student status (' || COALESCE(old_overall_status, 'Needs Verification') || ') without overwriting.'
                );
            ELSE
                UPDATE public.students
                SET overall_status = current_overall_status,
                    updated_at = now()
                WHERE id = NEW.student_id;

                INSERT INTO public.academic_standing_history (
                    student_id,
                    document_id,
                    school_year,
                    grade_level,
                    curriculum,
                    source_form_version,
                    grading_policy_version,
                    general_average_printed,
                    previous_status,
                    new_status,
                    decision_source,
                    confirmation_notes
                ) VALUES (
                    NEW.student_id,
                    NEW.id,
                    doc_school_year,
                    doc_grade_level,
                    doc_curriculum_id,
                    doc_source_form_version,
                    doc_grading_policy_version,
                    doc_gen_ave_printed,
                    old_overall_status,
                    current_overall_status,
                    'automated_trigger',
                    CASE
                        WHEN failed_count > 0 THEN 'Contains ' || failed_count || ' failing subject(s); held at Needs Verification pending official DepEd remedial/retention review.'
                        WHEN unverified_count > 0 THEN 'Contains incomplete or unverified marks; held at Needs Verification.'
                        ELSE 'All extracted subject marks meet passing threshold.'
                    END
                );
            END IF;
        END IF;

    -- CASE B: Document reverted, rejected, or deleted from a previously approved state
    ELSIF (TG_OP = 'UPDATE' AND NEW.status != 'approved' AND OLD.status = 'approved')
       OR (TG_OP = 'DELETE' AND OLD.status = 'approved') THEN

        -- Delete persisted grades for this un-approved or deleted document
        DELETE FROM public.subject_grades WHERE document_id = target_doc_id;

        -- Capture previous overall status before recalculation
        SELECT overall_status INTO old_overall_status FROM public.students WHERE id = target_student_id;

        -- Recalculate student overall status based on most recent remaining approved document
        -- using the exact same dominance rules as CASE A:
        -- 1. Valid DepEd school years supersede older or missing/malformed school years.
        -- 2. Within the same valid school year, period ordinals are compared ONLY when
        --    both documents share the same calendar family ('semester' or 'three_term'),
        --    or when a full-year 'summary' record supersedes a 'semester' or 'three_term' record.
        -- 3. Documents from different calendar families ('semester' vs 'three_term') or
        --    legacy records without period metadata are never ordered by numeric period_order.
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
              AND d.status = 'approved'
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

        -- Resolve authoritative Principal / Registrar confirmation (if any):
        -- 1. Valid DepEd school years sort ahead of missing/malformed school years (NULLS LAST)
        --    so malformed metadata is never inferred to be a newer school year.
        -- 2. Confirmed standing is never silently replaced by an automated recalculation
        --    when un-approving or deleting a document, unless a remaining approved document
        --    has a strictly newer validated school year (existing_sy_start > hist_sy_start).
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

COMMIT;

-- AVV context scoping and race-safe persistence.
-- Apply only after reviewing existing duplicate validation records. The duplicate
-- preflight intentionally aborts rather than deleting or rewriting duplicate history.

BEGIN;

ALTER TABLE public.cross_document_validations
    ADD COLUMN IF NOT EXISTS section TEXT,
    ADD COLUMN IF NOT EXISTS persistence_key TEXT,
    ADD COLUMN IF NOT EXISTS source_signature TEXT;

-- Fill section only where enrollment history identifies exactly one section
-- for this learner and academic context. Ambiguous history remains untouched.
WITH unique_sections AS (
    SELECT
        student_id,
        school_id,
        school_year,
        grade_level,
        MIN(section) AS section
    FROM public.student_enrollments
    WHERE section IS NOT NULL AND BTRIM(section) <> ''
    GROUP BY student_id, school_id, school_year, grade_level
    HAVING COUNT(DISTINCT public.normalize_section_key(section)) = 1
)
UPDATE public.cross_document_validations AS validation
SET section = unique_sections.section
FROM unique_sections
WHERE validation.section IS NULL
  AND validation.student_id = unique_sections.student_id
  AND validation.school_id = unique_sections.school_id
  AND validation.school_year = unique_sections.school_year
  AND validation.grade_level = unique_sections.grade_level;

UPDATE public.cross_document_validations AS validation
SET source_signature = COALESCE(
    (
        SELECT string_agg(DISTINCT source.document_id, '|' ORDER BY source.document_id)
        FROM jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(validation.comparison_results) = 'array'
                    THEN validation.comparison_results
                ELSE '[]'::jsonb
            END
        ) AS matrix_item(value)
        CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(matrix_item.value->'sourceDocumentIds') = 'array'
                    THEN matrix_item.value->'sourceDocumentIds'
                ELSE '[]'::jsonb
            END
        ) AS source(document_id)
    ),
    NULLIF(
        CONCAT_WS(
            '|',
            NULLIF(validation.source_doc1_id::TEXT, ''),
            NULLIF(validation.source_doc2_id::TEXT, '')
        ),
        ''
    ),
    ''
)
WHERE validation.validation_type = 'CONSOLIDATED_SHS'
  AND validation.source_signature IS NULL
  AND validation.section IS NOT NULL;

UPDATE public.cross_document_validations
SET persistence_key = CASE
    WHEN validation_type = 'CONSOLIDATED_SHS'
        THEN 'CONSOLIDATED|' || COALESCE(source_signature, '')
    ELSE FORMAT(
        'PAIR|%s|%s|%s|%s',
        validation_type,
        COALESCE(semester, 'Full Year'),
        COALESCE(source_doc1_id::TEXT, ''),
        COALESCE(source_doc2_id::TEXT, '')
    )
END
WHERE persistence_key IS NULL
  AND section IS NOT NULL;

ALTER TABLE public.cross_document_validations
    ADD CONSTRAINT chk_cross_validation_key_requires_context
    CHECK (
        persistence_key IS NULL
        OR (
            section IS NOT NULL
            AND BTRIM(section) <> ''
            AND grade_level IS NOT NULL
        )
    ) NOT VALID;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.cross_document_validations
        WHERE persistence_key IS NOT NULL
        GROUP BY student_id, school_id, school_year, grade_level, section, persistence_key
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate scoped validation keys exist; review and resolve them before applying migration 031.';
    END IF;
END;
$$;

CREATE UNIQUE INDEX uq_cross_validation_context_key
    ON public.cross_document_validations (
        student_id,
        school_id,
        school_year,
        grade_level,
        section,
        persistence_key
    )
    WHERE persistence_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cross_validation_context_lookup
    ON public.cross_document_validations (
        student_id,
        school_id,
        school_year,
        grade_level,
        section,
        updated_at DESC,
        created_at DESC
    );

-- Remove only the permissive legacy teacher SELECT policies from migration 025.
-- The exact-context child-table policies from migration 026 remain in force.
DROP POLICY IF EXISTS "Teacher access on sf1_roster_entries"
    ON public.sf1_roster_entries;
DROP POLICY IF EXISTS "Teacher access on sf2_attendance_entries"
    ON public.sf2_attendance_entries;
DROP POLICY IF EXISTS "Teacher access on sf5_promotion_entries"
    ON public.sf5_promotion_entries;
DROP POLICY IF EXISTS "Teacher read on cross_document_validations"
    ON public.cross_document_validations;

-- Replace the 026 validation read policy so it also matches the validation
-- row's own academic context, not merely some active enrollment for the learner.
DROP POLICY IF EXISTS "Authorized read cross_document_validations"
    ON public.cross_document_validations;
CREATE POLICY "Authorized read cross_document_validations"
    ON public.cross_document_validations FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR (
            public.is_principal()
            AND school_id = public.get_auth_user_school_id()
        )
        OR (
            public.is_approved_teacher()
            AND public.can_teacher_access_section(
                school_id,
                school_year,
                grade_level,
                section
            )
            AND EXISTS (
                SELECT 1
                FROM public.student_enrollments AS enrollment
                WHERE enrollment.student_id = cross_document_validations.student_id
                  AND enrollment.school_id = cross_document_validations.school_id
                  AND REGEXP_REPLACE(BTRIM(enrollment.school_year), '\s+', '', 'g')
                      = REGEXP_REPLACE(BTRIM(cross_document_validations.school_year), '\s+', '', 'g')
                  AND public.normalize_shs_grade_level(enrollment.grade_level)
                      = public.normalize_shs_grade_level(cross_document_validations.grade_level)
                  AND public.normalize_section_key(enrollment.section)
                      = public.normalize_section_key(cross_document_validations.section)
                  AND enrollment.enrollment_status = 'active'
            )
        )
    );

CREATE OR REPLACE FUNCTION public.persist_cross_document_validation(p_validation JSONB)
RETURNS SETOF public.cross_document_validations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    validation_row public.cross_document_validations%ROWTYPE;
    expected_persistence_key TEXT;
BEGIN
    validation_row := jsonb_populate_record(
        NULL::public.cross_document_validations,
        p_validation
    );

    expected_persistence_key := CASE
        WHEN validation_row.validation_type = 'CONSOLIDATED_SHS'
            THEN 'CONSOLIDATED|' || COALESCE(validation_row.source_signature, '')
        ELSE FORMAT(
            'PAIR|%s|%s|%s|%s',
            validation_row.validation_type,
            COALESCE(validation_row.semester, 'Full Year'),
            COALESCE(validation_row.source_doc1_id::TEXT, ''),
            COALESCE(validation_row.source_doc2_id::TEXT, '')
        )
    END;

    IF validation_row.student_id IS NULL
       OR validation_row.school_id IS NULL
       OR validation_row.school_year IS NULL
       OR BTRIM(validation_row.school_year) = ''
       OR validation_row.grade_level IS NULL
       OR validation_row.grade_level NOT IN ('Grade 11', 'Grade 12')
       OR validation_row.section IS NULL
       OR BTRIM(validation_row.section) = ''
       OR validation_row.validation_type IS NULL
       OR validation_row.validation_type NOT IN (
           'PSA_SF1', 'SF1_SF2', 'SF1_SF5', 'SF1_SF9',
           'SF9_SF10', 'SF5_SF9', 'SF5_SF10', 'CONSOLIDATED_SHS'
       )
       OR (
           validation_row.semester IS NOT NULL
           AND validation_row.semester NOT IN ('1st Semester', '2nd Semester', 'Full Year')
       )
       OR validation_row.persistence_key IS NULL
       OR BTRIM(validation_row.persistence_key) = ''
       OR validation_row.persistence_key <> expected_persistence_key
       OR (
           validation_row.status IS NOT NULL
           AND validation_row.status NOT IN (
               'MATCH', 'MISMATCH', 'DISCREPANCIES_FOUND',
               'NEEDS_VERIFICATION', 'NOT_APPLICABLE', 'RESOLVED'
           )
       )
       OR (
           p_validation ? 'comparison_results'
           AND jsonb_typeof(p_validation->'comparison_results') NOT IN ('array', 'null')
       )
       OR (
           p_validation ? 'discrepancy_details'
           AND jsonb_typeof(p_validation->'discrepancy_details') NOT IN ('array', 'null')
       )
       OR NOT EXISTS (
           SELECT 1
           FROM public.students AS student
           WHERE student.id = validation_row.student_id
             AND student.school_id = validation_row.school_id
       ) THEN
        RAISE EXCEPTION 'A complete validation context and persistence key are required.'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.cross_document_validations (
        student_id,
        school_id,
        school_year,
        grade_level,
        section,
        semester,
        validation_type,
        source_doc1_id,
        source_doc2_id,
        source_signature,
        persistence_key,
        comparison_results,
        discrepancy_details,
        status,
        needs_human_review
    )
    VALUES (
        validation_row.student_id,
        validation_row.school_id,
        validation_row.school_year,
        validation_row.grade_level,
        validation_row.section,
        validation_row.semester,
        validation_row.validation_type,
        validation_row.source_doc1_id,
        validation_row.source_doc2_id,
        validation_row.source_signature,
        validation_row.persistence_key,
        COALESCE(validation_row.comparison_results, '[]'::jsonb),
        COALESCE(validation_row.discrepancy_details, '[]'::jsonb),
        COALESCE(validation_row.status, 'NEEDS_VERIFICATION'),
        COALESCE(validation_row.needs_human_review, false)
    )
    ON CONFLICT (
        student_id,
        school_id,
        school_year,
        grade_level,
        section,
        persistence_key
    )
    WHERE persistence_key IS NOT NULL
    DO UPDATE SET
        source_doc1_id = EXCLUDED.source_doc1_id,
        source_doc2_id = EXCLUDED.source_doc2_id,
        source_signature = EXCLUDED.source_signature,
        comparison_results = EXCLUDED.comparison_results,
        discrepancy_details = EXCLUDED.discrepancy_details,
        status = EXCLUDED.status,
        needs_human_review = EXCLUDED.needs_human_review,
        updated_at = NOW()
    WHERE public.cross_document_validations.status <> 'RESOLVED'
      AND public.cross_document_validations.resolved_by IS NULL
      AND public.cross_document_validations.resolved_at IS NULL
      AND public.cross_document_validations.resolution_notes IS NULL
    RETURNING * INTO validation_row;

    IF NOT FOUND THEN
        SELECT *
        INTO validation_row
        FROM public.cross_document_validations
        WHERE student_id = (p_validation->>'student_id')::UUID
          AND school_id = (p_validation->>'school_id')::UUID
          AND school_year = p_validation->>'school_year'
          AND grade_level = p_validation->>'grade_level'
          AND section = p_validation->>'section'
          AND persistence_key = p_validation->>'persistence_key';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Validation persistence did not return a saved row.';
    END IF;

    RETURN NEXT validation_row;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_cross_document_validation(JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_cross_document_validation(JSONB)
    TO service_role;

COMMIT;

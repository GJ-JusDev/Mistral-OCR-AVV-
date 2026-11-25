BEGIN;

-- Keep incomplete historical rows editable while allowing keys only for rows
-- whose academic context can be represented without guessing.
UPDATE public.cross_document_validations
SET persistence_key = NULL
WHERE persistence_key IS NOT NULL
  AND (
      student_id IS NULL
      OR school_id IS NULL
      OR school_year IS NULL
      OR BTRIM(school_year) = ''
      OR grade_level IS NULL
      OR grade_level NOT IN ('Grade 11', 'Grade 12')
      OR section IS NULL
      OR BTRIM(section) = ''
  );

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.cross_document_validations AS validation
        WHERE validation.student_id IS NOT NULL
          AND validation.school_id IS NOT NULL
          AND validation.school_year IS NOT NULL
          AND BTRIM(validation.school_year) <> ''
          AND validation.grade_level IN ('Grade 11', 'Grade 12')
          AND validation.section IS NOT NULL
          AND BTRIM(validation.section) <> ''
        GROUP BY
            validation.student_id,
            validation.school_id,
            validation.school_year,
            validation.grade_level,
            validation.section,
            CASE
                WHEN validation.validation_type = 'CONSOLIDATED_SHS'
                    THEN 'CONSOLIDATED|' || COALESCE(validation.source_signature, '')
                ELSE FORMAT(
                    'PAIR|%s|%s|%s|%s',
                    validation.validation_type,
                    COALESCE(validation.semester, 'Full Year'),
                    COALESCE(validation.source_doc1_id::TEXT, ''),
                    COALESCE(validation.source_doc2_id::TEXT, '')
                )
            END
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate scoped validation keys exist; review and resolve them before applying migration 032.';
    END IF;
END;
$$;

UPDATE public.cross_document_validations AS validation
SET persistence_key = CASE
    WHEN validation.validation_type = 'CONSOLIDATED_SHS'
        THEN 'CONSOLIDATED|' || COALESCE(validation.source_signature, '')
    ELSE FORMAT(
        'PAIR|%s|%s|%s|%s',
        validation.validation_type,
        COALESCE(validation.semester, 'Full Year'),
        COALESCE(validation.source_doc1_id::TEXT, ''),
        COALESCE(validation.source_doc2_id::TEXT, '')
    )
END
WHERE validation.student_id IS NOT NULL
  AND validation.school_id IS NOT NULL
  AND validation.school_year IS NOT NULL
  AND BTRIM(validation.school_year) <> ''
  AND validation.grade_level IS NOT NULL
  AND validation.grade_level IN ('Grade 11', 'Grade 12')
  AND validation.section IS NOT NULL
  AND BTRIM(validation.section) <> '';

CREATE OR REPLACE FUNCTION public.persist_cross_document_validation_batch(p_validations JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    validation_item JSONB;
    validation_row public.cross_document_validations%ROWTYPE;
    first_context public.cross_document_validations%ROWTYPE;
    saved_row JSONB;
    saved_rows JSONB := '[]'::jsonb;
    item_count INTEGER;
    unique_key_count INTEGER;
    is_first BOOLEAN := TRUE;
    expected_persistence_key TEXT;
BEGIN
    IF jsonb_typeof(p_validations) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Validation batch must be a JSON array.'
            USING ERRCODE = '22023';
    END IF;

    item_count := jsonb_array_length(p_validations);
    IF item_count = 0 THEN
        RAISE EXCEPTION 'Validation batch must contain at least one result.'
            USING ERRCODE = '22023';
    END IF;

    -- Validate every row and the shared learner/context before any write.
    FOR validation_item IN
        SELECT value FROM jsonb_array_elements(p_validations)
    LOOP
        IF jsonb_typeof(validation_item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Every validation batch item must be a JSON object.'
                USING ERRCODE = '22023';
        END IF;

        validation_row := jsonb_populate_record(
            NULL::public.cross_document_validations,
            validation_item
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
           OR validation_row.persistence_key IS NULL
           OR BTRIM(validation_row.persistence_key) = ''
           OR validation_row.persistence_key <> expected_persistence_key
           OR validation_row.validation_type NOT IN (
               'PSA_SF1', 'SF1_SF2', 'SF1_SF5', 'SF1_SF9',
               'SF9_SF10', 'SF5_SF9', 'SF5_SF10', 'CONSOLIDATED_SHS'
           )
           OR (
               validation_row.semester IS NOT NULL
               AND validation_row.semester NOT IN ('1st Semester', '2nd Semester', 'Full Year')
           )
           OR (
               validation_row.status IS NOT NULL
               AND validation_row.status NOT IN (
                   'MATCH', 'MISMATCH', 'DISCREPANCIES_FOUND',
                   'NEEDS_VERIFICATION', 'NOT_APPLICABLE', 'RESOLVED'
               )
           )
           OR (
               validation_item ? 'comparison_results'
               AND jsonb_typeof(validation_item->'comparison_results') NOT IN ('array', 'null')
           )
           OR (
               validation_item ? 'discrepancy_details'
               AND jsonb_typeof(validation_item->'discrepancy_details') NOT IN ('array', 'null')
           )
           OR NOT EXISTS (
               SELECT 1
               FROM public.students AS student
               WHERE student.id = validation_row.student_id
                 AND student.school_id = validation_row.school_id
           ) THEN
            RAISE EXCEPTION 'Validation batch item has missing or invalid context or payload fields.'
                USING ERRCODE = '22023';
        END IF;

        IF is_first THEN
            first_context := validation_row;
            is_first := FALSE;
        ELSIF validation_row.student_id <> first_context.student_id
           OR validation_row.school_id <> first_context.school_id
           OR validation_row.school_year <> first_context.school_year
           OR validation_row.grade_level <> first_context.grade_level
           OR validation_row.section <> first_context.section THEN
            RAISE EXCEPTION 'All validation batch items must use one learner and academic context.'
                USING ERRCODE = '22023';
        END IF;
    END LOOP;

    SELECT COUNT(DISTINCT value->>'persistence_key')
    INTO unique_key_count
    FROM jsonb_array_elements(p_validations);
    IF unique_key_count <> item_count THEN
        RAISE EXCEPTION 'Validation batch contains duplicate persistence keys.'
            USING ERRCODE = '22023';
    END IF;

    FOR validation_item IN
        SELECT value FROM jsonb_array_elements(p_validations)
    LOOP
        SELECT to_jsonb(saved)
        INTO saved_row
        FROM public.persist_cross_document_validation(validation_item) AS saved;

        IF saved_row IS NULL THEN
            RAISE EXCEPTION 'A validation batch item did not return a persisted row.';
        END IF;
        saved_rows := saved_rows || jsonb_build_array(saved_row);
    END LOOP;

    RETURN jsonb_build_object(
        'success', TRUE,
        'persistedCount', item_count,
        'validations', saved_rows
    );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_cross_document_validation_batch(JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_cross_document_validation_batch(JSONB)
    TO service_role;

COMMIT;

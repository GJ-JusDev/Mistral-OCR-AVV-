-- ==============================================================================
-- Migration: 034_remove_sf5.sql
-- Description: Safely drops SF5 promotion entries table, removes SF5/SF5A/SF5B
--              from documents check constraints, roster student checks, and
--              trigger functions.
--
-- NOTE: DO NOT EXECUTE AUTOMATICALLY. THIS FILE IS PREPARED FOR MANUAL USER
--       REVIEW AND EXPLICIT EXECUTION AGAINST SUPABASE.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Drop SF5 Promotion Entries Child Table and Associated RLS/Triggers
-- ------------------------------------------------------------------------------

-- Safely drop child table if it exists
DROP TABLE IF EXISTS public.sf5_promotion_entries CASCADE;

-- ------------------------------------------------------------------------------
-- 2. Update documents.document_type CHECK Constraint
-- ------------------------------------------------------------------------------

-- Drop all existing check constraints on document_type
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT DISTINCT con.conname
        FROM pg_constraint con
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
        WHERE con.conrelid = 'public.documents'::regclass
          AND con.contype = 'c'
          AND att.attname = 'document_type'
    ) LOOP
        EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS %I;', r.conname);
    END LOOP;
END $$;

-- Enforce Senior High School whitelisted document types (excluding sf5/sf5a/sf5b)
ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
    CHECK (document_type IN ('sf1', 'sf2', 'sf9', 'sf10', 'birth_cert'));

COMMENT ON COLUMN public.documents.document_type IS
    'AVV SHS supported document types: sf1 (School Register), sf2 (Daily Attendance), sf9 (Report Card), sf10 (Permanent Record), and birth_cert (PSA Supporting Identity).';

-- ------------------------------------------------------------------------------
-- 3. Update Roster Student NULL Constraint (SF1 and SF2 only)
-- ------------------------------------------------------------------------------

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_roster_student_null;
ALTER TABLE public.documents ADD CONSTRAINT chk_documents_roster_student_null
    CHECK (
        (document_type IN ('sf1', 'sf2') AND student_id IS NULL)
        OR (document_type IN ('sf9', 'sf10', 'birth_cert'))
    );

-- ------------------------------------------------------------------------------
-- 4. Update Canonical Active Fields Constraint
-- ------------------------------------------------------------------------------

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_canonical_active_fields;
ALTER TABLE public.documents ADD CONSTRAINT chk_documents_canonical_active_fields
    CHECK (
        -- Condition 1: Individual linked active documents must have valid canonical fields
        (
            NOT (student_id IS NOT NULL AND status NOT IN ('archived', 'rejected'))
            OR (
                school_id IS NOT NULL
                AND document_type IN ('sf9', 'sf10', 'birth_cert')
                AND (
                    document_type = 'birth_cert'
                    OR document_type = 'sf10'
                    OR (
                        school_year IS NOT NULL AND btrim(school_year) <> ''
                        AND grade_level IS NOT NULL AND btrim(grade_level) <> ''
                    )
                )
            )
        )
        AND
        -- Condition 2: Approved documents validation
        (
            status <> 'approved'
            OR (
                school_id IS NOT NULL
                AND (
                    -- Individual academic documents: require student_id, school_year, grade_level
                    (
                        document_type IN ('sf9', 'sf10')
                        AND student_id IS NOT NULL
                        AND (
                            document_type = 'sf10'
                            OR (
                                school_year IS NOT NULL AND btrim(school_year) <> ''
                                AND grade_level IS NOT NULL AND btrim(grade_level) <> ''
                            )
                        )
                    )
                    -- Roster documents: student_id is NULL, require school_year, grade_level, section
                    OR (
                        document_type IN ('sf1', 'sf2')
                        AND student_id IS NULL
                        AND school_year IS NOT NULL AND btrim(school_year) <> ''
                        AND grade_level IS NOT NULL AND btrim(grade_level) <> ''
                    )
                    -- PSA supporting documents: can be approved once verified, linked to student_id
                    OR (
                        document_type = 'birth_cert'
                    )
                )
            )
        )
    );

-- ------------------------------------------------------------------------------
-- 5. Update link_document_student_before() Trigger Function
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.link_document_student_before()
RETURNS trigger AS $$
DECLARE
    clean_lrn text;
    matched_student_id uuid;
    matched_student_school_id uuid;
    matched_student_last_name text;
    doc_extracted_last_name text;
    doc_school_id uuid;
    is_conflict_verified boolean := false;
    has_existing_conflict_flag boolean := false;
    has_required_canonical_fields boolean := false;
    conflict_detected boolean := false;
    norm_last_name text;
    norm_matched_last_name text;
BEGIN
    -- 0. Roster documents (sf1, sf2) are multi-learner rosters.
    --    They must NEVER be linked to a single student_id.
    IF NEW.document_type IN ('sf1', 'sf2') THEN
        NEW.student_id := NULL;
        NEW.canonical_lrn := NULL;

        -- Resolve school_id if missing
        IF NEW.school_id IS NULL THEN
            SELECT school_id INTO doc_school_id
            FROM public.user_roles
            WHERE user_id = auth.uid()
            LIMIT 1;
            IF doc_school_id IS NOT NULL THEN
                NEW.school_id := doc_school_id;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- 1. Normal single-student documents (sf9, sf10, birth_cert)
    -- Canonical LRN cleaning
    clean_lrn := regexp_replace(COALESCE(NEW.canonical_lrn, ''), '[^0-9]', '', 'g');
    IF length(clean_lrn) = 12 THEN
        NEW.canonical_lrn := clean_lrn;
    END IF;

    -- If student_id already set, resolve school_id and return
    IF NEW.student_id IS NOT NULL THEN
        IF NEW.school_id IS NULL THEN
            SELECT school_id INTO matched_student_school_id
            FROM public.students
            WHERE id = NEW.student_id;
            IF matched_student_school_id IS NOT NULL THEN
                NEW.school_id := matched_student_school_id;
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- Match by LRN if available
    IF NEW.canonical_lrn IS NOT NULL AND length(NEW.canonical_lrn) = 12 THEN
        SELECT id, school_id, last_name
        INTO matched_student_id, matched_student_school_id, matched_student_last_name
        FROM public.students
        WHERE lrn = NEW.canonical_lrn
        LIMIT 1;

        IF matched_student_id IS NOT NULL THEN
            NEW.student_id := matched_student_id;
            IF NEW.school_id IS NULL THEN
                NEW.school_id := matched_student_school_id;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;

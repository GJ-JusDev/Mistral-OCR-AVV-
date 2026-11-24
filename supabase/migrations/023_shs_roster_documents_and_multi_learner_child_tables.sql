-- ==============================================================================
-- MIGRATION 023: SENIOR HIGH SCHOOL ROSTER DOCUMENTS & MULTI-LEARNER CHILD TABLES
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 500169
-- Academic Scope: Exclusively Senior High School (Grades 11 & 12)
-- ==============================================================================
-- Objectives:
--   1. Expand public.documents.document_type check constraint to officially admit
--      Senior High School forms: 'sf1', 'sf2', 'sf5', 'sf9', 'sf10', 'birth_cert'.
--   2. Allow documents.student_id to be NULL for multi-learner roster documents
--      ('sf1', 'sf2', 'sf5') while requiring student_id for individual learner
--      academic forms ('sf9', 'sf10') upon approval.
--   3. Update chk_documents_canonical_active_fields and link_document_student_before()
--      to handle roster documents and supporting PSA birth certificates properly.
--   4. Create multi-learner child tables for Senior High School:
--      - public.sf1_roster_entries (SHS section master register)
--      - public.sf2_attendance_entries (monthly attendance grid & totals)
--      - public.sf5_promotion_entries (SF5A-SHS semester status & SF5B-SHS graduation candidates)
--      - public.psa_identity_records (supporting civil registry identity evidence)
--   5. Add indexes, foreign keys, and updated_at triggers.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Expand Document Type Whitelist & Nullable Student ID for Rosters
-- ------------------------------------------------------------------------------

-- Drop any existing CHECK constraints on document_type
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

-- Enforce Senior High School whitelisted document types
ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
    CHECK (document_type IN ('sf1', 'sf2', 'sf5', 'sf9', 'sf10', 'birth_cert'));

COMMENT ON COLUMN public.documents.document_type IS
    'AVV SHS supported document types: sf1 (School Register), sf2 (Daily Attendance), sf5 (Promotion/Proficiency), sf9 (Report Card), sf10 (Permanent Record), and birth_cert (PSA Supporting Identity).';

-- Ensure student_id is nullable on public.documents
ALTER TABLE public.documents ALTER COLUMN student_id DROP NOT NULL;

-- Enforce that roster documents have student_id = NULL
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_roster_student_null;
ALTER TABLE public.documents ADD CONSTRAINT chk_documents_roster_student_null
    CHECK (
        (document_type IN ('sf1', 'sf2', 'sf5') AND student_id IS NULL)
        OR (document_type IN ('sf9', 'sf10', 'birth_cert'))
    );

-- Add section and month columns to public.documents if missing (for roster tracking)
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS section TEXT,
    ADD COLUMN IF NOT EXISTS reporting_month TEXT,
    ADD COLUMN IF NOT EXISTS track TEXT,
    ADD COLUMN IF NOT EXISTS strand TEXT;

-- ------------------------------------------------------------------------------
-- 2. Update Canonical Constraints & Trigger Function
-- ------------------------------------------------------------------------------

-- Update chk_documents_canonical_active_fields to accommodate roster documents & PSA
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
                        document_type IN ('sf1', 'sf2', 'sf5')
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

-- Update link_document_student_before() trigger to safely handle roster documents and birth_cert
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
    -- 0. Roster documents (sf1, sf2, sf5) are multi-learner rosters.
    --    They must NEVER be linked to a single student_id.
    IF NEW.document_type IN ('sf1', 'sf2', 'sf5') THEN
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

        -- Extract section, school_year, grade_level from extracted_fields if not set
        IF NEW.extracted_fields IS NOT NULL THEN
            IF NEW.school_year IS NULL OR TRIM(NEW.school_year) = '' THEN
                NEW.school_year := NULLIF(TRIM(NEW.extracted_fields->>'school_year'), '');
            END IF;
            IF NEW.grade_level IS NULL OR TRIM(NEW.grade_level) = '' THEN
                NEW.grade_level := public.normalize_shs_grade_level(NEW.extracted_fields->>'grade_level');
            END IF;
            IF NEW.section IS NULL OR TRIM(NEW.section) = '' THEN
                NEW.section := NULLIF(TRIM(NEW.extracted_fields->>'section'), '');
            END IF;
            IF NEW.track IS NULL OR TRIM(NEW.track) = '' THEN
                NEW.track := NULLIF(TRIM(NEW.extracted_fields->>'track'), '');
            END IF;
            IF NEW.strand IS NULL OR TRIM(NEW.strand) = '' THEN
                NEW.strand := NULLIF(TRIM(NEW.extracted_fields->>'strand'), '');
            END IF;
        END IF;

        IF LOWER(NEW.status) = 'approved' THEN
            IF NEW.school_id IS NULL OR NEW.school_year IS NULL OR NEW.grade_level IS NULL THEN
                RAISE EXCEPTION 'Canonical Roster Validation Failed: school_id, school_year, and grade_level must be non-null before approving a roster document.'
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- 1. Ensure file_hash is populated
    IF NEW.file_hash IS NULL OR TRIM(NEW.file_hash) = '' THEN
        NEW.file_hash := COALESCE(
            CASE WHEN NEW.extracted_fields IS NOT NULL THEN
                COALESCE(
                    NULLIF(TRIM(NEW.extracted_fields->>'file_hash'), ''),
                    NULLIF(TRIM(NEW.extracted_fields->'scan_history'->0->>'file_hash'), '')
                )
            ELSE NULL END,
            CASE WHEN NEW.image_url IS NOT NULL AND TRIM(NEW.image_url) <> '' THEN
                md5(NEW.image_url)
            ELSE NULL END
        );
    END IF;

    -- 2. Check explicit identity_conflict flags in extracted_fields
    IF NEW.extracted_fields IS NOT NULL THEN
        has_existing_conflict_flag := COALESCE((NEW.extracted_fields->>'identity_conflict') = 'true', false)
                                   OR COALESCE((NEW.extracted_fields->>'manual_lrn_verification_required') = 'true', false);
        is_conflict_verified := COALESCE((NEW.extracted_fields->>'lrn_conflict_verified') = 'true', false);
    END IF;

    IF is_conflict_verified THEN
        IF TG_OP = 'INSERT' THEN
            RAISE EXCEPTION 'Security Violation: lrn_conflict_verified cannot be set on initial document insert. Must use public.resolve_document_identity_conflict().'
                USING ERRCODE = '42501';
        ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.extracted_fields->>'lrn_conflict_verified', '') <> 'true' THEN
            IF COALESCE(current_setting('avv.conflict_resolution_authorized', true), '') <> NEW.id::text THEN
                RAISE EXCEPTION 'Security Violation: lrn_conflict_verified can only be set through the authorized, audited public.resolve_document_identity_conflict() RPC.'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    IF has_existing_conflict_flag AND NOT is_conflict_verified THEN
        IF LOWER(NEW.status) = 'approved' THEN
            RAISE EXCEPTION 'Identity Collision Blocked: Manual LRN verification (lrn_conflict_verified = true) is required before approving this document.'
                USING ERRCODE = '23514';
        END IF;
        NEW.student_id := NULL;
        NEW.canonical_lrn := NULL;
        RETURN NEW;
    END IF;

    -- 3. Resolve school_id
    doc_school_id := NEW.school_id;
    IF doc_school_id IS NULL THEN
        SELECT school_id INTO doc_school_id
        FROM public.user_roles
        WHERE user_id = auth.uid()
        LIMIT 1;
        IF doc_school_id IS NOT NULL THEN
            NEW.school_id := doc_school_id;
        END IF;
    END IF;

    -- 4. Check whether canonical identity fields are non-null and valid
    has_required_canonical_fields := (
        NEW.school_id IS NOT NULL
        AND NEW.document_type IN ('sf9', 'sf10', 'birth_cert')
        AND (
            NEW.document_type = 'birth_cert'
            OR NEW.document_type = 'sf10'
            OR (
                NEW.school_year IS NOT NULL AND TRIM(NEW.school_year) <> ''
                AND NEW.grade_level IS NOT NULL AND TRIM(NEW.grade_level) <> ''
            )
        )
    );

    IF LOWER(NEW.status) = 'approved' AND NOT has_required_canonical_fields THEN
        RAISE EXCEPTION 'Canonical Identity Validation Failed: school_id, document_type, school_year, and grade_level must be non-null before approving a document.'
            USING ERRCODE = '23514';
    END IF;

    -- 5. Resolve 12-digit LRN from extracted_fields or linked student
    IF NEW.extracted_fields IS NOT NULL THEN
        clean_lrn := REGEXP_REPLACE(
            REGEXP_REPLACE(
                TRIM(COALESCE(
                    NEW.extracted_fields->>'lrn',
                    NEW.extracted_fields->'student'->>'lrn',
                    NEW.extracted_fields->>'learner_reference_number',
                    ''
                )),
                '^[Ll][Rr][Nn][:\s\-]*', ''
            ),
            '[\s\-–—\.]', '', 'g'
        );
    END IF;

    IF (clean_lrn IS NULL OR clean_lrn !~ '^[0-9]{12}$') AND NEW.student_id IS NOT NULL THEN
        SELECT lrn INTO clean_lrn FROM public.students WHERE id = NEW.student_id;
    END IF;

    IF clean_lrn ~ '^[0-9]{12}$' THEN
        SELECT id, school_id, last_name INTO matched_student_id, matched_student_school_id, matched_student_last_name
        FROM public.students
        WHERE lrn = clean_lrn
        ORDER BY created_at ASC
        LIMIT 1;

        IF NEW.extracted_fields IS NOT NULL THEN
            doc_extracted_last_name := COALESCE(
                NULLIF(TRIM(NEW.extracted_fields->>'last_name'), ''),
                NULLIF(TRIM(NEW.extracted_fields->'student'->>'last_name'), '')
            );
        END IF;

        IF matched_student_id IS NOT NULL AND doc_extracted_last_name IS NOT NULL AND matched_student_last_name IS NOT NULL THEN
            norm_last_name := LOWER(REGEXP_REPLACE(TRIM(doc_extracted_last_name), '[^a-zA-Z0-9]', '', 'g'));
            norm_matched_last_name := LOWER(REGEXP_REPLACE(TRIM(matched_student_last_name), '[^a-zA-Z0-9]', '', 'g'));

            IF norm_last_name <> '' AND norm_matched_last_name <> ''
               AND norm_last_name <> norm_matched_last_name
               AND position(norm_last_name in norm_matched_last_name) = 0
               AND position(norm_matched_last_name in norm_last_name) = 0 THEN
                conflict_detected := true;
            END IF;
        END IF;

        IF conflict_detected AND NOT is_conflict_verified THEN
            IF LOWER(NEW.status) = 'approved' THEN
                RAISE EXCEPTION 'Identity Collision Blocked: Document last name "%" conflicts with student registry last name "%" for LRN %. Manual verification required.',
                    doc_extracted_last_name, matched_student_last_name, clean_lrn
                    USING ERRCODE = '23514';
            END IF;
            NEW.student_id := NULL;
            NEW.canonical_lrn := NULL;
            IF NEW.extracted_fields IS NOT NULL THEN
                NEW.extracted_fields := NEW.extracted_fields || jsonb_build_object(
                    'identity_conflict', true,
                    'manual_lrn_verification_required', true,
                    'conflict_lrn', clean_lrn,
                    'conflict_extracted_name', doc_extracted_last_name,
                    'conflict_registry_name', matched_student_last_name
                );
            END IF;
            RETURN NEW;
        END IF;

        NEW.canonical_lrn := clean_lrn;
        IF matched_student_id IS NOT NULL AND NEW.student_id IS NULL THEN
            NEW.student_id := matched_student_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 3. Create Multi-Learner Child Tables for Senior High School
-- ------------------------------------------------------------------------------

-- Table: public.sf1_roster_entries
CREATE TABLE IF NOT EXISTS public.sf1_roster_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    school_year TEXT NOT NULL,
    grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    section TEXT NOT NULL,
    track TEXT NOT NULL,
    strand TEXT NOT NULL,
    semester TEXT NOT NULL CHECK (semester IN ('1st Semester', '2nd Semester')),
    lrn TEXT NOT NULL,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    suffix TEXT,
    sex TEXT NOT NULL CHECK (sex IN ('M', 'F')),
    birth_date DATE,
    age NUMERIC,
    mother_tongue TEXT,
    ip_community TEXT,
    religion TEXT,
    address_details JSONB DEFAULT '{}'::jsonb,
    parents_details JSONB DEFAULT '{}'::jsonb,
    guardian_details JSONB DEFAULT '{}'::jsonb,
    remarks_indicator TEXT,
    row_index INTEGER NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    bounding_box JSONB,
    ocr_confidence NUMERIC,
    review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK (review_status IN ('NEEDS_REVIEW', 'VERIFIED', 'FLAGGED')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sf1_roster_doc ON public.sf1_roster_entries(document_id);
CREATE INDEX IF NOT EXISTS idx_sf1_roster_lrn ON public.sf1_roster_entries(lrn);
CREATE INDEX IF NOT EXISTS idx_sf1_roster_student ON public.sf1_roster_entries(student_id);
CREATE INDEX IF NOT EXISTS idx_sf1_roster_sec ON public.sf1_roster_entries(school_id, school_year, grade_level, section);

-- Table: public.sf2_attendance_entries
CREATE TABLE IF NOT EXISTS public.sf2_attendance_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    school_year TEXT NOT NULL,
    grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    section TEXT NOT NULL,
    track TEXT,
    strand TEXT,
    month TEXT NOT NULL,
    lrn TEXT,
    learner_name TEXT NOT NULL,
    total_school_days NUMERIC NOT NULL DEFAULT 0,
    days_present NUMERIC NOT NULL DEFAULT 0,
    days_absent NUMERIC NOT NULL DEFAULT 0,
    days_tardy NUMERIC NOT NULL DEFAULT 0,
    daily_grid JSONB NOT NULL DEFAULT '[]'::jsonb,
    remarks TEXT,
    row_index INTEGER NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    bounding_box JSONB,
    ocr_confidence NUMERIC,
    review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK (review_status IN ('NEEDS_REVIEW', 'VERIFIED', 'FLAGGED')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sf2_attendance_doc ON public.sf2_attendance_entries(document_id);
CREATE INDEX IF NOT EXISTS idx_sf2_attendance_lrn ON public.sf2_attendance_entries(lrn);
CREATE INDEX IF NOT EXISTS idx_sf2_attendance_student ON public.sf2_attendance_entries(student_id);
CREATE INDEX IF NOT EXISTS idx_sf2_attendance_month ON public.sf2_attendance_entries(school_id, school_year, section, month);

-- Table: public.sf5_promotion_entries
CREATE TABLE IF NOT EXISTS public.sf5_promotion_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    school_year TEXT NOT NULL,
    grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    section TEXT NOT NULL,
    track TEXT NOT NULL,
    strand TEXT NOT NULL,
    semester TEXT NOT NULL CHECK (semester IN ('1st Semester', '2nd Semester', 'Full Year')),
    form_variant TEXT NOT NULL CHECK (form_variant IN ('SF5A-SHS', 'SF5B-SHS')),
    lrn TEXT NOT NULL,
    learner_name TEXT NOT NULL,
    general_average NUMERIC,
    action_taken TEXT NOT NULL CHECK (action_taken IN ('COMPLETE', 'INCOMPLETE', 'GRADUATING', 'PENDING_DEFICIENCIES')),
    proficiency_level TEXT CHECK (proficiency_level IN ('DID_NOT_MEET_EXPECTATIONS', 'FAIRLY_SATISFACTORY', 'SATISFACTORY', 'VERY_SATISFACTORY', 'OUTSTANDING')),
    incomplete_subjects JSONB DEFAULT '[]'::jsonb,
    row_index INTEGER NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    bounding_box JSONB,
    ocr_confidence NUMERIC,
    review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK (review_status IN ('NEEDS_REVIEW', 'VERIFIED', 'FLAGGED')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sf5_promotion_doc ON public.sf5_promotion_entries(document_id);
CREATE INDEX IF NOT EXISTS idx_sf5_promotion_lrn ON public.sf5_promotion_entries(lrn);
CREATE INDEX IF NOT EXISTS idx_sf5_promotion_student ON public.sf5_promotion_entries(student_id);
CREATE INDEX IF NOT EXISTS idx_sf5_promotion_variant ON public.sf5_promotion_entries(school_id, school_year, form_variant);

-- Table: public.psa_identity_records
CREATE TABLE IF NOT EXISTS public.psa_identity_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    registry_number TEXT,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    sex TEXT NOT NULL CHECK (sex IN ('M', 'F')),
    birth_date DATE NOT NULL,
    birth_place JSONB DEFAULT '{}'::jsonb,
    mother_maiden_name TEXT,
    father_name TEXT,
    parents_marriage_details JSONB DEFAULT '{}'::jsonb,
    verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'FLAGGED_MISMATCH')),
    conflict_notes TEXT,
    verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    bounding_box JSONB,
    ocr_confidence NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psa_identity_doc ON public.psa_identity_records(document_id);
CREATE INDEX IF NOT EXISTS idx_psa_identity_student ON public.psa_identity_records(student_id);

-- ------------------------------------------------------------------------------
-- 4. Triggers for updated_at
-- ------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trigger_sf1_roster_updated_at ON public.sf1_roster_entries;
CREATE TRIGGER trigger_sf1_roster_updated_at
    BEFORE UPDATE ON public.sf1_roster_entries
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_sf2_attendance_updated_at ON public.sf2_attendance_entries;
CREATE TRIGGER trigger_sf2_attendance_updated_at
    BEFORE UPDATE ON public.sf2_attendance_entries
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_sf5_promotion_updated_at ON public.sf5_promotion_entries;
CREATE TRIGGER trigger_sf5_promotion_updated_at
    BEFORE UPDATE ON public.sf5_promotion_entries
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_psa_identity_updated_at ON public.psa_identity_records;
CREATE TRIGGER trigger_psa_identity_updated_at
    BEFORE UPDATE ON public.psa_identity_records
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;

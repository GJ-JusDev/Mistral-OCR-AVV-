-- ==============================================================================
-- Migration 021: Canonical Academic Document Records, Scan Version History,
-- Transactional Historical Reconciliation & Database-Level Uniqueness Enforcement
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 500169
-- ==============================================================================
--
-- Objectives:
-- 1. Ensure compatibility with Migrations 016–020 (archived status, archived_at,
--    archived_by, file_hash, and RLS policies).
-- 2. Create public.document_scans table to preserve uploaded physical scans as
--    versioned evidence without duplicating canonical academic records.
-- 3. Backfill top-level school_year, normalized grade_level ('Grade 11'/'Grade 12'),
--    semester, and file_hash from extracted_fields on existing records.
-- 4. Harden public.link_document_student_before() trigger function:
--    - Enforces Full Name / Last Name vs student registry collision verification.
--    - Blocks auto-linking on LRN + Name collision (Case C), keeps student_id = NULL,
--      and requires manual LRN verification (lrn_conflict_verified = true) before
--      any student linking or approval.
--    - Requires non-null validated canonical identity fields (school_id, student_id,
--      document_type, school_year, grade_level) before a record becomes an active
--      canonical SF9 record or is approved.
--    - Prohibits creating placeholder 'UNKNOWN' student records on approval.
-- 5. Harden public.process_approved_document() trigger function so that transitioning
--    an approved canonical record to 'needs_review' during an incremental grade upload
--    preserves existing verified subject_grades rows while new quarters await review.
-- 6. Provide and execute the reviewed, transactional reconciliation procedure
--    public.reconcile_historical_duplicate_documents() to archive historical
--    Justin Gomez duplicates into scan history while preserving all 18 verified
--    subject_grades, review_logs, and audit_logs, and isolating Kenneth Latonero
--    identity collision records (cc8b4c08 and edda579a).
-- 7. Enforce CHECK constraint chk_documents_canonical_active_fields and partial
--    UNIQUE indexes (never silently skipping index creation):
--    - idx_documents_canonical_sf9_active:
--      (school_id, student_id, document_type, school_year, grade_level)
--      WHERE status NOT IN ('archived', 'rejected') AND document_type = 'sf9' AND student_id IS NOT NULL
--    - idx_documents_canonical_sf10_active:
--      (school_id, student_id, document_type)
--      WHERE status NOT IN ('archived', 'rejected') AND document_type = 'sf10' AND student_id IS NOT NULL
--    - idx_documents_staging_file_hash_active:
--      (school_id, document_type, file_hash)
--      WHERE status NOT IN ('archived', 'rejected') AND student_id IS NULL AND file_hash IS NOT NULL
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. Ensure Prerequisite Columns & Status Check Compatibility (Migrations 016–020)
-- ------------------------------------------------------------------------------
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS file_hash TEXT,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS curriculum_id TEXT,
    ADD COLUMN IF NOT EXISTS source_form_version TEXT,
    ADD COLUMN IF NOT EXISTS grading_policy_version TEXT,
    ADD COLUMN IF NOT EXISTS grading_period_scheme TEXT,
    ADD COLUMN IF NOT EXISTS general_average_printed NUMERIC;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_status_check
    CHECK (status IN ('submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected', 'archived'));

-- ------------------------------------------------------------------------------
-- 1. Create public.document_scans Table & RLS Policies
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    scan_version INTEGER NOT NULL DEFAULT 1,
    file_path TEXT,
    file_hash TEXT,
    image_url TEXT NOT NULL,
    back_image_url TEXT,
    original_filename TEXT,
    detected_quarters TEXT[],
    uploaded_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_scans_doc_version
    ON public.document_scans (document_id, scan_version);

CREATE INDEX IF NOT EXISTS idx_document_scans_file_hash
    ON public.document_scans (file_hash)
    WHERE file_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_scans_student_id
    ON public.document_scans (student_id)
    WHERE student_id IS NOT NULL;

ALTER TABLE public.document_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read document_scans" ON public.document_scans;
CREATE POLICY "Authenticated users can read document_scans"
    ON public.document_scans FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.documents d
            JOIN public.user_roles ur ON ur.user_id = auth.uid()
            WHERE d.id = document_scans.document_id
              AND ur.account_status = 'Approved'
              AND (ur.school_id IS NULL OR ur.school_id = d.school_id)
        )
    );

DROP POLICY IF EXISTS "Authenticated users can insert document_scans" ON public.document_scans;
CREATE POLICY "Authenticated users can insert document_scans"
    ON public.document_scans FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM public.documents d
            JOIN public.user_roles ur ON ur.user_id = auth.uid()
            WHERE d.id = document_scans.document_id
              AND ur.account_status = 'Approved'
              AND (ur.school_id IS NULL OR ur.school_id = d.school_id)
        )
    );

-- ------------------------------------------------------------------------------
-- 2. Helper Function: Normalize SHS Grade Level ('11' -> 'Grade 11', '12' -> 'Grade 12')
--    Does NOT invent a grade level when input is NULL or unrecognized.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_shs_grade_level(raw_gl text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    cleaned text;
BEGIN
    IF raw_gl IS NULL OR TRIM(raw_gl) = '' THEN
        RETURN NULL;
    END IF;
    cleaned := LOWER(TRIM(raw_gl));
    IF cleaned ~ '(^|[^0-9])12([^0-9]|$)' OR cleaned ~ '\bxii\b' THEN
        RETURN 'Grade 12';
    ELSIF cleaned ~ '(^|[^0-9])11([^0-9]|$)' OR cleaned ~ '\bxi\b' THEN
        RETURN 'Grade 11';
    END IF;
    RETURN TRIM(raw_gl);
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. Backfill Top-Level school_year, grade_level, semester, and file_hash
--    on Existing Documents (Non-Destructive)
-- ------------------------------------------------------------------------------
UPDATE public.documents d
SET
    school_year = COALESCE(
        NULLIF(TRIM(d.school_year), ''),
        NULLIF(TRIM(d.extracted_fields->>'school_year'), ''),
        NULLIF(TRIM(d.extracted_fields->'student'->>'school_year'), '')
    ),
    grade_level = public.normalize_shs_grade_level(
        COALESCE(
            NULLIF(TRIM(d.grade_level), ''),
            NULLIF(TRIM(d.extracted_fields->>'grade_level'), ''),
            NULLIF(TRIM(d.extracted_fields->>'selected_grade_level'), ''),
            NULLIF(TRIM(d.extracted_fields->'student'->>'grade_level'), ''),
            (SELECT s.grade_level FROM public.students s WHERE s.id = d.student_id)
        )
    ),
    semester = COALESCE(
        NULLIF(TRIM(d.semester), ''),
        NULLIF(TRIM(d.extracted_fields->>'semester'), ''),
        NULLIF(TRIM(d.extracted_fields->>'term'), '')
    ),
    file_hash = COALESCE(
        NULLIF(TRIM(d.file_hash), ''),
        NULLIF(TRIM(d.extracted_fields->>'file_hash'), ''),
        NULLIF(TRIM(d.extracted_fields->'scan_history'->0->>'file_hash'), ''),
        CASE
            WHEN d.image_url IS NOT NULL AND TRIM(d.image_url) <> ''
            THEN md5(d.image_url || '::' || d.id::text)
            ELSE md5(d.id::text)
        END
    )
WHERE d.school_year IS NULL
   OR d.grade_level IS NULL
   OR d.grade_level IN ('11', '12')
   OR d.file_hash IS NULL;

-- ------------------------------------------------------------------------------
-- 4. Harden link_document_student_before() Trigger Function
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_document_student_before()
RETURNS trigger AS $$
DECLARE
    clean_lrn text;
    doc_school_id uuid;
    matched_student_id uuid;
    matched_student_school_id uuid;
    matched_student_last_name text;
    doc_extracted_last_name text;
    doc_extracted_first_name text;
    is_name_conflict boolean := false;
    is_conflict_verified boolean := false;
    has_existing_conflict_flag boolean := false;
    has_required_canonical_fields boolean := false;
BEGIN
    -- 1. Synchronize school_year, normalized grade_level, semester, and file_hash from extracted_fields
    --    Never invent values if missing from both top-level and extracted_fields
    IF (NEW.school_year IS NULL OR TRIM(NEW.school_year) = '') AND NEW.extracted_fields IS NOT NULL THEN
        NEW.school_year := COALESCE(
            NULLIF(TRIM(NEW.extracted_fields->>'school_year'), ''),
            NULLIF(TRIM(NEW.extracted_fields->'student'->>'school_year'), '')
        );
    END IF;

    NEW.grade_level := public.normalize_shs_grade_level(
        COALESCE(
            NULLIF(TRIM(NEW.grade_level), ''),
            CASE WHEN NEW.extracted_fields IS NOT NULL THEN
                COALESCE(
                    NULLIF(TRIM(NEW.extracted_fields->>'grade_level'), ''),
                    NULLIF(TRIM(NEW.extracted_fields->>'selected_grade_level'), ''),
                    NULLIF(TRIM(NEW.extracted_fields->'student'->>'grade_level'), '')
                )
            ELSE NULL END
        )
    );

    IF (NEW.semester IS NULL OR TRIM(NEW.semester) = '') AND NEW.extracted_fields IS NOT NULL THEN
        NEW.semester := COALESCE(
            NULLIF(TRIM(NEW.extracted_fields->>'semester'), ''),
            NULLIF(TRIM(NEW.extracted_fields->>'term'), '')
        );
    END IF;

    IF (NEW.file_hash IS NULL OR TRIM(NEW.file_hash) = '') THEN
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

    IF has_existing_conflict_flag AND NOT is_conflict_verified THEN
        IF LOWER(NEW.status) = 'approved' THEN
            RAISE EXCEPTION 'Identity Collision Blocked: Manual LRN verification (lrn_conflict_verified = true) is required before approving this document.'
                USING ERRCODE = '23514';
        END IF;
        NEW.student_id := NULL;
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
        AND NEW.document_type IN ('sf9', 'sf10')
        AND (
            NEW.document_type <> 'sf9'
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
                NULLIF(TRIM(NEW.extracted_fields->'student'->>'last_name'), ''),
                CASE WHEN (NEW.extracted_fields->>'name') LIKE '%,%' THEN
                    NULLIF(TRIM(split_part(NEW.extracted_fields->>'name', ',', 1)), '')
                WHEN (NEW.extracted_fields->>'full_name') LIKE '%,%' THEN
                    NULLIF(TRIM(split_part(NEW.extracted_fields->>'full_name', ',', 1)), '')
                ELSE NULL END
            );
            doc_extracted_first_name := COALESCE(
                NULLIF(TRIM(NEW.extracted_fields->>'first_name'), ''),
                NULLIF(TRIM(NEW.extracted_fields->'student'->>'first_name'), ''),
                CASE WHEN (NEW.extracted_fields->>'name') LIKE '%,%' THEN
                    NULLIF(TRIM(split_part(NEW.extracted_fields->>'name', ',', 2)), '')
                WHEN (NEW.extracted_fields->>'full_name') LIKE '%,%' THEN
                    NULLIF(TRIM(split_part(NEW.extracted_fields->>'full_name', ',', 2)), '')
                ELSE NULL END
            );
        END IF;

        -- Collision Check: If last name is extracted and conflicts with registered student for this LRN
        IF matched_student_id IS NOT NULL AND doc_extracted_last_name IS NOT NULL AND matched_student_last_name IS NOT NULL THEN
            IF LOWER(REGEXP_REPLACE(doc_extracted_last_name, '[^a-zA-Z]', '', 'g')) <> LOWER(REGEXP_REPLACE(matched_student_last_name, '[^a-zA-Z]', '', 'g'))
               AND POSITION(LOWER(REGEXP_REPLACE(doc_extracted_last_name, '[^a-zA-Z]', '', 'g')) IN LOWER(REGEXP_REPLACE(matched_student_last_name, '[^a-zA-Z]', '', 'g'))) = 0
               AND POSITION(LOWER(REGEXP_REPLACE(matched_student_last_name, '[^a-zA-Z]', '', 'g')) IN LOWER(REGEXP_REPLACE(doc_extracted_last_name, '[^a-zA-Z]', '', 'g'))) = 0 THEN
                is_name_conflict := true;
            END IF;
        END IF;

        IF matched_student_id IS NOT NULL THEN
            IF is_name_conflict AND NOT is_conflict_verified THEN
                IF LOWER(NEW.status) = 'approved' THEN
                    RAISE EXCEPTION 'Identity Collision Blocked: LRN % is registered to %, but document extracted %. Manual LRN verification is required before approval.',
                        clean_lrn, matched_student_last_name, doc_extracted_last_name
                        USING ERRCODE = '23514';
                END IF;
                -- Hard name conflict (Case C): do NOT link to the existing student!
                NEW.student_id := NULL;
                NEW.extracted_fields := jsonb_set(
                    jsonb_set(
                        COALESCE(NEW.extracted_fields, '{}'::jsonb),
                        '{identity_conflict}',
                        'true'::jsonb
                    ),
                    '{manual_lrn_verification_required}',
                    'true'::jsonb
                );
                NEW.extracted_fields := jsonb_set(
                    NEW.extracted_fields,
                    '{collision_reason}',
                    to_jsonb(format('LRN %s is registered to %s, but document extracted %s. Manual LRN verification required before approval.',
                        clean_lrn, matched_student_last_name, doc_extracted_last_name))
                );
            ELSIF matched_student_school_id = doc_school_id THEN
                -- Only link student_id on active records if all canonical identity fields are non-null
                IF has_required_canonical_fields OR LOWER(NEW.status) IN ('archived', 'rejected') THEN
                    NEW.student_id := matched_student_id;
                ELSE
                    NEW.student_id := NULL;
                END IF;
            ELSE
                IF LOWER(NEW.status) = 'approved' THEN
                    RAISE EXCEPTION 'Cross-school student conflict: LRN % is already registered to another school (School ID: %). Cross-school student linking or duplicate creation is prohibited without official transfer or administrative resolution.',
                        clean_lrn, matched_student_school_id
                        USING ERRCODE = '23505';
                ELSE
                    NEW.student_id := NULL;
                END IF;
            END IF;

        ELSE
            -- No existing student in public.students yet
            IF LOWER(NEW.status) = 'approved' THEN
                IF doc_extracted_first_name IS NULL OR doc_extracted_last_name IS NULL
                   OR UPPER(doc_extracted_first_name) = 'UNKNOWN' OR UPPER(doc_extracted_last_name) = 'UNKNOWN' THEN
                    RAISE EXCEPTION 'Student Identity Validation Failed: Validated first_name and last_name are required before creating a canonical student on approval.'
                        USING ERRCODE = '23514';
                END IF;

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
                    doc_extracted_first_name,
                    doc_extracted_last_name,
                    COALESCE(NULLIF(TRIM(NEW.extracted_fields->'student'->>'middle_name'), ''), NULLIF(TRIM(NEW.extracted_fields->>'middle_name'), '')),
                    COALESCE(NULLIF(TRIM(NEW.extracted_fields->'student'->>'suffix'), ''), NULLIF(TRIM(NEW.extracted_fields->>'suffix'), '')),
                    NEW.grade_level,
                    'active',
                    'Passed'
                )
                ON CONFLICT (lrn) DO NOTHING
                RETURNING id INTO matched_student_id;

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
    ELSE
        IF LOWER(NEW.status) = 'approved' AND NEW.student_id IS NULL THEN
            RAISE EXCEPTION 'Student Identity Validation Failed: A valid 12-digit LRN and verified student_id are required before approval.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Final guard: if canonical fields are missing on a non-archived/non-rejected record, keep student_id NULL (staging)
    IF NEW.student_id IS NOT NULL AND LOWER(NEW.status) NOT IN ('archived', 'rejected') AND NOT has_required_canonical_fields THEN
        NEW.student_id := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_link_document_student_before ON public.documents;
CREATE TRIGGER trg_link_document_student_before
    BEFORE INSERT OR UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.link_document_student_before();

-- ------------------------------------------------------------------------------
-- 5. Harden process_approved_document() Trigger Function
--    Preserves verified subject_grades when an approved canonical document
--    transitions to 'needs_review' during an incremental grade upload.
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
    -- CASE B: Document explicitly rejected, unapproved, or deleted from approved
    -- NOTE: Incremental updates that transition an approved canonical record to
    -- 'needs_review' (is_incremental_requeue = true) MUST preserve existing
    -- verified subject_grades while the new quarters await review!
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

                    IF clean_final IS NULL THEN
                        IF clean_q1 IS NOT NULL AND clean_q2 IS NOT NULL THEN
                            clean_final := ROUND((clean_q1 + clean_q2) / 2.0);
                        ELSIF clean_q3 IS NOT NULL AND clean_q4 IS NOT NULL THEN
                            clean_final := ROUND((clean_q3 + clean_q4) / 2.0);
                        END IF;
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

DROP TRIGGER IF EXISTS trigger_process_approved_document ON public.documents;
DROP TRIGGER IF EXISTS trg_process_approved_document ON public.documents;
CREATE TRIGGER trg_process_approved_document
    AFTER UPDATE OR DELETE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.process_approved_document();

-- ------------------------------------------------------------------------------
-- 6. Atomic Advisory Lock Helper for Concurrent Upload Serialization
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_canonical_document_lock(
    p_school_id uuid,
    p_document_type text,
    p_canonical_key text,
    p_school_year text DEFAULT NULL,
    p_grade_level text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lock_str text;
BEGIN
    v_lock_str := COALESCE(p_school_id::text, '') || '::' ||
                  COALESCE(LOWER(TRIM(p_document_type)), '') || '::' ||
                  COALESCE(TRIM(p_canonical_key), '') || '::' ||
                  COALESCE(TRIM(p_school_year), '') || '::' ||
                  COALESCE(public.normalize_shs_grade_level(p_grade_level), '');
    PERFORM pg_advisory_xact_lock(hashtext(v_lock_str));
END;
$$;

GRANT EXECUTE ON FUNCTION public.acquire_canonical_document_lock(uuid, text, text, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. Reviewed Transactional Historical Reconciliation Procedure
--    Preserves:
--    - Original scanned files (in public.document_scans & scan_history)
--    - Verified grade records (18 rows in public.subject_grades)
--    - Review logs (public.review_logs)
--    - Approval history (reviewed_by, reviewed_at)
--    - Audit events (public.audit_logs)
--    - Student relationships (unlinking Kenneth Latonero collision rows)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_historical_duplicate_documents()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_canonical_doc RECORD;
    v_dup_doc RECORD;
    v_collision_doc RECORD;
    v_grades_count INTEGER;
    v_active_gomez_count INTEGER;
    v_linked_collision_count INTEGER;
    v_scan_version INTEGER := 1;
    v_archived_count INTEGER := 0;
    v_unlinked_count INTEGER := 0;
    v_scan_history JSONB;
    v_result JSONB;
BEGIN
    -- 1. VERIFY CANONICAL RECORD INVARIANTS (Justin Gomez S.Y. 2019-2020 Grade 11 SF9)
    SELECT * INTO v_canonical_doc
    FROM public.documents
    WHERE id = '840dc1c4-a272-444e-9ff4-2faba4b94c0b'
      AND status = 'approved'
      AND student_id = '6722d559-440f-4cdc-bd14-e12fad11d836';

    IF v_canonical_doc.id IS NULL THEN
        RAISE EXCEPTION 'Reconciliation Aborted: Canonical document 840dc1c4-a272-444e-9ff4-2faba4b94c0b not found or not in approved status.';
    END IF;

    SELECT COUNT(*) INTO v_grades_count
    FROM public.subject_grades
    WHERE document_id = v_canonical_doc.id
      AND student_id = v_canonical_doc.student_id;

    IF v_grades_count < 18 THEN
        RAISE EXCEPTION 'Reconciliation Aborted: Canonical document 840dc1c4-a272-444e-9ff4-2faba4b94c0b only has % verified subject_grades (expected 18).', v_grades_count;
    END IF;

    -- Ensure canonical document top-level metadata is populated
    UPDATE public.documents
    SET
        school_year = '2019-2020',
        grade_level = 'Grade 11',
        file_hash = COALESCE(file_hash, md5(COALESCE(image_url, id::text)))
    WHERE id = v_canonical_doc.id;

    -- 2. BACKFILL INITIAL CANONICAL SCAN INTO document_scans (Version 1)
    INSERT INTO public.document_scans (
        document_id, student_id, scan_version, file_hash, image_url, original_filename, uploaded_by, created_at
    )
    SELECT
        v_canonical_doc.id,
        v_canonical_doc.student_id,
        1,
        COALESCE(v_canonical_doc.file_hash, md5(COALESCE(v_canonical_doc.image_url, v_canonical_doc.id::text))),
        v_canonical_doc.image_url,
        v_canonical_doc.original_filename,
        v_canonical_doc.uploaded_by,
        v_canonical_doc.created_at
    WHERE NOT EXISTS (
        SELECT 1 FROM public.document_scans
        WHERE document_id = v_canonical_doc.id AND scan_version = 1
    );

    SELECT COALESCE(MAX(scan_version), 1) INTO v_scan_version
    FROM public.document_scans
    WHERE document_id = v_canonical_doc.id;

    v_scan_history := COALESCE(
        v_canonical_doc.extracted_fields->'scan_history',
        jsonb_build_array(
            jsonb_build_object(
                'version', 1,
                'image_url', v_canonical_doc.image_url,
                'original_filename', v_canonical_doc.original_filename,
                'uploaded_by', v_canonical_doc.uploaded_by,
                'uploaded_at', v_canonical_doc.created_at,
                'source_document_id', v_canonical_doc.id
            )
        )
    );

    -- 3. CONSOLIDATE DUPLICATE SCANS & ARCHIVE DUPLICATE RECORDS FOR JUSTIN GOMEZ
    --    Target duplicate documents:
    --    - 4a04de06-2e3b-4397-8bb3-4a6b96beb40e (initial pre-approval upload)
    --    - 983802cc-cdb3-4f56-9c27-1aeb9c215233 (composite duplicate upload)
    --    - f3a40d3b-09ca-4521-9a4e-9e12d32dcf6d (repeat composite duplicate upload)
    --    NOTE: Do NOT overwrite v_canonical_doc.extracted_fields->'grades' or subject_grades!
    FOR v_dup_doc IN
        SELECT id, image_url, file_hash, original_filename, uploaded_by, created_at, extracted_fields
        FROM public.documents
        WHERE id IN (
            '4a04de06-2e3b-4397-8bb3-4a6b96beb40e',
            '983802cc-cdb3-4f56-9c27-1aeb9c215233',
            'f3a40d3b-09ca-4521-9a4e-9e12d32dcf6d'
        ) AND status <> 'archived'
        ORDER BY created_at ASC
    LOOP
        v_scan_version := v_scan_version + 1;

        INSERT INTO public.document_scans (
            document_id, student_id, scan_version, file_hash, image_url, original_filename, uploaded_by, created_at
        ) VALUES (
            v_canonical_doc.id,
            v_canonical_doc.student_id,
            v_scan_version,
            COALESCE(v_dup_doc.file_hash, md5(COALESCE(v_dup_doc.image_url, v_dup_doc.id::text))),
            v_dup_doc.image_url,
            v_dup_doc.original_filename,
            v_dup_doc.uploaded_by,
            v_dup_doc.created_at
        );

        v_scan_history := v_scan_history || jsonb_build_array(
            jsonb_build_object(
                'version', v_scan_version,
                'image_url', v_dup_doc.image_url,
                'original_filename', v_dup_doc.original_filename,
                'uploaded_by', v_dup_doc.uploaded_by,
                'uploaded_at', v_dup_doc.created_at,
                'reconciled_from_document_id', v_dup_doc.id
            )
        );

        UPDATE public.documents
        SET
            student_id = v_canonical_doc.student_id,
            school_year = '2019-2020',
            grade_level = 'Grade 11',
            status = 'archived',
            archived_at = now(),
            archived_by = v_canonical_doc.reviewed_by,
            extracted_fields = jsonb_set(
                COALESCE(extracted_fields, '{}'::jsonb),
                '{consolidation_info}',
                jsonb_build_object(
                    'reconciled_into_canonical_document_id', v_canonical_doc.id,
                    'preserved_scan_version', v_scan_version,
                    'reconciliation_timestamp', now()
                )
            )
        WHERE id = v_dup_doc.id;

        INSERT INTO public.audit_logs (
            request_id, category, action, outcome, actor_user_id, actor_role, school_id,
            target_type, target_id, target_label, reason, details
        ) VALUES (
            gen_random_uuid()::text,
            'DOCUMENT',
            'DOCUMENT_INCREMENTAL_UPDATE',
            'SUCCESS',
            v_canonical_doc.reviewed_by,
            'admin',
            v_canonical_doc.school_id,
            'document',
            v_dup_doc.id::text,
            'SF9 - Duplicate Record Consolidated',
            'Historical duplicate upload consolidated into canonical academic record with physical scan preserved',
            jsonb_build_object(
                'canonical_document_id', v_canonical_doc.id,
                'preserved_scan_version', v_scan_version,
                'student_id', v_canonical_doc.student_id
            )
        );

        v_archived_count := v_archived_count + 1;
    END LOOP;

    -- Persist updated scan_history on canonical document without altering verified grades
    UPDATE public.documents
    SET extracted_fields = jsonb_set(
        COALESCE(extracted_fields, '{}'::jsonb),
        '{scan_history}',
        v_scan_history
    )
    WHERE id = v_canonical_doc.id;

    -- 4. UNLINK KENNETH LATONERO IDENTITY COLLISION (cc8b4c08 & edda579a) FROM JUSTIN GOMEZ
    --    Preserves cc8b4c08 status = 'needs_review' and edda579a status = 'rejected' + review_logs
    FOR v_collision_doc IN
        SELECT id, student_id, status
        FROM public.documents
        WHERE id IN (
            'cc8b4c08-14bb-4c92-9958-d670f878ac29',
            'edda579a-6e1d-4acb-81d8-25d078798ff7'
        )
    LOOP
        UPDATE public.documents
        SET
            student_id = NULL,
            school_year = COALESCE(school_year, '2019-2020'),
            grade_level = COALESCE(grade_level, 'Grade 11'),
            extracted_fields = jsonb_set(
                jsonb_set(
                    jsonb_set(
                        COALESCE(extracted_fields, '{}'::jsonb),
                        '{identity_conflict}',
                        'true'::jsonb
                    ),
                    '{manual_lrn_verification_required}',
                    'true'::jsonb
                ),
                '{collision_reconciliation}',
                jsonb_build_object(
                    'unlinked_from_student_id', '6722d559-440f-4cdc-bd14-e12fad11d836',
                    'action', 'UNLINKED_PENDING_MANUAL_LRN_VERIFICATION',
                    'preserved_status', v_collision_doc.status,
                    'timestamp', now()
                )
            )
        WHERE id = v_collision_doc.id;

        INSERT INTO public.audit_logs (
            request_id, category, action, outcome, actor_user_id, actor_role, school_id,
            target_type, target_id, target_label, reason, details
        ) VALUES (
            gen_random_uuid()::text,
            'DOCUMENT',
            'DOCUMENT_CORRECTED',
            'SUCCESS',
            v_canonical_doc.reviewed_by,
            'admin',
            v_canonical_doc.school_id,
            'document',
            v_collision_doc.id::text,
            'SF9 - Kenneth Latonero Collision Isolated',
            'Unlinked document from Justin Gomez due to LRN identity collision. Requires manual LRN verification.',
            jsonb_build_object(
                'extracted_name', 'Latonero, Kenneth Abad',
                'colliding_lrn', '111304581972',
                'preserved_status', v_collision_doc.status
            )
        );

        v_unlinked_count := v_unlinked_count + 1;
    END LOOP;

    -- 5. POST-FLIGHT INVARIANT ASSERTIONS
    SELECT COUNT(*) INTO v_active_gomez_count
    FROM public.documents
    WHERE student_id = '6722d559-440f-4cdc-bd14-e12fad11d836'
      AND document_type = 'sf9'
      AND school_year = '2019-2020'
      AND grade_level = 'Grade 11'
      AND status NOT IN ('archived', 'rejected');

    IF v_active_gomez_count <> 1 THEN
        RAISE EXCEPTION 'Reconciliation Post-flight Failed: Expected exactly 1 active SF9 for Justin Gomez, found %.', v_active_gomez_count;
    END IF;

    SELECT COUNT(*) INTO v_grades_count
    FROM public.subject_grades
    WHERE document_id = v_canonical_doc.id
      AND student_id = v_canonical_doc.student_id;

    IF v_grades_count <> 18 THEN
        RAISE EXCEPTION 'Reconciliation Post-flight Failed: Expected 18 verified subject_grades on canonical document, found %.', v_grades_count;
    END IF;

    SELECT COUNT(*) INTO v_linked_collision_count
    FROM public.documents
    WHERE id IN ('cc8b4c08-14bb-4c92-9958-d670f878ac29', 'edda579a-6e1d-4acb-81d8-25d078798ff7')
      AND student_id IS NOT NULL;

    IF v_linked_collision_count <> 0 THEN
        RAISE EXCEPTION 'Reconciliation Post-flight Failed: Collision documents are still linked to a student.';
    END IF;

    v_result := jsonb_build_object(
        'status', 'SUCCESS',
        'canonical_document_id', v_canonical_doc.id,
        'archived_duplicates_count', v_archived_count,
        'unlinked_collisions_count', v_unlinked_count,
        'grades_preserved', v_grades_count,
        'scans_preserved', v_scan_version
    );

    RETURN v_result;
END;
$$;

-- Execute historical reconciliation automatically within the migration transaction
-- if the known production canonical document (840dc1c4-a272-444e-9ff4-2faba4b94c0b) is present.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.documents
        WHERE id = '840dc1c4-a272-444e-9ff4-2faba4b94c0b'
          AND status = 'approved'
    ) THEN
        PERFORM public.reconcile_historical_duplicate_documents();
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 8. Enforce Validated Canonical Identity Fields on All Active & Approved Records
-- ------------------------------------------------------------------------------
-- Any record with student_id IS NOT NULL that is active (status NOT IN ('archived', 'rejected'))
-- is missing school_year or grade_level for SF9 must be demoted to staging (student_id = NULL)
-- unless it is 'approved' (which will fail the constraint if invalid).
UPDATE public.documents
SET student_id = NULL
WHERE student_id IS NOT NULL
  AND status NOT IN ('archived', 'rejected', 'approved')
  AND (
      school_id IS NULL
      OR document_type NOT IN ('sf9', 'sf10')
      OR (
          document_type = 'sf9'
          AND (
              school_year IS NULL OR btrim(school_year) = ''
              OR grade_level IS NULL OR btrim(grade_level) = ''
          )
      )
  );

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_canonical_active_fields;
ALTER TABLE public.documents ADD CONSTRAINT chk_documents_canonical_active_fields
    CHECK (
        (
            NOT (student_id IS NOT NULL AND status NOT IN ('archived', 'rejected'))
            OR (
                school_id IS NOT NULL
                AND document_type IN ('sf9', 'sf10')
                AND (
                    document_type <> 'sf9'
                    OR (
                        school_year IS NOT NULL AND btrim(school_year) <> ''
                        AND grade_level IS NOT NULL AND btrim(grade_level) <> ''
                    )
                )
            )
        )
        AND (
            status <> 'approved'
            OR (
                student_id IS NOT NULL
                AND school_id IS NOT NULL
                AND document_type IN ('sf9', 'sf10')
                AND (
                    document_type <> 'sf9'
                    OR (
                        school_year IS NOT NULL AND btrim(school_year) <> ''
                        AND grade_level IS NOT NULL AND btrim(grade_level) <> ''
                    )
                )
            )
        )
    );

-- ------------------------------------------------------------------------------
-- 9. Strictly Enforce Canonical Unique Indexes (Never Silently Skip)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    dup_active_sf9_stu_count integer;
    dup_active_sf10_stu_count integer;
    dup_staging_hash_count integer;
BEGIN
    -- Preflight Check 1: Duplicate active SF9 by (school_id, student_id, document_type, school_year, grade_level)
    SELECT COUNT(*) INTO dup_active_sf9_stu_count
    FROM (
        SELECT school_id, student_id, document_type, school_year, grade_level
        FROM public.documents
        WHERE status NOT IN ('archived', 'rejected')
          AND document_type = 'sf9'
          AND student_id IS NOT NULL
        GROUP BY school_id, student_id, document_type, school_year, grade_level
        HAVING COUNT(*) > 1
    ) dups;

    IF dup_active_sf9_stu_count > 0 THEN
        RAISE EXCEPTION 'Migration 021 Pre-flight Blocked: Found % duplicate active SF9 group(s) by (school_id, student_id, document_type, school_year, grade_level).', dup_active_sf9_stu_count;
    END IF;

    -- Preflight Check 2: Duplicate active SF10 by (school_id, student_id, document_type)
    SELECT COUNT(*) INTO dup_active_sf10_stu_count
    FROM (
        SELECT school_id, student_id, document_type
        FROM public.documents
        WHERE status NOT IN ('archived', 'rejected')
          AND document_type = 'sf10'
          AND student_id IS NOT NULL
        GROUP BY school_id, student_id, document_type
        HAVING COUNT(*) > 1
    ) dups;

    IF dup_active_sf10_stu_count > 0 THEN
        RAISE EXCEPTION 'Migration 021 Pre-flight Blocked: Found % duplicate active SF10 group(s) by (school_id, student_id, document_type).', dup_active_sf10_stu_count;
    END IF;

    -- Preflight Check 3: Duplicate active staging records by (school_id, document_type, file_hash)
    SELECT COUNT(*) INTO dup_staging_hash_count
    FROM (
        SELECT school_id, document_type, file_hash
        FROM public.documents
        WHERE status NOT IN ('archived', 'rejected')
          AND student_id IS NULL
          AND file_hash IS NOT NULL
        GROUP BY school_id, document_type, file_hash
        HAVING COUNT(*) > 1
    ) dups;

    IF dup_staging_hash_count > 0 THEN
        RAISE EXCEPTION 'Migration 021 Pre-flight Blocked: Found % duplicate active staging group(s) by (school_id, document_type, file_hash).', dup_staging_hash_count;
    END IF;

    -- Drop any legacy/intermediate index names
    DROP INDEX IF EXISTS public.idx_documents_canonical_sf9_student_active;
    DROP INDEX IF EXISTS public.idx_documents_unresolved_file_hash_active;
    DROP INDEX IF EXISTS public.idx_documents_canonical_active_record;

    -- Create Unique Index 1: Canonical SF9 Academic Identity
    -- Strictly matches documented identity: (school_id, student_id, document_type, school_year, grade_level)
    DROP INDEX IF EXISTS public.idx_documents_canonical_sf9_active;
    CREATE UNIQUE INDEX idx_documents_canonical_sf9_active
        ON public.documents (school_id, student_id, document_type, school_year, grade_level)
        WHERE status NOT IN ('archived', 'rejected')
          AND document_type = 'sf9'
          AND student_id IS NOT NULL;

    -- Create Unique Index 2: Canonical SF10 Permanent Record Identity
    -- Strictly matches documented identity: (school_id, student_id, document_type)
    DROP INDEX IF EXISTS public.idx_documents_canonical_sf10_active;
    CREATE UNIQUE INDEX idx_documents_canonical_sf10_active
        ON public.documents (school_id, student_id, document_type)
        WHERE status NOT IN ('archived', 'rejected')
          AND document_type = 'sf10'
          AND student_id IS NOT NULL;

    -- Create Unique Index 3: Active Staging Record File Hash Deduplication (when student_id IS NULL)
    DROP INDEX IF EXISTS public.idx_documents_staging_file_hash_active;
    CREATE UNIQUE INDEX idx_documents_staging_file_hash_active
        ON public.documents (school_id, document_type, file_hash)
        WHERE status NOT IN ('archived', 'rejected')
          AND student_id IS NULL
          AND file_hash IS NOT NULL;

    -- Verify all unique indexes exist and are active in pg_indexes
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_documents_canonical_sf9_active'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_documents_canonical_sf10_active'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_documents_staging_file_hash_active'
    ) THEN
        RAISE EXCEPTION 'Migration 021 Verification Failed: Required canonical unique indexes were not installed.';
    END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

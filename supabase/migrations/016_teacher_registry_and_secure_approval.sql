-- ==============================================================================
-- Migration 016: Teacher Registry, Registration Verification, and Secure Approval
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 300792
-- ==============================================================================
-- 
-- Objectives:
-- 1. Create public.school_teacher_registry table for authoritative teacher roster.
-- 2. Add non-destructive registration tracking columns to public.user_roles.
-- 3. Configure strict Row Level Security (RLS) guaranteeing administrator-only management.
-- 4. Seed the eight (8) preliminary TRIS teacher roster entries idempotently.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. CREATE school_teacher_registry TABLE
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_teacher_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    first_name TEXT NOT NULL,
    middle_initial VARCHAR(1) CHECK (middle_initial IS NULL OR middle_initial ~ '^[A-Za-z]$'),
    last_name TEXT NOT NULL,
    full_name_original TEXT,
    verified_email TEXT CHECK (verified_email IS NULL OR verified_email ~* '^[A-Za-z0-9._%+-]+@gmail\.com$'),
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'inactive')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    linked_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint ensuring an active auth user is linked to at most one registry record
CREATE UNIQUE INDEX IF NOT EXISTS uq_registry_linked_user
ON public.school_teacher_registry (linked_user_id)
WHERE linked_user_id IS NOT NULL;

-- Fast search and deduplication indexes
CREATE INDEX IF NOT EXISTS idx_registry_school_names
ON public.school_teacher_registry (school_id, LOWER(last_name), LOWER(first_name));

CREATE INDEX IF NOT EXISTS idx_registry_verified_email
ON public.school_teacher_registry (LOWER(verified_email))
WHERE verified_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_registry_verification_status
ON public.school_teacher_registry (verification_status, is_active);

-- ------------------------------------------------------------------------------
-- 2. EXTEND public.user_roles WITH REGISTRATION LIFECYCLE COLUMNS
-- ------------------------------------------------------------------------------

ALTER TABLE public.user_roles
    ADD COLUMN IF NOT EXISTS registration_timestamp TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS review_eligibility_time TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours'),
    ADD COLUMN IF NOT EXISTS registry_match_status TEXT DEFAULT 'PENDING'
        CHECK (registry_match_status IN (
            'MATCHED', 'NOT_FOUND', 'AMBIGUOUS', 'REVIEW_REQUIRED',
            'DUPLICATE_CLAIM', 'INACTIVE_REGISTRY_ENTRY', 'PENDING'
        )),
    ADD COLUMN IF NOT EXISTS matched_registry_id UUID REFERENCES public.school_teacher_registry(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approval_method TEXT
        CHECK (approval_method IS NULL OR approval_method IN ('MANUAL_EARLY', 'AUTOMATIC', 'MANUAL_STANDARD')),
    ADD COLUMN IF NOT EXISTS approval_reason TEXT,
    ADD COLUMN IF NOT EXISTS decline_reason TEXT,
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS declined_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS middle_name TEXT,
    ADD COLUMN IF NOT EXISTS middle_initial VARCHAR(1),
    ADD COLUMN IF NOT EXISTS has_no_middle_name BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_user_roles_eligibility
ON public.user_roles (account_status, review_eligibility_time)
WHERE account_status = 'Pending';

CREATE INDEX IF NOT EXISTS idx_user_roles_matched_registry
ON public.user_roles (matched_registry_id)
WHERE matched_registry_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. ENABLE ROW LEVEL SECURITY (RLS) FOR school_teacher_registry
-- ------------------------------------------------------------------------------

ALTER TABLE public.school_teacher_registry ENABLE ROW LEVEL SECURITY;

-- Policy: Only approved administrators and service_role can view teacher registry
DROP POLICY IF EXISTS "Admins can view teacher registry" ON public.school_teacher_registry;
CREATE POLICY "Admins can view teacher registry"
ON public.school_teacher_registry FOR SELECT
TO authenticated
USING (
    auth.role() = 'service_role' OR
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'admin'
          AND ur.account_status = 'Approved'
          AND (ur.school_id IS NULL OR ur.school_id = school_teacher_registry.school_id)
    )
);

-- Policy: Only approved administrators can insert teacher registry records
DROP POLICY IF EXISTS "Admins can insert teacher registry" ON public.school_teacher_registry;
CREATE POLICY "Admins can insert teacher registry"
ON public.school_teacher_registry FOR INSERT
TO authenticated
WITH CHECK (
    auth.role() = 'service_role' OR
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'admin'
          AND ur.account_status = 'Approved'
          AND (ur.school_id IS NULL OR ur.school_id = school_teacher_registry.school_id)
    )
);

-- Policy: Only approved administrators can update teacher registry records
DROP POLICY IF EXISTS "Admins can update teacher registry" ON public.school_teacher_registry;
CREATE POLICY "Admins can update teacher registry"
ON public.school_teacher_registry FOR UPDATE
TO authenticated
USING (
    auth.role() = 'service_role' OR
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'admin'
          AND ur.account_status = 'Approved'
          AND (ur.school_id IS NULL OR ur.school_id = school_teacher_registry.school_id)
    )
)
WITH CHECK (
    auth.role() = 'service_role' OR
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'admin'
          AND ur.account_status = 'Approved'
          AND (ur.school_id IS NULL OR ur.school_id = school_teacher_registry.school_id)
    )
);

-- Policy: Only approved administrators can delete teacher registry records
DROP POLICY IF EXISTS "Admins can delete teacher registry" ON public.school_teacher_registry;
CREATE POLICY "Admins can delete teacher registry"
ON public.school_teacher_registry FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'admin'
          AND ur.account_status = 'Approved'
          AND (ur.school_id IS NULL OR ur.school_id = school_teacher_registry.school_id)
    )
);

-- ------------------------------------------------------------------------------
-- 4. IDEMPOTENT SEED OF THE EIGHT (8) INITIAL TRIS TEACHER ROSTER RECORDS
-- ------------------------------------------------------------------------------
-- Preliminary unverified roster entries for Taysan Resettlement Integrated School
-- UUID: a0000000-0000-0000-0000-000000000001 (School ID: 300792)
-- Unknown middle initials remain NULL.
-- No login accounts are created.
-- All records are marked as 'unverified'.
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    tris_school_uuid UUID := 'a0000000-0000-0000-0000-000000000001'::uuid;
BEGIN
    -- Verify TRIS exists in schools table
    IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = tris_school_uuid) THEN
        INSERT INTO public.schools (id, school_id, name, division, region, is_active)
        VALUES (tris_school_uuid, '300792', 'Taysan Resettlement Integrated School', 'Legazpi City', 'Region V', true)
        ON CONFLICT (id) DO NOTHING;
    END IF;

    -- 1. Arnold A. Reodique
    IF NOT EXISTS (
        SELECT 1 FROM public.school_teacher_registry 
        WHERE school_id = tris_school_uuid AND LOWER(first_name) = 'arnold' AND LOWER(last_name) = 'reodique'
    ) THEN
        INSERT INTO public.school_teacher_registry (school_id, first_name, middle_initial, last_name, full_name_original, verification_status, is_active)
        VALUES (tris_school_uuid, 'Arnold', 'A', 'Reodique', 'Arnold A. Reodique', 'unverified', true);
    END IF;

    -- 2. Estrella S. Babael
    IF NOT EXISTS (
        SELECT 1 FROM public.school_teacher_registry 
        WHERE school_id = tris_school_uuid AND LOWER(first_name) = 'estrella' AND LOWER(last_name) = 'babael'
    ) THEN
        INSERT INTO public.school_teacher_registry (school_id, first_name, middle_initial, last_name, full_name_original, verification_status, is_active)
        VALUES (tris_school_uuid, 'Estrella', 'S', 'Babael', 'Estrella S. Babael', 'unverified', true);
    END IF;

    -- 3. Rachel C. Nale
    IF NOT EXISTS (
        SELECT 1 FROM public.school_teacher_registry 
        WHERE school_id = tris_school_uuid AND LOWER(first_name) = 'rachel' AND LOWER(last_name) = 'nale'
    ) THEN
        INSERT INTO public.school_teacher_registry (school_id, first_name, middle_initial, last_name, full_name_original, verification_status, is_active)
        VALUES (tris_school_uuid, 'Rachel', 'C', 'Nale', 'Rachel C. Nale', 'unverified', true);
    END IF;

    -- 4. Wilson D. Rosales
    IF NOT EXISTS (
        SELECT 1 FROM public.school_teacher_registry 
        WHERE school_id = tris_school_uuid AND LOWER(first_name) = 'wilson' AND LOWER(last_name) = 'rosales'
    ) THEN
        INSERT INTO public.school_teacher_registry (school_id, first_name, middle_initial, last_name, full_name_original, verification_status, is_active)
        VALUES (tris_school_uuid, 'Wilson', 'D', 'Rosales', 'Wilson D. Rosales', 'unverified', true);
    END IF;

    -- 5. Deirek Alzaga (No Middle Initial)
    IF NOT EXISTS (
        SELECT 1 FROM public.school_teacher_registry 
        WHERE school_id = tris_school_uuid AND LOWER(first_name) = 'deirek' AND LOWER(last_name) = 'alzaga'
    ) THEN
        INSERT INTO public.school_teacher_registry (school_id, first_name, middle_initial, last_name, full_name_original, verification_status, is_active)
        VALUES (tris_school_uuid, 'Deirek', NULL, 'Alzaga', 'Deirek Alzaga', 'unverified', true);
    END IF;

    -- 6. Charlie N. Rivero
    IF NOT EXISTS (
        SELECT 1 FROM public.school_teacher_registry 
        WHERE school_id = tris_school_uuid AND LOWER(first_name) = 'charlie' AND LOWER(last_name) = 'rivero'
    ) THEN
        INSERT INTO public.school_teacher_registry (school_id, first_name, middle_initial, last_name, full_name_original, verification_status, is_active)
        VALUES (tris_school_uuid, 'Charlie', 'N', 'Rivero', 'Charlie N. Rivero', 'unverified', true);
    END IF;

    -- 7. Margie Ajero (No Middle Initial)
    IF NOT EXISTS (
        SELECT 1 FROM public.school_teacher_registry 
        WHERE school_id = tris_school_uuid AND LOWER(first_name) = 'margie' AND LOWER(last_name) = 'ajero'
    ) THEN
        INSERT INTO public.school_teacher_registry (school_id, first_name, middle_initial, last_name, full_name_original, verification_status, is_active)
        VALUES (tris_school_uuid, 'Margie', NULL, 'Ajero', 'Margie Ajero', 'unverified', true);
    END IF;

    -- 8. Blessila Theresa M. Sia (Multiple Given Names)
    IF NOT EXISTS (
        SELECT 1 FROM public.school_teacher_registry 
        WHERE school_id = tris_school_uuid AND LOWER(first_name) = 'blessila theresa' AND LOWER(last_name) = 'sia'
    ) THEN
        INSERT INTO public.school_teacher_registry (school_id, first_name, middle_initial, last_name, full_name_original, verification_status, is_active)
        VALUES (tris_school_uuid, 'Blessila Theresa', 'M', 'Sia', 'Blessila Theresa M. Sia', 'unverified', true);
    END IF;

END $$;

COMMIT;

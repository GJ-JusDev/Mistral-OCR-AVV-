-- ==============================================================================
-- Migration 030: Add Requested Advisory Class Columns to public.user_roles
-- ==============================================================================
-- Purpose:
--   Stores a teacher applicant's requested advisory class (grade level, strand,
--   section, status, and submission timestamp) separately from approved active
--   rows in public.teacher_assignments.
--
-- Safety & Data Integrity Guarantees:
--   1. Nullable defaults (DEFAULT NULL) ensure existing Admin, Principal, and
--      unrelated Teacher rows (as well as skeleton rows inserted by the
--      on_auth_user_created trigger) are NOT polluted with fake 'Pending'
--      advisory requests or migration-time timestamps.
--   2. Strict CHECK constraints limit requested_grade_level to ('Grade 11', 'Grade 12')
--      and requested_strand to ('CSS', 'HUMSS', 'Tourism') — no STEM default or fallback.
--   3. Section length/format constraint requires 2-50 trimmed characters matching
--      valid alphanumeric/punctuation section names when present.
--   4. Group completeness constraint guarantees that either all five requested
--      advisory columns are NULL (no advisory request) or all five are populated.
-- ==============================================================================

BEGIN;

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS requested_grade_level TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS requested_strand TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS requested_section TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS request_status TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS request_submitted_at TIMESTAMPTZ DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_user_roles_requested_grade_level'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT chk_user_roles_requested_grade_level
      CHECK (
        requested_grade_level IS NULL
        OR requested_grade_level IN ('Grade 11', 'Grade 12')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_user_roles_requested_strand'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT chk_user_roles_requested_strand
      CHECK (
        requested_strand IS NULL
        OR requested_strand IN ('CSS', 'HUMSS', 'Tourism')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_user_roles_requested_section'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT chk_user_roles_requested_section
      CHECK (
        requested_section IS NULL
        OR (
          char_length(btrim(requested_section)) BETWEEN 2 AND 50
          AND btrim(requested_section) ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*$'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_user_roles_request_status'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT chk_user_roles_request_status
      CHECK (
        request_status IS NULL
        OR request_status IN ('Pending', 'Approved', 'Declined')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_user_roles_advisory_request_completeness'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT chk_user_roles_advisory_request_completeness
      CHECK (
        (
          requested_grade_level IS NULL
          AND requested_strand IS NULL
          AND requested_section IS NULL
          AND request_status IS NULL
          AND request_submitted_at IS NULL
        )
        OR (
          requested_grade_level IS NOT NULL
          AND requested_strand IS NOT NULL
          AND requested_section IS NOT NULL
          AND request_status IS NOT NULL
          AND request_submitted_at IS NOT NULL
        )
      );
  END IF;
END $$;

COMMIT;

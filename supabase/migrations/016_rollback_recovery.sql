-- ==============================================================================
-- Migration 016 Rollback Recovery: Revert Teacher Registry and Extended Columns
-- ==============================================================================

BEGIN;

DROP TABLE IF EXISTS public.school_teacher_registry CASCADE;

ALTER TABLE public.user_roles
    DROP COLUMN IF EXISTS registration_timestamp,
    DROP COLUMN IF EXISTS review_eligibility_time,
    DROP COLUMN IF EXISTS registry_match_status,
    DROP COLUMN IF EXISTS matched_registry_id,
    DROP COLUMN IF EXISTS approval_method,
    DROP COLUMN IF EXISTS approval_reason,
    DROP COLUMN IF EXISTS decline_reason,
    DROP COLUMN IF EXISTS approved_by,
    DROP COLUMN IF EXISTS approved_at,
    DROP COLUMN IF EXISTS declined_by,
    DROP COLUMN IF EXISTS declined_at,
    DROP COLUMN IF EXISTS middle_name,
    DROP COLUMN IF EXISTS middle_initial,
    DROP COLUMN IF EXISTS has_no_middle_name;

COMMIT;

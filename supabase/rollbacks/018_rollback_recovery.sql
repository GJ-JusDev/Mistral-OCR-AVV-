-- ==============================================================================
-- Migration 018 Rollback Recovery: Revert Review Queue Direct Deletion
-- WARNING (DESTRUCTIVE):
--   1. Drops columns public.documents.archived_by and public.documents.archived_at.
--   2. Reverts any rows with status = 'archived' back to status = 'needs_review'
--      so that re-adding the pre-018 documents_status_check constraint does not
--      fail with SQLSTATE 23514 (check_violation).
--   3. Must ONLY be executed AFTER rolling back Migration 021 (021_rollback_recovery.sql),
--      otherwise un-archiving duplicate documents will violate Migration 021's
--      partial unique indexes (SQLSTATE 23505).
-- ==============================================================================

BEGIN;

-- Drop function signatures (both hardened 2-arg and legacy 3-arg if present)
DROP FUNCTION IF EXISTS public.archive_review_document(UUID, TEXT);
DROP FUNCTION IF EXISTS public.archive_review_document(UUID, TEXT, UUID);

DROP INDEX IF EXISTS public.idx_documents_archived_by;
DROP INDEX IF EXISTS public.idx_documents_archived_at;

-- Transition any archived documents back to 'needs_review' before tightening status constraint
UPDATE public.documents
SET status = 'needs_review',
    updated_at = now()
WHERE status = 'archived';

ALTER TABLE public.documents DROP COLUMN IF EXISTS archived_by;
ALTER TABLE public.documents DROP COLUMN IF EXISTS archived_at;

-- Revert status constraint to pre-018 definition
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_status_check 
    CHECK (status IN ('submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected'));

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;

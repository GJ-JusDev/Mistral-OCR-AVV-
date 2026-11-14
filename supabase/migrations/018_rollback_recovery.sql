-- ==============================================================================
-- Migration 018 Rollback Recovery: Revert Review Queue Direct Deletion
-- ==============================================================================

BEGIN;

-- Drop function signatures (both hardened 2-arg and legacy 3-arg if present)
DROP FUNCTION IF EXISTS public.archive_review_document(UUID, TEXT);
DROP FUNCTION IF EXISTS public.archive_review_document(UUID, TEXT, UUID);

DROP INDEX IF EXISTS public.idx_documents_archived_by;
DROP INDEX IF EXISTS public.idx_documents_archived_at;

ALTER TABLE public.documents DROP COLUMN IF EXISTS archived_by;
ALTER TABLE public.documents DROP COLUMN IF EXISTS archived_at;

-- Revert status constraint to pre-018 definition
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_status_check 
    CHECK (status IN ('submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected'));

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;

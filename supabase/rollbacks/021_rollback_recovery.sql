-- ==============================================================================
-- ROLLBACK RECOVERY: MIGRATION 021
-- Reverts canonical academic record unique indexes, helper functions, and constraints.
-- NOTE: Non-destructive to public.document_scans rows and public.documents columns
-- (school_year, grade_level, file_hash, canonical_lrn) to preserve scan evidence.
-- ==============================================================================

BEGIN;

DROP INDEX IF EXISTS public.idx_documents_canonical_sf9_active;
DROP INDEX IF EXISTS public.idx_documents_canonical_sf9_student_active;
DROP INDEX IF EXISTS public.idx_documents_canonical_sf10_active;
DROP INDEX IF EXISTS public.idx_documents_staging_file_hash_active;
DROP INDEX IF EXISTS public.idx_documents_unresolved_file_hash_active;
DROP INDEX IF EXISTS public.idx_documents_canonical_active_record;

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS chk_documents_canonical_active_fields;

DROP FUNCTION IF EXISTS public.enforce_canonical_document_unique_indexes();
DROP FUNCTION IF EXISTS public.reconcile_historical_duplicate_documents();
DROP FUNCTION IF EXISTS public.resolve_document_identity_conflict(uuid, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.record_incremental_document_update(uuid, uuid, jsonb, text, text, text, text, text, integer, text[], boolean, text);
DROP FUNCTION IF EXISTS public.acquire_canonical_document_lock(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.normalize_shs_grade_level(text);

NOTIFY pgrst, 'reload schema';

COMMIT;

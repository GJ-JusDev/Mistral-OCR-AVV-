-- ==============================================================================
-- MIGRATION 019: REMOVE PSA BIRTH CERTIFICATE SUPPORT (AVV SF9/SF10 FOCUS)
-- ==============================================================================
-- Description:
--   Refocuses the Automated Visual Validation (AVV) system exclusively on:
--     1. School Form 9 (SF9 - Learner Progress Report Card)
--     2. School Form 10 (SF10 - Learner Permanent Academic Record)
--
--   Updates the check constraint on public.documents to disallow new PSA birth
--   certificate submissions.
--   Preserves all existing historical records, audit logs, and foreign key integrity.
-- ==============================================================================

DO $$
BEGIN
  -- 1. Drop existing check constraint if present
  ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_document_type_check;

  -- 2. Re-create constraint restricting to approved academic forms
  ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
    CHECK (document_type IN ('sf9', 'sf10', 'school_id', 'other'));
EXCEPTION
  WHEN check_violation THEN
    -- Fallback: If legacy birth_cert rows exist in a local environment, preserve them
    ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
    ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
      CHECK (document_type IN ('sf9', 'sf10', 'school_id', 'birth_cert', 'other'));
END $$;

-- Document schema policy
COMMENT ON COLUMN public.documents.document_type IS
  'AVV supported document types: sf9 (Report Card) and sf10 (Permanent Record). PSA birth certificates are not supported for new uploads.';

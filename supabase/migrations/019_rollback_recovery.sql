-- ==============================================================================
-- ROLLBACK 019: RESTORE PSA SUPPORT CHECK CONSTRAINT
-- ==============================================================================

DO $$
BEGIN
  ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_document_type_check;
  ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
    CHECK (document_type IN ('sf9', 'sf10', 'school_id', 'birth_cert', 'other'));
END $$;

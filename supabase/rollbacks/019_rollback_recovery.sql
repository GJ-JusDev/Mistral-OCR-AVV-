-- ==============================================================================
-- ROLLBACK 019: RESTORE PREVIOUS CHECK CONSTRAINT
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop existing constraint(s) on document_type
  FOR r IN (
    SELECT DISTINCT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE con.conrelid = 'public.documents'::regclass
      AND con.contype = 'c'
      AND att.attname = 'document_type'
  ) LOOP
    EXECUTE format('ALTER TABLE public.documents DROP CONSTRAINT %I;', r.conname);
  END LOOP;

  -- Restore previous constraint from 001
  ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
    CHECK (document_type IN ('sf9', 'sf10', 'school_id', 'birth_cert', 'other'));
END $$;

COMMENT ON COLUMN public.documents.document_type IS
  'AVV document types (restored prior check constraint).';

COMMIT;

-- ==============================================================================
-- MIGRATION 019: RESTRICT DOCUMENT TYPES TO SF9 AND SF10 (REMOVE PSA & UNUSED TYPES)
-- ==============================================================================
-- Objectives:
--   1. Refocus the Automated Visual Validation (AVV) system exclusively on:
--      - School Form 9 (SF9 - Learner Progress Report Card)
--      - School Form 10 (SF10 - Learner Permanent Academic Record)
--   2. Check public.documents for existing document_type values outside ('sf9', 'sf10')
--      BEFORE altering constraints.
--   3. If unsupported records exist, abort the transaction safely with an explicit error.
--      Do NOT delete, modify, or silently permit those records.
--   4. Ensure the migration runs atomically (BEGIN ... COMMIT). Failures cannot leave
--      the database with a missing or weakened constraint.
--   5. Inspect and remove any conflicting or redundant check constraints on
--      public.documents.document_type.
--   6. Enforce strict final constraint: CHECK (document_type IN ('sf9', 'sf10')).
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_unsupported_count INTEGER;
  v_unsupported_types TEXT;
  r RECORD;
BEGIN
  -- 1. Check public.documents for existing document_type values outside ('sf9', 'sf10')
  SELECT COUNT(*), string_agg(DISTINCT quote_literal(document_type), ', ')
  INTO v_unsupported_count, v_unsupported_types
  FROM public.documents
  WHERE document_type IS NULL OR document_type NOT IN ('sf9', 'sf10');

  IF v_unsupported_count > 0 THEN
    RAISE EXCEPTION 'Migration 019 Aborted: Found % unsupported record(s) in public.documents with type(s): [%]. All records must be valid SF9 or SF10 documents before restricting constraints. No modifications were made.',
      v_unsupported_count, v_unsupported_types;
  END IF;

  -- 2. Inspect and drop all existing CHECK constraints on public.documents.document_type
  -- to avoid leaving conflicting, redundant, or stale constraints
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

  -- 3. Re-create constraint strictly restricting to approved academic forms: sf9 and sf10
  ALTER TABLE public.documents ADD CONSTRAINT documents_document_type_check
    CHECK (document_type IN ('sf9', 'sf10'));

END $$;

-- 4. Document schema policy
COMMENT ON COLUMN public.documents.document_type IS
  'AVV supported academic document types: sf9 (Report Card) and sf10 (Permanent Record). Only SF9 and SF10 are supported for processing.';

COMMIT;

-- ==============================================================================
-- Migration 017 Rollback Recovery: Revert TRIS DepEd School ID
-- Target Institution: Taysan Resettlement Integrated School (TRIS)
-- Rollback DepEd School ID: 500169 -> 300792
-- ==============================================================================

BEGIN;

UPDATE public.schools
SET school_id = '300792'
WHERE (id = 'a0000000-0000-0000-0000-000000000001'::uuid OR school_id = '500169');

UPDATE public.documents
SET extracted_fields = jsonb_set(extracted_fields, '{school_id}', '"300792"')
WHERE extracted_fields->>'school_id' = '500169';

UPDATE public.documents
SET extracted_fields = jsonb_set(extracted_fields, '{ocr_extracted_school_id}', '"300792"')
WHERE extracted_fields->>'ocr_extracted_school_id' = '500169';

COMMIT;

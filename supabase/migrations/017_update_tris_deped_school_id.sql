-- ==============================================================================
-- Migration 017: Correct Taysan Resettlement Integrated School (TRIS) DepEd School ID
-- Target Institution: Taysan Resettlement Integrated School (TRIS)
-- Correct DepEd School ID: 500169 (Replaces legacy/placeholder ID: 300792)
-- Internal Primary Key: a0000000-0000-0000-0000-000000000001 (UUID preserved)
-- ==============================================================================
-- Safety Invariants:
-- 1. Preserves existing internal UUID primary key ('a0000000-0000-0000-0000-000000000001').
-- 2. Preserves all foreign key relationships (students, documents, user_roles, registry).
-- 3. Updates public.schools.school_id to '500169'.
-- 4. Updates public.documents.extracted_fields JSONB metadata where school_id = '300792' to '500169'.
-- 5. Safe, idempotent, and non-destructive.
-- ==============================================================================

BEGIN;

-- 1. Update public.schools for TRIS
UPDATE public.schools
SET school_id = '500169'
WHERE (id = 'a0000000-0000-0000-0000-000000000001'::uuid OR school_id = '300792')
  AND school_id IS DISTINCT FROM '500169';

-- 2. Update public.documents extracted_fields metadata for TRIS
UPDATE public.documents
SET extracted_fields = jsonb_set(extracted_fields, '{school_id}', '"500169"')
WHERE extracted_fields->>'school_id' = '300792';

UPDATE public.documents
SET extracted_fields = jsonb_set(extracted_fields, '{ocr_extracted_school_id}', '"500169"')
WHERE extracted_fields->>'ocr_extracted_school_id' = '300792';

COMMIT;

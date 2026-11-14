-- ==============================================================================
-- Migration 021 — Phase 021-C: Canonical Unique Index Enforcement
-- ==============================================================================
-- Refactored from supabase/archive/021_canonical_academic_records_and_scan_versions.original.sql
-- Prerequisite: Phase 021-A and Phase 021-B (reconcile_historical_duplicate_documents)
-- completed and verified with 0 remaining active duplicate groups.
-- Effect:
--   Enforces all 4 partial unique indexes on public.documents:
--     1. idx_documents_canonical_sf9_active
--     2. idx_documents_canonical_sf9_student_active
--     3. idx_documents_canonical_sf10_active
--     4. idx_documents_unresolved_file_hash_active
-- ==============================================================================

SELECT public.enforce_canonical_document_unique_indexes() AS result;

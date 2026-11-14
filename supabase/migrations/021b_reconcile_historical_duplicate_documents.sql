-- ==============================================================================
-- Migration 021 — Phase 021-B: Explicit Historical Duplicate Reconciliation
-- ==============================================================================
-- Refactored from supabase/archive/021_canonical_academic_records_and_scan_versions.original.sql
-- Prerequisite: Phase 021-A (021a_schema_triggers_backfill_and_functions.sql) committed.
-- Effect:
--   1. Verifies canonical approved Justin Gomez record 840dc1c4 and its 18 subject_grades.
--   2. Preserves all 4 Justin Gomez scan images in public.document_scans.
--   3. Archives duplicate Justin Gomez SF9 records (4a04de06, 983802cc, f3a40d3b).
--   4. Unlinks Kenneth Latonero identity-collision documents (cc8b4c08, edda579a)
--      by keeping student_id = NULL and lrn_conflict_verified = false.
-- ==============================================================================

SELECT public.reconcile_historical_duplicate_documents() AS result;

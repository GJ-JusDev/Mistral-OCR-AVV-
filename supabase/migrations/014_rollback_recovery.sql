-- ============================================================================
-- Migration 014 Rollback: Revert Complete Admin Audit Logs & Activity Monitoring
-- ============================================================================
-- Purpose:
--   Safely reverts Migration 014 changes back to Migration 013 state without
--   data corruption or dropping pre-existing core tables.
-- ============================================================================

BEGIN;

-- 1. Drop audit triggers on operational tables
DROP TRIGGER IF EXISTS trg_audit_eligibility_decision ON public.eligibility_approvals;
DROP TRIGGER IF EXISTS trg_audit_document_decision ON public.documents;
DROP TRIGGER IF EXISTS trg_audit_user_roles_transition ON public.user_roles;

-- 2. Drop audit trigger functions
DROP FUNCTION IF EXISTS public.process_audit_eligibility_decision();
DROP FUNCTION IF EXISTS public.process_audit_document_decision();
DROP FUNCTION IF EXISTS public.process_audit_user_roles_transition();

-- 3. Drop immutability trigger and function on audit_logs
DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
DROP FUNCTION IF EXISTS public.prevent_audit_log_modification();

-- 4. Drop helper function for recording audit events
DROP FUNCTION IF EXISTS public.record_audit_event(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB, TEXT, TEXT, TEXT, TEXT
);

-- 5. Drop audit_logs table and all associated indexes & RLS policies
DROP TABLE IF EXISTS public.audit_logs CASCADE;

-- 6. Revert tracking columns added to core operational tables
DO $$
BEGIN
    IF to_regclass('public.eligibility_approvals') IS NOT NULL THEN
        ALTER TABLE public.eligibility_approvals DROP COLUMN IF EXISTS last_operation_id;
    END IF;
END $$;

ALTER TABLE public.documents 
    DROP COLUMN IF EXISTS last_operation_id,
    DROP COLUMN IF EXISTS reviewed_by;

ALTER TABLE public.user_roles 
    DROP COLUMN IF EXISTS last_operation_id,
    DROP COLUMN IF EXISTS updated_by;

COMMIT;

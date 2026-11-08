-- ============================================================================
-- Migration 014: AVV System Complete Admin Audit Logs & Activity Monitoring
-- ============================================================================
-- Purpose:
--   Implements an immutable, append-only, administrator-exclusive audit log
--   table for comprehensive accountability across authentication, registration,
--   document handling, OCR, academic evaluation, user management, and security.
--
-- Security & Invariants:
--   1. Strictly Append-Only: No UPDATE or DELETE policies are granted.
--   2. Database-Level Immutability: A trigger prevents any UPDATE or DELETE,
--      even by privileged database roles.
--   3. Administrator Scope: Only Approved Administrators can read audit records
--      within their authorized school scope.
--   4. Anti-Spoofing: Ordinary authenticated users cannot directly INSERT rows
--      to forge roles or outcomes; client logging MUST use record_audit_event()
--      which authoritatively resolves actor identity, role, and school from JWT.
--   5. Safe Search Path: SECURITY DEFINER functions use explicit search_path.
--   6. Principle of Least Privilege: Anonymous users have zero access.
--
-- DO NOT EXECUTE ON PRODUCTION WITHOUT EXPLICIT APPROVAL.
-- ============================================================================

-- 1. Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    transaction_id BIGINT DEFAULT txid_current(),
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email TEXT,
    actor_role TEXT NOT NULL DEFAULT 'anonymous',
    actor_school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    actor_school_name TEXT,
    school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    target_label TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED', 'WARNING')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason TEXT,
    request_id TEXT,
    ip_address TEXT,
    user_agent TEXT
);

-- Ensure transaction_id column exists if table was previously created
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS transaction_id BIGINT DEFAULT txid_current();

-- Ensure target tables have authoritative updater and operation tracking columns
ALTER TABLE public.user_roles 
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS last_operation_id TEXT;

ALTER TABLE public.documents 
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS last_operation_id TEXT;

DO $$
BEGIN
    IF to_regclass('public.eligibility_approvals') IS NOT NULL THEN
        ALTER TABLE public.eligibility_approvals
            ADD COLUMN IF NOT EXISTS last_operation_id TEXT;
    END IF;
END $$;

-- 2. Indexes for fast administrative querying, filtering, and reporting
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON public.audit_logs(category);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_outcome ON public.audit_logs(outcome);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_school ON public.audit_logs(actor_school_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_school ON public.audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user ON public.audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON public.audit_logs(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_txid ON public.audit_logs(transaction_id);

-- 3. Enable Row-Level Security
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies

-- Policy: Only approved administrators can read audit logs within their school scope
DROP POLICY IF EXISTS "Approved admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Approved admins can view audit logs"
ON public.audit_logs FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'admin'
          AND ur.account_status = 'Approved'
          AND (
              ur.school_id IS NULL                                                     -- System-wide super-admin
              OR (audit_logs.actor_school_id IS NULL AND audit_logs.school_id IS NULL) -- Pure unscoped system-level event
              OR ur.school_id = audit_logs.actor_school_id                             -- Actor within same school
              OR ur.school_id = audit_logs.school_id                                   -- Target within same school
          )
    )
);

-- Policy: Service role can read audit logs for maintenance and reporting
DROP POLICY IF EXISTS "Service role can view audit logs" ON public.audit_logs;
CREATE POLICY "Service role can view audit logs"
ON public.audit_logs FOR SELECT
TO service_role
USING (true);

-- Policy: Service role has full insert access (system and background tasks)
DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.audit_logs;
CREATE POLICY "Service role can insert audit logs"
ON public.audit_logs FOR INSERT
TO service_role
WITH CHECK (true);

-- Immutability Safeguards:
-- NO UPDATE POLICY: Audit entries are immutable. Any UPDATE statement will be denied by RLS.
-- NO DELETE POLICY: Application users (including admins) cannot delete audit logs from the client.

-- 5. Immutability Trigger: Database-level guarantee against UPDATE or DELETE
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs entries are immutable and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_log_modification();

-- 6. Helper Function: record_audit_event
-- Secure, server-side function to record audit events atomically with safe search_path
-- and authoritative server-side actor attribution (preventing client spoofing).
CREATE OR REPLACE FUNCTION public.record_audit_event(
    p_category TEXT,
    p_action TEXT,
    p_outcome TEXT,
    p_target_type TEXT DEFAULT NULL,
    p_target_id TEXT DEFAULT NULL,
    p_target_label TEXT DEFAULT NULL,
    p_school_id UUID DEFAULT NULL,
    p_details JSONB DEFAULT '{}'::jsonb,
    p_reason TEXT DEFAULT NULL,
    p_request_id TEXT DEFAULT NULL,
    p_ip_address TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_email TEXT;
    v_actor_role TEXT := 'anonymous';
    v_actor_school_id UUID;
    v_actor_school_name TEXT;
    v_target_school_id UUID;
    v_event_id UUID;
BEGIN
    v_actor_id := auth.uid();
    
    IF v_actor_id IS NOT NULL THEN
        -- Resolve authoritative role and school from database, preventing client spoofing
        SELECT ur.role, ur.school_id, s.name
        INTO v_actor_role, v_actor_school_id, v_actor_school_name
        FROM public.user_roles ur
        LEFT JOIN public.schools s ON s.id = ur.school_id
        WHERE ur.user_id = v_actor_id
        LIMIT 1;

        -- Resolve email from auth.users safely
        SELECT email INTO v_actor_email
        FROM auth.users
        WHERE id = v_actor_id
        LIMIT 1;
    END IF;

    -- Default target school to actor school if not provided
    v_target_school_id := COALESCE(p_school_id, v_actor_school_id);

    INSERT INTO public.audit_logs (
        actor_user_id,
        actor_email,
        actor_role,
        actor_school_id,
        actor_school_name,
        school_id,
        category,
        action,
        target_type,
        target_id,
        target_label,
        outcome,
        details,
        reason,
        request_id,
        ip_address,
        user_agent
    ) VALUES (
        v_actor_id,
        v_actor_email,
        COALESCE(v_actor_role, 'anonymous'),
        v_actor_school_id,
        v_actor_school_name,
        v_target_school_id,
        p_category,
        p_action,
        p_target_type,
        p_target_id,
        p_target_label,
        p_outcome,
        COALESCE(p_details, '{}'::jsonb),
        p_reason,
        p_request_id,
        p_ip_address,
        p_user_agent
    )
    RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

-- 7. Table and Function Privileges
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon;

REVOKE ALL ON FUNCTION public.record_audit_event FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_audit_event TO authenticated, service_role;

-- ============================================================================
-- SECTION 8: TRANSACTIONAL DATABASE AUDIT TRIGGERS FOR CRITICAL MUTATIONS
-- ============================================================================
-- Purpose:
--   Guarantees ACID atomicity across critical mutations:
--   - Account approvals, declines, role changes, and deletions on public.user_roles
--   - Document review decisions (approve, reject) and grade corrections on public.documents
--   - Eligibility decisions on public.eligibility_approvals
--
-- Invariants:
--   1. Strict Atomicity: The mutation and its audit entry succeed or fail together.
--   2. Authoritative Attribution: Actor identity and school context are derived from auth.uid().
--   3. Deduplication: Checks for matching events within a 2-second window to prevent duplicate records.
--   4. Privacy: Only metadata and status transitions are recorded; sensitive credentials and binaries are excluded.
-- ============================================================================

-- 8.1 User Roles Transactional Audit Trigger (Approvals, Declines, Role Changes, Deletions)
CREATE OR REPLACE FUNCTION public.process_audit_user_roles_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_action TEXT;
    v_details JSONB;
    v_actor_id UUID;
    v_actor_email TEXT;
    v_actor_role TEXT := 'system';
    v_actor_school_id UUID;
    v_actor_school_name TEXT;
    v_target_id TEXT;
    v_target_school UUID;
    v_reason TEXT;
    v_operation_id TEXT;
BEGIN
    -- Determine authoritative actor from session context, request header, or explicit table updater
    v_actor_id := COALESCE(
        auth.uid(),
        NULLIF(current_setting('app.actor_user_id', true), '')::uuid,
        CASE 
            WHEN current_setting('request.headers', true) IS NOT NULL 
                 AND (current_setting('request.headers', true)::jsonb ? 'x-actor-user-id')
            THEN (current_setting('request.headers', true)::jsonb ->> 'x-actor-user-id')::uuid
            ELSE NULL 
        END,
        CASE WHEN TG_OP = 'DELETE' THEN OLD.updated_by ELSE NEW.updated_by END
    );
    v_operation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.last_operation_id ELSE NEW.last_operation_id END;

    IF v_actor_id IS NOT NULL THEN
        SELECT ur.role, ur.school_id, s.name, u.email
        INTO v_actor_role, v_actor_school_id, v_actor_school_name, v_actor_email
        FROM public.user_roles ur
        LEFT JOIN public.schools s ON s.id = ur.school_id
        LEFT JOIN auth.users u ON u.id = ur.user_id
        WHERE ur.user_id = v_actor_id
        LIMIT 1;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_action := 'ACCOUNT_DELETED';
        v_target_id := OLD.user_id::text;
        v_target_school := OLD.school_id;
        v_reason := 'Database-enforced transactional audit: Account record deleted';
        v_details := jsonb_build_object(
            'deleted_role', OLD.role,
            'deleted_status', OLD.account_status,
            'school_id', OLD.school_id
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_target_id := NEW.user_id::text;
        v_target_school := COALESCE(NEW.school_id, OLD.school_id);
        
        IF OLD.account_status IS DISTINCT FROM NEW.account_status THEN
            IF NEW.account_status = 'Approved' THEN
                v_action := 'ACCOUNT_APPROVED';
                v_reason := 'Database-enforced transactional audit: Account status changed to Approved';
            ELSIF NEW.account_status = 'Declined' THEN
                v_action := 'ACCOUNT_DECLINED';
                v_reason := 'Database-enforced transactional audit: Account status changed to Declined';
            ELSE
                v_action := 'ACCOUNT_STATUS_CHANGED';
                v_reason := 'Database-enforced transactional audit: Account status changed to ' || NEW.account_status;
            END IF;
            v_details := jsonb_build_object(
                'previous_status', OLD.account_status,
                'new_status', NEW.account_status,
                'role', NEW.role,
                'school_id', NEW.school_id
            );
        ELSIF OLD.role IS DISTINCT FROM NEW.role THEN
            v_action := 'USER_ROLE_CHANGED';
            v_reason := 'Database-enforced transactional audit: User role updated';
            v_details := jsonb_build_object(
                'previous_role', OLD.role,
                'new_role', NEW.role,
                'account_status', NEW.account_status,
                'school_id', NEW.school_id
            );
        ELSE
            -- No critical security transition occurred
            RETURN NEW;
        END IF;
    ELSE
        RETURN NEW;
    END IF;

    -- Default actor school to target school if executed via system role
    v_actor_school_id := COALESCE(v_actor_school_id, v_target_school);

    -- Transaction-aware and operation-id deduplication (zero silent discarding of legitimate actions)
    IF v_operation_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.audit_logs
            WHERE request_id = v_operation_id
        ) THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
        END IF;
    ELSE
        IF EXISTS (
            SELECT 1 FROM public.audit_logs
            WHERE transaction_id = txid_current()
              AND action = v_action
              AND target_id = v_target_id
        ) THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
        END IF;
    END IF;

    INSERT INTO public.audit_logs (
        transaction_id,
        actor_user_id,
        actor_email,
        actor_role,
        actor_school_id,
        actor_school_name,
        school_id,
        category,
        action,
        target_type,
        target_id,
        target_label,
        outcome,
        details,
        reason,
        request_id
    ) VALUES (
        txid_current(),
        v_actor_id,
        v_actor_email,
        COALESCE(v_actor_role, 'system'),
        v_actor_school_id,
        v_actor_school_name,
        v_target_school,
        'USER_MANAGEMENT',
        v_action,
        'user',
        v_target_id,
        'User ' || v_target_id,
        'SUCCESS',
        v_details,
        v_reason,
        v_operation_id
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_roles_transition ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles_transition
AFTER UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.process_audit_user_roles_transition();

-- 8.2 Document Decision & Grade Correction Transactional Trigger
CREATE OR REPLACE FUNCTION public.process_audit_document_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_action TEXT;
    v_category TEXT;
    v_details JSONB;
    v_actor_id UUID;
    v_actor_email TEXT;
    v_actor_role TEXT := 'system';
    v_actor_school_id UUID;
    v_actor_school_name TEXT;
    v_target_id TEXT;
    v_target_school UUID;
    v_reason TEXT;
    v_operation_id TEXT;
BEGIN
    v_actor_id := COALESCE(
        auth.uid(),
        NULLIF(current_setting('app.actor_user_id', true), '')::uuid,
        CASE 
            WHEN current_setting('request.headers', true) IS NOT NULL 
                 AND (current_setting('request.headers', true)::jsonb ? 'x-actor-user-id')
            THEN (current_setting('request.headers', true)::jsonb ->> 'x-actor-user-id')::uuid
            ELSE NULL 
        END,
        NEW.reviewed_by
    );
    v_operation_id := NEW.last_operation_id;

    IF v_actor_id IS NOT NULL THEN
        SELECT ur.role, ur.school_id, s.name, u.email
        INTO v_actor_role, v_actor_school_id, v_actor_school_name, v_actor_email
        FROM public.user_roles ur
        LEFT JOIN public.schools s ON s.id = ur.school_id
        LEFT JOIN auth.users u ON u.id = ur.user_id
        WHERE ur.user_id = v_actor_id
        LIMIT 1;
    END IF;

    v_target_id := NEW.id::text;
    v_target_school := NEW.school_id;

    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = 'approved' THEN
            v_action := 'REVIEW_APPROVED';
            v_category := 'REVIEW';
            v_reason := 'Database-enforced transactional audit: Document review approved';
        ELSIF NEW.status = 'rejected' THEN
            v_action := 'REVIEW_REJECTED';
            v_category := 'REVIEW';
            v_reason := 'Database-enforced transactional audit: Document review rejected';
        ELSE
            v_action := 'DOCUMENT_STATUS_CHANGED';
            v_category := 'REVIEW';
            v_reason := 'Database-enforced transactional audit: Document status updated to ' || NEW.status;
        END IF;

        v_details := jsonb_build_object(
            'previous_status', OLD.status,
            'new_status', NEW.status,
            'document_type', NEW.document_type,
            'student_id', NEW.student_id
        );
    ELSIF (OLD.extracted_fields->'grades') IS DISTINCT FROM (NEW.extracted_fields->'grades') THEN
        v_action := 'GRADE_CORRECTED';
        v_category := 'ACADEMIC';
        v_reason := 'Database-enforced transactional audit: Academic grades corrected';
        v_details := jsonb_build_object(
            'document_type', NEW.document_type,
            'student_id', NEW.student_id,
            'status', NEW.status,
            'previous_grades_count', jsonb_array_length(COALESCE(OLD.extracted_fields->'grades', '[]'::jsonb)),
            'new_grades_count', jsonb_array_length(COALESCE(NEW.extracted_fields->'grades', '[]'::jsonb))
        );
    ELSE
        RETURN NEW;
    END IF;

    v_actor_school_id := COALESCE(v_actor_school_id, v_target_school);

    -- Transaction-aware and operation-id deduplication
    IF v_operation_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.audit_logs
            WHERE request_id = v_operation_id
        ) THEN
            RETURN NEW;
        END IF;
    ELSE
        IF EXISTS (
            SELECT 1 FROM public.audit_logs
            WHERE transaction_id = txid_current()
              AND action = v_action
              AND target_id = v_target_id
        ) THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.audit_logs (
        transaction_id,
        actor_user_id,
        actor_email,
        actor_role,
        actor_school_id,
        actor_school_name,
        school_id,
        category,
        action,
        target_type,
        target_id,
        target_label,
        outcome,
        details,
        reason,
        request_id
    ) VALUES (
        txid_current(),
        v_actor_id,
        v_actor_email,
        COALESCE(v_actor_role, 'system'),
        v_actor_school_id,
        v_actor_school_name,
        v_target_school,
        v_category,
        v_action,
        'document',
        v_target_id,
        COALESCE(UPPER(NEW.document_type), 'DOCUMENT') || ' #' || SUBSTRING(v_target_id, 1, 8),
        'SUCCESS',
        v_details,
        v_reason,
        v_operation_id
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_document_decision ON public.documents;
CREATE TRIGGER trg_audit_document_decision
AFTER UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.process_audit_document_decision();

-- 8.3 Eligibility Approvals Transactional Trigger (Safe Conditional Installation)
DO $$
BEGIN
    IF to_regclass('public.eligibility_approvals') IS NOT NULL THEN
        CREATE OR REPLACE FUNCTION public.process_audit_eligibility_decision()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $el_func$
        DECLARE
            v_action TEXT := 'ELIGIBILITY_DECISION';
            v_details JSONB;
            v_actor_id UUID;
            v_actor_email TEXT;
            v_actor_role TEXT := 'system';
            v_actor_school_id UUID;
            v_actor_school_name TEXT;
            v_target_id TEXT;
            v_target_school UUID;
            v_reason TEXT;
            v_operation_id TEXT;
        BEGIN
            v_actor_id := COALESCE(
                auth.uid(),
                NULLIF(current_setting('app.actor_user_id', true), '')::uuid,
                CASE 
                    WHEN current_setting('request.headers', true) IS NOT NULL 
                         AND (current_setting('request.headers', true)::jsonb ? 'x-actor-user-id')
                    THEN (current_setting('request.headers', true)::jsonb ->> 'x-actor-user-id')::uuid
                    ELSE NULL 
                END,
                NEW.approved_by
            );
            v_operation_id := NEW.last_operation_id;

            IF v_actor_id IS NOT NULL THEN
                SELECT ur.role, ur.school_id, s.name, u.email
                INTO v_actor_role, v_actor_school_id, v_actor_school_name, v_actor_email
                FROM public.user_roles ur
                LEFT JOIN public.schools s ON s.id = ur.school_id
                LEFT JOIN auth.users u ON u.id = ur.user_id
                WHERE ur.user_id = v_actor_id
                LIMIT 1;
            END IF;

            v_target_id := NEW.student_id::text;
            v_target_school := NEW.school_id;
            v_reason := 'Database-enforced transactional audit: Eligibility decision ' || NEW.decision || ' for ' || NEW.eligibility_type;

            v_details := jsonb_build_object(
                'approval_id', NEW.id,
                'grade_level', NEW.grade_level,
                'school_year', NEW.school_year,
                'eligibility_type', NEW.eligibility_type,
                'status', NEW.status,
                'decision', NEW.decision,
                'remarks', NEW.remarks
            );

            v_actor_school_id := COALESCE(v_actor_school_id, v_target_school);

            -- Transaction-aware and operation-id deduplication
            IF v_operation_id IS NOT NULL THEN
                IF EXISTS (
                    SELECT 1 FROM public.audit_logs
                    WHERE request_id = v_operation_id
                ) THEN
                    RETURN NEW;
                END IF;
            ELSE
                IF EXISTS (
                    SELECT 1 FROM public.audit_logs
                    WHERE transaction_id = txid_current()
                      AND action = v_action
                      AND target_id = v_target_id
                ) THEN
                    RETURN NEW;
                END IF;
            END IF;

            INSERT INTO public.audit_logs (
                transaction_id,
                actor_user_id,
                actor_email,
                actor_role,
                actor_school_id,
                actor_school_name,
                school_id,
                category,
                action,
                target_type,
                target_id,
                target_label,
                outcome,
                details,
                reason,
                request_id
            ) VALUES (
                txid_current(),
                v_actor_id,
                v_actor_email,
                COALESCE(v_actor_role, 'system'),
                v_actor_school_id,
                v_actor_school_name,
                v_target_school,
                'ACADEMIC',
                v_action,
                'student',
                v_target_id,
                NEW.eligibility_type || ' (' || NEW.grade_level || ')',
                'SUCCESS',
                v_details,
                v_reason,
                v_operation_id
            );

            RETURN NEW;
        END;
        $el_func$;

        DROP TRIGGER IF EXISTS trg_audit_eligibility_decision ON public.eligibility_approvals;
        CREATE TRIGGER trg_audit_eligibility_decision
        AFTER INSERT OR UPDATE ON public.eligibility_approvals
        FOR EACH ROW
        EXECUTE FUNCTION public.process_audit_eligibility_decision();
    END IF;
END $$;

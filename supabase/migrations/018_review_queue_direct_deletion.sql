-- ==============================================================================
-- Migration 018: Review Queue Direct Deletion with Safe Archival and Audit Logging
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 500169
-- ==============================================================================
-- 
-- Objectives:
-- 1. Extend public.documents to support 'archived' status and archival metadata:
--    - status: includes 'archived' in check constraint
--    - archived_at: timestamp of confirmed deletion
--    - archived_by: user UUID who confirmed and executed the deletion
-- 2. Provide safe, atomic RPC public.archive_review_document for direct deletion:
--    - Requires exact confirmation phrase: 'I am deleting this'
--    - Derives actor identity strictly from verified auth.uid() (NO spoofable p_actor_id)
--    - Revokes default PUBLIC/anon execution; grants only to authenticated and service_role
--    - Enforces authoritative role (approved teacher or administrator; principal is monitoring-only)
--    - Rejects deletion if caller's school cannot be verified (unless division admin)
--    - Rejects deletion by teachers for documents with NULL school_id unless verified owner (uploaded_by)
--    - Enforces school-isolation (cannot delete another school's records)
--    - Strictly enforces document eligibility (only 'needs_review' records can be archived)
--    - Updates document to 'archived' status without cascading deletions
--    - Directly inserts REVIEW_QUEUE_DOCUMENT_DELETED into public.audit_logs in the
--      SAME atomic transaction (if either fails, entire operation rolls back)
-- 3. Reloads PostgREST schema cache immediately via NOTIFY pgrst, 'reload schema'.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. EXTEND public.documents FOR ARCHIVAL / SOFT-DELETE STATUS
-- ------------------------------------------------------------------------------

-- Update status check constraint to include 'archived'
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_status_check 
    CHECK (status IN ('submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected', 'archived'));

-- Add archival metadata columns to public.documents
ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_archived_at 
ON public.documents (archived_at) 
WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_archived_by 
ON public.documents (archived_by) 
WHERE archived_by IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. ATOMIC RPC FUNCTION FOR SAFE DIRECT ARCHIVAL & AUDIT LOGGING
-- ------------------------------------------------------------------------------

-- Clean up any prior overloads (ensures no older bypass signatures exist)
DROP FUNCTION IF EXISTS public.archive_review_document(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.archive_review_document(UUID, TEXT);
DROP FUNCTION IF EXISTS public.archive_review_document(UUID);

CREATE OR REPLACE FUNCTION public.archive_review_document(
    p_document_id UUID,
    p_confirmation_phrase TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_email TEXT;
    v_caller_role TEXT;
    v_caller_school UUID;
    v_school_name TEXT;
    v_account_status TEXT;
    v_doc RECORD;
    v_student_name TEXT;
    v_student_lrn TEXT;
    v_student_identifier TEXT;
    v_target_label TEXT;
    v_actor_label TEXT;
BEGIN
    -- 1. STRICT AUTHENTICATION DERIVATION
    -- Never accept client-supplied actor ID. Derive strictly from auth context.
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User not authenticated.';
    END IF;

    -- 2. CONFIRMATION PHRASE VERIFICATION
    IF TRIM(p_confirmation_phrase) != 'I am deleting this' THEN
        RAISE EXCEPTION 'Invalid confirmation phrase. Exactly "I am deleting this" is required.';
    END IF;

    -- 3. ROLE-BASED ACCESS CONTROL (RBAC) & STATUS CHECK
    SELECT role, account_status, school_id
    INTO v_caller_role, v_account_status, v_caller_school
    FROM public.user_roles
    WHERE user_id = v_caller_id;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Forbidden: User profile not found.';
    END IF;

    IF v_account_status != 'Approved' THEN
        RAISE EXCEPTION 'Forbidden: Account is not approved (Status: %).', v_account_status;
    END IF;

    -- Only Teachers and Administrators are authorized; Principals are monitoring-only
    IF LOWER(v_caller_role) NOT IN ('teacher', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Role % is not authorized to delete review records.', v_caller_role;
    END IF;

    -- 4. VERIFY CALLER SCHOOL ASSIGNMENT
    -- Teachers and non-admins must have a verified school assignment
    IF v_caller_school IS NULL AND LOWER(v_caller_role) != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Caller school cannot be verified. Teachers must have an assigned school to delete review queue records.';
    END IF;

    -- 5. ATOMIC ROW LOCK AND ELIGIBILITY VERIFICATION
    SELECT * INTO v_doc
    FROM public.documents
    WHERE id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document not found.';
    END IF;

    -- Check if already archived (idempotency / prevent repeated deletion)
    IF v_doc.status = 'archived' THEN
        RAISE EXCEPTION 'Document is already archived.';
    END IF;

    -- Only eligible review-queue records (needs_review) can be archived via this function
    IF v_doc.status != 'needs_review' THEN
        RAISE EXCEPTION 'Document is not eligible for review deletion (Current status: %). Only records in needs_review state can be deleted.', v_doc.status;
    END IF;

    -- 6. SCHOOL ISOLATION & OWNERSHIP POLICY VERIFICATION
    IF v_doc.school_id IS NULL THEN
        -- Document has no school assigned:
        -- Non-admin callers (teachers) cannot delete documents with unassigned school
        -- unless authorized by documented ownership policy (they uploaded the document).
        IF LOWER(v_caller_role) != 'admin' THEN
            IF v_doc.uploaded_by IS NULL OR (v_doc.uploaded_by::text != v_caller_id::text) THEN
                RAISE EXCEPTION 'Forbidden: Teachers cannot delete documents with unassigned school unless explicitly authorized as the document owner.';
            END IF;
        END IF;
    ELSE
        -- Document has an assigned school:
        -- Non-admin callers can ONLY delete documents from their assigned school
        IF LOWER(v_caller_role) != 'admin' THEN
            IF v_caller_school != v_doc.school_id THEN
                RAISE EXCEPTION 'Forbidden: Cannot delete document belonging to another school.';
            END IF;
        ELSE
            -- Admin: If admin has an assigned school, enforce isolation unless division/system admin
            IF v_caller_school IS NOT NULL AND v_caller_school != v_doc.school_id THEN
                RAISE EXCEPTION 'Forbidden: Cannot delete document belonging to another school.';
            END IF;
        END IF;
    END IF;

    -- Retrieve caller email for audit trail
    SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;

    -- Resolve school name for audit logging
    IF v_doc.school_id IS NOT NULL THEN
        SELECT name INTO v_school_name FROM public.schools WHERE id = v_doc.school_id;
    END IF;

    -- 7. SAFE SOFT-DELETE / ARCHIVAL UPDATE
    UPDATE public.documents
    SET status = 'archived',
        archived_at = now(),
        archived_by = v_caller_id,
        updated_at = now()
    WHERE id = p_document_id;

    -- Resolve student metadata for audit logging if linked
    IF v_doc.student_id IS NOT NULL THEN
        SELECT last_name || ', ' || first_name, lrn
        INTO v_student_name, v_student_lrn
        FROM public.students
        WHERE id = v_doc.student_id;

        IF v_student_lrn IS NOT NULL THEN
            v_student_identifier := 'LRN: ' || v_student_lrn || ' (' || COALESCE(v_student_name, 'Unknown') || ')';
        ELSE
            v_student_identifier := v_student_name;
        END IF;
    END IF;

    IF v_student_identifier IS NULL AND v_doc.extracted_fields IS NOT NULL THEN
        IF v_doc.extracted_fields->>'lrn' IS NOT NULL THEN
            v_student_identifier := 'LRN: ' || (v_doc.extracted_fields->>'lrn') || ' (' || COALESCE(v_doc.extracted_fields->>'name', 'Unknown') || ')';
        ELSE
            v_student_identifier := v_doc.extracted_fields->>'name';
        END IF;
    END IF;

    v_target_label := COALESCE(v_doc.original_filename, UPPER(v_doc.document_type), 'Review Queue Document');
    v_actor_label := CASE WHEN LOWER(v_caller_role) = 'teacher' THEN 'Teacher' ELSE 'Administrator' END;

    -- 8. ATOMIC AUDIT LOGGING (Same transaction: commits or rolls back together)
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
        reason,
        details
    ) VALUES (
        v_caller_id,
        v_caller_email,
        LOWER(v_caller_role),
        COALESCE(v_caller_school, v_doc.school_id),
        COALESCE(v_school_name, 'TRIS (500169)'),
        COALESCE(v_doc.school_id, v_caller_school),
        'REVIEW',
        'REVIEW_QUEUE_DOCUMENT_DELETED',
        'document',
        p_document_id::text,
        v_target_label,
        'SUCCESS',
        v_actor_label || ' archived a document from the Review Queue after confirming deletion.',
        jsonb_build_object(
            'document_id', p_document_id,
            'document_name', COALESCE(v_doc.original_filename, v_doc.document_type),
            'student_id', v_doc.student_id,
            'student_identifier', v_student_identifier,
            'previous_status', v_doc.status,
            'new_status', 'archived',
            'action_result', 'success',
            'confirmation_method', 'typed confirmation phrase',
            'confirmation_phrase', 'I am deleting this'
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'document_id', p_document_id,
        'document_type', v_doc.document_type,
        'original_filename', v_doc.original_filename,
        'previous_status', v_doc.status,
        'new_status', 'archived',
        'student_id', v_doc.student_id,
        'student_name', v_student_name,
        'student_lrn', v_student_lrn,
        'archived_by', v_caller_id,
        'archived_at', now()
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. STRICT PRIVILEGE MANAGEMENT
-- ------------------------------------------------------------------------------

-- Revoke default PUBLIC and anon execution permissions
REVOKE ALL ON FUNCTION public.archive_review_document(UUID, TEXT) FROM PUBLIC, anon;

-- Grant execution strictly to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.archive_review_document(UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. RELOAD POSTGREST SCHEMA CACHE
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;

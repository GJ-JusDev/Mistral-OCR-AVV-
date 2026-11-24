-- ==============================================================================
-- MIGRATION 029: RECONCILE RETRY SEGMENT RECORDS & ATOMIC DATA INTEGRITY
-- ==============================================================================
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 500169
-- Description:
--   Provides an atomic, securely scoped database procedure to reconcile document segments
--   during retry operations without hard-deleting the parent document, preserving the
--   original document ID and storage path, while fully complying with Migration 014
--   Audit Logs, Migration 024 Cross-Document Validations, Migration 026 Data Access
--   Control (DAC) and trigger protections, and Migration 028 Observed Values schemas.
--
-- Invariants Enforced:
--   1. ID Preservation: The existing document primary key is preserved in-place.
--   2. Strict Teacher-Only Authorization: Only authenticated, approved Class Advisers
--      assigned to the document's section/school may reconcile the segment.
--   3. Explicit Role Blocking: Admin and Principal cannot invoke segment reconciliation.
--   4. Strict 8-Point Staging Document Verification:
--      - Must exist and be locked FOR UPDATE.
--      - Must be a genuine temporary retry staging record (status IN ('extracted', 'submitted'),
--        extracted_fields->>'is_retry_staging' = 'true', and
--        extracted_fields->>'retry_target_document_id' = p_document_id::text).
--      - Must be owned by the authenticated caller (uploaded_by = auth.uid()).
--      - Must belong to the same school as the target document and caller.
--      - Must match the target document's and active class-adviser assignment's section,
--        grade_level, school_year, and teacher_assignment_id.
--      - Must have a document_type compatible with the target document.
--   5. Scoped Child Record Reconciliation & Cross-Document Validation Preservation:
--      - Clears previous child records associated specifically with p_document_id across:
--        sf1_roster_entries, sf2_attendance_entries, sf5_promotion_entries,
--        subject_grades, psa_identity_records, field_extraction_traces,
--        student_identity_conflicts, learner_observed_values,
--        sf9_grading_scale_legends, validation_results.
--      - For public.cross_document_validations (Migration 024 schema: source_doc1_id,
--        source_doc2_id): removes ONLY unresolved records referencing p_document_id via
--        either source_doc1_id or source_doc2_id, while strictly preserving teacher-resolved
--        validation records (status = 'RESOLVED' or resolved_by/resolved_at IS NOT NULL)
--        and their resolution metadata.
--   6. True Transaction Atomicity: Supports both staging document transfer and direct
--      child record ingestion within a single atomic database transaction. If ANY
--      operation fails, the entire transaction rolls back completely and all original
--      parent and child records remain 100% intact.
--   7. Protected Field Trigger Synchronization: Updates public.guard_document_protected_fields()
--      to allow image_url updates exclusively when called from within the verified, audited
--      reconcile_retry_segment_document() context with a single-use transaction setting.
--   8. Authorized Failed-Staging Cleanup RPC: Provides public.cleanup_failed_retry_staging_document()
--      so failed temporary staging records can be removed safely on the server without
--      granting direct DELETE on public.documents to authenticated users.
--   9. Immutable Audit Trail: Records an official RETRY_DOCUMENT_SEGMENT event into
--      public.audit_logs using the authoritative Migration 014 / 026 column schema.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. UPDATE public.guard_document_protected_fields() TRIGGER FUNCTION
-- ------------------------------------------------------------------------------
-- Securely permits updating image_url when executed from inside the authorized,
-- audited public.reconcile_retry_segment_document() RPC.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_document_protected_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_context text;
BEGIN
    -- Trusted system processes and backend OCR pipeline via service_role may reconcile columns
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Prohibit modifying administrative routing and ownership columns
    IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
        RAISE EXCEPTION 'Forbidden: Cannot alter protected field school_id on an existing document.';
    END IF;

    IF NEW.teacher_assignment_id IS DISTINCT FROM OLD.teacher_assignment_id THEN
        RAISE EXCEPTION 'Forbidden: Cannot alter protected field teacher_assignment_id on an existing document.';
    END IF;

    IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
        RAISE EXCEPTION 'Forbidden: Cannot alter protected field uploaded_by on an existing document.';
    END IF;

    IF NEW.school_year IS DISTINCT FROM OLD.school_year THEN
        RAISE EXCEPTION 'Forbidden: Cannot alter protected field school_year on an existing document.';
    END IF;

    IF NEW.grade_level IS DISTINCT FROM OLD.grade_level THEN
        RAISE EXCEPTION 'Forbidden: Cannot alter protected field grade_level on an existing document.';
    END IF;

    IF NEW.section IS DISTINCT FROM OLD.section THEN
        RAISE EXCEPTION 'Forbidden: Cannot alter protected field section on an existing document.';
    END IF;

    IF NEW.document_type IS DISTINCT FROM OLD.document_type THEN
        RAISE EXCEPTION 'Forbidden: Cannot alter protected field document_type on an existing document.';
    END IF;

    -- image_url Protection:
    -- Authenticated callers cannot directly alter image_url on an existing document.
    -- Updating image_url is strictly restricted to service_role or the authorized,
    -- audited public.reconcile_retry_segment_document() RPC.
    IF NEW.image_url IS DISTINCT FROM OLD.image_url THEN
        GET DIAGNOSTICS v_context = PG_CONTEXT;
        IF v_context NOT LIKE '%reconcile_retry_segment_document%'
           OR COALESCE(current_setting('avv.retry_reconciliation_authorized', true), '') <> NEW.id::text THEN
            RAISE EXCEPTION 'Forbidden: Cannot alter protected field image_url on an existing document.';
        END IF;
        -- Single-use: Clear authorization immediately upon consumption (transaction-local)
        PERFORM set_config('avv.retry_reconciliation_authorized', '', true);
    END IF;

    -- Document Archival Protection:
    -- Authenticated callers cannot directly transition status to 'archived'.
    -- Archiving must only be performed through the authorized, audited public.archive_review_document() RPC.
    IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
        GET DIAGNOSTICS v_context = PG_CONTEXT;
        IF v_context NOT LIKE '%archive_review_document%'
           OR COALESCE(current_setting('avv.document_archival_authorized', true), '') <> NEW.id::text THEN
            RAISE EXCEPTION 'Forbidden: Documents cannot be directly transitioned to archived status. Use public.archive_review_document().';
        END IF;
        -- Single-use: Clear authorization immediately upon consumption (transaction-local)
        PERFORM set_config('avv.document_archival_authorized', '', true);
    END IF;

    -- student_id Protection:
    -- Authenticated callers cannot directly alter student_id on an existing document (whether NULL or non-NULL).
    -- Setting or reassigning student_id on an existing document is strictly restricted to service_role
    -- or the authorized, audited public.resolve_document_identity_conflict() RPC.
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
        GET DIAGNOSTICS v_context = PG_CONTEXT;
        IF v_context NOT LIKE '%resolve_document_identity_conflict%'
           OR COALESCE(current_setting('avv.conflict_resolution_authorized', true), '') <> NEW.id::text THEN
            RAISE EXCEPTION 'Forbidden: Cannot reassign student_id on an existing document directly. Use authorized identity verification workflow.';
        END IF;
        -- Single-use: Clear authorization immediately upon consumption (transaction-local)
        PERFORM set_config('avv.conflict_resolution_authorized', '', true);
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_document_protected_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_document_protected_fields() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_document_protected_fields ON public.documents;
CREATE TRIGGER trg_guard_document_protected_fields
    BEFORE UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_document_protected_fields();

-- ------------------------------------------------------------------------------
-- 2. CREATE ATOMIC RECONCILIATION RPC: public.reconcile_retry_segment_document
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_retry_segment_document(
    p_document_id UUID,
    p_extracted_text TEXT,
    p_extracted_fields JSONB,
    p_ocr_confidence NUMERIC DEFAULT 0.95,
    p_storage_path TEXT DEFAULT NULL,
    p_image_url TEXT DEFAULT NULL,
    p_staging_document_id UUID DEFAULT NULL,
    p_subject_grades JSONB DEFAULT NULL,
    p_psa_record JSONB DEFAULT NULL,
    p_observed_values JSONB DEFAULT NULL,
    p_grading_legends JSONB DEFAULT NULL
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
    v_staging_doc RECORD;
    v_clean_fields JSONB;
    v_now TIMESTAMPTZ := now();
    v_item JSONB;
BEGIN
    -- 1. Authentication Check
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User not authenticated.';
    END IF;

    -- 2. Authoritative User Profile & Approval Status
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

    -- 3. Strict Role-Based Restrictions
    IF LOWER(v_caller_role) IN ('admin', 'administrator') THEN
        RAISE EXCEPTION 'Forbidden: Administrator role cannot modify or scan student documents.';
    END IF;

    IF LOWER(v_caller_role) = 'principal' THEN
        RAISE EXCEPTION 'Forbidden: Principal role is monitoring-only.';
    END IF;

    IF LOWER(v_caller_role) != 'teacher' THEN
        RAISE EXCEPTION 'Forbidden: Role % is not authorized to retry document scanning.', v_caller_role;
    END IF;

    IF v_caller_school IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Caller school cannot be verified.';
    END IF;

    SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;
    SELECT name INTO v_school_name FROM public.schools WHERE id = v_caller_school;

    -- 4. Target Document Lock & Existence Verification
    SELECT * INTO v_doc
    FROM public.documents
    WHERE id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target document % not found for retry reconciliation.', p_document_id;
    END IF;

    IF v_doc.school_id IS NULL OR v_caller_school != v_doc.school_id THEN
        RAISE EXCEPTION 'Forbidden: Cannot reconcile document belonging to another school.';
    END IF;

    IF v_doc.status = 'archived' THEN
        RAISE EXCEPTION 'Forbidden: Archived documents cannot be retried.';
    END IF;

    -- 5. Strict Teacher Advisory Verification
    -- Caller MUST hold an active Class Adviser assignment matching the document
    IF NOT EXISTS (
        SELECT 1 FROM public.teacher_assignments ta
        WHERE ta.teacher_user_id = v_caller_id
          AND ta.assignment_type = 'class_adviser'
          AND ta.assignment_status = 'active'
          AND ta.school_id = v_caller_school
          AND ta.school_id = v_doc.school_id
          AND (
              (v_doc.teacher_assignment_id IS NOT NULL AND ta.id = v_doc.teacher_assignment_id)
              OR (
                  LOWER(TRIM(ta.section)) = LOWER(TRIM(v_doc.section))
                  AND LOWER(TRIM(ta.school_year)) = LOWER(TRIM(v_doc.school_year))
                  AND LOWER(TRIM(ta.grade_level)) = LOWER(TRIM(v_doc.grade_level))
              )
          )
    ) THEN
        RAISE EXCEPTION 'Forbidden: Teachers may only retry documents belonging to their officially assigned active advisory section.';
    END IF;

    -- 6. Strict 8-Point Staging Document Ownership & Context Verification (if provided)
    IF p_staging_document_id IS NOT NULL THEN
        IF p_staging_document_id = p_document_id THEN
            RAISE EXCEPTION 'Invalid staging document: Staging document cannot be the target document.';
        END IF;

        -- 6.1 Existence & Row Lock
        SELECT * INTO v_staging_doc
        FROM public.documents
        WHERE id = p_staging_document_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Staging document % not found for retry reconciliation.', p_staging_document_id;
        END IF;

        -- 6.2 Caller Ownership Verification (must belong to auth.uid())
        IF v_staging_doc.uploaded_by IS NULL OR v_staging_doc.uploaded_by::text != v_caller_id::text THEN
            RAISE EXCEPTION 'Forbidden: Staging document does not belong to the authenticated teacher.';
        END IF;

        -- 6.3 School Match Verification
        IF v_staging_doc.school_id IS NULL OR v_staging_doc.school_id != v_doc.school_id OR v_staging_doc.school_id != v_caller_school THEN
            RAISE EXCEPTION 'Forbidden: Staging document school mismatch.';
        END IF;

        -- 6.4 Genuinely a Temporary Retry Staging Record (not a legitimate active/approved/archived document)
        -- Explicit NULL rejection: `NULL NOT IN (...)` evaluates to NULL, which PL/pgSQL IF treats as false.
        IF v_staging_doc.status IS NULL THEN
            RAISE EXCEPTION 'Forbidden: Document % is not a valid temporary retry staging record for target document % (status is NULL).', p_staging_document_id, p_document_id;
        END IF;

        IF v_staging_doc.status NOT IN ('extracted', 'submitted')
           OR COALESCE((v_staging_doc.extracted_fields->>'is_retry_staging')::boolean, false) IS NOT TRUE
           OR COALESCE(v_staging_doc.extracted_fields->>'retry_target_document_id', '') != p_document_id::text
        THEN
            RAISE EXCEPTION 'Forbidden: Document % is not a valid temporary retry staging record for target document %.', p_staging_document_id, p_document_id;
        END IF;

        -- 6.5 Advisory Assignment Context Match (section, grade_level, school_year, and teacher_assignment_id)
        IF LOWER(TRIM(COALESCE(v_staging_doc.section, ''))) != LOWER(TRIM(COALESCE(v_doc.section, '')))
           OR LOWER(TRIM(COALESCE(v_staging_doc.school_year, ''))) != LOWER(TRIM(COALESCE(v_doc.school_year, '')))
           OR LOWER(TRIM(COALESCE(v_staging_doc.grade_level, ''))) != LOWER(TRIM(COALESCE(v_doc.grade_level, '')))
        THEN
            RAISE EXCEPTION 'Forbidden: Staging document advisory assignment context (section, grade level, or school year) does not match target document.';
        END IF;

        -- 6.5b Strict, NULL-safe teacher_assignment_id match.
        -- Rejects: target set + staging NULL, target NULL + staging set, and both set but different.
        -- Both NULL is permitted only because the caller's active class-adviser assignment (Step 5)
        -- and the advisory context match (Step 6.5) have already been enforced above.
        IF v_staging_doc.teacher_assignment_id IS DISTINCT FROM v_doc.teacher_assignment_id THEN
            RAISE EXCEPTION 'Forbidden: Staging document teacher_assignment_id does not match target document.';
        END IF;

        -- 6.6 Document Type Presence & Compatibility
        IF NULLIF(TRIM(COALESCE(v_doc.document_type, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Invalid target document: document_type is missing or empty.';
        END IF;

        IF NULLIF(TRIM(COALESCE(v_staging_doc.document_type, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Invalid staging document: document_type is missing or empty.';
        END IF;

        IF LOWER(TRIM(v_staging_doc.document_type)) != LOWER(TRIM(v_doc.document_type)) THEN
            RAISE EXCEPTION 'Invalid staging document: Document type (%) is incompatible with target document type (%).', v_staging_doc.document_type, v_doc.document_type;
        END IF;
    END IF;

    -- 7. Authorize Protected Field Update in Trigger (Single-use, scoped to this document ID)
    PERFORM set_config('avv.retry_reconciliation_authorized', p_document_id::text, true);

    -- 8. Clean previous child records strictly for THIS target document ID across child tables
    IF to_regclass('public.sf1_roster_entries') IS NOT NULL THEN
        DELETE FROM public.sf1_roster_entries WHERE document_id = p_document_id;
    END IF;
    IF to_regclass('public.sf2_attendance_entries') IS NOT NULL THEN
        DELETE FROM public.sf2_attendance_entries WHERE document_id = p_document_id;
    END IF;
    IF to_regclass('public.sf5_promotion_entries') IS NOT NULL THEN
        DELETE FROM public.sf5_promotion_entries WHERE document_id = p_document_id;
    END IF;
    IF to_regclass('public.subject_grades') IS NOT NULL THEN
        DELETE FROM public.subject_grades WHERE document_id = p_document_id;
    END IF;
    IF to_regclass('public.psa_identity_records') IS NOT NULL THEN
        DELETE FROM public.psa_identity_records WHERE document_id = p_document_id;
    END IF;
    IF to_regclass('public.field_extraction_traces') IS NOT NULL THEN
        DELETE FROM public.field_extraction_traces WHERE document_id = p_document_id;
    END IF;
    IF to_regclass('public.student_identity_conflicts') IS NOT NULL THEN
        DELETE FROM public.student_identity_conflicts WHERE document_id = p_document_id;
    END IF;
    IF to_regclass('public.learner_observed_values') IS NOT NULL THEN
        DELETE FROM public.learner_observed_values WHERE document_id = p_document_id;
    END IF;
    IF to_regclass('public.sf9_grading_scale_legends') IS NOT NULL THEN
        DELETE FROM public.sf9_grading_scale_legends WHERE document_id = p_document_id;
    END IF;
    IF to_regclass('public.validation_results') IS NOT NULL THEN
        DELETE FROM public.validation_results WHERE document_id = p_document_id;
    END IF;

    -- 8b. Cross-Document Validations (Migration 024 schema: source_doc1_id, source_doc2_id)
    -- Clean ONLY unresolved validation rows involving p_document_id through either source column.
    -- Strictly preserve teacher-resolved validation records (status = 'RESOLVED' or resolved_by/resolved_at IS NOT NULL).
    IF to_regclass('public.cross_document_validations') IS NOT NULL THEN
        DELETE FROM public.cross_document_validations
        WHERE (source_doc1_id = p_document_id OR source_doc2_id = p_document_id)
          AND status <> 'RESOLVED'
          AND resolved_by IS NULL
          AND resolved_at IS NULL;
    END IF;

    -- 9. If staging document provided, transfer child records to target document atomically
    IF p_staging_document_id IS NOT NULL THEN
        IF to_regclass('public.sf1_roster_entries') IS NOT NULL THEN
            UPDATE public.sf1_roster_entries SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.sf2_attendance_entries') IS NOT NULL THEN
            UPDATE public.sf2_attendance_entries SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.sf5_promotion_entries') IS NOT NULL THEN
            UPDATE public.sf5_promotion_entries SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.subject_grades') IS NOT NULL THEN
            UPDATE public.subject_grades SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.psa_identity_records') IS NOT NULL THEN
            UPDATE public.psa_identity_records SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.field_extraction_traces') IS NOT NULL THEN
            UPDATE public.field_extraction_traces SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.student_identity_conflicts') IS NOT NULL THEN
            UPDATE public.student_identity_conflicts SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.learner_observed_values') IS NOT NULL THEN
            UPDATE public.learner_observed_values SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.sf9_grading_scale_legends') IS NOT NULL THEN
            UPDATE public.sf9_grading_scale_legends SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.validation_results') IS NOT NULL THEN
            UPDATE public.validation_results SET document_id = p_document_id WHERE document_id = p_staging_document_id;
        END IF;
        IF to_regclass('public.cross_document_validations') IS NOT NULL THEN
            UPDATE public.cross_document_validations
            SET source_doc1_id = p_document_id,
                updated_at = v_now
            WHERE source_doc1_id = p_staging_document_id;

            UPDATE public.cross_document_validations
            SET source_doc2_id = p_document_id,
                updated_at = v_now
            WHERE source_doc2_id = p_staging_document_id;
        END IF;

        -- Remove temporary staging document row
        DELETE FROM public.documents WHERE id = p_staging_document_id;
    END IF;

    -- 10. Direct Child Data Ingestion (if provided as JSON arrays)
    -- 10a. Subject Grades
    IF p_subject_grades IS NOT NULL AND jsonb_typeof(p_subject_grades) = 'array' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_subject_grades)
        LOOP
            INSERT INTO public.subject_grades (
                document_id, subject, q1, q2, final_grade
            ) VALUES (
                p_document_id,
                COALESCE(v_item->>'subject', 'General'),
                (v_item->>'q1')::numeric,
                (v_item->>'q2')::numeric,
                (v_item->>'final_grade')::numeric
            );
        END LOOP;
    END IF;

    -- 10b. PSA Identity Record
    IF p_psa_record IS NOT NULL AND jsonb_typeof(p_psa_record) = 'object' THEN
        INSERT INTO public.psa_identity_records (
            document_id, student_id, school_id, registry_number,
            last_name, first_name, middle_name, sex, birth_date,
            mother_maiden_name, father_name, verification_status, ocr_confidence
        ) VALUES (
            p_document_id,
            (p_psa_record->>'student_id')::uuid,
            v_caller_school,
            p_psa_record->>'registry_number',
            p_psa_record->>'last_name',
            p_psa_record->>'first_name',
            p_psa_record->>'middle_name',
            COALESCE(p_psa_record->>'sex', 'M'),
            COALESCE((p_psa_record->>'birth_date')::date, '2000-01-01'::date),
            p_psa_record->>'mother_maiden_name',
            p_psa_record->>'father_name',
            'PENDING',
            COALESCE(p_ocr_confidence, 0.95)
        );
    END IF;

    -- 10c. Learner Observed Values (Migration 028)
    IF p_observed_values IS NOT NULL AND jsonb_typeof(p_observed_values) = 'array' THEN
        IF to_regclass('public.learner_observed_values') IS NOT NULL THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(p_observed_values)
            LOOP
                INSERT INTO public.learner_observed_values (
                    document_id, school_id, student_id, lrn, school_year, grade_level,
                    core_value, core_value_index, behavior_statement, statement_id,
                    quarter, original_mark, normalized_rating, ocr_confidence, source_page
                ) VALUES (
                    p_document_id,
                    v_caller_school,
                    (v_item->>'student_id')::uuid,
                    v_item->>'lrn',
                    COALESCE(v_item->>'school_year', v_doc.school_year),
                    COALESCE(v_item->>'grade_level', v_doc.grade_level),
                    v_item->>'core_value',
                    (v_item->>'core_value_index')::smallint,
                    v_item->>'behavior_statement',
                    v_item->>'statement_id',
                    v_item->>'quarter',
                    v_item->>'original_mark',
                    v_item->>'normalized_rating',
                    (v_item->>'ocr_confidence')::real,
                    COALESCE((v_item->>'source_page')::smallint, 2)
                );
            END LOOP;
        END IF;
    END IF;

    -- 10d. SF9 Grading Scale Legends (Migration 028)
    IF p_grading_legends IS NOT NULL AND jsonb_typeof(p_grading_legends) = 'array' THEN
        IF to_regclass('public.sf9_grading_scale_legends') IS NOT NULL THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(p_grading_legends)
            LOOP
                INSERT INTO public.sf9_grading_scale_legends (
                    document_id, descriptor, grading_scale, remarks, source_page
                ) VALUES (
                    p_document_id,
                    v_item->>'descriptor',
                    v_item->>'grading_scale',
                    v_item->>'remarks',
                    COALESCE((v_item->>'source_page')::smallint, 2)
                );
            END LOOP;
        END IF;
    END IF;

    -- 11. Update parent document record in-place, preserving its ID and routing metadata
    -- Strip temporary staging markers from extracted_fields if present
    v_clean_fields := COALESCE(p_extracted_fields, '{}'::jsonb) - 'is_retry_staging' - 'retry_target_document_id';

    UPDATE public.documents
    SET extracted_text = p_extracted_text,
        extracted_fields = v_clean_fields,
        ocr_confidence = COALESCE(p_ocr_confidence, ocr_confidence),
        storage_path = COALESCE(p_storage_path, storage_path),
        image_url = COALESCE(p_image_url, image_url),
        status = 'needs_review',
        updated_at = v_now
    WHERE id = p_document_id;

    -- 12. Record Audit Event in public.audit_logs (Migration 014 / 026 Authoritative Schema)
    IF to_regclass('public.audit_logs') IS NOT NULL THEN
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
            'teacher',
            v_caller_school,
            COALESCE(v_school_name, 'Taysan Resettlement Integrated School (500169)'),
            v_doc.school_id,
            'DOCUMENT',
            'RETRY_DOCUMENT_SEGMENT',
            'document',
            p_document_id::text,
            UPPER(COALESCE(v_doc.document_type, 'DOCUMENT')) || ' - ' || COALESCE(v_doc.original_filename, p_document_id::text),
            'SUCCESS',
            'Teacher retried and reconciled document segment in-place',
            jsonb_build_object(
                'document_id', p_document_id,
                'document_type', v_doc.document_type,
                'school_year', v_doc.school_year,
                'grade_level', v_doc.grade_level,
                'section', v_doc.section,
                'staging_document_id', p_staging_document_id,
                'reconciled_at', v_now
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'document_id', p_document_id,
        'reconciled_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_retry_segment_document(UUID, TEXT, JSONB, NUMERIC, TEXT, TEXT, UUID, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_retry_segment_document(UUID, TEXT, JSONB, NUMERIC, TEXT, TEXT, UUID, JSONB, JSONB, JSONB, JSONB) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. CREATE FAILED-STAGING CLEANUP RPC: public.cleanup_failed_retry_staging_document
-- ------------------------------------------------------------------------------
-- Allows an authenticated, approved Teacher to safely remove ONLY their own
-- temporary retry staging document when child ingestion fails, preserving
-- Migration 026's prohibition on direct client DELETEs on public.documents.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_failed_retry_staging_document(
    p_staging_document_id UUID,
    p_target_document_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_school UUID;
    v_account_status TEXT;
    v_staging_doc RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User not authenticated.';
    END IF;

    SELECT role, account_status, school_id
    INTO v_caller_role, v_account_status, v_caller_school
    FROM public.user_roles
    WHERE user_id = v_caller_id;

    IF v_caller_role IS NULL OR v_account_status != 'Approved' THEN
        RAISE EXCEPTION 'Forbidden: Approved user profile required.';
    END IF;

    IF LOWER(v_caller_role) IN ('admin', 'administrator', 'principal') OR LOWER(v_caller_role) != 'teacher' THEN
        RAISE EXCEPTION 'Forbidden: Only authorized Teachers may clean up retry staging documents.';
    END IF;

    SELECT * INTO v_staging_doc
    FROM public.documents
    WHERE id = p_staging_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'deleted', false,
            'staging_document_id', p_staging_document_id,
            'reason', 'not_found'
        );
    END IF;

    IF v_staging_doc.uploaded_by IS NULL OR v_staging_doc.uploaded_by::text != v_caller_id::text THEN
        RAISE EXCEPTION 'Forbidden: Staging document does not belong to the authenticated teacher.';
    END IF;

    IF v_staging_doc.school_id IS NULL OR v_staging_doc.school_id != v_caller_school THEN
        RAISE EXCEPTION 'Forbidden: Staging document school mismatch.';
    END IF;

    IF v_staging_doc.status IS NULL
       OR v_staging_doc.status NOT IN ('extracted', 'submitted')
       OR COALESCE((v_staging_doc.extracted_fields->>'is_retry_staging')::boolean, false) IS NOT TRUE
       OR (
           p_target_document_id IS NOT NULL
           AND COALESCE(v_staging_doc.extracted_fields->>'retry_target_document_id', '') != p_target_document_id::text
       )
    THEN
        RAISE EXCEPTION 'Forbidden: Document % is not a temporary retry staging record.', p_staging_document_id;
    END IF;

    DELETE FROM public.documents WHERE id = p_staging_document_id;

    RETURN jsonb_build_object(
        'success', true,
        'deleted', true,
        'staging_document_id', p_staging_document_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_failed_retry_staging_document(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_failed_retry_staging_document(UUID, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

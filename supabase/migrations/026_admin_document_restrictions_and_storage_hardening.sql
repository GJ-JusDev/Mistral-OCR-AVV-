-- ==============================================================================
-- MIGRATION 026: ADMIN DOCUMENT OPERATIONS REVOCATION & STORAGE HARDENING (TARGETED FINAL)
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 500169
-- ==============================================================================
-- Purpose:
--   Establish comprehensive defense-in-depth security across documents, child roster
--   tables, audit logs, and Supabase Storage, enforcing strict separation of concerns:
--
-- Invariants Enforced:
--   1. Storage Policy Inspection & Bucket Isolation:
--      - Inspects every policy on storage.objects; drops only policies affecting the 'documents' bucket.
--      - Preserves policies for unrelated storage buckets (e.g. avatars).
--   2. Strict Non-Null Metadata Verification:
--      - can_teacher_access_document() and archive_review_document() reject NULL school_year,
--        grade_level, section, or school_id. Zero-null tolerance ensures exact advisory match.
--   3. Elimination of Enrollment Shortcuts:
--      - Removes se.adviser_user_id = auth.uid() shortcut from document SELECT and UPDATE.
--      - Access requires a currently active class_adviser assignment matching section, SY, and grade.
--   4. Child Roster Confinement:
--      - All 6 child-table SELECT policies require matching the teacher's active assignment,
--        including exact school_year. Document association alone cannot bypass assignment rules.
--      - Client write operations (INSERT/UPDATE/DELETE) are completely revoked (service_role only).
--   5. Audit Log Immutability & Anti-Fabrication:
--      - Client INSERT on public.audit_logs is revoked from authenticated and anon.
--      - Neither Admin nor Teacher can fabricate audit events. Only service_role and trusted RPCs write.
--   6. Canonical Storage Object Matching:
--      - Removes fuzzy matching (name LIKE '%' || d.id || '%').
--      - Requires canonical exact storage path (storage_path = name, image_url = name, or exact suffix).
--   7. Protected Document Fields & student_id Protection:
--      - BEFORE UPDATE trigger blocks tampering with routing fields and student_id.
--      - Authorized conflict resolution RPC and trusted backend workflows are preserved.
--   8. Function Security & Clean Overloads:
--      - All SECURITY DEFINER functions set search_path = public, pg_temp with explicit grants.
--
-- DO NOT EXECUTE ON PRODUCTION WITHOUT EXPLICIT APPROVAL.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. TARGETED POLICY PURGE (PRESERVING UNRELATED BUCKETS)
-- ------------------------------------------------------------------------------
-- PostgreSQL permissive policies combine with OR. To ensure no legacy policy
-- grants unintended access to documents or child tables, we dynamically drop
-- policies on affected public tables and target storage policies affecting 'documents'.

DO $$
DECLARE
    r RECORD;
    pol RECORD;
BEGIN
    -- 1.1 Purge all policies on targeted public tables
    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'documents',
              'sf1_roster_entries',
              'sf2_attendance_entries',
              'sf5_promotion_entries',
              'psa_identity_records',
              'cross_document_validations',
              'field_extraction_traces',
              'audit_logs'
          )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;

    -- 1.2 Inspect every policy on storage.objects:
    -- - Explicitly drop known legacy policies affecting the 'documents' bucket.
    -- - Identify and drop policies explicitly referencing the 'documents' bucket.
    -- - Drop global unrestricted policies (no bucket_id constraint in qual or with_check).
    -- - Preserve policies that can be confidently established as restricted exclusively to unrelated buckets
    --   (including safe positive IN or OR multi-bucket expressions).
    -- - FAIL-CLOSED: For ambiguous policies that cannot be proven safe (e.g. negative bucket conditions like <>,
    --   disjunctions with unconstrained OR branches, or CASE expressions), RAISE EXCEPTION and abort the migration.
    --   (Note: Static text inspection is intentionally conservative and fail-closed; it does not claim full SQL AST semantic analysis).
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
        -- 1.2.1 Explicit drop of known legacy policies from migrations 001, 008, and 009
        EXECUTE 'DROP POLICY IF EXISTS "Give public access to documents bucket" ON storage.objects';
        EXECUTE 'DROP POLICY IF EXISTS "Give public upload access to documents bucket" ON storage.objects';
        EXECUTE 'DROP POLICY IF EXISTS "Give public update access to documents bucket" ON storage.objects';
        EXECUTE 'DROP POLICY IF EXISTS "Give public delete access to documents bucket" ON storage.objects';
        EXECUTE 'DROP POLICY IF EXISTS "Public Read Documents Bucket" ON storage.objects';
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated Users Read Documents" ON storage.objects';
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated Users Upload Documents" ON storage.objects';
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated Users Manage Documents" ON storage.objects';
        EXECUTE 'DROP POLICY IF EXISTS "Authenticated Users Delete Documents" ON storage.objects';

        -- 1.2.2 Inspect remaining policies on storage.objects
        FOR pol IN
            SELECT schemaname, tablename, policyname, cmd, qual, with_check
            FROM pg_policies
            WHERE schemaname = 'storage' AND tablename = 'objects'
        LOOP
            DECLARE
                v_is_documents_target BOOLEAN := false;
                v_is_global_unconstrained BOOLEAN := false;
                v_is_provably_safe BOOLEAN := true;
                v_expr TEXT;
                v_or_part TEXT;
                v_or_parts TEXT[];
            BEGIN
                -- 1. Explicit reference to 'documents' bucket in policy name, qual, or with_check
                IF pol.policyname ILIKE '%document%' OR pol.policyname ILIKE '%documents%' THEN
                    v_is_documents_target := true;
                ELSIF (pol.qual IS NOT NULL AND pol.qual ILIKE '%''documents''%')
                   OR (pol.with_check IS NOT NULL AND pol.with_check ILIKE '%''documents''%') THEN
                    v_is_documents_target := true;

                -- 2. Policies without bucket_id condition:
                -- Only policies proven to be genuinely global and unrestricted (strictly 'true' or pure standard auth.role() checks)
                -- affecting all buckets can be safely dropped.
                -- Any function-based, setting-based, column-based, or otherwise ambiguous policy without bucket_id
                -- CANNOT be proven safe or genuinely unconstrained, and MUST cause a fail-closed migration abort.
                ELSIF (pol.qual IS NULL OR pol.qual NOT ILIKE '%bucket_id%')
                  AND (pol.with_check IS NULL OR pol.with_check NOT ILIKE '%bucket_id%') THEN

                    DECLARE
                        v_all_expressions_genuinely_unconstrained BOOLEAN := true;
                    BEGIN
                        FOR v_expr IN SELECT unnest(ARRAY[pol.qual, pol.with_check]) LOOP
                            IF v_expr IS NOT NULL THEN
                                IF NOT (
                                    v_expr ~* '^\s*\(?\s*true\s*\)?\s*$'
                                    OR v_expr ~* '^\s*\(?\s*auth\.role\(\)\s*=\s*''(authenticated|anon)''(?:::text)?\s*\)?\s*$'
                                    OR v_expr ~* '^\s*\(?\s*auth\.role\(\)\s*=\s*ANY\s*\(\s*ARRAY\s*\[\s*''(authenticated|anon)''(?:::text)?(\s*,\s*''(authenticated|anon)''(?:::text)?)*\s*\]\s*\)\s*\)?\s*$'
                                ) THEN
                                    v_all_expressions_genuinely_unconstrained := false;
                                END IF;
                            END IF;
                        END LOOP;

                        IF v_all_expressions_genuinely_unconstrained THEN
                            v_is_global_unconstrained := true;
                        ELSE
                            v_is_provably_safe := false;
                        END IF;
                    END;

                ELSE
                    -- 3. Policy mentions bucket_id and does NOT mention 'documents'.
                    -- Verify whether it can be confidently proven restricted exclusively to unrelated buckets using explicit literal names.
                    -- Note: Static text/pattern checks are intentionally fail-closed and conservative; no claim of full SQL AST analysis is made.
                    FOR v_expr IN SELECT unnest(ARRAY[pol.qual, pol.with_check]) LOOP
                        IF v_expr IS NOT NULL THEN
                            -- Disallow negative operators, CASE, COALESCE, NULLIF, subqueries, or dynamic settings
                            IF v_expr ILIKE '%<>%'
                               OR v_expr ILIKE '%!=%'
                               OR v_expr ~* '\mNOT\M'
                               OR v_expr ILIKE '%CASE%'
                               OR v_expr ILIKE '%COALESCE%'
                               OR v_expr ILIKE '%NULLIF%'
                               OR v_expr ILIKE '%SELECT%'
                               OR v_expr ILIKE '%EXISTS%'
                               OR v_expr ILIKE '%current_setting%' THEN
                                v_is_provably_safe := false;
                            END IF;

                            -- Verify bucket_id comparison uses strictly literal values (reject dynamic functions like current_bucket())
                            IF v_is_provably_safe THEN
                                IF v_expr ~* 'bucket_id\s*=\s*ANY' THEN
                                    -- Must be strictly literal ARRAY['literal'::text, ...] without nested function calls
                                    IF NOT (v_expr ~* 'bucket_id\s*=\s*ANY\s*\(\s*ARRAY\s*\['
                                            AND NOT (v_expr ~* 'ARRAY\s*\[[^\]]*\(')) THEN
                                        v_is_provably_safe := false;
                                    END IF;
                                ELSIF v_expr ~* 'bucket_id\s*=' THEN
                                    -- Must be strictly literal bucket equality (e.g. bucket_id = 'avatars'::text)
                                    IF NOT (v_expr ~* 'bucket_id\s*=\s*''[a-zA-Z0-9_-]+''') THEN
                                        v_is_provably_safe := false;
                                    END IF;
                                ELSE
                                    v_is_provably_safe := false;
                                END IF;
                            END IF;

                            -- Check for OR expressions and AND/OR precedence
                            IF v_is_provably_safe AND v_expr ~* '\s+OR\s+' THEN
                                -- Check if all OR branches are pure literal bucket comparisons
                                v_or_parts := regexp_split_to_array(v_expr, '\s+OR\s+', 'i');
                                FOREACH v_or_part IN ARRAY v_or_parts LOOP
                                    IF NOT (v_or_part ~* 'bucket_id\s*=\s*''[a-zA-Z0-9_-]+''')
                                       OR v_or_part ILIKE '%''documents''%'
                                       OR (v_or_part ~* '\m(auth\.role|owner|owner_id|current_setting)\M' AND NOT (v_or_part ~* 'AND')) THEN
                                        v_is_provably_safe := false;
                                    END IF;
                                END LOOP;

                                -- Disallow nested OR branches or ambiguous precedence containing unconstrained terms
                                IF v_expr ~* '\s+OR\s+\([^)]*auth\.role'
                                   OR v_expr ~* 'auth\.role[^)]*\s+OR\s+'
                                   OR v_expr ~* '\s+OR\s+[^()]+\s+AND\s+'
                                   OR v_expr ~* '\s+AND\s+[^()]+\s+OR\s+' THEN
                                    v_is_provably_safe := false;
                                END IF;
                            END IF;
                        END IF;
                    END LOOP;
                END IF;

                IF v_is_documents_target THEN
                    RAISE NOTICE 'Dropping legacy documents storage policy: %', pol.policyname;
                    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
                ELSIF v_is_global_unconstrained THEN
                    RAISE NOTICE 'Dropping global unrestricted storage policy affecting documents bucket: %', pol.policyname;
                    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
                ELSIF v_is_provably_safe THEN
                    RAISE NOTICE 'Preserving verified unrelated storage policy: % (qual: %, with_check: %)',
                        pol.policyname, pol.qual, pol.with_check;
                ELSE
                    RAISE EXCEPTION 'MIGRATION ABORTED (FAIL-CLOSED): Policy "%" on storage.objects cannot be proven safe for documents bucket (qual: %, with_check: %). Manual review required before applying Migration 026.',
                        pol.policyname, pol.qual, pol.with_check;
                END IF;
            END;
        END LOOP;
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 2. HARDEN HELPER FUNCTIONS (CLEAN OVERLOADS & STRICT METADATA)
-- ------------------------------------------------------------------------------

-- 2.1 can_teacher_scan_with_assignment: Strict Class Adviser verification (no admin shortcut)
DROP FUNCTION IF EXISTS public.can_teacher_scan_with_assignment(UUID);

CREATE OR REPLACE FUNCTION public.can_teacher_scan_with_assignment(p_assignment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.teacher_assignments ta
        JOIN public.user_roles ur
          ON ur.user_id = ta.teacher_user_id
         AND ur.school_id = ta.school_id
        WHERE ta.id = p_assignment_id
          AND ta.teacher_user_id = auth.uid()
          AND ta.assignment_status = 'active'
          AND ta.assignment_type = 'class_adviser'
          AND ur.role = 'teacher'
          AND ur.account_status = 'Approved'
    );
$$;

REVOKE ALL ON FUNCTION public.can_teacher_scan_with_assignment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_teacher_scan_with_assignment(UUID) TO authenticated, service_role;

-- 2.2 can_teacher_access_section: Strict Class Adviser verification with zero null tolerance
DROP FUNCTION IF EXISTS public.can_teacher_access_section(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.can_teacher_access_section(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.can_teacher_access_section(
    p_school_id UUID,
    p_school_year TEXT,
    p_grade_level TEXT,
    p_section TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.teacher_assignments ta
        JOIN public.user_roles ur
          ON ur.user_id = ta.teacher_user_id
         AND ur.school_id = ta.school_id
        WHERE ta.teacher_user_id = auth.uid()
          AND ta.school_id = p_school_id
          AND ta.assignment_status = 'active'
          AND ta.assignment_type = 'class_adviser'
          AND ur.role = 'teacher'
          AND ur.account_status = 'Approved'
          AND p_school_id IS NOT NULL
          AND p_school_year IS NOT NULL AND TRIM(p_school_year) <> ''
          AND p_grade_level IS NOT NULL AND TRIM(p_grade_level) <> ''
          AND p_section IS NOT NULL AND TRIM(p_section) <> ''
          AND LOWER(TRIM(ta.school_year)) = LOWER(TRIM(p_school_year))
          AND LOWER(TRIM(ta.grade_level)) = LOWER(TRIM(p_grade_level))
          AND LOWER(TRIM(ta.section)) = LOWER(TRIM(p_section))
    );
$$;

REVOKE ALL ON FUNCTION public.can_teacher_access_section(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_teacher_access_section(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 2.3 can_teacher_access_document: Zero-null tolerance. Rejects missing metadata.
DROP FUNCTION IF EXISTS public.can_teacher_access_document(UUID);

CREATE OR REPLACE FUNCTION public.can_teacher_access_document(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.documents d
        JOIN public.teacher_assignments ta
          ON ta.teacher_user_id = auth.uid()
         AND ta.school_id = d.school_id
         AND ta.assignment_status = 'active'
         AND ta.assignment_type = 'class_adviser'
        JOIN public.user_roles ur
          ON ur.user_id = ta.teacher_user_id
         AND ur.school_id = ta.school_id
         AND ur.role = 'teacher'
         AND ur.account_status = 'Approved'
        WHERE d.id = p_document_id
          AND d.school_id IS NOT NULL
          AND (
              -- Path A: Document explicitly linked to this teacher assignment
              (d.teacher_assignment_id IS NOT NULL AND d.teacher_assignment_id = ta.id)
              OR (
                  -- Path B: Exact match across school, school year, grade level, and section.
                  -- ZERO null tolerance: all four attributes MUST be non-null and match.
                  d.section IS NOT NULL AND TRIM(d.section) <> ''
                  AND d.school_year IS NOT NULL AND TRIM(d.school_year) <> ''
                  AND d.grade_level IS NOT NULL AND TRIM(d.grade_level) <> ''
                  AND LOWER(TRIM(ta.section)) = LOWER(TRIM(d.section))
                  AND LOWER(TRIM(ta.school_year)) = LOWER(TRIM(d.school_year))
                  AND LOWER(TRIM(ta.grade_level)) = LOWER(TRIM(d.grade_level))
              )
          )
    );
$$;

REVOKE ALL ON FUNCTION public.can_teacher_access_document(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_teacher_access_document(UUID) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 3. COLUMN IMMUTABILITY TRIGGER (public.documents)
-- ------------------------------------------------------------------------------
-- RLS alone controls row-level visibility, not column-level modifications.
-- This BEFORE UPDATE trigger ensures that authenticated callers (Teachers) cannot
-- alter protected routing, identity, or student link columns on existing documents.

DROP TRIGGER IF EXISTS trg_guard_document_protected_fields ON public.documents;
DROP FUNCTION IF EXISTS public.guard_document_protected_fields();

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

    IF NEW.image_url IS DISTINCT FROM OLD.image_url THEN
        RAISE EXCEPTION 'Forbidden: Cannot alter protected field image_url on an existing document.';
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

CREATE TRIGGER trg_guard_document_protected_fields
    BEFORE UPDATE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_document_protected_fields();


-- ------------------------------------------------------------------------------
-- 4. HARDEN public.documents RLS POLICIES
-- ------------------------------------------------------------------------------

-- 4.1 SELECT: Admin (institutional), service_role, Principal (school scope), and Teacher (exact active advisory)
-- Removed se.adviser_user_id = auth.uid() shortcut: access requires active Class Adviser assignment.
CREATE POLICY "Authorized read documents" ON public.documents
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal()
            AND documents.school_id IS NOT NULL
            AND documents.school_id = public.get_auth_user_school_id()
        )
        OR (
            public.is_approved_teacher()
            AND (
                public.can_teacher_access_document(documents.id)
                OR (
                    documents.student_id IS NOT NULL
                    AND documents.school_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.student_enrollments se
                        WHERE se.student_id = documents.student_id
                          AND se.school_id = documents.school_id
                          AND se.enrollment_status = 'active'
                          AND public.can_teacher_access_section(se.school_id, se.school_year, se.grade_level, se.section)
                    )
                )
            )
        )
    );

-- 4.2 INSERT: Admin and Principal are REVOKED. Only service_role and Class Advisers with verified assignment.
CREATE POLICY "Authorized insert documents" ON public.documents
    FOR INSERT WITH CHECK (
        auth.role() = 'service_role'
        OR (
            public.is_approved_teacher()
            AND uploaded_by = auth.uid()::text
            AND school_id = public.get_auth_user_school_id()
            AND teacher_assignment_id IS NOT NULL
            AND public.can_teacher_scan_with_assignment(teacher_assignment_id)
        )
    );

-- 4.3 UPDATE: Admin and Principal are REVOKED.
-- Teachers can only update documents belonging to their exact active advisory assignment.
-- Removed se.adviser_user_id shortcut. Teachers cannot transition status to approved or rejected.
CREATE POLICY "Authorized update documents" ON public.documents
    FOR UPDATE
    USING (
        auth.role() = 'service_role'
        OR (
            public.is_approved_teacher()
            AND status NOT IN ('approved', 'rejected', 'archived')
            AND (
                public.can_teacher_access_document(documents.id)
                OR (
                    documents.student_id IS NOT NULL
                    AND documents.school_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.student_enrollments se
                        WHERE se.student_id = documents.student_id
                          AND se.school_id = documents.school_id
                          AND se.enrollment_status = 'active'
                          AND public.can_teacher_access_section(se.school_id, se.school_year, se.grade_level, se.section)
                    )
                )
            )
        )
    )
    WITH CHECK (
        auth.role() = 'service_role'
        OR (
            public.is_approved_teacher()
            AND status NOT IN ('approved', 'rejected', 'archived')
            AND (
                public.can_teacher_access_document(documents.id)
                OR (
                    documents.student_id IS NOT NULL
                    AND documents.school_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1
                        FROM public.student_enrollments se
                        WHERE se.student_id = documents.student_id
                          AND se.school_id = documents.school_id
                          AND se.enrollment_status = 'active'
                          AND public.can_teacher_access_section(se.school_id, se.school_year, se.grade_level, se.section)
                    )
                )
            )
        )
    );

-- 4.4 DELETE: Hard delete strictly restricted to service_role. Admin, Principal, and Teachers have ZERO delete privilege.
CREATE POLICY "Service role delete documents" ON public.documents
    FOR DELETE USING (auth.role() = 'service_role');


-- ------------------------------------------------------------------------------
-- 5. HARDEN SUPABASE STORAGE POLICIES ('documents' BUCKET)
-- ------------------------------------------------------------------------------
-- Removed fuzzy matching (LIKE '%' || d.id || '%').
-- Canonical match requires storage_path = name, image_url = name, or exact suffix /documents/<name>.

-- 5.1 Storage SELECT
CREATE POLICY "Authorized Read Documents Bucket" ON storage.objects
FOR SELECT
USING (
    bucket_id = 'documents'
    AND (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR (
            public.is_principal()
            AND EXISTS (
                SELECT 1 FROM public.documents d 
                WHERE (
                    COALESCE(d.storage_path, '') = name
                    OR d.image_url = name
                    OR d.image_url LIKE '%/documents/' || name
                )
                AND d.school_id = public.get_auth_user_school_id()
            )
        )
        OR (
            public.is_approved_teacher() 
            AND (
                -- 1. Path embeds teacher active Class Adviser assignment UUID
                (
                    (storage.foldername(name))[1] = auth.uid()::text
                    AND array_length(storage.foldername(name), 1) >= 2
                    AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    AND public.can_teacher_scan_with_assignment(((storage.foldername(name))[2])::uuid)
                )
                OR
                -- 2. Storage object is linked to an accessible, non-archived document via canonical path
                EXISTS (
                    SELECT 1 FROM public.documents d 
                    WHERE (
                        COALESCE(d.storage_path, '') = name
                        OR d.image_url = name
                        OR d.image_url LIKE '%/documents/' || name
                    )
                    AND d.school_id = public.get_auth_user_school_id()
                    AND d.status != 'archived'
                    AND public.can_teacher_access_document(d.id)
                )
            )
        )
    )
);

-- 5.2 Storage INSERT: Admin and Principal are REVOKED.
CREATE POLICY "Authorized Upload Documents Bucket" ON storage.objects
FOR INSERT
WITH CHECK (
    bucket_id = 'documents'
    AND (
        auth.role() = 'service_role'
        OR (
            public.is_approved_teacher()
            AND (storage.foldername(name))[1] = auth.uid()::text
            AND (
                -- 1. Exact active assignment UUID embedded in path: <userId>/<assignmentId>/...
                (
                    array_length(storage.foldername(name), 1) >= 2
                    AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    AND public.can_teacher_scan_with_assignment(((storage.foldername(name))[2])::uuid)
                )
                OR
                -- 2. Linked document pre-registered in public.documents with canonical path
                EXISTS (
                    SELECT 1 FROM public.documents d
                    WHERE d.uploaded_by = auth.uid()::text
                      AND d.school_id = public.get_auth_user_school_id()
                      AND d.teacher_assignment_id IS NOT NULL
                      AND public.can_teacher_scan_with_assignment(d.teacher_assignment_id)
                      AND (
                          COALESCE(d.storage_path, '') = name
                          OR d.image_url = name
                          OR d.image_url LIKE '%/documents/' || name
                      )
                )
            )
        )
    )
);

-- 5.3 Storage UPDATE: Explicit identical WITH CHECK prevents path moving or renames outside assignment
CREATE POLICY "Authorized Update Documents Bucket" ON storage.objects
FOR UPDATE
USING (
    bucket_id = 'documents'
    AND (
        auth.role() = 'service_role'
        OR (
            public.is_approved_teacher()
            AND (storage.foldername(name))[1] = auth.uid()::text
            AND (
                (
                    array_length(storage.foldername(name), 1) >= 2
                    AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    AND public.can_teacher_scan_with_assignment(((storage.foldername(name))[2])::uuid)
                )
                OR
                EXISTS (
                    SELECT 1 FROM public.documents d
                    WHERE d.uploaded_by = auth.uid()::text
                      AND d.school_id = public.get_auth_user_school_id()
                      AND d.teacher_assignment_id IS NOT NULL
                      AND public.can_teacher_scan_with_assignment(d.teacher_assignment_id)
                      AND (
                          COALESCE(d.storage_path, '') = name
                          OR d.image_url = name
                          OR d.image_url LIKE '%/documents/' || name
                      )
                )
            )
        )
    )
)
WITH CHECK (
    bucket_id = 'documents'
    AND (
        auth.role() = 'service_role'
        OR (
            public.is_approved_teacher()
            AND (storage.foldername(name))[1] = auth.uid()::text
            AND (
                (
                    array_length(storage.foldername(name), 1) >= 2
                    AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    AND public.can_teacher_scan_with_assignment(((storage.foldername(name))[2])::uuid)
                )
                OR
                EXISTS (
                    SELECT 1 FROM public.documents d
                    WHERE d.uploaded_by = auth.uid()::text
                      AND d.school_id = public.get_auth_user_school_id()
                      AND d.teacher_assignment_id IS NOT NULL
                      AND public.can_teacher_scan_with_assignment(d.teacher_assignment_id)
                      AND (
                          COALESCE(d.storage_path, '') = name
                          OR d.image_url = name
                          OR d.image_url LIKE '%/documents/' || name
                      )
                )
            )
        )
    )
);

-- 5.4 Storage DELETE: Hard delete strictly restricted to service_role
CREATE POLICY "Authorized Delete Documents Bucket" ON storage.objects
FOR DELETE
USING (
    bucket_id = 'documents'
    AND auth.role() = 'service_role'
);


-- ------------------------------------------------------------------------------
-- 6. HARDEN RPC FUNCTION public.archive_review_document
-- ------------------------------------------------------------------------------
-- Overload cleanup
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
    v_teacher_name TEXT;
    v_formatted_doc_type TEXT;
    v_now TIMESTAMPTZ := now();
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: User not authenticated.';
    END IF;

    IF TRIM(p_confirmation_phrase) != 'I am deleting this' THEN
        RAISE EXCEPTION 'Invalid confirmation phrase. Exactly "I am deleting this" is required.';
    END IF;

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

    IF LOWER(v_caller_role) IN ('admin', 'administrator') THEN
        RAISE EXCEPTION 'Forbidden: Administrator role cannot delete student documents. Document deletion is restricted to authorized teachers.';
    END IF;

    IF LOWER(v_caller_role) = 'principal' THEN
        RAISE EXCEPTION 'Forbidden: Principal role is monitoring-only and cannot delete review records.';
    END IF;

    IF LOWER(v_caller_role) != 'teacher' THEN
        RAISE EXCEPTION 'Forbidden: Role % is not authorized to delete review records.', v_caller_role;
    END IF;

    IF v_caller_school IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Caller school cannot be verified. Teachers must have an assigned school to delete review queue records.';
    END IF;

    SELECT * INTO v_doc
    FROM public.documents
    WHERE id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document not found.';
    END IF;

    IF v_doc.status = 'archived' THEN
        RAISE EXCEPTION 'Document is already archived.';
    END IF;

    IF v_doc.status != 'needs_review' THEN
        RAISE EXCEPTION 'Document is not eligible for review deletion (Current status: %). Only records in needs_review state can be deleted.', v_doc.status;
    END IF;

    IF v_doc.school_id IS NULL THEN
        RAISE EXCEPTION 'Verification error: Document school_id is missing. Cannot verify advisory assignment.';
    END IF;

    IF v_caller_school != v_doc.school_id THEN
        RAISE EXCEPTION 'Forbidden: Cannot delete document belonging to another school.';
    END IF;

    -- Strict non-null metadata check: If not directly linked via teacher_assignment_id,
    -- required routing fields must be populated to verify advisory assignment.
    IF v_doc.teacher_assignment_id IS NULL AND (
        v_doc.section IS NULL OR TRIM(v_doc.section) = '' OR
        v_doc.school_year IS NULL OR TRIM(v_doc.school_year) = '' OR
        v_doc.grade_level IS NULL OR TRIM(v_doc.grade_level) = ''
    ) THEN
        RAISE EXCEPTION 'Verification error: Document metadata (school_year, grade_level, section) is incomplete. Cannot verify advisory assignment.';
    END IF;

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
        RAISE EXCEPTION 'Forbidden: Teachers may only delete documents belonging to their officially assigned active advisory section.';
    END IF;

    SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_id;
    IF v_doc.school_id IS NOT NULL THEN
        SELECT name INTO v_school_name FROM public.schools WHERE id = v_doc.school_id;
    END IF;

    SELECT teacher_name INTO v_teacher_name
    FROM public.teacher_assignments
    WHERE teacher_user_id = v_caller_id AND assignment_status = 'active'
    LIMIT 1;

    IF v_teacher_name IS NULL THEN
        v_teacher_name := COALESCE(v_caller_email, 'Teacher');
    END IF;

    v_formatted_doc_type := UPPER(COALESCE(v_doc.document_type, 'DOCUMENT'));
    IF v_formatted_doc_type = 'BIRTH_CERT' THEN
        v_formatted_doc_type := 'PSA';
    END IF;

    -- Authorize the archival trigger for this specific document within this transaction
    PERFORM set_config('avv.document_archival_authorized', p_document_id::text, true);

    UPDATE public.documents
    SET status = 'archived',
        archived_at = v_now,
        archived_by = v_caller_id,
        updated_at = v_now
    WHERE id = p_document_id;

    -- Atomic audit log insertion within SECURITY DEFINER context
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
        'DOCUMENT_ARCHIVED',
        'document',
        p_document_id::text,
        v_formatted_doc_type || ' - ' || COALESCE(v_doc.original_filename, p_document_id::text),
        'SUCCESS',
        'Teacher ' || v_teacher_name || ' archived document from review queue (soft deletion)',
        jsonb_build_object(
            'teacher_name', v_teacher_name,
            'teacher_user_id', v_caller_id,
            'action', 'DOCUMENT_ARCHIVED',
            'deletion_type', 'soft_deletion (archived)',
            'document_type', v_formatted_doc_type,
            'document_id', p_document_id::text,
            'original_filename', v_doc.original_filename,
            'archived_at', v_now,
            'deleted_at', v_now,
            'school_year', v_doc.school_year,
            'section', v_doc.section,
            'grade_level', v_doc.grade_level
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'document_id', p_document_id,
        'new_status', 'archived',
        'archived_at', v_now,
        'archived_by', v_caller_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.archive_review_document(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_review_document(UUID, TEXT) TO authenticated, service_role;


-- 6.2 resolve_document_identity_conflict: Authorized manual identity-conflict resolution RPC
-- Admin is forbidden from processing student documents. Restricted to authorized Teachers with matching advisory assignment.
DROP FUNCTION IF EXISTS public.resolve_document_identity_conflict(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.resolve_document_identity_conflict(
    p_document_id UUID,
    p_verified_lrn TEXT,
    p_verified_first_name TEXT,
    p_verified_last_name TEXT,
    p_verified_middle_name TEXT DEFAULT NULL,
    p_resolution_reason TEXT DEFAULT NULL,
    p_resolution_action TEXT DEFAULT 'VERIFY_LRN_AND_IDENTITY'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_email TEXT;
    v_actor_role TEXT;
    v_actor_status TEXT;
    v_actor_school_id UUID;
    v_school_name TEXT;
    v_doc RECORD;
    v_clean_lrn TEXT;
    v_clean_first TEXT;
    v_clean_last TEXT;
    v_clean_middle TEXT;
    v_clean_reason TEXT;
    v_existing_student RECORD;
    v_updated_fields JSONB;
    v_now TIMESTAMPTZ := now();
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required to resolve document identity conflict.'
            USING ERRCODE = '42501';
    END IF;

    SELECT role, account_status, school_id
    INTO v_actor_role, v_actor_status, v_actor_school_id
    FROM public.user_roles
    WHERE user_id = v_actor_id
    LIMIT 1;

    IF v_actor_role IS NULL THEN
        RAISE EXCEPTION 'Forbidden: User profile not found.'
            USING ERRCODE = '42501';
    END IF;

    IF COALESCE(v_actor_status, '') <> 'Approved' THEN
        RAISE EXCEPTION 'Forbidden: Account is not approved (Status: %).', v_actor_status
            USING ERRCODE = '42501';
    END IF;

    -- Admin is forbidden from processing or modifying student documents
    IF LOWER(v_actor_role) IN ('admin', 'administrator') THEN
        RAISE EXCEPTION 'Forbidden: Administrator role cannot process student documents. Identity resolution is restricted to authorized teachers.'
            USING ERRCODE = '42501';
    END IF;

    -- Principal is monitoring-only
    IF LOWER(v_actor_role) = 'principal' THEN
        RAISE EXCEPTION 'Forbidden: Principal role is monitoring-only and cannot resolve document identity conflicts.'
            USING ERRCODE = '42501';
    END IF;

    IF LOWER(v_actor_role) != 'teacher' THEN
        RAISE EXCEPTION 'Forbidden: Role % is not authorized to resolve document identity conflicts.', v_actor_role
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_school_id IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Caller school cannot be verified.'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_doc
    FROM public.documents
    WHERE id = p_document_id
    FOR UPDATE;

    IF v_doc.id IS NULL THEN
        RAISE EXCEPTION 'Not Found: Document % does not exist.', p_document_id
            USING ERRCODE = 'P0002';
    END IF;

    IF v_doc.school_id IS NULL THEN
        RAISE EXCEPTION 'Verification error: Document school_id is missing. Cannot verify advisory assignment.'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_school_id <> v_doc.school_id THEN
        RAISE EXCEPTION 'Forbidden: Cross-school identity conflict resolution is prohibited.'
            USING ERRCODE = '42501';
    END IF;

    -- Teacher must have active Class Adviser assignment matching the document
    IF NOT public.can_teacher_access_document(p_document_id) THEN
        RAISE EXCEPTION 'Forbidden: Teachers may only resolve identity conflicts for documents belonging to their officially assigned active advisory section.'
            USING ERRCODE = '42501';
    END IF;

    -- Validation: Clean and verify 12-digit LRN
    v_clean_lrn := REGEXP_REPLACE(TRIM(COALESCE(p_verified_lrn, '')), '[^0-9]', '', 'g');
    IF v_clean_lrn !~ '^[0-9]{12}$' THEN
        RAISE EXCEPTION 'Validation Failed: A valid 12-digit LRN is required to resolve identity conflict.'
            USING ERRCODE = '23514';
    END IF;

    v_clean_first := NULLIF(TRIM(COALESCE(p_verified_first_name, '')), '');
    v_clean_last := NULLIF(TRIM(COALESCE(p_verified_last_name, '')), '');
    v_clean_middle := NULLIF(TRIM(COALESCE(p_verified_middle_name, '')), '');
    v_clean_reason := NULLIF(TRIM(COALESCE(p_resolution_reason, '')), '');

    IF v_clean_first IS NULL OR v_clean_last IS NULL OR UPPER(v_clean_first) = 'UNKNOWN' OR UPPER(v_clean_last) = 'UNKNOWN' THEN
        RAISE EXCEPTION 'Validation Failed: Verified first_name and last_name are required.'
            USING ERRCODE = '23514';
    END IF;

    IF v_clean_reason IS NULL OR LENGTH(v_clean_reason) < 10 THEN
        RAISE EXCEPTION 'Validation Failed: A detailed verification reason (at least 10 characters) is required for audit compliance.'
            USING ERRCODE = '23514';
    END IF;

    -- Cross-school student conflict check
    SELECT id, school_id, first_name, last_name
    INTO v_existing_student
    FROM public.students
    WHERE lrn = v_clean_lrn
    LIMIT 1;

    IF v_existing_student.id IS NOT NULL THEN
        IF v_existing_student.school_id <> v_doc.school_id THEN
            RAISE EXCEPTION 'Cross-school student conflict: LRN % belongs to another school.', v_clean_lrn
                USING ERRCODE = '23505';
        END IF;

        IF LOWER(REGEXP_REPLACE(v_clean_last, '[^a-zA-Z]', '', 'g')) <> LOWER(REGEXP_REPLACE(v_existing_student.last_name, '[^a-zA-Z]', '', 'g'))
           AND COALESCE(p_resolution_action, '') <> 'CONFIRM_SAME_STUDENT_NAME_CORRECTION' THEN
            RAISE EXCEPTION 'Identity Collision Unresolved: LRN % is registered to %, which still conflicts with verified last name %. Provide a distinct verified LRN or explicit CONFIRM_SAME_STUDENT_NAME_CORRECTION.',
                v_clean_lrn, v_existing_student.last_name, v_clean_last
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Set transaction-local GUC strictly scoped to this document ID
    PERFORM set_config('avv.conflict_resolution_authorized', p_document_id::text, true);

    v_updated_fields := COALESCE(v_doc.extracted_fields, '{}'::jsonb)
        || jsonb_build_object(
            'lrn', v_clean_lrn,
            'first_name', v_clean_first,
            'last_name', v_clean_last,
            'middle_name', COALESCE(v_clean_middle, v_doc.extracted_fields->>'middle_name', ''),
            'name', v_clean_last || ', ' || v_clean_first || CASE WHEN v_clean_middle IS NOT NULL THEN ' ' || v_clean_middle ELSE '' END,
            'identity_conflict', false,
            'manual_lrn_verification_required', false,
            'lrn_conflict_verified', true,
            'identity_conflict_resolution', jsonb_build_object(
                'verified_by', v_actor_id,
                'verified_role', v_actor_role,
                'verified_at', v_now,
                'verified_lrn', v_clean_lrn,
                'verified_first_name', v_clean_first,
                'verified_last_name', v_clean_last,
                'previous_lrn', v_doc.extracted_fields->>'lrn',
                'previous_name', v_doc.extracted_fields->>'name',
                'resolution_action', p_resolution_action,
                'reason', v_clean_reason
            )
        );

    -- Execute update
    UPDATE public.documents
    SET extracted_fields = v_updated_fields,
        updated_at = v_now
    WHERE id = p_document_id;

    -- Clear GUC immediately to ensure single-use (transaction-local)
    PERFORM set_config('avv.conflict_resolution_authorized', '', true);

    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor_id;
    SELECT name INTO v_school_name FROM public.schools WHERE id = v_doc.school_id;

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
        v_actor_id,
        v_actor_email,
        'teacher',
        v_actor_school_id,
        COALESCE(v_school_name, 'Taysan Resettlement Integrated School (500169)'),
        v_doc.school_id,
        'DOCUMENT',
        'DOCUMENT_IDENTITY_CONFLICT_RESOLVED',
        'document',
        p_document_id::text,
        'Identity Conflict Resolved - ' || COALESCE(v_doc.original_filename, p_document_id::text),
        'SUCCESS',
        v_clean_reason,
        jsonb_build_object(
            'document_id', p_document_id,
            'verified_lrn', v_clean_lrn,
            'verified_first_name', v_clean_first,
            'verified_last_name', v_clean_last,
            'resolution_action', p_resolution_action,
            'verified_at', v_now
        )
    );

    RETURN jsonb_build_object(
        'status', 'SUCCESS',
        'document_id', p_document_id,
        'verified_lrn', v_clean_lrn,
        'verified_by', v_actor_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_document_identity_conflict(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_document_identity_conflict(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 7. CHILD ROSTER TABLES & AUDIT LOGS (READ-ONLY FOR USERS, SERVICE_ROLE WRITES)
-- ------------------------------------------------------------------------------
-- Direct client INSERT/UPDATE/DELETE is strictly revoked.
-- SELECT access requires matching the exact active advisory assignment, including school_year.

DO $$
BEGIN
    -- 7.1 public.sf1_roster_entries
    IF to_regclass('public.sf1_roster_entries') IS NOT NULL THEN
        CREATE POLICY "Service role full access on sf1_roster_entries"
            ON public.sf1_roster_entries FOR ALL TO service_role
            USING (true) WITH CHECK (true);

        CREATE POLICY "Authorized read sf1_roster_entries"
            ON public.sf1_roster_entries FOR SELECT TO authenticated
            USING (
                public.is_admin()
                OR (
                    public.is_principal()
                    AND sf1_roster_entries.school_id = public.get_auth_user_school_id()
                )
                OR (
                    public.is_approved_teacher()
                    AND public.can_teacher_access_section(
                        sf1_roster_entries.school_id,
                        sf1_roster_entries.school_year,
                        sf1_roster_entries.grade_level,
                        sf1_roster_entries.section
                    )
                )
            );
    END IF;

    -- 7.2 public.sf2_attendance_entries
    IF to_regclass('public.sf2_attendance_entries') IS NOT NULL THEN
        CREATE POLICY "Service role full access on sf2_attendance_entries"
            ON public.sf2_attendance_entries FOR ALL TO service_role
            USING (true) WITH CHECK (true);

        CREATE POLICY "Authorized read sf2_attendance_entries"
            ON public.sf2_attendance_entries FOR SELECT TO authenticated
            USING (
                public.is_admin()
                OR (
                    public.is_principal()
                    AND sf2_attendance_entries.school_id = public.get_auth_user_school_id()
                )
                OR (
                    public.is_approved_teacher()
                    AND public.can_teacher_access_section(
                        sf2_attendance_entries.school_id,
                        sf2_attendance_entries.school_year,
                        sf2_attendance_entries.grade_level,
                        sf2_attendance_entries.section
                    )
                )
            );
    END IF;

    -- 7.3 public.sf5_promotion_entries
    IF to_regclass('public.sf5_promotion_entries') IS NOT NULL THEN
        CREATE POLICY "Service role full access on sf5_promotion_entries"
            ON public.sf5_promotion_entries FOR ALL TO service_role
            USING (true) WITH CHECK (true);

        CREATE POLICY "Authorized read sf5_promotion_entries"
            ON public.sf5_promotion_entries FOR SELECT TO authenticated
            USING (
                public.is_admin()
                OR (
                    public.is_principal()
                    AND sf5_promotion_entries.school_id = public.get_auth_user_school_id()
                )
                OR (
                    public.is_approved_teacher()
                    AND public.can_teacher_access_section(
                        sf5_promotion_entries.school_id,
                        sf5_promotion_entries.school_year,
                        sf5_promotion_entries.grade_level,
                        sf5_promotion_entries.section
                    )
                )
            );
    END IF;

    -- 7.4 public.psa_identity_records
    IF to_regclass('public.psa_identity_records') IS NOT NULL THEN
        CREATE POLICY "Service role full access on psa_identity_records"
            ON public.psa_identity_records FOR ALL TO service_role
            USING (true) WITH CHECK (true);

        CREATE POLICY "Authorized read psa_identity_records"
            ON public.psa_identity_records FOR SELECT TO authenticated
            USING (
                public.is_admin()
                OR (
                    public.is_principal()
                    AND psa_identity_records.school_id = public.get_auth_user_school_id()
                )
                OR (
                    public.is_approved_teacher()
                    AND (
                        student_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1 FROM public.student_enrollments se
                            WHERE se.student_id = psa_identity_records.student_id
                              AND se.school_id = psa_identity_records.school_id
                              AND se.enrollment_status = 'active'
                              AND public.can_teacher_access_section(se.school_id, se.school_year, se.grade_level, se.section)
                        )
                    )
                )
            );
    END IF;

    -- 7.5 public.cross_document_validations
    IF to_regclass('public.cross_document_validations') IS NOT NULL THEN
        CREATE POLICY "Service role full access on cross_document_validations"
            ON public.cross_document_validations FOR ALL TO service_role
            USING (true) WITH CHECK (true);

        CREATE POLICY "Authorized read cross_document_validations"
            ON public.cross_document_validations FOR SELECT TO authenticated
            USING (
                public.is_admin()
                OR (
                    public.is_principal()
                    AND cross_document_validations.school_id = public.get_auth_user_school_id()
                )
                OR (
                    public.is_approved_teacher()
                    AND (
                        student_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1 FROM public.student_enrollments se
                            WHERE se.student_id = cross_document_validations.student_id
                              AND se.school_id = cross_document_validations.school_id
                              AND se.enrollment_status = 'active'
                              AND public.can_teacher_access_section(se.school_id, se.school_year, se.grade_level, se.section)
                        )
                    )
                )
            );
    END IF;

    -- 7.6 public.field_extraction_traces
    IF to_regclass('public.field_extraction_traces') IS NOT NULL THEN
        CREATE POLICY "Service role full access on field_extraction_traces"
            ON public.field_extraction_traces FOR ALL TO service_role
            USING (true) WITH CHECK (true);

        CREATE POLICY "Authorized read field_extraction_traces"
            ON public.field_extraction_traces FOR SELECT TO authenticated
            USING (
                public.is_admin()
                OR (
                    public.is_principal()
                    AND EXISTS (
                        SELECT 1 FROM public.documents d
                        WHERE d.id = field_extraction_traces.document_id
                          AND d.school_id = public.get_auth_user_school_id()
                    )
                )
                OR (
                    public.is_approved_teacher()
                    AND public.can_teacher_access_document(document_id)
                )
            );
    END IF;

    -- 7.7 public.audit_logs: Approved Admins and service_role can view; NO client INSERT
    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        CREATE POLICY "Approved admins can view audit logs"
            ON public.audit_logs FOR SELECT TO authenticated
            USING (
                public.is_admin()
                OR auth.role() = 'service_role'
            );
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 8. TABLE-LEVEL AND COLUMN-LEVEL PRIVILEGE HARDENING (DAC)
-- ------------------------------------------------------------------------------

-- 8.1 public.documents: Revoke hard DELETE from authenticated users
REVOKE ALL ON TABLE public.documents FROM PUBLIC, anon;
REVOKE DELETE ON TABLE public.documents FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.documents TO authenticated;
GRANT ALL ON TABLE public.documents TO service_role;

-- 8.2 Child Roster Tables: Revoke all writes from authenticated users; SELECT only
DO $$
BEGIN
    IF to_regclass('public.sf1_roster_entries') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.sf1_roster_entries FROM PUBLIC, anon;
        REVOKE INSERT, UPDATE, DELETE ON TABLE public.sf1_roster_entries FROM authenticated;
        GRANT SELECT ON TABLE public.sf1_roster_entries TO authenticated;
        GRANT ALL ON TABLE public.sf1_roster_entries TO service_role;
    END IF;

    IF to_regclass('public.sf2_attendance_entries') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.sf2_attendance_entries FROM PUBLIC, anon;
        REVOKE INSERT, UPDATE, DELETE ON TABLE public.sf2_attendance_entries FROM authenticated;
        GRANT SELECT ON TABLE public.sf2_attendance_entries TO authenticated;
        GRANT ALL ON TABLE public.sf2_attendance_entries TO service_role;
    END IF;

    IF to_regclass('public.sf5_promotion_entries') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.sf5_promotion_entries FROM PUBLIC, anon;
        REVOKE INSERT, UPDATE, DELETE ON TABLE public.sf5_promotion_entries FROM authenticated;
        GRANT SELECT ON TABLE public.sf5_promotion_entries TO authenticated;
        GRANT ALL ON TABLE public.sf5_promotion_entries TO service_role;
    END IF;

    IF to_regclass('public.psa_identity_records') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.psa_identity_records FROM PUBLIC, anon;
        REVOKE INSERT, UPDATE, DELETE ON TABLE public.psa_identity_records FROM authenticated;
        GRANT SELECT ON TABLE public.psa_identity_records TO authenticated;
        GRANT ALL ON TABLE public.psa_identity_records TO service_role;
    END IF;

    IF to_regclass('public.cross_document_validations') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.cross_document_validations FROM PUBLIC, anon;
        REVOKE INSERT, UPDATE, DELETE ON TABLE public.cross_document_validations FROM authenticated;
        GRANT SELECT ON TABLE public.cross_document_validations TO authenticated;
        GRANT ALL ON TABLE public.cross_document_validations TO service_role;
    END IF;

    IF to_regclass('public.field_extraction_traces') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.field_extraction_traces FROM PUBLIC, anon;
        REVOKE INSERT, UPDATE, DELETE ON TABLE public.field_extraction_traces FROM authenticated;
        GRANT SELECT ON TABLE public.field_extraction_traces TO authenticated;
        GRANT ALL ON TABLE public.field_extraction_traces TO service_role;
    END IF;
END $$;

-- 8.3 public.audit_logs: ZERO INSERT/UPDATE/DELETE for authenticated users; service_role only
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

-- 8.4 storage.objects: Revoke DELETE from authenticated
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
        REVOKE DELETE ON TABLE storage.objects FROM authenticated;
        GRANT SELECT, INSERT, UPDATE ON TABLE storage.objects TO authenticated;
        GRANT ALL ON TABLE storage.objects TO service_role;
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 9. RELOAD POSTGREST SCHEMA CACHE
-- ------------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

COMMIT;

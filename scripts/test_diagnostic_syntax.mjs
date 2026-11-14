import { PGlite } from "@electric-sql/pglite";

async function validateDiagnosticQuery() {
  const db = new PGlite();

  // Test SQL syntax
  const query = `
    SELECT 
      cat.category,
      cat.target_object,
      cat.expected_in,
      cat.current_status,
      cat.description
    FROM (
      -- 1. Tables & Views
      SELECT '1. TABLE / VIEW' AS category, 'public.audit_logs' AS target_object, 'Migration 014' AS expected_in,
             CASE WHEN to_regclass('public.audit_logs') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END AS current_status,
             'Immutable administrative audit log table' AS description
      UNION ALL
      SELECT '1. TABLE / VIEW', 'public.grade_change_history', 'Migration 015',
             CASE WHEN to_regclass('public.grade_change_history') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'Immutable grade correction audit trail table'
      UNION ALL
      SELECT '1. TABLE / VIEW', 'public.v_duplicate_students_report', 'Migration 015',
             CASE WHEN to_regclass('public.v_duplicate_students_report') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'Administrative report view for duplicate LRN detection'

      -- 2. Tracking Columns
      UNION ALL
      SELECT '2. COLUMN', 'public.documents.reviewed_by', 'Migration 014 & 015',
             CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'reviewed_by') THEN 'EXISTS' ELSE 'MISSING' END,
             'UUID referencing auth.users(id) for reviewer attribution'
      UNION ALL
      SELECT '2. COLUMN', 'public.documents.last_operation_id', 'Migration 014',
             CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'last_operation_id') THEN 'EXISTS' ELSE 'MISSING' END,
             'TEXT column for idempotent operation deduplication'
      UNION ALL
      SELECT '2. COLUMN', 'public.user_roles.updated_by', 'Migration 014',
             CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'updated_by') THEN 'EXISTS' ELSE 'MISSING' END,
             'UUID referencing auth.users(id) for admin role change audit'
      UNION ALL
      SELECT '2. COLUMN', 'public.user_roles.last_operation_id', 'Migration 014',
             CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'last_operation_id') THEN 'EXISTS' ELSE 'MISSING' END,
             'TEXT column for role update deduplication'

      -- 3. Constraints
      UNION ALL
      SELECT '3. CONSTRAINT', 'chk_students_lrn_format on public.students', 'Migration 015',
             CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_students_lrn_format') THEN 'EXISTS' ELSE 'MISSING' END,
             'CHECK constraint enforcing strict 12-digit numeric LRN'

      -- 4. Unique & Performance Indexes
      UNION ALL
      SELECT '4. INDEX', 'idx_students_normalized_lrn', 'Migration 015',
             CASE WHEN to_regclass('public.idx_students_normalized_lrn') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'UNIQUE functional index on stripped 12-digit LRN'
      UNION ALL
      SELECT '4. INDEX', 'idx_subject_grades_composite_active', 'Migration 015',
             CASE WHEN to_regclass('public.idx_subject_grades_composite_active') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'UNIQUE index on (student_id, school_year, semester, subject)'
      UNION ALL
      SELECT '4. INDEX', 'idx_audit_logs_created_at', 'Migration 014',
             CASE WHEN to_regclass('public.idx_audit_logs_created_at') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'B-Tree index on audit_logs(created_at DESC)'
      UNION ALL
      SELECT '4. INDEX', 'idx_grade_change_hist_student', 'Migration 015',
             CASE WHEN to_regclass('public.idx_grade_change_hist_student') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'B-Tree index on grade_change_history(student_id)'

      -- 5. Functions
      UNION ALL
      SELECT '5. FUNCTION', 'public.record_audit_event()', 'Migration 014',
             CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_audit_event' AND pronamespace = 'public'::regnamespace) THEN 'EXISTS' ELSE 'MISSING' END,
             'Authoritative server-side event logging function'
      UNION ALL
      SELECT '5. FUNCTION', 'public.prevent_audit_log_modification()', 'Migration 014',
             CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'prevent_audit_log_modification' AND pronamespace = 'public'::regnamespace) THEN 'EXISTS' ELSE 'MISSING' END,
             'Immutability guard trigger function'
      UNION ALL
      SELECT '5. FUNCTION', 'public.lookup_student_by_lrn()', 'Migration 015',
             CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lookup_student_by_lrn' AND pronamespace = 'public'::regnamespace) THEN 'EXISTS' ELSE 'MISSING' END,
             'LRN resolution function respecting school isolation'
      UNION ALL
      SELECT '5. FUNCTION', 'public.process_approved_document()', 'Baseline / 015',
             CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_approved_document' AND pronamespace = 'public'::regnamespace) THEN 'EXISTS' ELSE 'MISSING' END,
             'Core DepEd approval trigger function'

      -- 6. Triggers
      UNION ALL
      SELECT '6. TRIGGER', 'trg_audit_logs_immutable on public.audit_logs', 'Migration 014',
             CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_immutable') THEN 'EXISTS' ELSE 'MISSING' END,
             'Prevents UPDATE or DELETE on audit logs'
      UNION ALL
      SELECT '6. TRIGGER', 'trg_audit_user_roles_transition on public.user_roles', 'Migration 014',
             CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_user_roles_transition') THEN 'EXISTS' ELSE 'MISSING' END,
             'Captures role and account status changes'
      UNION ALL
      SELECT '6. TRIGGER', 'trg_audit_document_decision on public.documents', 'Migration 014',
             CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_document_decision') THEN 'EXISTS' ELSE 'MISSING' END,
             'Captures document approval and review decisions'

      -- 7. RLS Policies
      UNION ALL
      SELECT '7. RLS POLICY', 'Approved admins can view audit logs', 'Migration 014',
             CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'Approved admins can view audit logs') THEN 'EXISTS' ELSE 'MISSING' END,
             'Restricts audit viewing to approved admins'
      UNION ALL
      SELECT '7. RLS POLICY', 'Authorized read grade_change_history', 'Migration 015',
             CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'grade_change_history' AND policyname = 'Authorized read grade_change_history') THEN 'EXISTS' ELSE 'MISSING' END,
             'Restricts grade history to authorized educators'

      -- 8. Production Row Preservation Checks
      UNION ALL
      SELECT '8. DATA PRESERVATION', 'public.schools count', 'Baseline',
             (SELECT count(*)::text FROM (SELECT 1 FROM public.schools LIMIT 10) s),
             'Real schools count (Expected: 1)'
      UNION ALL
      SELECT '8. DATA PRESERVATION', 'public.user_roles count', 'Baseline',
             (SELECT count(*)::text FROM (SELECT 1 FROM public.user_roles LIMIT 10) ur),
             'Real user roles count (Expected: 5)'
      UNION ALL
      SELECT '8. DATA PRESERVATION', 'public.documents count', 'Baseline',
             (SELECT count(*)::text FROM (SELECT 1 FROM public.documents LIMIT 10) d),
             'Real documents count (Expected: 4)'
      UNION ALL
      SELECT '8. DATA PRESERVATION', 'public.students count', 'Baseline',
             (SELECT count(*)::text FROM (SELECT 1 FROM public.students LIMIT 10) st),
             'Active students count (Expected: 0)'
    ) cat
    ORDER BY cat.category, cat.target_object;
  `;

  // First create baseline tables so the query can run
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS public.schools (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE IF NOT EXISTS public.user_roles (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE IF NOT EXISTS public.documents (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE IF NOT EXISTS public.students (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  `);

  const res = await db.query(query);
  console.log("Diagnostic query syntax is 100% valid! Returned rows:", res.rows.length);
}

validateDiagnosticQuery().catch(console.error);

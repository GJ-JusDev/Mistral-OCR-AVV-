import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

async function testDiagnostic() {
  const db = new PGlite();

  // Create baseline mock schema
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      school_id TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      role user_role NOT NULL DEFAULT 'teacher',
      account_status TEXT NOT NULL DEFAULT 'Pending',
      school_id UUID REFERENCES public.schools(id)
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id),
      lrn TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification'
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      school_id UUID REFERENCES public.schools(id),
      document_type TEXT NOT NULL DEFAULT 'SF9',
      status TEXT NOT NULL DEFAULT 'needs_review',
      reviewed_by UUID REFERENCES auth.users(id) -- simulating the one column that exists!
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id),
      document_id UUID REFERENCES public.documents(id),
      school_year TEXT,
      semester TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
      final_grade NUMERIC,
      status TEXT DEFAULT 'Missing'
    );
  `);

  console.log("Baseline initialized. Testing Diagnostic SQL Query...");

  const diagnosticSql = `
    WITH catalog_check AS (
      -- 1. Tables & Views
      SELECT 'TABLE/VIEW' AS object_category, 'public.audit_logs' AS object_name,
             CASE WHEN to_regclass('public.audit_logs') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END AS status,
             'Migration 014 Core Table' AS notes
      UNION ALL
      SELECT 'TABLE/VIEW', 'public.grade_change_history',
             CASE WHEN to_regclass('public.grade_change_history') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 015 Core Table'
      UNION ALL
      SELECT 'TABLE/VIEW', 'public.v_duplicate_students_report',
             CASE WHEN to_regclass('public.v_duplicate_students_report') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 015 Admin View'

      -- 2. Columns
      UNION ALL
      SELECT 'COLUMN', 'public.documents.reviewed_by',
             CASE WHEN EXISTS (
               SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'reviewed_by'
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 & 015 Tracking Column'
      UNION ALL
      SELECT 'COLUMN', 'public.documents.last_operation_id',
             CASE WHEN EXISTS (
               SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'last_operation_id'
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 Operation Id Column'
      UNION ALL
      SELECT 'COLUMN', 'public.user_roles.updated_by',
             CASE WHEN EXISTS (
               SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'updated_by'
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 Updater Column'
      UNION ALL
      SELECT 'COLUMN', 'public.user_roles.last_operation_id',
             CASE WHEN EXISTS (
               SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'last_operation_id'
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 Operation Id Column'

      -- 3. Constraints
      UNION ALL
      SELECT 'CONSTRAINT', 'chk_students_lrn_format',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_constraint WHERE conname = 'chk_students_lrn_format'
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 015 12-digit LRN CHECK constraint'

      -- 4. Indexes
      UNION ALL
      SELECT 'INDEX', 'idx_students_normalized_lrn',
             CASE WHEN to_regclass('public.idx_students_normalized_lrn') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 015 Normalized LRN UNIQUE Index'
      UNION ALL
      SELECT 'INDEX', 'idx_subject_grades_composite_active',
             CASE WHEN to_regclass('public.idx_subject_grades_composite_active') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 015 Grade Composite UNIQUE Index'
      UNION ALL
      SELECT 'INDEX', 'idx_audit_logs_created_at',
             CASE WHEN to_regclass('public.idx_audit_logs_created_at') IS NOT NULL THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 Audit Timestamp Index'

      -- 5. Functions
      UNION ALL
      SELECT 'FUNCTION', 'public.record_audit_event()',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_proc WHERE proname = 'record_audit_event' AND pronamespace = 'public'::regnamespace
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 Event Logger Function'
      UNION ALL
      SELECT 'FUNCTION', 'public.prevent_audit_log_modification()',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_proc WHERE proname = 'prevent_audit_log_modification' AND pronamespace = 'public'::regnamespace
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 Immutability Guard Function'
      UNION ALL
      SELECT 'FUNCTION', 'public.lookup_student_by_lrn(text)',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_proc WHERE proname = 'lookup_student_by_lrn' AND pronamespace = 'public'::regnamespace
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 015 Student Lookup Function'
      UNION ALL
      SELECT 'FUNCTION', 'public.process_approved_document()',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_proc WHERE proname = 'process_approved_document' AND pronamespace = 'public'::regnamespace
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Document Processing Trigger Function'

      -- 6. Triggers
      UNION ALL
      SELECT 'TRIGGER', 'trg_audit_logs_immutable on public.audit_logs',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_immutable'
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 Immutability Trigger'
      UNION ALL
      SELECT 'TRIGGER', 'trg_audit_user_roles_transition on public.user_roles',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_user_roles_transition'
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 User Role Change Audit Trigger'
      UNION ALL
      SELECT 'TRIGGER', 'trg_audit_document_decision on public.documents',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_document_decision'
             ) THEN 'EXISTS' ELSE 'MISSING' END,
             'Migration 014 Document Decision Audit Trigger'
    )
    SELECT object_category, object_name, status, notes
    FROM catalog_check
    ORDER BY 
      CASE object_category 
        WHEN 'TABLE/VIEW' THEN 1 
        WHEN 'COLUMN' THEN 2 
        WHEN 'CONSTRAINT' THEN 3 
        WHEN 'INDEX' THEN 4 
        WHEN 'FUNCTION' THEN 5 
        WHEN 'TRIGGER' THEN 6 
        ELSE 7 
      END, object_name;
  `;

  const res = await db.query(diagnosticSql);
  console.log("Diagnostic Results (Simulated Baseline + reviewed_by):");
  console.table(res.rows);
}

testDiagnostic().catch(console.error);

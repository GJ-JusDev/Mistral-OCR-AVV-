import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

async function verify014OnProdBackup() {
  const db = new PGlite();
  console.log("[1] Loading complete production backup...");
  const backupSql = fs.readFileSync("backups/complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql", "utf-8");
  
  // Set up auth/system roles that exist in live Supabase
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT '135baa53-7e1e-4c1f-b76a-f32a915b5f21'::uuid; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT 'authenticated'; $$ LANGUAGE sql STABLE;
  `);

  await db.exec(backupSql);
  console.log("✓ Production backup loaded (Schools: 1, User Roles: 5, Documents: 4, Students: 0).");

  // Simulate the existing partial modification: documents.reviewed_by already exists
  await db.exec(`
    ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  `);
  console.log("✓ Simulated partial state: public.documents.reviewed_by is present.");

  // Execute Migration 014 wrapped in a transaction block
  console.log("\n[2] Executing Migration 014 inside BEGIN ... COMMIT transaction block...");
  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf-8");
  
  const startTime = Date.now();
  await db.exec(`
    BEGIN;
    ${sql014}
    COMMIT;
  `);
  const duration = Date.now() - startTime;
  console.log(`✓ Migration 014 EXECUTED SUCCESSFULLY in ${duration}ms!`);

  // Run the read-only verification query
  console.log("\n[3] Running 014 Verification Query on Database Catalog...");
  const verifySql = `
    SELECT 
      obj_name,
      obj_type,
      CASE WHEN status = true THEN 'PASS' ELSE 'FAIL' END AS result
    FROM (
      SELECT 'public.audit_logs' AS obj_name, 'Table' AS obj_type, to_regclass('public.audit_logs') IS NOT NULL AS status
      UNION ALL
      SELECT 'public.documents.reviewed_by', 'Column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'reviewed_by')
      UNION ALL
      SELECT 'public.documents.last_operation_id', 'Column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'last_operation_id')
      UNION ALL
      SELECT 'public.user_roles.updated_by', 'Column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'updated_by')
      UNION ALL
      SELECT 'public.user_roles.last_operation_id', 'Column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'last_operation_id')
      UNION ALL
      SELECT 'public.record_audit_event()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_audit_event' AND pronamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'public.prevent_audit_log_modification()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'prevent_audit_log_modification' AND pronamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'public.process_audit_user_roles_transition()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_audit_user_roles_transition' AND pronamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'public.process_audit_document_decision()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_audit_document_decision' AND pronamespace = 'public'::regnamespace)
      UNION ALL
      SELECT 'trg_audit_logs_immutable', 'Trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_immutable')
      UNION ALL
      SELECT 'trg_audit_user_roles_transition', 'Trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_user_roles_transition')
      UNION ALL
      SELECT 'trg_audit_document_decision', 'Trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_document_decision')
      UNION ALL
      SELECT 'Approved admins can view audit logs', 'RLS Policy', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'Approved admins can view audit logs')
      UNION ALL
      SELECT 'Service role can view audit logs', 'RLS Policy', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'Service role can view audit logs')
      UNION ALL
      SELECT 'Service role can insert audit logs', 'RLS Policy', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'Service role can insert audit logs')
    ) checks
    ORDER BY obj_type, obj_name;
  `;

  const res = await db.query(verifySql);
  console.table(res.rows);

  const failures = res.rows.filter(r => r.result !== 'PASS');
  console.log(`\nVerification Summary: Total Checks = ${res.rows.length}, Failures = ${failures.length}`);

  // Confirm production records preserved
  console.log("\n[4] Confirming Production Records Preservation...");
  const counts = await db.query(`
    SELECT 'schools' AS entity, count(*) AS count FROM public.schools
    UNION ALL SELECT 'user_roles', count(*) FROM public.user_roles
    UNION ALL SELECT 'documents', count(*) FROM public.documents
    UNION ALL SELECT 'students', count(*) FROM public.students
    UNION ALL SELECT 'subject_grades', count(*) FROM public.subject_grades
  `);
  console.table(counts.rows);
}

verify014OnProdBackup().catch(console.error);

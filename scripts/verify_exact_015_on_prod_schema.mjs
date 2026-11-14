import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

async function verify015OnProdSchema() {
  const db = new PGlite();
  console.log("[1] Initializing production schema with Migration 014 applied...");
  
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

  const backupSql = fs.readFileSync("backups/complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql", "utf-8");
  await db.exec(backupSql);

  // Define helper functions that exist on live Supabase
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin' AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'principal' AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'teacher' AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'principal', 'teacher') AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid();
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
  `);

  // Apply Migration 014
  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf-8");
  await db.exec(sql014);
  console.log("✓ Migration 014 established in test database.");

  // Execute Migration 015 wrapped in a transaction block
  console.log("\n[2] Executing Migration 015 inside BEGIN ... COMMIT transaction block...");
  const sql015 = fs.readFileSync("supabase/migrations/015_lrn_deduplication_and_grade_updates.sql", "utf-8");
  
  const startTime = Date.now();
  await db.exec(`
    BEGIN;
    ${sql015}
    COMMIT;
  `);
  const duration = Date.now() - startTime;
  console.log(`✓ Migration 015 EXECUTED SUCCESSFULLY in ${duration}ms!`);

  // Run the read-only verification query for 015
  console.log("\n[3] Running 015 Verification Query on Database Catalog...");
  const verify015Sql = `
    SELECT 
      obj_name,
      obj_type,
      CASE WHEN status = true THEN 'PASS' ELSE 'FAIL' END AS result
    FROM (
      SELECT 'public.grade_change_history' AS obj_name, 'Table' AS obj_type, to_regclass('public.grade_change_history') IS NOT NULL AS status
      UNION ALL SELECT 'public.v_duplicate_students_report', 'View', to_regclass('public.v_duplicate_students_report') IS NOT NULL
      UNION ALL SELECT 'chk_students_lrn_format', 'Constraint', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_students_lrn_format')
      UNION ALL SELECT 'idx_students_normalized_lrn', 'Index', to_regclass('public.idx_students_normalized_lrn') IS NOT NULL
      UNION ALL SELECT 'idx_subject_grades_composite_active', 'Index', to_regclass('public.idx_subject_grades_composite_active') IS NOT NULL
      UNION ALL SELECT 'idx_grade_change_hist_student', 'Index', to_regclass('public.idx_grade_change_hist_student') IS NOT NULL
      UNION ALL SELECT 'public.lookup_student_by_lrn()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lookup_student_by_lrn' AND pronamespace = 'public'::regnamespace)
      UNION ALL SELECT 'public.process_approved_document()', 'Function', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_approved_document' AND pronamespace = 'public'::regnamespace)
      UNION ALL SELECT 'trg_process_approved_document', 'Trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_process_approved_document')
      UNION ALL SELECT 'Authorized read grade_change_history', 'RLS Policy', EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'grade_change_history' AND policyname = 'Authorized read grade_change_history')
      UNION ALL SELECT 'v_duplicate_students_report (anon revoked)', 'Security', has_table_privilege('anon', 'public.v_duplicate_students_report', 'SELECT') = false
    ) checks
    ORDER BY obj_type, obj_name;
  `;

  const res = await db.query(verify015Sql);
  console.table(res.rows);

  const failures = res.rows.filter(r => r.result !== 'PASS');
  console.log(`\n015 Verification Summary: Total Checks = ${res.rows.length}, Failures = ${failures.length}`);

  // Confirm production records preserved
  console.log("\n[4] Confirming Production Records Preservation...");
  const counts = await db.query(`
    SELECT 'schools' AS entity, count(*) AS count FROM public.schools
    UNION ALL SELECT 'user_roles', count(*) FROM public.user_roles
    UNION ALL SELECT 'documents', count(*) FROM public.documents
    UNION ALL SELECT 'students', count(*) FROM public.students
    UNION ALL SELECT 'subject_grades', count(*) FROM public.subject_grades
    UNION ALL SELECT 'audit_logs', count(*) FROM public.audit_logs
    UNION ALL SELECT 'grade_change_history', count(*) FROM public.grade_change_history
  `);
  console.table(counts.rows);
}

verify015OnProdSchema().catch(console.error);

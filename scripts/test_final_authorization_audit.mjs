import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

async function runFinalAuthorizationAudit() {
  console.log("================================================================================");
  console.log("   FINAL AUTHORIZATION AUDIT: PENDING/DECLINED ACCOUNTS & DUPLICATE VIEW PRIVACY");
  console.log("================================================================================");

  const db = new PGlite();

  // 1. Setup isolated environment
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ 
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; 
    $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ 
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated'); 
    $$ LANGUAGE sql STABLE;
  `);

  const backupSql = fs.readFileSync("backups/complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql", "utf-8");
  await db.exec(backupSql);

  // Helper functions
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
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
  `);

  // Apply Migration 014
  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf-8");
  await db.exec(sql014);

  // Seed two distinct schools
  const schoolA = "a0000000-0000-0000-0000-000000000001"; // TRIS
  const schoolB = "a0000000-0000-0000-0000-000000000002"; // Other School
  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES ('${schoolB}', '300799', 'Other DepEd School')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Seed Users across roles and account_status
  const approvedTeacherA = "11111111-1111-1111-1111-111111111111";
  const pendingTeacherA  = "22222222-2222-2222-2222-222222222222";
  const declinedTeacherA = "33333333-3333-3333-3333-333333333333";
  const approvedPrincipalA = "44444444-4444-4444-4444-444444444444";
  const pendingPrincipalA  = "55555555-5555-5555-5555-555555555555";
  const approvedAdmin      = "66666666-6666-6666-6666-666666666666";

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES 
      ('${approvedTeacherA}', 'approved.teacher@deped.gov.ph'),
      ('${pendingTeacherA}', 'pending.teacher@deped.gov.ph'),
      ('${declinedTeacherA}', 'declined.teacher@deped.gov.ph'),
      ('${approvedPrincipalA}', 'approved.principal@deped.gov.ph'),
      ('${pendingPrincipalA}', 'pending.principal@deped.gov.ph'),
      ('${approvedAdmin}', 'approved.admin@deped.gov.ph');

    INSERT INTO public.user_roles (id, user_id, role, account_status, school_id) VALUES
      (gen_random_uuid(), '${approvedTeacherA}', 'teacher', 'Approved', '${schoolA}'),
      (gen_random_uuid(), '${pendingTeacherA}', 'teacher', 'Pending', '${schoolA}'),
      (gen_random_uuid(), '${declinedTeacherA}', 'teacher', 'Declined', '${schoolA}'),
      (gen_random_uuid(), '${approvedPrincipalA}', 'principal', 'Approved', '${schoolA}'),
      (gen_random_uuid(), '${pendingPrincipalA}', 'principal', 'Pending', '${schoolA}'),
      (gen_random_uuid(), '${approvedAdmin}', 'admin', 'Approved', '${schoolA}');
  `);

  // Apply revised Migration 015
  const sql015 = fs.readFileSync("supabase/migrations/015_lrn_deduplication_and_grade_updates.sql", "utf-8");
  await db.exec(`
    BEGIN;
    ${sql015}
    COMMIT;
  `);
  console.log("✓ Applied 014 and 015 successfully.");

  // Seed Students
  const lrnA = "111111111111"; // Student in School A
  const lrnB = "222222222222"; // Student in School B
  await db.exec(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name) VALUES
      ('${schoolA}', '${lrnA}', 'Juan', 'Dela Cruz'),
      ('${schoolB}', '${lrnB}', 'Maria', 'Santos');
  `);

  // ----------------------------------------------------------------------------
  // PART 1: Pending & Declined Account Denial in lookup_student_by_lrn()
  // ----------------------------------------------------------------------------
  console.log("\n--- PART 1: lookup_student_by_lrn() Account Status Authorization ---");

  // Helper to run query as a specific user
  async function lookupAs(userId, role, lrn, pSchoolId = null) {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', false); SELECT set_config('request.jwt.claim.role', '${role}', false);`);
    const res = await db.query(`SELECT * FROM public.lookup_student_by_lrn('${lrn}', ${pSchoolId ? `'${pSchoolId}'` : 'NULL'});`);
    return res.rows;
  }

  // 1.1: Approved Teacher at School A looks up Student A (Allowed)
  const rows1_1 = await lookupAs(approvedTeacherA, 'authenticated', lrnA);
  console.log(`1.1 Approved Teacher -> Student A: ${rows1_1.length === 1 ? 'PASS (Allowed)' : 'FAIL'} (Rows: ${rows1_1.length})`);

  // 1.2: Pending Teacher at School A looks up Student A (Must be DENIED)
  const rows1_2 = await lookupAs(pendingTeacherA, 'authenticated', lrnA);
  console.log(`1.2 Pending Teacher -> Student A: ${rows1_2.length === 0 ? 'PASS (Denied)' : 'FAIL (Security Leak!)'} (Rows: ${rows1_2.length})`);

  // 1.3: Declined Teacher at School A looks up Student A (Must be DENIED)
  const rows1_3 = await lookupAs(declinedTeacherA, 'authenticated', lrnA);
  console.log(`1.3 Declined Teacher -> Student A: ${rows1_3.length === 0 ? 'PASS (Denied)' : 'FAIL (Security Leak!)'} (Rows: ${rows1_3.length})`);

  // 1.4: Pending Principal at School A looks up Student A (Must be DENIED)
  const rows1_4 = await lookupAs(pendingPrincipalA, 'authenticated', lrnA);
  console.log(`1.4 Pending Principal -> Student A: ${rows1_4.length === 0 ? 'PASS (Denied)' : 'FAIL (Security Leak!)'} (Rows: ${rows1_4.length})`);

  // 1.5: Approved Principal at School A looks up Student A (Allowed)
  const rows1_5 = await lookupAs(approvedPrincipalA, 'authenticated', lrnA);
  console.log(`1.5 Approved Principal -> Student A: ${rows1_5.length === 1 ? 'PASS (Allowed)' : 'FAIL'} (Rows: ${rows1_5.length})`);

  // 1.6: Approved Principal at School A looks up Student B (Must be DENIED)
  const rows1_6 = await lookupAs(approvedPrincipalA, 'authenticated', lrnB);
  console.log(`1.6 Approved Principal -> Student B (Other School): ${rows1_6.length === 0 ? 'PASS (Blocked)' : 'FAIL (Leaked!)'} (Rows: ${rows1_6.length})`);

  // 1.7: Approved Admin looks up Student B (Allowed across schools)
  const rows1_7 = await lookupAs(approvedAdmin, 'authenticated', lrnB);
  console.log(`1.7 Approved Admin -> Student B across schools: ${rows1_7.length === 1 ? 'PASS (Allowed)' : 'FAIL'} (Rows: ${rows1_7.length})`);

  // ----------------------------------------------------------------------------
  // PART 2: v_duplicate_students_report Cross-School Privacy for Principals
  // ----------------------------------------------------------------------------
  console.log("\n--- PART 2: v_duplicate_students_report Cross-School Privacy ---");

  // Create a cross-school duplicate student:
  // Same LRN (333333333333) exists in School A and School B
  const crossDupLrn = "333333333333";
  await db.exec(`
    -- Temporarily drop constraint to seed duplicate for view testing
    ALTER TABLE public.students DROP CONSTRAINT IF EXISTS chk_students_lrn_format;
    DROP INDEX IF EXISTS idx_students_normalized_lrn;
    INSERT INTO public.students (school_id, lrn, first_name, last_name) VALUES
      ('${schoolA}', '${crossDupLrn}', 'Pedro', 'Penduko'),
      ('${schoolB}', '${crossDupLrn}', 'Maria', 'Clara');
  `);

  async function queryDupViewAs(userId, role) {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', false); SELECT set_config('request.jwt.claim.role', '${role}', false);`);
    const res = await db.query(`SELECT * FROM public.v_duplicate_students_report WHERE normalized_lrn = '${crossDupLrn}';`);
    return res.rows;
  }

  // 2.1: School-scoped Principal at School A queries duplicate view
  const principalDupRows = await queryDupViewAs(approvedPrincipalA, 'authenticated');
  console.log("\nPrincipal Query Result:", principalDupRows);

  let pPass = false;
  if (principalDupRows.length === 1) {
    const row = principalDupRows[0];
    const names = row.student_names || [];
    const schoolIds = row.school_ids || [];
    const exposesSchoolBName = names.some(n => n.includes("Clara") || n.includes("Maria"));
    const exposesSchoolBID = schoolIds.includes(schoolB);
    const includesSchoolAName = names.some(n => n.includes("Pedro") || n.includes("Penduko"));
    const includesSchoolAID = schoolIds.includes(schoolA);

    console.log(`  - Includes School A student name: ${includesSchoolAName}`);
    console.log(`  - Includes School A school ID: ${includesSchoolAID}`);
    console.log(`  - Exposes School B student name: ${exposesSchoolBName}`);
    console.log(`  - Exposes School B school ID: ${exposesSchoolBID}`);

    if (includesSchoolAName && includesSchoolAID && !exposesSchoolBName && !exposesSchoolBID) {
      pPass = true;
    }
  }
  console.log(`2.1 Principal School A privacy (Exposes own student, hides School B data): ${pPass ? 'PASS' : 'FAIL'}`);

  // 2.2: System Admin queries duplicate view (Must see all schools)
  const adminDupRows = await queryDupViewAs(approvedAdmin, 'authenticated');
  let aPass = false;
  if (adminDupRows.length === 1) {
    const row = adminDupRows[0];
    const names = row.student_names || [];
    const schoolIds = row.school_ids || [];
    const hasSchoolA = names.some(n => n.includes("Penduko")) && schoolIds.includes(schoolA);
    const hasSchoolB = names.some(n => n.includes("Clara")) && schoolIds.includes(schoolB);
    if (hasSchoolA && hasSchoolB) aPass = true;
  }
  console.log(`2.2 Admin oversight (Sees full duplicate details across both schools): ${aPass ? 'PASS' : 'FAIL'}`);

  // 2.3: Pending Principal queries duplicate view (Must be DENIED / 0 rows)
  const pendingPrincipalDupRows = await queryDupViewAs(pendingPrincipalA, 'authenticated');
  console.log(`2.3 Pending Principal -> v_duplicate_students_report: ${pendingPrincipalDupRows.length === 0 ? 'PASS (Denied / 0 rows)' : 'FAIL'} (Rows: ${pendingPrincipalDupRows.length})`);

  // 2.4: Regular Teacher queries duplicate view (Must be DENIED / 0 rows)
  const teacherDupRows = await queryDupViewAs(approvedTeacherA, 'authenticated');
  console.log(`2.4 Teacher -> v_duplicate_students_report: ${teacherDupRows.length === 0 ? 'PASS (Denied / 0 rows)' : 'FAIL'} (Rows: ${teacherDupRows.length})`);

  console.log("\n================================================================================");
  console.log("   FINAL AUTHORIZATION AUDIT COMPLETE");
  console.log("================================================================================");
}

runFinalAuthorizationAudit().catch(console.error);

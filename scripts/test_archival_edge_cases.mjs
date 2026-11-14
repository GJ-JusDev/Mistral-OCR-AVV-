import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function testArchivalEdgeCases() {
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ 
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''), '135baa53-7e1e-4c1f-b76a-f32a915b5f21')::uuid; 
    $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ 
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated'); 
    $$ LANGUAGE sql STABLE;
  `);

  const backupSqlPath = path.join(rootDir, "backups", "complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql");
  const backupSql = fs.readFileSync(backupSqlPath, "utf-8");
  await db.exec(backupSql);

  await db.exec(`
    INSERT INTO auth.users (id, email)
    SELECT user_id, 'user_' || substr(user_id::text, 1, 8) || '@example.com' FROM public.user_roles ON CONFLICT DO NOTHING;
    INSERT INTO auth.users (id, email) VALUES ('135baa53-7e1e-4c1f-b76a-f32a915b5f21', 'admin@deped.gov.ph') ON CONFLICT DO NOTHING;
  `);

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

  await db.exec(fs.readFileSync(path.join(rootDir, "supabase", "migrations", "014_admin_audit_logs.sql"), "utf-8"));
  await db.exec(`
    BEGIN;
    ${fs.readFileSync(path.join(rootDir, "supabase", "migrations", "015_lrn_deduplication_and_grade_updates.sql"), "utf-8")}
    COMMIT;
  `);

  const schoolRes = await db.query("SELECT id FROM public.schools LIMIT 1;");
  const schoolId = schoolRes.rows[0].id;
  const adminId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21";

  const studentId = "f6666666-6666-6666-6666-666666666666";
  await db.query(`
    INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, overall_status)
    VALUES ('${studentId}', '${schoolId}', '666666666666', 'Test', 'Archived', '12', 'Needs Verification');
  `);

  const doc1 = "df666666-6666-6666-6666-666666666601";
  await db.query(`
    INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
    VALUES ('${doc1}', '${studentId}', '${schoolId}', 'SF9', '2021-2022', '1st Semester', '11', 'needs_review',
      '{"school_year":"2021-2022","semester":"1st Semester","grade_level":"11","grades":[{"subject":"Subj 1","q1":90,"q2":90,"final":90,"status":"Passed"}]}'::jsonb,
      '${adminId}');
  `);

  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc1}';`);
  const status1 = (await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentId}';`)).rows[0].overall_status;
  console.log("1. After Doc 1 Approved (SY 2021-2022, Grade 11): student overall_status =", status1);

  // Transition Doc 1 to archived
  await db.query(`UPDATE public.documents SET status = 'archived' WHERE id = '${doc1}';`);
  const statusArchived = (await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentId}';`)).rows[0].overall_status;
  const gradesCountArchived = (await db.query(`SELECT count(*) FROM public.subject_grades WHERE student_id = '${studentId}';`)).rows[0].count;
  console.log("2. After Doc 1 set to 'archived': student overall_status =", statusArchived, ", active grades count =", gradesCountArchived);

  // Now approve Doc 2 (SY 2022-2023, Grade 12) with a failing grade
  const doc2 = "df666666-6666-6666-6666-666666666602";
  await db.query(`
    INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
    VALUES ('${doc2}', '${studentId}', '${schoolId}', 'SF9', '2022-2023', '1st Semester', '12', 'needs_review',
      '{"school_year":"2022-2023","semester":"1st Semester","grade_level":"12","grades":[{"subject":"Subj 2","q1":65,"q2":65,"final":65,"status":"Failed"}]}'::jsonb,
      '${adminId}');
  `);
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc2}';`);
  const statusDoc2Approved = (await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentId}';`)).rows[0].overall_status;
  const gradesCountDoc2Approved = (await db.query(`SELECT count(*) FROM public.subject_grades WHERE student_id = '${studentId}';`)).rows[0].count;
  console.log("3. After Doc 2 Approved (SY 2022-2023, Grade 12, Failed): student overall_status =", statusDoc2Approved, ", total active grades =", gradesCountDoc2Approved);

  // Now reject Doc 2
  await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = '${doc2}';`);
  const statusDoc2Rejected = (await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentId}';`)).rows[0].overall_status;
  const gradesAfterDoc2Rejected = (await db.query(`SELECT subject, school_year, final_grade, status FROM public.subject_grades WHERE student_id = '${studentId}';`)).rows;
  console.log("4. After Doc 2 Rejected: student overall_status =", statusDoc2Rejected);
  console.log("   Remaining active grades in subject_grades:", gradesAfterDoc2Rejected);

  // Check standing history
  const standingHist = (await db.query(`SELECT document_id, previous_status, new_status, confirmation_notes FROM public.academic_standing_history WHERE student_id = '${studentId}' ORDER BY created_at ASC;`)).rows;
  console.log("5. Academic Standing History for student:");
  console.table(standingHist);
}

testArchivalEdgeCases().catch(console.error);

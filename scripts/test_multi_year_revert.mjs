import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function testMultiYearRevert() {
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

  const backupSql = fs.readFileSync(path.join(rootDir, "backups", "complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql"), "utf-8");
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

  const schoolId = (await db.query("SELECT id FROM public.schools LIMIT 1;")).rows[0].id;
  const adminId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21";
  const studentId = "77777777-7777-7777-7777-777777777777";

  await db.query(`
    INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, overall_status)
    VALUES ('${studentId}', '${schoolId}', '777777777777', 'Juan', 'MultiYear', '12', 'Needs Verification');
  `);

  // Doc 1: SY 2021-2022 Grade 11 (Passed)
  const doc1 = "d7777777-7777-7777-7777-777777777701";
  await db.query(`
    INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
    VALUES ('${doc1}', '${studentId}', '${schoolId}', 'SF9', '2021-2022', '1st Semester', '11', 'needs_review',
      '{"school_year":"2021-2022","semester":"1st Semester","grade_level":"11","grades":[{"subject":"Oral Comm","q1":90,"q2":90,"final":90,"status":"Passed"}]}'::jsonb,
      '${adminId}');
  `);
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc1}';`);
  console.log("1. After Doc 1 (SY 2021-2022 Grade 11) approved:", (await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentId}';`)).rows[0]);

  // Doc 2: SY 2022-2023 Grade 12 (Failed)
  const doc2 = "d7777777-7777-7777-7777-777777777702";
  await db.query(`
    INSERT INTO public.documents (id, student_id, school_id, document_type, school_year, semester, grade_level, status, extracted_fields, uploaded_by)
    VALUES ('${doc2}', '${studentId}', '${schoolId}', 'SF9', '2022-2023', '1st Semester', '12', 'needs_review',
      '{"school_year":"2022-2023","semester":"1st Semester","grade_level":"12","grades":[{"subject":"Adv Math","q1":70,"q2":70,"final":70,"status":"Failed"}]}'::jsonb,
      '${adminId}');
  `);
  await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = '${doc2}';`);
  console.log("2. After Doc 2 (SY 2022-2023 Grade 12 Failed) approved:", (await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentId}';`)).rows[0]);

  // Now REJECT Doc 2
  await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = '${doc2}';`);
  console.log("3. After Doc 2 rejected:");
  console.log("   Student overall_status:", (await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentId}';`)).rows[0]);
  console.log("   Active grades in subject_grades:", (await db.query(`SELECT school_year, grade_level, subject, final_grade, status FROM public.subject_grades WHERE student_id = '${studentId}';`)).rows);
  console.log("   Academic standing history:");
  console.table((await db.query(`SELECT document_id, previous_status, new_status, confirmation_notes FROM public.academic_standing_history WHERE student_id = '${studentId}' ORDER BY created_at ASC;`)).rows);
}

testMultiYearRevert().catch(console.error);

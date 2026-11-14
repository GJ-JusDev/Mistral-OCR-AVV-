import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Verify Production Pre-Migration Backup (016-021) is 100% Restorable', async (t) => {
  const db = new PGlite();

  // 1. Load Backup JSON
  const backupPath = path.resolve(rootDir, 'supabase', 'backups', 'production_pre_m016_m021_backup.json');
  assert.ok(fs.existsSync(backupPath), 'Backup file must exist on disk');
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  // 2. Setup Base Supabase Infrastructure
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT now()
    );

    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[],
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text REFERENCES storage.buckets(id),
      name text NOT NULL,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY, school_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      division TEXT, region TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      role TEXT NOT NULL DEFAULT 'teacher',
      account_status TEXT NOT NULL DEFAULT 'Approved',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, middle_name TEXT, last_name TEXT NOT NULL,
      suffix TEXT, grade_level TEXT, sex TEXT, status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification',
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL, image_url TEXT NOT NULL, original_filename TEXT,
      school_year TEXT, grade_level TEXT, semester TEXT,
      extracted_fields JSONB DEFAULT '{}', status TEXT NOT NULL DEFAULT 'needs_review',
      uploaded_by TEXT, reviewed_by UUID, reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      school_year TEXT, grade_level TEXT, semester TEXT,
      subject TEXT NOT NULL, q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
      final_grade NUMERIC, status TEXT NOT NULL DEFAULT 'Passed',
      needs_verification BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.review_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      action TEXT NOT NULL, notes TEXT, created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 3. Restore Auth Users
  for (const u of backup.usersRoster) {
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u.id, u.email]);
  }
  const authCount = await db.query(`SELECT COUNT(*) as count FROM auth.users`);
  assert.equal(parseInt(authCount.rows[0].count), backup.usersRoster.length, "All auth users restored");

  // 4. Restore Schools
  for (const s of backup.tables.schools.rows) {
    await db.query(`INSERT INTO public.schools (id, school_id, name) VALUES ($1, $2, $3)`, [s.id, s.school_id, s.name]);
  }
  const schoolCount = await db.query(`SELECT COUNT(*) as count FROM public.schools`);
  assert.equal(parseInt(schoolCount.rows[0].count), 1, "Schools restored");

  // 5. Restore Students
  for (const st of backup.tables.students.rows) {
    await db.query(
      `INSERT INTO public.students (id, school_id, lrn, first_name, middle_name, last_name, grade_level, status, overall_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [st.id, st.school_id, st.lrn, st.first_name, st.middle_name, st.last_name, st.grade_level, st.status, st.overall_status]
    );
  }
  const studentCount = await db.query(`SELECT COUNT(*) as count FROM public.students`);
  assert.equal(parseInt(studentCount.rows[0].count), 2, "Both students restored");

  // 6. Restore Documents
  for (const d of backup.tables.documents.rows) {
    await db.query(
      `INSERT INTO public.documents (id, student_id, school_id, document_type, image_url, original_filename, status, uploaded_by, reviewed_by, reviewed_at, extracted_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [d.id, d.student_id, d.school_id, d.document_type, d.image_url, d.original_filename, d.status, d.uploaded_by, d.reviewed_by, d.reviewed_at, JSON.stringify(d.extracted_fields || {})]
    );
  }
  const docCount = await db.query(`SELECT COUNT(*) as count FROM public.documents`);
  assert.equal(parseInt(docCount.rows[0].count), 6, "All 6 documents restored");

  // 7. Restore 18 Subject Grades
  for (const g of backup.tables.subject_grades.rows) {
    await db.query(
      `INSERT INTO public.subject_grades (id, student_id, document_id, school_year, grade_level, semester, subject, q1, q2, q3, q4, final_grade, status, needs_verification)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [g.id, g.student_id, g.document_id, g.school_year, g.grade_level, g.semester, g.subject, g.q1, g.q2, g.q3, g.q4, g.final_grade, g.status, g.needs_verification]
    );
  }
  const gradeCount = await db.query(`SELECT COUNT(*) as count FROM public.subject_grades`);
  assert.equal(parseInt(gradeCount.rows[0].count), 18, "All 18 subject grades restored");

  // 7b. Restore Storage Buckets
  for (const b of backup.storage.buckets) {
    await db.query(`INSERT INTO storage.buckets (id, name, public) VALUES ($1, $2, $3)`, [b.id, b.name, b.public]);
  }
  const bucketCount = await db.query(`SELECT COUNT(*) as count FROM storage.buckets`);
  assert.equal(parseInt(bucketCount.rows[0].count), 1, "Storage bucket restored");

  // 8. Restore Storage Object References
  for (const obj of backup.storage.documentsBucketObjects) {
    await db.query(`INSERT INTO storage.objects (id, bucket_id, name) VALUES ($1, $2, $3)`, [obj.id, 'documents', obj.path]);
  }
  const objCount = await db.query(`SELECT COUNT(*) as count FROM storage.objects`);
  assert.equal(parseInt(objCount.rows[0].count), 20, "All 20 storage objects restored");
});

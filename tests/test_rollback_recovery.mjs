import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function setupSupabaseMocks(db) {
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

    CREATE SCHEMA IF NOT EXISTS auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT now()
    );
    GRANT ALL ON auth.users TO anon, authenticated, service_role;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    BEGIN
      RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    END;
    $$ LANGUAGE plpgsql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
    BEGIN
      RETURN COALESCE(current_setting('request.jwt.claim.role', true), 'anon');
    END;
    $$ LANGUAGE plpgsql STABLE;

    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

    CREATE SCHEMA IF NOT EXISTS storage;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[],
      created_at timestamptz DEFAULT now()
    );
    GRANT ALL ON storage.buckets TO anon, authenticated, service_role;

    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text REFERENCES storage.buckets(id),
      name text NOT NULL,
      owner uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      metadata jsonb DEFAULT '{}'
    );
    GRANT ALL ON storage.objects TO anon, authenticated, service_role;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    CREATE OR REPLACE FUNCTION storage.foldername(name text)
    RETURNS text[] AS $$
    BEGIN
      RETURN string_to_array(name, '/');
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
    GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
  `);
}

async function setAuthContext(db, userId, role = 'authenticated') {
  if (role === 'service_role') {
    await db.exec(`RESET ROLE;`);
    await db.exec(`SET request.jwt.claim.sub = '${userId || ''}';`);
    await db.exec(`SET request.jwt.claim.role = 'service_role';`);
  } else if (userId) {
    await db.exec(`SET ROLE authenticated;`);
    await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
    await db.exec(`SET request.jwt.claim.role = 'authenticated';`);
  } else {
    await db.exec(`SET ROLE anon;`);
    await db.exec(`SET request.jwt.claim.sub = '';`);
    await db.exec(`SET request.jwt.claim.role = 'anon';`);
  }
}

test('Migration 009 Two-Step Application and Rollback Recovery Verification', async (t) => {
  const db = new PGlite();
  await setupSupabaseMocks(db);

  await t.test('1. Apply Baseline Migrations 001 - 002', async () => {
    let m001 = fs.readFileSync(path.join(rootDir, 'supabase/migrations/001_initial_schema.sql'), 'utf8');
    m001 = m001.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- pgcrypto built-in');
    await db.exec(m001);

    const m002 = fs.readFileSync(path.join(rootDir, 'supabase/migrations/002_auth_rbac.sql'), 'utf8');
    await db.exec(m002);

    const { rows: roles } = await db.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype;`);
    assert.deepEqual(roles.map(r => r.enumlabel).sort(), ['admin', 'teacher'].sort());
  });

  await t.test('2. Execute Migration 009 Step 1 (Separate Enum Transaction)', async () => {
    const step1Sql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/009_step1_add_principal_enum.sql'), 'utf8');
    await db.exec(step1Sql);

    const { rows: roles } = await db.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype;`);
    assert.ok(roles.some(r => r.enumlabel === 'principal'), 'principal enum must exist after step 1');
  });

  await t.test('3. Execute Migration 009 Step 2 (Schema, Triggers, Functions, RLS)', async () => {
    const step2Sql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/009_step2_consolidated_schema_and_security.sql'), 'utf8');
    await db.exec(step2Sql);

    // Verify 009 state
    const { rows: subjectGradesTable } = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'subject_grades';
    `);
    assert.equal(subjectGradesTable.length, 1, 'subject_grades table must exist');

    const { rows: docCols } = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'school_id';
    `);
    assert.equal(docCols.length, 1, 'documents.school_id must exist');

    const { rows: studentCols } = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'overall_status';
    `);
    assert.equal(studentCols.length, 1, 'students.overall_status must exist');

    const { rows: tris } = await db.query(`SELECT id, school_id, name FROM public.schools WHERE school_id = '300792';`);
    assert.equal(tris.length, 1, 'TRIS school record must be seeded');
    assert.equal(tris[0].name, 'Taysan Resettlement Integrated School');
  });

  await t.test('4. Seed Active Data under Migration 009', async () => {
    await setAuthContext(db, null, 'service_role');
    const teacherUid = '11111111-1111-1111-1111-111111111111';
    const trisId = 'a0000000-0000-0000-0000-000000000001';

    await db.query(`INSERT INTO auth.users (id, email) VALUES ('${teacherUid}', 'teacher@tris.edu.ph');`);
    await db.query(`
      UPDATE public.user_roles
      SET role = 'teacher', account_status = 'Approved', school_id = '${trisId}'
      WHERE user_id = '${teacherUid}';
    `);

    const studentId = '22222222-2222-2222-2222-222222222222';
    await db.query(`
      INSERT INTO public.students (id, lrn, first_name, last_name, school_id, overall_status)
      VALUES ('${studentId}', '123456789012', 'Maria', 'Santos', '${trisId}', 'Needs Verification');
    `);

    const docId = '33333333-3333-3333-3333-333333333333';
    await db.query(`
      INSERT INTO public.documents (id, student_id, document_type, image_url, status, uploaded_by, school_id)
      VALUES ('${docId}', '${studentId}', 'sf9', 'http://storage/test.png', 'submitted', '${teacherUid}', '${trisId}');
    `);

    // Verify teacher can read own document
    await setAuthContext(db, teacherUid, 'authenticated');
    const { rows: readDocs } = await db.query(`SELECT id FROM public.documents WHERE id = '${docId}';`);
    assert.equal(readDocs.length, 1, 'Teacher can read own document under 009');
  });

  await t.test('5. Execute 009_rollback_recovery.sql', async () => {
    await setAuthContext(db, null, 'service_role');
    const rollbackSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/009_rollback_recovery.sql'), 'utf8');
    await db.exec(rollbackSql);
  });

  await t.test('6. Verify Schema Cleanliness Post-Rollback', async () => {
    // 1. subject_grades table must NOT exist
    const { rows: sg } = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'subject_grades';
    `);
    assert.equal(sg.length, 0, 'subject_grades must be dropped');

    // 2. Added columns must NOT exist
    const { rows: docCols } = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'school_id';
    `);
    assert.equal(docCols.length, 0, 'documents.school_id must be dropped');

    const { rows: studentCols } = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'overall_status';
    `);
    assert.equal(studentCols.length, 0, 'students.overall_status must be dropped');

    const { rows: userRoleCols } = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'user_roles' 
        AND column_name IN ('school_id', 'account_status');
    `);
    assert.equal(userRoleCols.length, 0, 'user_roles school_id and account_status must be dropped');

    // 3. Trigger and trigger function must NOT exist
    const { rows: trg } = await db.query(`
      SELECT trigger_name FROM information_schema.triggers 
      WHERE event_object_table = 'documents' AND trigger_name = 'trigger_process_approved_document';
    `);
    assert.equal(trg.length, 0, 'trigger_process_approved_document must be dropped');

    const { rows: trgFn } = await db.query(`
      SELECT routine_name FROM information_schema.routines 
      WHERE routine_schema = 'public' AND routine_name = 'process_approved_document';
    `);
    assert.equal(trgFn.length, 0, 'process_approved_document function must be dropped');

    // 4. Helper functions must NOT exist
    const { rows: helperFns } = await db.query(`
      SELECT routine_name FROM information_schema.routines 
      WHERE routine_schema = 'public' AND routine_name IN ('is_approved_staff', 'is_approved_teacher', 'can_approve_documents');
    `);
    assert.equal(helperFns.length, 0, '009 helper functions must be dropped');
  });

  await t.test('7. Verify Baseline RLS Enforcement Post-Rollback', async () => {
    const teacherUid = '11111111-1111-1111-1111-111111111111';

    // 1. Anonymous access MUST be denied on students and documents
    await setAuthContext(db, null, 'anon');
    const { rows: anonStudents } = await db.query(`SELECT * FROM public.students;`);
    assert.equal(anonStudents.length, 0, 'Anonymous users must get 0 rows for students');

    const { rows: anonDocs } = await db.query(`SELECT * FROM public.documents;`);
    assert.equal(anonDocs.length, 0, 'Anonymous users must get 0 rows for documents');

    // 2. Authenticated user CAN access baseline tables
    await setAuthContext(db, teacherUid, 'authenticated');
    const { rows: authStudents } = await db.query(`SELECT * FROM public.students;`);
    assert.equal(authStudents.length, 1, 'Authenticated user can read students under baseline');

    const { rows: authDocs } = await db.query(`SELECT * FROM public.documents;`);
    assert.equal(authDocs.length, 1, 'Authenticated user can read documents under baseline');

    // 3. Authenticated user can read own user_role
    const { rows: ownRole } = await db.query(`SELECT * FROM public.user_roles WHERE user_id = '${teacherUid}';`);
    assert.equal(ownRole.length, 1, 'Authenticated user can read own role');

    // 4. Non-admin CANNOT read other users' roles
    const otherUid = '99999999-9999-9999-9999-999999999999';
    await setAuthContext(db, null, 'service_role');
    await db.query(`INSERT INTO auth.users (id, email) VALUES ('${otherUid}', 'other@school.edu.ph');`);
    await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ('${otherUid}', 'teacher') ON CONFLICT (user_id) DO NOTHING;`);

    await setAuthContext(db, teacherUid, 'authenticated');
    const { rows: otherRole } = await db.query(`SELECT * FROM public.user_roles WHERE user_id = '${otherUid}';`);
    assert.equal(otherRole.length, 0, 'Teacher cannot read another user role under baseline RLS');
  });

  await t.test('8. Verify Irreversible Enum Constraint is Documented', async () => {
    // In PostgreSQL, ALTER TYPE DROP VALUE does NOT exist
    const { rows: roles } = await db.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.user_role'::regtype;`);
    assert.ok(roles.some(r => r.enumlabel === 'principal'), 'PostgreSQL retains enum value in type as expected');
  });
});

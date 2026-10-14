import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// ==============================================================================
// AVV — Real PostgreSQL Engine Staging Verification Suite
// Engine: PGlite (Real PostgreSQL 18.6 WASM execution engine)
// Tests: Migration ordering, Transaction boundaries, Real RLS, Two-School Isolation
// ==============================================================================

async function setupSupabaseMocks(db) {
  // 1. Setup mock database roles (matching Supabase environment)
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    -- Grant schema permissions to authenticated and service_role
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

test('Real PostgreSQL Staging Verification', async (t) => {
  const db = new PGlite();
  await setupSupabaseMocks(db);

  await t.test('1. Baseline Migration 001 - 002 execution', async () => {
    let m001 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '001_initial_schema.sql'), 'utf8');
    m001 = m001.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- pgcrypto built-in');
    await db.exec(m001);

    const m002 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '002_auth_rbac.sql'), 'utf8');
    await db.exec(m002);

    const tables = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    const tableNames = tables.rows.map(r => r.table_name);
    assert.ok(tableNames.includes('schools'));
    assert.ok(tableNames.includes('students'));
    assert.ok(tableNames.includes('documents'));
    assert.ok(tableNames.includes('validation_results'));
    assert.ok(tableNames.includes('review_logs'));
    assert.ok(tableNames.includes('user_roles'));
  });

  await t.test('2. Enum Transaction Boundary Audit: ALTER TYPE ADD VALUE', async () => {
    let failedInsideTx = false;
    let errorMessage = '';
    try {
      await db.exec(`
        BEGIN;
        ALTER TYPE public.user_role ADD VALUE 'test_enum_val';
        CREATE TABLE test_tx_table (role public.user_role DEFAULT 'test_enum_val');
        COMMIT;
      `);
    } catch (err) {
      failedInsideTx = true;
      errorMessage = err.message;
      await db.exec('ROLLBACK;');
    }

    assert.equal(failedInsideTx, true, 'PostgreSQL MUST reject using new enum value in the same transaction block');
    assert.match(errorMessage, /unsafe use of new value|cannot be run inside a transaction/i);

    // Standalone execution succeeds
    await db.exec(`ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'principal';`);
    const enumVals = await db.query(`
      SELECT enumlabel FROM pg_enum 
      WHERE enumtypid = 'public.user_role'::regtype;
    `);
    const labels = enumVals.rows.map(r => r.enumlabel);
    assert.ok(labels.includes('principal'), 'principal enum value present');
  });

  await t.test('3. Migration 009 Execution on Real PostgreSQL Staging', async () => {
    const m009 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '009_step2_consolidated_schema_and_security.sql'), 'utf8');
    await db.exec(m009);

    // Force RLS on public tables to guarantee RLS enforcement across all roles
    await db.exec(`
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
      ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.schools FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.students FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.documents FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.subject_grades FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.validation_results FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.review_logs FORCE ROW LEVEL SECURITY;
      ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;
    `);

    // Verify columns exist
    const cols = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'user_roles' AND table_schema = 'public';
    `);
    const colNames = cols.rows.map(r => r.column_name);
    assert.ok(colNames.includes('account_status'), 'user_roles has account_status');
    assert.ok(colNames.includes('school_id'), 'user_roles has school_id');

    // Verify TRIS seeded
    const tris = await db.query(`SELECT * FROM public.schools WHERE school_id = '300792';`);
    assert.equal(tris.rows.length, 1);
    assert.equal(tris.rows[0].name, 'Taysan Resettlement Integrated School');
  });

  await t.test('4. Seed Synthetic Records across Two Schools in Real PostgreSQL', async () => {
    await setAuthContext(db, null, 'service_role');

    const trisId = 'a0000000-0000-0000-0000-000000000001';
    const sjnhsId = 'b0000000-0000-0000-0000-000000000002';
    await db.exec(`
      INSERT INTO public.schools (id, school_id, name)
      VALUES ('${sjnhsId}', '300793', 'San Jose National High School')
      ON CONFLICT (school_id) DO NOTHING;
    `);

    const uids = {
      admin: '11111111-1111-1111-1111-111111111111',
      principalTris: '22222222-2222-2222-2222-222222222222',
      principalSjnhs: '33333333-3333-3333-3333-333333333333',
      teacherTris: '44444444-4444-4444-4444-444444444444',
      teacherSjnhs: '55555555-5555-5555-5555-555555555555',
      pendingUser: '66666666-6666-6666-6666-666666666666'
    };

    for (const [name, id] of Object.entries(uids)) {
      await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${id}', '${name}@test.com') ON CONFLICT DO NOTHING;`);
    }

    await db.exec(`
      INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES
      ('${uids.admin}', 'admin', 'Approved', '${trisId}'),
      ('${uids.principalTris}', 'principal', 'Approved', '${trisId}'),
      ('${uids.principalSjnhs}', 'principal', 'Approved', '${sjnhsId}'),
      ('${uids.teacherTris}', 'teacher', 'Approved', '${trisId}'),
      ('${uids.teacherSjnhs}', 'teacher', 'Approved', '${sjnhsId}'),
      ('${uids.pendingUser}', 'teacher', 'Pending', '${trisId}')
      ON CONFLICT (user_id) DO UPDATE SET 
        role = EXCLUDED.role, 
        account_status = EXCLUDED.account_status, 
        school_id = EXCLUDED.school_id;
    `);

    const studentTrisId = '77777777-7777-7777-7777-777777777777';
    const studentSjnhsId = '88888888-8888-8888-8888-888888888888';
    await db.exec(`
      INSERT INTO public.students (id, lrn, first_name, last_name, school_id) VALUES
      ('${studentTrisId}', '111111111111', 'Juan', 'Dela Cruz', '${trisId}'),
      ('${studentSjnhsId}', '222222222222', 'Maria', 'Santos', '${sjnhsId}')
      ON CONFLICT DO NOTHING;
    `);

    const docTrisId = '99999999-9999-9999-9999-999999999999';
    const docSjnhsId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await db.exec(`
      INSERT INTO public.documents (id, student_id, school_id, document_type, uploaded_by, image_url, status, extracted_fields) VALUES
      ('${docTrisId}', '${studentTrisId}', '${trisId}', 'sf10', '${uids.teacherTris}', '${uids.teacherTris}/doc1.png', 'validated', '{"school_year":"2023-2024","grades":[{"subject":"Math","final":85,"status":"Passed"}]}'),
      ('${docSjnhsId}', '${studentSjnhsId}', '${sjnhsId}', 'sf10', '${uids.teacherSjnhs}', '${uids.teacherSjnhs}/doc2.png', 'validated', '{"school_year":"2023-2024","grades":[{"subject":"Science","final":88,"status":"Passed"}]}')
      ON CONFLICT DO NOTHING;
    `);

    await db.exec(`
      INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('documents', '${uids.teacherTris}/doc1.png', '${uids.teacherTris}'),
      ('documents', '${uids.teacherSjnhs}/doc2.png', '${uids.teacherSjnhs}');
    `);
  });

  await t.test('5. Real PostgreSQL RLS: Teacher Access Scope', async () => {
    const uids = {
      teacherTris: '44444444-4444-4444-4444-444444444444',
      docTrisId: '99999999-9999-9999-9999-999999999999',
      docSjnhsId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    };

    await setAuthContext(db, uids.teacherTris, 'authenticated');

    // 5.1 Teacher can see own document
    const ownDocs = await db.query(`SELECT id FROM public.documents WHERE id = '${uids.docTrisId}';`);
    assert.equal(ownDocs.rows.length, 1, 'Teacher can view own document');

    // 5.2 Teacher CANNOT see other teacher document
    const otherDocs = await db.query(`SELECT id FROM public.documents WHERE id = '${uids.docSjnhsId}';`);
    assert.equal(otherDocs.rows.length, 0, 'Teacher CANNOT view document from other teacher');

    // 5.3 Teacher CANNOT approve document (RLS blocks status = approved update)
    let teacherApproveBlocked = false;
    try {
      await db.query(`
        UPDATE public.documents 
        SET status = 'approved' 
        WHERE id = '${uids.docTrisId}'
        RETURNING id;
      `);
    } catch (err) {
      teacherApproveBlocked = true;
      assert.match(err.message, /violates row-level security policy/i);
    }
    assert.equal(teacherApproveBlocked, true, 'Teacher UPDATE to approved strictly blocked by RLS');
  });

  await t.test('6. Real PostgreSQL RLS: Cross-School Principal Isolation', async () => {
    const uids = {
      principalTris: '22222222-2222-2222-2222-222222222222',
      principalSjnhs: '33333333-3333-3333-3333-333333333333',
      docTrisId: '99999999-9999-9999-9999-999999999999',
      docSjnhsId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    };

    // 6.1 TRIS Principal context
    await setAuthContext(db, uids.principalTris, 'authenticated');

    const trisDocs = await db.query(`SELECT id FROM public.documents WHERE id = '${uids.docTrisId}';`);
    assert.equal(trisDocs.rows.length, 1, 'TRIS Principal CAN view TRIS document');

    const crossDocs = await db.query(`SELECT id FROM public.documents WHERE id = '${uids.docSjnhsId}';`);
    assert.equal(crossDocs.rows.length, 0, 'TRIS Principal CANNOT view SJNHS document');

    const crossUpdate = await db.query(`
      UPDATE public.documents 
      SET status = 'approved' 
      WHERE id = '${uids.docSjnhsId}'
      RETURNING id;
    `);
    assert.equal(crossUpdate.rows.length, 0, 'TRIS Principal CANNOT approve SJNHS document');

    // 6.2 SJNHS Principal context
    await setAuthContext(db, uids.principalSjnhs, 'authenticated');

    const sjnhsDocs = await db.query(`SELECT id FROM public.documents WHERE id = '${uids.docSjnhsId}';`);
    assert.equal(sjnhsDocs.rows.length, 1, 'SJNHS Principal CAN view SJNHS document');

    const sjnhsCross = await db.query(`SELECT id FROM public.documents WHERE id = '${uids.docTrisId}';`);
    assert.equal(sjnhsCross.rows.length, 0, 'SJNHS Principal CANNOT view TRIS document');
  });

  await t.test('7. Real PostgreSQL RLS: Comprehensive Document Storage Authorization', async () => {
    const admin = '11111111-1111-1111-1111-111111111111';
    const principalTris = '22222222-2222-2222-2222-222222222222';
    const principalSjnhs = '33333333-3333-3333-3333-333333333333';
    const teacherTris = '44444444-4444-4444-4444-444444444444';
    const teacherSjnhs = '55555555-5555-5555-5555-555555555555';
    const pendingUser = '66666666-6666-6666-6666-666666666666';

    // 7.1 SELECT (Read)
    // Teacher reading own file -> SUCCESS
    await setAuthContext(db, teacherTris, 'authenticated');
    const ownFile = await db.query(`SELECT name FROM storage.objects WHERE name = '${teacherTris}/doc1.png';`);
    assert.equal(ownFile.rows.length, 1, 'Teacher can read own storage object');

    // Teacher reading other teacher file -> BLOCKED (0 rows)
    const otherTeacherFile = await db.query(`SELECT name FROM storage.objects WHERE name = '${teacherSjnhs}/doc2.png';`);
    assert.equal(otherTeacherFile.rows.length, 0, 'Teacher CANNOT read other teacher storage object');

    // Principal TRIS reading TRIS document file -> SUCCESS
    await setAuthContext(db, principalTris, 'authenticated');
    const trisFile = await db.query(`SELECT name FROM storage.objects WHERE name = '${teacherTris}/doc1.png';`);
    assert.equal(trisFile.rows.length, 1, 'TRIS Principal can read TRIS document file');

    // Principal TRIS reading SJNHS document file -> BLOCKED (0 rows)
    const crossSchoolFile = await db.query(`SELECT name FROM storage.objects WHERE name = '${teacherSjnhs}/doc2.png';`);
    assert.equal(crossSchoolFile.rows.length, 0, 'TRIS Principal CANNOT read SJNHS document file');

    // Pending user reading files -> BLOCKED (0 rows)
    await setAuthContext(db, pendingUser, 'authenticated');
    const pendingReadFile = await db.query(`SELECT name FROM storage.objects;`);
    assert.equal(pendingReadFile.rows.length, 0, 'Pending user CANNOT read any storage objects');

    // Anonymous reading files -> BLOCKED (0 rows)
    await setAuthContext(db, null, 'anon');
    const anonReadFile = await db.query(`SELECT name FROM storage.objects;`);
    assert.equal(anonReadFile.rows.length, 0, 'Anonymous caller CANNOT read any storage objects');

    // 7.2 INSERT (Upload)
    // Approved teacher uploading into own path prefix -> SUCCESS
    await setAuthContext(db, teacherTris, 'authenticated');
    await db.query(`
      INSERT INTO storage.objects (bucket_id, name, owner)
      VALUES ('documents', '${teacherTris}/upload_test.pdf', '${teacherTris}');
    `);
    const uploadedOwn = await db.query(`SELECT name FROM storage.objects WHERE name = '${teacherTris}/upload_test.pdf';`);
    assert.equal(uploadedOwn.rows.length, 1, 'Teacher can upload into own folder');

    // Approved teacher attempting to upload into another user's folder -> BLOCKED
    let uploadSpoofBlocked = false;
    try {
      await db.query(`
        INSERT INTO storage.objects (bucket_id, name, owner)
        VALUES ('documents', '${teacherSjnhs}/spoof.pdf', '${teacherTris}');
      `);
    } catch (err) {
      uploadSpoofBlocked = true;
      assert.match(err.message, /violates row-level security policy/i);
    }
    assert.equal(uploadSpoofBlocked, true, 'Teacher upload into another user path strictly blocked by RLS');

    // Pending user attempting upload -> BLOCKED
    await setAuthContext(db, pendingUser, 'authenticated');
    let pendingUploadBlocked = false;
    try {
      await db.query(`
        INSERT INTO storage.objects (bucket_id, name, owner)
        VALUES ('documents', '${pendingUser}/pending.pdf', '${pendingUser}');
      `);
    } catch (err) {
      pendingUploadBlocked = true;
      assert.match(err.message, /violates row-level security policy/i);
    }
    assert.equal(pendingUploadBlocked, true, 'Pending user upload strictly blocked by RLS');

    // Anonymous user attempting upload -> BLOCKED
    await setAuthContext(db, null, 'anon');
    let anonUploadBlocked = false;
    try {
      await db.query(`
        INSERT INTO storage.objects (bucket_id, name, owner)
        VALUES ('documents', 'anon/hack.pdf', gen_random_uuid());
      `);
    } catch (err) {
      anonUploadBlocked = true;
      assert.match(err.message, /violates row-level security policy/i);
    }
    assert.equal(anonUploadBlocked, true, 'Anonymous upload strictly blocked by RLS');

    // 7.3 UPDATE
    // Teacher updating own file -> SUCCESS
    await setAuthContext(db, teacherTris, 'authenticated');
    const updateOwn = await db.query(`
      UPDATE storage.objects 
      SET updated_at = now() 
      WHERE name = '${teacherTris}/upload_test.pdf'
      RETURNING name;
    `);
    assert.equal(updateOwn.rows.length, 1, 'Teacher can update own object');

    // Teacher updating another teacher file -> BLOCKED (0 rows updated)
    const updateOther = await db.query(`
      UPDATE storage.objects 
      SET updated_at = now() 
      WHERE name = '${teacherSjnhs}/doc2.png'
      RETURNING name;
    `);
    assert.equal(updateOther.rows.length, 0, 'Teacher cannot update other teacher object');

    // 7.4 DELETE
    // Teacher attempting DELETE -> BLOCKED (admin only policy)
    const deleteTeacher = await db.query(`
      DELETE FROM storage.objects 
      WHERE name = '${teacherTris}/upload_test.pdf'
      RETURNING name;
    `);
    assert.equal(deleteTeacher.rows.length, 0, 'Teacher DELETE strictly blocked (admin-only policy)');

    // Principal attempting DELETE -> BLOCKED (admin only policy)
    await setAuthContext(db, principalTris, 'authenticated');
    const deletePrincipal = await db.query(`
      DELETE FROM storage.objects 
      WHERE name = '${teacherTris}/upload_test.pdf'
      RETURNING name;
    `);
    assert.equal(deletePrincipal.rows.length, 0, 'Principal DELETE strictly blocked (admin-only policy)');

    // Admin DELETE -> SUCCESS
    await setAuthContext(db, admin, 'authenticated');
    const deleteAdmin = await db.query(`
      DELETE FROM storage.objects 
      WHERE name = '${teacherTris}/upload_test.pdf'
      RETURNING name;
    `);
    assert.equal(deleteAdmin.rows.length, 1, 'Admin can delete storage objects');
  });

  await t.test('8. Real PostgreSQL Trigger: Document Approval & Grade Synchronization', async () => {
    const principalTris = '22222222-2222-2222-2222-222222222222';
    const docTrisId = '99999999-9999-9999-9999-999999999999';
    const studentTrisId = '77777777-7777-7777-7777-777777777777';

    await setAuthContext(db, principalTris, 'authenticated');

    const approveRes = await db.query(`
      UPDATE public.documents 
      SET status = 'approved' 
      WHERE id = '${docTrisId}'
      RETURNING id, status;
    `);
    assert.equal(approveRes.rows.length, 1, 'Document successfully approved');
    assert.equal(approveRes.rows[0].status, 'approved');

    const grades = await db.query(`
      SELECT subject, final_grade, status 
      FROM public.subject_grades 
      WHERE document_id = '${docTrisId}';
    `);
    assert.equal(grades.rows.length, 1, 'Subject grade created by trigger');
    assert.equal(grades.rows[0].subject, 'Math');
    assert.equal(grades.rows[0].status, 'Passed');

    const student = await db.query(`SELECT overall_status FROM public.students WHERE id = '${studentTrisId}';`);
    assert.equal(student.rows[0].overall_status, 'Passed');
  });

  await t.test('9. Real PostgreSQL Privilege Escalation Check: user_roles & registration metadata', async () => {
    const teacherTris = '44444444-4444-4444-4444-444444444444';
    await setAuthContext(db, teacherTris, 'authenticated');

    // 9.1 Teacher attempting to self-promote to admin
    const updateRole = await db.query(`
      UPDATE public.user_roles 
      SET role = 'admin' 
      WHERE user_id = '${teacherTris}'
      RETURNING id;
    `);
    assert.equal(updateRole.rows.length, 0, 'Teacher cannot modify own role');

    // 9.2 Teacher attempting to insert a new role
    const fakeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    let insertFailed = false;
    try {
      await db.query(`
        INSERT INTO public.user_roles (user_id, role, account_status)
        VALUES ('${fakeId}', 'admin', 'Approved');
      `);
    } catch {
      insertFailed = true;
    }
    const fakeRole = await db.query(`SELECT * FROM public.user_roles WHERE user_id = '${fakeId}';`);
    assert.equal(fakeRole.rows.length, 0, 'Teacher cannot insert roles');

    // 9.3 Self-registration privilege escalation attempt
    // Attacker signs up with raw_user_meta_data = {"role": "admin", "school_id": "a0000000-0000-0000-0000-000000000001", "account_status": "Approved"}
    const attackerId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    await setAuthContext(db, null, 'service_role');
    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('${attackerId}', 'attacker@hack.com', '{"role":"admin","school_id":"a0000000-0000-0000-0000-000000000001","account_status":"Approved"}');
    `);

    // Verify handle_new_user unconditionally forced role to 'teacher', status to 'Pending', and school_id to NULL
    const attackerRole = await db.query(`
      SELECT role, account_status, school_id FROM public.user_roles WHERE user_id = '${attackerId}';
    `);
    assert.equal(attackerRole.rows[0].role, 'teacher', 'Registration with role=admin MUST be forced to teacher');
    assert.equal(attackerRole.rows[0].account_status, 'Pending', 'Registration must be Pending');
    assert.equal(attackerRole.rows[0].school_id, null, 'Registration must NOT assign school_id');

    // Verify is_admin() evaluates to false for attacker
    await setAuthContext(db, attackerId, 'authenticated');
    const isAdminCheck = await db.query(`SELECT public.is_admin() AS is_admin;`);
    assert.equal(isAdminCheck.rows[0].is_admin, false, 'Attacker must NOT be granted admin privileges');
  });

  await t.test('10. Comprehensive 5-Role CRUD Authorization Matrix on Real PostgreSQL', async () => {
    const admin = '11111111-1111-1111-1111-111111111111';
    const principalTris = '22222222-2222-2222-2222-222222222222';
    const teacherTris = '44444444-4444-4444-4444-444444444444';
    const teacherSjnhs = '55555555-5555-5555-5555-555555555555';
    const pendingUser = '66666666-6666-6666-6666-666666666666';
    const studentTrisId = '77777777-7777-7777-7777-777777777777';
    const docTrisId = '99999999-9999-9999-9999-999999999999';
    const docSjnhsId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    // 10.1 ANONYMOUS SESSIONS
    await setAuthContext(db, null, 'anon');
    const anonDocs = await db.query(`SELECT * FROM public.documents;`);
    assert.equal(anonDocs.rows.length, 0, 'Anon CANNOT read documents');
    const anonStudents = await db.query(`SELECT * FROM public.students;`);
    assert.equal(anonStudents.rows.length, 0, 'Anon CANNOT read students');
    const anonGrades = await db.query(`SELECT * FROM public.subject_grades;`);
    assert.equal(anonGrades.rows.length, 0, 'Anon CANNOT read grades');
    const anonRoles = await db.query(`SELECT * FROM public.user_roles;`);
    assert.equal(anonRoles.rows.length, 0, 'Anon CANNOT read user_roles');
    const anonStorage = await db.query(`SELECT * FROM storage.objects;`);
    assert.equal(anonStorage.rows.length, 0, 'Anon CANNOT read storage');

    let anonInsertDocBlocked = false;
    try {
      await db.query(`INSERT INTO public.documents (document_type, uploaded_by) VALUES ('sf9', 'anon');`);
    } catch { anonInsertDocBlocked = true; }
    assert.equal(anonInsertDocBlocked, true, 'Anon INSERT documents rejected');

    let anonInsertGradeBlocked = false;
    try {
      await db.query(`INSERT INTO public.subject_grades (student_id, document_id, subject) VALUES ('${studentTrisId}', '${docTrisId}', 'Math');`);
    } catch { anonInsertGradeBlocked = true; }
    assert.equal(anonInsertGradeBlocked, true, 'Anon INSERT grades rejected');

    // 10.2 PENDING TEACHER SESSIONS
    await setAuthContext(db, pendingUser, 'authenticated');
    const pendingDocs = await db.query(`SELECT * FROM public.documents;`);
    assert.equal(pendingDocs.rows.length, 0, 'Pending teacher CANNOT read documents');
    const pendingStudents = await db.query(`SELECT * FROM public.students;`);
    assert.equal(pendingStudents.rows.length, 0, 'Pending teacher CANNOT read students');
    const pendingGrades = await db.query(`SELECT * FROM public.subject_grades;`);
    assert.equal(pendingGrades.rows.length, 0, 'Pending teacher CANNOT read grades');
    const pendingRoles = await db.query(`SELECT role, account_status FROM public.user_roles;`);
    assert.equal(pendingRoles.rows.length, 1, 'Pending teacher sees only own role row');
    assert.equal(pendingRoles.rows[0].account_status, 'Pending');

    let pendingDocInsertBlocked = false;
    try {
      await db.query(`INSERT INTO public.documents (document_type, uploaded_by) VALUES ('sf9', '${pendingUser}');`);
    } catch { pendingDocInsertBlocked = true; }
    assert.equal(pendingDocInsertBlocked, true, 'Pending teacher INSERT documents rejected');

    // 10.3 APPROVED TEACHER SESSIONS (TRIS)
    await setAuthContext(db, teacherTris, 'authenticated');
    // Cannot directly modify grades
    let teacherGradeInsertBlocked = false;
    try {
      await db.query(`INSERT INTO public.subject_grades (student_id, document_id, subject) VALUES ('${studentTrisId}', '${docTrisId}', 'Hacking');`);
    } catch { teacherGradeInsertBlocked = true; }
    assert.equal(teacherGradeInsertBlocked, true, 'Teacher direct INSERT grades rejected');

    let teacherGradeUpdateBlocked = false;
    const gradeUpdateRes = await db.query(`UPDATE public.subject_grades SET final_grade = 99 WHERE document_id = '${docTrisId}' RETURNING id;`);
    assert.equal(gradeUpdateRes.rows.length, 0, 'Teacher direct UPDATE grades blocked (0 rows affected)');

    // Cannot delete document
    const teacherDocDelete = await db.query(`DELETE FROM public.documents WHERE id = '${docTrisId}' RETURNING id;`);
    assert.equal(teacherDocDelete.rows.length, 0, 'Teacher DELETE documents blocked (0 rows affected)');

    // 10.4 APPROVED PRINCIPAL SESSIONS (TRIS)
    await setAuthContext(db, principalTris, 'authenticated');
    // Cannot directly modify grades
    let principalGradeInsertBlocked = false;
    try {
      await db.query(`INSERT INTO public.subject_grades (student_id, document_id, subject) VALUES ('${studentTrisId}', '${docTrisId}', 'Math');`);
    } catch { principalGradeInsertBlocked = true; }
    assert.equal(principalGradeInsertBlocked, true, 'Principal direct INSERT grades rejected');

    const principalGradeUpdate = await db.query(`UPDATE public.subject_grades SET final_grade = 100 WHERE document_id = '${docTrisId}' RETURNING id;`);
    assert.equal(principalGradeUpdate.rows.length, 0, 'Principal direct UPDATE grades blocked (0 rows affected)');

    // Cannot access another school
    const crossSchoolDoc = await db.query(`SELECT id FROM public.documents WHERE id = '${docSjnhsId}';`);
    assert.equal(crossSchoolDoc.rows.length, 0, 'Principal CANNOT read cross-school document');

    // 10.5 APPROVED ADMIN SESSIONS
    await setAuthContext(db, admin, 'authenticated');
    const adminDocs = await db.query(`SELECT id FROM public.documents;`);
    assert.equal(adminDocs.rows.length >= 2, true, 'Admin can read documents across all schools');
    const adminRoles = await db.query(`SELECT * FROM public.user_roles;`);
    assert.equal(adminRoles.rows.length >= 4, true, 'Admin can read all user roles');
  });
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

    CREATE SCHEMA IF NOT EXISTS storage;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[],
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
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

test('Academic Standing Safety & DepEd Alignment Regression Suite', async (t) => {
  const db = new PGlite();
  await setupSupabaseMocks(db);

  // Apply baseline migrations
  let m001 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '001_initial_schema.sql'), 'utf8');
  m001 = m001.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- pgcrypto built-in');
  await db.exec(m001);
  const m002 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '002_auth_rbac.sql'), 'utf8');
  await db.exec(m002);

  // Apply Step 1 and Step 2
  const step1 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '009_step1_add_principal_enum.sql'), 'utf8');
  const step2 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '009_step2_consolidated_schema_and_security.sql'), 'utf8');
  await db.exec(step1);
  await db.exec(step2);

  // Seed School A (TRIS) and School B (SJNHS)
  const trisId = 'a0000000-0000-0000-0000-000000000001';
  const sjnhsId = 'b0000000-0000-0000-0000-000000000002';
  await db.exec(`
    INSERT INTO public.schools (id, school_id, name)
    VALUES ('${sjnhsId}', '300799', 'San Jose National High School')
    ON CONFLICT (school_id) DO NOTHING;
  `);

  // Seed Staff Accounts
  const teacherId = '11111111-1111-1111-1111-111111111111';
  const principalTrisId = '22222222-2222-2222-2222-222222222222';
  const principalSjnhsId = '33333333-3333-3333-3333-333333333333';
  const adminId = '44444444-4444-4444-4444-444444444444';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES 
      ('${teacherId}', 'teacher_tris@example.com'),
      ('${principalTrisId}', 'principal_tris@example.com'),
      ('${principalSjnhsId}', 'principal_sjnhs@example.com'),
      ('${adminId}', 'admin@example.com');

    INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES
      ('${teacherId}', 'teacher', 'Approved', '${trisId}'),
      ('${principalTrisId}', 'principal', 'Approved', '${trisId}'),
      ('${principalSjnhsId}', 'principal', 'Approved', '${sjnhsId}'),
      ('${adminId}', 'admin', 'Approved', NULL)
    ON CONFLICT (user_id) DO UPDATE 
    SET role = EXCLUDED.role, 
        account_status = EXCLUDED.account_status, 
        school_id = EXCLUDED.school_id;
  `);

  // Seed Student in TRIS
  const studentRes = await db.query(`
    INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
    VALUES ('109876543210', 'Juan', 'Dela Cruz', '${trisId}', 'Grade 10', 'Needs Verification')
    RETURNING id;
  `);
  const studentId = studentRes.rows[0].id;

  await t.test('1. Document with 3 Failing Grades: Must NOT automatically set Failed', async () => {
    // Teacher uploads a card with 3 failed grades
    const docRes = await db.query(`
      INSERT INTO public.documents (student_id, document_type, image_url, status, school_id, uploaded_by, extracted_fields)
      VALUES (
        '${studentId}',
        'sf9',
        'http://example.com/sf9_failed.jpg',
        'submitted',
        '${trisId}',
        '${teacherId}',
        '${JSON.stringify({
          school_year: '2025-2026',
          grade_level: 'Grade 10',
          grades: [
            { subject: 'Math', final: '70', status: 'Failed' },
            { subject: 'Science', final: '72', status: 'Failed' },
            { subject: 'English', final: '71', status: 'Failed' },
            { subject: 'Filipino', final: '85', status: 'Passed' }
          ]
        })}'::jsonb
      )
      RETURNING id;
    `);
    const docId = docRes.rows[0].id;

    // Principal approves document
    await setAuthContext(db, principalTrisId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [docId]);

    // Check subject_grades: 4 rows inserted
    const grades = await db.query(`SELECT * FROM public.subject_grades WHERE document_id = $1`, [docId]);
    assert.equal(grades.rows.length, 4);

    // CRITICAL INVARIANT: Student overall_status must be 'Needs Verification' (NOT 'Failed')
    const student = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [studentId]);
    assert.equal(student.rows[0].overall_status, 'Needs Verification', 'Must be Needs Verification pending DepEd remedial/retention review');

    // Audit log must exist in academic_standing_history
    const history = await db.query(`SELECT * FROM public.academic_standing_history WHERE student_id = $1`, [studentId]);
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].new_status, 'Needs Verification');
    assert.match(history.rows[0].confirmation_notes, /Contains 3 failing subject/i);
  });

  await t.test('2. Archived/Older Document: Must NOT overwrite student standing', async () => {
    // Authenticate as teacher to upload document
    await setAuthContext(db, teacherId, 'authenticated');

    // Current document was 2025-2026.
    // Now an archived document from Grade 8 (2023-2024) is uploaded and approved.
    const archiveDocRes = await db.query(`
      INSERT INTO public.documents (student_id, document_type, image_url, status, school_id, uploaded_by, extracted_fields)
      VALUES (
        '${studentId}',
        'sf10',
        'http://example.com/sf10_archive.jpg',
        'submitted',
        '${trisId}',
        '${teacherId}',
        '${JSON.stringify({
          school_year: '2023-2024',
          grade_level: 'Grade 8',
          grades: [
            { subject: 'Math', final: '88', status: 'Passed' },
            { subject: 'Science', final: '90', status: 'Passed' }
          ]
        })}'::jsonb
      )
      RETURNING id;
    `);
    const archiveDocId = archiveDocRes.rows[0].id;

    // Approve the older archived document
    await setAuthContext(db, principalTrisId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [archiveDocId]);

    // Overall status must still be 'Needs Verification' (from 2025-2026), not overwritten by 2023-2024!
    const student = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [studentId]);
    assert.equal(student.rows[0].overall_status, 'Needs Verification', 'Archived document must not overwrite current standing');

    // Audit log should note that the archived document was preserved without overwriting
    const history = await db.query(`
      SELECT * FROM public.academic_standing_history 
      WHERE document_id = $1
    `, [archiveDocId]);
    assert.equal(history.rows.length, 1);
    assert.match(history.rows[0].confirmation_notes, /Archived document processed.*preserved current student status/i);
  });

  await t.test('3. Official Academic Standing Confirmation: Authorized Principal can confirm', async () => {
    await setAuthContext(db, principalTrisId, 'authenticated');

    // TRIS Principal confirms student as 'Passed' following remedial class completion
    await db.query(`
      SELECT public.confirm_student_academic_standing(
        $1::uuid,
        'Passed',
        '2025-2026',
        'Passed Summer Remedial Instruction; Certificate of Recomputed Final Grade verified.'
      );
    `, [studentId]);

    const student = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [studentId]);
    assert.equal(student.rows[0].overall_status, 'Passed');

    const history = await db.query(`
      SELECT * FROM public.academic_standing_history 
      WHERE student_id = $1 AND decision_source = 'school_head_review'
    `, [studentId]);
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].confirmed_by, principalTrisId);
    assert.match(history.rows[0].confirmation_notes, /Certificate of Recomputed Final Grade/i);
  });

  await t.test('4. Cross-School Isolation: SJNHS Principal BLOCKED from confirming TRIS student', async () => {
    await setAuthContext(db, principalSjnhsId, 'authenticated');

    let errorThrown = false;
    try {
      await db.query(`
        SELECT public.confirm_student_academic_standing(
          $1::uuid,
          'Failed',
          '2025-2026',
          'Unauthorized cross-school tamper attempt'
        );
      `, [studentId]);
    } catch (err) {
      errorThrown = true;
      assert.match(err.message, /Principal cannot modify students outside assigned school/i);
    }
    assert.ok(errorThrown, 'Cross-school standing modification must be strictly rejected');
  });

  await t.test('5. Teacher BLOCKED from confirming academic standing', async () => {
    await setAuthContext(db, teacherId, 'authenticated');

    let errorThrown = false;
    try {
      await db.query(`
        SELECT public.confirm_student_academic_standing(
          $1::uuid,
          'Passed',
          '2025-2026',
          'Teacher attempting school-head function'
        );
      `, [studentId]);
    } catch (err) {
      errorThrown = true;
      assert.match(err.message, /Only an authorized Admin or Principal can confirm/i);
    }
    assert.ok(errorThrown, 'Teacher must not be able to confirm academic standing');
  });
});

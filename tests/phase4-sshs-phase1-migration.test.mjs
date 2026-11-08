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

test('Phase 1 Strengthened SHS Migration (010) & Safeguards Verification', async (t) => {
  const db = new PGlite();
  await setupSupabaseMocks(db);

  // 1. Apply migrations 001, 002, 009_step1, 009_step2 first
  let m001 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '001_initial_schema.sql'), 'utf8');
  m001 = m001.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- pgcrypto built-in');
  await db.exec(m001);
  const m002 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '002_auth_rbac.sql'), 'utf8');
  await db.exec(m002);
  const step1 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '009_step1_add_principal_enum.sql'), 'utf8');
  const step2 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '009_step2_consolidated_schema_and_security.sql'), 'utf8');
  await db.exec(step1);
  await db.exec(step2);

  // Seed historical data BEFORE applying migration 010 to verify Safeguard 1
  const trisId = 'a0000000-0000-0000-0000-000000000001';
  const teacherId = '11111111-1111-1111-1111-111111111111';
  const principalId = '22222222-2222-2222-2222-222222222222';

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${teacherId}', 'teacher@tris.edu.ph'),
      ('${principalId}', 'principal@tris.edu.ph');

    INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES
      ('${teacherId}', 'teacher', 'Approved', '${trisId}'),
      ('${principalId}', 'principal', 'Approved', '${trisId}')
    ON CONFLICT (user_id) DO UPDATE SET
      role = EXCLUDED.role,
      account_status = EXCLUDED.account_status,
      school_id = EXCLUDED.school_id;
  `);

  const histStudentRes = await db.query(`
    INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
    VALUES ('109876543211', 'Pedro', 'Penduko', '${trisId}', 'Grade 11', 'Needs Verification')
    RETURNING id;
  `);
  const histStudentId = histStudentRes.rows[0].id;

  const histDocNoCurrRes = await db.query(`
    INSERT INTO public.documents (student_id, document_type, image_url, status, school_id, uploaded_by, extracted_fields)
    VALUES (
      '${histStudentId}',
      'sf10',
      'http://example.com/legacy_unlabeled.jpg',
      'validated',
      '${trisId}',
      '${teacherId}',
      '{"school_year":"2024-2025","grade_level":"Grade 10","grades":[{"subject":"Mathematics 10","final":86,"status":"Passed"}]}'::jsonb
    )
    RETURNING id;
  `);
  const histDocNoCurrId = histDocNoCurrRes.rows[0].id;

  const histDocLegacyShsRes = await db.query(`
    INSERT INTO public.documents (student_id, document_type, image_url, status, school_id, uploaded_by, extracted_fields)
    VALUES (
      '${histStudentId}',
      'sf10',
      'http://example.com/legacy_k12_shs.jpg',
      'validated',
      '${trisId}',
      '${teacherId}',
      '{"school_year":"2025-2026","grade_level":"Grade 11","curriculum":"SHS_LEGACY_K12_2016","grades":[{"subject":"Oral Communication","q1":85,"q2":87,"final":86,"status":"Passed"}]}'::jsonb
    )
    RETURNING id;
  `);
  const histDocLegacyShsId = histDocLegacyShsRes.rows[0].id;

  const m010 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '010_strengthened_shs_metadata.sql'), 'utf8');

  await t.test('1. Safeguard 1: Migration 010 is additive, idempotent, and never auto-labels existing documents as SHS_STRENGTHENED_2026', async () => {
    await db.exec(m010);
    // Rerun to prove idempotency
    await db.exec(m010);

    // Check historical documents were preserved and NOT defaulted to SHS_STRENGTHENED_2026
    const docs = await db.query(`
      SELECT id, curriculum_id, source_form_version, grading_policy_version, grading_period_scheme
      FROM public.documents
      WHERE id IN ($1, $2)
      ORDER BY created_at ASC;
    `, [histDocNoCurrId, histDocLegacyShsId]);

    assert.equal(docs.rows.length, 2, 'Both historical documents must be preserved');
    for (const row of docs.rows) {
      assert.equal(row.curriculum_id, null, 'Historical document curriculum_id must remain NULL, not defaulted to SHS_STRENGTHENED_2026');
      assert.equal(row.source_form_version, null, 'Historical document source_form_version must remain NULL');
      assert.equal(row.grading_policy_version, null, 'Historical document grading_policy_version must remain NULL');
      assert.equal(row.grading_period_scheme, null, 'Historical document grading_period_scheme must remain NULL');
    }
  });

  await t.test('2. Safeguard 2: TRIS sshs_pilot_status remains unverified (neither true nor false)', async () => {
    const tris = await db.query(`
      SELECT name, sshs_pilot_status, sshs_pilot_reference, school_calendar_type
      FROM public.schools
      WHERE id = $1;
    `, [trisId]);

    assert.equal(tris.rows.length, 1);
    assert.equal(tris.rows[0].name, 'Taysan Resettlement Integrated School');
    assert.equal(tris.rows[0].sshs_pilot_status, 'unverified', 'TRIS pilot status must remain unverified');
    assert.equal(tris.rows[0].sshs_pilot_reference, null);
    assert.equal(tris.rows[0].school_calendar_type, null);

    // Verify invalid pilot status values are rejected by constraint
    let invalidStatusRejected = false;
    try {
      await db.query(`UPDATE public.schools SET sshs_pilot_status = 'true' WHERE id = $1`, [trisId]);
    } catch {
      invalidStatusRejected = true;
    }
    assert.equal(invalidStatusRejected, true, 'Invalid sshs_pilot_status must be rejected by CHECK constraint');
  });

  await t.test('3. Safeguard 1 & 3: Approving historical/legacy documents preserves existing curriculum metadata or NULL', async () => {
    await setAuthContext(db, principalId, 'authenticated');

    // Approve historical document without curriculum metadata
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [histDocNoCurrId]);
    const g1 = await db.query(`SELECT curriculum_id, source_form_version, final_grade, status FROM public.subject_grades WHERE document_id = $1`, [histDocNoCurrId]);
    assert.equal(g1.rows.length, 1);
    assert.equal(g1.rows[0].curriculum_id, null, 'Unlabeled historical document must not invent curriculum_id');
    assert.equal(Number(g1.rows[0].final_grade), 86);
    assert.equal(g1.rows[0].status, 'Passed');

    // Approve historical document with extracted_fields->>'curriculum' = 'SHS_LEGACY_K12_2016'
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [histDocLegacyShsId]);
    const g2 = await db.query(`SELECT curriculum_id, final_grade, status FROM public.subject_grades WHERE document_id = $1`, [histDocLegacyShsId]);
    assert.equal(g2.rows.length, 1);
    assert.equal(g2.rows[0].curriculum_id, 'SHS_LEGACY_K12_2016', 'Existing curriculum metadata in extracted_fields must be preserved');

    const histAudit = await db.query(`SELECT curriculum, new_status FROM public.academic_standing_history WHERE document_id = $1`, [histDocLegacyShsId]);
    assert.equal(histAudit.rows.length, 1);
    assert.equal(histAudit.rows[0].curriculum, 'SHS_LEGACY_K12_2016');
  });

  await t.test('4. Safeguard 2, 3 & 4: Approving recognized SSHS SF10 v2026 Corrected record persists all verified fields faithfully', async () => {
    await setAuthContext(db, null, 'service_role');

    const sshsStudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543212', 'Maria', 'Clara', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const sshsStudentId = sshsStudentRes.rows[0].id;

    // Insert a recognized SSHS SF 10 v2026_corrected document
    const sshsSf10Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, shs_track,
        curriculum_id, source_form_version, grading_policy_version, grading_period_scheme,
        general_average_printed, general_average_action_taken,
        extracted_fields
      ) VALUES (
        $1, $2, 'sf10', 'http://example.com/sshs_sf10_v2026.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', 'Summary', 'Academic',
        'SHS_STRENGTHENED_2026', 'SSHS_SF10_V2026_CORRECTED', 'DO_015_S2026_TRANSITIONAL', 'quarterly_semestral',
        85, 'PASSED',
        $4::jsonb
      )
      RETURNING id;
    `, [
      sshsStudentId,
      trisId,
      teacherId,
      JSON.stringify({
        school_year: '2026-2027',
        grade_level: 'Grade 11',
        curriculum_id: 'SHS_STRENGTHENED_2026',
        source_form_version: 'SSHS_SF10_V2026_CORRECTED',
        grading_policy_version: 'DO_015_S2026_TRANSITIONAL',
        grading_period_scheme: 'quarterly_semestral',
        general_average: 85,
        grades: [
          {
            subject_code: '1',
            subject_track: 'CORE',
            subject_category: 'CORE',
            subject: 'Effective Communication & Mabisang Komunikasyon',
            source_section: 'summary_final_grades',
            q1: 84,
            q2: 86,
            q3: 88,
            q4: 86,
            final: 86,
            action_taken: 'PASSED',
            remark: 'The General Average / Final Grade is the average of four (4) quarterly grades.',
            status: 'Passed'
          },
          {
            subject_code: '6',
            subject_track: 'ACADEMIC',
            subject_category: 'ACADEMIC_ELECTIVE_REGULAR',
            subject: 'Biology 1',
            semester: 'First Semester',
            source_section: 'scholastic_sem1',
            q1: 88,
            q2: 90,
            sem1_final_grade: 89,
            final: 89,
            action_taken: 'PASSED',
            remark: 'Ave. of 2 Qs; Sem. Grade',
            status: 'Passed'
          },
          {
            subject_code: '7',
            subject_track: 'ACADEMIC',
            subject_category: 'ACADEMIC_ELECTIVE_REGULAR',
            subject: 'Pre-Calculus',
            semester: 'First Semester',
            source_section: 'remediation_sem1',
            q1: 70,
            q2: 74,
            failed_final_grade: 72,
            remedial_class_mark: 84,
            recomputed_final_grade: 78,
            remedial_sem1_recomputed: 78,
            final: 78,
            action_taken: 'PASSED',
            remark: 'Recomputed after remediation',
            status: 'Passed'
          }
        ]
      })
    ]);
    const sshsSf10Id = sshsSf10Res.rows[0].id;

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [sshsSf10Id]);

    const grades = await db.query(`
      SELECT *
      FROM public.subject_grades
      WHERE document_id = $1
      ORDER BY subject_code ASC;
    `, [sshsSf10Id]);

    assert.equal(grades.rows.length, 3);

    // Core row
    const coreRow = grades.rows[0];
    assert.equal(coreRow.subject_code, '1');
    assert.equal(coreRow.subject_track, 'CORE');
    assert.equal(coreRow.subject_category, 'CORE');
    assert.equal(Number(coreRow.q1), 84);
    assert.equal(Number(coreRow.q2), 86);
    assert.equal(Number(coreRow.q3), 88);
    assert.equal(Number(coreRow.q4), 86);
    assert.equal(Number(coreRow.final_grade), 86);
    assert.equal(coreRow.action_taken, 'PASSED');
    assert.equal(coreRow.remark, 'The General Average / Final Grade is the average of four (4) quarterly grades.');
    assert.equal(coreRow.curriculum_id, 'SHS_STRENGTHENED_2026');
    assert.equal(coreRow.source_form_version, 'SSHS_SF10_V2026_CORRECTED');
    assert.equal(coreRow.grading_policy_version, 'DO_015_S2026_TRANSITIONAL');

    // Academic Elective row
    const elecRow = grades.rows[1];
    assert.equal(elecRow.subject_track, 'ACADEMIC');
    assert.equal(Number(elecRow.sem1_final_grade), 89);
    assert.equal(elecRow.remark, 'Ave. of 2 Qs; Sem. Grade');

    // Remediation row
    const remRow = grades.rows[2];
    assert.equal(Number(remRow.failed_final_grade), 72);
    assert.equal(Number(remRow.remedial_class_mark), 84);
    assert.equal(Number(remRow.recomputed_final_grade), 78);
    assert.equal(Number(remRow.remedial_sem1_recomputed), 78);
    assert.equal(Number(remRow.final_grade), 78);

    // Check academic_standing_history provenance
    const standing = await db.query(`
      SELECT curriculum, source_form_version, grading_policy_version, general_average_printed, new_status
      FROM public.academic_standing_history
      WHERE document_id = $1;
    `, [sshsSf10Id]);
    assert.equal(standing.rows.length, 1);
    assert.equal(standing.rows[0].curriculum, 'SHS_STRENGTHENED_2026');
    assert.equal(standing.rows[0].source_form_version, 'SSHS_SF10_V2026_CORRECTED');
    assert.equal(standing.rows[0].grading_policy_version, 'DO_015_S2026_TRANSITIONAL');
    assert.equal(Number(standing.rows[0].general_average_printed), 85);
    assert.equal(standing.rows[0].new_status, 'Passed');
  });

  await t.test('5. Safeguard 2 & 3: Supports DO 015, s. 2026 Annex G Three-Term SF9 and never invents missing Final Grades', async () => {
    await setAuthContext(db, null, 'service_role');

    const sf9StudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543213', 'Crisostomo', 'Ibarra', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const sf9StudentId = sf9StudentRes.rows[0].id;

    // Insert DO 015, s. 2026 Annex G SF9 with one complete 3-term subject and one incomplete subject (missing Final Grade)
    const sf9DocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, shs_track,
        curriculum_id, source_form_version, grading_policy_version, grading_period_scheme,
        extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/sshs_sf9_annex_g.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', 'Academic',
        'SHS_STRENGTHENED_2026', 'DO_015_S2026_ANNEX_G_SF9', 'DO_015_S2026_TRANSITIONAL', 'three_term',
        $4::jsonb
      )
      RETURNING id;
    `, [
      sf9StudentId,
      trisId,
      teacherId,
      JSON.stringify({
        school_year: '2026-2027',
        grade_level: 'Grade 11',
        curriculum_id: 'SHS_STRENGTHENED_2026',
        source_form_version: 'DO_015_S2026_ANNEX_G_SF9',
        grading_policy_version: 'DO_015_S2026_TRANSITIONAL',
        grading_period_scheme: 'three_term',
        grades: [
          {
            subject_track: 'CORE',
            subject_category: 'CORE',
            subject: 'General Mathematics',
            t1: 84,
            t2: 86,
            t3: 88,
            units: 6,
            final: 86,
            remark: 'Benchmarking',
            status: 'Passed'
          },
          {
            subject_track: 'CORE',
            subject_category: 'CORE',
            subject: 'General Science',
            t1: 80,
            t2: 82,
            t3: 84
            // final is intentionally omitted to verify no synthetic averaging
          }
        ]
      })
    ]);
    const sf9DocId = sf9DocRes.rows[0].id;

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [sf9DocId]);

    const sf9Grades = await db.query(`
      SELECT subject, t1, t2, t3, units, final_grade, status, needs_verification, grading_period_scheme
      FROM public.subject_grades
      WHERE document_id = $1
      ORDER BY subject ASC;
    `, [sf9DocId]);

    assert.equal(sf9Grades.rows.length, 2);

    const genMath = sf9Grades.rows[0];
    assert.equal(genMath.subject, 'General Mathematics');
    assert.equal(Number(genMath.t1), 84);
    assert.equal(Number(genMath.t2), 86);
    assert.equal(Number(genMath.t3), 88);
    assert.equal(Number(genMath.units), 6);
    assert.equal(Number(genMath.final_grade), 86);
    assert.equal(genMath.status, 'Passed');
    assert.equal(genMath.grading_period_scheme, 'three_term');

    const genSci = sf9Grades.rows[1];
    assert.equal(genSci.subject, 'General Science');
    assert.equal(Number(genSci.t1), 80);
    assert.equal(Number(genSci.t2), 82);
    assert.equal(Number(genSci.t3), 84);
    assert.equal(genSci.final_grade, null, 'Trigger must NEVER invent final_grade from (t1+t2+t3)/3');
    assert.equal(genSci.status, 'Missing');
    assert.equal(genSci.needs_verification, true, 'Missing final grade must be flagged for human verification');

    const studentStanding = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [sf9StudentId]);
    assert.equal(studentStanding.rows[0].overall_status, 'Needs Verification', 'Student with missing final grade must remain at Needs Verification');
  });

  await t.test('6. Safeguard 3: action_taken does NOT override status=Missing and stale final_grade key does NOT invent missing final', async () => {
    await setAuthContext(db, null, 'service_role');

    const sRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543214', 'Elias', 'Salome', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const sId = sRes.rows[0].id;

    // Document where final is null and status is Missing, even though action_taken='PASSED' (e.g. semestral column) and a stale final_grade=99 key exists
    const docRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, curriculum_id, source_form_version,
        extracted_fields
      ) VALUES (
        $1, $2, 'sf10', 'http://example.com/partial_sf10.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', 'SHS_STRENGTHENED_2026', 'SSHS_SF10_V2026_CORRECTED',
        $4::jsonb
      )
      RETURNING id;
    `, [
      sId,
      trisId,
      teacherId,
      JSON.stringify({
        school_year: '2026-2027',
        grade_level: 'Grade 11',
        grades: [
          {
            subject: 'Life and Career Skills',
            q1: 85,
            q2: 87,
            final: null,
            final_grade: 99, // stale key must be ignored when final is null
            action_taken: 'PASSED', // verbatim printed text must NOT override status='Missing'
            status: 'Missing'
          }
        ]
      })
    ]);
    const docId = docRes.rows[0].id;

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [docId]);

    const sg = await db.query(`
      SELECT final_grade, status, action_taken, needs_verification
      FROM public.subject_grades
      WHERE document_id = $1;
    `, [docId]);
    assert.equal(sg.rows.length, 1);
    assert.equal(sg.rows[0].final_grade, null, 'final_grade must remain NULL when final is null');
    assert.equal(sg.rows[0].status, 'Missing', 'status must remain Missing and not be overridden by action_taken');
    assert.equal(sg.rows[0].action_taken, 'PASSED', 'action_taken text is still preserved verbatim');
    assert.equal(sg.rows[0].needs_verification, true);
  });

  await t.test('7. Safeguard 1 & 3: Metadata update on already-approved document does NOT overwrite Principal school_head_review standing', async () => {
    await setAuthContext(db, null, 'service_role');

    const sRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543215', 'Basilio', 'Sisa', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const sId = sRes.rows[0].id;

    const docRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        extracted_fields
      ) VALUES (
        $1, $2, 'sf10', 'http://example.com/remedial_sf10.jpg', 'validated', $3,
        '{"school_year":"2026-2027","grade_level":"Grade 11","grades":[{"subject":"General Mathematics","final":72,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [sId, trisId, teacherId]);
    const docId = docRes.rows[0].id;

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [docId]);

    // Principal confirms student standing as Passed after remedial verification
    await db.query(`
      SELECT public.confirm_student_academic_standing(
        $1::uuid,
        'Passed',
        '2026-2027',
        'Verified Summer Remedial Class completion.'
      );
    `, [sId]);

    const beforeUpdate = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [sId]);
    assert.equal(beforeUpdate.rows[0].overall_status, 'Passed');

    // Now update document-level metadata on the already-approved document
    await db.query(`
      UPDATE public.documents
      SET curriculum_id = 'SHS_STRENGTHENED_2026',
          source_form_version = 'SSHS_SF10_V2026_CORRECTED'
      WHERE id = $1;
    `, [docId]);

    const afterUpdate = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [sId]);
    assert.equal(afterUpdate.rows[0].overall_status, 'Passed', 'Metadata update on already-approved document must NOT clobber Principal confirmed standing');

    const historyCount = await db.query(`SELECT COUNT(*) FROM public.academic_standing_history WHERE student_id = $1`, [sId]);
    assert.equal(parseInt(historyCount.rows[0].count, 10), 2, 'Must only have initial approval log + school_head_review log (no duplicate trigger log)');
  });

  await t.test('8. School-year comparison & archive protection across all AVV formats (S.Y., SY, slash, hyphen)', async () => {
    await setAuthContext(db, null, 'service_role');

    const sRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543216', 'Isagani', 'Florentino', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const sId = sRes.rows[0].id;

    // 8a. Approve a 2025/2026 document with failing grade -> status = 'Needs Verification'
    const doc2025Res = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, extracted_fields)
      VALUES (
        $1, $2, 'sf10', 'http://example.com/sy2025_slash.jpg', 'validated', $3,
        '{"school_year":"2025/2026","grade_level":"Grade 11","grades":[{"subject":"General Mathematics","final":71,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [sId, trisId, teacherId]);
    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [doc2025Res.rows[0].id]);

    let st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [sId]);
    assert.equal(st.rows[0].overall_status, 'Needs Verification');

    // 8b. Approve an older archived document with 'S.Y. 2023-2024' (all Passed).
    // Even though 'S' > '2' in ASCII, 2023 < 2025 numerically so it MUST be treated as archived and NOT overwrite standing to Passed!
    await setAuthContext(db, null, 'service_role');
    const doc2023Res = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, extracted_fields)
      VALUES (
        $1, $2, 'sf9', 'http://example.com/sy2023_prefixed.jpg', 'validated', $3,
        '{"school_year":"S.Y. 2023-2024","grade_level":"Grade 9","grades":[{"subject":"Mathematics 9","final":92,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [sId, trisId, teacherId]);
    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [doc2023Res.rows[0].id]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [sId]);
    assert.equal(st.rows[0].overall_status, 'Needs Verification', 'Archived S.Y. 2023-2024 document must NOT overwrite 2025/2026 standing');

    // 8c. Approve a newer '2026-2027' document (all Passed) even when 'S.Y. 2023-2024' exists in documents.
    // Because 2026 > max(2025, 2023), it MUST NOT be misclassified as archived and MUST update standing to Passed!
    await setAuthContext(db, null, 'service_role');
    const doc2026Res = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, extracted_fields)
      VALUES (
        $1, $2, 'sf10', 'http://example.com/sy2026_current.jpg', 'validated', $3,
        '{"school_year":"2026-2027","grade_level":"Grade 12","grades":[{"subject":"Biology 1","final":90,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [sId, trisId, teacherId]);
    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [doc2026Res.rows[0].id]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [sId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'Newer 2026-2027 document must update standing even when S.Y. 2023-2024 exists');
  });

  await t.test('9. Function privileges & non-destructive restoration of 009 process_approved_document()', async () => {
    await setAuthContext(db, null, 'service_role');

    // Verify authenticated and service_role have EXECUTE privilege on process_approved_document(), and anon does NOT
    const privs = await db.query(`
      SELECT
        has_function_privilege('anon', 'public.process_approved_document()', 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', 'public.process_approved_document()', 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', 'public.process_approved_document()', 'EXECUTE') AS srv_exec
    `);
    assert.equal(privs.rows[0].anon_exec, false, 'anon must not have EXECUTE privilege on process_approved_document()');
    assert.equal(privs.rows[0].auth_exec, true);
    assert.equal(privs.rows[0].srv_exec, true);

    // Extract 009's process_approved_document() definition and restore it on top of the 010 schema
    const fnStart = step2.indexOf('CREATE OR REPLACE FUNCTION public.process_approved_document()');
    const fnEnd = step2.indexOf('GRANT EXECUTE ON FUNCTION public.process_approved_document() TO authenticated, service_role;') +
      'GRANT EXECUTE ON FUNCTION public.process_approved_document() TO authenticated, service_role;'.length;
    const m009FunctionSql = step2.slice(fnStart, fnEnd);

    await db.exec(m009FunctionSql);

    // Verify approving a document with 009's restored trigger function succeeds on the 010 schema
    const sRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543217', 'Simoun', 'Ibarra', '${trisId}', 'Grade 12', 'Needs Verification')
      RETURNING id;
    `);
    const docRes = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, extracted_fields)
      VALUES (
        $1, $2, 'sf10', 'http://example.com/rollback_test.jpg', 'validated', $3,
        '{"school_year":"2026-2027","grade_level":"Grade 12","grades":[{"subject":"Chemistry 1","final":88,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [sRes.rows[0].id, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [docRes.rows[0].id]);

    const sg = await db.query(`SELECT subject, final_grade, status FROM public.subject_grades WHERE document_id = $1`, [docRes.rows[0].id]);
    assert.equal(sg.rows.length, 1);
    assert.equal(Number(sg.rows[0].final_grade), 88);

    // Re-apply 010 so database leaves test in Phase 1 state
    await setAuthContext(db, null, 'service_role');
    await db.exec(m010);
  });

  await t.test('10. Issue 1 Regression: Same-school-year ordering (reversed 1st/2nd sem, 3-term, legacy without semester, and Principal confirmation preservation)', async () => {
    // 10a. Reversed approval order: 2nd Semester (Passed) approved FIRST, then 1st Semester (Failed) approved SECOND
    await setAuthContext(db, null, 'service_role');
    const semStudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543218', 'Paulita', 'Gomez', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const semStudentId = semStudentRes.rows[0].id;

    const sem2DocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/sy2026_sem2.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', '2nd Semester',
        '{"school_year":"2026-2027","grade_level":"Grade 11","semester":"2nd Semester","grades":[{"subject":"Biology 2","final":89,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [semStudentId, trisId, teacherId]);
    const sem2DocId = sem2DocRes.rows[0].id;

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [sem2DocId]);

    let st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [semStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', '2nd Semester (all Passed) sets student standing to Passed');

    // Now approve 1st Semester for the SAME school year (2026-2027) containing a failing grade
    await setAuthContext(db, null, 'service_role');
    const sem1DocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/sy2026_sem1.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', '1st Semester',
        '{"school_year":"2026-2027","grade_level":"Grade 11","semester":"1st Semester","grades":[{"subject":"Biology 1","final":71,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [semStudentId, trisId, teacherId]);
    const sem1DocId = sem1DocRes.rows[0].id;

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [sem1DocId]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [semStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', '1st Semester approved after 2nd Semester for same SY must NOT overwrite 2nd Semester standing');

    const sem1Hist = await db.query(`SELECT confirmation_notes FROM public.academic_standing_history WHERE document_id = $1`, [sem1DocId]);
    assert.equal(sem1Hist.rows.length, 1);
    assert.match(sem1Hist.rows[0].confirmation_notes, /Archived document processed.*preserved current student status/i);

    // 10b. Same-year Three-Term ordering: Term 3 (Passed) approved FIRST, then Term 1 and Term 2 (with failing marks) approved AFTER
    await setAuthContext(db, null, 'service_role');
    const termStudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543219', 'Macaraig', 'Sandoval', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const termStudentId = termStudentRes.rows[0].id;

    const term3DocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/sy2026_term3.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', 'Term 3',
        '{"school_year":"2026-2027","grade_level":"Grade 11","term":"Term 3","grades":[{"subject":"General Science","final":88,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [termStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [term3DocRes.rows[0].id]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [termStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed');

    await setAuthContext(db, null, 'service_role');
    const term1DocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/sy2026_term1.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', 'Term 1',
        '{"school_year":"2026-2027","grade_level":"Grade 11","term":"Term 1","grades":[{"subject":"General Science","final":70,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [termStudentId, trisId, teacherId]);

    const term2DocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/sy2026_term2.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', 'Term 2 (Ikalawang Termino)',
        '{"school_year":"2026-2027","grade_level":"Grade 11","term":"Term 2 (Ikalawang Termino)","grades":[{"subject":"General Science","final":72,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [termStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [term1DocRes.rows[0].id]);
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [term2DocRes.rows[0].id]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [termStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'Term 1 and Term 2 approved after Term 3 for same SY must NOT overwrite Term 3 standing');

    // 10c. Legacy documents without semester/term metadata for the same school year preserve current behavior
    await setAuthContext(db, null, 'service_role');
    const legacyStudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543220', 'Placido', 'Penitente', '${trisId}', 'Grade 10', 'Needs Verification')
      RETURNING id;
    `);
    const legacyStudentId = legacyStudentRes.rows[0].id;

    const legDoc1Res = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, extracted_fields)
      VALUES (
        $1, $2, 'sf10', 'http://example.com/leg_2025_1.jpg', 'validated', $3,
        '{"school_year":"2025-2026","grade_level":"Grade 10","grades":[{"subject":"English 10","final":85,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [legacyStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [legDoc1Res.rows[0].id]);
    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [legacyStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed');

    await setAuthContext(db, null, 'service_role');
    const legDoc2Res = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, extracted_fields)
      VALUES (
        $1, $2, 'sf10', 'http://example.com/leg_2025_2.jpg', 'validated', $3,
        '{"school_year":"2025-2026","grade_level":"Grade 10","grades":[{"subject":"Mathematics 10","final":70,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [legacyStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [legDoc2Res.rows[0].id]);
    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [legacyStudentId]);
    assert.equal(st.rows[0].overall_status, 'Needs Verification', 'Legacy documents without semester metadata preserve current behavior and update standing');

    // 10d. Principal-confirmed decision preserved when earlier semester or older year document is subsequently approved or un-approved
    await db.query(`
      SELECT public.confirm_student_academic_standing(
        $1::uuid,
        'Passed',
        '2025-2026',
        'Principal confirmed Passed after remedial completion.'
      );
    `, [legacyStudentId]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [legacyStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed');

    await setAuthContext(db, null, 'service_role');
    const sem1AfterPrincipalRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/sem1_after_principal.jpg', 'validated', $3,
        '2025-2026', 'Grade 10', '1st Semester',
        '{"school_year":"2025-2026","grade_level":"Grade 10","semester":"1st Semester","grades":[{"subject":"Science 10","final":71,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [legacyStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [sem1AfterPrincipalRes.rows[0].id]);
    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [legacyStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'Principal-confirmed standing must not be overwritten by same-year automated trigger');

    // Un-approving that document (CASE B) must also preserve the Principal-confirmed standing
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = $1`, [sem1AfterPrincipalRes.rows[0].id]);
    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [legacyStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'CASE B revert must preserve Principal-confirmed standing');
  });

  await t.test('11. Issue 2 Regression: Null, blank, and malformed school-year metadata never throws or masquerades as valid year', async () => {
    await setAuthContext(db, null, 'service_role');
    const badSyStudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543221', 'Juli', 'Tales', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const badSyStudentId = badSyStudentRes.rows[0].id;

    // First approve a valid 2024-2025 document (all Passed -> overall_status = 'Passed')
    const valid2024Res = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, school_year, extracted_fields)
      VALUES (
        $1, $2, 'sf10', 'http://example.com/valid_2024.jpg', 'validated', $3,
        '2024-2025',
        '{"school_year":"2024-2025","grade_level":"Grade 10","grades":[{"subject":"Filipino 10","final":88,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [badSyStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [valid2024Res.rows[0].id]);

    let st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [badSyStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed');

    // Now test null, blank, and malformed school_year values (including ones with 4-digit numbers >= 2028
    // that would have been misparsed as newer years by substring(... from '([12][0-9]{3})')!)
    const invalidSchoolYears = [
      null,
      '',
      '   ',
      '2028',                // single year (missing range)
      '2028-2030',           // non-consecutive range (end != start + 1)
      '2029-2028',           // inverted range
      '209999999999',        // 12-digit LRN-like string starting with 2099
      'SY Twenty-Twenty-Six' // non-numeric text
    ];

    for (let i = 0; i < invalidSchoolYears.length; i++) {
      const badSy = invalidSchoolYears[i];
      await setAuthContext(db, null, 'service_role');
      const badDocRes = await db.query(`
        INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, school_year, extracted_fields)
        VALUES (
          $1, $2, 'sf10', $3, 'validated', $4,
          $5,
          $6::jsonb
        )
        RETURNING id;
      `, [
        badSyStudentId,
        trisId,
        `http://example.com/bad_sy_${i}.jpg`,
        teacherId,
        badSy,
        JSON.stringify({
          ...(badSy !== null ? { school_year: badSy } : {}),
          grade_level: 'Grade 11',
          grades: [{ subject: 'General Mathematics', final: 70, status: 'Failed' }]
        })
      ]);

      await setAuthContext(db, principalId, 'authenticated');
      // Must NOT throw any trigger/cast error
      await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [badDocRes.rows[0].id]);

      st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [badSyStudentId]);
      assert.equal(
        st.rows[0].overall_status,
        'Passed',
        `Invalid school_year (${JSON.stringify(badSy)}) must NOT be treated as a valid year or overwrite valid 2024-2025 standing`
      );
    }

    // Finally verify that a genuine valid newer school year ('SY 2025-2026' with a failing grade) DOES update standing
    await setAuthContext(db, null, 'service_role');
    const valid2025Res = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, school_year, extracted_fields)
      VALUES (
        $1, $2, 'sf10', 'http://example.com/valid_2025.jpg', 'validated', $3,
        'SY 2025-2026',
        '{"school_year":"SY 2025-2026","grade_level":"Grade 11","grades":[{"subject":"General Mathematics","final":71,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [badSyStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [valid2025Res.rows[0].id]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [badSyStudentId]);
    assert.equal(st.rows[0].overall_status, 'Needs Verification', 'Valid newer school year SY 2025-2026 must still sort and update standing properly');
  });

  await t.test('12. Audit Issue 1 Regression: CASE B & CASE A calendar-family isolation (mixed semester/three-term, summary vs term/semester, and legacy without period)', async () => {
    // 12a. Mixed semester vs three-term: Term 3 (ordinal 3, Failed) approved FIRST, then 2nd Semester (ordinal 2, Passed) approved SECOND.
    // Neither CASE A nor CASE B may infer that Term 3 (3) is newer than 2nd Semester (2) across different calendar families.
    await setAuthContext(db, null, 'service_role');
    const mixedStudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543222', 'Sandoval', 'Tadeo', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const mixedStudentId = mixedStudentRes.rows[0].id;

    const term3DocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/mixed_term3.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', 'Term 3',
        '{"school_year":"2026-2027","grade_level":"Grade 11","term":"Term 3","grades":[{"subject":"General Science","final":70,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [mixedStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [term3DocRes.rows[0].id]);

    let st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [mixedStudentId]);
    assert.equal(st.rows[0].overall_status, 'Needs Verification');

    await setAuthContext(db, null, 'service_role');
    const sem2DocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/mixed_sem2.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', '2nd Semester',
        '{"school_year":"2026-2027","grade_level":"Grade 11","semester":"2nd Semester","grades":[{"subject":"Biology 2","final":90,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [mixedStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [sem2DocRes.rows[0].id]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [mixedStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'CASE A must not treat 2nd Semester as older than Term 3 across different calendar families');

    // Now approve and revert an older 2024-2025 document to trigger CASE B recalculation across remaining [Term 3, 2nd Semester]
    await setAuthContext(db, null, 'service_role');
    const tempOldDocRes = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, status, uploaded_by, school_year, extracted_fields)
      VALUES (
        $1, $2, 'sf9', 'http://example.com/temp_old_2024.jpg', 'validated', $3,
        '2024-2025',
        '{"school_year":"2024-2025","grade_level":"Grade 9","grades":[{"subject":"Math 9","final":71,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [mixedStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [tempOldDocRes.rows[0].id]);
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = $1`, [tempOldDocRes.rows[0].id]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [mixedStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'CASE B must not let Term 3 (ordinal 3) override more recent 2nd Semester (ordinal 2) from a different calendar family');

    // 12b. Summary as a distinct period family vs Term 3 and 2nd Semester
    await setAuthContext(db, null, 'service_role');
    const summaryDocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf10', 'http://example.com/summary_2026.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', 'Summary of Final Grades',
        '{"school_year":"2026-2027","grade_level":"Grade 11","semester":"Summary of Final Grades","grades":[{"subject":"Effective Communication","final":88,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [mixedStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [summaryDocRes.rows[0].id]);

    // Now approve a Term 3 (Failed) document AFTER Summary -> Summary must be preserved
    await setAuthContext(db, null, 'service_role');
    const lateTerm3Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/late_term3.jpg', 'validated', $3,
        '2026-2027', 'Grade 11', 'Term 3',
        '{"school_year":"2026-2027","grade_level":"Grade 11","term":"Term 3","grades":[{"subject":"General Mathematics","final":70,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [mixedStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [lateTerm3Res.rows[0].id]);
    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [mixedStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'Full-year summary must not be overwritten by a single-term record for the same school year');

    // Revert sem2Doc -> CASE B must still pick Summary ('Passed') over lateTerm3 ('Failed')
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = $1`, [sem2DocRes.rows[0].id]);
    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [mixedStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'CASE B must prefer full-year summary over single-term records for the same school year');

    // 12c. Legacy record without period metadata approved AFTER a 1st Semester record must not be demoted in CASE B
    await setAuthContext(db, null, 'service_role');
    const legMixStudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543223', 'Pecson', 'Pelaez', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const legMixStudentId = legMixStudentRes.rows[0].id;

    const firstSemFailRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, semester, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/sem1_fail.jpg', 'validated', $3,
        '2025-2026', 'Grade 11', '1st Semester',
        '{"school_year":"2025-2026","grade_level":"Grade 11","semester":"1st Semester","grades":[{"subject":"Oral Communication","final":70,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [legMixStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [firstSemFailRes.rows[0].id]);

    await setAuthContext(db, null, 'service_role');
    const legacyNoSemPassRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, extracted_fields
      ) VALUES (
        $1, $2, 'sf10', 'http://example.com/legacy_no_sem_pass.jpg', 'validated', $3,
        '2025-2026', 'Grade 11',
        '{"school_year":"2025-2026","grade_level":"Grade 11","grades":[{"subject":"Oral Communication","final":86,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [legMixStudentId, trisId, teacherId]);

    const dummy2023Res = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, grade_level, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/dummy_2023.jpg', 'validated', $3,
        '2023-2024', 'Grade 9',
        '{"school_year":"2023-2024","grade_level":"Grade 9","grades":[{"subject":"Math 9","final":85,"status":"Passed"}]}'::jsonb
      )
      RETURNING id;
    `, [legMixStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [legacyNoSemPassRes.rows[0].id]);
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [dummy2023Res.rows[0].id]);

    // Trigger CASE B by un-approving dummy2023 -> legacyNoSemPass (approved more recently than firstSemFail) must win!
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = $1`, [dummy2023Res.rows[0].id]);
    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [legMixStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'CASE B must preserve legacy behavior when period metadata is missing rather than demoting NULL period_order');
  });

  await t.test('13. Audit Issue 2 Regression: Principal/registrar confirmation safety across multiple years, malformed metadata, and unapprove/delete', async () => {
    // 13a. Multiple human confirmations for different school years (2025-2026 confirmed FIRST as Passed, then 2024-2025 confirmed SECOND as Failed)
    // Plus a confirmation with malformed school-year ('2099') that must NOT be inferred as newer than 2025-2026
    await setAuthContext(db, null, 'service_role');
    const multiConfStudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543224', 'Cabesang', 'Tales', '${trisId}', 'Grade 12', 'Needs Verification')
      RETURNING id;
    `);
    const multiConfStudentId = multiConfStudentRes.rows[0].id;

    // Insert a remaining approved document with a malformed school year ('invalid-sy') and failing grade
    const malformedRemDocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, extracted_fields
      ) VALUES (
        $1, $2, 'sf10', 'http://example.com/malformed_rem.jpg', 'validated', $3,
        'invalid-sy',
        '{"school_year":"invalid-sy","grades":[{"subject":"General Math","final":70,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [multiConfStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [malformedRemDocRes.rows[0].id]);

    // Principal confirms 2025-2026 as Passed
    await db.query(`
      SELECT public.confirm_student_academic_standing(
        $1::uuid,
        'Passed',
        '2025-2026',
        'Confirmed Passed for SY 2025-2026.'
      );
    `, [multiConfStudentId]);

    // Principal retroactively logs a confirmation for older SY 2024-2025 as Needs Verification, and a malformed SY '2099' row as Failed
    await setAuthContext(db, null, 'service_role');
    await db.query(`
      INSERT INTO public.academic_standing_history (
        student_id, school_year, previous_status, new_status, decision_source, confirmed_by, confirmation_notes
      ) VALUES
        ($1, '2024-2025', 'Needs Verification', 'Needs Verification', 'school_head_review', $2, 'Retroactive note for 2024-2025'),
        ($1, '2099', 'Passed', 'Failed', 'registrar_manual', $2, 'Malformed single-year entry must not outrank valid 2025-2026');
    `, [multiConfStudentId, principalId]);

    // Now approve a 2025-2026 document with a failing grade (CASE A) -> must preserve 'Passed' from the 2025-2026 confirmation!
    const doc2025FailRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, extracted_fields
      ) VALUES (
        $1, $2, 'sf9', 'http://example.com/doc2025_fail.jpg', 'validated', $3,
        '2025-2026',
        '{"school_year":"2025-2026","grades":[{"subject":"Physics 1","final":71,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [multiConfStudentId, trisId, teacherId]);

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [doc2025FailRes.rows[0].id]);

    let st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [multiConfStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'CASE A must preserve latest valid-SY confirmation (2025-2026 Passed) over older 2024-2025 and malformed 2099 confirmations');

    // Now un-approve doc2025Fail (CASE B), leaving only malformedRemDoc ('invalid-sy') as the remaining approved document!
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = $1`, [doc2025FailRes.rows[0].id]);
    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [multiConfStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'CASE B must preserve valid 2025-2026 confirmation when remaining approved document has missing/malformed SY');

    // 13b. Confirmation with missing/malformed school-year metadata AND unapproving/deleting the document associated with a confirmation
    await setAuthContext(db, null, 'service_role');
    const nullSyConfStudentRes = await db.query(`
      INSERT INTO public.students (lrn, first_name, last_name, school_id, grade_level, overall_status)
      VALUES ('109876543225', 'Hermana', 'Penchang', '${trisId}', 'Grade 11', 'Needs Verification')
      RETURNING id;
    `);
    const nullSyConfStudentId = nullSyConfStudentRes.rows[0].id;

    const assocDocRes = await db.query(`
      INSERT INTO public.documents (
        student_id, school_id, document_type, image_url, status, uploaded_by,
        school_year, extracted_fields
      ) VALUES (
        $1, $2, 'sf10', 'http://example.com/assoc_doc.jpg', 'validated', $3,
        '2025-2026',
        '{"school_year":"2025-2026","grades":[{"subject":"Chemistry 1","final":72,"status":"Failed"}]}'::jsonb
      )
      RETURNING id;
    `, [nullSyConfStudentId, trisId, teacherId]);
    const assocDocId = assocDocRes.rows[0].id;

    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [assocDocId]);

    // Principal confirms Passed with NULL school_year, and associate confirmation directly with assocDocId
    await db.query(`
      SELECT public.confirm_student_academic_standing(
        $1::uuid,
        'Passed',
        NULL,
        'Confirmed Passed with missing school_year metadata.'
      );
    `, [nullSyConfStudentId]);
    await setAuthContext(db, null, 'service_role');
    await db.query(`
      UPDATE public.academic_standing_history
      SET document_id = $1
      WHERE student_id = $2 AND decision_source = 'school_head_review';
    `, [assocDocId, nullSyConfStudentId]);

    // Verify no school_year was invented on the confirmation row
    const confRow = await db.query(`
      SELECT school_year, decision_source, new_status
      FROM public.academic_standing_history
      WHERE student_id = $1 AND decision_source = 'school_head_review';
    `, [nullSyConfStudentId]);
    assert.equal(confRow.rows.length, 1);
    assert.equal(confRow.rows[0].school_year, null, 'Must not invent a school year on confirmation with NULL school_year');

    // Un-approving assocDocId (UPDATE status = 'rejected') must NOT silently replace confirmed Passed standing
    await setAuthContext(db, principalId, 'authenticated');
    await db.query(`UPDATE public.documents SET status = 'rejected' WHERE id = $1`, [assocDocId]);
    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [nullSyConfStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'Unapproving document associated with confirmation must NOT silently overwrite confirmed standing');

    // Re-approve and then DELETE assocDocId (DELETE FROM public.documents) -> must not throw FK error and must preserve confirmed standing and audit history
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [assocDocId]);
    await setAuthContext(db, null, 'service_role');
    await db.query(`DELETE FROM public.documents WHERE id = $1`, [assocDocId]);

    st = await db.query(`SELECT overall_status FROM public.students WHERE id = $1`, [nullSyConfStudentId]);
    assert.equal(st.rows[0].overall_status, 'Passed', 'Deleting approved document associated with confirmation must preserve confirmed standing');

    const preservedAudit = await db.query(`
      SELECT decision_source, new_status, document_id
      FROM public.academic_standing_history
      WHERE student_id = $1 AND decision_source = 'school_head_review';
    `, [nullSyConfStudentId]);
    assert.equal(preservedAudit.rows.length, 1, 'Confirmation audit history row must be preserved after document deletion');
    assert.equal(preservedAudit.rows[0].decision_source, 'school_head_review');
    assert.equal(preservedAudit.rows[0].new_status, 'Passed');
    assert.equal(preservedAudit.rows[0].document_id, null, 'FK ON DELETE SET NULL clears document_id while preserving confirmation row');
  });
});





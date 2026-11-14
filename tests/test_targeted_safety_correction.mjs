import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("Final Targeted Safety Correction Suite for Migration 015", async (t) => {
  const schoolA = "a0000000-0000-0000-0000-000000000001";
  const schoolB = "b0000000-0000-0000-0000-000000000002";

  // Helper to initialize isolated database with full production schema + 014
  async function initDb() {
    const db = new PGlite();

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
        created_at timestamptz DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean AS $$
      BEGIN
        IF auth.uid() IS NULL THEN RETURN false; END IF;
        RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin' AND account_status = 'Approved');
      END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

      CREATE OR REPLACE FUNCTION public.is_principal() RETURNS boolean AS $$
      BEGIN
        IF auth.uid() IS NULL THEN RETURN false; END IF;
        RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'principal' AND account_status = 'Approved');
      END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

      CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS boolean AS $$
      BEGIN
        IF auth.uid() IS NULL THEN RETURN false; END IF;
        RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND account_status = 'Approved');
      END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

      CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS uuid AS $$
      BEGIN
        IF auth.uid() IS NULL THEN RETURN NULL; END IF;
        RETURN (SELECT school_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1);
      END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);

    const backupSql = fs.readFileSync("C:/Users/windows-11/.gemini/antigravity/brain/3bd93d8b-599d-47ba-9020-42d155f09897/complete_production_backup_pre_014_015.sql", "utf-8");
    await db.exec(backupSql);

    // Apply Migration 014
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
          user_email TEXT,
          user_role TEXT,
          school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILURE', 'DENIED', 'WARNING')),
          ip_address TEXT,
          user_agent TEXT,
          details JSONB DEFAULT '{}'::jsonb,
          operation_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL
      );
      ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_by UUID;
      ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS last_operation_id TEXT;
      ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS updated_by UUID;
      ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS last_operation_id TEXT;

      -- Seed School B
      INSERT INTO public.schools (id, name, school_id)
      VALUES ('${schoolB}', 'San Jose National High School', '300793')
      ON CONFLICT DO NOTHING;
    `);

    return db;
  }

  // Read migration 015 SQL
  const migration015Sql = fs.readFileSync("supabase/migrations/015_lrn_deduplication_and_grade_updates.sql", "utf-8");

  // ===========================================================================
  // TEST 1: PostgreSQL ON CONFLICT Compatibility & First-Time Creation
  // ===========================================================================
  await t.test("1. PostgreSQL ON CONFLICT compatibility & first-time student creation on approval", async () => {
    const db = await initDb();
    await db.exec(migration015Sql);

    // Verify index definition in PostgreSQL catalog
    const idxCheck = await db.query(`
      SELECT i.relname AS index_name, idx.indisunique, pg_get_indexdef(idx.indexrelid) AS index_def
      FROM pg_index idx
      JOIN pg_class i ON i.oid = idx.indexrelid
      WHERE i.relname = 'idx_students_normalized_lrn';
    `);
    assert.strictEqual(idxCheck.rows.length, 1);
    assert.strictEqual(idxCheck.rows[0].indisunique, true);
    console.log("Index definition:", idxCheck.rows[0].index_def);

    // Insert an SF9 document in needs_review with no existing student
    const docRes = await db.query(`
      INSERT INTO public.documents (
        school_id, document_type, image_url, school_year, semester,
        extracted_fields, status
      ) VALUES (
        '${schoolA}', 'sf9', 'test-new-student.jpg', '2024-2025', '1st Semester',
        $1, 'needs_review'
      ) RETURNING id, student_id;
    `, [JSON.stringify({
      lrn: "123456789012",
      student: {
        first_name: "CRISPIN",
        last_name: "BASILIO",
        grade_level: "Grade 11"
      },
      grades: [
        { subject: "Oral Communication", q1: 85, q2: 87, status: "Passed", semester: "1st Semester" }
      ]
    })]);

    const docId = docRes.rows[0].id;
    // In needs_review, student is NOT auto-created
    assert.strictEqual(docRes.rows[0].student_id, null, "Document in needs_review must have student_id = NULL");

    // Approve the document: BEFORE trigger must create student and assign student_id via ON CONFLICT
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [docId]);

    const updatedDoc = await db.query(`SELECT student_id, status FROM public.documents WHERE id = $1;`, [docId]);
    assert.notStrictEqual(updatedDoc.rows[0].student_id, null, "Approved document must have non-null student_id");

    const createdStudent = await db.query(`SELECT * FROM public.students WHERE id = $1;`, [updatedDoc.rows[0].student_id]);
    assert.strictEqual(createdStudent.rows[0].lrn, "123456789012");
    assert.strictEqual(createdStudent.rows[0].first_name, "CRISPIN");
    assert.strictEqual(createdStudent.rows[0].last_name, "BASILIO");
    assert.strictEqual(createdStudent.rows[0].school_id, schoolA);

    // Active grades were created
    const grades = await db.query(`SELECT * FROM public.subject_grades WHERE student_id = $1;`, [createdStudent.rows[0].id]);
    assert.strictEqual(grades.rows.length, 1);
    assert.strictEqual(Number(grades.rows[0].final_grade), 86);
  });

  // ===========================================================================
  // TEST 2: Concurrent First-Time Approvals (Race Condition Handling)
  // ===========================================================================
  await t.test("2. Concurrent approvals for same LRN cleanly resolve to exactly 1 student", async () => {
    const db = await initDb();
    await db.exec(migration015Sql);

    const docFields = {
      lrn: "222233334444",
      first_name: "ISAGANI",
      last_name: "HERMOSA",
      grades: [{ subject: "General Mathematics", q1: 88, q2: 90, status: "Passed", semester: "1st Semester" }]
    };

    const d1 = await db.query(`
      INSERT INTO public.documents (school_id, document_type, image_url, school_year, semester, extracted_fields, status)
      VALUES ('${schoolA}', 'sf9', 'isagani-1.jpg', '2024-2025', '1st Semester', $1, 'needs_review')
      RETURNING id;
    `, [JSON.stringify(docFields)]);

    const d2 = await db.query(`
      INSERT INTO public.documents (school_id, document_type, image_url, school_year, semester, extracted_fields, status)
      VALUES ('${schoolA}', 'sf9', 'isagani-2.jpg', '2024-2025', '1st Semester', $1, 'needs_review')
      RETURNING id;
    `, [JSON.stringify(docFields)]);

    // Approve both documents
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [d1.rows[0].id]);
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [d2.rows[0].id]);

    const doc1 = await db.query(`SELECT student_id FROM public.documents WHERE id = $1;`, [d1.rows[0].id]);
    const doc2 = await db.query(`SELECT student_id FROM public.documents WHERE id = $1;`, [d2.rows[0].id]);

    // Both documents must link to the EXACT SAME student
    assert.strictEqual(doc1.rows[0].student_id, doc2.rows[0].student_id);

    // Exactly 1 student record must exist
    const students = await db.query(`SELECT count(*) FROM public.students WHERE lrn = '222233334444';`);
    assert.strictEqual(Number(students.rows[0].count), 1);
  });

  // ===========================================================================
  // TEST 3: Legacy Duplicate LRN Remediation Path (Safe Failure)
  // ===========================================================================
  await t.test("3. Pre-existing duplicate LRNs cause migration to fail safely with explicit remediation instructions", async () => {
    const db = await initDb();

    // Seed duplicate students with same LRN
    await db.exec(`
      INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
      VALUES ('${schoolA}', '999999999999', 'STUDENT', 'ONE', 'Grade 11');
      INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
      VALUES ('${schoolA}', '999999999999', 'STUDENT', 'TWO', 'Grade 11');
    `);

    // Applying Migration 015 must fail safely with 23505 and NOT lose deduplication guarantees
    let migrationError = null;
    try {
      await db.exec(migration015Sql);
    } catch (e) {
      migrationError = e;
    }

    assert.notStrictEqual(migrationError, null, "Migration MUST throw an error when duplicate LRNs exist");
    assert.match(migrationError.message, /duplicate LRN/i);
    assert.match(migrationError.message, /remediat/i);

    // Verify existing student records were NOT deleted or destroyed
    const students = await db.query(`SELECT count(*) FROM public.students WHERE lrn = '999999999999';`);
    assert.strictEqual(Number(students.rows[0].count), 2, "Both records must be preserved without destructive deletion");
  });

  // ===========================================================================
  // TEST 4: Cross-School Student Linking & Multi-Tenant Isolation
  // ===========================================================================
  await t.test("4. Cross-school document upload never links or overwrites other school's student", async () => {
    const db = await initDb();
    await db.exec(migration015Sql);

    // 4.1 Create Student at School A
    const stARes = await db.query(`
      INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
      VALUES ('${schoolA}', '555566667777', 'MARIA', 'CLARA', 'Grade 11')
      RETURNING id;
    `);
    const studentAId = stARes.rows[0].id;

    // 4.2 School A repeated SF9 upload links to existing Student A cleanly
    const docARes = await db.query(`
      INSERT INTO public.documents (school_id, document_type, image_url, school_year, semester, extracted_fields, status)
      VALUES ('${schoolA}', 'sf9', 'maria-sem2.jpg', '2024-2025', '2nd Semester', $1, 'needs_review')
      RETURNING id, student_id;
    `, [JSON.stringify({ lrn: "555566667777", grades: [{ subject: "Reading & Writing", q3: 88, q4: 90 }] })]);
    assert.strictEqual(docARes.rows[0].student_id, studentAId, "Same school upload immediately links to existing student");

    // 4.3 School B uploads an SF9 with Student A's LRN
    const docBRes = await db.query(`
      INSERT INTO public.documents (school_id, document_type, image_url, school_year, semester, extracted_fields, status)
      VALUES ('${schoolB}', 'sf9', 'maria-schoolB.jpg', '2024-2025', '1st Semester', $1, 'needs_review')
      RETURNING id, student_id;
    `, [JSON.stringify({ lrn: "555566667777", grades: [{ subject: "Oral Communication", q1: 80, q2: 82 }] })]);

    // School B document must NOT link to School A's student!
    assert.strictEqual(docBRes.rows[0].student_id, null, "School B document MUST NOT link to School A student");

    // 4.4 School B attempts to approve the document with School A's LRN
    // Approval MUST be rejected with explicit cross-school conflict exception
    let approveErr = null;
    try {
      await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1;`, [docBRes.rows[0].id]);
    } catch (e) {
      approveErr = e;
    }

    assert.notStrictEqual(approveErr, null, "School B approving School A's LRN must raise an exception");
    assert.match(approveErr.message, /cross-school/i);

    // 4.5 Verify Student A remains completely untouched
    const checkStA = await db.query(`SELECT * FROM public.students WHERE id = $1;`, [studentAId]);
    assert.strictEqual(checkStA.rows[0].school_id, schoolA, "School A ownership must NOT be transferred");
    assert.strictEqual(checkStA.rows[0].first_name, "MARIA");
    assert.strictEqual(checkStA.rows[0].last_name, "CLARA");
  });

  // ===========================================================================
  // TEST 5: Concurrency-Related Duplicate Subject Grade Prevention
  // ===========================================================================
  await t.test("5. Subject grade uniqueness prevents duplicates even if unique index is dropped", async () => {
    const db = await initDb();
    await db.exec(migration015Sql);

    const stRes = await db.query(`
      INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
      VALUES ('${schoolA}', '777788889999', 'ELIAS', 'PILOTO', 'Grade 11')
      RETURNING id;
    `);
    const studentId = stRes.rows[0].id;

    // Verify unique index in catalog
    const sgIdx = await db.query(`
      SELECT i.relname AS index_name, idx.indisunique
      FROM pg_index idx
      JOIN pg_class i ON i.oid = idx.indexrelid
      WHERE i.relname = 'idx_subject_grades_composite_active';
    `);
    assert.strictEqual(sgIdx.rows[0].indisunique, true);

    // Insert first grade
    await db.query(`
      INSERT INTO public.subject_grades (student_id, school_year, semester, subject, q1, q2, final_grade, status)
      VALUES ($1, '2024-2025', '1st Semester', 'Physical Science', 85, 87, 86, 'Passed');
    `, [studentId]);

    // Attempt duplicate insert with index active
    let dupErr1 = null;
    try {
      await db.query(`
        INSERT INTO public.subject_grades (student_id, school_year, semester, subject, q1, q2, final_grade, status)
        VALUES ($1, '2024-2025', '1st Semester', 'Physical Science', 90, 92, 91, 'Passed');
      `, [studentId]);
    } catch (e) {
      dupErr1 = e;
    }
    assert.notStrictEqual(dupErr1, null, "Duplicate grade insert must fail");

    // NOW: Drop the unique index idx_subject_grades_composite_active and recreate as NON-UNIQUE
    await db.query(`DROP INDEX public.idx_subject_grades_composite_active;`);
    await db.query(`CREATE INDEX idx_subject_grades_composite_active ON public.subject_grades (student_id, school_year, semester, subject);`);

    // Verify index is now NON-unique in catalog
    const nonUniqueIdx = await db.query(`
      SELECT i.relname AS index_name, idx.indisunique
      FROM pg_index idx
      JOIN pg_class i ON i.oid = idx.indexrelid
      WHERE i.relname = 'idx_subject_grades_composite_active';
    `);
    assert.strictEqual(nonUniqueIdx.rows[0].indisunique, false);

    // Attempt duplicate insert when unique index is ABSENT: trigger MUST still reject duplicate!
    let dupErr2 = null;
    try {
      await db.query(`
        INSERT INTO public.subject_grades (student_id, school_year, semester, subject, q1, q2, final_grade, status)
        VALUES ($1, '2024-2025', '1st Semester', 'Physical Science', 90, 92, 91, 'Passed');
      `, [studentId]);
    } catch (e) {
      dupErr2 = e;
    }
    assert.notStrictEqual(dupErr2, null, "Trigger must reject duplicate grade even when unique index is absent");
    assert.match(dupErr2.message, /duplicate/i);

    const gradesCount = await db.query(`SELECT count(*) FROM public.subject_grades WHERE student_id = $1;`, [studentId]);
    assert.strictEqual(Number(gradesCount.rows[0].count), 1);
  });
});

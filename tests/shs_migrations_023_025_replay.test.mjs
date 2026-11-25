import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const MIGRATION_022_PATH = path.resolve(rootDir, "supabase", "migrations", "022_teacher_assignments_and_section_scanning.sql");
const MIGRATION_023_PATH = path.resolve(rootDir, "supabase", "migrations", "023_shs_roster_documents_and_multi_learner_child_tables.sql");
const MIGRATION_024_PATH = path.resolve(rootDir, "supabase", "migrations", "024_shs_cross_document_validation_engine.sql");
const MIGRATION_025_PATH = path.resolve(rootDir, "supabase", "migrations", "025_shs_roster_security_and_rls_hardening.sql");
const MIGRATION_031_PATH = path.resolve(rootDir, "supabase", "migrations", "031_avv_validation_context_and_atomic_persistence.sql");
const MIGRATION_032_PATH = path.resolve(rootDir, "supabase", "migrations", "032_avv_null_context_and_batch_persistence.sql");

const SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";
const ADMIN_ID = "10000000-0000-0000-0000-000000000001";
const PRINCIPAL_ID = "20000000-0000-0000-0000-000000000002";
const TEACHER_A_ID = "30000000-0000-0000-0000-000000000003"; // Grade 11 STEM - Rizal
const TEACHER_B_ID = "40000000-0000-0000-0000-000000000004"; // Grade 12 ABM - Bonifacio

async function asUser(db, userId, fn) {
  await db.exec("BEGIN;");
  try {
    await db.exec("SET LOCAL ROLE authenticated;");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true);", [userId]);
    await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true);");
    const res = await fn();
    await db.exec("COMMIT;");
    return res;
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  }
}

async function bootstrapFullDatabase() {
  const db = new PGlite();

  // 1. Core Supabase Roles and Schema
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.role', true), ''),
        NULLIF(current_setting('role', true), '')
      );
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION public.normalize_shs_grade_level(raw_grade TEXT)
    RETURNS TEXT
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
    DECLARE
      cleaned TEXT := LOWER(BTRIM(COALESCE(raw_grade, '')));
    BEGIN
      IF cleaned = '' THEN RETURN NULL; END IF;
      IF cleaned IN ('11', 'g11', 'grade 11', 'gr. 11') OR cleaned LIKE '%grade 11%' THEN
        RETURN 'Grade 11';
      ELSIF cleaned IN ('12', 'g12', 'grade 12', 'gr. 12') OR cleaned LIKE '%grade 12%' THEN
        RETURN 'Grade 12';
      END IF;
      RETURN BTRIM(raw_grade);
    END;
    $$;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY,
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('teacher', 'admin', 'principal')),
      account_status TEXT NOT NULL DEFAULT 'Approved',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, school_id)
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      suffix TEXT,
      grade_level TEXT,
      sex TEXT,
      status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL,
      image_url TEXT NOT NULL,
      original_filename TEXT,
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      canonical_lrn TEXT,
      file_hash TEXT,
      last_operation_id UUID,
      extracted_fields JSONB DEFAULT '{}'::JSONB,
      status TEXT NOT NULL DEFAULT 'needs_review',
      uploaded_by TEXT,
      reviewed_by UUID,
      archived_at TIMESTAMPTZ,
      archived_by UUID,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT documents_document_type_check CHECK (document_type IN ('sf9', 'sf10'))
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC,
      q2 NUMERIC,
      q3 NUMERIC,
      q4 NUMERIC,
      final_grade NUMERIC,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.document_scans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      scan_version INTEGER NOT NULL DEFAULT 1,
      file_path TEXT,
      file_hash TEXT,
      image_url TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'admin' AND account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'principal' AND account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'teacher' AND account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    INSERT INTO public.schools (id, school_id, name)
    VALUES ('${SCHOOL_ID}', '500169', 'Taysan Resettlement Integrated School');

    INSERT INTO auth.users (id, email) VALUES
      ('${ADMIN_ID}', 'admin@tris.edu.ph'),
      ('${PRINCIPAL_ID}', 'principal@tris.edu.ph'),
      ('${TEACHER_A_ID}', 'teacher.a@tris.edu.ph'),
      ('${TEACHER_B_ID}', 'teacher.b@tris.edu.ph');

    INSERT INTO public.user_roles (user_id, school_id, role, account_status) VALUES
      ('${ADMIN_ID}', '${SCHOOL_ID}', 'admin', 'Approved'),
      ('${PRINCIPAL_ID}', '${SCHOOL_ID}', 'principal', 'Approved'),
      ('${TEACHER_A_ID}', '${SCHOOL_ID}', 'teacher', 'Approved'),
      ('${TEACHER_B_ID}', '${SCHOOL_ID}', 'teacher', 'Approved');
  `);

  // 2. Apply Migration 022 (Teacher Assignments & Normalization)
  const m022Sql = fs.readFileSync(MIGRATION_022_PATH, "utf8");
  await db.exec(m022Sql);

  // Set up teacher assignments:
  // Teacher A: Grade 11 STEM - Rizal (Class Adviser)
  // Teacher B: Grade 12 ABM - Bonifacio (Class Adviser)
  await db.exec(`
    INSERT INTO public.teacher_assignments (
      teacher_user_id, school_id, school_year, grade_level, section, strand_or_track, assignment_type, assignment_status
    ) VALUES
      ('${TEACHER_A_ID}', '${SCHOOL_ID}', '2026-2027', 'Grade 11', 'Rizal', 'STEM', 'class_adviser', 'active'),
      ('${TEACHER_B_ID}', '${SCHOOL_ID}', '2026-2027', 'Grade 12', 'Bonifacio', 'ABM', 'class_adviser', 'active');
  `);

  // 3. Apply Migration 023 (SHS Roster Documents & Multi-Learner Child Tables)
  const m023Sql = fs.readFileSync(MIGRATION_023_PATH, "utf8");
  await db.exec(m023Sql);

  // 4. Apply Migration 024 (SHS Cross-Document Validation Engine)
  const m024Sql = fs.readFileSync(MIGRATION_024_PATH, "utf8");
  await db.exec(m024Sql);

  // 5. Apply Migration 025 (SHS Roster Security & RLS Hardening)
  const m025Sql = fs.readFileSync(MIGRATION_025_PATH, "utf8");
  await db.exec(m025Sql);

  // Grant schema/table access to authenticated role
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
  `);

  return db;
}

test("SHS Migrations 023-025 Replay & Verification Suite (PostgreSQL / PGlite)", async (t) => {
  const db = await bootstrapFullDatabase();

  await t.test("1. Migration 023: Document whitelist expansion and constraints", async () => {
    // A. Verify all 6 SHS document types can be inserted
    const docTypes = ["sf1", "sf2", "sf5", "sf9", "sf10", "birth_cert"];
    for (const dt of docTypes) {
      const res = await db.query(`
        INSERT INTO public.documents (
          school_id, document_type, image_url, status, school_year, grade_level
        ) VALUES (
          $1, $2, 'https://storage.local/test.jpg', 'needs_review', '2026-2027', 'Grade 11'
        ) RETURNING id, document_type;
      `, [SCHOOL_ID, dt]);
      assert.equal(res.rows[0].document_type, dt);
    }

    // B. Verify unsupported document types are REJECTED
    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.documents (
          school_id, document_type, image_url, status
        ) VALUES (
          $1, 'elementary_sf1', 'https://storage.local/test.jpg', 'needs_review'
        );
      `, [SCHOOL_ID]);
    }, /(?:documents_document_type_check|chk_documents_roster_student_null)/);

    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.documents (
          school_id, document_type, image_url, status
        ) VALUES (
          $1, 'jhs_report_card', 'https://storage.local/test.jpg', 'needs_review'
        );
      `, [SCHOOL_ID]);
    }, /(?:documents_document_type_check|chk_documents_roster_student_null)/);
  });

  await t.test("2. Migration 023: Roster documents require student_id = NULL", async () => {
    // Create a student first
    const stuRes = await db.query(`
      INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
      VALUES ($1, '109345000001', 'Juan', 'Dela Cruz', 'Grade 11')
      RETURNING id;
    `, [SCHOOL_ID]);
    const studentId = stuRes.rows[0].id;

    // A. SF1 with non-null student_id MUST FAIL
    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.documents (
          school_id, student_id, document_type, image_url, status, school_year, grade_level
        ) VALUES (
          $1, $2, 'sf1', 'https://storage.local/test.jpg', 'needs_review', '2026-2027', 'Grade 11'
        );
      `, [SCHOOL_ID, studentId]);
    }, /(?:chk_documents_roster_student_null|chk_documents_canonical_active_fields)/);

    // B. SF2 with non-null student_id MUST FAIL
    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.documents (
          school_id, student_id, document_type, image_url, status, school_year, grade_level
        ) VALUES (
          $1, $2, 'sf2', 'https://storage.local/test.jpg', 'needs_review', '2026-2027', 'Grade 11'
        );
      `, [SCHOOL_ID, studentId]);
    }, /(?:chk_documents_roster_student_null|chk_documents_canonical_active_fields)/);

    // C. SF5 with non-null student_id MUST FAIL
    await assert.rejects(async () => {
      await db.query(`
        INSERT INTO public.documents (
          school_id, student_id, document_type, image_url, status, school_year, grade_level
        ) VALUES (
          $1, $2, 'sf5', 'https://storage.local/test.jpg', 'needs_review', '2026-2027', 'Grade 11'
        );
      `, [SCHOOL_ID, studentId]);
    }, /(?:chk_documents_roster_student_null|chk_documents_canonical_active_fields)/);

    // D. SF9 with non-null student_id SUCCEEDS
    const sf9Res = await db.query(`
      INSERT INTO public.documents (
        school_id, student_id, document_type, image_url, status, school_year, grade_level
      ) VALUES (
        $1, $2, 'sf9', 'https://storage.local/test.jpg', 'needs_review', '2026-2027', 'Grade 11'
      ) RETURNING id;
    `, [SCHOOL_ID, studentId]);
    assert.ok(sf9Res.rows[0].id);
  });

  await t.test("3. Migration 023: Child Tables CRUD and CASCADE deletion", async () => {
    // Create an SF1 roster document
    const sf1DocRes = await db.query(`
      INSERT INTO public.documents (
        school_id, document_type, image_url, status, school_year, grade_level, section, track, strand
      ) VALUES (
        $1, 'sf1', 'https://storage.local/sf1.jpg', 'needs_review', '2026-2027', 'Grade 11', 'Rizal', 'Academic', 'STEM'
      ) RETURNING id;
    `, [SCHOOL_ID]);
    const sf1DocId = sf1DocRes.rows[0].id;

    // Insert SF1 roster entry
    const entryRes = await db.query(`
      INSERT INTO public.sf1_roster_entries (
        document_id, school_id, school_year, grade_level, section, track, strand, semester,
        lrn, last_name, first_name, middle_name, sex, birth_date, row_index, ocr_confidence
      ) VALUES (
        $1, $2, '2026-2027', 'Grade 11', 'Rizal', 'Academic', 'STEM', '1st Semester',
        '109345000002', 'Santos', 'Maria', 'Clara', 'F', '2009-05-12', 1, 0.985
      ) RETURNING id, lrn, last_name;
    `, [sf1DocId, SCHOOL_ID]);
    assert.equal(entryRes.rows[0].lrn, "109345000002");
    assert.equal(entryRes.rows[0].last_name, "Santos");

    // Insert SF2 attendance entry
    const sf2DocRes = await db.query(`
      INSERT INTO public.documents (
        school_id, document_type, image_url, status, school_year, grade_level, section, reporting_month
      ) VALUES (
        $1, 'sf2', 'https://storage.local/sf2.jpg', 'needs_review', '2026-2027', 'Grade 11', 'Rizal', 'September'
      ) RETURNING id;
    `, [SCHOOL_ID]);
    const sf2DocId = sf2DocRes.rows[0].id;

    const sf2Entry = await db.query(`
      INSERT INTO public.sf2_attendance_entries (
        document_id, school_id, school_year, grade_level, section, month,
        lrn, learner_name, total_school_days, days_present, days_absent, days_tardy, row_index
      ) VALUES (
        $1, $2, '2026-2027', 'Grade 11', 'Rizal', 'September',
        '109345000002', 'Santos, Maria Clara', 22, 21, 1, 0, 1
      ) RETURNING id, days_present;
    `, [sf2DocId, SCHOOL_ID]);
    assert.equal(Number(sf2Entry.rows[0].days_present), 21);

    // Insert SF5A promotion entry
    const sf5DocRes = await db.query(`
      INSERT INTO public.documents (
        school_id, document_type, image_url, status, school_year, grade_level, section, track, strand
      ) VALUES (
        $1, 'sf5', 'https://storage.local/sf5.jpg', 'needs_review', '2026-2027', 'Grade 11', 'Rizal', 'Academic', 'STEM'
      ) RETURNING id;
    `, [SCHOOL_ID]);
    const sf5DocId = sf5DocRes.rows[0].id;

    const sf5Entry = await db.query(`
      INSERT INTO public.sf5_promotion_entries (
        document_id, school_id, school_year, grade_level, section, track, strand,
        semester, form_variant, lrn, learner_name, general_average, action_taken, proficiency_level, row_index
      ) VALUES (
        $1, $2, '2026-2027', 'Grade 11', 'Rizal', 'Academic', 'STEM',
        '1st Semester', 'SF5A-SHS', '109345000002', 'Santos, Maria Clara', 89.5, 'COMPLETE', 'VERY_SATISFACTORY', 1
      ) RETURNING id, action_taken;
    `, [sf5DocId, SCHOOL_ID]);
    assert.equal(sf5Entry.rows[0].action_taken, "COMPLETE");

    // Insert PSA identity record
    const psaDocRes = await db.query(`
      INSERT INTO public.documents (
        school_id, document_type, image_url, status
      ) VALUES (
        $1, 'birth_cert', 'https://storage.local/psa.jpg', 'needs_review'
      ) RETURNING id;
    `, [SCHOOL_ID]);
    const psaDocId = psaDocRes.rows[0].id;

    const psaRec = await db.query(`
      INSERT INTO public.psa_identity_records (
        document_id, school_id, registry_number, last_name, first_name, middle_name, sex, birth_date
      ) VALUES (
        $1, $2, '2009-12345', 'Santos', 'Maria', 'Clara', 'F', '2009-05-12'
      ) RETURNING id, registry_number;
    `, [psaDocId, SCHOOL_ID]);
    assert.equal(psaRec.rows[0].registry_number, "2009-12345");

    // CASCADE Deletion Check: Delete sf1Doc and ensure sf1_roster_entries row is deleted
    await db.query(`DELETE FROM public.documents WHERE id = $1;`, [sf1DocId]);
    const checkDeleted = await db.query(`SELECT COUNT(*) as cnt FROM public.sf1_roster_entries WHERE document_id = $1;`, [sf1DocId]);
    assert.equal(Number(checkDeleted.rows[0].cnt), 0);
  });

  await t.test("4. Migration 024: Cross-document validation engine & field traces", async () => {
    // Get a student
    const stu = await db.query(`SELECT id FROM public.students LIMIT 1;`);
    const studentId = stu.rows[0].id;

    // Insert cross-document validation
    const valRes = await db.query(`
      INSERT INTO public.cross_document_validations (
        student_id, school_id, school_year, grade_level, semester, validation_type,
        comparison_results, discrepancy_details, status
      ) VALUES (
        $1, $2, '2026-2027', 'Grade 11', '1st Semester', 'SF1_SF9',
        '[{"field": "lrn", "status": "MATCH"}]'::jsonb,
        '[]'::jsonb,
        'MATCH'
      ) RETURNING id, status, validation_type;
    `, [studentId, SCHOOL_ID]);
    assert.equal(valRes.rows[0].status, "MATCH");
    assert.equal(valRes.rows[0].validation_type, "SF1_SF9");

    // Insert field extraction trace
    const docRes = await db.query(`SELECT id FROM public.documents LIMIT 1;`);
    const docId = docRes.rows[0].id;

    const traceRes = await db.query(`
      INSERT INTO public.field_extraction_traces (
        document_id, source_table, record_id, field_name, extracted_value, ocr_provider, ocr_confidence
      ) VALUES (
        $1, 'sf1_roster_entries', gen_random_uuid(), 'general_average', '89.5', 'azure', 0.982
      ) RETURNING id, ocr_provider;
    `, [docId]);
    assert.equal(traceRes.rows[0].ocr_provider, "azure");
  });

  await t.test("5. Migration 025: Section-Scoped RLS Enforcement", async () => {
    // Create an SF1 document belonging to Rizal section (Teacher A is adviser)
    const docA = await db.query(`
      INSERT INTO public.documents (
        school_id, document_type, image_url, status, school_year, grade_level, section, uploaded_by
      ) VALUES (
        $1, 'sf1', 'https://storage.local/sf1_rizal.jpg', 'needs_review', '2026-2027', 'Grade 11', 'Rizal', $2
      ) RETURNING id;
    `, [SCHOOL_ID, TEACHER_A_ID]);
    const docAId = docA.rows[0].id;

    await db.query(`
      INSERT INTO public.sf1_roster_entries (
        document_id, school_id, school_year, grade_level, section, track, strand, semester,
        lrn, last_name, first_name, sex, row_index
      ) VALUES (
        $1, $2, '2026-2027', 'Grade 11', 'Rizal', 'Academic', 'STEM', '1st Semester',
        '109345000099', 'RizalStudent', 'Jose', 'M', 1
      );
    `, [docAId, SCHOOL_ID]);

    // Teacher A (Adviser of Rizal) reads sf1_roster_entries: SHOULD FIND 1 ROW
    const teacherARead = await asUser(db, TEACHER_A_ID, async () => {
      const res = await db.query(`SELECT * FROM public.sf1_roster_entries WHERE section = 'Rizal';`);
      return res.rows;
    });
    assert.equal(teacherARead.length, 1);
    assert.equal(teacherARead[0].last_name, "RizalStudent");

    // Teacher B (Adviser of Bonifacio) reads sf1_roster_entries: SHOULD FIND 0 ROWS (Section Isolation!)
    const teacherBRead = await asUser(db, TEACHER_B_ID, async () => {
      const res = await db.query(`SELECT * FROM public.sf1_roster_entries WHERE section = 'Rizal';`);
      return res.rows;
    });
    assert.equal(teacherBRead.length, 0, "Teacher B must NOT see Teacher A's section roster entries");

    // Principal reads sf1_roster_entries: SHOULD FIND 1 ROW (School-wide oversight)
    const principalRead = await asUser(db, PRINCIPAL_ID, async () => {
      const res = await db.query(`SELECT * FROM public.sf1_roster_entries WHERE section = 'Rizal';`);
      return res.rows;
    });
    assert.equal(principalRead.length, 1, "Principal must see all TRIS section roster entries");

    // Admin reads sf1_roster_entries: SHOULD FIND 1 ROW (Full access)
    const adminRead = await asUser(db, ADMIN_ID, async () => {
      const res = await db.query(`SELECT * FROM public.sf1_roster_entries WHERE section = 'Rizal';`);
      return res.rows;
    });
    assert.equal(adminRead.length, 1, "Admin must have full access");
  });
});

test("Migration 031 removes conflicting AVV read policies and persists atomically", async () => {
  const db = await bootstrapFullDatabase();

  await db.exec(`
    CREATE POLICY "Authorized read sf1_roster_entries"
      ON public.sf1_roster_entries FOR SELECT TO authenticated
      USING (
        public.is_admin()
        OR (public.is_principal() AND school_id = public.get_auth_user_school_id())
        OR (
          public.is_approved_teacher()
          AND public.can_teacher_access_section(school_id, school_year, grade_level, section)
        )
      );
    CREATE POLICY "Authorized read sf2_attendance_entries"
      ON public.sf2_attendance_entries FOR SELECT TO authenticated
      USING (
        public.is_admin()
        OR (public.is_principal() AND school_id = public.get_auth_user_school_id())
        OR (
          public.is_approved_teacher()
          AND public.can_teacher_access_section(school_id, school_year, grade_level, section)
        )
      );
    CREATE POLICY "Authorized read sf5_promotion_entries"
      ON public.sf5_promotion_entries FOR SELECT TO authenticated
      USING (
        public.is_admin()
        OR (public.is_principal() AND school_id = public.get_auth_user_school_id())
        OR (
          public.is_approved_teacher()
          AND public.can_teacher_access_section(school_id, school_year, grade_level, section)
        )
      );
    CREATE POLICY "Authorized read cross_document_validations"
      ON public.cross_document_validations FOR SELECT TO authenticated
      USING (
        public.is_admin()
        OR (public.is_principal() AND school_id = public.get_auth_user_school_id())
        OR (
          public.is_approved_teacher()
          AND EXISTS (
            SELECT 1
            FROM public.student_enrollments enrollment
            WHERE enrollment.student_id = cross_document_validations.student_id
              AND enrollment.school_id = cross_document_validations.school_id
              AND enrollment.enrollment_status = 'active'
              AND public.can_teacher_access_section(
                enrollment.school_id,
                enrollment.school_year,
                enrollment.grade_level,
                enrollment.section
              )
          )
        )
      );
  `);

  const student = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000088', 'Test', 'Learner', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = student.rows[0].id;

  await db.query(`
    INSERT INTO public.student_enrollments (
      student_id, school_id, school_year, grade_level, section, adviser_user_id,
      enrollment_status, is_current
    ) VALUES ($1, $2, '2026-2027', 'Grade 11', 'Rizal', $3, 'active', true);
  `, [studentId, SCHOOL_ID, TEACHER_A_ID]);

  const rowIds = {};
  for (const year of ["2025-2026", "2026-2027"]) {
    for (const type of ["sf1", "sf2", "sf5"]) {
      const document = await db.query(`
        INSERT INTO public.documents (
          school_id, document_type, image_url, status, school_year, grade_level, section
        ) VALUES ($1, $2, $3, 'needs_review', $4, 'Grade 11', 'Rizal')
        RETURNING id;
      `, [SCHOOL_ID, type, `https://storage.local/${type}-${year}.jpg`, year]);
      rowIds[`${type}-${year}`] = document.rows[0].id;
    }

    await db.query(`
      INSERT INTO public.sf1_roster_entries (
        document_id, student_id, school_id, school_year, grade_level, section, track, strand,
        semester, lrn, last_name, first_name, sex, row_index
      ) VALUES ($1, $2, $3, $4, 'Grade 11', 'Rizal', 'Academic', 'STEM',
        '1st Semester', '109345000088', 'Learner', 'Test', 'M', 1);
    `, [rowIds[`sf1-${year}`], studentId, SCHOOL_ID, year]);
    await db.query(`
      INSERT INTO public.sf2_attendance_entries (
        document_id, student_id, school_id, school_year, grade_level, section, month,
        lrn, learner_name, row_index
      ) VALUES ($1, $2, $3, $4, 'Grade 11', 'Rizal', 'August',
        '109345000088', 'Learner, Test', 1);
    `, [rowIds[`sf2-${year}`], studentId, SCHOOL_ID, year]);
    await db.query(`
      INSERT INTO public.sf5_promotion_entries (
        document_id, student_id, school_id, school_year, grade_level, section, track, strand,
        semester, form_variant, lrn, learner_name, action_taken, row_index
      ) VALUES ($1, $2, $3, $4, 'Grade 11', 'Rizal', 'Academic', 'STEM',
        '1st Semester', 'SF5A-SHS', '109345000088', 'Learner, Test', 'COMPLETE', 1);
    `, [rowIds[`sf5-${year}`], studentId, SCHOOL_ID, year]);

    await db.query(`
      INSERT INTO public.cross_document_validations (
        student_id, school_id, school_year, grade_level, semester, validation_type, status
      ) VALUES ($1, $2, $3, 'Grade 11', '1st Semester', 'SF1_SF2', 'NEEDS_VERIFICATION');
    `, [studentId, SCHOOL_ID, year]);
  }

  const legacyReadCount = await asUser(db, TEACHER_A_ID, async () => {
    const result = await db.query("SELECT COUNT(*)::int AS count FROM public.sf1_roster_entries;");
    return result.rows[0].count;
  });
  assert.equal(legacyReadCount, 2, "The fixture reproduces the older policy's cross-year OR access.");

  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.query(`
    UPDATE public.cross_document_validations
    SET section = 'Rizal'
    WHERE school_year = '2025-2026';
  `);
  await db.exec(`
    ALTER TABLE public.cross_document_validations
      DROP CONSTRAINT chk_cross_validation_key_requires_context;
  `);
  const incompleteContext = await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, section, semester,
      validation_type, persistence_key, status
    ) VALUES ($1, $2, '2027-2028', NULL, 'Rizal', 'Full Year',
      'SF1_SF9', 'LEGACY_NULL_GRADE_KEY', 'NEEDS_VERIFICATION')
    RETURNING id;
  `, [studentId, SCHOOL_ID]);
  const incompleteGradeId = incompleteContext.rows[0].id;
  const emptySection = await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, section, semester,
      validation_type, persistence_key, status
    ) VALUES ($1, $2, '2027-2028', 'Grade 11', '', 'Full Year',
      'SF1_SF9', 'LEGACY_EMPTY_SECTION_KEY', 'NEEDS_VERIFICATION')
    RETURNING id;
  `, [studentId, SCHOOL_ID]);
  const emptySectionId = emptySection.rows[0].id;
  const whitespaceSection = await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, section, semester,
      validation_type, persistence_key, status, resolved_by, resolved_at, resolution_notes
    ) VALUES ($1, $2, '2027-2028', 'Grade 11', '   ', 'Full Year',
      'SF1_SF9', 'LEGACY_WHITESPACE_SECTION_KEY', 'RESOLVED', $3,
      TIMESTAMPTZ '2026-01-02 03:04:05+00', 'Historical resolution retained')
    RETURNING id;
  `, [studentId, SCHOOL_ID, TEACHER_A_ID]);
  const whitespaceSectionId = whitespaceSection.rows[0].id;
  const blankSchoolYear = await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, section, semester,
      validation_type, persistence_key, status
    ) VALUES ($1, $2, '   ', 'Grade 11', 'Rizal', 'Full Year',
      'SF1_SF9', 'LEGACY_BLANK_YEAR_KEY', 'NEEDS_VERIFICATION')
    RETURNING id;
  `, [studentId, SCHOOL_ID]);
  const blankSchoolYearId = blankSchoolYear.rows[0].id;
  await db.exec(`
    ALTER TABLE public.cross_document_validations
      ADD CONSTRAINT chk_cross_validation_key_requires_context
      CHECK (
        persistence_key IS NULL
        OR (section IS NOT NULL AND BTRIM(section) <> '' AND grade_level IS NOT NULL)
      ) NOT VALID;
  `);
  const incompleteSection = await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, section, semester,
      validation_type, status
    ) VALUES ($1, $2, '2027-2028', 'Grade 11', NULL, 'Full Year',
      'SF1_SF9', 'NEEDS_VERIFICATION')
    RETURNING id;
  `, [studentId, SCHOOL_ID]);
  const incompleteSectionId = incompleteSection.rows[0].id;
  const completeContext = await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, section, semester,
      validation_type, status
    ) VALUES ($1, $2, '2027-2028', 'Grade 11', 'Rizal', 'Full Year',
      'SF1_SF5', 'NEEDS_VERIFICATION')
    RETURNING id;
  `, [studentId, SCHOOL_ID]);

  await db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8"));
  const repairedContexts = await db.query(`
    SELECT id, grade_level, section, persistence_key
    FROM public.cross_document_validations
    WHERE id IN ($1, $2, $3, $4, $5, $6);
  `, [
    incompleteGradeId,
    emptySectionId,
    whitespaceSectionId,
    blankSchoolYearId,
    incompleteSectionId,
    completeContext.rows[0].id,
  ]);
  const byId = new Map(repairedContexts.rows.map((row) => [row.id, row]));
  assert.equal(byId.get(incompleteGradeId).persistence_key, null, "Unknown grade must not receive a persistence key.");
  assert.equal(byId.get(incompleteSectionId).persistence_key, null, "Unknown section must not receive a persistence key.");
  assert.equal(byId.get(emptySectionId).persistence_key, null, "Empty section must not retain a persistence key.");
  assert.equal(byId.get(whitespaceSectionId).persistence_key, null, "Whitespace-only section must not retain a persistence key.");
  assert.equal(byId.get(blankSchoolYearId).persistence_key, null, "Blank school year must not receive a persistence key.");
  assert.equal(
    byId.get(completeContext.rows[0].id).persistence_key,
    "PAIR|SF1_SF5|Full Year||",
    "Complete academic context receives its scoped key."
  );
  await db.query(`
    UPDATE public.cross_document_validations
    SET status = 'RESOLVED', resolved_by = $2, resolved_at = NOW(), resolution_notes = 'Reviewed legacy context'
    WHERE id = $1;
  `, [incompleteGradeId, TEACHER_A_ID]);
  const resolvedIncomplete = await db.query(`
    SELECT status, persistence_key, resolution_notes
    FROM public.cross_document_validations
    WHERE id = $1;
  `, [incompleteGradeId]);
  assert.equal(resolvedIncomplete.rows[0].status, "RESOLVED");
  assert.equal(resolvedIncomplete.rows[0].persistence_key, null);
  assert.equal(resolvedIncomplete.rows[0].resolution_notes, "Reviewed legacy context");
  await db.query(`
    UPDATE public.cross_document_validations
    SET status = 'RESOLVED', resolved_by = $2, resolved_at = NOW(), resolution_notes = 'Reviewed empty-section context'
    WHERE id = $1;
  `, [emptySectionId, TEACHER_A_ID]);
  await db.query(`
    UPDATE public.cross_document_validations
    SET updated_at = NOW()
    WHERE id = $1;
  `, [incompleteSectionId]);
  const preservedHistoricalResolution = await db.query(`
    SELECT status, persistence_key, resolved_by, resolved_at, resolution_notes
    FROM public.cross_document_validations
    WHERE id = $1;
  `, [whitespaceSectionId]);
  assert.equal(preservedHistoricalResolution.rows[0].status, "RESOLVED");
  assert.equal(preservedHistoricalResolution.rows[0].persistence_key, null);
  assert.equal(preservedHistoricalResolution.rows[0].resolved_by, TEACHER_A_ID);
  assert.equal(preservedHistoricalResolution.rows[0].resolved_at.toISOString(), "2026-01-02T03:04:05.000Z");
  assert.equal(preservedHistoricalResolution.rows[0].resolution_notes, "Historical resolution retained");

  const policies = await db.query(`
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'sf1_roster_entries', 'sf2_attendance_entries',
        'sf5_promotion_entries', 'cross_document_validations'
      );
  `);
  const policyNames = new Set(policies.rows.map((row) => row.policyname));
  for (const legacyPolicy of [
    "Teacher access on sf1_roster_entries",
    "Teacher access on sf2_attendance_entries",
    "Teacher access on sf5_promotion_entries",
    "Teacher read on cross_document_validations",
  ]) {
    assert.equal(policyNames.has(legacyPolicy), false, `${legacyPolicy} must be removed`);
  }
  for (const scopedPolicy of [
    "Authorized read sf1_roster_entries",
    "Authorized read sf2_attendance_entries",
    "Authorized read sf5_promotion_entries",
    "Authorized read cross_document_validations",
  ]) {
    assert.equal(policyNames.has(scopedPolicy), true, `${scopedPolicy} must remain`);
  }
  const rpcPrivileges = await db.query(`
    SELECT
      has_function_privilege('authenticated', 'public.persist_cross_document_validation(jsonb)', 'EXECUTE') AS authenticated_can_persist,
      has_function_privilege('service_role', 'public.persist_cross_document_validation(jsonb)', 'EXECUTE') AS service_role_can_persist,
      has_function_privilege('authenticated', 'public.persist_cross_document_validation_batch(jsonb)', 'EXECUTE') AS authenticated_can_batch,
      has_function_privilege('service_role', 'public.persist_cross_document_validation_batch(jsonb)', 'EXECUTE') AS service_role_can_batch;
  `);
  assert.equal(rpcPrivileges.rows[0].authenticated_can_persist, false);
  assert.equal(rpcPrivileges.rows[0].service_role_can_persist, true);
  assert.equal(rpcPrivileges.rows[0].authenticated_can_batch, false);
  assert.equal(rpcPrivileges.rows[0].service_role_can_batch, true);

  for (const table of [
    "sf1_roster_entries",
    "sf2_attendance_entries",
    "sf5_promotion_entries",
    "cross_document_validations",
  ]) {
    const years = await asUser(db, TEACHER_A_ID, async () => {
      const result = await db.query(`SELECT DISTINCT school_year FROM public.${table} ORDER BY school_year;`);
      return result.rows.map((row) => row.school_year);
    });
    assert.deepEqual(years, ["2026-2027"], `${table} reads must match the teacher's exact school year`);
  }

  const persistenceContext = {
    student_id: studentId,
    school_id: SCHOOL_ID,
    school_year: "2026-2027",
    grade_level: "Grade 11",
    section: "Rizal",
    semester: "1st Semester",
    validation_type: "SF1_SF2",
    source_doc1_id: rowIds["sf1-2026-2027"],
    source_doc2_id: rowIds["sf2-2026-2027"],
    source_signature: null,
    persistence_key: `PAIR|SF1_SF2|1st Semester|${rowIds["sf1-2026-2027"]}|${rowIds["sf2-2026-2027"]}`,
    comparison_results: [{ sourceDocumentIds: [rowIds["sf1-2026-2027"], rowIds["sf2-2026-2027"]] }],
    discrepancy_details: [{ message: "Initial discrepancy" }],
    status: "MISMATCH",
    needs_human_review: true,
  };
  const persist = (payload) => db.query(
    "SELECT * FROM public.persist_cross_document_validation($1::jsonb);",
    [JSON.stringify(payload)]
  );
  const invalidPersistencePayloads = [
    { ...persistenceContext, school_year: null },
    { ...persistenceContext, school_year: "" },
    { ...persistenceContext, school_year: "   " },
    { ...persistenceContext, grade_level: null },
    { ...persistenceContext, grade_level: "Grade 10" },
    { ...persistenceContext, section: null },
    { ...persistenceContext, section: "   " },
    { ...persistenceContext, school_id: "00000000-0000-0000-0000-000000000001" },
    { ...persistenceContext, persistence_key: "NOT_THE_CANONICAL_KEY" },
    { ...persistenceContext, persistence_key: "   " },
  ];
  for (const invalidPayload of invalidPersistencePayloads) {
    await assert.rejects(
      () => persist(invalidPayload),
      /complete validation context and persistence key are required/i
    );
    await assert.rejects(
      () => db.query(
        "SELECT public.persist_cross_document_validation_batch($1::jsonb);",
        [JSON.stringify([invalidPayload])]
      ),
      /missing or invalid context or payload fields/i
    );
  }
  const initial = await persist(persistenceContext);
  await persist({
    ...persistenceContext,
    comparison_results: [{ message: "Updated comparison" }],
  });
  let count = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM public.cross_document_validations
    WHERE persistence_key = $1;
  `, [persistenceContext.persistence_key]);
  assert.equal(count.rows[0].count, 1, "Repeated writes must use one unique context key.");
  assert.deepEqual(initial.rows[0].comparison_results, persistenceContext.comparison_results);

  await db.query(`
    UPDATE public.cross_document_validations
    SET status = 'RESOLVED',
        resolved_by = $2,
        resolved_at = NOW(),
        resolution_notes = 'Teacher decision'
    WHERE id = $1;
  `, [initial.rows[0].id, TEACHER_A_ID]);
  const beforeResolvedWrite = await db.query(`
    SELECT comparison_results, resolved_by, resolved_at, resolution_notes
    FROM public.cross_document_validations
    WHERE id = $1;
  `, [initial.rows[0].id]);
  await persist({
    ...persistenceContext,
    comparison_results: [{ message: "Must not overwrite resolved record" }],
    status: "MISMATCH",
  });
  const afterResolvedWrite = await db.query(`
    SELECT status, comparison_results, resolved_by, resolved_at, resolution_notes
    FROM public.cross_document_validations
    WHERE id = $1;
  `, [initial.rows[0].id]);
  assert.equal(afterResolvedWrite.rows[0].status, "RESOLVED");
  assert.deepEqual(afterResolvedWrite.rows[0].comparison_results, beforeResolvedWrite.rows[0].comparison_results);
  assert.equal(afterResolvedWrite.rows[0].resolved_by, TEACHER_A_ID);
  assert.equal(afterResolvedWrite.rows[0].resolved_at.toISOString(), beforeResolvedWrite.rows[0].resolved_at.toISOString());
  assert.equal(afterResolvedWrite.rows[0].resolution_notes, "Teacher decision");

  const successfulBatchPayloads = [
    {
      ...persistenceContext,
      comparison_results: [{ message: "Must preserve the teacher resolution" }],
      discrepancy_details: [],
    },
    {
      ...persistenceContext,
      validation_type: "SF1_SF5",
      persistence_key: "PAIR|SF1_SF5|1st Semester||",
      source_doc1_id: null,
      source_doc2_id: null,
      comparison_results: [],
      discrepancy_details: [],
    },
  ];
  const successfulBatch = await db.query(
    "SELECT public.persist_cross_document_validation_batch($1::jsonb) AS result;",
    [JSON.stringify(successfulBatchPayloads)]
  );
  assert.equal(successfulBatch.rows[0].result.success, true);
  assert.equal(successfulBatch.rows[0].result.persistedCount, 2);
  const preservedBatchResolution = await db.query(`
    SELECT status, comparison_results, resolved_by, resolved_at, resolution_notes
    FROM public.cross_document_validations
    WHERE id = $1;
  `, [initial.rows[0].id]);
  assert.equal(preservedBatchResolution.rows[0].status, "RESOLVED");
  assert.deepEqual(preservedBatchResolution.rows[0].comparison_results, beforeResolvedWrite.rows[0].comparison_results);
  assert.equal(preservedBatchResolution.rows[0].resolved_by, TEACHER_A_ID);
  assert.equal(preservedBatchResolution.rows[0].resolved_at.toISOString(), beforeResolvedWrite.rows[0].resolved_at.toISOString());
  assert.equal(preservedBatchResolution.rows[0].resolution_notes, "Teacher decision");

  const mixedContextPayloads = [
    {
      ...persistenceContext,
      source_doc1_id: null,
      source_doc2_id: null,
      persistence_key: "PAIR|SF1_SF2|1st Semester||",
    },
    {
      ...persistenceContext,
      school_year: "2025-2026",
      source_doc1_id: null,
      source_doc2_id: null,
      persistence_key: "PAIR|SF1_SF2|1st Semester||",
    },
  ];
  const mixedContextRowsBefore = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM public.cross_document_validations
    WHERE persistence_key = 'PAIR|SF1_SF2|1st Semester||';
  `);
  await assert.rejects(
    () => db.query(
      "SELECT public.persist_cross_document_validation_batch($1::jsonb);",
      [JSON.stringify(mixedContextPayloads)]
    ),
    /one learner and academic context/
  );
  const invalidBatchRows = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM public.cross_document_validations
    WHERE persistence_key = 'PAIR|SF1_SF2|1st Semester||';
  `);
  assert.equal(
    invalidBatchRows.rows[0].count,
    mixedContextRowsBefore.rows[0].count,
    "Invalid batch context is rejected without writing any rows."
  );

  const batchFailurePayloads = [
    {
      ...persistenceContext,
      validation_type: "PSA_SF1",
      semester: "Full Year",
      persistence_key: "PAIR|PSA_SF1|Full Year||",
      source_doc1_id: null,
      source_doc2_id: null,
    },
    {
      ...persistenceContext,
      validation_type: "SF1_SF2",
      persistence_key: "PAIR|SF1_SF2|1st Semester||",
      source_doc1_id: null,
      source_doc2_id: null,
    },
  ];
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.fail_second_validation_batch_write()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.validation_type = 'SF1_SF2' THEN
        RAISE EXCEPTION 'simulated batch write failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER fail_second_validation_batch_write
      BEFORE INSERT ON public.cross_document_validations
      FOR EACH ROW EXECUTE FUNCTION public.fail_second_validation_batch_write();
  `);
  await assert.rejects(
    () => db.query(
      "SELECT public.persist_cross_document_validation_batch($1::jsonb);",
      [JSON.stringify(batchFailurePayloads)]
    ),
    /simulated batch write failure/
  );
  const failedBatchRows = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM public.cross_document_validations
    WHERE persistence_key = 'PAIR|PSA_SF1|Full Year||';
  `);
  assert.equal(failedBatchRows.rows[0].count, 0, "A later batch write failure must roll back earlier writes.");
});

test("Migration 031 duplicate complete-context keys abort without deleting history", async () => {
  const db = await bootstrapFullDatabase();
  const student = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000077', 'Duplicate', 'Learner', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = student.rows[0].id;
  await db.query(`
    INSERT INTO public.student_enrollments (
      student_id, school_id, school_year, grade_level, section, adviser_user_id,
      enrollment_status, is_current
    ) VALUES ($1, $2, '2026-2027', 'Grade 11', 'Rizal', $3, 'active', true);
  `, [studentId, SCHOOL_ID, TEACHER_A_ID]);
  await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, semester, validation_type, status
    ) VALUES
      ($1, $2, '2026-2027', 'Grade 11', '1st Semester', 'SF1_SF2', 'NEEDS_VERIFICATION'),
      ($1, $2, '2026-2027', 'Grade 11', '1st Semester', 'SF1_SF2', 'NEEDS_VERIFICATION');
  `, [studentId, SCHOOL_ID]);

  await assert.rejects(
    () => db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8")),
    /Duplicate scoped validation keys exist/
  );
  await db.exec("ROLLBACK;");
  const preservedRows = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM public.cross_document_validations
    WHERE student_id = $1;
  `, [studentId]);
  assert.equal(preservedRows.rows[0].count, 2, "Duplicate history remains untouched after the migration aborts.");
  const migrationColumn = await db.query(`
    SELECT COUNT(*)::int AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cross_document_validations'
      AND column_name = 'persistence_key';
  `);
  assert.equal(migrationColumn.rows[0].count, 0, "The failed transactional migration leaves no partial schema changes.");
});

test("Migration 032 duplicate canonical contexts abort without merging history", async () => {
  const db = await bootstrapFullDatabase();
  const student = await db.query(`
    INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level)
    VALUES ($1, '109345000078', 'Duplicate', 'Context', 'Grade 11')
    RETURNING id;
  `, [SCHOOL_ID]);
  const studentId = student.rows[0].id;
  await db.query(`
    INSERT INTO public.student_enrollments (
      student_id, school_id, school_year, grade_level, section, adviser_user_id,
      enrollment_status, is_current
    ) VALUES ($1, $2, '2026-2027', 'Grade 11', 'Rizal', $3, 'active', true);
  `, [studentId, SCHOOL_ID, TEACHER_A_ID]);
  await db.exec(fs.readFileSync(MIGRATION_031_PATH, "utf8"));
  await db.exec("DROP INDEX public.uq_cross_validation_context_key;");
  await db.query(`
    INSERT INTO public.cross_document_validations (
      student_id, school_id, school_year, grade_level, section, semester,
      validation_type, persistence_key, status
    ) VALUES
      ($1, $2, '2026-2027', 'Grade 11', 'Rizal', '1st Semester',
        'SF1_SF2', 'LEGACY_KEY_A', 'NEEDS_VERIFICATION'),
      ($1, $2, '2026-2027', 'Grade 11', 'Rizal', '1st Semester',
        'SF1_SF2', 'LEGACY_KEY_B', 'RESOLVED');
  `, [studentId, SCHOOL_ID]);

  await assert.rejects(
    () => db.exec(fs.readFileSync(MIGRATION_032_PATH, "utf8")),
    /Duplicate scoped validation keys exist/
  );
  await db.exec("ROLLBACK;");
  const preservedRows = await db.query(`
    SELECT persistence_key, status
    FROM public.cross_document_validations
    WHERE student_id = $1
    ORDER BY persistence_key;
  `, [studentId]);
  assert.deepEqual(preservedRows.rows, [
    { persistence_key: "LEGACY_KEY_A", status: "NEEDS_VERIFICATION" },
    { persistence_key: "LEGACY_KEY_B", status: "RESOLVED" },
  ]);
});

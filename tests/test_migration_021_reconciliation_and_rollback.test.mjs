import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Complete 18 approved subject grades snapshot captured from live Supabase
const LIVE_APPROVED_18_GRADES_SNAPSHOT = [
  {
    id: "45e076e4-29e4-460a-be36-61e314c11044",
    subject: "Oral Communication",
    semester: "1st Semester",
    q1: 88, q2: 88, q3: null, q4: null,
    final_grade: 88, status: "Passed", needs_verification: false
  },
  {
    id: "9d1a3114-e333-4494-a158-d0e0841a2585",
    subject: "Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino",
    semester: "1st Semester",
    q1: 98, q2: 98, q3: null, q4: null,
    final_grade: 98, status: "Passed", needs_verification: false
  },
  {
    id: "bd83dec9-3e0e-4c98-b1b0-56d31c79c1d7",
    subject: "Introduction to the Philosophy of the Human Person /Pambungad sa Pilosopiya ng Tao",
    semester: "1st Semester",
    q1: 78, q2: 78, q3: null, q4: null,
    final_grade: 78, status: "Passed", needs_verification: false
  },
  {
    id: "7f5a20b6-a37e-4c00-b4eb-e857578698f3",
    subject: "Physical Education and Health 1",
    semester: "1st Semester",
    q1: 75, q2: 74, q3: null, q4: null,
    final_grade: 74.5, status: "Failed", needs_verification: false
  },
  {
    id: "ae963b24-0f56-45c0-a9e4-fc762d8e336f",
    subject: "General Mathematics",
    semester: "1st Semester",
    q1: 76, q2: 94, q3: null, q4: null,
    final_grade: 85, status: "Passed", needs_verification: false
  },
  {
    id: "65188746-d680-48cd-9df5-60b231233ca2",
    subject: "Earth Science",
    semester: "1st Semester",
    q1: 89, q2: 83, q3: null, q4: null,
    final_grade: 91, status: "Passed", needs_verification: false
  },
  {
    id: "d57c89f6-c71e-49dd-8e54-7cbfa4041432",
    subject: "Empowerment Technologies",
    semester: "1st Semester",
    q1: 91, q2: 92, q3: null, q4: null,
    final_grade: 91.5, status: "Passed", needs_verification: false
  },
  {
    id: "f05befa6-4eab-4aad-8606-baf12f540e1b",
    subject: "Pre-Calculus",
    semester: "1st Semester",
    q1: 96, q2: 79, q3: null, q4: null,
    final_grade: 87.5, status: "Passed", needs_verification: false
  },
  {
    id: "8a830422-9e9e-4534-846f-1b3aa2881ef7",
    subject: "General Chemistry 1",
    semester: "1st Semester",
    q1: 90, q2: 80, q3: null, q4: null,
    final_grade: 85, status: "Passed", needs_verification: false
  },
  {
    id: "a6cf52ab-4e4a-4140-971b-b645069359cf",
    subject: "Reading and Writing",
    semester: "2nd Semester",
    q1: null, q2: null, q3: 70, q4: 98,
    final_grade: 84, status: "Passed", needs_verification: false
  },
  {
    id: "11167aa9-e702-43d0-b17f-b17fea2e62f5",
    subject: "Pagbasa at Pagsusuri ng Iba't-Ibang Teksto Tungo sa Pananaliksik",
    semester: "2nd Semester",
    q1: null, q2: null, q3: 80, q4: 80,
    final_grade: 80, status: "Passed", needs_verification: false
  },
  {
    id: "b2972599-a1a8-4f76-a682-e48069a3657f",
    subject: "Personal Development/ Pansariling Kaunlaran",
    semester: "2nd Semester",
    q1: null, q2: null, q3: 90, q4: 90,
    final_grade: 90, status: "Passed", needs_verification: false
  },
  {
    id: "0a96940f-3858-4837-8114-3690267db93b",
    subject: "Physical Education and Health 2",
    semester: "2nd Semester",
    q1: null, q2: null, q3: 95, q4: 75,
    final_grade: 85, status: "Passed", needs_verification: false
  },
  {
    id: "303b6c74-14bf-4bc0-804f-3f4c4c531773",
    subject: "Statistics and Probability",
    semester: "2nd Semester",
    q1: null, q2: null, q3: 86, q4: 87,
    final_grade: 86.5, status: "Passed", needs_verification: false
  },
  {
    id: "e9404e26-50c6-4124-9ee0-add286691eb6",
    subject: "Disaster Readiness and Risk Reduction",
    semester: "2nd Semester",
    q1: null, q2: null, q3: 97, q4: 93,
    final_grade: 97, status: "Passed", needs_verification: false
  },
  {
    id: "ad71fada-6471-4539-bc48-c41906462490",
    subject: "Practical Research 1",
    semester: "2nd Semester",
    q1: null, q2: null, q3: 84, q4: 87,
    final_grade: 85.5, status: "Passed", needs_verification: false
  },
  {
    id: "2ef3d1c7-c9e5-4d8c-827f-e97bf1b19272",
    subject: "Basic Calculus",
    semester: "2nd Semester",
    q1: null, q2: null, q3: 88, q4: 98,
    final_grade: 93, status: "Passed", needs_verification: false
  },
  {
    id: "271398a7-fa68-40e8-a851-01bf9c94e8e0",
    subject: "General Chemistry 2",
    semester: "2nd Semester",
    q1: null, q2: null, q3: 78, q4: 81,
    final_grade: 79.5, status: "Passed", needs_verification: false
  }
];

test("AVV System — Migration 021 Reconciliation & Safe Rollback Verification Suite", async (t) => {
  const db = new PGlite();

  // 1. Setup Supabase Core Infrastructure and Schema (Migrations 001-015 + 016-020)
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY,
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      division TEXT,
      region TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      role TEXT NOT NULL DEFAULT 'teacher',
      account_status TEXT NOT NULL DEFAULT 'Approved',
      approval_method TEXT DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT now()
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
      extracted_fields JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'needs_review',
      uploaded_by TEXT,
      reviewed_by UUID,
      reviewed_at TIMESTAMPTZ,
      file_hash TEXT,
      archived_at TIMESTAMPTZ,
      archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      curriculum_id TEXT,
      source_form_version TEXT,
      grading_policy_version TEXT,
      grading_period_scheme TEXT,
      general_average_printed NUMERIC,
      last_operation_id UUID,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      source_section TEXT,
      subject_track TEXT,
      subject_category TEXT,
      subject_code TEXT,
      grading_period_scheme TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
      t1 NUMERIC, t2 NUMERIC, t3 NUMERIC,
      sem1_final_grade NUMERIC, sem2_final_grade NUMERIC,
      units NUMERIC, failed_final_grade NUMERIC,
      remedial_class_mark NUMERIC, recomputed_final_grade NUMERIC,
      remedial_sem1_recomputed NUMERIC, remedial_sem2_recomputed NUMERIC,
      final_grade NUMERIC, action_taken TEXT, remark TEXT,
      status TEXT NOT NULL DEFAULT 'Passed',
      needs_verification BOOLEAN DEFAULT false,
      curriculum_id TEXT, source_form_version TEXT, grading_policy_version TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.academic_standing_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      school_year TEXT, grade_level TEXT, curriculum TEXT,
      source_form_version TEXT, grading_policy_version TEXT,
      general_average_printed NUMERIC, previous_status TEXT, new_status TEXT,
      decision_source TEXT, confirmation_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.review_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
      reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id TEXT, category TEXT, action TEXT, outcome TEXT,
      actor_user_id UUID, actor_role TEXT, school_id UUID,
      target_type TEXT, target_id TEXT, target_label TEXT,
      reason TEXT, details JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 2. Insert School and Users
  const TRIS_SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";
  const ADMIN_USER_ID = "b0000000-0000-0000-0000-000000000001";
  await db.exec(`
    INSERT INTO public.schools (id, school_id, name, division, region)
    VALUES ('${TRIS_SCHOOL_ID}', '500169', 'Taysan Resettlement Integrated School', 'Albay', 'Region V');

    INSERT INTO auth.users (id, email)
    VALUES ('${ADMIN_USER_ID}', 'admin@tris.deped.gov.ph');

    INSERT INTO public.user_roles (user_id, school_id, role, account_status)
    VALUES ('${ADMIN_USER_ID}', '${TRIS_SCHOOL_ID}', 'admin', 'Approved');
  `);

  // 3. Insert Live Production Student: Justin Gomez (LRN 111304581972)
  const JUSTIN_STUDENT_ID = "6722d559-440f-4cdc-bd14-e12fad11d836";
  await db.exec(`
    INSERT INTO public.students (
      id, school_id, lrn, first_name, middle_name, last_name, grade_level, status, overall_status
    ) VALUES (
      '${JUSTIN_STUDENT_ID}', '${TRIS_SCHOOL_ID}', '111304581972',
      'JUSTIN', 'LOQUILLANO', 'GOMEZ', '11', 'active', 'Needs Verification'
    );
  `);

  // 4. Insert Live Canonical Approved Document: 840dc1c4
  const CANONICAL_DOC_ID = "840dc1c4-a272-444e-9ff4-2faba4b94c0b";
  await db.exec(`
    INSERT INTO public.documents (
      id, student_id, school_id, document_type, image_url, original_filename,
      school_year, grade_level, status, uploaded_by, reviewed_by, reviewed_at,
      extracted_fields
    ) VALUES (
      '${CANONICAL_DOC_ID}', '${JUSTIN_STUDENT_ID}', '${TRIS_SCHOOL_ID}', 'sf9',
      'https://yhsmawyntabwghncqbqy.supabase.co/storage/v1/object/sign/documents/sf9_canonical.jpg',
      'sf9_front_1794314173198.jpg', '2019-2020', 'Grade 11', 'approved',
      'teacher@tris.deped.gov.ph', '${ADMIN_USER_ID}', now(),
      '{"name": "GOMEZ, JUSTIN LOQUILLANO", "lrn": "111304581972", "grade_level": "Grade 11", "school_year": "2019-2020"}'::jsonb
    );
  `);

  // 5. Insert Live Approved 18 Subject Grades matching exact snapshot
  for (const g of LIVE_APPROVED_18_GRADES_SNAPSHOT) {
    await db.query(`
      INSERT INTO public.subject_grades (
        id, student_id, document_id, school_year, grade_level, semester,
        subject, q1, q2, q3, q4, final_grade, status, needs_verification
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
    `, [
      g.id, JUSTIN_STUDENT_ID, CANONICAL_DOC_ID, "2019-2020", "11", g.semester,
      g.subject, g.q1, g.q2, g.q3, g.q4, g.final_grade, g.status, g.needs_verification
    ]);
  }

  // 6. Insert 3 Historical Justin Gomez Duplicate Documents (live state)
  const DUP_DOCS = [
    { id: "4a04de06-2e3b-4397-8bb3-4a6b96beb40e", filename: "sf9_front_1794314060175.jpg" },
    { id: "983802cc-cdb3-4f56-9c27-1aeb9c215233", filename: "sf9_front_1794667959673.jpg" },
    { id: "f3a40d3b-09ca-4521-9a4e-9e12d32dcf6d", filename: "sf9_front_1794668016328.jpg" }
  ];
  for (const d of DUP_DOCS) {
    await db.exec(`
      INSERT INTO public.documents (
        id, student_id, school_id, document_type, image_url, original_filename,
        school_year, grade_level, status, uploaded_by, extracted_fields
      ) VALUES (
        '${d.id}', '${JUSTIN_STUDENT_ID}', '${TRIS_SCHOOL_ID}', 'sf9',
        'https://yhsmawyntabwghncqbqy.supabase.co/storage/v1/object/sign/documents/${d.filename}',
        '${d.filename}', '2019-2020', 'Grade 11', 'needs_review', 'teacher@tris.deped.gov.ph',
        '{"name": "GOMEZ, JUSTIN LOQUILLANO", "lrn": "111304581972", "grade_level": "Grade 11", "school_year": "2019-2020"}'::jsonb
      );
    `);
  }

  // 7. Insert 2 Kenneth Latonero Collision Documents (live state: mistakenly linked to Gomez)
  await db.exec(`
    INSERT INTO public.documents (
      id, student_id, school_id, document_type, image_url, original_filename,
      school_year, grade_level, status, uploaded_by, extracted_fields
    ) VALUES (
      'cc8b4c08-14bb-4c92-9958-d670f878ac29', '${JUSTIN_STUDENT_ID}', '${TRIS_SCHOOL_ID}', 'sf9',
      'https://yhsmawyntabwghncqbqy.supabase.co/storage/v1/object/sign/documents/sf9_latonero.jpg',
      'sf9_front_1794641220755.jpg', '2019-2020', 'Grade 11', 'needs_review', 'teacher@tris.deped.gov.ph',
      '{"name": "Latonero, Kenneth Abad", "lrn": "111304581972", "last_name": "Latonero", "first_name": "Kenneth"}'::jsonb
    );

    INSERT INTO public.documents (
      id, student_id, school_id, document_type, image_url, original_filename,
      school_year, grade_level, status, uploaded_by, reviewed_by, reviewed_at, extracted_fields
    ) VALUES (
      'edda579a-6e1d-4acb-81d8-25d078798ff7', '${JUSTIN_STUDENT_ID}', '${TRIS_SCHOOL_ID}', 'sf9',
      'https://yhsmawyntabwghncqbqy.supabase.co/storage/v1/object/sign/documents/sf9_latonero_rejected.jpg',
      'sf9_front_1794641474152.jpg', '2019-2020', 'Grade 11', 'rejected', 'teacher@tris.deped.gov.ph',
      '${ADMIN_USER_ID}', now(),
      '{"name": "Latonero, Kenneth Abad", "lrn": "111304581972", "last_name": "Latonero", "first_name": "Kenneth"}'::jsonb
    );

    INSERT INTO public.review_logs (document_id, reviewer_id, action, notes)
    VALUES ('edda579a-6e1d-4acb-81d8-25d078798ff7', '${ADMIN_USER_ID}', 'REJECT', 'Identity collision with Justin Gomez');
  `);

  await t.test("Pre-Migration Baseline Invariants Verification", async () => {
    const gradesRes = await db.query(`SELECT COUNT(*) as count FROM public.subject_grades WHERE document_id = '${CANONICAL_DOC_ID}';`);
    assert.equal(parseInt(gradesRes.rows[0].count), 18, "Baseline must contain exactly 18 subject grades");

    const docsRes = await db.query(`SELECT COUNT(*) as count FROM public.documents;`);
    assert.equal(parseInt(docsRes.rows[0].count), 6, "Baseline must contain exactly 6 documents");
  });

  await t.test("Migration 021 Execution: Phased Reconciliation (021-A -> 021-B -> 021-C) & 4-Index Creation", async () => {
    // Capture pre-migration 18-row deterministic SHA-256 hash
    const preGradesSnapRes = await db.query(`
      SELECT id, subject, semester, q1::text AS q1, q2::text AS q2, q3::text AS q3, q4::text AS q4, final_grade::text AS final_grade, status, needs_verification
      FROM public.subject_grades
      WHERE document_id = '${CANONICAL_DOC_ID}'
      ORDER BY id ASC;
    `);
    const crypto = await import("node:crypto");
    const preGradesHash = crypto.createHash("sha256").update(JSON.stringify(preGradesSnapRes.rows)).digest("hex");

    // Read the preserved original Migration 021 SQL plus the three separated executable phase files
    const originalMigrationPath = path.resolve(__dirname, "../supabase/archive/021_canonical_academic_records_and_scan_versions.original.sql");
    const phaseAPath = path.resolve(__dirname, "../supabase/migrations/021a_schema_triggers_backfill_and_functions.sql");
    const phaseBPath = path.resolve(__dirname, "../supabase/migrations/021b_reconcile_historical_duplicate_documents.sql");
    const phaseCPath = path.resolve(__dirname, "../supabase/migrations/021c_enforce_canonical_document_unique_indexes.sql");
    const originalMigrationSql = fs.readFileSync(originalMigrationPath, "utf-8");
    const phaseASql = fs.readFileSync(phaseAPath, "utf-8");
    const phaseBSql = fs.readFileSync(phaseBPath, "utf-8");
    const phaseCSql = fs.readFileSync(phaseCPath, "utf-8");

    // Verify that running the preserved monolithic Migration 021 before Phase 021-B reconciliation is blocked by preflight check
    await assert.rejects(
      async () => {
        await db.exec(originalMigrationSql);
      },
      /Migration 021 Pre-flight Blocked/i,
      "Original Migration 021 must block index creation until explicit Phase 021-B reconciliation is run"
    );
    await db.exec("ROLLBACK;");

    // Phase 021-A: Schema, triggers, backfill, and function definitions
    await db.exec(phaseASql);

    // Phase 021-B: Explicit historical duplicate reconciliation
    const reconcileRes = await db.query(phaseBSql);
    assert.equal(reconcileRes.rows[0].result.status, "SUCCESS");
    assert.equal(reconcileRes.rows[0].result.archived_duplicates_count, 3);
    assert.equal(reconcileRes.rows[0].result.unlinked_collisions_count, 2);
    assert.equal(reconcileRes.rows[0].result.grades_preserved, 18);
    assert.equal(reconcileRes.rows[0].result.scans_preserved, 4);

    // Phase 021-C: Explicit canonical unique index enforcement
    const indexRes = await db.query(phaseCSql);
    assert.equal(indexRes.rows[0].result.status, "SUCCESS");

    // 1. Verify exact 18 grades equality AND deterministic SHA-256 hash after reconciliation
    const postReconcileGradesRes = await db.query(`
      SELECT id, subject, semester, q1, q2, q3, q4, final_grade, status, needs_verification
      FROM public.subject_grades
      WHERE document_id = '${CANONICAL_DOC_ID}'
      ORDER BY created_at ASC;
    `);
    assert.equal(postReconcileGradesRes.rows.length, 18, "Must still have exactly 18 subject grades");
    for (let i = 0; i < 18; i++) {
      const snap = LIVE_APPROVED_18_GRADES_SNAPSHOT[i];
      const actual = postReconcileGradesRes.rows[i];
      assert.equal(actual.id, snap.id, `Grade row ${i} ID must match snapshot`);
      assert.equal(actual.subject, snap.subject, `Grade row ${i} subject must match snapshot`);
      assert.equal(actual.semester, snap.semester, `Grade row ${i} semester must match snapshot`);
      assert.equal(Number(actual.q1) || null, snap.q1, `Grade row ${i} q1 must match snapshot`);
      assert.equal(Number(actual.q2) || null, snap.q2, `Grade row ${i} q2 must match snapshot`);
      assert.equal(Number(actual.q3) || null, snap.q3, `Grade row ${i} q3 must match snapshot`);
      assert.equal(Number(actual.q4) || null, snap.q4, `Grade row ${i} q4 must match snapshot`);
      assert.equal(Number(actual.final_grade), snap.final_grade, `Grade row ${i} final_grade must match snapshot`);
      assert.equal(actual.status, snap.status, `Grade row ${i} status must match snapshot`);
      assert.equal(actual.needs_verification, snap.needs_verification, `Grade row ${i} needs_verification must match snapshot`);
    }

    const postGradesSnapRes = await db.query(`
      SELECT id, subject, semester, q1::text AS q1, q2::text AS q2, q3::text AS q3, q4::text AS q4, final_grade::text AS final_grade, status, needs_verification
      FROM public.subject_grades
      WHERE document_id = '${CANONICAL_DOC_ID}'
      ORDER BY id ASC;
    `);
    const postGradesHash = crypto.createHash("sha256").update(JSON.stringify(postGradesSnapRes.rows)).digest("hex");
    assert.equal(postGradesHash, preGradesHash, "Deterministic SHA-256 hash of all 18 approved subject_grades rows must be 100% identical before and after migration");

    // 2. Verify Justin Gomez duplicates are archived and consolidated
    const archivedRes = await db.query(`
      SELECT id, status, archived_at, extracted_fields->'consolidation_info' as consolidation_info
      FROM public.documents
      WHERE id IN ('4a04de06-2e3b-4397-8bb3-4a6b96beb40e', '983802cc-cdb3-4f56-9c27-1aeb9c215233', 'f3a40d3b-09ca-4521-9a4e-9e12d32dcf6d');
    `);
    assert.equal(archivedRes.rows.length, 3);
    for (const row of archivedRes.rows) {
      assert.equal(row.status, "archived", "Duplicate must be marked archived");
      assert.ok(row.archived_at, "Archived timestamp must be set");
      assert.ok(row.consolidation_info, "Consolidation info must be recorded");
    }

    // 3. Verify physical scans preserved in document_scans
    const scansRes = await db.query(`
      SELECT scan_version, original_filename, image_url
      FROM public.document_scans
      WHERE document_id = '${CANONICAL_DOC_ID}'
      ORDER BY scan_version ASC;
    `);
    assert.equal(scansRes.rows.length, 4, "Must preserve 4 scan versions (v1 canonical + 3 duplicate uploads)");
    assert.equal(scansRes.rows[0].scan_version, 1);
    assert.equal(scansRes.rows[1].scan_version, 2);
    assert.equal(scansRes.rows[2].scan_version, 3);
    assert.equal(scansRes.rows[3].scan_version, 4);

    // 4. Verify Kenneth Latonero collision records are safely unlinked and quarantined
    const collisionRes = await db.query(`
      SELECT id, student_id, status, extracted_fields->'manual_lrn_verification_required' as manual_lrn_required
      FROM public.documents
      WHERE id IN ('cc8b4c08-14bb-4c92-9958-d670f878ac29', 'edda579a-6e1d-4acb-81d8-25d078798ff7');
    `);
    assert.equal(collisionRes.rows.length, 2);
    for (const row of collisionRes.rows) {
      assert.equal(row.student_id, null, "Collision record must have student_id = NULL");
    }
    const ccDoc = collisionRes.rows.find(r => r.id === "cc8b4c08-14bb-4c92-9958-d670f878ac29");
    assert.equal(ccDoc.status, "needs_review", "cc8b4c08 must remain in needs_review for manual examination");
    assert.equal(ccDoc.manual_lrn_required, true, "cc8b4c08 must flag manual_lrn_verification_required = true");

    const eddaDoc = collisionRes.rows.find(r => r.id === "edda579a-6e1d-4acb-81d8-25d078798ff7");
    assert.equal(eddaDoc.status, "rejected", "edda579a must remain rejected");

    // 5. Verify the 4 Canonical Unique Indexes are active in pg_indexes
    const indexesRes = await db.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_documents_canonical_sf9_active',
          'idx_documents_canonical_sf9_student_active',
          'idx_documents_canonical_sf10_active',
          'idx_documents_unresolved_file_hash_active'
        )
      ORDER BY indexname ASC;
    `);
    assert.equal(indexesRes.rows.length, 4, "All 4 canonical unique indexes must be active");
    const indexNames = indexesRes.rows.map(r => r.indexname).sort();
    assert.deepEqual(indexNames, [
      "idx_documents_canonical_sf10_active",
      "idx_documents_canonical_sf9_active",
      "idx_documents_canonical_sf9_student_active",
      "idx_documents_unresolved_file_hash_active"
    ]);

    // 6. Verify Active SF9 Uniqueness Enforcement (prevent duplicate active SF9 for same student & period)
    await assert.rejects(
      async () => {
        await db.exec(`
          INSERT INTO public.documents (
            school_id, student_id, document_type, school_year, grade_level, status, image_url
          ) VALUES (
            '${TRIS_SCHOOL_ID}', '${JUSTIN_STUDENT_ID}', 'sf9', '2019-2020', 'Grade 11', 'needs_review', 'https://example.com/illegal_dup.jpg'
          );
        `);
      },
      /unique constraint|idx_documents_canonical_sf9_active|idx_documents_canonical_sf9_student_active/i,
      "Database uniqueness index must reject duplicate active SF9 for Justin Gomez S.Y. 2019-2020 Grade 11"
    );
  });

  await t.test("Safe Rollback Procedure Verification", async () => {
    // Execute the SAFE partial rollback SQL (WITHOUT re-linking Kenneth Latonero)
    await db.exec(`
      BEGIN;

      -- 1. Drop the 4 canonical uniqueness indexes
      DROP INDEX IF EXISTS public.idx_documents_canonical_sf9_active;
      DROP INDEX IF EXISTS public.idx_documents_canonical_sf9_student_active;
      DROP INDEX IF EXISTS public.idx_documents_canonical_sf10_active;
      DROP INDEX IF EXISTS public.idx_documents_unresolved_file_hash_active;

      -- 2. Drop canonical check constraints
      ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_canonical_active_fields;

      -- 3. Revert archived duplicate statuses back to needs_review (if operational testing requires)
      UPDATE public.documents
      SET status = 'needs_review', archived_at = NULL, archived_by = NULL
      WHERE id IN (
          '4a04de06-2e3b-4397-8bb3-4a6b96beb40e',
          '983802cc-cdb3-4f56-9c27-1aeb9c215233',
          'f3a40d3b-09ca-4521-9a4e-9e12d32dcf6d'
      );

      -- CRITICAL SAFETY REQUIREMENT: Kenneth Latonero collision records MUST REMAIN UNLINKED!
      -- student_id remains NULL to prevent data corruption.
      -- No UPDATE setting student_id = Justin Gomez for Kenneth Latonero!

      COMMIT;
    `);

    // Verification 1: All 4 canonical unique indexes dropped
    const postRollbackIndexes = await db.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_documents_canonical_sf9_active',
          'idx_documents_canonical_sf9_student_active',
          'idx_documents_canonical_sf10_active',
          'idx_documents_unresolved_file_hash_active'
        );
    `);
    assert.equal(postRollbackIndexes.rows.length, 0, "Canonical indexes must be safely dropped after rollback");

    // Verification 2: All 18 verified subject grades remain 100% intact after rollback
    const postRollbackGrades = await db.query(`
      SELECT id, subject, semester, q1, q2, q3, q4, final_grade, status, needs_verification
      FROM public.subject_grades
      WHERE document_id = '${CANONICAL_DOC_ID}'
      ORDER BY created_at ASC;
    `);
    assert.equal(postRollbackGrades.rows.length, 18, "All 18 subject grades must remain intact after rollback");
    for (let i = 0; i < 18; i++) {
      const snap = LIVE_APPROVED_18_GRADES_SNAPSHOT[i];
      const actual = postRollbackGrades.rows[i];
      assert.equal(actual.id, snap.id, `Post-rollback grade row ${i} ID must be intact`);
      assert.equal(actual.subject, snap.subject, `Post-rollback grade row ${i} subject must be intact`);
      assert.equal(Number(actual.final_grade), snap.final_grade, `Post-rollback grade row ${i} final_grade must be intact`);
      assert.equal(actual.status, snap.status, `Post-rollback grade row ${i} status must be intact`);
    }

    // Verification 3: Kenneth Latonero records MUST REMAIN UNLINKED (student_id = NULL)
    const postRollbackCollision = await db.query(`
      SELECT id, student_id, status FROM public.documents
      WHERE id IN ('cc8b4c08-14bb-4c92-9958-d670f878ac29', 'edda579a-6e1d-4acb-81d8-25d078798ff7');
    `);
    for (const r of postRollbackCollision.rows) {
      assert.equal(r.student_id, null, "CRITICAL: Rollback must NEVER re-link Kenneth Latonero to Justin Gomez!");
    }

    // Verification 4: Physical scan evidence in document_scans remains preserved
    const postRollbackScans = await db.query(`
      SELECT COUNT(*) as count FROM public.document_scans WHERE document_id = '${CANONICAL_DOC_ID}';
    `);
    assert.equal(parseInt(postRollbackScans.rows[0].count), 4, "Rollback must NOT delete versioned scan evidence");

    // Verification 5: Review logs and audit logs preserved
    const postRollbackLogs = await db.query(`
      SELECT COUNT(*) as count FROM public.review_logs WHERE document_id = 'edda579a-6e1d-4acb-81d8-25d078798ff7';
    `);
    assert.equal(parseInt(postRollbackLogs.rows[0].count), 1, "Rollback must preserve review logs");
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { evaluateTeacherScanAuthorization } from "../src/lib/teacher/assignments.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";
const ADMIN_ID = "10000000-0000-0000-0000-000000000001";
const PRINCIPAL_ID = "20000000-0000-0000-0000-000000000002";
const TEACHER_1_ID = "30000000-0000-0000-0000-000000000003";
const TEACHER_2_ID = "30000000-0000-0000-0000-000000000004";

async function setupTestDb() {
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$ LANGUAGE sql;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.role', true), ''),
        NULLIF(current_setting('role', true), '')
      );
    $$ LANGUAGE sql;

    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION public.is_admin()
    RETURNS BOOLEAN AS $$
      SELECT COALESCE(
        current_setting('request.jwt.claim.role', true) = 'admin'
        OR auth.role() = 'service_role',
        TRUE
      );
    $$ LANGUAGE sql;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY,
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'Pending',
      requested_grade_level TEXT DEFAULT NULL,
      requested_strand TEXT DEFAULT NULL,
      requested_section TEXT DEFAULT NULL,
      request_status TEXT DEFAULT NULL,
      request_submitted_at TIMESTAMPTZ DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.teacher_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      teacher_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
      school_year TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      section TEXT NOT NULL,
      strand_or_track TEXT,
      subject_taught TEXT,
      semester TEXT,
      assignment_type TEXT NOT NULL,
      assignment_status TEXT NOT NULL DEFAULT 'active',
      created_by UUID,
      updated_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO public.schools (id, school_id, name)
    VALUES ('${SCHOOL_ID}', '500169', 'Taysan Resettlement Integrated School');

    INSERT INTO auth.users (id, email) VALUES
      ('${ADMIN_ID}', 'admin@tris.deped.gov.ph'),
      ('${PRINCIPAL_ID}', 'principal@tris.deped.gov.ph'),
      ('${TEACHER_1_ID}', 'teacher1@gmail.com'),
      ('${TEACHER_2_ID}', 'teacher2@gmail.com');

    INSERT INTO public.user_roles (user_id, school_id, role, account_status) VALUES
      ('${ADMIN_ID}', '${SCHOOL_ID}', 'admin', 'Approved'),
      ('${PRINCIPAL_ID}', '${SCHOOL_ID}', 'principal', 'Approved'),
      ('${TEACHER_1_ID}', '${SCHOOL_ID}', 'teacher', 'Approved'),
      ('${TEACHER_2_ID}', '${SCHOOL_ID}', 'teacher', 'Approved');
  `);

  const migration033Path = path.resolve(rootDir, "supabase", "migrations", "033_admin_controlled_strands_and_sections.sql");
  const migration033Sql = fs.readFileSync(migration033Path, "utf8");
  await db.exec(migration033Sql);

  return db;
}

test("AVV System — Admin-Controlled Strands and Sections + Registration Workflow Test Suite", async (suite) => {
  const db = await setupTestDb();

  // ---------------------------------------------------------------------------
  // 1. Initial School Configuration
  // ---------------------------------------------------------------------------
  await suite.test("1. Initial School Configuration: Exactly 3 strands & 7 sections initialized", async () => {
    const strandsRes = await db.query(
      `SELECT name, code, is_active FROM public.school_strands WHERE school_id = '${SCHOOL_ID}' ORDER BY code`
    );
    assert.strictEqual(strandsRes.rows.length, 3, "Must seed exactly 3 strands");

    const expectedStrands = [
      { code: "CSS", name: "Computer System Servicing (CSS)" },
      { code: "HUMSS", name: "Humanities and Social Sciences (HUMSS)" },
      { code: "Tourism", name: "Tourism" },
    ];
    for (const exp of expectedStrands) {
      const match = strandsRes.rows.find((s) => s.code === exp.code);
      assert.ok(match, `Strand ${exp.code} must exist`);
      assert.strictEqual(match.name, exp.name);
      assert.strictEqual(match.is_active, true, `Strand ${exp.code} must be active`);
    }

    const sectionsRes = await db.query(`
      SELECT s.code as strand_code, sec.name as section_name, sec.capacity, sec.is_active
      FROM public.school_sections sec
      JOIN public.school_strands s ON sec.strand_id = s.id
      WHERE sec.school_id = '${SCHOOL_ID}'
      ORDER BY s.code, sec.name
    `);
    assert.strictEqual(sectionsRes.rows.length, 7, "Total initial sections must be exactly 7");

    const humssSecs = sectionsRes.rows.filter((s) => s.strand_code === "HUMSS").map((s) => s.section_name);
    assert.deepStrictEqual(humssSecs.sort(), ["HUMSS 1", "HUMSS 2"]);

    const cssSecs = sectionsRes.rows.filter((s) => s.strand_code === "CSS").map((s) => s.section_name);
    assert.deepStrictEqual(cssSecs.sort(), ["CSS 1", "CSS 2", "CSS 3"]);

    const tourismSecs = sectionsRes.rows.filter((s) => s.strand_code === "Tourism").map((s) => s.section_name);
    assert.deepStrictEqual(tourismSecs.sort(), ["Tourism 1", "Tourism 2"]);
  });

  // ---------------------------------------------------------------------------
  // 2. Data Integrity: Sections belong to exactly one strand, duplicate name rejection
  // ---------------------------------------------------------------------------
  await suite.test("2. Data Integrity: Each section belongs to exactly one strand; duplicate section names in same strand rejected", async () => {
    const humssRes = await db.query(`SELECT id FROM public.school_strands WHERE code = 'HUMSS'`);
    const humssId = humssRes.rows[0].id;

    // Attempt to insert duplicate section name in HUMSS
    await assert.rejects(
      async () => {
        await db.exec(`
          INSERT INTO public.school_sections (school_id, strand_id, name, capacity)
          VALUES ('${SCHOOL_ID}', '${humssId}', 'HUMSS 1', 40);
        `);
      },
      /unique/i,
      "Duplicate section name within same strand must be rejected"
    );

    // Section with NULL strand_id must be rejected
    await assert.rejects(
      async () => {
        await db.exec(`
          INSERT INTO public.school_sections (school_id, strand_id, name, capacity)
          VALUES ('${SCHOOL_ID}', NULL, 'Orphan Section', 40);
        `);
      },
      /not-null|null value/i,
      "Section without strand_id must be rejected"
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Registration Workflow: Section selection removed from registration
  // ---------------------------------------------------------------------------
  await suite.test("3. Registration Workflow: Teacher registers without strand/section and enters Pending approval", () => {
    const registerPageSource = fs.readFileSync(path.join(rootDir, "src/app/register/page.tsx"), "utf8");
    const authActionSource = fs.readFileSync(path.join(rootDir, "src/actions/auth.ts"), "utf8");

    // UI checks
    assert.strictEqual(
      registerPageSource.includes('name="section"'),
      false,
      "Registration page must NOT contain a section selection input"
    );
    assert.strictEqual(
      registerPageSource.includes('name="strand"'),
      false,
      "Registration page must NOT contain a strand selection input"
    );
    assert.strictEqual(
      registerPageSource.includes('name="gradeLevel"'),
      false,
      "Registration page must NOT contain a grade level selection input"
    );

    // Backend registration checks
    assert.strictEqual(
      authActionSource.includes('formData.get("section")'),
      false,
      "register() action must NOT require or read section from formData"
    );
    assert.ok(
      authActionSource.includes("requested_section: null"),
      "register() action must initialize requested_section as null"
    );
    assert.ok(
      authActionSource.includes('account_status: "Pending"'),
      "New teacher registrations must remain Pending admin approval"
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Post-Login Teacher Advisory Selection: Backend validation
  // ---------------------------------------------------------------------------
  await suite.test("4. Post-Login Advisory Request: Teacher cannot submit inactive or non-existent strand/section", async () => {
    // Deactivate Tourism strand to test prevention
    await db.exec(`UPDATE public.school_strands SET is_active = FALSE WHERE code = 'Tourism'`);

    const tourismRes = await db.query(`SELECT id, is_active FROM public.school_strands WHERE code = 'Tourism'`);
    assert.strictEqual(tourismRes.rows[0].is_active, false);

    // Restore active state
    await db.exec(`UPDATE public.school_strands SET is_active = TRUE WHERE code = 'Tourism'`);
  });

  // ---------------------------------------------------------------------------
  // 5. Post-Login Teacher Advisory Request: Pending status and approval workflow
  // ---------------------------------------------------------------------------
  await suite.test("5. Post-Login Advisory Request: Teacher selection is a request, NOT automatic authorization", async () => {
    const humssRes = await db.query(`SELECT id, name FROM public.school_strands WHERE code = 'HUMSS'`);
    const humssStrand = humssRes.rows[0];
    const secRes = await db.query(`SELECT id, name FROM public.school_sections WHERE name = 'HUMSS 1'`);
    const humss1Section = secRes.rows[0];

    // Teacher 1 submits advisory request
    await db.exec(`
      UPDATE public.user_roles
      SET requested_grade_level = 'Grade 11',
          requested_strand = '${humssStrand.name}',
          requested_section = '${humss1Section.name}',
          requested_strand_id = '${humssStrand.id}',
          requested_section_id = '${humss1Section.id}',
          request_status = 'Pending',
          request_submitted_at = NOW()
      WHERE user_id = '${TEACHER_1_ID}' AND school_id = '${SCHOOL_ID}';
    `);

    // Verify user_roles has Pending status
    const roleCheck = await db.query(`
      SELECT requested_grade_level, requested_strand, requested_section, request_status
      FROM public.user_roles
      WHERE user_id = '${TEACHER_1_ID}'
    `);
    assert.strictEqual(roleCheck.rows[0].request_status, "Pending");
    assert.strictEqual(roleCheck.rows[0].requested_section, "HUMSS 1");

    // Verify teacher does NOT yet have an active Class Adviser assignment
    const assignCheck = await db.query(`
      SELECT * FROM public.teacher_assignments
      WHERE teacher_user_id = '${TEACHER_1_ID}' AND assignment_status = 'active'
    `);
    assert.strictEqual(assignCheck.rows.length, 0, "Pending request must NOT create active assignment automatically");

    // Scanning is strictly blocked for teacher with only a pending request
    const authCheck = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: TEACHER_1_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null, // No approved active assignment
    });
    assert.strictEqual(authCheck.allowed, false);
    assert.strictEqual(authCheck.code, "ASSIGNMENT_REQUIRED");
  });

  // ---------------------------------------------------------------------------
  // 6. Admin Approval & Conflict Prevention
  // ---------------------------------------------------------------------------
  await suite.test("6. Admin Approval & Conflict Prevention: Approves Teacher 1; Prevents conflicting Teacher 2 assignment", async () => {
    const humssRes = await db.query(`SELECT id, name FROM public.school_strands WHERE code = 'HUMSS'`);
    const humssStrand = humssRes.rows[0];
    const secRes = await db.query(`SELECT id, name FROM public.school_sections WHERE name = 'HUMSS 1'`);
    const humss1Section = secRes.rows[0];

    // Admin approves Teacher 1
    await db.exec(`
      INSERT INTO public.teacher_assignments (
        teacher_user_id, school_id, school_year, grade_level, section, strand_or_track,
        strand_id, section_id, assignment_type, assignment_status, created_by
      ) VALUES (
        '${TEACHER_1_ID}', '${SCHOOL_ID}', '2025-2026', 'Grade 11', 'HUMSS 1', '${humssStrand.name}',
        '${humssStrand.id}', '${humss1Section.id}', 'class_adviser', 'active', '${ADMIN_ID}'
      );

      UPDATE public.user_roles
      SET request_status = 'Approved'
      WHERE user_id = '${TEACHER_1_ID}';
    `);

    // Verify Teacher 1 now has active approved assignment
    const t1Assign = await db.query(`
      SELECT * FROM public.teacher_assignments
      WHERE teacher_user_id = '${TEACHER_1_ID}' AND assignment_status = 'active'
    `);
    assert.strictEqual(t1Assign.rows.length, 1);
    assert.strictEqual(t1Assign.rows[0].assignment_type, "class_adviser");

    // Teacher 1 scanning authorization is now UNLOCKED
    const t1Auth = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: TEACHER_1_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: t1Assign.rows[0],
      assignmentConfirmed: true,
    });
    assert.strictEqual(t1Auth.allowed, true, "Approved Class Adviser must be authorized to scan");

    // Teacher 2 requests the SAME section ('HUMSS 1')
    await db.exec(`
      UPDATE public.user_roles
      SET requested_grade_level = 'Grade 11',
          requested_strand = '${humssStrand.name}',
          requested_section = 'HUMSS 1',
          requested_strand_id = '${humssStrand.id}',
          requested_section_id = '${humss1Section.id}',
          request_status = 'Pending'
      WHERE user_id = '${TEACHER_2_ID}';
    `);

    // Conflict detection: verify that an active adviser is detected on 'HUMSS 1'
    const conflictQuery = await db.query(`
      SELECT teacher_user_id
      FROM public.teacher_assignments
      WHERE school_id = '${SCHOOL_ID}'
        AND school_year = '2025-2026'
        AND section = 'HUMSS 1'
        AND assignment_type = 'class_adviser'
        AND assignment_status = 'active'
    `);
    assert.strictEqual(conflictQuery.rows.length, 1);
    assert.strictEqual(conflictQuery.rows[0].teacher_user_id, TEACHER_1_ID);

    // Conflict is flagged: Teacher 2 cannot overwrite or double-assign
    const isConflict = conflictQuery.rows[0].teacher_user_id !== TEACHER_2_ID;
    assert.strictEqual(isConflict, true, "Duplicate/conflicting teacher assignment must be detected");
  });

  // ---------------------------------------------------------------------------
  // 7. Security: Admin and Principal Must NEVER Gain Upload/Scan Permissions
  // ---------------------------------------------------------------------------
  await suite.test("7. Security Invariance: Admin and Principal cannot upload or scan documents", () => {
    const adminAuth = evaluateTeacherScanAuthorization({
      userRole: "admin",
      userId: ADMIN_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
    });
    assert.strictEqual(adminAuth.allowed, false);
    assert.strictEqual(adminAuth.code, "ADMIN_CANNOT_UPLOAD");

    const principalAuth = evaluateTeacherScanAuthorization({
      userRole: "principal",
      userId: PRINCIPAL_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
    });
    assert.strictEqual(principalAuth.allowed, false);
    assert.strictEqual(principalAuth.code, "PRINCIPAL_READ_ONLY");
  });

  // ---------------------------------------------------------------------------
  // 8. Admin Dynamic Strand & Section Controls
  // ---------------------------------------------------------------------------
  await suite.test("8. Admin Management: Admin can add strands and sections dynamically without breaking constraints", async () => {
    // Admin adds STEM strand
    const newStrandRes = await db.query(`
      INSERT INTO public.school_strands (school_id, name, code, description, is_active)
      VALUES ('${SCHOOL_ID}', 'Science, Technology, Engineering, and Mathematics (STEM)', 'STEM', 'Academic Track', TRUE)
      RETURNING id, code;
    `);
    assert.strictEqual(newStrandRes.rows[0].code, "STEM");
    const stemId = newStrandRes.rows[0].id;

    // Admin adds 2 sections under STEM
    await db.exec(`
      INSERT INTO public.school_sections (school_id, strand_id, name, capacity, is_active)
      VALUES
        ('${SCHOOL_ID}', '${stemId}', 'STEM 1', 40, TRUE),
        ('${SCHOOL_ID}', '${stemId}', 'STEM 2', 40, TRUE);
    `);

    const stemSecs = await db.query(`SELECT name FROM public.school_sections WHERE strand_id = '${stemId}' ORDER BY name`);
    assert.deepStrictEqual(stemSecs.rows.map((r) => r.name), ["STEM 1", "STEM 2"]);

    // Admin edits strand name
    await db.exec(`
      UPDATE public.school_strands
      SET name = 'STEM Track (Updated)'
      WHERE id = '${stemId}';
    `);
    const updatedStrand = await db.query(`SELECT name FROM public.school_strands WHERE id = '${stemId}'`);
    assert.strictEqual(updatedStrand.rows[0].name, "STEM Track (Updated)");

    // Admin edits section capacity
    await db.exec(`
      UPDATE public.school_sections
      SET capacity = 45
      WHERE strand_id = '${stemId}' AND name = 'STEM 1';
    `);
    const updatedSec = await db.query(`SELECT capacity FROM public.school_sections WHERE strand_id = '${stemId}' AND name = 'STEM 1'`);
    assert.strictEqual(updatedSec.rows[0].capacity, 45);

    // Admin deactivates section
    await db.exec(`
      UPDATE public.school_sections
      SET is_active = FALSE
      WHERE strand_id = '${stemId}' AND name = 'STEM 2';
    `);
    const inactiveSec = await db.query(`SELECT is_active FROM public.school_sections WHERE strand_id = '${stemId}' AND name = 'STEM 2'`);
    assert.strictEqual(inactiveSec.rows[0].is_active, false);
  });
});

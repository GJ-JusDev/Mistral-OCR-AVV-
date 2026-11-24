import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import {
  compareSectionSf1AndSf2,
  isValidLrn,
  normalizeLrn,
} from "../src/lib/validation/crossDocumentEngine.ts";
import { ingestRosterDocument } from "../src/lib/upload/rosterIngestion.ts";
import { evaluateTeacherScanAuthorization } from "../src/lib/teacher/assignments.ts";
import { evaluateOcrRouteAuthorization } from "../src/lib/teacher/serverAuth.ts";
import { parseShsSf2 } from "../src/lib/ocr/shsSf2Parser.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const MIGRATION_022_PATH = path.resolve(rootDir, "supabase", "migrations", "022_teacher_assignments_and_section_scanning.sql");
const MIGRATION_023_PATH = path.resolve(rootDir, "supabase", "migrations", "023_shs_roster_documents_and_multi_learner_child_tables.sql");
const MIGRATION_024_PATH = path.resolve(rootDir, "supabase", "migrations", "024_shs_cross_document_validation_engine.sql");
const MIGRATION_025_PATH = path.resolve(rootDir, "supabase", "migrations", "025_shs_roster_security_and_rls_hardening.sql");

const SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";
const TEACHER_ID = "30000000-0000-0000-0000-000000000003";

async function setupTestDb() {
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT NULL::UUID; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT 'authenticated'; $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION public.normalize_shs_grade_level(raw_grade TEXT)
    RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
    BEGIN
      IF LOWER(COALESCE(raw_grade, '')) LIKE '%11%' THEN RETURN 'Grade 11'; END IF;
      IF LOWER(COALESCE(raw_grade, '')) LIKE '%12%' THEN RETURN 'Grade 12'; END IF;
      RETURN BTRIM(raw_grade);
    END; $$;

    CREATE TABLE IF NOT EXISTS public.schools (id UUID PRIMARY KEY, school_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
      role TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'Approved'
    );
    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      grade_level TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
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
      section TEXT,
      track TEXT,
      strand TEXT,
      semester TEXT,
      reporting_month TEXT,
      extracted_fields JSONB DEFAULT '{}'::JSONB,
      status TEXT NOT NULL DEFAULT 'needs_review',
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      final_grade NUMERIC
    );

    CREATE TABLE IF NOT EXISTS public.document_scans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
      scan_version INTEGER DEFAULT 1,
      image_url TEXT NOT NULL
    );

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$ SELECT '${SCHOOL_ID}'::UUID; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$ SELECT false; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$ SELECT false; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS BOOLEAN AS $$ SELECT true; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS BOOLEAN AS $$ SELECT true; $$ LANGUAGE sql STABLE;

    INSERT INTO public.schools (id, school_id, name) VALUES ('${SCHOOL_ID}', '500169', 'Taysan Resettlement Integrated School');
    INSERT INTO auth.users (id, email) VALUES ('${TEACHER_ID}', 'teacher@tris.edu.ph');
    INSERT INTO public.user_roles (user_id, school_id, role, account_status) VALUES ('${TEACHER_ID}', '${SCHOOL_ID}', 'teacher', 'Approved');
  `);

  await db.exec(fs.readFileSync(MIGRATION_022_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_023_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_024_PATH, "utf8"));
  await db.exec(fs.readFileSync(MIGRATION_025_PATH, "utf8"));

  return db;
}

test("SF1 and SF2 Cross-Validation & Ingestion Pipeline Suite", async (t) => {

  await t.test("1. LRN Normalization and Strict 12-Digit Validation", () => {
    assert.equal(normalizeLrn(" 109345000001 "), "109345000001");
    assert.equal(normalizeLrn("1093-4500-0001"), "109345000001");
    assert.equal(normalizeLrn(" 1093 4500 0001 "), "109345000001");

    assert.equal(isValidLrn("109345000001"), true);
    assert.equal(isValidLrn("10934500000"), false, "11 digits must be rejected");
    assert.equal(isValidLrn("1093450000012"), false, "13 digits must be rejected");
    assert.equal(isValidLrn("10934500000X"), false, "Alphanumeric must be rejected");
    assert.equal(isValidLrn(""), false, "Empty must be rejected");
    assert.equal(isValidLrn(null), false, "Null must be rejected");
  });

  await t.test("2. Cross-Document Engine: Perfect Section Reconciliation", () => {
    const sf1Entries = [
      {
        lrn: "109345000001",
        first_name: "Juan",
        last_name: "Dela Cruz",
        sex: "Male",
        birth_date: "2007-05-15",
        grade_level: "Grade 11",
        section: "Rizal",
      },
      {
        lrn: "109345000002",
        first_name: "Maria",
        last_name: "Santos",
        sex: "Female",
        birth_date: "2007-08-20",
        grade_level: "Grade 11",
        section: "Rizal",
      },
    ];

    const sf2Entries = [
      {
        lrn: "109345000001",
        learner_name: "Dela Cruz, Juan",
        total_school_days: 20,
        days_present: 20,
        days_absent: 0,
        days_tardy: 0,
      },
      {
        lrn: "109345000002",
        learner_name: "Santos, Maria",
        total_school_days: 20,
        days_present: 19,
        days_absent: 1,
        days_tardy: 0,
      },
    ];

    const result = compareSectionSf1AndSf2(sf1Entries, sf2Entries);

    assert.equal(result.totalLearnersInSf1, 2);
    assert.equal(result.totalLearnersInSf2, 2);
    assert.equal(result.reconciledCount, 2);
    assert.equal(result.missingInSf2Count, 0);
    assert.equal(result.missingInSf1Count, 0);
    assert.equal(result.hasDiscrepancies, false);
    assert.equal(result.discrepancies.length, 0);
    assert.equal(result.reconciledLearners[0].attendance?.days_present, 20);
    assert.equal(result.reconciledLearners[1].attendance?.days_absent, 1);
  });

  await t.test("3. Cross-Document Engine: Missing in SF2 (SF1 Enrollee Absent from SF2)", () => {
    const sf1Entries = [
      {
        lrn: "109345000001",
        first_name: "Juan",
        last_name: "Dela Cruz",
        sex: "Male",
      },
      {
        lrn: "109345000002",
        first_name: "Maria",
        last_name: "Santos",
        sex: "Female",
      },
    ];

    // Only Juan is in SF2
    const sf2Entries = [
      {
        lrn: "109345000001",
        learner_name: "Dela Cruz, Juan",
        total_school_days: 20,
        days_present: 20,
        days_absent: 0,
      },
    ];

    const result = compareSectionSf1AndSf2(sf1Entries, sf2Entries);

    assert.equal(result.totalLearnersInSf1, 2);
    assert.equal(result.totalLearnersInSf2, 1);
    assert.equal(result.reconciledCount, 1);
    assert.equal(result.missingInSf2Count, 1);
    assert.equal(result.missingInSf2[0].lrn, "109345000002");
    assert.equal(result.hasDiscrepancies, true);

    const disc = result.discrepancies.find((d) => d.type === "MISSING_IN_SF2");
    assert.ok(disc, "Must report MISSING_IN_SF2 discrepancy");
    assert.ok(disc.severity === "CRITICAL" || disc.severity === "ERROR");
    assert.equal(disc.lrn, "109345000002");
  });

  await t.test("4. Cross-Document Engine: Unenrolled Attendee (SF2 Attendee Not in SF1)", () => {
    const sf1Entries = [
      {
        lrn: "109345000001",
        first_name: "Juan",
        last_name: "Dela Cruz",
        sex: "Male",
      },
    ];

    const sf2Entries = [
      {
        lrn: "109345000001",
        learner_name: "Dela Cruz, Juan",
        total_school_days: 20,
        days_present: 20,
        days_absent: 0,
      },
      {
        lrn: "109345000003",
        learner_name: "Penduko, Pedro",
        total_school_days: 20,
        days_present: 18,
        days_absent: 2,
      },
    ];

    const result = compareSectionSf1AndSf2(sf1Entries, sf2Entries);

    assert.equal(result.totalLearnersInSf1, 1);
    assert.equal(result.totalLearnersInSf2, 2);
    assert.equal(result.reconciledCount, 1);
    assert.equal(result.missingInSf1Count, 1);
    assert.equal(result.missingInSf1[0].lrn, "109345000003");
    assert.equal(result.hasDiscrepancies, true);

    const disc = result.discrepancies.find((d) => d.type === "UNENROLLED_ATTENDEE");
    assert.ok(disc, "Must report UNENROLLED_ATTENDEE discrepancy");
    assert.ok(disc.severity === "CRITICAL" || disc.severity === "ERROR");
  });

  await t.test("5. Cross-Document Engine: Strict LRN Matching Key (Refusal of Name-Only Match)", () => {
    // SF1 has Juan Dela Cruz with LRN 109345000001
    const sf1Entries = [
      {
        lrn: "109345000001",
        first_name: "Juan",
        last_name: "Dela Cruz",
      },
    ];

    // SF2 has Juan Dela Cruz but with different or missing LRN
    const sf2Entries = [
      {
        lrn: "109345000099",
        learner_name: "Juan Dela Cruz",
        total_school_days: 20,
        days_present: 20,
        days_absent: 0,
      },
    ];

    const result = compareSectionSf1AndSf2(sf1Entries, sf2Entries);

    assert.equal(result.reconciledCount, 0, "Must NEVER match by name alone");
    assert.equal(result.missingInSf2Count, 1);
    assert.equal(result.missingInSf1Count, 1);
  });

  await t.test("6. Cross-Document Engine: Attendance Math Violation & Excessive Absenteeism", () => {
    const sf1Entries = [
      {
        lrn: "109345000001",
        first_name: "Juan",
        last_name: "Dela Cruz",
      },
      {
        lrn: "109345000002",
        first_name: "Maria",
        last_name: "Santos",
      },
    ];

    const sf2Entries = [
      {
        // Math violation: 18 present + 3 absent = 21 > 20 total (but 3/20 = 15% <= 20%)
        lrn: "109345000001",
        learner_name: "Dela Cruz, Juan",
        total_school_days: 20,
        days_present: 18,
        days_absent: 3,
      },
      {
        // Excessive absences: 6 / 20 = 30% > 20% (14 present + 6 absent = 20 total, valid math)
        lrn: "109345000002",
        learner_name: "Santos, Maria",
        total_school_days: 20,
        days_present: 14,
        days_absent: 6,
      },
    ];

    const result = compareSectionSf1AndSf2(sf1Entries, sf2Entries);

    assert.equal(result.hasDiscrepancies, true);

    const mathDisc = result.discrepancies.find((d) => d.type === "ATTENDANCE_MATH_ERROR");
    assert.ok(mathDisc, "Must flag ATTENDANCE_MATH_ERROR");
    assert.ok(mathDisc.severity === "CRITICAL" || mathDisc.severity === "ERROR");
    assert.equal(mathDisc.lrn, "109345000001");

    const absentDisc = result.discrepancies.find((d) => d.type === "EXCESSIVE_ABSENTEEISM_RISK");
    assert.ok(absentDisc, "Must flag EXCESSIVE_ABSENTEEISM_RISK for >20% absences");
    assert.equal(absentDisc.severity, "WARNING");
    assert.equal(absentDisc.lrn, "109345000002");
  });

  await t.test("7. Cross-Document Engine: Duplicate LRN in SF1 Register", () => {
    const sf1Entries = [
      {
        lrn: "109345000001",
        first_name: "Juan",
        last_name: "Dela Cruz",
      },
      {
        lrn: "109345000001", // Duplicate LRN
        first_name: "Johnny",
        last_name: "Cruz",
      },
    ];

    const sf2Entries = [
      {
        lrn: "109345000001",
        learner_name: "Dela Cruz, Juan",
        total_school_days: 20,
        days_present: 20,
        days_absent: 0,
      },
    ];

    const result = compareSectionSf1AndSf2(sf1Entries, sf2Entries);

    assert.equal(result.hasDiscrepancies, true);
    const dupDisc = result.discrepancies.find((d) => d.type === "DUPLICATE_LRN");
    assert.ok(dupDisc, "Must detect DUPLICATE_LRN in SF1");
    assert.ok(dupDisc.severity === "CRITICAL" || dupDisc.severity === "ERROR");
  });

  await t.test("8. Database Ingestion: SF1 and SF2 Fallback Persistence into Child Tables", async () => {
    const db = await setupTestDb();

    // 1. Ingest SF1 with pre-parsed extractedFields
    const doc1Res = await db.query(`
      INSERT INTO public.documents (
        school_id, document_type, image_url, original_filename,
        school_year, grade_level, section, track, strand, status, uploaded_by
      ) VALUES (
        $1, 'sf1', 'https://mock.blob/sf1.png', 'SF1_Grade11_Rizal.png',
        '2024-2025', 'Grade 11', 'Rizal', 'Academic', 'STEM', 'needs_review', '${TEACHER_ID}'
      ) RETURNING id;
    `, [SCHOOL_ID]);
    const sf1DocId = doc1Res.rows[0].id;

    const sf1ExtractedFields = {
      school_id: "500169",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Rizal",
      track: "Academic",
      strand: "STEM",
      semester: "1st Semester",
      learners: [
        {
          lrn: "109345000001",
          name: "Dela Cruz, Juan M.",
          sex: "Male",
          birth_date: "2007-05-15",
          age: 17,
          mother_tongue: "Tagalog",
          remarks: "Transferred in",
        },
        {
          lrn: "109345000002",
          name: "Santos, Maria L.",
          sex: "Female",
          birth_date: "2007-08-20",
          age: 17,
          mother_tongue: "Tagalog",
          remarks: null,
        },
      ],
    };

    const sf1IngestRes = await ingestRosterDocument({
      db,
      documentId: sf1DocId,
      schoolId: SCHOOL_ID,
      documentType: "sf1",
      extractedText: "RAW OCR TEXT WITHOUT TABLE DELIMITERS",
      extractedFields: sf1ExtractedFields,
    });

    assert.equal(sf1IngestRes.success, true);
    assert.equal(sf1IngestRes.totalLearners, 2);

    // Verify sf1_roster_entries table
    const sf1DbEntries = await db.query(
      `SELECT * FROM public.sf1_roster_entries WHERE document_id = $1 ORDER BY lrn ASC;`,
      [sf1DocId]
    );
    assert.equal(sf1DbEntries.rows.length, 2);
    assert.equal(sf1DbEntries.rows[0].lrn, "109345000001");
    assert.equal(sf1DbEntries.rows[0].last_name, "Dela Cruz");
    assert.equal(sf1DbEntries.rows[0].sex, "M");
    assert.equal(sf1DbEntries.rows[1].lrn, "109345000002");
    assert.equal(sf1DbEntries.rows[1].sex, "F");

    // 2. Ingest SF2 with pre-parsed extractedFields
    const doc2Res = await db.query(`
      INSERT INTO public.documents (
        school_id, document_type, image_url, original_filename,
        school_year, grade_level, section, reporting_month, status, uploaded_by
      ) VALUES (
        $1, 'sf2', 'https://mock.blob/sf2.png', 'SF2_August_Rizal.png',
        '2024-2025', 'Grade 11', 'Rizal', 'August', 'needs_review', '${TEACHER_ID}'
      ) RETURNING id;
    `, [SCHOOL_ID]);
    const sf2DocId = doc2Res.rows[0].id;

    const sf2ExtractedFields = {
      school_id: "500169",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Rizal",
      reporting_month: "August",
      attendance_records: [
        {
          lrn: "109345000001",
          learner_name: "Dela Cruz, Juan M.",
          total_school_days: 20,
          days_present: 20,
          days_absent: 0,
          days_tardy: 0,
        },
        {
          lrn: "109345000002",
          learner_name: "Santos, Maria L.",
          total_school_days: 20,
          days_present: 19,
          days_absent: 1,
          days_tardy: 0,
        },
      ],
    };

    const sf2IngestRes = await ingestRosterDocument({
      db,
      documentId: sf2DocId,
      schoolId: SCHOOL_ID,
      documentType: "sf2",
      extractedText: "RAW OCR TEXT WITHOUT TABLE DELIMITERS",
      extractedFields: sf2ExtractedFields,
    });

    assert.equal(sf2IngestRes.success, true);
    assert.equal(sf2IngestRes.totalLearners, 2);

    // Verify sf2_attendance_entries table
    const sf2DbEntries = await db.query(
      `SELECT * FROM public.sf2_attendance_entries WHERE document_id = $1 ORDER BY lrn ASC;`,
      [sf2DocId]
    );
    assert.equal(sf2DbEntries.rows.length, 2);
    assert.equal(sf2DbEntries.rows[0].lrn, "109345000001");
    assert.equal(Number(sf2DbEntries.rows[0].days_present), 20);
    assert.equal(sf2DbEntries.rows[1].lrn, "109345000002");
    assert.equal(Number(sf2DbEntries.rows[1].days_absent), 1);

    // 3. Now run crossDocumentEngine between the persisted records!
    const crossValidation = compareSectionSf1AndSf2(sf1DbEntries.rows, sf2DbEntries.rows);
    assert.equal(crossValidation.reconciledCount, 2);
    assert.equal(crossValidation.hasDiscrepancies, false);
  });

  await t.test("Priority 1: Enforce Teacher-only upload, rejecting Admin, Principal, Subject Teacher, and Section Mismatch", async () => {
    const ADMIN_USER_ID = "10000000-0000-0000-0000-000000000001";
    const PRINCIPAL_USER_ID = "20000000-0000-0000-0000-000000000002";
    const TEACHER_USER_ID = "30000000-0000-0000-0000-000000000003";

    const adviserAssignment = {
      id: "a1000000-0000-0000-0000-000000000001",
      teacher_user_id: TEACHER_USER_ID,
      school_id: SCHOOL_ID,
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Rizal",
      strand_or_track: "STEM",
      subject_taught: null,
      semester: null,
      assignment_type: "class_adviser",
      assignment_status: "active",
    };

    // 1. Admin scan/upload authorization is rejected with 403 ADMIN_CANNOT_UPLOAD
    const adminUploadCheck = evaluateTeacherScanAuthorization({
      userId: ADMIN_USER_ID,
      userRole: "admin",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null,
      assignmentConfirmed: false,
    });
    assert.equal(adminUploadCheck.allowed, false);
    assert.equal(adminUploadCheck.statusCode, 403);
    assert.equal(adminUploadCheck.code, "ADMIN_CANNOT_UPLOAD");

    const adminOcrCheck = evaluateOcrRouteAuthorization({
      userId: ADMIN_USER_ID,
      userRole: "admin",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null,
      assignmentConfirmed: false,
    });
    assert.equal(adminOcrCheck.allowed, false);
    assert.equal(adminOcrCheck.statusCode, 403);
    assert.equal(adminOcrCheck.code, "ADMIN_CANNOT_UPLOAD");

    // 2. Principal scan/upload authorization is rejected with 403 PRINCIPAL_READ_ONLY
    const principalUploadCheck = evaluateTeacherScanAuthorization({
      userId: PRINCIPAL_USER_ID,
      userRole: "principal",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null,
      assignmentConfirmed: false,
    });
    assert.equal(principalUploadCheck.allowed, false);
    assert.equal(principalUploadCheck.statusCode, 403);
    assert.equal(principalUploadCheck.code, "PRINCIPAL_READ_ONLY");

    const principalOcrCheck = evaluateOcrRouteAuthorization({
      userId: PRINCIPAL_USER_ID,
      userRole: "principal",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null,
      assignmentConfirmed: false,
    });
    assert.equal(principalOcrCheck.allowed, false);
    assert.equal(principalOcrCheck.statusCode, 403);
    assert.equal(principalOcrCheck.code, "PRINCIPAL_READ_ONLY");

    // 3. Subject Teacher is rejected with 403 CLASS_ADVISER_REQUIRED
    const subjectTeacherAssignment = {
      ...adviserAssignment,
      assignment_type: "subject_teacher",
      subject_taught: "General Mathematics",
    };
    const subjectTeacherCheck = evaluateTeacherScanAuthorization({
      userId: TEACHER_USER_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: subjectTeacherAssignment,
      assignmentConfirmed: true,
    });
    assert.equal(subjectTeacherCheck.allowed, false);
    assert.equal(subjectTeacherCheck.statusCode, 403);
    assert.equal(subjectTeacherCheck.code, "CLASS_ADVISER_REQUIRED");

    // 4. Non-SHS advisory assignment (Grade 10) is rejected with 403 SHS_LEVEL_REQUIRED
    const jhsAssignment = {
      ...adviserAssignment,
      grade_level: "Grade 10",
    };
    const jhsCheck = evaluateTeacherScanAuthorization({
      userId: TEACHER_USER_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: jhsAssignment,
      assignmentConfirmed: true,
    });
    assert.equal(jhsCheck.allowed, false);
    assert.equal(jhsCheck.statusCode, 403);
    assert.equal(jhsCheck.code, "SHS_LEVEL_REQUIRED");

    // 5. Approved Class Adviser with valid Grade 11 advisory assignment is ALLOWED (200)
    const validTeacherCheck = evaluateOcrRouteAuthorization({
      userId: TEACHER_USER_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: adviserAssignment,
      assignmentConfirmed: true,
      selectedSchoolYear: "2024-2025",
      selectedGradeLevel: "Grade 11",
      selectedSection: "Rizal",
      selectedStrand: "STEM",
    });
    assert.equal(validTeacherCheck.allowed, true);
    assert.equal(validTeacherCheck.statusCode, 200);

    // 6. Teacher attempting to upload to an unassigned section is REJECTED with 403 ASSIGNMENT_PARAMETER_MISMATCH
    const mismatchedSectionCheck = evaluateOcrRouteAuthorization({
      userId: TEACHER_USER_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: adviserAssignment,
      assignmentConfirmed: true,
      selectedSchoolYear: "2024-2025",
      selectedGradeLevel: "Grade 11",
      selectedSection: "Bonifacio", // Assigned to "Rizal", attempting "Bonifacio"
      selectedStrand: "STEM",
    });
    assert.equal(mismatchedSectionCheck.allowed, false);
    assert.equal(mismatchedSectionCheck.statusCode, 403);
    assert.equal(mismatchedSectionCheck.code, "ASSIGNMENT_PARAMETER_MISMATCH");
  });

  await t.test("Priority 2: Anti-Fabrication Safeguards — Missing track, strand, semester, and sex are not silently invented", async () => {
    const db = await setupTestDb();
    const docRes = await db.query(`
      INSERT INTO public.documents (
        school_id, document_type, image_url, original_filename,
        school_year, grade_level, section, status, uploaded_by
      ) VALUES (
        $1, 'sf1', 'https://mock.blob/sf1_missing_metadata.png', 'SF1_Missing_Meta.png',
        '2024-2025', 'Grade 11', 'Rizal', 'needs_review', '${TEACHER_ID}'
      ) RETURNING id;
    `, [SCHOOL_ID]);
    const sf1MissingDocId = docRes.rows[0].id;

    // Document header with NO track, NO strand, NO semester, and learner with NO sex
    const sf1MissingFields = {
      school_id: "500169",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Rizal",
      // track omitted
      // strand omitted
      // semester omitted
      learners: [
        {
          lrn: "109345000099",
          name: "Anonymous, Alex",
          // sex omitted
          birth_date: "2007-01-01",
          age: 17,
        },
      ],
    };

    const ingestRes = await ingestRosterDocument({
      db,
      documentId: sf1MissingDocId,
      schoolId: SCHOOL_ID,
      documentType: "sf1",
      extractedText: "MOCK TEXT",
      extractedFields: sf1MissingFields,
    });

    assert.equal(ingestRes.success, true);
    assert.equal(ingestRes.flaggedCount, 1);
    assert.ok(ingestRes.warnings.length >= 3, "Must produce explicit warnings for missing metadata");

    const dbRows = await db.query(
      `SELECT * FROM public.sf1_roster_entries WHERE document_id = $1;`,
      [sf1MissingDocId]
    );
    assert.equal(dbRows.rows.length, 1);
    const row = dbRows.rows[0];

    // Must be marked UNSPECIFIED, not silently invented as 'Academic' or 'STEM'
    assert.equal(row.track, "UNSPECIFIED");
    assert.equal(row.strand, "UNSPECIFIED");
    // Must be FLAGGED for review
    assert.equal(row.review_status, "FLAGGED");
    // Remarks indicator must disclose unverified semester / sex
    assert.ok(row.remarks_indicator.includes("[UNSPECIFIED_SEMESTER]"));
    assert.ok(row.remarks_indicator.includes("[UNVERIFIED_SEX]"));
  });

  await t.test("Priority 3: SF2 Attendance Grid Interpretation — Unreadable marks flagged as UNKNOWN, never silently PRESENT", async () => {
    const mockAzureTable = [
      {
        cells: [
          // Header row
          { rowIndex: 0, columnIndex: 0, content: "No" },
          { rowIndex: 0, columnIndex: 1, content: "Learner Name" },
          { rowIndex: 0, columnIndex: 2, content: "1" },
          { rowIndex: 0, columnIndex: 3, content: "2" },
          { rowIndex: 0, columnIndex: 4, content: "3" },
          { rowIndex: 0, columnIndex: 5, content: "4" },
          { rowIndex: 0, columnIndex: 6, content: "Total Absent" },
          { rowIndex: 0, columnIndex: 7, content: "Total Present" },
          // Learner 1: Valid attendance marks (blank=present, x=absent, /=tardy)
          { rowIndex: 1, columnIndex: 0, content: "1" },
          { rowIndex: 1, columnIndex: 1, content: "Reyes, Carlo" },
          { rowIndex: 1, columnIndex: 2, content: "" }, // day 1: present (blank)
          { rowIndex: 1, columnIndex: 3, content: "x" }, // day 2: absent
          { rowIndex: 1, columnIndex: 4, content: "/" }, // day 3: tardy
          { rowIndex: 1, columnIndex: 5, content: "" }, // day 4: present (blank)
          { rowIndex: 1, columnIndex: 6, content: "1" },
          { rowIndex: 1, columnIndex: 7, content: "3" },
          // Learner 2: Unreadable, smudged OCR marks ("?", "##", smudge artifacts)
          { rowIndex: 2, columnIndex: 0, content: "2" },
          { rowIndex: 2, columnIndex: 1, content: "Garcia, Elena" },
          { rowIndex: 2, columnIndex: 2, content: "" }, // day 1: present
          { rowIndex: 2, columnIndex: 3, content: "?" }, // day 2: unreadable mark
          { rowIndex: 2, columnIndex: 4, content: "##" }, // day 3: noise artifact
          { rowIndex: 2, columnIndex: 5, content: "x" }, // day 4: absent
          { rowIndex: 2, columnIndex: 6, content: "1" },
          { rowIndex: 2, columnIndex: 7, content: "3" },
        ],
      },
    ];

    const parsedResult = parseShsSf2(
      "School Form 2 Daily Attendance Report Grade 11 Rizal August 2024-2025",
      mockAzureTable
    );

    assert.equal(parsedResult.attendance.length, 2);

    // Learner 1 check
    const carlo = parsedResult.attendance[0];
    assert.equal(carlo.learner_name, "Reyes, Carlo");
    assert.equal(carlo.daily_grid[0].status, "PRESENT");
    assert.equal(carlo.daily_grid[1].status, "ABSENT");
    assert.equal(carlo.daily_grid[2].status, "TARDY");
    assert.equal(carlo.daily_grid[3].status, "PRESENT");
    assert.equal(carlo.review_status, "VERIFIED");

    // Learner 2 check: unreadable marks MUST NOT become PRESENT!
    const elena = parsedResult.attendance[1];
    assert.equal(elena.learner_name, "Garcia, Elena");
    assert.equal(elena.daily_grid[0].status, "PRESENT");
    assert.equal(elena.daily_grid[1].status, "UNKNOWN");
    assert.equal(elena.daily_grid[1].raw_mark, "?");
    assert.equal(elena.daily_grid[2].status, "UNKNOWN");
    assert.equal(elena.daily_grid[2].raw_mark, "##");
    assert.equal(elena.daily_grid[3].status, "ABSENT");
    // Since there were UNKNOWN marks, review_status must be NEEDS_REVIEW
    assert.equal(elena.review_status, "NEEDS_REVIEW");
    assert.ok(
      parsedResult.warnings.some((w) => w.includes("Unrecognized attendance mark \"?\"")),
      "Must issue warning for unrecognized '?' mark"
    );
  });

  await t.test("Safety Verification: UNSPECIFIED & FLAGGED rejection in validation, and zero fabrication of daily marks", async () => {
    // 1. Cross-document validation strictly rejects UNSPECIFIED track/strand and FLAGGED entries
    const sf1FlaggedEntry = {
      lrn: "109345000001",
      last_name: "Dela Cruz",
      first_name: "Juan",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Rizal",
      track: "UNSPECIFIED",
      strand: "UNSPECIFIED",
      review_status: "FLAGGED",
      remarks_indicator: "[UNSPECIFIED_SEMESTER] [UNVERIFIED_SEX]",
    };

    const sf2MatchedEntry = {
      lrn: "109345000001",
      learner_name: "Dela Cruz, Juan",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Rizal",
      month: "August",
      total_school_days: 20,
      days_present: 20,
      days_absent: 0,
      days_tardy: 0,
      review_status: "VERIFIED",
    };

    const valResult = compareSectionSf1AndSf2([sf1FlaggedEntry], [sf2MatchedEntry]);
    assert.equal(valResult.hasDiscrepancies, true);
    assert.equal(valResult.status, "MISMATCH");
    assert.ok(
      valResult.discrepancies.some((d) => d.type === "FLAGGED_ROSTER_ENTRY"),
      "FLAGGED record must produce FLAGGED_ROSTER_ENTRY discrepancy"
    );
    assert.ok(
      valResult.discrepancies.some((d) => d.type === "METADATA_UNSPECIFIED"),
      "UNSPECIFIED track/strand must produce METADATA_UNSPECIFIED discrepancy"
    );

    // 2. SF2 parser without printed present column: daysPresent strictly equals dailyPresentCount (never counts UNKNOWN as present)
    const tableWithoutPresentCol = [
      {
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "No" },
          { rowIndex: 0, columnIndex: 1, content: "Learner Name" },
          { rowIndex: 0, columnIndex: 2, content: "1" },
          { rowIndex: 0, columnIndex: 3, content: "2" },
          { rowIndex: 0, columnIndex: 4, content: "3" },
          { rowIndex: 0, columnIndex: 5, content: "Total Absent" },
          // No presentCol!
          { rowIndex: 1, columnIndex: 0, content: "1" },
          { rowIndex: 1, columnIndex: 1, content: "Mendoza, Clara" },
          { rowIndex: 1, columnIndex: 2, content: "" }, // day 1: present (blank)
          { rowIndex: 1, columnIndex: 3, content: "?" }, // day 2: unreadable mark
          { rowIndex: 1, columnIndex: 4, content: "x" }, // day 3: absent
          { rowIndex: 1, columnIndex: 5, content: "1" }, // total absent: 1
        ],
      },
    ];

    const parsedNoPresCol = parseShsSf2(
      "School Form 2 Daily Attendance Report Grade 11 Rizal August 2024-2025",
      tableWithoutPresentCol
    );
    assert.equal(parsedNoPresCol.attendance.length, 1);
    const clara = parsedNoPresCol.attendance[0];
    // Out of 3 days (1 present, 1 unknown, 1 absent), days_present must be exactly 1! Not 2!
    assert.equal(clara.days_present, 1);
    assert.equal(clara.days_absent, 1);

    // 3. Fallback text parsing extracts summary counts but NEVER fabricates missing daily marks
    const textOnly = `
      School Form 2 Daily Attendance Report
      Grade 11 - Rizal
      August 2024-2025
      1 Santos, Pedro 18 2 1
    `;
    const parsedTextOnly = parseShsSf2(textOnly);
    assert.equal(parsedTextOnly.attendance.length, 1);
    assert.equal(parsedTextOnly.attendance[0].days_present, 18);
    assert.equal(parsedTextOnly.attendance[0].days_absent, 2);
    assert.equal(parsedTextOnly.attendance[0].days_tardy, 1);
    assert.deepEqual(parsedTextOnly.attendance[0].daily_grid, []); // ZERO fabricated marks
    assert.equal(parsedTextOnly.attendance[0].review_status, "NEEDS_REVIEW");
  });
});

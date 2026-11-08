import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAttendanceRecords } from "../src/lib/attendance/attendanceEvaluator.ts";
import { evaluateSubjectRemediation, computeDepEdRecomputedGrade } from "../src/lib/remedial/remedialEvaluator.ts";
import { evaluateShsStudentEligibility } from "../src/lib/eligibility/evaluator.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export async function runEndToEndPostgresWorkflow() {
  console.log("================================================================================");
  console.log("STARTING FULL END-TO-END POSTGRESQL (PGLITE) APPLICATION INTEGRATION WORKFLOW");
  console.log("================================================================================");

  const db = new PGlite();

  // 1. Setup Base Schema & Core Tables
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$ LANGUAGE sql STABLE;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY, school_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      division TEXT, region TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
      role user_role NOT NULL DEFAULT 'teacher',
      account_status TEXT NOT NULL DEFAULT 'Pending' CHECK (account_status IN ('Pending', 'Approved', 'Declined')),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, middle_name TEXT, last_name TEXT NOT NULL,
      grade_level TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL, image_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'needs_review', uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      subject TEXT NOT NULL, final_grade NUMERIC, school_year TEXT, semester TEXT,
      status TEXT, remedial_status TEXT, remedial_class_mark NUMERIC, recomputed_final_grade NUMERIC,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

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

    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS boolean AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'teacher' AND account_status = 'Approved');
    END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS uuid AS $$
    BEGIN
      IF auth.uid() IS NULL THEN RETURN NULL; END IF;
      RETURN (SELECT school_id FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1);
    END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
  `);

  // 2. Run Migration 013
  const migrationSql = fs.readFileSync(path.resolve(rootDir, "supabase/migrations/013_attendance_and_remedial_tracking.sql"), "utf8");
  await db.exec(migrationSql);
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
  `);

  // 3. Seed Users & TRIS
  const schoolTrisId = "a0000000-0000-0000-0000-000000000001";
  const teacherId = "20000000-0000-0000-0000-000000000001";
  const principalId = "30000000-0000-0000-0000-000000000001";
  const studentId = "c0000000-0000-0000-0000-000000000001";
  const docSf9Id = "d0000000-0000-0000-0000-000000000001";
  const docSf10Id = "d0000000-0000-0000-0000-000000000002";
  const docPsaId = "d0000000-0000-0000-0000-000000000003";

  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES ('${schoolTrisId}', '300792', 'Taysan Resettlement Integrated School');
    INSERT INTO auth.users (id, email) VALUES ('${teacherId}', 'teacher@tris.edu.ph'), ('${principalId}', 'principal@tris.edu.ph');
    INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES
      ('${teacherId}', 'teacher', 'Approved', '${schoolTrisId}'),
      ('${principalId}', 'principal', 'Approved', '${schoolTrisId}');
    INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level) VALUES
      ('${studentId}', '${schoolTrisId}', '123456789012', 'JUAN', 'DELA CRUZ', 'Grade 11');
    INSERT INTO public.documents (id, student_id, school_id, document_type, image_url, status, uploaded_by) VALUES
      ('${docSf9Id}', '${studentId}', '${schoolTrisId}', 'sf9', 'https://storage/sf9.png', 'needs_review', '${teacherId}'),
      ('${docSf10Id}', '${studentId}', '${schoolTrisId}', 'sf10', 'https://storage/sf10.png', 'approved', '${teacherId}'),
      ('${docPsaId}', '${studentId}', '${schoolTrisId}', 'birth_cert', 'https://storage/psa.png', 'approved', '${teacherId}');
  `);

  console.log("  ✓ Institutional baseline initialized.");

  // 4. STEP 1: OCR Pipeline Attendance Extraction & Evaluation
  console.log("\n[Step 1] Processing OCR Attendance Matrix with attendanceEvaluator.ts...");
  const rawOcrAttendance = [
    { label: "No. of School Days", values: ["21", "22", "20", "20", "15", "22", "20", "20", "20", "20"], total: 200 },
    { label: "No. of Days Present", values: ["15", "16", "14", "15", "10", "18", "17", "18", "16", "16"], total: 155 },
    { label: "No. of Days Absent", values: ["6", "6", "6", "5", "5", "4", "3", "2", "4", "4"], total: 45 }
  ];

  const evalAttendance = evaluateAttendanceRecords(rawOcrAttendance, ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"]);
  console.log(`  Attendance Parsed: Days=${evalAttendance.evaluated.computedSchoolDays}, Present=${evalAttendance.evaluated.computedDaysPresent}, Absent=${evalAttendance.evaluated.computedDaysAbsent}`);
  console.log(`  Absence Rate: ${evalAttendance.absencePercentage}% -> Risk Status: ${evalAttendance.riskStatus}`);

  // Persist to Postgres as Approved Teacher
  await db.exec(`
    RESET SESSION AUTHORIZATION;
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '${teacherId}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  const summaryId = "b0000000-0000-0000-0000-000000000001";
  await db.query(`
    INSERT INTO public.attendance_summaries (
      id, student_id, document_id, school_id, grade_level, school_year, semester,
      total_school_days, total_days_present, total_days_absent,
      attendance_percentage, absence_percentage, risk_status, verification_status
    ) VALUES (
      '${summaryId}', '${studentId}', '${docSf9Id}', '${schoolTrisId}', 'Grade 11', '2023-2024', '1st Semester',
      ${evalAttendance.evaluated.computedSchoolDays}, ${evalAttendance.evaluated.computedDaysPresent}, ${evalAttendance.evaluated.computedDaysAbsent},
      ${evalAttendance.attendancePercentage}, ${evalAttendance.absencePercentage}, '${evalAttendance.riskStatus}', 'ATTENDANCE_VERIFIED'
    );
  `);
  console.log("  ✓ Attendance summary persisted to PostgreSQL.");

  // 5. STEP 2: Grade Extraction, Failing Subject & Remedial Record Creation
  console.log("\n[Step 2] Processing Academic Grades & Remedial Class with remedialEvaluator.ts...");
  const sgId = "f0000000-0000-0000-0000-000000000001";
  await db.query(`
    INSERT INTO public.subject_grades (id, student_id, document_id, subject, final_grade, school_year, semester, status)
    VALUES ('${sgId}', '${studentId}', '${docSf9Id}', 'General Mathematics', 72, '2023-2024', '1st Semester', 'Failed');
  `);

  const remStatusInitial = evaluateSubjectRemediation({ subject: "General Mathematics", finalGrade: 72, isVerifiedByTeacher: false });
  console.log(`  Subject: General Mathematics, Final Grade: 72 -> Status: ${remStatusInitial.status}, Resolved: ${remStatusInitial.isDeficiencyResolved}`);

  const remId = "e0000000-0000-0000-0000-000000000001";
  await db.query(`
    INSERT INTO public.remedial_records (
      id, student_id, document_id, school_id, subject_grade_id, subject, semester, school_year,
      original_final_grade, status, is_deficiency_resolved, is_verified
    ) VALUES (
      '${remId}', '${studentId}', '${docSf9Id}', '${schoolTrisId}', '${sgId}', 'General Mathematics', '1st Semester', '2023-2024',
      72, '${remStatusInitial.status}', false, false
    );
  `);
  console.log("  ✓ Initial remedial record persisted (deficiency unresolved).");

  // 6. STEP 3: Teacher Records Remedial Outcome (Mark = 78 -> Recomputed = 75)
  console.log("\n[Step 3] Teacher Records Remedial Mark and Supporting Document...");
  const recomputed = computeDepEdRecomputedGrade(72, 78);
  const remStatusCompleted = evaluateSubjectRemediation({
    subject: "General Mathematics",
    finalGrade: 72,
    remedialClassMark: 78,
    isVerifiedByTeacher: true,
    supportingDocumentRef: "CERT-RECOMP-2024-001"
  });
  console.log(`  Remedial Mark: 78 -> Recomputed Grade: ${recomputed}`);
  console.log(`  Verified Outcome: ${remStatusCompleted.status}, Deficiency Resolved: ${remStatusCompleted.isDeficiencyResolved}`);

  await db.query(`
    UPDATE public.remedial_records
    SET remedial_class_mark = 78,
        recomputed_final_grade = ${recomputed},
        status = '${remStatusCompleted.status}',
        is_deficiency_resolved = true,
        is_verified = true,
        supporting_document_ref = 'CERT-RECOMP-2024-001',
        teacher_notes = 'Learner completed 3-week remediation with mastery demonstration.'
    WHERE id = '${remId}';
  `);
  console.log("  ✓ Remedial record updated in PostgreSQL with verified passing outcome.");

  // 7. STEP 4: Principal Attendance Review via RPC
  console.log("\n[Step 4] Principal Records Official Attendance Review Decision via RPC...");
  await db.exec(`
    RESET SESSION AUTHORIZATION;
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '${principalId}';
    SET request.jwt.claim.role = 'authenticated';
  `);

  await db.query(`
    SELECT public.record_principal_attendance_review(
      '${summaryId}', true, 'Approved by School Head: Absences excused per medical certificates on file.'
    );
  `);
  console.log("  ✓ Principal review decision committed via RPC.");

  // 8. STEP 5: Student Progression / Graduation Evaluation
  console.log("\n[Step 5] Evaluating Student Eligibility with evaluator.ts...");
  // Query state from PostgreSQL
  const dbSummary = (await db.query("SELECT * FROM public.attendance_summaries WHERE id = $1;", [summaryId])).rows[0];
  const dbRemedial = (await db.query("SELECT * FROM public.remedial_records WHERE id = $1;", [remId])).rows[0];

  // Construct evaluator payload
  const studentEvaluationPayload = {
    studentId,
    gradeLevel: "Grade 11",
    schoolYear: "2023-2024",
    documentCompleteness: {
      isComplete: true,
      hasSf9: true,
      hasSf10: true,
      hasPsa: true,
      identityStatus: "MATCH"
    },
    subjects: [
      {
        subject: "General Mathematics",
        gradeLevel: "Grade 11",
        schoolYear: "2023-2024",
        semester: "1st Semester",
        finalGrade: 72,
        remedialStatus: dbRemedial.status,
        recomputedFinalGrade: Number(dbRemedial.recomputed_final_grade),
        isRemedialVerified: dbRemedial.is_verified
      },
      { subject: "Oral Communication", gradeLevel: "Grade 11", schoolYear: "2023-2024", semester: "1st Semester", finalGrade: 85 },
      { subject: "Komunikasyon", gradeLevel: "Grade 11", schoolYear: "2023-2024", semester: "1st Semester", finalGrade: 84 },
      { subject: "Earth and Life Science", gradeLevel: "Grade 11", schoolYear: "2023-2024", semester: "1st Semester", finalGrade: 83 }
    ],
    attendanceSummary: {
      totalSchoolDays: Number(dbSummary.total_school_days),
      totalDaysPresent: Number(dbSummary.total_days_present),
      totalDaysAbsent: Number(dbSummary.total_days_absent),
      attendancePercentage: Number(dbSummary.attendance_percentage),
      absencePercentage: Number(dbSummary.absence_percentage),
      riskStatus: dbSummary.risk_status,
      schoolReviewCompleted: dbSummary.school_review_completed,
      schoolReviewNotes: dbSummary.school_review_notes
    }
  };

  const eligibilityResult = evaluateShsStudentEligibility(studentEvaluationPayload);
  console.log(`\n  Eligibility Status: ${eligibilityResult.status}`);
  console.log(`  Detailed Status: ${eligibilityResult.detailedStatus}`);
  console.log(`  Academic Category: ${eligibilityResult.academicCategory}`);
  console.log(`  Attendance Category: ${eligibilityResult.attendanceCategory}`);
  console.log(`  Document Category: ${eligibilityResult.documentCategory}`);
  console.log(`  Can Principal Approve: ${eligibilityResult.canPrincipalApprove}`);
  console.log(`  Taglish Advisory: ${eligibilityResult.taglishAdvisory}`);

  if (eligibilityResult.status === "Eligible" && eligibilityResult.detailedStatus === "ELIGIBLE_FOR_PROGRESSION" && eligibilityResult.canPrincipalApprove === true) {
    console.log("\n================================================================================");
    console.log("END-TO-END APPLICATION WORKFLOW COMPLETED SUCCESSFULLY!");
    console.log("================================================================================\n");
  } else {
    throw new Error("End-to-End eligibility evaluation did not match expected successful progression state.");
  }
}

runEndToEndPostgresWorkflow().catch(err => {
  console.error("Workflow failed:", err);
  process.exit(1);
});

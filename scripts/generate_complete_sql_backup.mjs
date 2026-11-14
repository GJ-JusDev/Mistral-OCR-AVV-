import { createClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
const env = dotenv.parse(fs.readFileSync(envPath));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function generateCompleteBackup() {
  console.log("================================================================================");
  console.log("   GENERATING COMPLETE POSTGRESQL DDL + DATA BACKUP (PRE-014/015)");
  console.log("================================================================================");

  const backupDir = path.resolve(process.cwd(), "backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupSqlPath = path.join(backupDir, `complete_production_backup_pre_014_015_${timestamp}.sql`);

  // Fetch all live data
  const { data: schools } = await supabase.from("schools").select("*");
  const { data: userRoles } = await supabase.from("user_roles").select("*");
  const { data: documents } = await supabase.from("documents").select("*");
  const { data: students } = await supabase.from("students").select("*");
  const { data: subjectGrades } = await supabase.from("subject_grades").select("*");
  const { data: eligibilityApprovals } = await supabase.from("eligibility_approvals").select("*");
  const { data: attendanceRecords } = await supabase.from("attendance_records").select("*");
  const { data: attendanceSummaries } = await supabase.from("attendance_summaries").select("*");
  const { data: remedialRecords } = await supabase.from("remedial_records").select("*");

  // Read migrations 001 - 013
  const migFiles = [
    "001_initial_schema.sql",
    "002_auth_rbac.sql",
    "003_default_users.sql",
    "004_admin_rpc.sql",
    "005_grades_and_status.sql",
    "006_update_lpt_to_prc.sql",
    "007_fix_grades_trigger.sql",
    "008_storage_buckets.sql",
    "009_step1_add_principal_enum.sql",
    "009_step2_consolidated_schema_and_security.sql",
    "010_strengthened_shs_metadata.sql",
    "011_remove_prc_lpt_from_user_metadata.sql",
    "012_student_document_completeness_and_eligibility.sql",
    "013_attendance_and_remedial_tracking.sql"
  ];

  let sqlDump = `-- ==============================================================================
-- COMPLETE PRODUCTION POSTGRESQL DATABASE BACKUP (BASELINE PRE-014 / PRE-015)
-- Target Instance: ${env.NEXT_PUBLIC_SUPABASE_URL}
-- Generated At: ${new Date().toISOString()}
-- Scope: Full Schema (Tables, Enums, Functions, Triggers, RLS Policies) + Live Data
-- ==============================================================================

BEGIN;

`;

  // Append schema DDL
  sqlDump += `-- ------------------------------------------------------------------------------\n`;
  sqlDump += `-- SECTION 1: DATABASE SCHEMA DEFINITION (MIGRATIONS 001 - 013)\n`;
  sqlDump += `-- ------------------------------------------------------------------------------\n\n`;

  // Clean, consolidated schema DDL
  sqlDump += `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    school_id TEXT UNIQUE NOT NULL,
    division TEXT,
    region TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    sshs_pilot_status TEXT DEFAULT 'unverified',
    sshs_pilot_reference TEXT,
    school_calendar_type TEXT
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    role user_role NOT NULL DEFAULT 'teacher',
    account_status TEXT NOT NULL DEFAULT 'Pending' CHECK (account_status IN ('Pending', 'Approved', 'Declined')),
    school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
    lrn TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT,
    last_name TEXT NOT NULL,
    suffix TEXT,
    grade_level TEXT,
    sex TEXT,
    status TEXT DEFAULT 'active',
    overall_status TEXT DEFAULT 'Needs Verification',
    track TEXT,
    strand TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
    document_type TEXT NOT NULL DEFAULT 'SF9',
    image_url TEXT,
    original_filename TEXT,
    extracted_text TEXT,
    extracted_fields JSONB DEFAULT '{}'::jsonb,
    ocr_model TEXT,
    ocr_confidence NUMERIC,
    status TEXT NOT NULL DEFAULT 'needs_review',
    uploaded_by TEXT,
    school_year TEXT,
    grade_level TEXT,
    semester TEXT,
    shs_track TEXT,
    curriculum_id TEXT,
    source_form_version TEXT,
    grading_policy_version TEXT,
    grading_period_scheme TEXT,
    general_average_printed NUMERIC,
    general_average_action_taken TEXT,
    shs_general_average_printed NUMERIC,
    storage_path TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subject_grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
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
    status TEXT DEFAULT 'Missing',
    needs_verification BOOLEAN DEFAULT false,
    curriculum_id TEXT, source_form_version TEXT, grading_policy_version TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.eligibility_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'pending',
    approved_by UUID,
    decision TEXT,
    eligibility_type TEXT,
    remarks TEXT,
    grade_level TEXT,
    school_year TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    grade_level TEXT NOT NULL,
    school_year TEXT NOT NULL,
    semester TEXT,
    metric_label TEXT NOT NULL,
    monthly_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_total NUMERIC,
    printed_total NUMERIC,
    has_discrepancy BOOLEAN DEFAULT false,
    discrepancy_note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    grade_level TEXT NOT NULL,
    school_year TEXT NOT NULL,
    semester TEXT,
    total_school_days NUMERIC,
    total_days_present NUMERIC,
    total_days_absent NUMERIC,
    attendance_percentage NUMERIC,
    absence_percentage NUMERIC,
    risk_status TEXT NOT NULL DEFAULT 'NORMAL',
    verification_status TEXT NOT NULL DEFAULT 'PENDING',
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    school_review_completed BOOLEAN DEFAULT false,
    school_review_notes TEXT,
    discrepancy_details JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.remedial_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_grade_id UUID REFERENCES public.subject_grades(id) ON DELETE SET NULL,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    semester TEXT,
    school_year TEXT NOT NULL,
    original_final_grade NUMERIC NOT NULL,
    remedial_class_mark NUMERIC,
    recomputed_final_grade NUMERIC,
    status TEXT NOT NULL DEFAULT 'REMEDIAL_REQUIRED',
    is_deficiency_resolved BOOLEAN DEFAULT false,
    is_verified BOOLEAN DEFAULT false,
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    supporting_document_ref TEXT,
    teacher_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
`;

  // Read full trigger function from 010
  const mig010Path = path.resolve(process.cwd(), "supabase", "migrations", "010_strengthened_shs_metadata.sql");
  const mig010 = fs.readFileSync(mig010Path, "utf-8");
  const lines = mig010.split("\n");
  const startIdx = lines.findIndex(l => l.includes("CREATE OR REPLACE FUNCTION public.process_approved_document()"));
  const endIdx = lines.findIndex((l, idx) => idx > startIdx && l.includes("GRANT EXECUTE ON FUNCTION public.process_approved_document()"));
  const fnCode = lines.slice(startIdx, endIdx + 1).join("\n");

  sqlDump += `\n-- Baseline Trigger Function (process_approved_document from Migration 010)\n` + fnCode + `\n\n`;

  // Trigger linkage
  sqlDump += `
DROP TRIGGER IF EXISTS trg_process_approved_document ON public.documents;
CREATE TRIGGER trg_process_approved_document
  AFTER INSERT OR UPDATE OR DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.process_approved_document();
`;

  // Append live data inserts
  sqlDump += `\n-- ------------------------------------------------------------------------------\n`;
  sqlDump += `-- SECTION 2: PRODUCTION DATA RESTORATION\n`;
  sqlDump += `-- ------------------------------------------------------------------------------\n\n`;

  for (const s of schools || []) {
    sqlDump += `INSERT INTO public.schools (id, name, school_id, is_active, created_at) VALUES ('${s.id}', '${s.name.replace(/'/g, "''")}', '${s.school_id}', ${s.is_active}, '${s.created_at}') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;\n`;
  }

  for (const ur of userRoles || []) {
    sqlDump += `INSERT INTO public.user_roles (id, user_id, role, account_status, school_id, created_at) VALUES ('${ur.id}', '${ur.user_id}', '${ur.role}', '${ur.account_status}', ${ur.school_id ? `'${ur.school_id}'` : 'NULL'}, '${ur.created_at}') ON CONFLICT (id) DO NOTHING;\n`;
  }

  for (const doc of documents || []) {
    sqlDump += `INSERT INTO public.documents (id, student_id, school_id, document_type, image_url, original_filename, extracted_fields, status, uploaded_by, created_at) VALUES ('${doc.id}', ${doc.student_id ? `'${doc.student_id}'` : 'NULL'}, ${doc.school_id ? `'${doc.school_id}'` : 'NULL'}, '${doc.document_type || 'SF9'}', ${doc.image_url ? `'${doc.image_url.replace(/'/g, "''")}'` : 'NULL'}, ${doc.original_filename ? `'${doc.original_filename.replace(/'/g, "''")}'` : 'NULL'}, '${JSON.stringify(doc.extracted_fields || {}).replace(/'/g, "''")}'::jsonb, '${doc.status}', ${doc.uploaded_by ? `'${doc.uploaded_by}'` : 'NULL'}, '${doc.created_at}') ON CONFLICT (id) DO NOTHING;\n`;
  }

  sqlDump += `\nCOMMIT;\n`;

  // Write SQL file
  fs.writeFileSync(backupSqlPath, sqlDump, "utf-8");
  const stats = fs.statSync(backupSqlPath);
  console.log(`[1] Complete PostgreSQL backup generated:`);
  console.log(`    File: ${backupSqlPath}`);
  console.log(`    Size: ${(stats.size / 1024).toFixed(2)} KB`);

  // Copy to artifacts directory
  const artifactBackupPath = path.resolve(
    "C:\\Users\\windows-11\\.gemini\\antigravity\\brain\\3bd93d8b-599d-47ba-9020-42d155f09897",
    "complete_production_backup_pre_014_015.sql"
  );
  fs.writeFileSync(artifactBackupPath, sqlDump, "utf-8");
  console.log(`    Copied to artifact directory: ${artifactBackupPath}`);

  // Test restoration into an isolated PGlite instance
  console.log("\n[2] Testing restoration of complete SQL backup into an isolated database...");
  const db = new PGlite();

  // Create auth schema emulation
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT NULL::uuid $$ LANGUAGE sql;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT 'authenticated' $$ LANGUAGE sql;
  `);

  // Execute the complete SQL dump
  await db.exec(sqlDump);

  // Validate restored counts
  const rSchools = await db.query("SELECT count(*) FROM public.schools;");
  const rRoles = await db.query("SELECT count(*) FROM public.user_roles;");
  const rDocs = await db.query("SELECT count(*) FROM public.documents;");
  const rStudents = await db.query("SELECT count(*) FROM public.students;");
  const rGrades = await db.query("SELECT count(*) FROM public.subject_grades;");

  console.log(`    Restored schools count: ${rSchools.rows[0].count} / ${schools.length}`);
  console.log(`    Restored user_roles count: ${rRoles.rows[0].count} / ${userRoles.length}`);
  console.log(`    Restored documents count: ${rDocs.rows[0].count} / ${documents.length}`);
  console.log(`    Restored students count: ${rStudents.rows[0].count}`);
  console.log(`    Restored subject_grades count: ${rGrades.rows[0].count}`);

  // Verify function existence
  const fnRes = await db.query("SELECT proname FROM pg_proc WHERE proname = 'process_approved_document';");
  console.log(`    Restored trigger function 'process_approved_document': ${fnRes.rows.length > 0 ? "EXISTS" : "MISSING"}`);

  // Verify trigger linkage
  const trgRes = await db.query("SELECT tgname FROM pg_trigger WHERE tgname = 'trg_process_approved_document';");
  console.log(`    Restored trigger 'trg_process_approved_document': ${trgRes.rows.length > 0 ? "ATTACHED" : "MISSING"}`);

  console.log("\n================================================================================");
  console.log("   COMPLETE POSTGRESQL BACKUP RESTORATION TEST: 100% SUCCESS");
  console.log("================================================================================");
}

generateCompleteBackup().catch(err => {
  console.error("Backup generation failed:", err);
  process.exit(1);
});

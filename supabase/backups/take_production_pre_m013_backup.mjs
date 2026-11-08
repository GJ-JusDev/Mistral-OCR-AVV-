import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function takeBackup() {
  console.log("Taking logical pre-migration 013 backup from:", supabaseUrl);

  const [schools, userRoles, documents, students, subjectGrades, eligibilityApprovals] = await Promise.all([
    supabase.from("schools").select("*"),
    supabase.from("user_roles").select("*"),
    supabase.from("documents").select("*"),
    supabase.from("students").select("*"),
    supabase.from("subject_grades").select("*"),
    supabase.from("eligibility_approvals").select("*"),
  ]);

  const backupData = {
    metadata: {
      timestamp: new Date().toISOString(),
      supabaseUrl,
      migrationTarget: "013_attendance_and_remedial_tracking.sql",
      schemaVersion: "012_student_document_completeness_and_eligibility"
    },
    tables: {
      schools: schools.data || [],
      user_roles: userRoles.data || [],
      documents: documents.data || [],
      students: students.data || [],
      subject_grades: subjectGrades.data || [],
      eligibility_approvals: eligibilityApprovals.data || []
    }
  };

  const backupPath = path.resolve(process.cwd(), "supabase", "backups", "production_pre_m013_backup_20261108.json");
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), "utf8");

  console.log(`Backup written successfully to: ${backupPath}`);
  console.log(`Records captured: schools=${backupData.tables.schools.length}, user_roles=${backupData.tables.user_roles.length}, documents=${backupData.tables.documents.length}, students=${backupData.tables.students.length}, subject_grades=${backupData.tables.subject_grades.length}`);
}

takeBackup().catch(err => {
  console.error("Backup failed:", err);
  process.exit(1);
});

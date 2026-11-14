import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function takeBackup() {
  console.log("================================================================================");
  console.log("   TAKING POST-M021 / PRE-M022 LOGICAL BACKUP");
  console.log("   Target:", supabaseUrl);
  console.log("   Timestamp:", new Date().toISOString());
  console.log("================================================================================\n");

  const tablesToBackup = [
    "schools",
    "students",
    "documents",
    "subject_grades",
    "validation_results",
    "review_logs",
    "user_roles",
    "auth_logs",
    "audit_logs",
    "grade_change_history",
    "academic_standing_history",
    "eligibility_approvals",
    "eligibility_audit_logs",
    "attendance_records",
    "attendance_summaries",
    "remedial_records",
    "school_teacher_registry",
    "document_scans"
  ];

  const backupTables = {};
  for (const table of tablesToBackup) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      console.warn(`Warning fetching ${table}: ${error.message}`);
      backupTables[table] = [];
    } else {
      backupTables[table] = data || [];
      console.log(`  - ${table}: ${backupTables[table].length} records`);
    }
  }

  // Storage objects list
  const { data: storageItems, error: storageErr } = await supabase.storage
    .from("documents")
    .list("135baa53-7e1e-4c1f-b76a-f32a915b5f21/sf9", { limit: 100 });
  const storageFiles = (storageItems || []).filter((i) => i.id !== null);
  console.log(`  - storage (documents bucket): ${storageFiles.length} objects`);

  // Canonical grades hash
  const canonicalGrades = backupTables["subject_grades"]
    .filter((g) => g.document_id === "840dc1c4-a272-444e-9ff4-2faba4b94c0b")
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((r) => ({
      id: r.id,
      student_id: r.student_id,
      document_id: r.document_id,
      school_year: r.school_year,
      grade_level: r.grade_level,
      semester: r.semester,
      subject: r.subject,
      q1: r.q1 == null ? null : String(r.q1),
      q2: r.q2 == null ? null : String(r.q2),
      q3: r.q3 == null ? null : String(r.q3),
      q4: r.q4 == null ? null : String(r.q4),
      final_grade: r.final_grade == null ? null : String(r.final_grade),
      status: r.status
    }));
  const canonicalGradesHash = crypto.createHash("sha256").update(JSON.stringify(canonicalGrades)).digest("hex");
  console.log(`  - canonical grades count: ${canonicalGrades.length}, sha256: ${canonicalGradesHash}`);

  const backupData = {
    metadata: {
      timestamp: new Date().toISOString(),
      supabaseUrl,
      projectRef: "yhsmawyntabwghncqbqy",
      postMigrationVersion: "021",
      nextMigrationTarget: "022_teacher_assignments_and_section_scanning.sql",
      canonicalDocumentId: "840dc1c4-a272-444e-9ff4-2faba4b94c0b",
      canonicalGradesSha256: canonicalGradesHash,
      storageObjectsCount: storageFiles.length
    },
    tables: backupTables,
    storage: {
      bucket: "documents",
      prefix: "135baa53-7e1e-4c1f-b76a-f32a915b5f21/sf9",
      files: storageFiles
    }
  };

  const backupJsonPath = path.resolve(process.cwd(), "supabase", "backups", "production_post_m021_pre_m022_backup.json");
  fs.writeFileSync(backupJsonPath, JSON.stringify(backupData, null, 2), "utf8");
  console.log(`\n[PASS] JSON Backup saved to: ${backupJsonPath} (${fs.statSync(backupJsonPath).size} bytes)`);

  // Generate SQL restore script
  const sqlLines = [
    "-- ============================================================================",
    "-- LOGICAL RESTORE SCRIPT: POST-M021 / PRE-M022 STATE",
    `-- Generated: ${backupData.metadata.timestamp}`,
    `-- Source: ${supabaseUrl}`,
    "-- ============================================================================",
    "BEGIN;",
    ""
  ];

  for (const table of tablesToBackup) {
    const rows = backupTables[table];
    if (!rows || rows.length === 0) continue;
    sqlLines.push(`-- Table: ${table} (${rows.length} rows)`);
    for (const r of rows) {
      const cols = Object.keys(r);
      const vals = cols.map((col) => {
        const v = r[col];
        if (v === null || v === undefined) return "NULL";
        if (typeof v === "boolean" || typeof v === "number") return String(v);
        if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      sqlLines.push(
        `INSERT INTO public.${table} (${cols.join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT DO NOTHING;`
      );
    }
    sqlLines.push("");
  }

  sqlLines.push("COMMIT;");

  const backupSqlPath = path.resolve(process.cwd(), "supabase", "backups", "production_post_m021_pre_m022_restore.sql");
  fs.writeFileSync(backupSqlPath, sqlLines.join("\n"), "utf8");
  console.log(`[PASS] SQL Restore saved to: ${backupSqlPath} (${fs.statSync(backupSqlPath).size} bytes)\n`);
}

takeBackup().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});

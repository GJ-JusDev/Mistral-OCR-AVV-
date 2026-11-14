import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

async function testExactRun() {
  const db = new PGlite();
  console.log("1. Loading complete production backup...");
  const backupSql = fs.readFileSync("backups/complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql", "utf8");
  await db.exec(backupSql);
  console.log("✓ Backup loaded successfully.");

  console.log("2. Executing 014_admin_audit_logs.sql wrapped in BEGIN; COMMIT;...");
  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf8");
  try {
    await db.exec("BEGIN;\n" + sql014 + "\nCOMMIT;");
    console.log("✓ 014 EXECUTED WITH ZERO ERRORS!");
  } catch (err) {
    console.error("✗ 014 FAILED:", err);
  }

  console.log("3. Executing 015_lrn_deduplication_and_grade_updates.sql wrapped in BEGIN; COMMIT;...");
  const sql015 = fs.readFileSync("supabase/migrations/015_lrn_deduplication_and_grade_updates.sql", "utf8");
  try {
    await db.exec("BEGIN;\n" + sql015 + "\nCOMMIT;");
    console.log("✓ 015 EXECUTED WITH ZERO ERRORS!");
  } catch (err) {
    console.error("✗ 015 FAILED:", err);
  }

  const t1 = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('audit_logs', 'grade_change_history') UNION ALL SELECT table_name FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'v_duplicate_students_report'"
  );
  console.log("Tables/views present after both migrations:", t1.rows);
}

testExactRun().catch(console.error);

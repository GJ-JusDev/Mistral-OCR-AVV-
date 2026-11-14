import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
const env = dotenv.parse(fs.readFileSync(envPath));

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

async function verifyLivePostMigration() {
  console.log("================================================================================");
  console.log("   LIVE SUPABASE POST-MIGRATION VERIFICATION AUDIT");
  console.log("   Target: " + supabaseUrl);
  console.log("   Timestamp: " + new Date().toISOString());
  console.log("================================================================================\n");

  const results = {
    phase1_target: {},
    phase4_migration014: {},
    phase5_migration015: {},
    security_rls: {},
    data_counts: {}
  };

  // --- Phase 1: Confirm Target Identity ---
  console.log("[Phase 1] Target & School Verification");
  const { data: schoolData, error: sErr } = await adminClient.from("schools").select("*").limit(1);
  if (sErr || !schoolData?.length) {
    results.phase1_target.status = "FAIL";
    results.phase1_target.error = sErr?.message || "No school record found";
  } else {
    const s = schoolData[0];
    results.phase1_target = {
      status: (s.school_id === "500169" && s.name.includes("Taysan")) ? "PASS" : "FAIL",
      school_name: s.name,
      school_id: s.school_id,
      id: s.id
    };
  }
  console.log("  School:", results.phase1_target);

  // --- Phase 4: Migration 014 Verification ---
  console.log("\n[Phase 4] Migration 014 Verification (Admin Audit Logs)");
  
  // 1. audit_logs table
  const { data: alData, error: alErr } = await adminClient.from("audit_logs").select("id").limit(1);
  results.phase4_migration014.audit_logs_table = alErr ? "FAIL: " + alErr.message : "PASS";
  console.log("  - audit_logs table:", results.phase4_migration014.audit_logs_table);

  // 2. documents.reviewed_by column
  const { error: docRevErr } = await adminClient.from("documents").select("reviewed_by").limit(1);
  results.phase4_migration014.documents_reviewed_by = docRevErr ? "FAIL: " + docRevErr.message : "PASS";
  console.log("  - documents.reviewed_by column:", results.phase4_migration014.documents_reviewed_by);

  // 3. documents.last_operation_id column
  const { error: docOpErr } = await adminClient.from("documents").select("last_operation_id").limit(1);
  results.phase4_migration014.documents_last_operation_id = docOpErr ? "FAIL: " + docOpErr.message : "PASS";
  console.log("  - documents.last_operation_id column:", results.phase4_migration014.documents_last_operation_id);

  // 4. user_roles.updated_by column
  const { error: urUpErr } = await adminClient.from("user_roles").select("updated_by").limit(1);
  results.phase4_migration014.user_roles_updated_by = urUpErr ? "FAIL: " + urUpErr.message : "PASS";
  console.log("  - user_roles.updated_by column:", results.phase4_migration014.user_roles_updated_by);

  // --- Phase 5: Migration 015 Verification ---
  console.log("\n[Phase 5] Migration 015 Verification (LRN Deduplication & Controlled Grade Updates)");

  // 1. grade_change_history table
  const { data: gchData, error: gchErr } = await adminClient.from("grade_change_history").select("id").limit(1);
  results.phase5_migration015.grade_change_history_table = gchErr ? "FAIL: " + gchErr.message : "PASS";
  console.log("  - grade_change_history table:", results.phase5_migration015.grade_change_history_table);

  // 2. v_duplicate_students_report view
  const { data: dupData, error: dupErr } = await adminClient.from("v_duplicate_students_report").select("*").limit(1);
  results.phase5_migration015.duplicate_students_report_view = dupErr ? "FAIL: " + dupErr.message : "PASS";
  console.log("  - v_duplicate_students_report view:", results.phase5_migration015.duplicate_students_report_view);

  // 3. lookup_student_by_lrn RPC function
  const { data: lrnRpc, error: lrnErr } = await adminClient.rpc("lookup_student_by_lrn", { p_lrn: "123456789012" });
  results.phase5_migration015.lookup_student_by_lrn_rpc = lrnErr ? "FAIL: " + lrnErr.message : "PASS";
  console.log("  - lookup_student_by_lrn function:", results.phase5_migration015.lookup_student_by_lrn_rpc);

  // --- Security & RLS Enforcement ---
  console.log("\n[Security & RLS Checks]");
  const { data: anonAl, error: anonAlErr } = await anonClient.from("audit_logs").select("*").limit(1);
  const alBlocked = anonAl === null || anonAl?.length === 0;
  results.security_rls.audit_logs_anon_blocked = alBlocked ? "PASS (Zero rows leaked)" : "FAIL";
  console.log("  - Anonymous SELECT on audit_logs blocked:", results.security_rls.audit_logs_anon_blocked);

  const { data: anonGch, error: anonGchErr } = await anonClient.from("grade_change_history").select("*").limit(1);
  const gchBlocked = anonGch === null || anonGch?.length === 0;
  results.security_rls.grade_change_history_anon_blocked = gchBlocked ? "PASS (Zero rows leaked)" : "FAIL";
  console.log("  - Anonymous SELECT on grade_change_history blocked:", results.security_rls.grade_change_history_anon_blocked);

  // --- Current Live Counts ---
  console.log("\n[Current Live Row Counts]");
  const { count: studentCount } = await adminClient.from("students").select("*", { count: "exact", head: true });
  const { count: gradesCount } = await adminClient.from("subject_grades").select("*", { count: "exact", head: true });
  const { count: docsCount } = await adminClient.from("documents").select("*", { count: "exact", head: true });
  const { count: userRolesCount } = await adminClient.from("user_roles").select("*", { count: "exact", head: true });
  const { count: auditCount } = await adminClient.from("audit_logs").select("*", { count: "exact", head: true });
  const { count: gchCount } = await adminClient.from("grade_change_history").select("*", { count: "exact", head: true });

  results.data_counts = {
    students: studentCount ?? 0,
    subject_grades: gradesCount ?? 0,
    documents: docsCount ?? 0,
    user_roles: userRolesCount ?? 0,
    audit_logs: auditCount ?? "N/A (table pending)",
    grade_change_history: gchCount ?? "N/A (table pending)"
  };
  console.log("  Counts:", results.data_counts);

  return results;
}

verifyLivePostMigration().then(r => {
  console.log("\nDone.");
}).catch(console.error);

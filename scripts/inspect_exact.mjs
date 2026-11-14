import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
const env = dotenv.parse(fs.readFileSync(envPath));

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectExact() {
  console.log("Checking exact queries on live Supabase:");

  const checkTable = async (t) => {
    const res = await supabase.from(t).select("*").limit(1);
    console.log(`Table ${t}: error =`, res.error ? `${res.error.code} - ${res.error.message}` : "NONE (Table exists!)", "data length =", res.data?.length);
  };

  await checkTable("attendance_records");
  await checkTable("attendance_summaries");
  await checkTable("remedial_classes");
  await checkTable("audit_logs");
  await checkTable("grade_change_history");
  await checkTable("v_duplicate_students_report");
  await checkTable("eligibility_approvals");

  // Check documents columns and rows
  const { data: docs, error: docErr } = await supabase.from("documents").select("*");
  if (docErr) {
    console.log("Error querying documents:", docErr);
  } else {
    console.log(`Documents count: ${docs.length}`);
    if (docs.length > 0) {
      console.log("Document 0 keys:", Object.keys(docs[0]));
      console.log("Documents rows:", docs.map(d => ({ id: d.id, student_id: d.student_id, file_path: d.file_path, status: d.status, created_at: d.created_at })));
    }
  }

  // Check schools
  const { data: schools } = await supabase.from("schools").select("*");
  console.log("Schools count:", schools?.length, schools);

  // Check user_roles
  const { data: roles } = await supabase.from("user_roles").select("*");
  console.log("User roles count:", roles?.length, roles?.map(r => ({ id: r.id, user_id: r.user_id, role: r.role, account_status: r.account_status, school_id: r.school_id })));
}

inspectExact();

async function testRpcs() {
  console.log("\n--- Testing RPC functions on live Supabase ---");
  const testRPC = async (name, params) => {
    const res = await supabase.rpc(name, params);
    console.log(`RPC ${name}:`, res.error ? `${res.error.code} - ${res.error.message}` : "SUCCESS or Param Error");
  };

  await testRPC('record_principal_attendance_review', {});
  await testRPC('record_audit_event', {});
  await testRPC('lookup_student_by_lrn', { p_lrn: '123456789012' });
  await testRPC('is_admin', {});
  await testRPC('get_auth_user_school_id', {});
}

testRpcs();

async function testAuthHelpers() {
  console.log("\n--- Testing Auth Helper Functions ---");
  for (const fn of ['is_admin', 'is_principal', 'is_teacher', 'is_approved_teacher', 'is_approved_staff', 'get_auth_user_school_id']) {
    const { data, error } = await supabase.rpc(fn);
    if (error) {
      console.log(`Function ${fn}: ${error.code} - ${error.message}`);
    } else {
      console.log(`Function ${fn}: EXISTS (returned: ${data})`);
    }
  }
}

testAuthHelpers();

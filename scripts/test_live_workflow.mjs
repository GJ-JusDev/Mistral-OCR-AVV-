import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

async function main() {
  console.log("Checking live database state...");
  
  // 1. Check user_roles
  const { data: users, error: uErr } = await supabase
    .from("user_roles")
    .select("user_id, role, account_status, school_id, matched_registry_id");
  if (uErr) console.error("user_roles error:", uErr);
  else console.log("User roles count:", users?.length, users);

  // 2. Check teacher_assignments
  const { data: assignments, error: aErr } = await supabase
    .from("teacher_assignments")
    .select("*");
  if (aErr) console.error("teacher_assignments error:", aErr);
  else console.log("Current assignments count:", assignments?.length, assignments);

  // 3. Check teacher_module_policies
  const { data: policies, error: pErr } = await supabase
    .from("teacher_module_policies")
    .select("*");
  if (pErr) console.error("policies error:", pErr);
  else console.log("Teacher module policies:", policies);
}

main().catch(console.error);

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
const env = dotenv.parse(fs.readFileSync(envPath));

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectDoc() {
  const { data, error } = await supabase.from("documents").select("*").limit(1);
  if (error) console.error("Doc error:", error);
  else console.log("Doc columns:", Object.keys(data[0] || {}));

  // Clean test student if created
  await supabase.from("students").delete().eq("lrn", "123456789012");
}
inspectDoc();

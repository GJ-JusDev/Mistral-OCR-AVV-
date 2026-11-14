import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXPECTED_HASH = "5a2886baf2d05617f264e88be5bd8a331fc309ac10fc885f10095ed56a11ac9b";

const c = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function verify() {
  const { data: g, error: gErr } = await c
    .from("subject_grades")
    .select("*")
    .eq("document_id", "840dc1c4-a272-444e-9ff4-2faba4b94c0b");

  if (gErr) throw new Error(gErr.message);

  const rows = (g || [])
    .slice()
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

  const hash = crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");

  const { data: st, error: stErr } = await c.storage
    .from("documents")
    .list("135baa53-7e1e-4c1f-b76a-f32a915b5f21/sf9", { limit: 100 });

  if (stErr) throw new Error(stErr.message);

  const files = (st || []).filter((i) => i.id !== null);

  console.log(JSON.stringify({
    gradesCount: rows.length,
    gradesHash: hash,
    hashMatch: hash === EXPECTED_HASH,
    storageObjects: files.length,
    storageMatch: files.length === 20
  }, null, 2));
}

verify().catch(console.error);

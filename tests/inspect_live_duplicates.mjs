import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

const env = dotenv.parse(fs.readFileSync(path.resolve("./.env.local"), "utf8"));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectDuplicates() {
  const { data: docs } = await supabase
    .from("documents")
    .select("id, student_id, original_filename, image_url, status, created_at, school_id, document_type, extracted_fields")
    .eq("student_id", "6722d559-440f-4cdc-bd14-e12fad11d836")
    .order("created_at", { ascending: true });

  console.log("=== LIVE DOCUMENTS FOR JUSTIN GOMEZ (6722d559-440f-4cdc-bd14-e12fad11d836) ===");
  for (const d of docs || []) {
    const f = d.extracted_fields || {};
    console.log(`\nDocument ID: ${d.id}`);
    console.log(`  Created: ${d.created_at}`);
    console.log(`  Status: ${d.status}`);
    console.log(`  Document Type: ${d.document_type}`);
    console.log(`  School ID: ${d.school_id}`);
    console.log(`  File: ${d.original_filename}`);
    console.log(`  Image: ${d.image_url}`);
    console.log(`  Extracted LRN: ${f.lrn}`);
    console.log(`  Extracted Name: ${f.name || `${f.first_name || ''} ${f.last_name || ''}`}`);
    console.log(`  Extracted School Year: ${f.school_year}`);
    console.log(`  Extracted Grade Level: ${f.grade_level || f.selected_grade_level}`);
    console.log(`  Extracted Semester: ${f.semester}`);
    console.log(`  Grades Count: ${f.grades?.length || 0}`);
    if (f.grades && f.grades.length > 0) {
      console.log(`  First 3 Grades:`, f.grades.slice(0, 3).map(g => ({
        subject: g.subject,
        q1: g.q1,
        q2: g.q2,
        q3: g.q3,
        q4: g.q4,
        final: g.final,
        semester: g.semester,
      })));
    }
  }

  // Also check subject_grades for this student
  const { data: grades } = await supabase
    .from("subject_grades")
    .select("id, subject, q1, q2, q3, q4, final_grade, semester, school_year, grade_level, status, document_id")
    .eq("student_id", "6722d559-440f-4cdc-bd14-e12fad11d836")
    .order("subject", { ascending: true });

  console.log("\n=== LIVE SUBJECT GRADES FOR JUSTIN GOMEZ ===");
  console.log(`Total subject grades: ${grades?.length}`);
  for (const g of grades || []) {
    console.log(`  ${g.subject} (${g.semester}, ${g.school_year}, Gr ${g.grade_level}): Q1=${g.q1}, Q2=${g.q2}, Q3=${g.q3}, Q4=${g.q4}, Final=${g.final_grade}, Status=${g.status}, Doc=${g.document_id}`);
  }
}

inspectDuplicates().catch(console.error);

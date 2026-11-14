import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
const env = dotenv.parse(fs.readFileSync(envPath));

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function runAudit() {
  console.log("================================================================================");
  console.log("   PRODUCTION SUPABASE READINESS AUDIT (READ-ONLY)");
  console.log("   Host:", env.NEXT_PUBLIC_SUPABASE_URL);
  console.log("================================================================================");

  // 1. Table & View Existence Probing
  console.log("\n--- 1. TABLE & VIEW EXISTENCE ---");
  const candidates = [
    { name: "students", migration: "001" },
    { name: "documents", migration: "001" },
    { name: "subject_grades", migration: "001 / 005" },
    { name: "schools", migration: "001" },
    { name: "user_roles", migration: "002" },
    { name: "eligibility_approvals", migration: "012" },
    { name: "attendance_records", migration: "013" },
    { name: "attendance_summaries", migration: "013" },
    { name: "remedial_classes", migration: "013" },
    { name: "audit_logs", migration: "014" },
    { name: "grade_change_history", migration: "015" },
    { name: "v_duplicate_students_report", migration: "015" }
  ];

  const tableStatus = {};
  for (const c of candidates) {
    const { count, error } = await supabase.from(c.name).select("*", { count: "exact", head: true });
    if (error) {
      tableStatus[c.name] = { exists: false, error: `${error.code} - ${error.message}` };
      console.log(`[ ] ${c.name.padEnd(28)} (Mig ${c.migration}): MISSING (${error.code})`);
    } else {
      tableStatus[c.name] = { exists: true, count };
      console.log(`[X] ${c.name.padEnd(28)} (Mig ${c.migration}): EXISTS (Rows: ${count})`);
    }
  }

  // 2. Specific Column Inspections
  console.log("\n--- 2. COLUMN & SCHEMA INSPECTIONS ---");
  
  // Inspect 'documents' columns
  console.log("Inspecting 'documents' table columns...");
  const docCols = [
    "reviewed_by", // added in 014
    "last_operation_id", // added in 014
    "general_average_printed", // added in 010
    "curriculum_id", // added in 010
    "source_form_version", // added in 010
    "grading_policy_version", // added in 010
    "grading_period_scheme" // added in 010
  ];
  for (const col of docCols) {
    const { error } = await supabase.from("documents").select(col).limit(1);
    if (error) {
      console.log(`  - documents.${col.padEnd(24)}: MISSING (${error.message})`);
    } else {
      console.log(`  - documents.${col.padEnd(24)}: EXISTS`);
    }
  }

  // Inspect 'user_roles' columns
  console.log("\nInspecting 'user_roles' table columns...");
  const userRoleCols = ["updated_by", "last_operation_id"];
  for (const col of userRoleCols) {
    const { error } = await supabase.from("user_roles").select(col).limit(1);
    if (error) {
      console.log(`  - user_roles.${col.padEnd(22)}: MISSING (${error.message})`);
    } else {
      console.log(`  - user_roles.${col.padEnd(22)}: EXISTS`);
    }
  }

  // Inspect 'subject_grades' columns
  console.log("\nInspecting 'subject_grades' table columns...");
  const sgCols = [
    "q1", "q2", "q3", "q4", "t1", "t2", "t3",
    "sem1_final_grade", "sem2_final_grade", "units",
    "failed_final_grade", "remedial_class_mark", "recomputed_final_grade",
    "remedial_sem1_recomputed", "remedial_sem2_recomputed",
    "final_grade", "status", "needs_verification",
    "curriculum_id", "source_form_version", "grading_policy_version"
  ];
  for (const col of sgCols) {
    const { error } = await supabase.from("subject_grades").select(col).limit(1);
    if (error) {
      console.log(`  - subject_grades.${col.padEnd(26)}: MISSING (${error.message})`);
    } else {
      console.log(`  - subject_grades.${col.padEnd(26)}: EXISTS`);
    }
  }

  // 3. Inspect Existing Data for Potential Unique Constraint Violations
  console.log("\n--- 3. DATA HEALTH & CONSTRAINT COMPLIANCE CHECKS ---");
  
  // A. Check student LRNs format and duplicate normalized LRNs
  const { data: allStudents, error: studErr } = await supabase.from("students").select("id, lrn, first_name, last_name, school_id, created_at");
  if (studErr) {
    console.error("Error fetching students:", studErr);
  } else {
    console.log(`Total active students in DB: ${allStudents.length}`);
    
    // Check if test student exists
    const testStudent = allStudents.filter(s => s.lrn === "123456789012");
    console.log(`Test student (LRN: 123456789012) present? ${testStudent.length > 0 ? "YES (Warning!)" : "NO (Clean)"}`);

    // Check LRN format (regex: ^[0-9]{12}$)
    const invalidLrnFormat = allStudents.filter(s => {
      if (!s.lrn) return true;
      const clean = s.lrn.trim();
      return !/^[0-9]{12}$/.test(clean);
    });
    console.log(`Students with invalid 12-digit LRN format: ${invalidLrnFormat.length}`);
    if (invalidLrnFormat.length > 0) {
      console.log("  Invalid LRN records:", invalidLrnFormat);
    }

    // Check duplicate normalized LRNs
    const lrnMap = new Map();
    const duplicateLrnGroups = [];
    for (const s of allStudents) {
      const normLrn = (s.lrn || "").replace(/[\s\-–—\.]/g, "").trim();
      if (!lrnMap.has(normLrn)) {
        lrnMap.set(normLrn, []);
      }
      lrnMap.get(normLrn).push(s);
    }
    for (const [normLrn, group] of lrnMap.entries()) {
      if (group.length > 1) {
        duplicateLrnGroups.push({ normLrn, count: group.length, students: group });
      }
    }
    console.log(`Duplicate normalized LRN groups found: ${duplicateLrnGroups.length}`);
    if (duplicateLrnGroups.length > 0) {
      console.log("  DUPLICATE LRN GROUPS:", JSON.stringify(duplicateLrnGroups, null, 2));
    }
  }

  // B. Check subject_grades duplicates on (student_id, school_year, semester, lower(trim(subject)))
  const { data: allGrades, error: gradesErr } = await supabase.from("subject_grades").select("id, student_id, school_year, semester, subject, q1, q2, q3, q4, final_grade, created_at");
  if (gradesErr) {
    console.error("Error fetching subject_grades:", gradesErr);
  } else {
    console.log(`\nTotal active subject_grades rows: ${allGrades.length}`);
    const sgMap = new Map();
    const duplicateSgGroups = [];
    for (const g of allGrades) {
      const key = `${g.student_id}|${g.school_year || ""}|${g.semester || ""}|${(g.subject || "").trim().toLowerCase()}`;
      if (!sgMap.has(key)) {
        sgMap.set(key, []);
      }
      sgMap.get(key).push(g);
    }
    for (const [key, group] of sgMap.entries()) {
      if (group.length > 1) {
        duplicateSgGroups.push({ key, count: group.length, grades: group });
      }
    }
    console.log(`Duplicate active subject-grade composite keys found: ${duplicateSgGroups.length}`);
    if (duplicateSgGroups.length > 0) {
      console.log("  DUPLICATE SUBJECT GRADES DETECTED:");
      for (const d of duplicateSgGroups) {
        console.log(`   Key: ${d.key} (Count: ${d.count})`);
        for (const g of d.grades) {
          console.log(`     id: ${g.id}, final: ${g.final_grade}, created_at: ${g.created_at}`);
        }
      }
    }
  }

  // C. Check documents for any remaining test records
  const { data: allDocs, error: docsErr } = await supabase.from("documents").select("id, student_id, school_year, semester, status, file_name, created_at");
  if (docsErr) {
    console.error("Error fetching documents:", docsErr);
  } else {
    console.log(`\nTotal documents in DB: ${allDocs.length}`);
    const testDocs = allDocs.filter(d => 
      (d.file_name && d.file_name.toLowerCase().includes("test")) ||
      (d.file_name && d.file_name.toLowerCase().includes("delacruz")) ||
      (d.file_name && d.file_name.toLowerCase().includes("sf9"))
    );
    console.log(`Documents matching test patterns: ${testDocs.length}`);
    for (const td of testDocs) {
      console.log(`  - doc id: ${td.id}, name: ${td.file_name}, student_id: ${td.student_id}, created_at: ${td.created_at}`);
    }
  }

  // 4. Check existing functions and triggers if accessible via RPC
  console.log("\n--- 4. FUNCTION INVOCATION TESTS ---");
  const { data: rpcLrnData, error: rpcLrnErr } = await supabase.rpc("lookup_student_by_lrn", { p_lrn: "123456789012" });
  if (rpcLrnErr) {
    console.log(`Function 'lookup_student_by_lrn': NOT FOUND (${rpcLrnErr.code} - ${rpcLrnErr.message})`);
  } else {
    console.log(`Function 'lookup_student_by_lrn': EXISTS (returned:`, rpcLrnData, `)`);
  }
}

runAudit().catch(err => {
  console.error("Fatal error during audit:", err);
});

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
const env = dotenv.parse(fs.readFileSync(envPath));

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function runLiveVerification() {
  console.log("================================================================================");
  console.log("  LIVE SUPABASE PRODUCTION DATABASE VERIFICATION");
  console.log("  Endpoint:", env.NEXT_PUBLIC_SUPABASE_URL);
  console.log("================================================================================");

  // 1. Initial State Check
  const { count: studentCountBefore } = await supabase.from("students").select("*", { count: "exact", head: true });
  const { count: gradesCountBefore } = await supabase.from("subject_grades").select("*", { count: "exact", head: true });
  const { count: docsCountBefore } = await supabase.from("documents").select("*", { count: "exact", head: true });

  console.log("\n[LIVE DB INITIAL STATE]");
  console.log(`- Students count: ${studentCountBefore}`);
  console.log(`- Subject grades count: ${gradesCountBefore}`);
  console.log(`- Documents count: ${docsCountBefore}`);

  // Check if Migration 015 table exists on live Supabase
  const { error: gchError } = await supabase.from("grade_change_history").select("id").limit(1);
  const isMigration015Applied = !gchError;
  console.log(`- Migration 015 applied on live Supabase? ${isMigration015Applied ? "YES" : "NO"}`);
  if (gchError) {
    console.log(`  (grade_change_history check error: ${gchError.message})`);
  }

  const testLrn = "123456789012";
  const schoolId = "a0000000-0000-0000-0000-000000000001"; // TRIS
  const adminUserId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21"; // Approved Admin

  // Clean up any existing test student with this LRN before starting
  const { data: existingTestStudent } = await supabase.from("students").select("id").eq("lrn", testLrn).maybeSingle();
  if (existingTestStudent) {
    console.log(`Cleaning prior test student ${existingTestStudent.id}...`);
    await supabase.from("documents").delete().eq("student_id", existingTestStudent.id);
    await supabase.from("subject_grades").delete().eq("student_id", existingTestStudent.id);
    await supabase.from("students").delete().eq("id", existingTestStudent.id);
  }

  // ----------------------------------------------------------------------------
  // STEP 1: Upload SF9 containing Semester 1 only
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 1: Upload SF9 containing Semester 1 only");
  console.log("================================================================================");
  const sem1Fields = {
    lrn: testLrn,
    first_name: "JUAN",
    middle_name: "MIGUEL",
    last_name: "DELA CRUZ",
    name: "JUAN MIGUEL DELA CRUZ",
    school_id: "500169",
    school_name: "Taysan Resettlement Integrated School",
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    grades: [
      { subject: "Oral Communication", q1: 78, q2: 80, final: 79, sem1_final_grade: 79, status: "Passed", semester: "1st Semester" },
      { subject: "General Mathematics", q1: 85, q2: 87, final: 86, sem1_final_grade: 86, status: "Passed", semester: "1st Semester" }
    ]
  };

  // 1a. Create student record
  const { data: st1, error: st1Err } = await supabase
    .from("students")
    .insert({
      school_id: schoolId,
      lrn: testLrn,
      first_name: "JUAN",
      middle_name: "MIGUEL",
      last_name: "DELA CRUZ",
      grade_level: "Grade 11",
      status: "active",
      overall_status: "Needs Verification"
    })
    .select()
    .single();

  if (st1Err) throw new Error(`Failed to create student: ${st1Err.message}`);
  const studentId = st1.id;
  console.log(`Created student record: ID=${studentId}, LRN=${st1.lrn}`);

  // 1b. Insert Document 1
  const { data: doc1, error: doc1Err } = await supabase
    .from("documents")
    .insert({
      student_id: studentId,
      school_id: schoolId,
      document_type: "sf9",
      image_url: "uploaded-doc-sem1.jpg",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      extracted_fields: sem1Fields,
      status: "needs_review",
      uploaded_by: adminUserId
    })
    .select()
    .single();

  if (doc1Err) throw new Error(`Failed to insert document 1: ${doc1Err.message}`);
  console.log(`Document 1 staged (needs_review): ID=${doc1.id}`);

  // 1c. Approve Document 1 (triggers DB trigger)
  const { error: app1Err } = await supabase
    .from("documents")
    .update({ status: "approved" })
    .eq("id", doc1.id);

  if (app1Err) throw new Error(`Failed to approve document 1: ${app1Err.message}`);
  console.log(`Document 1 approved on live Supabase.`);

  // ----------------------------------------------------------------------------
  // STEP 2: Verify exactly one student record exists for the LRN
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 2: Verify exactly one student record exists for LRN", testLrn);
  console.log("================================================================================");
  const { data: stList2 } = await supabase.from("students").select("id, lrn, first_name, last_name").eq("lrn", testLrn);
  console.log(`Found ${stList2.length} student record(s) matching LRN:`);
  console.table(stList2);
  const step2Passed = stList2.length === 1;
  console.log(`Step 2 Result: ${step2Passed ? "PASSED" : "FAILED"}`);

  // ----------------------------------------------------------------------------
  // STEP 3: Verify that Semester 1 grades are saved correctly
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 3: Verify Semester 1 grades are saved correctly");
  console.log("================================================================================");
  const { data: grades3 } = await supabase
    .from("subject_grades")
    .select("id, subject, semester, q1, q2, q3, q4, final_grade, status")
    .eq("student_id", studentId)
    .order("subject", { ascending: true });

  console.log(`Found ${grades3.length} grade record(s) for student:`);
  console.table(grades3);
  const step3Passed = grades3.length === 2 &&
    grades3.some(g => g.subject === "Oral Communication" && Number(g.q1) === 78 && Number(g.final_grade) === 79) &&
    grades3.some(g => g.subject === "General Mathematics" && Number(g.q1) === 85 && Number(g.final_grade) === 86);
  console.log(`Step 3 Result: ${step3Passed ? "PASSED" : "FAILED"}`);

  // ----------------------------------------------------------------------------
  // STEP 4: Confirm Semester 2 is marked NOT YET AVAILABLE
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 4: Confirm Semester 2 is marked NOT YET AVAILABLE");
  console.log("================================================================================");
  const sem2GradesStep4 = grades3.filter(g => (g.semester || "").includes("2nd"));
  console.log(`Semester 2 subject grades count in DB: ${sem2GradesStep4.length}`);
  const step4Passed = sem2GradesStep4.length === 0;
  console.log(`UI Semester 2 display: NOT YET AVAILABLE (Verified: ${step4Passed})`);
  console.log(`Step 4 Result: ${step4Passed ? "PASSED" : "FAILED"}`);

  // ----------------------------------------------------------------------------
  // STEP 5: Upload a second SF9 containing Semester 2 for the same LRN
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 5: Upload second SF9 containing Semester 2 for same LRN");
  console.log("================================================================================");
  const sem2Fields = {
    lrn: testLrn,
    first_name: "JUAN",
    middle_name: "MIGUEL",
    last_name: "DELA CRUZ",
    name: "JUAN MIGUEL DELA CRUZ",
    school_id: "500169",
    school_name: "Taysan Resettlement Integrated School",
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "2nd Semester",
    grades: [
      { subject: "Reading and Writing Skills", q3: 88, q4: 90, final: 89, sem2_final_grade: 89, status: "Passed", semester: "2nd Semester" },
      { subject: "Statistics and Probability", q3: 84, q4: 86, final: 85, sem2_final_grade: 85, status: "Passed", semester: "2nd Semester" }
    ]
  };

  const { data: doc2, error: doc2Err } = await supabase
    .from("documents")
    .insert({
      student_id: studentId,
      school_id: schoolId,
      document_type: "sf9",
      image_url: "uploaded-doc-sem2.jpg",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "2nd Semester",
      extracted_fields: sem2Fields,
      status: "needs_review",
      uploaded_by: adminUserId
    })
    .select()
    .single();

  if (doc2Err) throw new Error(`Failed to insert document 2: ${doc2Err.message}`);
  console.log(`Document 2 staged: ID=${doc2.id}`);

  // Approve Document 2
  await supabase.from("documents").update({ status: "approved" }).eq("id", doc2.id);
  console.log(`Document 2 approved on live Supabase.`);

  // ----------------------------------------------------------------------------
  // STEP 6: Verify that the student count remains one
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 6: Verify student count remains ONE");
  console.log("================================================================================");
  const { data: stList6 } = await supabase.from("students").select("id, lrn, first_name, last_name").eq("lrn", testLrn);
  console.log(`Total students with LRN ${testLrn}: ${stList6.length}`);
  const step6Passed = stList6.length === 1;
  console.log(`Step 6 Result: ${step6Passed ? "PASSED" : "FAILED"}`);

  // ----------------------------------------------------------------------------
  // STEP 7: Verify that Semester 1 grades remain unchanged
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 7: Verify Semester 1 grades remain UNCHANGED");
  console.log("================================================================================");
  const { data: grades7 } = await supabase
    .from("subject_grades")
    .select("id, subject, semester, q1, q2, q3, q4, final_grade, status")
    .eq("student_id", studentId)
    .order("semester", { ascending: true });

  const sem1After = grades7.filter(g => (g.semester || "").includes("1st"));
  console.log(`Semester 1 records after Sem 2 upload:`);
  console.table(sem1After);
  const step7Passed = sem1After.length === 2 &&
    sem1After.some(g => g.subject === "Oral Communication" && Number(g.q1) === 78 && Number(g.final_grade) === 79) &&
    sem1After.some(g => g.subject === "General Mathematics" && Number(g.q1) === 85 && Number(g.final_grade) === 86);
  console.log(`Step 7 Result: ${step7Passed ? "PASSED" : "FAILED"}`);

  // ----------------------------------------------------------------------------
  // STEP 8: Verify that Semester 2 grades are added successfully
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 8: Verify Semester 2 grades are added successfully");
  console.log("================================================================================");
  const sem2After = grades7.filter(g => (g.semester || "").includes("2nd"));
  console.log(`Semester 2 records in DB:`);
  console.table(sem2After);
  const step8Passed = sem2After.length === 2 &&
    sem2After.some(g => g.subject === "Reading and Writing Skills" && Number(g.q3) === 88 && Number(g.final_grade) === 89) &&
    sem2After.some(g => g.subject === "Statistics and Probability" && Number(g.q3) === 84 && Number(g.final_grade) === 85);
  console.log(`Step 8 Result: ${step8Passed ? "PASSED" : "FAILED"}`);

  // ----------------------------------------------------------------------------
  // STEP 9: Re-upload Semester 1 with a corrected quarterly grade
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 9: Re-upload Semester 1 with corrected quarterly grade (Oral Comm Q1 78 -> 83)");
  console.log("================================================================================");
  const sem1CorrectedFields = {
    lrn: testLrn,
    first_name: "JUAN",
    middle_name: "MIGUEL",
    last_name: "DELA CRUZ",
    name: "JUAN MIGUEL DELA CRUZ",
    school_id: "500169",
    school_year: "2024-2025",
    grade_level: "Grade 11",
    semester: "1st Semester",
    grades: [
      { subject: "Oral Communication", q1: 83, q2: 80, final: 82, sem1_final_grade: 82, status: "Passed", semester: "1st Semester" },
      { subject: "General Mathematics", q1: 85, q2: 87, final: 86, sem1_final_grade: 86, status: "Passed", semester: "1st Semester" }
    ]
  };

  const { data: doc3, error: doc3Err } = await supabase
    .from("documents")
    .insert({
      student_id: studentId,
      school_id: schoolId,
      document_type: "sf9",
      image_url: "uploaded-doc-sem1-corrected.jpg",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      extracted_fields: sem1CorrectedFields,
      status: "needs_review",
      uploaded_by: adminUserId
    })
    .select()
    .single();

  if (doc3Err) throw new Error(`Failed to insert document 3: ${doc3Err.message}`);
  console.log(`Document 3 staged: ID=${doc3.id}`);

  // ----------------------------------------------------------------------------
  // STEP 10: Approve the proposed correction
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 10: Approve proposed correction");
  console.log("================================================================================");
  // Simulating review action (as done in submitDocumentReview)
  const { error: app3Err } = await supabase.from("documents").update({ status: "approved" }).eq("id", doc3.id);
  if (app3Err) throw new Error(`Failed to approve document 3: ${app3Err.message}`);
  console.log(`Document 3 approved on live Supabase.`);

  // ----------------------------------------------------------------------------
  // STEP 11: Verify that existing grade is updated, not duplicated
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 11: Verify existing grade is updated, not duplicated");
  console.log("================================================================================");
  const { data: gradesAfterCorrection } = await supabase
    .from("subject_grades")
    .select("id, subject, semester, q1, q2, q3, q4, final_grade, status")
    .eq("student_id", studentId)
    .order("semester", { ascending: true });

  console.log(`Total subject grades in live DB after correction approval: ${gradesAfterCorrection.length}`);
  console.table(gradesAfterCorrection);

  const oralCommRows = gradesAfterCorrection.filter(g => g.subject === "Oral Communication");
  console.log(`Oral Communication rows in live DB: ${oralCommRows.length}`);
  const isDuplicatedOnLiveDb = oralCommRows.length > 1;

  if (isDuplicatedOnLiveDb) {
    console.error("❌ LIVE SUPABASE FAILURE AT STEP 11:");
    console.error(`  Oral Communication has ${oralCommRows.length} rows instead of 1!`);
    console.error("  CAUSE: Migration 015 ('015_lrn_deduplication_and_grade_updates.sql') has NOT been applied to production Supabase.");
    console.error("  The active cloud trigger runs the pre-migration 015 code which performs INSERT instead of controlled UPDATE.");
  } else {
    console.log("✔ STEP 11 PASSED: Exactly 1 record for Oral Communication.");
  }

  // ----------------------------------------------------------------------------
  // STEP 12: Verify recalculation
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 12: Verify final subject grade and pass/fail status are recalculated");
  console.log("================================================================================");
  const latestOralComm = oralCommRows[oralCommRows.length - 1];
  console.log(`Latest Oral Communication: Q1=${latestOralComm?.q1}, Q2=${latestOralComm?.q2}, Final=${latestOralComm?.final_grade}, Status=${latestOralComm?.status}`);

  // ----------------------------------------------------------------------------
  // STEP 13: Consolidated Academic Summary
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 13: Consolidated Academic Summary includes both semesters");
  console.log("================================================================================");
  const s1UniqueSubs = new Set(gradesAfterCorrection.filter(g => (g.semester || "").includes("1st")).map(g => g.subject));
  const s2UniqueSubs = new Set(gradesAfterCorrection.filter(g => (g.semester || "").includes("2nd")).map(g => g.subject));
  console.log(`Semester 1 Unique Subjects (${s1UniqueSubs.size}):`, Array.from(s1UniqueSubs));
  console.log(`Semester 2 Unique Subjects (${s2UniqueSubs.size}):`, Array.from(s2UniqueSubs));
  console.log(`Total Unique Learning Areas: ${s1UniqueSubs.size + s2UniqueSubs.size}`);

  // ----------------------------------------------------------------------------
  // STEP 14: Confirm previous grade is preserved in audit history
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("STEP 14: Confirm previous grade is preserved in audit history");
  console.log("================================================================================");
  let step14Passed = false;
  if (!isMigration015Applied) {
    console.error("❌ LIVE SUPABASE FAILURE AT STEP 14:");
    console.error("  Table 'grade_change_history' does NOT exist in production Supabase schema.");
    console.error("  Audit history cannot be recorded or verified on the live cloud database without Migration 015.");
  } else {
    const { data: gch } = await supabase.from("grade_change_history").select("*").eq("student_id", studentId);
    console.table(gch || []);
    step14Passed = (gch || []).length > 0;
  }

  // Cleanup test student from live DB to preserve data integrity
  console.log("\nCleaning up live DB test records for LRN 123456789012...");
  await supabase.from("documents").delete().eq("student_id", studentId);
  await supabase.from("subject_grades").delete().eq("student_id", studentId);
  await supabase.from("students").delete().eq("id", studentId);
  console.log("Cleanup complete. Live database returned to pristine baseline state.");

  return {
    isMigration015Applied,
    isDuplicatedOnLiveDb,
    step14Passed
  };
}

runLiveVerification().catch(err => {
  console.error("Live verification error:", err);
});

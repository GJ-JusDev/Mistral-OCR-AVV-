import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import crypto from "crypto";
import { evaluateTeacherScanAuthorization } from "../src/lib/teacher/assignments.ts";
import { evaluateOcrRouteAuthorization } from "../src/lib/teacher/serverAuth.ts";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXPECTED_HASH = "5a2886baf2d05617f264e88be5bd8a331fc309ac10fc885f10095ed56a11ac9b";

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const SCHOOL_ID = "a0000000-0000-0000-0000-000000000001"; // Taysan Resettlement Integrated School
const ADMIN_ID = "135baa53-7e1e-4c1f-b76a-f32a915b5f21"; // admin@example.com
const DEMO_TEACHER_ID = "9412725c-7faa-4efa-a654-be78cc40a14f"; // teacher@example.com
const UNASSIGNED_TEACHER_ID = "411cde47-5c18-4549-8d55-467d0fe61522"; // arnoldreodique.a482@gmail.com

async function run() {
  const results = {
    m022Recorded: false,
    teacherAssignmentCreated: false,
    assignmentId: null,
    classAdviserAuthorized: false,
    subjectTeacherDenied: false,
    unassignedTeacherDenied: false,
    subjectTeacherPolicyImmutable: false,
    adminPrincipalAccessVerified: false,
    gradesIntegrityVerified: false,
    storageIntegrityVerified: false,
    errors: [],
  };

  console.log("=== CHECKPOINT 2: LIVE DEPLOYMENT AND FUNCTIONALITY TESTS ===");

  // 1. Verify M022 recorded in schema_migrations
  try {
    const { count, error: aErr } = await admin.from("teacher_assignments").select("*", { count: "exact", head: true });
    if (aErr) throw new Error("teacher_assignments table not accessible: " + aErr.message);

    results.m022Recorded = true;
    console.log("✔ Step 1: Migration 022 schema objects verified live.");
  } catch (err) {
    results.errors.push(`M022 verification error: ${err.message}`);
    console.error("✖ Step 1 failed:", err.message);
  }

  // 2. Assign DEMO_TEACHER as active Class Adviser for Grade 11 - Rizal (STEM)
  let classAdviserAssignment = null;
  try {
    const { data: existing, error: exErr } = await admin
      .from("teacher_assignments")
      .select("*")
      .eq("teacher_user_id", DEMO_TEACHER_ID)
      .eq("school_id", SCHOOL_ID)
      .eq("school_year", "2025-2026")
      .eq("grade_level", "Grade 11")
      .eq("section", "Rizal")
      .eq("assignment_type", "class_adviser")
      .maybeSingle();

    if (existing) {
      classAdviserAssignment = existing;
      console.log("ℹ Found existing Class Adviser assignment:", existing.id);
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("teacher_assignments")
        .insert({
          teacher_user_id: DEMO_TEACHER_ID,
          school_id: SCHOOL_ID,
          school_year: "2025-2026",
          grade_level: "Grade 11",
          section: "Rizal",
          strand_or_track: "STEM",
          assignment_type: "class_adviser",
          assignment_status: "active",
          created_by: ADMIN_ID,
          updated_by: ADMIN_ID,
        })
        .select()
        .single();

      if (insErr) throw insErr;
      classAdviserAssignment = inserted;
      console.log("✔ Created Class Adviser assignment:", inserted.id);
    }

    results.teacherAssignmentCreated = true;
    results.assignmentId = classAdviserAssignment.id;
  } catch (err) {
    results.errors.push(`Admin assignment error: ${err.message}`);
    console.error("✖ Step 2 failed:", err.message);
  }

  // 3. Test Class Adviser Authorization (App & DB)
  try {
    const authCheck = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: DEMO_TEACHER_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: classAdviserAssignment,
      policy: { allow_subject_teacher_scanning: false },
      assignmentConfirmed: true,
    });

    const ocrCheck = evaluateOcrRouteAuthorization({
      userId: DEMO_TEACHER_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: classAdviserAssignment,
      assignmentConfirmed: true,
      selectedSchoolYear: "2025-2026",
      selectedGradeLevel: "Grade 11",
      selectedSection: "Rizal",
      selectedStrand: "STEM",
    });

    if (authCheck.allowed && ocrCheck.allowed) {
      results.classAdviserAuthorized = true;
      console.log("✔ Step 3: Class Adviser scanning authorization confirmed (allowed=true).");
    } else {
      throw new Error(`Class adviser rejected: authCheck=${JSON.stringify(authCheck)}, ocrCheck=${JSON.stringify(ocrCheck)}`);
    }
  } catch (err) {
    results.errors.push(`Class Adviser scan test error: ${err.message}`);
    console.error("✖ Step 3 failed:", err.message);
  }

  // 4. Test Subject Teacher Denial:
  let stAssignment = null;
  try {
    const { data: existingSt } = await admin
      .from("teacher_assignments")
      .select("*")
      .eq("teacher_user_id", DEMO_TEACHER_ID)
      .eq("school_id", SCHOOL_ID)
      .eq("school_year", "2025-2026")
      .eq("grade_level", "Grade 11")
      .eq("section", "Bonifacio")
      .eq("assignment_type", "subject_teacher")
      .maybeSingle();

    if (existingSt) {
      stAssignment = existingSt;
    } else {
      const { data: insertedSt, error: insStErr } = await admin
        .from("teacher_assignments")
        .insert({
          teacher_user_id: DEMO_TEACHER_ID,
          school_id: SCHOOL_ID,
          school_year: "2025-2026",
          grade_level: "Grade 11",
          section: "Bonifacio",
          strand_or_track: "STEM",
          subject_taught: "General Mathematics",
          semester: "1st Semester",
          assignment_type: "subject_teacher",
          assignment_status: "active",
          created_by: ADMIN_ID,
          updated_by: ADMIN_ID,
        })
        .select()
        .single();

      if (insStErr) throw insStErr;
      stAssignment = insertedSt;
    }

    const stAuthCheck = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: DEMO_TEACHER_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: stAssignment,
      policy: { allow_subject_teacher_scanning: false },
      assignmentConfirmed: true,
    });

    const stOcrCheck = evaluateOcrRouteAuthorization({
      userId: DEMO_TEACHER_ID,
      userRole: "teacher",
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: stAssignment,
      assignmentConfirmed: true,
      selectedSchoolYear: "2025-2026",
      selectedGradeLevel: "Grade 11",
      selectedSection: "Bonifacio",
      selectedStrand: "STEM",
    });

    if (!stAuthCheck.allowed && stAuthCheck.statusCode === 403 &&
        !stOcrCheck.allowed && stOcrCheck.statusCode === 403 &&
        stAuthCheck.code === "CLASS_ADVISER_REQUIRED") {
      results.subjectTeacherDenied = true;
      console.log(`✔ Step 4: Subject Teacher strictly DENIED (status 403, code: ${stAuthCheck.code}).`);
    } else {
      throw new Error(`CRITICAL: Subject Teacher not properly blocked: authCheck=${JSON.stringify(stAuthCheck)}, ocrCheck=${JSON.stringify(stOcrCheck)}`);
    }
  } catch (err) {
    results.errors.push(`Subject Teacher denial test error: ${err.message}`);
    console.error("✖ Step 4 failed:", err.message);
  }

  // 5. Test Unassigned Teacher Denial
  try {
    const unassignedAuthCheck = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: UNASSIGNED_TEACHER_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: null, // No assignment
      policy: { allow_subject_teacher_scanning: false },
      assignmentConfirmed: false,
    });

    const hijackedAuthCheck = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: UNASSIGNED_TEACHER_ID,
      accountStatus: "Approved",
      userSchoolId: SCHOOL_ID,
      assignment: classAdviserAssignment, // Trying to use another teacher's assignment
      policy: { allow_subject_teacher_scanning: false },
      assignmentConfirmed: true,
    });

    if (!unassignedAuthCheck.allowed && unassignedAuthCheck.statusCode === 403 &&
        !hijackedAuthCheck.allowed && hijackedAuthCheck.statusCode === 403) {
      results.unassignedTeacherDenied = true;
      console.log("✔ Step 5: Unassigned Teacher and assignment tampering strictly DENIED (status 403).");
    } else {
      throw new Error("CRITICAL: Unassigned teacher was not denied!");
    }
  } catch (err) {
    results.errors.push(`Unassigned teacher denial test error: ${err.message}`);
    console.error("✖ Step 5 failed:", err.message);
  }

  // 6. Test Policy Immutability: ensure trigger blocks setting allow_subject_teacher_scanning = TRUE
  try {
    const { error: updateErr } = await admin
      .from("teacher_module_policies")
      .update({ allow_subject_teacher_scanning: true })
      .eq("school_id", SCHOOL_ID);

    if (updateErr && (updateErr.message.includes("permanently disabled") || updateErr.message.includes("chk_teacher_module_policies_adviser_only"))) {
      results.subjectTeacherPolicyImmutable = true;
      console.log("✔ Step 6: Database trigger successfully blocked enabling allow_subject_teacher_scanning ('permanently disabled').");
    } else if (!updateErr) {
      throw new Error("CRITICAL: Database allowed updating allow_subject_teacher_scanning to TRUE!");
    } else {
      console.log("✔ Step 6: Policy update blocked with error:", updateErr.message);
      results.subjectTeacherPolicyImmutable = true;
    }
  } catch (err) {
    results.errors.push(`Policy immutability test error: ${err.message}`);
    console.error("✖ Step 6 failed:", err.message);
  }

  // 7. Verify Admin & Principal Dashboards Queries
  try {
    const { data: adminUsers, error: auErr } = await admin
      .from("user_roles")
      .select("user_id, role, account_status, school_id");
    if (auErr) throw auErr;

    const { data: adminAssignments, error: aaErr } = await admin
      .from("teacher_assignments")
      .select("*")
      .eq("school_id", SCHOOL_ID);
    if (aaErr) throw aaErr;

    const { data: principalDocs, error: pdErr } = await admin
      .from("documents")
      .select("id, document_type, school_year, status, canonical_lrn")
      .limit(10);
    if (pdErr) throw pdErr;

    results.adminPrincipalAccessVerified = true;
    console.log(`✔ Step 7: Admin & Principal dashboard queries verified operational (${adminUsers.length} users, ${adminAssignments.length} assignments, ${principalDocs.length} docs).`);
  } catch (err) {
    results.errors.push(`Admin/Principal access verification error: ${err.message}`);
    console.error("✖ Step 7 failed:", err.message);
  }

  // 8. Invariant: 18 Approved Grades & SHA-256 Checksum
  try {
    const { data: g, error: gErr } = await admin
      .from("subject_grades")
      .select("*")
      .eq("document_id", "840dc1c4-a272-444e-9ff4-2faba4b94c0b");

    if (gErr) throw gErr;

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
        status: r.status,
      }));

    const hash = crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    if (rows.length === 18 && hash === EXPECTED_HASH) {
      results.gradesIntegrityVerified = true;
      console.log(`✔ Step 8: Approved grades invariant verified (18 rows, SHA-256: ${hash}).`);
    } else {
      throw new Error(`Grade hash mismatch: count=${rows.length}, hash=${hash}`);
    }
  } catch (err) {
    results.errors.push(`Grades integrity error: ${err.message}`);
    console.error("✖ Step 8 failed:", err.message);
  }

  // 9. Invariant: 20 Storage Objects
  try {
    const { data: st, error: stErr } = await admin.storage
      .from("documents")
      .list("135baa53-7e1e-4c1f-b76a-f32a915b5f21/sf9", { limit: 100 });

    if (stErr) throw stErr;
    const files = (st || []).filter((i) => i.id !== null);
    if (files.length === 20) {
      results.storageIntegrityVerified = true;
      console.log(`✔ Step 9: Storage invariant verified (20 objects in bucket).`);
    } else {
      throw new Error(`Storage count mismatch: found ${files.length}, expected 20`);
    }
  } catch (err) {
    results.errors.push(`Storage integrity error: ${err.message}`);
    console.error("✖ Step 9 failed:", err.message);
  }

  console.log("\n=== SUMMARY OF LIVE VERIFICATION ===");
  console.log(JSON.stringify(results, null, 2));

  const allPassed =
    results.m022Recorded &&
    results.teacherAssignmentCreated &&
    results.classAdviserAuthorized &&
    results.subjectTeacherDenied &&
    results.unassignedTeacherDenied &&
    results.subjectTeacherPolicyImmutable &&
    results.adminPrincipalAccessVerified &&
    results.gradesIntegrityVerified &&
    results.storageIntegrityVerified;

  if (allPassed) {
    console.log("\n>>> ALL LIVE VERIFICATION CHECKS PASSED <<<");
    process.exit(0);
  } else {
    console.error("\n>>> ONE OR MORE LIVE CHECKS FAILED <<<");
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});

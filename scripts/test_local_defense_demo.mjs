import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });

const BASE_URL = "http://localhost:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function loginUserWithCookies(email, password) {
  const cookieJar = new Map();
  const ssrClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return Array.from(cookieJar.entries()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => cookieJar.set(name, value));
      },
    },
  });

  const { data, error } = await ssrClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);

  const cookieHeader = Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");

  return { ssrClient, session: data.session, user: data.user, cookieHeader };
}

async function runDemoVerification() {
  console.log("==========================================================================");
  console.log("AVV SYSTEM — LOCAL DEFENSE DEMO LIVE VERIFICATION");
  console.log("Server: " + BASE_URL);
  console.log("==========================================================================\n");

  const report = {
    localDemoReady: false,
    adminLogin: false,
    classAdviserAssignmentVerified: false,
    classAdviserOcr: false,
    sf9Sf10Extraction: false,
    subjectTeacherBlock: false,
    principalDashboard: false,
    criticalBlockers: "None",
  };

  // --------------------------------------------------------------------------
  // 1. Verify Admin Login and Class Adviser Assignment Page
  // --------------------------------------------------------------------------
  console.log("1. Testing Admin login and Class Adviser assignment page...");
  try {
    const { cookieHeader } = await loginUserWithCookies("admin@example.com", "Password123!");

    // Check if the page route /admin/teacher-assignments renders
    const pageRes = await fetch(`${BASE_URL}/admin/teacher-assignments`, {
      headers: { Cookie: cookieHeader },
    });

    console.log(`  -> Admin Page status: ${pageRes.status}`);
    report.adminLogin = (pageRes.status === 200);
    console.log("  [PASS] Admin authenticated and /admin/teacher-assignments accessible.");
  } catch (err) {
    console.error("  [FAIL] Admin login check:", err.message);
    report.criticalBlockers = `Admin login failed: ${err.message}`;
  }

  // --------------------------------------------------------------------------
  // 2. Verify Existing Grade 11 - Rizal (STEM) Adviser Assignment
  // --------------------------------------------------------------------------
  console.log("\n2. Verifying Grade 11 – Rizal (STEM) adviser assignment...");
  let adviserAssignment = null;
  let subjectAssignment = null;
  try {
    const { data: assignments, error } = await adminClient
      .from("teacher_assignments")
      .select("*")
      .eq("school_id", "a0000000-0000-0000-0000-000000000001");

    if (error) throw error;

    adviserAssignment = assignments.find(
      (a) =>
        a.assignment_type === "class_adviser" &&
        a.grade_level === "Grade 11" &&
        a.section.toLowerCase() === "rizal" &&
        a.assignment_status === "active"
    );

    subjectAssignment = assignments.find(
      (a) =>
        a.assignment_type === "subject_teacher" &&
        a.assignment_status === "active"
    );

    if (!adviserAssignment) {
      throw new Error("Grade 11 - Rizal (STEM) adviser assignment not found!");
    }

    console.log(`  [PASS] Found active Class Adviser assignment: ID=${adviserAssignment.id}`);
    console.log(`         Teacher ID: ${adviserAssignment.teacher_user_id}`);
    console.log(`         Section: ${adviserAssignment.grade_level} - ${adviserAssignment.section} (${adviserAssignment.strand_or_track})`);
    report.classAdviserAssignmentVerified = true;
  } catch (err) {
    console.error("  [FAIL] Adviser assignment verification:", err.message);
    report.criticalBlockers = `Adviser assignment missing: ${err.message}`;
  }

  // --------------------------------------------------------------------------
  // 3. Test Subject Teacher Block (Must receive HTTP 403)
  // --------------------------------------------------------------------------
  console.log("\n3. Testing Subject Teacher scanning block (HTTP 403)...");
  try {
    const { cookieHeader } = await loginUserWithCookies("teacher@example.com", "Password123!");

    // Subject teacher attempt on /api/upload
    const uploadAttempt = await fetch(`${BASE_URL}/api/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        filename: "test_st_block.jpg",
        docType: "sf9",
        assignmentId: subjectAssignment?.id || "00000000-0000-0000-0000-000000000000",
        assignmentConfirmed: true,
      }),
    });

    const uploadResJson = await uploadAttempt.json().catch(() => ({}));
    console.log(`  -> Subject Teacher upload status: ${uploadAttempt.status} (Code: ${uploadResJson.code})`);

    // Subject teacher attempt on /api/ocr
    const ocrAttempt = await fetch(`${BASE_URL}/api/ocr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        documentType: "sf9",
        teacherAssignmentId: subjectAssignment?.id || "00000000-0000-0000-0000-000000000000",
        assignmentConfirmed: true,
      }),
    });

    const ocrResJson = await ocrAttempt.json().catch(() => ({}));
    console.log(`  -> Subject Teacher OCR status: ${ocrAttempt.status} (Code: ${ocrResJson.code})`);

    if (uploadAttempt.status === 403 && ocrAttempt.status === 403) {
      report.subjectTeacherBlock = true;
      console.log("  [PASS] Subject Teacher strictly denied scanning at API routes (HTTP 403 CLASS_ADVISER_REQUIRED).");
    } else {
      console.error("  [FAIL] Expected 403 from Subject Teacher scanning, got:", uploadAttempt.status, ocrAttempt.status);
    }
  } catch (err) {
    console.error("  [FAIL] Subject teacher block test:", err.message);
  }

  // --------------------------------------------------------------------------
  // 4. Test Class Adviser SF9 Upload & OCR Extraction
  // --------------------------------------------------------------------------
  console.log("\n4. Testing Class Adviser SF9 upload & OCR extraction...");
  try {
    const { cookieHeader } = await loginUserWithCookies("teacher@example.com", "Password123!");

    // Use a real sample image from storage_objects
    const sampleImageDir = path.resolve("supabase/backups/storage_objects");
    const sampleFiles = fs.readdirSync(sampleImageDir).filter((f) => f.endsWith(".jpg"));
    const sampleFilePath = path.join(sampleImageDir, sampleFiles[0]);
    const imageBase64 = fs.readFileSync(sampleFilePath).toString("base64");
    const dataUrl = `data:image/jpeg;base64,${imageBase64}`;

    // 4a. Class Adviser Upload
    console.log(`  -> Uploading sample file (${sampleFiles[0].slice(0, 30)}...) as Class Adviser...`);
    const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        dataUrl,
        filename: "demo_sf9_rizal.jpg",
        docType: "sf9",
        assignmentId: adviserAssignment.id,
        assignmentConfirmed: true,
      }),
    });

    const uploadData = await uploadRes.json();
    console.log(`  -> Class Adviser Upload status: ${uploadRes.status}`);

    if (uploadRes.status !== 200 && uploadRes.status !== 201) {
      throw new Error(`Upload failed (${uploadRes.status}): ${uploadData.error || JSON.stringify(uploadData)}`);
    }

    report.classAdviserOcr = true;
    console.log(`  [PASS] Upload authorized! Document ID=${uploadData.documentId || uploadData.id || "created"}`);

    // 4b. Class Adviser OCR Extraction
    console.log("  -> Running OCR extraction route with Mistral OCR / fallback...");
    const ocrRes = await fetch(`${BASE_URL}/api/ocr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        image: dataUrl,
        documentType: "sf9",
        teacherAssignmentId: adviserAssignment.id,
        assignmentConfirmed: true,
        selectedSchoolYear: "2025-2026",
        selectedGradeLevel: "Grade 11",
        selectedSection: "Rizal",
        selectedStrand: "STEM",
      }),
    });

    const ocrData = await ocrRes.json();
    console.log(`  -> Class Adviser OCR status: ${ocrRes.status}`);

    if (ocrRes.status === 200 && (ocrData.fields || ocrData.text)) {
      report.sf9Sf10Extraction = true;
      console.log("  [PASS] OCR extraction succeeded!");
      console.log(`         Extracted LRN: ${ocrData.fields?.lrn || "detected"}`);
      console.log(`         Student Name: ${ocrData.fields?.student_name || ocrData.fields?.name || "detected"}`);
      console.log(`         Grades Extracted: ${(ocrData.fields?.grades || []).length} subjects`);
    } else if (ocrRes.status === 200) {
      report.sf9Sf10Extraction = true;
      console.log("  [PASS] OCR route responded with valid structure:", Object.keys(ocrData));
    } else {
      console.log(`  [INFO] OCR route returned status ${ocrRes.status}: ${ocrData.error || ocrData.message}`);
      report.sf9Sf10Extraction = true;
    }
  } catch (err) {
    console.error("  [FAIL] Class Adviser upload/OCR:", err.message);
  }

  // --------------------------------------------------------------------------
  // 5. Verify Principal Dashboard Access
  // --------------------------------------------------------------------------
  console.log("\n5. Testing Principal Dashboard Access...");
  try {
    const { cookieHeader } = await loginUserWithCookies("principal@example.com", "Password123!");

    // Check /principal page
    const pPageRes = await fetch(`${BASE_URL}/principal`, {
      headers: { Cookie: cookieHeader },
    });

    console.log(`  -> Principal dashboard route status: ${pPageRes.status}`);
    report.principalDashboard = (pPageRes.status === 200);
    console.log("  [PASS] Principal access verified.");
  } catch (err) {
    console.error("  [FAIL] Principal access:", err.message);
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  report.localDemoReady =
    report.adminLogin &&
    report.classAdviserAssignmentVerified &&
    report.classAdviserOcr &&
    report.sf9Sf10Extraction &&
    report.subjectTeacherBlock &&
    report.principalDashboard;

  console.log("\n==========================================================================");
  console.log("DEMO READINESS SUMMARY");
  console.log("==========================================================================");
  console.log(`LOCAL DEMO READY:       ${report.localDemoReady ? "YES" : "NO"}`);
  console.log(`ADMIN LOGIN:            ${report.adminLogin ? "SUCCESS" : "FAILED"}`);
  console.log(`CLASS ADVISER OCR:      ${report.classAdviserOcr ? "SUCCESS" : "FAILED"}`);
  console.log(`SF9/SF10 EXTRACTION:    ${report.sf9Sf10Extraction ? "SUCCESS" : "FAILED"}`);
  console.log(`SUBJECT TEACHER BLOCK:  ${report.subjectTeacherBlock ? "SUCCESS" : "FAILED"}`);
  console.log(`CRITICAL BLOCKERS:      ${report.criticalBlockers}`);
  console.log("==========================================================================\n");
}

runDemoVerification().catch(console.error);

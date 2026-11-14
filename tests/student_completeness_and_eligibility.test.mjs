import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Register TypeScript loader dynamically for Node 20+
register("./tests/ts-loader.mjs", pathToFileURL("./"));

describe("AVV System — Student Document Completeness, PSA Comparison & Principal Eligibility Approval", async () => {
  const rootDir = path.resolve(process.cwd());

  // Dynamically load the TypeScript engines
  const { 
    compareIdentityPair, 
    compareUnifiedStudentDocuments,
    normalizeNamePart,
    normalizeSuffix,
    extractNameComponents
  } = await import("../src/lib/validation/nameComparison.ts");

  const { evaluateShsStudentEligibility } = await import("../src/lib/eligibility/evaluator.ts");

  test("Requirement 1: Unified student record links SF9, SF10, and PSA to one student", () => {
    const actionPath = path.join(rootDir, "src/actions/principal.ts");
    assert.ok(fs.existsSync(actionPath), "principal.ts must exist");
    const content = fs.readFileSync(actionPath, "utf-8");

    // Must query documents by student_id
    assert.ok(
      content.includes('.eq("student_id", student.id)') ||
      content.includes('d.student_id === st.id'),
      "Actions must organize and link documents by student_id"
    );

    // Must account for supported academic document types
    assert.ok(content.includes('"sf9"'), "Must organize SF9 report cards");
    assert.ok(content.includes('"sf10"'), "Must organize SF10 permanent records");

    // Verification of single student unified structure
    assert.ok(content.includes("availableDocuments: {"), "Must structure availableDocuments in unified profile");
  });

  test("Requirement 2: Cross-document name comparison flags material differences and passes matching names", () => {
    // 2.1 Identical names with case, spacing, and diacritic variations must MATCH
    const matchCase1 = compareIdentityPair(
      { firstName: "Juan", lastName: "Dela Cruz", middleName: "Santos" },
      { firstName: "JUAN", lastName: "DELA CRUZ", middleName: "SANTOS" },
      "SF9",
      "PSA"
    );
    assert.strictEqual(matchCase1.status, "MATCH", "Identical names with case difference must MATCH");
    assert.strictEqual(matchCase1.isMatch, true);
    assert.strictEqual(matchCase1.discrepancies.length, 0);

    // 2.2 Accented characters (diacritics) normalized
    const matchCase2 = compareIdentityPair(
      { firstName: "José", lastName: "Peña", middleName: "Niño" },
      { firstName: "Jose", lastName: "Pena", middleName: "Nino" },
      "SF10",
      "PSA"
    );
    assert.strictEqual(matchCase2.status, "MATCH", "Diacritics (é, ñ) must normalize and MATCH");

    // 2.3 Suffix normalization (JR, JR., Junior, III)
    const suffix1 = normalizeSuffix("JR.");
    const suffix2 = normalizeSuffix("JUNIOR");
    const suffix3 = normalizeSuffix("III");
    assert.strictEqual(suffix1, "JR");
    assert.strictEqual(suffix2, "JR");
    assert.strictEqual(suffix3, "III");

    const matchCase3 = compareIdentityPair(
      { firstName: "Juan", lastName: "Dela Cruz", suffix: "Jr." },
      { firstName: "Juan", lastName: "Dela Cruz", suffix: "JR" },
      "SF9",
      "SF10"
    );
    assert.strictEqual(matchCase3.status, "MATCH", "Normalized suffixes must MATCH");

    // 2.4 Material difference in surname -> MUST flag IDENTITY_REVIEW_REQUIRED
    const mismatch1 = compareIdentityPair(
      { firstName: "Juan", lastName: "Dela Cruz", middleName: "Santos" },
      { firstName: "Juan", lastName: "Reyes", middleName: "Santos" },
      "SF9",
      "PSA"
    );
    assert.strictEqual(mismatch1.status, "IDENTITY_REVIEW_REQUIRED", "Surname discrepancy must trigger IDENTITY_REVIEW_REQUIRED");
    assert.strictEqual(mismatch1.isMatch, false);
    assert.ok(mismatch1.discrepancies.some(d => d.includes("Last name mismatch")));

    // 2.5 Conflicting LRN -> MUST flag IDENTITY_REVIEW_REQUIRED
    const lrnMismatch = compareIdentityPair(
      { firstName: "Juan", lastName: "Dela Cruz", lrn: "123456789012" },
      { firstName: "Juan", lastName: "Dela Cruz", lrn: "987654321098" },
      "SF9",
      "SF10"
    );
    assert.strictEqual(lrnMismatch.status, "IDENTITY_REVIEW_REQUIRED", "Conflicting LRNs must trigger IDENTITY_REVIEW_REQUIRED");

    // 2.6 Full 3-document comparison
    const unifiedMatch = compareUnifiedStudentDocuments({
      sf9: { firstName: "Maria", lastName: "Santos", lrn: "109876543210" },
      sf10: { firstName: "Maria", lastName: "Santos", lrn: "109876543210" },
      psa: { firstName: "Maria", lastName: "Santos", birthDate: "2007-05-15" }
    });
    assert.strictEqual(unifiedMatch.overallStatus, "MATCH");
    assert.strictEqual(unifiedMatch.canLink, true);

    const unifiedDiscrepancy = compareUnifiedStudentDocuments({
      sf9: { firstName: "Maria", lastName: "Santos", lrn: "109876543210" },
      sf10: { firstName: "Maria", lastName: "Santos", lrn: "109876543210" },
      psa: { firstName: "Marianne", lastName: "Santos", birthDate: "2007-05-15" }
    });
    assert.strictEqual(unifiedDiscrepancy.overallStatus, "IDENTITY_REVIEW_REQUIRED");
    assert.strictEqual(unifiedDiscrepancy.canLink, false);
  });

  test("Requirement 3: Student with SF9 but missing SF10 displays Incomplete ('Missing SF10')", () => {
    const studentGrades = [
      { subject: "General Mathematics", final_grade: 86, status: "Passed" },
      { subject: "Oral Communication", final_grade: 89, status: "Passed" },
    ];

    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      subjects: studentGrades,
      documentCompleteness: {
        isComplete: false,
        hasSf9: true,
        hasSf10: false,
      },
    });

    // Incomplete document set
    assert.ok(result.blockingFactors.some(f => f.includes("Missing SF10")), "Must explicitly cite Missing SF10");
    assert.strictEqual(result.canPrincipalApprove, false, "Principal cannot approve student missing required documents");

    // Check UI component label rendering
    const viewPath = path.join(rootDir, "src/components/principal/PrincipalStudentsView.tsx");
    const viewContent = fs.readFileSync(viewPath, "utf-8");
    assert.ok(viewContent.includes("Missing SF10"), "Principal view must display 'Missing SF10' option");
  });

  test("Requirement 4: Student with both approved documents (SF9 + SF10) displays Complete (green)", () => {
    const studentGrades = [
      { subject: "General Mathematics", final_grade: 85, status: "Passed" },
      { subject: "Oral Communication", final_grade: 88, status: "Passed" },
      { subject: "Earth and Life Science", final_grade: 90, status: "Passed" },
    ];

    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      subjects: studentGrades,
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        identityStatus: "MATCH",
      },
    });

    assert.strictEqual(result.status, "Eligible", "Student with passing grades and complete docs must be Eligible");
    assert.strictEqual(result.canPrincipalApprove, true, "Principal can approve when all documents are complete and grades pass");
    assert.strictEqual(result.blockingFactors.length, 0, "No blocking factors for complete eligible student");

    // Check UI component green indicator
    const viewPath = path.join(rootDir, "src/components/principal/PrincipalStudentsView.tsx");
    const viewContent = fs.readFileSync(viewPath, "utf-8");
    assert.ok(viewContent.includes("Complete Set"), "Principal view must display 'Complete Set'");
    assert.ok(viewContent.includes("bg-emerald-50 text-emerald-700"), "Complete badge must use green styling");
  });

  test("Requirement 5: Student with failing grades (<75) is classified as Not Eligible (red)", () => {
    const failingGrades = [
      { subject: "General Mathematics", final_grade: 70, status: "Failed" }, // < 75
      { subject: "Oral Communication", final_grade: 85, status: "Passed" },
    ];

    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      subjects: failingGrades,
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
      },
    });

    assert.strictEqual(result.status, "Not Eligible", "Failing grade < 75 must result in Not Eligible status");
    assert.strictEqual(result.canPrincipalApprove, false, "Principal cannot approve academically failed student");
    assert.ok(result.reasons.some(r => r.includes("General Mathematics")), "Must identify failing subject");

    // Check UI component red indicator
    const viewPath = path.join(rootDir, "src/components/principal/PrincipalStudentsView.tsx");
    const viewContent = fs.readFileSync(viewPath, "utf-8");
    assert.ok(viewContent.includes("bg-red-50 text-red-700"), "Not Eligible badge must use red styling");
  });

  test("Requirement 6: Invariant — Missing documents do NOT cause academic failure (status is Needs Review, never Not Eligible)", () => {
    // Passing grades in all subjects, but missing documents
    const passingGrades = [
      { subject: "General Mathematics", final_grade: 88, status: "Passed" },
      { subject: "Physical Science", final_grade: 91, status: "Passed" },
    ];

    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      subjects: passingGrades,
      documentCompleteness: {
        isComplete: false,
        hasSf9: true,
        hasSf10: false,
      },
    });

    // Invariant assertion: MUST be "Needs Review", NOT "Not Eligible"
    assert.strictEqual(result.status, "Needs Review", "Missing documents must set status to 'Needs Review'");
    assert.notStrictEqual(result.status, "Not Eligible", "Missing documents must NEVER cause academic failure ('Not Eligible')");
    assert.strictEqual(result.canPrincipalApprove, false, "Principal approval must be held until documents are submitted");
    assert.ok(
      result.reasons.some(r => r.includes("Passing marks in all recorded subjects")),
      "Academic performance must be acknowledged even when documents are missing"
    );
  });

  test("Requirement 7: Principal can approve verified eligible students with complete records", async () => {
    const actionPath = path.join(rootDir, "src/actions/principal.ts");
    const content = fs.readFileSync(actionPath, "utf-8");

    // Action function exists
    assert.ok(content.includes("async function approveStudentEligibility"), "approveStudentEligibility must be defined");

    // Allows decision: "Approved"
    assert.ok(content.includes('decision: "Approved" | "Not Approved"'), "Must accept Approved decision");

    // Saves to eligibility_approvals table
    assert.ok(content.includes('"eligibility_approvals"'), "Must store approval in eligibility_approvals");
    assert.ok(content.includes('"eligibility_audit_logs"'), "Must write immutable audit log in eligibility_audit_logs");
  });

  test("Requirement 8: Principal cannot approve unverified or incomplete records (server-side check)", async () => {
    const actionPath = path.join(rootDir, "src/actions/principal.ts");
    const content = fs.readFileSync(actionPath, "utf-8");

    // Server-side check blocking approval when evaluation.canPrincipalApprove is false
    assert.ok(
      content.includes('if (decision === "Approved" && !evaluation.canPrincipalApprove)'),
      "Server action must strictly reject approval if evaluation.canPrincipalApprove is false"
    );
    assert.ok(
      content.includes("Cannot approve eligibility:"),
      "Must return descriptive error explaining blocking factors"
    );
  });

  test("Requirement 9: Principal role cannot upload documents or edit grades (server-side enforcement)", () => {
    // Upload API check
    const uploadRoutePath = path.join(rootDir, "src/app/api/upload/route.ts");
    const uploadContent = fs.readFileSync(uploadRoutePath, "utf-8");
    assert.ok(
      uploadContent.includes('roleRow?.role?.toLowerCase() === "principal"') &&
      uploadContent.includes("403"),
      "Upload route must block Principal from uploading documents"
    );

    // Validation API check
    const validationRoutePath = path.join(rootDir, "src/app/api/validation/route.ts");
    const validationContent = fs.readFileSync(validationRoutePath, "utf-8");
    assert.ok(
      validationContent.includes('roleRow?.role?.toLowerCase() === "principal"') &&
      validationContent.includes("403"),
      "Validation route must block Principal from triggering OCR"
    );

    // Review action check
    const reviewActionPath = path.join(rootDir, "src/actions/review.ts");
    const reviewContent = fs.readFileSync(reviewActionPath, "utf-8");
    assert.ok(
      reviewContent.includes('role === "principal"') &&
      reviewContent.includes("monitoring-only"),
      "submitDocumentReview must block Principal from editing or approving OCR review queue directly"
    );
  });

  test("Requirement 10: Original document image is preserved and viewable via signed URL", () => {
    const migrationPath = path.join(rootDir, "supabase/migrations/012_student_document_completeness_and_eligibility.sql");
    assert.ok(fs.existsSync(migrationPath), "Migration 012 must exist");
    const migrationContent = fs.readFileSync(migrationPath, "utf-8");

    // storage_path column
    assert.ok(
      migrationContent.includes("ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_path text;"),
      "Migration 012 must add storage_path to documents table"
    );

    // Signed URL generation in principal.ts
    const actionPath = path.join(rootDir, "src/actions/principal.ts");
    const actionContent = fs.readFileSync(actionPath, "utf-8");
    assert.ok(
      actionContent.includes('supabase.storage.from("documents").createSignedUrl(path, 3600)'),
      "Must generate fresh 1-hour secure signed URL from private storage"
    );

    // Principal UI has link to view original file
    const viewPath = path.join(rootDir, "src/components/principal/PrincipalStudentsView.tsx");
    const viewContent = fs.readFileSync(viewPath, "utf-8");
    assert.ok(viewContent.includes("View Original File"), "UI must have button to view complete original file");
  });

  test("Requirement 11: Digital academic record accurately reflects verified records with disclaimer", () => {
    const modalPath = path.join(rootDir, "src/components/principal/DigitalAcademicRecordModal.tsx");
    assert.ok(fs.existsSync(modalPath), "DigitalAcademicRecordModal.tsx must exist");
    const modalContent = fs.readFileSync(modalPath, "utf-8");

    // Institution and School ID
    assert.ok(modalContent.includes("500169"), "Digital record must include DepEd School ID 500169");
    assert.ok(modalContent.includes("TAYSAN RESETTLEMENT INTEGRATED SCHOOL"), "Digital record must display TRIS header");

    // Mandatory legal/administrative disclaimer
    assert.ok(
      modalContent.includes("does not replace the official physical Form 137 / SF10 or Form 138 / SF9"),
      "Must display explicit non-replacement disclaimer for DepEd physical forms"
    );

    // Grade integrity & print layout
    assert.ok(modalContent.includes("window.print()"), "Must support printing the digital record");
    assert.ok(modalContent.includes("Zero Fabricated Grades"), "Must state zero fabricated grades policy");
  });
});

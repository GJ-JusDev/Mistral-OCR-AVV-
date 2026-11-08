import test from "node:test";
import assert from "node:assert/strict";
import { validateFields } from "../src/lib/validation/engine.ts";
import {
  getAuthoritativeSemesterFinalGrade,
  recalculateSubjectGradeStatus,
  normalizeGradeRecords,
} from "../src/lib/validation/gradeUtils.ts";
import { compareDocuments } from "../src/lib/validation/documentComparator.ts";

// ─────────────────────────────────────────────────────────────────────────────
// BASE FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const TRIS_SCHOOL_UUID = "a0000000-0000-0000-0000-000000000001";
const TRIS_DEPED_ID = "300792";
const TRIS_SCHOOL_NAME = "Taysan Resettlement Integrated School";

const BASE_STUDENT_IDENTITY = {
  name: "DELA CRUZ, JUAN SANTOS",
  first_name: "JUAN",
  last_name: "DELA CRUZ",
  middle_name: "SANTOS",
  lrn: "111687140043",
  grade_level: "11",
  school_year: "2023-2024",
  birth_date: "2005-01-15",
  adviser: "RICHARD R. RAQUEÑO",
  document_type: "sf9",
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. SCHOOL IDENTIFICATION REGRESSION TESTS
// ─────────────────────────────────────────────────────────────────────────────

test("School ID 1: Older SHS SF9 without printed School ID passes when institutional config is verified", () => {
  const fields = {
    ...BASE_STUDENT_IDENTITY,
    school_name: TRIS_SCHOOL_NAME,
    school_id: TRIS_DEPED_ID,
    school_id_source: "school_configuration",
    trusted_school_verified: true,
    school_uuid: TRIS_SCHOOL_UUID,
  };

  const report = validateFields(fields, { ocrConfidence: 0.95 });

  const presentRule = report.results.find((r) => r.ruleName === "school_id_present");
  const formatRule = report.results.find((r) => r.ruleName === "school_id_format");
  const institutionRule = report.results.find((r) => r.ruleName === "school_id_match_institution");

  assert.ok(presentRule, "school_id_present must execute");
  assert.equal(presentRule.passed, true, "school_id_present must pass for verified institutional config");

  assert.ok(formatRule, "school_id_format must execute");
  assert.equal(formatRule.passed, true, "300792 is a valid 6-digit DepEd School ID");

  assert.ok(institutionRule, "school_id_match_institution must execute");
  assert.equal(institutionRule.passed, true, "Institutional match must pass for TRIS");

  assert.equal(report.status, "valid", "Document must be valid (not needs_review or invalid)");
});

test("School ID 2: Missing School ID without trusted institutional resolution remains a warning/error", () => {
  const fields = {
    ...BASE_STUDENT_IDENTITY,
    school_name: TRIS_SCHOOL_NAME,
    school_id: "",
  };

  const report = validateFields(fields, { ocrConfidence: 0.95 });
  const presentRule = report.results.find((r) => r.ruleName === "school_id_present");

  assert.ok(presentRule);
  assert.equal(presentRule.passed, false, "Must fail when school_id is unextracted and unverified");
  assert.equal(report.status, "needs_review", "Must trigger human review");
});

test("School ID 3: Explicitly conflicting OCR School ID fails institutional match rule", () => {
  const fields = {
    ...BASE_STUDENT_IDENTITY,
    school_id: TRIS_DEPED_ID,
    ocr_extracted_school_id: "999999", // Contradictory school on document
    school_id_source: "school_configuration",
    trusted_school_verified: true,
  };

  const report = validateFields(fields, { ocrConfidence: 0.95 });
  const institutionRule = report.results.find((r) => r.ruleName === "school_id_match_institution");

  assert.ok(institutionRule);
  assert.equal(institutionRule.passed, false, "Conflicting document school ID must fail");
  assert.equal(institutionRule.severity, "error", "Discrepancy must be an error");
  assert.equal(report.status, "invalid", "Document with conflicting school identity must be rejected");
});

test("School ID 4: DepEd 6-digit ID (300792) is kept separate from DB internal UUID (a0000000-...)", () => {
  assert.match(TRIS_DEPED_ID, /^\d{6}$/, "DepEd School ID must be a 6-digit string");
  assert.match(
    TRIS_SCHOOL_UUID,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Database primary key must be a valid UUID"
  );
  assert.notEqual(TRIS_DEPED_ID, TRIS_SCHOOL_UUID, "DepEd text code must never be confused with database UUID");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GRADE EXTRACTION AND NORMALIZATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

test("Grade Norm 1: First-semester final grade present populates sem1_final_grade and final", () => {
  const rawRecord = {
    subject: "Oral Communication in Context",
    semester: "1st Semester",
    q1: 88,
    q2: 90,
    sem1_final_grade: 89,
    status: "Missing", // Stale initial tag
  };

  const normalized = recalculateSubjectGradeStatus(rawRecord);

  assert.equal(normalized.sem1_final_grade, 89);
  assert.equal(normalized.final, 89);
  assert.equal(normalized.status, "Passed");
  assert.equal(normalized.needsVerification, false);
});

test("Grade Norm 2: Second-semester final grade present populates sem2_final_grade and final", () => {
  const rawRecord = {
    subject: "Reading and Writing Skills",
    semester: "2nd Semester",
    q3: 84,
    q4: 86,
    sem2_final_grade: 85,
    status: "Missing",
  };

  const normalized = recalculateSubjectGradeStatus(rawRecord);

  assert.equal(normalized.sem2_final_grade, 85);
  assert.equal(normalized.final, 85);
  assert.equal(normalized.status, "Passed");
  assert.equal(normalized.needsVerification, false);
});

test("Grade Norm 3: Source final grade genuinely blank remains Missing and does not fabricate grades", () => {
  const blankDocRecord = {
    subject: "General Mathematics",
    semester: "1st Semester",
    q1: 80,
    q2: 82,
    sem1_final_grade: undefined,
    final: undefined,
    status: "Missing",
  };

  const normalized = recalculateSubjectGradeStatus(blankDocRecord);

  assert.equal(normalized.sem1_final_grade, undefined, "Must NOT auto-calculate 81 average");
  assert.equal(normalized.final, undefined, "Must NOT invent final grade");
  assert.equal(normalized.status, "Missing");
  assert.equal(normalized.needsVerification, true);
});

test("Grade Norm 4: Decimal final grade (74.5) is preserved exactly without rounding", () => {
  const decimalRecord = {
    subject: "Pre-Calculus",
    semester: "1st Semester",
    q1: 74,
    q2: 75,
    sem1_final_grade: 74.5,
    status: "Missing",
  };

  const normalized = recalculateSubjectGradeStatus(decimalRecord);

  assert.equal(normalized.sem1_final_grade, 74.5);
  assert.equal(normalized.final, 74.5);
  assert.equal(normalized.status, "Failed", "74.5 is strictly below DepEd passing threshold of 75");
  assert.equal(normalized.needsVerification, true, "74.5 is borderline [72, 77]");
});

test("Grade Norm 5: Missing quarterly mark preserves final grade and computes correct status", () => {
  const missingQ1Record = {
    subject: "Earth Science",
    semester: "1st Semester",
    q1: undefined, // Teacher omitted Q1 on card
    q2: 85,
    sem1_final_grade: 85,
    status: "Missing",
  };

  const normalized = recalculateSubjectGradeStatus(missingQ1Record);

  assert.equal(normalized.q1, undefined);
  assert.equal(normalized.q2, 85);
  assert.equal(normalized.final, 85);
  assert.equal(normalized.status, "Passed");
});

test("Grade Norm 6: No cross-semester grade contamination", () => {
  const sem1 = {
    subject: "Physical Education 1",
    semester: "1st Semester",
    sem1_final_grade: 92,
  };

  const sem2 = {
    subject: "Physical Education 2",
    semester: "2nd Semester",
    sem2_final_grade: 95,
  };

  assert.equal(getAuthoritativeSemesterFinalGrade(sem1), 92);
  assert.equal(getAuthoritativeSemesterFinalGrade(sem2), 95);

  const norm1 = recalculateSubjectGradeStatus(sem1);
  const norm2 = recalculateSubjectGradeStatus(sem2);

  assert.equal(norm1.sem1_final_grade, 92);
  assert.equal(norm1.sem2_final_grade, undefined, "1st semester must NEVER contaminate 2nd semester field");

  assert.equal(norm2.sem2_final_grade, 95);
  assert.equal(norm2.sem1_final_grade, undefined, "2nd semester must NEVER contaminate 1st semester field");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. REVIEW QUEUE GRADE STATUS RECALCULATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

test("Review Queue 1: Entering 85 immediately flips status from Missing to Passed", () => {
  const staged = {
    subject: "Empowerment Technologies",
    semester: "1st Semester",
    q1: 84,
    q2: 86,
    sem1_final_grade: undefined,
    status: "Missing",
    needsVerification: true,
  };

  // User enters '85' in the Review Queue input field
  const edited = { ...staged, sem1_final_grade: 85 };
  const updated = recalculateSubjectGradeStatus(edited);

  assert.equal(updated.status, "Passed");
  assert.equal(updated.final, 85);
  assert.equal(updated.needsVerification, false);
});

test("Review Queue 2: Entering 74 flips status from Missing to Failed with borderline warning", () => {
  const staged = {
    subject: "General Chemistry 1",
    semester: "1st Semester",
    q1: 72,
    q2: 76,
    sem1_final_grade: undefined,
    status: "Missing",
    needsVerification: true,
  };

  const edited = { ...staged, sem1_final_grade: 74 };
  const updated = recalculateSubjectGradeStatus(edited);

  assert.equal(updated.status, "Failed");
  assert.equal(updated.final, 74);
  assert.equal(updated.needsVerification, true, "74 is in borderline range [72, 77]");
});

test("Review Queue 3: Entering 75 flips status to Passed with borderline warning", () => {
  const staged = {
    subject: "General Chemistry 1",
    semester: "1st Semester",
    sem1_final_grade: undefined,
    status: "Missing",
  };

  const edited = { ...staged, sem1_final_grade: 75 };
  const updated = recalculateSubjectGradeStatus(edited);

  assert.equal(updated.status, "Passed");
  assert.equal(updated.final, 75);
  assert.equal(updated.needsVerification, true, "75 is exactly on DepEd passing boundary [72, 77]");
});

test("Review Queue 4: Clearing a final grade resets status back to Missing", () => {
  const staged = {
    subject: "Oral Communication",
    semester: "1st Semester",
    sem1_final_grade: 88,
    final: 88,
    status: "Passed",
    needsVerification: false,
  };

  // User clears the input box
  const edited = { ...staged, sem1_final_grade: undefined, final: undefined };
  const updated = recalculateSubjectGradeStatus(edited);

  assert.equal(updated.status, "Missing");
  assert.equal(updated.needsVerification, true);
});

test("Review Queue 5: Server-side normalizeGradeRecords prevents contradictory status persistence", () => {
  const malformedBatch = [
    {
      subject: "Subj A",
      semester: "1st Semester",
      sem1_final_grade: 90,
      final: undefined,
      status: "Missing", // Stale client status
    },
    {
      subject: "Subj B",
      semester: "1st Semester",
      sem1_final_grade: 70,
      final: 70,
      status: "Passed", // Contradictory client status
    },
    {
      subject: "Subj C",
      semester: "1st Semester",
      sem1_final_grade: "",
      final: "",
      status: "Passed", // Fabricated status without grade
    },
  ];

  const cleaned = normalizeGradeRecords(malformedBatch);

  assert.equal(cleaned[0].status, "Passed", "Subj A (90) must be normalized to Passed");
  assert.equal(cleaned[0].final, 90, "Subj A final must mirror sem1_final_grade");

  assert.equal(cleaned[1].status, "Failed", "Subj B (70) must be normalized to Failed");
  assert.equal(cleaned[1].final, 70);

  assert.equal(cleaned[2].status, "Missing", "Subj C (empty) must be normalized to Missing");
  assert.equal(cleaned[2].final, undefined);
  assert.equal(cleaned[2].needsVerification, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DOCUMENT COMPARISON REGRESSION TESTS
// ─────────────────────────────────────────────────────────────────────────────

test("Doc Compare 1: SF9 and SF10 first-semester comparison matches correctly", () => {
  const doc1 = {
    ...BASE_STUDENT_IDENTITY,
    grades: [
      {
        subject: "Oral Communication in Context",
        semester: "1st Semester",
        sem1_final_grade: 88,
        final: 88,
        status: "Passed",
      },
    ],
  };

  const doc2 = {
    ...BASE_STUDENT_IDENTITY,
    document_type: "sf10",
    grades: [
      {
        subject: "Oral Communication in Context",
        semester: "1st Semester",
        sem1_final_grade: 88,
        final: 88,
        status: "Passed",
      },
    ],
  };

  const comp = compareDocuments(doc1, doc2);

  assert.equal(comp.isSameLearner, true);
  assert.equal(comp.academicResults.length, 1);
  assert.equal(comp.academicResults[0].status, "MATCH");
  assert.equal(comp.academicResults[0].doc1Grade, 88);
  assert.equal(comp.academicResults[0].doc2Grade, 88);
});

test("Doc Compare 2: SF9 and SF10 second-semester comparison matches correctly", () => {
  const doc1 = {
    ...BASE_STUDENT_IDENTITY,
    grades: [
      {
        subject: "Reading and Writing Skills",
        semester: "2nd Semester",
        sem2_final_grade: 91,
        final: 91,
        status: "Passed",
      },
    ],
  };

  const doc2 = {
    ...BASE_STUDENT_IDENTITY,
    document_type: "sf10",
    grades: [
      {
        subject: "Reading and Writing Skills",
        semester: "2nd Semester",
        sem2_final_grade: 91,
        final: 91,
        status: "Passed",
      },
    ],
  };

  const comp = compareDocuments(doc1, doc2);

  assert.equal(comp.academicResults.length, 1);
  assert.equal(comp.academicResults[0].status, "MATCH");
  assert.equal(comp.academicResults[0].doc1Grade, 91);
  assert.equal(comp.academicResults[0].doc2Grade, 91);
});

test("Doc Compare 3: SF9 has final grade, SF10 is missing -> NEEDS_VERIFICATION (no fabricated grade)", () => {
  const doc1 = {
    ...BASE_STUDENT_IDENTITY,
    grades: [
      {
        subject: "General Mathematics",
        semester: "1st Semester",
        sem1_final_grade: 85,
        final: 85,
        status: "Passed",
      },
    ],
  };

  const doc2 = {
    ...BASE_STUDENT_IDENTITY,
    document_type: "sf10",
    grades: [
      {
        subject: "General Mathematics",
        semester: "1st Semester",
        sem1_final_grade: undefined,
        final: undefined,
        status: "Missing",
      },
    ],
  };

  const comp = compareDocuments(doc1, doc2);

  assert.equal(comp.academicResults.length, 1);
  assert.equal(comp.academicResults[0].status, "NEEDS_VERIFICATION");
  assert.equal(comp.academicResults[0].doc1Grade, 85);
  assert.equal(comp.academicResults[0].doc2Grade, "-");
  assert.match(comp.academicResults[0].details || "", /Grade missing on SF10/);
});

test("Doc Compare 4: Grade discrepancy reports MISMATCH with exact values", () => {
  const doc1 = {
    ...BASE_STUDENT_IDENTITY,
    grades: [
      {
        subject: "Physical Science",
        semester: "1st Semester",
        sem1_final_grade: 85,
        final: 85,
        status: "Passed",
      },
    ],
  };

  const doc2 = {
    ...BASE_STUDENT_IDENTITY,
    document_type: "sf10",
    grades: [
      {
        subject: "Physical Science",
        semester: "1st Semester",
        sem1_final_grade: 82,
        final: 82,
        status: "Passed",
      },
    ],
  };

  const comp = compareDocuments(doc1, doc2);

  assert.equal(comp.academicResults.length, 1);
  assert.equal(comp.academicResults[0].status, "MISMATCH");
  assert.match(comp.academicResults[0].details || "", /SF9 has 85, but SF10 has 82/);
});

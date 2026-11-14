import test from "node:test";
import assert from "node:assert/strict";

import {
  computeRawSemesterFinalGrade,
  computeOfficialSemesterFinalGrade,
  computeSemesterFinalGrade,
  recalculateSubjectGradeStatus,
  normalizeGradeRecords,
  computeSemesterGeneralAverage,
  updateExtractedFieldsAverages,
  normalizeSemesterContext,
  parseQuarterNumeric,
  isBlankOrMissingFinal,
} from "../src/lib/validation/gradeUtils.ts";

test("URGENT BUG FIX REGRESSION: Second Semester Review Queue Auto Grade Computation", async (t) => {
  // Typical SHS 2nd Semester 9 subjects payload as extracted from SF9 Review Queue
  const createMockReviewQueueRecord = () => ({
    id: "doc-shs-sem2-review-001",
    document_type: "sf9",
    grade_level: "Grade 11",
    semester: "2nd Semester",
    school_year: "2024-2025",
    validation_status: "needs_review",
    extracted_fields: {
      student_name: "Juan Dela Cruz",
      lrn: "123456789012",
      semester: "2nd Semester",
      school_year: "2024-2025",
      general_average: undefined,
      sem2_general_average: undefined,
      grades: [
        { subject: "Reading and Writing Skills", semester: "2nd Semester", q1: null, q2: null, q3: "88", q4: "90", final: "Missing", sem2_final_grade: null, status: "Missing" },
        { subject: "Statistics and Probability", semester: "2nd Semester", q1: null, q2: null, q3: "85", q4: "87", final: "Missing", sem2_final_grade: null, status: "Missing" },
        { subject: "Physical Science", semester: "2nd Semester", q1: null, q2: null, q3: "89", q4: "91", final: "Missing", sem2_final_grade: null, status: "Missing" },
        { subject: "Disaster Readiness and Risk Reduction", semester: "2nd Semester", q1: null, q2: null, q3: "84", q4: "86", final: "Missing", sem2_final_grade: null, status: "Missing" },
        { subject: "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik", semester: "2nd Semester", q1: null, q2: null, q3: "90", q4: "92", final: "Missing", sem2_final_grade: null, status: "Missing" },
        { subject: "Practical Research 1", semester: "2nd Semester", q1: null, q2: null, q3: "86", q4: "88", final: "Missing", sem2_final_grade: null, status: "Missing" },
        { subject: "Empowerment Technologies", semester: "2nd Semester", q1: null, q2: null, q3: "87", q4: "89", final: "Missing", sem2_final_grade: null, status: "Missing" },
        { subject: "Physical Education and Health 2", semester: "2nd Semester", q1: null, q2: null, q3: "92", q4: "94", final: "Missing", sem2_final_grade: null, status: "Missing" },
        { subject: "English for Academic and Professional Purposes", semester: "2nd Semester", q1: null, q2: null, q3: "85", q4: "85", final: "Missing", sem2_final_grade: null, status: "Missing" },
      ],
    },
  });

  await t.test("1. All 9 subjects with valid Q3 and Q4 automatically compute Raw Calc and Semester Final Grade", () => {
    const rawRecord = createMockReviewQueueRecord();
    const normalizedGrades = normalizeGradeRecords(rawRecord.extracted_fields.grades, rawRecord.extracted_fields.semester);

    assert.strictEqual(normalizedGrades.length, 9, "Must retain all 9 subjects");

    const expectedCalculations = [
      { subject: "Reading and Writing Skills", raw: 89, official: 89 },
      { subject: "Statistics and Probability", raw: 86, official: 86 },
      { subject: "Physical Science", raw: 90, official: 90 },
      { subject: "Disaster Readiness and Risk Reduction", raw: 85, official: 85 },
      { subject: "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik", raw: 91, official: 91 },
      { subject: "Practical Research 1", raw: 87, official: 87 },
      { subject: "Empowerment Technologies", raw: 88, official: 88 },
      { subject: "Physical Education and Health 2", raw: 93, official: 93 },
      { subject: "English for Academic and Professional Purposes", raw: 85, official: 85 },
    ];

    for (let i = 0; i < expectedCalculations.length; i++) {
      const exp = expectedCalculations[i];
      const actual = normalizedGrades[i];

      assert.strictEqual(actual.subject, exp.subject);
      assert.strictEqual(actual.raw_calculated_final, exp.raw, `Raw calculation for ${exp.subject} must be ${exp.raw}`);
      assert.strictEqual(actual.final, exp.official, `Candidate final grade for ${exp.subject} must be ${exp.official}`);
      assert.strictEqual(actual.sem2_final_grade, exp.official, `sem2_final_grade for ${exp.subject} must be ${exp.official}`);
      assert.strictEqual(actual.status, "Passed", `Status must be Passed, not Missing`);
      assert.strictEqual(actual.is_auto_computed, true, "is_auto_computed must be true");
      assert.strictEqual(actual.needsVerification, true, "needsVerification must be preserved for review workflow");
    }
  });

  await t.test("2. Second Semester General Average updates from Incomplete (0 of 9) to Complete with official and raw average", () => {
    const rawRecord = createMockReviewQueueRecord();
    const normalizedGrades = normalizeGradeRecords(rawRecord.extracted_fields.grades, rawRecord.extracted_fields.semester);

    const sem2Avg = computeSemesterGeneralAverage(normalizedGrades, "2nd Semester");
    assert.strictEqual(sem2Avg.completeness, "COMPLETE", "Second semester completeness must be COMPLETE");
    assert.strictEqual(sem2Avg.subjectCount, 9, "9 subjects evaluated");
    assert.strictEqual(sem2Avg.pendingSubjects.length, 0, "No pending subjects when all quarters present");

    // Sum of official grades = 89 + 86 + 90 + 85 + 91 + 87 + 88 + 93 + 85 = 794
    // 794 / 9 = 88.2222... -> 88.22
    assert.strictEqual(sem2Avg.officialAverage, 88.22, "Official average must be 88.22");
    assert.strictEqual(sem2Avg.rawAverage, 88.22, "Raw average must be 88.22");

    // Full document fields update
    const updatedFields = updateExtractedFieldsAverages({
      ...rawRecord.extracted_fields,
      grades: normalizedGrades,
    });

    assert.strictEqual(updatedFields.sem2_general_average, 88.22, "sem2_general_average must be populated");
    assert.strictEqual(updatedFields.sem2_raw_general_average, 88.22, "sem2_raw_general_average must be populated");
    assert.strictEqual(updatedFields.sem2_completeness, "COMPLETE", "sem2_completeness must be COMPLETE");
    assert.strictEqual(updatedFields.general_average, 88.22, "general_average must be set to 2nd semester average for sem2 document");
  });

  await t.test("3. String quarterly grades with whitespace and decimal formats parse safely", () => {
    const stringRecord = {
      subject: "General Mathematics",
      semester: "2nd Semester",
      q3: " 87.0 ",
      q4: "89",
      final: "",
      status: "Missing",
    };

    const res = recalculateSubjectGradeStatus(stringRecord);
    assert.strictEqual(res.raw_calculated_final, 88);
    assert.strictEqual(res.final, 88);
    assert.strictEqual(res.sem2_final_grade, 88);
    assert.strictEqual(res.status, "Passed");
    assert.strictEqual(res.is_auto_computed, true);
  });

  await t.test("4. Half-up rounding policy (DepEd DO 8, s. 2015) is strictly respected", () => {
    // 87 and 88 -> 87.5 -> rounded to 88
    const r1 = recalculateSubjectGradeStatus({
      subject: "Test Subject",
      semester: "2nd Semester",
      q3: 87,
      q4: 88,
      final: "-",
    });
    assert.strictEqual(r1.raw_calculated_final, 87.5);
    assert.strictEqual(r1.final, 88);
    assert.strictEqual(r1.status, "Passed");

    // 74 and 74 -> 74.0 -> Failed
    const r2 = recalculateSubjectGradeStatus({
      subject: "Test Subject 2",
      semester: "2nd Semester",
      q3: 74,
      q4: 74,
      final: "",
    });
    assert.strictEqual(r2.raw_calculated_final, 74);
    assert.strictEqual(r2.final, 74);
    assert.strictEqual(r2.status, "Failed");
    assert.strictEqual(r2.failed_final_grade, 74);

    // 74 and 75 -> 74.5 -> rounded to 75 -> Passed
    const r3 = recalculateSubjectGradeStatus({
      subject: "Test Subject 3",
      semester: "2nd Semester",
      q3: 74,
      q4: 75,
      final: "",
    });
    assert.strictEqual(r3.raw_calculated_final, 74.5);
    assert.strictEqual(r3.final, 75);
    assert.strictEqual(r3.status, "Passed");
  });

  await t.test("5. Missing Quarter Safety: Does NOT fabricate grade if a quarter is genuinely missing", () => {
    const incompleteRecord = {
      subject: "Statistics and Probability",
      semester: "2nd Semester",
      q3: 88,
      q4: null, // Q4 is genuinely missing
      final: "Missing",
      status: "Missing",
    };

    const res = recalculateSubjectGradeStatus(incompleteRecord);
    assert.strictEqual(res.final, undefined, "Must not fabricate final grade");
    assert.strictEqual(res.sem2_final_grade, undefined, "sem2_final_grade must be undefined");
    assert.strictEqual(res.raw_calculated_final, undefined, "raw_calculated_final must be undefined");
    assert.strictEqual(res.status, "Missing", "Status must remain Missing");
    assert.strictEqual(res.needsVerification, true, "needsVerification must be true");
    assert.strictEqual(res.is_auto_computed, false, "is_auto_computed must be false");

    // In a 9-subject list, 1 missing quarter keeps the general average INCOMPLETE
    const gradesWithOneMissing = [
      ...createMockReviewQueueRecord().extracted_fields.grades.slice(0, 8),
      incompleteRecord,
    ];
    const normalized = normalizeGradeRecords(gradesWithOneMissing, "2nd Semester");
    const avg = computeSemesterGeneralAverage(normalized, "2nd Semester");

    assert.strictEqual(avg.completeness, "INCOMPLETE");
    assert.strictEqual(avg.officialAverage, undefined, "General average must not be computed when incomplete");
    assert.deepStrictEqual(avg.pendingSubjects, ["Statistics and Probability"]);
  });

  await t.test("6. Physical Discrepancy Preservation: Does NOT silently overwrite printed final mark", () => {
    const discrepancyRecord = {
      subject: "Disaster Readiness and Risk Reduction",
      semester: "2nd Semester",
      q3: 80,
      q4: 82, // Average = 81
      final: 85, // Printed mark on document is 85
    };

    const res = recalculateSubjectGradeStatus(discrepancyRecord);
    assert.strictEqual(res.final, 85, "Printed final grade 85 must be preserved");
    assert.strictEqual(res.computed_final_grade, 81, "Computed quarter average is 81");
    assert.strictEqual(res.raw_calculated_final, 81);
    assert.strictEqual(res.has_calculation_discrepancy, true, "Must flag calculation discrepancy");
    assert.strictEqual(res.needsVerification, true, "Must flag for teacher verification");
    assert.strictEqual(res.is_auto_computed, false, "Must not be flagged as auto-computed because printed mark was present");
  });

  await t.test("7. Preserves human verification requirement: Never marks document as approved", () => {
    const rawRecord = createMockReviewQueueRecord();
    const normalizedGrades = normalizeGradeRecords(rawRecord.extracted_fields.grades, rawRecord.extracted_fields.semester);

    // Auto-computation only updates candidate values, keeping validation_status as needs_review
    for (const g of normalizedGrades) {
      assert.strictEqual(g.needsVerification, true, "Every auto-computed grade must require teacher verification");
      assert.strictEqual(g.is_auto_computed, true);
    }

    assert.strictEqual(rawRecord.validation_status, "needs_review", "Document must remain in review queue");
  });
});

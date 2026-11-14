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
  getAuthoritativeSemesterFinalGrade,
} from "../src/lib/validation/gradeUtils.ts";

test("TC-GRADE-01: Auto-computation of blank Semester 1 final grade with valid Q1 & Q2", async (t) => {
  const testCases = [
    { q1: 88, q2: 88, expectedRaw: 88, expectedOfficial: 88, expectedStatus: "Passed" },
    { q1: 75, q2: 74, expectedRaw: 74.5, expectedOfficial: 75, expectedStatus: "Passed" },
    { q1: 76, q2: 94, expectedRaw: 85, expectedOfficial: 85, expectedStatus: "Passed" },
    { q1: 91, q2: 92, expectedRaw: 91.5, expectedOfficial: 92, expectedStatus: "Passed" },
    { q1: 96, q2: 79, expectedRaw: 87.5, expectedOfficial: 88, expectedStatus: "Passed" },
    { q1: 72, q2: 74, expectedRaw: 73, expectedOfficial: 73, expectedStatus: "Failed" },
  ];

  for (const tc of testCases) {
    await t.test(`Computes Q1=${tc.q1}, Q2=${tc.q2} -> Raw ${tc.expectedRaw}, Official ${tc.expectedOfficial}`, () => {
      // 1. Standalone function checks
      const raw = computeRawSemesterFinalGrade(tc.q1, tc.q2);
      const official = computeOfficialSemesterFinalGrade(tc.q1, tc.q2);
      assert.strictEqual(raw, tc.expectedRaw, `Raw calculation must equal ${tc.expectedRaw}`);
      assert.strictEqual(official, tc.expectedOfficial, `Official rounded grade must equal ${tc.expectedOfficial}`);

      // 2. Normalization and candidate record population
      const record = {
        subject: "Oral Communication in Context",
        semester: "1st Semester",
        q1: tc.q1,
        q2: tc.q2,
        sem1_final_grade: undefined,
        final: undefined,
        status: "Missing",
      };

      const result = recalculateSubjectGradeStatus(record);
      assert.strictEqual(result.final, tc.expectedOfficial, "Candidate final must be auto-populated");
      assert.strictEqual(result.sem1_final_grade, tc.expectedOfficial, "sem1_final_grade must be auto-populated");
      assert.strictEqual(result.raw_calculated_final, tc.expectedRaw, "Exact raw arithmetic average must be preserved");
      assert.strictEqual(result.official_computed_final, tc.expectedOfficial, "Official rounded candidate must be recorded");
      assert.strictEqual(result.is_auto_computed, true, "Must have is_auto_computed flag true");
      assert.strictEqual(result.grade_source, "auto_computed", "Grade source must be auto_computed");
      assert.strictEqual(result.status, tc.expectedStatus, `Status must be ${tc.expectedStatus}`);
      assert.strictEqual(result.needsVerification, true, "Candidate grade requires human review before approval");
      assert.strictEqual(result.has_calculation_discrepancy, false, "Auto-computed grade has no discrepancy");
    });
  }
});

test("TC-GRADE-02: Auto-computation of blank Semester 2 final grade with valid Q3 & Q4", async (t) => {
  await t.test("Valid Q3 and Q4 populates sem2_final_grade, preserves Q1 and Q2 as undefined", () => {
    const record = {
      subject: "Reading and Writing Skills",
      semester: "2nd Semester",
      q3: 91,
      q4: 92,
      sem2_final_grade: undefined,
      final: undefined,
      status: "Missing",
    };

    const result = recalculateSubjectGradeStatus(record);
    assert.strictEqual(result.final, 92, "Auto-computed official final is 92 (half-up from 91.5)");
    assert.strictEqual(result.sem2_final_grade, 92, "sem2_final_grade is 92");
    assert.strictEqual(result.raw_calculated_final, 91.5, "Raw arithmetic average is 91.5");
    assert.strictEqual(result.official_computed_final, 92);
    assert.strictEqual(result.is_auto_computed, true);
    assert.strictEqual(result.grade_source, "auto_computed");
    assert.strictEqual(result.status, "Passed");
    assert.strictEqual(result.q1, undefined, "Q1 must remain undefined in Semester 2");
    assert.strictEqual(result.q2, undefined, "Q2 must remain undefined in Semester 2");
  });

  await t.test("Failing Semester 2 grade (< 75) records failed_final_grade", () => {
    const record = {
      subject: "Statistics and Probability",
      semester: "2nd Semester",
      q3: 72,
      q4: 74,
      sem2_final_grade: undefined,
      final: undefined,
      status: "Missing",
    };

    const result = recalculateSubjectGradeStatus(record);
    assert.strictEqual(result.final, 73);
    assert.strictEqual(result.status, "Failed");
    assert.strictEqual(result.failed_final_grade, 73, "failed_final_grade must record failing mark");
  });
});

test("TC-GRADE-03: Defensive fallback for Semester 2 records passed with Q1 & Q2", async () => {
  const record = {
    subject: "Physical Science",
    semester: "2nd Semester",
    q1: 88, // Form parser extracted columns as Q1 and Q2 for semester 2 table
    q2: 90,
    q3: undefined,
    q4: undefined,
    sem2_final_grade: undefined,
    final: undefined,
    status: "Missing",
  };

  const result = recalculateSubjectGradeStatus(record);
  assert.strictEqual(result.final, 89, "Fallback routes Q1/Q2 when Q3/Q4 are empty in 2nd semester");
  assert.strictEqual(result.sem2_final_grade, 89);
  assert.strictEqual(result.status, "Passed");
  assert.strictEqual(result.is_auto_computed, true);
});

test("TC-GRADE-04: Non-destructive preservation on discrepancy (Earth Science printed 91 vs computed 86)", async () => {
  const record = {
    subject: "Earth Science",
    semester: "1st Semester",
    q1: 89,
    q2: 83,
    sem1_final_grade: 91, // Misprinted or erroneous OCR on physical card
    final: 91,
    status: "Passed",
  };

  const result = recalculateSubjectGradeStatus(record);
  // 1. Strict non-destructive preservation
  assert.strictEqual(result.final, 91, "Printed final grade must NEVER be silently overwritten");
  assert.strictEqual(result.sem1_final_grade, 91, "sem1_final_grade must preserve printed value 91");

  // 2. Computed discrepancy metrics
  assert.strictEqual(result.computed_final_grade, 86, "Computed final grade is (89+83)/2 = 86");
  assert.strictEqual(result.official_computed_final, 86);
  assert.strictEqual(result.raw_calculated_final, 86);
  assert.strictEqual(result.has_calculation_discrepancy, true, "Must flag calculation discrepancy");
  assert.strictEqual(result.needsVerification, true, "Must require human review");
  assert.strictEqual(result.is_auto_computed, false, "Must NOT be marked as auto-computed");
  assert.ok(result.calculation_notes?.includes("Discrepancy"), "Calculation notes must explain discrepancy");
  assert.ok(result.calculation_notes?.includes("91") && result.calculation_notes?.includes("86"));
});

test("TC-GRADE-05: Missing one or both quarters leaves final grade blank (undefined) and status Missing", async (t) => {
  await t.test("Q1 missing, Q2 present", () => {
    const record = {
      subject: "Disaster Readiness",
      semester: "1st Semester",
      q1: undefined,
      q2: 85,
      sem1_final_grade: undefined,
      final: undefined,
      status: "Missing",
    };
    const result = recalculateSubjectGradeStatus(record);
    assert.strictEqual(result.final, undefined, "Final must remain undefined without inventing grade");
    assert.strictEqual(result.sem1_final_grade, undefined);
    assert.strictEqual(result.status, "Missing");
    assert.strictEqual(result.needsVerification, true);
    assert.strictEqual(result.is_auto_computed, false);
  });

  await t.test("Q1 present, Q2 missing", () => {
    const record = {
      subject: "Disaster Readiness",
      semester: "1st Semester",
      q1: 85,
      q2: undefined,
      sem1_final_grade: undefined,
      final: undefined,
      status: "Missing",
    };
    const result = recalculateSubjectGradeStatus(record);
    assert.strictEqual(result.final, undefined);
    assert.strictEqual(result.status, "Missing");
  });

  await t.test("Both quarters missing", () => {
    const record = {
      subject: "Disaster Readiness",
      semester: "1st Semester",
      q1: undefined,
      q2: undefined,
      sem1_final_grade: undefined,
      final: undefined,
      status: "Missing",
    };
    const result = recalculateSubjectGradeStatus(record);
    assert.strictEqual(result.final, undefined);
    assert.strictEqual(result.status, "Missing");
  });
});

test("TC-GRADE-06: Non-numeric quarter marks ('INC', 'DRP', '-') return undefined without grade fabrication", async () => {
  const incRecord = {
    subject: "General Mathematics",
    semester: "1st Semester",
    q1: "INC",
    q2: 85,
    sem1_final_grade: undefined,
    final: undefined,
    status: "Missing",
  };
  const result = recalculateSubjectGradeStatus(incRecord);
  assert.strictEqual(result.final, undefined);
  assert.strictEqual(result.status, "Missing");
  assert.strictEqual(result.needsVerification, true);

  const drpRecord = {
    subject: "General Mathematics",
    semester: "1st Semester",
    q1: "-",
    q2: "-",
    sem1_final_grade: undefined,
    final: undefined,
    status: "Missing",
  };
  const drpResult = recalculateSubjectGradeStatus(drpRecord);
  assert.strictEqual(drpResult.final, undefined);
  assert.strictEqual(drpResult.status, "Missing");
});

test("TC-GRADE-07: Semester General Average with dynamic 9 subjects (Exact prompt example: Sum 773.5 / 9 = 85.94)", async () => {
  // Prompt example:
  // 88 + 98 + 78 + 74.5 + 85 + 86 + 91.5 + 87.5 + 85 = 773.5
  // 773.5 / 9 = 85.9444... -> 85.94
  const grades = [
    { subject: "Subject 1", semester: "1st Semester", final: 88, sem1_final_grade: 88, status: "Passed" },
    { subject: "Subject 2", semester: "1st Semester", final: 98, sem1_final_grade: 98, status: "Passed" },
    { subject: "Subject 3", semester: "1st Semester", final: 78, sem1_final_grade: 78, status: "Passed" },
    // Auto-computed subject from Q1=75, Q2=74 -> raw 74.5, official 75
    recalculateSubjectGradeStatus({
      subject: "Subject 4",
      semester: "1st Semester",
      q1: 75,
      q2: 74,
      sem1_final_grade: undefined,
      final: undefined,
      status: "Missing",
    }),
    { subject: "Subject 5", semester: "1st Semester", final: 85, sem1_final_grade: 85, status: "Passed" },
    { subject: "Subject 6", semester: "1st Semester", final: 86, sem1_final_grade: 86, status: "Passed" },
    // Auto-computed subject from Q1=91, Q2=92 -> raw 91.5, official 92
    recalculateSubjectGradeStatus({
      subject: "Subject 7",
      semester: "1st Semester",
      q1: 91,
      q2: 92,
      sem1_final_grade: undefined,
      final: undefined,
      status: "Missing",
    }),
    // Auto-computed subject from Q1=96, Q2=79 -> raw 87.5, official 88
    recalculateSubjectGradeStatus({
      subject: "Subject 8",
      semester: "1st Semester",
      q1: 96,
      q2: 79,
      sem1_final_grade: undefined,
      final: undefined,
      status: "Missing",
    }),
    { subject: "Subject 9", semester: "1st Semester", final: 85, sem1_final_grade: 85, status: "Passed" },
  ];

  const averageResult = computeSemesterGeneralAverage(grades, "1st Semester");

  assert.strictEqual(averageResult.subjectCount, 9, "Dynamic count must equal 9");
  assert.strictEqual(averageResult.completeness, "COMPLETE", "Must be complete");
  // Exact prompt arithmetic verification:
  assert.strictEqual(averageResult.rawAverage, 85.94, "Raw average must be exactly 85.94 (from 773.5 / 9)");
  // Official average using DepEd whole-number rounded subject marks (88+98+78+75+85+86+92+88+85 = 775 / 9 = 86.11):
  assert.strictEqual(averageResult.officialAverage, 86.11, "Official average must be 86.11");
});

test("TC-GRADE-08: Semester General Average with dynamic 8 subjects (Proving N is never hardcoded to 9)", async () => {
  // 8 subjects with total sum = 708
  // 708 / 8 = 88.50
  const marks = [85, 86, 87, 88, 89, 90, 91, 92];
  const grades = marks.map((mark, i) => ({
    subject: `Learning Area ${i + 1}`,
    semester: "1st Semester",
    final: mark,
    sem1_final_grade: mark,
    status: "Passed",
  }));

  const averageResult = computeSemesterGeneralAverage(grades, "1st Semester");

  assert.strictEqual(averageResult.subjectCount, 8, "Dynamic count must be 8 (never forced to 9)");
  assert.strictEqual(averageResult.completeness, "COMPLETE");
  assert.strictEqual(averageResult.officialAverage, 88.5);
  assert.strictEqual(averageResult.rawAverage, 88.5);
});

test("TC-GRADE-09: Completeness requirement - missing or incomplete subject withholds General Average", async () => {
  const grades = [
    { subject: "Oral Communication", semester: "1st Semester", final: 88, sem1_final_grade: 88, status: "Passed" },
    { subject: "General Mathematics", semester: "1st Semester", final: 85, sem1_final_grade: 85, status: "Passed" },
    {
      subject: "Earth and Life Science",
      semester: "1st Semester",
      q1: 80,
      q2: undefined, // Missing quarter, cannot compute candidate
      sem1_final_grade: undefined,
      final: undefined,
      status: "Missing",
    },
  ];

  const averageResult = computeSemesterGeneralAverage(grades, "1st Semester");

  assert.strictEqual(averageResult.subjectCount, 3);
  assert.strictEqual(averageResult.completeness, "INCOMPLETE", "Incomplete semester must withhold official average");
  assert.strictEqual(averageResult.officialAverage, undefined, "Official average must be undefined when incomplete");
  assert.strictEqual(averageResult.rawAverage, undefined);
  assert.ok(averageResult.pendingSubjects?.includes("Earth and Life Science"));
});

test("TC-GRADE-10: Empty Semester 2 returns EMPTY / NOT YET AVAILABLE", async () => {
  // Only 1st semester subjects recorded
  const grades = [
    { subject: "Oral Communication", semester: "1st Semester", final: 88, sem1_final_grade: 88, status: "Passed" },
  ];

  const averageResult = computeSemesterGeneralAverage(grades, "2nd Semester");

  assert.strictEqual(averageResult.subjectCount, 0);
  assert.strictEqual(averageResult.completeness, "EMPTY");
  assert.strictEqual(averageResult.officialAverage, undefined);
});

test("TC-GRADE-11: Manual grade edits in review workflow updateExtractedFieldsAverages", async () => {
  const initialFields = {
    document_type: "sf9",
    grade_level: "Grade 11",
    grades: [
      {
        subject: "Empowerment Technologies",
        semester: "1st Semester",
        q1: 80,
        q2: 82,
        sem1_final_grade: undefined,
        final: undefined,
        status: "Missing",
      },
    ],
  };

  // 1. Normalize grades
  initialFields.grades = normalizeGradeRecords(initialFields.grades);
  const updatedFields = updateExtractedFieldsAverages(initialFields);

  assert.strictEqual(updatedFields.grades[0].final, 81, "Auto-computed candidate final is 81");
  assert.strictEqual(updatedFields.grades[0].is_auto_computed, true);
  assert.strictEqual(updatedFields.sem1_subject_count, 1);
  assert.strictEqual(updatedFields.sem1_completeness, "COMPLETE");
  assert.strictEqual(updatedFields.sem1_general_average, 81);

  // 2. User manually overrides final grade to 85
  const userEditedRecord = {
    ...updatedFields.grades[0],
    final: 85,
    sem1_final_grade: 85,
    is_auto_computed: false,
    grade_source: "manual_edit",
  };
  const reNormalized = recalculateSubjectGradeStatus(userEditedRecord);
  assert.strictEqual(reNormalized.final, 85);
  assert.strictEqual(reNormalized.is_auto_computed, false);
  assert.strictEqual(reNormalized.grade_source, "manual_edit");
  // Quarter average (80+82)/2 = 81 vs manual 85 -> flags discrepancy
  assert.strictEqual(reNormalized.has_calculation_discrepancy, true);
});

test("TC-GRADE-12: Strict cross-semester isolation", async () => {
  const mixedGrades = [
    { subject: "Subj 1", semester: "1st Semester", q1: 84, q2: 86, sem1_final_grade: 85, final: 85, status: "Passed" },
    { subject: "Subj 2", semester: "2nd Semester", q3: 92, q4: 94, sem2_final_grade: 93, final: 93, status: "Passed" },
  ];

  const sem1 = computeSemesterGeneralAverage(mixedGrades, "1st Semester");
  const sem2 = computeSemesterGeneralAverage(mixedGrades, "2nd Semester");

  assert.strictEqual(sem1.subjectCount, 1);
  assert.strictEqual(sem1.officialAverage, 85);

  assert.strictEqual(sem2.subjectCount, 1);
  assert.strictEqual(sem2.officialAverage, 93);
});

test("TC-GRADE-13: Validation engine flags grade_calculation_discrepancy as warning requiring review", async () => {
  const { validateFields } = await import("../src/lib/validation/engine.ts");

  const fields = {
    name: "DELA CRUZ, JUAN",
    lrn: "111687140043",
    school_name: "Taysan Resettlement Integrated School",
    school_id: "500169",
    school_year: "2023-2024",
    grade_level: "Grade 11",
    document_type: "sf9",
    grades: [
      recalculateSubjectGradeStatus({
        subject: "Earth Science",
        semester: "1st Semester",
        q1: 89,
        q2: 83,
        sem1_final_grade: 91, // Discrepant printed grade
        final: 91,
        status: "Passed",
      }),
    ],
  };

  const report = validateFields(fields, { ocrConfidence: 0.95 });
  const discrepancyRule = report.results.find((r) => r.ruleName === "grade_calculation_discrepancy");

  assert.ok(discrepancyRule, "grade_calculation_discrepancy rule must execute");
  assert.strictEqual(discrepancyRule.passed, false, "Must fail because Earth Science has discrepancy");
  assert.strictEqual(discrepancyRule.severity, "warning");
  assert.ok(discrepancyRule.message?.includes("Earth Science"));
  assert.strictEqual(report.status, "needs_review", "Document with grade discrepancy must require review");
});

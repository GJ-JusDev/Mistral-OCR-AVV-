import test from "node:test";
import assert from "node:assert/strict";

import { computeSemesterFinalGrade, recalculateSubjectGradeStatus } from "../src/lib/validation/gradeUtils.ts";

test("Phase A: DepEd Semester Final Grade Calculation & Rounding (DO 8, s. 2015)", async (t) => {
  await t.test("1. Basic semestral average computation for whole numbers", () => {
    // (88 + 90) / 2 = 89
    const computed = computeSemesterFinalGrade(88, 90);
    assert.strictEqual(computed, 89);
  });

  await t.test("2. Standard DepEd half-up rounding (87.5 -> 88)", () => {
    // (87 + 88) / 2 = 87.5 -> 88
    const computed = computeSemesterFinalGrade(87, 88);
    assert.strictEqual(computed, 88);
  });

  await t.test("3. Standard DepEd half-up rounding (74.5 -> 75)", () => {
    // (74 + 75) / 2 = 74.5 -> 75
    const computed = computeSemesterFinalGrade(74, 75);
    assert.strictEqual(computed, 75);
  });

  await t.test("4. Downward rounding when below half (74.4 -> 74)", () => {
    // (74 + 74.8) / 2 = 74.4 -> 74
    const computed = computeSemesterFinalGrade(74, 74.8);
    assert.strictEqual(computed, 74);
  });

  await t.test("5. String inputs are parsed correctly", () => {
    const computed = computeSemesterFinalGrade("85", "87");
    assert.strictEqual(computed, 86);
  });

  await t.test("6. Blank, null, or undefined quarters return undefined without inventing grades", () => {
    assert.strictEqual(computeSemesterFinalGrade(85, undefined), undefined);
    assert.strictEqual(computeSemesterFinalGrade(undefined, 85), undefined);
    assert.strictEqual(computeSemesterFinalGrade("", "85"), undefined);
    assert.strictEqual(computeSemesterFinalGrade("-", "85"), undefined);
    assert.strictEqual(computeSemesterFinalGrade("INC", "85"), undefined);
  });
});

test("Phase A: Printed vs Computed Grade Discrepancy Detection & Field Preservation", async (t) => {
  await t.test("1. Matching printed final grade and computed quarter average", () => {
    const record = {
      subject: "Oral Communication",
      semester: "1st Semester",
      q1: 88,
      q2: 90,
      sem1_final_grade: 89,
      status: "Missing",
    };

    const result = recalculateSubjectGradeStatus(record);
    assert.strictEqual(result.final, 89);
    assert.strictEqual(result.computed_final_grade, 89);
    assert.strictEqual(result.has_calculation_discrepancy, false);
    assert.strictEqual(result.status, "Passed");
  });

  await t.test("2. Discrepancy detected when printed final grade contradicts computed quarters", () => {
    // Printed says 82, but Q1(88) and Q2(90) compute to 89
    const record = {
      subject: "Oral Communication",
      semester: "1st Semester",
      q1: 88,
      q2: 90,
      sem1_final_grade: 82, // Misprinted or OCR error
      status: "Missing",
    };

    const result = recalculateSubjectGradeStatus(record);
    assert.strictEqual(result.final, 82, "Printed OCR grade must be strictly preserved");
    assert.strictEqual(result.computed_final_grade, 89, "Computed grade must reflect DepEd formula");
    assert.strictEqual(result.has_calculation_discrepancy, true, "Must flag calculation discrepancy");
    assert.strictEqual(result.needsVerification, true, "Must require Teacher verification");
    assert.ok(result.calculation_notes?.includes("Discrepancy"), "Must provide explanatory note");
  });

  await t.test("3. Blank printed final grade with valid quarters calculates raw and official candidates with auto-computed provenance", () => {
    const record = {
      subject: "General Mathematics",
      semester: "1st Semester",
      q1: 84,
      q2: 86,
      sem1_final_grade: undefined, // Blank printed cell
      final: undefined,
      status: "Missing",
    };

    const result = recalculateSubjectGradeStatus(record);
    assert.strictEqual(result.final, 85, "Candidate final grade must be auto-computed from quarters");
    assert.strictEqual(result.sem1_final_grade, 85, "sem1_final_grade populated with candidate");
    assert.strictEqual(result.official_computed_final, 85, "Preserves official rounded candidate");
    assert.strictEqual(result.raw_calculated_final, 85, "Preserves raw calculated arithmetic average");
    assert.strictEqual(result.is_auto_computed, true, "Must be tagged as auto-computed");
    assert.strictEqual(result.grade_source, "auto_computed", "Grade source must be auto_computed");
    assert.strictEqual(result.status, "Passed", "Candidate status evaluates to Passed (85 >= 75)");
    assert.strictEqual(result.needsVerification, true, "Requires human review before approval");
    assert.ok(result.calculation_notes?.includes("Auto-computed"), "Notes that candidate grade was auto-computed");
  });

  await t.test("4. 2nd Semester quarters (Q3, Q4) are correctly routed and computed", () => {
    const record = {
      subject: "Pagbasa at Pagsusuri",
      semester: "2nd Semester",
      q3: 91,
      q4: 93,
      sem2_final_grade: 92,
      status: "Missing",
    };

    const result = recalculateSubjectGradeStatus(record);
    assert.strictEqual(result.final, 92);
    assert.strictEqual(result.computed_final_grade, 92);
    assert.strictEqual(result.has_calculation_discrepancy, false);
    assert.strictEqual(result.status, "Passed");
  });
});

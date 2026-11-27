import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDynamicGradeStatus } from "../src/lib/validation/gradeUtils.ts";

test("evaluateDynamicGradeStatus - Case A: Blank, Empty, and Unread cells", () => {
  const blankInputs = [undefined, null, "", "   ", "—", "-", "N/A", "n/a"];

  for (const input of blankInputs) {
    const res = evaluateDynamicGradeStatus({ grade: input });
    assert.equal(res.status, "blank", `Input '${input}' should produce status 'blank'`);
    assert.equal(res.gradeDisplay, "Blank", `Input '${input}' should produce gradeDisplay 'Blank'`);
    assert.equal(res.remarkDisplay, "Blank / Incomplete", `Input '${input}' should produce remarkDisplay 'Blank / Incomplete'`);
    assert.equal(res.officialRemark, "BLANK / INCOMPLETE", `Input '${input}' should produce officialRemark 'BLANK / INCOMPLETE'`);
    assert.notEqual(res.remarkDisplay, "PASSED", "Blank cells must NEVER default to 'PASSED'");
    assert.notEqual(res.remarkDisplay, "FAILED", "Blank cells must NEVER default to 'FAILED'");
  }
});

test("evaluateDynamicGradeStatus - Case B: Low OCR Confidence (< 65%) or Unrecognized Text", () => {
  // Low confidence numeric grade (54%)
  const lowConfRes = evaluateDynamicGradeStatus({ grade: 88, confidencePercent: 0.54 });
  assert.equal(lowConfRes.status, "not_recognized");
  assert.equal(lowConfRes.isLowConfidence, true);
  assert.match(lowConfRes.remarkDisplay, /^Not Recognized \(54%\)$/);
  assert.equal(lowConfRes.officialRemark, "NOT RECOGNIZED");

  // Percentage input passed as 50 (i.e. 50%)
  const lowConfIntRes = evaluateDynamicGradeStatus({ grade: 92, confidencePercent: 50 });
  assert.equal(lowConfIntRes.status, "not_recognized");
  assert.equal(lowConfIntRes.isLowConfidence, true);
  assert.match(lowConfIntRes.remarkDisplay, /^Not Recognized \(50%\)$/);

  // Garbled non-numeric text with sufficient confidence
  const garbledRes = evaluateDynamicGradeStatus({ grade: "xyz??!#", confidencePercent: 0.95 });
  assert.equal(garbledRes.status, "not_recognized");
  assert.equal(garbledRes.remarkDisplay, "Not Recognized");
  assert.equal(garbledRes.officialRemark, "NOT RECOGNIZED");
});

test("evaluateDynamicGradeStatus - Case C: Valid Numeric Grade with Sufficient Confidence (>= 65%)", () => {
  // Passing grades (>= 75)
  const passingGrades = [75, 75.0, 75.4, 76, 85, 89.5, 90, 98, 100];
  for (const grade of passingGrades) {
    const res = evaluateDynamicGradeStatus({ grade, confidencePercent: 0.90 });
    assert.equal(res.status, "passed", `Grade ${grade} must have status 'passed'`);
    assert.equal(res.remarkDisplay, "PASSED", `Grade ${grade} must have remarkDisplay 'PASSED'`);
    assert.equal(res.officialRemark, "PASSED", `Grade ${grade} must have officialRemark 'PASSED'`);
    assert.equal(res.isLowConfidence, false);
  }

  // Failing grades (< 75)
  const failingGrades = [60, 65, 70, 74, 74.4];
  for (const grade of failingGrades) {
    const res = evaluateDynamicGradeStatus({ grade, confidencePercent: 0.85 });
    assert.equal(res.status, "failed", `Grade ${grade} must have status 'failed'`);
    assert.equal(res.remarkDisplay, "FAILED", `Grade ${grade} must have remarkDisplay 'FAILED'`);
    assert.equal(res.officialRemark, "FAILED", `Grade ${grade} must have officialRemark 'FAILED'`);
    assert.equal(res.isLowConfidence, false);
  }
});

test("evaluateDynamicGradeStatus - Case D: Explicit Physical Remarks Preservation", () => {
  // Incomplete
  const incRes = evaluateDynamicGradeStatus({ grade: null, rawRemark: "INC", confidencePercent: 0.90 });
  assert.equal(incRes.status, "incomplete");
  assert.equal(incRes.officialRemark, "INCOMPLETE");
  assert.equal(incRes.remarkDisplay, "Incomplete");

  // Dropped
  const drpRes = evaluateDynamicGradeStatus({ grade: null, rawRemark: "DROPPED", confidencePercent: 0.90 });
  assert.equal(drpRes.status, "dropped");
  assert.equal(drpRes.officialRemark, "DROPPED");
  assert.equal(drpRes.remarkDisplay, "Dropped");

  // Transferred
  const transRes = evaluateDynamicGradeStatus({ grade: null, rawRemark: "TRANSFERRED", confidencePercent: 0.90 });
  assert.equal(transRes.status, "transferred");
  assert.equal(transRes.officialRemark, "TRANSFERRED");
  assert.equal(transRes.remarkDisplay, "Transferred");
});

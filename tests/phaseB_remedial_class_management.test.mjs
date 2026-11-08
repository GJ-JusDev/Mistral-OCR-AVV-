import test from "node:test";
import assert from "node:assert/strict";

import {
  computeDepEdRecomputedGrade,
  evaluateSubjectRemediation,
  evaluateStudentRemediationSummary,
} from "../src/lib/remedial/remedialEvaluator.ts";

test("Phase B: DepEd Recomputed Final Grade Calculation (DO 8, s. 2015)", async (t) => {
  await t.test("1. Recomputed grade is average of original final grade and remedial class mark", () => {
    // Original = 72, Remedial = 78 -> (72 + 78) / 2 = 75
    const recomputed = computeDepEdRecomputedGrade(72, 78);
    assert.strictEqual(recomputed, 75);
  });

  await t.test("2. Half-up rounding on fractional recomputed grade (72 + 77) / 2 = 74.5 -> 75", () => {
    const recomputed = computeDepEdRecomputedGrade(72, 77);
    assert.strictEqual(recomputed, 75);
  });

  await t.test("3. String numeric inputs work accurately", () => {
    const recomputed = computeDepEdRecomputedGrade("70", "80");
    assert.strictEqual(recomputed, 75);
  });

  await t.test("4. Missing or blank inputs return undefined without inventing marks", () => {
    assert.strictEqual(computeDepEdRecomputedGrade(72, undefined), undefined);
    assert.strictEqual(computeDepEdRecomputedGrade(undefined, 78), undefined);
    assert.strictEqual(computeDepEdRecomputedGrade(72, ""), undefined);
  });
});

test("Phase B: Remedial Status Workflow & Verification Controls", async (t) => {
  await t.test("1. Grade below 75 triggers REMEDIAL_REQUIRED with Taglish message", () => {
    const result = evaluateSubjectRemediation({
      subject: "General Mathematics",
      finalGrade: 72,
    });

    assert.ok(result);
    assert.strictEqual(result.status, "REMEDIAL_REQUIRED");
    assert.strictEqual(result.isDeficiencyResolved, false);
    assert.ok(result.advisoryMessage.includes("General Mathematics (72)"));
    assert.ok(result.advisoryMessage.includes("Kailangan ng academic review"));
  });

  await t.test("2. Unverified remedial result does NOT clear academic deficiency", () => {
    // OCR finds a remedial class mark of 80, but it is not yet verified by teacher
    const result = evaluateSubjectRemediation({
      subject: "General Mathematics",
      finalGrade: 72,
      remedialClassMark: 80,
      isVerifiedByTeacher: false,
    });

    assert.ok(result);
    assert.strictEqual(result.status, "REMEDIAL_COMPLETED_PENDING_VERIFICATION");
    assert.strictEqual(result.recomputedFinalGrade, 76);
    assert.strictEqual(result.isDeficiencyResolved, false, "Must NOT clear deficiency without teacher verification");
    assert.strictEqual(result.requiresTeacherVerification, true);
  });

  await t.test("3. Verified passing remedial result clears academic deficiency", () => {
    const result = evaluateSubjectRemediation({
      subject: "General Mathematics",
      finalGrade: 72,
      remedialClassMark: 80,
      isVerifiedByTeacher: true,
      verifiedBy: "teacher-uuid-123",
      supportingDocumentRef: "Certificate of Recomputed Final Grade #101",
    });

    assert.ok(result);
    assert.strictEqual(result.status, "REMEDIAL_PASSED");
    assert.strictEqual(result.recomputedFinalGrade, 76);
    assert.strictEqual(result.isDeficiencyResolved, true, "Deficiency is cleared once verified");
    assert.strictEqual(result.supportingDocumentRef, "Certificate of Recomputed Final Grade #101");
  });

  await t.test("4. Verified failing remedial result keeps deficiency active as REMEDIAL_FAILED", () => {
    // Original: 70, Remedial: 72 -> Recomputed: 71 (< 75)
    const result = evaluateSubjectRemediation({
      subject: "General Mathematics",
      finalGrade: 70,
      remedialClassMark: 72,
      isVerifiedByTeacher: true,
      verifiedBy: "teacher-uuid-123",
    });

    assert.ok(result);
    assert.strictEqual(result.status, "REMEDIAL_FAILED");
    assert.strictEqual(result.recomputedFinalGrade, 71);
    assert.strictEqual(result.isDeficiencyResolved, false);
    assert.ok(result.advisoryMessage.includes("Hindi umabot sa passing mark (75)"));
  });
});

test("Phase B: Student-Level Remedial Summary & Hold Policy", async (t) => {
  await t.test("1. Student with unresolved remedial has hold status, not permanent failure", () => {
    const summary = evaluateStudentRemediationSummary([
      { subject: "Oral Communication", finalGrade: 88 },
      { subject: "General Mathematics", finalGrade: 72 }, // Deficient
      { subject: "Komunikasyon", finalGrade: 85 },
    ]);

    assert.strictEqual(summary.totalDeficiencies, 1);
    assert.strictEqual(summary.unresolvedDeficienciesCount, 1);
    assert.strictEqual(summary.overallAcademicStanding, "REMEDIAL_REQUIRED");
    assert.strictEqual(summary.canProceedToGraduationReview, false);
    assert.ok(summary.summaryMessage.includes("General Mathematics (72)"));
  });

  await t.test("2. Once remedial is verified and passed, graduation review can proceed", () => {
    const summary = evaluateStudentRemediationSummary([
      { subject: "Oral Communication", finalGrade: 88 },
      {
        subject: "General Mathematics",
        finalGrade: 72,
        remedialClassMark: 80,
        isVerifiedByTeacher: true,
      },
      { subject: "Komunikasyon", finalGrade: 85 },
    ]);

    assert.strictEqual(summary.totalDeficiencies, 1);
    assert.strictEqual(summary.unresolvedDeficienciesCount, 0);
    assert.strictEqual(summary.resolvedDeficienciesCount, 1);
    assert.strictEqual(summary.overallAcademicStanding, "PASSED");
    assert.strictEqual(summary.canProceedToGraduationReview, true);
  });
});

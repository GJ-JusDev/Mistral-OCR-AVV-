import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateShsStudentEligibility,
} from "../src/lib/eligibility/evaluator.ts";

test("Phase E: Grade 11 Progression Evaluation (DO 8, s. 2015 & DO 55, s. 2016)", async (t) => {
  await t.test("1. All Grade 11 subjects passed with complete documents -> Eligible for Progression", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Oral Communication", finalGrade: 86, status: "Passed" },
        { subject: "General Mathematics", finalGrade: 84, status: "Passed" },
        { subject: "Earth and Life Science", finalGrade: 88, status: "Passed" },
        { subject: "Komunikasyon at Pananaliksik", finalGrade: 87, status: "Passed" },
        { subject: "21st Century Literature", finalGrade: 85, status: "Passed" },
      ],
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.gradeLevel, "Grade 11");
    assert.strictEqual(result.eligibilityType, "Grade 11 Progression");
    assert.strictEqual(result.status, "Eligible");
    assert.strictEqual(result.detailedStatus, "ELIGIBLE_FOR_PROGRESSION");
    assert.strictEqual(result.academicCategory, "Academically Eligible");
    assert.strictEqual(result.attendanceCategory, "Normal");
    assert.strictEqual(result.documentCategory, "Complete");
    assert.strictEqual(result.isAcademicallyPassing, true);
    assert.strictEqual(result.canPrincipalApprove, true);
    assert.strictEqual(result.failedSubjectsCount, 0);
  });

  await t.test("2. Grade 11 with failing subject below 75 -> Not Eligible (Remedial Required)", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Oral Communication", finalGrade: 85, status: "Passed" },
        { subject: "General Mathematics", finalGrade: 72, status: "Failed" },
        { subject: "Earth and Life Science", finalGrade: 82, status: "Passed" },
      ],
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.status, "Not Eligible");
    assert.strictEqual(result.detailedStatus, "REMEDIAL_REQUIRED");
    assert.strictEqual(result.academicCategory, "Remedial Required");
    assert.strictEqual(result.isAcademicallyPassing, false);
    assert.strictEqual(result.canPrincipalApprove, false);
    assert.ok(result.blockingFactors.some((bf) => bf.includes("General Mathematics")));
    assert.ok(result.taglishAdvisory.includes("General Mathematics"));
  });

  await t.test("3. Unverified remedial mark does NOT clear deficiency for progression", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Oral Communication", finalGrade: 85, status: "Passed" },
        {
          subject: "General Mathematics",
          finalGrade: 72,
          remedialClassMark: 80,
          recomputedFinalGrade: 76,
          remedialStatus: "REMEDIAL_COMPLETED_PENDING_VERIFICATION",
          isRemedialVerified: false,
          status: "Failed",
        },
      ],
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.status, "Not Eligible");
    assert.strictEqual(result.canPrincipalApprove, false);
    assert.strictEqual(result.isAcademicallyPassing, false);
    // Unverified recomputed grade places category in Academic Review Required
    assert.strictEqual(result.academicCategory, "Academic Review Required");
    assert.ok(result.blockingFactors.some((bf) => bf.includes("verification") || bf.includes("remedial")));
  });

  await t.test("4. Verified remedial mark (isRemedialVerified: true, recomputed >= 75) clears deficiency", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Oral Communication", finalGrade: 85, status: "Passed" },
        {
          subject: "General Mathematics",
          finalGrade: 72,
          remedialClassMark: 80,
          recomputedFinalGrade: 76,
          remedialStatus: "REMEDIAL_PASSED",
          isRemedialVerified: true,
          status: "Passed",
        },
      ],
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.status, "Eligible");
    assert.strictEqual(result.detailedStatus, "ELIGIBLE_FOR_PROGRESSION");
    assert.strictEqual(result.academicCategory, "Academically Eligible");
    assert.strictEqual(result.isAcademicallyPassing, true);
    assert.strictEqual(result.remedialResolvedCount, 1);
    assert.strictEqual(result.canPrincipalApprove, true);
  });
});

test("Phase E: Grade 12 Graduation Evaluation & Prerequisites", async (t) => {
  await t.test("1. Grade 12 with complete subjects, G11 prerequisites passed & Work Immersion -> Eligible for Graduation", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 12",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Inquiries, Investigations and Immersion", finalGrade: 90, status: "Passed" },
        { subject: "Contemporary Philippine Arts from the Regions", finalGrade: 88, status: "Passed" },
        { subject: "Media and Information Literacy", finalGrade: 89, status: "Passed" },
        { subject: "Work Immersion", finalGrade: 92, status: "Passed" },
      ],
      historicalGrade11Subjects: [
        { subject: "Oral Communication", finalGrade: 85, status: "Passed" },
        { subject: "General Mathematics", finalGrade: 84, status: "Passed" },
      ],
      workImmersionCompleted: true,
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.gradeLevel, "Grade 12");
    assert.strictEqual(result.eligibilityType, "Grade 12 Graduation");
    assert.strictEqual(result.status, "Eligible");
    assert.strictEqual(result.detailedStatus, "ELIGIBLE_FOR_GRADUATION");
    assert.strictEqual(result.canPrincipalApprove, true);
    assert.strictEqual(result.isAcademicallyPassing, true);
  });

  await t.test("2. Grade 12 with unresolved Grade 11 prerequisite cannot graduate until cleared", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 12",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Inquiries, Investigations and Immersion", finalGrade: 90, status: "Passed" },
        { subject: "Work Immersion", finalGrade: 92, status: "Passed" },
      ],
      historicalGrade11Subjects: [
        { subject: "General Mathematics", finalGrade: 71, status: "Failed" },
      ],
      workImmersionCompleted: true,
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.status, "Not Eligible");
    assert.strictEqual(result.detailedStatus, "REMEDIAL_REQUIRED");
    assert.strictEqual(result.canPrincipalApprove, false);
    assert.ok(result.blockingFactors.some((bf) => bf.includes("Grade 11 prerequisite")));
  });

  await t.test("3. Grade 12 without Work Immersion cannot graduate", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 12",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Inquiries, Investigations and Immersion", finalGrade: 90, status: "Passed" },
      ],
      historicalGrade11Subjects: [
        { subject: "Oral Communication", finalGrade: 85, status: "Passed" },
      ],
      workImmersionCompleted: false,
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.status, "Needs Review");
    assert.strictEqual(result.detailedStatus, "ACADEMIC_REQUIREMENTS_INCOMPLETE");
    assert.strictEqual(result.canPrincipalApprove, false);
    assert.ok(result.blockingFactors.some((bf) => bf.includes("Work Immersion")));
  });
});

test("Phase E: Attendance Safeguards & 3 Monitoring Categories", async (t) => {
  await t.test("1. High absences (> 20%) place eligibility on hold without academic failure", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Oral Communication", finalGrade: 88, status: "Passed" },
        { subject: "General Mathematics", finalGrade: 86, status: "Passed" },
      ],
      attendanceSummary: {
        riskStatus: "ATTENDANCE_REVIEW_REQUIRED",
        absencePercentage: 22.5,
        attendancePercentage: 77.5,
      },
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    // Academic status remains passing! (No automatic academic failure or grade change)
    assert.strictEqual(result.isAcademicallyPassing, true, "Must NOT fail student academically for attendance");
    assert.strictEqual(result.academicCategory, "Passed");
    assert.strictEqual(result.attendanceCategory, "Review Required");
    // Eligibility decision is held on review pending authorized school inquiry
    assert.strictEqual(result.status, "Needs Review");
    assert.strictEqual(result.detailedStatus, "ATTENDANCE_REVIEW_PENDING");
    assert.strictEqual(result.canPrincipalApprove, false);
    assert.ok(result.blockingFactors.some((bf) => bf.includes("20%")));
    assert.ok(result.taglishAdvisory.includes("Attendance Review Required"));
  });

  await t.test("2. Attendance Warning (15-20%) does not block progression if academically passed", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Oral Communication", finalGrade: 88, status: "Passed" },
        { subject: "General Mathematics", finalGrade: 86, status: "Passed" },
      ],
      attendanceSummary: {
        riskStatus: "ATTENDANCE_WARNING",
        absencePercentage: 17.5,
        attendancePercentage: 82.5,
      },
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.isAcademicallyPassing, true);
    assert.strictEqual(result.academicCategory, "Academically Eligible");
    assert.strictEqual(result.attendanceCategory, "Warning");
    // Warning alone below 20% does not disqualify progression
    assert.strictEqual(result.status, "Eligible");
    assert.strictEqual(result.canPrincipalApprove, true);
  });

  await t.test("3. Missing documents separate from academic standing", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Oral Communication", finalGrade: 88, status: "Passed" },
        { subject: "General Mathematics", finalGrade: 86, status: "Passed" },
      ],
      documentCompleteness: {
        isComplete: false,
        hasSf9: true,
        hasSf10: false, // Missing SF10
        hasPsa: true,
        identityStatus: "MATCH",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.isAcademicallyPassing, true);
    assert.strictEqual(result.documentCategory, "Missing SF10");
    assert.strictEqual(result.status, "Needs Review");
    assert.strictEqual(result.detailedStatus, "DOCUMENTS_INCOMPLETE");
    assert.strictEqual(result.canPrincipalApprove, false);
    assert.ok(result.blockingFactors.some((bf) => bf.includes("SF10")));
  });

  await t.test("4. Principal approval override authority", () => {
    const result = evaluateShsStudentEligibility({
      gradeLevel: "Grade 12",
      schoolYear: "2023-2024",
      subjects: [
        { subject: "Inquiries, Investigations and Immersion", finalGrade: 90, status: "Passed" },
      ],
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
        hasPsa: true,
        identityStatus: "MATCH",
      },
      existingApproval: {
        id: "approval-uuid-1",
        decision: "Approved",
        approvedBy: "Principal Santos",
        approvedAt: "2024-04-15T08:00:00Z",
        remarks: "Approved for graduation after manual review.",
      },
    });

    assert.ok(result);
    assert.strictEqual(result.approvalDecision, "Approved");
  });
});

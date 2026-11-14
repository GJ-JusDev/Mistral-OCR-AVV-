/**
 * DepEd Senior High School Academic Eligibility Evaluator.
 *
 * Scoped to Taysan Resettlement Integrated School (TRIS), DepEd School ID 500169.
 * Grades 11 and 12 only.
 *
 * Implements strict DepEd criteria (DO 8, s. 2015 & DO 55, s. 2016):
 * - Grade 11: Progression to Grade 12
 * - Grade 12: Graduation
 * - ZERO grade fabrication / zero recalculation of missing source grades.
 * - Missing document NEVER classifies student as academically failed; places on hold ("Needs Review").
 * - Remedial Integration: Verified remedial passing marks (>= 75) clear academic deficiencies.
 * - Attendance Safeguard: High absences trigger review hold, never automatic academic failure.
 * - Statuses: Eligible, Not Eligible (RED), Needs Review, Approved, Not Approved.
 */

import type { RemedialStatus } from "../remedial/remedialEvaluator";
import type { AttendanceRiskStatus } from "../attendance/attendanceEvaluator";

export type ShsEligibilityType = "Grade 11 Progression" | "Grade 12 Graduation";

export type AcademicEligibilityStatus = "Eligible" | "Not Eligible" | "Needs Review";

export type DetailedEligibilityStatus =
  | "ELIGIBLE_FOR_PROGRESSION"
  | "ELIGIBLE_FOR_GRADUATION"
  | "REMEDIAL_REQUIRED"
  | "ACADEMIC_REQUIREMENTS_INCOMPLETE"
  | "ATTENDANCE_REVIEW_PENDING"
  | "DOCUMENTS_INCOMPLETE"
  | "NEEDS_REVIEW";

export type PrincipalApprovalDecision = "Approved" | "Not Approved" | "Pending";

export type AcademicMonitoringCategory =
  | "Passed"
  | "Remedial Required"
  | "Remedial In Progress"
  | "Academic Review Required"
  | "Academically Eligible";

export type AttendanceMonitoringCategory =
  | "Normal"
  | "Warning"
  | "Review Required"
  | "Incomplete Data";

export type DocumentMonitoringCategory =
  | "Complete"
  | "Missing SF9"
  | "Missing SF10"
  | "Identity Review Required";

export interface EvaluatedSubject {
  subject: string;
  finalGrade?: number | null;
  status: "Passed" | "Failed" | "Missing" | "Pending";
  semester?: string | null;
  q1?: number | null;
  q2?: number | null;
  q3?: number | null;
  q4?: number | null;
  remedialClassMark?: number | null;
  recomputedFinalGrade?: number | null;
  remedialStatus?: RemedialStatus | null;
  isRemedialVerified?: boolean;
  supportingDocumentRef?: string | null;
}

export interface AttendanceEvaluationSummaryInput {
  riskStatus?: AttendanceRiskStatus;
  absencePercentage?: number;
  attendancePercentage?: number;
  isAttendanceVerified?: boolean;
  schoolReviewCompleted?: boolean;
}

export interface EligibilityEvaluationInput {
  gradeLevel: string;
  schoolYear?: string | null;
  subjects: EvaluatedSubject[];
  historicalGrade11Subjects?: EvaluatedSubject[];
  workImmersionCompleted?: boolean;
  attendanceSummary?: AttendanceEvaluationSummaryInput | null;
  documentCompleteness: {
    isComplete: boolean;
    hasSf9: boolean;
    hasSf10: boolean;
    hasPsa?: boolean;
    identityStatus?: "MATCH" | "IDENTITY_REVIEW_REQUIRED" | "MISSING_DATA";
  };
  existingApproval?: {
    id?: string;
    decision: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    remarks?: string | null;
  } | null;
}

export interface EligibilityEvaluationResult {
  gradeLevel: "Grade 11" | "Grade 12";
  eligibilityType: ShsEligibilityType;
  status: AcademicEligibilityStatus;
  detailedStatus: DetailedEligibilityStatus;
  approvalDecision: PrincipalApprovalDecision;
  academicCategory: AcademicMonitoringCategory;
  attendanceCategory: AttendanceMonitoringCategory;
  documentCategory: DocumentMonitoringCategory;
  taglishAdvisory: string;
  isAcademicallyPassing: boolean;
  canPrincipalApprove: boolean;
  reasons: string[];
  blockingFactors: string[];
  totalSubjects: number;
  passedSubjectsCount: number;
  failedSubjectsCount: number;
  missingSubjectsCount: number;
  remedialResolvedCount: number;
  existingApproval?: {
    id?: string;
    decision: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    remarks?: string | null;
  } | null;
}

/**
 * DEPED SENIOR HIGH SCHOOL ACADEMIC ELIGIBILITY EVALUATOR
 *
 * Bakit ito ginawa para sa School Head / Principal:
 * Ito ang automated core engine na sumusuri sa estado ng mag-aaral:
 * - Grade 11: Progression to Grade 12 (kailangang maipasa ang lahat ng G11 subjects o ma-remedial)
 * - Grade 12: Graduation (kailangang maipasa ang lahat ng G11 & G12 curriculum requirements at Work Immersion)
 *
 * Mahahalagang Proteksyon:
 * 1. Ang kakulangan sa dokumento (hal. missing SF9/SF10) ay HINDI academic failure (Needs Review lang).
 * 2. Ang bagsak na subject na naipasa sa remedial class at na-verify ng guro ay ganap na nalilinis.
 * 3. Ang mataas na absences ay naglalabas ng review hold (ATTENDANCE_REVIEW_PENDING) pero HINDI automatic failure.
 * 4. Tanging ang authorized Principal lamang ang may kapangyarihang mag-apruba sa opisyal na desisyon.
 */
export function evaluateShsStudentEligibility(
  input: EligibilityEvaluationInput
): EligibilityEvaluationResult {
  const isG12 = /12/i.test(input.gradeLevel);
  const gradeLevel: "Grade 11" | "Grade 12" = isG12 ? "Grade 12" : "Grade 11";
  const eligibilityType: ShsEligibilityType = isG12 ? "Grade 12 Graduation" : "Grade 11 Progression";

  const subjects = input.subjects || [];
  const reasons: string[] = [];
  const blockingFactors: string[] = [];

  let passedCount = 0;
  let failedCount = 0;
  let missingCount = 0;
  let remedialResolvedCount = 0;
  let remedialInProgressCount = 0;
  let remedialPendingVerifCount = 0;

  const failedSubjectNames: string[] = [];

  // 1. Academic Assessment ng bawat subject sa kasalukuyang grade level
  subjects.forEach((sub) => {
    const finalGrade = typeof sub.finalGrade === "number" ? sub.finalGrade : null;

    // Suriin kung may verified remedial result
    const hasVerifiedPassingRemedial =
      (sub.remedialStatus === "REMEDIAL_PASSED" ||
        (typeof sub.recomputedFinalGrade === "number" && sub.recomputedFinalGrade >= 75)) &&
      sub.isRemedialVerified === true;

    if (hasVerifiedPassingRemedial) {
      passedCount++;
      remedialResolvedCount++;
      reasons.push(
        `Naipasa ang remedial sa ${sub.subject} na may recomputed grade na ${sub.recomputedFinalGrade} (orihinal: ${finalGrade ?? "Failed"}). Verified ni Teacher.`
      );
    } else if (sub.remedialStatus === "REMEDIAL_IN_PROGRESS") {
      failedCount++;
      remedialInProgressCount++;
      failedSubjectNames.push(`${sub.subject} (Remedial in progress)`);
      reasons.push(`Kasalukuyang sumasailalim sa remedial class para sa ${sub.subject}.`);
    } else if (
      sub.remedialStatus === "REMEDIAL_COMPLETED_PENDING_VERIFICATION" ||
      (typeof sub.recomputedFinalGrade === "number" && !sub.isRemedialVerified)
    ) {
      failedCount++;
      remedialPendingVerifCount++;
      failedSubjectNames.push(`${sub.subject} (Pending verification)`);
      reasons.push(`May remedial mark ang ${sub.subject} ngunit kailangan pa ng opisyal na verification ng Teacher.`);
    } else if (finalGrade !== null) {
      if (finalGrade >= 75) {
        passedCount++;
      } else {
        failedCount++;
        failedSubjectNames.push(`${sub.subject} (${finalGrade})`);
        reasons.push(`Failing mark in ${sub.subject} (${finalGrade}).`);
      }
    } else if (sub.status === "Passed") {
      passedCount++;
    } else if (sub.status === "Failed") {
      failedCount++;
      failedSubjectNames.push(sub.subject);
      reasons.push(`Failing grade recorded for ${sub.subject}.`);
    } else {
      missingCount++;
      reasons.push(`Missing final grade for ${sub.subject}.`);
    }
  });

  // 2. Prerequisite Check para sa Grade 12 Graduation:
  // Dapat walang unresolved failures sa Grade 11 records
  let hasG11Deficiency = false;
  if (isG12 && Array.isArray(input.historicalGrade11Subjects) && input.historicalGrade11Subjects.length > 0) {
    input.historicalGrade11Subjects.forEach((g11Sub) => {
      const g11Final = typeof g11Sub.finalGrade === "number" ? g11Sub.finalGrade : null;
      const g11RemedialPassed =
        (g11Sub.remedialStatus === "REMEDIAL_PASSED" ||
          (typeof g11Sub.recomputedFinalGrade === "number" && g11Sub.recomputedFinalGrade >= 75)) &&
        g11Sub.isRemedialVerified === true;

      if (!g11RemedialPassed && ((g11Final !== null && g11Final < 75) || g11Sub.status === "Failed")) {
        hasG11Deficiency = true;
        failedCount++;
        failedSubjectNames.push(`Grade 11: ${g11Sub.subject}`);
        blockingFactors.push(
          `Unresolved Grade 11 prerequisite: Failing grade in ${g11Sub.subject} (${g11Final ?? "Failed"}).`
        );
      }
    });
  }

  // 3. Work Immersion check para sa Grade 12
  let missingWorkImmersion = false;
  if (isG12 && input.workImmersionCompleted === false) {
    missingWorkImmersion = true;
    blockingFactors.push("Pending completion of Work Immersion / Research / Culminating Activity requirement.");
  }

  // Academic assessment: pasado ba sa lahat ng subject?
  const hasAcademicFailure = failedCount > 0;
  const hasIncompleteGrades = subjects.length === 0 || missingCount > 0;
  const isAcademicallyPassing = !hasAcademicFailure && !hasIncompleteGrades && passedCount > 0;

  // 4. Document completeness assessment: kumpleto ba ang SF9 at SF10?
  const docs = input.documentCompleteness;
  let documentCategory: DocumentMonitoringCategory = "Complete";
  if (!docs.hasSf9) {
    documentCategory = "Missing SF9";
    blockingFactors.push("Missing SF9 Report Card.");
  } else if (!docs.hasSf10) {
    documentCategory = "Missing SF10";
    blockingFactors.push("Missing SF10 Permanent Record.");
  } else if (docs.identityStatus === "IDENTITY_REVIEW_REQUIRED") {
    documentCategory = "Identity Review Required";
    blockingFactors.push("Identity Review Required: Document name or LRN discrepancies detected.");
  }

  // 5. Attendance Assessment
  const attendance = input.attendanceSummary;
  let attendanceCategory: AttendanceMonitoringCategory = "Normal";
  let hasPendingAttendanceReview = false;

  if (attendance) {
    if (attendance.riskStatus === "ATTENDANCE_REVIEW_REQUIRED") {
      attendanceCategory = "Review Required";
      if (!attendance.schoolReviewCompleted) {
        hasPendingAttendanceReview = true;
        blockingFactors.push(
          `Attendance Review Pending: Recorded absences (${attendance.absencePercentage ?? ">20"}%) exceed the 20% limit. Requires School Head / Principal review.`
        );
      }
    } else if (attendance.riskStatus === "ATTENDANCE_WARNING") {
      attendanceCategory = "Warning";
    } else if (attendance.riskStatus === "INCOMPLETE_ATTENDANCE_DATA") {
      attendanceCategory = "Incomplete Data";
    }
  }

  // 6. Academic Category
  let academicCategory: AcademicMonitoringCategory = "Passed";
  if (failedCount > 0) {
    if (remedialInProgressCount > 0) {
      academicCategory = "Remedial In Progress";
    } else if (remedialPendingVerifCount > 0) {
      academicCategory = "Academic Review Required";
    } else {
      academicCategory = "Remedial Required";
    }
  } else if (isAcademicallyPassing) {
    academicCategory = docs.isComplete && !hasPendingAttendanceReview ? "Academically Eligible" : "Passed";
  }

  // 7. Resolve Final Statuses
  let status: AcademicEligibilityStatus = "Needs Review";
  let detailedStatus: DetailedEligibilityStatus = "NEEDS_REVIEW";
  let taglishAdvisory = "";

  if (hasAcademicFailure) {
    // May failing grade -> Not Eligible
    status = "Not Eligible";
    detailedStatus = "REMEDIAL_REQUIRED";
    blockingFactors.push(...reasons.filter((r) => r.includes("Failing") || r.toLowerCase().includes("remedial")));
    taglishAdvisory = `Ang student ay may failing subject na kailangang i-remedial (${failedSubjectNames.join(", ")}). Hindi pa maaaring i-approve ang ${eligibilityType.toLowerCase()} hangga't hindi verified at resolved ang applicable academic requirements.`;
  } else if (!docs.isComplete || docs.identityStatus === "IDENTITY_REVIEW_REQUIRED") {
    // Kulang sa dokumento o may identity conflict -> Needs Review
    status = "Needs Review";
    detailedStatus = docs.identityStatus === "IDENTITY_REVIEW_REQUIRED" ? "NEEDS_REVIEW" : "DOCUMENTS_INCOMPLETE";
    if (isAcademicallyPassing) {
      reasons.push("Passing marks in all recorded subjects.");
    }
    taglishAdvisory = `Naka-hold ang approval ng ${eligibilityType.toLowerCase()} dahil sa kakulangan ng dokumento (${documentCategory}). Hindi ito failing grade; magiging eligible ang student oras na makumpleto ang file.`;
  } else if (hasPendingAttendanceReview) {
    // Attendance review hold -> Needs Review
    status = "Needs Review";
    detailedStatus = "ATTENDANCE_REVIEW_PENDING";
    taglishAdvisory = `Attendance Review Required: May mataas na bilang ng absences ang student (${attendance?.absencePercentage ?? ">20"}%). Kailangan ng opisyal na pagsusuri ng School Head / Principal bago ma-clear ang eligibility.`;
  } else if (hasIncompleteGrades || missingWorkImmersion) {
    // Kulang sa academic grades o Work Immersion -> Needs Review
    status = "Needs Review";
    detailedStatus = "ACADEMIC_REQUIREMENTS_INCOMPLETE";
    if (missingCount > 0) {
      blockingFactors.push(`${missingCount} subject grade(s) are missing or pending verification.`);
    }
    taglishAdvisory = `Kulang ang mga kinakailangang academic records upang makapag-desisyon sa ${eligibilityType.toLowerCase()}. Kailangan munang kumpletuhin ang mga quarterly/final grades.`;
  } else if (isAcademicallyPassing) {
    // Lahat ay kumpleto at pasado -> Eligible
    status = "Eligible";
    detailedStatus = isG12 ? "ELIGIBLE_FOR_GRADUATION" : "ELIGIBLE_FOR_PROGRESSION";
    taglishAdvisory = isG12
      ? "Lahat ng academic requirements, Work Immersion, at SF9/SF10 records ay kumpleto at verified. Maaari nang aprubahan ng Principal ang graduation eligibility."
      : "Lahat ng Grade 11 subject requirements at document records ay kumpleto at verified. Maaari nang aprubahan ng Principal ang Grade 11 progression.";
    reasons.push(
      gradeLevel === "Grade 11"
        ? "Satisfied all Grade 11 curriculum subject requirements."
        : "Satisfied all Senior High School graduation requirements."
    );
  }

  // Principal Authorization Policy:
  // Tanging kapag "Eligible" ang status AT 100% kumpleto ang mga dokumento AT walang pending attendance review
  const canPrincipalApprove =
    status === "Eligible" &&
    docs.isComplete &&
    docs.identityStatus !== "IDENTITY_REVIEW_REQUIRED" &&
    !hasPendingAttendanceReview;

  // Resolve current approval decision
  let approvalDecision: PrincipalApprovalDecision = "Pending";
  if (input.existingApproval?.decision === "Approved") {
    approvalDecision = "Approved";
  } else if (input.existingApproval?.decision === "Not Approved") {
    approvalDecision = "Not Approved";
  }

  return {
    gradeLevel,
    eligibilityType,
    status,
    detailedStatus,
    approvalDecision,
    academicCategory,
    attendanceCategory,
    documentCategory,
    taglishAdvisory,
    isAcademicallyPassing,
    canPrincipalApprove,
    reasons,
    blockingFactors,
    totalSubjects: subjects.length,
    passedSubjectsCount: passedCount,
    failedSubjectsCount: failedCount,
    missingSubjectsCount: missingCount,
    remedialResolvedCount,
    existingApproval: input.existingApproval,
  };
}

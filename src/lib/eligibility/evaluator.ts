/**
 * DepEd Senior High School Academic Eligibility Evaluator.
 *
 * Scoped to Taysan Resettlement Integrated School (TRIS), DepEd School ID 300792.
 * Grades 11 and 12 only.
 *
 * Implements strict DepEd criteria:
 * - Grade 11: Progression to Grade 12
 * - Grade 12: Graduation
 * - ZERO grade fabrication / zero recalculation of missing source grades.
 * - Missing document NEVER classifies student as academically failed; places on hold ("Needs Review").
 * - Statuses: Eligible, Not Eligible (RED), Needs Review, Approved, Not Approved.
 */

export type ShsEligibilityType = "Grade 11 Progression" | "Grade 12 Graduation";

export type AcademicEligibilityStatus = "Eligible" | "Not Eligible" | "Needs Review";

export type PrincipalApprovalDecision = "Approved" | "Not Approved" | "Pending";

export interface EvaluatedSubject {
  subject: string;
  finalGrade?: number | null;
  status: "Passed" | "Failed" | "Missing" | "Pending";
  semester?: string | null;
  q1?: number | null;
  q2?: number | null;
  q3?: number | null;
  q4?: number | null;
}

export interface EligibilityEvaluationInput {
  gradeLevel: string;
  schoolYear?: string | null;
  subjects: EvaluatedSubject[];
  documentCompleteness: {
    isComplete: boolean;
    hasSf9: boolean;
    hasSf10: boolean;
    hasPsa: boolean;
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
  approvalDecision: PrincipalApprovalDecision;
  isAcademicallyPassing: boolean;
  canPrincipalApprove: boolean;
  reasons: string[];
  blockingFactors: string[];
  totalSubjects: number;
  passedSubjectsCount: number;
  failedSubjectsCount: number;
  missingSubjectsCount: number;
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
 * - Grade 11: Progression to Grade 12 (kailangang maipasa ang lahat ng G11 subjects)
 * - Grade 12: Graduation (kailangang maipasa ang lahat ng Senior High School curriculum requirements)
 *
 * Napakahalagang DepEd Invariance Rule:
 * 1. Ang kakulangan sa dokumento (hal. missing PSA Birth Certificate) ay HINDI academic failure!
 *    Kaya hindi magiging "Not Eligible" (bagsak) ang estudyante; sa halip, magiging "Needs Review"
 *    ito (naka-hold lang ang promotion approval hanggang makumpleto ang file).
 * 2. Ang "Not Eligible" (Red) ay nakalaan LAMANG sa may aktwal na failing grades (< 75).
 * 3. Zero Grade Fabrication: Hindi nag-iimbento o nagka-calculate ng nawawalang grado ang engine.
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

  // Suriin ang bawat subject laban sa DepEd passing mark (75)
  subjects.forEach((sub) => {
    const finalGrade = typeof sub.finalGrade === "number" ? sub.finalGrade : null;

    if (finalGrade !== null) {
      if (finalGrade >= 75) {
        passedCount++;
      } else {
        failedCount++;
        reasons.push(`Failing mark in ${sub.subject} (${finalGrade}).`);
      }
    } else if (sub.status === "Passed") {
      passedCount++;
    } else if (sub.status === "Failed") {
      failedCount++;
      reasons.push(`Failing grade recorded for ${sub.subject}.`);
    } else {
      missingCount++;
      reasons.push(`Missing final grade for ${sub.subject}.`);
    }
  });

  // Academic assessment: pasado ba sa lahat ng subject?
  const hasAcademicFailure = failedCount > 0;
  const hasIncompleteGrades = subjects.length === 0 || missingCount > 0;
  const isAcademicallyPassing = !hasAcademicFailure && !hasIncompleteGrades && passedCount > 0;

  // Document completeness assessment: kumpleto ba ang SF9, SF10, at PSA?
  // Tandaan: Ang kakulangan ng dokumento ay nagba-block lang sa approval, HINDI ito nagpapabagsak sa grado.
  const docs = input.documentCompleteness;
  if (!docs.isComplete) {
    if (!docs.hasPsa) {
      blockingFactors.push("Missing PSA Birth Certificate.");
    }
    if (!docs.hasSf9) {
      blockingFactors.push("Missing SF9 Report Card.");
    }
    if (!docs.hasSf10) {
      blockingFactors.push("Missing SF10 Permanent Record.");
    }
  }

  if (docs.identityStatus === "IDENTITY_REVIEW_REQUIRED") {
    blockingFactors.push("Identity Review Required: Document name or LRN discrepancies detected.");
  }

  let status: AcademicEligibilityStatus = "Needs Review";

  if (hasAcademicFailure) {
    // 1. May bagsak na subject (< 75) -> Not Eligible (Red)
    status = "Not Eligible";
    blockingFactors.push(...reasons.filter(r => r.includes("Failing")));
  } else if (!docs.isComplete || docs.identityStatus === "IDENTITY_REVIEW_REQUIRED" || hasIncompleteGrades) {
    // 2. Pasado ang mga grado pero kulang sa dokumento o may identity conflict -> Needs Review (Amber)
    // Mapoprotektahan ang academic standing ng mag-aaral habang hinihintay ang kulang na dokumento.
    status = "Needs Review";
    if (isAcademicallyPassing) {
      reasons.push("Passing marks in all recorded subjects; official eligibility pending complete document verification.");
    } else if (subjects.length === 0) {
      blockingFactors.push("No official subject grades are attached to this record yet.");
    } else if (missingCount > 0) {
      blockingFactors.push(`${missingCount} subject grade(s) are missing or pending verification.`);
    }
  } else if (isAcademicallyPassing) {
    // 3. Pasado sa lahat ng subjects AT kumpleto ang dokumento -> Eligible (Green)
    status = "Eligible";
    reasons.push(
      gradeLevel === "Grade 11"
        ? "Satisfied all Grade 11 curriculum subject requirements."
        : "Satisfied all Senior High School graduation requirements."
    );
  }

  // Principal Authorization Policy:
  // Tanging kapag "Eligible" ang status AT 100% kumpleto ang mga dokumento
  // saka lamang mae-enable ang "Approve Eligibility" button para sa School Head.
  const canPrincipalApprove = status === "Eligible" && docs.isComplete && docs.identityStatus !== "IDENTITY_REVIEW_REQUIRED";

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
    approvalDecision,
    isAcademicallyPassing,
    canPrincipalApprove,
    reasons,
    blockingFactors,
    totalSubjects: subjects.length,
    passedSubjectsCount: passedCount,
    failedSubjectsCount: failedCount,
    missingSubjectsCount: missingCount,
    existingApproval: input.existingApproval,
  };
}

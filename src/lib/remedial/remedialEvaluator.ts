/**
 * REMEDIAL CLASS DETECTION & MANAGEMENT MODULE
 * 
 * Bakit ito kailangan para sa Taysan Resettlement Integrated School (School ID 300792):
 * Sa DepEd K-12 Senior High School Curriculum (DO 8, s. 2015):
 * 1. Kapag ang isang mag-aaral ay nakakuha ng final grade na mas mababa sa 75 sa anumang subject,
 *    hindi ito nangangahulugan na agad-agad siyang permanenteng bagsak o hindi na makakatapos.
 * 2. Ang student ay binibigyan ng pagkakataong mag-remedial class (tuwing bakasyon o semestral break).
 * 3. Matapos ang remedial class, kinakalkula ang "Recomputed Final Grade" gamit ang opisyal na DepEd formula:
 *    Recomputed Final Grade = round((Original Final Grade + Remedial Class Mark) / 2)
 * 4. Kapag ang Recomputed Final Grade ay 75 o pataas, nagiging "REMEDIAL_PASSED" ito at nalilinis ang academic deficiency.
 * 5. Bawal mag-auto-clear: Kailangang may opisyal na patunay (Certificate of Recomputed Final Grade)
 *    at beripikasyon ng authorized Teacher bago maaprubahan ang graduation eligibility.
 */

export type RemedialStatus =
  | "PASSED"
  | "REMEDIAL_REQUIRED"
  | "REMEDIAL_IN_PROGRESS"
  | "REMEDIAL_COMPLETED_PENDING_VERIFICATION"
  | "REMEDIAL_PASSED"
  | "REMEDIAL_FAILED"
  | "ACADEMIC_REVIEW_REQUIRED";

export interface SubjectRemedialInput {
  subject: string;
  semester?: string | null;
  finalGrade?: number | string | null;
  remedialClassMark?: number | string | null;
  recomputedFinalGrade?: number | string | null;
  statusOverride?: RemedialStatus | null;
  supportingDocumentRef?: string | null;
  isVerifiedByTeacher?: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  teacherNotes?: string | null;
}

export interface RemedialAssessmentItem {
  subject: string;
  semester?: string | null;
  originalFinalGrade: number;
  remedialClassMark?: number | null;
  recomputedFinalGrade?: number | null;
  status: RemedialStatus;
  isDeficiencyResolved: boolean;
  requiresTeacherVerification: boolean;
  supportingDocumentRef?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  advisoryMessage: string;
  teacherNotes?: string | null;
}

export interface RemedialSummary {
  items: RemedialAssessmentItem[];
  totalDeficiencies: number;
  unresolvedDeficienciesCount: number;
  resolvedDeficienciesCount: number;
  overallAcademicStanding: "PASSED" | "REMEDIAL_REQUIRED" | "REMEDIAL_IN_PROGRESS" | "ACADEMIC_REVIEW_REQUIRED";
  summaryMessage: string;
  canProceedToGraduationReview: boolean;
}

/**
 * DEPED OFFICIAL RECOMPUTED FINAL GRADE FORMULA (DO 8, s. 2015)
 *
 * Formula: round((Final Grade + Remedial Class Mark) / 2)
 *
 * Pareho itong katumbas ng: (Final Grade * 0.5) + (Remedial Class Mark * 0.5)
 * Gumagamit ng standard round-half-up upang makuha ang opisyal na buong numero.
 */
export function computeDepEdRecomputedGrade(
  originalFinalGrade: number | string | undefined | null,
  remedialClassMark: number | string | undefined | null
): number | undefined {
  if (originalFinalGrade === undefined || originalFinalGrade === null || remedialClassMark === undefined || remedialClassMark === null) {
    return undefined;
  }

  const strOrig = String(originalFinalGrade).trim();
  const strRem = String(remedialClassMark).trim();

  if (strOrig === "" || strRem === "" || strOrig === "-" || strRem === "-") {
    return undefined;
  }

  const numOrig = typeof originalFinalGrade === "number" ? originalFinalGrade : parseFloat(strOrig);
  const numRem = typeof remedialClassMark === "number" ? remedialClassMark : parseFloat(strRem);

  if (isNaN(numOrig) || isNaN(numRem)) {
    return undefined;
  }

  // DepEd formula: 50% original final grade + 50% remedial class mark
  return Math.round((numOrig + numRem) / 2);
}

/**
 * EVALUATE SINGLE SUBJECT REMEDIATION STATUS
 *
 * Sinusuri ang estado ng isang subject para malaman kung kailangan ng remedial,
 * kung naipasa na ito, o kung kailangan pa ng verification ng Teacher.
 */
export function evaluateSubjectRemediation(input: SubjectRemedialInput): RemedialAssessmentItem | null {
  const finalGradeVal = input.finalGrade;
  if (finalGradeVal === undefined || finalGradeVal === null || String(finalGradeVal).trim() === "") {
    return null;
  }

  const origNum = typeof finalGradeVal === "number" ? finalGradeVal : parseFloat(String(finalGradeVal).trim());
  if (isNaN(origNum)) {
    return null;
  }

  // Kung 75 o pataas, pasado ang subject ayon sa DepEd passing mark
  if (origNum >= 75) {
    return {
      subject: input.subject,
      semester: input.semester,
      originalFinalGrade: origNum,
      remedialClassMark: null,
      recomputedFinalGrade: origNum,
      status: "PASSED",
      isDeficiencyResolved: true,
      requiresTeacherVerification: false,
      advisoryMessage: `Pasado ang student sa ${input.subject} (${origNum}).`,
    };
  }

  // Kapag mas mababa sa 75: MAY ACADEMIC DEFICIENCY (< 75)
  // Alamin kung may remedial class mark o recomputed grade na naitala
  const remMarkVal = input.remedialClassMark;
  const remMarkNum = remMarkVal !== undefined && remMarkVal !== null && String(remMarkVal).trim() !== ""
    ? (typeof remMarkVal === "number" ? remMarkVal : parseFloat(String(remMarkVal).trim()))
    : undefined;

  let computedFinal = typeof input.recomputedFinalGrade === "number"
    ? input.recomputedFinalGrade
    : (remMarkNum !== undefined && !isNaN(remMarkNum) ? computeDepEdRecomputedGrade(origNum, remMarkNum) : undefined);

  const isVerified = Boolean(input.isVerifiedByTeacher);

  // Status mapping logic
  let status: RemedialStatus = "REMEDIAL_REQUIRED";
  let isDeficiencyResolved = false;
  let advisoryMessage = `May failing grade ang student sa ${input.subject} (${origNum}). Kailangan ng academic review at applicable remedial requirements bago ma-clear ang graduation eligibility.`;

  if (input.statusOverride) {
    status = input.statusOverride;
  } else if (remMarkNum !== undefined && !isNaN(remMarkNum)) {
    if (computedFinal !== undefined && computedFinal >= 75) {
      if (isVerified) {
        status = "REMEDIAL_PASSED";
        isDeficiencyResolved = true;
        advisoryMessage = `Naipasa ng student ang remedial class sa ${input.subject} na may recomputed grade na ${computedFinal} (orihinal: ${origNum}). Na-clear na ang academic deficiency matapos ma-verify ng guro.`;
      } else {
        status = "REMEDIAL_COMPLETED_PENDING_VERIFICATION";
        isDeficiencyResolved = false;
        advisoryMessage = `May naitalang remedial result sa ${input.subject} (Recomputed: ${computedFinal}), ngunit kailangan muna itong i-verify ng guro bago i-clear ang eligibility.`;
      }
    } else if (computedFinal !== undefined && computedFinal < 75) {
      if (isVerified) {
        status = "REMEDIAL_FAILED";
        isDeficiencyResolved = false;
        advisoryMessage = `Hindi umabot sa passing mark (75) ang recomputed grade (${computedFinal}) ng student sa ${input.subject}. Kailangan itong ulitin ayon sa DepEd policy.`;
      } else {
        status = "REMEDIAL_COMPLETED_PENDING_VERIFICATION";
        isDeficiencyResolved = false;
        advisoryMessage = `May naitalang remedial mark sa ${input.subject} ngunit hindi umabot sa 75 ang recomputed grade (${computedFinal}). Pending teacher verification.`;
      }
    }
  }

  return {
    subject: input.subject,
    semester: input.semester,
    originalFinalGrade: origNum,
    remedialClassMark: remMarkNum !== undefined && !isNaN(remMarkNum) ? remMarkNum : null,
    recomputedFinalGrade: computedFinal !== undefined ? computedFinal : null,
    status,
    isDeficiencyResolved,
    requiresTeacherVerification: !isVerified && status !== "PASSED",
    supportingDocumentRef: input.supportingDocumentRef || null,
    verifiedBy: input.verifiedBy || null,
    verifiedAt: input.verifiedAt || null,
    advisoryMessage,
    teacherNotes: input.teacherNotes || null,
  };
}

/**
 * SUMMARIZE REMEDIATION STATUSES FOR STUDENT
 *
 * Sinusuri ang lahat ng subject ng estudyante upang bumuo ng komprehensibong remedial summary.
 */
export function evaluateStudentRemediationSummary(subjects: SubjectRemedialInput[]): RemedialSummary {
  const items: RemedialAssessmentItem[] = [];

  subjects.forEach((sub) => {
    const assessed = evaluateSubjectRemediation(sub);
    if (assessed) {
      items.push(assessed);
    }
  });

  const deficiencies = items.filter((item) => item.originalFinalGrade < 75);
  const unresolved = deficiencies.filter((item) => !item.isDeficiencyResolved);
  const resolved = deficiencies.filter((item) => item.isDeficiencyResolved);

  let overallAcademicStanding: "PASSED" | "REMEDIAL_REQUIRED" | "REMEDIAL_IN_PROGRESS" | "ACADEMIC_REVIEW_REQUIRED" = "PASSED";
  let summaryMessage = "Lahat ng evaluated subjects ay pasado ayon sa DepEd criteria.";

  if (unresolved.length > 0) {
    const hasPendingVerification = unresolved.some((i) => i.status === "REMEDIAL_COMPLETED_PENDING_VERIFICATION");
    const hasInProgress = unresolved.some((i) => i.status === "REMEDIAL_IN_PROGRESS");

    if (hasPendingVerification) {
      overallAcademicStanding = "ACADEMIC_REVIEW_REQUIRED";
      summaryMessage = `May ${unresolved.length} subject deficiency na may remedial record ngunit kailangan ng opisyal na teacher verification.`;
    } else if (hasInProgress) {
      overallAcademicStanding = "REMEDIAL_IN_PROGRESS";
      summaryMessage = `Kasalukuyang sumasailalim ang student sa remedial class para sa ${unresolved.length} subject(s).`;
    } else {
      overallAcademicStanding = "REMEDIAL_REQUIRED";
      const subjectNames = unresolved.map((u) => `${u.subject} (${u.originalFinalGrade})`).join(", ");
      summaryMessage = `May failing subject(s) ang student na kailangang i-remedial: ${subjectNames}. Naka-hold muna ang graduation/progression eligibility.`;
    }
  } else if (deficiencies.length > 0 && resolved.length === deficiencies.length) {
    overallAcademicStanding = "PASSED";
    summaryMessage = `Naresolba at naipasa na ng student ang lahat ng ${resolved.length} remedial subject(s) na may kaukulang teacher verification.`;
  }

  return {
    items,
    totalDeficiencies: deficiencies.length,
    unresolvedDeficienciesCount: unresolved.length,
    resolvedDeficienciesCount: resolved.length,
    overallAcademicStanding,
    summaryMessage,
    canProceedToGraduationReview: unresolved.length === 0,
  };
}

/**
 * DEPED K-12 ACADEMIC EXCELLENCE AWARDEE EVALUATION ENGINE
 *
 * Applicable Guidelines & Official Policies:
 * - DepEd Order No. 36, s. 2016: "Policy Guidelines on Awards and Recognition
 *   for the K to 12 Basic Education Program" (Effective SY 2016-2017 to SY 2025-2026)
 * - DepEd Memorandum No. 030, s. 2021: "Clarifications on the Recognition of
 *   Academic Excellence Awardees Per DepEd Order No. 36, s. 2016" (Mandatory
 *   alphabetical order within award categories; prohibition of decimal ranking)
 * - DepEd Order No. 015, s. 2026: "Revised Guidelines on Classroom Assessment,
 *   Grading System, and Awards and Recognition for the K to 12 Basic Education Program"
 *   (Effective SY 2026-2027 onwards; provisional implementation awaiting full Division Gazette)
 *
 * Core Tenets & Compliance Mandates:
 * 1. Strict Prohibition of Class Ranking:
 *    - DepEd Order No. 36, s. 2016, DM 030, s. 2021, and DO 015, s. 2026 explicitly
 *      FORBID numerical ranking (1st, 2nd, 3rd, etc.) of academic awardees.
 *    - Awardees must be presented in ALPHABETICAL ORDER by surname within each award category.
 *    - Decimal differences in General Average must NOT be used to prioritize or rank
 *      learners within the same award category.
 * 2. Separate Quarterly vs. Final Subject Grade Floors:
 *    - DO 36, s. 2016: Final grade floor in any subject is 85; quarterly grade floor is 80.
 *      Learners with quarterly grades between 80 and 84 are NOT disqualified if their final
 *      subject grade reaches 85.
 *    - DO 015, s. 2026: Final grade floor is 80 in all learning areas (85 requirement abolished).
 * 3. Human Verification & Audit Preservation:
 *    - Unverified grades or calculation discrepancies CANNOT receive premature award decisions.
 *    - Original printed SF9 grades remain authoritative until human teacher verification.
 *    - Full decimal precision (preciseAverage) is preserved for audit trails and transcripts.
 */

import {
  parseQuarterNumeric,
  roundDisplayedGrade,
  formatDisplayedGrade,
  formatPreciseGrade,
} from "../validation/gradeUtils";

export type DepEdAcademicAward =
  | "With Highest Honors"
  | "With High Honors"
  | "With Honors"
  | "Academic Excellence Award"
  | "None";

export type AwardPolicyVersion =
  | "DO_36_S_2016"
  | "DM_030_S_2021"
  | "DO_015_S_2026_PROVISIONAL";

export interface AwardPolicyConfig {
  policyVersion: AwardPolicyVersion;
  policyReference: string;
  isProvisional: boolean;
  requiresAlphabeticalPresentation: boolean;
  prohibitsRanking: boolean;
  finalGradeFloor: number; // 85 in DO 36; 80 in DO 015
  quarterlyGradeFloor?: number; // 80 in DO 36; undefined in DO 015
  allowThreeHonorTiers: boolean;
}

export interface AwardSubjectGrade {
  subject: string;
  finalGrade?: number | string | null;
  q1?: number | string | null;
  q2?: number | string | null;
  q3?: number | string | null;
  q4?: number | string | null;
  status?: string | null;
  needsVerification?: boolean | null;
  has_calculation_discrepancy?: boolean | null;
  preciseComputedGrade?: number | null;
}

export interface StudentAwardCandidate {
  studentId: string;
  lrn: string;
  studentName: string;
  gradeLevel: string;
  section?: string;
  schoolYear: string;
  curriculumId?: string;
  semester?: "1st Semester" | "2nd Semester" | "Full Year";
  grades: AwardSubjectGrade[];
  preciseAverage?: number;
  disciplinarySanctions?: boolean;
}

export interface EvaluatedAwardee {
  studentId: string;
  lrn: string;
  studentName: string;
  gradeLevel: string;
  section?: string;
  schoolYear: string;
  semester?: string;
  curriculumId?: string;
  preciseAverage: number;
  displayedAverage: number;
  award: DepEdAcademicAward;
  awardTagalog: string;
  isEligibleForAward: boolean;
  disqualificationReasons: string[];
  qualifyingSubjectCount: number;
  presentationOrder: "alphabetical";
  rank?: undefined; // Deprecated per DepEd DO 36 / DM 30 / DO 15; kept undefined
  isTied?: boolean;
  evaluationReference: string;
  policyVersion: AwardPolicyVersion;
  isProvisionalPolicy?: boolean;
}

/**
 * Resolves the applicable DepEd award policy based on school year and curriculum.
 */
export function resolveAwardPolicy(
  schoolYear?: string | null,
  curriculumId?: string | null
): AwardPolicyConfig {
  const syTrim = (schoolYear || "").trim();
  const syMatch = syTrim.match(/^(\d{4})/);
  const startYear = syMatch ? parseInt(syMatch[1], 10) : 2025;

  // SY 2026-2027 onwards (Strengthened SHS Curriculum / DO 015, s. 2026)
  // Isolated behind provisional configuration awaiting official Division Gazette IRR
  if (startYear >= 2026 || (curriculumId && curriculumId.toLowerCase().includes("sshs"))) {
    return {
      policyVersion: "DO_015_S_2026_PROVISIONAL",
      policyReference: "DepEd Order No. 015, s. 2026 (Provisional / Pending Official Division Gazette)",
      isProvisional: true,
      requiresAlphabeticalPresentation: true,
      prohibitsRanking: true,
      finalGradeFloor: 80,
      quarterlyGradeFloor: undefined,
      allowThreeHonorTiers: false,
    };
  }

  // SY 2020-2021 pandemic period with DM 030, s. 2021 clarification
  if (startYear === 2020) {
    return {
      policyVersion: "DM_030_S_2021",
      policyReference: "DepEd Order No. 36, s. 2016 / DepEd Memorandum No. 030, s. 2021",
      isProvisional: false,
      requiresAlphabeticalPresentation: true,
      prohibitsRanking: true,
      finalGradeFloor: 85,
      quarterlyGradeFloor: 80,
      allowThreeHonorTiers: true,
    };
  }

  // Standard K-12 Basic Education (SY 2016-2017 to SY 2025-2026)
  return {
    policyVersion: "DO_36_S_2016",
    policyReference: "DepEd Order No. 36, s. 2016 / DM 030, s. 2021",
    isProvisional: false,
    requiresAlphabeticalPresentation: true,
    prohibitsRanking: true,
    finalGradeFloor: 85,
    quarterlyGradeFloor: 80,
    allowThreeHonorTiers: true,
  };
}

/**
 * Computes the exact arithmetic mean of subject grades without premature rounding.
 * Preserves decimal precision up to 4 decimal places.
 */
export function computePreciseGeneralAverage(grades: AwardSubjectGrade[]): {
  preciseAverage?: number;
  displayedAverage?: number;
  subjectCount: number;
  hasIncomplete: boolean;
  incompleteSubjects: string[];
} {
  if (!Array.isArray(grades) || grades.length === 0) {
    return { subjectCount: 0, hasIncomplete: true, incompleteSubjects: [] };
  }

  let totalSum = 0;
  let count = 0;
  const incompleteSubjects: string[] = [];

  for (const g of grades) {
    if (!g.subject || g.subject.trim() === "") continue;

    // Use finalGrade (authoritative printed/recorded grade) or fallback to preciseComputedGrade
    let gradeNum: number | undefined = undefined;
    if (g.finalGrade !== undefined && g.finalGrade !== null) {
      gradeNum = parseQuarterNumeric(g.finalGrade);
    } else if (typeof g.preciseComputedGrade === "number" && !isNaN(g.preciseComputedGrade)) {
      gradeNum = g.preciseComputedGrade;
    }

    if (gradeNum === undefined || isNaN(gradeNum)) {
      incompleteSubjects.push(g.subject);
      continue;
    }

    totalSum += gradeNum;
    count++;
  }

  if (count === 0 || incompleteSubjects.length > 0) {
    return {
      subjectCount: count,
      hasIncomplete: incompleteSubjects.length > 0,
      incompleteSubjects,
    };
  }

  const rawMean = totalSum / count;
  const preciseAverage = Number(rawMean.toFixed(4));
  const displayedAverage = Math.round(preciseAverage);

  return {
    preciseAverage,
    displayedAverage,
    subjectCount: count,
    hasIncomplete: false,
    incompleteSubjects: [],
  };
}

/**
 * Extracts student surname for standard DepEd alphabetical sorting.
 */
export function extractStudentSurname(fullName: string): string {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return "";
  if (trimmed.includes(",")) {
    return trimmed.split(",")[0].trim().toLowerCase();
  }
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Evaluates a single student candidate against the applicable DepEd award policy.
 */
export function evaluateStudentForAcademicAward(
  candidate: StudentAwardCandidate,
  policyOverride?: AwardPolicyConfig
): EvaluatedAwardee {
  const policy = policyOverride || resolveAwardPolicy(candidate.schoolYear, candidate.curriculumId);
  const disqualificationReasons: string[] = [];

  // 1. Calculate General Average with full decimal precision
  let preciseAvg: number;
  let displayedAvg: number;
  let subjectCount: number;

  if (typeof candidate.preciseAverage === "number" && !isNaN(candidate.preciseAverage)) {
    preciseAvg = candidate.preciseAverage;
    displayedAvg = Math.round(preciseAvg);
    subjectCount = candidate.grades.length;
  } else {
    const avgResult = computePreciseGeneralAverage(candidate.grades);
    if (avgResult.hasIncomplete || avgResult.preciseAverage === undefined) {
      return {
        studentId: candidate.studentId,
        lrn: candidate.lrn,
        studentName: candidate.studentName,
        gradeLevel: candidate.gradeLevel,
        section: candidate.section,
        schoolYear: candidate.schoolYear,
        semester: candidate.semester,
        curriculumId: candidate.curriculumId,
        preciseAverage: 0,
        displayedAverage: 0,
        award: "None",
        awardTagalog: "Walang Karangalan",
        isEligibleForAward: false,
        disqualificationReasons: [
          `Incomplete academic marks: Missing grade in ${avgResult.incompleteSubjects.join(", ")}`,
        ],
        qualifyingSubjectCount: avgResult.subjectCount,
        presentationOrder: "alphabetical",
        evaluationReference: policy.policyReference,
        policyVersion: policy.policyVersion,
        isProvisionalPolicy: policy.isProvisional,
      };
    }
    preciseAvg = avgResult.preciseAverage;
    displayedAvg = avgResult.displayedAverage ?? Math.round(preciseAvg);
    subjectCount = avgResult.subjectCount;
  }

  // 2. Teacher Verification & Discrepancy Gate:
  // Incomplete or unverified records cannot receive premature award decisions
  const unverifiedSubjects: string[] = [];
  for (const g of candidate.grades) {
    if (!g.subject || g.subject.trim() === "") continue;
    if (g.needsVerification || g.has_calculation_discrepancy || g.status === "Missing") {
      unverifiedSubjects.push(g.subject);
    }
  }

  if (unverifiedSubjects.length > 0) {
    disqualificationReasons.push(
      `Pending teacher verification: Unverified marks or discrepancies in ${unverifiedSubjects.join(", ")}.`
    );
  }

  // 3. Minimum Grade Checks per Policy Version
  const failingItems: string[] = [];
  const subFloorFinalItems: string[] = [];
  const subFloorQuarterItems: string[] = [];

  for (const g of candidate.grades) {
    if (!g.subject || g.subject.trim() === "") continue;

    // Check final grade in subject
    const fin = parseQuarterNumeric(g.finalGrade ?? g.preciseComputedGrade);
    if (fin !== undefined) {
      if (fin < 75) {
        failingItems.push(`${g.subject} final grade is ${fin} (< 75 Failed)`);
      } else if (fin < policy.finalGradeFloor) {
        subFloorFinalItems.push(
          `${g.subject} final grade is ${fin} (< ${policy.finalGradeFloor} minimum threshold)`
        );
      }
    }

    // Check quarterly marks
    if (policy.quarterlyGradeFloor !== undefined) {
      const quarters = [
        { name: "Q1", val: parseQuarterNumeric(g.q1) },
        { name: "Q2", val: parseQuarterNumeric(g.q2) },
        { name: "Q3", val: parseQuarterNumeric(g.q3) },
        { name: "Q4", val: parseQuarterNumeric(g.q4) },
      ];

      for (const q of quarters) {
        if (q.val !== undefined) {
          if (q.val < 75) {
            failingItems.push(`${g.subject} ${q.name} is ${q.val} (< 75 Failed)`);
          } else if (q.val < policy.quarterlyGradeFloor) {
            // Under DO 36: Floor is 80. Quarterly grades 80-84 are ALLOWED.
            subFloorQuarterItems.push(
              `${g.subject} ${q.name} is ${q.val} (< ${policy.quarterlyGradeFloor} quarterly floor)`
            );
          }
        }
      }
    }
  }

  if (failingItems.length > 0) {
    disqualificationReasons.push(
      `Failed learning area(s) detected: ${failingItems.join("; ")}`
    );
  }

  if (subFloorFinalItems.length > 0) {
    disqualificationReasons.push(
      `Final subject grade below policy minimum: ${subFloorFinalItems.join("; ")}`
    );
  }

  if (subFloorQuarterItems.length > 0) {
    disqualificationReasons.push(
      `Quarterly grade below policy floor: ${subFloorQuarterItems.join("; ")}`
    );
  }

  // 4. Disciplinary Sanctions Check
  if (candidate.disciplinarySanctions) {
    disqualificationReasons.push(
      "Learner has recorded formal disciplinary sanctions violating conduct criteria."
    );
  }

  // 5. Determine Award Category based on General Average & Policy Version
  let candidateAward: DepEdAcademicAward = "None";
  let awardTagalog = "Walang Karangalan";

  if (policy.allowThreeHonorTiers) {
    // DepEd DO 36, s. 2016 / DM 030, s. 2021 Tiers:
    // With Highest Honors: 98.00 - 100.00
    // With High Honors: 95.00 - 97.99
    // With Honors: 90.00 - 94.99
    if (preciseAvg >= 98.0) {
      candidateAward = "With Highest Honors";
      awardTagalog = "May Pinakamataas na Karangalan";
    } else if (preciseAvg >= 95.0) {
      candidateAward = "With High Honors";
      awardTagalog = "May Mataas na Karangalan";
    } else if (preciseAvg >= 90.0) {
      candidateAward = "With Honors";
      awardTagalog = "May Karangalan";
    } else {
      candidateAward = "None";
      awardTagalog = "Walang Karangalan";
      disqualificationReasons.push(
        `General Average ${formatPreciseGrade(preciseAvg)} is below the minimum honors threshold of 90.00.`
      );
    }
  } else {
    // DepEd DO 015, s. 2026 (Provisional): Single Academic Excellence Award (GA >= 90.00)
    if (preciseAvg >= 90.0) {
      candidateAward = "Academic Excellence Award";
      awardTagalog = "Gawad sa Kahusayan sa Akademiko";
    } else {
      candidateAward = "None";
      awardTagalog = "Walang Karangalan";
      disqualificationReasons.push(
        `General Average ${formatPreciseGrade(preciseAvg)} is below the minimum threshold of 90.00.`
      );
    }
  }

  const isEligible = disqualificationReasons.length === 0 && candidateAward !== "None";

  return {
    studentId: candidate.studentId,
    lrn: candidate.lrn,
    studentName: candidate.studentName,
    gradeLevel: candidate.gradeLevel,
    section: candidate.section,
    schoolYear: candidate.schoolYear,
    semester: candidate.semester,
    curriculumId: candidate.curriculumId,
    preciseAverage: preciseAvg,
    displayedAverage: displayedAvg,
    award: isEligible ? candidateAward : "None",
    awardTagalog: isEligible ? awardTagalog : "Walang Karangalan",
    isEligibleForAward: isEligible,
    disqualificationReasons,
    qualifyingSubjectCount: subjectCount,
    presentationOrder: "alphabetical",
    evaluationReference: policy.policyReference,
    policyVersion: policy.policyVersion,
    isProvisionalPolicy: policy.isProvisional,
  };
}

/**
 * Compares two students alphabetically by surname for presentation.
 */
export function compareAwardeesAlphabetically(
  a: { studentName: string },
  b: { studentName: string }
): number {
  const surnameA = extractStudentSurname(a.studentName);
  const surnameB = extractStudentSurname(b.studentName);
  const surnameComp = surnameA.localeCompare(surnameB, "fil");
  if (surnameComp !== 0) return surnameComp;
  return a.studentName.localeCompare(b.studentName, "fil");
}

/**
 * Presents awardees grouped by category and strictly ordered ALPHABETICALLY by surname.
 *
 * Compliance:
 * - DepEd DO 36, s. 2016 & DM 030, s. 2021: Strict prohibition on class ranking.
 * - Awardees are presented alphabetically by surname within each award category.
 * - Does NOT use decimal differences to rank or sequence learners within the same category.
 * - Preserves preciseAverage and displayedAverage for audit and transcript purposes.
 */
export function presentAwardeesAlphabetically(
  candidates: StudentAwardCandidate[],
  options: { includeNonAwardees?: boolean } = {}
): EvaluatedAwardee[] {
  // 1. Evaluate each student individually under the applicable policy
  const evaluated = candidates.map((c) => evaluateStudentForAcademicAward(c));

  // 2. Filter if requested
  const pool = options.includeNonAwardees
    ? evaluated
    : evaluated.filter((e) => e.isEligibleForAward);

  // 3. Define DepEd Award Category Presentation Hierarchy
  const categoryOrder: Record<DepEdAcademicAward, number> = {
    "With Highest Honors": 1,
    "With High Honors": 2,
    "With Honors": 3,
    "Academic Excellence Award": 4,
    "None": 5,
  };

  // 4. Group by category and sort ALPHABETICALLY by surname within each category
  pool.sort((a, b) => {
    const catDiff = categoryOrder[a.award] - categoryOrder[b.award];
    if (catDiff !== 0) return catDiff;
    // Strict Alphabetical Presentation: No decimal ranking!
    return compareAwardeesAlphabetically(a, b);
  });

  return pool;
}

/**
 * Backward compatibility alias for presentAwardeesAlphabetically.
 * Deprecates numerical ranking and enforces DepEd alphabetical presentation.
 */
export function rankAwardees(
  candidates: StudentAwardCandidate[],
  options: { includeNonAwardees?: boolean } = {}
): EvaluatedAwardee[] {
  return presentAwardeesAlphabetically(candidates, options);
}

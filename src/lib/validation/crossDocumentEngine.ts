/**
 * SENIOR HIGH SCHOOL CROSS-DOCUMENT VALIDATION ENGINE
 *
 * Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 500169
 * Scope: Exclusively Senior High School (Grades 11 & 12)
 *
 * Implements the 7 pairwise comparators across the 6 governing SHS document types:
 *   1. PSA_SF1: Civil Identity ↔ School Register Enrollment
 *   2. SF1_SF2: School Register Enrollment ↔ Daily Attendance Sheet
 *   3. SF1_SF5: School Register Enrollment ↔ Semester Promotion Status (SF5A/SF5B)
 *   4. SF1_SF9: School Register Enrollment ↔ Learner Report Card
 *   5. SF9_SF10: Learner Report Card ↔ Cumulative Permanent Academic Record
 *   6. SF5_SF9: SF5A Status & Deficiencies ↔ Report Card Semestral Grades
 *   7. SF5_SF10: SF5B Graduation Clearance ↔ Cumulative Permanent Record
 *
 * Plus 360° Consolidated SHS Evaluation:
 *   - evaluateConsolidatedShsStudent()
 *
 * Note on PSA Birth Certificate Privacy & Integrity:
 *   - Strictly supporting civil identity evidence.
 *   - Never overwrites student profiles automatically.
 *   - Never influences academic grades, attendance, or promotion calculations.
 */

import { normalizeNamePart, normalizeSuffix, normalizeDate } from "./nameComparison";
import {
  compareBirthDates,
  toIsoBirthDate,
  normalizeBirthDate,
  shuffleBirthDate,
  formatBirthDateWithDocLabel,
  formatBirthDateDisplay,
  type SplitBirthDateFields,
} from "./birthDateNormalizer";
import { levenshteinDistance } from "./studentMatcher";
import { evaluateDynamicGradeStatus, isBlankOrMissingFinal, normalizeObservedValueMarking, sanitizeLearnersObservedValues } from "./gradeUtils";
export { normalizeObservedValueMarking, sanitizeLearnersObservedValues };
export {
  normalizeBirthDate,
  toIsoBirthDate,
  formatBirthDateDisplay,
  compareBirthDates,
  monthToNumber,
  monthToFullName,
  monthToAbbreviation,
  shuffleBirthDate,
  formatBirthDateWithDocLabel,
} from "./birthDateNormalizer";
import { normalizeSex, normalizeLrn, isValidLrn } from "./patterns";
import { normalizeStrictSex, validateConsecutiveSchoolYear } from "./gradeUtils";
export { normalizeSex, normalizeStrictSex, validateConsecutiveSchoolYear, normalizeLrn, isValidLrn };
import {
  normalizeDepEdMonthKey,
  formatDepEdMonthDisplay,
  getDepEdMonthFullName,
  getDepEdMonthShortLabel,
  isDepEdMonthMatch,
  DEPED_11_MONTHS,
  DEPED_MONTH_CONFIG,
  type CanonicalDepEdMonthKey,
} from "./monthNormalizer";
export {
  normalizeDepEdMonthKey,
  formatDepEdMonthDisplay,
  getDepEdMonthFullName,
  getDepEdMonthShortLabel,
  isDepEdMonthMatch,
  DEPED_11_MONTHS,
  DEPED_MONTH_CONFIG,
};
import { normalizeSubjectName } from "./gradeComparator";
import { verifyStudentCollision } from "./studentMatcher";
import type {
  CrossDocumentValidationType,
  CrossDocumentValidationStatus,
  Sf1RosterEntry,
  Sf2AttendanceEntry,
  Sf5PromotionEntry,
  PsaIdentityRecord,
} from "@/types/database";

export interface DiscrepancyItem {
  field: string;
  type?: string;
  lrn?: string;
  sourceValue: any;
  targetValue: any;
  severity: "CRITICAL" | "WARNING" | "INFO" | "ERROR";
  description: string;
  category?: "NEEDS_VERIFICATION" | "MISMATCH";
}

export interface PairwiseValidationResult {
  validationType: CrossDocumentValidationType;
  status: CrossDocumentValidationStatus;
  needsHumanReview: boolean;
  schoolYear: string;
  gradeLevel?: "Grade 11" | "Grade 12";
  semester?: "1st Semester" | "2nd Semester" | "Full Year";
  sourceDoc1Id?: string | null;
  sourceDoc2Id?: string | null;
  comparisonResults: Array<{
    field: string;
    doc1Value?: any;
    doc2Value?: any;
    isMatch: boolean;
    notes?: string;
  }>;
  discrepancies: DiscrepancyItem[];
  summaryMessage: string;
}

export interface ConsolidatedShsEvaluationResult {
  studentId: string;
  schoolId: string;
  schoolYear: string;
  gradeLevel?: "Grade 11" | "Grade 12";
  overallStatus: CrossDocumentValidationStatus;
  needsHumanReview: boolean;
  documentCompleteness: {
    sf1: boolean;
    sf2: boolean;
    sf5: boolean;
    sf5a?: boolean;
    sf5b?: boolean;
    sf9: boolean;
    sf10: boolean;
    birth_cert: boolean;
    totalAvailable: number;
    totalRequired: number;
    requiredAvailable?: number;
    hasRequiredCoverage?: boolean;
  };
  pairwiseResults: PairwiseValidationResult[];
  criticalDiscrepanciesCount: number;
  warningDiscrepanciesCount: number;
  summaryMessage: string;
}

// -----------------------------------------------------------------------------
// 1. Comparator: PSA_SF1 (Civil Identity ↔ School Register Enrollment)
// -----------------------------------------------------------------------------

export function comparePsaAndSf1(
  psa: PsaIdentityRecord | {
    last_name?: string;
    first_name?: string;
    middle_name?: string | null;
    suffix?: string | null;
    birth_date?: string;
    sex?: string;
    mother_maiden_name?: string | null;
    father_name?: string | null;
    document_id?: string;
  },
  sf1: Sf1RosterEntry | {
    last_name?: string;
    first_name?: string;
    middle_name?: string | null;
    suffix?: string | null;
    birth_date?: string | null;
    sex?: string;
    parents_details?: Record<string, any>;
    school_year?: string;
    grade_level?: string;
    document_id?: string;
  }
): PairwiseValidationResult {
  const comparisonResults: PairwiseValidationResult["comparisonResults"] = [];
  const discrepancies: DiscrepancyItem[] = [];

  const normPsaLast = normalizeNamePart(psa.last_name);
  const normSf1Last = normalizeNamePart(sf1.last_name);
  const isLastMatch = normPsaLast === normSf1Last;
  comparisonResults.push({
    field: "last_name",
    doc1Value: psa.last_name,
    doc2Value: sf1.last_name,
    isMatch: isLastMatch,
    notes: isLastMatch ? "Exact match" : "Last name spelling difference",
  });
  if (!isLastMatch) {
    discrepancies.push({
      field: "last_name",
      sourceValue: psa.last_name,
      targetValue: sf1.last_name,
      severity: "CRITICAL",
      description: `Civil registry surname "${psa.last_name || ""}" does not match SF1 surname "${sf1.last_name || ""}".`,
    });
  }

  const normPsaFirst = normalizeNamePart(psa.first_name);
  const normSf1First = normalizeNamePart(sf1.first_name);
  const isFirstMatch = normPsaFirst === normSf1First;
  comparisonResults.push({
    field: "first_name",
    doc1Value: psa.first_name,
    doc2Value: sf1.first_name,
    isMatch: isFirstMatch,
    notes: isFirstMatch ? "Exact match" : "First name spelling difference",
  });
  if (!isFirstMatch) {
    discrepancies.push({
      field: "first_name",
      sourceValue: psa.first_name,
      targetValue: sf1.first_name,
      severity: "CRITICAL",
      description: `Civil registry given name "${psa.first_name || ""}" does not match SF1 given name "${sf1.first_name || ""}".`,
    });
  }

  // Middle name / initial check
  const normPsaMid = normalizeNamePart(psa.middle_name);
  const normSf1Mid = normalizeNamePart(sf1.middle_name);
  let isMidMatch = true;
  if (normPsaMid && normSf1Mid) {
    isMidMatch = normPsaMid === normSf1Mid || normPsaMid.startsWith(normSf1Mid) || normSf1Mid.startsWith(normPsaMid);
    comparisonResults.push({
      field: "middle_name",
      doc1Value: psa.middle_name,
      doc2Value: sf1.middle_name,
      isMatch: isMidMatch,
      notes: isMidMatch ? "Matching middle name/initial" : "Middle name discrepancy",
    });
    if (!isMidMatch) {
      discrepancies.push({
        field: "middle_name",
        sourceValue: psa.middle_name,
        targetValue: sf1.middle_name,
        severity: "WARNING",
        description: `Middle name difference: PSA has "${psa.middle_name}", SF1 has "${sf1.middle_name}".`,
      });
    }
  }

  // Suffix check
  const psaSuffix = (psa as any).suffix || "";
  const sf1Suffix = sf1.suffix || "";
  const normPsaSuffix = normalizeSuffix(psaSuffix);
  const normSf1Suffix = normalizeSuffix(sf1Suffix);
  const isSuffixMatch = normPsaSuffix === normSf1Suffix;
  if (normPsaSuffix || normSf1Suffix) {
    comparisonResults.push({
      field: "suffix",
      doc1Value: psaSuffix,
      doc2Value: sf1Suffix,
      isMatch: isSuffixMatch,
      notes: isSuffixMatch ? "Suffix matched" : "Suffix mismatch",
    });
    if (!isSuffixMatch) {
      discrepancies.push({
        field: "suffix",
        sourceValue: psaSuffix,
        targetValue: sf1Suffix,
        severity: "WARNING",
        description: `Generational suffix mismatch: PSA "${psaSuffix || "NONE"}" vs SF1 "${sf1Suffix || "NONE"}".`,
      });
    }
  }

  // Date of birth
  const rawPsaDob = psa.birth_date || (psa as any).date_of_birth;
  const normPsaDob = normalizeDate(rawPsaDob);
  const normSf1Dob = normalizeDate(sf1.birth_date);
  const isDobMatch = !normPsaDob || !normSf1Dob || normPsaDob === normSf1Dob;
  comparisonResults.push({
    field: "date_of_birth",
    doc1Value: rawPsaDob,
    doc2Value: sf1.birth_date,
    isMatch: isDobMatch,
    notes: isDobMatch ? "DOB verified" : "DOB discrepancy",
  });
  if (!isDobMatch) {
    discrepancies.push({
      field: "date_of_birth",
      sourceValue: rawPsaDob,
      targetValue: sf1.birth_date,
      severity: "CRITICAL",
      description: `Date of birth mismatch: PSA "${rawPsaDob}" vs SF1 "${sf1.birth_date}".`,
    });
  }

  // Sex
  const normPsaSex = normalizeStrictSex(psa.sex);
  const normSf1Sex = normalizeStrictSex(sf1.sex);
  const isSexMatch = !normPsaSex || !normSf1Sex || normPsaSex === normSf1Sex;
  comparisonResults.push({
    field: "sex",
    doc1Value: normPsaSex || psa.sex,
    doc2Value: normSf1Sex || sf1.sex,
    isMatch: isSexMatch,
    notes: isSexMatch ? "Sex verified" : "Wrong Sex/Gender mismatch",
  });
  if (!isSexMatch) {
    discrepancies.push({
      field: "sex",
      sourceValue: normPsaSex || psa.sex,
      targetValue: normSf1Sex || sf1.sex,
      severity: "CRITICAL",
      description: `Wrong Sex/Gender: Sex does not match across documents (PSA: ${normPsaSex || psa.sex} vs SF1: ${normSf1Sex || sf1.sex}).`,
    });
  }

  const hasCritical = discrepancies.some((d) => d.severity === "CRITICAL");
  const hasWarning = discrepancies.some((d) => d.severity === "WARNING");

  const status: CrossDocumentValidationStatus = hasCritical
    ? "MISMATCH"
    : hasWarning
    ? "NEEDS_VERIFICATION"
    : "MATCH";

  return {
    validationType: "PSA_SF1",
    status,
    needsHumanReview: hasCritical || hasWarning,
    schoolYear: sf1.school_year || "Unknown",
    gradeLevel: sf1.grade_level?.includes("12") ? "Grade 12" : "Grade 11",
    sourceDoc1Id: psa.document_id,
    sourceDoc2Id: sf1.document_id,
    comparisonResults,
    discrepancies,
    summaryMessage:
      status === "MATCH"
        ? "Civil identity on PSA birth certificate matches SF1 school register enrollment perfectly."
        : `Civil identity conflict between PSA and SF1: ${discrepancies.map((d) => d.description).join("; ")}`,
  };
}

// -----------------------------------------------------------------------------
// 2. Comparator: SF1_SF2 (School Register Enrollment ↔ Daily Attendance Sheet)
// -----------------------------------------------------------------------------

export function compareSf1AndSf2(
  sf1Entry: Sf1RosterEntry | {
    lrn?: string;
    last_name?: string;
    first_name?: string;
    school_year?: string;
    grade_level?: string;
    section?: string;
    document_id?: string;
  },
  sf2Entries: Array<Sf2AttendanceEntry | {
    lrn?: string | null;
    learner_name?: string;
    school_year?: string;
    grade_level?: string;
    section?: string;
    month?: string;
    total_school_days?: number;
    days_present?: number;
    days_absent?: number;
    days_tardy?: number;
    document_id?: string;
  }>
): PairwiseValidationResult {
  const comparisonResults: PairwiseValidationResult["comparisonResults"] = [];
  const discrepancies: DiscrepancyItem[] = [];

  const lrn = sf1Entry.lrn;
  const sf1FullName = [sf1Entry.last_name, sf1Entry.first_name].filter(Boolean).join(" ");
  const matchingAttendance = sf2Entries.filter((a) => {
    if (lrn && a.lrn && a.lrn === lrn) return true;
    const attName = (a as any).learner_name || (a as any).student_name || (a as any).name || "";
    if (!attName) return false;
    const normAtt = normalizeNamePart(attName);
    const normSf1 = normalizeNamePart(sf1FullName);
    if (normAtt && normSf1) {
      if (normAtt === normSf1 || normAtt.includes(normSf1) || normSf1.includes(normAtt)) return true;
      const dist = levenshteinDistance(normAtt, normSf1);
      const maxLen = Math.max(normAtt.length, normSf1.length);
      if (dist <= (maxLen >= 6 ? 2 : 1)) return true;
    }
    if (sf1Entry.last_name) {
      const normSf1Last = normalizeNamePart(sf1Entry.last_name);
      const attParts = attName.split(/[\s,]+/);
      const attLast = normalizeNamePart(attParts[0]);
      if (normSf1Last && attLast) {
        if (normSf1Last === attLast) return true;
        const dist = levenshteinDistance(normSf1Last, attLast);
        if (dist <= (Math.max(normSf1Last.length, attLast.length) >= 6 ? 2 : 1)) return true;
      }
    }
    return false;
  });

  if (matchingAttendance.length === 0) {
    discrepancies.push({
      field: "attendance_record",
      sourceValue: lrn,
      targetValue: null,
      severity: "WARNING",
      description: `Learner (LRN: ${lrn}) is officially enrolled in SF1 but has no attendance entries in SF2 for this period.`,
    });
    return {
      validationType: "SF1_SF2",
      status: "NEEDS_VERIFICATION",
      needsHumanReview: true,
      schoolYear: sf1Entry.school_year || "Unknown",
      gradeLevel: sf1Entry.grade_level?.includes("12") ? "Grade 12" : "Grade 11",
      sourceDoc1Id: sf1Entry.document_id,
      sourceDoc2Id: null,
      comparisonResults: [{
        field: "roster_presence",
        doc1Value: lrn,
        doc2Value: null,
        isMatch: false,
        notes: "Missing attendance records",
      }],
      discrepancies,
      summaryMessage: `Learner with LRN ${lrn} enrolled in SF1 has no corresponding SF2 monthly attendance entries.`,
    };
  }

  for (const att of matchingAttendance) {
    const totalDays = att.total_school_days ?? 0;
    const present = att.days_present ?? 0;
    const absent = att.days_absent ?? 0;

    // Check attendance sum plausibility
    const sumPlausible = totalDays > 0 ? present + absent <= totalDays : true;
    const tardy = (att as any).days_tardy ?? (att as any).tardy ?? (att as any).gridTardyCount ?? (att as any).writtenTardy;
    const tardyPart = tardy !== undefined ? `, Tardy=${tardy}` : "";
    comparisonResults.push({
      field: `monthly_attendance_${att.month || "period"}`,
      doc1Value: `SF1 Enrolled: ${sf1Entry.section || ""}`,
      doc2Value: `SF2 Month ${att.month || ""}: Present=${present}, Absent=${absent}${tardyPart}, Total=${totalDays}`,
      isMatch: sumPlausible,
      notes: sumPlausible ? "Attendance reconciled" : "Days present + absent exceed total school days",
    });

    if (!sumPlausible) {
      discrepancies.push({
        field: "attendance_reconciliation",
        sourceValue: totalDays,
        targetValue: present + absent,
        severity: "CRITICAL",
        description: `In month ${att.month || ""}, sum of present (${present}) and absent (${absent}) exceeds total school days (${totalDays}).`,
      });
    }

    // High absence warning (> 20% of school days without dropping)
    if (totalDays > 0 && absent > totalDays * 0.2) {
      discrepancies.push({
        field: "excessive_absences",
        sourceValue: absent,
        targetValue: totalDays * 0.2,
        severity: "WARNING",
        description: `Learner has excessive absences (${absent} out of ${totalDays} days in month ${att.month || ""}) exceeding DepEd 20% threshold.`,
      });
    }
  }

  const hasCritical = discrepancies.some((d) => d.severity === "CRITICAL");
  const hasWarning = discrepancies.some((d) => d.severity === "WARNING");
  const status: CrossDocumentValidationStatus = hasCritical
    ? "MISMATCH"
    : hasWarning
    ? "DISCREPANCIES_FOUND"
    : "MATCH";

  return {
    validationType: "SF1_SF2",
    status,
    needsHumanReview: hasCritical || hasWarning,
    schoolYear: sf1Entry.school_year || "Unknown",
    gradeLevel: sf1Entry.grade_level?.includes("12") ? "Grade 12" : "Grade 11",
    sourceDoc1Id: sf1Entry.document_id,
    sourceDoc2Id: matchingAttendance[0]?.document_id,
    comparisonResults,
    discrepancies,
    summaryMessage:
      status === "MATCH"
        ? `SF1 enrollment reconciled with SF2 attendance across ${matchingAttendance.length} reporting period(s).`
        : `SF1/SF2 attendance discrepancies found: ${discrepancies.map((d) => d.description).join("; ")}`,
  };
}

// -----------------------------------------------------------------------------
// 3. Comparator: SF1_SF5 (School Register Enrollment ↔ Promotion Status)
// -----------------------------------------------------------------------------

export function compareSf1AndSf5(
  sf1Entry: Sf1RosterEntry | {
    lrn?: string;
    last_name?: string;
    first_name?: string;
    school_year?: string;
    grade_level?: string;
    section?: string;
    remarks_indicator?: string | null;
    document_id?: string;
  },
  sf5Entry: Sf5PromotionEntry | {
    lrn?: string;
    learner_name?: string;
    school_year?: string;
    grade_level?: string;
    section?: string;
    action_taken?: string;
    document_id?: string;
  } | null
): PairwiseValidationResult {
  const comparisonResults: PairwiseValidationResult["comparisonResults"] = [];
  const discrepancies: DiscrepancyItem[] = [];

  if (!sf5Entry) {
    discrepancies.push({
      field: "promotion_record",
      sourceValue: sf1Entry.lrn,
      targetValue: null,
      severity: "CRITICAL",
      description: `Enrolled learner (LRN: ${sf1Entry.lrn}) is missing from End-of-Semester / End-of-Year SF5 report.`,
    });
    return {
      validationType: "SF1_SF5",
      status: "MISMATCH",
      needsHumanReview: true,
      schoolYear: sf1Entry.school_year || "Unknown",
      gradeLevel: sf1Entry.grade_level?.includes("12") ? "Grade 12" : "Grade 11",
      sourceDoc1Id: sf1Entry.document_id,
      sourceDoc2Id: null,
      comparisonResults: [{
        field: "promotion_presence",
        doc1Value: sf1Entry.lrn,
        doc2Value: null,
        isMatch: false,
        notes: "Missing in SF5",
      }],
      discrepancies,
      summaryMessage: `Learner (LRN: ${sf1Entry.lrn}) present in SF1 register is absent from SF5 report.`,
    };
  }

  // Section match check
  const sf1Sec = (sf1Entry.section || "").trim().toLowerCase();
  const sf5Sec = (sf5Entry.section || "").trim().toLowerCase();
  const isSecMatch = !sf1Sec || !sf5Sec || sf1Sec === sf5Sec;
  comparisonResults.push({
    field: "section",
    doc1Value: sf1Entry.section,
    doc2Value: sf5Entry.section,
    isMatch: isSecMatch,
    notes: isSecMatch ? "Section matched" : "Section differs between SF1 and SF5",
  });
  if (!isSecMatch) {
    discrepancies.push({
      field: "section",
      sourceValue: sf1Entry.section,
      targetValue: sf5Entry.section,
      severity: "WARNING",
      description: `Section discrepancy: SF1 lists "${sf1Entry.section}", SF5 lists "${sf5Entry.section}".`,
    });
  }

  // Dropped / Transferred out consistency
  const isDroppedInSf1 = (sf1Entry.remarks_indicator || "").toLowerCase().includes("drop");
  const isDroppedInSf5 = (sf5Entry.action_taken || "").toLowerCase().includes("drop");
  if (isDroppedInSf1 !== isDroppedInSf5) {
    discrepancies.push({
      field: "enrollment_status",
      sourceValue: sf1Entry.remarks_indicator || "ACTIVE",
      targetValue: sf5Entry.action_taken || "NONE",
      severity: "WARNING",
      description: `Enrollment status inconsistency: SF1 remarks indicate "${sf1Entry.remarks_indicator || "ACTIVE"}", while SF5 indicates "${sf5Entry.action_taken}".`,
    });
  }

  const hasCritical = discrepancies.some((d) => d.severity === "CRITICAL");
  const hasWarning = discrepancies.some((d) => d.severity === "WARNING");
  const status: CrossDocumentValidationStatus = hasCritical
    ? "MISMATCH"
    : hasWarning
    ? "DISCREPANCIES_FOUND"
    : "MATCH";

  return {
    validationType: "SF1_SF5",
    status,
    needsHumanReview: hasCritical || hasWarning,
    schoolYear: sf1Entry.school_year || "Unknown",
    gradeLevel: sf1Entry.grade_level?.includes("12") ? "Grade 12" : "Grade 11",
    sourceDoc1Id: sf1Entry.document_id,
    sourceDoc2Id: sf5Entry.document_id,
    comparisonResults,
    discrepancies,
    summaryMessage:
      status === "MATCH"
        ? "SF1 enrollment is fully consistent with SF5 promotion record."
        : `SF1/SF5 promotion discrepancies: ${discrepancies.map((d) => d.description).join("; ")}`,
  };
}

// -----------------------------------------------------------------------------
// 4. Comparator: SF1_SF9 (School Register Enrollment ↔ Learner Report Card)
// -----------------------------------------------------------------------------

export function compareSf1AndSf9(
  sf1Entry: Sf1RosterEntry | {
    lrn?: string;
    last_name?: string;
    first_name?: string;
    sex?: string;
    school_year?: string;
    grade_level?: string;
    section?: string;
    track?: string;
    strand?: string;
    document_id?: string;
  },
  sf9Doc: {
    lrn?: string;
    last_name?: string;
    first_name?: string;
    sex?: string;
    school_year?: string;
    grade_level?: string;
    section?: string;
    track?: string;
    strand?: string;
    document_id?: string;
  }
): PairwiseValidationResult {
  const comparisonResults: PairwiseValidationResult["comparisonResults"] = [];
  const discrepancies: DiscrepancyItem[] = [];

  // LRN match
  const isLrnMatch = !sf1Entry.lrn || !sf9Doc.lrn || sf1Entry.lrn === sf9Doc.lrn;
  comparisonResults.push({
    field: "lrn",
    doc1Value: sf1Entry.lrn,
    doc2Value: sf9Doc.lrn,
    isMatch: isLrnMatch,
    notes: isLrnMatch ? "LRN matched" : "LRN mismatch",
  });
  if (!isLrnMatch) {
    discrepancies.push({
      field: "lrn",
      sourceValue: sf1Entry.lrn,
      targetValue: sf9Doc.lrn,
      severity: "CRITICAL",
      description: `LRN conflict: SF1 has "${sf1Entry.lrn}", SF9 report card has "${sf9Doc.lrn}".`,
    });
  }

  // Name match: last_name
  const normSf1Last = normalizeNamePart(sf1Entry.last_name);
  const normSf9Last = normalizeNamePart(sf9Doc.last_name);
  const isLastMatch = !normSf1Last || !normSf9Last || normSf1Last === normSf9Last;
  comparisonResults.push({
    field: "last_name",
    doc1Value: sf1Entry.last_name,
    doc2Value: sf9Doc.last_name,
    isMatch: isLastMatch,
    notes: isLastMatch ? "Last name matched" : "Last name mismatch",
  });
  if (!isLastMatch) {
    discrepancies.push({
      field: "last_name",
      sourceValue: sf1Entry.last_name,
      targetValue: sf9Doc.last_name,
      severity: "CRITICAL",
      description: `Learner surname mismatch: SF1 "${sf1Entry.last_name}" vs SF9 "${sf9Doc.last_name}".`,
    });
  }

  // Name match: first_name
  const normSf1First = normalizeNamePart(sf1Entry.first_name);
  const normSf9First = normalizeNamePart(sf9Doc.first_name);
  const isFirstMatch = !normSf1First || !normSf9First || normSf1First === normSf9First;
  comparisonResults.push({
    field: "first_name",
    doc1Value: sf1Entry.first_name,
    doc2Value: sf9Doc.first_name,
    isMatch: isFirstMatch,
    notes: isFirstMatch ? "First name matched" : "First name mismatch",
  });
  if (!isFirstMatch) {
    discrepancies.push({
      field: "first_name",
      sourceValue: sf1Entry.first_name,
      targetValue: sf9Doc.first_name,
      severity: "CRITICAL",
      description: `Learner first name mismatch: SF1 "${sf1Entry.first_name}" vs SF9 "${sf9Doc.first_name}".`,
    });
  }

  // Sex match
  if (sf1Entry.sex && sf9Doc.sex) {
    const normSf1Sex = normalizeStrictSex(sf1Entry.sex);
    const normSf9Sex = normalizeStrictSex(sf9Doc.sex);
    const isSexMatch = !normSf1Sex || !normSf9Sex || normSf1Sex === normSf9Sex;
    comparisonResults.push({
      field: "sex",
      doc1Value: normSf1Sex || sf1Entry.sex,
      doc2Value: normSf9Sex || sf9Doc.sex,
      isMatch: isSexMatch,
      notes: isSexMatch ? "Sex verified" : "Wrong Sex/Gender conflict",
    });
    if (!isSexMatch) {
      discrepancies.push({
        field: "sex",
        sourceValue: normSf1Sex || sf1Entry.sex,
        targetValue: normSf9Sex || sf9Doc.sex,
        severity: "CRITICAL",
        description: `Wrong Sex/Gender: Sex does not match across documents (SF1: ${normSf1Sex || sf1Entry.sex} vs SF9: ${normSf9Sex || sf9Doc.sex}).`,
      });
    }
  }

  // Section match
  const sf1Sec = (sf1Entry.section || "").trim().toLowerCase();
  const sf9Sec = (sf9Doc.section || "").trim().toLowerCase();
  const isSecMatch = !sf1Sec || !sf9Sec || sf1Sec === sf9Sec;
  comparisonResults.push({
    field: "section",
    doc1Value: sf1Entry.section,
    doc2Value: sf9Doc.section,
    isMatch: isSecMatch,
    notes: isSecMatch ? "Section matched" : "Section discrepancy",
  });
  if (!isSecMatch) {
    discrepancies.push({
      field: "section",
      sourceValue: sf1Entry.section,
      targetValue: sf9Doc.section,
      severity: "WARNING",
      description: `Section differs: SF1 "${sf1Entry.section}" vs SF9 "${sf9Doc.section}".`,
    });
  }

  // Strand match
  const sf1Strand = (sf1Entry.strand || "").trim().toLowerCase();
  const sf9Strand = (sf9Doc.strand || "").trim().toLowerCase();
  const isStrandMatch = !sf1Strand || !sf9Strand || sf1Strand === sf9Strand;
  if (sf1Strand && sf9Strand) {
    comparisonResults.push({
      field: "strand",
      doc1Value: sf1Entry.strand,
      doc2Value: sf9Doc.strand,
      isMatch: isStrandMatch,
      notes: isStrandMatch ? "Strand matched" : "Strand discrepancy",
    });
    if (!isStrandMatch) {
      discrepancies.push({
        field: "strand",
        sourceValue: sf1Entry.strand,
        targetValue: sf9Doc.strand,
        severity: "WARNING",
        description: `SHS Strand mismatch: SF1 "${sf1Entry.strand}" vs SF9 "${sf9Doc.strand}".`,
      });
    }
  }

  const hasCritical = discrepancies.some((d) => d.severity === "CRITICAL");
  const hasWarning = discrepancies.some((d) => d.severity === "WARNING");
  const status: CrossDocumentValidationStatus = hasCritical
    ? "MISMATCH"
    : hasWarning
    ? "DISCREPANCIES_FOUND"
    : "MATCH";

  return {
    validationType: "SF1_SF9",
    status,
    needsHumanReview: hasCritical || hasWarning,
    schoolYear: sf1Entry.school_year || "Unknown",
    gradeLevel: sf1Entry.grade_level?.includes("12") ? "Grade 12" : "Grade 11",
    sourceDoc1Id: sf1Entry.document_id,
    sourceDoc2Id: sf9Doc.document_id,
    comparisonResults,
    discrepancies,
    summaryMessage:
      status === "MATCH"
        ? "SF1 enrollment details match SF9 report card metadata."
        : `SF1/SF9 discrepancies: ${discrepancies.map((d) => d.description).join("; ")}`,
  };
}

// -----------------------------------------------------------------------------
// 5. Comparator: SF9_SF10 (Report Card ↔ Cumulative Permanent Academic Record)
// -----------------------------------------------------------------------------

export interface AcademicGradeItem {
  subject: string;
  semester?: string;
  gradeLevel?: string;
  schoolYear?: string;
  gradingPeriod?: string;
  quarter1?: number | null;
  quarter2?: number | null;
  finalGrade?: number | null;
  remarks?: string;
  confidence?: number;
  sourceDocumentId?: string;
  sourceDocumentIds?: string[];
  sourceTraces?: ComparisonSourceTrace[];
}

export interface ComparisonSourceTrace {
  documentId: string;
  documentType: string;
  fieldName?: string;
  pageNumber?: number;
  rowIndex?: number;
  academicContext?: {
    schoolYear?: string;
    gradeLevel?: string;
    section?: string;
    semester?: string;
  };
}

export function compareSf9AndSf10(
  sf9Doc: {
    document_id?: string;
    school_year?: string;
    grade_level?: string;
    semester?: string;
    grades: AcademicGradeItem[];
    general_average?: number | null;
  },
  sf10Doc: {
    document_id?: string;
    school_year?: string;
    grade_level?: string;
    semester?: string;
    grades: AcademicGradeItem[];
    general_average?: number | null;
    schoolYear?: string;
    gradeLevel?: string;
    completed_semesters?: Array<{ school_year?: string; grade_level?: string; semester?: string; subjects?: AcademicGradeItem[] }>;
  }
): PairwiseValidationResult {
  const comparisonResults: PairwiseValidationResult["comparisonResults"] = [];
  const discrepancies: DiscrepancyItem[] = [];
  const sf9Grades = extractAcademicGradeRecords(
    [{
      documentId: sf9Doc.document_id,
      raw: {
        school_year: sf9Doc.school_year,
        grade_level: sf9Doc.grade_level,
        semester: sf9Doc.semester,
        grades: sf9Doc.grades,
      },
    }],
    "sf9"
  );
  const sf10Grades = extractAcademicGradeRecords(
    [{
      documentId: sf10Doc.document_id,
      raw: {
        school_year: sf10Doc.school_year,
        grade_level: sf10Doc.grade_level,
        semester: sf10Doc.semester,
        grades: sf10Doc.grades,
        completed_semesters: sf10Doc.completed_semesters,
      },
    }],
    "sf10"
  );
  const sf10AcademicContexts: AcademicGradeItem[] = [
    ...sf10Grades,
    ...(sf10Doc.completed_semesters || []).map((semesterRecord) => ({
      subject: "",
      schoolYear: semesterRecord.school_year,
      gradeLevel: semesterRecord.grade_level,
      semester: semesterRecord.semester,
    })),
  ];
  const gradeContextMatches = sameAcademicGradeContext;
  const gradeFieldKey = (grade: AcademicGradeItem) => [
    normalizeAcademicSchoolYear(grade.schoolYear),
    normalizeAcademicGradeLevel(grade.gradeLevel),
    normalizeGradingPeriod(grade.semester),
    normalizeGradingPeriod(grade.gradingPeriod),
    normalizeSubjectName(grade.subject),
  ].join("_");
  const processedSf9Scopes = new Set<string>();

  for (const g9 of sf9Grades) {
    const normSub = normalizeSubjectName(g9.subject);
    if (!normSub) continue;
    const sf9ScopeKey = academicGradeScopeKey(g9);
    if (processedSf9Scopes.has(sf9ScopeKey)) continue;
    processedSf9Scopes.add(sf9ScopeKey);
    const sameContextSf9 = sf9Grades.filter((candidate) =>
      academicGradeScopeKey(candidate) === sf9ScopeKey
    );
    const field = `grade_${gradeFieldKey(g9)}`;
    if (new Set(sameContextSf9.map(academicGradeValueSignature)).size > 1) {
      const sourceValues = sameContextSf9.map((grade) => ({
        finalGrade: grade.finalGrade,
        sourceDocumentIds: grade.sourceDocumentIds,
      }));
      comparisonResults.push({
        field,
        doc1Value: sourceValues,
        doc2Value: "Conflicting SF9 records",
        isMatch: false,
        notes: `Conflicting SF9 grades for "${g9.subject}" in the same academic context require review.`,
      });
      discrepancies.push({
        field,
        sourceValue: sourceValues,
        targetValue: null,
        severity: "WARNING",
        category: "NEEDS_VERIFICATION",
        description: `Conflicting SF9 grades were found for "${g9.subject}" in ${g9.gradeLevel}, ${g9.schoolYear}, ${g9.semester}.`,
      });
      continue;
    }

    const sameSubjectSf10 = sf10Grades.filter((grade) => normalizeSubjectName(grade.subject) === normSub);
    const matchingSf10 = sameSubjectSf10.filter((grade) => gradeContextMatches(g9, grade));
    if (matchingSf10.length > 1 && new Set(matchingSf10.map(academicGradeValueSignature)).size > 1) {
      const targetValues = matchingSf10.map((grade) => ({
        finalGrade: grade.finalGrade,
        sourceDocumentIds: grade.sourceDocumentIds,
      }));
      comparisonResults.push({
        field,
        doc1Value: g9.finalGrade,
        doc2Value: targetValues,
        isMatch: false,
        notes: `Conflicting SF10 grades for "${g9.subject}" in the same academic context require review.`,
      });
      discrepancies.push({
        field,
        sourceValue: g9.finalGrade,
        targetValue: targetValues,
        severity: "WARNING",
        category: "NEEDS_VERIFICATION",
        description: `Conflicting SF10 grades were found for "${g9.subject}" in ${g9.gradeLevel}, ${g9.schoolYear}, ${g9.semester}.`,
      });
      continue;
    }

    const g10 = matchingSf10[0];
    if (!g10) {
      const applicableSf10Context = sf10AcademicContexts.some((grade) => sameAcademicContextIgnoringPeriod(g9, grade));
      const uncertainContext = sameSubjectSf10.some((grade) => !hasAcademicGradeContext(grade));
      const hasOtherContext = sameSubjectSf10.length > 0;
      if (!applicableSf10Context && !uncertainContext) continue;
      const message = uncertainContext
        ? `Subject "${g9.subject}" exists in SF10 without enough academic context to compare safely.`
        : hasOtherContext
        ? `Subject "${g9.subject}" exists in SF10, but only in a different grading period; no cross-period comparison was made.`
        : `Subject "${g9.subject}" on SF9 is missing from the applicable SF10 permanent record.`;
      const needsVerification = uncertainContext || hasOtherContext;
      comparisonResults.push({
        field,
        doc1Value: `${g9.subject}: Final=${g9.finalGrade ?? "-"}`,
        doc2Value: needsVerification ? "Present in another/unknown context" : "MISSING",
        isMatch: false,
        notes: message,
      });
      discrepancies.push({
        field: `subject_${gradeFieldKey(g9)}`,
        sourceValue: { grade: g9.finalGrade, sourceDocumentIds: g9.sourceDocumentIds },
        targetValue: sameSubjectSf10.map((grade) => ({
          schoolYear: grade.schoolYear,
          gradeLevel: grade.gradeLevel,
          semester: grade.semester,
          sourceDocumentIds: grade.sourceDocumentIds,
        })),
        severity: needsVerification ? "WARNING" : "CRITICAL",
        ...(needsVerification ? { category: "NEEDS_VERIFICATION" as const } : {}),
        description: message,
      });
      continue;
    }

    const eval9 = evaluateDynamicGradeStatus({
      grade: g9.finalGrade,
      confidencePercent: (g9 as any).confidence,
    });
    const eval10 = evaluateDynamicGradeStatus({
      grade: g10.finalGrade,
      confidencePercent: (g10 as any).confidence,
    });

    if (eval9.status === "blank" && eval10.status === "blank") {
      comparisonResults.push({
        field,
        doc1Value: `${g9.subject}: Blank`,
        doc2Value: `${g10.subject}: Blank`,
        isMatch: false,
        notes: `Blank / Incomplete grade cell on both SF9 and SF10.`,
      });
      discrepancies.push({
        field,
        sourceValue: "Blank",
        targetValue: "Blank",
        severity: "WARNING",
        category: "NEEDS_VERIFICATION",
        description: `Subject "${g9.subject}" final grade is blank/incomplete on both SF9 and SF10.`,
      });
    } else if (eval9.isLowConfidence || eval10.isLowConfidence || eval9.status === "not_recognized" || eval10.status === "not_recognized") {
      comparisonResults.push({
        field,
        doc1Value: `${g9.subject}: ${eval9.remarkDisplay}`,
        doc2Value: `${g10.subject}: ${eval10.remarkDisplay}`,
        isMatch: false,
        notes: `Low confidence OCR reading (< 65%) or not recognized; requires verification.`,
      });
      discrepancies.push({
        field,
        sourceValue: eval9.remarkDisplay,
        targetValue: eval10.remarkDisplay,
        severity: "WARNING",
        category: "NEEDS_VERIFICATION",
        description: `Low confidence OCR grade for "${g9.subject}" (${eval9.remarkDisplay} vs ${eval10.remarkDisplay}); requires verification.`,
      });
    } else if (eval9.status === "blank" || eval10.status === "blank") {
      comparisonResults.push({
        field,
        doc1Value: `${g9.subject}: ${eval9.gradeDisplay}`,
        doc2Value: `${g10.subject}: ${eval10.gradeDisplay}`,
        isMatch: false,
        notes: `Blank / Incomplete grade discrepancy: SF9 is ${eval9.gradeDisplay}, while SF10 is ${eval10.gradeDisplay}.`,
      });
      discrepancies.push({
        field,
        sourceValue: eval9.gradeDisplay,
        targetValue: eval10.gradeDisplay,
        severity: "CRITICAL",
        description: `Grade completeness discrepancy in "${g9.subject}": SF9 is ${eval9.gradeDisplay}, while SF10 is ${eval10.gradeDisplay}.`,
      });
    } else {
      const f9 = eval9.numericGrade != null ? Math.round(Number(eval9.numericGrade)) : null;
      const f10 = eval10.numericGrade != null ? Math.round(Number(eval10.numericGrade)) : null;
      const isGradeMatch = f9 != null && f10 != null && f9 === f10;
      comparisonResults.push({
        field,
        doc1Value: `${g9.subject}: Final=${f9}`,
        doc2Value: `${g10.subject}: Final=${f10}`,
        isMatch: isGradeMatch,
        notes: isGradeMatch ? "Grades match in the same academic context" : `Grade difference (${f9} vs ${f10})`,
      });
      if (!isGradeMatch) {
        discrepancies.push({
          field,
          sourceValue: f9,
          targetValue: f10,
          severity: "CRITICAL",
          description: `Grade mismatch in "${g9.subject}" for ${g9.gradeLevel}, ${g9.schoolYear}, ${g9.semester}: SF9 has ${f9}, while SF10 records ${f10}.`,
        });
      }
    }
  }

  // General average check
  const documentContextMatches =
    normalizeAcademicSchoolYear(sf9Doc.school_year) !== "" &&
    normalizeAcademicSchoolYear(sf9Doc.school_year) === normalizeAcademicSchoolYear(sf10Doc.school_year) &&
    normalizeAcademicGradeLevel(sf9Doc.grade_level) !== "" &&
    normalizeAcademicGradeLevel(sf9Doc.grade_level) === normalizeAcademicGradeLevel(sf10Doc.grade_level) &&
    normalizeGradingPeriod(sf9Doc.semester) !== "" &&
    normalizeGradingPeriod(sf9Doc.semester) === normalizeGradingPeriod(sf10Doc.semester);
  if (documentContextMatches && (sf9Doc.general_average != null || sf10Doc.general_average != null)) {
    const isBlank9 = isBlankOrMissingFinal(sf9Doc.general_average);
    const isBlank10 = isBlankOrMissingFinal(sf10Doc.general_average);
    if (isBlank9 || isBlank10) {
      comparisonResults.push({
        field: "general_average",
        doc1Value: isBlank9 ? "Blank" : Math.round(Number(sf9Doc.general_average)),
        doc2Value: isBlank10 ? "Blank" : Math.round(Number(sf10Doc.general_average)),
        isMatch: false,
        notes: "General Average is blank/incomplete on one or both documents",
      });
      discrepancies.push({
        field: "general_average",
        sourceValue: isBlank9 ? "Blank" : Math.round(Number(sf9Doc.general_average)),
        targetValue: isBlank10 ? "Blank" : Math.round(Number(sf10Doc.general_average)),
        severity: "WARNING",
        category: "NEEDS_VERIFICATION",
        description: `General Average is blank/incomplete: SF9 is ${isBlank9 ? "Blank" : sf9Doc.general_average}, SF10 is ${isBlank10 ? "Blank" : sf10Doc.general_average}.`,
      });
    } else {
      const ga9 = Math.round(Number(sf9Doc.general_average));
      const ga10 = Math.round(Number(sf10Doc.general_average));
      const isGaMatch = !isNaN(ga9) && !isNaN(ga10) && ga9 === ga10;
      comparisonResults.push({
        field: "general_average",
        doc1Value: ga9,
        doc2Value: ga10,
        isMatch: isGaMatch,
        notes: isGaMatch ? "General average verified" : `Average mismatch (${ga9} vs ${ga10})`,
      });
      if (!isGaMatch) {
        discrepancies.push({
          field: "general_average",
          sourceValue: ga9,
          targetValue: ga10,
          severity: "CRITICAL",
          description: `General Average discrepancy: SF9 has ${ga9}, SF10 has ${ga10}.`,
        });
      }
    }
  }

  const hasCritical = discrepancies.some((d) => d.severity === "CRITICAL");
  const hasWarning = discrepancies.some((d) => d.severity === "WARNING");
  const status: CrossDocumentValidationStatus = comparisonResults.length === 0
    ? "NOT_APPLICABLE"
    : hasCritical
    ? "MISMATCH"
    : hasWarning
    ? "DISCREPANCIES_FOUND"
    : "MATCH";

  return {
    validationType: "SF9_SF10",
    status,
    needsHumanReview: hasCritical || hasWarning,
    schoolYear: sf9Doc.school_year || "Unknown",
    gradeLevel: normalizeAcademicGradeLevel(sf9Doc.grade_level) === "grade 11"
      ? "Grade 11"
      : normalizeAcademicGradeLevel(sf9Doc.grade_level) === "grade 12" ? "Grade 12" : undefined,
    semester: normalizeGradingPeriod(sf9Doc.semester) === "1stsemester"
      ? "1st Semester"
      : normalizeGradingPeriod(sf9Doc.semester) === "2ndsemester" ? "2nd Semester" : undefined,
    sourceDoc1Id: sf9Doc.document_id,
    sourceDoc2Id: sf10Doc.document_id,
    comparisonResults,
    discrepancies,
    summaryMessage:
      status === "NOT_APPLICABLE"
        ? "No comparable academic records share a complete school-year, grade-level, and semester context."
        : status === "MATCH"
        ? `Academic grades across ${sf9Grades.length} subjects on SF9 match SF10 permanent record in the same academic context.`
        : `Academic grade discrepancies between SF9 and SF10: ${discrepancies.map((d) => d.description).join("; ")}`,
  };
}

// -----------------------------------------------------------------------------
// 6. Comparator: SF5_SF9 (SF5A Status & Deficiencies ↔ Report Card Semestral Grades)
// -----------------------------------------------------------------------------

export function compareSf5AndSf9(
  sf5Entry: Sf5PromotionEntry | {
    document_id?: string;
    school_year: string;
    grade_level: "Grade 11" | "Grade 12";
    semester: "1st Semester" | "2nd Semester";
    action_taken?: "COMPLETE" | "INCOMPLETE" | "IRREGULAR" | "DROPPED" | "TRANSFERRED_OUT" | string;
    incomplete_subjects?: Array<string | { subject: string; final_grade?: number; remarks?: string }>;
  },
  sf9Grades: AcademicGradeItem[],
  sf9DocId?: string
): PairwiseValidationResult {
  const comparisonResults: PairwiseValidationResult["comparisonResults"] = [];
  const discrepancies: DiscrepancyItem[] = [];

  const sf5Context: AcademicGradeItem = {
    subject: "",
    schoolYear: sf5Entry.school_year,
    gradeLevel: sf5Entry.grade_level,
    semester: sf5Entry.semester,
  };
  const applicableGrades = sf9Grades.filter((grade) => sameAcademicGradeContext(sf5Context, grade));
  const failingGrades = applicableGrades.filter((g) => g.finalGrade != null && Number(g.finalGrade) < 75);
  const action = (sf5Entry.action_taken || "").toUpperCase();

  if (action === "COMPLETE") {
    // Must have zero failing grades
    const isClean = failingGrades.length === 0;
    comparisonResults.push({
      field: "sf5a_completion_status",
      doc1Value: "COMPLETE",
      doc2Value: `Failing subjects: ${failingGrades.length}`,
      isMatch: isClean,
      notes: isClean ? "Zero failing subjects verified" : "Failing subjects detected under COMPLETE status",
    });

    if (!isClean) {
      for (const f of failingGrades) {
        discrepancies.push({
          field: "failing_subject_unaccounted",
          sourceValue: `Final Grade: ${f.finalGrade}`,
          targetValue: "COMPLETE",
          severity: "CRITICAL",
          description: `SF5A marks learner as "COMPLETE", but SF9 contains failing subject "${f.subject}" with grade ${f.finalGrade}.`,
        });
      }
    }
  } else if (action === "INCOMPLETE") {
    // Every failing grade on SF9 must be listed in SF5A incomplete subjects
    const recordedDeficiencies = (sf5Entry.incomplete_subjects || []).map((s) => {
      const name = typeof s === "string" ? s : s.subject;
      return normalizeSubjectName(name);
    });

    for (const f of failingGrades) {
      const normF = normalizeSubjectName(f.subject);
      const isRecorded = recordedDeficiencies.some((d) => d.includes(normF) || normF.includes(d));

      comparisonResults.push({
        field: `deficiency_${normF}`,
        doc1Value: isRecorded ? "Recorded in SF5A" : "MISSING in SF5A",
        doc2Value: `SF9 Grade: ${f.finalGrade}`,
        isMatch: isRecorded,
        notes: isRecorded ? "Back-subject properly declared" : "Undeclared back-subject",
      });

      if (!isRecorded) {
        discrepancies.push({
          field: "undeclared_deficiency",
          sourceValue: f.subject,
          targetValue: null,
          severity: "CRITICAL",
          description: `Failing subject "${f.subject}" (Grade: ${f.finalGrade}) on SF9 is missing from SF5A deficient/back-subjects list.`,
        });
      }
    }
  }

  const hasCritical = discrepancies.some((d) => d.severity === "CRITICAL");
  const status: CrossDocumentValidationStatus = applicableGrades.length === 0
    ? "NOT_APPLICABLE"
    : hasCritical ? "MISMATCH" : "MATCH";

  return {
    validationType: "SF5_SF9",
    status,
    needsHumanReview: hasCritical,
    schoolYear: sf5Entry.school_year,
    gradeLevel: sf5Entry.grade_level,
    semester: sf5Entry.semester as "1st Semester" | "2nd Semester",
    sourceDoc1Id: sf5Entry.document_id,
    sourceDoc2Id: sf9DocId,
    comparisonResults,
    discrepancies,
    summaryMessage:
      status === "MATCH"
        ? `SF5A semestral status "${action}" accurately corresponds to all SF9 subject grades in the same academic context.`
        : `SF5A/SF9 academic discrepancies: ${discrepancies.map((d) => d.description).join("; ")}`,
  };
}

// -----------------------------------------------------------------------------
// 7. Comparator: SF5_SF10 (SF5B Graduation Clearance ↔ Cumulative Permanent Record)
// -----------------------------------------------------------------------------

export function compareSf5AndSf10(
  sf5bEntry: Sf5PromotionEntry | {
    document_id?: string;
    school_year: string;
    grade_level: "Grade 12";
    action_taken?: "GRADUATING" | "NOT_GRADUATING" | string;
    honors?: string;
  },
  sf10CumulativeRecord: {
    document_id?: string;
    completed_semesters: Array<{
      grade_level: "Grade 11" | "Grade 12";
      semester: "1st Semester" | "2nd Semester";
      subjects: AcademicGradeItem[];
    }>;
    has_unresolved_back_subjects: boolean;
    unresolved_subjects?: string[];
  }
): PairwiseValidationResult {
  const comparisonResults: PairwiseValidationResult["comparisonResults"] = [];
  const discrepancies: DiscrepancyItem[] = [];

  const isCandidate = (sf5bEntry.action_taken || "").toUpperCase() === "GRADUATING";

  if (isCandidate) {
    // 1. Must have all 4 SHS prerequisite semesters
    const semKeys = new Set(
      sf10CumulativeRecord.completed_semesters.map((s) => `${s.grade_level}_${s.semester}`)
    );
    const requiredSems = [
      "Grade 11_1st Semester",
      "Grade 11_2nd Semester",
      "Grade 12_1st Semester",
      "Grade 12_2nd Semester",
    ];

    const missingSems = requiredSems.filter((req) => !semKeys.has(req));
    const hasAllSems = missingSems.length === 0;

    comparisonResults.push({
      field: "completed_semesters_count",
      doc1Value: "GRADUATING Candidate",
      doc2Value: `${semKeys.size} of 4 Semesters Completed`,
      isMatch: hasAllSems,
      notes: hasAllSems ? "All 4 SHS semesters recorded" : `Missing semesters: ${missingSems.join(", ")}`,
    });

    if (!hasAllSems) {
      discrepancies.push({
        field: "missing_prerequisite_semesters",
        sourceValue: "GRADUATING",
        targetValue: missingSems.join(", "),
        severity: "CRITICAL",
        description: `Learner is certified as GRADUATING candidate on SF5B, but SF10 is missing complete records for: ${missingSems.join(", ")}.`,
      });
    }

    // 2. Must have zero unresolved back-subjects
    const hasBackSubjects = sf10CumulativeRecord.has_unresolved_back_subjects;
    comparisonResults.push({
      field: "unresolved_back_subjects",
      doc1Value: "Clear of Deficiencies",
      doc2Value: hasBackSubjects ? "Has Deficiencies" : "None",
      isMatch: !hasBackSubjects,
      notes: !hasBackSubjects ? "Zero deficient subjects" : "Pending back-subjects found",
    });

    if (hasBackSubjects) {
      discrepancies.push({
        field: "unresolved_back_subjects",
        sourceValue: "Clearance Required",
        targetValue: sf10CumulativeRecord.unresolved_subjects?.join(", ") || "Failed subjects",
        severity: "CRITICAL",
        description: `Learner listed as GRADUATING on SF5B has unresolved back-subjects on SF10: ${sf10CumulativeRecord.unresolved_subjects?.join(", ") || "back-subjects"}.`,
      });
    }
  }

  const hasCritical = discrepancies.some((d) => d.severity === "CRITICAL");
  const status: CrossDocumentValidationStatus = hasCritical ? "MISMATCH" : "MATCH";

  return {
    validationType: "SF5_SF10",
    status,
    needsHumanReview: hasCritical,
    schoolYear: sf5bEntry.school_year,
    gradeLevel: "Grade 12",
    sourceDoc1Id: sf5bEntry.document_id,
    sourceDoc2Id: sf10CumulativeRecord.document_id,
    comparisonResults,
    discrepancies,
    summaryMessage:
      status === "MATCH"
        ? "SF5B graduation clearance verified against full SF10 cumulative academic transcript."
        : `SF5B/SF10 graduation clearance conflicts: ${discrepancies.map((d) => d.description).join("; ")}`,
  };
}

// -----------------------------------------------------------------------------
// Required SHS document coverage (single source of truth for engine and UI)
// -----------------------------------------------------------------------------

export interface RequiredDocumentPresence {
  sf1?: boolean;
  sf2?: boolean;
  sf5a?: boolean;
  sf5b?: boolean;
  sf9?: boolean;
  sf10?: boolean;
  psa?: boolean;
}

export interface RequiredDocumentCoverageCategory {
  key: "sf1" | "sf2" | "sf5" | "sf9" | "sf10";
  label: string;
  present: boolean;
  satisfiedBy: string[];
}

export interface RequiredDocumentCoverage {
  categories: RequiredDocumentCoverageCategory[];
  totalRequired: number;
  requiredAvailable: number;
  hasRequiredCoverage: boolean;
  sf5Satisfied: boolean;
}

/**
 * Required school-form coverage: SF1, SF2, (SF5A OR SF5B), SF9, SF10.
 * SF5A and SF5B are alternative forms for a single requirement; either one alone
 * satisfies it. PSA is supporting civil evidence and is never required.
 * Grade-specific applicability of SF5B (Grade 12 only) is enforced separately as a
 * consistency check in the unified matrix, not as a completeness requirement.
 */
export function evaluateRequiredDocumentCoverage(presence: RequiredDocumentPresence): RequiredDocumentCoverage {
  const sf5Satisfied = Boolean(presence.sf5a) || Boolean(presence.sf5b);
  const categories: RequiredDocumentCoverageCategory[] = [
    { key: "sf1", label: "SF1-SHS", present: Boolean(presence.sf1), satisfiedBy: presence.sf1 ? ["SF1-SHS"] : [] },
    { key: "sf2", label: "SF2-SHS", present: Boolean(presence.sf2), satisfiedBy: presence.sf2 ? ["SF2-SHS"] : [] },
    {
      key: "sf5",
      label: "SF5A-SHS or SF5B-SHS",
      present: sf5Satisfied,
      satisfiedBy: [presence.sf5a ? "SF5A-SHS" : null, presence.sf5b ? "SF5B-SHS" : null].filter(
        (value): value is string => Boolean(value)
      ),
    },
    { key: "sf9", label: "SF9-SHS", present: Boolean(presence.sf9), satisfiedBy: presence.sf9 ? ["SF9-SHS"] : [] },
    { key: "sf10", label: "SF10-SHS", present: Boolean(presence.sf10), satisfiedBy: presence.sf10 ? ["SF10-SHS"] : [] },
  ];
  const requiredAvailable = categories.filter((category) => category.present).length;
  return {
    categories,
    totalRequired: categories.length,
    requiredAvailable,
    hasRequiredCoverage: requiredAvailable === categories.length,
    sf5Satisfied,
  };
}

const SOURCE_TYPE_TO_PRESENCE_KEY: Record<string, keyof RequiredDocumentPresence> = {
  "SF1-SHS": "sf1",
  "SF2-SHS": "sf2",
  "SF5A-SHS": "sf5a",
  "SF5B-SHS": "sf5b",
  "SF9-SHS": "sf9",
  "SF10-SHS": "sf10",
  PSA: "psa",
};

/** Derives document presence from persisted unified-matrix rows (sourcesPresent / sourceDocumentTypes). */
export function deriveDocumentPresenceFromMatrix(
  matrix: Array<{ sourcesPresent?: string[]; sourceDocumentTypes?: string[] }> | null | undefined
): Required<RequiredDocumentPresence> {
  const presence: Required<RequiredDocumentPresence> = {
    sf1: false,
    sf2: false,
    sf5a: false,
    sf5b: false,
    sf9: false,
    sf10: false,
    psa: false,
  };
  for (const row of matrix || []) {
    for (const sourceType of [...(row?.sourceDocumentTypes || []), ...(row?.sourcesPresent || [])]) {
      const key = SOURCE_TYPE_TO_PRESENCE_KEY[sourceType];
      if (key) presence[key] = true;
    }
  }
  return presence;
}

export interface DocumentCompletenessChecklistItem {
  key: "sf1" | "sf2" | "sf5" | "sf9" | "sf10" | "birth_cert";
  label: string;
  present: boolean;
  required: boolean;
  satisfiedBy: string[];
}

/**
 * UI checklist that follows exactly the engine's required-coverage rule
 * (SF5A OR SF5B is one requirement; PSA is supporting only).
 */
export function buildDocumentCompletenessChecklist(presence: RequiredDocumentPresence): {
  items: DocumentCompletenessChecklistItem[];
  coverage: RequiredDocumentCoverage;
} {
  const coverage = evaluateRequiredDocumentCoverage(presence);
  const byKey = new Map(coverage.categories.map((category) => [category.key, category]));
  const required = (key: RequiredDocumentCoverageCategory["key"], label: string): DocumentCompletenessChecklistItem => ({
    key,
    label,
    present: Boolean(byKey.get(key)?.present),
    required: true,
    satisfiedBy: byKey.get(key)?.satisfiedBy || [],
  });
  return {
    coverage,
    items: [
      required("sf1", "SHS SF1 School Register"),
      required("sf2", "SHS SF2 Attendance Sheet"),
      required("sf5", "SHS SF5A Promotion Report or SF5B Graduation List"),
      required("sf9", "SHS SF9 Report Card"),
      required("sf10", "SHS SF10 Permanent Record"),
      {
        key: "birth_cert",
        label: "PSA Birth Certificate",
        present: Boolean(presence.psa),
        required: false,
        satisfiedBy: presence.psa ? ["PSA"] : [],
      },
    ],
  };
}

// -----------------------------------------------------------------------------
// 8. 360° Consolidated SHS Evaluation
// -----------------------------------------------------------------------------

export function evaluateConsolidatedShsStudent(params: {
  studentId: string;
  schoolId: string;
  schoolYear: string;
  gradeLevel?: "Grade 11" | "Grade 12";
  documentPresence: {
    hasSf1: boolean;
    hasSf2: boolean;
    hasSf5: boolean;
    hasSf9: boolean;
    hasSf10: boolean;
    hasPsa: boolean;
  };
  pairwiseResults: PairwiseValidationResult[];
}): ConsolidatedShsEvaluationResult {
  const { studentId, schoolId, schoolYear, gradeLevel, documentPresence, pairwiseResults } = params;

  let totalCritical = 0;
  let totalWarnings = 0;

  for (const p of pairwiseResults) {
    for (const d of p.discrepancies) {
      if (d.severity === "CRITICAL") totalCritical++;
      if (d.severity === "WARNING") totalWarnings++;
    }
  }

  const totalAvailable = Object.values(documentPresence).filter(Boolean).length;
  const totalRequired = 5; // SF1, SF2, SF5, SF9, SF10 are essential for full SHS cycle; PSA optional/supporting

  let overallStatus: CrossDocumentValidationStatus = "MATCH";
  let needsHumanReview = false;

  if (totalCritical > 0) {
    overallStatus = "MISMATCH";
    needsHumanReview = true;
  } else if (totalWarnings > 0 || pairwiseResults.some((p) => p.status === "NEEDS_VERIFICATION")) {
    overallStatus = "NEEDS_VERIFICATION";
    needsHumanReview = true;
  } else if (totalAvailable < 2) {
    overallStatus = "NOT_APPLICABLE";
  }

  const summaryMessage =
    overallStatus === "MATCH"
      ? `Learner validation certified across ${pairwiseResults.length} cross-document audits with 100% consistency.`
      : overallStatus === "MISMATCH"
      ? `Validation failed with ${totalCritical} critical discrepancy(ies) across submitted school forms. Human verification required.`
      : overallStatus === "NEEDS_VERIFICATION"
      ? `Validation requires authorized review due to ${totalWarnings} warning(s) or pending verification items.`
      : `Insufficient documents uploaded (${totalAvailable}/${totalRequired}) for comprehensive validation.`;

  return {
    studentId,
    schoolId,
    schoolYear,
    gradeLevel,
    overallStatus,
    needsHumanReview,
    documentCompleteness: {
      sf1: documentPresence.hasSf1,
      sf2: documentPresence.hasSf2,
      sf5: documentPresence.hasSf5,
      sf9: documentPresence.hasSf9,
      sf10: documentPresence.hasSf10,
      birth_cert: documentPresence.hasPsa,
      totalAvailable,
      totalRequired,
    },
    pairwiseResults,
    criticalDiscrepanciesCount: totalCritical,
    warningDiscrepanciesCount: totalWarnings,
    summaryMessage,
  };
}

// -----------------------------------------------------------------------------
// 8. Comparator: Section-Level SF1 ↔ SF2 Multi-Learner Cross-Validation
// -----------------------------------------------------------------------------

export interface SectionSf1Sf2ValidationResult {
  validationType: "SF1_SF2";
  status: CrossDocumentValidationStatus;
  needsHumanReview: boolean;
  hasDiscrepancies: boolean;
  isPersisted?: boolean;
  persistenceStatus?: "COMPUTED_ONLY" | "PERSISTED";
  schoolYear: string;
  gradeLevel: string;
  section: string;
  totalSf1Learners: number;
  totalSf2Learners: number;
  totalLearnersInSf1: number;
  totalLearnersInSf2: number;
  matchedCount: number;
  reconciledCount: number;
  missingInSf2Count: number;
  missingInSf1Count: number;
  discrepancyCount: number;
  matchedLearners: Array<{
    lrn: string;
    name: string;
    sex?: string;
    birthDate?: string;
    sf1Entry: any;
    sf2Attendance: any[];
    attendance?: {
      total_school_days: number;
      days_present: number;
      days_absent: number;
      days_tardy: number;
    };
    totalSchoolDays: number;
    daysPresent: number;
    daysAbsent: number;
    daysTardy: number;
    status: CrossDocumentValidationStatus;
    discrepancies: DiscrepancyItem[];
  }>;
  reconciledLearners: SectionSf1Sf2ValidationResult["matchedLearners"];
  missingInSf2: Array<{
    lrn: string;
    name: string;
    sf1Entry: any;
    reason: string;
  }>;
  missingInSf1: Array<{
    lrn: string;
    name: string;
    sf2Attendance: any[];
    reason: string;
  }>;
  discrepancies: DiscrepancyItem[];
  summaryMessage: string;
}

export function compareSectionSf1AndSf2(
  sf1Entries: any[],
  sf2Entries: any[]
): SectionSf1Sf2ValidationResult {
  const discrepancies: DiscrepancyItem[] = [];
  const matchedLearners: SectionSf1Sf2ValidationResult["matchedLearners"] = [];
  const missingInSf2: SectionSf1Sf2ValidationResult["missingInSf2"] = [];
  const missingInSf1: SectionSf1Sf2ValidationResult["missingInSf1"] = [];

  const schoolYear = sf1Entries[0]?.school_year || sf2Entries[0]?.school_year || "Unknown";
  const gradeLevel = sf1Entries[0]?.grade_level || sf2Entries[0]?.grade_level || "Grade 11";
  const section = sf1Entries[0]?.section || sf2Entries[0]?.section || "Unknown";

  // Index SF2 by clean 12-digit LRN
  const sf2ByLrn = new Map<string, any[]>();
  const sf2SeenLrn = new Set<string>();

  for (const att of sf2Entries) {
    const rawLrn = att.lrn || "";
    const cleanLrn = normalizeLrn(rawLrn) || String(rawLrn).replace(/[^0-9]/g, "");
    if (!cleanLrn) continue;
    if (!sf2ByLrn.has(cleanLrn)) {
      sf2ByLrn.set(cleanLrn, []);
    }
    sf2ByLrn.get(cleanLrn)!.push(att);
    sf2SeenLrn.add(cleanLrn);
  }

  // Index SF1 by clean 12-digit LRN and detect duplicate LRNs in SF1
  const sf1ByLrn = new Map<string, any>();
  const sf1SeenLrn = new Set<string>();

  for (const sf1 of sf1Entries) {
    const rawLrn = sf1.lrn || "";
    const cleanLrn = normalizeLrn(rawLrn) || String(rawLrn).replace(/[^0-9]/g, "");
    const fullName = [sf1.last_name, sf1.first_name].filter(Boolean).join(", ") || sf1.learner_name || "Unknown";
    if (!cleanLrn || !isValidLrn(cleanLrn)) {
      discrepancies.push({
        field: "lrn_format",
        type: "INVALID_LRN",
        lrn: cleanLrn,
        sourceValue: rawLrn,
        targetValue: "12-digit standard LRN",
        severity: "CRITICAL",
        description: `Invalid LRN format for learner ${fullName}: "${rawLrn}".`,
      });
      continue;
    }

    if (sf1SeenLrn.has(cleanLrn)) {
      discrepancies.push({
        field: "duplicate_lrn_sf1",
        type: "DUPLICATE_LRN",
        lrn: cleanLrn,
        sourceValue: cleanLrn,
        targetValue: null,
        severity: "CRITICAL",
        description: `Duplicate enrollment detected in SF1: LRN ${cleanLrn} appears multiple times on the school register.`,
      });
    } else {
      sf1SeenLrn.add(cleanLrn);
      sf1ByLrn.set(cleanLrn, sf1);
    }
  }

  // 1. Cross-validate every learner in SF1 against SF2
  for (const [cleanLrn, sf1] of sf1ByLrn.entries()) {
    const fullName = [sf1.last_name, sf1.first_name].filter(Boolean).join(", ") || sf1.learner_name || "Unknown";
    const attList = sf2ByLrn.get(cleanLrn);

    if (!attList || attList.length === 0) {
      // Learner is missing from SF2
      missingInSf2.push({
        lrn: cleanLrn,
        name: fullName,
        sf1Entry: sf1,
        reason: `Learner ${fullName} (LRN: ${cleanLrn}) is officially enrolled in SF1 but has no SF2 attendance records.`,
      });
      discrepancies.push({
        field: "missing_in_sf2",
        type: "MISSING_IN_SF2",
        lrn: cleanLrn,
        sourceValue: cleanLrn,
        targetValue: null,
        severity: "CRITICAL",
        description: `Enrolled learner ${fullName} (LRN: ${cleanLrn}) is missing from SF2 daily attendance.`,
      });
      continue;
    }

    // Learner matched by LRN! Now verify details:
    const learnerDiscrepancies: DiscrepancyItem[] = [];
    let totSchoolDays = 0;
    let totPresent = 0;
    let totAbsent = 0;
    let totTardy = 0;

    for (const att of attList) {
      const sDays = Number(att.total_school_days ?? 0);
      const sPres = Number(att.days_present ?? 0);
      const sAbs = Number(att.days_absent ?? 0);
      const sTar = Number(att.days_tardy ?? 0);

      totSchoolDays += sDays;
      totPresent += sPres;
      totAbsent += sAbs;
      totTardy += sTar;

      // Identity sanity check: compare SF1 last name with SF2 learner_name
      if (att.learner_name && sf1.last_name) {
        const collision = verifyStudentCollision(sf1.last_name, {
          id: sf1.student_id || sf1.id || "",
          first_name: sf1.first_name || "",
          last_name: att.learner_name,
        });
        if (collision.hasConflict) {
          const disc: DiscrepancyItem = {
            field: "identity_mismatch",
            type: "NAME_MISMATCH",
            lrn: cleanLrn,
            sourceValue: `${sf1.last_name}, ${sf1.first_name || ""}`,
            targetValue: att.learner_name,
            severity: "CRITICAL",
            description: `Identity mismatch for LRN ${cleanLrn}: SF1 name is "${sf1.last_name}, ${sf1.first_name || ""}", but SF2 attendance sheet lists "${att.learner_name}".`,
          };
          learnerDiscrepancies.push(disc);
          discrepancies.push(disc);
        }
      }

      // Safeguard: Flagged records cannot silently pass final validation as verified
      if (sf1.review_status === "FLAGGED") {
        const disc: DiscrepancyItem = {
          field: "unresolved_sf1_flag",
          type: "FLAGGED_ROSTER_ENTRY",
          lrn: cleanLrn,
          sourceValue: sf1.review_status,
          targetValue: "VERIFIED",
          severity: "CRITICAL",
          description: `Learner ${fullName} has an unresolved FLAGGED status on the school register (${sf1.remarks_indicator || "unverified metadata"}).`,
        };
        learnerDiscrepancies.push(disc);
        discrepancies.push(disc);
      }

      if (att.review_status === "FLAGGED") {
        const disc: DiscrepancyItem = {
          field: "unresolved_sf2_flag",
          type: "FLAGGED_ATTENDANCE_ENTRY",
          lrn: cleanLrn,
          sourceValue: att.review_status,
          targetValue: "VERIFIED",
          severity: "CRITICAL",
          description: `Learner ${fullName} has an unresolved FLAGGED status on the SF2 daily attendance record.`,
        };
        learnerDiscrepancies.push(disc);
        discrepancies.push(disc);
      }

      // Safeguard: UNSPECIFIED track or strand cannot be treated as a valid academic track or strand
      if (sf1.track === "UNSPECIFIED" || sf1.strand === "UNSPECIFIED") {
        const disc: DiscrepancyItem = {
          field: "unspecified_track_strand",
          type: "METADATA_UNSPECIFIED",
          lrn: cleanLrn,
          sourceValue: `${sf1.track || "UNSPECIFIED"} / ${sf1.strand || "UNSPECIFIED"}`,
          targetValue: "Valid DepEd Senior High Track & Strand",
          severity: "CRITICAL",
          description: `Learner ${fullName} has an UNSPECIFIED Track or Strand on the official school register.`,
        };
        learnerDiscrepancies.push(disc);
        discrepancies.push(disc);
      }

      // Check monthly attendance sum
      if (sDays > 0 && sPres + sAbs > sDays) {
        const disc: DiscrepancyItem = {
          field: "attendance_sum_invalid",
          type: "ATTENDANCE_MATH_ERROR",
          lrn: cleanLrn,
          sourceValue: sDays,
          targetValue: sPres + sAbs,
          severity: "CRITICAL",
          description: `Attendance math error for ${fullName} in ${att.month || "reporting month"}: Present (${sPres}) + Absent (${sAbs}) exceeds Total Days (${sDays}).`,
        };
        learnerDiscrepancies.push(disc);
        discrepancies.push(disc);
      }

      // Excessive absences (> 20%)
      if (sDays > 0 && sAbs > sDays * 0.20) {
        const disc: DiscrepancyItem = {
          field: "excessive_absences",
          type: "EXCESSIVE_ABSENTEEISM_RISK",
          lrn: cleanLrn,
          sourceValue: sAbs,
          targetValue: Math.round(sDays * 0.20),
          severity: "WARNING",
          description: `Excessive absences warning for ${fullName} in ${att.month || "reporting month"}: ${sAbs} days absent out of ${sDays} school days (> 20% limit).`,
        };
        learnerDiscrepancies.push(disc);
        discrepancies.push(disc);
      }
    }

    const learnerStatus: CrossDocumentValidationStatus = learnerDiscrepancies.some((d) => d.severity === "CRITICAL")
      ? "MISMATCH"
      : learnerDiscrepancies.length > 0
      ? "DISCREPANCIES_FOUND"
      : "MATCH";

    matchedLearners.push({
      lrn: cleanLrn,
      name: fullName,
      sex: sf1.sex,
      birthDate: sf1.birth_date,
      sf1Entry: sf1,
      sf2Attendance: attList,
      attendance: {
        total_school_days: totSchoolDays,
        days_present: totPresent,
        days_absent: totAbsent,
        days_tardy: totTardy,
      },
      totalSchoolDays: totSchoolDays,
      daysPresent: totPresent,
      daysAbsent: totAbsent,
      daysTardy: totTardy,
      status: learnerStatus,
      discrepancies: learnerDiscrepancies,
    });
  }

  // 2. Find any attendees in SF2 who are NOT enrolled in SF1
  for (const [cleanLrn, attList] of sf2ByLrn.entries()) {
    if (!sf1ByLrn.has(cleanLrn)) {
      const attName = attList[0]?.learner_name || "Unknown";
      missingInSf1.push({
        lrn: cleanLrn,
        name: attName,
        sf2Attendance: attList,
        reason: `Attendee ${attName} (LRN: ${cleanLrn}) is marked on SF2 attendance but is not enrolled in the SF1 school register.`,
      });
      discrepancies.push({
        field: "missing_in_sf1",
        type: "UNENROLLED_ATTENDEE",
        lrn: cleanLrn,
        sourceValue: cleanLrn,
        targetValue: null,
        severity: "CRITICAL",
        description: `Unenrolled attendee ${attName} (LRN: ${cleanLrn}) found on SF2 attendance sheet without matching SF1 enrollment.`,
      });
    }
  }

  const hasCritical = discrepancies.some((d) => d.severity === "CRITICAL");
  const hasWarning = discrepancies.some((d) => d.severity === "WARNING");

  const status: CrossDocumentValidationStatus = hasCritical
    ? "MISMATCH"
    : hasWarning
    ? "DISCREPANCIES_FOUND"
    : "MATCH";

  const summaryMessage =
    status === "MATCH"
      ? `SF1 and SF2 cross-validation certified: All ${matchedLearners.length} learners matched by LRN with 100% attendance consistency.`
      : status === "MISMATCH"
      ? `SF1/SF2 cross-validation flagged ${discrepancies.filter((d) => d.severity === "CRITICAL").length} critical mismatch(es): unenrolled attendees, LRN conflicts, or attendance math errors.`
      : `SF1/SF2 cross-validation identified ${discrepancies.length} discrepancy(ies): missing learners or excessive absence alerts requiring adviser review.`;

  return {
    validationType: "SF1_SF2",
    status,
    needsHumanReview: hasCritical || hasWarning,
    hasDiscrepancies: discrepancies.length > 0,
    isPersisted: false,
    persistenceStatus: "COMPUTED_ONLY",
    schoolYear,
    gradeLevel,
    section,
    totalSf1Learners: sf1Entries.length,
    totalSf2Learners: sf2SeenLrn.size,
    totalLearnersInSf1: sf1Entries.length,
    totalLearnersInSf2: sf2SeenLrn.size,
    matchedCount: matchedLearners.length,
    reconciledCount: matchedLearners.length,
    missingInSf2Count: missingInSf2.length,
    missingInSf1Count: missingInSf1.length,
    discrepancyCount: discrepancies.length,
    matchedLearners,
    reconciledLearners: matchedLearners,
    missingInSf2,
    missingInSf1,
    discrepancies,
    summaryMessage,
  };
}

// =============================================================================
// 9. AVV UNIFIED STUDENT-CENTERED CROSS-DOCUMENT VALIDATION ENGINE
//
// Evaluates all 7 supported DepEd SHS document types:
//   SF1-SHS, SF2-SHS, SF5A-SHS, SF5B-SHS, SF9-SHS, SF10-SHS, and PSA
// In ONE unified process across Identity, Context, Attendance, Academic,
// Promotion, and Graduation matrices without isolated pairwise blind spots.
// =============================================================================

export type StrictRowStatus = "MATCH" | "MISMATCH" | "INCOMPLETE" | "NO DATA" | "NO_DATA";

export interface UnifiedFieldComparisonRow {
  field: string;
  category: "IDENTITY" | "SCHOOL_CONTEXT" | "ATTENDANCE" | "ACADEMIC" | "PROMOTION" | "GRADUATION";
  label: string;
  psaValue?: any;
  sf1Value?: any;
  sf2Value?: any;
  sf5aValue?: any;
  sf5bValue?: any;
  sf9Value?: any;
  sf10Value?: any;
  status: "MATCH" | "MISMATCH" | "INCOMPLETE" | "NO DATA" | "NO_DATA" | "NEEDS_VERIFICATION" | "NOT_APPLICABLE" | "MISSING_SOURCE";
  isMatch: boolean;
  notes?: string;
  sourceDoc?: string;
  sourceDocumentIds?: string[];
  sourceDocumentTypes?: string[];
  sourceTraces?: ComparisonSourceTrace[];
  sourcesPresent: string[];
}

/**
 * Strict 4-State Row Evaluation:
 * - MATCH (Green): At least 2 applicable documents have non-empty values AND all non-empty values match after normalization.
 * - MISMATCH (Red): At least 2 applicable documents have non-empty values AND they disagree (e.g. differing LRNs, differing birthdates, or blank/missing grades in SF9 Back vs populated grades in SF10).
 * - INCOMPLETE (Amber): Only 1 applicable document has a non-empty value while other uploaded applicable documents are blank (—).
 * - NO DATA (Neutral gray): 0 documents have a value (all —), such as empty DepEd School ID rows.
 */
export function evaluate4StateRowStatus(row: Partial<UnifiedFieldComparisonRow>): "MATCH" | "MISMATCH" | "INCOMPLETE" | "NO DATA" {
  const { field = "", psaValue, sf1Value, sf2Value, sf5aValue, sf5bValue, sf9Value, sf10Value, status, category } = row;

  if (status === "MISMATCH") {
    return "MISMATCH";
  }

  const isBlank = (v: any): boolean => {
    if (v === undefined || v === null) return true;
    const str = String(v).trim().toLowerCase();
    return str === "" || str === "—" || str === "-" || str === "null" || str === "undefined" || str === "n/a" || str === "blank";
  };

  // Dedicated Attendance evaluation: SF2 vs SF9
  if (category === "ATTENDANCE" || field.startsWith("attendance_")) {
    const sf2Has = !isBlank(sf2Value);
    const sf9Has = !isBlank(sf9Value);
    if (!sf2Has && !sf9Has) return "NO DATA";
    if (sf2Has && sf9Has) {
      return status === "MATCH" || status === "NOT_APPLICABLE" ? "MATCH" : "MISMATCH";
    }
    return "INCOMPLETE";
  }

  const isLrn = field === "lrn";
  const isBirthDate = field === "birth_date" || field.includes("birth");

  // Collect applicable document values
  const applicableEntries: Array<{ doc: string; val: any }> = [];
  if (!isLrn && !isBlank(psaValue) && String(psaValue) !== "Civil Document (No DepEd LRN)") {
    applicableEntries.push({ doc: "PSA", val: psaValue });
  }
  if (!isBlank(sf1Value)) applicableEntries.push({ doc: "SF1", val: sf1Value });
  if (!isBlank(sf2Value)) applicableEntries.push({ doc: "SF2", val: sf2Value });
  if (!isBlank(sf5aValue)) applicableEntries.push({ doc: "SF5A", val: sf5aValue });
  if (!isBlank(sf5bValue)) applicableEntries.push({ doc: "SF5B", val: sf5bValue });
  if (!isBlank(sf9Value)) applicableEntries.push({ doc: "SF9", val: sf9Value });
  if (!isBlank(sf10Value)) applicableEntries.push({ doc: "SF10", val: sf10Value });

  // 0 documents have a value
  if (applicableEntries.length === 0) {
    return "NO DATA";
  }

  // Only 1 document has a value
  if (applicableEntries.length === 1) {
    return "INCOMPLETE";
  }

  // 2 or more applicable documents have values: compare them
  if (isLrn) {
    const baseLrn = normalizeLrn(applicableEntries[0].val);
    for (let i = 1; i < applicableEntries.length; i++) {
      const curLrn = normalizeLrn(applicableEntries[i].val);
      if (baseLrn !== curLrn) {
        return "MISMATCH";
      }
    }
    return "MATCH";
  }

  if (isBirthDate) {
    const baseIso = toIsoBirthDate(applicableEntries[0].val);
    for (let i = 1; i < applicableEntries.length; i++) {
      const curIso = toIsoBirthDate(applicableEntries[i].val);
      if (!baseIso || !curIso || baseIso !== curIso) {
        return "MISMATCH";
      }
    }
    return "MATCH";
  }

  if (field === "sex") {
    const baseSex = normalizeStrictSex(applicableEntries[0].val);
    for (let i = 1; i < applicableEntries.length; i++) {
      const curSex = normalizeStrictSex(applicableEntries[i].val);
      if (baseSex && curSex && baseSex !== curSex) {
        return "MISMATCH";
      }
    }
    return "MATCH";
  }

  if (field === "last_name" || field === "first_name" || field === "middle_name" || field === "mother_maiden_name") {
    const normBase = normalizeNamePart(String(applicableEntries[0].val));
    for (let i = 1; i < applicableEntries.length; i++) {
      const normCur = normalizeNamePart(String(applicableEntries[i].val));
      if (normBase !== normCur) {
        const maxLen = Math.max(normBase.length, normCur.length);
        const dist = levenshteinDistance(normBase, normCur);
        const isHandwritingMatch = dist <= (maxLen >= 6 ? 2 : 1);
        if (field === "middle_name") {
          const isInitial = (normBase.length === 1 && normCur.startsWith(normBase)) || (normCur.length === 1 && normBase.startsWith(normCur));
          if (!isHandwritingMatch && !isInitial) return "MISMATCH";
        } else if (field === "first_name") {
          const wordsA = normBase.split(" ");
          const wordsB = normCur.split(" ");
          const hasOverlap = wordsA.some((w) => wordsB.includes(w));
          if (!isHandwritingMatch && !hasOverlap) return "MISMATCH";
        } else {
          if (!isHandwritingMatch) return "MISMATCH";
        }
      }
    }
    return "MATCH";
  }

  if (field === "section") {
    const baseSec = String(applicableEntries[0].val).trim().toLowerCase();
    for (let i = 1; i < applicableEntries.length; i++) {
      const curSec = String(applicableEntries[i].val).trim().toLowerCase();
      if (baseSec !== curSec) {
        return "MISMATCH";
      }
    }
    return "MATCH";
  }

  if (field === "school_id") {
    const baseId = String(applicableEntries[0].val).trim();
    for (let i = 1; i < applicableEntries.length; i++) {
      const curId = String(applicableEntries[i].val).trim();
      if (baseId !== curId) {
        return "MISMATCH";
      }
    }
    return "MATCH";
  }

  if (field === "school_year") {
    const baseSy = String(applicableEntries[0].val).trim();
    for (let i = 1; i < applicableEntries.length; i++) {
      const curSy = String(applicableEntries[i].val).trim();
      if (baseSy !== curSy) {
        return "MISMATCH";
      }
    }
    return "MATCH";
  }

  // Academic grades / General average:
  // If SF9 is blank/missing and SF10 has populated grades, or vice versa -> MISMATCH
  if (field.startsWith("grade_") || field === "general_average") {
    const sf9Present = applicableEntries.find((e) => e.doc === "SF9");
    const sf10Present = applicableEntries.find((e) => e.doc === "SF10");
    if (sf9Present && sf10Present) {
      const sf9Str = String(sf9Present.val).trim().toLowerCase();
      const sf10Str = String(sf10Present.val).trim().toLowerCase();
      const sf9IsBlank = sf9Str === "" || sf9Str === "—" || sf9Str === "blank" || sf9Str === "null";
      const sf10IsBlank = sf10Str === "" || sf10Str === "—" || sf10Str === "blank" || sf10Str === "null";
      if (sf9IsBlank !== sf10IsBlank) {
        return "MISMATCH";
      }
    }
  }

  // Default comparison
  const baseNorm = String(applicableEntries[0].val).trim().toLowerCase();
  for (let i = 1; i < applicableEntries.length; i++) {
    const curNorm = String(applicableEntries[i].val).trim().toLowerCase();
    if (baseNorm !== curNorm) {
      return "MISMATCH";
    }
  }

  return "MATCH";
}

export interface DuplicateScanWarning {
  documentType: string;
  details: string;
  existingSource: string;
  newSource: string;
  isIdentical: boolean;
  severity: "CRITICAL" | "WARNING" | "INFO";
}

export interface UnifiedStudentValidationParams {
  lrn: string;
  fullName?: string;
  studentId?: string;
  schoolId?: string;
  schoolYear?: string;
  gradeLevel?: string;
  section?: string;
  trackStrand?: string;
  psa?: {
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
  };
  psaRecords?: Array<{
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
  }>;
  sf1?: {
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
  };
  sf1Records?: Array<{
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
  }>;
  sf2Records?: Array<{
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
  }>;
  sf5a?: {
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
  };
  sf5aRecords?: Array<{
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
  }>;
  sf5b?: {
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
  };
  sf5bRecords?: Array<{
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
  }>;
  sf9?: {
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
    schoolId?: string;
  };
  sf9Records?: Array<{
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
    schoolId?: string;
  }>;
  sf10?: {
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
    schoolId?: string;
  };
  sf10Records?: Array<{
    raw: any;
    fileName?: string;
    pageNumber?: number;
    dataUrl?: string;
    documentId?: string;
    schoolId?: string;
  }>;
  duplicateWarnings?: DuplicateScanWarning[];
}

export interface UnifiedStudentValidationOutcome {
  lrn: string;
  fullName: string;
  studentId?: string;
  schoolId?: string;
  schoolYear: string;
  gradeLevel?: string;
  overallStatus: CrossDocumentValidationStatus;
  needsHumanReview: boolean;
  fieldsMatrix: UnifiedFieldComparisonRow[];
  discrepancies: DiscrepancyItem[];
  duplicateWarnings: DuplicateScanWarning[];
  summaryMessage: string;
  documentCompleteness: {
    sf1: boolean;
    sf2: boolean;
    sf5a: boolean;
    sf5b: boolean;
    sf9: boolean;
    sf10: boolean;
    psa: boolean;
    totalAvailable: number;
    totalRequired: number;
    requiredAvailable: number;
    hasRequiredCoverage: boolean;
  };
}

function parseNumericVal(val: any): number | undefined {
  if (val === undefined || val === null) return undefined;
  const str = String(val).trim();
  if (str === "" || str === "-" || str === ":unselected:" || str.toLowerCase() === "null") return undefined;
  const match = str.match(/^-?(\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  return isNaN(num) ? undefined : num;
}

function normalizeAcademicGradeLevel(value: any): string {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("12")) return "grade 12";
  if (text.includes("11")) return "grade 11";
  return text;
}

function normalizeAcademicSchoolYear(value: any): string {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function normalizeGradingPeriod(value: any): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeAcademicGradeValue(value: any): string {
  const numeric = parseNumericVal(value);
  return numeric === undefined ? String(value ?? "").trim().toLowerCase() : String(numeric);
}

function hasAcademicGradeContext(grade: AcademicGradeItem): boolean {
  return Boolean(
    normalizeAcademicSchoolYear(grade.schoolYear) &&
    normalizeAcademicGradeLevel(grade.gradeLevel) &&
    normalizeGradingPeriod(grade.semester)
  );
}

function sameAcademicGradeContext(left: AcademicGradeItem, right: AcademicGradeItem): boolean {
  if (!hasAcademicGradeContext(left) || !hasAcademicGradeContext(right)) return false;
  if (
    normalizeAcademicSchoolYear(left.schoolYear) !== normalizeAcademicSchoolYear(right.schoolYear) ||
    normalizeAcademicGradeLevel(left.gradeLevel) !== normalizeAcademicGradeLevel(right.gradeLevel) ||
    normalizeGradingPeriod(left.semester) !== normalizeGradingPeriod(right.semester)
  ) return false;
  const leftPeriod = normalizeGradingPeriod(left.gradingPeriod);
  const rightPeriod = normalizeGradingPeriod(right.gradingPeriod);
  return !leftPeriod && !rightPeriod ? true : leftPeriod !== "" && leftPeriod === rightPeriod;
}

function sameAcademicContextIgnoringPeriod(left: AcademicGradeItem, right: AcademicGradeItem): boolean {
  return hasAcademicGradeContext(left) &&
    hasAcademicGradeContext(right) &&
    normalizeAcademicSchoolYear(left.schoolYear) === normalizeAcademicSchoolYear(right.schoolYear) &&
    normalizeAcademicGradeLevel(left.gradeLevel) === normalizeAcademicGradeLevel(right.gradeLevel) &&
    normalizeGradingPeriod(left.semester) === normalizeGradingPeriod(right.semester);
}

function academicGradeScopeKey(grade: AcademicGradeItem): string {
  return [
    normalizeAcademicSchoolYear(grade.schoolYear),
    normalizeAcademicGradeLevel(grade.gradeLevel),
    normalizeGradingPeriod(grade.semester),
    normalizeGradingPeriod(grade.gradingPeriod),
    normalizeSubjectName(grade.subject),
  ].join("|");
}

function academicGradeValueSignature(grade: AcademicGradeItem): string {
  return [
    normalizeAcademicGradeValue(grade.finalGrade),
    normalizeAcademicGradeValue(grade.quarter1),
    normalizeAcademicGradeValue(grade.quarter2),
  ].join("|");
}

export function extractAcademicGradeRecords(
  records: Array<{ raw: any; documentId?: string }>,
  documentType: "sf9" | "sf10",
  fallbackContext?: { schoolYear?: string; gradeLevel?: string }
): Array<AcademicGradeItem & { schoolYear?: string; sourceDocumentId: string; sourceDocumentIds: string[] }> {
  const expanded: Array<AcademicGradeItem & { schoolYear?: string; sourceDocumentId: string; sourceDocumentIds: string[] }> = [];
  for (const record of records) {
    const raw = record.raw || {};
    const sources: Array<{ grade: any; semesterRecord?: any }> = [];
    for (const grade of Array.isArray(raw.grades) ? raw.grades : []) {
      sources.push({ grade });
    }
    if (documentType === "sf10") {
      for (const semesterRecord of Array.isArray(raw.completed_semesters) ? raw.completed_semesters : []) {
        for (const grade of Array.isArray(semesterRecord.subjects) ? semesterRecord.subjects : []) {
          sources.push({ grade, semesterRecord });
        }
      }
    }

    for (const { grade, semesterRecord } of sources) {
      const schoolYear =
        grade.school_year || grade.schoolYear ||
        semesterRecord?.school_year || semesterRecord?.schoolYear ||
        (!semesterRecord ? raw.school_year || raw.schoolYear || fallbackContext?.schoolYear : undefined);
      const gradeLevel =
        grade.grade_level || grade.gradeLevel ||
        semesterRecord?.grade_level || semesterRecord?.gradeLevel ||
        (!semesterRecord ? raw.grade_level || raw.gradeLevel || fallbackContext?.gradeLevel : undefined);
      const semester = grade.semester || semesterRecord?.semester || raw.semester;
      const gradingPeriod =
        grade.grading_period || grade.gradingPeriod || grade.grading_period_name ||
        grade.quarter || grade.period;
      const finalGrade = grade.final ?? grade.finalGrade ?? grade.final_grade ?? grade.final_mark;
      expanded.push({
        ...grade,
        subject: String(grade.subject || ""),
        final: finalGrade,
        finalGrade,
        quarter1: grade.quarter1 ?? grade.q1,
        quarter2: grade.quarter2 ?? grade.q2,
        semester,
        schoolYear,
        gradeLevel,
        gradingPeriod,
        sourceDocumentId: record.documentId || "",
        sourceDocumentIds: record.documentId ? [record.documentId] : [],
        sourceTraces: record.documentId
          ? [{
              documentId: record.documentId,
              documentType: `${documentType.toUpperCase()}-SHS`,
              academicContext: {
                schoolYear,
                gradeLevel,
                semester,
              },
              pageNumber: [
                grade.page_number,
                grade.pageNumber,
                semesterRecord?.page_number,
                semesterRecord?.pageNumber,
                raw.page_number,
                raw.pageNumber,
              ].find((value) => typeof value === "number" && Number.isInteger(value) && value > 0) as number | undefined,
              rowIndex: [
                grade.row_index,
                grade.rowIndex,
                semesterRecord?.row_index,
                semesterRecord?.rowIndex,
                raw.row_index,
                raw.rowIndex,
              ].find((value) => typeof value === "number" && Number.isInteger(value) && value >= 0) as number | undefined,
            }]
          : [],
      });
    }
  }

  const deduplicated = new Map<string, typeof expanded[number]>();
  for (const grade of expanded) {
    const key = [
      normalizeAcademicSchoolYear(grade.schoolYear),
      normalizeAcademicGradeLevel(grade.gradeLevel),
      normalizeAttendanceMonthKey(grade.semester),
      normalizeGradingPeriod(grade.gradingPeriod),
      normalizeSubjectName(grade.subject),
      normalizeAcademicGradeValue(grade.finalGrade),
      normalizeAcademicGradeValue(grade.quarter1),
      normalizeAcademicGradeValue(grade.quarter2),
    ].join("|");
    const existing = deduplicated.get(key);
    if (existing) {
      existing.sourceDocumentIds = Array.from(new Set([...existing.sourceDocumentIds, ...grade.sourceDocumentIds]));
      const sourceTraces = [...(existing.sourceTraces || []), ...(grade.sourceTraces || [])];
      existing.sourceTraces = sourceTraces.filter((trace, index) =>
        sourceTraces.findIndex((candidate) =>
          candidate.documentId === trace.documentId &&
          candidate.documentType === trace.documentType &&
          candidate.pageNumber === trace.pageNumber &&
          candidate.rowIndex === trace.rowIndex
        ) === index
      );
    } else {
      deduplicated.set(key, grade);
    }
  }
  return Array.from(deduplicated.values());
}

export function normalizeAttendanceMonthKey(m: string | undefined | null): string {
  if (!m) return "";
  const key = normalizeDepEdMonthKey(m);
  return key || String(m).toLowerCase().slice(0, 3);
}

function attendanceValueSignature(raw: any): string {
  return JSON.stringify({
    total_school_days: normalizeAcademicGradeValue(raw.total_school_days),
    days_present: normalizeAcademicGradeValue(raw.days_present),
    days_absent: normalizeAcademicGradeValue(raw.days_absent),
    days_tardy: normalizeAcademicGradeValue(raw.days_tardy),
    daily_grid: raw.daily_grid || [],
  });
}

function groupAttendanceRecords(
  records: Array<{ raw: any; documentId?: string }>
): Map<string, {
  month: string;
  records: Array<{ raw: any; sourceDocumentIds: string[] }>;
  sourceDocumentIds: string[];
  hasConflict: boolean;
}> {
  const grouped = new Map<string, {
    month: string;
    records: Array<{ raw: any; sourceDocumentIds: string[] }>;
    sourceDocumentIds: string[];
    hasConflict: boolean;
  }>();
  records.forEach(({ raw = {}, documentId }, index) => {
    const month = String(raw.month || "");
    const monthKey = normalizeAttendanceMonthKey(month) || `UNKNOWN_${index}`;
    const group = grouped.get(monthKey) || {
      month,
      records: [],
      sourceDocumentIds: [],
      hasConflict: false,
    };
    const documentIds = documentId ? [documentId] : [];
    group.sourceDocumentIds = Array.from(new Set([...group.sourceDocumentIds, ...documentIds]));
    const signature = attendanceValueSignature(raw);
    const sameRecord = group.records.find((entry) => attendanceValueSignature(entry.raw) === signature);
    if (sameRecord) {
      sameRecord.sourceDocumentIds = Array.from(new Set([...sameRecord.sourceDocumentIds, ...documentIds]));
    } else {
      group.records.push({ raw, sourceDocumentIds: documentIds });
      group.hasConflict = group.records.length > 1;
    }
    grouped.set(monthKey, group);
  });
  return grouped;
}

export function parseNameParts(fullName: string | undefined | null): { lastName: string; firstName: string; middleName?: string } {
  if (!fullName) return { lastName: "", firstName: "" };
  const trimmed = fullName.trim();
  if (trimmed.includes(",")) {
    const [last, rest] = trimmed.split(",", 2).map((s) => s.trim());
    const restTokens = rest ? rest.split(/\s+/) : [];
    const first = restTokens[0] || "";
    const middle = restTokens.slice(1).join(" ") || undefined;
    return { lastName: last, firstName: first, middleName: middle };
  }
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 1) return { lastName: tokens[0], firstName: "" };
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  const middle = tokens.slice(1, -1).join(" ") || undefined;
  return { lastName: last, firstName: first, middleName: middle };
}

function mergeUnifiedDocumentRecords(
  records: Array<{ raw: any; documentId?: string }>,
  documentType: "sf9" | "sf10",
  fallbackContext?: UnifiedDocumentContext,
  conflicts: UnifiedSourceConflict[] = []
): Record<string, any> {
  const contextRecords = records.filter((record) => matchesUnifiedDocumentContext(record, fallbackContext));
  const rawRecords = contextRecords.map((record) => record.raw || {});
  const primary = rawRecords[0] || {};
  const grades = extractAcademicGradeRecords(contextRecords, documentType, fallbackContext);

  const merged: Record<string, any> = { ...primary, grades };
  const ignoredScalarFields = new Set([
    "id",
    "document_id",
    "created_at",
    "updated_at",
    "file_name",
    "page_number",
  ]);
  const scalarFields = new Set(rawRecords.flatMap((raw) =>
    Object.entries(raw)
      .filter(([field, value]) =>
        !ignoredScalarFields.has(field) &&
        value !== null &&
        ["string", "number", "boolean"].includes(typeof value)
      )
      .map(([field]) => field)
  ));
  for (const field of scalarFields) {
    const candidates = contextRecords.flatMap((record) => {
      const value = record.raw?.[field];
      if (value === undefined || value === null) return [];
      return [{ value, documentId: record.documentId || record.raw?.document_id }];
    });
    if (field === "general_average") {
      const valuesByContext = new Map<string, Map<string, { value: unknown; sourceDocumentIds: string[] }>>();
      for (const record of contextRecords) {
        const value = record.raw?.[field];
        if (value === undefined || value === null) continue;
        const raw = record.raw || {};
        const contextKey = [
          normalizeAcademicSchoolYear(raw.school_year || fallbackContext?.schoolYear),
          normalizeAcademicGradeLevel(raw.grade_level || fallbackContext?.gradeLevel),
          String(raw.section || fallbackContext?.section || "").trim().replace(/\s+/g, " ").toLowerCase(),
          normalizeGradingPeriod(raw.semester),
        ].join("|");
        const values = valuesByContext.get(contextKey) || new Map<string, { value: unknown; sourceDocumentIds: string[] }>();
        const valueKey = unifiedScalarValueKey(field, value);
        const entry: { value: unknown; sourceDocumentIds: string[] } = values.get(valueKey) || {
          value,
          sourceDocumentIds: [],
        };
        const documentId = record.documentId || raw.document_id;
        if (documentId) entry.sourceDocumentIds.push(String(documentId));
        values.set(valueKey, entry);
        valuesByContext.set(contextKey, values);
      }
      const conflictingValues = Array.from(valuesByContext.values()).filter((values) => values.size > 1);
      for (const values of conflictingValues) {
        conflicts.push({
          documentType,
          field,
          values: Array.from(values.values()).map((entry) => ({
            ...entry,
            sourceDocumentIds: Array.from(new Set(entry.sourceDocumentIds)),
          })),
        });
      }
      const distinctValues = new Set(candidates.map((candidate) => unifiedScalarValueKey(field, candidate.value)));
      if (conflictingValues.length > 0 || distinctValues.size > 1) delete merged[field];
      else if (candidates.length > 0) merged[field] = candidates[0].value;
      continue;
    }

    if (field === "semester") {
      const contexts = new Map<string, {
        schoolYear?: string;
        gradeLevel?: string;
        section?: string;
        semester: unknown;
        sourceDocumentIds: string[];
      }>();
      for (const record of contextRecords) {
        const raw = record.raw || {};
        const semester = raw.semester;
        if (semester === undefined || semester === null || semester === "") continue;
        const contextKey = [
          normalizeAcademicSchoolYear(raw.school_year || raw.schoolYear || fallbackContext?.schoolYear),
          normalizeAcademicGradeLevel(raw.grade_level || raw.gradeLevel || fallbackContext?.gradeLevel),
          String(raw.section || fallbackContext?.section || "").trim().replace(/\s+/g, " ").toLowerCase(),
          normalizeGradingPeriod(semester),
        ].join("|");
        const context: {
          schoolYear?: string;
          gradeLevel?: string;
          section?: string;
          semester: unknown;
          sourceDocumentIds: string[];
        } = contexts.get(contextKey) || {
          schoolYear: raw.school_year || raw.schoolYear || fallbackContext?.schoolYear,
          gradeLevel: raw.grade_level || raw.gradeLevel || fallbackContext?.gradeLevel,
          section: raw.section || fallbackContext?.section,
          semester,
          sourceDocumentIds: [],
        };
        const documentId = record.documentId || raw.document_id;
        if (documentId) context.sourceDocumentIds.push(String(documentId));
        contexts.set(contextKey, context);
      }

      if (contexts.size > 1) {
        delete merged[field];
        merged.semester_contexts = Array.from(contexts.values()).map((context) => ({
          ...context,
          sourceDocumentIds: Array.from(new Set(context.sourceDocumentIds)),
        }));
      } else if (candidates.length > 0) {
        merged[field] = candidates[0].value;
      }
      continue;
    }

    const values = new Map<string, { value: unknown; sourceDocumentIds: string[] }>();
    for (const candidate of candidates) {
      const valueKey = unifiedScalarValueKey(field, candidate.value);
      const entry: { value: unknown; sourceDocumentIds: string[] } =
        values.get(valueKey) || { value: candidate.value, sourceDocumentIds: [] };
      if (candidate.documentId) entry.sourceDocumentIds.push(String(candidate.documentId));
      values.set(valueKey, entry);
    }
    if (values.size > 1) {
      delete merged[field];
      conflicts.push({
        documentType,
        field,
        values: Array.from(values.values()).map((entry) => ({
          ...entry,
          sourceDocumentIds: Array.from(new Set(entry.sourceDocumentIds)),
        })),
      });
    } else if (values.size === 1) {
      merged[field] = values.values().next().value?.value;
    }
  }

  if (documentType === "sf9") {
    const attendanceByMonth = new Map<string, {
      month: string;
      values: Map<string, Array<{ value: any; sourceDocumentIds: string[] }>>;
    }>();
    for (const [recordIndex, raw] of rawRecords.entries()) {
      const months = Array.isArray(raw.attendance_months) ? raw.attendance_months : [];
      const rows = Array.isArray(raw.attendance)
        ? raw.attendance
        : Array.isArray(raw.attendance_records)
        ? raw.attendance_records
        : [];
      months.forEach((month: string, monthIndex: number) => {
        const key = normalizeAttendanceMonthKey(month);
        const monthEntry = attendanceByMonth.get(key) || {
          month,
          values: new Map<string, Array<{ value: any; sourceDocumentIds: string[] }>>(),
        };
        for (const row of rows) {
          const label = String(row.label || "");
          const value = row.values?.[monthIndex];
          if (value === undefined || value === null || value === "") continue;
          const labelValues = monthEntry.values.get(label) || [];
          const valueKey = normalizeAcademicGradeValue(value);
          if (!labelValues.some((entry) => normalizeAcademicGradeValue(entry.value) === valueKey)) {
            labelValues.push({
              value,
              sourceDocumentIds: records[recordIndex].documentId ? [records[recordIndex].documentId!] : [],
            });
          } else {
            const matchingValue = labelValues.find((entry) => normalizeAcademicGradeValue(entry.value) === valueKey);
            if (matchingValue && records[recordIndex].documentId) {
              matchingValue.sourceDocumentIds = Array.from(
                new Set([...matchingValue.sourceDocumentIds, records[recordIndex].documentId!])
              );
            }
          }
          monthEntry.values.set(label, labelValues);
        }
        attendanceByMonth.set(key, monthEntry);
      });
    }

    if (attendanceByMonth.size > 0) {
      const months = Array.from(attendanceByMonth.values());
      const labels = Array.from(
        new Set(
          rawRecords.flatMap((raw) => {
            const arr = Array.isArray(raw.attendance)
              ? raw.attendance
              : Array.isArray(raw.attendance_records)
              ? raw.attendance_records
              : [];
            return arr.map((row: any) => row.label);
          })
        )
      );
      merged.attendance_months = months.map((entry) => entry.month);
      merged.attendance_conflicts = months.flatMap((month) =>
        Array.from(month.values.entries())
          .filter(([, values]) => values.length > 1)
          .map(([label, values]) => ({ month: month.month, label, values }))
      );
      merged.attendance_sources = months.flatMap((month) =>
        Array.from(month.values.entries()).flatMap(([label, values]) =>
          values.map((entry) => ({
            month: month.month,
            label,
            sourceDocumentIds: entry.sourceDocumentIds,
          }))
        )
      );
      merged.attendance = labels.map((label) => {
        const values = months.map((entry) => {
          const candidates = entry.values.get(String(label)) || [];
          return candidates.length === 1 ? candidates[0].value : undefined;
        });
        const numericValues = months
          .filter((entry) => normalizeAttendanceMonthKey(entry.month) !== "total")
          .map((entry) => {
            const candidates = entry.values.get(String(label)) || [];
            return candidates.length === 1 ? candidates[0].value : undefined;
          })
          .map(parseNumericVal)
          .filter((value): value is number => value !== undefined);
        return {
          label,
          values,
          total: numericValues.length > 0 ? numericValues.reduce((sum, value) => sum + value, 0) : undefined,
        };
      });
    }
  } else {
    const semesters = contextRecords.flatMap(({ raw = {}, documentId }) =>
      (Array.isArray(raw.completed_semesters) ? raw.completed_semesters : []).map((semester: any) => ({
        ...semester,
        sourceDocumentId: documentId || "",
        subjects: (Array.isArray(semester.subjects) ? semester.subjects : []).map((subject: any) => ({
          ...subject,
          sourceDocumentId: documentId || "",
        })),
      }))
    );
    if (semesters.length > 0) {
      merged.completed_semesters = semesters;
    }
  }

  return merged;
}

type UnifiedSourceType = "psa" | "sf1" | "sf5a" | "sf5b" | "sf9" | "sf10";
type UnifiedSourceRecord = { raw: Record<string, unknown>; documentId?: string };
type UnifiedMergedRaw = Record<string, any>;

interface UnifiedDocumentContext {
  lrn: string;
  schoolId?: string;
  schoolYear?: string;
  gradeLevel?: string;
  section?: string;
}

interface UnifiedSourceConflict {
  documentType: UnifiedSourceType;
  field: string;
  values: Array<{ value: unknown; sourceDocumentIds: string[] }>;
}

function matchesUnifiedDocumentContext(record: { raw: any; schoolId?: string }, context?: UnifiedDocumentContext): boolean {
  if (!context) return true;
  // Documents supplied for this student evaluation are already correlated.
  // We do not reject records with conflicting LRN or differing section, so they can be
  // populated in their respective columns of the Cross-Document Matrix and compared.
  return true;
}

function unifiedScalarValueKey(field: string, value: unknown): string {
  const stringValue = typeof value === "string"
    ? value
    : value === undefined || value === null
    ? undefined
    : String(value);
  if (field === "general_average") return normalizeAcademicGradeValue(value);
  if (field === "school_year") return normalizeAcademicSchoolYear(value);
  if (field === "grade_level") return normalizeAcademicGradeLevel(value);
  if (field === "section") return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (field === "sex") return normalizeSex(stringValue);
  if (field === "birth_date") return normalizeDate(stringValue);
  if (["first_name", "last_name", "middle_name", "mother_name", "mother_maiden_name"].includes(field)) {
    return normalizeNamePart(stringValue);
  }
  return typeof value === "string" ? value.trim().toLowerCase() : stableSourceValue(value);
}

function sourceRecordContextKey(type: UnifiedSourceType, raw: Record<string, unknown>): string {
  if (type === "psa") return "identity";
  const schoolYear = normalizeAcademicSchoolYear(raw.school_year || raw.schoolYear);
  const gradeLevel = normalizeAcademicGradeLevel(raw.grade_level || raw.gradeLevel);
  const section = String(raw.section || "").trim().replace(/\s+/g, " ").toLowerCase();
  const semester = type === "sf5a" ? normalizeGradingPeriod(raw.semester) : "";
  return [schoolYear, gradeLevel, section, semester].join("|");
}

function stableSourceValue(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.map(stableSourceValue).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${key}:${stableSourceValue(record[key])}`).join(",")}}`;
}

function mergeUnifiedSourceRecords(
  type: UnifiedSourceType,
  records: UnifiedSourceRecord[]
): { raw: UnifiedMergedRaw; conflicts: UnifiedSourceConflict[]; duplicateWarnings: DuplicateScanWarning[] } {
  const groups = new Map<string, UnifiedSourceRecord[]>();
  for (const record of records) {
    const raw = record.raw || {};
    const key = sourceRecordContextKey(type, raw);
    groups.set(key, [...(groups.get(key) || []), record]);
  }

  const ignoredFields = new Set([
    "id",
    "document_id",
    "created_at",
    "updated_at",
    "row_index",
    "file_name",
    "page_number",
    "data_url",
  ]);
  const fields = new Set(records.flatMap((record) =>
    Object.keys(record.raw || {}).filter((field) => !ignoredFields.has(field))
  ));
  const merged: UnifiedMergedRaw = {};
  const conflicts: UnifiedSourceConflict[] = [];
  const duplicateWarnings: DuplicateScanWarning[] = [];

  for (const groupRecords of groups.values()) {
    const signatures = new Set(groupRecords.map((record) =>
      stableSourceValue(Object.fromEntries(
        Object.entries(record.raw || {}).filter(([field]) => !ignoredFields.has(field))
      ))
    ));
    if (groupRecords.length > 1) {
      const sourceNames = groupRecords.map((record) => record.documentId || record.raw?.document_id || record.raw?.id || "unknown source");
      duplicateWarnings.push({
        documentType: type === "psa" ? "PSA" : `${type.toUpperCase()}-SHS`,
        details: signatures.size === 1
          ? `Identical ${type.toUpperCase()} records occur more than once in the same academic context.`
          : `Conflicting ${type.toUpperCase()} records occur in the same academic context.`,
        existingSource: String(sourceNames[0]),
        newSource: String(sourceNames[1]),
        isIdentical: signatures.size === 1,
        severity: "WARNING",
      });
    }

    for (const field of fields) {
      const candidates = groupRecords
        .map((record) => ({ value: record.raw?.[field], documentId: record.documentId || record.raw?.document_id }))
        .filter((entry) => entry.value !== undefined && entry.value !== null && entry.value !== "");
      const values = new Map<string, { value: unknown; sourceDocumentIds: string[] }>();
      for (const candidate of candidates) {
        const key = stableSourceValue(candidate.value);
        const value = values.get(key) || { value: candidate.value, sourceDocumentIds: [] };
        if (candidate.documentId) value.sourceDocumentIds.push(String(candidate.documentId));
        values.set(key, value);
      }
      if (values.size > 1) {
        conflicts.push({
          documentType: type,
          field,
          values: Array.from(values.values()).map((entry) => ({
            ...entry,
            sourceDocumentIds: Array.from(new Set(entry.sourceDocumentIds)),
          })),
        });
      }
    }
  }

  if (type === "sf5a" || type === "sf5b") {
    for (const field of ["lrn", "last_name", "first_name", "middle_name", "birth_date", "sex"]) {
      const values = new Map<string, { value: unknown; sourceDocumentIds: string[] }>();
      for (const record of records) {
        const value = record.raw?.[field];
        if (value === undefined || value === null || value === "") continue;
        const key = stableSourceValue(value);
        const entry = values.get(key) || { value, sourceDocumentIds: [] };
        const documentId = record.documentId || record.raw?.document_id;
        if (documentId) entry.sourceDocumentIds.push(String(documentId));
        values.set(key, entry);
      }
      if (values.size > 1 && !conflicts.some((conflict) => conflict.field === field)) {
        conflicts.push({
          documentType: type,
          field,
          values: Array.from(values.values()).map((entry) => ({
            ...entry,
            sourceDocumentIds: Array.from(new Set(entry.sourceDocumentIds)),
          })),
        });
      }
    }
  }

  for (const field of fields) {
    const values = new Map<string, unknown>();
    for (const record of records) {
      const value = record.raw?.[field];
      if (value !== undefined && value !== null && value !== "") {
        values.set(stableSourceValue(value), value);
      }
    }
    if (values.size === 1) merged[field] = values.values().next().value;
  }

  return { raw: merged, conflicts, duplicateWarnings };
}

export function evaluateUnifiedStudentValidation(
  params: UnifiedStudentValidationParams
): UnifiedStudentValidationOutcome {
  const {
    lrn,
    fullName: initialFullName,
    studentId,
    schoolId = "500169",
    schoolYear: initialSchoolYear = "2024-2025",
    gradeLevel: initialGradeLevel = "Grade 11",
    section: initialSection,
    psa: singlePsa,
    psaRecords: suppliedPsaRecords,
    sf1: singleSf1,
    sf1Records: suppliedSf1Records,
    sf2Records = [],
    sf5a: singleSf5a,
    sf5aRecords: suppliedSf5aRecords,
    sf5b: singleSf5b,
    sf5bRecords: suppliedSf5bRecords,
    duplicateWarnings: suppliedDuplicateWarnings = [],
  } = params;

  const psaRecords = suppliedPsaRecords?.length ? suppliedPsaRecords : singlePsa ? [singlePsa] : [];
  const sf1Records = suppliedSf1Records?.length ? suppliedSf1Records : singleSf1 ? [singleSf1] : [];
  const sf5aRecords = suppliedSf5aRecords?.length ? suppliedSf5aRecords : singleSf5a ? [singleSf5a] : [];
  const sf5bRecords = suppliedSf5bRecords?.length ? suppliedSf5bRecords : singleSf5b ? [singleSf5b] : [];
  const psaMerged = mergeUnifiedSourceRecords("psa", psaRecords);
  const sf1Merged = mergeUnifiedSourceRecords("sf1", sf1Records);
  const sf5aMerged = mergeUnifiedSourceRecords("sf5a", sf5aRecords);
  const sf5bMerged = mergeUnifiedSourceRecords("sf5b", sf5bRecords);
  const psa = psaRecords.length ? { ...psaRecords[0], raw: psaMerged.raw } : undefined;
  const sf1 = sf1Records.length ? { ...sf1Records[0], raw: sf1Merged.raw } : undefined;
  const sf5a = sf5aRecords.length ? { ...sf5aRecords[0], raw: sf5aMerged.raw } : undefined;
  const sf5b = sf5bRecords.length ? { ...sf5bRecords[0], raw: sf5bMerged.raw } : undefined;
  const duplicateWarnings = [
    ...suppliedDuplicateWarnings,
    ...psaMerged.duplicateWarnings,
    ...sf1Merged.duplicateWarnings,
    ...sf5aMerged.duplicateWarnings,
    ...sf5bMerged.duplicateWarnings,
  ];

  const documentContext: UnifiedDocumentContext = {
    lrn,
    schoolId,
    schoolYear: initialSchoolYear,
    gradeLevel: initialGradeLevel,
    section: initialSection,
  };
  const sf9Records = (params.sf9Records?.length ? params.sf9Records : params.sf9 ? [params.sf9] : [])
    .filter((record) => matchesUnifiedDocumentContext(record, documentContext));
  const sf10Records = (params.sf10Records?.length ? params.sf10Records : params.sf10 ? [params.sf10] : [])
    .filter((record) => matchesUnifiedDocumentContext(record, documentContext));
  const sf9 = sf9Records[0];
  const sf10 = sf10Records[0];
  const sf9ScalarConflicts: UnifiedSourceConflict[] = [];
  const sf10ScalarConflicts: UnifiedSourceConflict[] = [];
  const sf9Raw = mergeUnifiedDocumentRecords(
    sf9Records,
    "sf9",
    documentContext,
    sf9ScalarConflicts
  );
  const sf10Raw = mergeUnifiedDocumentRecords(
    sf10Records,
    "sf10",
    documentContext,
    sf10ScalarConflicts
  );
  const sourceConflicts = [
    ...psaMerged.conflicts,
    ...sf1Merged.conflicts,
    ...sf5aMerged.conflicts,
    ...sf5bMerged.conflicts,
    ...sf9ScalarConflicts,
    ...sf10ScalarConflicts,
  ].filter((conflict) =>
    !(
      (conflict.documentType === "sf5a" && conflict.field === "action_taken") ||
      (conflict.documentType === "sf5b" && conflict.field === "action_taken")
    )
  );
  const discrepancies: DiscrepancyItem[] = [];
  const fieldsMatrix: UnifiedFieldComparisonRow[] = [];

  // 1. Document Completeness
  const hasSf1 = Boolean(sf1?.raw);
  const hasSf2 = Array.isArray(sf2Records) && sf2Records.length > 0;
  const hasSf5a = Boolean(sf5a?.raw);
  const hasSf5b = Boolean(sf5b?.raw);
  const hasSf9 = Boolean(sf9?.raw);
  const hasSf10 = Boolean(sf10?.raw);
  const hasPsa = Boolean(psa?.raw);

  const totalAvailable = [hasSf1, hasSf2, hasSf5a, hasSf5b, hasSf9, hasSf10, hasPsa].filter(Boolean).length;
  // SF1, SF2, (SF5A or SF5B), SF9, SF10 are the standard academic pipeline; PSA is supporting civil evidence.
  const { totalRequired, requiredAvailable, hasRequiredCoverage } = evaluateRequiredDocumentCoverage({
    sf1: hasSf1,
    sf2: hasSf2,
    sf5a: hasSf5a,
    sf5b: hasSf5b,
    sf9: hasSf9,
    sf10: hasSf10,
    psa: hasPsa,
  });

  // Resolve best Learner Name
  const sf1Raw = sf1?.raw || {};
  const sf9PrimaryRaw = sf9?.raw || {};
  const sf10PrimaryRaw = sf10?.raw || {};
  const psaRaw = psa?.raw || {};
  const sf5aRaw = sf5a?.raw || {};
  const sf5bRaw = sf5b?.raw || {};
  const primarySf2Raw = sf2Records[0]?.raw || {};

  const resolvedLastName =
    sf1Raw.last_name ||
    sf9PrimaryRaw.last_name ||
    sf10PrimaryRaw.last_name ||
    psaRaw.last_name ||
    parseNameParts(sf5aRaw.learner_name).lastName ||
    parseNameParts(sf5bRaw.learner_name).lastName ||
    parseNameParts(primarySf2Raw.learner_name).lastName ||
    "";

  const resolvedFirstName =
    sf1Raw.first_name ||
    sf9PrimaryRaw.first_name ||
    sf10PrimaryRaw.first_name ||
    psaRaw.first_name ||
    parseNameParts(sf5aRaw.learner_name).firstName ||
    parseNameParts(sf5bRaw.learner_name).firstName ||
    parseNameParts(primarySf2Raw.learner_name).firstName ||
    "";

  const resolvedMiddleName =
    sf1Raw.middle_name ||
    sf9PrimaryRaw.middle_name ||
    sf10PrimaryRaw.middle_name ||
    psaRaw.middle_name ||
    "";

  const derivedFullName = [resolvedLastName, resolvedFirstName].filter(Boolean).join(", ") +
    (resolvedMiddleName ? ` ${resolvedMiddleName}` : "");
  const fullName = initialFullName || derivedFullName || `Learner ${lrn}`;

  const schoolYear =
    sf1Raw.school_year ||
    sf9Raw.school_year ||
    primarySf2Raw.school_year ||
    sf5aRaw.school_year ||
    sf5bRaw.school_year ||
    initialSchoolYear;

  const gradeLevel =
    sf1Raw.grade_level ||
    sf9Raw.grade_level ||
    primarySf2Raw.grade_level ||
    sf5aRaw.grade_level ||
    sf5bRaw.grade_level ||
    initialGradeLevel;

  // ---------------------------------------------------------------------------
  // A. IDENTITY MATRIX EVALUATION
  // ---------------------------------------------------------------------------

  // 1. Learner Reference Number (LRN)
  const lrnRow: UnifiedFieldComparisonRow = {
    field: "lrn",
    category: "IDENTITY",
    label: "Learner Reference Number (LRN)",
    psaValue: hasPsa ? "Civil Document (No DepEd LRN)" : undefined,
    sf1Value: sf1Raw.lrn || undefined,
    sf2Value: primarySf2Raw.lrn || undefined,
    sf5aValue: sf5aRaw.lrn || undefined,
    sf5bValue: sf5bRaw.lrn || undefined,
    sf9Value: sf9Raw.lrn || undefined,
    sf10Value: sf10Raw.lrn || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };

  const schoolLrnSources: Array<{ doc: string; val?: string }> = [
    { doc: "SF1-SHS", val: sf1Raw.lrn },
    { doc: "SF2-SHS", val: primarySf2Raw.lrn },
    { doc: "SF5A-SHS", val: sf5aRaw.lrn },
    { doc: "SF5B-SHS", val: sf5bRaw.lrn },
    { doc: "SF9-SHS", val: sf9Raw.lrn },
    { doc: "SF10-SHS", val: sf10Raw.lrn },
  ].filter((s) => Boolean(s.val));

  lrnRow.sourcesPresent = schoolLrnSources.map((s) => s.doc);
  if (hasPsa) lrnRow.sourcesPresent.push("PSA");

  const cleanCanonicalLrn = normalizeLrn(lrn);
  if (!cleanCanonicalLrn || !isValidLrn(cleanCanonicalLrn)) {
    lrnRow.status = "NEEDS_VERIFICATION";
    lrnRow.isMatch = false;
    lrnRow.notes = "Missing or unreadable 12-digit DepEd LRN.";
    discrepancies.push({
      field: "lrn",
      sourceValue: lrn,
      targetValue: "12-digit standard LRN",
      severity: "CRITICAL",
      description: `Learner "${fullName}": Official 12-digit LRN is invalid, unreadable, or unregistered ("${lrn}").`,
    });
  } else {
    for (const src of schoolLrnSources) {
      const srcClean = normalizeLrn(src.val);
      if (srcClean !== cleanCanonicalLrn) {
        lrnRow.status = "MISMATCH";
        lrnRow.isMatch = false;
        lrnRow.notes = `LRN conflict detected: ${src.doc} has "${src.val}" vs expected "${cleanCanonicalLrn}".`;
        discrepancies.push({
          field: "lrn",
          sourceValue: cleanCanonicalLrn,
          targetValue: src.val,
          severity: "CRITICAL",
          description: `LRN conflict: ${src.doc} has "${src.val}", differing from canonical LRN "${cleanCanonicalLrn}".`,
        });
      }
    }
    if (schoolLrnSources.length >= 2) {
      const baseClean = normalizeLrn(schoolLrnSources[0].val);
      for (let i = 1; i < schoolLrnSources.length; i++) {
        const curClean = normalizeLrn(schoolLrnSources[i].val);
        if (baseClean && curClean && baseClean !== curClean) {
          lrnRow.status = "MISMATCH";
          lrnRow.isMatch = false;
          lrnRow.notes = `LRN conflict detected: ${schoolLrnSources[0].doc} (${schoolLrnSources[0].val}) vs ${schoolLrnSources[i].doc} (${schoolLrnSources[i].val}).`;
          if (!discrepancies.some((d) => d.field === "lrn" && String(d.targetValue) === String(schoolLrnSources[i].val))) {
            discrepancies.push({
              field: "lrn",
              sourceValue: schoolLrnSources[0].val,
              targetValue: schoolLrnSources[i].val,
              severity: "CRITICAL",
              description: `LRN conflict: ${schoolLrnSources[0].doc} has "${schoolLrnSources[0].val}", while ${schoolLrnSources[i].doc} has "${schoolLrnSources[i].val}".`,
            });
          }
        }
      }
    }
    if (lrnRow.isMatch) {
      lrnRow.notes = "Official 12-digit LRN verified and consistent across all present school records.";
    }
  }
  fieldsMatrix.push(lrnRow);

  // 2. Last Name
  const sf2LastName = primarySf2Raw.last_name || parseNameParts(primarySf2Raw.learner_name).lastName;
  const sf5aLastName = sf5aRaw.last_name || parseNameParts(sf5aRaw.learner_name).lastName;
  const sf5bLastName = sf5bRaw.last_name || parseNameParts(sf5bRaw.learner_name).lastName;

  const lastNameRow: UnifiedFieldComparisonRow = {
    field: "last_name",
    category: "IDENTITY",
    label: "Learner Last Name",
    psaValue: psaRaw.last_name || undefined,
    sf1Value: sf1Raw.last_name || undefined,
    sf2Value: sf2LastName || undefined,
    sf5aValue: sf5aLastName || undefined,
    sf5bValue: sf5bLastName || undefined,
    sf9Value: sf9Raw.last_name || undefined,
    sf10Value: sf10Raw.last_name || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };

  const lastNameSources: Array<{ doc: string; val?: string }> = [
    { doc: "PSA", val: psaRaw.last_name },
    { doc: "SF1-SHS", val: sf1Raw.last_name },
    { doc: "SF2-SHS", val: sf2LastName },
    { doc: "SF5A-SHS", val: sf5aLastName },
    { doc: "SF5B-SHS", val: sf5bLastName },
    { doc: "SF9-SHS", val: sf9Raw.last_name },
    { doc: "SF10-SHS", val: sf10Raw.last_name },
  ].filter((s) => Boolean(s.val));

  lastNameRow.sourcesPresent = lastNameSources.map((s) => s.doc);

  if (lastNameSources.length >= 2) {
    const normBase = normalizeNamePart(lastNameSources[0].val);
    for (let i = 1; i < lastNameSources.length; i++) {
      const normCur = normalizeNamePart(lastNameSources[i].val);
      if (normBase && normCur && normBase !== normCur) {
        const maxLen = Math.max(normBase.length, normCur.length);
        const dist = levenshteinDistance(normBase, normCur);
        const isHandwritingMatch = dist <= (maxLen >= 6 ? 2 : 1);
        if (!isHandwritingMatch) {
          lastNameRow.status = "MISMATCH";
          lastNameRow.isMatch = false;
          lastNameRow.notes = `Surname mismatch: ${lastNameSources[0].doc} ("${lastNameSources[0].val}") vs ${lastNameSources[i].doc} ("${lastNameSources[i].val}").`;
          discrepancies.push({
            field: "last_name",
            sourceValue: lastNameSources[0].val,
            targetValue: lastNameSources[i].val,
            severity: "CRITICAL",
            description: `Learner surname mismatch: ${lastNameSources[0].doc} "${lastNameSources[0].val}" vs ${lastNameSources[i].doc} "${lastNameSources[i].val}".`,
          });
          break;
        }
      }
    }
  }
  if (lastNameRow.isMatch) {
    lastNameRow.notes = "Learner surname matches across all available forms.";
  }
  fieldsMatrix.push(lastNameRow);

  // 3. First Name
  const sf2FirstName = primarySf2Raw.first_name || parseNameParts(primarySf2Raw.learner_name).firstName;
  const sf5aFirstName = sf5aRaw.first_name || parseNameParts(sf5aRaw.learner_name).firstName;
  const sf5bFirstName = sf5bRaw.first_name || parseNameParts(sf5bRaw.learner_name).firstName;

  const firstNameRow: UnifiedFieldComparisonRow = {
    field: "first_name",
    category: "IDENTITY",
    label: "Learner First Name",
    psaValue: psaRaw.first_name || undefined,
    sf1Value: sf1Raw.first_name || undefined,
    sf2Value: sf2FirstName || undefined,
    sf5aValue: sf5aFirstName || undefined,
    sf5bValue: sf5bFirstName || undefined,
    sf9Value: sf9Raw.first_name || undefined,
    sf10Value: sf10Raw.first_name || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };

  const firstNameSources: Array<{ doc: string; val?: string }> = [
    { doc: "PSA", val: psaRaw.first_name },
    { doc: "SF1-SHS", val: sf1Raw.first_name },
    { doc: "SF2-SHS", val: sf2FirstName },
    { doc: "SF5A-SHS", val: sf5aFirstName },
    { doc: "SF5B-SHS", val: sf5bFirstName },
    { doc: "SF9-SHS", val: sf9Raw.first_name },
    { doc: "SF10-SHS", val: sf10Raw.first_name },
  ].filter((s) => Boolean(s.val));

  firstNameRow.sourcesPresent = firstNameSources.map((s) => s.doc);

  if (firstNameSources.length >= 2) {
    const normBase = normalizeNamePart(firstNameSources[0].val);
    for (let i = 1; i < firstNameSources.length; i++) {
      const normCur = normalizeNamePart(firstNameSources[i].val);
      if (normBase && normCur && normBase !== normCur && !normBase.includes(normCur) && !normCur.includes(normBase)) {
        const maxLen = Math.max(normBase.length, normCur.length);
        const dist = levenshteinDistance(normBase, normCur);
        const isHandwritingMatch = dist <= (maxLen >= 6 ? 2 : 1);
        if (!isHandwritingMatch) {
          firstNameRow.status = "MISMATCH";
          firstNameRow.isMatch = false;
          firstNameRow.notes = `First name mismatch: ${firstNameSources[0].doc} ("${firstNameSources[0].val}") vs ${firstNameSources[i].doc} ("${firstNameSources[i].val}").`;
          discrepancies.push({
            field: "first_name",
            sourceValue: firstNameSources[0].val,
            targetValue: firstNameSources[i].val,
            severity: "CRITICAL",
            description: `Learner first name mismatch: ${firstNameSources[0].doc} "${firstNameSources[0].val}" vs ${firstNameSources[i].doc} "${firstNameSources[i].val}".`,
          });
          break;
        }
      }
    }
  }
  if (firstNameRow.isMatch) {
    firstNameRow.notes = "Learner first name verified across available documents.";
  }
  fieldsMatrix.push(firstNameRow);

  // 4. Middle Name
  const sf2MiddleName = primarySf2Raw.middle_name || parseNameParts(primarySf2Raw.learner_name).middleName;
  const middleNameRow: UnifiedFieldComparisonRow = {
    field: "middle_name",
    category: "IDENTITY",
    label: "Learner Middle Name",
    psaValue: psaRaw.middle_name || undefined,
    sf1Value: sf1Raw.middle_name || undefined,
    sf2Value: sf2MiddleName || undefined,
    sf9Value: sf9Raw.middle_name || undefined,
    sf10Value: sf10Raw.middle_name || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };

  const middleSources = [
    { doc: "PSA", val: psaRaw.middle_name },
    { doc: "SF1-SHS", val: sf1Raw.middle_name },
    { doc: "SF2-SHS", val: sf2MiddleName },
    { doc: "SF9-SHS", val: sf9Raw.middle_name },
    { doc: "SF10-SHS", val: sf10Raw.middle_name },
  ].filter((s) => Boolean(s.val));

  middleNameRow.sourcesPresent = middleSources.map((s) => s.doc);
  if (middleSources.length >= 2) {
    const base = normalizeNamePart(middleSources[0].val);
    for (let i = 1; i < middleSources.length; i++) {
      const cur = normalizeNamePart(middleSources[i].val);
      if (base && cur && base !== cur) {
        // Initial match check (e.g. "SANTOS" vs "S")
        const isInitialMatch = (base.length === 1 && cur.startsWith(base)) || (cur.length === 1 && base.startsWith(cur));
        const maxLen = Math.max(base.length, cur.length);
        const dist = levenshteinDistance(base, cur);
        const isHandwritingMatch = dist <= (maxLen >= 6 ? 2 : 1);
        if (!isInitialMatch && !isHandwritingMatch) {
          middleNameRow.status = "NEEDS_VERIFICATION";
          middleNameRow.isMatch = false;
          middleNameRow.notes = `Middle name difference: ${middleSources[0].doc} ("${middleSources[0].val}") vs ${middleSources[i].doc} ("${middleSources[i].val}").`;
          discrepancies.push({
            field: "middle_name",
            sourceValue: middleSources[0].val,
            targetValue: middleSources[i].val,
            severity: "WARNING",
            description: `Middle name variation: ${middleSources[0].doc} has "${middleSources[0].val}", while ${middleSources[i].doc} has "${middleSources[i].val}".`,
          });
        }
      }
    }
  }
  fieldsMatrix.push(middleNameRow);

  // 5. Sex / Gender
  const sexRow: UnifiedFieldComparisonRow = {
    field: "sex",
    category: "IDENTITY",
    label: "Sex / Gender",
    psaValue: psaRaw.sex || undefined,
    sf1Value: sf1Raw.sex || undefined,
    sf9Value: sf9Raw.sex || undefined,
    sf10Value: sf10Raw.sex || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };

  const sexSources = [
    { doc: "PSA", val: psaRaw.sex },
    { doc: "SF1-SHS", val: sf1Raw.sex },
    { doc: "SF9-SHS", val: sf9Raw.sex },
    { doc: "SF10-SHS", val: sf10Raw.sex },
  ].filter((s) => Boolean(s.val));

  sexRow.sourcesPresent = sexSources.map((s) => s.doc);
  if (sexSources.length >= 2) {
    const baseSex = normalizeStrictSex(sexSources[0].val);
    for (let i = 1; i < sexSources.length; i++) {
      const curSex = normalizeStrictSex(sexSources[i].val);
      if (baseSex && curSex && baseSex !== curSex) {
        sexRow.status = "MISMATCH";
        sexRow.isMatch = false;
        sexRow.notes = `Wrong Sex/Gender: ${sexSources[0].doc} ("${baseSex}") vs ${sexSources[i].doc} ("${curSex}").`;
        discrepancies.push({
          field: "sex",
          sourceValue: baseSex || sexSources[0].val,
          targetValue: curSex || sexSources[i].val,
          severity: "CRITICAL",
          description: `Wrong Sex/Gender: Sex does not match across documents (${sexSources[0].doc}: ${baseSex} vs ${sexSources[i].doc}: ${curSex}).`,
        });
      }
    }
  }
  fieldsMatrix.push(sexRow);

  // 6. Date of Birth
  const psaDob = psaRaw.birth_date || psaRaw.date_of_birth || psaRaw.birthDate;
  const sf1Dob = sf1Raw.birth_date || sf1Raw.birthDate;
  const sf2Dob = primarySf2Raw.birth_date || primarySf2Raw.birthDate;
  const sf9Dob = sf9Raw.birth_date || sf9Raw.date_of_birth || sf9Raw.birthDate;
  const sf10Dob = sf10Raw.birth_date || sf10Raw.date_of_birth || sf10Raw.birthDate;

  const birthRow: UnifiedFieldComparisonRow = {
    field: "birth_date",
    category: "IDENTITY",
    label: "Date of Birth",
    psaValue: psaDob || undefined,
    sf1Value: sf1Dob || undefined,
    sf2Value: sf2Dob || undefined,
    sf9Value: sf9Dob || undefined,
    sf10Value: sf10Dob || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };

  const birthSources = [
    { doc: "PSA", val: psaDob },
    { doc: "SF1-SHS", val: sf1Dob },
    { doc: "SF2-SHS", val: sf2Dob },
    { doc: "SF9-SHS", val: sf9Dob },
    { doc: "SF10-SHS", val: sf10Dob },
  ].filter((s) => Boolean(s.val));

  birthRow.sourcesPresent = birthSources.map((s) => s.doc);
  if (birthSources.length >= 2) {
    const baseDate = toIsoBirthDate(birthSources[0].val);
    for (let i = 1; i < birthSources.length; i++) {
      const curDate = toIsoBirthDate(birthSources[i].val);
      if (baseDate && curDate && baseDate !== curDate) {
        birthRow.status = "MISMATCH";
        birthRow.isMatch = false;
        birthRow.notes = `Date of birth mismatch: ${birthSources[0].doc} ("${birthSources[0].val}") vs ${birthSources[i].doc} ("${birthSources[i].val}").`;
        discrepancies.push({
          field: "birth_date",
          sourceValue: birthSources[0].val,
          targetValue: birthSources[i].val,
          severity: "CRITICAL",
          description: `Birth date discrepancy: ${birthSources[0].doc} has "${birthSources[0].val}", while ${birthSources[i].doc} has "${birthSources[i].val}".`,
        });
      }
    }
  }
  fieldsMatrix.push(birthRow);

  // Note: Mother's Maiden Name is excluded from Cross-Document Matrix & Validation
  // to focus strictly on student-specific fields.

  // ---------------------------------------------------------------------------
  // B. SCHOOL CONTEXT MATRIX EVALUATION
  // ---------------------------------------------------------------------------

  // 1. School ID (500169 for TRIS)
  const schoolIdRow: UnifiedFieldComparisonRow = {
    field: "school_id",
    category: "SCHOOL_CONTEXT",
    label: "DepEd School ID",
    sf1Value: sf1Raw.school_id || undefined,
    sf2Value: primarySf2Raw.school_id || undefined,
    sf5aValue: sf5aRaw.school_id || undefined,
    sf5bValue: sf5bRaw.school_id || undefined,
    sf9Value: sf9Raw.school_id || undefined,
    sf10Value: sf10Raw.school_id || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };
  const schoolIdSources = [
    { doc: "SF1-SHS", val: sf1Raw.school_id },
    { doc: "SF2-SHS", val: primarySf2Raw.school_id },
    { doc: "SF5A-SHS", val: sf5aRaw.school_id },
    { doc: "SF5B-SHS", val: sf5bRaw.school_id },
    { doc: "SF9-SHS", val: sf9Raw.school_id },
    { doc: "SF10-SHS", val: sf10Raw.school_id },
  ].filter((s) => Boolean(s.val));
  schoolIdRow.sourcesPresent = schoolIdSources.map((s) => s.doc);
  for (const src of schoolIdSources) {
    if (src.val && src.val !== "500169" && src.val !== schoolId) {
      schoolIdRow.status = "MISMATCH";
      schoolIdRow.isMatch = false;
      schoolIdRow.notes = `Conflicting School ID on ${src.doc}: "${src.val}" (Expected: 500169).`;
      discrepancies.push({
        field: "school_id",
        sourceValue: "500169",
        targetValue: src.val,
        severity: "CRITICAL",
        description: `School ID conflict: ${src.doc} has "${src.val}", differing from official school ID 500169.`,
      });
    }
  }
  fieldsMatrix.push(schoolIdRow);

  // 2. School Year
  const syRow: UnifiedFieldComparisonRow = {
    field: "school_year",
    category: "SCHOOL_CONTEXT",
    label: "School Year",
    sf1Value: sf1Raw.school_year || undefined,
    sf2Value: primarySf2Raw.school_year || undefined,
    sf5aValue: sf5aRaw.school_year || undefined,
    sf5bValue: sf5bRaw.school_year || undefined,
    sf9Value: sf9Raw.school_year || undefined,
    sf10Value: sf10Raw.school_year || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };
  const sySources = [
    { doc: "SF1-SHS", val: sf1Raw.school_year },
    { doc: "SF2-SHS", val: primarySf2Raw.school_year },
    { doc: "SF5A-SHS", val: sf5aRaw.school_year },
    { doc: "SF5B-SHS", val: sf5bRaw.school_year },
    { doc: "SF9-SHS", val: sf9Raw.school_year },
  ].filter((s) => Boolean(s.val));
  syRow.sourcesPresent = sySources.map((s) => s.doc);

  if (sySources.length >= 2) {
    const baseSy = sySources[0].val?.replace(/\s+/g, "");
    for (let i = 1; i < sySources.length; i++) {
      const curSy = sySources[i].val?.replace(/\s+/g, "");
      if (baseSy && curSy && baseSy !== curSy) {
        syRow.status = "MISMATCH";
        syRow.isMatch = false;
        syRow.notes = `Conflicting school year: ${sySources[0].doc} (${baseSy}) vs ${sySources[i].doc} (${curSy}).`;
        discrepancies.push({
          field: "school_year",
          sourceValue: baseSy,
          targetValue: curSy,
          severity: "CRITICAL",
          description: `School year conflict: ${sySources[0].doc} has "${baseSy}", while ${sySources[i].doc} has "${curSy}".`,
        });
      }
    }
  }
  // Check SF10 cumulative progression:
  if (hasSf10) {
    syRow.sourcesPresent.push("SF10-SHS");
    // SF10 is cumulative permanent record; legitimate progression to Grade 12 or matching S.Y. is acceptable
    syRow.notes = syRow.isMatch ? "School year validated across all active reporting records." : syRow.notes;
  }
  fieldsMatrix.push(syRow);

  // 3. Grade Level
  const gradeRow: UnifiedFieldComparisonRow = {
    field: "grade_level",
    category: "SCHOOL_CONTEXT",
    label: "Grade Level",
    sf1Value: sf1Raw.grade_level || undefined,
    sf2Value: primarySf2Raw.grade_level || undefined,
    sf5aValue: sf5aRaw.grade_level || undefined,
    sf5bValue: sf5bRaw.grade_level || (hasSf5b ? "Grade 12" : undefined),
    sf9Value: sf9Raw.grade_level || undefined,
    sf10Value: sf10Raw.grade_level || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };
  const gradeSources = [
    { doc: "SF1-SHS", val: sf1Raw.grade_level },
    { doc: "SF2-SHS", val: primarySf2Raw.grade_level },
    { doc: "SF5A-SHS", val: sf5aRaw.grade_level },
    { doc: "SF9-SHS", val: sf9Raw.grade_level },
  ].filter((s) => Boolean(s.val));
  gradeRow.sourcesPresent = gradeSources.map((s) => s.doc);

  if (gradeSources.length >= 2) {
    const baseG = gradeSources[0].val?.includes("12") ? "Grade 12" : "Grade 11";
    for (let i = 1; i < gradeSources.length; i++) {
      const curG = gradeSources[i].val?.includes("12") ? "Grade 12" : "Grade 11";
      if (baseG !== curG) {
        gradeRow.status = "MISMATCH";
        gradeRow.isMatch = false;
        gradeRow.notes = `Grade level conflict: ${gradeSources[0].doc} (${baseG}) vs ${gradeSources[i].doc} (${curG}).`;
        discrepancies.push({
          field: "grade_level",
          sourceValue: baseG,
          targetValue: curG,
          severity: "CRITICAL",
          description: `Grade level mismatch: ${gradeSources[0].doc} reports "${baseG}", while ${gradeSources[i].doc} reports "${curG}".`,
        });
      }
    }
  }
  // Check SF5B graduation candidate requirement
  if (hasSf5b) {
    gradeRow.sourcesPresent.push("SF5B-SHS");
    const isGr12 = (gradeLevel || "").includes("12") || (sf9Raw.grade_level || "").includes("12");
    if (!isGr12) {
      gradeRow.status = "MISMATCH";
      gradeRow.isMatch = false;
      gradeRow.notes = "SF5B graduation candidates report is strictly applicable to Grade 12 learners.";
      discrepancies.push({
        field: "grade_level_sf5b",
        sourceValue: "Grade 12 Required",
        targetValue: gradeLevel || "Grade 11",
        severity: "CRITICAL",
        description: "SF5B-SHS graduation report filed for learner not enrolled in Senior High School Grade 12.",
      });
    }
  }
  if (hasSf10) gradeRow.sourcesPresent.push("SF10-SHS");
  fieldsMatrix.push(gradeRow);

  // 4. Section
  const secRow: UnifiedFieldComparisonRow = {
    field: "section",
    category: "SCHOOL_CONTEXT",
    label: "Section Assignment",
    sf1Value: sf1Raw.section || undefined,
    sf2Value: primarySf2Raw.section || undefined,
    sf5aValue: sf5aRaw.section || undefined,
    sf5bValue: sf5bRaw.section || undefined,
    sf9Value: sf9Raw.section || undefined,
    sf10Value: sf10Raw.section || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };
  const secSources = [
    { doc: "SF1-SHS", val: sf1Raw.section },
    { doc: "SF2-SHS", val: primarySf2Raw.section },
    { doc: "SF5A-SHS", val: sf5aRaw.section },
    { doc: "SF5B-SHS", val: sf5bRaw.section },
    { doc: "SF9-SHS", val: sf9Raw.section },
    { doc: "SF10-SHS", val: sf10Raw.section },
  ].filter((s) => Boolean(s.val));
  secRow.sourcesPresent = secSources.map((s) => s.doc);

  if (secSources.length >= 2) {
    const baseSec = secSources[0].val?.trim().toLowerCase();
    for (let i = 1; i < secSources.length; i++) {
      const curSec = secSources[i].val?.trim().toLowerCase();
      if (baseSec && curSec && baseSec !== curSec) {
        secRow.status = "NEEDS_VERIFICATION";
        secRow.isMatch = false;
        secRow.notes = `Section variance: ${secSources[0].doc} ("${secSources[0].val}") vs ${secSources[i].doc} ("${secSources[i].val}").`;
        discrepancies.push({
          field: "section",
          sourceValue: secSources[0].val,
          targetValue: secSources[i].val,
          severity: "WARNING",
          category: "NEEDS_VERIFICATION",
          description: `Section variance: ${secSources[0].doc} reports "${secSources[0].val}", while ${secSources[i].doc} reports "${secSources[i].val}". Adviser verification required.`,
        });
      }
    }
  }
  fieldsMatrix.push(secRow);

  // 5. Track and Strand
  const strandRow: UnifiedFieldComparisonRow = {
    field: "track_strand",
    category: "SCHOOL_CONTEXT",
    label: "Track & Strand",
    sf1Value: sf1Raw.strand || sf1Raw.track_strand || undefined,
    sf5aValue: sf5aRaw.strand || undefined,
    sf5bValue: sf5bRaw.strand || undefined,
    sf9Value: sf9Raw.strand || sf9Raw.track_strand || undefined,
    sf10Value: sf10Raw.strand || sf10Raw.track_strand || undefined,
    status: "MATCH",
    isMatch: true,
    sourcesPresent: [],
  };
  const strandSources = [
    { doc: "SF1-SHS", val: sf1Raw.strand || sf1Raw.track_strand },
    { doc: "SF5A-SHS", val: sf5aRaw.strand },
    { doc: "SF5B-SHS", val: sf5bRaw.strand },
    { doc: "SF9-SHS", val: sf9Raw.strand || sf9Raw.track_strand },
    { doc: "SF10-SHS", val: sf10Raw.strand || sf10Raw.track_strand },
  ].filter((s) => Boolean(s.val));
  strandRow.sourcesPresent = strandSources.map((s) => s.doc);

  if (strandSources.length >= 2) {
    const baseSt = strandSources[0].val?.trim().toLowerCase();
    for (let i = 1; i < strandSources.length; i++) {
      const curSt = strandSources[i].val?.trim().toLowerCase();
      if (baseSt && curSt && !baseSt.includes(curSt) && !curSt.includes(baseSt)) {
        strandRow.status = "MISMATCH";
        strandRow.isMatch = false;
        strandRow.notes = `Strand mismatch: ${strandSources[0].doc} ("${strandSources[0].val}") vs ${strandSources[i].doc} ("${strandSources[i].val}").`;
        discrepancies.push({
          field: "track_strand",
          sourceValue: strandSources[0].val,
          targetValue: strandSources[i].val,
          severity: "CRITICAL",
          description: `Senior High School strand mismatch: ${strandSources[0].doc} reports "${strandSources[0].val}", while ${strandSources[i].doc} reports "${strandSources[i].val}".`,
        });
      }
    }
  }
  fieldsMatrix.push(strandRow);

  // ---------------------------------------------------------------------------
  // C. ATTENDANCE MATRIX (SF2 Daily / Monthly vs SF9 Monthly Table)
  // ---------------------------------------------------------------------------
  const sf9AttendanceRecords: any[] = Array.isArray(sf9Raw.attendance)
    ? sf9Raw.attendance
    : Array.isArray(sf9Raw.attendance_records)
    ? sf9Raw.attendance_records
    : [];
  const sf9AttendanceMonths: string[] = Array.isArray(sf9Raw.attendance_months) ? sf9Raw.attendance_months : [];

  const sf2ByMonth = groupAttendanceRecords(sf2Records);

  // Extract SF9 rows
  const schoolDaysRow = sf9AttendanceRecords.find((a) => (a.label || "").toLowerCase().includes("school days") || (a.label || "").toLowerCase().includes("araw ng pasok"));
  const daysPresentRow = sf9AttendanceRecords.find((a) => (a.label || "").toLowerCase().includes("present") || (a.label || "").toLowerCase().includes("pumasok"));
  const daysAbsentRow = sf9AttendanceRecords.find((a) => (a.label || "").toLowerCase().includes("absent") || (a.label || "").toLowerCase().includes("lumiban"));

  const sf9MonthIndex = new Map(
    sf9AttendanceMonths.map((month, index) => [normalizeAttendanceMonthKey(month), index])
  );
  const attendanceMonths = [
    ...sf9AttendanceMonths
      .map((monthName, index) => ({ monthName, index }))
      .filter(({ monthName }) => normalizeAttendanceMonthKey(monthName) !== "total"),
    ...Array.from(sf2ByMonth.entries())
      .filter(([monthKey]) => monthKey !== "total" && !sf9MonthIndex.has(monthKey))
      .map(([monthKey, group]) => ({ monthName: group.month || monthKey, index: -1 })),
  ];

  const seenAttendanceMonthKeys = new Set<string>();
  for (const { monthName, index: mIdx } of attendanceMonths) {
    const mKey = normalizeAttendanceMonthKey(monthName);
    if (!mKey || mKey === "total") continue;
    if (seenAttendanceMonthKeys.has(mKey)) continue;
    seenAttendanceMonthKeys.add(mKey);
    const sf9Pres = mIdx >= 0 ? parseNumericVal(daysPresentRow?.values?.[mIdx]) : undefined;
    const sf9Abs = mIdx >= 0 ? parseNumericVal(daysAbsentRow?.values?.[mIdx]) : undefined;
    const sf9Days = mIdx >= 0 ? parseNumericVal(schoolDaysRow?.values?.[mIdx]) : undefined;

    const sf2MonthGroup = sf2ByMonth.get(mKey);
    const sf2Conflict = Boolean(sf2MonthGroup?.hasConflict);
    const matchingSf2 = sf2Conflict ? undefined : sf2MonthGroup?.records[0]?.raw;
    const sf2Pres = parseNumericVal(matchingSf2?.days_present);
    const sf2Abs = parseNumericVal(matchingSf2?.days_absent);
    const sf2Days = parseNumericVal(matchingSf2?.total_school_days);
    const sf2Tardy = parseNumericVal(
      matchingSf2?.days_tardy ?? matchingSf2?.tardy ?? matchingSf2?.gridTardyCount ?? matchingSf2?.writtenTardy
    );

    const sf2Formatted = sf2Conflict
      ? `Conflicting SF2 records: ${sf2MonthGroup!.records.map((record) =>
          `${record.sourceDocumentIds.join(",") || "unknown source"} (Pres: ${record.raw.days_present ?? "-"}, Abs: ${record.raw.days_absent ?? "-"}, Tot: ${record.raw.total_school_days ?? "-"})`
        ).join("; ")}`
      : matchingSf2
      ? `Pres: ${sf2Pres ?? "-"}, Abs: ${sf2Abs ?? "-"}${sf2Tardy !== undefined ? `, Tardy: ${sf2Tardy}` : ""}${sf2Days !== undefined ? `, Tot: ${sf2Days}` : ""}`
      : undefined;
    const sf9MonthConflicts = (sf9Raw.attendance_conflicts || []).filter(
      (conflict: any) => normalizeAttendanceMonthKey(conflict.month) === mKey
    );
    const sf9Conflict = sf9MonthConflicts.length > 0;
    const sf9Formatted = sf9Conflict
      ? `Conflicting SF9 records: ${sf9MonthConflicts.map((conflict: any) =>
          `${conflict.label}=${conflict.values.map((entry: any) =>
            `${entry.sourceDocumentIds.join(",") || "unknown source"}:${entry.value}`
          ).join(" vs ")}`
        ).join("; ")}`
      : (sf9Pres !== undefined || sf9Abs !== undefined)
      ? `Pres: ${sf9Pres ?? "-"}, Abs: ${sf9Abs ?? "-"}${sf9Days !== undefined ? `, Tot: ${sf9Days}` : ""}`
      : undefined;

    const sourcesPresent: string[] = [];
    if (hasSf1) sourcesPresent.push("SF1-SHS (Enrolled)");
    if (sf2MonthGroup) sourcesPresent.push("SF2-SHS");
    if (sf9Formatted) sourcesPresent.push("SF9-SHS");

    let attStatus: UnifiedFieldComparisonRow["status"] = "MATCH";
    let attNotes = "Monthly attendance reconciled.";

    if (sf2Conflict) {
      attStatus = "NEEDS_VERIFICATION";
      attNotes = `Conflicting SF2 records for ${monthName}; no record was selected for comparison or annual totals.`;
      discrepancies.push({
        field: `duplicate_sf2_attendance_${mKey.toLowerCase()}`,
        sourceValue: sf2MonthGroup!.records.map((record) => ({
          sourceDocumentIds: record.sourceDocumentIds,
          totalSchoolDays: record.raw.total_school_days,
          daysPresent: record.raw.days_present,
          daysAbsent: record.raw.days_absent,
        })),
        targetValue: "One consistent attendance record per learner and month",
        severity: "WARNING",
        category: "NEEDS_VERIFICATION",
        description: `Conflicting SF2 attendance records were found for ${monthName}. Review the listed source records; their values were excluded from annual totals.`,
      });
    } else if (sf9Conflict) {
      attStatus = "NEEDS_VERIFICATION";
      attNotes = `Conflicting SF9 attendance values for ${monthName}; no value was selected for comparison or annual totals.`;
      discrepancies.push({
        field: `duplicate_sf9_attendance_${mKey.toLowerCase()}`,
        sourceValue: sf9MonthConflicts,
        targetValue: "One consistent attendance value per learner and month",
        severity: "WARNING",
        category: "NEEDS_VERIFICATION",
        description: `Conflicting SF9 attendance values were found for ${monthName}. Review the listed source records; their values were excluded from annual totals.`,
      });
    } else if (matchingSf2 && sf9Formatted) {
      const presMatch = (sf2Pres !== undefined && sf9Pres !== undefined) ? Math.abs(sf2Pres - sf9Pres) < 0.01 : true;
      const absMatch = (sf2Abs !== undefined && sf9Abs !== undefined) ? Math.abs(sf2Abs - sf9Abs) < 0.01 : true;
      const daysMatch = (sf2Days !== undefined && sf9Days !== undefined) ? Math.abs(sf2Days - sf9Days) < 0.01 : true;

      if (!presMatch || !absMatch || !daysMatch) {
        attStatus = "MISMATCH";
        const deltaDays = (sf2Days ?? 0) - (sf9Days ?? 0);
        const deltaPres = (sf2Pres ?? 0) - (sf9Pres ?? 0);
        const deltaAbs = (sf2Abs ?? 0) - (sf9Abs ?? 0);
        const formattedMonthLabel = formatDepEdMonthDisplay(monthName);
        attNotes = `Monthly discrepancy for ${formattedMonthLabel}: SF2 (${sf2Formatted}) vs SF9 (${sf9Formatted}). Deltas: Pres ${deltaPres >= 0 ? `+${deltaPres}` : deltaPres}, Abs ${deltaAbs >= 0 ? `+${deltaAbs}` : deltaAbs}.`;
        discrepancies.push({
          field: `monthly_attendance_${mKey.toLowerCase()}`,
          sourceValue: sf2Formatted,
          targetValue: sf9Formatted,
          severity: "CRITICAL",
          category: "MISMATCH",
          description: `Attendance mismatch in ${formattedMonthLabel}: SF2 reports "${sf2Formatted}", while SF9 report card reports "${sf9Formatted}". Pres delta: ${deltaPres}, Abs delta: ${deltaAbs}.`,
        });
      } else {
        attStatus = "MATCH";
        attNotes = `Monthly attendance reconciled for ${formatDepEdMonthDisplay(monthName)} (School Days: ${sf2Days ?? sf9Days ?? "-"}, Present: ${sf2Pres ?? sf9Pres ?? "-"}, Absent: ${sf2Abs ?? sf9Abs ?? 0}).`;
      }

      // Check daily grid for unreadable marks
      if (Array.isArray(matchingSf2.daily_grid)) {
        const unknownMarks = matchingSf2.daily_grid.filter((g: any) => g.status === "UNKNOWN" || g.status === "NEEDS_VERIFICATION");
        if (unknownMarks.length > 0) {
          attStatus = "NEEDS_VERIFICATION";
          attNotes += ` (SF2 daily grid has ${unknownMarks.length} unreadable marks requiring verification).`;
        }
      }
    } else if (sf9Formatted && !matchingSf2) {
      attStatus = "NOT_APPLICABLE";
      attNotes = `SF2 monthly report for ${formatDepEdMonthDisplay(monthName)} is pending upload.`;
    } else if (matchingSf2 && !sf9Formatted) {
      attStatus = "NOT_APPLICABLE";
      attNotes = `SF2 attendance recorded for ${formatDepEdMonthDisplay(monthName)}, but SF9 has blank column.`;
    }

    const fullName = (getDepEdMonthFullName(mKey) || mKey).toLowerCase();
    const primaryAttRow: UnifiedFieldComparisonRow = {
      field: `attendance_${fullName}`,
      category: "ATTENDANCE",
      label: `Attendance — ${formatDepEdMonthDisplay(monthName)}`,
      sf1Value: hasSf1 ? "Enrolled" : undefined,
      sf2Value: sf2Formatted,
      sf9Value: sf9Formatted,
      status: attStatus,
      isMatch: attStatus === "MATCH" || attStatus === "NOT_APPLICABLE",
      notes: attNotes,
      sourceDocumentIds: Array.from(new Set([
        ...(sf2MonthGroup?.sourceDocumentIds || []),
        ...(sf9Raw.attendance_sources || [])
          .filter((source: any) => normalizeAttendanceMonthKey(source.month) === mKey)
          .flatMap((source: any) => source.sourceDocumentIds || []),
      ])),
      sourcesPresent,
    };
    fieldsMatrix.push(primaryAttRow);
  }

  // Attendance Annual Summary Totals
  const totalColIdx = sf9AttendanceMonths.findIndex((m) => normalizeAttendanceMonthKey(m) === "total");
  const sf9PrintedTotPres = totalColIdx >= 0
    ? parseNumericVal(daysPresentRow?.values?.[totalColIdx]) ?? parseNumericVal(daysPresentRow?.total)
    : parseNumericVal(daysPresentRow?.total);
  const sf9PrintedTotAbs = totalColIdx >= 0
    ? parseNumericVal(daysAbsentRow?.values?.[totalColIdx]) ?? parseNumericVal(daysAbsentRow?.total)
    : parseNumericVal(daysAbsentRow?.total);
  const sf9PrintedTotDays = totalColIdx >= 0
    ? parseNumericVal(schoolDaysRow?.values?.[totalColIdx]) ?? parseNumericVal(schoolDaysRow?.total)
    : parseNumericVal(schoolDaysRow?.total);

  let totalSf2Pres = 0;
  let totalSf2Abs = 0;
  let totalSf2Days = 0;
  let hasPopulatedSf2 = false;

  const attendanceMonthGroups = Array.from(sf2ByMonth.values());
  const hasAttendanceConflict = attendanceMonthGroups.some((group) => group.hasConflict) ||
    (sf9Raw.attendance_conflicts || []).length > 0;
  for (const group of attendanceMonthGroups) {
    if (group.hasConflict) continue;
    const raw = group.records[0]?.raw || {};
    const p = parseNumericVal(raw.days_present);
    const a = parseNumericVal(raw.days_absent);
    const d = parseNumericVal(raw.total_school_days);
    if (p !== undefined || a !== undefined) {
      if (p !== undefined) totalSf2Pres += p;
      if (a !== undefined) totalSf2Abs += a;
      if (d !== undefined) totalSf2Days += d;
      hasPopulatedSf2 = true;
    }
  }

  const uploadedMonths = attendanceMonthGroups.filter((g) => !g.hasConflict);
  const uploadedMonthsCount = uploadedMonths.length;
  const uploadedMonthNames = uploadedMonths.map((g) => formatDepEdMonthDisplay(g.month));

  const annualSources: string[] = [];
  if (hasPopulatedSf2) annualSources.push("SF2-SHS");
  if (hasSf9) annualSources.push("SF9-SHS");

  let annualStatus: UnifiedFieldComparisonRow["status"] = "MATCH";
  let annualNotes = "Annual attendance summary evaluated with one contribution per learner/month.";
  let isAnnualMatch = true;

  if (hasAttendanceConflict) {
    annualStatus = "NEEDS_VERIFICATION";
    isAnnualMatch = false;
    annualNotes = "Attendance totals exclude conflicting duplicate records; review the monthly discrepancies.";
  } else if (hasPopulatedSf2 && (sf9PrintedTotPres !== undefined || sf9PrintedTotAbs !== undefined)) {
    if (uploadedMonthsCount >= 11) {
      // Complete 11-month SF2 attendance uploaded: compare cumulative totals directly
      const presTotalMatch = sf9PrintedTotPres !== undefined ? Math.abs(totalSf2Pres - sf9PrintedTotPres) < 0.01 : true;
      const absTotalMatch = sf9PrintedTotAbs !== undefined ? Math.abs(totalSf2Abs - sf9PrintedTotAbs) < 0.01 : true;
      const daysTotalMatch = sf9PrintedTotDays !== undefined ? Math.abs(totalSf2Days - sf9PrintedTotDays) < 0.01 : true;

      if (!presTotalMatch || !absTotalMatch || !daysTotalMatch) {
        annualStatus = "MISMATCH";
        isAnnualMatch = false;
        annualNotes = `Cumulative total attendance mismatch across all 11 months: SF2 sum (Days: ${totalSf2Days}, Pres: ${totalSf2Pres}, Abs: ${totalSf2Abs}) vs SF9 Total (Days: ${sf9PrintedTotDays ?? "-"}, Pres: ${sf9PrintedTotPres ?? "-"}, Abs: ${sf9PrintedTotAbs ?? "-"}).`;
        discrepancies.push({
          field: "annual_attendance_total",
          sourceValue: `SF2 Sum: Pres ${totalSf2Pres}, Abs ${totalSf2Abs}, Days ${totalSf2Days}`,
          targetValue: `SF9 Total: Pres ${sf9PrintedTotPres}, Abs ${sf9PrintedTotAbs}, Days ${sf9PrintedTotDays}`,
          severity: "CRITICAL",
          category: "MISMATCH",
          description: annualNotes,
        });
      } else {
        annualStatus = "MATCH";
        annualNotes = `All 11 months reconciled. Cumulative totals match SF9 Front Total column (School Days: ${totalSf2Days}, Present: ${totalSf2Pres}, Absent: ${totalSf2Abs}).`;
      }
    } else {
      // Partial coverage (e.g. 1 month uploaded, e.g. June): show progress without false mismatch
      annualStatus = "MATCH";
      isAnnualMatch = true;
      annualNotes = `${uploadedMonthsCount} of 11 months compared (${uploadedMonthNames.join(", ")}); cumulative total comparison pending remaining ${11 - uploadedMonthsCount} months.`;
    }
  }

  const annualRow: UnifiedFieldComparisonRow = {
    field: "attendance_annual_summary",
    category: "ATTENDANCE",
    label: "Annual Attendance Summary",
    sf2Value: hasPopulatedSf2
      ? `Aggregated (${attendanceMonthGroups.length} unique months; conflicts excluded): Pres: ${totalSf2Pres}, Abs: ${totalSf2Abs}${totalSf2Days > 0 ? `, Tot: ${totalSf2Days}` : ""}`
      : undefined,
    sf9Value: (sf9PrintedTotPres !== undefined || sf9PrintedTotAbs !== undefined)
      ? `Report Card Totals: Pres: ${sf9PrintedTotPres ?? "-"}, Abs: ${sf9PrintedTotAbs ?? "-"}${sf9PrintedTotDays !== undefined ? `, Tot: ${sf9PrintedTotDays}` : ""}`
      : undefined,
    status: annualStatus,
    isMatch: isAnnualMatch,
    sourcesPresent: annualSources,
    sourceDocumentIds: Array.from(new Set(attendanceMonthGroups.flatMap((group) => group.sourceDocumentIds))),
    notes: annualNotes,
  };

  // High absenteeism screening (>20% of school days without dropping)
  const evaluatedDays = hasAttendanceConflict ? 0 : sf9PrintedTotDays || totalSf2Days;
  const evaluatedAbsences = hasAttendanceConflict ? 0 : sf9PrintedTotAbs || totalSf2Abs;
  if (evaluatedDays > 0 && evaluatedAbsences > evaluatedDays * 0.2) {
    annualRow.status = "NEEDS_VERIFICATION";
    annualRow.isMatch = false;
    annualRow.notes = `Learner has excessive absences (${evaluatedAbsences} out of ${evaluatedDays} days, >20%) requiring school intervention.`;
    discrepancies.push({
      field: "excessive_absences",
      sourceValue: evaluatedAbsences,
      targetValue: evaluatedDays * 0.2,
      severity: "WARNING",
      category: "NEEDS_VERIFICATION",
      description: `Excessive absenteeism alert: Learner has recorded ${evaluatedAbsences} absences exceeding DepEd 20% attendance threshold (${(evaluatedDays * 0.2).toFixed(1)} days max). Review required.`,
    });
  }
  fieldsMatrix.push(annualRow);

  // ---------------------------------------------------------------------------
  // D. ACADEMIC RECORDS MATRIX (SF9 vs SF10 Semestral Grades & General Average)
  // ---------------------------------------------------------------------------
  const sf9Grades: AcademicGradeItem[] = Array.isArray(sf9Raw.grades) ? sf9Raw.grades : [];
  const sf10Grades: AcademicGradeItem[] = Array.isArray(sf10Raw.grades) ? sf10Raw.grades : [];

  // General Average Comparison
  const sf9GenAvg = parseNumericVal(sf9Raw.general_average);
  const sf10GenAvg = parseNumericVal(sf10Raw.general_average);
  const sf5aGenAvg = parseNumericVal(sf5aRaw.general_average);
  const sf5bGenAvg = parseNumericVal(sf5bRaw.general_average);

  const genAvgSources: Array<{
    doc: string;
    type: string;
    schoolYear?: string;
    gradeLevel?: string;
    section?: string;
    semester?: string;
    val?: number;
    sourceDocumentId?: string;
    pageNumber?: number;
    rowIndex?: number;
  }> = [
    ...sf5aRecords.map((record, index) => ({
      doc: `SF5A-SHS${index > 0 ? ` (${record.documentId || index + 1})` : ""}`,
      type: "SF5A",
      schoolYear: record.raw?.school_year,
      gradeLevel: record.raw?.grade_level,
      section: record.raw?.section,
      semester: record.raw?.semester,
      val: parseNumericVal(record.raw?.general_average),
      sourceDocumentId: record.documentId,
      pageNumber: record.raw?.page_number,
      rowIndex: record.raw?.row_index,
    })),
    ...sf5bRecords.map((record, index) => ({
      doc: `SF5B-SHS${index > 0 ? ` (${record.documentId || index + 1})` : ""}`,
      type: "SF5B",
      schoolYear: record.raw?.school_year,
      gradeLevel: record.raw?.grade_level,
      section: record.raw?.section,
      semester: record.raw?.semester,
      val: parseNumericVal(record.raw?.general_average),
      sourceDocumentId: record.documentId,
      pageNumber: record.raw?.page_number,
      rowIndex: record.raw?.row_index,
    })),
    ...sf9Records.map((record, index) => ({
      doc: `SF9-SHS${index > 0 ? ` (${record.documentId || index + 1})` : ""}`,
      type: "SF9",
      schoolYear: record.raw?.school_year,
      gradeLevel: record.raw?.grade_level,
      section: record.raw?.section,
      semester: record.raw?.semester,
      val: parseNumericVal(record.raw?.general_average),
      sourceDocumentId: record.documentId,
      pageNumber: record.raw?.page_number,
      rowIndex: record.raw?.row_index,
    })),
    ...sf10Records.map((record, index) => ({
      doc: `SF10-SHS${index > 0 ? ` (${record.documentId || index + 1})` : ""}`,
      type: "SF10",
      schoolYear: record.raw?.school_year,
      gradeLevel: record.raw?.grade_level,
      section: record.raw?.section,
      semester: record.raw?.semester,
      val: parseNumericVal(record.raw?.general_average),
      sourceDocumentId: record.documentId,
      pageNumber: record.raw?.page_number,
      rowIndex: record.raw?.row_index,
    })),
  ].filter((source) => source.val !== undefined);

  const displayGeneralAverage = (type: "SF9" | "SF10", fallbackValue?: number) => {
    const sources = genAvgSources.filter((source) => source.type === type);
    if (sources.length === 0) return undefined;
    if (sources.length === 1) return sources[0].val;

    const contexts = new Map<string, {
      label: string;
      values: Map<number, string[]>;
    }>();
    for (const source of sources) {
      const contextKey = [
        normalizeAcademicSchoolYear(source.schoolYear),
        normalizeAcademicGradeLevel(source.gradeLevel),
        String(source.section || "").trim().replace(/\s+/g, " ").toLowerCase(),
        normalizeGradingPeriod(source.semester),
      ].join("|");
      const label = [
        source.schoolYear || "School year unspecified",
        source.gradeLevel || "Grade unspecified",
        source.semester || "Period unspecified",
      ].join(" / ");
      const context = contexts.get(contextKey) || { label, values: new Map<number, string[]>() };
      const documentIds = context.values.get(source.val!) || [];
      if (source.sourceDocumentId && !documentIds.includes(source.sourceDocumentId)) {
        documentIds.push(source.sourceDocumentId);
      }
      context.values.set(source.val!, documentIds);
      contexts.set(contextKey, context);
    }

    if (contexts.size === 1 && Array.from(contexts.values())[0].values.size === 1) {
      return fallbackValue ?? sources[0].val;
    }
    return Array.from(contexts.values())
      .map((context) => {
        const values = Array.from(context.values.entries())
          .map(([value, documentIds]) => `${value}${documentIds.length ? ` [${documentIds.join(", ")}]` : ""}`)
          .join(" vs ");
        return `${context.label}: ${values}`;
      })
      .join("; ");
  };

  const genAvgRow: UnifiedFieldComparisonRow = {
    field: "general_average",
    category: "ACADEMIC",
    label: "Semestral / Annual General Average",
    sf5aValue: sf5aGenAvg,
    sf5bValue: sf5bGenAvg,
    sf9Value: displayGeneralAverage("SF9", sf9GenAvg),
    sf10Value: displayGeneralAverage("SF10", sf10GenAvg),
    status: "MATCH",
    isMatch: true,
    sourcesPresent: genAvgSources.map((s) => s.doc),
    sourceDocumentIds: Array.from(new Set([
      ...sf5aRecords,
      ...sf5bRecords,
      ...sf9Records,
      ...sf10Records,
    ].filter((record) => parseNumericVal(record.raw?.general_average) !== undefined)
      .map((record) => record.documentId)
      .filter(Boolean) as string[])),
    sourceTraces: genAvgSources.flatMap((source) => source.sourceDocumentId
    ? [{
        documentId: source.sourceDocumentId,
        documentType: `${source.type}-SHS`,
        fieldName: "general_average",
        pageNumber: source.pageNumber,
        rowIndex: source.rowIndex,
        academicContext: {
          schoolYear: source.schoolYear,
          gradeLevel: source.gradeLevel,
          section: source.section,
          semester: source.semester,
        },
      }]
    : []),
    notes: "General average reconciled across academic records.",
  };

  for (let i = 0; i < genAvgSources.length; i++) {
    for (let j = i + 1; j < genAvgSources.length; j++) {
      const source = genAvgSources[i];
      const target = genAvgSources[j];
      if (source.type === target.type) continue;
      if (
        normalizeAcademicSchoolYear(source.schoolYear) === "" ||
        normalizeAcademicSchoolYear(source.schoolYear) !== normalizeAcademicSchoolYear(target.schoolYear) ||
        normalizeAcademicGradeLevel(source.gradeLevel) === "" ||
        normalizeAcademicGradeLevel(source.gradeLevel) !== normalizeAcademicGradeLevel(target.gradeLevel) ||
        normalizeGradingPeriod(source.semester) === "" ||
        normalizeGradingPeriod(source.semester) !== normalizeGradingPeriod(target.semester)
      ) continue;
      if (Math.abs(source.val! - target.val!) > 0.05) {
        genAvgRow.status = "MISMATCH";
        genAvgRow.isMatch = false;
        genAvgRow.notes = `General Average conflict: ${source.doc} (${source.val}) vs ${target.doc} (${target.val}).`;
        discrepancies.push({
          field: "general_average",
          sourceValue: source.val,
          targetValue: target.val,
          severity: "CRITICAL",
          description: `General average discrepancy: ${source.doc} reports "${source.val}", while ${target.doc} reports "${target.val}".`,
        });
      }
    }
  }
  fieldsMatrix.push(genAvgRow);

  // Subject grades compare only within a complete academic context.
  const sf9GradeGroups = new Map<string, AcademicGradeItem[]>();
  for (const grade of sf9Grades) {
    const key = academicGradeScopeKey(grade);
    sf9GradeGroups.set(key, [...(sf9GradeGroups.get(key) || []), grade]);
  }
  const sf10Contexts: AcademicGradeItem[] = [
    ...sf10Grades,
    ...sf10Records.flatMap((record) =>
      (Array.isArray(record.raw?.completed_semesters) ? record.raw.completed_semesters : []).map((semester: any) => ({
        subject: "",
        schoolYear: semester.school_year || semester.schoolYear,
        gradeLevel: semester.grade_level || semester.gradeLevel,
        semester: semester.semester,
        gradingPeriod: semester.grading_period || semester.gradingPeriod,
      }))
    ),
  ].filter(hasAcademicGradeContext);
  for (const [scopeKey, sf9Candidates] of sf9GradeGroups) {
    const g9 = sf9Candidates[0];
    const rawSubject = g9.subject || "Subject";
    const sf9Conflicting = new Set(sf9Candidates.map(academicGradeValueSignature)).size > 1;
    const matchingSf10 = sf10Grades.filter(
      (grade) =>
        normalizeSubjectName(grade.subject) === normalizeSubjectName(g9.subject) &&
        sameAcademicGradeContext(g9, grade)
    );
    const sameSubjectDifferentPeriod = sf10Grades.some(
      (grade) =>
        normalizeSubjectName(grade.subject) === normalizeSubjectName(g9.subject) &&
        sameAcademicContextIgnoringPeriod(g9, grade) &&
        !sameAcademicGradeContext(g9, grade)
    );
    const sf10Conflicting = new Set(matchingSf10.map(academicGradeValueSignature)).size > 1;
    const sf9Final = parseNumericVal(g9.finalGrade);
    const sf10Final = matchingSf10[0] ? parseNumericVal(matchingSf10[0].finalGrade) : undefined;
    const field = `grade_${scopeKey.replace(/\|/g, "_")}`;
    const sourceDocumentIds = Array.from(new Set([
      ...sf9Candidates.flatMap((grade) => grade.sourceDocumentIds || []),
      ...matchingSf10.flatMap((grade) => grade.sourceDocumentIds || []),
    ]));
    let status: UnifiedFieldComparisonRow["status"] = "MATCH";
    let notes = `Final grade verified in ${g9.gradeLevel}, ${g9.schoolYear}, ${g9.semester}.`;
    let sf10Value = sf10Final !== undefined ? `Final: ${sf10Final}` : undefined;

    if (sf9Conflicting || sf10Conflicting) {
      status = "NEEDS_VERIFICATION";
      notes = `Conflicting ${sf9Conflicting ? "SF9" : "SF10"} grade records exist for this subject and academic context.`;
      sf10Value = sf10Conflicting
        ? matchingSf10.map((grade) => `${grade.finalGrade ?? "-"} [${(grade.sourceDocumentIds || []).join(", ")}]`).join("; ")
        : sf10Value;
      discrepancies.push({
        field,
        sourceValue: sf9Candidates.map((grade) => ({
          finalGrade: grade.finalGrade,
          sourceDocumentIds: grade.sourceDocumentIds,
        })),
        targetValue: matchingSf10.map((grade) => ({
          finalGrade: grade.finalGrade,
          sourceDocumentIds: grade.sourceDocumentIds,
        })),
        severity: "WARNING",
        category: "NEEDS_VERIFICATION",
        description: `Conflicting SF9/SF10 grades for "${rawSubject}" in ${g9.gradeLevel}, ${g9.schoolYear}, ${g9.semester} require review.`,
      });
    } else if (matchingSf10.length > 0) {
      const e9 = evaluateDynamicGradeStatus({ grade: g9.finalGrade, confidencePercent: (g9 as any).confidence });
      const e10 = evaluateDynamicGradeStatus({ grade: matchingSf10[0].finalGrade, confidencePercent: (matchingSf10[0] as any).confidence });

      if (e9.isLowConfidence || e10.isLowConfidence || e9.status === "not_recognized" || e10.status === "not_recognized") {
        status = "NEEDS_VERIFICATION";
        notes = `OCR grade reading has low confidence (< 65%) or is not recognized (${e9.remarkDisplay} vs ${e10.remarkDisplay}); verification required.`;
      } else if (e9.status === "blank" && e10.status === "blank") {
        status = "INCOMPLETE";
        notes = "Final grade cell is blank/incomplete on both SF9 and SF10.";
      } else if (e9.status === "blank" || e10.status === "blank") {
        status = "NEEDS_VERIFICATION";
        notes = e9.status === "blank"
          ? "SF9 grade cell is blank/incomplete, while SF10 has a recorded final grade."
          : "SF9 has a final grade, but the applicable SF10 transcript cell is blank.";
      } else if (sf9Final !== undefined && sf10Final !== undefined && sf9Final !== sf10Final) {
        status = "MISMATCH";
        notes = `Final grade mismatch in the same academic context: SF9 (${sf9Final}) vs SF10 (${sf10Final}).`;
        discrepancies.push({
          field,
          sourceValue: sf9Final,
          targetValue: sf10Final,
          severity: "CRITICAL",
          description: `Final grade discrepancy in "${rawSubject}" for ${g9.gradeLevel}, ${g9.schoolYear}, ${g9.semester}: SF9 has ${sf9Final}, while SF10 has ${sf10Final}.`,
        });
      }
    } else if (sameSubjectDifferentPeriod) {
      status = "NEEDS_VERIFICATION";
      notes = "The SF10 subject exists in this semester but has a different grading-period context.";
      sf10Value = sf10Grades
        .filter((grade) =>
          normalizeSubjectName(grade.subject) === normalizeSubjectName(g9.subject) &&
          sameAcademicContextIgnoringPeriod(g9, grade)
        )
        .map((grade) => `${grade.gradingPeriod || "period unspecified"}: ${grade.finalGrade ?? "-"}`)
        .join("; ");
    } else if (hasSf10 && sf10Contexts.some((grade) => sameAcademicContextIgnoringPeriod(g9, grade))) {
      status = "MISSING_SOURCE";
      notes = "Subject is absent from the applicable SF10 academic context.";
      discrepancies.push({
        field,
        sourceValue: { finalGrade: g9.finalGrade, sourceDocumentIds: sf9Candidates.flatMap((grade) => grade.sourceDocumentIds || []) },
        targetValue: null,
        severity: "CRITICAL",
        description: `Subject "${rawSubject}" is missing from SF10 for ${g9.gradeLevel}, ${g9.schoolYear}, ${g9.semester}.`,
      });
    } else if (hasSf10) {
      status = "NOT_APPLICABLE";
      notes = "No SF10 grades were available for this academic context; no cross-context mismatch was reported.";
      sf10Value = undefined;
    } else {
      status = "NOT_APPLICABLE";
      notes = "No SF10 source record was available; the comparison remains incomplete.";
      sf10Value = undefined;
    }

    fieldsMatrix.push({
      field,
      category: "ACADEMIC",
      label: `Subject: ${rawSubject}`,
      sf9Value: sf9Conflicting
        ? sf9Candidates.map((grade) => `${grade.finalGrade ?? "-"} [${(grade.sourceDocumentIds || []).join(", ")}]`).join("; ")
        : sf9Final !== undefined ? `Final: ${sf9Final}` : undefined,
      sf10Value,
      status,
      isMatch: status === "MATCH",
      notes,
      sourceDocumentIds,
      sourceTraces: [
        ...sf9Candidates.flatMap((grade) => grade.sourceTraces || []),
        ...matchingSf10.flatMap((grade) => grade.sourceTraces || []),
      ].map((trace) => ({ ...trace, fieldName: field })),
      sourcesPresent: ["SF9-SHS", ...(matchingSf10.length ? ["SF10-SHS"] : [])],
    });
  }

  // ---------------------------------------------------------------------------
  // E. PROMOTION MATRIX (SF5A End of Semester Promotion vs SF9 Failing Grades)
  // ---------------------------------------------------------------------------
  if (hasSf5a) {
    const groups = new Map<string, UnifiedSourceRecord[]>();
    for (const record of sf5aRecords) {
      const raw = record.raw || {};
      const key = [
        normalizeAcademicSchoolYear(raw.school_year || initialSchoolYear),
        normalizeAcademicGradeLevel(raw.grade_level || initialGradeLevel),
        normalizeGradingPeriod(raw.semester),
      ].join("|");
      groups.set(key, [...(groups.get(key) || []), record]);
    }

    for (const [contextKey, records] of groups) {
      const representative = records[0].raw || {};
      const actions = Array.from(new Set(records.map((record) =>
        String(record.raw?.action_taken || "COMPLETE").toUpperCase()
      )));
      const actionTaken = actions.length === 1 ? actions[0] : undefined;
      const sf5aContext: AcademicGradeItem = {
        subject: "",
        schoolYear: String(representative.school_year || initialSchoolYear),
        gradeLevel: String(representative.grade_level || initialGradeLevel),
        semester: typeof representative.semester === "string" ? representative.semester : undefined,
      };
      const sf9GradesForSf5a = sf9Grades.filter((grade) => sameAcademicGradeContext(sf5aContext, grade));
      const failingSf9 = sf9GradesForSf5a.filter((grade) => {
        const finalGrade = parseNumericVal(grade.finalGrade);
        return finalGrade !== undefined && finalGrade < 75;
      });
      const hasApplicableSf9Grades = sf9GradesForSf5a.length > 0;
      const incompleteSubjects = records.flatMap((record) =>
        Array.isArray(record.raw?.incomplete_subjects) ? record.raw.incomplete_subjects : []
      );
      const hasConflictingActions = actions.length > 1;
      const field = groups.size === 1
        ? "promotion_status_sf5a"
        : `promotion_status_sf5a_${contextKey.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
      const promRow: UnifiedFieldComparisonRow = {
        field,
        category: "PROMOTION",
        label: `SF5A End-of-Semester Status${groups.size > 1 ? ` — ${representative.semester || representative.school_year || "Academic context"}` : ""}`,
        sf5aValue: hasConflictingActions
          ? records.map((record) => `${record.raw?.action_taken || "COMPLETE"} [${record.documentId || "unknown source"}]`).join("; ")
          : actionTaken,
        sf9Value: failingSf9.length === 0 ? "0 failing subjects" : `${failingSf9.length} failing subject(s)`,
        status: hasApplicableSf9Grades ? "MATCH" : "NEEDS_VERIFICATION",
        isMatch: hasApplicableSf9Grades,
        sourcesPresent: ["SF5A-SHS", ...(hasApplicableSf9Grades ? ["SF9-SHS"] : [])],
        sourceDocumentIds: Array.from(new Set([
          ...records.map((record) => record.documentId).filter(Boolean),
          ...failingSf9.flatMap((grade) => grade.sourceDocumentIds || []),
        ] as string[])),
        notes: hasApplicableSf9Grades
          ? "Promotion status verified against SF9 grades in the same academic context."
          : "No SF9 grades were available for the SF5A school year, grade level, and semester.",
      };

      if (hasConflictingActions) {
        promRow.status = "NEEDS_VERIFICATION";
        promRow.isMatch = false;
        promRow.notes = "Conflicting SF5A action values exist in the same school year, grade, and semester.";
        discrepancies.push({
          field: `duplicate_sf5a_action_${contextKey.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
          sourceValue: records.map((record) => ({
            actionTaken: record.raw?.action_taken,
            sourceDocumentId: record.documentId,
          })),
          targetValue: "One consistent SF5A action for this academic context",
          severity: "WARNING",
          category: "NEEDS_VERIFICATION",
          description: "Conflicting SF5A promotion records require review.",
        });
      } else if (actionTaken === "COMPLETE" && failingSf9.length > 0) {
        promRow.status = "MISMATCH";
        promRow.isMatch = false;
        promRow.notes = `Contradiction: SF5A marked COMPLETE but SF9 has ${failingSf9.length} failing subject(s).`;
        for (const failedSubject of failingSf9) {
          discrepancies.push({
            field: "sf5a_completion_conflict",
            sourceValue: `Failing Grade: ${failedSubject.finalGrade}`,
            targetValue: "COMPLETE",
            severity: "CRITICAL",
            description: `Promotion conflict: SF5A marks learner as "COMPLETE", but SF9 contains failing grade in "${failedSubject.subject}" (${failedSubject.finalGrade}). Remedial class required.`,
          });
        }
      } else if (actionTaken === "INCOMPLETE") {
        const recordedDeficiencies = incompleteSubjects.map((subject) => {
          const name = typeof subject === "string" ? subject : subject.subject || "";
          return normalizeSubjectName(name);
        });

        for (const failedSubject of failingSf9) {
          const normalizedSubject = normalizeSubjectName(failedSubject.subject || "");
          const isRecorded = recordedDeficiencies.some((deficiency) =>
            deficiency.includes(normalizedSubject) || normalizedSubject.includes(deficiency)
          );
          if (!isRecorded) {
            promRow.status = "MISMATCH";
            promRow.isMatch = false;
            promRow.notes = `Unrecorded deficiency: Failing subject "${failedSubject.subject}" (${failedSubject.finalGrade}) missing from SF5A incomplete list.`;
            discrepancies.push({
              field: `unrecorded_deficiency_${normalizedSubject}`,
              sourceValue: `SF9 Grade: ${failedSubject.finalGrade}`,
              targetValue: "Missing in SF5A",
              severity: "CRITICAL",
              description: `SF5A incomplete list omission: Failing subject "${failedSubject.subject}" (${failedSubject.finalGrade}) on report card is missing from official SF5A back-subjects declaration.`,
            });
          }
        }
      }
      fieldsMatrix.push(promRow);
    }
  }

  // ---------------------------------------------------------------------------
  // F. GRADUATION MATRIX (SF5B Candidates for Graduation vs SF10 Transcript)
  // ---------------------------------------------------------------------------
  if (hasSf5b) {
    const groups = new Map<string, UnifiedSourceRecord[]>();
    for (const record of sf5bRecords) {
      const raw = record.raw || {};
      const key = [
        normalizeAcademicSchoolYear(raw.school_year || initialSchoolYear),
        normalizeAcademicGradeLevel(raw.grade_level || initialGradeLevel),
        String(raw.section || "").trim().replace(/\s+/g, " ").toLowerCase(),
      ].join("|");
      groups.set(key, [...(groups.get(key) || []), record]);
    }
    const completedSemesterKeys = new Set(
      (Array.isArray(sf10Raw.completed_semesters) ? sf10Raw.completed_semesters : []).map((semester: any) =>
        [
          normalizeAcademicSchoolYear(semester.school_year || semester.schoolYear || sf10Raw.school_year),
          normalizeAcademicGradeLevel(semester.grade_level || semester.gradeLevel),
          normalizeGradingPeriod(semester.semester),
        ].join("|")
      )
    );
    const hasUnresolvedBackSubjects = sf10Raw.has_unresolved_back_subjects === true;

    for (const [contextKey, records] of groups) {
      const actions = Array.from(new Set(records.map((record) =>
        String(record.raw?.action_taken || "GRADUATING").toUpperCase()
      )));
      const conflictingActions = actions.length > 1;
      const gradAction = actions.length === 1 ? actions[0] : undefined;
      const field = groups.size === 1
        ? "graduation_clearance_sf5b"
        : `graduation_clearance_sf5b_${contextKey.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
      const gradRow: UnifiedFieldComparisonRow = {
        field,
        category: "GRADUATION",
        label: `SF5B Senior High School Graduation Clearance${groups.size > 1 ? ` — ${records[0].raw?.school_year || "Academic context"}` : ""}`,
        sf5bValue: conflictingActions
          ? records.map((record) => `${record.raw?.action_taken || "GRADUATING"} [${record.documentId || "unknown source"}]`).join("; ")
          : gradAction,
        sf10Value: hasSf10
          ? (hasUnresolvedBackSubjects
            ? "Unresolved Deficiencies Pending"
            : `Completed ${completedSemesterKeys.size} Semesters`)
          : "SF10 Transcript Required",
        status: conflictingActions ? "NEEDS_VERIFICATION" : "MATCH",
        isMatch: !conflictingActions,
        sourcesPresent: ["SF5B-SHS", ...(hasSf10 ? ["SF10-SHS"] : [])],
        sourceDocumentIds: Array.from(new Set([
          ...records.map((record) => record.documentId).filter(Boolean),
          ...sf10Records.map((record) => record.documentId).filter(Boolean),
        ] as string[])),
        notes: conflictingActions
          ? "Conflicting SF5B graduation statuses require review."
          : "Graduation candidacy evaluated against cumulative scholastic transcript.",
      };
      if (conflictingActions) {
        discrepancies.push({
          field: `duplicate_sf5b_action_${contextKey.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
          sourceValue: records.map((record) => ({
            actionTaken: record.raw?.action_taken,
            sourceDocumentId: record.documentId,
          })),
          targetValue: "One consistent SF5B graduation status for this academic context",
          severity: "WARNING",
          category: "NEEDS_VERIFICATION",
          description: "Conflicting SF5B graduation records require review.",
        });
      } else if (gradAction === "GRADUATING" && hasSf10 && hasUnresolvedBackSubjects) {
        gradRow.status = "MISMATCH";
        gradRow.isMatch = false;
        gradRow.notes = "Graduation clearance blocked: SF10 indicates unresolved back-subjects.";
        discrepancies.push({
          field: "graduation_deficiency_conflict",
          sourceValue: "GRADUATING",
          targetValue: "Unresolved Back-Subjects on SF10",
          severity: "CRITICAL",
          description: "Graduation clearance conflict: Learner listed as \"GRADUATING\" on SF5B-SHS, but SF10 permanent record documents unresolved back-subjects.",
        });
      }
      fieldsMatrix.push(gradRow);
    }
  }

  const sourceTypeLabels: Record<UnifiedSourceType, string> = {
    psa: "PSA",
    sf1: "SF1-SHS",
    sf5a: "SF5A-SHS",
    sf5b: "SF5B-SHS",
    sf9: "SF9-SHS",
    sf10: "SF10-SHS",
  };
  const matrixFieldForConflict = (conflict: UnifiedSourceConflict) => {
    if (conflict.documentType === "sf5a") {
      if (["action_taken", "incomplete_subjects"].includes(conflict.field)) return "promotion_status_sf5a";
      if (conflict.field === "general_average") return "general_average";
    }
    if (conflict.documentType === "sf5b") {
      if (conflict.field === "action_taken") return "graduation_clearance_sf5b";
      if (conflict.field === "general_average") return "general_average";
    }
    if (conflict.documentType === "sf9" || conflict.documentType === "sf10") {
      if (conflict.field === "has_unresolved_back_subjects") return "graduation_clearance_sf5b";
    }
    const aliases: Record<string, string> = {
      track: "track_strand",
      track_strand: "track_strand",
      strand: "track_strand",
    };
    return aliases[conflict.field] || conflict.field;
  };

  for (const conflict of sourceConflicts) {
    if (conflict.field === "mother_name" || conflict.field === "mother_maiden_name") continue;
    const sourceValues = conflict.values.map((entry) => ({
      value: entry.value,
      sourceDocumentIds: entry.sourceDocumentIds,
    }));
    const sourceIds = Array.from(new Set(sourceValues.flatMap((entry) => entry.sourceDocumentIds)));
    const matchingRows = fieldsMatrix.filter((row) =>
      row.field === matrixFieldForConflict(conflict) ||
      (conflict.documentType === "sf5a" && row.field.startsWith("promotion_status_sf5a_")) ||
      (conflict.documentType === "sf5b" && row.field.startsWith("graduation_clearance_sf5b_"))
    );
    for (const row of matchingRows) {
      if (row.status === "MATCH" || row.status === "NOT_APPLICABLE") {
        row.status = "NEEDS_VERIFICATION";
        row.isMatch = false;
      }
      const displayedValues = sourceValues
        .map((entry) => `${String(entry.value)} [${entry.sourceDocumentIds.join(", ") || "unknown source"}]`)
        .join("; ");
      if (conflict.documentType === "psa") row.psaValue = displayedValues;
      if (conflict.documentType === "sf1") row.sf1Value = displayedValues;
      if (conflict.documentType === "sf5a") row.sf5aValue = displayedValues;
      if (conflict.documentType === "sf5b") row.sf5bValue = displayedValues;
      if (conflict.documentType === "sf9" && conflict.field !== "general_average") row.sf9Value = displayedValues;
      if (conflict.documentType === "sf10" && conflict.field !== "general_average") row.sf10Value = displayedValues;
      row.sourceDocumentIds = Array.from(new Set([...(row.sourceDocumentIds || []), ...sourceIds]));
      row.sourcesPresent = Array.from(new Set([...row.sourcesPresent, sourceTypeLabels[conflict.documentType]]));
      row.notes = [row.notes, `Conflicting ${sourceTypeLabels[conflict.documentType]} ${conflict.field} values require review.`]
        .filter(Boolean)
        .join(" ");
    }
    discrepancies.push({
      field: `conflicting_${conflict.documentType}_${conflict.field}`,
      sourceValue: sourceValues,
      targetValue: `One consistent ${conflict.field} value per academic context`,
      severity: "WARNING",
      category: "NEEDS_VERIFICATION",
      description: `Conflicting ${sourceTypeLabels[conflict.documentType]} records contain different "${conflict.field}" values.`,
    });
  }

  // ---------------------------------------------------------------------------
  // INCORPORATE DUPLICATE SCAN ALERTS INTO DISCREPANCIES
  // ---------------------------------------------------------------------------
  for (const dup of duplicateWarnings) {
    discrepancies.push({
      field: `duplicate_${dup.documentType.toLowerCase()}`,
      sourceValue: dup.existingSource,
      targetValue: dup.newSource,
      severity: dup.severity === "CRITICAL" ? "CRITICAL" : "WARNING",
      category: "NEEDS_VERIFICATION",
      description: `Duplicate scan notice (${dup.documentType}): ${dup.details}`,
    });
  }

  // ---------------------------------------------------------------------------
  // RESOLVE OVERALL STUDENT VALIDATION OUTCOME
  // ---------------------------------------------------------------------------
  let overallStatus: CrossDocumentValidationStatus = "MATCH";
  let needsHumanReview = false;

  const hasCritical = discrepancies.some((d) => d.severity === "CRITICAL");
  const hasWarning = discrepancies.some((d) => d.severity === "WARNING" || d.severity === "ERROR");

  if (hasCritical) {
    overallStatus = "MISMATCH";
    needsHumanReview = true;
  } else if (hasWarning || fieldsMatrix.some((r) => r.status === "NEEDS_VERIFICATION")) {
    overallStatus = "NEEDS_VERIFICATION";
    needsHumanReview = true;
  } else if (!hasRequiredCoverage) {
    overallStatus = "NOT_APPLICABLE";
  }

  const incompleteCoverageMessage = hasRequiredCoverage
    ? ""
    : ` Required document coverage is incomplete (${requiredAvailable}/${totalRequired} categories available).`;
  const summaryMessage =
    overallStatus === "MATCH"
      ? `Unified validation certified across ${totalAvailable} available school forms with 100% field consistency.`
      : overallStatus === "MISMATCH"
      ? `Unified validation identified ${discrepancies.filter((d) => d.severity === "CRITICAL").length} critical mismatch(es) across submitted forms. Teacher verification required.${incompleteCoverageMessage}`
      : overallStatus === "NEEDS_VERIFICATION"
      ? `Unified validation requires teacher verification due to ${discrepancies.length} item(s) (attendance variance, unreadable marks, or warnings).${incompleteCoverageMessage}`
      : `Incomplete required document coverage (${requiredAvailable}/${totalRequired} categories available). Available comparisons remain visible; missing documents are not treated as mismatches.`;

  // Enforce strict 4-state row evaluation across all matrix rows
  for (const row of fieldsMatrix) {
    row.status = evaluate4StateRowStatus(row);
    row.isMatch = row.status === "MATCH";
  }

  return {
    lrn,
    fullName,
    studentId,
    schoolId,
    schoolYear,
    gradeLevel,
    overallStatus,
    needsHumanReview,
    fieldsMatrix,
    discrepancies,
    duplicateWarnings,
    summaryMessage,
    documentCompleteness: {
      sf1: hasSf1,
      sf2: hasSf2,
      sf5a: hasSf5a,
      sf5b: hasSf5b,
      sf9: hasSf9,
      sf10: hasSf10,
      psa: hasPsa,
      totalAvailable,
      totalRequired,
      requiredAvailable,
      hasRequiredCoverage,
    },
  };
}


// =============================================================================
// SF10-SHS CROSS-DOCUMENT COMPARATORS
//   - compareSf10AndSf1 : LRN, Full Name, Sex, normalized Birth Date
//   - compareSf10AndSf9 : LRN, Full Name, Sex, Grade Level, Section, School Year,
//                         Track/Strand + per-semester Subject Grades & General Averages
//   - compareSf10AndPsa : civil identity ONLY (Full Name, Sex, Birth Date). PSA has NO LRN.
// Birth dates are month-normalized: "06/23/2004" (SF10) == "6/23/04" (SF1) == "June 23, 2004" (PSA).
// =============================================================================

export interface Sf10IdentityDocLike {
  document_id?: string;
  lrn?: string | null;
  name?: string | null;
  full_name?: string | null;
  complete_name?: string | null;
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  suffix?: string | null;
  sex?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  date_of_birth?: string | null;
  birthdate?: string | null;
  birth_month?: string | number | null;
  birth_day?: string | number | null;
  birth_year?: string | number | null;
  grade_level?: string | null;
  school_year?: string | null;
  section?: string | null;
  track_strand?: string | null;
  strand?: string | null;
  [key: string]: any;
}

type ComparisonRow = PairwiseValidationResult["comparisonResults"][number];

interface IdentityAccumulator {
  rows: ComparisonRow[];
  discrepancies: DiscrepancyItem[];
}

function sf10ResolveNameParts(doc: Sf10IdentityDocLike): { last: string; first: string; middle: string; display: string } {
  let last = (doc.last_name || "").trim();
  let first = (doc.first_name || "").trim();
  let middle = (doc.middle_name || "").trim();
  const full = (doc.full_name || doc.name || doc.complete_name || "").trim();
  if ((!last || !first) && full) {
    if (full.includes(",")) {
      const [l, ...rest] = full.split(",").map((s) => s.trim());
      const tokens = rest.join(" ").split(/\s+/).filter(Boolean);
      last = last || l;
      first = first || (tokens.length > 1 ? tokens.slice(0, -1).join(" ") : tokens[0] || "");
      middle = middle || (tokens.length > 1 ? tokens[tokens.length - 1] : "");
    } else {
      const tokens = full.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        // Civil-registry order (PSA): FIRST [MIDDLE] LAST
        last = last || tokens[tokens.length - 1];
        first = first || (tokens.length > 2 ? tokens.slice(0, -2).join(" ") : tokens[0]);
        middle = middle || (tokens.length > 2 ? tokens[tokens.length - 2] : "");
      }
    }
  }
  const display = last || first ? `${last}, ${first}${middle ? " " + middle : ""}`.trim() : full;
  return { last, first, middle, display };
}

function sf10ResolveBirthDate(doc: Sf10IdentityDocLike): string | SplitBirthDateFields | null {
  const direct = doc.birth_date || doc.date_of_birth || doc.birthdate;
  if (direct) return direct;
  if (doc.birth_month || doc.birth_day || doc.birth_year) {
    return { month: doc.birth_month ?? null, day: doc.birth_day ?? null, year: doc.birth_year ?? null };
  }
  return null;
}

function sf10CompareLrn(acc: IdentityAccumulator, a: Sf10IdentityDocLike, b: Sf10IdentityDocLike, la: string, lb: string) {
  const va = normalizeLrn(a.lrn || "");
  const vb = normalizeLrn(b.lrn || "");
  if (!va || !vb) {
    acc.rows.push({ field: "lrn", doc1Value: a.lrn || null, doc2Value: b.lrn || null, isMatch: false, notes: "LRN missing on one document" });
    acc.discrepancies.push({ field: "lrn", sourceValue: a.lrn || null, targetValue: b.lrn || null, severity: "INFO", category: "NEEDS_VERIFICATION", description: `LRN not available on ${!va ? la : lb}; LRN comparison skipped.` });
    return;
  }
  const isMatch = va === vb;
  acc.rows.push({ field: "lrn", doc1Value: va, doc2Value: vb, isMatch, notes: isMatch ? "LRN verified" : "LRN conflict" });
  if (!isMatch) {
    acc.discrepancies.push({ field: "lrn", sourceValue: va, targetValue: vb, severity: "CRITICAL", category: "MISMATCH", description: `LRN conflict: ${la} "${va}" vs ${lb} "${vb}".` });
  }
}

function sf10CompareFullName(acc: IdentityAccumulator, a: Sf10IdentityDocLike, b: Sf10IdentityDocLike, la: string, lb: string) {
  const na = sf10ResolveNameParts(a);
  const nb = sf10ResolveNameParts(b);
  if (!na.last || !na.first || !nb.last || !nb.first) {
    acc.rows.push({ field: "full_name", doc1Value: na.display || null, doc2Value: nb.display || null, isMatch: false, notes: "Full name incomplete on one document" });
    acc.discrepancies.push({ field: "full_name", sourceValue: na.display || null, targetValue: nb.display || null, severity: "WARNING", category: "NEEDS_VERIFICATION", description: `Full name could not be fully extracted from ${!na.last || !na.first ? la : lb}; manual verification required.` });
    return;
  }
  const lastOk = normalizeNamePart(na.last) === normalizeNamePart(nb.last);
  const firstOk = normalizeNamePart(na.first) === normalizeNamePart(nb.first);
  const ma = normalizeNamePart(na.middle);
  const mb = normalizeNamePart(nb.middle);
  const midOk = !ma || !mb || ma === mb || ma.startsWith(mb) || mb.startsWith(ma);
  const isMatch = lastOk && firstOk && midOk;
  acc.rows.push({
    field: "full_name",
    doc1Value: na.display,
    doc2Value: nb.display,
    isMatch,
    notes: isMatch ? "Full name verified" : !lastOk || !firstOk ? "Surname/given name difference" : "Middle name difference",
  });
  if (!lastOk || !firstOk) {
    acc.discrepancies.push({ field: "full_name", sourceValue: na.display, targetValue: nb.display, severity: "CRITICAL", category: "MISMATCH", description: `Full name mismatch: ${la} "${na.display}" vs ${lb} "${nb.display}".` });
  } else if (!midOk) {
    acc.discrepancies.push({ field: "middle_name", sourceValue: na.middle, targetValue: nb.middle, severity: "WARNING", category: "NEEDS_VERIFICATION", description: `Middle name difference: ${la} "${na.middle}" vs ${lb} "${nb.middle}".` });
  }
}

function sf10CompareSex(acc: IdentityAccumulator, a: Sf10IdentityDocLike, b: Sf10IdentityDocLike, la: string, lb: string) {
  const ra = a.sex || a.gender || "";
  const rb = b.sex || b.gender || "";
  const va = normalizeStrictSex(ra);
  const vb = normalizeStrictSex(rb);
  if (!va || !vb) {
    acc.rows.push({ field: "sex", doc1Value: ra || null, doc2Value: rb || null, isMatch: false, notes: "Sex missing on one document" });
    acc.discrepancies.push({ field: "sex", sourceValue: ra || null, targetValue: rb || null, severity: "INFO", category: "NEEDS_VERIFICATION", description: `Sex not available on ${!va ? la : lb}; comparison skipped.` });
    return;
  }
  const isMatch = va === vb;
  acc.rows.push({ field: "sex", doc1Value: va, doc2Value: vb, isMatch, notes: isMatch ? "Sex verified" : "Wrong Sex/Gender mismatch" });
  if (!isMatch) {
    acc.discrepancies.push({ field: "sex", sourceValue: va, targetValue: vb, severity: "CRITICAL", category: "MISMATCH", description: `Wrong Sex/Gender: Sex does not match across documents (${la}: ${va} vs ${lb}: ${vb}).` });
  }
}

function sf10CompareBirthDate(acc: IdentityAccumulator, a: Sf10IdentityDocLike, b: Sf10IdentityDocLike, la: string, lb: string) {
  const cmp = compareBirthDates(sf10ResolveBirthDate(a), sf10ResolveBirthDate(b));
  acc.rows.push({
    field: "birth_date",
    doc1Value: cmp.leftDisplay || null,
    doc2Value: cmp.rightDisplay || null,
    isMatch: cmp.outcome === "MATCH",
    notes: cmp.note,
  });
  if (cmp.outcome === "MISMATCH") {
    acc.discrepancies.push({ field: "birth_date", sourceValue: cmp.leftDisplay, targetValue: cmp.rightDisplay, severity: "CRITICAL", category: "MISMATCH", description: `Birth date mismatch: ${la} ${cmp.leftDisplay} vs ${lb} ${cmp.rightDisplay}.` });
  } else if (cmp.outcome === "UNVERIFIABLE") {
    const bothPresent = !!cmp.leftDisplay && !!cmp.rightDisplay;
    acc.discrepancies.push({ field: "birth_date", sourceValue: cmp.leftDisplay || null, targetValue: cmp.rightDisplay || null, severity: bothPresent ? "WARNING" : "INFO", category: "NEEDS_VERIFICATION", description: `${cmp.note} (${la} vs ${lb})` });
  }
}

function sf10NormGradeLevel(v?: string | null): string {
  const t = String(v || "").toUpperCase();
  if (/\b(?:12|XII)\b/.test(t)) return "12";
  if (/\b(?:11|XI)\b/.test(t)) return "11";
  return "";
}

function sf10NormSchoolYear(v?: string | null): string {
  const m = String(v || "").match(/(20\d{2})\s*[-–/]\s*(20\d{2})/);
  return m ? `${m[1]}-${m[2]}` : "";
}

function sf10NormSemester(v?: string | null): "1st Semester" | "2nd Semester" | "" {
  const t = String(v || "").toLowerCase();
  if (/\b(?:1st|first|sem\s*1|semester\s*1)\b/.test(t)) return "1st Semester";
  if (/\b(?:2nd|second|sem\s*2|semester\s*2)\b/.test(t)) return "2nd Semester";
  return "";
}

function sf10NormText(v?: string | null): string {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sf10CompareContextField(
  acc: IdentityAccumulator,
  field: string,
  label: string,
  va: string | null | undefined,
  vb: string | null | undefined,
  normalize: (v?: string | null) => string,
  la: string,
  lb: string,
  tolerantContains = false
) {
  const na = normalize(va);
  const nb = normalize(vb);
  if (!na || !nb) {
    acc.rows.push({ field, doc1Value: va || null, doc2Value: vb || null, isMatch: false, notes: `${label} missing on one document` });
    acc.discrepancies.push({ field, sourceValue: va || null, targetValue: vb || null, severity: "INFO", category: "NEEDS_VERIFICATION", description: `${label} not available on ${!na ? la : lb}; comparison skipped.` });
    return;
  }
  const isMatch = na === nb || (tolerantContains && (na.includes(nb) || nb.includes(na)));
  acc.rows.push({ field, doc1Value: va, doc2Value: vb, isMatch, notes: isMatch ? `${label} verified` : `${label} difference` });
  if (!isMatch) {
    acc.discrepancies.push({ field, sourceValue: va, targetValue: vb, severity: "WARNING", category: "NEEDS_VERIFICATION", description: `${label} difference: ${la} "${va}" vs ${lb} "${vb}".` });
  }
}

function sf10StatusOf(rows: ComparisonRow[], discrepancies: DiscrepancyItem[]): CrossDocumentValidationStatus {
  if (rows.length === 0) return "NOT_APPLICABLE";
  if (discrepancies.some((d) => d.severity === "CRITICAL")) return "MISMATCH";
  if (discrepancies.some((d) => d.severity === "WARNING")) return "NEEDS_VERIFICATION";
  return "MATCH";
}

/** SF10 <-> SF1: LRN, Full Name, Sex, normalized Birth Date. */
export function compareSf10AndSf1(sf10: Sf10IdentityDocLike, sf1: Sf10IdentityDocLike): PairwiseValidationResult {
  const acc: IdentityAccumulator = { rows: [], discrepancies: [] };
  const la = "SF10";
  const lb = "SF1";
  sf10CompareLrn(acc, sf10, sf1, la, lb);
  sf10CompareFullName(acc, sf10, sf1, la, lb);
  sf10CompareSex(acc, sf10, sf1, la, lb);
  sf10CompareBirthDate(acc, sf10, sf1, la, lb);
  const status = sf10StatusOf(acc.rows, acc.discrepancies);
  const gl = sf10NormGradeLevel(sf1.grade_level || sf10.grade_level);
  return {
    validationType: "SF1_SF10",
    status,
    needsHumanReview: status !== "MATCH",
    schoolYear: sf1.school_year || sf10.school_year || "Unknown",
    gradeLevel: gl === "12" ? "Grade 12" : gl === "11" ? "Grade 11" : undefined,
    sourceDoc1Id: sf10.document_id,
    sourceDoc2Id: sf1.document_id,
    comparisonResults: acc.rows,
    discrepancies: acc.discrepancies,
    summaryMessage:
      status === "MATCH"
        ? "SF10 learner's information (LRN, full name, sex, birth date) matches the SF1 school register."
        : `SF10 vs SF1 identity review: ${acc.discrepancies.filter((d) => d.severity !== "INFO").map((d) => d.description).join("; ") || "incomplete data"}`,
  };
}

/** SF10 <-> PSA: civil identity ONLY (Full Name, Sex, month-normalized Birth Date). No LRN on PSA. */
export function compareSf10AndPsa(sf10: Sf10IdentityDocLike, psa: Sf10IdentityDocLike): PairwiseValidationResult {
  const acc: IdentityAccumulator = { rows: [], discrepancies: [] };
  const la = "SF10";
  const lb = "PSA";
  sf10CompareFullName(acc, sf10, psa, la, lb);
  sf10CompareSex(acc, sf10, psa, la, lb);
  sf10CompareBirthDate(acc, sf10, psa, la, lb);
  const status = sf10StatusOf(acc.rows, acc.discrepancies);
  return {
    validationType: "PSA_SF10",
    status,
    needsHumanReview: status !== "MATCH",
    schoolYear: sf10.school_year || "Unknown",
    sourceDoc1Id: sf10.document_id,
    sourceDoc2Id: psa.document_id,
    comparisonResults: acc.rows,
    discrepancies: acc.discrepancies,
    summaryMessage:
      status === "MATCH"
        ? "SF10 civil identity (full name, sex, birth date) matches the PSA birth certificate."
        : `SF10 vs PSA civil identity review: ${acc.discrepancies.filter((d) => d.severity !== "INFO").map((d) => d.description).join("; ") || "incomplete data"}`,
  };
}

export interface Sf10SemesterBlockLike {
  school_id?: string;
  school_year?: string;
  grade_level?: string;
  semester?: string;
  section?: string;
  track_strand?: string;
  general_average?: number | null;
  subjects?: Array<Record<string, any>>;
}

function sf10NumOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

/** Resolve SF10 semester blocks from scholastic_records, completed_semesters, or flat grades. */
export function resolveSf10SemesterBlocks(sf10: Sf10IdentityDocLike): Sf10SemesterBlockLike[] {
  const fromRecords: any[] = Array.isArray(sf10.scholastic_records) && sf10.scholastic_records.length > 0
    ? sf10.scholastic_records
    : Array.isArray(sf10.completed_semesters) ? sf10.completed_semesters : [];
  if (fromRecords.length > 0) {
    return fromRecords.map((r) => ({
      school_id: r.school_id,
      school_year: r.school_year || r.schoolYear || sf10.school_year || undefined,
      grade_level: r.grade_level || r.gradeLevel || sf10.grade_level || undefined,
      semester: r.semester,
      section: r.section || sf10.section || undefined,
      track_strand: r.track_strand || sf10.track_strand || sf10.strand || undefined,
      general_average: sf10NumOrNull(r.general_average),
      subjects: (r.subjects || []).map((s: any) => ({
        subject: s.subject,
        q1: s.q1,
        q2: s.q2,
        q3: s.q3,
        q4: s.q4,
        final: s.sem_final_grade ?? s.final_grade ?? s.final,
      })),
    }));
  }
  const groups = new Map<string, Sf10SemesterBlockLike>();
  for (const g of Array.isArray(sf10.grades) ? sf10.grades : []) {
    const sem = sf10NormSemester(g.semester || sf10.semester) || "1st Semester";
    const gl = g.grade_level || sf10.grade_level || undefined;
    const sy = g.school_year || sf10.school_year || undefined;
    const key = `${gl}|${sy}|${sem}`;
    if (!groups.has(key)) {
      groups.set(key, {
        school_year: sy,
        grade_level: gl,
        semester: sem,
        section: sf10.section || undefined,
        track_strand: sf10.track_strand || sf10.strand || undefined,
        general_average:
          sem === "2nd Semester"
            ? sf10NumOrNull(sf10.sem2_printed_general_average ?? sf10.sem2_general_average)
            : sf10NumOrNull(sf10.sem1_printed_general_average ?? sf10.sem1_general_average ?? sf10.general_average),
        subjects: [],
      });
    }
    groups.get(key)!.subjects!.push(g);
  }
  return Array.from(groups.values());
}

/**
 * SF10 <-> SF9: identity (LRN, Full Name, Sex) + scholastic context (Grade Level,
 * Section, School Year, Track/Strand) + per-semester Subject Grades & General Averages.
 */
export function compareSf10AndSf9(sf10: Sf10IdentityDocLike, sf9: Sf10IdentityDocLike): PairwiseValidationResult {
  const acc: IdentityAccumulator = { rows: [], discrepancies: [] };
  const la = "SF10";
  const lb = "SF9";
  sf10CompareLrn(acc, sf10, sf9, la, lb);
  sf10CompareFullName(acc, sf10, sf9, la, lb);
  sf10CompareSex(acc, sf10, sf9, la, lb);

  const blocks = resolveSf10SemesterBlocks(sf10);
  const sf9Gl = sf10NormGradeLevel(sf9.grade_level);
  const sf9Sy = sf10NormSchoolYear(sf9.school_year);
  const contextBlocks = blocks.filter(
    (b) => (!sf9Gl || sf10NormGradeLevel(b.grade_level) === sf9Gl) && (!sf9Sy || sf10NormSchoolYear(b.school_year) === sf9Sy)
  );
  const ctx: Sf10SemesterBlockLike =
    contextBlocks[0] ||
    blocks.find((b) => sf9Gl && sf10NormGradeLevel(b.grade_level) === sf9Gl) ||
    blocks[0] || {
      school_year: sf10.school_year || undefined,
      grade_level: sf10.grade_level || undefined,
      section: sf10.section || undefined,
      track_strand: sf10.track_strand || sf10.strand || undefined,
    };

  sf10CompareContextField(acc, "grade_level", "Grade level", ctx.grade_level, sf9.grade_level, sf10NormGradeLevel, la, lb);
  sf10CompareContextField(acc, "school_year", "School year", ctx.school_year, sf9.school_year, sf10NormSchoolYear, la, lb);
  sf10CompareContextField(acc, "section", "Section", ctx.section, sf9.section, sf10NormText, la, lb);
  sf10CompareContextField(acc, "track_strand", "Track/Strand", ctx.track_strand, sf9.track_strand || sf9.strand, sf10NormText, la, lb, true);

  // Per-semester subject grades & general averages
  const sf9Grades: any[] = Array.isArray(sf9.grades) ? sf9.grades : [];
  const sf9DefaultSem = sf10NormSemester(sf9.semester) || "1st Semester";
  const sf9Ctx = { schoolYear: sf9.school_year || ctx.school_year, gradeLevel: sf9.grade_level || ctx.grade_level };
  const semesters: Array<"1st Semester" | "2nd Semester"> = ["1st Semester", "2nd Semester"];
  const semesterSummaries: string[] = [];

  for (const sem of semesters) {
    const sf9SemGrades = sf9Grades.filter((g) => (sf10NormSemester(g.semester) || sf9DefaultSem) === sem);
    const sf9Ga = sf10NumOrNull(
      sem === "1st Semester"
        ? sf9.sem1_general_average ?? sf9.sem1_displayed_general_average ?? (sf9DefaultSem === sem && !sf9.sem2_general_average ? sf9.general_average : null)
        : sf9.sem2_general_average ?? sf9.sem2_displayed_general_average ?? (sf9DefaultSem === sem ? sf9.general_average : null)
    );
    const block = (contextBlocks.length > 0 ? contextBlocks : blocks).find((b) => sf10NormSemester(b.semester) === sem);
    if (sf9SemGrades.length === 0 && sf9Ga === null) continue;
    if (!block) {
      acc.rows.push({ field: `semester_${sem}`, doc1Value: "MISSING", doc2Value: `${sf9SemGrades.length} subjects`, isMatch: false, notes: `No SF10 ${sem} block for this school year / grade level.` });
      acc.discrepancies.push({ field: `semester_${sem}`, sourceValue: null, targetValue: sf9SemGrades.length, severity: "WARNING", category: "NEEDS_VERIFICATION", description: `SF9 has ${sem} grades but no matching SF10 ${sem} scholastic record was found.` });
      continue;
    }

    const schoolYear = sf9Ctx.schoolYear || block.school_year;
    const gradeLevel = sf9Ctx.gradeLevel || block.grade_level;
    const toItem = (g: any): AcademicGradeItem => ({
      subject: String(g.subject || ""),
      semester: sem,
      gradeLevel,
      schoolYear,
      quarter1: sf10NumOrNull(sem === "2nd Semester" ? g.q3 ?? g.q1 : g.q1),
      quarter2: sf10NumOrNull(sem === "2nd Semester" ? g.q4 ?? g.q2 : g.q2),
      finalGrade: sf10NumOrNull(g.final ?? g.finalGrade ?? g.final_grade ?? g.recomputed_final_grade),
      confidence: g.confidence,
    });

    const semRes = compareSf9AndSf10(
      { document_id: sf9.document_id, school_year: schoolYear, grade_level: gradeLevel, semester: sem, grades: sf9SemGrades.map(toItem), general_average: null },
      { document_id: sf10.document_id, school_year: schoolYear, grade_level: gradeLevel, semester: sem, grades: (block.subjects || []).map(toItem), general_average: null }
    );
    acc.rows.push(...semRes.comparisonResults);
    acc.discrepancies.push(...semRes.discrepancies);

    // Per-semester General Average (printed SF10 "General Ave." vs SF9 semester average)
    const sf10Ga = sf10NumOrNull(block.general_average);
    if (sf9Ga !== null && sf10Ga !== null) {
      const isGaMatch = Math.round(sf9Ga) === Math.round(sf10Ga);
      acc.rows.push({ field: `general_average_${sem}`, doc1Value: sf10Ga, doc2Value: sf9Ga, isMatch: isGaMatch, notes: isGaMatch ? `${sem} general average verified` : `${sem} general average mismatch` });
      if (!isGaMatch) {
        acc.discrepancies.push({ field: `general_average_${sem}`, sourceValue: sf10Ga, targetValue: sf9Ga, severity: "CRITICAL", category: "MISMATCH", description: `${sem} General Average discrepancy: SF10 has ${sf10Ga}, SF9 has ${sf9Ga}.` });
      }
    }
    semesterSummaries.push(`${sem}: ${semRes.status}`);
  }

  const status = sf10StatusOf(acc.rows, acc.discrepancies);
  return {
    validationType: "SF9_SF10",
    status,
    needsHumanReview: status !== "MATCH",
    schoolYear: sf9.school_year || ctx.school_year || "Unknown",
    gradeLevel: sf9Gl === "12" ? "Grade 12" : sf9Gl === "11" ? "Grade 11" : undefined,
    semester: "Full Year",
    sourceDoc1Id: sf9.document_id,
    sourceDoc2Id: sf10.document_id,
    comparisonResults: acc.rows,
    discrepancies: acc.discrepancies,
    summaryMessage:
      status === "MATCH"
        ? `SF10 permanent record matches SF9 report card (identity, scholastic context${semesterSummaries.length ? ", " + semesterSummaries.join(", ") : ""}).`
        : `SF10 vs SF9 review: ${acc.discrepancies.filter((d) => d.severity !== "INFO").map((d) => d.description).join("; ") || "incomplete data"}`,
  };
}

// -----------------------------------------------------------------------------
// STUDENT DATA RECONCILIATION ENGINE USING PRIMARY SOURCE DOCUMENTS
// -----------------------------------------------------------------------------

export interface ReconciliationLogItem {
  fieldName: string;
  primarySource: "SF1" | "PSA" | "SF9";
  baselineValue: string;
  updatedForms: string[];
  previousStatus: "MISMATCH" | "INCOMPLETE";
  // Compatible aliases
  primaryKeySource?: "SF1" | "PSA" | "SF9";
  canonicalValue?: string;
}

export function reconcileStudentDataFromPrimarySources<T extends Record<string, any>>(
  dossier: T
): T & {
  reconciledDossier: T;
  reconciliationLog: ReconciliationLogItem[];
} {
  const reconciled: any = JSON.parse(JSON.stringify(dossier));
  const reconciliationLog: ReconciliationLogItem[] = [];

  const sf1Raw = reconciled.matchedSources?.sf1?.raw || reconciled.sf1Raw || {};
  const psaRaw = reconciled.matchedSources?.psa?.raw || reconciled.psaRaw || {};
  const sf2Raw = reconciled.matchedSources?.sf2?.raw || reconciled.sf2Raw || {};
  const sf9Raw = reconciled.matchedSources?.sf9?.raw || reconciled.sf9Raw || {};
  const sf10Raw = reconciled.matchedSources?.sf10?.raw || reconciled.sf10Raw || {};

  // 1. Primary Source 1 — SF1 for LRN & Enrollment Baseline
  const canonicalLrn = String(
    sf1Raw.lrn || sf1Raw.learner_reference_number || sf1Raw.student_lrn || reconciled.lrn || ""
  ).trim();
  const canonicalSchoolId = String(
    sf1Raw.school_id || sf1Raw.deped_school_id || sf9Raw.school_id || sf10Raw.school_id || "500169"
  ).trim();
  const canonicalSchoolYear = String(
    sf1Raw.school_year || sf1Raw.schoolYear || sf9Raw.school_year || sf10Raw.school_year || "2024-2025"
  ).trim();
  const canonicalGradeLevel = String(
    sf1Raw.grade_level || sf1Raw.gradeLevel || sf9Raw.grade_level || sf10Raw.grade_level || "Grade 11"
  ).trim();
  const canonicalSection = String(
    sf1Raw.section || sf1Raw.section_name || sf9Raw.section || sf10Raw.section || ""
  ).trim();
  const canonicalTrackStrand = String(
    sf1Raw.track_strand || sf1Raw.trackStrand || sf1Raw.strand || sf9Raw.track_strand || sf10Raw.track_strand || ""
  ).trim();

  // 2. Primary Source 2 — PSA for Student Full Name, Sex, & Birthday ONLY
  const hasPsa = Boolean(
    reconciled.documentPresence?.psa ||
    psaRaw.last_name ||
    psaRaw.identity?.last_name ||
    psaRaw.child_name ||
    psaRaw.name
  );

  const rawLastName = hasPsa
    ? (psaRaw.last_name || psaRaw.identity?.last_name || sf1Raw.last_name || reconciled.lastName || "")
    : (sf1Raw.last_name || sf9Raw.last_name || reconciled.lastName || "");
  const canonicalLastName = String(rawLastName).trim().toUpperCase();

  const rawFirstName = hasPsa
    ? (psaRaw.first_name || psaRaw.identity?.first_name || sf1Raw.first_name || reconciled.firstName || "")
    : (sf1Raw.first_name || sf9Raw.first_name || reconciled.firstName || "");
  const canonicalFirstName = String(rawFirstName).trim().toUpperCase();

  const rawMiddleName = hasPsa
    ? ((psaRaw.middle_name || psaRaw.identity?.middle_name) ?? sf1Raw.middle_name ?? reconciled.middleName ?? "")
    : (sf1Raw.middle_name ?? sf9Raw.middle_name ?? reconciled.middleName ?? "");
  const canonicalMiddleName = String(rawMiddleName || "").trim().toUpperCase();

  const rawSex = hasPsa
    ? (psaRaw.sex || psaRaw.identity?.sex || sf1Raw.sex || reconciled.sex)
    : (sf1Raw.sex || sf9Raw.sex || reconciled.sex);
  const canonicalSex = normalizeStrictSex(rawSex);

  const rawBirthDate = hasPsa
    ? (psaRaw.birth_date || psaRaw.identity?.birth_date || psaRaw.date_of_birth || sf1Raw.birth_date || reconciled.birthDate)
    : (sf1Raw.birth_date || sf9Raw.birth_date || reconciled.birthDate);
  const canonicalBirthDate = formatBirthDateDisplay(rawBirthDate) || String(rawBirthDate || "").trim();

  const canonicalFullName = `${canonicalLastName}, ${canonicalFirstName}${canonicalMiddleName ? " " + canonicalMiddleName : ""}`.trim();

  // 3. Primary Source 3 — SF9 for Grades & Attendance Baseline
  const sf9GeneralAverage = sf9Raw.general_average ?? sf9Raw.generalAverage;

  // Propagate to matchedSources raw objects
  if (reconciled.matchedSources?.sf1?.raw) {
    const s = reconciled.matchedSources.sf1.raw;
    if (canonicalLrn) s.lrn = canonicalLrn;
    if (canonicalSchoolId) s.school_id = canonicalSchoolId;
    if (canonicalSchoolYear) s.school_year = canonicalSchoolYear;
    if (canonicalGradeLevel) s.grade_level = canonicalGradeLevel;
    if (canonicalSection) s.section = canonicalSection;
    if (canonicalTrackStrand) s.track_strand = canonicalTrackStrand;
    if (canonicalLastName) s.last_name = canonicalLastName;
    if (canonicalFirstName) s.first_name = canonicalFirstName;
    if (canonicalMiddleName) s.middle_name = canonicalMiddleName;
    if (canonicalSex) s.sex = canonicalSex;
    if (canonicalBirthDate) s.birth_date = canonicalBirthDate;
  }

  if (reconciled.matchedSources?.sf2?.raw) {
    const s = reconciled.matchedSources.sf2.raw;
    if (canonicalLrn) s.lrn = canonicalLrn;
    if (canonicalSchoolId) s.school_id = canonicalSchoolId;
    if (canonicalSchoolYear) s.school_year = canonicalSchoolYear;
    if (canonicalGradeLevel) s.grade_level = canonicalGradeLevel;
    if (canonicalSection) s.section = canonicalSection;
    if (canonicalLastName) s.last_name = canonicalLastName;
    if (canonicalFirstName) s.first_name = canonicalFirstName;
    if (canonicalMiddleName) s.middle_name = canonicalMiddleName;
    if (canonicalSex) s.sex = canonicalSex;
    if (canonicalBirthDate) s.birth_date = canonicalBirthDate;
  }
  if (Array.isArray(reconciled.allSf2Records)) {
    for (const rec of reconciled.allSf2Records) {
      if (rec?.raw) {
        if (canonicalLrn) rec.raw.lrn = canonicalLrn;
        if (canonicalSchoolId) rec.raw.school_id = canonicalSchoolId;
        if (canonicalLastName) rec.raw.last_name = canonicalLastName;
        if (canonicalFirstName) rec.raw.first_name = canonicalFirstName;
      }
    }
  }

  if (reconciled.matchedSources?.sf9?.raw) {
    const s = reconciled.matchedSources.sf9.raw;
    if (canonicalLrn) s.lrn = canonicalLrn;
    if (canonicalSchoolId) s.school_id = canonicalSchoolId;
    if (canonicalSchoolYear) s.school_year = canonicalSchoolYear;
    if (canonicalGradeLevel) s.grade_level = canonicalGradeLevel;
    if (canonicalSection) s.section = canonicalSection;
    if (canonicalTrackStrand) s.track_strand = canonicalTrackStrand;
    if (canonicalLastName) s.last_name = canonicalLastName;
    if (canonicalFirstName) s.first_name = canonicalFirstName;
    if (canonicalMiddleName) s.middle_name = canonicalMiddleName;
    if (canonicalSex) s.sex = canonicalSex;
    if (canonicalBirthDate) s.birth_date = canonicalBirthDate;
  }

  if (reconciled.matchedSources?.sf10?.raw) {
    const s = reconciled.matchedSources.sf10.raw;
    if (canonicalLrn) s.lrn = canonicalLrn;
    if (canonicalSchoolId) s.school_id = canonicalSchoolId;
    if (canonicalSchoolYear) s.school_year = canonicalSchoolYear;
    if (canonicalGradeLevel) s.grade_level = canonicalGradeLevel;
    if (canonicalSection) s.section = canonicalSection;
    if (canonicalTrackStrand) s.track_strand = canonicalTrackStrand;
    if (canonicalLastName) s.last_name = canonicalLastName;
    if (canonicalFirstName) s.first_name = canonicalFirstName;
    if (canonicalMiddleName) s.middle_name = canonicalMiddleName;
    if (canonicalSex) s.sex = canonicalSex;
    if (canonicalBirthDate) s.birth_date = canonicalBirthDate;
    if (sf9GeneralAverage && !s.general_average) {
      s.general_average = sf9GeneralAverage;
    }
  }

  // Deduplicate and filter unifiedMatrix
  let rawMatrix: UnifiedFieldComparisonRow[] = Array.isArray(reconciled.unifiedMatrix)
    ? reconciled.unifiedMatrix
    : [];

  // Exclude Mother's Maiden Name from matrix
  rawMatrix = rawMatrix.filter(
    (row) => row.field !== "mother_maiden_name" && row.label !== "Mother's Maiden Name"
  );

  // Deduplicate monthly attendance comparison rows by normalized month key
  const seenAttendanceKeys = new Set<string>();
  const deduplicatedMatrix: UnifiedFieldComparisonRow[] = [];
  for (const row of rawMatrix) {
    if (row.category === "ATTENDANCE" || row.field.startsWith("attendance_")) {
      const mKey = normalizeAttendanceMonthKey(row.field.replace(/^attendance_/, "") || row.label || "");
      if (mKey && mKey !== "total" && mKey !== "annual_summary") {
        if (seenAttendanceKeys.has(mKey)) continue;
        seenAttendanceKeys.add(mKey);
      }
    }
    deduplicatedMatrix.push(row);
  }

  // Helper to add log item
  const addLog = (
    fieldName: string,
    primarySource: "SF1" | "PSA" | "SF9",
    baselineValue: string,
    updatedForms: string[],
    previousStatus: "MISMATCH" | "INCOMPLETE"
  ) => {
    reconciliationLog.push({
      fieldName,
      primarySource,
      baselineValue,
      updatedForms,
      previousStatus,
      primaryKeySource: primarySource,
      canonicalValue: baselineValue,
    });
  };

  // Iterate over matrix and reconcile rows
  for (const row of deduplicatedMatrix) {
    const prevStatus: "MISMATCH" | "INCOMPLETE" | undefined =
      row.status === "MISMATCH" || row.status === "INCOMPLETE"
        ? (row.status as "MISMATCH" | "INCOMPLETE")
        : row.isMatch === false
        ? "MISMATCH"
        : undefined;

    const fieldLower = (row.field || "").toLowerCase();

    if (fieldLower === "lrn") {
      row.sf1Value = canonicalLrn;
      row.sf2Value = canonicalLrn;
      row.sf9Value = canonicalLrn;
      row.sf10Value = canonicalLrn;
      row.psaValue = "Civil Document (No DepEd LRN)";
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source SF1 LRN baseline.";
      if (prevStatus) {
        addLog(row.label || "Learner Reference Number (LRN)", "SF1", canonicalLrn, ["SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "last_name") {
      if (hasPsa) row.psaValue = canonicalLastName;
      row.sf1Value = canonicalLastName;
      row.sf2Value = canonicalLastName;
      row.sf9Value = canonicalLastName;
      row.sf10Value = canonicalLastName;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source PSA civil identity.";
      if (prevStatus) {
        addLog(row.label || "Learner Last Name", hasPsa ? "PSA" : "SF1", canonicalLastName, ["SF1", "SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "first_name") {
      if (hasPsa) row.psaValue = canonicalFirstName;
      row.sf1Value = canonicalFirstName;
      row.sf2Value = canonicalFirstName;
      row.sf9Value = canonicalFirstName;
      row.sf10Value = canonicalFirstName;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source PSA civil identity.";
      if (prevStatus) {
        addLog(row.label || "Learner First Name", hasPsa ? "PSA" : "SF1", canonicalFirstName, ["SF1", "SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "middle_name") {
      if (hasPsa) row.psaValue = canonicalMiddleName;
      row.sf1Value = canonicalMiddleName;
      row.sf2Value = canonicalMiddleName;
      row.sf9Value = canonicalMiddleName;
      row.sf10Value = canonicalMiddleName;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source PSA civil identity.";
      if (prevStatus) {
        addLog(row.label || "Learner Middle Name", hasPsa ? "PSA" : "SF1", canonicalMiddleName, ["SF1", "SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "sex") {
      if (hasPsa) row.psaValue = canonicalSex;
      row.sf1Value = canonicalSex;
      row.sf2Value = canonicalSex;
      row.sf9Value = canonicalSex;
      row.sf10Value = canonicalSex;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source PSA civil identity.";
      if (prevStatus) {
        addLog(row.label || "Sex / Gender", hasPsa ? "PSA" : "SF1", canonicalSex, ["SF1", "SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "birth_date" || fieldLower.includes("birth")) {
      if (hasPsa) row.psaValue = canonicalBirthDate;
      row.sf1Value = canonicalBirthDate;
      row.sf2Value = canonicalBirthDate;
      row.sf9Value = canonicalBirthDate;
      row.sf10Value = canonicalBirthDate;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source PSA birth certificate.";
      if (prevStatus) {
        addLog(row.label || "Date of Birth", hasPsa ? "PSA" : "SF1", canonicalBirthDate, ["SF1", "SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "school_id") {
      row.sf1Value = canonicalSchoolId;
      row.sf2Value = canonicalSchoolId;
      row.sf9Value = canonicalSchoolId;
      row.sf10Value = canonicalSchoolId;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source SF1 school context.";
      if (prevStatus) {
        addLog(row.label || "DepEd School ID", "SF1", canonicalSchoolId, ["SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "school_year") {
      row.sf1Value = canonicalSchoolYear;
      row.sf2Value = canonicalSchoolYear;
      row.sf9Value = canonicalSchoolYear;
      row.sf10Value = canonicalSchoolYear;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source SF1 school context.";
      if (prevStatus) {
        addLog(row.label || "School Year", "SF1", canonicalSchoolYear, ["SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "grade_level") {
      row.sf1Value = canonicalGradeLevel;
      row.sf2Value = canonicalGradeLevel;
      row.sf9Value = canonicalGradeLevel;
      row.sf10Value = canonicalGradeLevel;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source SF1 school context.";
      if (prevStatus) {
        addLog(row.label || "Grade Level", "SF1", canonicalGradeLevel, ["SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "section") {
      row.sf1Value = canonicalSection;
      row.sf2Value = canonicalSection;
      row.sf9Value = canonicalSection;
      row.sf10Value = canonicalSection;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source SF1 school context.";
      if (prevStatus) {
        addLog(row.label || "Section Assignment", "SF1", canonicalSection, ["SF2", "SF9", "SF10"], prevStatus);
      }
    } else if (fieldLower === "track_strand" || fieldLower === "track" || fieldLower === "strand") {
      row.sf1Value = canonicalTrackStrand;
      row.sf9Value = canonicalTrackStrand;
      row.sf10Value = canonicalTrackStrand;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source SF1 school context.";
      if (prevStatus) {
        addLog(row.label || "Track & Strand", "SF1", canonicalTrackStrand, ["SF9", "SF10"], prevStatus);
      }
    } else if (row.category === "ATTENDANCE" || fieldLower.startsWith("attendance_")) {
      const canonicalAtt = row.sf9Value || row.sf2Value || "Pres: 20, Abs: 0, Tot: 20";
      row.sf9Value = canonicalAtt;
      row.sf2Value = canonicalAtt;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source SF9 attendance baseline.";
      if (prevStatus) {
        addLog(row.label || row.field, "SF9", canonicalAtt, ["SF2"], prevStatus);
      }
    } else if (
      fieldLower === "general_average" ||
      fieldLower.startsWith("general_average") ||
      fieldLower.startsWith("grade_") ||
      fieldLower.startsWith("subject_") ||
      row.category === "ACADEMIC_PERFORMANCE"
    ) {
      const canonicalGrade = row.sf9Value ?? row.sf10Value ?? sf9GeneralAverage ?? "";
      row.sf9Value = canonicalGrade;
      row.sf10Value = canonicalGrade;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled from Primary Source SF9 report card baseline.";
      if (prevStatus) {
        addLog(row.label || row.field, "SF9", String(canonicalGrade), ["SF10"], prevStatus);
      }
    } else if (prevStatus) {
      const primarySource: "SF1" | "PSA" | "SF9" =
        fieldLower.includes("attendance") || fieldLower.includes("grade") ? "SF9" : "SF1";
      const canonicalVal = row.sf1Value || row.sf9Value || row.sf10Value || row.sf2Value || row.psaValue || "";
      if (row.sf1Value !== undefined) row.sf1Value = canonicalVal;
      if (row.sf2Value !== undefined) row.sf2Value = canonicalVal;
      if (row.sf9Value !== undefined) row.sf9Value = canonicalVal;
      if (row.sf10Value !== undefined) row.sf10Value = canonicalVal;
      row.status = "MATCH";
      row.isMatch = true;
      row.notes = "Reconciled to Primary Source baseline.";
      addLog(row.label || row.field, primarySource, String(canonicalVal), ["All Related Forms"], prevStatus);
    }
  }

  reconciled.unifiedMatrix = deduplicatedMatrix;
  reconciled.discrepancies = [];
  reconciled.overallStatus = "MATCH";
  reconciled.lrn = canonicalLrn;
  reconciled.fullName = canonicalFullName;
  reconciled.lastName = canonicalLastName;
  reconciled.firstName = canonicalFirstName;
  reconciled.middleName = canonicalMiddleName;
  reconciled.sex = canonicalSex;
  reconciled.birthDate = canonicalBirthDate;
  reconciled.gradeLevel = canonicalGradeLevel;
  reconciled.section = canonicalSection;
  reconciled.trackStrand = canonicalTrackStrand;
  reconciled.reconciliationLog = reconciliationLog;
  reconciled.reconciledDossier = reconciled;

  return reconciled;
}

// Backward-compatible alias
export const reconcileStudentDataFromPrimaryKeys = reconcileStudentDataFromPrimarySources;

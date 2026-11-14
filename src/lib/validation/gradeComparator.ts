import { computeSemesterFinalGrade, getAuthoritativeSemesterFinalGrade } from "./gradeUtils";
import type { GradeRecord } from "@/types/documents";

export interface GradeQuarterDiff {
  quarter: "q1" | "q2" | "q3" | "q4";
  existingValue: number | null;
  scannedValue: number | null;
  hasChange: boolean;
  isOverwritable: boolean; // false if scanned is blank/unreadable
  displayDiff?: string;
}

export interface SubjectComparisonItem {
  subject: string;
  normalizedSubject: string;
  schoolYear: string;
  semester: string;
  existingId?: string;
  status: "UNCHANGED" | "PROPOSED_UPDATE" | "NEW_SUBJECT";
  existingGrades: {
    q1: number | null;
    q2: number | null;
    q3: number | null;
    q4: number | null;
    final: number | null;
    status: string | null;
  } | null;
  scannedGrades: {
    q1: number | null;
    q2: number | null;
    q3: number | null;
    q4: number | null;
    final: number | null;
    status: string | null;
  };
  quarterDiffs: GradeQuarterDiff[];
  proposedFinalGrade?: number | null;
  proposedStatus?: "Passed" | "Failed" | "Needs Verification";
  hasProposedChanges: boolean;
  notes: string;
}

export interface DocumentGradeComparisonResult {
  studentId?: string;
  isExistingStudent: boolean;
  totalSubjects: number;
  unchangedCount: number;
  proposedUpdateCount: number;
  newSubjectCount: number;
  hasAnyProposedChanges: boolean;
  subjects: SubjectComparisonItem[];
  summaryMessage: string;
}

/**
 * Normalizes subject names for reliable matching across OCR variations and DepEd nomenclatures.
 */
export function normalizeSubjectName(raw: string | undefined | null): string {
  if (!raw || typeof raw !== "string") return "";
  let norm = raw.toLowerCase().trim();

  // Strip leading numbering or bullet points e.g. "1. Oral Communication" -> "Oral Communication"
  norm = norm.replace(/^\d+[\.\)]\s*/, "");

  // Common abbreviations and aliases in DepEd SHS SF9/SF10
  norm = norm.replace(/\bcomm\b\.?/g, "communication");
  norm = norm.replace(/\bgen(?:\.?|\s+)?math\b/g, "general mathematics");
  norm = norm.replace(/\bstat(?:\.?|\s+)?prob\b/g, "statistics and probability");
  norm = norm.replace(/\bintro\b/g, "introduction");
  norm = norm.replace(/\bpe\s*&\s*health\b/g, "physical education and health");
  norm = norm.replace(/\bp\.e\b/g, "physical education");
  norm = norm.replace(/\s*&\s*/g, " and ");
  norm = norm.replace(/[^a-z0-9\s]/g, " ");
  norm = norm.replace(/\s+/g, " ").trim();

  return norm;
}

/**
 * Normalizes semester labels to standard "1st Semester", "2nd Semester", or "Full Year".
 */
export function normalizeSemester(sem: string | undefined | null): string {
  if (!sem || typeof sem !== "string") return "1st Semester";
  const lower = sem.toLowerCase().trim();
  if (lower.includes("2nd") || lower.includes("second") || lower.includes("sem 2") || lower.includes("semester 2")) {
    return "2nd Semester";
  }
  if (lower.includes("1st") || lower.includes("first") || lower.includes("sem 1") || lower.includes("semester 1")) {
    return "1st Semester";
  }
  return sem.trim();
}

function parseGradeNumber(val: any): number | null {
  if (val === undefined || val === null || val === "" || val === "-" || val === "N/A") return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  const match = String(val).trim().match(/^-?(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const parsed = parseFloat(match[1]);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Compares newly scanned OCR grades against active database subject_grades for an existing student.
 * Detects proposed changes, prevents silent overwrites, protects verified grades from blank cells,
 * and recalculates dependent final grades.
 */
export function compareScannedGradesWithExisting(params: {
  existingGrades: any[];
  scannedGrades: GradeRecord[];
  schoolYear?: string;
  semester?: string;
  studentId?: string;
}): DocumentGradeComparisonResult {
  const { existingGrades = [], scannedGrades = [], schoolYear = "Unknown", semester = "1st Semester", studentId } = params;

  const normTargetYear = schoolYear.trim();
  const normTargetSem = normalizeSemester(semester);

  const subjects: SubjectComparisonItem[] = [];
  let unchangedCount = 0;
  let proposedUpdateCount = 0;
  let newSubjectCount = 0;

  for (const scan of scannedGrades) {
    const rawSubject = (scan.subject || "General Subject").trim();
    const normSub = normalizeSubjectName(rawSubject);
    const scanSem = normalizeSemester(scan.semester || normTargetSem);
    const scanYear = ((scan as any).school_year || normTargetYear).trim();

    // Find matching active existing grade
    const match = existingGrades.find((ex: any) => {
      const exSub = normalizeSubjectName(ex.subject);
      const exSem = normalizeSemester(ex.semester || normTargetSem);
      const exYear = (ex.school_year || normTargetYear).trim();

      const yearMatch = !normTargetYear || normTargetYear === "Unknown" || exYear === scanYear;
      const semMatch = exSem === scanSem;
      const subMatch = exSub === normSub || exSub.includes(normSub) || normSub.includes(exSub);

      return yearMatch && semMatch && subMatch;
    });

    const scanQ1 = parseGradeNumber(scan.q1);
    const scanQ2 = parseGradeNumber(scan.q2);
    const scanQ3 = parseGradeNumber(scan.q3);
    const scanQ4 = parseGradeNumber(scan.q4);
    const scanFinal = parseGradeNumber(getAuthoritativeSemesterFinalGrade(scan));

    if (!match) {
      // New subject proposed for this academic period
      newSubjectCount++;
      const computedFinal = scanSem === "1st Semester"
        ? computeSemesterFinalGrade(scanQ1, scanQ2)
        : computeSemesterFinalGrade(scanQ3, scanQ4);
      const effectiveFinal = scanFinal ?? computedFinal;
      const proposedStatus = effectiveFinal !== undefined ? (effectiveFinal >= 75 ? "Passed" : "Failed") : "Needs Verification";

      subjects.push({
        subject: rawSubject,
        normalizedSubject: normSub,
        schoolYear: scanYear,
        semester: scanSem,
        status: "NEW_SUBJECT",
        existingGrades: null,
        scannedGrades: {
          q1: scanQ1,
          q2: scanQ2,
          q3: scanQ3,
          q4: scanQ4,
          final: scanFinal,
          status: scan.status || (effectiveFinal ? (effectiveFinal >= 75 ? "Passed" : "Failed") : null),
        },
        quarterDiffs: [],
        proposedFinalGrade: effectiveFinal,
        proposedStatus,
        hasProposedChanges: true,
        notes: `New learning area '${rawSubject}' detected in scanned document.`,
      });
      continue;
    }

    // Existing grade record located — evaluate quarter diffs
    const exQ1 = parseGradeNumber(match.q1);
    const exQ2 = parseGradeNumber(match.q2);
    const exQ3 = parseGradeNumber(match.q3);
    const exQ4 = parseGradeNumber(match.q4);
    const exFinal = parseGradeNumber(match.final_grade ?? match.final);

    const quarterDiffs: GradeQuarterDiff[] = [];
    const quartersToCheck: Array<"q1" | "q2" | "q3" | "q4"> =
      scanSem === "1st Semester" ? ["q1", "q2"] : ["q3", "q4"];

    let hasSubjectChange = false;

    for (const q of quartersToCheck) {
      const exVal = q === "q1" ? exQ1 : q === "q2" ? exQ2 : q === "q3" ? exQ3 : exQ4;
      const scVal = q === "q1" ? scanQ1 : q === "q2" ? scanQ2 : q === "q3" ? scanQ3 : scanQ4;

      if (scVal !== null && exVal !== null) {
        if (scVal !== exVal) {
          hasSubjectChange = true;
          quarterDiffs.push({
            quarter: q,
            existingValue: exVal,
            scannedValue: scVal,
            hasChange: true,
            isOverwritable: true,
            displayDiff: `${exVal} → ${scVal}`,
          });
        } else {
          quarterDiffs.push({
            quarter: q,
            existingValue: exVal,
            scannedValue: scVal,
            hasChange: false,
            isOverwritable: false,
          });
        }
      } else if (scVal !== null && exVal === null) {
        // Scanned value provides previously missing quarter
        hasSubjectChange = true;
        quarterDiffs.push({
          quarter: q,
          existingValue: null,
          scannedValue: scVal,
          hasChange: true,
          isOverwritable: true,
          displayDiff: `Missing → ${scVal}`,
        });
      } else if (scVal === null && exVal !== null) {
        // Scanned is blank/unreadable; DO NOT overwrite verified grade
        quarterDiffs.push({
          quarter: q,
          existingValue: exVal,
          scannedValue: null,
          hasChange: false,
          isOverwritable: false,
          displayDiff: `Retained verified grade (${exVal})`,
        });
      }
    }

    // Dependent final grade recalculation
    const effectiveQ1 = scanQ1 ?? exQ1;
    const effectiveQ2 = scanQ2 ?? exQ2;
    const effectiveQ3 = scanQ3 ?? exQ3;
    const effectiveQ4 = scanQ4 ?? exQ4;

    const computedFinal = scanSem === "1st Semester"
      ? computeSemesterFinalGrade(effectiveQ1, effectiveQ2)
      : computeSemesterFinalGrade(effectiveQ3, effectiveQ4);

    const proposedFinal = computedFinal ?? scanFinal ?? exFinal;
    const proposedStatus = (proposedFinal !== undefined && proposedFinal !== null)
      ? (proposedFinal >= 75 ? "Passed" : "Failed")
      : "Needs Verification";

    if (hasSubjectChange) {
      proposedUpdateCount++;
      const changeDescriptions = quarterDiffs
        .filter((d) => d.hasChange)
        .map((d) => `${d.quarter.toUpperCase()}: ${d.displayDiff}`)
        .join(", ");

      subjects.push({
        subject: match.subject || rawSubject,
        normalizedSubject: normSub,
        schoolYear: scanYear,
        semester: scanSem,
        existingId: match.id,
        status: "PROPOSED_UPDATE",
        existingGrades: {
          q1: exQ1,
          q2: exQ2,
          q3: exQ3,
          q4: exQ4,
          final: exFinal,
          status: match.status || (exFinal ? (exFinal >= 75 ? "Passed" : "Failed") : null),
        },
        scannedGrades: {
          q1: scanQ1,
          q2: scanQ2,
          q3: scanQ3,
          q4: scanQ4,
          final: scanFinal,
          status: scan.status || (scanFinal ? (scanFinal >= 75 ? "Passed" : "Failed") : null),
        },
        quarterDiffs,
        proposedFinalGrade: proposedFinal,
        proposedStatus,
        hasProposedChanges: true,
        notes: `Proposed grade update: ${changeDescriptions}. Dependent final recomputed to ${proposedFinal} (${proposedStatus}).`,
      });
    } else {
      unchangedCount++;
      subjects.push({
        subject: match.subject || rawSubject,
        normalizedSubject: normSub,
        schoolYear: scanYear,
        semester: scanSem,
        existingId: match.id,
        status: "UNCHANGED",
        existingGrades: {
          q1: exQ1,
          q2: exQ2,
          q3: exQ3,
          q4: exQ4,
          final: exFinal,
          status: match.status || (exFinal ? (exFinal >= 75 ? "Passed" : "Failed") : null),
        },
        scannedGrades: {
          q1: scanQ1,
          q2: scanQ2,
          q3: scanQ3,
          q4: scanQ4,
          final: scanFinal,
          status: scan.status || (scanFinal ? (scanFinal >= 75 ? "Passed" : "Failed") : null),
        },
        quarterDiffs,
        proposedFinalGrade: exFinal,
        proposedStatus: exFinal !== null ? (exFinal >= 75 ? "Passed" : "Failed") : "Needs Verification",
        hasProposedChanges: false,
        notes: "Scanned grades match active database records. Zero changes needed.",
      });
    }
  }

  const hasAnyProposedChanges = proposedUpdateCount > 0 || newSubjectCount > 0;
  let summaryMessage = "";
  if (!existingGrades.length) {
    summaryMessage = "Initial scan: all extracted subjects are staged as new active records.";
  } else if (hasAnyProposedChanges) {
    summaryMessage = `Detected ${proposedUpdateCount} subject update(s) and ${newSubjectCount} new subject(s) awaiting authorized review.`;
  } else {
    summaryMessage = "All scanned grades match existing verified records. No duplicate records will be created.";
  }

  return {
    studentId,
    isExistingStudent: Boolean(existingGrades.length > 0 || studentId),
    totalSubjects: subjects.length,
    unchangedCount,
    proposedUpdateCount,
    newSubjectCount,
    hasAnyProposedChanges,
    subjects,
    summaryMessage,
  };
}

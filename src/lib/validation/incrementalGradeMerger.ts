import { 
  normalizeSubjectName, 
  normalizeSemester 
} from "./gradeComparator";
import { computeSemesterFinalGrade, getAuthoritativeSemesterFinalGrade } from "./gradeUtils";
import type { GradeRecord } from "@/types/documents";

export interface GradeConflict {
  subject: string;
  quarter: "q1" | "q2" | "q3" | "q4";
  existingValue: number;
  scannedValue: number;
  message: string;
}

export interface IncrementalMergeResult {
  mergedGrades: GradeRecord[];
  conflicts: GradeConflict[];
  hasConflicts: boolean;
  addedQuarters: Array<{ subject: string; quarter: string; value: number }>;
  preservedQuarters: Array<{ subject: string; quarter: string; value: number }>;
}

function parseGrade(val: unknown): number | null {
  if (val === undefined || val === null || val === "" || val === "-" || val === "N/A") return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  const match = String(val).trim().match(/^-?(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const parsed = parseFloat(match[1]);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Detects which quarters have numeric grades populated in a grade records array.
 */
export function detectCapturedQuarters(grades: GradeRecord[] | any[] | undefined | null): string[] {
  if (!Array.isArray(grades) || grades.length === 0) return [];
  const quarters = new Set<string>();
  for (const g of grades) {
    if (parseGrade(g.q1) !== null) quarters.add("Q1");
    if (parseGrade(g.q2) !== null) quarters.add("Q2");
    if (parseGrade(g.q3) !== null) quarters.add("Q3");
    if (parseGrade(g.q4) !== null) quarters.add("Q4");
  }
  return Array.from(quarters).sort();
}

/**
 * Merges newly scanned quarterly grades into existing academic grades for the same student.
 * 
 * Invariants:
 * 1. Preserves existing quarterly grades (e.g., Q1 from earlier scan) when new scan only contains later quarters (e.g., Q2).
 * 2. Adds newly populated quarters (e.g., Q2) to existing subjects.
 * 3. Flags any conflicting grades between existing and new scan for manual teacher review.
 * 4. Recalculates semester final grades and pass/fail statuses under DepEd DO 8, s. 2015.
 * 5. Preserves all existing subjects while adding any newly detected learning areas.
 */
export function mergeIncrementalGrades(params: {
  existingGrades: GradeRecord[] | any[];
  newGrades: GradeRecord[] | any[];
  schoolYear?: string;
  semester?: string;
}): IncrementalMergeResult {
  const { existingGrades = [], newGrades = [], semester = "1st Semester" } = params;

  const conflicts: GradeConflict[] = [];
  const addedQuarters: Array<{ subject: string; quarter: string; value: number }> = [];
  const preservedQuarters: Array<{ subject: string; quarter: string; value: number }> = [];

  const existingMap = new Map<string, any>();
  for (const ex of existingGrades) {
    const key = `${normalizeSubjectName(ex.subject)}::${normalizeSemester(ex.semester || semester)}`;
    existingMap.set(key, { ...ex });
  }

  const mergedList: GradeRecord[] = [];
  const consumedKeys = new Set<string>();

  // Process incoming grades
  for (const sc of newGrades) {
    const rawSub = sc.subject || "General Subject";
    const scSem = normalizeSemester(sc.semester || semester);
    const key = `${normalizeSubjectName(rawSub)}::${scSem}`;

    const ex = existingMap.get(key);

    if (ex) {
      consumedKeys.add(key);
      const merged: any = { ...ex, ...sc };
      merged.subject = ex.subject || sc.subject;
      merged.semester = scSem;

      // Evaluate Q1-Q4
      const quarters: Array<"q1" | "q2" | "q3" | "q4"> = ["q1", "q2", "q3", "q4"];

      for (const q of quarters) {
        const exVal = parseGrade(ex[q]);
        const scVal = parseGrade(sc[q]);

        if (exVal !== null && scVal !== null) {
          if (exVal !== scVal) {
            // Discrepancy between earlier scan and new scan!
            conflicts.push({
              subject: merged.subject,
              quarter: q,
              existingValue: exVal,
              scannedValue: scVal,
              message: `Conflicting grade for ${merged.subject} ${q.toUpperCase()}: Previous verified value was ${exVal}, but new scan shows ${scVal}.`,
            });
            // Keep earlier value as active, flag conflict for manual teacher decision
            merged[q] = exVal;
            preservedQuarters.push({ subject: merged.subject, quarter: q, value: exVal });
          } else {
            merged[q] = exVal;
            preservedQuarters.push({ subject: merged.subject, quarter: q, value: exVal });
          }
        } else if (exVal !== null && scVal === null) {
          // Preserve earlier quarter grade
          merged[q] = exVal;
          preservedQuarters.push({ subject: merged.subject, quarter: q, value: exVal });
        } else if (exVal === null && scVal !== null) {
          // Add newly scanned quarter grade!
          merged[q] = scVal;
          addedQuarters.push({ subject: merged.subject, quarter: q, value: scVal });
        } else {
          merged[q] = null;
        }
      }

      // Recompute semester final grade under DepEd DO 8 rules
      const computedFinal = scSem === "1st Semester"
        ? computeSemesterFinalGrade(merged.q1, merged.q2)
        : computeSemesterFinalGrade(merged.q3, merged.q4);

      const effectiveFinal = computedFinal ?? parseGrade(getAuthoritativeSemesterFinalGrade(sc)) ?? parseGrade(ex.final_grade ?? ex.final);
      merged.final = effectiveFinal !== null ? effectiveFinal : null;
      merged.final_grade = effectiveFinal !== null ? effectiveFinal : null;

      if (effectiveFinal !== null && effectiveFinal !== undefined) {
        merged.status = effectiveFinal >= 75 ? "Passed" : "Failed";
      } else {
        merged.status = ex.status || sc.status || "Needs Verification";
      }

      mergedList.push(merged);
    } else {
      // New subject in incoming scan
      const scValQ1 = parseGrade(sc.q1);
      const scValQ2 = parseGrade(sc.q2);
      const scValQ3 = parseGrade(sc.q3);
      const scValQ4 = parseGrade(sc.q4);

      if (scValQ1 !== null) addedQuarters.push({ subject: rawSub, quarter: "q1", value: scValQ1 });
      if (scValQ2 !== null) addedQuarters.push({ subject: rawSub, quarter: "q2", value: scValQ2 });
      if (scValQ3 !== null) addedQuarters.push({ subject: rawSub, quarter: "q3", value: scValQ3 });
      if (scValQ4 !== null) addedQuarters.push({ subject: rawSub, quarter: "q4", value: scValQ4 });

      const computedFinal = scSem === "1st Semester"
        ? computeSemesterFinalGrade(scValQ1, scValQ2)
        : computeSemesterFinalGrade(scValQ3, scValQ4);

      const effectiveFinal = computedFinal ?? parseGrade(getAuthoritativeSemesterFinalGrade(sc));
      const status = effectiveFinal !== null ? (effectiveFinal >= 75 ? "Passed" : "Failed") : (sc.status || "Needs Verification");

      mergedList.push({
        ...sc,
        subject: rawSub,
        semester: scSem,
        q1: scValQ1,
        q2: scValQ2,
        q3: scValQ3,
        q4: scValQ4,
        final: effectiveFinal,
        final_grade: effectiveFinal,
        status,
      });
    }
  }

  // Preserve existing subjects that were not present in the new scan
  for (const [key, ex] of existingMap.entries()) {
    if (!consumedKeys.has(key)) {
      mergedList.push(ex);
      if (parseGrade(ex.q1) !== null) preservedQuarters.push({ subject: ex.subject, quarter: "q1", value: parseGrade(ex.q1)! });
      if (parseGrade(ex.q2) !== null) preservedQuarters.push({ subject: ex.subject, quarter: "q2", value: parseGrade(ex.q2)! });
      if (parseGrade(ex.q3) !== null) preservedQuarters.push({ subject: ex.subject, quarter: "q3", value: parseGrade(ex.q3)! });
      if (parseGrade(ex.q4) !== null) preservedQuarters.push({ subject: ex.subject, quarter: "q4", value: parseGrade(ex.q4)! });
    }
  }

  return {
    mergedGrades: mergedList,
    conflicts,
    hasConflicts: conflicts.length > 0,
    addedQuarters,
    preservedQuarters,
  };
}

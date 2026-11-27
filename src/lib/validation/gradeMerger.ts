import type { GradeRecord, ExtractedFields } from "@/types/documents";
import { 
  normalizeSubjectName, 
  normalizeSemester 
} from "./gradeComparator";
import { 
  computeRawSemesterFinalGrade,
  computeOfficialSemesterFinalGrade,
  computeSemesterGeneralAverage, 
  normalizeSemesterContext, 
  parseQuarterNumeric,
  updateExtractedFieldsAverages,
  evaluateDynamicGradeStatus
} from "./gradeUtils";

export interface GradeQuarterConflict {
  subject: string;
  semester: string;
  quarter: "q1" | "q2" | "q3" | "q4";
  existingValue: number;
  incomingValue: number;
  reason: string;
}

export interface AddedQuarter {
  subject: string;
  semester: string;
  quarter: "q1" | "q2" | "q3" | "q4";
  value: number;
}

export interface GradeMergeResult {
  mergedGrades: GradeRecord[];
  mergedFields: ExtractedFields;
  hasNewGrades: boolean;
  isIdentical: boolean;
  addedQuarters: AddedQuarter[];
  conflicts: GradeQuarterConflict[];
  recalculatedAverages: Record<string, any>;
  summaryMessage: string;
}

/**
 * Recomputes the official DepEd semester final grade and status for a single subject grade record.
 */
export function recomputeSubjectFinalAndStatus(rec: GradeRecord, semesterContext?: string): GradeRecord {
  const sem = normalizeSemesterContext(rec.semester) || normalizeSemesterContext(semesterContext) || "1st Semester";
  const updated: GradeRecord = { ...rec, semester: sem };

  const q1 = parseQuarterNumeric(rec.q1);
  const q2 = parseQuarterNumeric(rec.q2);
  const q3 = parseQuarterNumeric(rec.q3);
  const q4 = parseQuarterNumeric(rec.q4);

  if (sem === "1st Semester") {
    if (q1 !== undefined && q2 !== undefined) {
      const raw = computeRawSemesterFinalGrade(q1, q2);
      const final = computeOfficialSemesterFinalGrade(q1, q2);
      const eval1 = evaluateDynamicGradeStatus({ grade: final });
      updated.q1 = q1;
      updated.q2 = q2;
      updated.sem1_final_grade = final;
      updated.final = final;
      updated.status = eval1.status === "passed" ? "Passed" : eval1.status === "failed" ? "Failed" : "Missing";
      updated.remarks = eval1.remarkDisplay;
      updated.remark = eval1.remarkDisplay;
      updated.needsVerification = eval1.isLowConfidence || eval1.status === "blank";
      (updated as any).raw_calculated_final = raw;
    } else {
      updated.sem1_final_grade = undefined;
      updated.final = undefined;
      updated.status = "Missing";
      updated.remarks = "Blank / Incomplete";
      updated.remark = "Blank / Incomplete";
      updated.needsVerification = true;
    }
  } else if (sem === "2nd Semester") {
    if (q3 !== undefined && q4 !== undefined) {
      const raw = computeRawSemesterFinalGrade(q3, q4);
      const final = computeOfficialSemesterFinalGrade(q3, q4);
      const eval2 = evaluateDynamicGradeStatus({ grade: final });
      updated.q3 = q3;
      updated.q4 = q4;
      updated.sem2_final_grade = final;
      updated.final = final;
      updated.status = eval2.status === "passed" ? "Passed" : eval2.status === "failed" ? "Failed" : "Missing";
      updated.remarks = eval2.remarkDisplay;
      updated.remark = eval2.remarkDisplay;
      updated.needsVerification = eval2.isLowConfidence || eval2.status === "blank";
      (updated as any).raw_calculated_final = raw;
    } else {
      updated.sem2_final_grade = undefined;
      updated.final = undefined;
      updated.status = "Missing";
      updated.remarks = "Blank / Incomplete";
      updated.remark = "Blank / Incomplete";
      updated.needsVerification = true;
    }
  }

  return updated;
}

/**
 * DETERMINISTIC SUBJECT-AWARE GRADE MERGE ALGORITHM
 *
 * Implements DepEd DO 8, s. 2015 incremental academic record update rules:
 * 1. Existing Q1 = 89, incoming Q2 = 92 -> Preserve Q1 = 89, Add Q2 = 92.
 * 2. Existing Q1 = 89, incoming Q1 = 89 -> No change required.
 * 3. Existing verified Q1 = 89, incoming Q1 = 85 -> If verified/approved, preserve 89 & record conflict for reviewer.
 * 4. Existing Q1 = 89, incoming Q2 is blank -> Preserve Q1. Never overwrite with null or zero.
 * 5. Incoming new semester -> Add semester-specific subjects and grades without modifying existing semester.
 * 6. Existing approved record receives new unverified grades -> Preserve approval history, stage in needs_review.
 * 7. Recalculates semester final grades and overall averages automatically.
 */
export function mergeAcademicGrades(params: {
  existingGrades: GradeRecord[];
  incomingGrades: GradeRecord[];
  baseFields?: ExtractedFields;
  isExistingApproved?: boolean;
  defaultSemester?: string;
}): GradeMergeResult {
  const {
    existingGrades = [],
    incomingGrades = [],
    baseFields = {},
    isExistingApproved = false,
    defaultSemester = "1st Semester",
  } = params;

  const mergedList: GradeRecord[] = existingGrades.map((g) => ({ ...g }));
  const addedQuarters: AddedQuarter[] = [];
  const conflicts: GradeQuarterConflict[] = [];
  let hasNewGrades = false;

  const quarters: ("q1" | "q2" | "q3" | "q4")[] = ["q1", "q2", "q3", "q4"];

  for (const inc of incomingGrades) {
    const rawSub = inc.subject || "General Subject";
    const normIncSub = normalizeSubjectName(rawSub);
    const incSem = normalizeSemester(inc.semester || defaultSemester);

    // Look for matching subject in mergedList
    let matchedIdx = -1;
    for (let i = 0; i < mergedList.length; i++) {
      const ex = mergedList[i];
      const normExSub = normalizeSubjectName(ex.subject);
      const exSem = normalizeSemester(ex.semester || defaultSemester);

      if (normExSub === normIncSub && exSem === incSem) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx >= 0) {
      // Existing subject found -> Merge quarterly columns
      const existing = mergedList[matchedIdx];

      for (const q of quarters) {
        const incVal = parseQuarterNumeric(inc[q]);
        const exVal = parseQuarterNumeric(existing[q]);

        if (incVal !== undefined) {
          if (exVal === undefined) {
            // Rule 1: Existing was blank, incoming has value -> ADD NEW QUARTER!
            existing[q] = incVal;
            hasNewGrades = true;
            addedQuarters.push({
              subject: existing.subject,
              semester: incSem,
              quarter: q,
              value: incVal,
            });
          } else if (exVal === incVal) {
            // Rule 2: Identical value -> No change needed
          } else {
            // Value mismatch between existing and incoming!
            if (isExistingApproved) {
              // Rule 3: Do NOT overwrite verified grades automatically!
              // Keep existing verified grade, flag conflict for authorized review
              conflicts.push({
                subject: existing.subject,
                semester: incSem,
                quarter: q,
                existingValue: exVal,
                incomingValue: incVal,
                reason: `Conflicting ${q.toUpperCase()} grade for ${existing.subject}: verified record has ${exVal}, incoming document extracted ${incVal}.`,
              });
            } else {
              // If not yet verified/approved, accept update
              existing[q] = incVal;
              hasNewGrades = true;
            }
          }
        } else {
          // Rule 4: Incoming is blank -> Preserve existing verified grade!
          // Never overwrite existing grade with undefined or zero!
        }
      }

      // Recompute final grade and status for this subject
      mergedList[matchedIdx] = recomputeSubjectFinalAndStatus(existing, incSem);
    } else {
      // Rule 5: New subject (e.g. from a new semester or curriculum addition)
      const cleanNewSub: GradeRecord = recomputeSubjectFinalAndStatus({
        ...inc,
        semester: incSem,
      }, incSem);

      mergedList.push(cleanNewSub);
      hasNewGrades = true;

      for (const q of quarters) {
        const v = parseQuarterNumeric(cleanNewSub[q]);
        if (v !== undefined) {
          addedQuarters.push({
            subject: cleanNewSub.subject,
            semester: incSem,
            quarter: q,
            value: v,
          });
        }
      }
    }
  }

  // Update averages across all merged records
  const updatedFields: ExtractedFields = {
    ...baseFields,
    grades: mergedList,
  };

  const fieldsWithAverages = updateExtractedFieldsAverages(updatedFields);

  const isIdentical = !hasNewGrades && conflicts.length === 0 && incomingGrades.length > 0;

  let summaryMessage = "Grades processed.";
  if (isIdentical) {
    summaryMessage = "Identical document grades detected. No new quarter grades were added.";
  } else if (conflicts.length > 0) {
    summaryMessage = `Merged ${addedQuarters.length} new quarter grade(s) with ${conflicts.length} conflict(s) requiring verification.`;
  } else if (addedQuarters.length > 0) {
    summaryMessage = `Successfully added ${addedQuarters.length} new quarter grade(s) to existing academic record.`;
  }

  return {
    mergedGrades: mergedList,
    mergedFields: fieldsWithAverages,
    hasNewGrades,
    isIdentical,
    addedQuarters,
    conflicts,
    recalculatedAverages: {
      sem1_average: (fieldsWithAverages as any).sem1_general_average,
      sem2_average: (fieldsWithAverages as any).sem2_general_average,
      general_average: fieldsWithAverages.general_average,
    },
    summaryMessage,
  };
}

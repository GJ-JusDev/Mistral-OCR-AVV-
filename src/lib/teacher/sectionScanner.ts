import type { ExtractedFields } from "@/types/documents";
import { mergeSf9FrontAndBack } from "@/lib/validation/sf9Merger";
import {
  normalizeGradeLevelKey,
  normalizeSchoolYearKey,
  normalizeSectionKey,
  normalizeStrandKey,
  type TeacherAssignmentRecord,
} from "./assignments";

export type ContextMismatchType =
  | "SCHOOL_YEAR_MISMATCH"
  | "GRADE_LEVEL_MISMATCH"
  | "SECTION_MISMATCH"
  | "STRAND_MISMATCH";

export interface ContextMismatchItem {
  type: ContextMismatchType;
  expected: string;
  actual: string;
  message: string;
}

export interface AssignmentContextComparisonResult {
  matchesAssignment: boolean;
  mismatches: ContextMismatchItem[];
  flags: string[];
  conflictTypes: Array<
    "SECTION_MISMATCH" | "STRAND_MISMATCH" | "GRADE_LEVEL_MISMATCH"
  >;
}

/**
 * Compares document extracted metadata against the teacher's confirmed assignment context.
 * Discrepancies never silently fail or fork canonical records — they flag for review/quarantine.
 */
export function compareDocumentContextWithAssignment(params: {
  assignment: Pick<
    TeacherAssignmentRecord,
    "school_year" | "grade_level" | "section" | "strand_or_track"
  >;
  documentType: "sf9" | "sf10";
  extractedFields: ExtractedFields | null | undefined;
}): AssignmentContextComparisonResult {
  const { assignment, documentType, extractedFields } = params;
  const mismatches: ContextMismatchItem[] = [];
  const flags: string[] = [];
  const conflictTypes: AssignmentContextComparisonResult["conflictTypes"] = [];

  if (!extractedFields) {
    return { matchesAssignment: true, mismatches, flags, conflictTypes };
  }

  // SF9 is per-SY/per-grade card; SF10 is a multi-year cumulative permanent record
  if (documentType === "sf9" && extractedFields.school_year) {
    const expectedSy = normalizeSchoolYearKey(assignment.school_year);
    const actualSy = normalizeSchoolYearKey(extractedFields.school_year);
    if (expectedSy && actualSy && expectedSy !== actualSy) {
      mismatches.push({
        type: "SCHOOL_YEAR_MISMATCH",
        expected: expectedSy,
        actual: actualSy,
        message: `Extracted school year (${actualSy}) differs from confirmed assignment (${expectedSy}).`,
      });
      flags.push("assignment_school_year_mismatch");
    }
  }

  if (documentType === "sf9" && extractedFields.grade_level) {
    const expectedGrade = normalizeGradeLevelKey(assignment.grade_level);
    const actualGrade = normalizeGradeLevelKey(extractedFields.grade_level);
    if (expectedGrade && actualGrade && expectedGrade !== actualGrade) {
      mismatches.push({
        type: "GRADE_LEVEL_MISMATCH",
        expected: expectedGrade,
        actual: actualGrade,
        message: `Extracted grade level (${actualGrade}) differs from confirmed assignment (${expectedGrade}).`,
      });
      flags.push("assignment_grade_level_mismatch");
      conflictTypes.push("GRADE_LEVEL_MISMATCH");
    }
  }

  if (extractedFields.section) {
    const expectedSec = normalizeSectionKey(assignment.section);
    const actualSec = normalizeSectionKey(extractedFields.section);
    if (expectedSec && actualSec && expectedSec !== actualSec) {
      mismatches.push({
        type: "SECTION_MISMATCH",
        expected: assignment.section,
        actual: extractedFields.section,
        message: `Extracted section ("${extractedFields.section}") does not match assigned section ("${assignment.section}").`,
      });
      flags.push("assignment_section_mismatch");
      conflictTypes.push("SECTION_MISMATCH");
    }
  }

  const extractedStrandRaw =
    extractedFields.strand || extractedFields.track_strand || extractedFields.shs_track;
  if (assignment.strand_or_track && extractedStrandRaw) {
    const expectedStrand = normalizeStrandKey(assignment.strand_or_track);
    const actualStrand = normalizeStrandKey(extractedStrandRaw);
    if (expectedStrand && actualStrand && expectedStrand !== actualStrand) {
      mismatches.push({
        type: "STRAND_MISMATCH",
        expected: expectedStrand,
        actual: actualStrand,
        message: `Extracted strand/track ("${actualStrand}") does not match assigned strand ("${expectedStrand}").`,
      });
      flags.push("assignment_strand_mismatch");
      conflictTypes.push("STRAND_MISMATCH");
    }
  }

  return {
    matchesAssignment: mismatches.length === 0,
    mismatches,
    flags,
    conflictTypes,
  };
}

export interface CrossSideIdentityCheckResult {
  isSameStudent: boolean;
  hasMixedStudentConflict: boolean;
  conflicts: string[];
  warnings: string[];
  mergedFields: ExtractedFields;
}

/**
 * Evaluates two-sided SF9 front + back OCR payloads to catch mixed-student scans
 * before records are saved or linked to a canonical student profile.
 */
export function evaluateTwoSidedSf9Identity(params: {
  frontFields?: ExtractedFields | null;
  backFields?: ExtractedFields | null;
  frontRawText?: string;
  backRawText?: string;
  frontConfidence?: number;
  backConfidence?: number;
}): CrossSideIdentityCheckResult {
  const merged = mergeSf9FrontAndBack(
    {
      fields: params.frontFields || {},
      rawText: params.frontRawText,
      pageNumber: 1,
      confidence: params.frontConfidence,
    },
    {
      fields: params.backFields || {},
      rawText: params.backRawText,
      pageNumber: 2,
      confidence: params.backConfidence,
    }
  );

  const hasMixed = Boolean(merged.hasIdentityConflict || !merged.isSameLearner);
  const existingFlags = Array.isArray(merged.unifiedFields.flags)
    ? [...merged.unifiedFields.flags]
    : [];

  if (hasMixed && !existingFlags.includes("mixed_student_front_back")) {
    existingFlags.push("mixed_student_front_back");
  }

  const unifiedFields: ExtractedFields = {
    ...merged.unifiedFields,
    flags: existingFlags,
    ...(hasMixed
      ? {
          mixed_student_front_back: true,
          identity_conflict: true,
          identity_conflict_details: merged.identityConflicts.join(" | "),
        }
      : {}),
  };

  return {
    isSameStudent: !hasMixed,
    hasMixedStudentConflict: hasMixed,
    conflicts: merged.identityConflicts,
    warnings: merged.warnings,
    mergedFields: unifiedFields,
  };
}

import { isValidLrn, normalizeLrn, NAME_PATTERN } from "./patterns";
import type { ExtractedFields } from "@/types/documents";

export interface StudentMatchEvaluation {
  isValidLrn: boolean;
  isValidName: boolean;
  normalizedLrn: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  suffix: string | null;
  canAutoLink: boolean;
  canAutoCreate: boolean;
  requiresManualReview: boolean;
  reasons: string[];
}

export type IdentityMatrixCase =
  | "SAME_LRN_SAME_NAME"      // Case A: LRN and Name match
  | "SAME_LRN_MINOR_DIFF"     // Case B: Same LRN, minor spelling / middle name difference
  | "SAME_LRN_CONFLICT_NAME"  // Case C: Same LRN, completely different student name (COLLISION)
  | "DIFF_LRN_SAME_NAME"      // Case D: Different LRN, same student name
  | "NEW_LRN_NEW_NAME"        // Case E: New valid LRN & valid name
  | "INVALID_OR_MISSING_LRN"; // Case F: Missing, invalid, or malformed LRN

export interface IdentityMatrixResult {
  matchType: IdentityMatrixCase;
  canAutoLink: boolean;
  canAutoCreate: boolean;
  canAutoMergeGrades: boolean;
  requiresManualReview: boolean;
  studentId?: string;
  flag?: string;
  reason: string;
}

const INVALID_PLACEHOLDERS = new Set([
  "unknown",
  "learner",
  "student",
  "not found",
  "n/a",
  "none",
  "null",
  "undefined",
]);

function isRealName(namePart?: string | null): boolean {
  if (!namePart) return false;
  const trimmed = namePart.trim().toLowerCase();
  if (trimmed.length < 2) return false;
  if (INVALID_PLACEHOLDERS.has(trimmed)) return false;
  return NAME_PATTERN.test(namePart);
}

/**
 * Standardize name strings for comparison:
 * Trims whitespace, removes accents/diacritics, strips punctuation, normalizes uppercase.
 */
export function normalizeNameString(val?: string | null): string {
  if (!val || typeof val !== "string") return "";
  return val
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Standardize generational suffixes (JR, SR, II, III, IV, etc.).
 */
export function normalizeSuffixString(val?: string | null): string {
  if (!val || typeof val !== "string") return "";
  const clean = val.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (["JR", "JNR", "JUNIOR"].includes(clean)) return "JR";
  if (["SR", "SNR", "SENIOR"].includes(clean)) return "SR";
  if (["II", "2", "2ND", "SECOND"].includes(clean)) return "II";
  if (["III", "3", "3RD", "THIRD"].includes(clean)) return "III";
  if (["IV", "4", "4TH", "FOURTH"].includes(clean)) return "IV";
  if (["V", "5", "5TH", "FIFTH"].includes(clean)) return "V";
  return clean;
}

/**
 * Computes Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Evaluates OCR extracted learner fields for safe student matching or creation.
 * Enforces DepEd 12-digit LRN standards and rejects placeholder names.
 */
export function evaluateStudentIdentity(fields: ExtractedFields): StudentMatchEvaluation {
  const reasons: string[] = [];

  // 1. LRN Validation
  const rawLrn = fields.lrn
    ? String(fields.lrn)
    : (fields as any).learner_reference_number
    ? String((fields as any).learner_reference_number)
    : "";
  const normalizedLrn = rawLrn ? normalizeLrn(rawLrn) : null;
  const isLrnValid = Boolean(normalizedLrn && isValidLrn(normalizedLrn));

  if (!isLrnValid) {
    if (!normalizedLrn) {
      reasons.push("LRN is missing.");
    } else {
      reasons.push(`Invalid LRN: "${rawLrn}" is not exactly 12 numeric digits.`);
    }
  }

  // 2. Name Extraction and Validation
  let firstName = fields.first_name?.trim() || null;
  let middleName = fields.middle_name?.trim() || null;
  let lastName = fields.last_name?.trim() || null;
  const suffix = fields.suffix?.trim() || null;

  if ((!firstName || !lastName) && fields.name) {
    const rawName = fields.name.trim();
    if (rawName.includes(",")) {
      const [last, ...rest] = rawName.split(",").map((s) => s.trim());
      lastName = lastName || last;
      const firstParts = rest.join(" ").split(/\s+/);
      firstName = firstName || firstParts[0];
      if (firstParts.length > 1) {
        middleName = middleName || firstParts.slice(1).join(" ");
      }
    } else {
      const parts = rawName.split(/\s+/);
      if (parts.length >= 2) {
        lastName = lastName || parts[0];
        firstName = firstName || parts.slice(1).join(" ");
      }
    }
  }

  const isFirstNameValid = isRealName(firstName);
  const isLastNameValid = isRealName(lastName);
  const isNameValid = isFirstNameValid && isLastNameValid;

  if (!isFirstNameValid) {
    reasons.push(`First name is missing or invalid ("${firstName || 'empty'}").`);
  }
  if (!isLastNameValid) {
    reasons.push(`Last name is missing or invalid ("${lastName || 'empty'}").`);
  }

  const canAutoCreate = isLrnValid && isNameValid;
  const canAutoLink = isLrnValid;
  const requiresManualReview = !canAutoCreate;

  return {
    isValidLrn: isLrnValid,
    isValidName: isNameValid,
    normalizedLrn: isLrnValid ? normalizedLrn : null,
    firstName: isFirstNameValid ? firstName : null,
    middleName,
    lastName: isLastNameValid ? lastName : null,
    suffix,
    canAutoLink,
    canAutoCreate,
    requiresManualReview,
    reasons,
  };
}

/**
 * Checks for LRN identity collision between OCR extracted name and an existing database student.
 * Preserved for backward-compatibility with existing tests while integrating normalized comparison.
 */
export function verifyStudentCollision(
  extractedLastName: string | null,
  existingStudent: { id: string; first_name: string; last_name: string }
): { hasConflict: boolean; reason?: string } {
  if (!extractedLastName) {
    return {
      hasConflict: true,
      reason: `Cannot link to student ${existingStudent.last_name}, ${existingStudent.first_name} without an extracted last name for verification.`,
    };
  }

  const cleanExtracted = normalizeNameString(extractedLastName);
  const cleanExisting = normalizeNameString(existingStudent.last_name);

  // If last names match exactly, or one contains the other, or edit distance <= 1
  const isMatch = cleanExtracted === cleanExisting ||
    cleanExtracted.includes(cleanExisting) ||
    cleanExisting.includes(cleanExtracted) ||
    levenshteinDistance(cleanExtracted, cleanExisting) <= 1;

  if (!isMatch) {
    return {
      hasConflict: true,
      reason: `LRN conflict detected: LRN is registered to "${existingStudent.last_name}, ${existingStudent.first_name}", but document extracted "${extractedLastName}". Manual verification required.`,
    };
  }

  return { hasConflict: false };
}

/**
 * IMPLEMENTS THE MANDATORY 6-WAY STUDENT IDENTITY MATCHING MATRIX
 *
 * A. SAME LRN + SAME NORMALIZED FULL NAME:
 *    - Reuse existing student. Find matching academic record. Merge new grades.
 * B. SAME LRN + MINOR NAME DIFFERENCE:
 *    - Do not create another student. Flag for manual identity verification. Do not auto-apply disputed updates.
 * C. SAME LRN + COMPLETELY DIFFERENT NAME:
 *    - Block automatic merging. Require authorized identity review. Do not create second student with same LRN.
 * D. DIFFERENT LRN + SAME FULL NAME:
 *    - Do not merge automatically. Flag potential OCR or identity discrepancy.
 * E. NEW VALID LRN + NEW FULL NAME:
 *    - Create one canonical student after sufficient identity validation.
 * F. MISSING, INVALID, OR LOW-CONFIDENCE LRN:
 *    - Require manual identity resolution. Do not silently create duplicate canonical students.
 */
export function matchStudentIdentityMatrix(params: {
  extracted: StudentMatchEvaluation;
  existingStudentByLrn?: {
    id: string;
    lrn: string;
    first_name: string;
    middle_name?: string | null;
    last_name: string;
    suffix?: string | null;
  } | null;
  existingStudentByNameDiffLrn?: {
    id: string;
    lrn: string;
    first_name: string;
    last_name: string;
  } | null;
}): IdentityMatrixResult {
  const { extracted, existingStudentByLrn, existingStudentByNameDiffLrn } = params;

  // Case F: MISSING, INVALID, OR MALFORMED LRN
  if (!extracted.isValidLrn || !extracted.normalizedLrn) {
    return {
      matchType: "INVALID_OR_MISSING_LRN",
      canAutoLink: false,
      canAutoCreate: false,
      canAutoMergeGrades: false,
      requiresManualReview: true,
      flag: !extracted.normalizedLrn ? "missing_lrn" : "invalid_lrn",
      reason: extracted.reasons.join(" ") || "Missing or invalid 12-digit LRN. Manual identity resolution required.",
    };
  }

  // If a student with this exact LRN is found in the registry:
  if (existingStudentByLrn) {
    const extLast = normalizeNameString(extracted.lastName);
    const exLast = normalizeNameString(existingStudentByLrn.last_name);
    const extFirst = normalizeNameString(extracted.firstName);
    const exFirst = normalizeNameString(existingStudentByLrn.first_name);

    // If extracted name is completely missing or placeholder
    if (!extracted.isValidName || !extLast || !extFirst) {
      return {
        matchType: "SAME_LRN_MINOR_DIFF",
        canAutoLink: true,
        canAutoCreate: false,
        canAutoMergeGrades: false,
        requiresManualReview: true,
        studentId: existingStudentByLrn.id,
        flag: "identity_verification_required",
        reason: `LRN ${extracted.normalizedLrn} matches ${existingStudentByLrn.last_name}, ${existingStudentByLrn.first_name}, but document name is incomplete. Manual review required.`,
      };
    }

    const lastDist = levenshteinDistance(extLast, exLast);
    const firstDist = levenshteinDistance(extFirst, exFirst);

    // 1. Exact Match / Formatting / Spacing Match
    const isLastNameExact = extLast === exLast;
    const isFirstNameExact = extFirst === exFirst;
    const isFirstNamePrefix = extFirst.startsWith(exFirst) || exFirst.startsWith(extFirst);

    if (isLastNameExact && (isFirstNameExact || isFirstNamePrefix)) {
      // Case A: SAME LRN + SAME NORMALIZED FULL NAME
      return {
        matchType: "SAME_LRN_SAME_NAME",
        canAutoLink: true,
        canAutoCreate: false,
        canAutoMergeGrades: true,
        requiresManualReview: false,
        studentId: existingStudentByLrn.id,
        reason: `Verified canonical match for student ${existingStudentByLrn.last_name}, ${existingStudentByLrn.first_name} (LRN: ${extracted.normalizedLrn}).`,
      };
    }

    // 2. Minor Name Difference:
    // e.g. typo in last name (dist <= 1) while first name matches,
    // or typo in first name (dist <= 2) while last name matches,
    // or middle initial variation
    const isMinorLastNameDiff = lastDist <= 1;
    const isMinorFirstNameDiff = firstDist <= 2;

    if (isMinorLastNameDiff && (isFirstNameExact || isMinorFirstNameDiff)) {
      // Case B: SAME LRN + MINOR NAME DIFFERENCE
      return {
        matchType: "SAME_LRN_MINOR_DIFF",
        canAutoLink: true, // Reuse existing student record: do not create another student!
        canAutoCreate: false,
        canAutoMergeGrades: false, // Disallow automatic merge of grades until human verified
        requiresManualReview: true,
        studentId: existingStudentByLrn.id,
        flag: "name_discrepancy",
        reason: `Same LRN ${extracted.normalizedLrn} with minor name variation between document ("${extracted.lastName}, ${extracted.firstName}") and registry ("${existingStudentByLrn.last_name}, ${existingStudentByLrn.first_name}"). Manual verification required.`,
      };
    }

    // 3. Completely Different Name:
    // Case C: SAME LRN + COMPLETELY DIFFERENT NAME
    // e.g. GOMEZ, JUSTIN vs LATONERO, KENNETH
    return {
      matchType: "SAME_LRN_CONFLICT_NAME",
      canAutoLink: false, // BLOCK AUTOMATIC LINKING: do not pollute the other student!
      canAutoCreate: false,
      canAutoMergeGrades: false,
      requiresManualReview: true,
      studentId: undefined,
      flag: "identity_conflict",
      reason: `LRN conflict detected: LRN ${extracted.normalizedLrn} is registered to "${existingStudentByLrn.last_name}, ${existingStudentByLrn.first_name}", but document extracted "${extracted.lastName}, ${extracted.firstName}". Authorized identity review required.`,
    };
  }

  // If no student exists with this LRN, but another student exists with identical Full Name:
  if (existingStudentByNameDiffLrn) {
    // Case D: DIFFERENT LRN + SAME FULL NAME
    return {
      matchType: "DIFF_LRN_SAME_NAME",
      canAutoLink: false,
      canAutoCreate: false,
      canAutoMergeGrades: false,
      requiresManualReview: true,
      flag: "different_lrn_same_name",
      reason: `Potential identity discrepancy: Document extracted name "${extracted.lastName}, ${extracted.firstName}" matches existing student (LRN ${existingStudentByNameDiffLrn.lrn}), but document specifies different LRN ${extracted.normalizedLrn}. Separate record staging required.`,
    };
  }

  // Case E: NEW VALID LRN + NEW FULL NAME
  if (extracted.canAutoCreate) {
    return {
      matchType: "NEW_LRN_NEW_NAME",
      canAutoLink: true,
      canAutoCreate: true,
      canAutoMergeGrades: true,
      requiresManualReview: false,
      reason: `New verified 12-digit LRN ${extracted.normalizedLrn} and learner identity ("${extracted.lastName}, ${extracted.firstName}"). Ready for canonical registration.`,
    };
  }

  // Fallback to manual resolution
  return {
    matchType: "INVALID_OR_MISSING_LRN",
    canAutoLink: false,
    canAutoCreate: false,
    canAutoMergeGrades: false,
    requiresManualReview: true,
    flag: "identity_verification_required",
    reason: extracted.reasons.join(" ") || "Incomplete learner identity. Manual review required.",
  };
}

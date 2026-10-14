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
 * Evaluates OCR extracted learner fields for safe student matching or creation.
 * Enforces DepEd 12-digit LRN standards and rejects placeholder names.
 */
export function evaluateStudentIdentity(fields: ExtractedFields): StudentMatchEvaluation {
  const reasons: string[] = [];

  // 1. LRN Validation
  const rawLrn = fields.lrn ? String(fields.lrn) : "";
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

  const cleanExtracted = extractedLastName.toLowerCase().replace(/[^a-z]/g, "");
  const cleanExisting = existingStudent.last_name.toLowerCase().replace(/[^a-z]/g, "");

  // If last names do not match and neither is a substring of the other, flag conflict
  const isMatch = cleanExtracted === cleanExisting ||
    cleanExtracted.includes(cleanExisting) ||
    cleanExisting.includes(cleanExtracted);

  if (!isMatch) {
    return {
      hasConflict: true,
      reason: `LRN conflict detected: LRN is registered to "${existingStudent.last_name}, ${existingStudent.first_name}", but document extracted "${extractedLastName}". Manual verification required.`,
    };
  }

  return { hasConflict: false };
}

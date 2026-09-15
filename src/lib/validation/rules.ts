/**
 * Validation rules for school document fields.
 *
 * Each rule targets a specific extracted field and returns whether it passes.
 * Rules are run by the validation engine (engine.ts) against ExtractedFields.
 */

import type { ExtractedFields } from "@/types/documents";
import {
  isValidLrn,
  NAME_PATTERN,
  GRADE_PATTERN,
  looksLikeDate,
  normalizeSex,
} from "./patterns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationContext = {
  /** List of recognized school names (lowercased, stripped). */
  knownSchools: string[];
  /** All extracted fields for cross-field checks. */
  allFields: ExtractedFields;
  /** OCR confidence score 0–1. */
  ocrConfidence: number;
};

export type ValidationRule = {
  /** Machine-readable rule identifier. */
  name: string;
  /** Which extracted field this rule checks. */
  field: keyof ExtractedFields;
  /** Human-readable failure message. */
  message: string;
  /** Severity: 'error' blocks approval, 'warning' flags for review. */
  severity: "error" | "warning";
  /**
   * Return `true` if the field value is acceptable.
   * Receives the field value and an optional context object for cross-checks.
   */
  check: (value: string, context: ValidationContext) => boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPresent(value: string): boolean {
  return Boolean(value) && value !== "Not found" && value.trim().length > 0;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

export const VALIDATION_RULES: ValidationRule[] = [
  // ── Name ──────────────────────────────────────────────────────────────
  {
    name: "name_present",
    field: "name",
    message: "Student name must be present.",
    severity: "error",
    check: (v) => isPresent(v),
  },
  {
    name: "name_valid_chars",
    field: "name",
    message: "Name should contain alphabetic characters.",
    severity: "warning",
    check: (v) => !isPresent(v) || NAME_PATTERN.test(v),
  },

  // ── LRN ───────────────────────────────────────────────────────────────
  {
    name: "lrn_present",
    field: "lrn",
    message: "Learner Reference Number (LRN) is required.",
    severity: "error",
    check: (v) => isPresent(v),
  },
  {
    name: "lrn_format",
    field: "lrn",
    message: "LRN must be exactly 12 digits.",
    severity: "error",
    check: (v) => !isPresent(v) || isValidLrn(v),
  },

  // ── Grade ─────────────────────────────────────────────────────────────
  {
    name: "grade_present",
    field: "grade_level",
    message: "Grade level cannot be blank.",
    severity: "error",
    check: (v) => isPresent(v),
  },
  {
    name: "grade_valid",
    field: "grade_level",
    message: "Grade level format is not recognized (expected Grade 1–12 or Kinder).",
    severity: "warning",
    check: (v) => !isPresent(v) || GRADE_PATTERN.test(v.trim()),
  },

  // ── School ────────────────────────────────────────────────────────────
  {
    name: "school_present",
    field: "school_name",
    message: "School name must be present.",
    severity: "error",
    check: (v) => isPresent(v),
  },
  {
    name: "school_recognized",
    field: "school_name",
    message: "School is not in the recognized list.",
    severity: "warning",
    check: (v, ctx) => {
      // If no known schools loaded, skip this check (pass by default).
      if (ctx.knownSchools.length === 0) return true;
      return ctx.knownSchools.includes(normalize(v));
    },
  },

  // ── Date of birth ─────────────────────────────────────────────────────
  {
    name: "birth_date_present",
    field: "birth_date",
    message: "Date of birth should be provided.",
    severity: "warning",
    check: (v) => isPresent(v),
  },
  {
    name: "birth_date_valid",
    field: "birth_date",
    message: "Date of birth does not look like a valid date.",
    severity: "warning",
    check: (v) => !isPresent(v) || looksLikeDate(v),
  },

  // ── Sex ───────────────────────────────────────────────────────────────
  {
    name: "sex_valid",
    field: "sex",
    message: "Sex should be M or F.",
    severity: "warning",
    check: (v) => !isPresent(v) || normalizeSex(v) !== "",
  },

  // ── OCR confidence ────────────────────────────────────────────────────
  {
    name: "ocr_confidence",
    field: "name", // Applies globally but needs a field; use name as anchor.
    message: "OCR confidence is low — manual review recommended.",
    severity: "warning",
    check: (_v, ctx) => ctx.ocrConfidence >= 0.6,
  },
];

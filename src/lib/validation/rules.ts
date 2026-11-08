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
  SHS_GRADE_PATTERN,
  GRADE_PATTERN,
  looksLikeDate,
  normalizeSex,
  isValidSchoolYear,
  SCHOOL_ID_PATTERN,
} from "./patterns";

import type { ValidationContext, ValidationRule } from "@/types/validation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPresent(value: string): boolean {
  return Boolean(value) && value !== "Not found" && value.trim().length > 0;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPsaBirthCertificate(ctx?: ValidationContext): boolean {
  const docType = String(ctx?.allFields?.document_type || "").toLowerCase().trim();
  return (
    docType === "birth_cert" ||
    docType === "psa" ||
    docType === "psa_birth_certificate" ||
    Boolean((ctx?.allFields as any)?.registry_number)
  );
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
    check: (v, ctx) => isPsaBirthCertificate(ctx) || isPresent(v),
  },
  {
    name: "lrn_format",
    field: "lrn",
    message: "LRN must be exactly 12 digits.",
    severity: "error",
    check: (v, ctx) => isPsaBirthCertificate(ctx) || !isPresent(v) || isValidLrn(v),
  },

  // ── Grade ─────────────────────────────────────────────────────────────
  {
    name: "grade_present",
    field: "grade_level",
    message: "Grade level cannot be blank.",
    severity: "error",
    check: (v, ctx) => isPsaBirthCertificate(ctx) || isPresent(v),
  },
  {
    name: "grade_valid",
    field: "grade_level",
    message: "Grade level format is not recognized or outside Senior High School scope (expected Grade 11 or Grade 12).",
    severity: "warning",
    check: (v, ctx) => {
      if (isPsaBirthCertificate(ctx)) return true;
      if (!isPresent(v)) return true;
      const isShs =
        ctx?.allFields?.academic_level === "Senior High School" ||
        ctx?.allFields?.selected_grade_level === "Grade 11" ||
        ctx?.allFields?.selected_grade_level === "Grade 12";
      if (isShs) {
        return SHS_GRADE_PATTERN.test(v.trim());
      }
      return GRADE_PATTERN.test(v.trim());
    },
  },

  // ── School ────────────────────────────────────────────────────────────
  {
    name: "school_present",
    field: "school_name",
    message: (_v, ctx) => {
      const isUnextracted =
        ctx.allFields.flags?.includes("school_name_unextracted") ||
        (ctx.allFields as any).school_name_unextracted === true;
      if (isUnextracted) {
        return "School name could not be reliably extracted. Verify against the original SF9.";
      }
      return "School name must be present.";
    },
    severity: (_v, ctx) => {
      const isUnextracted =
        ctx.allFields.flags?.includes("school_name_unextracted") ||
        (ctx.allFields as any).school_name_unextracted === true;
      return isUnextracted ? "warning" : "error";
    },
    check: (v, ctx) => isPsaBirthCertificate(ctx) || isPresent(v),
  },
  {
    name: "school_recognized",
    field: "school_name",
    message: "School is not in the recognized list.",
    severity: "warning",
    check: (v, ctx) => {
      if (isPsaBirthCertificate(ctx)) return true;
      // If no known schools loaded, skip this check (pass by default).
      if (ctx.knownSchools.length === 0) return true;
      if (!isPresent(v)) return true;
      const norm = normalize(v);
      const normWithoutDeped = normalize(v.replace(/^deped\s+/i, ""));
      const normalizedKnown = ctx.knownSchools.map((s) => normalize(s));
      return normalizedKnown.includes(norm) || normalizedKnown.includes(normWithoutDeped);
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

  // ── School Year ───────────────────────────────────────────────────────
  {
    name: "school_year_present",
    field: "school_year",
    message: "School year is missing. Required for DepEd academic progression records.",
    severity: "warning",
    check: (v, ctx) => isPsaBirthCertificate(ctx) || isPresent(v),
  },
  {
    name: "school_year_valid",
    field: "school_year",
    message: "School year must be in consecutive YYYY-YYYY format (e.g. 2023-2024).",
    severity: "warning",
    check: (v, ctx) => isPsaBirthCertificate(ctx) || !isPresent(v) || isValidSchoolYear(v),
  },

  // ── School ID ─────────────────────────────────────────────────────────
  {
    name: "school_id_present",
    field: "school_id",
    message: (_v, ctx) => {
      const isExplicitlyMissing =
        ctx.allFields.flags?.includes("missing_school_id") ||
        (ctx.allFields as any).school_id_missing === true;
      if (isExplicitlyMissing) {
        return "DepEd School ID must be present.";
      }
      return "DepEd School ID could not be reliably extracted. Verify against the original SF9.";
    },
    severity: (_v, ctx) => {
      const isExplicitlyMissing =
        ctx.allFields.flags?.includes("missing_school_id") ||
        (ctx.allFields as any).school_id_missing === true;
      return isExplicitlyMissing ? "error" : "warning";
    },
    check: (v, ctx) => isPsaBirthCertificate(ctx) || isPresent(v),
  },
  {
    name: "school_id_match_institution",
    field: "school_id",
    message: "Document school identity conflicts with authorized institutional configuration (TRIS — 300792).",
    severity: "error",
    check: (v, ctx) => {
      if (isPsaBirthCertificate(ctx)) return true;
      const flags = ctx?.allFields?.flags;
      if (Array.isArray(flags) && flags.includes("school_id_discrepancy")) {
        return false;
      }
      const ocrId = (ctx?.allFields as any)?.ocr_extracted_school_id;
      if (ocrId && isPresent(ocrId) && isPresent(v) && ocrId.trim() !== v.trim()) {
        return false;
      }
      return true;
    },
  },
  {
    name: "school_id_format",
    field: "school_id",
    message: (v) =>
      isPresent(v) && SCHOOL_ID_PATTERN.test(v.trim())
        ? "DepEd School ID is a valid 6-digit number."
        : "DepEd School ID must be a 6-digit number.",
    severity: "error",
    check: (v, ctx) => isPsaBirthCertificate(ctx) || !isPresent(v) || SCHOOL_ID_PATTERN.test(v.trim()),
  },

  // ── Class Adviser ─────────────────────────────────────────────────────
  {
    name: "adviser_present",
    field: "adviser",
    message: (_v, ctx) => {
      const isUnextracted =
        ctx.allFields.flags?.includes("adviser_unextracted") ||
        (ctx.allFields as any).adviser_unextracted === true;
      if (isUnextracted) {
        return "Adviser name could not be reliably extracted. Verify against the original SF9.";
      }
      return "Class adviser name should be recorded.";
    },
    severity: "warning",
    check: (v, ctx) => isPsaBirthCertificate(ctx) || isPresent(v),
  },

  // ── OCR confidence ────────────────────────────────────────────────────
  {
    name: "ocr_confidence",
    field: "name", // Applies globally but needs a field; use name as anchor.
    message: "OCR confidence is unmeasured or below required threshold — manual review recommended.",
    severity: "warning",
    check: (_v, ctx) => typeof ctx.ocrConfidence === "number" && ctx.ocrConfidence >= 0.6,
  },
];

import type { ValidationRule, ValidationContext } from "@/types/validation";
import {
  NAME_PATTERN,
  SCHOOL_ID_PATTERN,
  looksLikeDate,
  isValidLrn,
  normalizeSex,
  isValidSchoolYear,
} from "./patterns";
import { matchSchool } from "./schoolMatcher";

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

export const VALIDATION_RULES: ValidationRule[] = [
  // ── Document Type Support ─────────────────────────────────────────────
  {
    name: "supported_document_type",
    field: "document_type",
    message: "PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document.",
    severity: "error",
    check: (_v, ctx) => {
      const docType = String(ctx?.allFields?.document_type || "").toLowerCase().trim();
      return docType !== "birth_cert" && docType !== "psa" && docType !== "psa_birth_certificate";
    },
  },

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
    message: "Grade level format is not recognized or outside Senior High School scope (expected Grade 11 or Grade 12).",
    severity: "warning",
    check: (v, ctx) => {
      if (!isPresent(v)) return true;
      const isShs =
        ctx?.allFields?.academic_level === "Senior High School" ||
        ctx?.allFields?.selected_grade_level === "Grade 11" ||
        ctx?.allFields?.selected_grade_level === "Grade 12";
      if (!isShs) return true;
      const clean = String(v).replace(/\s+/g, " ").trim().toLowerCase();
      return (
        clean.includes("11") ||
        clean.includes("12") ||
        clean.includes("grade 11") ||
        clean.includes("grade 12") ||
        clean.includes("eleven") ||
        clean.includes("twelve") ||
        clean.includes("senior high") ||
        clean.includes("shs")
      );
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
    check: (v) => isPresent(v),
  },
  {
    name: "school_recognized",
    field: "school_name",
    message: "School is not in the recognized list.",
    severity: "warning",
    check: (v, ctx) => {
      // If no known schools loaded, skip this check (pass by default).
      if (!ctx.knownSchools || ctx.knownSchools.length === 0) return true;
      if (!isPresent(v)) return true;
      const match = matchSchool(v, ctx.knownSchools, (ctx as any).schoolAliases);
      return match.matched;
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
    check: (v) => isPresent(v),
  },
  {
    name: "school_year_valid",
    field: "school_year",
    message: "School year must be in consecutive YYYY-YYYY format (e.g. 2023-2024).",
    severity: "warning",
    check: (v) => !isPresent(v) || isValidSchoolYear(v),
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
    check: (v) => isPresent(v),
  },
  {
    name: "school_id_match_institution",
    field: "school_id",
    message: "Document school identity conflicts with authorized institutional configuration (TRIS — 500169).",
    severity: "error",
    check: (v, ctx) => {
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
    check: (v) => !isPresent(v) || SCHOOL_ID_PATTERN.test(v.trim()),
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
    check: (v) => isPresent(v),
  },

  // ── OCR confidence ────────────────────────────────────────────────────
  {
    name: "ocr_confidence",
    field: "name", // Applies globally but needs a field; use name as anchor.
    message: "OCR confidence is unmeasured or below required threshold — manual review recommended.",
    severity: "warning",
    check: (_v, ctx) => typeof ctx.ocrConfidence === "number" && ctx.ocrConfidence >= 0.6,
  },

  // ── Grade Calculation Discrepancy ─────────────────────────────────────
  {
    name: "grade_calculation_discrepancy",
    field: "grades",
    message: (_v, ctx) => {
      const grades = ctx.allFields.grades || [];
      const discrepant = grades.filter((g) => g.has_calculation_discrepancy);
      if (discrepant.length > 0) {
        const details = discrepant
          .slice(0, 3)
          .map((g) => `${g.subject} (Printed: ${g.final}, Computed: ${g.computed_final_grade})`)
          .join("; ");
        return `Grade calculation discrepancy detected: ${details}${discrepant.length > 3 ? ` (+${discrepant.length - 3} more)` : ""}. Verification required.`;
      }
      return "Grade calculation discrepancy detected: computed quarter average differs from printed final grade.";
    },
    severity: "warning",
    check: (_v, ctx) => {
      const grades = ctx.allFields.grades;
      if (!Array.isArray(grades) || grades.length === 0) return true;
      return !grades.some((g) => g.has_calculation_discrepancy === true);
    },
  },
];

export interface ValidationRuleOutput {
  rule_id: string;
  status: "PASS" | "FAIL";
  severity: string;
  message: string;
}

export function validateDocument(fields: any): ValidationRuleOutput[] {
  return VALIDATION_RULES.map((rule) => {
    const value = fields?.[rule.field] ?? "";
    const ctx = { allFields: fields || {}, knownSchools: [] };
    const passed = rule.check(value, ctx);
    const message = typeof rule.message === "function" ? rule.message(value, ctx) : rule.message;
    const severity = typeof rule.severity === "function" ? rule.severity(value, ctx) : rule.severity;
    return {
      rule_id: rule.name,
      status: passed ? "PASS" : "FAIL",
      severity: String(severity).toUpperCase(),
      message,
    };
  });
}


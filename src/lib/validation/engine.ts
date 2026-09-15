/**
 * Validation engine — runs all rules against extracted document fields and
 * produces a ValidationReport summarizing the outcome.
 */

import type { ExtractedFields } from "@/types/documents";
import { VALIDATION_RULES, type ValidationContext, type ValidationRule } from "./rules";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationRuleResult = {
  ruleName: string;
  fieldName: string;
  passed: boolean;
  expectedValue?: string;
  actualValue: string;
  message: string;
  severity: "error" | "warning";
};

export type ValidationReport = {
  /** Overall status derived from rule results. */
  status: "valid" | "needs_review" | "invalid";
  /** Individual rule results. */
  results: ValidationRuleResult[];
  /** Count of rules that passed. */
  passCount: number;
  /** Count of rules that failed. */
  failCount: number;
  /** Total rules evaluated. */
  totalRules: number;
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Run all validation rules against the given extracted fields.
 *
 * @param fields     - The extracted fields from OCR.
 * @param context    - Additional context (known schools, OCR confidence).
 * @param rules      - Override the default rules if needed (for testing).
 * @returns A ValidationReport with individual results and an overall status.
 */
export function validateFields(
  fields: ExtractedFields,
  context: Partial<ValidationContext> = {},
  rules: ValidationRule[] = VALIDATION_RULES
): ValidationReport {
  const fullContext: ValidationContext = {
    knownSchools: context.knownSchools ?? [],
    allFields: fields,
    ocrConfidence: context.ocrConfidence ?? 1.0,
  };

  const results: ValidationRuleResult[] = rules.map((rule) => {
    const value = fields[rule.field] ?? "";
    const passed = rule.check(value, fullContext);

    return {
      ruleName: rule.name,
      fieldName: rule.field,
      passed,
      actualValue: value,
      message: rule.message,
      severity: rule.severity,
    };
  });

  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.filter((r) => !r.passed).length;

  // Determine overall status:
  //   - If any "error"-severity rule fails → invalid
  //   - If only "warning"-severity rules fail → needs_review
  //   - If everything passes → valid
  const hasErrorFailure = results.some((r) => !r.passed && r.severity === "error");
  const hasWarningFailure = results.some((r) => !r.passed && r.severity === "warning");

  let status: ValidationReport["status"];
  if (hasErrorFailure) {
    status = "invalid";
  } else if (hasWarningFailure) {
    status = "needs_review";
  } else {
    status = "valid";
  }

  return {
    status,
    results,
    passCount,
    failCount,
    totalRules: results.length,
  };
}

/**
 * Convenience: validate and return just the status string.
 */
export function getValidationStatus(
  fields: ExtractedFields,
  context?: Partial<ValidationContext>
): ValidationReport["status"] {
  return validateFields(fields, context).status;
}

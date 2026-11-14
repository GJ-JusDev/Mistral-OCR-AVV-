/**
 * Validation engine — runs all rules against extracted document fields and
 * produces a ValidationReport summarizing the outcome.
 */

import type { ExtractedFields } from "@/types/documents";
import { VALIDATION_RULES } from "./rules";
import type { ValidationReport, ValidationRuleResult, ValidationContext, ValidationRule } from "@/types/validation";

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * DOCUMENT VALIDATION ENGINE
 *
 * Dito dumadaan ang lahat ng na-extract na data mula sa OCR para i-check laban sa DepEd rules.
 *
 * Bakit ito mahalaga sa Capstone Defense:
 * Hindi sapat na nabasa lang ng OCR ang dokumento; kailangang patunayan ng system na
 * sumusunod ang data sa DepEd standards (12-digit LRN, valid School ID, valid grades, etc.).
 *
 * Status Decision Logic:
 * 1. "invalid" - kapag may bumagsak na rule na may "error" severity (hal. mali ang format ng LRN).
 * 2. "needs_review" - kapag walang hard error pero may "warning" (hal. mababang OCR confidence,
 *    o borderline grade 72-77 na kailangan suriin ng Teacher).
 * 3. "valid" - kapag 100% pumasa ang lahat ng rules.
 */
export function validateFields(
  fields: ExtractedFields,
  context: Partial<ValidationContext> = {},
  rules: ValidationRule[] = VALIDATION_RULES
): ValidationReport {
  const fullContext: ValidationContext = {
    knownSchools: context.knownSchools ?? [],
    allFields: fields,
    ocrConfidence: context.ocrConfidence !== undefined ? context.ocrConfidence : undefined,
    schoolAliases: context.schoolAliases,
  };

  // I-execute ang bawat validation rule laban sa kaukulang field
  const results: ValidationRuleResult[] = rules.map((rule) => {
    const value = fields[rule.field] ?? "";
    const passed = rule.check(value, fullContext);
    const message =
      typeof rule.message === "function"
        ? rule.message(value, fullContext)
        : rule.message;
    const severity =
      typeof rule.severity === "function"
        ? rule.severity(value, fullContext)
        : rule.severity;

    return {
      ruleName: rule.name,
      fieldName: rule.field,
      passed,
      actualValue: value,
      message,
      severity,
    };
  });

  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.filter((r) => !r.passed).length;

  // Pag-evaluate ng Overall Document Status:
  // - Kapag may kahit isang "error" rule na nag-fail -> invalid agad (hindi pwede i-auto approve)
  // - Kapag puro "warning" lang ang nag-fail -> needs_review (ipapakita sa teacher sa review queue)
  // - Kapag pasado lahat -> valid
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

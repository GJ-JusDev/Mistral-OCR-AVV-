import type { ValidationRuleResult } from "@/types/validation";

export interface NormalizedValidationItem {
  ruleName: string;
  fieldName: string;
  passed: boolean;
  actualValue: any;
  message: string;
  severity: "error" | "warning";
}

/**
 * Defensively normalizes validation result items from all sources:
 * - In-memory engine results (camelCase: ruleName, fieldName, actualValue)
 * - Persisted database rows (snake_case: rule_name, field_name, actual_value)
 * - Legacy mock objects (ruleId, name, field)
 * - Missing/undefined metadata
 */
export function normalizeValidationItem(item: ValidationRuleResult | Record<string, any>): NormalizedValidationItem {
  const ruleName =
    typeof item?.ruleName === "string"
      ? item.ruleName
      : typeof item?.rule_name === "string"
      ? item.rule_name
      : typeof item?.name === "string"
      ? item.name
      : typeof item?.ruleId === "string"
      ? item.ruleId
      : "";

  const fieldName =
    typeof item?.fieldName === "string"
      ? item.fieldName
      : typeof item?.field_name === "string"
      ? item.field_name
      : typeof item?.field === "string"
      ? item.field
      : "";

  const actualValue =
    item?.actualValue !== undefined
      ? item.actualValue
      : item?.actual_value !== undefined
      ? item.actual_value
      : "";

  const passed = Boolean(item?.passed);

  const message =
    typeof item?.message === "string" && item.message.trim().length > 0
      ? item.message
      : ruleName
      ? ruleName.replace(/_/g, " ")
      : "Validation check";

  let severity: "error" | "warning" = "error";
  if (item?.severity === "warning" || item?.severity === "error") {
    severity = item.severity;
  } else if (ruleName) {
    if (
      ruleName.endsWith("_present") &&
      (ruleName.startsWith("school_id") ||
        ruleName.startsWith("school_name") ||
        ruleName.startsWith("school_") ||
        ruleName.startsWith("adviser") ||
        ruleName.startsWith("birth_date") ||
        ruleName.startsWith("school_year"))
    ) {
      severity = "warning";
    } else if (
      ruleName === "school_recognized" ||
      ruleName === "ocr_confidence" ||
      ruleName === "grade_valid" ||
      ruleName === "name_valid_chars" ||
      ruleName === "school_year_valid" ||
      ruleName === "birth_date_valid" ||
      ruleName === "sex_valid"
    ) {
      severity = "warning";
    }
  }

  return {
    ruleName,
    fieldName,
    passed,
    actualValue,
    message,
    severity,
  };
}

/**
 * Filter results to avoid displaying misleading green "format pass" checkmarks
 * when the underlying field value was unextracted or empty.
 */
export function filterValidationResults(
  results: (ValidationRuleResult | Record<string, any>)[]
): NormalizedValidationItem[] {
  if (!Array.isArray(results)) return [];

  const normalized = results.map(normalizeValidationItem);

  return normalized.filter((result) => {
    if (result.passed) {
      const isPresenceRule = result.ruleName.endsWith("_present");
      const isConfidenceRule = result.ruleName === "ocr_confidence";

      if (!isPresenceRule && !isConfidenceRule) {
        const val = result.actualValue;
        const isValPresent = Boolean(val && String(val).trim() && String(val) !== "Not found");
        if (!isValPresent) {
          return false;
        }
      }
    }
    return true;
  });
}

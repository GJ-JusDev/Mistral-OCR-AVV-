/**
 * AVV System — Senior High School SF9 Observed Values & Grade Validator
 *
 * Enforces strict DepEd non-numerical ratings (AO, SO, RO, NO) with visual homoglyph snapping.
 * Digits (0-9) and non-standard codes are strictly prohibited from entering the database
 * or triggering spurious validation discrepancies.
 */

import {
  normalizeObservedValueMarking,
  sanitizeLearnersObservedValues,
  type DepEdObservedValueCode,
} from "./gradeUtils";
import type { ExtractedFields, LearnersObservedValues } from "@/types/documents";

export {
  normalizeObservedValueMarking,
  sanitizeLearnersObservedValues,
  type DepEdObservedValueCode,
};

export interface Sf9ObservedValuesValidationResult {
  isValid: boolean;
  hasUnreadableMarks: boolean;
  unreadableCount: number;
  normalizedCount: number;
  invalidEntries: Array<{
    quarter: string;
    statement: string;
    originalMark: string;
  }>;
}

/**
 * Validates and deeply sanitizes SF9 Observed Values within an ExtractedFields object.
 */
export function validateShsSf9ObservedValues(
  fields: ExtractedFields | Record<string, any>
): Sf9ObservedValuesValidationResult {
  const result: Sf9ObservedValuesValidationResult = {
    isValid: true,
    hasUnreadableMarks: false,
    unreadableCount: 0,
    normalizedCount: 0,
    invalidEntries: [],
  };

  if (!fields || !fields.observed_values) {
    return result;
  }

  // Sanitize in-place
  fields.observed_values = sanitizeLearnersObservedValues(fields.observed_values);
  const ov = fields.observed_values as LearnersObservedValues;

  if (Array.isArray(ov.observations)) {
    for (const o of ov.observations) {
      if (o.normalized_rating) {
        result.normalizedCount++;
      } else if (o.needs_verification) {
        result.hasUnreadableMarks = true;
        result.unreadableCount++;
        result.invalidEntries.push({
          quarter: o.quarter,
          statement: o.behavior_statement,
          originalMark: o.original_mark,
        });
      }
    }
  }

  return result;
}

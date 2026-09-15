/**
 * Regex patterns and constants for validating school document fields.
 */

/** LRN (Learner Reference Number) must be exactly 12 digits. */
export const LRN_PATTERN = /^\d{12}$/;

/** Loose LRN pattern that allows spaces/dashes between digit groups. */
export const LRN_LOOSE_PATTERN = /^\d[\d\s\-]{10,14}\d$/;

/** Name must contain at least 2 alphabetic characters. */
export const NAME_PATTERN = /[a-zA-ZÀ-ÿñÑ]{2,}/;

/** Grade level patterns (Grade 1–12, Kinder, K–12 variants). */
export const GRADE_PATTERN = /^(?:Grade\s*)?(?:1[0-2]|[1-9]|K(?:inder(?:garten)?)?|I{1,3}|IV|V|VI{0,3}|IX|X|XI{0,2})$/i;

/** Date patterns: M/D/YYYY, YYYY-MM-DD, Month D YYYY, D Month YYYY. */
export const DATE_PATTERNS = [
  /\d{1,2}\/\d{1,2}\/\d{2,4}/,           // M/D/YYYY or MM/DD/YYYY
  /\d{4}-\d{2}-\d{2}/,                     // YYYY-MM-DD
  /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i,
  /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i,
];

/** Sex field must be M or F (case-insensitive, also accepts Male/Female). */
export const SEX_PATTERN = /^(?:M(?:ale)?|F(?:emale)?)$/i;

/** School ID (DepEd) pattern: typically 6 digits. */
export const SCHOOL_ID_PATTERN = /^\d{6}$/;

/**
 * Normalize an LRN string by stripping spaces and dashes, keeping only digits.
 */
export function normalizeLrn(raw: string): string {
  return raw.replace(/[\s\-]/g, "");
}

/**
 * Check if a raw LRN string (possibly with spaces/dashes) is valid.
 */
export function isValidLrn(raw: string): boolean {
  return LRN_PATTERN.test(normalizeLrn(raw));
}

/**
 * Check if a value looks like a valid date string.
 */
export function looksLikeDate(value: string): boolean {
  return DATE_PATTERNS.some((p) => p.test(value.trim()));
}

/**
 * Normalize sex value to single letter M or F.
 */
export function normalizeSex(raw: string): "M" | "F" | "" {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "M" || trimmed === "MALE") return "M";
  if (trimmed === "F" || trimmed === "FEMALE") return "F";
  return "";
}

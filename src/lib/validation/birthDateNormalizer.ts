/**
 * AVV System — Universal Birthdate Normalizer
 *
 * Reconciles the different birth date notations used across the governing
 * Senior High School documents so they can be compared field-for-field:
 *
 *   SF10-SHS (Learner's Information) : "06/23/2004"        (MM/DD/YYYY)
 *   SF1-SHS  (School Register)        : "6/23/04"           (M/D/YY)
 *   PSA Birth Certificate             : "June 23, 2004", "23 June 2004",
 *                                       "JUN 23, 2004", or split
 *                                       Month / Day / Year boxes
 *
 * Every value is normalized to:
 *   - canonical ISO  : "2004-06-23"
 *   - display        : "06/23/2004 (June 23, 2004)"
 *
 * Numeric months 01..12 (and 1..9) map bidirectionally to full month names
 * (January..December) and abbreviations (Jan..Dec).
 */

export const MONTH_FULL_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type MonthFullName = (typeof MONTH_FULL_NAMES)[number];
export type MonthAbbreviation = (typeof MONTH_ABBREVIATIONS)[number];

/** Alternate spellings (English variants, Filipino month names, OCR forms). */
const MONTH_ALIASES: Record<string, number> = {
  sept: 9,
  enero: 1,
  pebrero: 2,
  marso: 3,
  abril: 4,
  mayo: 5,
  hunyo: 6,
  hulyo: 7,
  agosto: 8,
  setyembre: 9,
  septiyembre: 9,
  oktubre: 10,
  nobyembre: 11,
  disyembre: 12,
};

export interface NormalizedBirthDate {
  /** Canonical ISO value, e.g. "2004-06-23". */
  iso: string;
  /** Numeric DepEd notation, e.g. "06/23/2004". */
  numeric: string;
  /** Long textual notation, e.g. "June 23, 2004". */
  textual: string;
  /** Combined display, e.g. "06/23/2004 (June 23, 2004)". */
  display: string;
  year: number;
  month: number;
  day: number;
  monthName: MonthFullName;
  monthAbbr: MonthAbbreviation;
  /** Canonical YYYY/MM/DD notation, e.g. "2004/06/23". */
  slashYyyyMmDd: string;
  /** The original raw value that was parsed. */
  raw: string;
}

export interface SplitBirthDateFields {
  month?: string | number | null;
  day?: string | number | null;
  year?: string | number | null;
}

// ---------------------------------------------------------------------------
// Month mapping (bidirectional)
// ---------------------------------------------------------------------------

/**
 * Convert a month token ("06", "6", "June", "JUN", "Jun.", "Sept", "Hunyo")
 * to its 1-based month number. Returns null if unrecognized.
 */
export function monthToNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 1 && raw <= 12 ? raw : null;
  }
  const cleaned = String(raw).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!cleaned) return null;

  if (/^\d{1,2}$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    return n >= 1 && n <= 12 ? n : null;
  }

  if (MONTH_ALIASES[cleaned] !== undefined) return MONTH_ALIASES[cleaned];

  for (let i = 0; i < 12; i++) {
    const full = MONTH_FULL_NAMES[i].toLowerCase();
    const abbr = MONTH_ABBREVIATIONS[i].toLowerCase();
    if (cleaned === full || cleaned === abbr) return i + 1;
  }
  // Prefix matching for OCR-truncated names ("Septem", "Decemb"), min 3 chars.
  if (cleaned.length >= 3) {
    for (let i = 0; i < 12; i++) {
      const full = MONTH_FULL_NAMES[i].toLowerCase();
      if (full.startsWith(cleaned) || (cleaned.startsWith(full) && cleaned.length <= full.length + 1)) {
        return i + 1;
      }
    }
  }
  return null;
}

/** 6 -> "June", "06" -> "June", "Jun" -> "June". */
export function monthToFullName(raw: string | number | null | undefined): MonthFullName | "" {
  const n = monthToNumber(raw);
  return n ? MONTH_FULL_NAMES[n - 1] : "";
}

/** 6 -> "Jun", "06" -> "Jun", "June" -> "Jun". */
export function monthToAbbreviation(raw: string | number | null | undefined): MonthAbbreviation | "" {
  const n = monthToNumber(raw);
  return n ? MONTH_ABBREVIATIONS[n - 1] : "";
}

/** "June" -> "06", "jun" -> "06", 6 -> "06". */
export function monthToPaddedNumber(raw: string | number | null | undefined): string {
  const n = monthToNumber(raw);
  return n ? String(n).padStart(2, "0") : "";
}

function isMonthWord(token: string): boolean {
  return /[a-z]/i.test(token) && monthToNumber(token) !== null;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Expand a 2-digit year using a birth-date pivot (never in the future). */
function expandYear(raw: string): number | null {
  if (!/^\d{2}$|^\d{4}$/.test(raw)) return null;
  if (raw.length === 4) return parseInt(raw, 10);
  const yy = parseInt(raw, 10);
  const currentYY = new Date().getUTCFullYear() % 100;
  return yy <= currentYY ? 2000 + yy : 1900 + yy;
}

function build(year: number | null, month: number | null, day: number | null, raw: string): NormalizedBirthDate | null {
  if (!year || !month || !day) return null;
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const monthName = MONTH_FULL_NAMES[month - 1];
  const numeric = `${mm}/${dd}/${year}`;
  const textual = `${monthName} ${day}, ${year}`;
  const slashYyyyMmDd = `${year}/${mm}/${dd}`;
  return {
    iso: `${year}-${mm}-${dd}`,
    numeric,
    textual,
    display: `${numeric} (${textual})`,
    year,
    month,
    day,
    monthName,
    monthAbbr: MONTH_ABBREVIATIONS[month - 1],
    slashYyyyMmDd,
    raw,
  };
}

/** Strip labels such as "Date of Birth (MM/DD/YYYY):", "Month", "(Day)". */
function stripLabels(raw: string): string {
  return raw
    .replace(/\(\s*(?:mm|m)\s*\/\s*(?:dd|d)\s*\/\s*(?:yyyy|yy)\s*\)/gi, " ")
    .replace(/\b(?:date\s+of\s+birth|birth\s*date|birthdate|birthday|date\s+born|kapanganakan|petsa\s+ng\s+kapanganakan|dob)\b/gi, " ")
    .replace(/\b(?:month|buwan|day|araw|year|taon)\b/gi, " ")
    .replace(/[|*_`]+/g, " ")
    .replace(/[:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize split PSA Month / Day / Year boxes.
 */
export function normalizeSplitBirthDate(fields: SplitBirthDateFields): NormalizedBirthDate | null {
  const month = monthToNumber(fields.month as any);
  const day = fields.day !== null && fields.day !== undefined ? parseInt(String(fields.day).replace(/\D/g, ""), 10) : NaN;
  const yearStr = fields.year !== null && fields.year !== undefined ? String(fields.year).replace(/\D/g, "") : "";
  const year = expandYear(yearStr);
  const raw = [fields.month, fields.day, fields.year].filter((v) => v !== null && v !== undefined).join(" / ");
  return build(year, month, isNaN(day) ? null : day, raw);
}

/**
 * Parse any supported birth date notation into a normalized record.
 * Returns null when the value cannot be confidently interpreted (never guesses).
 */
export function normalizeBirthDate(
  input: string | SplitBirthDateFields | null | undefined
): NormalizedBirthDate | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "object") return normalizeSplitBirthDate(input);
  if (typeof input !== "string") return null;

  const raw = input;
  const text = stripLabels(raw);
  if (!text) return null;

  // 1. ISO: YYYY-MM-DD / YYYY/MM/DD (optionally with time component)
  let m = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) {
    return build(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), raw);
  }

  // 2. Numeric DepEd: MM/DD/YYYY (SF10), M/D/YY (SF1). Also accepts "-" and "." separators.
  m = text.match(/\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4}|\d{2})\b/);
  if (m) {
    let a = parseInt(m[1], 10);
    let b = parseInt(m[2], 10);
    const year = expandYear(m[3]);
    // DepEd forms use MM/DD. Only swap when the first part cannot be a month.
    if (a > 12 && b <= 12) {
      const t = a;
      a = b;
      b = t;
    }
    return build(year, a, b, raw);
  }

  // 3. Textual / split boxes: tokenize and classify.
  const tokens = text
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1")
    .split(/[\s,/.\-]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const monthIdx = tokens.findIndex(isMonthWord);
  if (monthIdx >= 0) {
    const month = monthToNumber(tokens[monthIdx]);
    const numbers = tokens.filter((t, i) => i !== monthIdx && /^\d{1,4}$/.test(t));
    const yearTok = numbers.find((t) => t.length === 4) ?? (numbers.length >= 2 ? numbers.find((t, i) => i > 0 && t.length === 2) : undefined);
    const dayTok = numbers.find((t) => t !== yearTok && t.length <= 2);
    if (yearTok && dayTok) {
      return build(expandYear(yearTok), month, parseInt(dayTok, 10), raw);
    }
    return null;
  }

  // 4. Split numeric boxes without separators recognized above, e.g. "06 23 2004".
  if (tokens.length === 3 && tokens.every((t) => /^\d+$/.test(t))) {
    return build(expandYear(tokens[2]), parseInt(tokens[0], 10), parseInt(tokens[1], 10), raw);
  }

  return null;
}

/** "06/23/2004" | "6/23/04" | "June 23, 2004" -> "2004-06-23" ("" if unparseable). */
export function toIsoBirthDate(input: string | SplitBirthDateFields | null | undefined): string {
  return normalizeBirthDate(input)?.iso ?? "";
}

/** -> "06/23/2004 (June 23, 2004)". Falls back to the trimmed raw value. */
export function formatBirthDateDisplay(input: string | SplitBirthDateFields | null | undefined): string {
  const n = normalizeBirthDate(input);
  if (n) return n.display;
  return typeof input === "string" ? input.trim() : "";
}

export type BirthDateComparisonOutcome = "MATCH" | "MISMATCH" | "UNVERIFIABLE";

export interface BirthDateComparison {
  outcome: BirthDateComparisonOutcome;
  matches: boolean;
  left: NormalizedBirthDate | null;
  right: NormalizedBirthDate | null;
  leftDisplay: string;
  rightDisplay: string;
  note: string;
}

/**
 * Compare two birth dates written in any supported notation.
 * e.g. "06/23/2004" (SF10) vs "June 23, 2004" (PSA) -> MATCH.
 */
export function compareBirthDates(
  left: string | SplitBirthDateFields | null | undefined,
  right: string | SplitBirthDateFields | null | undefined
): BirthDateComparison {
  const l = normalizeBirthDate(left);
  const r = normalizeBirthDate(right);
  const leftDisplay = l?.display ?? (typeof left === "string" ? left.trim() : "");
  const rightDisplay = r?.display ?? (typeof right === "string" ? right.trim() : "");

  if (!l || !r) {
    return {
      outcome: "UNVERIFIABLE",
      matches: false,
      left: l,
      right: r,
      leftDisplay,
      rightDisplay,
      note: !leftDisplay || !rightDisplay
        ? "Birth date missing on one document; comparison skipped."
        : "Birth date could not be normalized on one document; manual verification required.",
    };
  }
  const isMatch = l.iso === r.iso;
  return {
    outcome: isMatch ? "MATCH" : "MISMATCH",
    matches: isMatch,
    left: l,
    right: r,
    leftDisplay,
    rightDisplay,
    note: isMatch
      ? `Birth date verified (${l.display}).`
      : `Birth date mismatch: ${l.display} vs ${r.display}.`,
  };
}

/**
 * Explicitly shuffle PSA YYYY/MM/DD & DepEd MM/DD/YYYY birthdates into standard MM/DD/YYYY and YYYY/MM/DD notations.
 */
export function shuffleBirthDate(
  input: string | SplitBirthDateFields | null | undefined
): {
  mmDdYyyy: string;
  yyyyMmDd: string;
  iso: string;
  year: number;
  month: number;
  day: number;
  raw: string;
} | null {
  const norm = normalizeBirthDate(input);
  if (!norm) return null;
  const mm = String(norm.month).padStart(2, "0");
  const dd = String(norm.day).padStart(2, "0");
  return {
    mmDdYyyy: `${mm}/${dd}/${norm.year}`,
    yyyyMmDd: `${norm.year}/${mm}/${dd}`,
    iso: norm.iso,
    year: norm.year,
    month: norm.month,
    day: norm.day,
    raw: norm.raw,
  };
}

/**
 * Renders the shuffled canonical MM/DD/YYYY date together with the original document format
 * e.g. "06/23/2004 (PSA: 2004/06/23)" | "06/23/2004 (SF1: 6/23/04)" | "06/23/2004 (SF9)" | "06/23/2004 (SF10)"
 */
export function formatBirthDateWithDocLabel(rawVal: any, docLabel: string): string {
  if (rawVal === undefined || rawVal === null) return "";
  const str = String(rawVal).trim();
  if (!str || str === "—" || str === "-" || str.toLowerCase() === "null" || str.toLowerCase() === "undefined" || str.toLowerCase() === "n/a") {
    return "";
  }
  const norm = normalizeBirthDate(str);
  if (!norm) return str;

  // If raw format differs from standard MM/DD/YYYY (e.g. 2004/06/23, 2004-06-23, 6/23/04, June 23, 2004)
  if (str !== norm.numeric) {
    return `${norm.numeric} (${docLabel}: ${str})`;
  }
  return `${norm.numeric} (${docLabel})`;
}

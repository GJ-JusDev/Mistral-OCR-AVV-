/**
 * AVV System — DepEd Canonical Month Normalizer & Header Mapping
 *
 * Provides bidirectional mapping and normalization for DepEd School Form 2 (SF2)
 * monthly attendance and School Form 9 (SF9) Front Report on Attendance.
 *
 * DepEd Senior High School operates across 11 official school months:
 *   June (Jun) -> July (Jul) -> August (Aug) -> September (Sept) -> October (Oct) ->
 *   November (Nov) -> December (Dec) -> January (Jan) -> February (Feb) ->
 *   March (Mar) -> April (Apr)
 * Plus the cumulative "Total" column.
 */

export type CanonicalDepEdMonthKey =
  | "jun"
  | "jul"
  | "aug"
  | "sept"
  | "oct"
  | "nov"
  | "dec"
  | "jan"
  | "feb"
  | "mar"
  | "apr"
  | "total";

export const DEPED_11_MONTHS: CanonicalDepEdMonthKey[] = [
  "jun",
  "jul",
  "aug",
  "sept",
  "oct",
  "nov",
  "dec",
  "jan",
  "feb",
  "mar",
  "apr",
];

export interface DepEdMonthMeta {
  key: CanonicalDepEdMonthKey;
  shortLabel: string; // e.g. "Jun", "Sept", "Total"
  fullName: string;   // e.g. "June", "September", "Total"
  displayLabel: string; // e.g. "June (Jun)", "September (Sept)", "Total"
  order: number;
}

export const DEPED_MONTH_CONFIG: Record<CanonicalDepEdMonthKey, DepEdMonthMeta> = {
  jun: { key: "jun", shortLabel: "Jun", fullName: "June", displayLabel: "June (Jun)", order: 1 },
  jul: { key: "jul", shortLabel: "Jul", fullName: "July", displayLabel: "July (Jul)", order: 2 },
  aug: { key: "aug", shortLabel: "Aug", fullName: "August", displayLabel: "August (Aug)", order: 3 },
  sept: { key: "sept", shortLabel: "Sept", fullName: "September", displayLabel: "September (Sept)", order: 4 },
  oct: { key: "oct", shortLabel: "Oct", fullName: "October", displayLabel: "October (Oct)", order: 5 },
  nov: { key: "nov", shortLabel: "Nov", fullName: "November", displayLabel: "November (Nov)", order: 6 },
  dec: { key: "dec", shortLabel: "Dec", fullName: "December", displayLabel: "December (Dec)", order: 7 },
  jan: { key: "jan", shortLabel: "Jan", fullName: "January", displayLabel: "January (Jan)", order: 8 },
  feb: { key: "feb", shortLabel: "Feb", fullName: "February", displayLabel: "February (Feb)", order: 9 },
  mar: { key: "mar", shortLabel: "Mar", fullName: "March", displayLabel: "March (Mar)", order: 10 },
  apr: { key: "apr", shortLabel: "Apr", fullName: "April", displayLabel: "April (Apr)", order: 11 },
  total: { key: "total", shortLabel: "Total", fullName: "Total", displayLabel: "Total", order: 12 },
};

/**
 * Maps raw month text (from SF2 "Report for the Month of", SF9 header columns, or OCR tokens)
 * to its canonical DepEd key ("jun" .. "apr", "total").
 */
export function normalizeDepEdMonthKey(raw: string | null | undefined): CanonicalDepEdMonthKey | "" {
  if (!raw) return "";
  let cleaned = String(raw).toLowerCase().trim();
  // Strip common prefixes e.g. "report for the month of", "month of", "buwan ng"
  cleaned = cleaned.replace(/^(?:report\s+for\s+the\s+month\s+of|report\s+for\s+the\s+month|for\s+the\s+month\s+of|month\s+of|buwan\s+ng)\s*/i, "");
  cleaned = cleaned.replace(/[^a-z0-9]/g, "").trim();
  if (!cleaned) return "";

  // 1. Total
  if (
    cleaned === "total" ||
    cleaned.includes("total") ||
    cleaned === "tot" ||
    cleaned.includes("kabuuan") ||
    cleaned.includes("kabuuang") ||
    cleaned.includes("annual") ||
    cleaned === "sum"
  ) {
    return "total";
  }

  // 2. June (Jun / Hunyo)
  if (
    cleaned.startsWith("jun") ||
    cleaned.includes("june") ||
    cleaned.startsWith("hun") ||
    cleaned === "hunyo"
  ) {
    return "jun";
  }

  // 3. July (Jul / Hulyo)
  if (
    cleaned.startsWith("jul") ||
    cleaned.includes("july") ||
    cleaned.startsWith("hul") ||
    cleaned === "hulyo"
  ) {
    return "jul";
  }

  // 4. August (Aug / Agosto)
  if (
    cleaned.startsWith("aug") ||
    cleaned.includes("august") ||
    cleaned.startsWith("agost")
  ) {
    return "aug";
  }

  // 5. September (Sept / Sep / Setyembre)
  if (
    cleaned.startsWith("sept") ||
    cleaned.startsWith("sep") ||
    cleaned.includes("september") ||
    cleaned.startsWith("sety") ||
    cleaned.startsWith("seti")
  ) {
    return "sept";
  }

  // 6. October (Oct / Oktubre)
  if (
    cleaned.startsWith("oct") ||
    cleaned.includes("october") ||
    cleaned.startsWith("okt")
  ) {
    return "oct";
  }

  // 7. November (Nov / Nobyembre)
  if (
    cleaned.startsWith("nov") ||
    cleaned.includes("november") ||
    cleaned.startsWith("nob")
  ) {
    return "nov";
  }

  // 8. December (Dec / Disyembre)
  if (
    cleaned.startsWith("dec") ||
    cleaned.includes("december") ||
    cleaned.startsWith("dis")
  ) {
    return "dec";
  }

  // 9. January (Jan / Enero)
  if (
    cleaned.startsWith("jan") ||
    cleaned.includes("january") ||
    cleaned.startsWith("ene") ||
    cleaned === "enr"
  ) {
    return "jan";
  }

  // 10. February (Feb / Pebrero)
  if (
    cleaned.startsWith("feb") ||
    cleaned.includes("february") ||
    cleaned.startsWith("peb")
  ) {
    return "feb";
  }

  // 11. March (Mar / Marso)
  if (
    (cleaned.startsWith("mar") && !cleaned.startsWith("may")) ||
    cleaned.includes("march") ||
    cleaned.startsWith("mars")
  ) {
    return "mar";
  }

  // 12. April (Apr / Abril)
  if (
    cleaned.startsWith("apr") ||
    cleaned.includes("april") ||
    cleaned.startsWith("abr")
  ) {
    return "apr";
  }

  return "";
}

/**
 * Returns the standardized display label, e.g. "June (Jun)" or "Total".
 */
export function formatDepEdMonthDisplay(raw: string | null | undefined): string {
  const key = normalizeDepEdMonthKey(raw);
  if (!key || !DEPED_MONTH_CONFIG[key]) {
    return raw ? String(raw).trim() : "-";
  }
  return DEPED_MONTH_CONFIG[key].displayLabel;
}

/**
 * Returns the standard short label, e.g. "Jun", "Sept", "Total".
 */
export function getDepEdMonthShortLabel(raw: string | null | undefined): string {
  const key = normalizeDepEdMonthKey(raw);
  if (!key || !DEPED_MONTH_CONFIG[key]) {
    return raw ? String(raw).trim() : "-";
  }
  return DEPED_MONTH_CONFIG[key].shortLabel;
}

/**
 * Returns the full month name, e.g. "June", "September", "Total".
 */
export function getDepEdMonthFullName(raw: string | null | undefined): string {
  const key = normalizeDepEdMonthKey(raw);
  if (!key || !DEPED_MONTH_CONFIG[key]) {
    return raw ? String(raw).trim() : "Unknown Month";
  }
  return DEPED_MONTH_CONFIG[key].fullName;
}

/**
 * Checks whether two month representations refer to the exact same DepEd school month.
 */
export function isDepEdMonthMatch(m1: string | null | undefined, m2: string | null | undefined): boolean {
  const k1 = normalizeDepEdMonthKey(m1);
  const k2 = normalizeDepEdMonthKey(m2);
  return Boolean(k1 && k2 && k1 === k2);
}

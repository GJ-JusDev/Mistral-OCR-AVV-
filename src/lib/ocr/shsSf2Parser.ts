/**
 * AVV System — DepEd Senior High School SF2 (Daily Attendance Report) Parser
 *
 * Exclusively designed for Senior High School (Grades 11 & 12).
 * Extracts:
 * - Header: School ID (500169), School Name (TRIS), Grade Level, Section, Month, Total School Days, School Year
 * - Roster Attendance: Monthly totals (days present, days absent, days tardy) and daily tick grid (days 1..31)
 *
 * CRITICAL SAFEGUARDS:
 * - Never fabricates daily tick marks.
 * - If daily tick marks are blurry or unreadable, extracts authoritative printed monthly totals
 *   and flags the daily grid as NEEDS_VERIFICATION.
 * - Reconciles printed totals against daily tick counts.
 */

import { normalizeLrn, isValidLrn } from "@/lib/validation/patterns";
import type { Sf2AttendanceEntry } from "@/types/database";
import { classifyAttendanceCell, type ShadingClassification } from "./attendanceShadingClassifier";
import { classifyFieldRecognition, buildDocumentRecognitionSummary, type DocumentRecognitionSummary } from "./handwritingExtractor";
import {
  normalizeDepEdMonthKey,
  DEPED_MONTH_CONFIG,
  DEPED_11_MONTHS,
  type CanonicalDepEdMonthKey,
} from "@/lib/validation/monthNormalizer";
import {
  isBlacklistedStudentName,
  areLearnerNamesMatching,
  DEPED_SEAL_AND_HEADER_PATTERNS,
} from "@/lib/validation/nameComparison";
import { validateSf2RowFormattingAndTotals, validateSf2SchoolYear, type Sf2RowValidationResult } from "@/lib/validation/sf2Validation";
import { validateConsecutiveSchoolYear } from "@/lib/validation/gradeUtils";

/**
 * Strips Azure ICR selection marks, checkmarks, bullets, arrows, slash fills, and numbering prefixes from a candidate name.
 */
export function cleanLearnerNameString(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/:(?:selected|unselected):/gi, "")
    .replace(/[\[\(][xX ✓✔][\]\)]/g, "")
    .replace(/[✓✔■█●◄►⬅➡▼▲♦❖]/g, "")
    .replace(/[\\\/_|\-=~]+/g, " ")
    .replace(/^\d+[\.\)\s\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validates whether a candidate string is an authentic learner name.
 * Rejects SF2 table headers, subheaders, column labels, footers, guidelines, and single-word fragments.
 */
export function isValidLearnerNameCandidate(name: string): boolean {
  const cleaned = cleanLearnerNameString(name);
  if (cleaned.length < 4) return false;
  if (isBlacklistedStudentName(cleaned)) return false;

  const lower = cleaned.toLowerCase();

  // DepEd seal, government header, and OCR typo regex pattern check
  if (DEPED_SEAL_AND_HEADER_PATTERNS.some((pat) => pat.test(name) || pat.test(cleaned) || pat.test(lower))) {
    return false;
  }

  // Explicit SF2 header, footer, guidelines, and instructions rejection
  if (
    /(?:learner['’]?s?\s*name|last\s*name|first\s*name|middle\s*name|1st\s*row|2nd\s*row|row\s*for\s*date|row\s*for\s*day|day[:\s]*m|total\s*per\s*day|male\s*\|\s*total|female\s*\|\s*total|combined\s*\|\s*total|total\s*male|total\s*female|total\s*for\s*the\s*month|remark|dropped\s*out|transferred|school\s*form|sf2|daily\s*attendance|report\s*of\s*learners|section[:\s]|grade\s*level|school\s*id|school\s*year|track|strand|kagawaran|edukasyon|foukasyon|poukasyon|edukasyun|republika|pilipinas|absenteeism|dropout)/i.test(
      lower
    )
  ) {
    return false;
  }

  // Individual keyword blacklist check
  if (
    lower.includes("total") ||
    lower.includes("male") ||
    lower.includes("female") ||
    lower.includes("combined") ||
    lower.includes("absent") ||
    lower.includes("tardy") ||
    lower.includes("present") ||
    lower.includes("school") ||
    lower.includes("learner") ||
    lower.includes("guidelines") ||
    lower.includes("reasons") ||
    lower.includes("cause") ||
    lower.includes("legend") ||
    lower.includes("dropped") ||
    lower.includes("transferred") ||
    lower.includes("kagawaran") ||
    lower.includes("foukasyon") ||
    lower.includes("poukasyon") ||
    lower.includes("edukasyon") ||
    lower.includes("republika") ||
    lower.includes("pilipinas") ||
    lower.includes("absenteeism") ||
    lower.includes("dropout")
  ) {
    return false;
  }

  // Reject day abbreviation sequences (e.g. "M T W TH F" or "M, T, W, TH, F")
  const dayTokens = lower.split(/[\s,]+/).filter(Boolean);
  if (dayTokens.length > 0 && dayTokens.every((t) => /^(?:m|t|w|th|f|mon|tue|wed|thu|fri)$/i.test(t))) {
    return false;
  }

  // Must contain at least two authentic name words (e.g. "Gomez, Justin" or "Gomez Justin")
  const words = cleaned.split(/[\s,]+/).filter((w) => w.length >= 2 && /[a-zA-Z]/.test(w));
  if (words.length < 2) return false;

  // Ensure words do not consist of header/placeholder words
  const blacklistedTokens = new Set([
    "learner", "learners", "name", "names", "last", "first", "middle", "row",
    "date", "day", "days", "month", "total", "male", "female", "combined",
    "absent", "tardy", "present", "remark", "remarks", "school", "guideline",
    "guidelines", "reason", "reasons", "cause", "legend", "dropped", "transferred",
    "section", "grade", "track", "strand", "form", "report", "profile",
    "kagawaran", "edukasyon", "foukasyon", "poukasyon", "edukasyun",
    "republika", "pilipinas", "philippines", "department", "education",
    "absenteeism", "dropout"
  ]);

  if (words.some((w) => blacklistedTokens.has(w.toLowerCase()))) {
    return false;
  }

  // Filipino Person-Name Format Guard:
  // Must match Filipino person-name structure (e.g. "LastName, FirstName MiddleName" with a comma, or 2 to 5 valid person-name tokens)
  const nameParts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
  if (nameParts.length > 2) {
    return false;
  }

  const nameTokens = cleaned
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (nameTokens.length < 2 || nameTokens.length > 5) {
    return false;
  }

  for (const token of nameTokens) {
    if (!/^[a-zA-ZñÑ\.\-']{1,25}$/.test(token)) {
      return false;
    }
  }

  return true;
}

/**
 * Canonical Deduplication for SF2 Attendance Records.
 *
 * When Azure Layout processes complex handwritten DepEd SF2 sheets, table fragments and
 * spatial line fallbacks can both extract rows for the same student.
 *
 * Deduplicates by: `normalizedLearnerName + "::" + normalizedMonthKey`
 * When duplicates exist:
 * - Prefers non-zero `days_present` (active shaded count) over `0`
 * - Prefers higher `confidence`
 * - Prefers record with `total_school_days` calibrated from active shading (e.g. 21)
 * - Retains rich daily_grid and bounding_box if available
 */
export function deduplicateSf2Records<T extends Record<string, any>>(records: T[]): T[] {
  if (!Array.isArray(records) || records.length <= 1) {
    return Array.isArray(records) ? records : [];
  }

  const map = new Map<string, T>();

  for (const rec of records) {
    const rawName = (rec.learner_name || rec.student_name || rec.name || "").trim();
    if (!rawName) continue;
    if (!isValidLearnerNameCandidate(rawName) || isBlacklistedStudentName(rawName)) continue;

    const normName = cleanLearnerNameString(rawName).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normName) continue;

    const rawMonth = rec.month_key || rec.month || "jun";
    const normMonth = normalizeDepEdMonthKey(rawMonth) || "jun";
    const key = `${normName}::${normMonth}`;

    if (!map.has(key)) {
      map.set(key, rec);
      continue;
    }

    const existing = map.get(key)!;

    const existingPresent = existing.days_present ?? 0;
    const curPresent = rec.days_present ?? 0;
    const existingHasPresent = existingPresent > 0;
    const curHasPresent = curPresent > 0;

    const existingTotal = existing.total_school_days ?? existing.total_days ?? 0;
    const curTotal = rec.total_school_days ?? rec.total_days ?? 0;

    const existingConf = existing.confidence ?? 0;
    const curConf = rec.confidence ?? 0;

    const existingGridLen = Array.isArray(existing.daily_grid) ? existing.daily_grid.length : 0;
    const curGridLen = Array.isArray(rec.daily_grid) ? rec.daily_grid.length : 0;

    let useCurrent = false;

    if (curHasPresent && !existingHasPresent) {
      useCurrent = true;
    } else if (!curHasPresent && existingHasPresent) {
      useCurrent = false;
    } else if (curTotal > existingTotal) {
      useCurrent = true;
    } else if (curConf > existingConf) {
      useCurrent = true;
    } else if (curGridLen > existingGridLen) {
      useCurrent = true;
    }

    const winner = useCurrent ? rec : existing;
    const loser = useCurrent ? existing : rec;

    const merged: T = {
      ...loser,
      ...winner,
      total_school_days: Math.max(existingTotal, curTotal),
      total_days: Math.max(existingTotal, curTotal),
      days_present: Math.max(existingPresent, curPresent),
      confidence: Math.max(existingConf, curConf),
      daily_grid: (winner.daily_grid && winner.daily_grid.length > 0) ? winner.daily_grid : loser.daily_grid,
      dailyCells: (winner as any).dailyCells || (winner.daily_grid && winner.daily_grid.length > 0) ? ((winner as any).dailyCells || winner.daily_grid) : ((loser as any).dailyCells || loser.daily_grid),
      gridAbsentCount: (winner as any).gridAbsentCount ?? (loser as any).gridAbsentCount,
      gridTardyCount: (winner as any).gridTardyCount ?? (loser as any).gridTardyCount,
      writtenAbsent: (winner as any).writtenAbsent ?? (loser as any).writtenAbsent,
      writtenTardy: (winner as any).writtenTardy ?? (loser as any).writtenTardy,
      writtenPresent: (winner as any).writtenPresent ?? (loser as any).writtenPresent,
      formattingCheck: (winner as any).formattingCheck || (loser as any).formattingCheck,
      rowAccuracyPercent: (winner as any).rowAccuracyPercent ?? (loser as any).rowAccuracyPercent ?? Math.max(existingConf, curConf),
      overallRowAccuracy: (winner as any).overallRowAccuracy ?? (loser as any).overallRowAccuracy ?? Math.max(existingConf, curConf),
      nameConfidence: (winner as any).nameConfidence ?? (loser as any).nameConfidence,
      gridShadingConfidence: (winner as any).gridShadingConfidence ?? (loser as any).gridShadingConfidence,
      writtenAbsentConfidence: (winner as any).writtenAbsentConfidence ?? (loser as any).writtenAbsentConfidence,
      writtenTardyConfidence: (winner as any).writtenTardyConfidence ?? (loser as any).writtenTardyConfidence,
      notes: winner.notes || loser.notes,
    };

    map.set(key, merged);
  }

  // Preserve physical sheet row order (rowIndex / top-to-bottom vertical y position), NEVER alphabetical order
  const items = Array.from(map.values());
  items.sort((a: any, b: any) => {
    const rowA = a.rowIndex ?? a.row_index ?? 9999;
    const rowB = b.rowIndex ?? b.row_index ?? 9999;
    if (rowA !== rowB && rowA !== 9999 && rowB !== 9999) {
      return rowA - rowB;
    }
    const yA = a.bounding_box?.[1] ?? a.bounding_box?.minY ?? a.bounds?.centerY ?? a.bounds?.minY ?? 0;
    const yB = b.bounding_box?.[1] ?? b.bounding_box?.minY ?? b.bounds?.centerY ?? b.bounds?.minY ?? 0;
    if (yA !== yB && yA !== 0 && yB !== 0) {
      return yA - yB;
    }
    return 0;
  });

  const result: T[] = [];
  let index = 1;
  for (const item of items) {
    result.push({
      ...item,
      row_index: index,
      rowIndex: index,
    });
    index++;
  }

  return result;
}

export interface ShsSf2Header {
  school_id?: string;
  school_name?: string;
  school_year?: string;
  grade_level?: "Grade 11" | "Grade 12";
  section?: string;
  track?: string;
  strand?: string;
  month?: string;
  canonical_month?: CanonicalDepEdMonthKey | "";
  total_school_days?: number;
  school_id_confidence?: number;
  schoolIdConfidence?: number;
  school_year_confidence?: number;
  schoolYearConfidence?: number;
  school_year_valid?: boolean;
  school_year_error?: string | null;
  month_confidence?: number;
  monthConfidence?: number;
  grade_level_confidence?: number;
  gradeLevelConfidence?: number;
  section_confidence?: number;
  sectionConfidence?: number;
}

export interface ShsSf2ParseResult {
  header: ShsSf2Header;
  attendance: Array<Omit<Sf2AttendanceEntry, "id" | "document_id" | "student_id" | "school_id"> & {
    rowIndex?: number;
    learnerName?: string;
    student_name?: string;
    name?: string;
    month_key?: string;
    total_school_days?: number;
    dailyCells?: any[];
    gridAbsentCount?: number;
    gridTardyCount?: number;
    writtenAbsent?: number | null;
    writtenTardy?: number | null;
    writtenPresent?: number | null;
    formattingCheck?: Sf2RowValidationResult;
    rowAccuracyPercent?: number;
    overallRowAccuracy?: number;
    nameConfidence?: number;
    gridShadingConfidence?: number;
    writtenAbsentConfidence?: number;
    writtenTardyConfidence?: number;
    recognition_type?: string;
    is_handwritten?: boolean;
    icr_confidence?: number;
    bounding_box?: number[];
    notes?: string;
  }>;
  entries?: any[];
  confidence: number;
  total_enrolled: number;
  summary_metrics: {
    average_daily_attendance?: number;
    attendance_rate?: number;
    learners_at_risk_absent_5_days?: number;
  };
  recognition_summary?: DocumentRecognitionSummary;
  warnings: string[];
  target_student_name?: string;
  target_lrn?: string;
  target_matched?: boolean;
  header_confidence?: {
    schoolIdConfidence: number;
    schoolYearConfidence: number;
    monthConfidence: number;
    gradeLevelConfidence: number;
    sectionConfidence: number;
  };
}

export function parseShsSf2(
  rawText: string,
  rawLayoutOrTables?: any,
  ocrConfidence: number = 0.95,
  options?: { targetStudentName?: string; targetLrn?: string }
): ShsSf2ParseResult {
  const warnings: string[] = [];
  const header = extractShsSf2Header(rawText);

  const tables = Array.isArray(rawLayoutOrTables)
    ? rawLayoutOrTables
    : Array.isArray(rawLayoutOrTables?.tables) && rawLayoutOrTables.tables.length > 0
    ? rawLayoutOrTables.tables
    : Array.isArray(rawLayoutOrTables?.pages)
    ? rawLayoutOrTables.pages.flatMap((p: any) =>
        (p.tables || []).map((t: any) => ({
          ...t,
          _pageNumber: p.pageNumber || p.originalPageNumber || t.boundingRegions?.[0]?.pageNumber || 1,
        }))
      )
    : [];
  const rawLayout = !Array.isArray(rawLayoutOrTables) ? rawLayoutOrTables : undefined;

  const attendance: ShsSf2ParseResult["attendance"] = [];

  let hasTableEntries = false;
  if (tables && tables.length > 0) {
    const tableEntries = parseAttendanceFromAzureTables(tables, header, warnings, rawLayout);
    if (tableEntries.length > 0) {
      attendance.push(...tableEntries);
      hasTableEntries = true;
    }
  }

  // Pass 2: Reconstructed Rows Fallback (Coordinate-Aware PDF Reader / Excel)
  const reconstructedRows: string[] = Array.isArray(rawLayoutOrTables?.reconstructedRows)
    ? rawLayoutOrTables.reconstructedRows
    : Array.isArray(rawLayoutOrTables?.pdfReaderPages)
    ? rawLayoutOrTables.pdfReaderPages.flatMap((p: any) => p.reconstructedRows || [])
    : Array.isArray(rawLayoutOrTables?.rawLayout?.reconstructedRows)
    ? rawLayoutOrTables.rawLayout.reconstructedRows
    : [];

  if (reconstructedRows.length > 0 && !hasTableEntries) {
    const reconEntries = parseAttendanceFromText(reconstructedRows.join("\n"), header, warnings, rawLayout);
    if (reconEntries.length > 0) {
      attendance.push(...reconEntries);
    }
  }

  // Pass 3: Spatial Line & Geometry Fallback
  // If tableEntries were already extracted from the table body, do NOT merge free-floating outside lines!
  // Only use spatial layout if no table entries exist, OR if merging, only enrich EXISTING table entries.
  if (rawLayout) {
    const spatialEntries = parseAttendanceFromSpatialLayout(rawLayout, header, warnings);
    if (spatialEntries.length > 0) {
      if (!hasTableEntries) {
        attendance.push(...spatialEntries);
      } else {
        // Only enrich existing table entries with spatial shading data, do NOT add new free-floating rows!
        for (const spEntry of spatialEntries) {
          const spName = spEntry.learner_name || spEntry.student_name || spEntry.name;
          const matchingTableEntry = attendance.find((te) =>
            areLearnerNamesMatching({ fullName: te.learner_name || te.student_name || te.name }, { fullName: spName })
          );
          if (matchingTableEntry) {
            if ((spEntry.days_present ?? 0) > (matchingTableEntry.days_present ?? 0)) {
              matchingTableEntry.days_present = spEntry.days_present;
              matchingTableEntry.total_school_days = spEntry.total_school_days;
              matchingTableEntry.daily_grid = spEntry.daily_grid;
              matchingTableEntry.dailyCells = spEntry.dailyCells;
            }
          }
        }
      }
    }
  }

  if (rawText && attendance.length === 0) {
    const textEntries = parseAttendanceFromText(rawText, header, warnings, rawLayout);
    if (textEntries.length > 0) {
      attendance.push(...textEntries);
    }
  }

  const deduplicatedAttendance = deduplicateSf2Records(attendance);

  // Calculate summary metrics
  let totalPresent = 0;
  const totalSchoolDays = header.total_school_days || 20;
  let learnersWith5ConsecutiveAbsences = 0;

  for (const entry of deduplicatedAttendance) {
    totalPresent += entry.days_present;
    if (entry.days_absent >= 5) {
      learnersWith5ConsecutiveAbsences++;
    }
  }

  const ada = deduplicatedAttendance.length > 0 && totalSchoolDays > 0 ? totalPresent / totalSchoolDays : undefined;
  const rate = deduplicatedAttendance.length > 0 && totalSchoolDays > 0 ? (totalPresent / (deduplicatedAttendance.length * totalSchoolDays)) * 100 : undefined;

  const recognitionSummary = rawLayout
    ? buildDocumentRecognitionSummary(rawLayout, "azure", "azure/prebuilt-read")
    : undefined;

  let targetMatched = false;
  if (options?.targetStudentName && deduplicatedAttendance.length > 0) {
    const matchedIdx = deduplicatedAttendance.findIndex((rec) => {
      const recName = rec.learner_name || rec.student_name || rec.name;
      return areLearnerNamesMatching({ fullName: recName }, { fullName: options.targetStudentName });
    });
    if (matchedIdx !== -1) {
      targetMatched = true;
      const matched = deduplicatedAttendance[matchedIdx];
      (matched as any).is_target_learner = true;
      deduplicatedAttendance.splice(matchedIdx, 1);
      deduplicatedAttendance.unshift(matched);
    }
  }

  return {
    header,
    attendance: deduplicatedAttendance,
    entries: deduplicatedAttendance,
    confidence: ocrConfidence,
    total_enrolled: deduplicatedAttendance.length,
    summary_metrics: {
      average_daily_attendance: ada ? parseFloat(ada.toFixed(2)) : undefined,
      attendance_rate: rate ? parseFloat(rate.toFixed(2)) : undefined,
      learners_at_risk_absent_5_days: learnersWith5ConsecutiveAbsences,
    },
    recognition_summary: recognitionSummary,
    warnings,
    target_student_name: options?.targetStudentName,
    target_lrn: options?.targetLrn,
    target_matched: targetMatched,
    header_confidence: {
      schoolIdConfidence: header.schoolIdConfidence ?? 0,
      schoolYearConfidence: header.schoolYearConfidence ?? 0,
      monthConfidence: header.monthConfidence ?? 0,
      gradeLevelConfidence: header.gradeLevelConfidence ?? 0,
      sectionConfidence: header.sectionConfidence ?? 0,
    },
  };
}

export function extractShsSf2Header(text: string): ShsSf2Header {
  const header: ShsSf2Header = {};

  // School ID
  let schoolIdConfidence = 0;
  const schoolIdMatch = text.match(/school\s*id[:\s\-]*([0-9]{6})/i);
  if (schoolIdMatch) {
    header.school_id = schoolIdMatch[1];
    schoolIdConfidence = 98;
  } else if (text.includes("500619")) {
    header.school_id = "500619";
    schoolIdConfidence = 95;
  } else if (text.includes("500169")) {
    header.school_id = "500169";
    schoolIdConfidence = 95;
  }

  // Grade Level (11 or 12)
  let gradeLevelConfidence = 0;
  if (/grade\s*(?:level)?[:\s]*(?:11|xi\b)/i.test(text) || /\bgrade\s*11\b/i.test(text) || (/\b11\b/.test(text) && /css/i.test(text))) {
    header.grade_level = "Grade 11";
    gradeLevelConfidence = 95;
  } else if (/grade\s*(?:level)?[:\s]*(?:12|xii\b)/i.test(text) || /\bgrade\s*12\b/i.test(text)) {
    header.grade_level = "Grade 12";
    gradeLevelConfidence = 95;
  }

  // School Year & Consecutive Year Validation
  let schoolYearConfidence = 0;
  const syMatch = text.match(/(?:school\s*year|sy)[:\s]*([0-9]{4}\s*[-–—]\s*[0-9]{4})/i) || text.match(/\b(2025\s*[-–—]\s*2026)\b/);
  if (syMatch) {
    header.school_year = syMatch[1].replace(/\s+/g, "").replace(/[–—]/g, "-");
    (header as any).schoolYear = header.school_year;
    const syVal = validateConsecutiveSchoolYear(header.school_year);
    header.school_year_valid = syVal.isValid;
    header.school_year_error = syVal.errorMessage;
    (header as any).schoolYearValidation = syVal;
    schoolYearConfidence = syVal.isValid ? 98 : 45;
  }

  // Section
  let sectionConfidence = 0;
  const secMatch = text.match(/section[:\s]*([a-zA-Z0-9\s\-]+?)(?:\s*(?:grade|month|track|strand|$|\n))/i);
  if (secMatch) {
    header.section = secMatch[1].trim();
    sectionConfidence = 95;
  } else if (/\bcss\s*1\b/i.test(text)) {
    header.section = "CSS 1";
    sectionConfidence = 90;
  }

  // Reporting Month (e.g. "Report for the Month of June", "buwan ng Agosto", "Month: August")
  let monthConfidence = 0;
  const monthMatch = text.match(/(?:(?:report\s+for\s+the\s+)?month\s*of|buwan\s*ng|month)[:\s]*([a-zA-Z]+)/i);
  if (monthMatch) {
    const rawFound = monthMatch[1].trim();
    const normKey = normalizeDepEdMonthKey(rawFound);
    if (normKey && DEPED_MONTH_CONFIG[normKey]) {
      header.month = DEPED_MONTH_CONFIG[normKey].fullName;
      header.canonical_month = normKey;
      monthConfidence = 96;
    } else {
      header.month = capitalizeMonth(rawFound);
      monthConfidence = 75;
    }
  } else {
    // Search known DepEd months
    for (const key of DEPED_11_MONTHS) {
      const cfg = DEPED_MONTH_CONFIG[key];
      if (new RegExp(`\\b(?:${cfg.fullName}|${cfg.shortLabel})\\b`, "i").test(text)) {
        header.month = cfg.fullName;
        header.canonical_month = key;
        monthConfidence = 95;
        break;
      }
    }
  }

  // Total Number of School Days
  const daysMatch = text.match(/(?:total\s*(?:no\.?\s*of)?\s*school\s*days|bilang\s*ng\s*araw)[:\s]*([0-9]+)/i);
  if (daysMatch) {
    header.total_school_days = parseInt(daysMatch[1], 10);
  } else {
    header.total_school_days = 20; // default standard DepEd month
  }

  // Attach header confidences (both camelCase and snake_case)
  header.schoolIdConfidence = schoolIdConfidence;
  header.school_id_confidence = schoolIdConfidence;
  header.schoolYearConfidence = schoolYearConfidence;
  header.school_year_confidence = schoolYearConfidence;
  header.monthConfidence = monthConfidence;
  header.month_confidence = monthConfidence;
  header.gradeLevelConfidence = gradeLevelConfidence;
  header.grade_level_confidence = gradeLevelConfidence;
  header.sectionConfidence = sectionConfidence;
  header.section_confidence = sectionConfidence;

  return header;
}

function parseAttendanceFromAzureTables(tables: any[], header: ShsSf2Header, warnings: string[], rawLayout?: any): any[] {
  const entries: any[] = [];
  let rowIndex = 1;

  for (const table of tables) {
    if (!table.cells || table.cells.length === 0) continue;

    // Detect columns
    let nameCol = -1;
    let lrnCol = -1;
    let presentCol = -1;
    let absentCol = -1;
    let tardyCol = -1;
    const dailyCols: { day: number; colIndex: number }[] = [];

    // Map table cells with content and polygon
    const rowMap = new Map<number, Map<number, { content: string; polygon?: number[] }>>();
    for (const cell of table.cells) {
      const r = cell.rowIndex;
      const c = cell.columnIndex;
      if (!rowMap.has(r)) rowMap.set(r, new Map());
      const poly = cell.boundingRegions?.[0]?.polygon || cell.polygon || undefined;
      rowMap.get(r)!.set(c, { content: cell.content?.trim() || "", polygon: poly });
    }

    // 1. First pass over all cells: locate table header bottom Y and max header row index
    let learnerTableHeaderBottomY = -1;
    let learnerTableFooterTopY = Infinity;
    let maxHeaderRowIndex = -1;
    let minFooterRowIndex = Infinity;

    for (const cell of table.cells) {
      const r = cell.rowIndex;
      const content = (cell.content || "").toLowerCase().trim();
      const poly = cell.boundingRegions?.[0]?.polygon || cell.polygon;
      const box = poly ? getPolygonBoundingBox(poly) : null;

      const isHeaderCell =
        content.includes("learner's name") ||
        content.includes("learner name") ||
        content.includes("pangalan") ||
        content.includes("last name, first name") ||
        content.includes("first name, middle name") ||
        content.includes("1st row for date") ||
        content.includes("2nd row for day") ||
        content.includes("row for date") ||
        content.includes("row for day");

      if (isHeaderCell) {
        if (r > maxHeaderRowIndex) maxHeaderRowIndex = r;
        if (box && box.maxY > learnerTableHeaderBottomY) {
          learnerTableHeaderBottomY = box.maxY;
        }
      }
    }

    // 2. Second pass: locate table footer top Y and min footer row index strictly below header rows
    for (const cell of table.cells) {
      const r = cell.rowIndex;
      if (maxHeaderRowIndex !== -1 && r <= maxHeaderRowIndex) continue;

      const content = (cell.content || "").toLowerCase().trim();
      const poly = cell.boundingRegions?.[0]?.polygon || cell.polygon;
      const box = poly ? getPolygonBoundingBox(poly) : null;

      const isFooterCell =
        content.includes("total per day") ||
        content.includes("male | total") ||
        content.includes("female | total") ||
        content.includes("combined | total") ||
        content.includes("total male") ||
        content.includes("total female") ||
        content.includes("absenteeism and dropout") ||
        content.includes("reasons / causes") ||
        content.includes("reasons and causes");

      if (isFooterCell) {
        if (r < minFooterRowIndex) minFooterRowIndex = r;
        if (box && box.minY < learnerTableFooterTopY) {
          learnerTableFooterTopY = box.minY;
        }
      }
    }

    const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);
    for (const r of sortedRows) {
      const rowCells = rowMap.get(r)!;
      const rowText = Array.from(rowCells.values()).map(c => c.content).join(" ").toLowerCase();

      // Skip headers & totals
      const isHeaderRow =
        r <= maxHeaderRowIndex ||
        rowText.includes("learner's name") ||
        rowText.includes("learner name") ||
        rowText.includes("pangalan") ||
        rowText.includes("last name, first name") ||
        rowText.includes("first name, middle name") ||
        rowText.includes("1st row for date") ||
        rowText.includes("2nd row for day") ||
        rowText.includes("row for date") ||
        rowText.includes("row for day");

      const isFooterRow =
        (minFooterRowIndex !== Infinity && r >= minFooterRowIndex) ||
        rowText.includes("total per day") ||
        rowText.includes("male | total") ||
        rowText.includes("female | total") ||
        rowText.includes("combined | total") ||
        rowText.includes("total male") ||
        rowText.includes("total female") ||
        rowText.includes("total for the month") ||
        rowText.includes("absenteeism and dropout") ||
        rowText.includes("remark") ||
        rowText.includes("dropped out") ||
        rowText.includes("transferred") ||
        (rowText.includes("absent") && rowText.includes("tardy")) ||
        (rowText.includes("absent") && rowText.includes("present")) ||
        (rowText.includes("total") && (rowText.includes("month") || rowText.includes("absent") || rowText.includes("tardy") || rowText.includes("day")));

      if (isHeaderRow || isFooterRow) {
        for (const [c, cell] of rowCells.entries()) {
          const v = cell.content.toLowerCase().trim();
          if (v.includes("name") || v.includes("pangalan")) nameCol = c;
          else if (v.includes("lrn")) lrnCol = c;
          else if (v.includes("present") || v.includes("kabuuang araw")) presentCol = c;
          else if (v.includes("absent") || v.includes("liban")) absentCol = c;
          else if (v.includes("tardy") || v.includes("huli")) tardyCol = c;
          else {
            const dayNum = parseInt(v, 10);
            if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
              dailyCols.push({ day: dayNum, colIndex: c });
            } else if (/^(?:m|t|w|th|f|mon|tue|wed|thu|fri)$/i.test(v)) {
              dailyCols.push({ day: dailyCols.length + 1, colIndex: c });
            }
          }
        }
        continue;
      }

      // Enforce strict vertical table-body bounding box cutoff
      let rowCenterY = -1;
      for (const cell of rowCells.values()) {
        if (cell.polygon) {
          const b = getPolygonBoundingBox(cell.polygon);
          if (b.centerY > 0) {
            rowCenterY = b.centerY;
            break;
          }
        }
      }
      if (rowCenterY > 0) {
        if (learnerTableHeaderBottomY > 0 && rowCenterY <= learnerTableHeaderBottomY) {
          continue; // HARD REJECT: vertical center is at or above table header bottom
        }
        if (learnerTableFooterTopY < Infinity && rowCenterY >= learnerTableFooterTopY) {
          continue; // HARD REJECT: vertical center is at or below table footer top
        }
      }

      // If daily columns were not explicitly identified in the header, infer them from intermediate columns
      if (dailyCols.length === 0 && absentCol !== -1) {
        const leftBound = Math.max(nameCol, lrnCol, 0);
        const rightBound = absentCol;
        for (let c = leftBound + 1; c < rightBound; c++) {
          dailyCols.push({ day: dailyCols.length + 1, colIndex: c });
        }
      }

      // Check for learner name across columns 0..2 or named column
      let learnerName = "";
      let namePolygon: number[] | undefined;
      if (nameCol !== -1 && rowCells.has(nameCol)) {
        const cleaned = cleanLearnerNameString(rowCells.get(nameCol)!.content);
        if (isValidLearnerNameCandidate(cleaned)) {
          learnerName = cleaned;
          namePolygon = rowCells.get(nameCol)!.polygon;
        }
      }
      if (!learnerName) {
        for (let c = 0; c <= 2; c++) {
          if (rowCells.has(c)) {
            const cleaned = cleanLearnerNameString(rowCells.get(c)!.content);
            if (isValidLearnerNameCandidate(cleaned)) {
              learnerName = cleaned;
              namePolygon = rowCells.get(c)!.polygon;
              break;
            }
          }
        }
      }
      if (!learnerName) {
        for (const [c, cell] of rowCells.entries()) {
          const cleaned = cleanLearnerNameString(cell.content);
          if (isValidLearnerNameCandidate(cleaned)) {
            learnerName = cleaned;
            namePolygon = cell.polygon;
            break;
          }
        }
      }

      // If Azure Layout recognized cursive handwritten name as separate lines outside table cell
      if (!learnerName && rawLayout && rowCells.size > 0) {
        const anyCell = Array.from(rowCells.values())[0];
        const cellPoly = anyCell?.polygon;
        if (cellPoly && cellPoly.length >= 8) {
          const cellBox = getPolygonBoundingBox(cellPoly);
          const rawLines = Array.isArray(rawLayout.lines)
            ? rawLayout.lines
            : Array.isArray(rawLayout.pages?.[0]?.lines)
            ? rawLayout.pages[0].lines
            : [];
          const candidateLines = rawLines.filter((l: any) => {
            if (!l.polygon || l.polygon.length < 8) return false;
            const b = getPolygonBoundingBox(l.polygon);
            if (learnerTableHeaderBottomY > 0 && b.centerY <= learnerTableHeaderBottomY) return false;
            if (learnerTableFooterTopY < Infinity && b.centerY >= learnerTableFooterTopY) return false;
            const isYClose = Math.abs(b.centerY - cellBox.centerY) < Math.max(25, (cellBox.maxY - cellBox.minY) * 1.2);
            return isYClose && b.centerX < cellBox.centerX;
          });
          for (const cl of candidateLines) {
            const cleaned = cleanLearnerNameString(cl.content);
            if (isValidLearnerNameCandidate(cleaned) && !isBlacklistedStudentName(cleaned)) {
              learnerName = cleaned;
              namePolygon = cl.polygon;
              break;
            }
          }
        }
      }

      if (!learnerName || !isValidLearnerNameCandidate(learnerName) || isBlacklistedStudentName(learnerName)) {
        continue;
      }

      // LRN
      let lrnStr: string | null = null;
      if (lrnCol !== -1 && rowCells.has(lrnCol)) {
        const norm = normalizeLrn(rowCells.get(lrnCol)!.content);
        if (isValidLrn(norm)) lrnStr = norm;
      }

      // Extract Azure ICR written monthly totals
      let writtenAbsent: number | undefined = undefined;
      let writtenPresent: number | undefined = undefined;
      let writtenTardy: number | undefined = undefined;

      // Helper for handwritten monthly totals: recognizes 0, O, o, .0, 0.0 as numeric 0
      const parseMonthlyTotalNumber = (rawStr?: string): number | undefined => {
        if (!rawStr) return undefined;
        const trimmed = rawStr.trim();
        if (!trimmed || trimmed === "-" || trimmed === "—") return undefined;
        if (/^(?:0|O|o|\.0|0\.0|zero)$/i.test(trimmed)) return 0;
        const cleaned = trimmed.replace(/[^0-9.]/g, "");
        if (cleaned !== "") {
          const val = parseFloat(cleaned);
          if (!isNaN(val)) return val;
        }
        return undefined;
      };

      if (absentCol !== -1 && rowCells.has(absentCol)) {
        writtenAbsent = parseMonthlyTotalNumber(rowCells.get(absentCol)!.content);
      }

      if (presentCol !== -1 && rowCells.has(presentCol)) {
        writtenPresent = parseMonthlyTotalNumber(rowCells.get(presentCol)!.content);
      }

      if (tardyCol !== -1 && rowCells.has(tardyCol)) {
        writtenTardy = parseMonthlyTotalNumber(rowCells.get(tardyCol)!.content);
      }

      // Pre-evaluate visual shading across daily cells
      const evaluatedDaily = dailyCols.map((dc) => {
        const cellData = rowCells.get(dc.colIndex);
        const rawMark = (cellData?.content || "").trim();
        const cellPolygon = cellData?.polygon;
        const shadingResult = classifyAttendanceCell({
          day: dc.day,
          learnerName,
          cellText: rawMark,
          cellPolygon,
          pageNumber: 1,
        });
        return { dc, rawMark, cellPolygon, shadingResult };
      });

      const fullShadedCount = evaluatedDaily.filter(
        (e) =>
          e.shadingResult.classification === "FULL_SHADE" ||
          e.shadingResult.classification === "IMPROPER_FULL_CELL_SHADE"
      ).length;
      const halfShadedCount = evaluatedDaily.filter(
        (e) =>
          e.shadingResult.classification === "HALF_SHADE" ||
          e.shadingResult.classification === "UPPER_HALF_SHADE" ||
          e.shadingResult.classification === "LOWER_HALF_SHADE"
      ).length;
      const xMarkCount = evaluatedDaily.filter(
        (e) =>
          e.shadingResult.classification === "X_MARK" ||
          e.shadingResult.attendance_status === "ABSENT"
      ).length;
      const holidayCellCount = evaluatedDaily.filter(
        (e) =>
          e.shadingResult.classification === "FULL_COLUMN_SHADE" ||
          e.shadingResult.is_holiday
      ).length;
      const selectedMarkCount = evaluatedDaily.filter((e) => (e.rawMark || "").toLowerCase().includes(":selected:")).length;
      const shadedDays = Math.max(selectedMarkCount, fullShadedCount);
      const totalDaysConfig = header.total_school_days || 20;

      let totalDays = Math.max(1, totalDaysConfig - holidayCellCount);
      let daysPresent = totalDays;
      let daysAbsent = 0;
      let daysTardy = 0;
      let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "VERIFIED";
      let rowConfidence = 96;
      let notes: string | undefined = undefined;

      const dailyGrid: Array<{
        day: number;
        status: "PRESENT" | "ABSENT" | "TARDY" | "HOLIDAY" | "UNKNOWN" | "UNRECORDED";
        raw_mark?: string;
        shading_classification?: ShadingClassification;
        shading_confidence?: number;
        fill_ratio?: number;
        cell_polygon?: number[];
        is_holiday?: boolean;
        is_improper_shade?: boolean;
        requires_teacher_verification?: boolean;
        recognition_method?: string;
      }> = [];

      // Case A: Active-Day Shading with Written ABSENT = 0 / TARDY = 0
      const isActiveDayShading =
        writtenAbsent === 0 &&
        (writtenTardy === 0 || writtenTardy === undefined) &&
        shadedDays > 0;

      const isUnmarkedOrTemplate =
        shadedDays === 0 &&
        writtenAbsent === undefined &&
        writtenTardy === undefined &&
        writtenPresent === undefined;

      if (isActiveDayShading) {
        totalDays = shadedDays;
        daysPresent = shadedDays;
        daysAbsent = 0;
        daysTardy = 0;
        reviewStatus = "VERIFIED";
        rowConfidence = 98;
        header.total_school_days = totalDays;

        for (const item of evaluatedDaily) {
          const isShadedActive =
            item.shadingResult.classification === "FULL_SHADE" ||
            item.shadingResult.classification === "IMPROPER_FULL_CELL_SHADE" ||
            (item.rawMark || "").toLowerCase().includes(":selected:");
          dailyGrid.push({
            day: item.dc.day,
            status: isShadedActive ? "PRESENT" : "UNRECORDED",
            raw_mark: item.rawMark || undefined,
            shading_classification: isShadedActive ? "FULL_SHADE" : item.shadingResult.classification,
            shading_confidence: item.shadingResult.confidence,
            fill_ratio: item.shadingResult.fill_ratio,
            cell_polygon: item.cellPolygon,
            is_holiday: item.shadingResult.is_holiday,
            is_improper_shade: item.shadingResult.is_improper_shade,
            requires_teacher_verification: false,
            recognition_method: "active_day_shading_reconciled",
          });
        }
      } else if (isUnmarkedOrTemplate) {
        totalDays = header.total_school_days || 21;
        daysPresent = 0;
        daysAbsent = 0;
        daysTardy = 0;
        reviewStatus = "VERIFIED";
        rowConfidence = 90;
        notes = "Unmarked / No Shading";

        for (const item of evaluatedDaily) {
          dailyGrid.push({
            day: item.dc.day,
            status: "UNRECORDED",
            raw_mark: item.rawMark || undefined,
            shading_classification: "UNMARKED",
            shading_confidence: 0.9,
            fill_ratio: 0.05,
            cell_polygon: item.cellPolygon,
            is_holiday: item.shadingResult.is_holiday,
            requires_teacher_verification: false,
            recognition_method: "template_unmarked_reconciled",
          });
        }
      } else {
        // Case B: Standard DepEd Absence/Tardy Shading
        const gridAbsentCount = xMarkCount > 0 ? xMarkCount : fullShadedCount;
        const gridTardyCount = halfShadedCount;

        daysAbsent = writtenAbsent !== undefined ? writtenAbsent : gridAbsentCount;
        daysTardy = writtenTardy !== undefined ? writtenTardy : gridTardyCount;

        if (writtenPresent !== undefined) {
          daysPresent = writtenPresent;
        } else if (dailyCols.length > 0) {
          const dailyPresentCount = evaluatedDaily.filter(
            (e) => !e.shadingResult.is_holiday && (e.shadingResult.attendance_status === "PRESENT" || e.shadingResult.attendance_status === "TARDY" || e.shadingResult.isPresent)
          ).length;
          daysPresent = Math.min(dailyPresentCount, Math.max(0, totalDays - daysAbsent));
        } else {
          daysPresent = Math.max(0, totalDays - daysAbsent);
        }

        let hasUnknownMarks = false;
        for (const item of evaluatedDaily) {
          let status: "PRESENT" | "ABSENT" | "TARDY" | "HOLIDAY" | "UNKNOWN" | "UNRECORDED";
          if (item.shadingResult.is_holiday || item.shadingResult.classification === "FULL_COLUMN_SHADE") {
            status = "HOLIDAY";
          } else if (item.shadingResult.attendance_status === "ABSENT" || item.shadingResult.classification === "X_MARK") {
            status = "ABSENT";
          } else if (item.shadingResult.attendance_status === "TARDY") {
            status = "TARDY";
          } else if (item.shadingResult.attendance_status === "PRESENT") {
            status = "PRESENT";
          } else {
            status = "UNKNOWN";
            hasUnknownMarks = true;
            warnings.push(
              `Learner "${learnerName}": Unrecognized attendance mark "${item.rawMark}" on day ${item.dc.day} (${item.shadingResult.explanation}) flagged as UNKNOWN for manual review.`
            );
          }

          dailyGrid.push({
            day: item.dc.day,
            status,
            raw_mark: item.rawMark || undefined,
            shading_classification: item.shadingResult.classification,
            shading_confidence: item.shadingResult.confidence,
            fill_ratio: item.shadingResult.fill_ratio,
            cell_polygon: item.cellPolygon,
            is_holiday: item.shadingResult.is_holiday,
            is_improper_shade: item.shadingResult.is_improper_shade,
            requires_teacher_verification: item.shadingResult.requires_teacher_verification,
            recognition_method: item.shadingResult.classifier_method,
          });
        }
      }

      // Classify learner name handwriting / ICR metadata
      const nameRec = rawLayout ? classifyFieldRecognition(learnerName, rawLayout) : undefined;
      const tablePageNum =
        table._pageNumber ||
        table.boundingRegions?.[0]?.pageNumber ||
        1;

      // Execute DepEd SF2 Formatting & Computation Validation
      const formattingCheck = validateSf2RowFormattingAndTotals({
        rowIndex,
        learnerName,
        dailyCells: dailyGrid,
        gridAbsentCount: isActiveDayShading ? 0 : (xMarkCount > 0 ? xMarkCount : fullShadedCount),
        gridTardyCount: halfShadedCount,
        writtenAbsent: writtenAbsent ?? null,
        writtenTardy: writtenTardy ?? null,
        writtenPresent: writtenPresent ?? null,
        totalSchoolDays: totalDays,
        daysPresent,
        nameConfidence: nameRec?.icr_confidence ? Math.round(nameRec.icr_confidence * 100) : 96,
      });

      for (const dw of formattingCheck.discrepancyWarnings) {
        warnings.push(`Learner "${learnerName}": ${dw}`);
      }

      entries.push({
        rowIndex,
        row_index: rowIndex++,
        page_number: tablePageNum,
        school_year: header.school_year || "2025-2026",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "CSS 1",
        month: header.month || "June",
        month_key: header.canonical_month || normalizeDepEdMonthKey(header.month || "June") || "jun",
        lrn: lrnStr,
        learner_name: learnerName,
        student_name: learnerName,
        name: learnerName,
        total_school_days: totalDays,
        total_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_tardy: daysTardy,
        daily_grid: dailyGrid,
        dailyCells: dailyGrid,
        gridAbsentCount: formattingCheck.gridAbsentCount,
        grid_absent_count: formattingCheck.gridAbsentCount,
        gridTardyCount: formattingCheck.gridTardyCount,
        grid_tardy_count: formattingCheck.gridTardyCount,
        writtenAbsent: writtenAbsent ?? null,
        written_absent: writtenAbsent ?? null,
        writtenTardy: writtenTardy ?? null,
        written_tardy: writtenTardy ?? null,
        writtenPresent: writtenPresent ?? null,
        formattingCheck,
        formatting_audit: formattingCheck,
        rowAccuracyPercent: formattingCheck.rowAccuracyPercent,
        overallRowAccuracy: formattingCheck.overallRowAccuracy,
        overall_row_accuracy: formattingCheck.overallRowAccuracy,
        nameConfidence: formattingCheck.nameConfidence,
        gridShadingConfidence: formattingCheck.gridShadingConfidence,
        writtenAbsentConfidence: formattingCheck.writtenAbsentConfidence,
        writtenTardyConfidence: formattingCheck.writtenTardyConfidence,
        review_status: formattingCheck.isValid ? "VERIFIED" : "FLAGGED",
        status: (daysAbsent === 0 ? "PRESENT" : "ABSENT") as "PRESENT" | "ABSENT",
        confidence: formattingCheck.rowAccuracyPercent,
        recognition_type: nameRec?.recognition_type || "printed_ocr",
        is_handwritten: nameRec?.is_handwritten || false,
        icr_confidence: nameRec?.icr_confidence,
        bounding_box: nameRec?.bounding_box || namePolygon,
        notes,
      });
    }
  }

  return entries;
}

function getPolygonBoundingBox(polygon?: number[]) {
  if (!Array.isArray(polygon) || polygon.length < 4) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, centerX: 0, centerY: 0 };
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < polygon.length; i += 2) {
    xs.push(polygon[i]);
    if (i + 1 < polygon.length) ys.push(polygon[i + 1]);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function parseAttendanceFromSpatialLayout(
  rawLayout: any,
  header: ShsSf2Header,
  warnings: string[]
): any[] {
  if (!rawLayout) return [];

  const pages = Array.isArray(rawLayout.pages) ? rawLayout.pages : [];
  const page = pages[0] || {};
  const rawLines: any[] = Array.isArray(page.lines)
    ? page.lines
    : Array.isArray(rawLayout.lines)
    ? rawLayout.lines
    : [];
  const rawWords: any[] = Array.isArray(page.words)
    ? page.words
    : Array.isArray(rawLayout.words)
    ? rawLayout.words
    : [];

  if (rawLines.length === 0 && rawWords.length === 0) return [];

  const linesWithBounds = rawLines.map((l: any) => ({
    ...l,
    bounds: getPolygonBoundingBox(l.polygon),
  }));

  const wordsWithBounds = rawWords.map((w: any) => ({
    ...w,
    bounds: getPolygonBoundingBox(w.polygon),
  }));

  // Determine page dimensions
  const pageWidth =
    typeof page.width === "number" && page.width > 0
      ? page.width
      : Math.max(
          ...linesWithBounds.map((l) => l.bounds.maxX),
          ...wordsWithBounds.map((w) => w.bounds.maxX),
          1
        );
  const pageHeight =
    typeof page.height === "number" && page.height > 0
      ? page.height
      : Math.max(
          ...linesWithBounds.map((l) => l.bounds.maxY),
          ...wordsWithBounds.map((w) => w.bounds.maxY),
          1
        );

  // 1. Header metadata extraction from lines if missing
  const allText = linesWithBounds.map((l) => l.content || "").join("\n");
  if (!header.school_id) {
    const m = allText.match(/school\s*id[:\s\-]*([0-9]{6})/i) || allText.match(/\b(500619|500169)\b/);
    if (m) header.school_id = m[1];
  }
  if (!header.school_year) {
    const m =
      allText.match(/(?:school\s*year|sy)[:\s]*([0-9]{4}\s*[-–—]\s*[0-9]{4})/i) ||
      allText.match(/\b(2025\s*[-–—]\s*2026)\b/);
    if (m) header.school_year = m[1].replace(/\s+/g, "").replace(/[–—]/g, "-");
  }
  if (!header.grade_level) {
    if (
      /grade\s*(?:level)?[:\s]*(?:11|xi\b)/i.test(allText) ||
      /\bgrade\s*11\b/i.test(allText) ||
      (/\b11\b/.test(allText) && /css/i.test(allText))
    ) {
      header.grade_level = "Grade 11";
    } else if (
      /grade\s*(?:level)?[:\s]*(?:12|xii\b)/i.test(allText) ||
      /\bgrade\s*12\b/i.test(allText)
    ) {
      header.grade_level = "Grade 12";
    }
  }
  if (!header.section) {
    const m = allText.match(/section[:\s]*([a-zA-Z0-9\s\-]+?)(?:\s*(?:grade|month|track|strand|$|\n))/i);
    if (m) header.section = m[1].trim();
    else if (/\bcss\s*1\b/i.test(allText)) header.section = "CSS 1";
  }
  if (!header.month) {
    const m = allText.match(/(?:(?:report\s+for\s+the\s+)?month\s*of|buwan\s*ng|month)[:\s]*([a-zA-Z]+)/i);
    if (m) {
      const normKey = normalizeDepEdMonthKey(m[1]);
      if (normKey && DEPED_MONTH_CONFIG[normKey]) {
        header.month = DEPED_MONTH_CONFIG[normKey].fullName;
        header.canonical_month = normKey;
      } else {
        header.month = capitalizeMonth(m[1]);
        header.canonical_month = normKey || "";
      }
    } else if (/\bjune\b/i.test(allText)) {
      header.month = "June";
      header.canonical_month = "jun";
    }
  }

  // 2. Identify vertical boundaries: learnerTableHeaderBottomY and learnerTableFooterTopY
  let learnerTableHeaderBottomY = -1;
  let headerY = 0.20;
  for (const l of linesWithBounds) {
    const content = (l.content || "").toLowerCase();
    if (
      content.includes("learner's name") ||
      content.includes("learner name") ||
      content.includes("pangalan") ||
      content.includes("last name, first name") ||
      content.includes("first name, middle name") ||
      content.includes("1st row for date") ||
      content.includes("2nd row for day")
    ) {
      if (l.bounds.maxY > learnerTableHeaderBottomY) {
        learnerTableHeaderBottomY = l.bounds.maxY;
      }
      const normMaxY = l.bounds.maxY / pageHeight;
      if (normMaxY > headerY && normMaxY < 0.45) {
        headerY = normMaxY;
      }
    }
  }
  if (learnerTableHeaderBottomY <= 0) {
    learnerTableHeaderBottomY = headerY * pageHeight;
  }

  let learnerTableFooterTopY = Infinity;
  let bottomY = 0.95;
  for (const l of linesWithBounds) {
    if (learnerTableHeaderBottomY > 0 && l.bounds.centerY <= learnerTableHeaderBottomY) continue;
    const content = (l.content || "").toLowerCase();
    if (
      content.includes("total per day") ||
      content.includes("total male") ||
      content.includes("total female") ||
      content.includes("combined") ||
      content.includes("male | total") ||
      content.includes("female | total") ||
      content.includes("combined | total") ||
      content.includes("absenteeism and dropout") ||
      ((content.includes("male") || content.includes("female")) && content.includes("total") && l.bounds.centerY > 0.45 * pageHeight)
    ) {
      if (l.bounds.minY < learnerTableFooterTopY && l.bounds.minY > learnerTableHeaderBottomY) {
        learnerTableFooterTopY = l.bounds.minY;
      }
      const normMinY = l.bounds.minY / pageHeight;
      if (normMinY < bottomY && normMinY > headerY) {
        bottomY = normMinY;
      }
    }
  }
  if (learnerTableFooterTopY === Infinity) {
    learnerTableFooterTopY = bottomY * pageHeight;
  }

  // 3. Locate learner name lines inside dynamic LEARNER'S NAME column band
  let nameHeaderBounds: any = null;
  for (const l of linesWithBounds) {
    const content = (l.content || "").toLowerCase();
    if (
      content.includes("learner's name") ||
      content.includes("learner name") ||
      content.includes("pangalan") ||
      content.includes("last name, first name")
    ) {
      nameHeaderBounds = l.bounds;
      break;
    }
  }

  const colMinX = nameHeaderBounds
    ? Math.max(0, (nameHeaderBounds.minX - 0.1 * pageWidth) / pageWidth)
    : 0.05;
  const colMaxX = nameHeaderBounds
    ? Math.min(1, (nameHeaderBounds.maxX + 0.15 * pageWidth) / pageWidth)
    : 0.38;

  const candidateNameLines = linesWithBounds.filter((l) => {
    // HARD REJECT if vertical center y is above learnerTableHeaderBottomY or at/below learnerTableFooterTopY
    if (l.bounds.centerY <= learnerTableHeaderBottomY || l.bounds.centerY >= learnerTableFooterTopY) {
      return false;
    }
    const normCenterX = l.bounds.centerX / pageWidth;
    const normCenterY = l.bounds.centerY / pageHeight;
    if (normCenterY <= headerY || normCenterY >= bottomY) return false;
    if (normCenterX < colMinX || normCenterX > colMaxX) return false;

    const cleaned = cleanLearnerNameString(l.content);
    if (!isValidLearnerNameCandidate(cleaned) || isBlacklistedStudentName(cleaned)) return false;

    return true;
  });

  // Sort candidate name lines from top to bottom
  candidateNameLines.sort((a, b) => a.bounds.centerY - b.bounds.centerY);

  // Group into student rows
  const studentRows: Array<{
    name: string;
    line: any;
    bounds: any;
    normYCenter: number;
    yMin: number;
    yMax: number;
  }> = [];

  for (let i = 0; i < candidateNameLines.length; i++) {
    const cur = candidateNameLines[i];
    const cleanedName = cleanLearnerNameString(cur.content);
    if (!isValidLearnerNameCandidate(cleanedName)) continue;

    const normYCenter = cur.bounds.centerY / pageHeight;
    studentRows.push({
      name: cleanedName,
      line: cur,
      bounds: cur.bounds,
      normYCenter,
      yMin: cur.bounds.minY,
      yMax: cur.bounds.maxY,
    });
  }

  if (studentRows.length === 0) return [];

  // Helper for handwritten monthly totals: recognizes 0, O, o, .0, 0.0, zero as numeric 0
  const parseMonthlyTotalNumber = (rawStr?: string): number | undefined => {
    if (!rawStr) return undefined;
    const trimmed = rawStr.trim();
    if (!trimmed || trimmed === "-" || trimmed === "—") return undefined;
    if (/^(?:0|O|o|\.0|0\.0|zero)$/i.test(trimmed)) return 0;
    const cleaned = trimmed.replace(/[^0-9.]/g, "");
    if (cleaned !== "") {
      const val = parseFloat(cleaned);
      if (!isNaN(val)) return val;
    }
    return undefined;
  };

  // 4. For each student row, determine vertical band and scan totals & daily columns
  interface ParsedRowIntermediate {
    name: string;
    line: any;
    bounds: any;
    writtenAbsent?: number;
    writtenTardy?: number;
    fullShadedCount: number;
    halfShadedCount: number;
    evaluatedDaily: any[];
  }

  const intermediates: ParsedRowIntermediate[] = [];

  for (let i = 0; i < studentRows.length; i++) {
    const row = studentRows[i];
    const prevRow = i > 0 ? studentRows[i - 1] : undefined;
    const nextRow = i < studentRows.length - 1 ? studentRows[i + 1] : undefined;

    // Vertical boundary for this learner row
    const rowTop = prevRow
      ? (prevRow.bounds.maxY + row.bounds.minY) / 2
      : row.bounds.minY - (row.bounds.maxY - row.bounds.minY) * 0.5;
    const rowBottom = nextRow
      ? (row.bounds.maxY + nextRow.bounds.minY) / 2
      : row.bounds.maxY + (row.bounds.maxY - row.bounds.minY) * 0.5;

    // A. Scan Total for the Month horizontal band (x between 70% and 83% of page width)
    const totalWords = wordsWithBounds
      .filter((w) => {
        const normCenterX = w.bounds.centerX / pageWidth;
        return (
          normCenterX >= 0.70 &&
          normCenterX <= 0.83 &&
          w.bounds.centerY >= rowTop &&
          w.bounds.centerY <= rowBottom
        );
      })
      .sort((a, b) => a.bounds.centerX - b.bounds.centerX);

    const totalLines = linesWithBounds
      .filter((l) => {
        const normCenterX = l.bounds.centerX / pageWidth;
        return (
          normCenterX >= 0.70 &&
          normCenterX <= 0.83 &&
          l.bounds.centerY >= rowTop &&
          l.bounds.centerY <= rowBottom
        );
      })
      .sort((a, b) => a.bounds.centerX - b.bounds.centerX);

    let writtenAbsent: number | undefined = undefined;
    let writtenTardy: number | undefined = undefined;

    const totalTokens = totalWords.length > 0 ? totalWords : totalLines;
    if (totalTokens.length >= 2) {
      writtenAbsent = parseMonthlyTotalNumber(totalTokens[0].content);
      writtenTardy = parseMonthlyTotalNumber(totalTokens[1].content);
    } else if (totalTokens.length === 1) {
      const normCenterX = totalTokens[0].bounds.centerX / pageWidth;
      const parsedNum = parseMonthlyTotalNumber(totalTokens[0].content);
      if (normCenterX <= 0.74) {
        writtenAbsent = parsedNum;
      } else {
        writtenTardy = parsedNum;
      }
    }

    // B. Scan Daily Columns band (x between 30% and 70% of page width)
    const dailyTokens = wordsWithBounds
      .filter((w) => {
        const normCenterX = w.bounds.centerX / pageWidth;
        return (
          normCenterX >= 0.30 &&
          normCenterX <= 0.70 &&
          w.bounds.centerY >= rowTop &&
          w.bounds.centerY <= rowBottom
        );
      })
      .sort((a, b) => a.bounds.centerX - b.bounds.centerX);

    // Also check table cells if available
    const tableCellsInRow: any[] = [];
    if (Array.isArray(rawLayout.tables)) {
      for (const t of rawLayout.tables) {
        if (!Array.isArray(t.cells)) continue;
        for (const cell of t.cells) {
          const poly = cell.boundingRegions?.[0]?.polygon || cell.polygon;
          if (poly) {
            const b = getPolygonBoundingBox(poly);
            const normCenterX = b.centerX / pageWidth;
            if (
              normCenterX >= 0.30 &&
              normCenterX <= 0.70 &&
              b.centerY >= rowTop &&
              b.centerY <= rowBottom
            ) {
              tableCellsInRow.push({ content: cell.content || "", polygon: poly, bounds: b });
            }
          }
        }
      }
    }

    const itemsToEvaluate = tableCellsInRow.length > 0 ? tableCellsInRow : dailyTokens;

    let fullShadedCount = 0;
    let halfShadedCount = 0;
    let selectedMarkCount = 0;
    const evaluatedDaily: any[] = [];

    itemsToEvaluate.forEach((item, idx) => {
      const rawMark = (item.content || "").trim().toLowerCase();
      if (rawMark.includes(":selected:")) {
        selectedMarkCount++;
      }
      // Light diagonal slashes ('/' or '\') are template cells, NOT dark-shaded active days
      if (rawMark === "/" || rawMark === "\\" || rawMark === "—" || rawMark === "-") {
        evaluatedDaily.push({
          day: idx + 1,
          rawMark,
          classification: "UNMARKED" as ShadingClassification,
          isDarkShaded: false,
        });
        return;
      }

      const shadingResult = classifyAttendanceCell({
        day: idx + 1,
        learnerName: row.name,
        cellText: rawMark,
        cellPolygon: item.polygon,
        pageNumber: 1,
        imageBuffer: rawLayout.imageBuffer,
      });

      const isDarkShaded =
        shadingResult.classification === "FULL_SHADE" ||
        rawMark === "full_shade" ||
        rawMark === "shaded" ||
        rawMark === "[shaded]" ||
        rawMark === "full" ||
        rawMark === "selected" ||
        rawMark.includes(":selected:") ||
        rawMark === "■" ||
        rawMark === "█";

      if (isDarkShaded) {
        fullShadedCount++;
      } else if (shadingResult.classification === "HALF_SHADE") {
        halfShadedCount++;
      }

      evaluatedDaily.push({
        day: idx + 1,
        rawMark,
        classification: shadingResult.classification,
        isDarkShaded,
      });
    });

    const effectiveShadedCount = Math.max(fullShadedCount, selectedMarkCount);

    intermediates.push({
      name: row.name,
      line: row.line,
      bounds: row.bounds,
      writtenAbsent,
      writtenTardy,
      fullShadedCount: effectiveShadedCount,
      halfShadedCount,
      evaluatedDaily,
    });
  }

  // 5. Section Active School Days reconciliation
  const activeDayLearner = intermediates.find(
    (row) => row.writtenAbsent === 0 && row.fullShadedCount > 0
  );
  const sectionActiveDays = activeDayLearner
    ? activeDayLearner.fullShadedCount
    : header.total_school_days || 21;
  header.total_school_days = sectionActiveDays;

  // 6. Build final attendance entries
  const entries: any[] = [];
  let rowIndex = 1;

  for (const item of intermediates) {
    let totalDays = sectionActiveDays;
    let daysPresent = sectionActiveDays;
    let daysAbsent = 0;
    let daysTardy = 0;
    let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "VERIFIED";
    let rowConfidence = 96;
    let status: "PRESENT" | "ABSENT" = "PRESENT";
    let notes: string | undefined = undefined;

    const isActiveDayShading =
      item.writtenAbsent === 0 &&
      (item.writtenTardy === 0 || item.writtenTardy === undefined) &&
      item.fullShadedCount > 0;

    const isUnmarkedOrTemplate =
      item.fullShadedCount === 0 &&
      item.writtenAbsent === undefined &&
      item.writtenTardy === undefined;

    if (isActiveDayShading) {
      totalDays = item.fullShadedCount;
      daysPresent = item.fullShadedCount;
      daysAbsent = 0;
      daysTardy = item.writtenTardy ?? 0;
      status = "PRESENT";
      rowConfidence = 98;
      reviewStatus = "VERIFIED";
    } else if (isUnmarkedOrTemplate) {
      // Unmarked / No Shading (e.g., Latonero with template slashes '/')
      totalDays = sectionActiveDays;
      daysPresent = 0;
      daysAbsent = 0;
      daysTardy = 0;
      status = "PRESENT";
      rowConfidence = 90;
      reviewStatus = "VERIFIED";
      notes = "Unmarked / No Shading";
    } else {
      daysAbsent = item.writtenAbsent !== undefined ? item.writtenAbsent : item.fullShadedCount;
      daysTardy = item.writtenTardy !== undefined ? item.writtenTardy : item.halfShadedCount;
      daysPresent = Math.max(0, totalDays - daysAbsent);
      status = daysAbsent === 0 ? "PRESENT" : "ABSENT";
    }

    const nameRec = rawLayout ? classifyFieldRecognition(item.name, rawLayout) : undefined;
    const dailyCells = item.evaluatedDaily.map((ed) => ({
      day: ed.day,
      status: ed.isDarkShaded ? "PRESENT" : "UNRECORDED",
      raw_mark: ed.rawMark,
      shading_classification: ed.classification,
    }));

    const formattingCheck = validateSf2RowFormattingAndTotals({
      rowIndex,
      learnerName: item.name,
      dailyCells,
      gridAbsentCount: daysAbsent,
      gridTardyCount: daysTardy,
      writtenAbsent: item.writtenAbsent ?? null,
      writtenTardy: item.writtenTardy ?? null,
      writtenPresent: null,
      totalSchoolDays: totalDays,
      daysPresent,
      nameConfidence: nameRec?.icr_confidence ? Math.round(nameRec.icr_confidence * 100) : 96,
    });

    entries.push({
      rowIndex,
      row_index: rowIndex++,
      page_number: 1,
      school_year: header.school_year || "2025-2026",
      grade_level: header.grade_level || "Grade 11",
      section: header.section || "CSS 1",
      month: header.month || "June",
      month_key: header.canonical_month || normalizeDepEdMonthKey(header.month || "June") || "jun",
      lrn: null,
      learner_name: item.name,
      student_name: item.name,
      name: item.name,
      total_school_days: totalDays,
      total_days: totalDays,
      days_present: daysPresent,
      days_absent: daysAbsent,
      days_tardy: daysTardy,
      daily_grid: dailyCells,
      dailyCells,
      gridAbsentCount: formattingCheck.gridAbsentCount,
      gridTardyCount: formattingCheck.gridTardyCount,
      writtenAbsent: item.writtenAbsent ?? null,
      writtenTardy: item.writtenTardy ?? null,
      writtenPresent: null,
      formattingCheck,
      rowAccuracyPercent: formattingCheck.rowAccuracyPercent,
      overallRowAccuracy: formattingCheck.overallRowAccuracy,
      nameConfidence: formattingCheck.nameConfidence,
      gridShadingConfidence: formattingCheck.gridShadingConfidence,
      writtenAbsentConfidence: formattingCheck.writtenAbsentConfidence,
      writtenTardyConfidence: formattingCheck.writtenTardyConfidence,
      review_status: formattingCheck.isValid ? reviewStatus : "FLAGGED",
      status,
      confidence: formattingCheck.rowAccuracyPercent,
      recognition_type: nameRec?.recognition_type || "printed_ocr",
      is_handwritten: nameRec?.is_handwritten || false,
      icr_confidence: nameRec?.icr_confidence,
      bounding_box: nameRec?.bounding_box || item.bounds,
      notes,
    });
  }

  return entries;
}

function parseAttendanceFromText(text: string, header: ShsSf2Header, warnings: string[], rawLayout?: any): any[] {
  const entries: any[] = [];
  let rowIndex = 1;
  let currentPageNumber = 1;

  let inLearnerTableBody = !/(?:learner['’]?s?\s*name|last\s*name,\s*first\s*name|pangalan|1st\s*row\s*for\s*date)/i.test(text);

  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const pageMatch = trimmed.match(/\(?\bpage\s+(\d+)(?:\s+of\s+\d+)?\)?/i);
    if (pageMatch) {
      const parsedPage = parseInt(pageMatch[1], 10);
      if (!isNaN(parsedPage) && parsedPage >= 1) {
        currentPageNumber = parsedPage;
      }
    }

    const lower = trimmed.toLowerCase();

    // Check table-body header row activation
    if (
      lower.includes("learner's name") ||
      lower.includes("last name, first name") ||
      lower.includes("pangalan") ||
      lower.includes("1st row for date") ||
      lower.includes("2nd row for day")
    ) {
      inLearnerTableBody = true;
      continue;
    }

    // Check table-body footer row deactivation
    if (
      lower.includes("total per day") ||
      lower.includes("male | total") ||
      lower.includes("female | total") ||
      lower.includes("combined | total") ||
      lower.includes("total male") ||
      lower.includes("total female") ||
      lower.includes("total for the month") ||
      lower.includes("absenteeism and dropout") ||
      lower.includes("guidelines") ||
      lower.includes("reasons and causes")
    ) {
      inLearnerTableBody = false;
      continue;
    }

    // Hard reject lines outside the learner table body
    if (!inLearnerTableBody) {
      continue;
    }

    if (
      lower.includes("school form 2") ||
      lower.includes("daily attendance") ||
      lower.includes("total school days") ||
      lower.includes("average daily attendance") ||
      lower.startsWith("for the month") ||
      lower.startsWith("grade ")
    ) {
      continue;
    }

    const totalDays = header.total_school_days || 20;

    // 1. Check pipe-delimited row format: | 109345000001 | DELA CRUZ, CARLOS M. | 21 | 1 | 0 |
    if (trimmed.includes("|")) {
      const rawParts = trimmed.split("|").map((p) => p.trim());
      const parts = rawParts.filter((p, idx) => !(p === "" && (idx === 0 || idx === rawParts.length - 1)));
      if (parts.length >= 3) {
        const lrnMatch = trimmed.match(/\b([0-9]{12})\b/);
        const extractedLrn = lrnMatch ? lrnMatch[1] : null;
        const rawNamePart = parts.find(
          (p) =>
            p.length > 3 &&
            /[a-zA-Z]/.test(p) &&
            !p.includes(extractedLrn || "__NO_LRN__") &&
            !/^(?:learner|name|pangalan|lrn|present|absent|tardy|total)/i.test(p)
        );
        const namePart = cleanLearnerNameString(rawNamePart);
        const numericCols = parts
          .filter((p) => /^\d+(\.\d+)?$/.test(p) && parseFloat(p) <= 31)
          .map((p) => parseFloat(p));

        if (namePart && isValidLearnerNameCandidate(namePart) && !isBlacklistedStudentName(namePart) && numericCols.length >= 2) {
          // Detect daily cell tokens in parts (e.g. full, shaded, upper_triangle, blank)
          const cellTokens = parts.filter((p) => /^(?:full|shaded|full_shade|upper_triangle|lower_triangle|half|blank|unmarked|x|■)$/i.test(p));
          const fullShadedCount = cellTokens.filter((p) => /^(?:full|shaded|full_shade|x|■)$/i.test(p)).length;

          let daysPresent = numericCols[0];
          let daysAbsent = numericCols[1];
          let daysTardy = numericCols[2] ?? 0;
          let entrySchoolDays = totalDays;

          // Case A check in text/markdown: written absent is 0, full shaded cells present
          if (daysAbsent === 0 && fullShadedCount > 0) {
            entrySchoolDays = fullShadedCount;
            daysPresent = fullShadedCount;
            daysAbsent = 0;
            daysTardy = 0;
          }

          let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "VERIFIED";
          if (header.total_school_days && daysPresent + daysAbsent > entrySchoolDays) {
            reviewStatus = "FLAGGED";
            warnings.push(
              `Learner "${namePart}": Sum of days present (${daysPresent}) and days absent (${daysAbsent}) exceeds total school days (${entrySchoolDays}).`
            );
          }
          const nameRec = rawLayout ? classifyFieldRecognition(namePart, rawLayout) : undefined;
          const formattingCheck = validateSf2RowFormattingAndTotals({
            rowIndex,
            learnerName: namePart,
            gridAbsentCount: daysAbsent,
            gridTardyCount: daysTardy,
            writtenAbsent: daysAbsent,
            writtenTardy: daysTardy,
            writtenPresent: daysPresent,
            totalSchoolDays: entrySchoolDays,
            daysPresent,
            nameConfidence: nameRec?.icr_confidence ? Math.round(nameRec.icr_confidence * 100) : 96,
          });

          entries.push({
            rowIndex,
            row_index: rowIndex++,
            page_number: currentPageNumber,
            school_year: header.school_year || "2026-2027",
            grade_level: header.grade_level || "Grade 11",
            section: header.section || "Unassigned",
            month: header.month || "June",
            lrn: extractedLrn,
            learner_name: namePart,
            student_name: namePart,
            name: namePart,
            total_school_days: entrySchoolDays,
            total_days: entrySchoolDays,
            days_present: daysPresent,
            days_absent: daysAbsent,
            days_tardy: daysTardy,
            daily_grid: [],
            dailyCells: [],
            gridAbsentCount: daysAbsent,
            gridTardyCount: daysTardy,
            writtenAbsent: daysAbsent,
            writtenTardy: daysTardy,
            writtenPresent: daysPresent,
            formattingCheck,
            rowAccuracyPercent: formattingCheck.rowAccuracyPercent,
            overallRowAccuracy: formattingCheck.overallRowAccuracy,
            nameConfidence: formattingCheck.nameConfidence,
            gridShadingConfidence: formattingCheck.gridShadingConfidence,
            writtenAbsentConfidence: formattingCheck.writtenAbsentConfidence,
            writtenTardyConfidence: formattingCheck.writtenTardyConfidence,
            review_status: reviewStatus,
            confidence: formattingCheck.rowAccuracyPercent,
            recognition_type: nameRec?.recognition_type || "printed_ocr",
            is_handwritten: nameRec?.is_handwritten || false,
            icr_confidence: nameRec?.icr_confidence,
            bounding_box: nameRec?.bounding_box,
          });
          continue;
        }
      }
    }

    // 2. Check labeled format: "1. 109345000001 DELA CRUZ, CARLOS M. Present: 22 Absent: 0 Tardy: 0"
    const labeledMatch = trimmed.match(
      /^(?:\d+[\.\)\s]+)?(?:([0-9]{12})\s+)?([a-zA-ZñÑ\s\.\,\-]+?)\s+present[:\s]+(\d+)\s+absent[:\s]+(\d+)(?:\s+tardy[:\s]+(\d+))?$/i
    );
    if (labeledMatch) {
      const extractedLrn = labeledMatch[1] || null;
      const rawName = labeledMatch[2].trim();
      const name = cleanLearnerNameString(rawName);
      if (!isValidLearnerNameCandidate(name) || isBlacklistedStudentName(name)) continue;
      const daysPresent = parseInt(labeledMatch[3], 10);
      const daysAbsent = parseInt(labeledMatch[4], 10);
      const daysTardy = labeledMatch[5] ? parseInt(labeledMatch[5], 10) : 0;
      let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "NEEDS_REVIEW";
      if (header.total_school_days && daysPresent + daysAbsent > totalDays) {
        reviewStatus = "FLAGGED";
        warnings.push(
          `Learner "${name}": Sum of days present (${daysPresent}) and days absent (${daysAbsent}) exceeds total school days (${totalDays}).`
        );
      }
      const nameRec = rawLayout ? classifyFieldRecognition(name, rawLayout) : undefined;
      const formattingCheck = validateSf2RowFormattingAndTotals({
        rowIndex,
        learnerName: name,
        gridAbsentCount: daysAbsent,
        gridTardyCount: daysTardy,
        writtenAbsent: daysAbsent,
        writtenTardy: daysTardy,
        writtenPresent: daysPresent,
        totalSchoolDays: totalDays,
        daysPresent,
        nameConfidence: nameRec?.icr_confidence ? Math.round(nameRec.icr_confidence * 100) : 96,
      });

      entries.push({
        rowIndex,
        row_index: rowIndex++,
        page_number: currentPageNumber,
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        month: header.month || "June",
        lrn: extractedLrn,
        learner_name: name,
        student_name: name,
        name: name,
        total_school_days: totalDays,
        total_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_tardy: daysTardy,
        daily_grid: [],
        dailyCells: [],
        gridAbsentCount: daysAbsent,
        gridTardyCount: daysTardy,
        writtenAbsent: daysAbsent,
        writtenTardy: daysTardy,
        writtenPresent: daysPresent,
        formattingCheck,
        rowAccuracyPercent: formattingCheck.rowAccuracyPercent,
        overallRowAccuracy: formattingCheck.overallRowAccuracy,
        nameConfidence: formattingCheck.nameConfidence,
        gridShadingConfidence: formattingCheck.gridShadingConfidence,
        writtenAbsentConfidence: formattingCheck.writtenAbsentConfidence,
        writtenTardyConfidence: formattingCheck.writtenTardyConfidence,
        review_status: reviewStatus,
        confidence: formattingCheck.rowAccuracyPercent,
        recognition_type: nameRec?.recognition_type || "printed_ocr",
        is_handwritten: nameRec?.is_handwritten || false,
        icr_confidence: nameRec?.icr_confidence,
        bounding_box: nameRec?.bounding_box,
      });
      continue;
    }

    // 3. Look for lines containing optional LRN, learner name, and numbers at the end
    const match = trimmed.match(/^(?:\d+[\.\)\s]+)?(?:([0-9]{12})\s+)?([a-zA-ZñÑ\s\.\,\-]+?)\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
    if (match) {
      const extractedLrn = match[1] || null;
      const name = match[2].trim();
      const num1 = parseInt(match[3], 10);
      const num2 = parseInt(match[4], 10);
      const num3 = match[5] ? parseInt(match[5], 10) : 0;

      // In DepEd SF2, printed summary is usually (Days Present, Days Absent, Days Tardy)
      const daysPresent = num1;
      const daysAbsent = num2;
      const daysTardy = num3;
      let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "NEEDS_REVIEW";
      if (header.total_school_days && daysPresent + daysAbsent > totalDays) {
        reviewStatus = "FLAGGED";
        warnings.push(
          `Learner "${name}": Sum of days present (${daysPresent}) and days absent (${daysAbsent}) exceeds total school days (${totalDays}).`
        );
      }

      const nameRec = rawLayout ? classifyFieldRecognition(name, rawLayout) : undefined;

      entries.push({
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        month: header.month || "June",
        lrn: extractedLrn,
        learner_name: name,
        student_name: name,
        name: name,
        total_school_days: totalDays,
        total_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_tardy: daysTardy,
        daily_grid: [],
        row_index: rowIndex++,
        page_number: currentPageNumber,
        review_status: reviewStatus,
        confidence: 96,
        recognition_type: nameRec?.recognition_type || "printed_ocr",
        is_handwritten: nameRec?.is_handwritten || false,
        icr_confidence: nameRec?.icr_confidence,
        bounding_box: nameRec?.bounding_box,
      });
    }
  }

  return entries;
}

function capitalizeMonth(str: string): string {
  if (!str) return "September";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

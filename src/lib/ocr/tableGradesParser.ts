/**
 * Azure Document Intelligence Layout Table Parser for DepEd Academic Grades.
 *
 * Extracts structured subject grades and attendance from analyzeResult.tables.
 * Strictly adheres to AVV Grade Safety rules:
 * - Zero grade inference / calculation
 * - Preserves raw numeric candidates (e.g. 32 stays 32, 0 stays 0)
 * - Excludes Observed Values & Grading Scale tables
 * - Captures non-numeric DepEd marks (INC, DRP)
 */

import type { GradeRecord, AttendanceRecord, ExtractedFields, LearnersObservedValues, LearnerProgressAndAchievement, GradingScaleItem } from "@/types/documents";
import { evaluateAttendanceData, parseAttendanceNumber, isConcatenatedZeros, parseAttendanceTotalNumber } from "../attendance/attendanceEvaluator";
import { normalizeGradeRecords, evaluateDynamicGradeStatus, normalizeObservedValueMarking, sanitizeLearnersObservedValues, sanitizeAndRecoverDepEdGrade } from "../validation/gradeUtils";
import { classifyFieldRecognition } from "./handwritingExtractor";
import { parseAzureObservedValuesTable, parseAzureGradingScaleTable } from "./observedValuesParser";

export { normalizeObservedValueMarking, sanitizeLearnersObservedValues, sanitizeAndRecoverDepEdGrade };

export interface ParsedTableGradesResult {
  grades: GradeRecord[];
  attendance?: AttendanceRecord[];
  attendance_months?: string[];
  attendance_confidence?: number;
  attendance_totals?: {
    computed_school_days?: number;
    computed_days_present?: number;
    computed_days_absent?: number;
    is_school_days_complete?: boolean;
    is_days_present_complete?: boolean;
    is_days_absent_complete?: boolean;
    printed_school_days?: number;
    printed_days_present?: number;
    printed_days_absent?: number;
  };
  attendance_percentage?: number;
  absence_percentage?: number;
  attendance_risk_status?: "NORMAL" | "ATTENDANCE_WARNING" | "ATTENDANCE_REVIEW_REQUIRED" | "INCOMPLETE_ATTENDANCE_DATA";
  attendance_discrepancy_details?: string[];
  general_average?: number;
  general_average_confidence?: number;
  sem1_general_average?: number;
  sem1_confidence?: number;
  sem2_general_average?: number;
  sem2_confidence?: number;
  observed_values?: LearnersObservedValues;
  learner_progress_achievement?: LearnerProgressAndAchievement;
  grading_scale?: LearnerProgressAndAchievement | GradingScaleItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXCLUDED_OBSERVED_VALUES_KEYWORDS = [
  "core values",
  "behavior statements",
  "maka-diyos",
  "makatao",
  "makakalikasan",
  "makabansa",
  "expresses one's spiritual",
  "ethical principles",
];

const EXCLUDED_GRADING_SCALE_KEYWORDS = [
  "grading scale",
  "descriptors",
  "did not meet expectation",
  "very satisfactory",
  "fairly satisfactory",
  "90-100",
  "85-89",
  "80-84",
  "75-79",
  "below 75",
];

const ATTENDANCE_KEYWORDS = [
  "no. of school days",
  "no. of days",
  "days present",
  "days absent",
  "attendance",
];

const MONTH_KEYWORDS = [
  "jun", "jul", "aug", "sept", "sep", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may"
];

const CATEGORY_KEYWORDS = [
  "core subject",
  "core subjects",
  "applied subject",
  "applied subjects",
  "specialized subject",
  "specialized subjects",
  "applied and specialized",
  "applied and specialized subjects",
  "applied & specialized",
  "applied & specialized subjects",
  "institutional subjects",
  "other subjects",
];

function isCategoryHeader(subjectText: string): { isCategory: boolean; normalizedCategory?: string } {
  const lower = subjectText.toLowerCase().replace(/[\s\t]+/g, " ").trim();
  if (
    lower === "core subjects" ||
    lower === "core subject" ||
    lower.startsWith("core subjects") ||
    lower.startsWith("core subject")
  ) {
    return { isCategory: true, normalizedCategory: "Core Subjects" };
  }
  if (
    lower === "applied and specialized subjects" ||
    lower === "applied and specialized" ||
    lower === "applied & specialized subjects" ||
    lower === "applied & specialized" ||
    lower === "applied subjects" ||
    lower === "specialized subjects" ||
    lower.startsWith("applied and specialized") ||
    lower.startsWith("applied & specialized")
  ) {
    return { isCategory: true, normalizedCategory: "Applied and Specialized Subjects" };
  }
  const isMatch = CATEGORY_KEYWORDS.some((kw) => lower === kw || lower.includes(kw));
  return { isCategory: isMatch, normalizedCategory: isMatch ? subjectText.trim() : undefined };
}

const GENERAL_AVERAGE_KEYWORDS = [
  "general average",
  "general average for the semester",
  "general weighted average",
  "general ave",
  "general ave.",
  "general ave for the semester",
  "general ave. for the semester",
  "gen. ave",
  "gen ave",
  "gwa",
];

/**
 * Clean cell content and parse numeric or string mark without fabrication.
 */
function parseGradeCell(content: string | undefined): number | string | undefined {
  if (!content) return undefined;
  const trimmed = content.trim();

  // Strip empty/unselected place-markers
  if (
    trimmed === "" ||
    trimmed === "-" ||
    trimmed === "—" ||
    trimmed === "_" ||
    trimmed.toLowerCase() === ":unselected:" ||
    trimmed.toLowerCase() === ":selected:"
  ) {
    return undefined;
  }

  // Official DepEd non-numeric marks
  const upper = trimmed.toUpperCase();
  if (upper === "INC" || upper === "DRP" || upper === "DROP" || upper === "N/A") {
    return upper === "DROP" ? "DRP" : upper;
  }

  // Pure numeric check: accepts integers and decimals, including 0 and unusual numbers like 32
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) {
    const val = parseFloat(numMatch[1]);
    if (!isNaN(val)) return val;
  }

  // If mixed text contains a number (e.g. "85*"), extract without altering value
  const embeddedMatch = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (embeddedMatch) {
    const val = parseFloat(embeddedMatch[1]);
    if (!isNaN(val)) return val;
  }

  return undefined;
}

/**
 * Detect and split merged quarter cell strings containing two DepEd grades (60–100)
 * separated by space or newline (e.g. "88\n88", "75\n95", "70 98").
 */
export function extractTwoQuarterGrades(cellText?: string | null): [number, number] | null {
  if (!cellText) return null;
  const cleaned = String(cellText).replace(/\\n/g, " ").replace(/\//g, " ");
  const matches = (cleaned.match(/\b(6\d|7\d|8\d|9\d|100)\b/g) || []).map(Number);
  return matches.length >= 2 ? [matches[0], matches[1]] : null;
}

/**
 * Checks if a table is the DepEd Observed Values (Core Values) table.
 */
function isObservedValuesTable(table: any): boolean {
  if (!Array.isArray(table?.cells)) return false;
  return table.cells.some((cell: any) => {
    const text = (cell.content || "").toLowerCase();
    return EXCLUDED_OBSERVED_VALUES_KEYWORDS.some((kw) => text.includes(kw));
  });
}

/**
 * Checks if a table is the DepEd Grading Scale / Legend table.
 */
function isGradingScaleTable(table: any): boolean {
  if (!Array.isArray(table?.cells)) return false;
  return table.cells.some((cell: any) => {
    const text = (cell.content || "").toLowerCase();
    return EXCLUDED_GRADING_SCALE_KEYWORDS.some((kw) => text.includes(kw));
  });
}

/**
 * Checks if a table represents learner attendance.
 */
function isAttendanceTable(table: any): boolean {
  if (!Array.isArray(table?.cells)) return false;
  return table.cells.some((cell: any) => {
    const text = (cell.content || "").toLowerCase();
    return ATTENDANCE_KEYWORDS.some((kw) => text.includes(kw));
  });
}

/**
 * Converts Azure table cells into a 2D grid matrix of row x column strings.
 */
function buildCellMatrix(table: any): string[][] {
  const rowCount = table.rowCount || 0;
  const colCount = table.columnCount || 0;
  const matrix: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => "")
  );

  for (const cell of table.cells || []) {
    const r = cell.rowIndex ?? 0;
    const c = cell.columnIndex ?? 0;
    const content = (cell.content || "").replace(/[\r\n]+/g, " ").trim();
    if (r < rowCount && c < colCount) {
      matrix[r][c] = content;
    }
  }

  return matrix;
}

function buildCellConfidenceMatrix(table: any): (number | undefined)[][] {
  const rowCount = table.rowCount || 0;
  const colCount = table.columnCount || 0;
  const matrix: (number | undefined)[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => undefined)
  );

  for (const cell of table.cells || []) {
    const r = cell.rowIndex ?? 0;
    const c = cell.columnIndex ?? 0;
    if (r < rowCount && c < colCount) {
      const conf = typeof cell.confidence === "number" ? cell.confidence : undefined;
      matrix[r][c] = conf;
    }
  }

  return matrix;
}

function normalizeCellConfidencePct(conf?: number | null, fallback: number = 95): number {
  if (conf === undefined || conf === null || isNaN(conf)) return fallback;
  if (conf > 0 && conf <= 1) return Math.min(100, Math.max(0, Math.round(conf * 100)));
  return Math.min(100, Math.max(0, Math.round(conf)));
}

// ---------------------------------------------------------------------------
// Main Azure Layout Table Parser
// ---------------------------------------------------------------------------

/**
 * Parse structured tables from Azure Document Intelligence layout into GradeRecord[].
 */
export function parseAzureLayoutGrades(rawTables?: any[], rawLayout?: any): ParsedTableGradesResult {
  const result: ParsedTableGradesResult = {
    grades: [],
  };

  if (!Array.isArray(rawTables) || rawTables.length === 0) {
    return result;
  }

  let docGradeLevel: "Grade 11" | "Grade 12" | undefined = undefined;
  let academicTableCount = 0;

  for (let tableIdx = 0; tableIdx < rawTables.length; tableIdx++) {
    const table = rawTables[tableIdx];
    if (!table || !Array.isArray(table.cells) || table.cells.length === 0) {
      continue;
    }

    // 1. Observed Values & Grading Scale Extraction (Strictly excluded from academic grades)
    if (isObservedValuesTable(table)) {
      try {
        const ov = parseAzureObservedValuesTable(table);
        if (ov) {
          result.observed_values = sanitizeLearnersObservedValues(ov);
        }
      } catch (err) {
        console.warn("[tableGradesParser] Error parsing Observed Values table:", err);
      }
      continue;
    }
    if (isGradingScaleTable(table)) {
      try {
        const gs = parseAzureGradingScaleTable(table);
        if (gs) {
          result.learner_progress_achievement = gs;
          result.grading_scale = gs;
        }
      } catch (err) {
        console.warn("[tableGradesParser] Error parsing Grading Scale table:", err);
      }
      continue;
    }

    // 2. Attendance Table Detection (Phase C & D)
    if (isAttendanceTable(table)) {
      const matrix = buildCellMatrix(table);
      const attendanceRecords: AttendanceRecord[] = [];
      let months: string[] = [];
      let totalColIdx = -1;

      for (let r = 0; r < matrix.length; r++) {
        const row = matrix[r];
        const label = row[0] || "";
        const lowerLabel = label.toLowerCase();

        // Check if row has month headers
        const rowMonths = row.slice(1).filter((c) => {
          const l = c.toLowerCase();
          return MONTH_KEYWORDS.some((kw) => l === kw || l.includes(kw));
        });
        if (rowMonths.length >= 4) {
          // Suriin kung may "Total" column sa header row
          const foundTotal = row.findIndex((c, idx) => idx > 0 && c.toLowerCase().includes("total"));
          if (foundTotal > 0) {
            totalColIdx = foundTotal;
            months = row.slice(1, totalColIdx).map((c) => c.trim()).filter(Boolean);
          } else {
            months = row.slice(1).map((c) => c.trim()).filter((c) => {
              const l = c.toLowerCase();
              return MONTH_KEYWORDS.some((kw) => l === kw || l.includes(kw));
            });
          }
          // Ensure Apr (11th month) is never dropped when DepEd calendar starts in Jun
          if (months.length === 10 && months[0].toLowerCase().startsWith("jun") && months[9].toLowerCase().startsWith("mar")) {
            months.push("Apr");
          }
          continue;
        }

        if (ATTENDANCE_KEYWORDS.some((kw) => lowerLabel.includes(kw))) {
          let values: string[] = [];
          let printedTotal: string | undefined = undefined;

          // Panatilihin ang decimal/fractions (0.5, 17.5, 201.5), blangko, dash, at ihiwalay ang Total column
          if (totalColIdx > 0 && totalColIdx < row.length) {
            values = row.slice(1, totalColIdx).map((c) => c.trim());
            const rawTotal = row[totalColIdx]?.trim();
            printedTotal = rawTotal !== "" && rawTotal !== "-" && rawTotal !== "—" ? rawTotal : undefined;
          } else {
            values = row.slice(1).map((c) => c.trim());
          }

          // FIX: 100000000000 Concatenated Zero / Vertical Grid-Line Bug in No. of Days Absent
          const isAbsentRow = lowerLabel.includes("absent") || lowerLabel.includes("lumiban");
          const rowHasConcatZeros =
            isConcatenatedZeros(printedTotal) ||
            values.some((v) => isConcatenatedZeros(v)) ||
            (isAbsentRow && (
              values.length <= 1 ||
              /^1?0{6,14}$/.test(row.slice(1).join("").replace(/[\s\t|]+/g, ""))
            ));

          const targetMonthCount = months.length > 0 ? months.length : 11;

          if (rowHasConcatZeros && isAbsentRow) {
            values = Array.from({ length: targetMonthCount }, () => "0");
            printedTotal = "0";
          } else {
            // Process month cells and separate joined tokens like "17.5/201.5"
            for (let vIdx = 0; vIdx < values.length; vIdx++) {
              let v = values[vIdx];
              if (v.includes("/")) {
                const parts = v.split("/");
                values[vIdx] = parts[0].trim();
                if (!printedTotal && parts[1]) {
                  printedTotal = parts[1].trim();
                }
                v = values[vIdx];
              }

              if (isConcatenatedZeros(v)) {
                values[vIdx] = "0";
              } else {
                // Bounds enforcement: 0 <= month <= 31
                const num = parseFloat(v);
                if (!isNaN(num) && num > 31) {
                  // Grid line '1' prefix artifact e.g. 117.5 -> 17.5
                  if (/^1\d{2}(?:\.\d+)?$/.test(v)) {
                    const rem = parseFloat(v.slice(1));
                    if (!isNaN(rem) && rem <= 31) {
                      values[vIdx] = String(rem);
                    }
                  }
                }
              }
            }

            // Sanitize printedTotal (prefer printed bottom 201.5 over scribbles like 162)
            if (printedTotal !== undefined) {
              if (isConcatenatedZeros(printedTotal)) {
                printedTotal = "0";
              } else {
                const totalNum = parseAttendanceTotalNumber(printedTotal);
                if (totalNum !== undefined) {
                  printedTotal = String(totalNum);
                }
              }
            }
          }

          // Auto-sum ONLY if printed total is blank while monthly numbers exist
          if (printedTotal === undefined || printedTotal === "" || printedTotal === "-" || printedTotal === "—") {
            let autoSum = 0;
            let hasMonthlyNum = false;
            for (const v of values) {
              const num = parseAttendanceNumber(v);
              if (num !== undefined) {
                autoSum += num;
                hasMonthlyNum = true;
              }
            }
            if (hasMonthlyNum) {
              autoSum = Math.round(autoSum * 100) / 100;
              printedTotal = Number.isInteger(autoSum) ? String(autoSum) : String(autoSum);
            }
          }

          // Canonical DepEd metric label normalization
          let normalizedLabel = label.trim();
          if (lowerLabel.includes("school days") || lowerLabel.includes("araw ng pasok")) {
            normalizedLabel = "No. of School Days";
          } else if (lowerLabel.includes("present") || lowerLabel.includes("pumasok")) {
            normalizedLabel = "No. of Days Present";
          } else if (lowerLabel.includes("absent") || lowerLabel.includes("lumiban")) {
            normalizedLabel = "No. of Days Absent";
          }

          // Compute honest row confidence score (0-100%)
          const rowCells = (table.cells || []).filter((cell: any) => cell.rowIndex === r);
          const confs = rowCells.map((c: any) => typeof c.confidence === "number" ? c.confidence : 0.95);
          const avgCellConf = confs.length > 0 ? confs.reduce((a: number, b: number) => a + b, 0) / confs.length : 0.95;
          const validNumCount = values.filter((v) => parseAttendanceNumber(v) !== undefined).length;
          const expectedCount = months.length > 0 ? months.length : Math.max(values.length, 1);
          const completeness = Math.min(validNumCount / expectedCount, 1.0);
          const rowConfidence = Math.round(avgCellConf * (0.4 + 0.6 * completeness) * 100);

          attendanceRecords.push({
            label: normalizedLabel,
            values,
            total: printedTotal,
            confidence: rowConfidence,
            source_side: "front",
          });
        }
      }

      if (attendanceRecords.length > 0) {
        result.attendance = attendanceRecords;
        const totalRowConf = attendanceRecords.reduce((acc, rec) => acc + (rec.confidence ?? 0), 0);
        result.attendance_confidence = Math.round(totalRowConf / attendanceRecords.length);
      }
      if (months.length > 0) {
        result.attendance_months = months;
      }

      // Kalkulahin ang attendance totals, percentage, at warnings kapag may records
      if (attendanceRecords.length > 0 && months.length > 0) {
        const schoolDaysRec = attendanceRecords.find((a) =>
          a.label.toLowerCase().includes("school days") || a.label.toLowerCase().includes("bilang ng araw ng pasok")
        );
        const daysPresentRec = attendanceRecords.find((a) =>
          a.label.toLowerCase().includes("present") || a.label.toLowerCase().includes("pumasok")
        );
        const daysAbsentRec = attendanceRecords.find((a) =>
          a.label.toLowerCase().includes("absent") || a.label.toLowerCase().includes("lumiban")
        );

        const evaluated = evaluateAttendanceData({
          months,
          schoolDaysRow: schoolDaysRec?.values,
          daysPresentRow: daysPresentRec?.values,
          daysAbsentRow: daysAbsentRec?.values,
          printedSchoolDaysTotal: schoolDaysRec?.total,
          printedDaysPresentTotal: daysPresentRec?.total,
          printedDaysAbsentTotal: daysAbsentRec?.total,
        });

        result.attendance_totals = {
          computed_school_days: evaluated.computedSchoolDays,
          computed_days_present: evaluated.computedDaysPresent,
          computed_days_absent: evaluated.computedDaysAbsent,
          is_school_days_complete: evaluated.isSchoolDaysComplete,
          is_days_present_complete: evaluated.isDaysPresentComplete,
          is_days_absent_complete: evaluated.isDaysAbsentComplete,
          printed_school_days: evaluated.printedSchoolDays,
          printed_days_present: evaluated.printedDaysPresent,
          printed_days_absent: evaluated.printedDaysAbsent,
        };
        result.attendance_percentage = evaluated.attendancePercentage;
        result.absence_percentage = evaluated.absencePercentage;
        result.attendance_risk_status = evaluated.riskStatus;
        result.attendance_discrepancy_details = evaluated.discrepancyDetails;
      }
      continue;
    }

    // 3. Academic Subject Grades Table Detection & Classification (Phases 9 & 10)
    const matrix = buildCellMatrix(table);
    const confMatrix = buildCellConfidenceMatrix(table);
    if (matrix.length < 3) continue;

    // Determine semester and column mapping
    const fullTableText = table.cells.map((c: any) => (c.content || "").toLowerCase()).join(" ");

    // Check if table contains academic grade keywords
    const hasAcademicHeaders =
      fullTableText.includes("subject") ||
      fullTableText.includes("learning area") ||
      fullTableText.includes("pamagat") ||
      fullTableText.includes("quarter") ||
      fullTableText.includes("semester final grade") ||
      fullTableText.includes("final grade") ||
      fullTableText.includes("final rating") ||
      fullTableText.includes("core subjects");

    if (!hasAcademicHeaders) {
      continue;
    }

    // Ignore Remedial Classes tables so they never shift column mapping or overwrite regular semesters
    if (
      fullTableText.includes("remedial class") ||
      fullTableText.includes("remedial classes") ||
      fullTableText.includes("recomputed final grade") ||
      fullTableText.includes("remedial class mark")
    ) {
      continue;
    }

    const currentAcademicIdx = academicTableCount++;

    let isSemester1 = false;
    let isSemester2 = false;
    let isFullYearQuarterly = false;
    let tableGradeLevel: "Grade 11" | "Grade 12" | undefined = undefined;

    if (/\bgrade\s*(?:level)?[:\s]*(?:12|xii)\b/i.test(fullTableText)) {
      tableGradeLevel = "Grade 12";
      docGradeLevel = "Grade 12";
    } else if (/\bgrade\s*(?:level)?[:\s]*(?:11|xi)\b/i.test(fullTableText)) {
      tableGradeLevel = "Grade 11";
      docGradeLevel = "Grade 11";
    } else {
      tableGradeLevel = docGradeLevel;
    }

    const firstRowsText = matrix.slice(0, 3).map((r) => r.join(" ")).join(" ").toLowerCase();
    const isSem1Header =
      /\b(?:first\s*semester|1st\s*sem(?:ester)?|sem(?:ester)?[:\s]*1\b|sem[:\s]*i\b)\b/i.test(firstRowsText) ||
      /\b(?:first\s*semester|1st\s*sem(?:ester)?|sem(?:ester)?[:\s]*1\b)\b/i.test(fullTableText);
    const isSem2Header =
      /\b(?:second\s*semester|2nd\s*sem(?:ester)?|sem(?:ester)?[:\s]*2\b|sem[:\s]*ii\b)\b/i.test(firstRowsText) ||
      /\b(?:second\s*semester|2nd\s*sem(?:ester)?|sem(?:ester)?[:\s]*2\b)\b/i.test(fullTableText);

    if (isSem2Header && !isSem1Header) {
      isSemester2 = true;
      isSemester1 = false;
    } else if (isSem1Header && !isSem2Header) {
      isSemester1 = true;
      isSemester2 = false;
    }

    // Inspect header rows (Row 0 and Row 1) for column positioning
    const headerRow0 = matrix[0] || [];
    const headerRow1 = matrix[1] || [];

    const combinedHeadersText = (headerRow0.join(" ") + " " + headerRow1.join(" ") + " " + firstRowsText).toLowerCase();
    const isQ4BeforeQ3 = /\b(?:4th|4|quarter\s*4|q4)\b[^\n\r|]{0,30}\b(?:3rd|3|quarter\s*3|q3)\b/i.test(combinedHeadersText);
    const isQ2BeforeQ1 = /\b(?:2nd|2|quarter\s*2|q2)\b[^\n\r|]{0,30}\b(?:1st|1|quarter\s*1|q1)\b/i.test(combinedHeadersText);

    // If 4th/3rd or quarter 3/4 appears in header or first rows, it is strictly Semester 2
    if (/\b(?:3rd|4th|quarter\s*3|quarter\s*4|q3|q4)\b/i.test(combinedHeadersText)) {
      isSemester2 = true;
      isSemester1 = false;
    } else if (/\b(?:1st|quarter\s*1|q1)\b/i.test(combinedHeadersText) && !/\b(?:3rd|4th)\b/i.test(combinedHeadersText)) {
      isSemester1 = true;
      isSemester2 = false;
    }

    let subjectCol = 0;
    let q1Col = -1;
    let q2Col = -1;
    let q3Col = -1;
    let q4Col = -1;
    let finalGradeCol = -1;
    let remarksCol = -1;

    // Search header rows for column numbers
    for (let c = 0; c < table.columnCount; c++) {
      const h0 = (headerRow0[c] || "").toLowerCase().trim();
      const h1 = (headerRow1[c] || "").toLowerCase().trim();
      const combined = `${h0} ${h1}`.trim();

      if (
        combined.includes("subject") ||
        combined.includes("learning area") ||
        combined.includes("pamagat")
      ) {
        if (!h0.includes("core") && !h0.includes("applied") && !h1.includes("core") && !h1.includes("applied") && !combined.includes("indicate if")) {
          subjectCol = c;
        }
      }

      if (
        h0 === "1" ||
        h1 === "1" ||
        h0 === "1st" ||
        h1 === "1st" ||
        h0 === "q1" ||
        h1 === "q1" ||
        h0 === "quarter 1" ||
        h1 === "quarter 1" ||
        h0.includes("quarter 1") ||
        h1.includes("quarter 1") ||
        h0.includes("1st") ||
        h1.includes("1st") ||
        (combined.includes("quarter") && (h0.includes("1") || h1.includes("1")))
      ) {
        q1Col = c;
      }

      if (
        h0 === "2" ||
        h1 === "2" ||
        h0 === "2nd" ||
        h1 === "2nd" ||
        h0 === "q2" ||
        h1 === "q2" ||
        h0 === "quarter 2" ||
        h1 === "quarter 2" ||
        h0.includes("quarter 2") ||
        h1.includes("quarter 2") ||
        h0.includes("2nd") ||
        h1.includes("2nd") ||
        (combined.includes("quarter") && (h0.includes("2") || h1.includes("2")))
      ) {
        q2Col = c;
      }

      if (
        h0 === "3" ||
        h1 === "3" ||
        h0 === "3rd" ||
        h1 === "3rd" ||
        h0 === "q3" ||
        h1 === "q3" ||
        h0 === "quarter 3" ||
        h1 === "quarter 3" ||
        h0.includes("quarter 3") ||
        h1.includes("quarter 3") ||
        h0.includes("3rd") ||
        h1.includes("3rd") ||
        (combined.includes("quarter") && (h0.includes("3") || h1.includes("3")))
      ) {
        q3Col = c;
      }

      if (
        h0 === "4" ||
        h1 === "4" ||
        h0 === "4th" ||
        h1 === "4th" ||
        h0 === "q4" ||
        h1 === "q4" ||
        h0 === "quarter 4" ||
        h1 === "quarter 4" ||
        h0.includes("quarter 4") ||
        h1.includes("quarter 4") ||
        h0.includes("4th") ||
        h1.includes("4th") ||
        (combined.includes("quarter") && (h0.includes("4") || h1.includes("4")))
      ) {
        q4Col = c;
      }

      if (
        combined.includes("final") ||
        combined.includes("semester final") ||
        combined.includes("sem final")
      ) {
        finalGradeCol = c;
      }

      if (
        combined.includes("action") ||
        combined.includes("remark") ||
        combined.includes("pasya")
      ) {
        remarksCol = c;
      }
    }

    // Determine calendar structure:
    if (q1Col >= 0 && q2Col >= 0 && q3Col >= 0 && q4Col >= 0) {
      // All 4 quarters exist in one table -> Full-Year Elementary / JHS table
      isFullYearQuarterly = true;
      isSemester1 = false;
      isSemester2 = false;
    } else if (q3Col >= 0 || q4Col >= 0 || isSemester2) {
      // Explicit Q3 or Q4 columns present -> strictly Second Semester
      isSemester2 = true;
      isSemester1 = false;
      if (q3Col === -1 && table.columnCount >= 3) q3Col = 1;
      if (q4Col === -1 && table.columnCount >= 4) q4Col = 2;
    } else {
      // Default to First Semester (Q1, Q2)
      isSemester1 = true;
      isSemester2 = false;
      if (q1Col === -1 && table.columnCount >= 3) q1Col = 1;
      if (q2Col === -1 && table.columnCount >= 4) q2Col = 2;
    }

    // Specific column adjustments for DepEd 5-column and 6-column tables
    if (table.columnCount === 5) {
      // Case B (5-column layout): Col 0: Category, Col 1: Subject, Col 2: Quarters (merged), Col 3: Sem Final, Col 4: Action Taken
      if (subjectCol === 0 && (matrix[0]?.[1] || "").toLowerCase().includes("subject")) {
        subjectCol = 1;
      }
      // Only apply merged quarters adjustment if Q1/Q2 or Q3/Q4 are not already distinct columns detected from headers
      const hasDistinctQuarters =
        (isSemester2 && q3Col >= 0 && q4Col >= 0 && q3Col !== q4Col) ||
        (!isSemester2 && q1Col >= 0 && q2Col >= 0 && q1Col !== q2Col);

      if (!hasDistinctQuarters) {
        finalGradeCol = 3;
        remarksCol = 4;
        if (isSemester2) {
          q3Col = 2;
          q4Col = 2;
        } else {
          q1Col = 2;
          q2Col = 2;
        }
      }
    } else if (table.columnCount === 6) {
      // Case A (6-column layout): Col 0: Category, Col 1: Subject, Col 2: Q1/Q3, Col 3: Q2/Q4, Col 4: Sem Final, Col 5: Action Taken
      if (subjectCol === 0 && (matrix[0]?.[1] || "").toLowerCase().includes("subject")) {
        subjectCol = 1;
      }
      if (finalGradeCol === -1 || finalGradeCol === 2 || finalGradeCol === 3) {
        finalGradeCol = 4;
      }
      if (remarksCol === -1) {
        remarksCol = 5;
      }
      if (isSemester2) {
        if (q3Col === -1) q3Col = 2;
        if (q4Col === -1) q4Col = 3;
      } else {
        if (q1Col === -1) q1Col = 2;
        if (q2Col === -1) q2Col = 3;
      }
    } else {
      // Default column fallbacks for final grade column and remarks
      if (finalGradeCol === -1) {
        if (isFullYearQuarterly && table.columnCount >= 6) {
          finalGradeCol = 5;
        } else if (table.columnCount === 4) {
          finalGradeCol = 2;
        } else if (table.columnCount >= 5) {
          finalGradeCol = 3;
        }
      }

      if (remarksCol === -1 && table.columnCount >= 4) {
        remarksCol = table.columnCount - 1;
      }
    }

    // Prevent quarter column from stealing SEM FINAL GRADE column
    if (finalGradeCol >= 0) {
      if (q4Col === finalGradeCol) q4Col = -1;
      if (q2Col === finalGradeCol) q2Col = -1;
    }

    // If still undetermined semester, infer from academic table index (table 0 vs 1)
    if (!isFullYearQuarterly && !isSemester1 && !isSemester2) {
      isSemester1 = currentAcademicIdx === 0;
      isSemester2 = currentAcademicIdx === 1;
    }

    const semesterLabel = isFullYearQuarterly
      ? undefined
      : isSemester2
      ? "2nd Semester"
      : "1st Semester";

    // 4. Extract Subject Rows (Phases 11, 12, 13)
    let currentCategory = "";

    // Data rows typically begin after header rows
    const hasHeaderRow1 = headerRow1.some((c) => {
      const lower = c.toLowerCase().trim();
      return (
        lower === "1" ||
        lower === "2" ||
        lower === "3" ||
        lower === "4" ||
        lower.includes("quarter") ||
        lower.includes("final") ||
        lower.includes("q1") ||
        lower.includes("q2") ||
        lower.includes("q3") ||
        lower.includes("q4")
      );
    });
    const startRow = hasHeaderRow1 ? 2 : 1;

    for (let r = startRow; r < matrix.length; r++) {
      const row = matrix[r];
      let rawSubject = (row[subjectCol] || row[0] || "").trim();
      if (!rawSubject || rawSubject.length < 2) continue;

      const lowerSubject = rawSubject.toLowerCase().trim();

      // Skip table title / column header rows if captured in matrix
      if (
        lowerSubject === "subjects" ||
        lowerSubject === "subject" ||
        lowerSubject === "learning area" ||
        lowerSubject === "learning areas" ||
        lowerSubject === "pamagat" ||
        lowerSubject.includes("report on learning") ||
        lowerSubject.includes("progress and achievement") ||
        lowerSubject.includes("first semester") ||
        lowerSubject.includes("second semester") ||
        lowerSubject.includes("1st semester") ||
        lowerSubject.includes("2nd semester")
      ) {
        continue;
      }

      // Check category headers
      const catCheck = isCategoryHeader(rawSubject);
      if (catCheck.isCategory) {
        currentCategory = catCheck.normalizedCategory || rawSubject;
        continue;
      }

      // Check General Average row
      if (GENERAL_AVERAGE_KEYWORDS.some((kw) => lowerSubject === kw || lowerSubject.includes(kw))) {
        const tableOrDocConf =
          typeof (table as any)?.confidence === "number"
            ? Math.round((table as any).confidence <= 1 ? (table as any).confidence * 100 : (table as any).confidence)
            : typeof rawLayout?.confidence === "number"
            ? Math.round(rawLayout.confidence <= 1 ? rawLayout.confidence * 100 : rawLayout.confidence)
            : 95;

        let foundAvg: number | undefined = undefined;
        let foundConf: number | undefined = undefined;

        // Look for explicit numeric grade in row cells
        for (let c = 1; c < row.length; c++) {
          const parsedAvg = parseGradeCell(row[c]);
          if (typeof parsedAvg === "number" && parsedAvg >= 60 && parsedAvg <= 100) {
            foundAvg = parsedAvg;
            foundConf = confMatrix[r]?.[c] !== undefined
              ? normalizeCellConfidencePct(confMatrix[r]?.[c], tableOrDocConf)
              : tableOrDocConf;
            break;
          }
        }

        // If not found in other cells, check if embedded in row[0] (e.g. "General Ave. for the Semester: 86.5")
        if (foundAvg === undefined) {
          const embeddedInSubject = (row[0] || "").match(/\b(6\d|7\d|8\d|9\d|100)(?:\.\d+)?\b/);
          if (embeddedInSubject) {
            const val = parseFloat(embeddedInSubject[0]);
            if (val >= 60 && val <= 100) {
              foundAvg = val;
              foundConf = confMatrix[r]?.[0] !== undefined
                ? normalizeCellConfidencePct(confMatrix[r]?.[0], tableOrDocConf)
                : tableOrDocConf;
            }
          }
        }

        if (foundAvg !== undefined) {
          result.general_average = foundAvg;
          result.general_average_confidence = foundConf ?? tableOrDocConf;
          if (isSemester1) {
            result.sem1_general_average = foundAvg;
            (result as any).sem1_printed_general_average = foundAvg;
            result.sem1_confidence = foundConf ?? tableOrDocConf;
          } else if (isSemester2) {
            result.sem2_general_average = foundAvg;
            (result as any).sem2_printed_general_average = foundAvg;
            result.sem2_confidence = foundConf ?? tableOrDocConf;
          }
        }
        continue;
      }

      // SF10-SHS Trailing-Quarter Subject Cell Splitter:
      // If subject ends with a 2-digit DepEd grade (60-100) separated by whitespace,
      // strip the grade from the subject title (preserving course numbers like 1 or 2 (< 60)).
      let trailingQuarterGrade: number | undefined = undefined;
      const trailingSubjectMatch = rawSubject.match(/^(.*?)\s+(6\d|7\d|8\d|9\d|100)(?:\.0+)?$/);
      if (trailingSubjectMatch) {
        const candTitle = trailingSubjectMatch[1].trim();
        if (/[A-Za-z]{3,}/.test(candTitle)) {
          rawSubject = candTitle;
          trailingQuarterGrade = parseFloat(trailingSubjectMatch[2]);
        }
      }

      // Extract numeric grades and remarks from subsequent cells in row
      const remainingCells = row.slice(subjectCol + 1);
      const rowNumbers: number[] = [];
      let rowAction: string | undefined = undefined;

      for (const c of remainingCells) {
        const trimmedCell = (c || "").trim();
        if (!trimmedCell) continue;
        if (/^(?:PASSED|PASS|FAILED|FAIL|INC|DRP|DROPPED)$/i.test(trimmedCell)) {
          rowAction = trimmedCell.toUpperCase();
          if (rowAction === "PASS") rowAction = "PASSED";
          if (rowAction === "FAIL") rowAction = "FAILED";
          continue;
        }
        const twoQuarters = extractTwoQuarterGrades(trimmedCell);
        if (twoQuarters) {
          rowNumbers.push(twoQuarters[0], twoQuarters[1]);
          continue;
        }
        const gradeVal = parseGradeCell(trimmedCell);
        if (typeof gradeVal === "number" && gradeVal >= 60 && gradeVal <= 100) {
          rowNumbers.push(gradeVal);
        }
      }

      // Extract quarterly marks (with trailing quarter and merged quarter cell splitting)
      let q1: number | string | undefined;
      let q2: number | string | undefined;
      let q3: number | string | undefined;
      let q4: number | string | undefined;
      let semFinal: number | string | undefined;

      if (trailingQuarterGrade !== undefined) {
        // Trailing-quarter grade was stripped from subject cell:
        // Assign stripped number as first quarter column (q3 in Sem 2, q1 in Sem 1),
        // next column as second quarter column (q4 in Sem 2, q2 in Sem 1),
        // and SEM FINAL GRADE column as finalGrade!
        if (isSemester2) {
          q3 = trailingQuarterGrade;
          q4 = rowNumbers[0];
          semFinal = rowNumbers[1];
        } else {
          q1 = trailingQuarterGrade;
          q2 = rowNumbers[0];
          semFinal = rowNumbers[1];
        }
      } else if (rowNumbers.length >= 3) {
        if (isSemester2) {
          if (isQ4BeforeQ3) {
            q4 = rowNumbers[0];
            q3 = rowNumbers[1];
          } else {
            q3 = rowNumbers[0];
            q4 = rowNumbers[1];
          }
          semFinal = rowNumbers[2];
        } else {
          q1 = rowNumbers[0];
          q2 = rowNumbers[1];
          semFinal = rowNumbers[2];
        }
      } else {
        if (isFullYearQuarterly) {
          q1 = q1Col >= 0 ? parseGradeCell(row[q1Col]) : (rowNumbers.length > 0 ? rowNumbers[0] : undefined);
          q2 = q2Col >= 0 ? parseGradeCell(row[q2Col]) : (rowNumbers.length > 1 ? rowNumbers[1] : undefined);
          q3 = q3Col >= 0 ? parseGradeCell(row[q3Col]) : (rowNumbers.length > 2 ? rowNumbers[2] : undefined);
          q4 = q4Col >= 0 ? parseGradeCell(row[q4Col]) : (rowNumbers.length > 3 ? rowNumbers[3] : undefined);
          if (rowNumbers.length >= 5) semFinal = rowNumbers[4];
        } else if (isSemester2) {
          const quarterCellVal = q3Col >= 0 ? row[q3Col] : (q4Col >= 0 ? row[q4Col] : row[1]);
          const mergedQ2 = extractTwoQuarterGrades(quarterCellVal);
          if (mergedQ2) {
            if (isQ4BeforeQ3) {
              q4 = mergedQ2[0];
              q3 = mergedQ2[1];
            } else {
              q3 = mergedQ2[0];
              q4 = mergedQ2[1];
            }
          } else {
            q3 = q3Col >= 0 ? parseGradeCell(row[q3Col]) : (rowNumbers.length > 0 ? rowNumbers[0] : undefined);
            q4 = q4Col >= 0 && q4Col !== finalGradeCol ? parseGradeCell(row[q4Col]) : (rowNumbers.length > 1 ? rowNumbers[1] : undefined);
          }
        } else {
          const quarterCellVal1 = q1Col >= 0 ? row[q1Col] : (q2Col >= 0 ? row[q2Col] : row[1]);
          const mergedQ1 = extractTwoQuarterGrades(quarterCellVal1);
          if (mergedQ1) {
            if (isQ2BeforeQ1) {
              q2 = mergedQ1[0];
              q1 = mergedQ1[1];
            } else {
              q1 = mergedQ1[0];
              q2 = mergedQ1[1];
            }
          } else {
            q1 = q1Col >= 0 ? parseGradeCell(row[q1Col]) : (rowNumbers.length > 0 ? rowNumbers[0] : undefined);
            q2 = q2Col >= 0 && q2Col !== finalGradeCol ? parseGradeCell(row[q2Col]) : (rowNumbers.length > 1 ? rowNumbers[1] : undefined);
          }
        }
      }

      // Determine default cell confidence from row cells, table confidence, or document readability confidence (90–96%)
      const rowCellConfs: number[] = [];
      for (let c = 0; c < (confMatrix[r]?.length || 0); c++) {
        const val = confMatrix[r]?.[c];
        if (typeof val === "number" && !isNaN(val)) {
          rowCellConfs.push(val <= 1 ? Math.round(val * 100) : Math.round(val));
        }
      }
      const rowAvgConf = rowCellConfs.length > 0
        ? Math.round(rowCellConfs.reduce((a, b) => a + b, 0) / rowCellConfs.length)
        : undefined;

      const docOrTableConf =
        typeof (table as any)?.confidence === "number"
          ? Math.round((table as any).confidence <= 1 ? (table as any).confidence * 100 : (table as any).confidence)
          : typeof rawLayout?.confidence === "number"
          ? Math.round(rawLayout.confidence <= 1 ? rawLayout.confidence * 100 : rawLayout.confidence)
          : 95;

      const defaultCellConf = rowAvgConf ?? docOrTableConf;

      let q1Conf = q1Col >= 0
        ? (confMatrix[r]?.[q1Col] !== undefined
            ? normalizeCellConfidencePct(confMatrix[r]?.[q1Col])
            : (q1 !== undefined && q1 !== null ? defaultCellConf : undefined))
        : (q1 !== undefined && q1 !== null ? defaultCellConf : undefined);
      let q2Conf = q2Col >= 0
        ? (confMatrix[r]?.[q2Col] !== undefined
            ? normalizeCellConfidencePct(confMatrix[r]?.[q2Col])
            : (q2 !== undefined && q2 !== null ? defaultCellConf : undefined))
        : (q2 !== undefined && q2 !== null ? defaultCellConf : undefined);
      let q3Conf = q3Col >= 0
        ? (confMatrix[r]?.[q3Col] !== undefined
            ? normalizeCellConfidencePct(confMatrix[r]?.[q3Col])
            : (q3 !== undefined && q3 !== null ? defaultCellConf : undefined))
        : (q3 !== undefined && q3 !== null ? defaultCellConf : undefined);
      let q4Conf = q4Col >= 0
        ? (confMatrix[r]?.[q4Col] !== undefined
            ? normalizeCellConfidencePct(confMatrix[r]?.[q4Col])
            : (q4 !== undefined && q4 !== null ? defaultCellConf : undefined))
        : (q4 !== undefined && q4 !== null ? defaultCellConf : undefined);

      if (q1 !== undefined && q1 !== null && (q1Conf === undefined || isNaN(q1Conf))) q1Conf = defaultCellConf;
      if (q2 !== undefined && q2 !== null && (q2Conf === undefined || isNaN(q2Conf))) q2Conf = q1Conf ?? defaultCellConf;
      if (q3 !== undefined && q3 !== null && (q3Conf === undefined || isNaN(q3Conf))) q3Conf = defaultCellConf;
      if (q4 !== undefined && q4 !== null && (q4Conf === undefined || isNaN(q4Conf))) q4Conf = q3Conf ?? defaultCellConf;
      let finalGradeVal = semFinal !== undefined
        ? semFinal
        : finalGradeCol >= 0
        ? parseGradeCell(row[finalGradeCol])
        : undefined;
      let finalConf = finalGradeCol >= 0
        ? (confMatrix[r]?.[finalGradeCol] !== undefined
            ? normalizeCellConfidencePct(confMatrix[r]?.[finalGradeCol])
            : (finalGradeVal !== undefined && finalGradeVal !== null ? defaultCellConf : undefined))
        : (finalGradeVal !== undefined && finalGradeVal !== null ? defaultCellConf : undefined);

      // Homoglyph recovery for quarterly marks (e.g. 16 -> 86, 19 -> 79, 8 -> 88)
      if (q1 !== undefined && q1 !== null) {
        const recQ1 = sanitizeAndRecoverDepEdGrade({
          rawGrade: q1,
          siblingQuarter: typeof q2 === "number" ? q2 : undefined,
          confidencePercent: q1Conf,
        });
        if (recQ1.wasRecovered && recQ1.grade !== null) {
          q1 = recQ1.grade;
          q1Conf = Math.min(q1Conf ?? 95, 85);
        }
      }
      if (q2 !== undefined && q2 !== null) {
        const recQ2 = sanitizeAndRecoverDepEdGrade({
          rawGrade: q2,
          siblingQuarter: typeof q1 === "number" ? q1 : undefined,
          confidencePercent: q2Conf,
        });
        if (recQ2.wasRecovered && recQ2.grade !== null) {
          q2 = recQ2.grade;
          q2Conf = Math.min(q2Conf ?? 95, 85);
        }
      }
      if (q3 !== undefined && q3 !== null) {
        const recQ3 = sanitizeAndRecoverDepEdGrade({
          rawGrade: q3,
          siblingQuarter: typeof q4 === "number" ? q4 : undefined,
          confidencePercent: q3Conf,
        });
        if (recQ3.wasRecovered && recQ3.grade !== null) {
          q3 = recQ3.grade;
          q3Conf = Math.min(q3Conf ?? 95, 85);
        }
      }
      if (q4 !== undefined && q4 !== null) {
        const recQ4 = sanitizeAndRecoverDepEdGrade({
          rawGrade: q4,
          siblingQuarter: typeof q3 === "number" ? q3 : undefined,
          confidencePercent: q4Conf,
        });
        if (recQ4.wasRecovered && recQ4.grade !== null) {
          q4 = recQ4.grade;
          q4Conf = Math.min(q4Conf ?? 95, 85);
        }
      }

      const qAVal = typeof q1 === "number" ? q1 : typeof q3 === "number" ? q3 : undefined;
      const qBVal = typeof q2 === "number" ? q2 : typeof q4 === "number" ? q4 : undefined;

      semFinal = finalGradeVal;
      let candidateFinal = semFinal;
      if (candidateFinal !== undefined && candidateFinal !== null) {
        const recFin = sanitizeAndRecoverDepEdGrade({
          rawGrade: candidateFinal,
          q1: qAVal,
          q2: qBVal,
          confidencePercent: finalConf,
        });
        if (recFin.wasRecovered && recFin.grade !== null) {
          candidateFinal = recFin.grade;
          semFinal = recFin.grade;
          finalConf = Math.min(finalConf ?? 95, 85);
        }
      }

      // Extract field OCR confidence
      const gradeRec = rawLayout ? classifyFieldRecognition(rawSubject, rawLayout) : undefined;
      const fieldConf =
        finalConf ??
        gradeRec?.confidence ??
        gradeRec?.icr_confidence ??
        (typeof (table as any)?.confidence === "number" ? (table as any).confidence : undefined) ??
        (typeof rawLayout?.confidence === "number" ? rawLayout.confidence : undefined) ??
        0.95;

      const rawRemark = rowAction || (remarksCol >= 0 ? row[remarksCol] : undefined);
      const gradeEval = evaluateDynamicGradeStatus({
        grade: candidateFinal,
        rawRemark: rawRemark ? String(rawRemark).trim() : undefined,
        confidencePercent: fieldConf,
        q1: qAVal,
        q2: qBVal,
      });

      // Status and verification flag evaluation
      let status: "Passed" | "Failed" | "Missing" =
        gradeEval.status === "passed" ? "Passed" : gradeEval.status === "failed" ? "Failed" : "Missing";
      let needsVerification =
        candidateFinal === undefined ||
        gradeEval.isLowConfidence ||
        gradeEval.status === "not_recognized" ||
        (typeof candidateFinal === "number" && candidateFinal >= 72 && candidateFinal <= 77);

      // Borderline quarterly check
      const quarterNumericValues = [q1, q2, q3, q4].filter((v) => typeof v === "number") as number[];
      if (quarterNumericValues.some((v) => v >= 72 && v <= 77)) {
        needsVerification = true;
      }

      // In SHS semestral mode, subjects are semester-specific and grade-level-specific and must NEVER merge across semesters or grade levels.
      // Only merge if within the same grade_level, same semester, and same subject (e.g. split row in single table).
      const existingIdx = isFullYearQuarterly
        ? result.grades.findIndex((g) => g.subject.toLowerCase() === rawSubject.toLowerCase())
        : result.grades.findIndex(
            (g) =>
              Boolean(g) &&
              (!tableGradeLevel || !g.grade_level || g.grade_level === tableGradeLevel) &&
              g?.semester === semesterLabel &&
              g.subject?.toLowerCase() === rawSubject.toLowerCase()
          );

      if (existingIdx >= 0) {
        // Merge quarters into existing subject record within the SAME calendar scope
        const existing = result.grades[existingIdx];
        if (q1 !== undefined) existing.q1 = q1;
        if (q2 !== undefined) existing.q2 = q2;
        if (q3 !== undefined) existing.q3 = q3;
        if (q4 !== undefined) existing.q4 = q4;
        if (q1Conf !== undefined) { existing.q1Confidence = q1Conf; existing.q1_confidence = q1Conf; }
        if (q2Conf !== undefined) { existing.q2Confidence = q2Conf; existing.q2_confidence = q2Conf; }
        if (q3Conf !== undefined) { existing.q3Confidence = q3Conf; existing.q3_confidence = q3Conf; }
        if (q4Conf !== undefined) { existing.q4Confidence = q4Conf; existing.q4_confidence = q4Conf; }
        if (semFinal !== undefined) {
          if (isSemester2) {
            existing.sem2_final_grade = semFinal;
          } else if (isSemester1) {
            existing.sem1_final_grade = semFinal;
          }
          existing.final = semFinal;
          existing.status = status;
          existing.remarks = gradeEval.remarkDisplay;
          existing.remark = gradeEval.remarkDisplay;
          existing.finalGradeConfidence = finalConf;
          existing.final_confidence = finalConf;
        }
        if (needsVerification) existing.needsVerification = true;
        if (existing.confidence === undefined) {
          existing.confidence = fieldConf;
        }
      } else {
        let rowCategory = currentCategory;
        if (subjectCol > 0 && row[0]) {
          const catCheckRow = isCategoryHeader(row[0]);
          if (catCheckRow.isCategory) {
            rowCategory = catCheckRow.normalizedCategory || row[0].trim();
          } else if (/^(?:core|applied|specialized)/i.test(row[0].trim())) {
            rowCategory = row[0].trim().toUpperCase();
          }
        }

        const record: GradeRecord = {
          category: rowCategory || undefined,
          subject: rawSubject,
          semester: semesterLabel,
          grade_level: tableGradeLevel,
          grading_period_scheme: isFullYearQuarterly ? "quarterly" : "quarterly_semestral",
          q1,
          q2,
          q3,
          q4,
          final: candidateFinal,
          status,
          remarks: gradeEval.remarkDisplay,
          remark: gradeEval.remarkDisplay,
          needsVerification,
          confidence: fieldConf,
          q1Confidence: q1Conf,
          q2Confidence: q2Conf,
          q3Confidence: q3Conf,
          q4Confidence: q4Conf,
          finalGradeConfidence: finalConf,
          q1_confidence: q1Conf,
          q2_confidence: q2Conf,
          q3_confidence: q3Conf,
          q4_confidence: q4Conf,
          final_confidence: finalConf,
          recognition_type: gradeRec?.recognition_type || "printed_ocr",
          is_handwritten: gradeRec?.is_handwritten || false,
          icr_confidence: gradeRec?.icr_confidence,
          bounding_box: gradeRec?.bounding_box,
        };

        if (isSemester2) {
          record.sem2_final_grade = candidateFinal;
        } else if (isSemester1) {
          record.sem1_final_grade = candidateFinal;
        }

        result.grades.push(record);
      }
    }
  }

  if (result.grades.length > 0) {
    result.grades = normalizeGradeRecords(result.grades);
  }

  return result;
}

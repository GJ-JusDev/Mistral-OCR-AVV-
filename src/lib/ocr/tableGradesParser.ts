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

import type { GradeRecord, AttendanceRecord, ExtractedFields } from "@/types/documents";
import { evaluateAttendanceData } from "../attendance/attendanceEvaluator";

export interface ParsedTableGradesResult {
  grades: GradeRecord[];
  attendance?: AttendanceRecord[];
  attendance_months?: string[];
  attendance_totals?: {
    computed_school_days?: number;
    computed_days_present?: number;
    computed_days_absent?: number;
    printed_school_days?: number;
    printed_days_present?: number;
    printed_days_absent?: number;
  };
  attendance_percentage?: number;
  absence_percentage?: number;
  attendance_risk_status?: "NORMAL" | "ATTENDANCE_WARNING" | "ATTENDANCE_REVIEW_REQUIRED" | "INCOMPLETE_ATTENDANCE_DATA";
  attendance_discrepancy_details?: string[];
  general_average?: number;
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
  "gen. ave",
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

// ---------------------------------------------------------------------------
// Main Azure Layout Table Parser
// ---------------------------------------------------------------------------

/**
 * Parse structured tables from Azure Document Intelligence layout into GradeRecord[].
 */
export function parseAzureLayoutGrades(rawTables?: any[]): ParsedTableGradesResult {
  const result: ParsedTableGradesResult = {
    grades: [],
  };

  if (!Array.isArray(rawTables) || rawTables.length === 0) {
    return result;
  }

  for (let tableIdx = 0; tableIdx < rawTables.length; tableIdx++) {
    const table = rawTables[tableIdx];
    if (!table || !Array.isArray(table.cells) || table.cells.length === 0) {
      continue;
    }

    // 1. Explicit Exclusions (Phases 8 & 10)
    if (isObservedValuesTable(table)) {
      continue;
    }
    if (isGradingScaleTable(table)) {
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
          continue;
        }

        if (ATTENDANCE_KEYWORDS.some((kw) => lowerLabel.includes(kw))) {
          let values: string[] = [];
          let printedTotal: string | undefined = undefined;

          // Panatilihin ang decimal/fractions (0.5, 19.5) at ihiwalay ang Total column
          if (totalColIdx > 0 && totalColIdx < row.length) {
            values = row.slice(1, totalColIdx).map((c) => c.replace(/[^0-9.]/g, "").trim());
            const rawTotal = row[totalColIdx]?.replace(/[^0-9.]/g, "").trim();
            printedTotal = rawTotal !== "" ? rawTotal : undefined;
          } else {
            values = row.slice(1).map((c) => c.replace(/[^0-9.]/g, "").trim());
          }

          attendanceRecords.push({ label, values, total: printedTotal });
        }
      }

      if (attendanceRecords.length > 0) {
        result.attendance = attendanceRecords;
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

    let isSemester1 = false;
    let isSemester2 = false;
    let isFullYearQuarterly = false;

    if (fullTableText.includes("first semester") || fullTableText.includes("1st semester")) {
      isSemester1 = true;
    }
    if (fullTableText.includes("second semester") || fullTableText.includes("2nd semester")) {
      isSemester2 = true;
    }

    // Inspect header rows (Row 0 and Row 1) for column positioning
    const headerRow0 = matrix[0] || [];
    const headerRow1 = matrix[1] || [];

    let subjectCol = 0;
    let q1Col = -1;
    let q2Col = -1;
    let q3Col = -1;
    let q4Col = -1;
    let finalGradeCol = -1;

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
        if (!h0.includes("core") && !h0.includes("applied") && !h1.includes("core") && !h1.includes("applied")) {
          subjectCol = c;
        }
      }

      if (
        h0 === "1" ||
        h1 === "1" ||
        h0 === "q1" ||
        h1 === "q1" ||
        h0 === "quarter 1" ||
        h1 === "quarter 1" ||
        h0.includes("quarter 1") ||
        h1.includes("quarter 1") ||
        (combined.includes("quarter") && (h0.includes("1") || h1.includes("1")))
      ) {
        q1Col = c;
      }

      if (
        h0 === "2" ||
        h1 === "2" ||
        h0 === "q2" ||
        h1 === "q2" ||
        h0 === "quarter 2" ||
        h1 === "quarter 2" ||
        h0.includes("quarter 2") ||
        h1.includes("quarter 2") ||
        (combined.includes("quarter") && (h0.includes("2") || h1.includes("2")))
      ) {
        q2Col = c;
      }

      if (
        h0 === "3" ||
        h1 === "3" ||
        h0 === "q3" ||
        h1 === "q3" ||
        h0 === "quarter 3" ||
        h1 === "quarter 3" ||
        h0.includes("quarter 3") ||
        h1.includes("quarter 3") ||
        (combined.includes("quarter") && (h0.includes("3") || h1.includes("3")))
      ) {
        q3Col = c;
      }

      if (
        h0 === "4" ||
        h1 === "4" ||
        h0 === "q4" ||
        h1 === "q4" ||
        h0 === "quarter 4" ||
        h1 === "quarter 4" ||
        h0.includes("quarter 4") ||
        h1.includes("quarter 4") ||
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
    }

    // Determine calendar structure:
    if (q1Col >= 0 && q2Col >= 0 && q3Col >= 0 && q4Col >= 0) {
      // All 4 quarters exist in one table -> Full-Year Elementary / JHS table
      isFullYearQuarterly = true;
      isSemester1 = false;
      isSemester2 = false;
    } else if (isSemester2 || (q3Col >= 0 || q4Col >= 0)) {
      isSemester2 = true;
      isSemester1 = false;
      if (q3Col === -1 && q1Col >= 0) q3Col = q1Col;
      if (q4Col === -1 && q2Col >= 0) q4Col = q2Col;
      if (q3Col === -1 && table.columnCount >= 3) q3Col = 1;
      if (q4Col === -1 && table.columnCount >= 3) q4Col = 2;
    } else {
      isSemester1 = true;
      isSemester2 = false;
      if (q1Col === -1 && table.columnCount >= 3) q1Col = 1;
      if (q2Col === -1 && table.columnCount >= 3) q2Col = 2;
    }

    // Default column fallbacks for final grade column
    if (finalGradeCol === -1 && table.columnCount >= 4) {
      finalGradeCol = isFullYearQuarterly ? 5 : 3;
    }

    // If still undetermined semester, infer from table index if table 1 vs 2
    if (!isFullYearQuarterly && !isSemester1 && !isSemester2) {
      isSemester1 = tableIdx === 0;
      isSemester2 = tableIdx === 1;
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
      const rawSubject = (row[subjectCol] || "").trim();
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
        // Look for explicit numeric grade in the row
        for (let c = 1; c < row.length; c++) {
          const parsedAvg = parseGradeCell(row[c]);
          if (typeof parsedAvg === "number") {
            result.general_average = parsedAvg;
            break;
          }
        }
        continue;
      }

      // Extract quarterly marks
      let q1: number | string | undefined;
      let q2: number | string | undefined;
      let q3: number | string | undefined;
      let q4: number | string | undefined;

      if (isFullYearQuarterly) {
        q1 = q1Col >= 0 ? parseGradeCell(row[q1Col]) : undefined;
        q2 = q2Col >= 0 ? parseGradeCell(row[q2Col]) : undefined;
        q3 = q3Col >= 0 ? parseGradeCell(row[q3Col]) : undefined;
        q4 = q4Col >= 0 ? parseGradeCell(row[q4Col]) : undefined;
      } else if (isSemester2) {
        q3 = q3Col >= 0 ? parseGradeCell(row[q3Col]) : undefined;
        q4 = q4Col >= 0 ? parseGradeCell(row[q4Col]) : undefined;
      } else {
        q1 = q1Col >= 0 ? parseGradeCell(row[q1Col]) : undefined;
        q2 = q2Col >= 0 ? parseGradeCell(row[q2Col]) : undefined;
      }

      const finalGradeVal = finalGradeCol >= 0 ? parseGradeCell(row[finalGradeCol]) : undefined;

      // Final grade candidates (Do NOT calculate or infer!)
      const semFinal = finalGradeVal;

      // Status and verification flag evaluation
      let status: "Passed" | "Failed" | "Missing" = "Missing";
      let needsVerification = false;

      const candidateFinal = semFinal;
      if (candidateFinal !== undefined) {
        if (typeof candidateFinal === "number") {
          status = candidateFinal < 75 ? "Failed" : "Passed";
          if (candidateFinal >= 72 && candidateFinal <= 77) {
            needsVerification = true;
          }
        } else {
          // Non-numeric mark (e.g. INC, DRP)
          status = "Missing";
          needsVerification = true;
        }
      } else {
        status = "Missing";
        needsVerification = true;
      }

      // Borderline quarterly check
      const quarterNumericValues = [q1, q2, q3, q4].filter((v) => typeof v === "number") as number[];
      if (quarterNumericValues.some((v) => v >= 72 && v <= 77)) {
        needsVerification = true;
      }

      // In SHS semestral mode, subjects are semester-specific and must NEVER merge across semesters.
      // Only merge if within the same semester and same subject (e.g. split row in single table).
      const existingIdx = isFullYearQuarterly
        ? result.grades.findIndex((g) => g.subject.toLowerCase() === rawSubject.toLowerCase())
        : result.grades.findIndex(
            (g) =>
              g.semester === semesterLabel &&
              g.subject.toLowerCase() === rawSubject.toLowerCase()
          );

      if (existingIdx >= 0) {
        // Merge quarters into existing subject record within the SAME calendar scope
        const existing = result.grades[existingIdx];
        if (q1 !== undefined) existing.q1 = q1;
        if (q2 !== undefined) existing.q2 = q2;
        if (q3 !== undefined) existing.q3 = q3;
        if (q4 !== undefined) existing.q4 = q4;
        if (semFinal !== undefined) {
          if (isSemester2) {
            existing.sem2_final_grade = semFinal;
          } else if (isSemester1) {
            existing.sem1_final_grade = semFinal;
          }
          existing.final = semFinal;
          existing.status = status;
        }
        if (needsVerification) existing.needsVerification = true;
      } else {
        const record: GradeRecord = {
          category: currentCategory || undefined,
          subject: rawSubject,
          semester: semesterLabel,
          grading_period_scheme: isFullYearQuarterly ? "quarterly" : "quarterly_semestral",
          q1,
          q2,
          q3,
          q4,
          final: candidateFinal,
          status,
          needsVerification,
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

  return result;
}

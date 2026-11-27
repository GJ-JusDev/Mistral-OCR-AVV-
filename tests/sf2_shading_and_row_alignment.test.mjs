import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  classifyAttendanceCell,
  classifyCellFromPixels,
  detectHolidayColumn,
} from "../src/lib/ocr/attendanceShadingClassifier.ts";

import {
  validateSf2RowFormattingAndTotals,
  validateSf2SchoolYear,
} from "../src/lib/validation/sf2Validation.ts";

import {
  validateConsecutiveSchoolYear,
} from "../src/lib/validation/gradeUtils.ts";

import {
  parseShsSf2,
  extractShsSf2Header,
  cleanLearnerNameString,
  isValidLearnerNameCandidate,
} from "../src/lib/ocr/shsSf2Parser.ts";

import {
  evaluateUnifiedStudentValidation,
  parseNameParts,
} from "../src/lib/validation/crossDocumentEngine.ts";

describe("DepEd SF2 Attendance Shading Classifier (6 Explicit DepEd States)", () => {
  test("1. BLANK cell counts as Present (0 Absent, 0 Tardy)", () => {
    // Blank cell: text empty, minimal ink ratio (< 0.15)
    const result = classifyAttendanceCell("", 0.04, { isHoliday: false });
    assert.equal(result.classification, "BLANK");
    assert.equal(result.isAbsent, false);
    assert.equal(result.isTardy, false);
    assert.equal(result.isPresent, true);
    assert.equal(result.isHoliday, false);
    const confPercent = result.confidence <= 1 ? Math.round(result.confidence * 100) : result.confidence;
    assert.ok(confPercent >= 80, `Expected confidence >= 80, got ${confPercent}`);
  });

  test("2. X_MARK counts as Absent (+1 Absent, 0 Tardy)", () => {
    // Cell with 'X' or 'x' text mark
    const resUpper = classifyAttendanceCell("X", 0.35);
    assert.equal(resUpper.classification, "X_MARK");
    assert.equal(resUpper.isAbsent, true);
    assert.equal(resUpper.isTardy, false);
    assert.equal(resUpper.isPresent, false);

    const resLower = classifyAttendanceCell("x", 0.30);
    assert.equal(resLower.classification, "X_MARK");
    assert.equal(resLower.isAbsent, true);
    assert.equal(resLower.isTardy, false);
  });

  test("3. UPPER_HALF_SHADE counts as Tardy (Late Comer, +1 Tardy, Present)", () => {
    // Upper half shaded: fillRatio ~0.35, upperFillRatio ~0.70, lowerFillRatio ~0.05
    const res = classifyCellFromPixels({
      fillRatio: 0.35,
      upperFillRatio: 0.70,
      lowerFillRatio: 0.05,
      isColumnHoliday: false,
    });
    assert.equal(res.classification, "UPPER_HALF_SHADE");
    assert.equal(res.isTardy, true);
    assert.equal(res.isAbsent, false);
    assert.equal(res.isPresent, true);
  });

  test("4. LOWER_HALF_SHADE counts as Tardy (Cutting Classes, +1 Tardy, Present)", () => {
    // Lower half shaded: fillRatio ~0.35, upperFillRatio ~0.05, lowerFillRatio ~0.70
    const res = classifyCellFromPixels({
      fillRatio: 0.35,
      upperFillRatio: 0.05,
      lowerFillRatio: 0.70,
      isColumnHoliday: false,
    });
    assert.equal(res.classification, "LOWER_HALF_SHADE");
    assert.equal(res.isTardy, true);
    assert.equal(res.isAbsent, false);
    assert.equal(res.isPresent, true);
  });

  test("5. FULL_COLUMN_SHADE identifies Holiday / No Class (excluded from school days)", () => {
    // Column where multiple learner rows are shaded vertically
    const colCells = [
      { fillRatio: 0.85 },
      { fillRatio: 0.80 },
      { fillRatio: 0.90 },
      { fillRatio: 0.78 },
      { fillRatio: 0.82 },
    ];
    assert.equal(detectHolidayColumn(colCells, 0.70), true);

    const holidayCell = classifyAttendanceCell("", 0.85, { isColumnHoliday: true });
    assert.equal(holidayCell.classification, "FULL_COLUMN_SHADE");
    assert.equal(holidayCell.isHoliday, true);
    assert.equal(holidayCell.isAbsent, false);
    assert.equal(holidayCell.isTardy, false);
  });

  test("6. IMPROPER_FULL_CELL_SHADE flags solid fill on regular school days", () => {
    // Single cell filled solid black (> 0.72) on non-holiday day
    const res = classifyCellFromPixels({
      fillRatio: 0.88,
      upperFillRatio: 0.88,
      lowerFillRatio: 0.88,
      isColumnHoliday: false,
    });
    assert.equal(res.classification, "IMPROPER_FULL_CELL_SHADE");
    assert.equal(res.isImproperFullShade, true);
  });
});

describe("SF2 Formatting & Computation Validator (validateSf2RowFormattingAndTotals)", () => {
  test("1. Valid compliant row passes with 100% format compliance and high accuracy", () => {
    const row = {
      rowIndex: 1,
      learnerName: "Gomez, Justin Loquillano",
      totalSchoolDays: 20,
      daysPresent: 18,
      writtenAbsent: 2,
      writtenTardy: 1,
      dailyCells: [
        { dayIndex: 1, classification: "BLANK" },
        { dayIndex: 2, classification: "X_MARK" },
        { dayIndex: 3, classification: "UPPER_HALF_SHADE" },
        { dayIndex: 4, classification: "BLANK" },
        { dayIndex: 5, classification: "X_MARK" },
        { dayIndex: 6, classification: "BLANK" },
      ],
      nameConfidence: 95,
      writtenAbsentConfidence: 92,
      writtenTardyConfidence: 90,
    };

    const audit = validateSf2RowFormattingAndTotals(row);
    assert.equal(audit.isValid, true);
    assert.equal(audit.isShadingFormatValid, true);
    assert.equal(audit.absentMismatch, false);
    assert.equal(audit.tardyMismatch, false);
    assert.equal(audit.gridAbsentCount, 2);
    assert.equal(audit.gridTardyCount, 1);
    assert.equal(audit.hasConsecutiveAbsencesWarning, false);
    assert.ok(audit.overallRowAccuracy >= 85, `Expected row accuracy >= 85, got ${audit.overallRowAccuracy}`);
  });

  test("2. Detects improper full-cell shading and flags DepEd formatting warning", () => {
    const row = {
      rowIndex: 2,
      learnerName: "Santos, Maria Clara",
      totalSchoolDays: 20,
      writtenAbsent: 0,
      writtenTardy: 0,
      dailyCells: [
        { dayIndex: 1, classification: "IMPROPER_FULL_CELL_SHADE" },
        { dayIndex: 2, classification: "BLANK" },
        { dayIndex: 3, classification: "IMPROPER_FULL_CELL_SHADE" },
      ],
    };

    const audit = validateSf2RowFormattingAndTotals(row);
    assert.equal(audit.isShadingFormatValid, false);
    assert.equal(audit.isValid, false);
    assert.ok(
      audit.shadingFormatWarning?.includes("Improper SF2 Shading Format"),
      `Expected 'Improper SF2 Shading Format' warning, got: ${audit.shadingFormatWarning}`
    );
    assert.ok(
      audit.gridShadingConfidence < 70,
      `Expected penalized gridShadingConfidence (< 70), got ${audit.gridShadingConfidence}`
    );
  });

  test("3. Detects grid-vs-written mismatches (4 half-shaded vs written TARDY 3, 1 X vs written ABSENT 0)", () => {
    const rowTardyMismatch = {
      rowIndex: 3,
      learnerName: "Reyes, Mark Anthony",
      writtenAbsent: 0,
      writtenTardy: 3, // Written is 3, but grid has 4 half-shaded cells
      dailyCells: [
        { dayIndex: 1, classification: "UPPER_HALF_SHADE" },
        { dayIndex: 2, classification: "LOWER_HALF_SHADE" },
        { dayIndex: 3, classification: "UPPER_HALF_SHADE" },
        { dayIndex: 4, classification: "UPPER_HALF_SHADE" },
        { dayIndex: 5, classification: "BLANK" },
      ],
    };

    const auditTardy = validateSf2RowFormattingAndTotals(rowTardyMismatch);
    assert.equal(auditTardy.gridTardyCount, 4);
    assert.equal(auditTardy.writtenTardy, 3);
    assert.equal(auditTardy.tardyMismatch, true);
    assert.equal(auditTardy.isValid, false);
    assert.ok(
      auditTardy.reconciliationWarnings.some((w) => w.includes("Tardy count mismatch")),
      "Expected Tardy count mismatch warning"
    );

    const rowAbsentMismatch = {
      rowIndex: 4,
      learnerName: "Dela Cruz, Juan",
      writtenAbsent: 0, // Written is 0, but grid has 1 X_MARK
      writtenTardy: 0,
      dailyCells: [
        { dayIndex: 1, classification: "X_MARK" },
        { dayIndex: 2, classification: "BLANK" },
      ],
    };

    const auditAbsent = validateSf2RowFormattingAndTotals(rowAbsentMismatch);
    assert.equal(auditAbsent.gridAbsentCount, 1);
    assert.equal(auditAbsent.writtenAbsent, 0);
    assert.equal(auditAbsent.absentMismatch, true);
    assert.equal(auditAbsent.isValid, false);
    assert.ok(
      auditAbsent.reconciliationWarnings.some((w) => w.includes("Absent count mismatch")),
      "Expected Absent count mismatch warning"
    );
  });

  test("4. Detects 5 consecutive absences (SARDO Warning)", () => {
    const row5Consecutive = {
      rowIndex: 5,
      learnerName: "Villanueva, Pedro",
      writtenAbsent: 5,
      writtenTardy: 0,
      dailyCells: [
        { dayIndex: 1, classification: "X_MARK" },
        { dayIndex: 2, classification: "X_MARK" },
        { dayIndex: 3, classification: "X_MARK" },
        { dayIndex: 4, classification: "X_MARK" },
        { dayIndex: 5, classification: "X_MARK" },
        { dayIndex: 6, classification: "BLANK" },
      ],
    };

    const audit = validateSf2RowFormattingAndTotals(row5Consecutive);
    assert.equal(audit.gridAbsentCount, 5);
    assert.equal(audit.absentMismatch, false);
    assert.equal(audit.hasConsecutiveAbsencesWarning, true);
    assert.ok(
      audit.allWarnings.some((w) => w.includes("consecutive absences")),
      "Expected consecutive absences warning in allWarnings"
    );
  });

  test("5. Validates Header School Year (validateConsecutiveSchoolYear)", () => {
    const validSy = validateConsecutiveSchoolYear("2025-2026");
    assert.equal(validSy.isValid, true);
    assert.equal(validSy.normalized, "2025-2026");

    const invalidSy = validateConsecutiveSchoolYear("2025-2027");
    assert.equal(invalidSy.isValid, false);
    assert.ok(invalidSy.message?.includes("non-consecutive years"));

    const sf2SyVal = validateSf2SchoolYear("2024-2025");
    assert.equal(sf2SyVal.isValid, true);
  });
});

describe("Strict Row-by-Row Learner Alignment & Accuracy in Multi-Student SF2 Table", () => {
  test("Strict horizontal row binding keeps each learner's Name, Absent, Tardy, and overallRowAccuracy strictly aligned", () => {
    const azureTables = [
      {
        rowCount: 4,
        columnCount: 8,
        cells: [
          // Header row
          { rowIndex: 0, columnIndex: 0, content: "Learner Name" },
          { rowIndex: 0, columnIndex: 1, content: "D1" },
          { rowIndex: 0, columnIndex: 2, content: "D2" },
          { rowIndex: 0, columnIndex: 3, content: "D3" },
          { rowIndex: 0, columnIndex: 4, content: "D4" },
          { rowIndex: 0, columnIndex: 5, content: "Total Days" },
          { rowIndex: 0, columnIndex: 6, content: "ABSENT" },
          { rowIndex: 0, columnIndex: 7, content: "TARDY" },

          // Row 1: Gomez, Justin Loquillano (1 Absent, 1 Tardy)
          { rowIndex: 1, columnIndex: 0, content: "Gomez, Justin Loquillano" },
          { rowIndex: 1, columnIndex: 1, content: " " }, // Present
          { rowIndex: 1, columnIndex: 2, content: "X" }, // Absent
          { rowIndex: 1, columnIndex: 3, content: " " }, // Present
          { rowIndex: 1, columnIndex: 4, content: " " }, // Present
          { rowIndex: 1, columnIndex: 5, content: "20" },
          { rowIndex: 1, columnIndex: 6, content: "1" },
          { rowIndex: 1, columnIndex: 7, content: "0" },

          // Row 2: Santos, Maria Clara (0 Absent, 2 Tardy)
          { rowIndex: 2, columnIndex: 0, content: "Santos, Maria Clara" },
          { rowIndex: 2, columnIndex: 1, content: " " },
          { rowIndex: 2, columnIndex: 2, content: " " },
          { rowIndex: 2, columnIndex: 3, content: " " },
          { rowIndex: 2, columnIndex: 4, content: " " },
          { rowIndex: 2, columnIndex: 5, content: "20" },
          { rowIndex: 2, columnIndex: 6, content: "0" },
          { rowIndex: 2, columnIndex: 7, content: "2" },

          // Row 3: Dela Cruz, Juan (3 Absent, 0 Tardy)
          { rowIndex: 3, columnIndex: 0, content: "Dela Cruz, Juan" },
          { rowIndex: 3, columnIndex: 1, content: "X" },
          { rowIndex: 3, columnIndex: 2, content: "X" },
          { rowIndex: 3, columnIndex: 3, content: "X" },
          { rowIndex: 3, columnIndex: 4, content: " " },
          { rowIndex: 3, columnIndex: 5, content: "20" },
          { rowIndex: 3, columnIndex: 6, content: "3" },
          { rowIndex: 3, columnIndex: 7, content: "0" },
        ],
      },
    ];

    const parsed = parseShsSf2(
      "School Form 2 Daily Attendance Report\nSchool Year: 2025-2026\nMonth of: October\nSchool ID: 300123",
      { tables: azureTables }
    );

    const records = parsed.attendance || parsed.entries;
    assert.equal(records.length, 3);

    // Verify Row 1
    const r1 = records[0];
    assert.equal(r1.student_name, "Gomez, Justin Loquillano");
    assert.equal(r1.row_index, 1);
    assert.equal(r1.grid_absent_count, 1);
    assert.equal(r1.written_absent, 1);
    assert.equal(r1.formatting_audit?.absentMismatch, false);
    assert.ok(r1.overall_row_accuracy >= 80, `Expected row 1 accuracy >= 80, got ${r1.overall_row_accuracy}`);

    // Verify Row 2
    const r2 = records[1];
    assert.equal(r2.student_name, "Santos, Maria Clara");
    assert.equal(r2.row_index, 2);
    assert.equal(r2.grid_absent_count, 0);
    assert.equal(r2.written_tardy, 2);
    assert.equal(r2.formatting_audit?.tardyMismatch, true);
    assert.ok(r2.overall_row_accuracy >= 70, `Expected row 2 accuracy >= 70, got ${r2.overall_row_accuracy}`);

    // Verify Row 3
    const r3 = records[2];
    assert.equal(r3.student_name, "Dela Cruz, Juan");
    assert.equal(r3.row_index, 3);
    assert.equal(r3.grid_absent_count, 3);
    assert.equal(r3.written_absent, 3);
    assert.ok(r3.overall_row_accuracy >= 80, `Expected row 3 accuracy >= 80, got ${r3.overall_row_accuracy}`);

    // Verify Header Fields with Confidence and SY Validation
    assert.equal(parsed.header.schoolYear, "2025-2026");
    assert.equal(parsed.header.schoolYearValidation?.isValid, true);
    assert.ok(parsed.header.schoolYearConfidence >= 95);
    assert.ok(parsed.header.schoolIdConfidence >= 95);
  });
});

describe("UI DepEd SF2 Shading Legend & Preview Compliance", () => {
  test("upload/page.tsx and IndividualDocumentExtractionView.tsx include data-testid='sf2-shading-legend' and 'sf2-attendance-preview-table'", () => {
    // Relative to execution directory mistral-ocr or root
    const uploadPath = fs.existsSync("src/app/upload/page.tsx")
      ? path.resolve("src/app/upload/page.tsx")
      : path.resolve("mistral-ocr/src/app/upload/page.tsx");
    const viewPath = fs.existsSync("src/components/validation/IndividualDocumentExtractionView.tsx")
      ? path.resolve("src/components/validation/IndividualDocumentExtractionView.tsx")
      : path.resolve("mistral-ocr/src/components/validation/IndividualDocumentExtractionView.tsx");

    const uploadSrc = fs.readFileSync(uploadPath, "utf8");
    const viewSrc = fs.readFileSync(viewPath, "utf8");

    assert.ok(
      uploadSrc.includes('data-testid="sf2-shading-legend"'),
      "upload/page.tsx must contain data-testid='sf2-shading-legend'"
    );
    assert.ok(
      uploadSrc.includes('data-testid="sf2-attendance-preview-table"'),
      "upload/page.tsx must contain data-testid='sf2-attendance-preview-table'"
    );
    assert.ok(
      viewSrc.includes('data-testid="sf2-shading-legend"'),
      "IndividualDocumentExtractionView.tsx must contain data-testid='sf2-shading-legend'"
    );
    assert.ok(
      uploadSrc.includes("validateSf2RowFormattingAndTotals"),
      "upload/page.tsx must call validateSf2RowFormattingAndTotals"
    );
  });
});

describe("Learner Name Extraction & DepEd SF2 Header/Footer Label Exclusion", () => {
  test("Rejects all standard DepEd SF2 header and footer strings as student names", () => {
    const headerLabels = [
      "LEARNER'S NAME",
      "LEARNER'S NAME (Last Name, First Name, Middle Name)",
      "(Last Name, First Name, Middle Name)",
      "MALE | TOTAL Per Day",
      "FEMALE | TOTAL Per Day",
      "COMBINED | TOTAL Per Day",
      "◄ MALE | TOTAL Per Day ►",
      "Total for the Month",
      "(1st row for date, 2nd row for Day: M,T,W,TH,F)",
      "1st row for date, 2nd row for Day: M,T,W,TH,F",
      "REMARK/S (If DROPPED OUT, state reason, please refer to legend number 2.",
      "TRANSFERRED IN/OUT, write the name of School)",
      "///////////////////////",
      "\\\\\\\\\\\\\\\\\\\\\\\\\\\\",
      "-----------------------",
      "M T W TH F M T W TH F",
      "M, T, W, TH, F",
      "School Form 2 Daily Attendance Report",
      "Report for the Month of June",
      "Grade Level 11 Section CSS 1",
    ];

    for (const label of headerLabels) {
      assert.equal(
        isValidLearnerNameCandidate(label),
        false,
        `Expected header/footer label "${label}" to be rejected as a learner name`
      );
    }
  });

  test("Accepts authentic DepEd learner names", () => {
    const validNames = [
      "Gomez, Justin Loquillano",
      "Latonero, Kenneth Abad",
      "Santos, Maria Clara",
      "Dela Cruz, Juan Carlos",
      "Aquino, Benigno S.",
    ];

    for (const name of validNames) {
      assert.equal(
        isValidLearnerNameCandidate(name),
        true,
        `Expected authentic name "${name}" to be accepted`
      );
    }
  });

  test("parseNameParts decomposes full name into lastName, firstName, and middleName", () => {
    const p1 = parseNameParts("Gomez, Justin Loquillano");
    assert.equal(p1.lastName, "Gomez");
    assert.equal(p1.firstName, "Justin");
    assert.equal(p1.middleName, "Loquillano");

    const p2 = parseNameParts("Latonero, Kenneth Abad");
    assert.equal(p2.lastName, "Latonero");
    assert.equal(p2.firstName, "Kenneth");
    assert.equal(p2.middleName, "Abad");
  });
});

describe("DepEd SF2 Real Sheet Extraction (Gomez & Latonero with Active & Tardy Shading)", () => {
  test("Extracts Justin Gomez (21 Pres, 0 Abs, 0 Tardy) and Kenneth Latonero (21 Pres, 0 Abs, 3 Tardy) while excluding headers and template slashes", () => {
    const rawText = `
School Form 2 (SF2) Daily Attendance Report of Learners
School ID: 500619   School Year: 2025-2026   Report for the Month of: June
Grade Level: 11   Section: CSS 1
`;

    // 21 school day columns (index 1 to 21), absent col (22), tardy col (23)
    const azureTables = [
      {
        cells: [
          // Header Row 0
          { rowIndex: 0, columnIndex: 0, content: "LEARNER'S NAME" },
          { rowIndex: 0, columnIndex: 22, content: "Total for the Month" },
          // Header Row 1
          { rowIndex: 1, columnIndex: 0, content: "(Last Name, First Name, Middle Name)" },
          { rowIndex: 1, columnIndex: 1, content: "(1st row for date, 2nd row for Day: M,T,W,TH,F)" },
          { rowIndex: 1, columnIndex: 22, content: "ABSENT" },
          { rowIndex: 1, columnIndex: 23, content: "TARDY" },
          // Header Row 2 (Days: M T W TH F ...)
          { rowIndex: 2, columnIndex: 0, content: "M T W TH F" },
          ...Array.from({ length: 21 }, (_, i) => ({
            rowIndex: 2,
            columnIndex: i + 1,
            content: ["M", "T", "W", "TH", "F"][i % 5],
          })),
          // Row 3: Gomez, Justin Loquillano (21 days solid active shading, Absent 0, Tardy 0)
          { rowIndex: 3, columnIndex: 0, content: "Gomez, Justin Loquillano" },
          ...Array.from({ length: 21 }, (_, i) => ({
            rowIndex: 3,
            columnIndex: i + 1,
            content: ":selected:", // solid active day shading
          })),
          { rowIndex: 3, columnIndex: 22, content: "0" },
          { rowIndex: 3, columnIndex: 23, content: "0" },
          // Row 4: Latonero, Kenneth Abad (3 half-shaded tardy cells, 18 active shaded, Absent 0, Tardy 3)
          { rowIndex: 4, columnIndex: 0, content: "Latonero, Kenneth Abad" },
          { rowIndex: 4, columnIndex: 1, content: "upper_triangle" }, // day 1 tardy
          { rowIndex: 4, columnIndex: 2, content: ":selected:" },
          { rowIndex: 4, columnIndex: 3, content: ":selected:" },
          { rowIndex: 4, columnIndex: 4, content: "lower_triangle" }, // day 4 tardy
          { rowIndex: 4, columnIndex: 5, content: ":selected:" },
          { rowIndex: 4, columnIndex: 6, content: "upper_triangle" }, // day 6 tardy
          ...Array.from({ length: 15 }, (_, i) => ({
            rowIndex: 4,
            columnIndex: i + 7,
            content: ":selected:",
          })),
          { rowIndex: 4, columnIndex: 22, content: "0" },
          { rowIndex: 4, columnIndex: 23, content: "3" },
          // Row 5: Template slashes
          { rowIndex: 5, columnIndex: 0, content: "///////////////////////" },
          ...Array.from({ length: 21 }, (_, i) => ({
            rowIndex: 5,
            columnIndex: i + 1,
            content: "/",
          })),
          // Footer Row 6: MALE | TOTAL Per Day
          { rowIndex: 6, columnIndex: 0, content: "◄ MALE | TOTAL Per Day ►" },
          ...Array.from({ length: 21 }, (_, i) => ({
            rowIndex: 6,
            columnIndex: i + 1,
            content: "2",
          })),
        ],
      },
    ];

    const parsed = parseShsSf2(rawText, { tables: azureTables });

    // Assert Header
    assert.equal(parsed.header.school_id, "500619");
    assert.equal(parsed.header.school_year, "2025-2026");
    assert.equal(parsed.header.month, "June");
    assert.equal(parsed.header.grade_level, "Grade 11");
    assert.equal(parsed.header.section, "CSS 1");

    const records = parsed.attendance || parsed.entries;
    // Exactly 2 authentic learner rows; header and footer rows excluded
    assert.equal(records.length, 2, `Expected exactly 2 learner records, got ${records.length}`);

    // Verify Gomez, Justin Loquillano
    const gomez = records.find((r) => r.learner_name.includes("Gomez"));
    assert.ok(gomez, "Gomez, Justin Loquillano must be extracted");
    assert.equal(gomez.days_present, 21);
    assert.equal(gomez.days_absent, 0);
    assert.equal(gomez.days_tardy, 0);
    assert.equal(gomez.month, "June");

    // Verify Latonero, Kenneth Abad
    const latonero = records.find((r) => r.learner_name.includes("Latonero"));
    assert.ok(latonero, "Latonero, Kenneth Abad must be extracted");
    assert.equal(latonero.days_present, 21);
    assert.equal(latonero.days_absent, 0);
    assert.equal(latonero.days_tardy, 3);
    assert.equal(latonero.month, "June");
  });
});

describe("Month-Scoped (June-Only) SF9↔SF2 Cross-Document Attendance Matching", () => {
  test("Scopes SF2 June attendance strictly against SF9 June without false annual mismatch", () => {
    // SF9 has 11 months + Total column (201.5 days present, 0 absent)
    const sf9AttendanceMonths = [
      "June", "July", "August", "September", "October", "November",
      "December", "January", "February", "March", "April", "Total",
    ];

    const sf9AttendanceRecords = [
      {
        label: "No. of School Days",
        values: [21, 20, 20, 20, 21, 20, 15, 20, 19, 21, 4.5, 201.5],
        total: 201.5,
      },
      {
        label: "No. of Days Present",
        values: [21, 20, 20, 20, 21, 20, 15, 20, 19, 21, 4.5, 201.5],
        total: 201.5,
      },
      {
        label: "No. of Days Absent",
        values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        total: 0,
      },
    ];

    // SF2 has single month June for Justin Gomez
    const sf2Record = {
      raw: {
        learner_name: "Gomez, Justin Loquillano",
        last_name: "Gomez",
        first_name: "Justin",
        middle_name: "Loquillano",
        month: "June",
        month_key: "jun",
        total_school_days: 21,
        days_present: 21,
        days_absent: 0,
        days_tardy: 0,
        school_year: "2025-2026",
        grade_level: "Grade 11",
        section: "CSS 1",
      },
      sourceDocumentIds: ["doc-sf2-june"],
    };

    const outcome = evaluateUnifiedStudentValidation({
      lrn: "109345000001",
      initialSchoolYear: "2025-2026",
      initialGradeLevel: "Grade 11",
      sf9: {
        raw: {
          lrn: "109345000001",
          last_name: "Gomez",
          first_name: "Justin",
          middle_name: "Loquillano",
          school_year: "2025-2026",
          grade_level: "Grade 11",
          section: "CSS 1",
          attendance: sf9AttendanceRecords,
          attendance_months: sf9AttendanceMonths,
        },
      },
      sf2Records: [sf2Record],
    });

    // 1. Check June attendance row: must be MATCH
    const juneRow = outcome.fieldsMatrix.find((r) => r.field === "attendance_jun");
    assert.ok(juneRow, "June attendance row must exist in fieldsMatrix");
    assert.equal(juneRow.status, "MATCH");
    assert.equal(juneRow.isMatch, true);
    assert.ok(juneRow.sf2Value.includes("Pres: 21, Abs: 0"));
    assert.ok(juneRow.sf9Value.includes("Pres: 21, Abs: 0"));

    // 2. Check Annual Summary row: must be MATCH (partial 1/11 coverage, NOT a mismatch against 201.5 days)
    const annualRow = outcome.fieldsMatrix.find((r) => r.field === "attendance_annual_summary");
    assert.ok(annualRow, "Annual attendance summary row must exist");
    assert.equal(annualRow.status, "MATCH");
    assert.equal(annualRow.isMatch, true);
    assert.ok(annualRow.notes.includes("1 of 11 months compared"));

    // 3. No annual total discrepancy should be flagged
    const annualDiscrepancy = outcome.discrepancies.find((d) => d.field === "annual_attendance_total");
    assert.equal(annualDiscrepancy, undefined, "Must NOT flag annual_attendance_total mismatch for single-month SF2");
  });

  test("SF2 formatted string includes Tardy count when tardiness is recorded", () => {
    const sf9AttendanceMonths = ["June", "Total"];
    const sf9AttendanceRecords = [
      { label: "No. of School Days", values: [21, 21], total: 21 },
      { label: "No. of Days Present", values: [21, 21], total: 21 },
      { label: "No. of Days Absent", values: [0, 0], total: 0 },
    ];

    const sf2Record = {
      raw: {
        learner_name: "Latonero, Kenneth Abad",
        last_name: "Latonero",
        first_name: "Kenneth",
        middle_name: "Abad",
        month: "June",
        month_key: "jun",
        total_school_days: 21,
        days_present: 21,
        days_absent: 0,
        days_tardy: 3,
        school_year: "2025-2026",
      },
      sourceDocumentIds: ["doc-sf2-latonero"],
    };

    const outcome = evaluateUnifiedStudentValidation({
      lrn: "109345000002",
      initialSchoolYear: "2025-2026",
      sf9: {
        raw: {
          lrn: "109345000002",
          last_name: "Latonero",
          first_name: "Kenneth",
          attendance: sf9AttendanceRecords,
          attendance_months: sf9AttendanceMonths,
        },
      },
      sf2Records: [sf2Record],
    });

    const juneRow = outcome.fieldsMatrix.find((r) => r.field === "attendance_jun");
    assert.ok(juneRow, "June attendance row must exist");
    assert.ok(
      juneRow.sf2Value.includes("Tardy: 3"),
      `Expected sf2Value to contain 'Tardy: 3', got: ${juneRow.sf2Value}`
    );
  });
});

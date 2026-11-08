import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAttendanceData,
  parseAttendanceNumber,
} from "../src/lib/attendance/attendanceEvaluator.ts";
import { parseAzureLayoutGrades } from "../src/lib/ocr/tableGradesParser.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";

test("Phase C: Decimal & Fractional Attendance Parsing Safeguards", async (t) => {
  await t.test("1. Parses integers correctly", () => {
    assert.strictEqual(parseAttendanceNumber("21"), 21);
    assert.strictEqual(parseAttendanceNumber(20), 20);
    assert.strictEqual(parseAttendanceNumber("0"), 0);
  });

  await t.test("2. Preserves legitimate decimal and fractional attendance days", () => {
    assert.strictEqual(parseAttendanceNumber("0.5"), 0.5);
    assert.strictEqual(parseAttendanceNumber("19.5"), 19.5);
    assert.strictEqual(parseAttendanceNumber(20.5), 20.5);
  });

  await t.test("3. Blank, hyphen, or unreadable cells return undefined (NEVER zero)", () => {
    assert.strictEqual(parseAttendanceNumber(""), undefined);
    assert.strictEqual(parseAttendanceNumber("-"), undefined);
    assert.strictEqual(parseAttendanceNumber(":unselected:"), undefined);
    assert.strictEqual(parseAttendanceNumber(null), undefined);
    assert.strictEqual(parseAttendanceNumber(undefined), undefined);
  });
});

test("Phase C: SF9 Attendance Layout Parsing (Months vs Total Column)", async (t) => {
  await t.test("1. Azure table parser cleanly isolates Total column from months array", () => {
    const mockTables = [
      {
        rowCount: 4,
        columnCount: 6,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "" },
          { rowIndex: 0, columnIndex: 1, content: "Jun" },
          { rowIndex: 0, columnIndex: 2, content: "Jul" },
          { rowIndex: 0, columnIndex: 3, content: "Aug" },
          { rowIndex: 0, columnIndex: 4, content: "Sept" },
          { rowIndex: 0, columnIndex: 5, content: "Total" },

          { rowIndex: 1, columnIndex: 0, content: "No. of School Days" },
          { rowIndex: 1, columnIndex: 1, content: "20" },
          { rowIndex: 1, columnIndex: 2, content: "22" },
          { rowIndex: 1, columnIndex: 3, content: "21" },
          { rowIndex: 1, columnIndex: 4, content: "20" },
          { rowIndex: 1, columnIndex: 5, content: "83" }, // Printed Total

          { rowIndex: 2, columnIndex: 0, content: "No. of Days Present" },
          { rowIndex: 2, columnIndex: 1, content: "19.5" }, // Fractional
          { rowIndex: 2, columnIndex: 2, content: "21" },
          { rowIndex: 2, columnIndex: 3, content: "20" },
          { rowIndex: 2, columnIndex: 4, content: "19" },
          { rowIndex: 2, columnIndex: 5, content: "79.5" },

          { rowIndex: 3, columnIndex: 0, content: "No. of Days Absent" },
          { rowIndex: 3, columnIndex: 1, content: "0.5" },
          { rowIndex: 3, columnIndex: 2, content: "1" },
          { rowIndex: 3, columnIndex: 3, content: "1" },
          { rowIndex: 3, columnIndex: 4, content: "1" },
          { rowIndex: 3, columnIndex: 5, content: "3.5" },
        ],
      },
    ];

    const result = parseAzureLayoutGrades(mockTables);
    assert.ok(result.attendance);
    assert.strictEqual(result.attendance.length, 3);
    assert.deepStrictEqual(result.attendance_months, ["Jun", "Jul", "Aug", "Sept"]);

    const schoolDays = result.attendance.find((a) => a.label.includes("School Days"));
    assert.ok(schoolDays);
    assert.deepStrictEqual(schoolDays.values, ["20", "22", "21", "20"]);
    assert.strictEqual(schoolDays.total, "83");

    const present = result.attendance.find((a) => a.label.includes("Present"));
    assert.ok(present);
    assert.deepStrictEqual(present.values, ["19.5", "21", "20", "19"]);
    assert.strictEqual(present.total, "79.5");

    assert.ok(result.attendance_totals);
    assert.strictEqual(result.attendance_totals.computed_school_days, 83);
    assert.strictEqual(result.attendance_totals.computed_days_present, 79.5);
    assert.strictEqual(result.attendance_totals.computed_days_absent, 3.5);
  });

  await t.test("2. Markdown fallback parser isolates Total column and computes metrics", () => {
    const ocrMarkdown = `=== BACK (GRADES) ===
| REPORT ON ATTENDANCE | Jun | Jul | Aug | Sept | Oct | Total |
| --- | --- | --- | --- | --- | --- | --- |
| No. of School Days | 20 | 22 | 21 | 20 | 21 | 104 |
| No. of Days Present | 19 | 20 | 20 | 19 | 20 | 98 |
| No. of Days Absent | 1 | 2 | 1 | 1 | 1 | 6 |
First Semester
| Subjects | Quarter 1 | Quarter 2 | Semester Final Grade |
| --- | --- | --- | --- |
| Oral Communication | 88 | 90 | 89 |`;

    const parsed = parseSeniorHighGradesText(ocrMarkdown);
    assert.ok(parsed.attendance);
    assert.strictEqual(parsed.attendance.length, 3);
    assert.deepStrictEqual(parsed.attendance_months, ["Jun", "Jul", "Aug", "Sept", "Oct"]);

    const daysAbsent = parsed.attendance.find((a) => a.label.includes("Absent"));
    assert.ok(daysAbsent);
    assert.deepStrictEqual(daysAbsent.values, ["1", "2", "1", "1", "1"]);
    assert.strictEqual(daysAbsent.total, "6");

    assert.ok(parsed.attendance_totals);
    assert.strictEqual(parsed.attendance_totals.computed_school_days, 104);
    assert.strictEqual(parsed.attendance_totals.computed_days_absent, 6);
  });
});

test("Phase D: Attendance Screening Thresholds & Discrepancies", async (t) => {
  await t.test("1. Below 15% absence evaluates to NORMAL (no warning)", () => {
    // 200 school days, 190 present, 10 absent -> 5% absence
    const res = evaluateAttendanceData({
      months: ["Jun", "Jul", "Aug", "Sept", "Oct"],
      schoolDaysRow: [40, 40, 40, 40, 40],
      daysPresentRow: [38, 38, 38, 38, 38],
      daysAbsentRow: [2, 2, 2, 2, 2],
      printedSchoolDaysTotal: "200",
      printedDaysPresentTotal: "190",
      printedDaysAbsentTotal: "10",
    });

    assert.strictEqual(res.riskStatus, "NORMAL");
    assert.strictEqual(res.absencePercentage, 5);
    assert.strictEqual(res.attendancePercentage, 95);
    assert.strictEqual(res.requiresReview, false);
    assert.strictEqual(res.hasTotalsDiscrepancy, false);
  });

  await t.test("2. 15% to 20% absence triggers ATTENDANCE_WARNING", () => {
    // 100 school days, 82 present, 18 absent -> 18% absence
    const res = evaluateAttendanceData({
      months: ["Jun", "Jul", "Aug", "Sept", "Oct"],
      schoolDaysRow: [20, 20, 20, 20, 20],
      daysPresentRow: [16, 17, 16, 17, 16],
      daysAbsentRow: [4, 3, 4, 3, 4],
      printedSchoolDaysTotal: "100",
      printedDaysPresentTotal: "82",
      printedDaysAbsentTotal: "18",
    });

    assert.strictEqual(res.riskStatus, "ATTENDANCE_WARNING");
    assert.strictEqual(res.absencePercentage, 18);
    assert.strictEqual(res.requiresReview, true);
    assert.ok(res.advisoryMessage.includes("Attendance Warning"));
    assert.ok(res.advisoryMessage.includes("18% absences"));
  });

  await t.test("3. Above 20% absence triggers ATTENDANCE_REVIEW_REQUIRED without failing student", () => {
    // 100 school days, 75 present, 25 absent -> 25% absence
    const res = evaluateAttendanceData({
      months: ["Jun", "Jul", "Aug", "Sept", "Oct"],
      schoolDaysRow: [20, 20, 20, 20, 20],
      daysPresentRow: [15, 15, 15, 15, 15],
      daysAbsentRow: [5, 5, 5, 5, 5],
      printedSchoolDaysTotal: "100",
      printedDaysPresentTotal: "75",
      printedDaysAbsentTotal: "25",
    });

    assert.strictEqual(res.riskStatus, "ATTENDANCE_REVIEW_REQUIRED");
    assert.strictEqual(res.absencePercentage, 25);
    assert.strictEqual(res.requiresReview, true);
    assert.ok(res.advisoryMessage.includes("Attendance Review Required"));
    assert.ok(res.advisoryMessage.includes("Hindi pa ito automatic failure"));
  });

  await t.test("4. Discrepancy between printed total and monthly sum is flagged for review", () => {
    // Monthly sum = 100, but printed on card says 90
    const res = evaluateAttendanceData({
      months: ["Jun", "Jul", "Aug", "Sept", "Oct"],
      schoolDaysRow: [20, 20, 20, 20, 20],
      daysPresentRow: [20, 20, 20, 20, 20],
      daysAbsentRow: [0, 0, 0, 0, 0],
      printedSchoolDaysTotal: "90", // Discrepant printed total
      printedDaysPresentTotal: "100",
      printedDaysAbsentTotal: "0",
    });

    assert.strictEqual(res.hasTotalsDiscrepancy, true);
    assert.ok(res.discrepancyDetails.length > 0);
    assert.ok(res.discrepancyDetails[0].includes("Discrepancy sa Total School Days"));
  });
});

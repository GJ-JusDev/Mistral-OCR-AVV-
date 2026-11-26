import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDepEdMonthKey,
  formatDepEdMonthDisplay,
  getDepEdMonthShortLabel,
  getDepEdMonthFullName,
  isDepEdMonthMatch,
  DEPED_11_MONTHS,
} from "../src/lib/validation/monthNormalizer.ts";

import { parseShsSf2 } from "../src/lib/ocr/shsSf2Parser.ts";
import { evaluateUnifiedStudentValidation } from "../src/lib/validation/crossDocumentEngine.ts";

describe("SF2 Month Normalization & DepEd 11-Month Mapping", () => {
  test("normalizes all 11 DepEd school months and Total bidirectionally", () => {
    const testCases = [
      { inputs: ["June", "JUN", "jun", "june", "month of june"], expectedKey: "jun", expectedDisplay: "June (Jun)" },
      { inputs: ["July", "JUL", "jul", "july"], expectedKey: "jul", expectedDisplay: "July (Jul)" },
      { inputs: ["August", "AUG", "aug", "august"], expectedKey: "aug", expectedDisplay: "August (Aug)" },
      { inputs: ["September", "SEPT", "SEP", "sept", "sep", "september"], expectedKey: "sept", expectedDisplay: "September (Sept)" },
      { inputs: ["October", "OCT", "oct", "october"], expectedKey: "oct", expectedDisplay: "October (Oct)" },
      { inputs: ["November", "NOV", "nov", "november"], expectedKey: "nov", expectedDisplay: "November (Nov)" },
      { inputs: ["December", "DEC", "dec", "december"], expectedKey: "dec", expectedDisplay: "December (Dec)" },
      { inputs: ["January", "JAN", "jan", "january"], expectedKey: "jan", expectedDisplay: "January (Jan)" },
      { inputs: ["February", "FEB", "feb", "february"], expectedKey: "feb", expectedDisplay: "February (Feb)" },
      { inputs: ["March", "MAR", "mar", "march"], expectedKey: "mar", expectedDisplay: "March (Mar)" },
      { inputs: ["April", "APR", "apr", "april"], expectedKey: "apr", expectedDisplay: "April (Apr)" },
      { inputs: ["Total", "TOTAL", "tot", "annual total"], expectedKey: "total", expectedDisplay: "Total" },
    ];

    for (const { inputs, expectedKey, expectedDisplay } of testCases) {
      for (const input of inputs) {
        const key = normalizeDepEdMonthKey(input);
        assert.equal(key, expectedKey, `Expected key '${expectedKey}' for input '${input}', got '${key}'`);
        const display = formatDepEdMonthDisplay(input);
        assert.equal(display, expectedDisplay, `Expected display '${expectedDisplay}' for input '${input}', got '${display}'`);
      }
    }
  });

  test("isDepEdMonthMatch matches full names, abbreviations, and case-insensitively", () => {
    assert.equal(isDepEdMonthMatch("June", "Jun"), true);
    assert.equal(isDepEdMonthMatch("August", "Aug"), true);
    assert.equal(isDepEdMonthMatch("September", "Sept"), true);
    assert.equal(isDepEdMonthMatch("September", "Sep"), true);
    assert.equal(isDepEdMonthMatch("June", "August"), false);
    assert.equal(isDepEdMonthMatch("March", "Apr"), false);
  });

  test("DEPED_11_MONTHS contains exactly the 11 canonical academic months in order", () => {
    assert.deepEqual(DEPED_11_MONTHS, [
      "jun", "jul", "aug", "sept", "oct", "nov", "dec", "jan", "feb", "mar", "apr"
    ]);
  });
});

describe("SF2 Azure ICR + Visual Shading Reconciliation", () => {
  test("Case A: Active-day shading (21 shaded cells) with written ABSENT = 0, TARDY = 0 resolves to Present = 21, Absent = 0", () => {
    // Simulated Azure Layout table where teacher shaded 21 active school days across 25 M-F columns
    // and wrote ABSENT = 0, TARDY = 0
    const mockAzureTable = {
      rowCount: 5,
      columnCount: 30,
      cells: [
        // Header row
        { rowIndex: 0, columnIndex: 0, content: "No." },
        { rowIndex: 0, columnIndex: 1, content: "LEARNER'S NAME" },
        // Days columns 2..26 (M-F 5 weeks = 25 days)
        ...Array.from({ length: 25 }, (_, i) => ({
          rowIndex: 0,
          columnIndex: 2 + i,
          content: ["M", "T", "W", "TH", "F"][i % 5],
        })),
        { rowIndex: 0, columnIndex: 27, content: "TOTAL ABSENT" },
        { rowIndex: 0, columnIndex: 28, content: "TOTAL TARDY" },

        // Learner 1 Row: Gomez, Justin L.
        { rowIndex: 1, columnIndex: 0, content: "1" },
        { rowIndex: 1, columnIndex: 1, content: "Gomez, Justin Loquillano" },
        // 21 shaded active days, 4 blank (e.g. holidays or non-school days)
        ...Array.from({ length: 21 }, (_, i) => ({
          rowIndex: 1,
          columnIndex: 2 + i,
          content: "[shaded]",
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          rowIndex: 1,
          columnIndex: 23 + i,
          content: "",
        })),
        // Teacher written totals in Total columns
        { rowIndex: 1, columnIndex: 27, content: "0" }, // ABSENT = 0
        { rowIndex: 1, columnIndex: 28, content: "0" }, // TARDY = 0
      ],
    };

    const sf2Text = `
DEPARTMENT OF EDUCATION
School Form 2 (SF2) Daily Attendance Report of Learners
School ID: 305412
School Year: 2024-2025
Grade Level: Grade 11
Section: Diamond
Report for the Month of: June
    `;

    const parsed = parseShsSf2(sf2Text, { tables: [mockAzureTable] });

    assert.equal(parsed.header.month, "June");
    assert.equal(parsed.attendance.length, 1);

    const record = parsed.attendance[0];
    assert.equal(record.student_name, "Gomez, Justin Loquillano");
    // Crucial check: must NOT be inverted to 21 absent!
    assert.equal(record.days_absent, 0, "Days absent must be 0 when written ABSENT is 0");
    assert.equal(record.days_present, 21, "Days present must be 21 (active days)");
    assert.equal(record.days_tardy, 0, "Days tardy must be 0");
    assert.equal(record.total_days, 21, "Total school days must be 21");
    assert.equal(record.status, "PRESENT");
    assert.ok(record.confidence >= 80 && record.confidence <= 100, "Confidence must be between 80% and 100%");
  });

  test("Case B: Standard DepEd absence shading with written ABSENT > 0 and tardy triangle shading", () => {
    // Learner with 2 full-shaded absences, 1 upper-triangle tardy, and 18 unshaded present days in 21-day month
    const mockAzureTable = {
      rowCount: 5,
      columnCount: 30,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "No." },
        { rowIndex: 0, columnIndex: 1, content: "LEARNER'S NAME" },
        ...Array.from({ length: 25 }, (_, i) => ({
          rowIndex: 0,
          columnIndex: 2 + i,
          content: ["M", "T", "W", "TH", "F"][i % 5],
        })),
        { rowIndex: 0, columnIndex: 27, content: "TOTAL ABSENT" },
        { rowIndex: 0, columnIndex: 28, content: "TOTAL TARDY" },

        { rowIndex: 1, columnIndex: 0, content: "1" },
        { rowIndex: 1, columnIndex: 1, content: "Dela Cruz, Juan" },
        // 2 absent marks
        { rowIndex: 1, columnIndex: 2, content: "full_shade" },
        { rowIndex: 1, columnIndex: 3, content: "full_shade" },
        // 1 tardy mark
        { rowIndex: 1, columnIndex: 4, content: "upper_triangle" },
        // 18 present days (blank/unshaded or checkmark)
        ...Array.from({ length: 18 }, (_, i) => ({
          rowIndex: 1,
          columnIndex: 5 + i,
          content: "",
        })),
        // 4 out-of-month empty cells
        ...Array.from({ length: 4 }, (_, i) => ({
          rowIndex: 1,
          columnIndex: 23 + i,
          content: "",
        })),
        // Written totals
        { rowIndex: 1, columnIndex: 27, content: "2" }, // ABSENT = 2
        { rowIndex: 1, columnIndex: 28, content: "1" }, // TARDY = 1
      ],
    };

    const sf2Text = `
School Form 2 (SF2) Daily Attendance Report of Learners
School ID: 305412
School Year: 2024-2025
Grade Level: Grade 11
Section: Diamond
Report for the Month of: August
Total School Days: 21
    `;

    const parsed = parseShsSf2(sf2Text, { tables: [mockAzureTable] });

    assert.equal(parsed.header.month, "August");
    assert.equal(parsed.attendance.length, 1);

    const record = parsed.attendance[0];
    assert.equal(record.student_name, "Dela Cruz, Juan");
    assert.equal(record.days_absent, 2, "Days absent must be 2");
    assert.equal(record.days_tardy, 1, "Days tardy must be 1");
    assert.equal(record.total_days, 21, "Total school days must be 21");
    assert.equal(record.days_present, 19, "Days present must be 21 - 2 = 19");
    assert.ok(record.confidence >= 80, "Confidence should be high");
  });

  test("Fallback text parser handles Case A and Case B with decimal .5 half-days", () => {
    const fallbackTextCaseA = `
School Form 2 (SF2) Daily Attendance Report of Learners
Report for the Month of: September
School ID: 305412 | School Year: 2024-2025 | Grade Level: Grade 11 | Section: Diamond

| No. | Learner's Name | Total Absent | Total Tardy |
| 1 | Santos, Maria Clara | 0 | 0 |
    `;

    const parsedA = parseShsSf2(fallbackTextCaseA);
    assert.equal(parsedA.header.month, "September");
    assert.equal(parsedA.attendance.length, 1);
    assert.equal(parsedA.attendance[0].student_name, "Santos, Maria Clara");
    assert.equal(parsedA.attendance[0].days_absent, 0);
    assert.equal(parsedA.attendance[0].days_tardy, 0);

    const fallbackTextCaseBWithDecimals = `
School Form 2 (SF2) Daily Attendance Report of Learners
Report for the Month of: October
School ID: 305412 | School Year: 2024-2025 | Grade Level: Grade 11 | Section: Diamond

| No. | Learner's Name | Total Absent | Total Tardy |
| 1 | Santos, Maria Clara | 1.5 | 2 |
    `;

    const parsedB = parseShsSf2(fallbackTextCaseBWithDecimals);
    assert.equal(parsedB.header.month, "October");
    assert.equal(parsedB.attendance.length, 1);
    assert.equal(parsedB.attendance[0].student_name, "Santos, Maria Clara");
    assert.equal(parsedB.attendance[0].days_absent, 1.5);
    assert.equal(parsedB.attendance[0].days_tardy, 2);
  });
});

describe("Cross-Document Attendance Comparison: SF2 vs SF9 Front", () => {
  test("Matches SF2 'June' to SF9 Front 'Jun' column perfectly (21 School Days, 21 Present, 0 Absent)", () => {
    const sf1Raw = {
      lrn: "109324567890",
      last_name: "Gomez",
      first_name: "Justin",
      middle_name: "Loquillano",
      sex: "Male",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Diamond",
    };

    const sf2Records = [
      {
        raw: {
          month: "June",
          total_school_days: 21,
          days_present: 21,
          days_absent: 0,
          days_tardy: 0,
        },
      },
    ];

    const sf9Raw = {
      lrn: "109324567890",
      student_name: "Gomez, Justin Loquillano",
      last_name: "Gomez",
      first_name: "Justin",
      middle_name: "Loquillano",
      sex: "M",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Diamond",
      attendance_months: ["Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "Total"],
      attendance_records: [
        { label: "No. of School Days", values: [21, 22, 21, 20, 22, 20, 16, 21, 20, 21, 15, 219] },
        { label: "No. of Days Present", values: [21, 22, 21, 20, 22, 20, 16, 21, 20, 21, 15, 219] },
        { label: "No. of Days Absent", values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      ],
    };

    const result = evaluateUnifiedStudentValidation({
      lrn: "109324567890",
      sf1: { raw: sf1Raw },
      sf2Records,
      sf9: { raw: sf9Raw },
    });

    // Check June attendance field matrix
    const juneRow = result.fieldsMatrix.find((f) => f.field === "attendance_jun");
    assert.ok(juneRow, "Must include attendance_jun row in fieldsMatrix");
    assert.equal(juneRow.status, "MATCH");
    assert.equal(juneRow.isMatch, true);
    assert.match(juneRow.notes, /Monthly attendance reconciled for June \(Jun\)/);

    // Single month uploaded: annual attendance status must be MATCH (progress reported, not false mismatch)
    const annualRow = result.fieldsMatrix.find((f) => f.field === "attendance_annual_summary" || f.field === "annual_attendance_total");
    assert.ok(annualRow, "Must include attendance_annual_summary row");
    assert.equal(annualRow.status, "MATCH");
    assert.match(annualRow.notes, /1 of 11 months compared/);
  });

  test("Flags Attendance mismatch when SF2 days present/absent conflict with SF9 Front", () => {
    const sf1Raw = {
      lrn: "109324567890",
      last_name: "Gomez",
      first_name: "Justin",
    };

    // SF2 says 2 days absent, 19 present
    const sf2Records = [
      {
        raw: {
          month: "August",
          total_school_days: 21,
          days_present: 19,
          days_absent: 2,
          days_tardy: 0,
        },
      },
    ];

    // SF9 Front says 0 days absent, 21 present for Aug
    const sf9Raw = {
      lrn: "109324567890",
      last_name: "Gomez",
      first_name: "Justin",
      attendance_months: ["Jun", "Jul", "Aug", "Total"],
      attendance_records: [
        { label: "No. of School Days", values: [21, 22, 21, 64] },
        { label: "No. of Days Present", values: [21, 22, 21, 64] },
        { label: "No. of Days Absent", values: [0, 0, 0, 0] },
      ],
    };

    const result = evaluateUnifiedStudentValidation({
      lrn: "109324567890",
      sf1: { raw: sf1Raw },
      sf2Records,
      sf9: { raw: sf9Raw },
    });

    const augRow = result.fieldsMatrix.find((f) => f.field === "attendance_aug");
    assert.ok(augRow);
    assert.equal(augRow.status, "MISMATCH");
    assert.equal(augRow.isMatch, false);

    const disc = result.discrepancies.find((d) => d.field === "monthly_attendance_aug");
    assert.ok(disc, "Must report monthly_attendance_aug discrepancy");
    assert.equal(disc.severity, "CRITICAL");
    assert.match(disc.description, /Attendance mismatch in August \(Aug\)/);
  });

  test("Multi-month complete 11-month comparison matches SF9 Front Total column", () => {
    const sf1Raw = { lrn: "109324567890", last_name: "Gomez", first_name: "Justin" };

    // 11 months of SF2 data: 20 school days each, 20 present, 0 absent = 220 total
    const sf2Records = DEPED_11_MONTHS.map((m) => ({
      raw: {
        month: m,
        total_school_days: 20,
        days_present: 20,
        days_absent: 0,
        days_tardy: 0,
      },
    }));

    const sf9Raw = {
      lrn: "109324567890",
      last_name: "Gomez",
      first_name: "Justin",
      attendance_months: ["Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "Total"],
      attendance_records: [
        { label: "No. of School Days", values: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 220] },
        { label: "No. of Days Present", values: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 220] },
        { label: "No. of Days Absent", values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      ],
    };

    const result = evaluateUnifiedStudentValidation({
      lrn: "109324567890",
      sf1: { raw: sf1Raw },
      sf2Records,
      sf9: { raw: sf9Raw },
    });

    const annualRow = result.fieldsMatrix.find((f) => f.field === "attendance_annual_summary" || f.field === "annual_attendance_total");
    assert.ok(annualRow, "Must include attendance_annual_summary row");
    assert.equal(annualRow.status, "MATCH");
    assert.match(annualRow.notes, /All 11 months reconciled\. Cumulative totals match SF9 Front Total column/);
  });
});

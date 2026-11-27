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

import { parseShsSf2, cleanLearnerNameString, isValidLearnerNameCandidate, deduplicateSf2Records } from "../src/lib/ocr/shsSf2Parser.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";
import { evaluateUnifiedStudentValidation, compareSf1AndSf2 } from "../src/lib/validation/crossDocumentEngine.ts";
import { compareIdentityPair } from "../src/lib/validation/nameComparison.ts";

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

  test("Case D: img_0025.jpg & TRIS SF2 — handwritten '0' as OCR 'O' with 21 shaded active days vs '/' template cells for Latonero", () => {
    const mockTable = {
      rowCount: 3,
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

        // Learner 1: Gomez, Justin Loquillano (21 shaded boxes, written 'O' for absent, 'O' for tardy)
        { rowIndex: 1, columnIndex: 0, content: "1" },
        { rowIndex: 1, columnIndex: 1, content: "Gomez, Justin Loquillano" },
        ...Array.from({ length: 21 }, (_, i) => ({
          rowIndex: 1,
          columnIndex: 2 + i,
          content: "full_shade",
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          rowIndex: 1,
          columnIndex: 23 + i,
          content: "",
        })),
        { rowIndex: 1, columnIndex: 27, content: "O" }, // OCR 'O' for 0
        { rowIndex: 1, columnIndex: 28, content: "O" }, // OCR 'O' for 0

        // Learner 2: Latonero, Kenneth Abad (diagonal-slash '/' template cells, not dark-shaded active days)
        { rowIndex: 2, columnIndex: 0, content: "2" },
        { rowIndex: 2, columnIndex: 1, content: "Latonero, Kenneth Abad" },
        ...Array.from({ length: 25 }, (_, i) => ({
          rowIndex: 2,
          columnIndex: 2 + i,
          content: "/",
        })),
        { rowIndex: 2, columnIndex: 27, content: "" },
        { rowIndex: 2, columnIndex: 28, content: "" },
      ],
    };

    const sf2Text = `
School Form 2 (SF2) Daily Attendance Report of Learners
School ID: 500619 | School Year: 2025-2026 | Grade Level: Grade 11 | Section: CSS 1
Report for the Month of: June
`;

    const parsed = parseShsSf2(sf2Text, { tables: [mockTable] });
    assert.equal(parsed.attendance.length, 2);

    // Gomez, Justin Loquillano: Present: 21, Absent: 0, Tardy: 0
    const gomez = parsed.attendance.find((a) => a.student_name.includes("Gomez"));
    assert.ok(gomez);
    assert.equal(gomez.days_present, 21, "Gomez must have 21 days present");
    assert.equal(gomez.days_absent, 0, "Gomez must have 0 days absent (OCR 'O' recognized as 0)");
    assert.equal(gomez.days_tardy, 0, "Gomez must have 0 days tardy");
    assert.equal(gomez.total_days, 21);
    assert.equal(gomez.status, "PRESENT");

    // Latonero, Kenneth Abad: diagonal slashes '/' must NOT be miscounted as 25 dark-shaded active days
    const latonero = parsed.attendance.find((a) => a.student_name.includes("Latonero"));
    assert.ok(latonero);
    assert.notEqual(latonero.days_present, 25, "Diagonal slashes must not be counted as 25 active shaded days");
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

  test("SF2 extraction when Azure prebuilt-layout fragments the 25-column slash grid (0 valid table rows) and falls back to spatial OCR lines + 21 dark-shaded active boxes + handwritten '0'/'O'", () => {
    // Simulated Azure Layout result where tables array is empty (or fragmented with 0 valid learner rows)
    const mockRawLayout = {
      pages: [
        {
          pageNumber: 1,
          width: 1000,
          height: 1000,
          lines: [
            {
              content: "Republic of the Philippines - Department of Education",
              polygon: [100, 10, 900, 10, 900, 30, 100, 30],
            },
            {
              content: "School Form 2 (SF2) Daily Attendance Report of Learners",
              polygon: [100, 35, 900, 35, 900, 60, 100, 60],
            },
            {
              content: "School ID: 500619 | School Year: 2025-2026 | Grade Level: 11 | Section: CSS 1",
              polygon: [100, 65, 800, 65, 800, 85, 100, 85],
            },
            {
              content: "Report for the Month of June",
              polygon: [100, 90, 450, 90, 450, 110, 100, 110],
            },
            {
              content: "LEARNER'S NAME (Last Name, First Name, Middle Name)",
              polygon: [80, 130, 340, 130, 340, 155, 80, 155],
            },
            // Learner 1: Gomez, Justin Loquillano (x center: 200, y center: 220)
            {
              content: "1 Gomez, Justin Loquillano",
              polygon: [80, 205, 320, 205, 320, 235, 80, 235],
            },
            // Learner 2: Latonero, Kenneth Abad (x center: 200, y center: 280)
            {
              content: "2 Latonero, Kenneth Abad",
              polygon: [80, 265, 320, 265, 320, 295, 80, 295],
            },
            // Table bottom divider
            {
              content: "TOTAL Per Day | MALE",
              polygon: [80, 650, 400, 650, 400, 680, 80, 680],
            },
          ],
          words: [
            // Learner 1 (Gomez) 21 dark-shaded active cells in daily columns band (x between 33% and 69%)
            ...Array.from({ length: 21 }, (_, i) => ({
              content: "full_shade",
              polygon: [350 + i * 14, 210, 362 + i * 14, 210, 362 + i * 14, 230, 350 + i * 14, 230],
            })),
            // Learner 1 handwritten 'O' in ABSENT and TARDY total band (x between 69% and 79%)
            {
              content: "O",
              polygon: [705, 210, 725, 210, 725, 230, 705, 230], // Absent = 0
            },
            {
              content: "O",
              polygon: [750, 210, 770, 210, 770, 230, 750, 230], // Tardy = 0
            },
            // Learner 2 (Latonero) template slashes '/' in daily columns band (x between 33% and 69%)
            ...Array.from({ length: 25 }, (_, i) => ({
              content: "/",
              polygon: [350 + i * 13, 270, 360 + i * 13, 270, 360 + i * 13, 290, 350 + i * 13, 290],
            })),
            // Learner 2 blank totals in total band
          ],
        },
      ],
      tables: [], // 0 tables parsed by prebuilt-layout
      styles: [],
    };

    const sf2Text = `
School Form 2 (SF2) Daily Attendance Report of Learners
School ID: 500619 | School Year: 2025-2026 | Grade Level: 11 | Section: CSS 1
Report for the Month of June
`;

    // 1. Pass 2 Spatial Line & Geometry Fallback test via parseShsSf2
    const parsed = parseShsSf2(sf2Text, mockRawLayout);

    assert.equal(parsed.header.school_id, "500619");
    assert.equal(parsed.header.school_year, "2025-2026");
    assert.equal(parsed.header.grade_level, "Grade 11");
    assert.equal(parsed.header.section, "CSS 1");
    assert.equal(parsed.header.month, "June");
    assert.equal(parsed.header.canonical_month, "jun");
    assert.equal(parsed.header.total_school_days, 21);

    assert.equal(parsed.attendance.length, 2, "Must extract both Gomez and Latonero via spatial lines");

    const gomez = parsed.attendance.find((a) => a.student_name.includes("Gomez"));
    assert.ok(gomez, "Gomez must be extracted");
    assert.equal(gomez.student_name, "Gomez, Justin Loquillano");
    assert.equal(gomez.days_present, 21, "Gomez must have 21 days present from active-day shading");
    assert.equal(gomez.days_absent, 0, "Gomez must have 0 days absent from handwritten OCR 'O'");
    assert.equal(gomez.days_tardy, 0, "Gomez must have 0 days tardy from handwritten OCR 'O'");
    assert.equal(gomez.total_days, 21, "Total school days must be 21");
    assert.equal(gomez.status, "PRESENT");

    const latonero = parsed.attendance.find((a) => a.student_name.includes("Latonero"));
    assert.ok(latonero, "Latonero must be extracted");
    assert.equal(latonero.student_name, "Latonero, Kenneth Abad");
    assert.equal(latonero.days_present, 0, "Latonero must not count '/' slashes as active days");
    assert.equal(latonero.days_absent, 0, "Latonero absent is 0");
    assert.equal(latonero.days_tardy, 0, "Latonero tardy is 0");
    assert.equal(latonero.total_days, 21, "Latonero inherits 21 school days from section active days");
    assert.equal(latonero.notes, "Unmarked / No Shading");

    // 2. End-to-end /api/ocr extractedFields shape test consumed by Step 2 UI
    const extractedFields = parseGradesText(sf2Text, "Grade 11", mockRawLayout, "sf2");

    assert.equal(extractedFields.document_type, "sf2");
    assert.equal(extractedFields.month, "June");
    assert.equal(extractedFields.month_key, "jun");
    assert.equal(extractedFields.total_school_days, 21);

    // Verify all keys consumed by Step 2 UI
    assert.ok(Array.isArray(extractedFields.attendance_records), "Must provide attendance_records");
    assert.ok(Array.isArray(extractedFields.monthly_attendance), "Must provide monthly_attendance");
    assert.ok(Array.isArray(extractedFields.learners), "Must provide learners");
    assert.equal(extractedFields.attendance_records.length, 2);
    assert.equal(extractedFields.monthly_attendance.length, 2);
    assert.equal(extractedFields.learners.length, 2);

    const firstRec = extractedFields.attendance_records[0];
    assert.equal(firstRec.student_name, "Gomez, Justin Loquillano");
    assert.equal(firstRec.month, "June");
    assert.equal(firstRec.month_key, "jun");
    assert.equal(firstRec.total_school_days, 21);
    assert.equal(firstRec.days_present, 21);
    assert.equal(firstRec.days_absent, 0);
    assert.equal(firstRec.days_tardy, 0);
    assert.ok(typeof firstRec.confidence === "number");
  });

  test("Cleans :selected: tokens and rejects phantom rows without valid learner names", () => {
    // 1. cleanLearnerNameString helper checks
    assert.equal(cleanLearnerNameString(":selected:"), "");
    assert.equal(cleanLearnerNameString(":unselected:"), "");
    assert.equal(cleanLearnerNameString("1. Gomez, Justin Loquillano :selected:"), "Gomez, Justin Loquillano");
    assert.equal(cleanLearnerNameString("[x] Latonero, Kenneth Abad"), "Latonero, Kenneth Abad");

    // 2. isValidLearnerNameCandidate checks
    assert.equal(isValidLearnerNameCandidate(":selected:"), false);
    assert.equal(isValidLearnerNameCandidate(""), false);
    assert.equal(isValidLearnerNameCandidate("TOTAL"), false);
    assert.equal(isValidLearnerNameCandidate("MALE"), false);
    assert.equal(isValidLearnerNameCandidate("LEARNER'S NAME"), false);
    assert.equal(isValidLearnerNameCandidate("Gomez"), false); // Only 1 word
    assert.equal(isValidLearnerNameCandidate("Gomez, Justin Loquillano"), true);
    assert.equal(isValidLearnerNameCandidate("Latonero, Kenneth Abad"), true);
  });

  test("Handles img_0025.png Azure ICR scenario: :selected: tokens in daily cells, 2 valid learners, zero phantom rows", () => {
    // Simulated Azure Layout table containing:
    // Row 1: Gomez, Justin Loquillano with 21 ':selected:' marks and written totals ABSENT = 0, TARDY = 0
    // Row 2: Latonero, Kenneth Abad with template slashes '/' and blank totals
    // Row 3: Phantom row with ':selected:' in name column and no actual student name
    const mockAzureTable = {
      rowCount: 4,
      columnCount: 28,
      cells: [
        // Header row
        { rowIndex: 0, columnIndex: 0, content: "No." },
        { rowIndex: 0, columnIndex: 1, content: "LEARNER'S NAME (Last Name, First Name, Middle Name)" },
        ...Array.from({ length: 25 }, (_, i) => ({
          rowIndex: 0,
          columnIndex: 2 + i,
          content: ["M", "T", "W", "TH", "F"][i % 5],
        })),
        { rowIndex: 0, columnIndex: 27, content: "ABSENT" },

        // Row 1: Gomez with :selected: in 21 daily cells
        { rowIndex: 1, columnIndex: 0, content: "1" },
        { rowIndex: 1, columnIndex: 1, content: "Gomez, Justin Loquillano" },
        ...Array.from({ length: 21 }, (_, i) => ({
          rowIndex: 1,
          columnIndex: 2 + i,
          content: ":selected:",
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          rowIndex: 1,
          columnIndex: 23 + i,
          content: "",
        })),
        { rowIndex: 1, columnIndex: 27, content: "0" },

        // Row 2: Latonero with template '/' slashes
        { rowIndex: 2, columnIndex: 0, content: "2" },
        { rowIndex: 2, columnIndex: 1, content: "Latonero, Kenneth Abad" },
        ...Array.from({ length: 25 }, (_, i) => ({
          rowIndex: 2,
          columnIndex: 2 + i,
          content: "/",
        })),
        { rowIndex: 2, columnIndex: 27, content: "" },

        // Row 3: Phantom row with :selected:
        { rowIndex: 3, columnIndex: 0, content: "3" },
        { rowIndex: 3, columnIndex: 1, content: ":selected:" },
        ...Array.from({ length: 25 }, (_, i) => ({
          rowIndex: 3,
          columnIndex: 2 + i,
          content: ":selected:",
        })),
        { rowIndex: 3, columnIndex: 27, content: "" },
      ],
    };

    const sf2Text = `
School Form 2 (SF2) Daily Attendance Report of Learners
School ID: 500619 | School Year: 2025-2026 | Grade Level: 11 | Section: CSS 1
Report for the Month of June
`;

    const parsed = parseShsSf2(sf2Text, { tables: [mockAzureTable] });

    // EXACTLY 2 rows emitted (no 3rd phantom row with :selected:)
    assert.equal(parsed.attendance.length, 2, "Must omit phantom :selected: row");

    // Row 1: Gomez
    const gomez = parsed.attendance[0];
    assert.equal(gomez.student_name, "Gomez, Justin Loquillano");
    assert.equal(gomez.total_days, 21);
    assert.equal(gomez.days_present, 21);
    assert.equal(gomez.days_absent, 0);
    assert.equal(gomez.status, "PRESENT");

    // Row 2: Latonero
    const latonero = parsed.attendance[1];
    assert.equal(latonero.student_name, "Latonero, Kenneth Abad");
    assert.equal(latonero.total_days, 21);
    assert.equal(latonero.days_present, 0);
    assert.equal(latonero.days_absent, 0);
    assert.equal(latonero.notes, "Unmarked / No Shading");

    // Extracted fields for UI
    const extractedFields = parseGradesText(sf2Text, "Grade 11", { tables: [mockAzureTable] }, "sf2");
    assert.equal(extractedFields.attendance_records.length, 2);
    assert.ok(!extractedFields.attendance_records.some((r) => r.student_name.includes(":selected:")));
  });

  test("Handwriting tolerance: minor ICR spelling differences in middle/last names match across documents", () => {
    // 1. Pairwise comparison in nameComparison.ts
    // SF2 has handwritten "Gomez, Justin Loqullano" (missing 1 'i' in middle name, len 10, dist 1)
    const pairResult = compareIdentityPair(
      "SF1-SHS",
      { fullName: "Gomez, Justin Loquillano" },
      "SF2-SHS",
      { fullName: "Gomez, Justin Loqullano" }
    );
    assert.equal(pairResult.isMatch, true, "Minor handwriting variation in middle name must match");
    assert.equal(pairResult.status, "MATCH");

    // 2. compareSf1AndSf2 in crossDocumentEngine.ts
    const sf1Entry = {
      lrn: "109345000001",
      last_name: "Gomez",
      first_name: "Justin",
      school_year: "2025-2026",
      grade_level: "Grade 11",
      section: "CSS 1",
    };
    const sf2Entries = [
      {
        lrn: null, // SF2 sheet without LRN
        learner_name: "Gomez, Justin Loqullano", // Minor handwriting variation
        school_year: "2025-2026",
        grade_level: "Grade 11",
        section: "CSS 1",
        month: "June",
        total_school_days: 21,
        days_present: 21,
        days_absent: 0,
        days_tardy: 0,
      },
    ];
    const sf1Sf2Result = compareSf1AndSf2(sf1Entry, sf2Entries);
    assert.equal(sf1Sf2Result.status, "MATCH", "SF1 and SF2 must reconcile despite minor handwriting middle name variance");
    assert.equal(sf1Sf2Result.discrepancies.length, 0);

    // 3. evaluateUnifiedStudentValidation in crossDocumentEngine.ts
    const unifiedResult = evaluateUnifiedStudentValidation({
      studentId: "student-1",
      psa: {
        raw: {
          last_name: "Gomez",
          first_name: "Justin",
          middle_name: "Loquillano",
          birth_date: "2004-06-23",
          sex: "Male",
        },
      },
      sf1: {
        raw: {
          lrn: "109345000001",
          last_name: "Gomez",
          first_name: "Justin",
          middle_name: "Loquillano",
          birth_date: "2004-06-23",
          sex: "Male",
          school_year: "2025-2026",
          grade_level: "Grade 11",
          section: "CSS 1",
        },
      },
      sf2Records: [
        {
          raw: {
            learner_name: "Gomez, Justin Loqullano",
            month: "June",
            total_school_days: 21,
            days_present: 21,
            days_absent: 0,
            school_year: "2025-2026",
            grade_level: "Grade 11",
            section: "CSS 1",
          },
        },
      ],
    });

    const middleNameField = unifiedResult.fieldsMatrix.find((f) => f.field === "middle_name");
    assert.ok(middleNameField, "Middle name comparison row must exist");
    assert.equal(middleNameField.status, "MATCH", "Middle name row must be MATCH under handwriting tolerance");
  });

  test("Deduplicates SF2 attendance records by normalized learner name + month (2 learners only, no duplicates, calibrates 21 shaded days)", () => {
    // Simulated input with 4 raw rows (2 duplicates for Gomez, 2 duplicates for Latonero):
    // Pass 1 table fragments (Present: 0, 90%, total: 20)
    // Pass 2 spatial shading (Present: 21 for Gomez, 96%; Present: 0 for Latonero, total: 21)
    const rawDuplicateRecords = [
      {
        row_index: 1,
        student_name: "Gomez, Justin Loquillano",
        learner_name: "Gomez, Justin Loquillano",
        month: "June",
        month_key: "jun",
        total_school_days: 20,
        total_days: 20,
        days_present: 0,
        days_absent: 0,
        days_tardy: 0,
        confidence: 90,
      },
      {
        row_index: 2,
        student_name: "Latonero, Kenneth Abad",
        learner_name: "Latonero, Kenneth Abad",
        month: "June",
        month_key: "jun",
        total_school_days: 20,
        total_days: 20,
        days_present: 0,
        days_absent: 0,
        days_tardy: 0,
        confidence: 90,
      },
      {
        row_index: 3,
        student_name: "Gomez, Justin Loquillano",
        learner_name: "Gomez, Justin Loquillano",
        month: "June",
        month_key: "jun",
        total_school_days: 21,
        total_days: 21,
        days_present: 21,
        days_absent: 0,
        days_tardy: 0,
        confidence: 96,
        status: "PRESENT",
      },
      {
        row_index: 4,
        student_name: "Latonero, Kenneth Abad",
        learner_name: "Latonero, Kenneth Abad",
        month: "June",
        month_key: "jun",
        total_school_days: 21,
        total_days: 21,
        days_present: 0,
        days_absent: 0,
        days_tardy: 0,
        confidence: 90,
        notes: "Unmarked / No Shading",
      },
    ];

    const deduplicated = deduplicateSf2Records(rawDuplicateRecords);

    // 1. Must contain EXACTLY 2 rows (no duplicates)
    assert.equal(deduplicated.length, 2, "Must contain exactly 2 learner rows, no duplicates");

    // 2. Gomez has School Days: 21, Present: 21, Absent: 0, Tardy: 0, Confidence: 96%
    const gomez = deduplicated.find((r) => r.learner_name.includes("Gomez"));
    assert.ok(gomez, "Gomez must exist in deduplicated records");
    assert.equal(gomez.learner_name, "Gomez, Justin Loquillano");
    assert.equal(gomez.total_school_days, 21, "Gomez must have School Days: 21");
    assert.equal(gomez.total_days, 21);
    assert.equal(gomez.days_present, 21, "Gomez must have Present: 21");
    assert.equal(gomez.days_absent, 0, "Gomez must have Absent: 0");
    assert.equal(gomez.days_tardy, 0, "Gomez must have Tardy: 0");
    assert.equal(gomez.confidence, 96, "Gomez must have Confidence: 96%");

    // 3. Latonero has School Days: 21, Present: 0, Absent: 0, Tardy: 0
    const latonero = deduplicated.find((r) => r.learner_name.includes("Latonero"));
    assert.ok(latonero, "Latonero must exist in deduplicated records");
    assert.equal(latonero.learner_name, "Latonero, Kenneth Abad");
    assert.equal(latonero.total_school_days, 21, "Latonero inherits School Days: 21 from active row");
    assert.equal(latonero.total_days, 21);
    assert.equal(latonero.days_present, 0, "Latonero has Present: 0");
    assert.equal(latonero.days_absent, 0, "Latonero has Absent: 0");
    assert.equal(latonero.days_tardy, 0, "Latonero has Tardy: 0");
  });

  test("Target student name prioritization in SF2 extraction from SF9 anchor", () => {
    const sf2MultiText = `
School ID: 500169  School Year: 2026-2027  Grade Level: Grade 11  Section: Diamond
Month: June  Total School Days: 21

MALE
1. Latonero, Kenneth Abad   20  1  0
2. Gomez, Justin Loquillano 21  0  0
`;
    // Prioritize Gomez from SF9
    const res = parseShsSf2(sf2MultiText, undefined, 0.95, {
      targetStudentName: "Gomez, Justin Loquillano",
    });

    assert.equal(res.attendance.length, 2);
    assert.equal(res.attendance[0].learner_name, "Gomez, Justin Loquillano", "Target student must be prioritized to index 0");
    assert.equal(res.attendance[0].days_present, 21);
    assert.equal(res.target_matched, true);
  });
});

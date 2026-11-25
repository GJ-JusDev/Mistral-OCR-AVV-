import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAttendanceData,
  evaluateAttendanceRecords,
  parseAttendanceNumber,
} from "../src/lib/attendance/attendanceEvaluator.ts";

import {
  computeOfficialSemesterFinalGrade,
  computeRawSemesterFinalGrade,
  recalculateSubjectGradeStatus,
  normalizeGradeRecords,
  computeSemesterGeneralAverage,
  updateExtractedFieldsAverages,
} from "../src/lib/validation/gradeUtils.ts";

import { parseAzureLayoutGrades } from "../src/lib/ocr/tableGradesParser.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { mergeSf9FrontAndBack } from "../src/lib/validation/sf9Merger.ts";

describe("AVV SF9 Attendance Completeness & Semester Quarter Mapping Suite", () => {
  // -------------------------------------------------------------------------
  // 1. ATTENDANCE TABLE EXTRACTION & COMPLETENESS TESTS
  // -------------------------------------------------------------------------
  describe("1. Attendance Table Extraction & Completeness", () => {
    test("User Fixture: 10 months with partial absences evaluates totals and completeness correctly", () => {
      // Prompt fixture:
      // School Days:  21, 5, 7, 22, 21, 19, 11, 20, 14, 22
      // Days Present: 21, 5, 7, 22, 21, 19, 11, 20, 14, 22
      // Days Absent:  0,  0, —, blank, blank, blank, blank, blank, blank, blank
      const months = ["Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
      const schoolDays = [21, 5, 7, 22, 21, 19, 11, 20, 14, 22];
      const daysPresent = [21, 5, 7, 22, 21, 19, 11, 20, 14, 22];
      const daysAbsent = [0, 0, "—", "blank", "blank", "blank", "blank", "blank", "blank", "blank"];

      const res = evaluateAttendanceData({
        months,
        schoolDaysRow: schoolDays,
        daysPresentRow: daysPresent,
        daysAbsentRow: daysAbsent,
      });

      // Expected validations from prompt:
      // School Days total: 162
      assert.strictEqual(res.computedSchoolDays, 162);
      assert.strictEqual(res.isSchoolDaysComplete, true);

      // Days Present total: 162
      assert.strictEqual(res.computedDaysPresent, 162);
      assert.strictEqual(res.isDaysPresentComplete, true);

      // Days Absent total: incomplete / unknown (MUST NOT report as zero!)
      assert.strictEqual(res.computedDaysAbsent, undefined);
      assert.strictEqual(res.isDaysAbsentComplete, false);

      // Do not silently replace missing cells with zero
      assert.strictEqual(res.monthlyBreakdown[0].daysAbsent, 0);
      assert.strictEqual(res.monthlyBreakdown[1].daysAbsent, 0);
      assert.strictEqual(res.monthlyBreakdown[2].daysAbsent, undefined);
      assert.strictEqual(res.monthlyBreakdown[3].daysAbsent, undefined);
      assert.strictEqual(res.monthlyBreakdown[9].daysAbsent, undefined);

      // Monthly equations checked where complete
      assert.strictEqual(res.monthlyBreakdown[0].isEquationValid, true); // 21 = 21 + 0
      assert.strictEqual(res.monthlyBreakdown[1].isEquationValid, true); // 5 = 5 + 0
      assert.strictEqual(res.monthlyBreakdown[2].isEquationValid, undefined); // missing da

      // Overall completeness: incomplete
      assert.strictEqual(res.isComplete, false);
      assert.strictEqual(res.riskStatus, "INCOMPLETE_ATTENDANCE_DATA");
      assert.strictEqual(res.requiresReview, true);
    });

    test("Dashes, blanks, and unreadable marks never convert to zero", () => {
      assert.strictEqual(parseAttendanceNumber(""), undefined);
      assert.strictEqual(parseAttendanceNumber("-"), undefined);
      assert.strictEqual(parseAttendanceNumber("—"), undefined); // em dash
      assert.strictEqual(parseAttendanceNumber("–"), undefined); // en dash
      assert.strictEqual(parseAttendanceNumber("_"), undefined);
      assert.strictEqual(parseAttendanceNumber("blank"), undefined);
      assert.strictEqual(parseAttendanceNumber("BLANK"), undefined);
      assert.strictEqual(parseAttendanceNumber("none"), undefined);
      assert.strictEqual(parseAttendanceNumber("n/a"), undefined);
      assert.strictEqual(parseAttendanceNumber("unreadable"), undefined);
      assert.strictEqual(parseAttendanceNumber(":unselected:"), undefined);
      assert.strictEqual(parseAttendanceNumber(null), undefined);
      assert.strictEqual(parseAttendanceNumber(undefined), undefined);

      // Legitimate zero is strictly preserved
      assert.strictEqual(parseAttendanceNumber("0"), 0);
      assert.strictEqual(parseAttendanceNumber(0), 0);
      assert.strictEqual(parseAttendanceNumber("0.0"), 0);
    });

    test("Monthly attendance equation flags discrepancies when present + absent != school days", () => {
      const months = ["Jun", "Jul"];
      const schoolDays = [20, 22];
      const daysPresent = [18, 20];
      const daysAbsent = [1, 2]; // Jun: 18 + 1 = 19 != 20 (Discrepancy!) Jul: 20 + 2 = 22 == 22 (Valid)

      const res = evaluateAttendanceData({
        months,
        schoolDaysRow: schoolDays,
        daysPresentRow: daysPresent,
        daysAbsentRow: daysAbsent,
      });

      assert.strictEqual(res.monthlyBreakdown[0].isEquationValid, false);
      assert.strictEqual(res.monthlyBreakdown[1].isEquationValid, true);
      assert.strictEqual(res.hasEquationDiscrepancy, true);
      assert.strictEqual(res.requiresReview, true);
      assert.ok(res.discrepancyDetails.some((d) => d.includes("Jun")));
    });

    test("Printed totals are compared against computed sums when both are complete", () => {
      const months = ["Jun", "Jul", "Aug"];
      const schoolDays = [20, 21, 22]; // sum = 63
      const daysPresent = [19, 20, 21]; // sum = 60
      const daysAbsent = [1, 1, 1]; // sum = 3

      // Case A: Perfect match with printed totals
      const matchRes = evaluateAttendanceData({
        months,
        schoolDaysRow: schoolDays,
        daysPresentRow: daysPresent,
        daysAbsentRow: daysAbsent,
        printedSchoolDaysTotal: 63,
        printedDaysPresentTotal: 60,
        printedDaysAbsentTotal: 3,
      });
      assert.strictEqual(matchRes.hasTotalsDiscrepancy, false);
      assert.strictEqual(matchRes.isComplete, true);

      // Case B: Printed total discrepancy on card
      const diffRes = evaluateAttendanceData({
        months,
        schoolDaysRow: schoolDays,
        daysPresentRow: daysPresent,
        daysAbsentRow: daysAbsent,
        printedSchoolDaysTotal: 65, // mismatch
        printedDaysPresentTotal: 60,
        printedDaysAbsentTotal: 3,
      });
      assert.strictEqual(diffRes.hasTotalsDiscrepancy, true);
      assert.strictEqual(diffRes.requiresReview, true);
      assert.ok(diffRes.discrepancyDetails.some((d) => d.includes("Total School Days")));
    });

    test("Markdown fallback parser correctly processes the 10-month attendance table with partial data", () => {
      const ocrMarkdown = `=== REPORT ON ATTENDANCE ===
| Metric | Jun | Jul | Aug | Sept | Oct | Nov | Dec | Jan | Feb | Mar | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| No. of School Days | 21 | 5 | 7 | 22 | 21 | 19 | 11 | 20 | 14 | 22 | 162 |
| No. of Days Present | 21 | 5 | 7 | 22 | 21 | 19 | 11 | 20 | 14 | 22 | 162 |
| No. of Days Absent | 0 | 0 | — | blank | blank | blank | blank | blank | blank | blank | — |
First Semester
| Subjects | Quarter 1 | Quarter 2 | Semester Final Grade |
| Oral Communication | 88 | 88 | 88 |`;

      const fields = parseSeniorHighGradesText(ocrMarkdown);
      assert.ok(fields.attendance);
      assert.strictEqual(fields.attendance.length, 3);
      assert.strictEqual(fields.attendance_months?.length, 10);

      assert.ok(fields.attendance_totals);
      assert.strictEqual(fields.attendance_totals.computed_school_days, 162);
      assert.strictEqual(fields.attendance_totals.computed_days_present, 162);
      assert.strictEqual(fields.attendance_totals.computed_days_absent, undefined);
      assert.strictEqual(fields.attendance_totals.is_school_days_complete, true);
      assert.strictEqual(fields.attendance_totals.is_days_present_complete, true);
      assert.strictEqual(fields.attendance_totals.is_days_absent_complete, false);
      assert.strictEqual(fields.attendance_risk_status, "INCOMPLETE_ATTENDANCE_DATA");

      // Verify academic grades are NOT contaminated by attendance rows
      assert.strictEqual(fields.grades?.length, 1);
      assert.strictEqual(fields.grades?.[0].subject, "Oral Communication");
    });
  });

  // -------------------------------------------------------------------------
  // 2. CORRECT SF9 SEMESTER AND QUARTER ORGANIZATION TESTS
  // -------------------------------------------------------------------------
  describe("2. Correct SF9 Semester and Quarter Organization", () => {
    test("First Semester: Q1 and Q2 are preserved, Q3 and Q4 are strictly undefined", () => {
      const record = {
        subject: "Oral Communication",
        semester: "1st Semester",
        q1: 88,
        q2: 88,
        final: 88,
      };

      const normalized = recalculateSubjectGradeStatus(record, "1st Semester");
      assert.strictEqual(normalized.q1, 88);
      assert.strictEqual(normalized.q2, 88);
      assert.strictEqual(normalized.q3, undefined);
      assert.strictEqual(normalized.q4, undefined);
      assert.strictEqual(normalized.sem1_final_grade, 88);
      assert.strictEqual(normalized.sem2_final_grade, undefined);
      assert.strictEqual(normalized.status, "Passed");
    });

    test("Second Semester: Q3 and Q4 are preserved, Q1 and Q2 are strictly undefined", () => {
      const record = {
        subject: "Reading and Writing",
        semester: "2nd Semester",
        q3: 90,
        q4: 87,
      };

      const normalized = recalculateSubjectGradeStatus(record, "2nd Semester");
      assert.strictEqual(normalized.q1, undefined);
      assert.strictEqual(normalized.q2, undefined);
      assert.strictEqual(normalized.q3, 90);
      assert.strictEqual(normalized.q4, 87);
      assert.strictEqual(normalized.sem1_final_grade, undefined);
      assert.strictEqual(normalized.sem2_final_grade, 88.5); // raw arithmetic
      assert.strictEqual(normalized.displayed_final_grade, 89); // rounded whole number
      assert.strictEqual(normalized.status, "Passed");
    });

    test("All 9 subjects from User's First Semester table calculate correct final grades", () => {
      // First Semester subjects from uploaded image:
      // 1. Oral Communication: 88, 88 -> 88
      // 2. Komunikasyon at Pananaliksik: 90, 90 -> 90
      // 3. Intro to Philosophy: 87, 87 -> 87
      // 4. PE and Health 1: 85, 85 -> 85
      // 5. General Mathematics: 84, 84 -> 84
      // 6. Earth Science: 89, 89 -> 89
      // 7. Empowerment Technologies: 90, 90 -> 90
      // 8. Pre-Calculus: 87, 87 -> 87
      // 9. General Chemistry 1: 79, 79 -> 79
      const subjects = [
        { name: "Oral Communication", q1: 88, q2: 88, exp: 88 },
        { name: "Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino", q1: 90, q2: 90, exp: 90 },
        { name: "Introduction to the Philosophy of the Human Person", q1: 87, q2: 87, exp: 87 },
        { name: "Physical Education and Health 1", q1: 85, q2: 85, exp: 85 },
        { name: "General Mathematics", q1: 84, q2: 84, exp: 84 },
        { name: "Earth Science", q1: 89, q2: 89, exp: 89 },
        { name: "Empowerment Technologies", q1: 90, q2: 90, exp: 90 },
        { name: "Pre-Calculus", q1: 87, q2: 87, exp: 87 },
        { name: "General Chemistry 1", q1: 79, q2: 79, exp: 79 },
      ];

      const records = subjects.map((s) => ({
        subject: s.name,
        semester: "1st Semester",
        q1: s.q1,
        q2: s.q2,
      }));

      const normalized = normalizeGradeRecords(records, "1st Semester");
      for (let i = 0; i < subjects.length; i++) {
        const norm = normalized[i];
        assert.strictEqual(norm.q1, subjects[i].q1);
        assert.strictEqual(norm.q2, subjects[i].q2);
        assert.strictEqual(norm.q3, undefined);
        assert.strictEqual(norm.q4, undefined);
        assert.strictEqual(norm.displayed_final_grade, subjects[i].exp);
      }

      // First Semester General Average:
      // (88 + 90 + 87 + 85 + 84 + 89 + 90 + 87 + 79) / 9 = 779 / 9 = 86.56 (displayed: 87)
      const avg = computeSemesterGeneralAverage(normalized, "1st Semester");
      assert.strictEqual(avg.subjectCount, 9);
      assert.strictEqual(avg.completeness, "COMPLETE");
      assert.strictEqual(avg.officialAverage, 86.56);
      assert.strictEqual(avg.displayedAverage, 87);
    });

    test("All 9 subjects from User's Second Semester table calculate correct whole-number final grades", () => {
      // Second Semester subjects from uploaded image:
      // 1. Reading and Writing: 90, 87 -> (90+87)/2 = 88.5 -> 89
      // 2. Pagbasa at Pagsusuri: 87, 88 -> (87+88)/2 = 87.5 -> 88
      // 3. Personal Development: 85, 85 -> (85+85)/2 = 85 -> 85
      // 4. PE and Health 2: 86, 86 -> (86+86)/2 = 86 -> 86
      // 5. Statistics and Probability: 95, 94 -> (95+94)/2 = 94.5 -> 95
      // 6. DRRR: 78, 81 -> (78+81)/2 = 79.5 -> 80
      // 7. Practical Research 1: 81, 82 -> (81+82)/2 = 81.5 -> 82
      // 8. Basic Calculus: 84, 84 -> (84+84)/2 = 84 -> 84
      // 9. General Chemistry 2: 90, 90 -> (90+90)/2 = 90 -> 90
      const subjects = [
        { name: "Reading and Writing", q3: 90, q4: 87, expRaw: 88.5, expDisplayed: 89 },
        { name: "Pagbasa at Pagsusuri ng Iba't-Ibang Teksto Tungo sa Pananaliksik", q3: 87, q4: 88, expRaw: 87.5, expDisplayed: 88 },
        { name: "Personal Development/ Pansariling Kaunlaran", q3: 85, q4: 85, expRaw: 85, expDisplayed: 85 },
        { name: "Physical Education and Health 2", q3: 86, q4: 86, expRaw: 86, expDisplayed: 86 },
        { name: "Statistics and Probability", q3: 95, q4: 94, expRaw: 94.5, expDisplayed: 95 },
        { name: "Disaster Readiness and Risk Reduction", q3: 78, q4: 81, expRaw: 79.5, expDisplayed: 80 },
        { name: "Practical Research 1", q3: 81, q4: 82, expRaw: 81.5, expDisplayed: 82 },
        { name: "Basic Calculus", q3: 84, q4: 84, expRaw: 84, expDisplayed: 84 },
        { name: "General Chemistry 2", q3: 90, q4: 90, expRaw: 90, expDisplayed: 90 },
      ];

      const records = subjects.map((s) => ({
        subject: s.name,
        semester: "2nd Semester",
        q3: s.q3,
        q4: s.q4,
      }));

      const normalized = normalizeGradeRecords(records, "2nd Semester");
      for (let i = 0; i < subjects.length; i++) {
        const norm = normalized[i];
        assert.strictEqual(norm.q1, undefined);
        assert.strictEqual(norm.q2, undefined);
        assert.strictEqual(norm.q3, subjects[i].q3);
        assert.strictEqual(norm.q4, subjects[i].q4);
        assert.strictEqual(norm.raw_calculated_final, subjects[i].expRaw);
        assert.strictEqual(norm.displayed_final_grade, subjects[i].expDisplayed);
        assert.strictEqual(norm.official_computed_final, subjects[i].expDisplayed);
      }

      // Second Semester General Average:
      // (88.5 + 87.5 + 85 + 86 + 94.5 + 79.5 + 81.5 + 84 + 90) / 9 = 776.5 / 9 = 86.28 (displayed: 86)
      const avg = computeSemesterGeneralAverage(normalized, "2nd Semester");
      assert.strictEqual(avg.subjectCount, 9);
      assert.strictEqual(avg.completeness, "COMPLETE");
      assert.strictEqual(avg.officialAverage, 86.28);
      assert.strictEqual(avg.displayedAverage, 86);
    });

    test("Never mixes Q1/Q2 with Q3/Q4 across semesters in single record or averages", () => {
      const g1 = {
        subject: "General Mathematics",
        semester: "1st Semester",
        q1: 84,
        q2: 84,
      };
      const g2 = {
        subject: "Statistics and Probability",
        semester: "2nd Semester",
        q3: 95,
        q4: 94,
      };

      const allNormalized = normalizeGradeRecords([g1, g2]);

      // 1st Semester average ignores g2
      const sem1Avg = computeSemesterGeneralAverage(allNormalized, "1st Semester");
      assert.strictEqual(sem1Avg.subjectCount, 1);
      assert.strictEqual(sem1Avg.officialAverage, 84);

      // 2nd Semester average ignores g1
      const sem2Avg = computeSemesterGeneralAverage(allNormalized, "2nd Semester");
      assert.strictEqual(sem2Avg.subjectCount, 1);
      assert.strictEqual(sem2Avg.officialAverage, 94.5);
      assert.strictEqual(sem2Avg.displayedAverage, 95);
    });

    test("Keeps Grade 11 and Grade 12 records separate when merging front and back", () => {
      const frontSide = {
        fields: {
          grade_level: "Grade 11",
          grades: [
            {
              subject: "Physical Education and Health",
              grade_level: "Grade 11",
              semester: "1st Semester",
              q1: 85,
              q2: 85,
              final: 85,
            },
          ],
        } ,
      };

      const backSide = {
        fields: {
          grade_level: "Grade 12",
          grades: [
            {
              subject: "Physical Education and Health",
              grade_level: "Grade 12",
              semester: "1st Semester",
              q1: 90,
              q2: 90,
              final: 90,
            },
          ],
        } ,
      };

      const merged = mergeSf9FrontAndBack(frontSide, backSide);
      // Both records MUST exist distinctly; Grade 12 must not overwrite Grade 11
      assert.strictEqual(merged.unifiedFields.grades?.length, 2);
      const g11 = merged.unifiedFields.grades?.find((g) => g.grade_level === "Grade 11");
      const g12 = merged.unifiedFields.grades?.find((g) => g.grade_level === "Grade 12");
      assert.ok(g11);
      assert.ok(g12);
      assert.strictEqual(g11?.final, 85);
      assert.strictEqual(g12?.final, 90);
    });

    test("Azure layout table parser with both semesters extracts both tables into separate records", () => {
      const mockTables = [
        // Table 0: First Semester
        {
          rowCount: 3,
          columnCount: 4,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "First Semester" },
            { rowIndex: 0, columnIndex: 1, content: "Quarter" },
            { rowIndex: 0, columnIndex: 2, content: "Quarter" },
            { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
            { rowIndex: 1, columnIndex: 0, content: "Subjects" },
            { rowIndex: 1, columnIndex: 1, content: "1" },
            { rowIndex: 1, columnIndex: 2, content: "2" },
            { rowIndex: 1, columnIndex: 3, content: "" },
            { rowIndex: 2, columnIndex: 0, content: "Oral Communication" },
            { rowIndex: 2, columnIndex: 1, content: "88" },
            { rowIndex: 2, columnIndex: 2, content: "88" },
            { rowIndex: 2, columnIndex: 3, content: "88" },
          ],
        },
        // Table 1: Second Semester
        {
          rowCount: 3,
          columnCount: 4,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "Second Semester" },
            { rowIndex: 0, columnIndex: 1, content: "Quarter" },
            { rowIndex: 0, columnIndex: 2, content: "Quarter" },
            { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
            { rowIndex: 1, columnIndex: 0, content: "Subjects" },
            { rowIndex: 1, columnIndex: 1, content: "3" },
            { rowIndex: 1, columnIndex: 2, content: "4" },
            { rowIndex: 1, columnIndex: 3, content: "" },
            { rowIndex: 2, columnIndex: 0, content: "Reading and Writing" },
            { rowIndex: 2, columnIndex: 1, content: "90" },
            { rowIndex: 2, columnIndex: 2, content: "87" },
            { rowIndex: 2, columnIndex: 3, content: "" }, // blank final
          ],
        },
      ];

      const res = parseAzureLayoutGrades(mockTables);
      assert.strictEqual(res.grades.length, 2);

      const sem1Subj = res.grades.find((g) => g.subject === "Oral Communication");
      assert.ok(sem1Subj);
      assert.strictEqual(sem1Subj.semester, "1st Semester");
      assert.strictEqual(sem1Subj.q1, 88);
      assert.strictEqual(sem1Subj.q2, 88);
      assert.strictEqual(sem1Subj.q3, undefined);
      assert.strictEqual(sem1Subj.q4, undefined);
      assert.strictEqual(sem1Subj.final, 88);

      const sem2Subj = res.grades.find((g) => g.subject === "Reading and Writing");
      assert.ok(sem2Subj);
      assert.strictEqual(sem2Subj.semester, "2nd Semester");
      assert.strictEqual(sem2Subj.q1, undefined);
      assert.strictEqual(sem2Subj.q2, undefined);
      assert.strictEqual(sem2Subj.q3, 90);
      assert.strictEqual(sem2Subj.q4, 87);
      assert.strictEqual(sem2Subj.displayed_final_grade, 89);
    });

    test("Incomplete quarters do NOT invent grades based on assumptions", () => {
      const record = {
        subject: "General Chemistry 1",
        semester: "1st Semester",
        q1: 79,
        q2: undefined, // Missing Q2
        final: undefined,
      };

      const normalized = recalculateSubjectGradeStatus(record, "1st Semester");
      assert.strictEqual(normalized.q1, 79);
      assert.strictEqual(normalized.q2, undefined);
      assert.strictEqual(normalized.final, undefined);
      assert.strictEqual(normalized.displayed_final_grade, undefined);
      assert.strictEqual(normalized.status, "Missing");
      assert.strictEqual(normalized.needsVerification, true);
      assert.strictEqual(normalized.is_auto_computed, false);
    });
  });
});

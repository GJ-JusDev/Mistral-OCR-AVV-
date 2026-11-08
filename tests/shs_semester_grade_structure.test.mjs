import test from "node:test";
import assert from "node:assert/strict";

import { parseAzureLayoutGrades } from "../src/lib/ocr/tableGradesParser.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

test("AVV Senior High School Semester Grade Structure & Isolation Suite", async (t) => {

  // -------------------------------------------------------------------------
  // Test A: Semester 1 extraction (Quarter 1, Quarter 2, Semester Final Grade)
  // No Quarter 3 or Quarter 4 values.
  // -------------------------------------------------------------------------
  await t.test("Test A — Semester 1 extraction: maps Q1, Q2, sem1_final_grade; leaves Q3 and Q4 undefined", async () => {
    const sem1Table = {
      rowCount: 4,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "REPORT ON LEARNING PROGRESS AND ACHIEVEMENT" },
        { rowIndex: 0, columnIndex: 1, content: "First Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "Quarter 1" },
        { rowIndex: 1, columnIndex: 2, content: "Quarter 2" },
        { rowIndex: 1, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 2, columnIndex: 0, content: "Oral Communication" },
        { rowIndex: 2, columnIndex: 1, content: "88" },
        { rowIndex: 2, columnIndex: 2, content: "90" },
        { rowIndex: 2, columnIndex: 3, content: "89" },
        { rowIndex: 3, columnIndex: 0, content: "General Mathematics" },
        { rowIndex: 3, columnIndex: 1, content: "85" },
        { rowIndex: 3, columnIndex: 2, content: "87" },
        { rowIndex: 3, columnIndex: 3, content: "86" },
      ],
    };

    const result = parseAzureLayoutGrades([sem1Table]);
    assert.strictEqual(result.grades.length, 2, "Expected exactly 2 subject records");

    const oralComm = result.grades.find((g) => g.subject === "Oral Communication");
    assert.ok(oralComm, "Oral Communication record must exist");
    assert.strictEqual(oralComm.semester, "1st Semester", "Must be labeled '1st Semester'");
    assert.strictEqual(oralComm.grading_period_scheme, "quarterly_semestral");
    assert.strictEqual(oralComm.q1, 88, "Q1 must be 88");
    assert.strictEqual(oralComm.q2, 90, "Q2 must be 90");
    assert.strictEqual(oralComm.sem1_final_grade, 89, "sem1_final_grade must be 89");
    assert.strictEqual(oralComm.final, 89, "final candidate must be 89");
    assert.strictEqual(oralComm.q3, undefined, "Q3 MUST be undefined in Semester 1");
    assert.strictEqual(oralComm.q4, undefined, "Q4 MUST be undefined in Semester 1");
    assert.strictEqual(oralComm.sem2_final_grade, undefined, "sem2_final_grade MUST be undefined in Semester 1");
  });

  // -------------------------------------------------------------------------
  // Test B: Semester 2 extraction (Quarter 3, Quarter 4, Semester Final Grade)
  // No Quarter 1 or Quarter 2 values.
  // -------------------------------------------------------------------------
  await t.test("Test B — Semester 2 extraction: maps Q3, Q4, sem2_final_grade; leaves Q1 and Q2 undefined", async () => {
    const sem2Table = {
      rowCount: 4,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Second Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "Quarter 3" },
        { rowIndex: 1, columnIndex: 2, content: "Quarter 4" },
        { rowIndex: 1, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 2, columnIndex: 0, content: "Reading and Writing Skills" },
        { rowIndex: 2, columnIndex: 1, content: "91" },
        { rowIndex: 2, columnIndex: 2, content: "93" },
        { rowIndex: 2, columnIndex: 3, content: "92" },
        { rowIndex: 3, columnIndex: 0, content: "Statistics and Probability" },
        { rowIndex: 3, columnIndex: 1, content: "84" },
        { rowIndex: 3, columnIndex: 2, content: "86" },
        { rowIndex: 3, columnIndex: 3, content: "85" },
      ],
    };

    const result = parseAzureLayoutGrades([sem2Table]);
    assert.strictEqual(result.grades.length, 2, "Expected exactly 2 subject records");

    const readingWriting = result.grades.find((g) => g.subject === "Reading and Writing Skills");
    assert.ok(readingWriting, "Reading and Writing Skills must exist");
    assert.strictEqual(readingWriting.semester, "2nd Semester", "Must be labeled '2nd Semester'");
    assert.strictEqual(readingWriting.grading_period_scheme, "quarterly_semestral");
    assert.strictEqual(readingWriting.q3, 91, "Q3 must be 91");
    assert.strictEqual(readingWriting.q4, 93, "Q4 must be 93");
    assert.strictEqual(readingWriting.sem2_final_grade, 92, "sem2_final_grade must be 92");
    assert.strictEqual(readingWriting.final, 92, "final candidate must be 92");
    assert.strictEqual(readingWriting.q1, undefined, "Q1 MUST be undefined in Semester 2");
    assert.strictEqual(readingWriting.q2, undefined, "Q2 MUST be undefined in Semester 2");
    assert.strictEqual(readingWriting.sem1_final_grade, undefined, "sem1_final_grade MUST be undefined in Semester 2");
  });

  // -------------------------------------------------------------------------
  // Test C: Semester 1 and Semester 2 have different subjects.
  // They must NOT merge into one row.
  // -------------------------------------------------------------------------
  await t.test("Test C — Different subjects across Semesters 1 and 2 NEVER merge into one row", async () => {
    const sem1Table = {
      rowCount: 3,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "First Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "Quarter 1" },
        { rowIndex: 1, columnIndex: 2, content: "Quarter 2" },
        { rowIndex: 1, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 2, columnIndex: 0, content: "Oral Communication" },
        { rowIndex: 2, columnIndex: 1, content: "88" },
        { rowIndex: 2, columnIndex: 2, content: "90" },
        { rowIndex: 2, columnIndex: 3, content: "89" },
      ],
    };

    const sem2Table = {
      rowCount: 3,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Second Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "Quarter 3" },
        { rowIndex: 1, columnIndex: 2, content: "Quarter 4" },
        { rowIndex: 1, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 2, columnIndex: 0, content: "Reading and Writing Skills" },
        { rowIndex: 2, columnIndex: 1, content: "91" },
        { rowIndex: 2, columnIndex: 2, content: "93" },
        { rowIndex: 2, columnIndex: 3, content: "92" },
      ],
    };

    const result = parseAzureLayoutGrades([sem1Table, sem2Table]);
    assert.strictEqual(result.grades.length, 2, "Expected 2 separate records for different semestral subjects");

    const sem1 = result.grades.filter((g) => g.semester === "1st Semester");
    const sem2 = result.grades.filter((g) => g.semester === "2nd Semester");

    assert.strictEqual(sem1.length, 1);
    assert.strictEqual(sem2.length, 1);
    assert.strictEqual(sem1[0].subject, "Oral Communication");
    assert.strictEqual(sem2[0].subject, "Reading and Writing Skills");

    // Also test if by coincidence a subject has the same name in both semesters (e.g. Physical Education)
    const peSem1Table = {
      rowCount: 3,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "First Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "1" },
        { rowIndex: 1, columnIndex: 2, content: "2" },
        { rowIndex: 1, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 2, columnIndex: 0, content: "Physical Education" },
        { rowIndex: 2, columnIndex: 1, content: "95" },
        { rowIndex: 2, columnIndex: 2, content: "96" },
        { rowIndex: 2, columnIndex: 3, content: "96" },
      ],
    };
    const peSem2Table = {
      rowCount: 3,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Second Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "3" },
        { rowIndex: 1, columnIndex: 2, content: "4" },
        { rowIndex: 1, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 2, columnIndex: 0, content: "Physical Education" },
        { rowIndex: 2, columnIndex: 1, content: "97" },
        { rowIndex: 2, columnIndex: 2, content: "98" },
        { rowIndex: 2, columnIndex: 3, content: "98" },
      ],
    };

    const peResult = parseAzureLayoutGrades([peSem1Table, peSem2Table]);
    assert.strictEqual(peResult.grades.length, 2, "Even same-named subjects in different semesters must NOT merge");
    assert.strictEqual(peResult.grades[0].semester, "1st Semester");
    assert.strictEqual(peResult.grades[0].sem1_final_grade, 96);
    assert.strictEqual(peResult.grades[0].q3, undefined);
    assert.strictEqual(peResult.grades[1].semester, "2nd Semester");
    assert.strictEqual(peResult.grades[1].sem2_final_grade, 98);
    assert.strictEqual(peResult.grades[1].q1, undefined);
  });

  // -------------------------------------------------------------------------
  // Test D: 'Core Subjects' category header is excluded from subject records
  // -------------------------------------------------------------------------
  await t.test("Test D — 'Core Subjects' category header is excluded from subject records", async () => {
    const tableWithCoreHeader = {
      rowCount: 4,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "First Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "1" },
        { rowIndex: 1, columnIndex: 2, content: "2" },
        { rowIndex: 1, columnIndex: 3, content: "Final" },
        { rowIndex: 2, columnIndex: 0, content: "Core Subjects" },
        { rowIndex: 3, columnIndex: 0, content: "Oral Communication" },
        { rowIndex: 3, columnIndex: 1, content: "90" },
        { rowIndex: 3, columnIndex: 2, content: "92" },
        { rowIndex: 3, columnIndex: 3, content: "91" },
      ],
    };

    const result = parseAzureLayoutGrades([tableWithCoreHeader]);
    assert.strictEqual(result.grades.length, 1, "Only the actual subject must be in grades");
    assert.strictEqual(result.grades[0].subject, "Oral Communication");
    assert.strictEqual(result.grades[0].category, "Core Subjects", "Subject should inherit Core Subjects category");

    const coreHeaderRecord = result.grades.find((g) => g.subject.toLowerCase().includes("core subjects"));
    assert.strictEqual(coreHeaderRecord, undefined, "'Core Subjects' must NOT be a subject record");
  });

  // -------------------------------------------------------------------------
  // Test E: 'Applied and Specialized Subjects' category header is excluded
  // -------------------------------------------------------------------------
  await t.test("Test E — 'Applied and Specialized Subjects' category header is excluded from subject records", async () => {
    const tableWithAppliedHeader = {
      rowCount: 5,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "First Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "1" },
        { rowIndex: 1, columnIndex: 2, content: "2" },
        { rowIndex: 1, columnIndex: 3, content: "Final" },
        { rowIndex: 2, columnIndex: 0, content: "Applied and Specialized Subjects" },
        { rowIndex: 3, columnIndex: 0, content: "Empowerment Technologies" },
        { rowIndex: 3, columnIndex: 1, content: "85" },
        { rowIndex: 3, columnIndex: 2, content: "89" },
        { rowIndex: 3, columnIndex: 3, content: "87" },
        { rowIndex: 4, columnIndex: 0, content: "Pre-Calculus" },
        { rowIndex: 4, columnIndex: 1, content: "80" },
        { rowIndex: 4, columnIndex: 2, content: "82" },
        { rowIndex: 4, columnIndex: 3, content: "81" },
      ],
    };

    const result = parseAzureLayoutGrades([tableWithAppliedHeader]);
    assert.strictEqual(result.grades.length, 2, "Only the 2 actual subjects must be in grades");
    assert.strictEqual(result.grades[0].subject, "Empowerment Technologies");
    assert.strictEqual(result.grades[0].category, "Applied and Specialized Subjects");
    assert.strictEqual(result.grades[1].subject, "Pre-Calculus");
    assert.strictEqual(result.grades[1].category, "Applied and Specialized Subjects");

    const appliedRecord = result.grades.find((g) =>
      g.subject.toLowerCase().includes("applied and specialized")
    );
    assert.strictEqual(appliedRecord, undefined, "'Applied and Specialized Subjects' must NOT be a subject record");
  });

  // -------------------------------------------------------------------------
  // Test F: Blank Semester 2 is preserved as blank. Zero invented grades.
  // -------------------------------------------------------------------------
  await t.test("Test F — Blank Semester 2 is preserved as blank; zero invented grades or averages", async () => {
    const sem2BlankTable = {
      rowCount: 4,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Second Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "3" },
        { rowIndex: 1, columnIndex: 2, content: "4" },
        { rowIndex: 1, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 2, columnIndex: 0, content: "Reading and Writing Skills" },
        { rowIndex: 2, columnIndex: 1, content: "" },
        { rowIndex: 2, columnIndex: 2, content: "" },
        { rowIndex: 2, columnIndex: 3, content: "" },
        { rowIndex: 3, columnIndex: 0, content: "Statistics and Probability" },
        { rowIndex: 3, columnIndex: 1, content: "-" },
        { rowIndex: 3, columnIndex: 2, content: "-" },
        { rowIndex: 3, columnIndex: 3, content: "-" },
      ],
    };

    const result = parseAzureLayoutGrades([sem2BlankTable]);
    assert.strictEqual(result.grades.length, 2);

    for (const g of result.grades) {
      assert.strictEqual(g.q3, undefined, "Blank Q3 must stay undefined");
      assert.strictEqual(g.q4, undefined, "Blank Q4 must stay undefined");
      assert.strictEqual(g.sem2_final_grade, undefined, "Blank sem2_final_grade must stay undefined");
      assert.strictEqual(g.final, undefined, "Final grade candidate must stay undefined");
      assert.strictEqual(g.status, "Missing", "Status must be Missing");
      assert.strictEqual(g.needsVerification, true, "needsVerification must be true");
    }
    assert.strictEqual(result.general_average, undefined, "General average must NOT be invented");
  });

  // -------------------------------------------------------------------------
  // Test G: Unusual numeric value '32' is preserved as 32.
  // -------------------------------------------------------------------------
  await t.test("Test G — Unusual numeric value '32' is strictly preserved as 32 (never altered)", async () => {
    const tableWithUnusualGrade = {
      rowCount: 3,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "First Semester" },
        { rowIndex: 1, columnIndex: 0, content: "Subjects" },
        { rowIndex: 1, columnIndex: 1, content: "1" },
        { rowIndex: 1, columnIndex: 2, content: "2" },
        { rowIndex: 1, columnIndex: 3, content: "Final" },
        { rowIndex: 2, columnIndex: 0, content: "General Mathematics" },
        { rowIndex: 2, columnIndex: 1, content: "32" },
        { rowIndex: 2, columnIndex: 2, content: "75" },
        { rowIndex: 2, columnIndex: 3, content: "54" },
      ],
    };

    const result = parseAzureLayoutGrades([tableWithUnusualGrade]);
    assert.strictEqual(result.grades.length, 1);
    const math = result.grades[0];
    assert.strictEqual(math.q1, 32, "Numeric value 32 must be preserved exactly as 32");
    assert.strictEqual(math.q2, 75);
    assert.strictEqual(math.sem1_final_grade, 54);
    assert.strictEqual(math.status, "Failed", "54 is below 75, so status must be Failed");
  });

  // -------------------------------------------------------------------------
  // Test H: 'Observed Values' table produces zero grade records.
  // -------------------------------------------------------------------------
  await t.test("Test H — 'Observed Values' table produces ZERO grade records", async () => {
    const observedValuesTable = {
      rowCount: 5,
      columnCount: 5,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "REPORT ON LEARNER'S OBSERVED VALUES" },
        { rowIndex: 1, columnIndex: 0, content: "Core Values" },
        { rowIndex: 1, columnIndex: 1, content: "Behavior Statements" },
        { rowIndex: 1, columnIndex: 2, content: "Quarter 1" },
        { rowIndex: 1, columnIndex: 3, content: "Quarter 2" },
        { rowIndex: 1, columnIndex: 4, content: "Quarter 3" },
        { rowIndex: 2, columnIndex: 0, content: "1. Maka-Diyos" },
        { rowIndex: 2, columnIndex: 1, content: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others" },
        { rowIndex: 2, columnIndex: 2, content: "AO" },
        { rowIndex: 2, columnIndex: 3, content: "SO" },
        { rowIndex: 2, columnIndex: 4, content: "RO" },
        { rowIndex: 3, columnIndex: 0, content: "2. Makatao" },
        { rowIndex: 3, columnIndex: 1, content: "Shows adherence to ethical principles" },
        { rowIndex: 3, columnIndex: 2, content: "AO" },
        { rowIndex: 3, columnIndex: 3, content: "AO" },
        { rowIndex: 3, columnIndex: 4, content: "AO" },
        { rowIndex: 4, columnIndex: 0, content: "3. Makakalikasan" },
        { rowIndex: 4, columnIndex: 1, content: "Cares for the environment" },
        { rowIndex: 4, columnIndex: 2, content: "AO" },
        { rowIndex: 4, columnIndex: 3, content: "AO" },
        { rowIndex: 4, columnIndex: 4, content: "AO" },
      ],
    };

    const result = parseAzureLayoutGrades([observedValuesTable]);
    assert.strictEqual(result.grades.length, 0, "Observed Values table must produce ZERO grade records");
  });

  // -------------------------------------------------------------------------
  // Test I: 'Grading Scale' table produces zero grade records.
  // -------------------------------------------------------------------------
  await t.test("Test I — 'Grading Scale' table produces ZERO grade records", async () => {
    const gradingScaleTable = {
      rowCount: 6,
      columnCount: 3,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Descriptors" },
        { rowIndex: 0, columnIndex: 1, content: "Grading Scale" },
        { rowIndex: 0, columnIndex: 2, content: "Remarks" },
        { rowIndex: 1, columnIndex: 0, content: "Outstanding" },
        { rowIndex: 1, columnIndex: 1, content: "90-100" },
        { rowIndex: 1, columnIndex: 2, content: "Passed" },
        { rowIndex: 2, columnIndex: 0, content: "Very Satisfactory" },
        { rowIndex: 2, columnIndex: 1, content: "85-89" },
        { rowIndex: 2, columnIndex: 2, content: "Passed" },
        { rowIndex: 3, columnIndex: 0, content: "Fairly Satisfactory" },
        { rowIndex: 3, columnIndex: 1, content: "75-79" },
        { rowIndex: 3, columnIndex: 2, content: "Passed" },
        { rowIndex: 4, columnIndex: 0, content: "Did Not Meet Expectations" },
        { rowIndex: 4, columnIndex: 1, content: "Below 75" },
        { rowIndex: 4, columnIndex: 2, content: "Failed" },
      ],
    };

    const result = parseAzureLayoutGrades([gradingScaleTable]);
    assert.strictEqual(result.grades.length, 0, "Grading Scale table must produce ZERO grade records");
  });

  // -------------------------------------------------------------------------
  // Test J: Elementary and Junior High School parser regression:
  // Full-year quarterly cards still parse correctly into Q1, Q2, Q3, Q4, Final.
  // -------------------------------------------------------------------------
  await t.test("Test J — Elementary & JHS Regression: Full-year quarterly cards parse into Q1, Q2, Q3, Q4, Final", async () => {
    // 1. Azure Table format for Elementary / JHS (Single table with Q1..Q4)
    const elemJhsTable = {
      rowCount: 4,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Learning Areas" },
        { rowIndex: 0, columnIndex: 1, content: "Quarter 1" },
        { rowIndex: 0, columnIndex: 2, content: "Quarter 2" },
        { rowIndex: 0, columnIndex: 3, content: "Quarter 3" },
        { rowIndex: 0, columnIndex: 4, content: "Quarter 4" },
        { rowIndex: 0, columnIndex: 5, content: "Final Grade" },
        { rowIndex: 1, columnIndex: 0, content: "Filipino" },
        { rowIndex: 1, columnIndex: 1, content: "85" },
        { rowIndex: 1, columnIndex: 2, content: "86" },
        { rowIndex: 1, columnIndex: 3, content: "87" },
        { rowIndex: 1, columnIndex: 4, content: "88" },
        { rowIndex: 1, columnIndex: 5, content: "87" },
        { rowIndex: 2, columnIndex: 0, content: "English" },
        { rowIndex: 2, columnIndex: 1, content: "88" },
        { rowIndex: 2, columnIndex: 2, content: "89" },
        { rowIndex: 2, columnIndex: 3, content: "90" },
        { rowIndex: 2, columnIndex: 4, content: "91" },
        { rowIndex: 2, columnIndex: 5, content: "90" },
        { rowIndex: 3, columnIndex: 0, content: "General Average" },
        { rowIndex: 3, columnIndex: 5, content: "88.5" },
      ],
    };

    const elemResult = parseAzureLayoutGrades([elemJhsTable]);
    assert.strictEqual(elemResult.grades.length, 2, "Expected 2 subjects for Elementary/JHS");

    const filipino = elemResult.grades.find((g) => g.subject === "Filipino");
    assert.ok(filipino);
    assert.strictEqual(filipino.grading_period_scheme, "quarterly");
    assert.strictEqual(filipino.semester, undefined, "Elementary/JHS must NOT have semester");
    assert.strictEqual(filipino.q1, 85);
    assert.strictEqual(filipino.q2, 86);
    assert.strictEqual(filipino.q3, 87);
    assert.strictEqual(filipino.q4, 88);
    assert.strictEqual(filipino.final, 87);
    assert.strictEqual(filipino.status, "Passed");

    assert.strictEqual(elemResult.general_average, 88.5, "General Average must be recognized");

    // 2. Legacy text parser regression check via parseGradesText
    const elemMarkdown = `
| Learning Areas | 1 | 2 | 3 | 4 | Final |
|---|---|---|---|---|---|
| Filipino | 85 | 86 | 87 | 88 | 87 |
| English | 88 | 89 | 90 | 91 | 90 |
| Mathematics | 80 | 82 | 84 | 86 | 83 |
| General Average | | | | | 86.67 |
`;
    const textResult = parseGradesText(elemMarkdown, "Elementary");
    assert.ok(textResult.grades && textResult.grades.length >= 3);
    const textFil = textResult.grades.find((g) => g.subject.toLowerCase().includes("filipino"));
    assert.ok(textFil);
    assert.strictEqual(textFil.q1, 85);
    assert.strictEqual(textFil.q2, 86);
    assert.strictEqual(textFil.q3, 87);
    assert.strictEqual(textFil.q4, 88);
    assert.strictEqual(textFil.final, 87);
  });

  // -------------------------------------------------------------------------
  // Test K: Markdown Fallback for Senior High School preserves semestral separation
  // -------------------------------------------------------------------------
  await t.test("Test K — Markdown Fallback: Senior High pipe table parses into 1st & 2nd Semester without cross-merging", async () => {
    const shsMarkdown = `
# REPORT ON LEARNING PROGRESS AND ACHIEVEMENT

## First Semester
| Subjects | 1 | 2 | Semester Final Grade |
|---|---|---|---|
| Core Subjects | | | |
| Oral Communication | 88 | 90 | 89 |
| General Mathematics | 85 | 87 | 86 |
| Applied and Specialized Subjects | | | |
| Empowerment Technologies | 90 | 92 | 91 |

## Second Semester
| Subjects | 3 | 4 | Semester Final Grade |
|---|---|---|---|
| Core Subjects | | | |
| Reading and Writing Skills | 91 | 93 | 92 |
| Statistics and Probability | 84 | 86 | 85 |
| Applied and Specialized Subjects | | | |
| Practical Research 1 | 89 | 91 | 90 |

| General Average | | | 88.83 |
`;

    const parsed = parseSeniorHighGradesText(shsMarkdown);
    assert.ok(parsed.grades);
    assert.strictEqual(parsed.grades.length, 6, "Expected 3 subjects in Sem 1 + 3 subjects in Sem 2");

    const sem1Grades = parsed.grades.filter((g) => g.semester === "1st Semester");
    const sem2Grades = parsed.grades.filter((g) => g.semester === "2nd Semester");

    assert.strictEqual(sem1Grades.length, 3, "Sem 1 must have 3 subjects");
    assert.strictEqual(sem2Grades.length, 3, "Sem 2 must have 3 subjects");

    const oralComm = sem1Grades.find((g) => g.subject === "Oral Communication");
    assert.ok(oralComm);
    assert.strictEqual(oralComm.category, "Core Subjects");
    assert.strictEqual(oralComm.q1, 88);
    assert.strictEqual(oralComm.q2, 90);
    assert.strictEqual(oralComm.sem1_final_grade, 89);
    assert.strictEqual(oralComm.q3, undefined);
    assert.strictEqual(oralComm.q4, undefined);

    const rw = sem2Grades.find((g) => g.subject === "Reading and Writing Skills");
    assert.ok(rw);
    assert.strictEqual(rw.category, "Core Subjects");
    assert.strictEqual(rw.q3, 91);
    assert.strictEqual(rw.q4, 93);
    assert.strictEqual(rw.sem2_final_grade, 92);
    assert.strictEqual(rw.q1, undefined);
    assert.strictEqual(rw.q2, undefined);

    // Ensure category headers are not in subject list
    const hasCore = parsed.grades.some((g) => g.subject.toLowerCase() === "core subjects");
    const hasApplied = parsed.grades.some((g) => g.subject.toLowerCase() === "applied and specialized subjects");
    assert.strictEqual(hasCore, false);
    assert.strictEqual(hasApplied, false);
  });
});

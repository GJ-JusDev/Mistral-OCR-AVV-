import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  parseContentStreamTextItems,
  clusterAndReconstructRows,
} from "../src/lib/ocr/pdfTextExtractor.ts";
import {
  extractExcelDocument,
  isExcelOrCsvMimeOrExt,
} from "../src/lib/ocr/excelDocumentExtractor.ts";
import {
  parseSf10ShsText,
} from "../src/lib/ocr/sf10ShsParser.ts";
import {
  parseShsSf1,
} from "../src/lib/ocr/shsSf1Parser.ts";
import {
  parseShsSf2,
  deduplicateSf2Records,
} from "../src/lib/ocr/shsSf2Parser.ts";
import {
  parseGradesText,
} from "../src/lib/ocr/gradesParser.ts";

test("Universal PDF Reader + Excel (.xlsx/.xls/.csv) + Microsoft Azure Fusion Regression Suite", async (t) => {
  // =========================================================================
  // 1. Coordinate-Aware PDF Reader + Azure Fusion on SF10-SHS
  // =========================================================================
  await t.test(
    "1. SF10 PDF Extraction: extracts TAYSAN RESETTLEMENT INTEGRATED SCHOOL, clean subject titles, distinct Q1/Q2 & Q3/Q4, and exact categories",
    () => {
      // Coordinate text stream representing digital SF10 PDF (SF10_SHS_Filled_From_SF9_Front_1Page.pdf)
      const sf10PdfContentStream = `
BT
1 0 0 1 200 780 Tm (W NG REPUBLIC DEPARTMENT OF THE OF EDUCATION PHILIPPINES) Tj
1 0 0 1 220 760 Tm (SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD) Tj
1 0 0 1 80 730 Tm (LAST NAME: GOMEZ) Tj
1 0 0 1 220 730 Tm (FIRST NAME: JUSTIN) Tj
1 0 0 1 360 730 Tm (MIDDLE NAME: LOQUILLANO) Tj
1 0 0 1 80 715 Tm (LRN: 111304501972) Tj
1 0 0 1 240 715 Tm (Date of Birth: 06/23/2004) Tj
1 0 0 1 400 715 Tm (Sex: Male) Tj

1 0 0 1 80 680 Tm (SCHOLASTIC RECORD) Tj
1 0 0 1 80 665 Tm (SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL) Tj
1 0 0 1 350 665 Tm (SCHOOL ID: 500619) Tj
1 0 0 1 440 665 Tm (GRADE LEVEL: 11) Tj
1 0 0 1 520 665 Tm (SY: 2024-2025) Tj
1 0 0 1 600 665 Tm (SEM: 1st) Tj

1 0 0 1 80 640 Tm (CORE) Tj
1 0 0 1 140 640 Tm (General Mathematics) Tj
1 0 0 1 340 640 Tm (76) Tj
1 0 0 1 380 640 Tm (94) Tj
1 0 0 1 420 640 Tm (85) Tj
1 0 0 1 470 640 Tm (PASSED) Tj

1 0 0 1 80 620 Tm (CORE) Tj
1 0 0 1 140 620 Tm (Earth Science) Tj
1 0 0 1 340 620 Tm (89) Tj
1 0 0 1 380 620 Tm (83) Tj
1 0 0 1 420 620 Tm (86) Tj
1 0 0 1 470 620 Tm (PASSED) Tj

1 0 0 1 80 600 Tm (APPLIED) Tj
1 0 0 1 140 600 Tm (Empowerment Technologies) Tj
1 0 0 1 340 600 Tm (91) Tj
1 0 0 1 380 600 Tm (93) Tj
1 0 0 1 420 600 Tm (92) Tj
1 0 0 1 470 600 Tm (PASSED) Tj

1 0 0 1 80 580 Tm (SPECIALIZED) Tj
1 0 0 1 140 580 Tm (Pre-Calculus) Tj
1 0 0 1 340 580 Tm (96) Tj
1 0 0 1 380 580 Tm (80) Tj
1 0 0 1 420 580 Tm (88) Tj
1 0 0 1 470 580 Tm (PASSED) Tj

1 0 0 1 80 560 Tm (SPECIALIZED) Tj
1 0 0 1 140 560 Tm (General Chemistry 1) Tj
1 0 0 1 340 560 Tm (90) Tj
1 0 0 1 380 560 Tm (80) Tj
1 0 0 1 420 560 Tm (85) Tj
1 0 0 1 470 560 Tm (PASSED) Tj

1 0 0 1 140 540 Tm (General Ave. for the Semester) Tj
1 0 0 1 420 540 Tm (87.2) Tj

1 0 0 1 80 500 Tm (SCHOLASTIC RECORD) Tj
1 0 0 1 80 485 Tm (SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL) Tj
1 0 0 1 350 485 Tm (SCHOOL ID: 500619) Tj
1 0 0 1 440 485 Tm (GRADE LEVEL: 11) Tj
1 0 0 1 520 485 Tm (SY: 2024-2025) Tj
1 0 0 1 600 485 Tm (SEM: 2nd) Tj

1 0 0 1 80 460 Tm (CORE) Tj
1 0 0 1 140 460 Tm (Reading and Writing) Tj
1 0 0 1 340 460 Tm (70) Tj
1 0 0 1 380 460 Tm (98) Tj
1 0 0 1 420 460 Tm (84) Tj
1 0 0 1 470 460 Tm (PASSED) Tj

1 0 0 1 80 440 Tm (CORE) Tj
1 0 0 1 140 440 Tm (Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik) Tj
1 0 0 1 340 440 Tm (80) Tj
1 0 0 1 380 440 Tm (80) Tj
1 0 0 1 420 440 Tm (80) Tj
1 0 0 1 470 440 Tm (PASSED) Tj

1 0 0 1 80 420 Tm (CORE) Tj
1 0 0 1 140 420 Tm (Personal Development) Tj
1 0 0 1 340 420 Tm (90) Tj
1 0 0 1 380 420 Tm (90) Tj
1 0 0 1 420 420 Tm (90) Tj
1 0 0 1 470 420 Tm (PASSED) Tj

1 0 0 1 80 400 Tm (CORE) Tj
1 0 0 1 140 400 Tm (Physical Education and Health 2 95) Tj
1 0 0 1 380 400 Tm (75) Tj
1 0 0 1 420 400 Tm (85) Tj
1 0 0 1 470 400 Tm (PASSED) Tj

1 0 0 1 80 380 Tm (CORE) Tj
1 0 0 1 140 380 Tm (Statistics and Probability 86) Tj
1 0 0 1 380 380 Tm (87) Tj
1 0 0 1 420 380 Tm (87) Tj
1 0 0 1 470 380 Tm (PASSED) Tj

1 0 0 1 80 360 Tm (CORE) Tj
1 0 0 1 140 360 Tm (Disaster Readiness and Risk Reduction 91) Tj
1 0 0 1 380 360 Tm (93) Tj
1 0 0 1 420 360 Tm (92) Tj
1 0 0 1 470 360 Tm (PASSED) Tj

1 0 0 1 80 340 Tm (APPLIED) Tj
1 0 0 1 140 340 Tm (Practical Research 1 84) Tj
1 0 0 1 380 340 Tm (87) Tj
1 0 0 1 420 340 Tm (86) Tj
1 0 0 1 470 340 Tm (PASSED) Tj

1 0 0 1 80 320 Tm (SPECIALIZED) Tj
1 0 0 1 140 320 Tm (Basic Calculus 88) Tj
1 0 0 1 380 320 Tm (98) Tj
1 0 0 1 420 320 Tm (93) Tj
1 0 0 1 470 320 Tm (PASSED) Tj

1 0 0 1 80 300 Tm (SPECIALIZED) Tj
1 0 0 1 140 300 Tm (General Chemistry 2 78) Tj
1 0 0 1 380 300 Tm (81) Tj
1 0 0 1 420 300 Tm (80) Tj
1 0 0 1 470 300 Tm (PASSED) Tj

1 0 0 1 140 280 Tm (General Ave. for the Semester) Tj
1 0 0 1 420 280 Tm (87.0) Tj
ET
`;

      const items = parseContentStreamTextItems(sf10PdfContentStream);
      const reconstructedRows = clusterAndReconstructRows(items);

      // Reconstructed raw text
      const fullText = reconstructedRows.join("\n");

      // Pass reconstructedRows inside rawLayout to parseSf10ShsText
      const parsed = parseSf10ShsText(fullText, { reconstructedRows });

      // School Name check: strictly TAYSAN RESETTLEMENT INTEGRATED SCHOOL (never administrative DepEd header)
      assert.equal(
        parsed.scholastic_records[0].school_name,
        "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
        "Must extract exact school name, ignoring DepEd banner"
      );
      assert.equal(
        parsed.scholastic_records[1].school_name,
        "TAYSAN RESETTLEMENT INTEGRATED SCHOOL"
      );

      // Verify Semesters
      assert.equal(parsed.scholastic_records.length, 2);

      // Sem 1 Subjects & Distinct Q1 / Q2 verification
      const sem1 = parsed.scholastic_records[0];
      assert.equal(sem1.subjects.length, 5);

      const genMath = sem1.subjects.find((s) => s.subject.includes("General Mathematics"));
      assert.ok(genMath, "General Mathematics must be found");
      assert.equal(genMath.subject_type, "CORE");
      assert.equal(genMath.q1, 76);
      assert.equal(genMath.q2, 94);
      assert.equal(genMath.sem_final_grade, 85);

      const earthSci = sem1.subjects.find((s) => s.subject.includes("Earth Science"));
      assert.ok(earthSci, "Earth Science must be found");
      assert.equal(earthSci.subject_type, "CORE");
      assert.equal(earthSci.q1, 89);
      assert.equal(earthSci.q2, 83);
      assert.equal(earthSci.sem_final_grade, 86);

      const empTech = sem1.subjects.find((s) => s.subject.includes("Empowerment Technologies"));
      assert.ok(empTech, "Empowerment Technologies must be found");
      assert.equal(empTech.subject_type, "APPLIED", "Empowerment Tech must be APPLIED");
      assert.equal(empTech.q1, 91);
      assert.equal(empTech.q2, 93);
      assert.equal(empTech.sem_final_grade, 92);

      const preCalc = sem1.subjects.find((s) => s.subject.includes("Pre-Calculus"));
      assert.ok(preCalc, "Pre-Calculus must be found");
      assert.equal(preCalc.subject_type, "SPECIALIZED", "Pre-Calculus must be SPECIALIZED");
      assert.equal(preCalc.q1, 96);
      assert.equal(preCalc.q2, 80);
      assert.equal(preCalc.sem_final_grade, 88);

      const genChem1 = sem1.subjects.find((s) => s.subject.includes("General Chemistry 1"));
      assert.ok(genChem1, "General Chemistry 1 must be found");
      assert.equal(genChem1.subject_type, "SPECIALIZED", "General Chemistry 1 must be SPECIALIZED");
      assert.equal(genChem1.q1, 90);
      assert.equal(genChem1.q2, 80);
      assert.equal(genChem1.sem_final_grade, 85);

      // Sem 2 Subjects & Distinct Q3 / Q4 verification (and stripped trailing grade tokens)
      const sem2 = parsed.scholastic_records[1];
      assert.equal(sem2.subjects.length, 9);

      const readWrite = sem2.subjects.find((s) => s.subject.includes("Reading and Writing"));
      assert.ok(readWrite);
      assert.equal(readWrite.subject_type, "CORE");
      assert.equal(readWrite.q3, 70);
      assert.equal(readWrite.q4, 98);
      assert.equal(readWrite.sem_final_grade, 84);

      const pagbasa = sem2.subjects.find((s) => s.subject.includes("Pagbasa"));
      assert.ok(pagbasa);
      assert.equal(pagbasa.subject_type, "CORE");
      assert.equal(pagbasa.q3, 80);
      assert.equal(pagbasa.q4, 80);
      assert.equal(pagbasa.sem_final_grade, 80);

      const persDev = sem2.subjects.find((s) => s.subject.includes("Personal Development"));
      assert.ok(persDev);
      assert.equal(persDev.subject_type, "CORE");
      assert.equal(persDev.q3, 90);
      assert.equal(persDev.q4, 90);
      assert.equal(persDev.sem_final_grade, 90);

      // Verify "Physical Education and Health 2 95" has trailing 95 stripped cleanly from name
      const pe2 = sem2.subjects.find((s) => s.subject.includes("Physical Education and Health 2"));
      assert.ok(pe2, "PE & Health 2 must be found");
      assert.equal(pe2.subject, "Physical Education and Health 2", "Trailing grade 95 must not pollute subject name");
      assert.equal(pe2.subject_type, "CORE");
      assert.equal(pe2.q3, 95);
      assert.equal(pe2.q4, 75);
      assert.equal(pe2.sem_final_grade, 85);

      const statProb = sem2.subjects.find((s) => s.subject.includes("Statistics and Probability"));
      assert.ok(statProb);
      assert.equal(statProb.subject, "Statistics and Probability", "Trailing grade 86 must not pollute subject name");
      assert.equal(statProb.subject_type, "CORE");
      assert.equal(statProb.q3, 86);
      assert.equal(statProb.q4, 87);
      assert.equal(statProb.sem_final_grade, 87);

      const drrr = sem2.subjects.find((s) => s.subject.includes("Disaster Readiness"));
      assert.ok(drrr);
      assert.equal(drrr.subject, "Disaster Readiness and Risk Reduction");
      assert.equal(drrr.subject_type, "CORE");
      assert.equal(drrr.q3, 91);
      assert.equal(drrr.q4, 93);
      assert.equal(drrr.sem_final_grade, 92);

      const pracRes = sem2.subjects.find((s) => s.subject.includes("Practical Research 1"));
      assert.ok(pracRes);
      assert.equal(pracRes.subject, "Practical Research 1");
      assert.equal(pracRes.subject_type, "APPLIED", "Practical Research 1 must be APPLIED");
      assert.equal(pracRes.q3, 84);
      assert.equal(pracRes.q4, 87);
      assert.equal(pracRes.sem_final_grade, 86);

      const basicCalc = sem2.subjects.find((s) => s.subject.includes("Basic Calculus"));
      assert.ok(basicCalc);
      assert.equal(basicCalc.subject, "Basic Calculus");
      assert.equal(basicCalc.subject_type, "SPECIALIZED", "Basic Calculus must be SPECIALIZED");
      assert.equal(basicCalc.q3, 88);
      assert.equal(basicCalc.q4, 98);
      assert.equal(basicCalc.sem_final_grade, 93);

      const genChem2 = sem2.subjects.find((s) => s.subject.includes("General Chemistry 2"));
      assert.ok(genChem2);
      assert.equal(genChem2.subject, "General Chemistry 2");
      assert.equal(genChem2.subject_type, "SPECIALIZED", "General Chemistry 2 must be SPECIALIZED");
      assert.equal(genChem2.q3, 78);
      assert.equal(genChem2.q4, 81);
      assert.equal(genChem2.sem_final_grade, 80);
    }
  );

  // =========================================================================
  // 2. Coordinate-Aware PDF Reader + Azure Fusion on SF1, SF2, SF9
  // =========================================================================
  await t.test(
    "2. PDF Reader + Azure Fusion on SF1, SF2, and SF9 PDFs",
    () => {
      // 2a. SF1 PDF coordinate extraction
      const sf1Stream = `
BT
1 0 0 1 50 750 Tm (School ID: 500619) Tj
1 0 0 1 180 750 Tm (School Name: TAYSAN RESETTLEMENT INTEGRATED SCHOOL) Tj
1 0 0 1 450 750 Tm (Grade Level: 11) Tj
1 0 0 1 550 750 Tm (Section: Diamond) Tj
1 0 0 1 650 750 Tm (School Year: 2024-2025) Tj
1 0 0 1 50 700 Tm (111500619123) Tj
1 0 0 1 150 700 Tm (Gomez, Justin Loquillano) Tj
1 0 0 1 320 700 Tm (M) Tj
1 0 0 1 350 700 Tm (06/23/2004) Tj
ET
`;
      const sf1Items = parseContentStreamTextItems(sf1Stream);
      const sf1Rows = clusterAndReconstructRows(sf1Items);
      const sf1Parsed = parseShsSf1(sf1Rows.join("\n"), { reconstructedRows: sf1Rows });

      assert.equal(sf1Parsed.no_student_found, false);
      assert.equal(sf1Parsed.learners.length, 1);
      assert.equal(sf1Parsed.learners[0].lrn, "111500619123");
      assert.equal(sf1Parsed.learners[0].full_name, "Gomez, Justin Loquillano");
      assert.equal(sf1Parsed.header.school_id, "500619");
      assert.equal(sf1Parsed.header.school_name, "Taysan Resettlement Integrated School");

      // 2b. SF2 PDF coordinate extraction
      const sf2Stream = `
BT
1 0 0 1 50 750 Tm (School ID: 500619) Tj
1 0 0 1 180 750 Tm (School Name: Taysan Resettlement Integrated School) Tj
1 0 0 1 50 700 Tm (111500619123) Tj
1 0 0 1 150 700 Tm (Gomez, Justin Loquillano) Tj
1 0 0 1 350 700 Tm (21) Tj
1 0 0 1 380 700 Tm (0) Tj
1 0 0 1 50 670 Tm (111500619124) Tj
1 0 0 1 150 670 Tm (Dela Cruz, Juan Santos) Tj
1 0 0 1 350 670 Tm (21) Tj
1 0 0 1 380 670 Tm (0) Tj
ET
`;
      const sf2Items = parseContentStreamTextItems(sf2Stream);
      const sf2Rows = clusterAndReconstructRows(sf2Items);
      const sf2Parsed = parseShsSf2(sf2Rows.join("\n"), { reconstructedRows: sf2Rows });
      const deduplicated = deduplicateSf2Records(sf2Parsed.attendance);

      assert.equal(deduplicated.length, 2);
      assert.equal(deduplicated[0].days_present, 21);
      assert.equal(deduplicated[0].days_absent, 0);
      assert.equal(deduplicated[1].days_present, 21);
      assert.equal(deduplicated[1].days_absent, 0);

      // 2c. SF9 PDF coordinate extraction (Front attendance + Back grades)
      const sf9FrontStream = `
BT
1 0 0 1 50 750 Tm (REPORT ON ATTENDANCE) Tj
1 0 0 1 50 720 Tm (Month | Jun | Jul | Aug | Sep | Oct | Nov | Dec | Jan | Feb | Mar | Apr | Total) Tj
1 0 0 1 50 700 Tm (No. of school days | 21 | 5 | 7 | 22 | 21 | 19 | 11 | 20 | 14 | 22 | 17.5 | 201.5) Tj
1 0 0 1 50 680 Tm (No. of days present | 21 | 5 | 7 | 22 | 21 | 19 | 11 | 20 | 14 | 22 | 17.5 | 201.5) Tj
1 0 0 1 50 660 Tm (No. of days absent | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0) Tj
ET
`;
      const sf9FrontItems = parseContentStreamTextItems(sf9FrontStream);
      const sf9FrontRows = clusterAndReconstructRows(sf9FrontItems);
      const sf9FrontParsed = parseGradesText(sf9FrontRows.join("\n"), "Grade 11", { reconstructedRows: sf9FrontRows }, "sf9");

      assert.equal(sf9FrontParsed.attendance_months?.length, 11);
      assert.equal(sf9FrontParsed.attendance_totals?.computed_days_absent, 0);

      // SF9 Back with Azure layout tables + reconstructed rows
      const sf9BackAzureLayout = {
        reconstructedRows: [
          "Oral Communication | 90 | 85 | 88 | Passed",
          "General Mathematics | 76 | 94 | 85 | Passed",
          "Earth Science | 89 | 83 | 86 | Passed",
        ],
        tables: [
          {
            rowCount: 4,
            columnCount: 5,
            cells: [
              { rowIndex: 0, columnIndex: 0, content: "Subject" },
              { rowIndex: 0, columnIndex: 1, content: "Q1" },
              { rowIndex: 0, columnIndex: 2, content: "Q2" },
              { rowIndex: 0, columnIndex: 3, content: "Final" },
              { rowIndex: 0, columnIndex: 4, content: "Remarks" },
              { rowIndex: 1, columnIndex: 0, content: "Oral Communication" },
              { rowIndex: 1, columnIndex: 1, content: "90" },
              { rowIndex: 1, columnIndex: 2, content: "85" },
              { rowIndex: 1, columnIndex: 3, content: "88" },
              { rowIndex: 1, columnIndex: 4, content: "Passed" },
              { rowIndex: 2, columnIndex: 0, content: "General Mathematics" },
              { rowIndex: 2, columnIndex: 1, content: "76" },
              { rowIndex: 2, columnIndex: 2, content: "94" },
              { rowIndex: 2, columnIndex: 3, content: "85" },
              { rowIndex: 2, columnIndex: 4, content: "Passed" },
              { rowIndex: 3, columnIndex: 0, content: "Earth Science" },
              { rowIndex: 3, columnIndex: 1, content: "89" },
              { rowIndex: 3, columnIndex: 2, content: "83" },
              { rowIndex: 3, columnIndex: 3, content: "86" },
              { rowIndex: 3, columnIndex: 4, content: "Passed" },
            ],
          },
        ],
      };
      const sf9BackParsed = parseGradesText(
        sf9BackAzureLayout.reconstructedRows.join("\n"),
        "Grade 11",
        sf9BackAzureLayout,
        "sf9"
      );
      assert.equal(sf9BackParsed.grades?.length, 3);
      assert.equal(sf9BackParsed.grades?.[0].q1, 90);
      assert.equal(sf9BackParsed.grades?.[0].q2, 85);
      assert.equal(sf9BackParsed.grades?.[0].final_grade, 88);
    }
  );

  // =========================================================================
  // 3. Built-in Excel / Spreadsheet Reader (.xlsx, .xls, .csv) across SF1, SF2, SF9, SF10
  // =========================================================================
  await t.test(
    "3. Excel (.xlsx / .csv) Extraction across SF1, SF2, SF9, and SF10",
    () => {
      // 3a. Verify isExcelOrCsvMimeOrExt utility
      assert.equal(isExcelOrCsvMimeOrExt("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), true);
      assert.equal(isExcelOrCsvMimeOrExt("application/vnd.ms-excel"), true);
      assert.equal(isExcelOrCsvMimeOrExt("text/csv"), true);
      assert.equal(isExcelOrCsvMimeOrExt("file.xlsx"), true);
      assert.equal(isExcelOrCsvMimeOrExt("data.xls"), true);
      assert.equal(isExcelOrCsvMimeOrExt("report.csv"), true);
      assert.equal(isExcelOrCsvMimeOrExt("scan.pdf"), false);
      assert.equal(isExcelOrCsvMimeOrExt("image.png"), false);

      // 3b. SF1 Excel (.xlsx) extraction
      const sf1Workbook = XLSX.utils.book_new();
      const sf1SheetData = [
        ["School ID:", "500619", "School Name:", "Taysan Resettlement Integrated School"],
        ["Grade Level:", "Grade 11", "Section:", "Diamond", "School Year:", "2024-2025"],
        ["LRN", "Learner Name", "Sex", "Birth Date"],
        ["111500619123", "Gomez, Justin Loquillano", "M", "06/23/2004"],
        ["111500619124", "Dela Cruz, Juan Santos", "M", "08/15/2004"],
      ];
      const sf1Sheet = XLSX.utils.aoa_to_sheet(sf1SheetData);
      XLSX.utils.book_append_sheet(sf1Workbook, sf1Sheet, "SF1_Roster");
      const sf1Buffer = XLSX.write(sf1Workbook, { type: "buffer", bookType: "xlsx" });

      const sf1ExcelDoc = extractExcelDocument(sf1Buffer);
      assert.equal(sf1ExcelDoc.sheets.length, 1);
      assert.equal(sf1ExcelDoc.sheets[0].name, "SF1_Roster");
      assert.equal(sf1ExcelDoc.sheets[0].rowCount, 5);
      assert.ok(sf1ExcelDoc.allReconstructedRows.length >= 5);

      const sf1Parsed = parseShsSf1(sf1ExcelDoc.fullRawText, {
        reconstructedRows: sf1ExcelDoc.allReconstructedRows,
        tables: sf1ExcelDoc.tables,
      });
      assert.equal(sf1Parsed.no_student_found, false);
      assert.equal(sf1Parsed.learners.length, 2);
      assert.equal(sf1Parsed.learners[0].lrn, "111500619123");
      assert.equal(sf1Parsed.learners[1].lrn, "111500619124");
      assert.equal(sf1Parsed.header.school_id, "500619");

      // 3c. SF2 CSV extraction
      const sf2Csv = `School ID: 500619 | School Name: Taysan Resettlement Integrated School
Learner Name | Days Present | Days Absent
Gomez, Justin Loquillano | 21 | 0
Dela Cruz, Juan Santos | 21 | 0
`;
      const sf2CsvBuffer = Buffer.from(sf2Csv, "utf8");
      const sf2ExcelDoc = extractExcelDocument(sf2CsvBuffer);
      assert.ok(sf2ExcelDoc.sheets.length >= 1);

      const sf2Parsed = parseShsSf2(sf2ExcelDoc.fullRawText, {
        reconstructedRows: sf2ExcelDoc.allReconstructedRows,
        tables: sf2ExcelDoc.tables,
      });
      const sf2Deduped = deduplicateSf2Records(sf2Parsed.attendance);
      assert.equal(sf2Deduped.length, 2);
      assert.equal(sf2Deduped[0].days_present, 21);
      assert.equal(sf2Deduped[0].days_absent, 0);

      // 3d. SF9 Excel (.xlsx) extraction
      const sf9Workbook = XLSX.utils.book_new();
      const sf9GradesData = [
        ["Subject", "Q1", "Q2", "Final", "Remarks"],
        ["General Mathematics", "76", "94", "85", "Passed"],
        ["Earth Science", "89", "83", "86", "Passed"],
        ["Empowerment Technologies", "91", "93", "92", "Passed"],
      ];
      const sf9Sheet = XLSX.utils.aoa_to_sheet(sf9GradesData);
      XLSX.utils.book_append_sheet(sf9Workbook, sf9Sheet, "SF9_Grades");
      const sf9Buffer = XLSX.write(sf9Workbook, { type: "buffer", bookType: "xlsx" });

      const sf9ExcelDoc = extractExcelDocument(sf9Buffer);
      const sf9Parsed = parseGradesText(
        sf9ExcelDoc.fullRawText,
        "Grade 11",
        { reconstructedRows: sf9ExcelDoc.allReconstructedRows, tables: sf9ExcelDoc.tables },
        "sf9"
      );
      assert.equal(sf9Parsed.grades.length, 3);
      assert.equal(sf9Parsed.grades[0].q1, 76);
      assert.equal(sf9Parsed.grades[0].q2, 94);
      assert.equal(sf9Parsed.grades[0].final_grade, 85);

      // 3e. SF10 Excel (.xlsx) extraction
      const sf10Workbook = XLSX.utils.book_new();
      const sf10Data = [
        ["SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD (SF10-SHS)"],
        ["LAST NAME: GOMEZ", "FIRST NAME: JUSTIN", "MIDDLE NAME: LOQUILLANO"],
        ["LRN: 111304501972", "Date of Birth: 06/23/2004", "Sex: Male"],
        ["SCHOLASTIC RECORD"],
        ["SCHOOL: TAYSAN RESETTLEMENT INTEGRATED SCHOOL", "SCHOOL ID: 500619", "GRADE LEVEL: 11", "SY: 2024-2025", "SEM: 1st"],
        ["Subject Type", "Subject", "Q1", "Q2", "Final", "Action"],
        ["CORE", "General Mathematics", "76", "94", "85", "PASSED"],
        ["CORE", "Earth Science", "89", "83", "86", "PASSED"],
        ["APPLIED", "Empowerment Technologies", "91", "93", "92", "PASSED"],
        ["SPECIALIZED", "Pre-Calculus", "96", "80", "88", "PASSED"],
        ["SPECIALIZED", "General Chemistry 1", "90", "80", "85", "PASSED"],
        ["General Ave. for the Semester", "", "", "", "87.2", ""],
      ];
      const sf10Sheet = XLSX.utils.aoa_to_sheet(sf10Data);
      XLSX.utils.book_append_sheet(sf10Workbook, sf10Sheet, "SF10_Scholastic");
      const sf10Buffer = XLSX.write(sf10Workbook, { type: "buffer", bookType: "xlsx" });

      const sf10ExcelDoc = extractExcelDocument(sf10Buffer);
      const sf10Parsed = parseSf10ShsText(sf10ExcelDoc.fullRawText, {
        reconstructedRows: sf10ExcelDoc.allReconstructedRows,
        tables: sf10ExcelDoc.tables,
      });

      assert.equal(sf10Parsed.scholastic_records.length, 1);
      assert.equal(sf10Parsed.scholastic_records[0].school_name, "TAYSAN RESETTLEMENT INTEGRATED SCHOOL");
      assert.equal(sf10Parsed.scholastic_records[0].subjects.length, 5);
      assert.equal(sf10Parsed.scholastic_records[0].subjects[0].q1, 76);
      assert.equal(sf10Parsed.scholastic_records[0].subjects[0].q2, 94);
      assert.equal(sf10Parsed.scholastic_records[0].subjects[2].subject_type, "APPLIED");
      assert.equal(sf10Parsed.scholastic_records[0].subjects[3].subject_type, "SPECIALIZED");
      assert.equal(sf10Parsed.scholastic_records[0].subjects[4].subject_type, "SPECIALIZED");
    }
  );
});

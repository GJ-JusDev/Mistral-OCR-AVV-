import test from "node:test";
import assert from "node:assert/strict";

import { AzureDocumentIntelligenceProvider } from "../src/lib/ocr/providers/azureProvider.ts";
import {
  classifyCellFromPixels,
  classifyAttendanceCell,
} from "../src/lib/ocr/attendanceShadingClassifier.ts";
import {
  classifyFieldRecognition,
  buildDocumentRecognitionSummary,
} from "../src/lib/ocr/handwritingExtractor.ts";
import { parseShsSf1 } from "../src/lib/ocr/shsSf1Parser.ts";
import { parseShsSf2 } from "../src/lib/ocr/shsSf2Parser.ts";
import { parseShsSf5 } from "../src/lib/ocr/shsSf5Parser.ts";
import { parsePsaBirthCert } from "../src/lib/ocr/psaParser.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

test("AVV System — Actual OCR & ICR (Azure Document Intelligence) and Shading Pattern Recognition Suite", async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -------------------------------------------------------------------------
  // 1. Azure Read Model: Style Analysis and Word-Level ICR Extraction
  // -------------------------------------------------------------------------
  await t.test("1. Azure Provider correctly parses analyzeResult.styles for handwriting and maps spans to words", async () => {
    const provider = new AzureDocumentIntelligenceProvider();

    // Mock Azure Document Intelligence analyzeResult payload
    // String content: "DepEd Form 137 Maria Santos 89"
    // Spans:
    // "DepEd" (0..5), "Form" (6..10), "137" (11..14) -> printed
    // "Maria" (15..20), "Santos" (21..27) -> handwritten by student/teacher
    // "89" (28..30) -> printed
    const mockContent = "DepEd Form 137 Maria Santos 89";
    const mockAnalyzeResult = {
      content: mockContent,
      pages: [
        {
          pageNumber: 1,
          width: 8.5,
          height: 11,
          unit: "inch",
          words: [
            { content: "DepEd", confidence: 0.99, polygon: [1, 1, 2, 1, 2, 2, 1, 2], span: { offset: 0, length: 5 } },
            { content: "Form", confidence: 0.98, polygon: [2.1, 1, 3, 1, 3, 2, 2.1, 2], span: { offset: 6, length: 4 } },
            { content: "137", confidence: 0.97, polygon: [3.1, 1, 4, 1, 4, 2, 3.1, 2], span: { offset: 11, length: 3 } },
            { content: "Maria", confidence: 0.94, polygon: [1, 3, 2.5, 3, 2.5, 4, 1, 4], span: { offset: 15, length: 5 } },
            { content: "Santos", confidence: 0.93, polygon: [2.6, 3, 4, 3, 4, 4, 2.6, 4], span: { offset: 21, length: 6 } },
            { content: "89", confidence: 0.99, polygon: [5, 3, 5.5, 3, 5.5, 4, 5, 4], span: { offset: 28, length: 2 } },
          ],
          lines: [
            { content: "DepEd Form 137", polygon: [1, 1, 4, 1, 4, 2, 1, 2], spans: [{ offset: 0, length: 14 }] },
            { content: "Maria Santos 89", polygon: [1, 3, 5.5, 3, 5.5, 4, 1, 4], spans: [{ offset: 15, length: 15 }] },
          ],
        },
      ],
      styles: [
        {
          isHandwritten: true,
          confidence: 0.96,
          spans: [{ offset: 15, length: 12 }], // Covers "Maria Santos"
        },
      ],
    };

    // Use internal processAnalyzeResult
    const processed = provider.processAnalyzeResult(mockAnalyzeResult);

    assert.ok(processed.rawLayout, "Must produce structured rawLayout");
    const words = processed.rawLayout.words;
    assert.strictEqual(words.length, 6, "Must retain all 6 recognized words");

    // Word 0: "DepEd" -> printed
    assert.strictEqual(words[0].content, "DepEd");
    assert.strictEqual(words[0].isHandwritten, false);

    // Word 3: "Maria" -> handwritten (ICR)
    assert.strictEqual(words[3].content, "Maria");
    assert.strictEqual(words[3].isHandwritten, true);
    assert.strictEqual(words[3].styleConfidence, 0.96);
    assert.deepStrictEqual(words[3].polygon, [1, 3, 2.5, 3, 2.5, 4, 1, 4]);

    // Word 4: "Santos" -> handwritten (ICR)
    assert.strictEqual(words[4].content, "Santos");
    assert.strictEqual(words[4].isHandwritten, true);
    assert.strictEqual(words[4].styleConfidence, 0.96);

    // Word 5: "89" -> printed
    assert.strictEqual(words[5].content, "89");
    assert.strictEqual(words[5].isHandwritten, false);

    // Summary counters
    assert.strictEqual(processed.rawLayout.hasHandwriting, true);
    assert.strictEqual(processed.rawLayout.handwrittenWordCount, 2);
    assert.strictEqual(processed.rawLayout.printedWordCount, 4);
    assert.strictEqual(processed.rawLayout.handwritingConfidence, 0.935);
  });

  // -------------------------------------------------------------------------
  // 2. Handwriting Extractor & Field-Level Classification
  // -------------------------------------------------------------------------
  await t.test("2. Handwriting extractor correctly classifies field tokens into handwritten, printed, or mixed", async () => {
    const rawLayout = {
      words: [
        { content: "Juan", isHandwritten: true, confidence: 0.82, styleConfidence: 0.85, polygon: [10, 20, 50, 20, 50, 40, 10, 40], pageNumber: 1 },
        { content: "Dela", isHandwritten: true, confidence: 0.81, styleConfidence: 0.85, polygon: [55, 20, 90, 20, 90, 40, 55, 40], pageNumber: 1 },
        { content: "Cruz", isHandwritten: true, confidence: 0.84, styleConfidence: 0.85, polygon: [95, 20, 130, 20, 130, 40, 95, 40], pageNumber: 1 },
        { content: "123456789012", isHandwritten: false, confidence: 0.99, polygon: [10, 60, 100, 60, 100, 80, 10, 80], pageNumber: 1 },
      ],
      styles: [{ isHandwritten: true, confidence: 0.85 }],
      hasHandwriting: true,
      handwrittenWordCount: 3,
      printedWordCount: 1,
      handwritingConfidence: 0.82,
      printedConfidence: 0.99,
    };

    // Classify "Juan Dela Cruz"
    const nameMeta = classifyFieldRecognition("Juan Dela Cruz", rawLayout);
    assert.strictEqual(nameMeta.is_handwritten, true);
    assert.strictEqual(nameMeta.recognition_type, "handwritten");
    assert.strictEqual(nameMeta.handwritten_word_count, 3);
    assert.strictEqual(nameMeta.printed_word_count, 0);
    assert.ok(nameMeta.bounding_box, "Must calculate bounding box envelope");
    assert.deepStrictEqual(nameMeta.bounding_box, [10, 20, 130, 20, 130, 40, 10, 40]);

    // Classify "123456789012"
    const lrnMeta = classifyFieldRecognition("123456789012", rawLayout);
    assert.strictEqual(lrnMeta.is_handwritten, false);
    assert.strictEqual(lrnMeta.recognition_type, "printed");

    // Document-level summary (hwConfidence 0.82 < 0.88 triggers teacher review)
    const docSummary = buildDocumentRecognitionSummary(rawLayout, "azure", "azure/prebuilt-read");
    assert.strictEqual(docSummary.icr_available, true);
    assert.strictEqual(docSummary.has_handwriting, true);
    assert.strictEqual(docSummary.handwritten_word_count, 3);
    assert.strictEqual(docSummary.printed_word_count, 1);
    assert.strictEqual(docSummary.handwriting_ratio, 0.75);
    assert.strictEqual(docSummary.requires_teacher_icr_review, true);
  });

  // -------------------------------------------------------------------------
  // 3. Attendance Shading Classifier (Full shade, Half shade, Unmarked, Unclear)
  // -------------------------------------------------------------------------
  await t.test("3. SF2 Attendance Shading Classifier correctly distinguishes shading patterns on pixel matrices", async () => {
    const W = 20;
    const H = 20;

    // Helper to generate a 20x20 pixel matrix
    const createPixelGrid = (fillFunc) => {
      const data = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          data[y * W + x] = fillFunc(x, y); // 0 = black (shaded), 255 = white (unmarked)
        }
      }
      return { width: W, height: H, data, channels: 1 };
    };

    // Pattern A: Full Shade (Absent) -> All dark
    const fullShadePixels = createPixelGrid(() => 30); // Dark grey/black
    const fullRes = classifyCellFromPixels(fullShadePixels);
    assert.strictEqual(fullRes.classification, "FULL_SHADE");
    assert.ok(fullRes.fillRatio >= 0.55, "Full shade fill ratio must be >= 0.55");

    const fullCell = classifyAttendanceCell({ day: 1, pixelData: fullShadePixels });
    assert.strictEqual(fullCell.attendance_status, "ABSENT");
    assert.strictEqual(fullCell.is_shaded, true);
    assert.strictEqual(fullCell.is_half_shaded, false);
    assert.strictEqual(fullCell.requires_teacher_verification, false);

    // Pattern B: Half Shade (Tardy / Half-day) -> Upper diagonal shaded, lower diagonal white
    const halfShadePixels = createPixelGrid((x, y) => {
      // Upper diagonal (y <= x) is shaded (30), lower is white (255)
      return y <= x ? 30 : 255;
    });
    const halfRes = classifyCellFromPixels(halfShadePixels);
    assert.strictEqual(halfRes.classification, "HALF_SHADE");
    assert.ok(halfRes.asymmetryRatio >= 0.18, "Half shade must exhibit significant spatial asymmetry");

    const halfCell = classifyAttendanceCell({ day: 2, pixelData: halfShadePixels });
    assert.strictEqual(halfCell.attendance_status, "TARDY");
    assert.strictEqual(halfCell.is_half_shaded, true);

    // Pattern C: Unmarked (Present) -> Clean white cell
    const unmarkedPixels = createPixelGrid(() => 250); // White
    const unmarkedRes = classifyCellFromPixels(unmarkedPixels);
    assert.strictEqual(unmarkedRes.classification, "UNMARKED");
    assert.ok(unmarkedRes.fillRatio < 0.12, "Unmarked fill ratio must be < 0.12");

    const unmarkedCell = classifyAttendanceCell({ day: 3, pixelData: unmarkedPixels });
    assert.strictEqual(unmarkedCell.attendance_status, "PRESENT");

    // Pattern D: Unclear (Ambiguous smudge / artifact)
    // Moderate smudge with 16% density (between 0.12 and 0.20 threshold)
    const unclearPixels = createPixelGrid((x, y) => {
      if (x >= 7 && x <= 13 && y >= 7 && y <= 12) return 50;
      return 250;
    });
    const unclearRes = classifyCellFromPixels(unclearPixels);
    assert.strictEqual(unclearRes.classification, "UNCLEAR");

    const unclearCell = classifyAttendanceCell({ day: 4, pixelData: unclearPixels });
    assert.strictEqual(unclearCell.attendance_status, "NEEDS_VERIFICATION");
    assert.strictEqual(unclearCell.requires_teacher_verification, true);
  });

  // -------------------------------------------------------------------------
  // 4. SF2-SHS Daily Attendance Parser with Shading Pattern Integration
  // -------------------------------------------------------------------------
  await t.test("4. SF2-SHS parser applies shading classifier to daily grid and extracts ICR learner metadata", async () => {
    const rawText = `
School Form 2 Daily Attendance Report of Learners
School ID: 500169  School Year: 2026-2027  Grade Level: Grade 11  Section: STEM-A
Month of: September  Total School Days: 20
    `;

    // Simulated Azure table with learner name, daily columns, and monthly totals
    const mockTable = {
      cells: [
        // Header Row (Row 0)
        { rowIndex: 0, columnIndex: 0, content: "Learner's Name" },
        { rowIndex: 0, columnIndex: 1, content: "1" },
        { rowIndex: 0, columnIndex: 2, content: "2" },
        { rowIndex: 0, columnIndex: 3, content: "3" },
        { rowIndex: 0, columnIndex: 4, content: "Total Absent" },
        { rowIndex: 0, columnIndex: 5, content: "Total Present" },
        { rowIndex: 0, columnIndex: 6, content: "Total Tardy" },

        // Data Row 1: Maria Santos (Day 1: unmarked=present, Day 2: full shade=absent, Day 3: half shade=tardy)
        { rowIndex: 1, columnIndex: 0, content: "Santos, Maria", polygon: [10, 20, 80, 20, 80, 40, 10, 40] },
        { rowIndex: 1, columnIndex: 1, content: "" }, // Unmarked -> Present
        { rowIndex: 1, columnIndex: 2, content: "x" }, // Full shade mark -> Absent
        { rowIndex: 1, columnIndex: 3, content: "/" }, // Half shade mark -> Tardy
        { rowIndex: 1, columnIndex: 4, content: "1" },
        { rowIndex: 1, columnIndex: 5, content: "19" },
        { rowIndex: 1, columnIndex: 6, content: "1" },
      ],
    };

    const mockLayout = {
      tables: [mockTable],
      words: [
        { content: "Santos,", isHandwritten: true, styleConfidence: 0.94, confidence: 0.96, polygon: [10, 20, 45, 20, 45, 40, 10, 40], pageNumber: 1 },
        { content: "Maria", isHandwritten: true, styleConfidence: 0.94, confidence: 0.95, polygon: [50, 20, 80, 20, 80, 40, 50, 40], pageNumber: 1 },
      ],
      hasHandwriting: true,
      handwrittenWordCount: 2,
      printedWordCount: 15,
      handwritingConfidence: 0.94,
    };

    const sf2 = parseShsSf2(rawText, mockLayout);

    assert.strictEqual(sf2.header.school_id, "500169");
    assert.strictEqual(sf2.header.grade_level, "Grade 11");
    assert.strictEqual(sf2.attendance.length, 1);

    const learner = sf2.attendance[0];
    assert.strictEqual(learner.learner_name, "Santos, Maria");
    assert.strictEqual(learner.is_handwritten, true, "Learner name should be flagged as ICR handwritten");
    assert.strictEqual(learner.recognition_type, "handwritten");
    assert.strictEqual(learner.days_absent, 1);
    assert.strictEqual(learner.days_present, 19);
    assert.strictEqual(learner.days_tardy, 1);

    // Verify daily grid shading classifications
    assert.strictEqual(learner.daily_grid.length, 3);
    assert.strictEqual(learner.daily_grid[0].status, "PRESENT");
    assert.strictEqual(learner.daily_grid[0].shading_classification, "UNMARKED");

    assert.strictEqual(learner.daily_grid[1].status, "ABSENT");
    assert.strictEqual(learner.daily_grid[1].shading_classification, "FULL_SHADE");

    assert.strictEqual(learner.daily_grid[2].status, "TARDY");
    assert.strictEqual(learner.daily_grid[2].shading_classification, "HALF_SHADE");

    // Recognition summary
    assert.ok(sf2.recognition_summary);
    assert.strictEqual(sf2.recognition_summary.has_handwriting, true);
  });

  // -------------------------------------------------------------------------
  // 5. SF1-SHS Parser with ICR Multi-Learner Roster
  // -------------------------------------------------------------------------
  await t.test("5. SF1-SHS parser extracts multi-learner roster with handwriting indicators", async () => {
    const rawText = `
School Form 1 School Register for Senior High School
School ID: 500169  School Year: 2026-2027  Grade Level: Grade 12  Section: HUMSS-A
Track: Academic Track  Strand: Humanities and Social Sciences (HUMSS)  Semester: 1st Semester
    `;

    const mockTable = {
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "LRN" },
        { rowIndex: 0, columnIndex: 1, content: "Learner's Name" },
        { rowIndex: 0, columnIndex: 2, content: "Sex" },
        { rowIndex: 0, columnIndex: 3, content: "Birth Date" },

        // Learner 1 (Handwritten name)
        { rowIndex: 1, columnIndex: 0, content: "109876543210" },
        { rowIndex: 1, columnIndex: 1, content: "Batumbakal, Brandon Lee" },
        { rowIndex: 1, columnIndex: 2, content: "M" },
        { rowIndex: 1, columnIndex: 3, content: "2009-04-15" },
      ],
    };

    const mockLayout = {
      tables: [mockTable],
      words: [
        { content: "Batumbakal,", isHandwritten: true, styleConfidence: 0.95, confidence: 0.93, pageNumber: 1 },
        { content: "Brandon", isHandwritten: true, styleConfidence: 0.95, confidence: 0.94, pageNumber: 1 },
        { content: "Lee", isHandwritten: true, styleConfidence: 0.95, confidence: 0.92, pageNumber: 1 },
        { content: "109876543210", isHandwritten: false, confidence: 0.99, pageNumber: 1 },
      ],
      hasHandwriting: true,
      handwrittenWordCount: 3,
      printedWordCount: 20,
      handwritingConfidence: 0.95,
    };

    const sf1 = parseShsSf1(rawText, mockLayout);

    assert.strictEqual(sf1.header.school_id, "500169");
    assert.strictEqual(sf1.header.grade_level, "Grade 12");
    assert.strictEqual(sf1.learners.length, 1);

    const l = sf1.learners[0];
    assert.strictEqual(l.lrn, "109876543210");
    assert.strictEqual(l.last_name, "Batumbakal");
    assert.strictEqual(l.first_name, "Brandon");
    assert.strictEqual(l.middle_name, "Lee");
    assert.strictEqual(l.is_handwritten, true);
    assert.strictEqual(l.recognition_type, "handwritten");
    assert.strictEqual(l.icr_confidence, 0.95);
  });

  // -------------------------------------------------------------------------
  // 6. SF5-SHS Parser with ICR Candidate Promotion Entries
  // -------------------------------------------------------------------------
  await t.test("6. SF5-SHS parser identifies candidate promotion and tags handwritten entries", async () => {
    const rawText = `
School Form 5A End of Semester Learner Status (SF5A-SHS)
School ID: 500169  School Year: 2026-2027  Grade Level: Grade 11  Section: ABM-1
Semester: 1st Semester
    `;

    const mockTable = {
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "LRN" },
        { rowIndex: 0, columnIndex: 1, content: "Learner Name" },
        { rowIndex: 0, columnIndex: 2, content: "General Average" },
        { rowIndex: 0, columnIndex: 3, content: "Action Taken" },

        // Learner 1 (Passed, complete)
        { rowIndex: 1, columnIndex: 0, content: "123456789012" },
        { rowIndex: 1, columnIndex: 1, content: "Dela Cruz, Juan" },
        { rowIndex: 1, columnIndex: 2, content: "88" },
        { rowIndex: 1, columnIndex: 3, content: "COMPLETE" },
      ],
    };

    const mockLayout = {
      tables: [mockTable],
      words: [
        { content: "Dela", isHandwritten: true, styleConfidence: 0.93, confidence: 0.91, pageNumber: 1 },
        { content: "Cruz,", isHandwritten: true, styleConfidence: 0.93, confidence: 0.92, pageNumber: 1 },
        { content: "Juan", isHandwritten: true, styleConfidence: 0.93, confidence: 0.94, pageNumber: 1 },
      ],
      hasHandwriting: true,
      handwrittenWordCount: 3,
      printedWordCount: 18,
      handwritingConfidence: 0.93,
    };

    const sf5 = parseShsSf5(rawText, mockLayout);

    assert.strictEqual(sf5.header.form_variant, "SF5A-SHS");
    assert.strictEqual(sf5.learners.length, 1);

    const l = sf5.learners[0];
    assert.strictEqual(l.lrn, "123456789012");
    assert.strictEqual(l.learner_name, "Dela Cruz, Juan");
    assert.strictEqual(l.general_average, 88);
    assert.strictEqual(l.action_taken, "COMPLETE");
    assert.strictEqual(l.is_handwritten, true);
    assert.strictEqual(l.proficiency_level, "VERY_SATISFACTORY");
  });

  // -------------------------------------------------------------------------
  // 7. PSA Birth Certificate Parser with ICR Flagging
  // -------------------------------------------------------------------------
  await t.test("7. PSA Birth Certificate parser extracts civil registry identity and flags handwritten entries", async () => {
    const rawText = `
Republic of the Philippines
Office of the Civil Registrar General
CERTIFICATE OF LIVE BIRTH
Registry No.: 2009-12345
1. NAME OF CHILD: Dela Cruz, Juan Miguel
2. SEX: Male
3. DATE OF BIRTH: 15 June 2009
4. PLACE OF BIRTH: San Fernando, Pampanga
5. MAIDEN NAME OF MOTHER: Maria Santos
6. NAME OF FATHER: Pedro Dela Cruz
    `;

    const mockLayout = {
      words: [
        { content: "2009-12345", isHandwritten: true, styleConfidence: 0.97, confidence: 0.95, pageNumber: 1 },
        { content: "Juan", isHandwritten: true, styleConfidence: 0.96, confidence: 0.94, pageNumber: 1 },
        { content: "Miguel", isHandwritten: true, styleConfidence: 0.96, confidence: 0.93, pageNumber: 1 },
        { content: "Dela", isHandwritten: true, styleConfidence: 0.96, confidence: 0.95, pageNumber: 1 },
        { content: "Cruz", isHandwritten: true, styleConfidence: 0.96, confidence: 0.95, pageNumber: 1 },
      ],
      hasHandwriting: true,
      handwrittenWordCount: 5,
      printedWordCount: 30,
      handwritingConfidence: 0.96,
    };

    const psa = parsePsaBirthCert(rawText, mockLayout);

    assert.strictEqual(psa.identity.registry_number, "2009-12345");
    assert.strictEqual(psa.identity.first_name, "Juan");
    assert.strictEqual(psa.identity.middle_name, "Miguel");
    assert.strictEqual(psa.identity.last_name, "Dela Cruz");
    assert.strictEqual(psa.identity.birth_date, "2009-06-15");
    assert.strictEqual(psa.identity.sex, "M");

    // Verification of ICR metadata
    assert.ok(psa.field_recognition);
    assert.strictEqual(psa.field_recognition.registry_number?.is_handwritten, true);
    assert.strictEqual(psa.field_recognition.first_name?.is_handwritten, true);
    assert.strictEqual(psa.recognition_summary?.has_handwriting, true);

    // Human verification warning raised
    assert.ok(
      psa.warnings.some((w) => w.includes("Azure ICR")),
      "Must generate informational warning requiring teacher verification of handwritten PSA fields"
    );
  });

  // -------------------------------------------------------------------------
  // 8. End-to-End Pipeline & Unified Grade Parser Integration
  // -------------------------------------------------------------------------
  await t.test("8. Unified parseGradesText propagates ICR metadata onto ExtractedFields and GradeRecords", async () => {
    const rawText = `
Student Name: Dela Cruz, Juan
LRN: 123456789012
School ID: 500169
Grade Level: Grade 11
Section: STEM-A
First Semester
    `;

    const mockLayout = {
      tables: [
        {
          rowCount: 5,
          columnCount: 4,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "Subjects" },
            { rowIndex: 0, columnIndex: 1, content: "Quarter" },
            { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },

            { rowIndex: 1, columnIndex: 1, content: "1" },
            { rowIndex: 1, columnIndex: 2, content: "2" },

            { rowIndex: 2, columnIndex: 0, content: "Core Subjects" },

            { rowIndex: 3, columnIndex: 0, content: "General Mathematics" },
            { rowIndex: 3, columnIndex: 1, content: "85" },
            { rowIndex: 3, columnIndex: 2, content: "87" },
            { rowIndex: 3, columnIndex: 3, content: "86" },

            { rowIndex: 4, columnIndex: 0, content: "Oral Communication" },
            { rowIndex: 4, columnIndex: 1, content: "88" },
            { rowIndex: 4, columnIndex: 2, content: "90" },
            { rowIndex: 4, columnIndex: 3, content: "89" },
          ],
        },
      ],
      words: [
        { content: "General", isHandwritten: true, styleConfidence: 0.94, confidence: 0.95, pageNumber: 1 },
        { content: "Mathematics", isHandwritten: true, styleConfidence: 0.94, confidence: 0.95, pageNumber: 1 },
        { content: "Oral", isHandwritten: false, confidence: 0.99, pageNumber: 1 },
        { content: "Communication", isHandwritten: false, confidence: 0.99, pageNumber: 1 },
      ],
      hasHandwriting: true,
      handwrittenWordCount: 2,
      printedWordCount: 15,
      handwritingConfidence: 0.94,
    };

    const fields = parseGradesText(rawText, "Grade 11", mockLayout, "sf9");

    assert.strictEqual(fields.lrn, "123456789012");
    assert.strictEqual(fields.has_handwritten_content, true);
    assert.ok(fields.recognition_summary);

    assert.ok(Array.isArray(fields.grades) && fields.grades.length > 0);
    const mathGrade = fields.grades.find((g) => g.subject.includes("General Mathematics"));
    assert.ok(mathGrade);
    assert.strictEqual(mathGrade.is_handwritten, true);
    assert.strictEqual(mathGrade.final, 86);
    assert.strictEqual(mathGrade.status, "Passed");

    const oralGrade = fields.grades.find((g) => g.subject.includes("Oral Communication"));
    assert.ok(oralGrade);
    assert.strictEqual(oralGrade.is_handwritten, false);
    assert.strictEqual(oralGrade.final, 89);
  });
});

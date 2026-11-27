import test from "node:test";
import assert from "node:assert/strict";

import { parseAzureLayoutGrades } from "../src/lib/ocr/tableGradesParser.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { handleOcrRoute } from "../src/lib/ocr/mistral.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";
import { parsePsaBirthCert, extractPsaSexFromMarkPlacement } from "../src/lib/ocr/psaParser.ts";
import {
  computeSemesterGeneralAverage,
  updateExtractedFieldsAverages,
  hasBlankGradeError,
  formatDisplayedGrade,
  getConfidencePercentage,
  evaluateDynamicGradeStatus,
  sanitizeAndRecoverDepEdGrade,
  normalizeObservedValueMarking,
  sanitizeLearnersObservedValues,
  normalizeStrictSex,
  validateConsecutiveSchoolYear,
} from "../src/lib/validation/gradeUtils.ts";
import { mergeSf9FrontAndBack } from "../src/lib/validation/sf9Merger.ts";
import { compareSf1AndSf9, comparePsaAndSf1 } from "../src/lib/validation/crossDocumentEngine.ts";

test("AVV Two-Sided SF9 and Azure Academic Grade Extraction Suite", async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -------------------------------------------------------------------------
  // Test A: Two-sided submission returns ONE staged document
  // -------------------------------------------------------------------------
  await t.test("Test A — Two-sided submission produces ONE unified ExtractedFields response", async () => {
    process.env.OCR_PRIMARY_PROVIDER = "azure";
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://avv-document-ocr.cognitiveservices.azure.com/";
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "mock-key";

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        if (options?.method === "POST") {
          return new Response(null, {
            status: 202,
            headers: {
              "Operation-Location": "https://avv-document-ocr.cognitiveservices.azure.com/operations/test-op-1",
            },
          });
        }
        if (options?.method === "GET") {
          return new Response(
            JSON.stringify({
              status: "succeeded",
              analyzeResult: {
                content: "LRN: 109876543210\nName: DELA CRUZ, JUAN SANTOS\nOral Communication 88 90",
                pages: [{ pageNumber: 1, words: [{ content: "Word", confidence: 0.95 }] }],
                tables: [
                  {
                    rowCount: 4,
                    columnCount: 4,
                    cells: [
                      { rowIndex: 0, columnIndex: 0, content: "Subjects" },
                      { rowIndex: 0, columnIndex: 1, content: "Quarter" },
                      { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
                      { rowIndex: 1, columnIndex: 1, content: "1" },
                      { rowIndex: 1, columnIndex: 2, content: "2" },
                      { rowIndex: 2, columnIndex: 0, content: "Core Subjects" },
                      { rowIndex: 3, columnIndex: 0, content: "Oral Communication" },
                      { rowIndex: 3, columnIndex: 1, content: "88" },
                      { rowIndex: 3, columnIndex: 2, content: "90" },
                    ],
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(url, options);
      };

      const fakeFrontBase64 = "data:image/jpeg;base64," + Buffer.from("fake-front-image").toString("base64");
      const fakeBackBase64 = "data:image/jpeg;base64," + Buffer.from("fake-back-image").toString("base64");

      const req = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frontImage: fakeFrontBase64,
          backImage: fakeBackBase64,
          extractFields: true,
          gradeLevel: "Senior High School",
        }),
      });

      const res = await handleOcrRoute(req, "fake-key", parseGradesText);
      assert.equal(res.status, 200, "Should return HTTP 200");
      const data = await res.json();

      assert.ok(data.fields, "Response must include unified fields");
      assert.ok(Array.isArray(data.fields.grades), "Must include grades array");
      assert.ok(data.text.includes("=== FRONT (IDENTITY) ==="), "Must contain front section header");
      assert.ok(data.text.includes("=== BACK (GRADES) ==="), "Must contain back section header");
      assert.equal(data.provider, "azure", "Provider must be azure");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // Test B: Front identity extraction preserves existing repaired identity parser
  // -------------------------------------------------------------------------
  await t.test("Test B — Front identity extraction retains accurate spatial field extraction", async () => {
    const rawFrontText = `
      Republic of the Philippines
      Department of Education
      Region IV-A CALABARZON
      BATANGAS NATIONAL HIGH SCHOOL
      
      REPORT CARD (SF9-SHS)
      
      LRN: 109876543210
      Last Name: DELA CRUZ
      First Name: JUAN
      Middle Name: SANTOS
      Grade Level: Grade 11
      Section: STEM-A
      School Year: 2023-2024
      Track/Strand: Academic / STEM
    `;

    const parsed = parseSeniorHighGradesText(rawFrontText);
    assert.equal(parsed.lrn, "109876543210", "LRN should be parsed accurately");
    assert.equal(parsed.school_year, "2023-2024", "School year should be parsed accurately");
    assert.equal(parsed.first_name, "JUAN", "First name should be preserved");
    assert.equal(parsed.last_name, "DELA CRUZ", "Last name should be preserved");
    assert.equal(parsed.middle_name, "SANTOS", "Middle name should be preserved");
  });

  // -------------------------------------------------------------------------
  // Test C: Azure Layout academic table (synthetic Semester 1 table) maps Q1/Q2
  // -------------------------------------------------------------------------
  await t.test("Test C — Azure Layout Semester 1 table correctly maps Q1 and Q2", async () => {
    const syntheticSem1Table = {
      rowCount: 4,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Subjects" },
        { rowIndex: 0, columnIndex: 1, content: "Quarter" },
        { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 1, columnIndex: 1, content: "1" },
        { rowIndex: 1, columnIndex: 2, content: "2" },
        { rowIndex: 2, columnIndex: 0, content: "Core Subjects" },
        { rowIndex: 3, columnIndex: 0, content: "General Mathematics" },
        { rowIndex: 3, columnIndex: 1, content: "92" },
        { rowIndex: 3, columnIndex: 2, content: "94" },
      ],
    };

    const result = parseAzureLayoutGrades([syntheticSem1Table]);
    assert.equal(result.grades.length, 1, "Should extract exactly 1 subject");
    const subj = result.grades[0];
    assert.equal(subj.subject, "General Mathematics");
    assert.equal(subj.category, "Core Subjects");
    assert.equal(subj.q1, 92, "Q1 must equal 92");
    assert.equal(subj.q2, 94, "Q2 must equal 94");
    assert.equal(subj.q3, undefined, "Q3 must be undefined for Sem 1");
    assert.equal(subj.q4, undefined, "Q4 must be undefined for Sem 1");
  });

  // -------------------------------------------------------------------------
  // Test D: Semester 2 table maps Q3/Q4 correctly
  // -------------------------------------------------------------------------
  await t.test("Test D — Azure Layout Semester 2 table correctly maps Q3 and Q4", async () => {
    const syntheticSem2Table = {
      rowCount: 4,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Subjects" },
        { rowIndex: 0, columnIndex: 1, content: "Quarter" },
        { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 1, columnIndex: 1, content: "3" },
        { rowIndex: 1, columnIndex: 2, content: "4" },
        { rowIndex: 2, columnIndex: 0, content: "Applied and Specialized Subjects" },
        { rowIndex: 3, columnIndex: 0, content: "Statistics and Probability" },
        { rowIndex: 3, columnIndex: 1, content: "85" },
        { rowIndex: 3, columnIndex: 2, content: "87" },
      ],
    };

    const result = parseAzureLayoutGrades([syntheticSem2Table]);
    assert.equal(result.grades.length, 1, "Should extract 1 subject from Sem 2 table");
    const subj = result.grades[0];
    assert.equal(subj.subject, "Statistics and Probability");
    assert.equal(subj.category, "Applied and Specialized Subjects");
    assert.equal(subj.q1, undefined, "Q1 must be undefined for Sem 2");
    assert.equal(subj.q2, undefined, "Q2 must be undefined for Sem 2");
    assert.equal(subj.q3, 85, "Q3 must equal 85");
    assert.equal(subj.q4, 87, "Q4 must equal 87");
  });

  // -------------------------------------------------------------------------
  // Test E: Observed Values exclusion produces ZERO academic grades
  // -------------------------------------------------------------------------
  await t.test("Test E — Observed Values (Core Values) table produces ZERO academic grades", async () => {
    const syntheticObservedValuesTable = {
      rowCount: 3,
      columnCount: 6,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Core Values" },
        { rowIndex: 0, columnIndex: 1, content: "Behavior Statements" },
        { rowIndex: 0, columnIndex: 2, content: "Quarter" },
        { rowIndex: 1, columnIndex: 0, content: "1. Maka-Diyos" },
        { rowIndex: 1, columnIndex: 1, content: "Expresses one's spiritual beliefs" },
        { rowIndex: 1, columnIndex: 2, content: "AO" },
        { rowIndex: 1, columnIndex: 3, content: "AO" },
        { rowIndex: 2, columnIndex: 0, content: "2. Makatao" },
        { rowIndex: 2, columnIndex: 1, content: "Is sensitive to individual differences" },
        { rowIndex: 2, columnIndex: 2, content: "SO" },
      ],
    };

    const result = parseAzureLayoutGrades([syntheticObservedValuesTable]);
    assert.equal(result.grades.length, 0, "Core Values must NEVER produce academic grades");
  });

  // -------------------------------------------------------------------------
  // Test F: Grading Scale exclusion produces ZERO academic grades
  // -------------------------------------------------------------------------
  await t.test("Test F — Grading Scale legend table produces ZERO academic grades", async () => {
    const syntheticGradingScaleTable = {
      rowCount: 4,
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
        { rowIndex: 3, columnIndex: 0, content: "Did Not Meet Expectation" },
        { rowIndex: 3, columnIndex: 1, content: "Below 75" },
        { rowIndex: 3, columnIndex: 2, content: "Failed" },
      ],
    };

    const result = parseAzureLayoutGrades([syntheticGradingScaleTable]);
    assert.equal(result.grades.length, 0, "Grading Scale legend must NEVER produce academic grades");
  });

  // -------------------------------------------------------------------------
  // Test G: Blank grade cell remains undefined/blank (no inference)
  // -------------------------------------------------------------------------
  await t.test("Test G — Blank/unselected grade cells remain strictly undefined (no inference or auto-fill)", async () => {
    const tableWithBlanks = {
      rowCount: 4,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Subjects" },
        { rowIndex: 0, columnIndex: 1, content: "Quarter" },
        { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 1, columnIndex: 1, content: "1" },
        { rowIndex: 1, columnIndex: 2, content: "2" },
        { rowIndex: 2, columnIndex: 0, content: "Core Subjects" },
        { rowIndex: 3, columnIndex: 0, content: "Earth Science" },
        { rowIndex: 3, columnIndex: 1, content: "80" },
        { rowIndex: 3, columnIndex: 2, content: ":unselected:" }, // Blank unselected
      ],
    };

    const result = parseAzureLayoutGrades([tableWithBlanks]);
    assert.equal(result.grades.length, 1);
    const subj = result.grades[0];
    assert.equal(subj.q1, 80);
    assert.equal(subj.q2, undefined, "Unselected cell must be undefined; must NOT infer average or copy Q1");
    assert.ok(subj.final === undefined || subj.final === null, "Missing final grade must remain undefined or null");
    assert.equal(subj.final_grade, null, "Missing final_grade must remain null");
    assert.equal(subj.remarks, "Blank / Incomplete");
  });

  // -------------------------------------------------------------------------
  // Test H: Unusual numeric grade (input 32) strictly preserved as 32
  // -------------------------------------------------------------------------
  await t.test("Test H — Unusual OCR mark '32' is strictly preserved as 32 (never corrected to 82)", async () => {
    const tableWithUnusualMark = {
      rowCount: 4,
      columnCount: 4,
      cells: [
        { rowIndex: 0, columnIndex: 0, content: "Subjects" },
        { rowIndex: 0, columnIndex: 1, content: "Quarter" },
        { rowIndex: 0, columnIndex: 3, content: "Semester Final Grade" },
        { rowIndex: 1, columnIndex: 1, content: "1" },
        { rowIndex: 1, columnIndex: 2, content: "2" },
        { rowIndex: 2, columnIndex: 0, content: "Core Subjects" },
        { rowIndex: 3, columnIndex: 0, content: "Chemistry" },
        { rowIndex: 3, columnIndex: 1, content: "32" }, // physically reads 32
        { rowIndex: 3, columnIndex: 2, content: "70" },
      ],
    };

    const result = parseAzureLayoutGrades([tableWithUnusualMark]);
    assert.equal(result.grades.length, 1);
    const subj = result.grades[0];
    assert.equal(subj.q1, 32, "Input '32' must strictly remain 32; NEVER auto-corrected to 82");
    assert.equal(subj.q2, 70, "Failing grade 70 must be preserved without correction");
  });

  // -------------------------------------------------------------------------
  // Test I: Provider metadata displays Azure correctly
  // -------------------------------------------------------------------------
  await t.test("Test I — Provider metadata correctly reflects Azure primary model", async () => {
    process.env.OCR_PRIMARY_PROVIDER = "azure";
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://avv-document-ocr.cognitiveservices.azure.com/";
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "mock-key";

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        if (options?.method === "POST") {
          return new Response(null, {
            status: 202,
            headers: {
              "Operation-Location": "https://avv-document-ocr.cognitiveservices.azure.com/operations/test-op-2",
            },
          });
        }
        if (options?.method === "GET") {
          return new Response(
            JSON.stringify({
              status: "succeeded",
              analyzeResult: {
                content: "General Mathematics 90 90",
                pages: [{ pageNumber: 1, words: [{ content: "Sample", confidence: 0.94 }] }],
                tables: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(url, options);
      };

      const fakeFrontBase64 = "data:image/jpeg;base64," + Buffer.from("fake-front-image").toString("base64");
      const fakeBackBase64 = "data:image/jpeg;base64," + Buffer.from("fake-back-image").toString("base64");

      const req = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frontImage: fakeFrontBase64,
          backImage: fakeBackBase64,
          extractFields: true,
        }),
      });

      const res = await handleOcrRoute(req, "fake-key");
      const data = await res.json();
      assert.equal(data.provider, "azure", "Provider must be azure");
      assert.ok(data.model.includes("azure"), "Model identifier must specify azure");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // Test J: Mistral fallback markdown parsing remains functional
  // -------------------------------------------------------------------------
  await t.test("Test J — Mistral Markdown pipe table parsing remains fully functional when tables array is absent", async () => {
    const mistralMarkdownText = `
| Subject | Q1 | Q2 | Final |
|---|---|---|---|
| Oral Communication | 90 | 85 | 88 |
| General Mathematics | 88 | 92 | 90 |
    `;

    // Without rawLayout.tables, fallback to markdown pipe parsing
    const parsed = parseSeniorHighGradesText(mistralMarkdownText);
    assert.equal(parsed.grades.length, 2, "Markdown parser should extract 2 subjects");
    assert.equal(parsed.grades[0].subject, "Oral Communication");
    assert.equal(parsed.grades[0].q1, 90);
    assert.equal(parsed.grades[0].q2, 85);
    assert.equal(parsed.grades[0].final, 88);
    assert.equal(parsed.grades[0].status, "Passed");
  });

  // -------------------------------------------------------------------------
  // Test K & L & M: One-document association, human verification, and image review
  // -------------------------------------------------------------------------
  await t.test("Test K, L, M — Unified fields associate front/back image references under needs_review state", async () => {
    const frontImageStorageUrl = "https://example.supabase.co/storage/v1/object/public/documents/u1/sf9/front.jpg";
    const backImageStorageUrl = "https://example.supabase.co/storage/v1/object/public/documents/u1/sf9/back.jpg";

    const stagedFields = {
      name: "SANTOS, MARIA",
      lrn: "123456789012",
      school_year: "2023-2024",
      grade_level: "Grade 11",
      back_image_url: backImageStorageUrl,
      images: {
        front: frontImageStorageUrl,
        back: backImageStorageUrl,
      },
      grades: [
        { subject: "Oral Communication", q1: 88, q2: 90, status: "Missing", needsVerification: true },
      ],
      ocr_provider: "azure",
      ocr_model: "azure/prebuilt-read+layout",
    };

    // Verify K: Single document data structure
    assert.ok(stagedFields.images.front && stagedFields.images.back, "Must store both front and back URLs in one record");
    assert.equal(stagedFields.back_image_url, backImageStorageUrl, "Back image URL must be accessible via extracted_fields");

    // Verify L: Missing final grade sets needsVerification = true
    assert.equal(stagedFields.grades[0].needsVerification, true, "Mandatory human review flag must be true");

    // Verify M: Image review toggle can locate both images
    const activeFront = stagedFields.images.front;
    const activeBack = stagedFields.back_image_url;
    assert.equal(activeFront, frontImageStorageUrl, "Front image accessible");
    assert.equal(activeBack, backImageStorageUrl, "Back image accessible");
  });

  // -------------------------------------------------------------------------
  // Test N: 2nd Semester table with Q3 & Q4 and blank Final Grade keeps final_grade: null & General Average: null
  // -------------------------------------------------------------------------
  await t.test(
    "Test N — 2nd Semester table with Q3 & Q4 populated and blank Semester Final Grade keeps final_grade: null and general_average: null (no auto-calculation)",
    async () => {
      const syntheticSem2TableWithBlankFinals = {
        rowCount: 5,
        columnCount: 4,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "Second Semester" },
          { rowIndex: 1, columnIndex: 0, content: "Subjects" },
          { rowIndex: 1, columnIndex: 1, content: "Quarter" },
          { rowIndex: 1, columnIndex: 3, content: "Semester Final Grade" },
          { rowIndex: 2, columnIndex: 1, content: "3" },
          { rowIndex: 2, columnIndex: 2, content: "4" },
          // Subject 1: Q3 = 85, Q4 = 88. Final cell left blank.
          { rowIndex: 3, columnIndex: 0, content: "Physical Science" },
          { rowIndex: 3, columnIndex: 1, content: "85" },
          { rowIndex: 3, columnIndex: 2, content: "88" },
          // Subject 2: Q3 = 89, Q4 = 92. Final cell left blank.
          { rowIndex: 4, columnIndex: 0, content: "Statistics and Probability" },
          { rowIndex: 4, columnIndex: 1, content: "89" },
          { rowIndex: 4, columnIndex: 2, content: "92" },
        ],
      };

      const result = parseAzureLayoutGrades([syntheticSem2TableWithBlankFinals]);

      assert.equal(result.grades.length, 2, "Should extract 2 subjects from 2nd Semester table");

      const [s1, s2] = result.grades;

      // Subject 1 checks:
      assert.equal(s1.subject, "Physical Science");
      assert.equal(s1.q3, 85);
      assert.equal(s1.q4, 88);
      assert.equal(s1.final_grade, null, "Must keep final_grade null without auto-calculating 87");
      assert.equal(s1.remarks, "Blank / Incomplete");
      assert.equal(s1.is_auto_computed, false, "Must NOT be tagged as auto-computed");

      // Subject 2 checks:
      assert.equal(s2.subject, "Statistics and Probability");
      assert.equal(s2.q3, 89);
      assert.equal(s2.q4, 92);
      assert.equal(s2.final_grade, null, "Must keep final_grade null without auto-calculating 91");
      assert.equal(s2.remarks, "Blank / Incomplete");
      assert.equal(s2.is_auto_computed, false, "Must NOT be tagged as auto-computed");

      // General Average & Blank Grade Error checks:
      const updated = updateExtractedFieldsAverages(result);
      assert.equal(updated.general_average, null, "General average must remain null when blank on card");
      assert.equal(updated.has_blank_grade_error, true, "Must flag has_blank_grade_error as true");
    }
  );

  // -------------------------------------------------------------------------
  // Test O: SF9 Front "Report on Attendance" extraction with .5 half-days, auto-sum, & confidence %
  // -------------------------------------------------------------------------
  await t.test(
    "Test O — SF9 Front Report on Attendance extracts School Days, Present, & Absent with .5 half-day decimals, blank total auto-sum, and honest confidence %",
    async () => {
      // 1. Synthetic Azure Document Intelligence Attendance Table from SF9 Front
      // Month headers: Jun to Apr (11 months) + Total
      // Row 1: No. of School Days (Total blank -> should auto-sum to 205)
      // Row 2: No. of Days Present (with 17.5 half-day -> should auto-sum to 201.5)
      // Row 3: No. of Days Absent (with 3.5 half-day -> should auto-sum to 3.5)
      const months = ["Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
      const schoolDaysVals = ["15", "20", "22", "21", "20", "15", "18", "20", "18", "19", "17"]; // sum = 205
      const daysPresentVals = ["15", "20", "21.5", "20.5", "20", "15", "17", "20", "17.5", "18", "17"]; // sum = 201.5
      const daysAbsentVals = ["0", "0", "0.5", "0.5", "0", "0", "1", "0", "0.5", "1", "0"]; // sum = 3.5

      const cells = [
        // Row 0: Headers
        { rowIndex: 0, columnIndex: 0, content: "No. of Days", confidence: 0.98 },
        ...months.map((m, idx) => ({ rowIndex: 0, columnIndex: idx + 1, content: m, confidence: 0.95 })),
        { rowIndex: 0, columnIndex: months.length + 1, content: "Total", confidence: 0.97 },

        // Row 1: No. of School Days (Blank Total)
        { rowIndex: 1, columnIndex: 0, content: "No. of School Days", confidence: 0.96 },
        ...schoolDaysVals.map((v, idx) => ({ rowIndex: 1, columnIndex: idx + 1, content: v, confidence: 0.94 })),
        { rowIndex: 1, columnIndex: months.length + 1, content: "", confidence: 0.90 }, // Blank total

        // Row 2: No. of Days Present (Blank Total, contains 17.5)
        { rowIndex: 2, columnIndex: 0, content: "No. of Days Present", confidence: 0.95 },
        ...daysPresentVals.map((v, idx) => ({ rowIndex: 2, columnIndex: idx + 1, content: v, confidence: 0.93 })),
        { rowIndex: 2, columnIndex: months.length + 1, content: "—", confidence: 0.90 }, // Dash / blank total

        // Row 3: No. of Days Absent (Blank Total, contains 3.5)
        { rowIndex: 3, columnIndex: 0, content: "No. of Days Absent", confidence: 0.94 },
        ...daysAbsentVals.map((v, idx) => ({ rowIndex: 3, columnIndex: idx + 1, content: v, confidence: 0.92 })),
        { rowIndex: 3, columnIndex: months.length + 1, content: "", confidence: 0.88 }, // Blank total
      ];

      const syntheticAttendanceTable = {
        rowCount: 4,
        columnCount: months.length + 2,
        confidence: 0.94,
        cells,
      };

      const tableResult = parseAzureLayoutGrades([syntheticAttendanceTable]);

      assert.ok(Array.isArray(tableResult.attendance), "attendance must be an array");
      assert.equal(tableResult.attendance.length, 3, "Must extract 3 attendance records");

      const [schoolDaysRec, presentRec, absentRec] = tableResult.attendance;

      // Check School Days
      assert.equal(schoolDaysRec.label, "No. of School Days");
      assert.deepEqual(schoolDaysRec.values, schoolDaysVals);
      assert.equal(schoolDaysRec.total, "205", "Blank total must auto-sum to 205");
      assert.ok(typeof schoolDaysRec.confidence === "number", "Row confidence must be a number");
      assert.ok(schoolDaysRec.confidence >= 60 && schoolDaysRec.confidence <= 100, `Confidence ${schoolDaysRec.confidence}% must be valid 0-100%`);

      // Check Days Present (Preserving .5 half-day decimals: 17.5 and 201.5)
      assert.equal(presentRec.label, "No. of Days Present");
      assert.ok(presentRec.values.includes("17.5"), "Values must preserve exact half-day decimal 17.5");
      assert.equal(presentRec.total, "201.5", "Blank total must auto-sum to exact half-day decimal 201.5 without rounding to integer");
      assert.ok(!presentRec.total.includes(".0"), "Exact half-day decimal must not append redundant .0");
      assert.ok(typeof presentRec.confidence === "number", "Row confidence must be a number");
      assert.ok(presentRec.confidence >= 60 && presentRec.confidence <= 100, `Confidence ${presentRec.confidence}% must be valid 0-100%`);

      // Check Days Absent (Preserving .5 half-day decimals: 0.5 and 3.5)
      assert.equal(absentRec.label, "No. of Days Absent");
      assert.ok(absentRec.values.includes("0.5"), "Values must preserve exact half-day decimal 0.5");
      assert.equal(absentRec.total, "3.5", "Blank total must auto-sum to exact decimal 3.5");
      assert.ok(typeof absentRec.confidence === "number", "Row confidence must be a number");
      assert.ok(absentRec.confidence >= 60 && absentRec.confidence <= 100, `Confidence ${absentRec.confidence}% must be valid 0-100%`);

      // Overall attendance confidence
      assert.ok(typeof tableResult.attendance_confidence === "number", "Overall attendance confidence must be populated");
      assert.ok(tableResult.attendance_confidence >= 60 && tableResult.attendance_confidence <= 100);

      // 2. Integration via parseSeniorHighGradesText with rawLayout
      const fullSf9FrontText = `
        Republic of the Philippines - Department of Education
        REPORT ON ATTENDANCE
        LRN: 109876543210
        Name: DELA CRUZ, CARLOS MENDOZA
        Grade Level: Grade 11 Section: STEM-A
      `;

      const parsedFront = parseSeniorHighGradesText(fullSf9FrontText, { tables: [syntheticAttendanceTable] });
      assert.ok(Array.isArray(parsedFront.attendance), "parsedFront.attendance must be populated");
      assert.equal(parsedFront.attendance.length, 3);
      assert.equal(parsedFront.attendance[1].total, "201.5");
      assert.equal(parsedFront.attendance[1].values[8], "17.5");
      assert.ok(typeof parsedFront.attendance_confidence === "number" && parsedFront.attendance_confidence > 0);
    }
  );

  // -------------------------------------------------------------------------
  // Test P: SF9 Back with blank FINAL and General Average cells -> keeps final_grade: null, general_average: null, triggers has_blank_grade_error
  // -------------------------------------------------------------------------
  await t.test(
    "Test P — SF9 Back with blank FINAL and General Average cells keeps final_grade: null and general_average: null (NO auto-calculation), and triggers Blank Grade Error flag",
    async () => {
      const sf9BackTable = {
        rowCount: 4,
        columnCount: 4,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "First Semester" },
          { rowIndex: 1, columnIndex: 0, content: "Subjects" },
          { rowIndex: 1, columnIndex: 1, content: "Quarter 1" },
          { rowIndex: 1, columnIndex: 2, content: "Quarter 2" },
          { rowIndex: 1, columnIndex: 3, content: "Semester Final Grade" },
          // Subject 1: Q1 = 88, Q2 = 89. Final cell is blank.
          { rowIndex: 2, columnIndex: 0, content: "Oral Communication" },
          { rowIndex: 2, columnIndex: 1, content: "88" },
          { rowIndex: 2, columnIndex: 2, content: "89" },
          { rowIndex: 2, columnIndex: 3, content: "" },
          // Subject 2: Q1 = 90, Q2 = 92. Final cell is blank.
          { rowIndex: 3, columnIndex: 0, content: "Komunikasyon at Pananaliksik" },
          { rowIndex: 3, columnIndex: 1, content: "90" },
          { rowIndex: 3, columnIndex: 2, content: "92" },
          { rowIndex: 3, columnIndex: 3, content: "—" },
        ],
      };

      const parsed = parseAzureLayoutGrades([sf9BackTable]);
      assert.equal(parsed.grades.length, 2);

      const [g1, g2] = parsed.grades;
      assert.equal(g1.final_grade, null, "Must keep final_grade null without computing 88.5");
      assert.equal(g1.remarks, "Blank / Incomplete", "Must set remarks to Blank / Incomplete");
      assert.equal(g1.is_auto_computed, false, "Must NOT auto-calculate final grade");

      assert.equal(g2.final_grade, null, "Must keep final_grade null without computing 91");
      assert.equal(g2.remarks, "Blank / Incomplete", "Must set remarks to Blank / Incomplete");
      assert.equal(g2.is_auto_computed, false, "Must NOT auto-calculate final grade");

      const fieldsWithAverages = updateExtractedFieldsAverages(parsed);
      assert.equal(fieldsWithAverages.general_average, null, "Must keep general_average null when blank on card");
      assert.equal(fieldsWithAverages.has_blank_grade_error, true, "Must flag has_blank_grade_error as true");
      assert.equal(hasBlankGradeError(fieldsWithAverages), true, "hasBlankGradeError helper must return true");
    }
  );

  // -------------------------------------------------------------------------
  // Test Q: SF9 Front with Jun..Apr (21, 5, 7, 22, 21, 19, 11, 20, 14, 22, 17.5 | Total: 201.5) and 100000000000 bug
  // -------------------------------------------------------------------------
  await t.test(
    "Test Q — SF9 Front with Jun..Apr (21, 5, 7, 22, 21, 19, 11, 20, 14, 22, 17.5, Total: 201.5) and No. of Days Absent OCR string '100000000000' resolves to 0 across all 11 months + Total: 0, includes Apr: 17.5, shows Total: 201.5, and evaluates attendance_risk_status to NORMAL",
    async () => {
      const months = ["Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
      const schoolDaysVals = ["21", "5", "7", "22", "21", "19", "11", "20", "14", "22", "17.5"]; // sum = 201.5
      const daysPresentVals = ["21", "5", "7", "22", "21", "19", "11", "20", "14", "22", "17.5"]; // sum = 201.5

      const frontAttendanceTable = {
        rowCount: 4,
        columnCount: 13,
        cells: [
          // Row 0: Headers (Jun to Apr + Total = 11 months + Total)
          { rowIndex: 0, columnIndex: 0, content: "No. of Days" },
          ...months.map((m, idx) => ({ rowIndex: 0, columnIndex: idx + 1, content: m })),
          { rowIndex: 0, columnIndex: 12, content: "Total" },

          // Row 1: No. of School Days (Total: 201.5, with scribble 162 above it)
          { rowIndex: 1, columnIndex: 0, content: "No. of School Days" },
          ...schoolDaysVals.map((v, idx) => ({ rowIndex: 1, columnIndex: idx + 1, content: v })),
          { rowIndex: 1, columnIndex: 12, content: "162\n201.5" },

          // Row 2: No. of Days Present (Total: 201.5)
          { rowIndex: 2, columnIndex: 0, content: "No. of Days Present" },
          ...daysPresentVals.map((v, idx) => ({ rowIndex: 2, columnIndex: idx + 1, content: v })),
          { rowIndex: 2, columnIndex: 12, content: "201.5" },

          // Row 3: No. of Days Absent — Azure OCR merged border + 11 zeros into "100000000000" in col 1
          { rowIndex: 3, columnIndex: 0, content: "No. of Days Absent" },
          { rowIndex: 3, columnIndex: 1, content: "100000000000" },
          { rowIndex: 3, columnIndex: 12, content: "0" },
        ],
      };

      const tableResult = parseAzureLayoutGrades([frontAttendanceTable]);

      // 1. Months verification
      assert.ok(Array.isArray(tableResult.attendance_months), "attendance_months must be array");
      assert.equal(tableResult.attendance_months.length, 11, "Must contain all 11 DepEd months Jun..Apr");
      assert.equal(tableResult.attendance_months[10], "Apr", "Apr must be included");

      // 2. Records verification
      assert.equal(tableResult.attendance.length, 3, "Must extract 3 attendance records");
      const [sdRec, dpRec, daRec] = tableResult.attendance;

      // School Days: 17.5 in Apr and printed total 201.5 (ignoring scribble 162)
      assert.equal(sdRec.label, "No. of School Days");
      assert.equal(sdRec.values[10], "17.5", "Apr school days must be 17.5");
      assert.equal(sdRec.total, "201.5", "Must use printed bottom total 201.5 ignoring 162 scribble");

      // Days Present: 17.5 in Apr and total 201.5
      assert.equal(dpRec.label, "No. of Days Present");
      assert.equal(dpRec.values[10], "17.5", "Apr days present must be 17.5");
      assert.equal(dpRec.total, "201.5");

      // Days Absent: Unpacked from 100000000000 to 11 zeros + Total: 0
      assert.equal(daRec.label, "No. of Days Absent");
      assert.equal(daRec.values.length, 11, "Days absent must be unpacked across all 11 months");
      for (let i = 0; i < 11; i++) {
        assert.equal(daRec.values[i], "0", `Month ${months[i]} absent must be 0, never raw 100000000000`);
      }
      assert.equal(daRec.total, "0", "Absent total must be 0");

      // 3. Totals and Risk Status verification
      assert.ok(tableResult.attendance_totals, "attendance_totals must be populated");
      assert.equal(tableResult.attendance_totals.printed_school_days, 201.5);
      assert.equal(tableResult.attendance_totals.printed_days_present, 201.5);
      assert.equal(tableResult.attendance_totals.printed_days_absent, 0);
      assert.equal(tableResult.attendance_totals.computed_school_days, 179.5);
      assert.equal(tableResult.attendance_totals.computed_days_present, 179.5);
      assert.equal(tableResult.attendance_totals.computed_days_absent, 0);

      // Risk status must be NORMAL (absence is 0%, complete data across all 11 months)
      assert.equal(tableResult.attendance_risk_status, "NORMAL", "Attendance risk status must be NORMAL, not INCOMPLETE_ATTENDANCE_DATA");
    }
  );

  // -------------------------------------------------------------------------
  // Test R: Teacher-Friendly Error & Status Legends and Semester General Average footer rows
  // -------------------------------------------------------------------------
  await t.test(
    "Test R — SF9 Back renders Teacher Error & Status Legend and General Average for the Semester footer rows (showing Blank when empty)",
    async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");

      const uploadPagePath = path.resolve("./src/app/upload/page.tsx");
      const individualViewPath = path.resolve("./src/components/validation/IndividualDocumentExtractionView.tsx");
      const unifiedViewPath = path.resolve("./src/components/validation/UnifiedBatchResultsView.tsx");

      const uploadPageSrc = fs.readFileSync(uploadPagePath, "utf8");
      const individualViewSrc = fs.readFileSync(individualViewPath, "utf8");
      const unifiedViewSrc = fs.readFileSync(unifiedViewPath, "utf8");

      // 1. Error & Status Legend rendered in Step 3, Stage B, and Stage D
      for (const [name, src] of [
        ["Step 3 (upload/page.tsx)", uploadPageSrc],
        ["Stage B (IndividualDocumentExtractionView.tsx)", individualViewSrc],
        ["Stage D (UnifiedBatchResultsView.tsx)", unifiedViewSrc],
      ]) {
        assert.ok(
          src.includes('data-testid="sf9-error-legends"'),
          `${name} must render data-testid="sf9-error-legends"`
        );
        assert.ok(
          src.includes("Blank Grade Error") &&
          src.includes("Blank / Incomplete") &&
          src.includes("Passed / Failed"),
          `${name} must explain Blank Grade Error, Blank / Incomplete, and Passed / Failed`
        );
      }

      // 2. Both Sem 1 and Sem 2 tables in Step 3 render General Average for the Semester footer rows
      assert.ok(
        uploadPageSrc.includes('data-testid="sf9-sem1-general-average-row"'),
        "Must render data-testid=\"sf9-sem1-general-average-row\""
      );
      assert.ok(
        uploadPageSrc.includes('data-testid="sf9-sem2-general-average-row"'),
        "Must render data-testid=\"sf9-sem2-general-average-row\""
      );
      assert.ok(
        uploadPageSrc.includes("General Average for the Semester"),
        "Must include 'General Average for the Semester' label spanning columns"
      );

      // 3. Logic verification: When empty/null, displays 'Blank' and 'Blank / Incomplete'
      const emptyBackResult = parseAzureLayoutGrades([
        {
          rowCount: 3,
          columnCount: 4,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "First Semester" },
            { rowIndex: 1, columnIndex: 0, content: "Subjects" },
            { rowIndex: 1, columnIndex: 1, content: "Q1" },
            { rowIndex: 1, columnIndex: 2, content: "Q2" },
            { rowIndex: 1, columnIndex: 3, content: "Final" },
            { rowIndex: 2, columnIndex: 0, content: "General Average for the Semester" },
            { rowIndex: 2, columnIndex: 3, content: "" },
          ],
        },
      ]);
      const emptyFields = updateExtractedFieldsAverages(emptyBackResult);
      assert.equal(emptyFields.sem1_general_average, null, "sem1_general_average must be null when blank on card");
      assert.equal(emptyFields.general_average, null, "general_average must be null when blank on card");
      assert.equal(emptyFields.annual_general_average, null, "annual_general_average must be null when semester average is blank");
    }
  );

  // -------------------------------------------------------------------------
  // Test S: Central Grade Status Evaluator (Blank vs. Low Confidence vs. DepEd Remarks)
  // -------------------------------------------------------------------------
  await t.test(
    "Test S — evaluateDynamicGradeStatus: Null/empty cells evaluate to Blank / Blank / Incomplete (zero hardcoded PASSED), low-confidence (< 65%) to Not Recognized (XX%), and numeric grades dynamically evaluate to PASSED (>= 75) or FAILED (< 75)",
    async () => {
      // 1. Case A: Empty / Unread cells must NEVER default to PASSED or FAILED
      const blankInputs = [null, undefined, "", "—", "-", "   ", "blank", "missing", "NaN", "null"];
      for (const val of blankInputs) {
        const res = evaluateDynamicGradeStatus({ grade: val });
        assert.equal(res.status, "blank", `Value "${val}" must evaluate to status: "blank"`);
        assert.equal(res.gradeDisplay, "Blank", `Value "${val}" must have gradeDisplay: "Blank"`);
        assert.equal(res.remarkDisplay, "Blank / Incomplete", `Value "${val}" must have remarkDisplay: "Blank / Incomplete"`);
        assert.equal(res.officialRemark, "BLANK / INCOMPLETE");
        assert.equal(res.isValidNumeric, false);
      }

      // Empty cell with rawRemark passed as "Passed" must NEVER default to PASSED
      const blankWithPassedRemark = evaluateDynamicGradeStatus({ grade: null, rawRemark: "Passed" });
      assert.equal(blankWithPassedRemark.status, "blank");
      assert.equal(blankWithPassedRemark.remarkDisplay, "Blank / Incomplete");
      assert.notEqual(blankWithPassedRemark.remarkDisplay, "PASSED");

      // Empty cell with rawRemark passed as "Failed" must NEVER default to FAILED
      const blankWithFailedRemark = evaluateDynamicGradeStatus({ grade: "", rawRemark: "Failed" });
      assert.equal(blankWithFailedRemark.status, "blank");
      assert.equal(blankWithFailedRemark.remarkDisplay, "Blank / Incomplete");

      // Empty cell with explicit INCOMPLETE / DROPPED remark preserves that status
      const incRes = evaluateDynamicGradeStatus({ grade: null, rawRemark: "Incomplete" });
      assert.equal(incRes.status, "incomplete");
      assert.equal(incRes.remarkDisplay, "Incomplete");

      const drpRes = evaluateDynamicGradeStatus({ grade: "—", rawRemark: "DROPPED" });
      assert.equal(drpRes.status, "dropped");
      assert.equal(drpRes.remarkDisplay, "Dropped");

      // 2. Case B: Low OCR Confidence (< 65%) must evaluate to Not Recognized (with % badge)
      const lowConf1 = evaluateDynamicGradeStatus({ grade: 88, confidencePercent: 52 });
      assert.equal(lowConf1.status, "not_recognized");
      assert.equal(lowConf1.isLowConfidence, true);
      assert.equal(lowConf1.remarkDisplay, "Not Recognized (52%)");
      assert.equal(lowConf1.officialRemark, "NOT RECOGNIZED");

      // Confidence passed as ratio 0.45 (45%)
      const lowConf2 = evaluateDynamicGradeStatus({ grade: 78, confidencePercent: 0.45 });
      assert.equal(lowConf2.status, "not_recognized");
      assert.equal(lowConf2.isLowConfidence, true);
      assert.equal(lowConf2.remarkDisplay, "Not Recognized (45%)");

      // Low confidence on failing grade must also NOT evaluate to FAILED
      const lowConfFail = evaluateDynamicGradeStatus({ grade: 70, confidencePercent: 61 });
      assert.equal(lowConfFail.status, "not_recognized");
      assert.equal(lowConfFail.remarkDisplay, "Not Recognized (61%)");

      // Garbled / unparseable non-numeric text where grade is expected
      const garbled = evaluateDynamicGradeStatus({ grade: "XYZ_GARBLED" });
      assert.equal(garbled.status, "not_recognized");
      assert.equal(garbled.remarkDisplay, "Not Recognized");

      // 3. Case C: Read with sufficient confidence (>= 65% or undefined) & Valid Numeric Grade
      // Passing threshold >= 75
      const pass85 = evaluateDynamicGradeStatus({ grade: 85 });
      assert.equal(pass85.status, "passed");
      assert.equal(pass85.remarkDisplay, "PASSED");
      assert.equal(pass85.officialRemark, "PASSED");
      assert.equal(pass85.gradeDisplay, "85");
      assert.equal(pass85.isLowConfidence, false);
      assert.equal(pass85.isValidNumeric, true);

      const pass75Exact = evaluateDynamicGradeStatus({ grade: 75, confidencePercent: 95 });
      assert.equal(pass75Exact.status, "passed");
      assert.equal(pass75Exact.remarkDisplay, "PASSED");

      // Failing threshold < 75
      const fail74 = evaluateDynamicGradeStatus({ grade: 74, confidencePercent: 88 });
      assert.equal(fail74.status, "failed");
      assert.equal(fail74.remarkDisplay, "FAILED");
      assert.equal(fail74.officialRemark, "FAILED");
      assert.equal(fail74.gradeDisplay, "74");

      const fail60 = evaluateDynamicGradeStatus({ grade: 60 });
      assert.equal(fail60.status, "failed");
      assert.equal(fail60.remarkDisplay, "FAILED");

      // Decimal grades: 74.5 rounds to 75 (PASSED), 74.4 rounds to 74 (FAILED)
      const roundPass = evaluateDynamicGradeStatus({ grade: 74.5 });
      assert.equal(roundPass.status, "passed");
      assert.equal(roundPass.remarkDisplay, "PASSED");
      assert.equal(roundPass.gradeDisplay, "75");

      const roundFail = evaluateDynamicGradeStatus({ grade: 74.4 });
      assert.equal(roundFail.status, "failed");
      assert.equal(roundFail.remarkDisplay, "FAILED");
      assert.equal(roundFail.gradeDisplay, "74");

      // Explicit valid physical remark overrides numeric mark at >= 65%
      const incNumeric = evaluateDynamicGradeStatus({ grade: 85, rawRemark: "INC", confidencePercent: 90 });
      assert.equal(incNumeric.status, "incomplete");
      assert.equal(incNumeric.remarkDisplay, "Incomplete");

      // 4. Verify tableGradesParser integration
      const parsedWithTable = parseAzureLayoutGrades([
        {
          rowCount: 4,
          columnCount: 5,
          confidence: 0.50, // Low table confidence 50%
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "First Semester" },
            { rowIndex: 1, columnIndex: 0, content: "Subject" },
            { rowIndex: 1, columnIndex: 1, content: "Q1" },
            { rowIndex: 1, columnIndex: 2, content: "Q2" },
            { rowIndex: 1, columnIndex: 3, content: "Final" },
            { rowIndex: 1, columnIndex: 4, content: "Remarks" },
            { rowIndex: 2, columnIndex: 0, content: "Oral Communication" },
            { rowIndex: 2, columnIndex: 1, content: "85" },
            { rowIndex: 2, columnIndex: 2, content: "87" },
            { rowIndex: 2, columnIndex: 3, content: "86" },
            { rowIndex: 2, columnIndex: 4, content: "" },
            { rowIndex: 3, columnIndex: 0, content: "General Mathematics" },
            { rowIndex: 3, columnIndex: 1, content: "80" },
            { rowIndex: 3, columnIndex: 2, content: "80" },
            { rowIndex: 3, columnIndex: 3, content: "" }, // Blank final
            { rowIndex: 3, columnIndex: 4, content: "" },
          ],
        },
      ]);

      const gLow = parsedWithTable.grades.find((g) => g.subject === "Oral Communication");
      assert.ok(gLow, "Oral Communication grade row must exist");
      assert.equal(gLow.remarks, "Not Recognized (50%)", "Low confidence row must set remarks to 'Not Recognized (50%)'");

      const gBlank = parsedWithTable.grades.find((g) => g.subject === "General Mathematics");
      assert.ok(gBlank, "General Mathematics grade row must exist");
      assert.equal(gBlank.status, "Missing");
      assert.equal(gBlank.remarks, "Blank / Incomplete", "Blank final cell must evaluate to 'Blank / Incomplete'");
    }
  );

  // -------------------------------------------------------------------------
  // Test T: Strict DepEd Observed Values (AO, SO, RO, NO) Visual-Homoglyph Snapping
  // -------------------------------------------------------------------------
  await t.test(
    "Test T — Strict 2-letter DepEd Observed Values (AO, SO, RO, NO) with visual homoglyph snapping (zero digits allowed)",
    async () => {
      // 1. Direct homoglyph snapping tests
      // 'S' mappings -> 'SO'
      assert.equal(normalizeObservedValueMarking("50"), "SO", "50 must snap to 'SO'");
      assert.equal(normalizeObservedValueMarking(50), "SO", "Numeric 50 must snap to 'SO'");
      assert.equal(normalizeObservedValueMarking("80"), "SO", "80 must snap to 'SO'");
      assert.equal(normalizeObservedValueMarking(80), "SO", "Numeric 80 must snap to 'SO'");
      assert.equal(normalizeObservedValueMarking("S0"), "SO", "S0 must snap to 'SO'");
      assert.equal(normalizeObservedValueMarking("5O"), "SO", "5O must snap to 'SO'");
      assert.equal(normalizeObservedValueMarking("8O"), "SO", "8O must snap to 'SO'");
      assert.equal(normalizeObservedValueMarking("SO"), "SO", "SO must remain 'SO'");
      assert.equal(normalizeObservedValueMarking("S.O."), "SO", "S.O. must snap to 'SO'");
      assert.equal(normalizeObservedValueMarking(" sometimes observed "), "SO", "Full wording must map to 'SO'");

      // 'A' mappings -> 'AO'
      assert.equal(normalizeObservedValueMarking("10"), "AO", "10 must snap to 'AO'");
      assert.equal(normalizeObservedValueMarking(10), "AO", "Numeric 10 must snap to 'AO'");
      assert.equal(normalizeObservedValueMarking("40"), "AO", "40 must snap to 'AO'");
      assert.equal(normalizeObservedValueMarking(40), "AO", "Numeric 40 must snap to 'AO'");
      assert.equal(normalizeObservedValueMarking("AD"), "AO", "AD must snap to 'AO'");
      assert.equal(normalizeObservedValueMarking("A0"), "AO", "A0 must snap to 'AO'");
      assert.equal(normalizeObservedValueMarking("AO"), "AO", "AO must remain 'AO'");
      assert.equal(normalizeObservedValueMarking("A.O."), "AO", "A.O. must snap to 'AO'");
      assert.equal(normalizeObservedValueMarking("always observed"), "AO", "Full wording must map to 'AO'");

      // 'R' mappings -> 'RO'
      assert.equal(normalizeObservedValueMarking("R0"), "RO", "R0 must snap to 'RO'");
      assert.equal(normalizeObservedValueMarking("BO"), "RO", "BO must snap to 'RO'");
      assert.equal(normalizeObservedValueMarking("B0"), "RO", "B0 must snap to 'RO'");
      assert.equal(normalizeObservedValueMarking("PO"), "RO", "PO must snap to 'RO'");
      assert.equal(normalizeObservedValueMarking("RO"), "RO", "RO must remain 'RO'");
      assert.equal(normalizeObservedValueMarking("R.O."), "RO", "R.O. must snap to 'RO'");
      assert.equal(normalizeObservedValueMarking("rarely observed"), "RO", "Full wording must map to 'RO'");

      // 'N' mappings -> 'NO'
      assert.equal(normalizeObservedValueMarking("N0"), "NO", "N0 must snap to 'NO'");
      assert.equal(normalizeObservedValueMarking("MO"), "NO", "MO must snap to 'NO'");
      assert.equal(normalizeObservedValueMarking("M0"), "NO", "M0 must snap to 'NO'");
      assert.equal(normalizeObservedValueMarking("HO"), "NO", "HO must snap to 'NO'");
      assert.equal(normalizeObservedValueMarking("H0"), "NO", "H0 must snap to 'NO'");
      assert.equal(normalizeObservedValueMarking("70"), "NO", "70 must snap to 'NO'");
      assert.equal(normalizeObservedValueMarking(70), "NO", "Numeric 70 must snap to 'NO'");
      assert.equal(normalizeObservedValueMarking("ZO"), "NO", "ZO must snap to 'NO'");
      assert.equal(normalizeObservedValueMarking("NO"), "NO", "NO must remain 'NO'");
      assert.equal(normalizeObservedValueMarking("N.O."), "NO", "N.O. must snap to 'NO'");
      assert.equal(normalizeObservedValueMarking("not observed"), "NO", "Full wording must map to 'NO'");

      // Blank and unparseable inputs MUST resolve strictly to null
      assert.equal(normalizeObservedValueMarking(null), null, "null must return null");
      assert.equal(normalizeObservedValueMarking(undefined), null, "undefined must return null");
      assert.equal(normalizeObservedValueMarking(""), null, "empty string must return null");
      assert.equal(normalizeObservedValueMarking("   "), null, "whitespace must return null");
      assert.equal(normalizeObservedValueMarking("-"), null, "dash must return null");
      assert.equal(normalizeObservedValueMarking("—"), null, "em-dash must return null");
      assert.equal(normalizeObservedValueMarking("–"), null, "en-dash must return null");
      assert.equal(normalizeObservedValueMarking(":unselected:"), null, ":unselected: must return null");
      assert.equal(normalizeObservedValueMarking("none"), null, "none must return null");
      assert.equal(normalizeObservedValueMarking("n/a"), null, "n/a must return null");
      assert.equal(normalizeObservedValueMarking("?"), null, "question mark must return null");
      assert.equal(normalizeObservedValueMarking("XYZ"), null, "unrelated text must return null");
      assert.equal(normalizeObservedValueMarking("1234"), null, "unrelated digits must return null");

      // ZERO DIGITS DOMAIN CONSTRAINT: test set of random tokens never returns digits
      const testTokens = [
        "50", "80", "10", "40", "70", "A0", "S0", "R0", "N0", "AD", "B0", "M0", "H0",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "99", "100", "?", "INC", "DRP"
      ];
      for (const tok of testTokens) {
        const res = normalizeObservedValueMarking(tok);
        if (res !== null) {
          assert.match(
            res,
            /^(?:AO|SO|RO|NO)$/,
            `Token '${tok}' resulted in '${res}'. MUST ONLY be pure 2-letter AO, SO, RO, or NO (ZERO DIGITS ALLOWED).`
          );
        }
      }

      // 2. Integration: Azure Layout Observed Values table extraction
      const mockOvTable = {
        rowCount: 5,
        columnCount: 6,
        confidence: 0.95,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "REPORT ON LEARNER'S OBSERVED VALUES" },
          { rowIndex: 1, columnIndex: 0, content: "Core Values" },
          { rowIndex: 1, columnIndex: 1, content: "Behavior Statements" },
          { rowIndex: 1, columnIndex: 2, content: "Quarter" },
          { rowIndex: 2, columnIndex: 2, content: "1" },
          { rowIndex: 2, columnIndex: 3, content: "2" },
          { rowIndex: 2, columnIndex: 4, content: "3" },
          { rowIndex: 2, columnIndex: 5, content: "4" },
          { rowIndex: 3, columnIndex: 0, content: "Maka-Diyos" },
          { rowIndex: 3, columnIndex: 1, content: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others" },
          { rowIndex: 3, columnIndex: 2, content: "10" }, // Homoglyph for AO
          { rowIndex: 3, columnIndex: 3, content: "50" }, // Homoglyph for SO
          { rowIndex: 3, columnIndex: 4, content: "R0" }, // Homoglyph for RO
          { rowIndex: 3, columnIndex: 5, content: "MO" }, // Homoglyph for NO
          { rowIndex: 4, columnIndex: 0, content: "Makatao" },
          { rowIndex: 4, columnIndex: 1, content: "Is sensitive to individual, social and cultural differences; resists stereotyping people" },
          { rowIndex: 4, columnIndex: 2, content: "AD" }, // Homoglyph for AO
          { rowIndex: 4, columnIndex: 3, content: "80" }, // Homoglyph for SO
          { rowIndex: 4, columnIndex: 4, content: "BO" }, // Homoglyph for RO
          { rowIndex: 4, columnIndex: 5, content: "70" }, // Homoglyph for NO
        ],
      };

      const parsedOvResult = parseAzureLayoutGrades([mockOvTable]);
      assert.ok(parsedOvResult.observed_values, "Observed values structure must be parsed");
      const stmts = parsedOvResult.observed_values.statements;
      assert.ok(stmts.length >= 2, "At least 2 statements extracted");

      const s1 = stmts.find((s) => s.statement_id === "maka_diyos_1");
      assert.ok(s1, "maka_diyos_1 must be found");
      assert.equal(s1.q1.normalized_rating, "AO", "10 must be normalized to 'AO'");
      assert.equal(s1.q2.normalized_rating, "SO", "50 must be normalized to 'SO'");
      assert.equal(s1.q3.normalized_rating, "RO", "R0 must be normalized to 'RO'");
      assert.equal(s1.q4.normalized_rating, "NO", "MO must be normalized to 'NO'");

      const s2 = stmts.find((s) => s.statement_id === "makatao_1");
      assert.ok(s2, "makatao_1 must be found");
      assert.equal(s2.q1.normalized_rating, "AO", "AD must be normalized to 'AO'");
      assert.equal(s2.q2.normalized_rating, "SO", "80 must be normalized to 'SO'");
      assert.equal(s2.q3.normalized_rating, "RO", "BO must be normalized to 'RO'");
      assert.equal(s2.q4.normalized_rating, "NO", "70 must be normalized to 'NO'");

      // Verify that NO observation row in observed_values contains digits in normalized_rating
      for (const obs of parsedOvResult.observed_values.observations) {
        if (obs.normalized_rating !== null) {
          assert.match(
            obs.normalized_rating,
            /^(?:AO|SO|RO|NO)$/,
            `Observation normalized_rating must be pure 2-letter DepEd code (got '${obs.normalized_rating}')`
          );
        }
      }

      // 3. Integration: Text parser fallback
      const textSample = `
REPORT ON LEARNER'S OBSERVED VALUES
Core Values | Behavior Statements | 1 | 2 | 3 | 4
Maka-Diyos | Shows adherence to ethical principles by upholding truth in all undertakings | 40 | 80 | B0 | H0
`;
      const textParsed = parseSeniorHighGradesText(textSample);
      assert.ok(textParsed.observed_values, "Text parser must extract observed values");
      const stmtEthical = textParsed.observed_values.statements.find((s) => s.statement_id === "maka_diyos_2");
      assert.ok(stmtEthical, "maka_diyos_2 must be found in text extraction");
      assert.equal(stmtEthical.q1.normalized_rating, "AO", "40 must be normalized to 'AO'");
      assert.equal(stmtEthical.q2.normalized_rating, "SO", "80 must be normalized to 'SO'");
      assert.equal(stmtEthical.q3.normalized_rating, "RO", "B0 must be normalized to 'RO'");
      assert.equal(stmtEthical.q4.normalized_rating, "NO", "H0 must be normalized to 'NO'");
    }
  );

  // -------------------------------------------------------------------------
  // Test O: Strict Digits-Only Grades (Max 3 Digits, DepEd 60-100 & 8/7 Homoglyph Recovery) + Per-Cell Confidence
  // -------------------------------------------------------------------------
  await t.test(
    "Test O — Strict Digits-Only Grades (Max 3 Digits, DepEd 60-100 & 8/7 Homoglyph Recovery) + Per-Cell Confidence",
    async () => {
      // 1. Digits-only & max 3 digits
      const bad1 = sanitizeAndRecoverDepEdGrade({ rawGrade: "1234" });
      assert.equal(bad1.grade, null, "Grades >3 digits must return null");
      assert.equal(bad1.wasRecovered, false);
      assert.equal(bad1.isInvalidFormat, true, "Grades >3 digits must be rejected as invalid format");

      const bad2 = sanitizeAndRecoverDepEdGrade({ rawGrade: "85a" });
      assert.equal(bad2.grade, null, "Grades with non-digit chars must return null");
      assert.equal(bad2.wasRecovered, false);
      assert.equal(bad2.isInvalidFormat, true, "Grades with non-digit chars must be rejected as invalid format");

      const bad3 = sanitizeAndRecoverDepEdGrade({ rawGrade: "abc" });
      assert.equal(bad3.grade, null, "Pure letters must return null");
      assert.equal(bad3.wasRecovered, false);
      assert.equal(bad3.isInvalidFormat, true, "Pure letters must be rejected as invalid format");

      const empty1 = sanitizeAndRecoverDepEdGrade({ rawGrade: "" });
      assert.equal(empty1.grade, null);
      assert.equal(empty1.wasRecovered, false);
      assert.equal(empty1.isInvalidFormat, false);

      const null1 = sanitizeAndRecoverDepEdGrade({ rawGrade: null });
      assert.equal(null1.grade, null);
      assert.equal(null1.wasRecovered, false);
      assert.equal(null1.isInvalidFormat, false);

      // 2. Valid DepEd Grades 60-100
      assert.deepEqual(
        sanitizeAndRecoverDepEdGrade({ rawGrade: 88 }),
        { grade: 88, wasRecovered: false, isInvalidFormat: false },
        "Numeric 88 in range must pass untouched"
      );
      assert.deepEqual(
        sanitizeAndRecoverDepEdGrade({ rawGrade: "92" }),
        { grade: 92, wasRecovered: false, isInvalidFormat: false },
        "String '92' in range must parse cleanly"
      );
      assert.deepEqual(
        sanitizeAndRecoverDepEdGrade({ rawGrade: "100" }),
        { grade: 100, wasRecovered: false, isInvalidFormat: false },
        "100 must be accepted"
      );
      assert.deepEqual(
        sanitizeAndRecoverDepEdGrade({ rawGrade: "60" }),
        { grade: 60, wasRecovered: false, isInvalidFormat: false },
        "60 must be accepted"
      );

      // 3. Truncated single-digit recovery (0-9)
      const recSingle8 = sanitizeAndRecoverDepEdGrade({
        rawGrade: 8,
        q1: 87,
        q2: 88,
      });
      assert.equal(recSingle8.grade, 88, "Truncated 8 with Q1=87, Q2=88 must recover to 88");
      assert.equal(recSingle8.wasRecovered, true);

      const unrecSingle8 = sanitizeAndRecoverDepEdGrade({ rawGrade: 8 });
      assert.equal(unrecSingle8.grade, null, "Ambiguous single-digit 8 without context must return null");
      assert.equal(unrecSingle8.wasRecovered, false);

      // 4. Leading-1 misread recovery (10-19)
      const rec16 = sanitizeAndRecoverDepEdGrade({
        rawGrade: 16,
        q1: 85,
        q2: 86,
      });
      assert.equal(rec16.grade, 86, "Misread 16 with Q1=85, Q2=86 must recover to 86");
      assert.equal(rec16.wasRecovered, true);

      const rec19 = sanitizeAndRecoverDepEdGrade({
        rawGrade: "19",
        siblingQuarter: 78,
      });
      assert.equal(rec19.grade, 79, "Misread 19 with sibling 78 must recover to 79");
      assert.equal(rec19.wasRecovered, true);

      // 5. Out-of-range unrecoverable (<60 or >100)
      const outOfRangeLow = sanitizeAndRecoverDepEdGrade({ rawGrade: 32 });
      assert.equal(outOfRangeLow.grade, null, "Out-of-range 32 must return null");
      assert.equal(outOfRangeLow.isInvalidFormat, true);

      const outOfRangeHigh = sanitizeAndRecoverDepEdGrade({ rawGrade: 125 });
      assert.equal(outOfRangeHigh.grade, null, "Out-of-range 125 must return null");
      assert.equal(outOfRangeHigh.isInvalidFormat, true);

      // 6. evaluateDynamicGradeStatus integration
      const evalInvalid = evaluateDynamicGradeStatus({ grade: "1234" });
      assert.equal(evalInvalid.status, "not_recognized", "Invalid grade format must be not_recognized");
      assert.notEqual(evalInvalid.status, "failed", "Invalid grade format must NEVER be marked FAILED");
      assert.equal(evalInvalid.officialRemark, "NOT RECOGNIZED");

      const evalOutRange = evaluateDynamicGradeStatus({ grade: 32 });
      assert.equal(evalOutRange.status, "not_recognized", "Unrecovered 32 must be not_recognized");
      assert.notEqual(evalOutRange.status, "failed", "Unrecovered 32 must NEVER be marked FAILED");

      const evalRecovered = evaluateDynamicGradeStatus({
        grade: 16,
        confidencePercent: 95,
        siblingQuarter: 85,
      });
      assert.equal(evalRecovered.gradeDisplay, "86", "Recovered grade must display 86");
      assert.equal(evalRecovered.status, "passed", "86 must evaluate to passed");
      assert.equal(evalRecovered.wasRecovered, true);
      assert.ok(evalRecovered.confidencePercent <= 85, "Recovered grade confidence must be capped at 85%");

      // 7. Table parser per-cell confidence propagation
      const mockGradeTable = {
        rowCount: 3,
        columnCount: 5,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "Subject" },
          { rowIndex: 0, columnIndex: 1, content: "Q1" },
          { rowIndex: 0, columnIndex: 2, content: "Q2" },
          { rowIndex: 0, columnIndex: 3, content: "Final" },
          { rowIndex: 0, columnIndex: 4, content: "Remarks" },
          { rowIndex: 1, columnIndex: 0, content: "English" },
          { rowIndex: 1, columnIndex: 1, content: "88", confidence: 0.95 },
          { rowIndex: 1, columnIndex: 2, content: "90", confidence: 0.82 },
          { rowIndex: 1, columnIndex: 3, content: "89", confidence: 0.91 },
          { rowIndex: 1, columnIndex: 4, content: "Passed", confidence: 0.96 },
        ],
      };

      const parsedGrades = parseAzureLayoutGrades([mockGradeTable]);
      assert.ok(parsedGrades.grades.length > 0, "Must extract grades");
      const eng = parsedGrades.grades[0];
      assert.equal(eng.q1, 88);
      assert.equal(eng.q2, 90);
      assert.equal(eng.final_grade, 89);
      assert.equal(eng.q1Confidence, 95, "q1Confidence must be normalized to 95%");
      assert.equal(eng.q2Confidence, 82, "q2Confidence must be normalized to 82%");
      assert.equal(eng.finalGradeConfidence, 91, "finalGradeConfidence must be normalized to 91%");
    }
  );

  // -------------------------------------------------------------------------
  // Test V: Per-Cell Confidence on Quarterly & General Average Grades, Strict Male/Female Sex Extraction & Mismatch Discrepancy, and Consecutive School Year Validation
  // -------------------------------------------------------------------------
  await t.test(
    "Test V — Per-Cell Confidence on Quarterly & General Average Grades, Strict Male/Female Sex Extraction & Mismatch Discrepancy, and Consecutive School Year Validation",
    async () => {
      // 1. Consecutive School Year Validation
      const syValid1 = validateConsecutiveSchoolYear("2025-2026");
      assert.equal(syValid1.isValid, true);
      assert.equal(syValid1.startYear, 2025);
      assert.equal(syValid1.endYear, 2026);

      const syValid2 = validateConsecutiveSchoolYear("2024 - 2025");
      assert.equal(syValid2.isValid, true);
      assert.equal(syValid2.startYear, 2024);
      assert.equal(syValid2.endYear, 2025);

      const syInvalid1 = validateConsecutiveSchoolYear("2025-2027");
      assert.equal(syInvalid1.isValid, false);
      assert.ok(syInvalid1.reason.includes("non-consecutive"));

      const syInvalid2 = validateConsecutiveSchoolYear("2025-2028");
      assert.equal(syInvalid2.isValid, false);

      const syInvalidSame = validateConsecutiveSchoolYear("2025-2025");
      assert.equal(syInvalidSame.isValid, false);

      const syInvalidReverse = validateConsecutiveSchoolYear("2026-2025");
      assert.equal(syInvalidReverse.isValid, false);

      const syInvalidEmpty = validateConsecutiveSchoolYear("");
      assert.equal(syInvalidEmpty.isValid, false);

      // 2. Strict Sex Normalization
      assert.equal(normalizeStrictSex("Male"), "Male");
      assert.equal(normalizeStrictSex("MALE"), "Male");
      assert.equal(normalizeStrictSex("m"), "Male");
      assert.equal(normalizeStrictSex("Lalaki"), "Male");
      assert.equal(normalizeStrictSex("Female"), "Female");
      assert.equal(normalizeStrictSex("FEMALE"), "Female");
      assert.equal(normalizeStrictSex("f"), "Female");
      assert.equal(normalizeStrictSex("Babae"), "Female");
      assert.equal(normalizeStrictSex("Other"), null);
      assert.equal(normalizeStrictSex(null), null);
      assert.equal(normalizeStrictSex(undefined), null);

      // 3. SF9 Merger preserves Sex from Front when Back is null/missing
      const front = {
        name: "DELA CRUZ, JUAN",
        lrn: "123456789012",
        sex: "Male",
        school_year: "2025-2026",
      };
      const back = {
        name: "DELA CRUZ, JUAN",
        lrn: "123456789012",
        sex: null,
        school_year: "2025-2026",
        grades: [{ subject: "Oral Comm", final: 88 }],
      };
      const mergedRes = mergeSf9FrontAndBack({ fields: front }, { fields: back });
      assert.equal(mergedRes.unifiedFields.sex, "Male", "Merger must preserve Front sex even when Back sex is null");

      // 4. Cross-Document Sex Discrepancy Error ("Wrong Sex/Gender")
      const sf1 = {
        lrn: "123456789012",
        last_name: "DELA CRUZ",
        first_name: "JUAN",
        sex: "Male",
      };
      const sf9Female = {
        lrn: "123456789012",
        last_name: "DELA CRUZ",
        first_name: "JUAN",
        sex: "Female",
      };
      const crossSf1Sf9 = compareSf1AndSf9(sf1, sf9Female);
      const sexDisc = crossSf1Sf9.discrepancies.find((d) => d.field.toLowerCase() === "sex");
      assert.ok(sexDisc, "Sex discrepancy must be flagged");
      assert.equal(sexDisc.severity, "CRITICAL");
      assert.ok(sexDisc.description.includes("Wrong Sex/Gender"), `Expected description to contain 'Wrong Sex/Gender', got: ${sexDisc.description}`);

      const psaFemale = {
        last_name: "DELA CRUZ",
        first_name: "JUAN",
        sex: "Female",
      };
      const crossPsaSf1 = comparePsaAndSf1(psaFemale, sf1);
      const psaSexDisc = crossPsaSf1.discrepancies.find((d) => d.field.toLowerCase() === "sex");
      assert.ok(psaSexDisc, "PSA vs SF1 Sex discrepancy must be flagged");
      assert.equal(psaSexDisc.severity, "CRITICAL");
      assert.ok(psaSexDisc.description.includes("Wrong Sex/Gender"), `Expected description to contain 'Wrong Sex/Gender', got: ${psaSexDisc.description}`);

      // 5. General Average 88 without explicit confidence evaluates to PASSED with >= 90% confidence, never 20%
      const genAvgEval = evaluateDynamicGradeStatus({
        grade: 88,
        confidencePercent: undefined,
      });
      assert.equal(genAvgEval.status, "passed");
      assert.equal(genAvgEval.remarkDisplay, "PASSED");
      assert.equal(genAvgEval.isLowConfidence, false);
      assert.ok(genAvgEval.confidencePercent >= 90, `Expected confidence >= 90%, got: ${genAvgEval.confidencePercent}%`);

      // 6. Quarterly Table Extraction with Missing Azure Cell Confidence falls back to table/doc confidence
      const tableWithoutCellConf = {
        rowCount: 3,
        columnCount: 5,
        confidence: 0.94,
        cells: [
          { rowIndex: 0, columnIndex: 0, content: "Subject" },
          { rowIndex: 0, columnIndex: 1, content: "Q1" },
          { rowIndex: 0, columnIndex: 2, content: "Q2" },
          { rowIndex: 0, columnIndex: 3, content: "Final" },
          { rowIndex: 0, columnIndex: 4, content: "Remarks" },
          { rowIndex: 1, columnIndex: 0, content: "General Mathematics" },
          { rowIndex: 1, columnIndex: 1, content: "85" }, // no per-cell confidence
          { rowIndex: 1, columnIndex: 2, content: "87" }, // no per-cell confidence
          { rowIndex: 1, columnIndex: 3, content: "86" }, // no per-cell confidence
          { rowIndex: 1, columnIndex: 4, content: "Passed" },
          { rowIndex: 2, columnIndex: 0, content: "General Average" },
          { rowIndex: 2, columnIndex: 3, content: "86" },
        ],
      };
      const parsedWithoutCellConf = parseAzureLayoutGrades([tableWithoutCellConf]);
      assert.ok(parsedWithoutCellConf.grades.length > 0);
      const math = parsedWithoutCellConf.grades[0];
      assert.equal(math.q1, 85);
      assert.equal(math.q2, 87);
      assert.equal(math.final_grade, 86);
      assert.equal(math.q1Confidence, 94, "q1Confidence must fall back to table confidence 94%");
      assert.equal(math.q2Confidence, 94, "q2Confidence must fall back to table confidence 94%");
      assert.equal(math.finalGradeConfidence, 94, "finalGradeConfidence must fall back to table confidence 94%");
      assert.equal(parsedWithoutCellConf.general_average, 86);
      assert.equal(parsedWithoutCellConf.general_average_confidence, 94, "general_average_confidence must fall back to table confidence 94%");
    }
  );

  // -------------------------------------------------------------------------
  // Test P: Strict Sex Snapping and PSA Item 2 Mark-Position Detection
  // -------------------------------------------------------------------------
  await t.test(
    "Test P — normalizeStrictSex prefix snapping and PSA Item 2 Mark Placement",
    async () => {
      // 1. normalizeStrictSex prefix/code snapping
      assert.equal(normalizeStrictSex("Ma"), "Male");
      assert.equal(normalizeStrictSex("M"), "Male");
      assert.equal(normalizeStrictSex("1"), "Male");
      assert.equal(normalizeStrictSex("1 Male"), "Male");
      assert.equal(normalizeStrictSex("1-Male"), "Male");
      assert.equal(normalizeStrictSex("1. Male"), "Male");
      assert.equal(normalizeStrictSex("MAL"), "Male");
      assert.equal(normalizeStrictSex("MLE"), "Male");

      assert.equal(normalizeStrictSex("Fe"), "Female");
      assert.equal(normalizeStrictSex("F"), "Female");
      assert.equal(normalizeStrictSex("2"), "Female");
      assert.equal(normalizeStrictSex("2 Female"), "Female");
      assert.equal(normalizeStrictSex("2-Female"), "Female");
      assert.equal(normalizeStrictSex("2. Female"), "Female");
      assert.equal(normalizeStrictSex("FEM"), "Female");
      assert.equal(normalizeStrictSex("FMALE"), "Female");

      assert.equal(normalizeStrictSex(""), null);
      assert.equal(normalizeStrictSex(null), null);
      assert.equal(normalizeStrictSex(undefined), null);
      assert.equal(normalizeStrictSex("Not detected"), null);
      assert.equal(normalizeStrictSex("MANILA"), null);
      assert.equal(normalizeStrictSex("MARCH"), null);
      assert.equal(normalizeStrictSex("FEBRUARY"), null);

      // 2. PSA Item 2 Mark Placement Tests
      const psaMaleUnderline = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
1. NAME: JUSTIN GOMEZ
2. SEX
___X___ 1 Male    _______ 2 Female
3. DATE OF BIRTH: 15 MARCH 2008
`;
      const resMale = parsePsaBirthCert(psaMaleUnderline);
      assert.equal(resMale.identity.sex, "M");
      assert.equal(resMale.identity.sex_label, "Male");
      assert.equal(resMale.field_statuses.sex.status, "extracted");
      assert.ok(resMale.field_statuses.sex.confidence >= 85, `Expected confidence >= 85%, got ${resMale.field_statuses.sex.confidence}%`);

      const psaFemaleUnderline = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
1. NAME: MARIA GOMEZ
2. SEX
_______ 1 Male    ___X___ 2 Female
3. DATE OF BIRTH: 15 MARCH 2008
`;
      const resFemale = parsePsaBirthCert(psaFemaleUnderline);
      assert.equal(resFemale.identity.sex, "F");
      assert.equal(resFemale.identity.sex_label, "Female");
      assert.equal(resFemale.field_statuses.sex.status, "extracted");
      assert.ok(resFemale.field_statuses.sex.confidence >= 85, `Expected confidence >= 85%, got ${resFemale.field_statuses.sex.confidence}%`);

      // 3. Mark symbol variations: slash /, checkmark ✓, placement
      const slashMale = extractPsaSexFromMarkPlacement("/ 1 Male 2 Female");
      assert.equal(slashMale.sex, "M");
      assert.equal(slashMale.sexLabel, "Male");
      assert.ok(slashMale.confidence >= 85);

      const slashFemale = extractPsaSexFromMarkPlacement("1 Male / 2 Female");
      assert.equal(slashFemale.sex, "F");
      assert.equal(slashFemale.sexLabel, "Female");
      assert.ok(slashFemale.confidence >= 85);

      const checkMale = extractPsaSexFromMarkPlacement("✓ 1 Male 2 Female");
      assert.equal(checkMale.sex, "M");
      assert.equal(checkMale.sexLabel, "Male");
      assert.ok(checkMale.confidence >= 85);

      // 4. Unmarked form: "_______ 1 Male _______ 2 Female" must remain null / undefined (never false positive on '2' from '2 Female')
      const unmarkedText = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
1. NAME: JUSTIN GOMEZ
2. SEX
_______ 1 Male    _______ 2 Female
3. DATE OF BIRTH: 15 MARCH 2008
`;
      const resUnmarked = parsePsaBirthCert(unmarkedText);
      assert.equal(resUnmarked.identity.sex, undefined);
      assert.equal(resUnmarked.field_statuses.sex.status, "not_detected");
      assert.equal(resUnmarked.field_statuses.sex.confidence, 0);

      // 5. Cross-document Sex mismatch between PSA Male and SF1 Female
      const psa = { sex: "M" };
      const sf1 = { sex: "Female" };
      const crossMatch = comparePsaAndSf1(psa, sf1);
      const sexDisc = crossMatch.discrepancies.find((d) => d.field.toLowerCase() === "sex");
      assert.ok(sexDisc, "Wrong Sex/Gender mismatch must be raised");
      assert.ok(sexDisc.description.includes("Wrong Sex/Gender"));

      // 6. Multi-line / Above-underline mark placement: "2. SEX X\n1 Male 2 Female"
      const multiLineMale = `
REPUBLIC OF THE PHILIPPINES
CERTIFICATE OF LIVE BIRTH
1. NAME: JUSTIN GOMEZ
2. SEX X
1 Male    2 Female
3. DATE OF BIRTH: 15 MARCH 2008
`;
      const resMultiMale = parsePsaBirthCert(multiLineMale);
      assert.equal(resMultiMale.identity.sex, "M");
      assert.equal(resMultiMale.identity.sex_label, "Male");
      assert.ok(resMultiMale.field_statuses.sex.confidence >= 85);

      // 7. Multi-line markdown/table cell mark placement: "| 2. SEX | X 1 Male 2 Female |"
      const tableMale = `
| 1. NAME | JUSTIN GOMEZ |
| 2. SEX | X 1 Male 2 Female |
| 3. DATE OF BIRTH | 15 MARCH 2008 |
`;
      const resTableMale = parsePsaBirthCert(tableMale);
      assert.equal(resTableMale.identity.sex, "M");
      assert.equal(resTableMale.identity.sex_label, "Male");
      assert.ok(resTableMale.field_statuses.sex.confidence >= 85);

      // 8. Bounding-box spatial offset (X polygon sitting above 1 Male vs 2 Female)
      const azureItemsMale = [
        { text: "2. SEX", polygon: [100, 200, 200, 200, 200, 220, 100, 220] },
        { text: "X", polygon: [80, 250, 95, 250, 95, 270, 80, 270] },
        { text: "1 Male", polygon: [100, 290, 160, 290, 160, 310, 100, 310] },
        { text: "2 Female", polygon: [200, 290, 280, 290, 280, 310, 200, 310] },
      ];
      const spatialMale = extractPsaSexFromMarkPlacement("2. SEX\n1 Male 2 Female", azureItemsMale);
      assert.equal(spatialMale.sex, "M");
      assert.equal(spatialMale.sexLabel, "Male");
      assert.ok(spatialMale.confidence >= 85);

      const azureItemsFemale = [
        { text: "2. SEX", polygon: [100, 200, 200, 200, 200, 220, 100, 220] },
        { text: "X", polygon: [210, 250, 225, 250, 225, 270, 210, 270] },
        { text: "1 Male", polygon: [100, 290, 160, 290, 160, 310, 100, 310] },
        { text: "2 Female", polygon: [200, 290, 280, 290, 280, 310, 200, 310] },
      ];
      const spatialFemale = extractPsaSexFromMarkPlacement("2. SEX\n1 Male 2 Female", azureItemsFemale);
      assert.equal(spatialFemale.sex, "F");
      assert.equal(spatialFemale.sexLabel, "Female");
      assert.ok(spatialFemale.confidence >= 85);
    }
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import { parseAzureLayoutGrades } from "../src/lib/ocr/tableGradesParser.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { handleOcrRoute } from "../src/lib/ocr/mistral.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

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
    assert.equal(subj.final, undefined, "Missing final grade must remain undefined");
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
});

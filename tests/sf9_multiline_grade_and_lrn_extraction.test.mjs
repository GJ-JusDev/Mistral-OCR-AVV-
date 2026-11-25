import test from "node:test";
import assert from "node:assert/strict";

import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { parseOcrText } from "../src/lib/ocr/parser.ts";
import { AzureDocumentIntelligenceProvider } from "../src/lib/ocr/providers/azureProvider.ts";

test("AVV SF9 Multiline Grade, Attendance, and LRN Extraction Suite", async (t) => {
  // -------------------------------------------------------------------------
  // Test 1: Standalone LRN on newline following label
  // -------------------------------------------------------------------------
  await t.test("Test 1 — Standalone LRN on newline is parsed accurately", () => {
    const textA = `
      Republic of the Philippines
      Department of Education
      REPORT CARD (SF9-SHS)
      Learner Reference Number (LRN)
      111304581972
      Name: GOMEZ, JUSTIN L.
    `;
    const parsedA = parseOcrText(textA);
    assert.equal(parsedA.lrn, "111304581972", "LRN on line below label should be extracted");

    const textB = `
      LRN:
      111304581972
    `;
    const parsedB = parseOcrText(textB);
    assert.equal(parsedB.lrn, "111304581972", "LRN after colon on newline should be extracted");
  });

  // -------------------------------------------------------------------------
  // Test 2: Stacked 3-line name layout above bare labels (Gomez pattern)
  // -------------------------------------------------------------------------
  await t.test("Test 2 — Stacked 3-line name above bare labels extracts last, first, middle", () => {
    const text = `
      Department of Education
      Division of Batangas
      SF9-SHS

      GOMEZ
      JUSTIN
      LOQUILLANO
      Last Name
      First Name
      Middle Name

      LRN: 111304581972
      Grade 11 Section Rizal
    `;
    const parsed = parseOcrText(text);
    assert.equal(parsed.last_name, "GOMEZ", "Last name should be GOMEZ");
    assert.equal(parsed.first_name, "JUSTIN", "First name should be JUSTIN");
    assert.equal(parsed.middle_name, "LOQUILLANO", "Middle name should be LOQUILLANO");
    assert.equal(parsed.name, "GOMEZ, JUSTIN LOQUILLANO", "Full name should be correctly formatted");
  });

  // -------------------------------------------------------------------------
  // Test 3: Multiline plain OCR grades without markdown pipes (Azure fallback)
  // -------------------------------------------------------------------------
  await t.test("Test 3 — Multiline plain OCR grades extract across Semesters 1 and 2", () => {
    const plainText = `
      REPORT ON LEARNING PROGRESS AND ACHIEVEMENT
      First Semester
      Core Subjects
      Oral Communication in Context
      88
      89
      89
      Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino
      85
      87
      86
      General Mathematics
      90
      92
      91
      Applied and Specialized Subjects
      Empowerment Technologies
      84
      86
      85

      Second Semester
      Core Subjects
      Reading and Writing Skills
      89
      91
      90
      Statistics and Probability
      86
      88
      87
      Physical Science
      85
      87
      86
      Applied and Specialized Subjects
      Practical Research 1
      88
      90
      89
    `;

    const parsed = parseSeniorHighGradesText(plainText);
    assert.ok(Array.isArray(parsed.grades), "Grades must be an array");
    assert.equal(parsed.grades.length, 8, "Expected 8 total subject grades across both semesters");

    // Verify Semester 1 subject
    const oralComm = parsed.grades.find(g => g.subject.includes("Oral Communication"));
    assert.ok(oralComm, "Oral Communication should be extracted");
    assert.equal(oralComm.semester, "1st Semester");
    assert.equal(oralComm.q1, 88);
    assert.equal(oralComm.q2, 89);
    assert.equal(oralComm.sem1_final_grade, 89);
    assert.equal(oralComm.q3, undefined, "Sem 1 must NOT have q3");
    assert.equal(oralComm.q4, undefined, "Sem 1 must NOT have q4");
    assert.equal(oralComm.status, "Passed");

    // Verify Semester 2 subject
    const readWrite = parsed.grades.find(g => g.subject.includes("Reading and Writing"));
    assert.ok(readWrite, "Reading and Writing should be extracted");
    assert.equal(readWrite.semester, "2nd Semester");
    assert.equal(readWrite.q3, 89);
    assert.equal(readWrite.q4, 91);
    assert.equal(readWrite.sem2_final_grade, 90);
    assert.equal(readWrite.q1, undefined, "Sem 2 must NOT have q1");
    assert.equal(readWrite.q2, undefined, "Sem 2 must NOT have q2");
    assert.equal(readWrite.status, "Passed");
  });

  // -------------------------------------------------------------------------
  // Test 4: Non-numeric marks (INC and DRP) in multiline plain OCR
  // -------------------------------------------------------------------------
  await t.test("Test 4 — Non-numeric marks (INC, DRP) are preserved with status Missing", () => {
    const plainText = `
      First Semester
      Core Subjects
      Philosophy of the Human Person
      INC
      Second Semester
      Applied Subjects
      Inquiries, Investigations, and Immersion
      DRP
    `;

    const parsed = parseSeniorHighGradesText(plainText);
    const incSubj = parsed.grades?.find(g => g.subject.includes("Philosophy"));
    assert.ok(incSubj, "Philosophy should be extracted");
    assert.equal(incSubj.final, "INC");
    assert.equal(incSubj.status, "Missing");
    assert.equal(incSubj.needsVerification, true);

    const drpSubj = parsed.grades?.find(g => g.subject.includes("Inquiries"));
    assert.ok(drpSubj, "Inquiries should be extracted");
    assert.equal(drpSubj.final, "DRP");
    assert.equal(drpSubj.status, "Missing");
    assert.equal(drpSubj.needsVerification, true);
  });

  // -------------------------------------------------------------------------
  // Test 5: Multiline Attendance table with equation validation
  // -------------------------------------------------------------------------
  await t.test("Test 5 — Multiline Attendance table satisfies Present + Absent = School Days", () => {
    const attendanceText = `
      REPORT ON ATTENDANCE
      Jun Jul Aug Sept Oct Nov Dec Jan Feb Mar Apr Total
      No. of school days
      20 22 21 20 21 15 16 20 20 21 18 214
      No. of days present
      19 21 20 19 20 15 16 19 19 20 17 205
      No. of days absent
      1 1 1 1 1 0 0 1 1 1 1 9
    `;

    const parsed = parseSeniorHighGradesText(attendanceText);
    assert.ok(parsed.attendance, "Attendance array should be populated");
    assert.equal(parsed.attendance.length, 3, "Should have 3 attendance rows");

    assert.ok(parsed.attendance_totals, "Attendance totals should be computed");
    const totals = parsed.attendance_totals;
    assert.equal(totals.computed_school_days, 214);
    assert.equal(totals.computed_days_present, 205);
    assert.equal(totals.computed_days_absent, 9);
    assert.equal(
      totals.computed_days_present + totals.computed_days_absent,
      totals.computed_school_days,
      "Present + Absent must equal School Days"
    );
  });

  // -------------------------------------------------------------------------
  // Test 6: DepEd Core Values are isolated from Academic Grades
  // -------------------------------------------------------------------------
  await t.test("Test 6 — Observed Core Values do NOT contaminate Academic Grades", () => {
    const mixedText = `
      REPORT ON LEARNER'S OBSERVED VALUES
      Core Values
      Behavior Statements
      Quarter 1 2 3 4
      Maka-Diyos
      Expresses one's spiritual beliefs
      AO AO AO AO
      Makatao
      Shows respect for all
      SO SO SO SO
      REPORT ON LEARNING PROGRESS AND ACHIEVEMENT
      First Semester
      Core Subjects
      Earth and Life Science
      87
      89
      88
    `;

    const parsed = parseSeniorHighGradesText(mixedText);
    assert.equal(parsed.grades?.length, 1, "Only academic subject should be extracted as grade");
    assert.equal(parsed.grades?.[0].subject, "Earth and Life Science");

    // Observed values must be parsed separately
    assert.ok(parsed.observed_values, "Observed values should be populated");
    const makaDiyos = parsed.observed_values.core_values?.find(v => v.name.toLowerCase().includes("maka-diyos"));
    assert.ok(makaDiyos, "Maka-Diyos observed value should be extracted");
  });

  // -------------------------------------------------------------------------
  // Test 7: Azure Document Intelligence model selection uses prebuilt-layout for SF9
  // -------------------------------------------------------------------------
  await t.test("Test 7 — Azure provider selects prebuilt-layout for sf9 document type", async () => {
    const originalEnv = { ...process.env };
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL;
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://avv-document-ocr.cognitiveservices.azure.com/";
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "mock-key";

    const originalFetch = globalThis.fetch;
    const requestedUrls = [];
    try {
      globalThis.fetch = async (url, options) => {
        requestedUrls.push(String(url));
        if (options?.method === "GET") {
          return new Response(
            JSON.stringify({
              status: "succeeded",
              analyzeResult: {
                content: "Sample content",
                pages: [{ pageNumber: 1, words: [{ content: "Sample", confidence: 0.99 }] }],
                tables: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(null, {
          status: 202,
          headers: {
            "Operation-Location": "https://avv-document-ocr.cognitiveservices.azure.com/operations/op-1",
          },
        });
      };

      const provider = new AzureDocumentIntelligenceProvider();
      const fakeImage = "data:image/png;base64," + Buffer.from("fake-png-data").toString("base64");

      // Test SF9
      await provider.recognize({ image: fakeImage, documentType: "sf9" });
      assert.ok(
        requestedUrls.some(u => u.includes("documentModels/prebuilt-layout:analyze")),
        "SF9 should request prebuilt-layout model"
      );

      // Test SF10
      requestedUrls.length = 0;
      await provider.recognize({ image: fakeImage, documentType: "sf10" });
      assert.ok(
        requestedUrls.some(u => u.includes("documentModels/prebuilt-layout:analyze")),
        "SF10 should request prebuilt-layout model"
      );

      // Test default without docType
      requestedUrls.length = 0;
      await provider.recognize({ image: fakeImage });
      assert.ok(
        requestedUrls.some(u => u.includes("documentModels/prebuilt-read:analyze")),
        "Default without docType should request prebuilt-read model"
      );
    } finally {
      process.env = { ...originalEnv };
      globalThis.fetch = originalFetch;
    }
  });
});

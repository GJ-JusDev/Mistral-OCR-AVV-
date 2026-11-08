import test from "node:test";
import assert from "node:assert/strict";

import { extractSpatialIdentity } from "../src/lib/ocr/spatialIdentityParser.ts";
import { parseOcrText } from "../src/lib/ocr/parser.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";
import { handleOcrRoute } from "../src/lib/ocr/mistral.ts";

/**
 * Helper to build an 8-point polygon [x1, y1, x2, y2, x3, y3, x4, y4]
 * from normalized [0, 1] bounds and page width/height.
 */
function makePolygon(normX, normY, normW, normH, pageWidth = 1000, pageHeight = 1500) {
  const x1 = normX * pageWidth;
  const y1 = normY * pageHeight;
  const x2 = (normX + normW) * pageWidth;
  const y2 = y1;
  const x3 = x2;
  const y3 = (normY + normH) * pageHeight;
  const x4 = x1;
  const y4 = y3;
  return [x1, y1, x2, y2, x3, y3, x4, y4];
}

test("SF9 Spatial Identity Mapping Suite — Name Band & Anti-Contamination", async (t) => {
  const originalEnv = { ...process.env };

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  await t.test("Test A — School Header Contamination: Excludes school header words above local name row", () => {
    // School header at Y ≈ 0.25 (higher region)
    // Name anchor at Y ≈ 0.345
    // Learner names at Y ≈ 0.342
    // Printed labels at Y ≈ 0.368
    const pageWidth = 1000;
    const pageHeight = 1500;

    const rawLayout = {
      pages: [
        {
          pageNumber: 1,
          width: pageWidth,
          height: pageHeight,
          words: [
            // School header words in higher Y region
            { content: "DEPED", polygon: makePolygon(0.58, 0.25, 0.05, 0.015) },
            { content: "CENTRAL", polygon: makePolygon(0.64, 0.25, 0.06, 0.015) },
            { content: "HIGH", polygon: makePolygon(0.72, 0.25, 0.05, 0.015) },
            { content: "SCHOOL", polygon: makePolygon(0.79, 0.25, 0.06, 0.015) },
            { content: "School", polygon: makePolygon(0.71, 0.27, 0.04, 0.015) },

            // Name: label anchor
            { content: "Name:", polygon: makePolygon(0.53, 0.345, 0.04, 0.018) },

            // Local handwritten learner name row
            { content: "GARCIA", polygon: makePolygon(0.59, 0.342, 0.06, 0.02) },
            { content: "MARIA", polygon: makePolygon(0.71, 0.342, 0.06, 0.02) },
            { content: "CLARA", polygon: makePolygon(0.84, 0.342, 0.06, 0.02) },

            // Printed labels directly underneath
            { content: "Last", polygon: makePolygon(0.59, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.63, 0.368, 0.03, 0.015) },
            { content: "First", polygon: makePolygon(0.71, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.75, 0.368, 0.03, 0.015) },
            { content: "Middle", polygon: makePolygon(0.84, 0.368, 0.04, 0.015) },
            { content: "Name", polygon: makePolygon(0.89, 0.368, 0.03, 0.015) },
          ],
        },
      ],
    };

    const spatial = extractSpatialIdentity(rawLayout);

    assert.equal(spatial.last_name, "GARCIA", "Last name must strictly be GARCIA without school words");
    assert.equal(spatial.first_name, "MARIA", "First name must strictly be MARIA without school words");
    assert.equal(spatial.middle_name, "CLARA", "Middle name must strictly be CLARA without school words");
    assert.equal(spatial.name, "GARCIA, MARIA CLARA");
  });

  await t.test("Test B — Multi-Word School Name: Synthetic school words across all 3 columns are rejected", () => {
    // School words spanning across left, center, right columns at Y ≈ 0.25
    const pageWidth = 1000;
    const pageHeight = 1500;

    const rawLayout = {
      pages: [
        {
          pageNumber: 1,
          width: pageWidth,
          height: pageHeight,
          words: [
            // School name words in Col 1, Col 2, Col 3
            { content: "QUEZON", polygon: makePolygon(0.60, 0.25, 0.06, 0.02) },
            { content: "NATIONAL", polygon: makePolygon(0.72, 0.25, 0.07, 0.02) },
            { content: "ACADEMY", polygon: makePolygon(0.85, 0.25, 0.07, 0.02) },

            // Name: label anchor
            { content: "Name:", polygon: makePolygon(0.53, 0.345, 0.04, 0.018) },

            // Local handwritten learner name row
            { content: "DELA", polygon: makePolygon(0.58, 0.342, 0.04, 0.02) },
            { content: "ROSA", polygon: makePolygon(0.63, 0.342, 0.04, 0.02) },
            { content: "JOSE", polygon: makePolygon(0.72, 0.342, 0.05, 0.02) },
            { content: "RIZAL", polygon: makePolygon(0.85, 0.342, 0.06, 0.02) },

            // Printed labels
            { content: "Last", polygon: makePolygon(0.59, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.63, 0.368, 0.03, 0.015) },
            { content: "First", polygon: makePolygon(0.71, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.75, 0.368, 0.03, 0.015) },
            { content: "Middle", polygon: makePolygon(0.84, 0.368, 0.04, 0.015) },
            { content: "Name", polygon: makePolygon(0.89, 0.368, 0.03, 0.015) },
          ],
        },
      ],
    };

    const spatial = extractSpatialIdentity(rawLayout);

    assert.equal(spatial.last_name, "DELA ROSA");
    assert.equal(spatial.first_name, "JOSE");
    assert.equal(spatial.middle_name, "RIZAL");
    assert.equal(spatial.name, "DELA ROSA, JOSE RIZAL");
  });

  await t.test("Test C — Multi-Word Learner Name: Legitimate two-word first name in local row is preserved", () => {
    const pageWidth = 1000;
    const pageHeight = 1500;

    const rawLayout = {
      pages: [
        {
          pageNumber: 1,
          width: pageWidth,
          height: pageHeight,
          words: [
            // Name: anchor
            { content: "Name:", polygon: makePolygon(0.53, 0.345, 0.04, 0.018) },

            // Local handwritten name: Last Name has 2 words, First Name has 2 words
            { content: "DELA", polygon: makePolygon(0.58, 0.342, 0.04, 0.02) },
            { content: "CRUZ", polygon: makePolygon(0.63, 0.342, 0.04, 0.02) },
            { content: "JUAN", polygon: makePolygon(0.70, 0.342, 0.04, 0.02) },
            { content: "MIGUEL", polygon: makePolygon(0.75, 0.342, 0.05, 0.02) },
            { content: "SANTOS", polygon: makePolygon(0.85, 0.342, 0.06, 0.02) },

            // Printed labels
            { content: "Last", polygon: makePolygon(0.59, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.63, 0.368, 0.03, 0.015) },
            { content: "First", polygon: makePolygon(0.71, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.75, 0.368, 0.03, 0.015) },
            { content: "Middle", polygon: makePolygon(0.84, 0.368, 0.04, 0.015) },
            { content: "Name", polygon: makePolygon(0.89, 0.368, 0.03, 0.015) },
          ],
        },
      ],
    };

    const spatial = extractSpatialIdentity(rawLayout);

    assert.equal(spatial.last_name, "DELA CRUZ", "Must preserve multi-word last name");
    assert.equal(spatial.first_name, "JUAN MIGUEL", "Must preserve both words of first name");
    assert.equal(spatial.middle_name, "SANTOS");
    assert.equal(spatial.name, "DELA CRUZ, JUAN MIGUEL SANTOS");
  });

  await t.test("Test D — Scrambled Azure Word Order: 2D geometry resolves mapping regardless of array order", () => {
    const pageWidth = 1000;
    const pageHeight = 1500;

    const words = [
      { content: "Name", polygon: makePolygon(0.89, 0.368, 0.03, 0.015) },
      { content: "MIGUEL", polygon: makePolygon(0.75, 0.342, 0.05, 0.02) },
      { content: "SANTOS", polygon: makePolygon(0.85, 0.342, 0.06, 0.02) },
      { content: "Middle", polygon: makePolygon(0.84, 0.368, 0.04, 0.015) },
      { content: "Name:", polygon: makePolygon(0.53, 0.345, 0.04, 0.018) },
      { content: "First", polygon: makePolygon(0.71, 0.368, 0.03, 0.015) },
      { content: "CRUZ", polygon: makePolygon(0.63, 0.342, 0.04, 0.02) },
      { content: "Last", polygon: makePolygon(0.59, 0.368, 0.03, 0.015) },
      { content: "JUAN", polygon: makePolygon(0.70, 0.342, 0.04, 0.02) },
      { content: "Name", polygon: makePolygon(0.75, 0.368, 0.03, 0.015) },
      { content: "DELA", polygon: makePolygon(0.58, 0.342, 0.04, 0.02) },
      { content: "Name", polygon: makePolygon(0.63, 0.368, 0.03, 0.015) },
    ];

    const rawLayout = {
      pages: [{ pageNumber: 1, width: pageWidth, height: pageHeight, words }],
    };

    const spatial = extractSpatialIdentity(rawLayout);

    assert.equal(spatial.last_name, "DELA CRUZ");
    assert.equal(spatial.first_name, "JUAN MIGUEL");
    assert.equal(spatial.middle_name, "SANTOS");
    assert.equal(spatial.name, "DELA CRUZ, JUAN MIGUEL SANTOS");
  });

  await t.test("Test E — Missing Middle Name: Leaves middle name undefined, NEVER guesses or borrows", () => {
    const pageWidth = 1000;
    const pageHeight = 1500;

    const rawLayout = {
      pages: [
        {
          pageNumber: 1,
          width: pageWidth,
          height: pageHeight,
          words: [
            { content: "Name:", polygon: makePolygon(0.53, 0.345, 0.04, 0.018) },
            { content: "AQUINO", polygon: makePolygon(0.59, 0.342, 0.06, 0.02) },
            { content: "CORAZON", polygon: makePolygon(0.71, 0.342, 0.07, 0.02) },
            // NO words in middle column
            { content: "Last", polygon: makePolygon(0.59, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.63, 0.368, 0.03, 0.015) },
            { content: "First", polygon: makePolygon(0.71, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.75, 0.368, 0.03, 0.015) },
            { content: "Middle", polygon: makePolygon(0.84, 0.368, 0.04, 0.015) },
            { content: "Name", polygon: makePolygon(0.89, 0.368, 0.03, 0.015) },
          ],
        },
      ],
    };

    const spatial = extractSpatialIdentity(rawLayout);

    assert.equal(spatial.last_name, "AQUINO");
    assert.equal(spatial.first_name, "CORAZON");
    assert.equal(spatial.middle_name, undefined, "Missing middle name must remain undefined");
    assert.equal(spatial.name, "AQUINO, CORAZON");
  });

  await t.test("Test F — School Position Shift: School words positioned closer (Y ≈ 0.29) remain excluded", () => {
    // School words shifted downwards to Y ≈ 0.29, but outside local name band (which starts at Y ≈ 0.32)
    const pageWidth = 1000;
    const pageHeight = 1500;

    const rawLayout = {
      pages: [
        {
          pageNumber: 1,
          width: pageWidth,
          height: pageHeight,
          words: [
            // Shifted school header
            { content: "METRO", polygon: makePolygon(0.60, 0.29, 0.06, 0.018) },
            { content: "MANILA", polygon: makePolygon(0.72, 0.29, 0.06, 0.018) },
            { content: "COLLEGE", polygon: makePolygon(0.85, 0.29, 0.07, 0.018) },

            // Name: anchor
            { content: "Name:", polygon: makePolygon(0.53, 0.345, 0.04, 0.018) },

            // Local handwritten row
            { content: "TAN", polygon: makePolygon(0.60, 0.342, 0.04, 0.02) },
            { content: "LUCAS", polygon: makePolygon(0.72, 0.342, 0.05, 0.02) },
            { content: "CHUA", polygon: makePolygon(0.85, 0.342, 0.05, 0.02) },

            // Printed labels
            { content: "Last", polygon: makePolygon(0.59, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.63, 0.368, 0.03, 0.015) },
            { content: "First", polygon: makePolygon(0.71, 0.368, 0.03, 0.015) },
            { content: "Name", polygon: makePolygon(0.75, 0.368, 0.03, 0.015) },
            { content: "Middle", polygon: makePolygon(0.84, 0.368, 0.04, 0.015) },
            { content: "Name", polygon: makePolygon(0.89, 0.368, 0.03, 0.015) },
          ],
        },
      ],
    };

    const spatial = extractSpatialIdentity(rawLayout);

    assert.equal(spatial.last_name, "TAN", "TAN must not be contaminated by METRO");
    assert.equal(spatial.first_name, "LUCAS", "LUCAS must not be contaminated by MANILA");
    assert.equal(spatial.middle_name, "CHUA", "CHUA must not be contaminated by COLLEGE");
    assert.equal(spatial.name, "TAN, LUCAS CHUA");
  });

  await t.test("Test G — Confidence Semantics: Distinguishes provider avg. word confidence from field correctness", async () => {
    // When Azure Document Intelligence returns confidence: 0.99
    // It represents provider-level word confidence across the document, NOT field correctness.
    const mockResult = {
      text: "REPORT ON ATTENDANCE\nName: GOMEZ JUSTIN LOQUILLAND",
      confidence: 0.99,
      model: "azure/prebuilt-read",
      provider: "azure",
      rawLayout: {
        pages: [
          {
            pageNumber: 1,
            width: 1000,
            height: 1500,
            words: [
              { content: "Name:", polygon: makePolygon(0.53, 0.345, 0.04, 0.018), confidence: 0.99 },
              { content: "GOMEZ", polygon: makePolygon(0.60, 0.342, 0.05, 0.02), confidence: 0.99 },
              { content: "JUSTIN", polygon: makePolygon(0.72, 0.342, 0.06, 0.02), confidence: 0.99 },
              { content: "Last", polygon: makePolygon(0.59, 0.368, 0.03, 0.015), confidence: 0.99 },
              { content: "Name", polygon: makePolygon(0.63, 0.368, 0.03, 0.015), confidence: 0.99 },
              { content: "First", polygon: makePolygon(0.71, 0.368, 0.03, 0.015), confidence: 0.99 },
              { content: "Name", polygon: makePolygon(0.75, 0.368, 0.03, 0.015), confidence: 0.99 },
            ],
          },
        ],
      },
    };

    process.env.OCR_PRIMARY_PROVIDER = "azure";

    const req = new Request("http://localhost:3000/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        extractFields: true,
        gradeLevel: "Senior High School",
      }),
    });

    const { OcrOrchestrator } = await import("../src/lib/ocr/providers/orchestrator.ts");
    const origExecute = OcrOrchestrator.prototype.execute;
    OcrOrchestrator.prototype.execute = async () => mockResult;

    try {
      const response = await handleOcrRoute(req, "dummy-key", parseGradesText);
      const data = await response.json();

      assert.equal(data.provider, "azure");
      assert.equal(data.confidence, 0.99, "Document-wide average word confidence is preserved");
      assert.equal(data.fields.ocr_provider, "azure");
      assert.equal(data.fields.ocr_confidence, 0.99);

      // Verify that OcrResultCard would describe this as Azure OCR Avg. Word Confidence: 99%
      // and NOT 99% field correctness
      assert.equal(data.fields.last_name, "GOMEZ");
      assert.equal(data.fields.first_name, "JUSTIN");
    } finally {
      OcrOrchestrator.prototype.execute = origExecute;
    }
  });

  await t.test("Identity Header Metadata: Correctly extracts LRN, Age, and Sex spatially", () => {
    const pageWidth = 1000;
    const pageHeight = 1500;

    const rawLayout = {
      pages: [
        {
          pageNumber: 1,
          width: pageWidth,
          height: pageHeight,
          words: [
            { content: "LRN:", polygon: makePolygon(0.10, 0.12, 0.05, 0.02) },
            { content: "109876543210", polygon: makePolygon(0.17, 0.12, 0.12, 0.02) },
            { content: "Sex:", polygon: makePolygon(0.40, 0.12, 0.04, 0.02) },
            { content: "Female", polygon: makePolygon(0.46, 0.12, 0.06, 0.02) },
            { content: "Age:", polygon: makePolygon(0.60, 0.12, 0.04, 0.02) },
            { content: "17", polygon: makePolygon(0.66, 0.12, 0.03, 0.02) },
            { content: "SY", polygon: makePolygon(0.75, 0.12, 0.03, 0.02) },
            { content: "2024-2025", polygon: makePolygon(0.80, 0.12, 0.08, 0.02) },
          ],
        },
      ],
    };

    const spatial = extractSpatialIdentity(rawLayout);

    assert.equal(spatial.lrn, "109876543210");
    assert.equal(spatial.sex, "Female");
    assert.equal(spatial.age, "17");
    assert.equal(spatial.school_year, "2024-2025");
  });

  await t.test("Fallback when rawLayout is absent: Preserves existing regex/text extraction", () => {
    const ocrText = `
Name: REYES, CARLO MENDEZ
LRN: 123456789012
School Year: 2023-2024
Grade Level: 11
Track / Strand: TVL - ICT
    `;

    const fields = parseOcrText(ocrText);
    assert.equal(fields.name, "REYES, CARLO MENDEZ");
    assert.equal(fields.last_name, "REYES");
    assert.equal(fields.first_name, "CARLO");
    assert.equal(fields.middle_name, "MENDEZ");
    assert.equal(fields.lrn, "123456789012");
    assert.equal(fields.school_year, "2023-2024");
    assert.equal(fields.grade_level, "11");
  });
});

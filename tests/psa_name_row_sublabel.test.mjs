import test from "node:test";
import assert from "node:assert/strict";
import { parsePsaSpatialLayout, detectPsaItemAnchors, extractPersonNameFromRow } from "../src/lib/ocr/psaParser.ts";
import { compareDocuments } from "../src/lib/validation/documentComparator.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

function makePoly(x1, y1, x2, y2) {
  return [x1, y1, x2, y1, x2, y2, x1, y2];
}

// ----------------------------------------------------------------------------
// Test A, B, C, D: Anchor and Sub-Label Detection inside Item 1
// ----------------------------------------------------------------------------
test("Tests A, B, C, D: Item 1 NAME row and (First), (Middle), (Last) sub-labels detected", () => {
  const words = [
    { content: "1.", cleanText: "1", bbox: { minU: 0.05, maxU: 0.08, minV: 0.12, maxV: 0.14, centerU: 0.065, centerV: 0.13, width: 0.03, height: 0.02 } },
    { content: "NAME", cleanText: "name", bbox: { minU: 0.09, maxU: 0.15, minV: 0.12, maxV: 0.14, centerU: 0.12, centerV: 0.13, width: 0.06, height: 0.02 } },
    { content: "(First)", cleanText: "first", bbox: { minU: 0.18, maxU: 0.25, minV: 0.12, maxV: 0.14, centerU: 0.215, centerV: 0.13, width: 0.07, height: 0.02 } },
    { content: "(Middle)", cleanText: "middle", bbox: { minU: 0.44, maxU: 0.52, minV: 0.12, maxV: 0.14, centerU: 0.48, centerV: 0.13, width: 0.08, height: 0.02 } },
    { content: "(Last)", cleanText: "last", bbox: { minU: 0.70, maxU: 0.77, minV: 0.12, maxV: 0.14, centerU: 0.735, centerV: 0.13, width: 0.07, height: 0.02 } },
  ];

  const lines = [
    { content: "1. NAME (First) (Middle) (Last)", cleanText: "1 name first middle last", bbox: { minU: 0.05, maxU: 0.77, minV: 0.12, maxV: 0.14, centerU: 0.41, centerV: 0.13, width: 0.72, height: 0.02 } },
  ];

  const anchors = detectPsaItemAnchors(lines, words);
  // Test A: Item 1 Anchor detected
  assert.ok(anchors.has(1), "Item 1 Anchor must be detected");
  const anchor1 = anchors.get(1);
  assert.ok(anchor1);
  assert.equal(anchor1.itemNumber, 1);

  // Test B, C, D: Sub-labels detected inside row
  const nameResult = extractPersonNameFromRow(anchor1, [], words, lines, { minV: 0.10, maxV: 0.25 });
  assert.ok(nameResult.subLabelsFound.first, "First sub-label must be detected");
  assert.ok(nameResult.subLabelsFound.middle, "Middle sub-label must be detected");
  assert.ok(nameResult.subLabelsFound.last, "Last sub-label must be detected");
});

// ----------------------------------------------------------------------------
// Test E, F, G: Child First, Middle, Last map strictly to their sub-labels
// ----------------------------------------------------------------------------
test("Tests E, F, G: Child First, Middle, Last map strictly to respective sub-labels", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(50, 170, 80, 195) },
          { content: "NAME", polygon: makePoly(85, 170, 160, 195) },
          { content: "(First)", polygon: makePoly(180, 170, 250, 195) },
          { content: "(Middle)", polygon: makePoly(450, 170, 530, 195) },
          { content: "(Last)", polygon: makePoly(720, 170, 790, 195) },

          { content: "JUSTIN", polygon: makePoly(180, 210, 320, 240), confidence: 0.95 },
          { content: "MEJILLANO", polygon: makePoly(450, 210, 600, 240), confidence: 0.95 },
          { content: "LOQUILLANO", polygon: makePoly(720, 210, 870, 240), confidence: 0.95 },

          // Anchor 2 terminating row 1
          { content: "2.", polygon: makePoly(50, 270, 75, 295) },
          { content: "SEX", polygon: makePoly(80, 270, 130, 295) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  // Test E: First Name maps to First sub-label
  assert.equal(fields.first_name, "JUSTIN");
  // Test F: Middle Name maps to Middle sub-label
  assert.equal(fields.middle_name, "MEJILLANO");
  // Test G: Last Name maps to Last sub-label
  assert.equal(fields.last_name, "LOQUILLANO");
  assert.equal(fields.name, "LOQUILLANO, JUSTIN MEJILLANO");
});

// ----------------------------------------------------------------------------
// Test H: Visual order derived from sub-label coordinates (e.g. Last First Middle)
// ----------------------------------------------------------------------------
test("Test H: Name component order derived dynamically from sub-label coordinates", () => {
  // Reversal layout: [ (Last) at left ] [ (First) in middle ] [ (Middle) at right ]
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(50, 170, 80, 195) },
          { content: "NAME", polygon: makePoly(85, 170, 160, 195) },
          { content: "(Last)", polygon: makePoly(180, 170, 250, 195) },
          { content: "(First)", polygon: makePoly(450, 170, 530, 195) },
          { content: "(Middle)", polygon: makePoly(720, 170, 800, 195) },

          { content: "DELA CRUZ", polygon: makePoly(180, 210, 340, 240), confidence: 0.95 },
          { content: "JUAN", polygon: makePoly(450, 210, 550, 240), confidence: 0.95 },
          { content: "SANTOS", polygon: makePoly(720, 210, 850, 240), confidence: 0.95 },

          { content: "2.", polygon: makePoly(50, 270, 75, 295) },
          { content: "SEX", polygon: makePoly(80, 270, 130, 295) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.last_name, "DELA CRUZ");
  assert.equal(fields.first_name, "JUAN");
  assert.equal(fields.middle_name, "SANTOS");
  assert.equal(fields.name, "DELA CRUZ, JUAN SANTOS");
});

// ----------------------------------------------------------------------------
// Test I, J, K: Mother name row isolated, components mapped, 40 50 rejected
// ----------------------------------------------------------------------------
test("Tests I, J, K: Mother name row isolated, sub-labels mapped, and '40 50' rejected", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          // Item 6 Anchor and Sub-labels
          { content: "6.", polygon: makePoly(50, 520, 75, 545) },
          { content: "MAIDEN", polygon: makePoly(80, 520, 160, 545) },
          { content: "NAME", polygon: makePoly(165, 520, 230, 545) },
          { content: "(First)", polygon: makePoly(240, 520, 310, 545) },
          { content: "(Middle)", polygon: makePoly(480, 520, 560, 545) },
          { content: "(Last)", polygon: makePoly(720, 520, 790, 545) },

          // Mother Values
          { content: "JEANNE", polygon: makePoly(240, 560, 380, 590), confidence: 0.95 },
          { content: "MEJILLANO", polygon: makePoly(480, 560, 640, 590), confidence: 0.94 },
          { content: "LOQUILLANO", polygon: makePoly(720, 560, 890, 590), confidence: 0.96 },

          // Item 7 Anchor
          { content: "7.", polygon: makePoly(50, 620, 75, 645) },
          { content: "CITIZENSHIP", polygon: makePoly(80, 620, 200, 645) },

          // Item 9 & 11 with Numeric Contamination Traps
          { content: "9a.", polygon: makePoly(50, 680, 85, 705) },
          { content: "40", polygon: makePoly(180, 680, 220, 705) },
          { content: "50", polygon: makePoly(240, 680, 280, 705) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  // Test I & J: Mother row isolated and mapped
  assert.equal(fields.mother_first_name, "JEANNE");
  assert.equal(fields.mother_middle_name, "MEJILLANO");
  assert.equal(fields.mother_last_name, "LOQUILLANO");

  // Test K: Numeric 40 50 contamination rejected
  assert.ok(!fields.mother_name?.includes("40"), "Mother name must not contain 40");
  assert.ok(!fields.mother_name?.includes("50"), "Mother name must not contain 50");
  assert.equal(fields.mother_name, "LOQUILLANO, JEANNE MEJILLANO");
});

// ----------------------------------------------------------------------------
// Test L, M: Father row isolated and sub-labels mapped
// ----------------------------------------------------------------------------
test("Tests L, M: Father row isolated and First/Middle/Last correctly associated", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          // Item 13 Anchor and Sub-labels
          { content: "13.", polygon: makePoly(50, 830, 85, 855) },
          { content: "NAME", polygon: makePoly(90, 830, 155, 855) },
          { content: "(First)", polygon: makePoly(200, 830, 270, 855) },
          { content: "(Middle)", polygon: makePoly(450, 830, 530, 855) },
          { content: "(Last)", polygon: makePoly(700, 830, 770, 855) },

          // Father Values
          { content: "ROBERTO", polygon: makePoly(200, 865, 360, 895), confidence: 0.95 },
          { content: "CASTRO", polygon: makePoly(450, 865, 580, 895), confidence: 0.94 },
          { content: "LOQUILLANO", polygon: makePoly(700, 865, 880, 895), confidence: 0.96 },

          // Item 14 Anchor
          { content: "14.", polygon: makePoly(50, 920, 85, 945) },
          { content: "CITIZENSHIP", polygon: makePoly(90, 920, 200, 945) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  // Test L & M: Father row isolated and mapped
  assert.equal(fields.father_first_name, "ROBERTO");
  assert.equal(fields.father_middle_name, "CASTRO");
  assert.equal(fields.father_last_name, "LOQUILLANO");
  assert.equal(fields.father_name, "LOQUILLANO, ROBERTO CASTRO");
});

// ----------------------------------------------------------------------------
// Test N: M.D. professional suffix rejected from person name
// ----------------------------------------------------------------------------
test("Test N: M.D. professional suffix rejected from last name", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(50, 170, 80, 195) },
          { content: "NAME", polygon: makePoly(85, 170, 160, 195) },
          { content: "(Last)", polygon: makePoly(650, 170, 720, 195) },
          { content: "LOQUILLANO", polygon: makePoly(650, 210, 800, 240), confidence: 0.95 },
          { content: "M.D.", polygon: makePoly(820, 210, 880, 240), confidence: 0.92 },
          { content: "2.", polygon: makePoly(50, 270, 75, 295) },
          { content: "SEX", polygon: makePoly(80, 270, 130, 295) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.notEqual(fields.last_name, "M.D.");
  assert.equal(fields.last_name, "LOQUILLANO");
});

// ----------------------------------------------------------------------------
// Test O, P, Q: Item 4 terminates at Item 5, excludes '5a. TYPE OF BIRTH' and address labels
// ----------------------------------------------------------------------------
test("Tests O, P, Q: Item 4 ends at Item 5; excludes '5a. TYPE OF BIRTH' and address labels", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          // Item 4 Anchor
          { content: "4.", polygon: makePoly(50, 340, 75, 365) },
          { content: "PLACE", polygon: makePoly(80, 340, 140, 365) },
          { content: "OF", polygon: makePoly(145, 340, 170, 365) },
          { content: "BIRTH", polygon: makePoly(175, 340, 240, 365) },

          // Form address label traps
          { content: "House", polygon: makePoly(80, 370, 130, 390) },
          { content: "No.,", polygon: makePoly(135, 370, 170, 390) },
          { content: "Street,", polygon: makePoly(175, 370, 230, 390) },
          { content: "Barangay", polygon: makePoly(235, 370, 310, 390) },

          // Clean facility & city
          { content: "Manila", polygon: makePoly(80, 400, 160, 425), confidence: 0.95 },
          { content: "Doctors", polygon: makePoly(165, 400, 250, 425), confidence: 0.95 },
          { content: "Hospital", polygon: makePoly(255, 400, 350, 425), confidence: 0.95 },

          // Item 5 Anchor (Hard Boundary)
          { content: "5a.", polygon: makePoly(50, 440, 85, 465) },
          { content: "TYPE", polygon: makePoly(90, 440, 140, 465) },
          { content: "OF", polygon: makePoly(145, 440, 170, 465) },
          { content: "BIRTH", polygon: makePoly(175, 440, 240, 465) },
          { content: "Single", polygon: makePoly(250, 440, 320, 465) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  // Test O & P: Cannot contain 5a. or TYPE OF BIRTH
  assert.ok(!fields.birth_place?.includes("5a."), "Must not contain 5a.");
  assert.ok(!fields.birth_place?.includes("TYPE OF BIRTH"), "Must not contain TYPE OF BIRTH");
  assert.ok(!fields.birth_place?.includes("Single"), "Must not bleed into Single");

  // Test Q: Address labels excluded
  assert.ok(!fields.birth_place?.includes("House No."), "Must not contain House No.");
  assert.ok(!fields.birth_place?.includes("Barangay"), "Must not contain Barangay");
  assert.ok(fields.birth_place?.includes("Manila Doctors Hospital"));
});

// ----------------------------------------------------------------------------
// Test R: DOB component geometry works when Day/Month/Year are separate
// ----------------------------------------------------------------------------
test("Test R: DOB component geometry works when Azure splits Day, Month, Year", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "3.", polygon: makePoly(450, 270, 475, 295) },
          { content: "DATE", polygon: makePoly(480, 270, 530, 295) },
          { content: "OF", polygon: makePoly(535, 270, 560, 295) },
          { content: "BIRTH", polygon: makePoly(565, 270, 630, 295) },
          // Sub-cells:
          { content: "25", polygon: makePoly(650, 270, 680, 295), confidence: 0.95 },
          { content: "December", polygon: makePoly(690, 270, 770, 295), confidence: 0.96 },
          { content: "2006", polygon: makePoly(780, 270, 840, 295), confidence: 0.94 },
          // Anchor 4 below
          { content: "4.", polygon: makePoly(50, 340, 75, 365) },
          { content: "PLACE", polygon: makePoly(80, 340, 140, 365) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.birth_date, "25 December 2006");
  assert.equal(fields.field_metadata?.birth_date?.status, "extracted");
});

// ----------------------------------------------------------------------------
// Test S: Footer registration date cannot become DOB
// ----------------------------------------------------------------------------
test("Test S: Footer date cannot become child DOB", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          // Box 3 unreadable
          // Footer Box 21 Registration date (V in [0.85, 0.95])
          { content: "Registered", polygon: makePoly(200, 1200, 300, 1240) },
          { content: "15", polygon: makePoly(310, 1200, 350, 1240) },
          { content: "August", polygon: makePoly(360, 1200, 450, 1240) },
          { content: "2004", polygon: makePoly(460, 1200, 520, 1240) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.notEqual(fields.birth_date, "15 August 2004");
  assert.equal(fields.birth_date, undefined);
  assert.equal(fields.field_metadata?.birth_date?.needsVerification, true);
});

// ----------------------------------------------------------------------------
// Test T: Uncertain / blank values return Needs Verification
// ----------------------------------------------------------------------------
test("Test T: Uncertain or unextracted fields return Needs Verification", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(50, 170, 80, 195) },
          { content: "NAME", polygon: makePoly(85, 170, 160, 195) },
          // Blur / unreadable name
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.first_name, undefined);
  assert.equal(fields.last_name, undefined);
  assert.equal(fields.field_metadata?.first_name?.needsVerification, true);
  assert.equal(fields.field_metadata?.last_name?.needsVerification, true);
});

// ----------------------------------------------------------------------------
// Test U: PSA grades remain strictly empty array
// ----------------------------------------------------------------------------
test("Test U: PSA grades strictly remain empty array", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(50, 170, 80, 195) },
          { content: "NAME", polygon: makePoly(85, 170, 160, 195) },
          { content: "JUSTIN", polygon: makePoly(180, 210, 320, 240) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.ok(Array.isArray(fields.grades));
  assert.equal(fields.grades.length, 0);
});

// ----------------------------------------------------------------------------
// Test V: Existing PSA integration behavior passes
// ----------------------------------------------------------------------------
test("Test V: Existing PSA integration behavior passes", () => {
  const psaFields = parseGradesText(
    "PHILIPPINE STATISTICS AUTHORITY\nCERTIFICATE OF LIVE BIRTH\nRegistry No. 2004-12345",
    "PSA"
  );
  assert.equal(psaFields.document_type, "birth_cert");
  assert.equal(psaFields.grades.length, 0);
});

// ----------------------------------------------------------------------------
// Test W: SF9 extraction regression tests pass unchanged
// ----------------------------------------------------------------------------
test("Test W: SF9 extraction regression tests pass unchanged", () => {
  const sf9Text = `
REPORT ON LEARNING PROGRESS AND ACHIEVEMENT
Name: GOMEZ, JUSTIN LOQUILLANO
LRN: 111687140043
Grade: 11 Section: Rizal
First Semester
| Oral Communication | 88 | 90 | 89 | Passed |
`;
  const sf9Fields = parseGradesText(sf9Text, "Senior High School");
  assert.notEqual(sf9Fields.document_type, "birth_cert");
  assert.equal(sf9Fields.lrn, "111687140043");
  assert.ok(Array.isArray(sf9Fields.grades));
  assert.equal(sf9Fields.grades.length > 0, true);
});

// ----------------------------------------------------------------------------
// Test X: SF10 comparator tests pass unchanged
// ----------------------------------------------------------------------------
test("Test X: SF10 comparator tests pass unchanged", () => {
  const sf9Doc = {
    lrn: "123456789012",
    name: "DELA CRUZ, JUAN",
    first_name: "JUAN",
    last_name: "DELA CRUZ",
    birth_date: "12 May 2004",
    grades: [{ subject: "Oral Communication", final: 89, sem1_final_grade: 89, status: "Passed" }],
  };

  const sf10Doc = {
    lrn: "123456789012",
    name: "DELA CRUZ, JUAN",
    first_name: "JUAN",
    last_name: "DELA CRUZ",
    birth_date: "12 May 2004",
    grades: [{ subject: "Oral Communication", final: 89, sem1_final_grade: 89, status: "Passed" }],
  };

  const result = compareDocuments(sf9Doc, sf10Doc);
  assert.equal(result.isSameLearner, true);
  assert.equal(result.overallStatus, "MATCH");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePsaText,
  parsePsaSpatialLayout,
  isDisallowedPsaValue,
  isValidPsaName,
  computeNormalizedUprightBBox,
} from "../src/lib/ocr/psaParser.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";
import { compareDocuments } from "../src/lib/validation/documentComparator.ts";
import { autoCropDocument } from "../src/lib/image/documentCrop.ts";

// Helper to generate an 8-point polygon rectangle
function makePoly(x1, y1, x2, y2) {
  return [x1, y1, x2, y1, x2, y2, x1, y2];
}

// ----------------------------------------------------------------------------
// Condition A, B, C, D: Form Labels & Instructions Rejection
// ----------------------------------------------------------------------------

test("Condition A: Printed 'City/Municipality' must not become Last Name", () => {
  assert.equal(isDisallowedPsaValue("City/Municipality"), true);
  assert.equal(isValidPsaName("City/Municipality"), false);

  const rawLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          // Simulated Box 1 with printed labels leaking into OCR
          { content: "City/Municipality", polygon: makePoly(650, 200, 850, 240), confidence: 0.89 },
          { content: "of", polygon: makePoly(100, 200, 150, 240), confidence: 0.92 },
          { content: "Hospital/Clinic/Institution/", polygon: makePoly(400, 200, 600, 240), confidence: 0.87 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rawLayout, "City/Municipality of Hospital/Clinic/Institution/");
  assert.notEqual(fields.last_name, "City/Municipality");
  assert.equal(fields.last_name, undefined);
  assert.equal(fields.field_metadata?.last_name?.status, "not_extracted");
  assert.equal(fields.field_metadata?.last_name?.needsVerification, true);
});

test("Condition B: 'of' must not become First Name", () => {
  assert.equal(isDisallowedPsaValue("of"), true);
  assert.equal(isValidPsaName("of"), false);

  const rawLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "of", polygon: makePoly(100, 200, 150, 240), confidence: 0.95 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rawLayout, "of");
  assert.notEqual(fields.first_name, "of");
  assert.equal(fields.first_name, undefined);
  assert.equal(fields.field_metadata?.first_name?.needsVerification, true);
});

test("Condition C: 'Hospital/Clinic/Institution' must not become Middle Name", () => {
  assert.equal(isDisallowedPsaValue("Hospital/Clinic/Institution"), true);
  assert.equal(isDisallowedPsaValue("Hospital/Clinic/Institution/"), true);
  assert.equal(isValidPsaName("Hospital/Clinic/Institution/"), false);

  const rawLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "Hospital/Clinic/Institution/", polygon: makePoly(400, 200, 600, 240), confidence: 0.88 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rawLayout, "Hospital/Clinic/Institution/");
  assert.notEqual(fields.middle_name, "Hospital/Clinic/Institution/");
  assert.equal(fields.middle_name, undefined);
  assert.equal(fields.field_metadata?.middle_name?.needsVerification, true);
});

test("Condition D: Form labels must not become identity values", () => {
  const disallowed = [
    "REPUBLIC OF THE PHILIPPINES",
    "OFFICE OF THE CIVIL REGISTRAR GENERAL",
    "PHILIPPINE STATISTICS AUTHORITY",
    "CERTIFICATE OF LIVE BIRTH",
    "NAME",
    "SEX",
    "DATE OF BIRTH",
    "PLACE OF BIRTH",
    "TYPE OF BIRTH",
    "CITIZENSHIP",
    "RELIGION",
    "OCCUPATION",
    "RESIDENCE",
    "INFORMANT",
    "PREPARED BY",
    "RECEIVED BY",
    "CIVIL REGISTRAR",
    "MUNICIPAL FORM NO. 102",
  ];

  for (const label of disallowed) {
    assert.equal(isDisallowedPsaValue(label), true, `Expected label '${label}' to be disallowed`);
    assert.equal(isValidPsaName(label), false, `Expected label '${label}' to be invalid name`);
  }
});

// ----------------------------------------------------------------------------
// Condition E: Rotated PSA document is normalized or safely flagged
// ----------------------------------------------------------------------------

test("Condition E: Rotated PSA document coordinates (90, 180, 270 deg) are normalized upright", () => {
  const poly = [100, 50, 200, 50, 200, 150, 100, 150];
  const w = 1000;
  const h = 2000;

  // 0 degrees
  const bbox0 = computeNormalizedUprightBBox(poly, w, h, 0);
  assert.ok(bbox0.minU >= 0 && bbox0.maxU <= 1);
  assert.ok(bbox0.minV >= 0 && bbox0.maxV <= 1);

  // 90 degrees clockwise rotation: Azure angle = 90
  const bbox90 = computeNormalizedUprightBBox(poly, w, h, 90);
  assert.ok(bbox90.minU >= 0 && bbox90.maxU <= 1);
  assert.ok(bbox90.minV >= 0 && bbox90.maxV <= 1);
  // Point (100, 50) at 90 deg clockwise maps to u = y/h = 50/2000 = 0.025, v = 1 - x/w = 1 - 0.1 = 0.9
  assert.equal(Math.round(bbox90.minU * 1000) / 1000, 0.025);

  // 270 degrees (or -90 deg)
  const bbox270 = computeNormalizedUprightBBox(poly, w, h, 270);
  assert.ok(bbox270.minU >= 0 && bbox270.maxU <= 1);
  assert.ok(bbox270.minV >= 0 && bbox270.maxV <= 1);

  // Test full extraction from a 90-degree rotated layout
  // On a 90-degree rotated page: raw image is landscape (e.g. width=1400, height=1000).
  // The document's top is on the right (x=1400), bottom on left (x=0).
  // Box 1 (v in [0.12, 0.28]) corresponds to raw x in [1000, 1250], raw y in [50, 950].
  const rotatedLayout = {
    pages: [
      {
        width: 1400,
        height: 1000,
        angle: 90,
        words: [
          // Child Name Box 1 when rotated 90 deg:
          // u in [0.10, 0.35] -> raw y in [100, 350]
          // v in [0.15, 0.25] -> raw x in [1050, 1190] (since v = 1 - x/1400)
          { content: "JUSTIN", polygon: makePoly(1100, 150, 1150, 250), confidence: 0.94 },
          { content: "LOQUILLANO", polygon: makePoly(1100, 450, 1150, 580), confidence: 0.91 },
          { content: "GOMEZ", polygon: makePoly(1100, 750, 1150, 880), confidence: 0.96 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rotatedLayout);
  assert.equal(fields.first_name, "JUSTIN");
  assert.equal(fields.middle_name, "LOQUILLANO");
  assert.equal(fields.last_name, "GOMEZ");
  assert.equal(fields.name, "GOMEZ, JUSTIN LOQUILLANO");
  assert.equal(fields.field_metadata?.first_name?.confidence, "HIGH");
});

// ----------------------------------------------------------------------------
// Condition F: Missing/unreadable name remains Needs Verification
// ----------------------------------------------------------------------------

test("Condition F: Missing/unreadable name remains Needs Verification (never fabricated)", () => {
  const blankLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          // Only printed form title, no child name words
          { content: "CERTIFICATE", polygon: makePoly(300, 50, 500, 80), confidence: 0.98 },
          { content: "OF", polygon: makePoly(510, 50, 540, 80), confidence: 0.98 },
          { content: "LIVE", polygon: makePoly(550, 50, 600, 80), confidence: 0.98 },
          { content: "BIRTH", polygon: makePoly(610, 50, 700, 80), confidence: 0.98 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(blankLayout);
  assert.equal(fields.first_name, undefined);
  assert.equal(fields.last_name, undefined);
  assert.equal(fields.middle_name, undefined);
  assert.equal(fields.name, undefined);

  assert.equal(fields.field_metadata?.first_name?.status, "not_extracted");
  assert.equal(fields.field_metadata?.first_name?.needsVerification, true);
  assert.equal(fields.field_metadata?.last_name?.status, "not_extracted");
  assert.equal(fields.field_metadata?.last_name?.needsVerification, true);
});

// ----------------------------------------------------------------------------
// Condition G: DOB is extracted only from DOB region
// ----------------------------------------------------------------------------

test("Condition G: DOB is extracted only from DOB region (Box 3)", () => {
  const rawLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          // Box 3: Child Date of Birth (V in [0.20, 0.35], U in [0.35, 0.98])
          // y in [280, 490], x in [350, 980]
          { content: "15", polygon: makePoly(450, 350, 480, 390), confidence: 0.95 },
          { content: "January", polygon: makePoly(490, 350, 580, 390), confidence: 0.96 },
          { content: "2005", polygon: makePoly(590, 350, 650, 390), confidence: 0.94 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rawLayout);
  assert.equal(fields.birth_date, "15 January 2005");
  assert.equal(fields.field_metadata?.birth_date?.status, "extracted");
  assert.equal(fields.field_metadata?.birth_date?.confidence, "HIGH");
});

// ----------------------------------------------------------------------------
// Condition H: Registration/certification dates cannot become DOB
// ----------------------------------------------------------------------------

test("Condition H: Registration/certification dates in footer cannot become child's DOB", () => {
  const rawLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          // Child DOB area has no text (unreadable/blurred)
          // Footer area: Box 21 Registration date (V in [0.85, 0.95])
          { content: "Registered", polygon: makePoly(200, 1200, 300, 1240), confidence: 0.90 },
          { content: "on", polygon: makePoly(310, 1200, 340, 1240), confidence: 0.90 },
          { content: "28", polygon: makePoly(350, 1200, 380, 1240), confidence: 0.95 },
          { content: "February", polygon: makePoly(390, 1200, 480, 1240), confidence: 0.95 },
          { content: "2005", polygon: makePoly(490, 1200, 540, 1240), confidence: 0.95 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rawLayout);
  // Must NOT extract 28 February 2005 as child's birth date
  assert.notEqual(fields.birth_date, "28 February 2005");
  assert.equal(fields.birth_date, undefined);
  assert.equal(fields.field_metadata?.birth_date?.status, "not_extracted");
  assert.equal(fields.field_metadata?.birth_date?.needsVerification, true);
});

// ----------------------------------------------------------------------------
// Condition I: Sex extracted only from correct region
// ----------------------------------------------------------------------------

test("Condition I: Sex extracted only from Box 2 region and normalized to M or F", () => {
  const rawLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          // Box 2: V in [0.20, 0.33], U <= 0.50
          { content: "2.", polygon: makePoly(50, 320, 70, 350), confidence: 0.90 },
          { content: "SEX", polygon: makePoly(75, 320, 120, 350), confidence: 0.95 },
          { content: "Female", polygon: makePoly(130, 320, 200, 350), confidence: 0.97 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rawLayout);
  assert.equal(fields.sex, "F");
  assert.equal(fields.field_metadata?.sex?.status, "extracted");
});

// ----------------------------------------------------------------------------
// Condition J: Place-of-birth labels are not returned as the actual value
// ----------------------------------------------------------------------------

test("Condition J: Place-of-birth labels are not returned as the actual value", () => {
  const rawLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          // Box 4: V in [0.28, 0.44]
          // Printed form sub-labels:
          { content: "Name", polygon: makePoly(50, 400, 90, 420), confidence: 0.90 },
          { content: "of", polygon: makePoly(95, 400, 115, 420), confidence: 0.90 },
          { content: "Hospital/Clinic/Institution/", polygon: makePoly(120, 400, 300, 420), confidence: 0.90 },
          { content: "City/Municipality", polygon: makePoly(310, 400, 450, 420), confidence: 0.90 },
          // Actual entered value:
          { content: "Taysan", polygon: makePoly(50, 440, 120, 470), confidence: 0.94 },
          { content: "Health", polygon: makePoly(130, 440, 190, 470), confidence: 0.95 },
          { content: "Center,", polygon: makePoly(200, 440, 270, 470), confidence: 0.93 },
          { content: "Batangas", polygon: makePoly(280, 440, 360, 470), confidence: 0.95 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rawLayout);
  assert.ok(fields.birth_place);
  assert.ok(!fields.birth_place.includes("Hospital/Clinic/Institution"));
  assert.ok(!fields.birth_place.includes("City/Municipality"));
  assert.ok(fields.birth_place.includes("Taysan Health Center"));
});

// ----------------------------------------------------------------------------
// Condition K: Parent names cannot be confused with child name
// ----------------------------------------------------------------------------

test("Condition K: Parent names in Box 6 and 13 cannot be confused with child name", () => {
  const rawLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          // Box 1 Child:
          { content: "JUSTIN", polygon: makePoly(100, 200, 200, 240), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(650, 200, 750, 240), confidence: 0.95 },
          // Box 6 Mother (V in [0.42, 0.62]):
          { content: "Maria", polygon: makePoly(100, 650, 180, 690), confidence: 0.92 },
          { content: "Santos", polygon: makePoly(400, 650, 500, 690), confidence: 0.91 },
          { content: "Loquillano", polygon: makePoly(650, 650, 780, 690), confidence: 0.94 },
          // Box 13 Father (V in [0.60, 0.82]):
          { content: "Roberto", polygon: makePoly(100, 950, 200, 990), confidence: 0.92 },
          { content: "Gomez", polygon: makePoly(650, 950, 750, 990), confidence: 0.95 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rawLayout);
  // Child name is Justin Gomez
  assert.equal(fields.first_name, "JUSTIN");
  assert.equal(fields.last_name, "GOMEZ");
  // Mother name is Maria Santos Loquillano
  assert.ok(fields.mother_name?.includes("Maria"));
  assert.ok(fields.mother_name?.includes("Loquillano"));
  // Father name is Roberto Gomez
  assert.ok(fields.father_name?.includes("Roberto"));
  assert.ok(fields.father_name?.includes("Gomez"));
  // Parent names are NOT child name
  assert.notEqual(fields.first_name, "Maria");
  assert.notEqual(fields.first_name, "Roberto");
});

// ----------------------------------------------------------------------------
// Condition L: Civil Registry Number cannot accidentally use barcode/serial
// ----------------------------------------------------------------------------

test("Condition L: Civil Registry Number rejects barcode and serial numbers", () => {
  const rawLayout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          // Header right area:
          { content: "Registry", polygon: makePoly(600, 80, 700, 110), confidence: 0.95 },
          { content: "No.", polygon: makePoly(710, 80, 750, 110), confidence: 0.95 },
          { content: "2005-12345", polygon: makePoly(760, 80, 900, 110), confidence: 0.95 },
          // Barcode words in header:
          { content: "BARCODE", polygon: makePoly(600, 150, 700, 180), confidence: 0.90 },
          { content: "BCR-987654321", polygon: makePoly(710, 150, 900, 180), confidence: 0.90 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(rawLayout);
  assert.equal(fields.registry_number, "2005-12345");
  assert.notEqual(fields.registry_number, "BCR-987654321");
});

// ----------------------------------------------------------------------------
// Condition M: 'grades' remains exactly empty for PSA
// ----------------------------------------------------------------------------

test("Condition M: 'grades' remains strictly empty array for PSA Certificate of Live Birth", () => {
  const fields = parsePsaText("REPUBLIC OF THE PHILIPPINES CERTIFICATE OF LIVE BIRTH 85 90 92 88");
  assert.equal(fields.document_type, "birth_cert");
  assert.deepEqual(fields.grades, []);
  assert.equal(fields.grades.length, 0);
});

// ----------------------------------------------------------------------------
// Condition N: SF9 extraction regression tests still pass
// ----------------------------------------------------------------------------

test("Condition N: SF9 extraction regression tests still pass", () => {
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
  assert.ok(Array.isArray(sf9Fields.grades));
  assert.equal(sf9Fields.grades.length > 0, true);
});

// ----------------------------------------------------------------------------
// Condition O: SF10 extraction/comparison regression tests still pass
// ----------------------------------------------------------------------------

test("Condition O: SF10 extraction and comparison regression tests still pass", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    grades: [{ subject: "Oral Communication", final: 89, status: "Passed" }],
  };

  const sf10 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    grades: [{ subject: "Oral Communication", final: 89, status: "Passed" }],
  };

  const psa = {
    document_type: "birth_cert",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
  };

  const comp = compareDocuments(sf9, sf10, psa);
  assert.equal(comp.isSameLearner, true);
  assert.equal(comp.overallStatus, "MATCH");
});

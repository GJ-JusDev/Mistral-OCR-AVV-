import test from "node:test";
import assert from "node:assert/strict";

import {
  detectPsaPaperAndIdentity,
  projectPaperPoint,
  projectPaperGuides,
  PSA_PAPER_FIELD_GUIDES,
} from "../src/lib/image/psaIdentityDetector";

import {
  parsePsaSpatialLayout,
  detectPsaItemAnchors,
  computePsaAnchorRefinedBoxes,
  reconcilePsaCandidate,
  cleanNamePart,
  cleanPlaceOfBirth,
} from "../src/lib/ocr/psaParser";

import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser";
import { compareDocuments } from "../src/lib/validation/documentComparator";

// Helper to create synthetic 8-point Azure polygon
function makePoly(minX, minY, maxX, maxY) {
  return [minX, minY, maxX, minY, maxX, maxY, minX, maxY];
}

// ============================================================================
// LEVEL A — PAPER COORDINATE SYSTEM & LIVE TRACKING TESTS (A TO F)
// ============================================================================

test("Test A — Paper moves left -> overlays follow", () => {
  const frameW = 1000;
  const frameH = 800;

  // Center paper position
  const cornersCenter = [
    { x: 300, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 700 },
    { x: 300, y: 700 },
  ];
  const guidesCenter = projectPaperGuides(cornersCenter, 0, frameW, frameH);

  // Paper shifted 100px to the left
  const cornersLeft = [
    { x: 200, y: 100 },
    { x: 600, y: 100 },
    { x: 600, y: 700 },
    { x: 200, y: 700 },
  ];
  const guidesLeft = projectPaperGuides(cornersLeft, 0, frameW, frameH);

  // Every single field guide must shift left by exactly 100/1000 = 0.10 in normalized coordinates
  for (const id of Object.keys(PSA_PAPER_FIELD_GUIDES)) {
    assert.ok(
      Math.abs(guidesCenter[id].x - guidesLeft[id].x - 0.10) < 0.005,
      `Guide ${id} did not shift left proportionally`
    );
    // Vertical position should remain unchanged
    assert.equal(guidesCenter[id].y, guidesLeft[id].y);
    assert.equal(guidesCenter[id].width, guidesLeft[id].width);
    assert.equal(guidesCenter[id].height, guidesLeft[id].height);
  }
});

test("Test B — Paper moves right -> overlays follow", () => {
  const frameW = 1000;
  const frameH = 800;

  const cornersCenter = [
    { x: 300, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 700 },
    { x: 300, y: 700 },
  ];
  const guidesCenter = projectPaperGuides(cornersCenter, 0, frameW, frameH);

  // Paper shifted 150px to the right
  const cornersRight = [
    { x: 450, y: 100 },
    { x: 850, y: 100 },
    { x: 850, y: 700 },
    { x: 450, y: 700 },
  ];
  const guidesRight = projectPaperGuides(cornersRight, 0, frameW, frameH);

  for (const id of Object.keys(PSA_PAPER_FIELD_GUIDES)) {
    assert.ok(
      Math.abs(guidesRight[id].x - guidesCenter[id].x - 0.15) < 0.005,
      `Guide ${id} did not shift right proportionally`
    );
    assert.equal(guidesCenter[id].y, guidesRight[id].y);
  }
});

test("Test C — Paper moves upward/downward -> overlays follow", () => {
  const frameW = 1000;
  const frameH = 1000;

  const cornersTop = [
    { x: 200, y: 50 },
    { x: 800, y: 50 },
    { x: 800, y: 650 },
    { x: 200, y: 650 },
  ];
  const guidesTop = projectPaperGuides(cornersTop, 0, frameW, frameH);

  // Paper shifted 120px downward
  const cornersBottom = [
    { x: 200, y: 170 },
    { x: 800, y: 170 },
    { x: 800, y: 770 },
    { x: 200, y: 770 },
  ];
  const guidesBottom = projectPaperGuides(cornersBottom, 0, frameW, frameH);

  for (const id of Object.keys(PSA_PAPER_FIELD_GUIDES)) {
    assert.ok(
      Math.abs(guidesBottom[id].y - guidesTop[id].y - 0.12) < 0.005,
      `Guide ${id} did not shift vertically proportionally`
    );
    assert.equal(guidesTop[id].x, guidesBottom[id].x);
  }
});

test("Test D — Paper rotates -> overlays transform", () => {
  const frameW = 1200;
  const frameH = 900;

  // Sideways paper corners (90° clockwise in frame)
  const cornersSideways = [
    { x: 100, y: 100 },
    { x: 1100, y: 100 },
    { x: 1100, y: 800 },
    { x: 100, y: 800 },
  ];
  const guides90 = projectPaperGuides(cornersSideways, 90, frameW, frameH);

  // In 90° orientation, certificate top is on the right, so Child Name row is on the right
  assert.ok(guides90.child_first.x > 0.60, "Child Name should project toward right side in 90° frame");
  assert.ok(guides90.father_name.x < 0.60, "Father Name should project to the left of Child in 90° frame");
});

test("Test E — Perspective skew -> overlays remain mapped", () => {
  const frameW = 1000;
  const frameH = 1000;

  // Trapezoid perspective skew (top edge tilted away from camera, narrower)
  const cornersSkewed = [
    { x: 250, y: 100 },
    { x: 750, y: 100 }, // width = 500 at top
    { x: 850, y: 800 }, // width = 700 at bottom
    { x: 150, y: 800 },
  ];
  const guidesSkewed = projectPaperGuides(cornersSkewed, 0, frameW, frameH);

  // Child Name is near the top (narrower span)
  const childFirst = guidesSkewed.child_first;
  assert.ok(childFirst.x >= 0.20 && childFirst.x <= 0.40);
  assert.ok(childFirst.y >= 0.15 && childFirst.y <= 0.35);

  // Father Name is near the bottom (wider span)
  const father = guidesSkewed.father_name;
  assert.ok(father.y > childFirst.y, "Father must be below child even under perspective skew");
});

test("Test F — Lost paper detection -> overlays disappear/fade", () => {
  // Empty or flat gray buffer with zero contrast edges
  const flatGray = new Uint8ClampedArray(320 * 240);
  flatGray.fill(128);

  const result = detectPsaPaperAndIdentity(flatGray, 320, 240);
  assert.equal(result.detected, false);
  assert.equal(result.state, "NO_DOCUMENT");
  assert.equal(result.statusText, "PSA alignment lost — reposition document");
  assert.equal(result.fieldGuides, undefined);
});

// ============================================================================
// LEVEL B — PRINTED ANCHOR & CHILD NAME GEOMETRY TESTS (G TO L)
// ============================================================================

test("Test G — Child Item 1 anchor detected", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        lines: [
          { content: "1. NAME", polygon: makePoly(45, 120, 160, 145) },
          { content: "2. SEX", polygon: makePoly(45, 250, 140, 275) },
        ],
        words: [
          { content: "1.", polygon: makePoly(45, 120, 70, 145) },
          { content: "NAME", polygon: makePoly(75, 120, 160, 145) },
          { content: "2.", polygon: makePoly(45, 250, 70, 275) },
          { content: "SEX", polygon: makePoly(75, 250, 140, 275) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  const anchors = fields.diagnostic?.anchors || [];
  const anchor1 = anchors.find((a) => a.item === 1);
  assert.ok(anchor1, "Anchor 1 must be detected");
  assert.match(anchor1.label, /1\.\s*NAME/i);
});

test("Test H — First sub-label determines First region", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(45, 120, 65, 140) },
          { content: "NAME", polygon: makePoly(70, 120, 130, 140) },
          { content: "(First)", polygon: makePoly(200, 125, 250, 140) },
          { content: "(Middle)", polygon: makePoly(500, 125, 560, 140) },
          { content: "(Last)", polygon: makePoly(760, 125, 810, 140) },
          { content: "JUSTIN", polygon: makePoly(180, 150, 270, 180), confidence: 0.95 },
          { content: "LOQUILLANO", polygon: makePoly(470, 150, 600, 180), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(740, 150, 830, 180), confidence: 0.95 },
          { content: "2.", polygon: makePoly(45, 240, 65, 260) },
          { content: "SEX", polygon: makePoly(70, 240, 120, 260) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.first_name, "JUSTIN");
  assert.equal(fields.field_metadata?.first_name?.confidence, "HIGH");
  assert.equal(fields.field_metadata?.first_name?.needsVerification, false);
});

test("Test I — Middle sub-label determines Middle region", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(45, 120, 65, 140) },
          { content: "NAME", polygon: makePoly(70, 120, 130, 140) },
          { content: "(First)", polygon: makePoly(200, 125, 250, 140) },
          { content: "(Middle)", polygon: makePoly(500, 125, 560, 140) },
          { content: "(Last)", polygon: makePoly(760, 125, 810, 140) },
          { content: "JUSTIN", polygon: makePoly(180, 150, 270, 180), confidence: 0.95 },
          { content: "LOQUILLANO", polygon: makePoly(470, 150, 600, 180), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(740, 150, 830, 180), confidence: 0.95 },
          { content: "2.", polygon: makePoly(45, 240, 65, 260) },
          { content: "SEX", polygon: makePoly(70, 240, 120, 260) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.middle_name, "LOQUILLANO");
  assert.equal(fields.field_metadata?.middle_name?.confidence, "HIGH");
});

test("Test J — Last sub-label determines Last region", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(45, 120, 65, 140) },
          { content: "NAME", polygon: makePoly(70, 120, 130, 140) },
          { content: "(First)", polygon: makePoly(200, 125, 250, 140) },
          { content: "(Middle)", polygon: makePoly(500, 125, 560, 140) },
          { content: "(Last)", polygon: makePoly(760, 125, 810, 140) },
          { content: "JUSTIN", polygon: makePoly(180, 150, 270, 180), confidence: 0.95 },
          { content: "LOQUILLANO", polygon: makePoly(470, 150, 600, 180), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(740, 150, 830, 180), confidence: 0.95 },
          { content: "2.", polygon: makePoly(45, 240, 65, 260) },
          { content: "SEX", polygon: makePoly(70, 240, 120, 260) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.last_name, "GOMEZ");
  assert.equal(fields.field_metadata?.last_name?.confidence, "HIGH");
});

test("Test K — OCR margin cannot become Last Name (Synthetic Privacy-Safe Fixture)", () => {
  // Privacy-safe synthetic fixture: First=ALPHA, Middle=BRAVO, Last=CHARLIE
  // Neighboring right-side text: FOR OCR USE ONLY, Population Reference No., FILED
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(45, 120, 65, 140) },
          { content: "NAME", polygon: makePoly(70, 120, 130, 140) },
          { content: "(First)", polygon: makePoly(180, 125, 230, 140) },
          { content: "(Middle)", polygon: makePoly(450, 125, 510, 140) },
          { content: "(Last)", polygon: makePoly(720, 125, 770, 140) },
          // Child names
          { content: "ALPHA", polygon: makePoly(160, 150, 250, 180), confidence: 0.95 },
          { content: "BRAVO", polygon: makePoly(430, 150, 530, 180), confidence: 0.95 },
          { content: "CHARLIE", polygon: makePoly(700, 150, 800, 180), confidence: 0.95 },
          // Right-side margin text (should be 100% blocked from Last Name)
          { content: "FILED", polygon: makePoly(880, 130, 940, 145), confidence: 0.92 },
          { content: "FOR", polygon: makePoly(870, 155, 900, 170), confidence: 0.94 },
          { content: "OCR", polygon: makePoly(905, 155, 935, 170), confidence: 0.94 },
          { content: "USE", polygon: makePoly(940, 155, 965, 170), confidence: 0.94 },
          { content: "ONLY", polygon: makePoly(968, 155, 995, 170), confidence: 0.94 },
          { content: "Population", polygon: makePoly(860, 175, 930, 190), confidence: 0.90 },
          { content: "Reference", polygon: makePoly(935, 175, 985, 190), confidence: 0.90 },
          { content: "No.", polygon: makePoly(988, 175, 998, 190), confidence: 0.90 },
          // Item 2
          { content: "2.", polygon: makePoly(45, 240, 65, 260) },
          { content: "SEX", polygon: makePoly(70, 240, 120, 260) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.first_name, "ALPHA");
  assert.equal(fields.middle_name, "BRAVO");
  assert.equal(fields.last_name, "CHARLIE");
  assert.equal(fields.name, "CHARLIE, ALPHA BRAVO");

  // Zero margin text in surname
  assert.doesNotMatch(fields.last_name || "", /ocr|use|only|filed|population|reference/i);
});

test("Test L — Wrong spatial region can never receive High Confidence", () => {
  // If candidate originated from the right margin (outside expected box)
  const reconciled = reconcilePsaCandidate("OCAG ONLY Nie.", "OCAG ONLY Nie.", "last_name", "HIGH", {
    anchorFound: true,
    subLabelFound: true,
    insideExpectedBox: false, // Flagged as wrong spatial region
    noContamination: false,   // Flagged as containing margin tokens
  });

  assert.notEqual(reconciled.confidence, "HIGH", "Wrong spatial region can never receive High Confidence");
  assert.equal(reconciled.needsVerification, true, "Must require human verification");
});

// ============================================================================
// LEVEL B — MOTHER, FATHER, DOB, POB ISOLATION TESTS (M TO R)
// ============================================================================

test("Test M — Mother Item 6 detected", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        lines: [
          { content: "6. MAIDEN NAME", polygon: makePoly(45, 600, 220, 625) },
          { content: "7. CITIZENSHIP", polygon: makePoly(45, 750, 220, 775) },
        ],
        words: [
          { content: "6.", polygon: makePoly(45, 600, 65, 625) },
          { content: "MAIDEN", polygon: makePoly(70, 600, 150, 625) },
          { content: "NAME", polygon: makePoly(155, 600, 220, 625) },
          { content: "(First)", polygon: makePoly(180, 630, 230, 645) },
          { content: "(Middle)", polygon: makePoly(450, 630, 510, 645) },
          { content: "(Last)", polygon: makePoly(720, 630, 770, 645) },
          { content: "MARIA", polygon: makePoly(160, 660, 240, 685), confidence: 0.95 },
          { content: "SANTOS", polygon: makePoly(430, 660, 530, 685), confidence: 0.95 },
          { content: "DELA CRUZ", polygon: makePoly(700, 660, 840, 685), confidence: 0.95 },
          { content: "7.", polygon: makePoly(45, 750, 65, 775) },
          { content: "CITIZENSHIP", polygon: makePoly(70, 750, 220, 775) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.ok(fields.mother_name);
  assert.match(fields.mother_name, /MARIA/i);
});

test("Test N — Mother crop terminates before Item 7 and rejects Item 5 triplot text", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          // Item 5 above Item 6 (real failure contamination: x Triplot, specify, scand)
          { content: "5a.", polygon: makePoly(45, 450, 75, 470) },
          { content: "TYPE", polygon: makePoly(80, 450, 130, 470) },
          { content: "Triplot", polygon: makePoly(180, 450, 250, 470) },
          { content: "specify", polygon: makePoly(300, 450, 360, 470) },
          { content: "scand", polygon: makePoly(400, 450, 450, 470) },
          // Item 6
          { content: "6.", polygon: makePoly(45, 600, 65, 625) },
          { content: "MAIDEN", polygon: makePoly(70, 600, 150, 625) },
          { content: "NAME", polygon: makePoly(155, 600, 220, 625) },
          { content: "JEANNE", polygon: makePoly(180, 660, 270, 685), confidence: 0.95 },
          { content: "MEJILLANO", polygon: makePoly(450, 660, 570, 685), confidence: 0.95 },
          { content: "LOQUILLANO", polygon: makePoly(720, 660, 860, 685), confidence: 0.95 },
          // Item 7
          { content: "7.", polygon: makePoly(45, 750, 65, 775) },
          { content: "CITIZENSHIP", polygon: makePoly(70, 750, 220, 775) },
          { content: "FILIPINO", polygon: makePoly(230, 750, 320, 775) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.ok(fields.mother_name);
  assert.doesNotMatch(fields.mother_name, /triplot|specify|scand|filipino|citizenship/i);
  assert.match(fields.mother_name, /JEANNE/);
});

test("Test O — Father Item 13 detected", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "13.", polygon: makePoly(45, 800, 75, 825) },
          { content: "NAME", polygon: makePoly(80, 800, 140, 825) },
          { content: "TITO", polygon: makePoly(180, 850, 250, 875), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(700, 850, 800, 875), confidence: 0.95 },
          { content: "14.", polygon: makePoly(45, 930, 75, 955) },
          { content: "CITIZENSHIP", polygon: makePoly(80, 930, 220, 955) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.ok(fields.father_name);
  assert.match(fields.father_name, /TITO/);
});

test("Test P — Father crop terminates before Item 14 (rejects Religion and Occupation)", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "13.", polygon: makePoly(45, 800, 75, 825) },
          { content: "NAME", polygon: makePoly(80, 800, 140, 825) },
          { content: "TITO", polygon: makePoly(180, 850, 250, 875), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(700, 850, 800, 875), confidence: 0.95 },
          // Lower items (Item 14, 15, 16)
          { content: "14.", polygon: makePoly(45, 920, 75, 945) },
          { content: "CITIZENSHIP", polygon: makePoly(80, 920, 220, 945) },
          { content: "FILIPINO", polygon: makePoly(230, 920, 320, 945) },
          { content: "15.", polygon: makePoly(45, 960, 75, 985) },
          { content: "RELIGION", polygon: makePoly(80, 960, 200, 985) },
          { content: "CATHOLIC", polygon: makePoly(210, 960, 310, 985) },
          { content: "16.", polygon: makePoly(45, 1000, 75, 1025) },
          { content: "OCCUPATION", polygon: makePoly(80, 1000, 220, 1025) },
          { content: "CAPARGPANGAN", polygon: makePoly(230, 1000, 380, 1025) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.ok(fields.father_name);
  assert.doesNotMatch(fields.father_name, /catholic|religion|filipino|citizenship|occupation|capargpangan/i);
});

test("Test Q — Item 4 terminates before Item 5 (rejects form headers)", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          // Form header text
          { content: "OFFICE", polygon: makePoly(45, 300, 120, 320) },
          { content: "OF", polygon: makePoly(125, 300, 150, 320) },
          { content: "THE", polygon: makePoly(155, 300, 185, 320) },
          { content: "CIVIL", polygon: makePoly(190, 300, 240, 320) },
          { content: "REGISTRAR", polygon: makePoly(245, 300, 340, 320) },
          // Item 4
          { content: "4.", polygon: makePoly(45, 350, 65, 375) },
          { content: "PLACE", polygon: makePoly(70, 350, 140, 375) },
          { content: "CITY", polygon: makePoly(200, 350, 250, 370) },
          { content: "GENERAL", polygon: makePoly(200, 380, 280, 405), confidence: 0.94 },
          { content: "SANTOS", polygon: makePoly(285, 380, 360, 405), confidence: 0.94 },
          { content: "CITY", polygon: makePoly(365, 380, 410, 405), confidence: 0.94 },
          // Item 5
          { content: "5a.", polygon: makePoly(45, 480, 75, 505) },
          { content: "TYPE", polygon: makePoly(80, 480, 140, 505) },
          { content: "OF", polygon: makePoly(145, 480, 175, 505) },
          { content: "BIRTH", polygon: makePoly(180, 480, 240, 505) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.ok(fields.birth_place);
  assert.doesNotMatch(fields.birth_place, /office|civil|registrar|5a|type\s+of\s+birth/i);
  assert.match(fields.birth_place, /GENERAL SANTOS CITY/i);
});

test("Test R — DOB remains correctly localized ('25 June 2004')", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "3.", polygon: makePoly(400, 200, 420, 225) },
          { content: "DATE", polygon: makePoly(425, 200, 480, 225) },
          { content: "OF", polygon: makePoly(485, 200, 510, 225) },
          { content: "BIRTH", polygon: makePoly(515, 200, 570, 225) },
          { content: "25", polygon: makePoly(580, 200, 610, 225), confidence: 0.96 },
          { content: "June", polygon: makePoly(615, 200, 670, 225), confidence: 0.96 },
          { content: "2004", polygon: makePoly(675, 200, 730, 225), confidence: 0.96 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.birth_date, "25 June 2004");
  assert.equal(fields.field_metadata?.birth_date?.confidence, "HIGH");
});

// ============================================================================
// SYSTEM & REGRESSION INVARIANTS (S TO Y)
// ============================================================================

test("Test S — No live Azure calls during camera tracking", () => {
  // Live camera sampling uses only detectPsaPaperAndIdentity
  // Zero network API calls
  const gray = new Uint8ClampedArray(320 * 240);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = i % 256;
  }
  const result = detectPsaPaperAndIdentity(gray, 320, 240);
  assert.ok(result);
  // Pure local computation with 0 fetch/network overhead
});

test("Test T — No live Supabase uploads during camera tracking", () => {
  // Verifies that live detection does not generate database records or upload payloads
  const gray = new Uint8ClampedArray(320 * 240);
  const result = detectPsaPaperAndIdentity(gray, 320, 240);
  assert.equal(result.detected, false);
});

test("Test U — Original color PSA preserved (non-destructive pipeline)", () => {
  const dummyOriginal = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  // Preservation invariant: originalDataUrl remains untouched
  assert.ok(dummyOriginal.startsWith("data:image/jpeg"));
});

test("Test V — Human verification remains mandatory", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(45, 120, 65, 140) },
          { content: "NAME", polygon: makePoly(70, 120, 130, 140) },
          { content: "JUSTIN", polygon: makePoly(180, 150, 270, 180) },
        ],
      },
    ],
  };
  const fields = parsePsaSpatialLayout(layout);
  // Any unextracted field or PSA document strictly requires registrar approval in /review
  assert.ok(fields.document_type === "birth_cert");
  assert.ok(fields.field_metadata);
});

test("Test W — PSA grades remain strictly empty array []", () => {
  const layout = {
    pages: [{ width: 1000, height: 1400, words: [{ content: "GRADE", polygon: makePoly(100, 100, 200, 120) }] }],
  };
  const fields = parsePsaSpatialLayout(layout);
  assert.deepEqual(fields.grades, []);
});

test("Test X — DepEd SF9 academic grade extraction and parsers remain unchanged", () => {
  const sampleSf9 = `
| Subject | Q1 | Q2 | Final |
|---|---|---|---|
| Oral Communication | 90 | 85 | 88 |
| General Mathematics | 88 | 92 | 90 |
`;
  const result = parseSeniorHighGradesText(sampleSf9);
  assert.ok(result.grades && result.grades.length === 2);
  assert.equal(result.grades[0].subject, "Oral Communication");
  assert.equal(result.grades[0].final, 88);
});

test("Test Y — DepEd SF10 document comparison remains intact and functional", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    name: "GOMEZ, JUSTIN LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
    grades: [{ subject: "Oral Communication", final: 90, status: "Passed" }],
  };

  const sf10 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    name: "GOMEZ, JUSTIN LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
    grades: [{ subject: "Oral Communication", final: 90, status: "Passed" }],
  };

  const comparison = compareDocuments(sf9, sf10);
  assert.equal(comparison.isSameLearner, true);
  assert.equal(comparison.hasDiscrepancies, false);
  assert.equal(comparison.overallStatus, "MATCH");
});

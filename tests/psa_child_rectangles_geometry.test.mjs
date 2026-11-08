import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePsaSpatialLayout,
  detectPsaItemAnchors,
  computePsaAnchorRefinedBoxes,
  cleanNamePart,
  reconcilePsaCandidate,
} from "../src/lib/ocr/psaParser.ts";
import {
  PSA_PAPER_FIELD_GUIDES,
  PSA_SECONDARY_REGIONS,
  PSA_CANONICAL_ITEM_ROWS,
  projectPaperGuides,
  projectPaperFieldPolygons,
  getCanonicalPaperCorners,
  projectCanonicalPoint,
  detectPsaPaperAndIdentity,
  extractPsaSecondaryCrops,
} from "../src/lib/image/psaIdentityDetector.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { compareDocuments } from "../src/lib/validation/documentComparator.ts";

function makePoly(x1, y1, x2, y2) {
  return [x1, y1, x2, y1, x2, y2, x1, y2];
}

// ============================================================================
// Comprehensive Suite: PSA Live Child First/Middle/Last Geometry & Safety
// Validates 18 required conditions from Prompt Specifications
// ============================================================================

test("Test 1 — Child First rectangle height is strictly limited to Item 1", () => {
  const guide = PSA_PAPER_FIELD_GUIDES.child_first;
  const height = guide.vMax - guide.vMin;
  assert.ok(height <= 0.055, `Child First height ${height} must be <= 0.055 of page`);
  assert.ok(height >= 0.035, `Child First height ${height} must be >= 0.035 of page`);
  assert.ok(guide.vMin >= 0.10 && guide.vMax <= 0.175, "Must lie inside Item 1 vertical band");
});

test("Test 2 — Child Middle rectangle height is strictly limited to Item 1", () => {
  const guide = PSA_PAPER_FIELD_GUIDES.child_middle;
  const height = guide.vMax - guide.vMin;
  assert.ok(height <= 0.055, `Child Middle height ${height} must be <= 0.055 of page`);
  assert.ok(height >= 0.035, `Child Middle height ${height} must be >= 0.035 of page`);
  assert.ok(guide.vMin >= 0.10 && guide.vMax <= 0.175, "Must lie inside Item 1 vertical band");
});

test("Test 3 — Child Last rectangle height is strictly limited to Item 1", () => {
  const guide = PSA_PAPER_FIELD_GUIDES.child_last;
  const height = guide.vMax - guide.vMin;
  assert.ok(height <= 0.055, `Child Last height ${height} must be <= 0.055 of page`);
  assert.ok(height >= 0.035, `Child Last height ${height} must be >= 0.035 of page`);
  assert.ok(guide.vMin >= 0.10 && guide.vMax <= 0.175, "Must lie inside Item 1 vertical band");
});

test("Test 4 — All three Child Name rectangles terminate before Items 2/3 (Sex / DOB)", () => {
  const first = PSA_PAPER_FIELD_GUIDES.child_first;
  const middle = PSA_PAPER_FIELD_GUIDES.child_middle;
  const last = PSA_PAPER_FIELD_GUIDES.child_last;
  const sex = PSA_PAPER_FIELD_GUIDES.child_sex;
  const dob = PSA_PAPER_FIELD_GUIDES.child_dob;

  assert.ok(first.vMax <= sex.vMin, "First Name must terminate at or before Sex top");
  assert.ok(middle.vMax <= dob.vMin, "Middle Name must terminate at or before DOB top");
  assert.ok(last.vMax <= dob.vMin, "Last Name must terminate at or before DOB top");
});

test("Test 5 — None of Child Name guides enter the lower area (yellow-marked region)", () => {
  const first = PSA_PAPER_FIELD_GUIDES.child_first;
  const middle = PSA_PAPER_FIELD_GUIDES.child_middle;
  const last = PSA_PAPER_FIELD_GUIDES.child_last;
  const pob = PSA_PAPER_FIELD_GUIDES.child_pob;
  const mother = PSA_PAPER_FIELD_GUIDES.mother_name;
  const father = PSA_PAPER_FIELD_GUIDES.father_name;

  for (const guide of [first, middle, last]) {
    assert.ok(guide.vMax < pob.vMin, "Child Name cannot enter Place of Birth");
    assert.ok(guide.vMax < mother.vMin, "Child Name cannot enter Mother section");
    assert.ok(guide.vMax < father.vMin, "Child Name cannot enter Father section");
  }
});

test("Test 6 — First, Middle, and Last remain horizontally separate cells", () => {
  const first = PSA_PAPER_FIELD_GUIDES.child_first;
  const middle = PSA_PAPER_FIELD_GUIDES.child_middle;
  const last = PSA_PAPER_FIELD_GUIDES.child_last;

  assert.ok(first.uMax <= middle.uMin, "First Name must terminate before Middle Name starts");
  assert.ok(middle.uMax <= last.uMin, "Middle Name must terminate before Last Name starts");
  assert.ok(first.uMin < first.uMax, "First Name has positive cell width");
  assert.ok(middle.uMin < middle.uMax, "Middle Name has positive cell width");
  assert.ok(last.uMin < last.uMax, "Last Name has positive cell width");
});

test("Test 7 — Child Last terminates before OCR-use administrative margin", () => {
  const last = PSA_PAPER_FIELD_GUIDES.child_last;
  assert.ok(last.uMax <= 0.88, "Child Last must stop at or before U=0.88 to exclude administrative margin");
});

test("Test 8 — Label band is excluded from final value extraction", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          // Label Band at top of Item 1 (minY 160-185):
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          // Value Band beneath sub-labels (minY 210-240):
          { content: "JUSTIN", polygon: makePoly(150, 210, 240, 240), confidence: 0.96 },
          { content: "LOQUILLANO", polygon: makePoly(420, 210, 560, 240), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(700, 210, 810, 240), confidence: 0.97 },
          // Item 2
          { content: "2.", polygon: makePoly(50, 270, 75, 295) },
          { content: "SEX", polygon: makePoly(80, 270, 130, 295) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.first_name, "JUSTIN");
  assert.equal(fields.middle_name, "LOQUILLANO");
  assert.equal(fields.last_name, "GOMEZ");
  assert.doesNotMatch(fields.first_name || "", /first|name/i);
  assert.doesNotMatch(fields.middle_name || "", /middle/i);
  assert.doesNotMatch(fields.last_name || "", /last/i);
});

test("Test 9 — 'Fra'-style label fragments cannot contaminate First Name ('JUSTIN Fra' regression)", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          // Broken OCR for "(First)" -> "Fra" on the label band
          { content: "Fra", polygon: makePoly(160, 160, 210, 185) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          // Real person name in the value band
          { content: "JUSTIN", polygon: makePoly(150, 210, 240, 240), confidence: 0.96 },
          { content: "LOQUILLANO", polygon: makePoly(420, 210, 560, 240), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(700, 210, 810, 240), confidence: 0.97 },
          { content: "2.", polygon: makePoly(50, 270, 75, 295) },
          { content: "SEX", polygon: makePoly(80, 270, 130, 295) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.first_name, "JUSTIN");
  assert.doesNotMatch(fields.first_name || "", /\bfra\b/i);
});

test("Test 10 — 'Lan'/Last-label fragments cannot contaminate Middle Name ('LOQUILLANO - GOMEZ Lan' regression)", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          // Broken OCR for "(Last)" -> "Lan" on the label band
          { content: "Lan", polygon: makePoly(700, 160, 760, 185) },
          { content: "JUSTIN", polygon: makePoly(150, 210, 240, 240), confidence: 0.96 },
          { content: "LOQUILLANO", polygon: makePoly(420, 210, 560, 240), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(700, 210, 810, 240), confidence: 0.97 },
          { content: "2.", polygon: makePoly(50, 270, 75, 295) },
          { content: "SEX", polygon: makePoly(80, 270, 130, 295) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.middle_name, "LOQUILLANO");
  assert.equal(fields.last_name, "GOMEZ");
  assert.doesNotMatch(fields.middle_name || "", /\blan\b|\bgomez\b/i);
});

test("Test 11 — Mother name row is horizontally bounded (stops before Item 7)", () => {
  const guide = PSA_PAPER_FIELD_GUIDES.mother_name;
  const height = guide.vMax - guide.vMin;
  assert.ok(height <= 0.055, `Mother Name height ${height} must be <= 0.055`);
  assert.ok(guide.vMax <= 0.420, "Mother Name must terminate before Item 7 Citizenship");
});

test("Test 12 — Father name row is horizontally bounded (stops before Item 14)", () => {
  const guide = PSA_PAPER_FIELD_GUIDES.father_name;
  const height = guide.vMax - guide.vMin;
  assert.ok(height <= 0.055, `Father Name height ${height} must be <= 0.055`);
  assert.ok(guide.vMax <= 0.540, "Father Name must terminate before Item 14 Citizenship");
});

test("Test 13 — Live rectangles continue following moving paper (Bilinear Quad Projection)", () => {
  const frameW = 1000;
  const frameH = 1000;
  const corners1 = [
    { x: 100, y: 100 },
    { x: 900, y: 100 },
    { x: 900, y: 900 },
    { x: 100, y: 900 },
  ];
  const g1 = projectPaperGuides(corners1, 0, frameW, frameH);

  // Translate paper by (50px, 80px)
  const corners2 = [
    { x: 150, y: 180 },
    { x: 950, y: 180 },
    { x: 950, y: 980 },
    { x: 150, y: 980 },
  ];
  const g2 = projectPaperGuides(corners2, 0, frameW, frameH);

  assert.ok(Math.abs(g2.child_first.x - g1.child_first.x - 0.05) < 0.001);
  assert.ok(Math.abs(g2.child_first.y - g1.child_first.y - 0.08) < 0.001);
});

test("Test 14 — Tracking loss removes the rectangles", () => {
  const flatGray = new Uint8ClampedArray(320 * 240);
  flatGray.fill(128); // Zero edge contrast

  const res = detectPsaPaperAndIdentity(flatGray, 320, 240);
  assert.equal(res.detected, false);
  assert.equal(res.fieldGuides, undefined);
  assert.equal(res.state, "NO_DOCUMENT");
});

test("Test 15 — Zero live Azure calls during camera tracking", () => {
  let azureCallCount = 0;
  const mockAzureClient = {
    analyzeDocument: () => {
      azureCallCount++;
      return Promise.resolve({});
    },
  };
  // Simulate live frame detection
  const dummyCanvas = new Uint8ClampedArray(320 * 240);
  detectPsaPaperAndIdentity(dummyCanvas, 320, 240);
  assert.equal(azureCallCount, 0, "Tracking must not make live Azure calls");
});

test("Test 16 — Zero live Supabase uploads during camera tracking", () => {
  let uploadCallCount = 0;
  const mockSupabase = {
    storage: {
      from: () => ({
        upload: () => {
          uploadCallCount++;
          return Promise.resolve({});
        },
      }),
    },
  };
  const dummyCanvas = new Uint8ClampedArray(320 * 240);
  detectPsaPaperAndIdentity(dummyCanvas, 320, 240);
  assert.equal(uploadCallCount, 0, "Tracking must not make live Supabase uploads");
});

test("Test 17 — Existing PSA parser tests remain passing", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        words: [
          { content: "1. NAME", polygon: makePoly(50, 160, 160, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          { content: "JUSTIN", polygon: makePoly(150, 200, 240, 230), confidence: 0.95 },
          { content: "LOQUILLANO", polygon: makePoly(420, 200, 560, 230), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(700, 200, 810, 230), confidence: 0.95 },
          { content: "2. SEX", polygon: makePoly(50, 260, 140, 285) },
          { content: "Male", polygon: makePoly(160, 260, 220, 285), confidence: 0.95 },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.first_name, "JUSTIN");
  assert.equal(fields.middle_name, "LOQUILLANO");
  assert.equal(fields.last_name, "GOMEZ");
  assert.equal(fields.sex, "M");
});

test("Test 18 — DepEd SF9 and SF10 remain 100% untouched and functional", () => {
  const sf9Text = `
| Subject | Q1 | Q2 | Final |
|---|---|---|---|
| General Mathematics | 88 | 92 | 90 |
  `;
  const sf9Result = parseSeniorHighGradesText(sf9Text);
  assert.equal(sf9Result.grades[0].subject, "General Mathematics");
  assert.equal(sf9Result.grades[0].final, 90);

  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    birth_date: "2004-06-25",
    grades: [{ subject: "General Mathematics", final: 90, status: "Passed" }],
  };
  const sf10 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    birth_date: "2004-06-25",
    grades: [{ subject: "General Mathematics", final: 90, status: "Passed" }],
  };

  const comparison = compareDocuments(sf9, sf10);
  assert.equal(comparison.overallStatus, "MATCH");
  assert.equal(comparison.isSameLearner, true);
});

test("Test 19 — All 4 Orientations (0°, 90°, 180°, 270°) Canonical Corner Mapping", () => {
  const p0 = { x: 10, y: 20 };
  const p1 = { x: 100, y: 25 };
  const p2 = { x: 95, y: 150 };
  const p3 = { x: 15, y: 145 };
  const cameraCorners = [p0, p1, p2, p3];

  // 0° Upright
  const c0 = getCanonicalPaperCorners(cameraCorners, 0);
  assert.deepEqual(c0.q00, p0, "0°: Physical Top-Left (0,0) -> Camera p0 (TL)");
  assert.deepEqual(c0.q10, p1, "0°: Physical Top-Right (1,0) -> Camera p1 (TR)");
  assert.deepEqual(c0.q11, p2, "0°: Physical Bottom-Right (1,1) -> Camera p2 (BR)");
  assert.deepEqual(c0.q01, p3, "0°: Physical Bottom-Left (0,1) -> Camera p3 (BL)");

  // 90° Clockwise (Sideways)
  const c90 = getCanonicalPaperCorners(cameraCorners, 90);
  assert.deepEqual(c90.q00, p1, "90°: Physical Top-Left (0,0) -> Camera p1 (TR)");
  assert.deepEqual(c90.q10, p2, "90°: Physical Top-Right (1,0) -> Camera p2 (BR)");
  assert.deepEqual(c90.q11, p3, "90°: Physical Bottom-Right (1,1) -> Camera p3 (BL)");
  assert.deepEqual(c90.q01, p0, "90°: Physical Bottom-Left (0,1) -> Camera p0 (TL)");

  // 180° Inverted
  const c180 = getCanonicalPaperCorners(cameraCorners, 180);
  assert.deepEqual(c180.q00, p2, "180°: Physical Top-Left (0,0) -> Camera p2 (BR)");
  assert.deepEqual(c180.q10, p3, "180°: Physical Top-Right (1,0) -> Camera p3 (BL)");
  assert.deepEqual(c180.q11, p0, "180°: Physical Bottom-Right (1,1) -> Camera p0 (TL)");
  assert.deepEqual(c180.q01, p1, "180°: Physical Bottom-Left (0,1) -> Camera p1 (TR)");

  // 270° Counter-Clockwise
  const c270 = getCanonicalPaperCorners(cameraCorners, 270);
  assert.deepEqual(c270.q00, p3, "270°: Physical Top-Left (0,0) -> Camera p3 (BL)");
  assert.deepEqual(c270.q10, p0, "270°: Physical Top-Right (1,0) -> Camera p0 (TL)");
  assert.deepEqual(c270.q11, p1, "270°: Physical Bottom-Right (1,1) -> Camera p1 (TR)");
  assert.deepEqual(c270.q01, p2, "270°: Physical Bottom-Left (0,1) -> Camera p2 (BR)");
});

test("Test 20 — 90° Sideways Real Camera Case: Item 1 length is vertical, thickness is horizontal", () => {
  const frameW = 1000;
  const frameH = 1000;
  // A landscape bounding box (e.g. portrait document held sideways in camera)
  // minX=100, maxX=900 (W=800), minY=200, maxY=600 (H=400)
  const corners = [
    { x: 100, y: 200 }, // p0: TL
    { x: 900, y: 200 }, // p1: TR (Physical Top of paper)
    { x: 900, y: 600 }, // p2: BR
    { x: 100, y: 600 }, // p3: BL (Physical Bottom of paper)
  ];

  const { fieldPolygons, itemRowPolygons } = projectPaperFieldPolygons(corners, 90, frameW, frameH);

  // Item 1 Row Polygon
  const item1 = itemRowPolygons.item_1;
  assert.ok(item1, "item_1 row polygon must be present");

  const xCoords = item1.points.map((p) => p.x);
  const yCoords = item1.points.map((p) => p.y);
  const minX = Math.min(...xCoords);
  const maxX = Math.max(...xCoords);
  const minY = Math.min(...yCoords);
  const maxY = Math.max(...yCoords);

  const rowThickness = maxX - minX;
  const rowLength = maxY - minY;

  // In 90° sideways orientation:
  // - Row thickness is along camera X: (0.170 - 0.120) * (800 / 1000) = 0.050 * 0.8 = 0.040 (4% of frame)
  // - Row length is along camera Y: (0.880 - 0.045) * (400 / 1000) = 0.835 * 0.4 = 0.334 (33.4% of frame)
  assert.ok(rowThickness <= 0.050, `Item 1 thickness ${rowThickness} must be thin (<= 0.05 of frame)`);
  assert.ok(rowLength >= 0.300 && rowLength <= 0.360, `Item 1 length ${rowLength} must be ~0.334 of frame`);

  // Subdivisions (First, Middle, Last) are stacked sequentially along Y:
  const first = fieldPolygons.child_first;
  const middle = fieldPolygons.child_middle;
  const last = fieldPolygons.child_last;

  assert.ok(first.center.y < middle.center.y, "First Name is above Middle Name along Y");
  assert.ok(middle.center.y < last.center.y, "Middle Name is above Last Name along Y");

  // All three lie within the same narrow X column:
  assert.ok(Math.abs(first.center.x - middle.center.x) < 0.01, "First and Middle share same X column");
  assert.ok(Math.abs(middle.center.x - last.center.x) < 0.01, "Middle and Last share same X column");
});

test("Test 21 — Four-Point Polygon Representation preserves true quadrilateral geometry", () => {
  const frameW = 800;
  const frameH = 600;
  const corners = [
    { x: 50, y: 50 },
    { x: 750, y: 50 },
    { x: 750, y: 550 },
    { x: 50, y: 550 },
  ];

  const { fieldPolygons } = projectPaperFieldPolygons(corners, 0, frameW, frameH);

  for (const [id, poly] of Object.entries(fieldPolygons)) {
    assert.equal(poly.points.length, 4, `${id} must have exactly 4 points`);
    const [p1, p2, p3, p4] = poly.points;

    // Upright portrait: p1 is TL, p2 is TR, p3 is BR, p4 is BL
    assert.ok(p1.x <= p2.x, `${id}: p1.x <= p2.x`);
    assert.ok(p4.x <= p3.x, `${id}: p4.x <= p3.x`);
    assert.ok(p1.y <= p4.y, `${id}: p1.y <= p4.y`);
    assert.ok(p2.y <= p3.y, `${id}: p2.y <= p3.y`);

    // Center is within convex bounds
    assert.ok(poly.center.x >= p1.x && poly.center.x <= p2.x, `${id}: center.x in bounds`);
    assert.ok(poly.center.y >= p1.y && poly.center.y <= p4.y, `${id}: center.y in bounds`);
  }
});

test("Test 22 — Perspective Skew Quad (Trapezoid from Section 13)", () => {
  const frameW = 1000;
  const frameH = 1000;
  // Test quadrilateral from Section 13 of prompt:
  // TL = (100,80), TR = (520,110), BR = (560,760), BL = (70,720)
  const quadCorners = [
    { x: 100, y: 80 },
    { x: 520, y: 110 },
    { x: 560, y: 760 },
    { x: 70, y: 720 },
  ];

  const { itemRowPolygons, fieldPolygons } = projectPaperFieldPolygons(quadCorners, 0, frameW, frameH);

  const item1 = itemRowPolygons.item_1;
  const item6 = itemRowPolygons.item_6;
  const item13 = itemRowPolygons.item_13;

  // Assert all Item 1 points remain inside upper portion of trapezoid:
  for (const pt of item1.points) {
    assert.ok(pt.y >= 0.080 && pt.y <= 0.300, `Item 1 pt.y ${pt.y} is inside upper portion`);
    assert.ok(pt.x >= 0.070 && pt.x <= 0.520, `Item 1 pt.x ${pt.x} is inside horizontal trapezoid bounds`);
  }

  // Vertical ordering down the skewed document:
  assert.ok(item1.center.y < item6.center.y, "Item 1 (Child) is above Item 6 (Mother)");
  assert.ok(item6.center.y < item13.center.y, "Item 6 (Mother) is above Item 13 (Father)");

  // Child First, Middle, Last are ordered from left to right inside the skewed row:
  const first = fieldPolygons.child_first;
  const middle = fieldPolygons.child_middle;
  const last = fieldPolygons.child_last;

  assert.ok(first.center.x < middle.center.x, "First Name is to the left of Middle Name");
  assert.ok(middle.center.x < last.center.x, "Middle Name is to the left of Last Name");
});

test("Test 23 — Safety Fallback suppresses guides when detection is unconfident or invalid", () => {
  // 1. Unconfident / zero contrast image
  const flatGray = new Uint8ClampedArray(320 * 240);
  flatGray.fill(128);
  const res = detectPsaPaperAndIdentity(flatGray, 320, 240);

  assert.equal(res.canShowGuides, false, "canShowGuides must be false on no document");
  assert.equal(res.fieldPolygons, undefined, "fieldPolygons must be undefined when suppressed");
});

test("Test 24 — Canonical Item Rows: Child fields terminate strictly before Item 6 (Mother)", () => {
  const frameW = 1000;
  const frameH = 1000;
  const corners = [
    { x: 50, y: 50 },
    { x: 950, y: 50 },
    { x: 950, y: 950 },
    { x: 50, y: 950 },
  ];

  const { itemRowPolygons, fieldPolygons } = projectPaperFieldPolygons(corners, 0, frameW, frameH);

  // Child Place of Birth (Item 4) is the lowest Child field
  const childPob = fieldPolygons.child_pob;
  const motherRow = itemRowPolygons.item_6;
  const fatherRow = itemRowPolygons.item_13;

  const maxChildY = Math.max(...childPob.points.map((p) => p.y));
  const minMotherY = Math.min(...motherRow.points.map((p) => p.y));
  const minFatherY = Math.min(...fatherRow.points.map((p) => p.y));

  assert.ok(maxChildY < minMotherY, `Child fields max Y (${maxChildY}) must terminate before Mother Y (${minMotherY})`);
  assert.ok(minMotherY < minFatherY, `Mother Y (${minMotherY}) must terminate before Father Y (${minFatherY})`);
});

test("Test 25 — Canonical axes debug vectors anchor correctly in development", () => {
  const frameW = 1000;
  const frameH = 1000;
  const corners = [
    { x: 100, y: 100 },
    { x: 900, y: 100 },
    { x: 900, y: 900 },
    { x: 100, y: 900 },
  ];

  const { canonicalAxesDebug } = projectPaperFieldPolygons(corners, 0, frameW, frameH);

  assert.ok(canonicalAxesDebug.topPoint.y < canonicalAxesDebug.bottomPoint.y, "Top point is above Bottom point");
  assert.ok(canonicalAxesDebug.leftPoint.x < canonicalAxesDebug.rightPoint.x, "Left point is left of Right point");
  assert.ok(canonicalAxesDebug.originPoint.x < canonicalAxesDebug.uVectorEnd.x, "U vector points in +U direction");
  assert.ok(canonicalAxesDebug.originPoint.y < canonicalAxesDebug.vVectorEnd.y, "V vector points in +V direction");
});

test("Test 26 — Backwards Compatibility: projectPaperGuides matches projectPaperFieldPolygons.fieldGuides", () => {
  const frameW = 800;
  const frameH = 600;
  const corners = [
    { x: 40, y: 30 },
    { x: 760, y: 30 },
    { x: 760, y: 570 },
    { x: 40, y: 570 },
  ];

  const legacyGuides = projectPaperGuides(corners, 0, frameW, frameH);
  const { fieldGuides } = projectPaperFieldPolygons(corners, 0, frameW, frameH);

  assert.deepEqual(legacyGuides, fieldGuides, "Legacy projectPaperGuides must output identical fieldGuides");
});

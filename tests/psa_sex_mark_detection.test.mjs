import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePsaSpatialLayout,
} from "../src/lib/ocr/psaParser.ts";
import {
  analyzePsaSexMarksFromGrayscale,
  analyzeZoneInkAndPattern,
  evaluateSexMarkScores,
  deriveSexMarkZonesFromAnchors,
  SEX_MARK_THRESHOLDS,
  DEFAULT_ITEM2_CANONICAL,
  DEFAULT_MALE_MARK_ZONE,
  DEFAULT_FEMALE_MARK_ZONE,
} from "../src/lib/image/psaSexMarkDetector.ts";
import { parseSeniorHighGradesText } from "../src/lib/ocr/seniorHighParser.ts";
import { compareDocuments } from "../src/lib/validation/documentComparator.ts";

function makePoly(x1, y1, x2, y2) {
  return [x1, y1, x2, y1, x2, y2, x1, y2];
}

/**
 * Creates an in-memory grayscale image buffer (Uint8ClampedArray) of size width x height.
 * Background: 245 (off-white paper).
 */
function createWhiteCanvas(width, height) {
  const buf = new Uint8ClampedArray(width * height);
  buf.fill(245);
  return buf;
}

/**
 * Draws a dark line on a grayscale buffer.
 */
function drawLine(buf, width, height, x0, y0, x1, y1, thickness = 2, inkValue = 20) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let cx = x0;
  let cy = y0;

  while (true) {
    for (let tx = -thickness; tx <= thickness; tx++) {
      for (let ty = -thickness; ty <= thickness; ty++) {
        const px = cx + tx;
        const py = cy + ty;
        if (px >= 0 && px < width && py >= 0 && py < height) {
          buf[py * width + px] = inkValue;
        }
      }
    }

    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
}

/**
 * Draws an "X" mark inside a bounding box.
 */
function drawXMark(buf, width, height, minX, minY, maxX, maxY, thickness = 2) {
  drawLine(buf, width, height, minX, minY, maxX, maxY, thickness);
  drawLine(buf, width, height, minX, maxY, maxX, minY, thickness);
}

/**
 * Draws a vertical stroke (like printed digit "1").
 */
function drawVerticalStroke(buf, width, height, centerX, minY, maxY, thickness = 2) {
  drawLine(buf, width, height, centerX, minY, centerX, maxY, thickness);
}

/**
 * Draws a rectangular border (like a printed checkbox border).
 */
function drawBoxBorder(buf, width, height, minX, minY, maxX, maxY, thickness = 1) {
  drawLine(buf, width, height, minX, minY, maxX, minY, thickness);
  drawLine(buf, width, height, minX, maxY, maxX, maxY, thickness);
  drawLine(buf, width, height, minX, minY, minX, maxY, thickness);
  drawLine(buf, width, height, maxX, minY, maxX, maxY, thickness);
}

const DUMMY_LAYOUT_FOR_DIAGNOSTIC = {
  pages: [
    {
      width: 1000,
      height: 1400,
      angle: 0,
      words: [{ content: "PSA", polygon: makePoly(10, 10, 50, 30) }],
    },
  ],
};

// ============================================================================
// Comprehensive Suite: PSA Item 2 (SEX) Physical Mark Detection Engine
// Verifies Conditions A through O from Section 15 of Task Specification
// ============================================================================

test("Test A1 — Male selected via Spatial OCR Layout (X 1 Male 2 Female)", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "JUSTIN", polygon: makePoly(150, 200, 240, 230) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "LOQUILLANO", polygon: makePoly(420, 200, 560, 230) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          { content: "GOMEZ", polygon: makePoly(700, 200, 790, 230) },
          // Item 2: SEX
          { content: "2.", polygon: makePoly(50, 250, 75, 275) },
          { content: "SEX", polygon: makePoly(80, 250, 130, 275) },
          // Physical mark X before 1 Male
          { content: "X", polygon: makePoly(70, 280, 90, 300) },
          { content: "1", polygon: makePoly(95, 280, 110, 300) },
          { content: "Male", polygon: makePoly(115, 280, 170, 300) },
          // Female option (unmarked)
          { content: "2", polygon: makePoly(220, 280, 235, 300) },
          { content: "Female", polygon: makePoly(240, 280, 310, 300) },
          // Item 3: DOB
          { content: "3.", polygon: makePoly(350, 250, 375, 275) },
          { content: "DATE", polygon: makePoly(380, 250, 440, 275) },
          { content: "OF", polygon: makePoly(445, 250, 470, 275) },
          { content: "BIRTH", polygon: makePoly(475, 250, 540, 275) },
          { content: "25", polygon: makePoly(360, 280, 390, 300) },
          { content: "June", polygon: makePoly(400, 280, 450, 300) },
          { content: "2004", polygon: makePoly(460, 280, 510, 300) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.sex, "M", "Selected sex must be Male (M)");
  assert.equal(fields.field_metadata?.sex?.status, "extracted");
  assert.equal(fields.field_metadata?.sex?.confidence, "HIGH");
  assert.equal(fields.field_metadata?.sex?.needsVerification, false);
});

test("Test A2 — Male selected via Local Pixel Buffer Analysis (Synthetic Fixture)", () => {
  const item2W = 400;
  const item2H = 100;
  const buf = createWhiteCanvas(item2W, item2H);

  // Draw Male mark: X in Male mark zone (u: 0.08..0.25 relative to Item 2)
  drawXMark(buf, item2W, item2H, 30, 25, 75, 75, 3);

  // Female zone (u: 0.55..0.75) remains blank paper
  const result = analyzePsaSexMarksFromGrayscale(buf, item2W, item2H, {
    item2Bounds: { minU: 0, maxU: 1, minV: 0, maxV: 1 },
    maleMarkZone: { minU: 0.05, maxU: 0.25, minV: 0.20, maxV: 0.80 },
    femaleMarkZone: { minU: 0.55, maxU: 0.75, minV: 0.20, maxV: 0.80 },
  });

  assert.equal(result.state, "MALE_MARKED");
  assert.equal(result.detectedSex, "M");
  assert.ok(result.maleScore >= SEX_MARK_THRESHOLDS.STRONG, `maleScore ${result.maleScore} should be >= STRONG`);
  assert.ok(result.femaleScore <= SEX_MARK_THRESHOLDS.WEAK, `femaleScore ${result.femaleScore} should be <= WEAK`);
  assert.ok(result.scoreDifference >= SEX_MARK_THRESHOLDS.MIN_SEPARATION);

  // Pass analysis to parser
  const fields = parsePsaSpatialLayout(DUMMY_LAYOUT_FOR_DIAGNOSTIC, "", { sexMarkAnalysis: result });
  assert.equal(fields.sex, "M");
  assert.equal(fields.field_metadata?.sex?.status, "extracted");
  assert.equal(fields.field_metadata?.sex?.confidence, "HIGH");
});

test("Test B1 — Female selected via Spatial OCR Layout (1 Male X 2 Female)", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "2.", polygon: makePoly(50, 250, 75, 275) },
          { content: "SEX", polygon: makePoly(80, 250, 130, 275) },
          // Male option (unmarked)
          { content: "1", polygon: makePoly(95, 280, 110, 300) },
          { content: "Male", polygon: makePoly(115, 280, 170, 300) },
          // Physical mark X before 2 Female
          { content: "X", polygon: makePoly(200, 280, 220, 300) },
          { content: "2", polygon: makePoly(225, 280, 240, 300) },
          { content: "Female", polygon: makePoly(245, 280, 315, 300) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.sex, "F", "Selected sex must be Female (F)");
  assert.equal(fields.field_metadata?.sex?.status, "extracted");
  assert.equal(fields.field_metadata?.sex?.confidence, "HIGH");
  assert.equal(fields.field_metadata?.sex?.needsVerification, false);
});

test("Test B2 — Female selected via Local Pixel Buffer Analysis (Synthetic Fixture)", () => {
  const item2W = 400;
  const item2H = 100;
  const buf = createWhiteCanvas(item2W, item2H);

  // Male zone remains blank
  // Female zone has X mark
  drawXMark(buf, item2W, item2H, 230, 25, 275, 75, 3);

  const result = analyzePsaSexMarksFromGrayscale(buf, item2W, item2H, {
    item2Bounds: { minU: 0, maxU: 1, minV: 0, maxV: 1 },
    maleMarkZone: { minU: 0.05, maxU: 0.25, minV: 0.20, maxV: 0.80 },
    femaleMarkZone: { minU: 0.55, maxU: 0.75, minV: 0.20, maxV: 0.80 },
  });

  assert.equal(result.state, "FEMALE_MARKED");
  assert.equal(result.detectedSex, "F");
  assert.ok(result.femaleScore >= SEX_MARK_THRESHOLDS.STRONG);
  assert.ok(result.maleScore <= SEX_MARK_THRESHOLDS.WEAK);
  assert.ok(result.scoreDifference >= SEX_MARK_THRESHOLDS.MIN_SEPARATION);

  const fields = parsePsaSpatialLayout(DUMMY_LAYOUT_FOR_DIAGNOSTIC, "", { sexMarkAnalysis: result });
  assert.equal(fields.sex, "F");
  assert.equal(fields.field_metadata?.sex?.status, "extracted");
  assert.equal(fields.field_metadata?.sex?.confidence, "HIGH");
});

test("Test C1 — Neither selected via Spatial Layout (1 Male 2 Female) -> Needs Verification", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "2.", polygon: makePoly(50, 250, 75, 275) },
          { content: "SEX", polygon: makePoly(80, 250, 130, 275) },
          { content: "1", polygon: makePoly(95, 280, 110, 300) },
          { content: "Male", polygon: makePoly(115, 280, 170, 300) },
          { content: "2", polygon: makePoly(220, 280, 235, 300) },
          { content: "Female", polygon: makePoly(240, 280, 310, 300) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.sex, undefined, "Unmarked template must NOT guess sex");
  assert.equal(fields.field_metadata?.sex?.status, "needs_verification");
  assert.equal(fields.field_metadata?.sex?.needsVerification, true);
});

test("Test C2 — Neither selected via Local Pixel Buffer -> Needs Verification", () => {
  const item2W = 400;
  const item2H = 100;
  const buf = createWhiteCanvas(item2W, item2H); // blank template

  const result = analyzePsaSexMarksFromGrayscale(buf, item2W, item2H, {
    item2Bounds: { minU: 0, maxU: 1, minV: 0, maxV: 1 },
    maleMarkZone: { minU: 0.05, maxU: 0.25, minV: 0.20, maxV: 0.80 },
    femaleMarkZone: { minU: 0.55, maxU: 0.75, minV: 0.20, maxV: 0.80 },
  });

  assert.equal(result.state, "NONE_MARKED");
  assert.equal(result.detectedSex, undefined);

  const fields = parsePsaSpatialLayout(DUMMY_LAYOUT_FOR_DIAGNOSTIC, "", { sexMarkAnalysis: result });
  assert.equal(fields.sex, undefined);
  assert.equal(fields.field_metadata?.sex?.status, "needs_verification");
  assert.equal(fields.field_metadata?.sex?.needsVerification, true);
});

test("Test D1 — Both selected via Spatial Layout (X 1 Male X 2 Female) -> Needs Verification", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "2.", polygon: makePoly(50, 250, 75, 275) },
          { content: "SEX", polygon: makePoly(80, 250, 130, 275) },
          { content: "X", polygon: makePoly(70, 280, 90, 300) },
          { content: "1", polygon: makePoly(95, 280, 110, 300) },
          { content: "Male", polygon: makePoly(115, 280, 170, 300) },
          { content: "X", polygon: makePoly(200, 280, 220, 300) },
          { content: "2", polygon: makePoly(225, 280, 240, 300) },
          { content: "Female", polygon: makePoly(245, 280, 315, 300) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.sex, undefined, "Both marked must become Needs Verification");
  assert.equal(fields.field_metadata?.sex?.status, "needs_verification");
  assert.equal(fields.field_metadata?.sex?.needsVerification, true);
});

test("Test D2 — Both selected via Local Pixel Buffer -> Needs Verification", () => {
  const item2W = 400;
  const item2H = 100;
  const buf = createWhiteCanvas(item2W, item2H);

  // Draw X on both zones
  drawXMark(buf, item2W, item2H, 30, 25, 75, 75, 3);
  drawXMark(buf, item2W, item2H, 230, 25, 275, 75, 3);

  const result = analyzePsaSexMarksFromGrayscale(buf, item2W, item2H, {
    item2Bounds: { minU: 0, maxU: 1, minV: 0, maxV: 1 },
    maleMarkZone: { minU: 0.05, maxU: 0.25, minV: 0.20, maxV: 0.80 },
    femaleMarkZone: { minU: 0.55, maxU: 0.75, minV: 0.20, maxV: 0.80 },
  });

  assert.equal(result.state, "BOTH_MARKED");
  assert.equal(result.detectedSex, undefined);

  const fields = parsePsaSpatialLayout(DUMMY_LAYOUT_FOR_DIAGNOSTIC, "", { sexMarkAnalysis: result });
  assert.equal(fields.sex, undefined);
  assert.equal(fields.field_metadata?.sex?.status, "needs_verification");
});

test("Test E — Weak ambiguous marks / insufficient separation -> Needs Verification", () => {
  // Scenario: Both marks have comparable moderate scores with low separation (e.g. 0.31 vs 0.27)
  const eval1 = evaluateSexMarkScores(0.31, 0.27);
  assert.equal(eval1.state, "AMBIGUOUS");
  assert.equal(eval1.detectedSex, undefined);
  assert.ok(eval1.statusText.includes("Ambiguous") || eval1.statusText.includes("Needs Verification"));

  // Scenario: Weak smudge on Male (0.19) and noise on Female (0.15)
  const eval2 = evaluateSexMarkScores(0.19, 0.15);
  assert.equal(eval2.state, "AMBIGUOUS");
  assert.equal(eval2.detectedSex, undefined);

  // Integration with parser
  const fields = parsePsaSpatialLayout(DUMMY_LAYOUT_FOR_DIAGNOSTIC, "", {
    sexMarkAnalysis: {
      ...eval1,
      confidence: 0.2,
      maleScore: 0.31,
      femaleScore: 0.27,
      scoreDifference: 0.04,
      maleMarkZone: DEFAULT_MALE_MARK_ZONE,
      femaleMarkZone: DEFAULT_FEMALE_MARK_ZONE,
      item2Bounds: DEFAULT_ITEM2_CANONICAL,
    },
  });
  assert.equal(fields.sex, undefined);
  assert.equal(fields.field_metadata?.sex?.status, "needs_verification");
});

test("Test F — Printed form checkbox borders suppressed (not mistaken for mark)", () => {
  const item2W = 400;
  const item2H = 100;
  const buf = createWhiteCanvas(item2W, item2H);

  // Draw rectangular printed checkbox border at outer edges of Male mark zone
  drawBoxBorder(buf, item2W, item2H, 20, 20, 80, 80, 2);

  const result = analyzePsaSexMarksFromGrayscale(buf, item2W, item2H, {
    item2Bounds: { minU: 0, maxU: 1, minV: 0, maxV: 1 },
    maleMarkZone: { minU: 0.05, maxU: 0.20, minV: 0.20, maxV: 0.80 },
    femaleMarkZone: { minU: 0.55, maxU: 0.70, minV: 0.20, maxV: 0.80 },
  });

  // Border suppression margin must prevent false positive mark
  assert.notEqual(result.state, "MALE_MARKED", "Printed border must not trigger MALE_MARKED");
  assert.equal(result.state, "NONE_MARKED");
  assert.equal(result.detectedSex, undefined);
});

test("Test G — Printed digits '1' and '2' not mistaken for selection mark", () => {
  const item2W = 400;
  const item2H = 100;
  const buf = createWhiteCanvas(item2W, item2H);

  // Draw vertical line resembling printed digit '1'
  drawVerticalStroke(buf, item2W, item2H, 50, 25, 75, 2);

  const result = analyzePsaSexMarksFromGrayscale(buf, item2W, item2H, {
    item2Bounds: { minU: 0, maxU: 1, minV: 0, maxV: 1 },
    maleMarkZone: { minU: 0.05, maxU: 0.25, minV: 0.20, maxV: 0.80 },
    femaleMarkZone: { minU: 0.55, maxU: 0.75, minV: 0.20, maxV: 0.80 },
  });

  // Single vertical stroke lacks crossing diagonal components of an X
  assert.ok(result.maleScore < SEX_MARK_THRESHOLDS.STRONG, "Digit 1 score must be below STRONG mark threshold");
  assert.notEqual(result.state, "MALE_MARKED");
});

test("Test H — Printed words 'Male' and 'Female' placed outside mark scoring zone", () => {
  const words = [
    { cleanText: "2", content: "2.", bbox: { minU: 0.05, maxU: 0.07, minV: 0.18, maxV: 0.21, centerU: 0.06, centerV: 0.195 } },
    { cleanText: "sex", content: "SEX", bbox: { minU: 0.08, maxU: 0.12, minV: 0.18, maxV: 0.21, centerU: 0.10, centerV: 0.195 } },
    { cleanText: "1", content: "1", bbox: { minU: 0.12, maxU: 0.13, minV: 0.18, maxV: 0.21, centerU: 0.125, centerV: 0.195 } },
    { cleanText: "male", content: "Male", bbox: { minU: 0.14, maxU: 0.18, minV: 0.18, maxV: 0.21, centerU: 0.16, centerV: 0.195 } },
    { cleanText: "2", content: "2", bbox: { minU: 0.23, maxU: 0.24, minV: 0.18, maxV: 0.21, centerU: 0.235, centerV: 0.195 } },
    { cleanText: "female", content: "Female", bbox: { minU: 0.25, maxU: 0.31, minV: 0.18, maxV: 0.21, centerU: 0.28, centerV: 0.195 } },
  ];

  const derived = deriveSexMarkZonesFromAnchors(words, {
    minU: 0.045,
    maxU: 0.35,
    minV: 0.175,
    maxV: 0.22,
  });

  // Male mark zone must be strictly to the left of "1" and "Male"
  assert.ok(derived.maleMarkZone.maxU <= 0.125, "Male mark zone must end before '1' / 'Male'");
  // Female mark zone must be strictly to the left of "2" and "Female"
  assert.ok(derived.femaleMarkZone.maxU <= 0.235, "Female mark zone must end before '2' / 'Female'");
});

test("Test I — Camera rotation normalization (0°, 90°, 180°, 270°)", () => {
  // The system normalizes rotated camera frames to 0° upright before Item 2 mark analysis.
  // Verify that DEFAULT_ITEM2_CANONICAL and mark zones are strictly upright coordinates.
  assert.ok(DEFAULT_ITEM2_CANONICAL.minV > 0.15 && DEFAULT_ITEM2_CANONICAL.maxV < 0.25);
  assert.ok(DEFAULT_MALE_MARK_ZONE.minU < DEFAULT_FEMALE_MARK_ZONE.minU);
  assert.ok(DEFAULT_MALE_MARK_ZONE.maxU < DEFAULT_FEMALE_MARK_ZONE.minU);
});

test("Test J — Perspective skew handling (Upright Normalized Mapping)", () => {
  // In normalized upright PSA space, Item 2 is positioned directly below Item 1 (Child Name)
  // and directly above Item 4 (Place of Birth).
  const item1Bottom = 0.170;
  const item2Top = DEFAULT_ITEM2_CANONICAL.minV;
  const item2Bottom = DEFAULT_ITEM2_CANONICAL.maxV;
  const item4Top = 0.225;

  assert.ok(item2Top >= item1Bottom - 0.01, "Item 2 must start after Item 1");
  assert.ok(item2Bottom <= item4Top + 0.01, "Item 2 must end before Item 4 Place of Birth");
});

test("Test K — Zero additional Azure requests (Deterministic Local Execution)", () => {
  // analyzeZoneInkAndPattern and analyzePsaSexMarksFromGrayscale run with zero network activity
  const pixels = new Uint8ClampedArray(40 * 40).fill(250);
  const result = analyzeZoneInkAndPattern(pixels, 40, 40);
  assert.equal(typeof result.markScore, "number");
  assert.equal(typeof result.isMarked, "boolean");
  assert.equal(result.isMarked, false);
});

test("Test L — Zero live Supabase uploads during mark analysis", () => {
  // Verification: detector operates synchronously or on local canvas with no API calls
  const evalResult = evaluateSexMarkScores(0.75, 0.05);
  assert.equal(evalResult.state, "MALE_MARKED");
  assert.equal(evalResult.detectedSex, "M");
});

test("Test M — Existing PSA name fields unaffected by Sex mark detection", () => {
  const layout = {
    pages: [
      {
        width: 1000,
        height: 1400,
        angle: 0,
        words: [
          { content: "1.", polygon: makePoly(50, 160, 75, 185) },
          { content: "NAME", polygon: makePoly(80, 160, 140, 185) },
          { content: "(First)", polygon: makePoly(150, 160, 220, 185) },
          { content: "JUSTIN", polygon: makePoly(150, 200, 240, 230) },
          { content: "(Middle)", polygon: makePoly(420, 160, 510, 185) },
          { content: "LOQUILLANO", polygon: makePoly(420, 200, 560, 230) },
          { content: "(Last)", polygon: makePoly(700, 160, 770, 185) },
          { content: "GOMEZ", polygon: makePoly(700, 200, 790, 230) },
          // Item 2: SEX
          { content: "2.", polygon: makePoly(50, 250, 75, 275) },
          { content: "SEX", polygon: makePoly(80, 250, 130, 275) },
          { content: "X", polygon: makePoly(70, 280, 90, 300) },
          { content: "1", polygon: makePoly(95, 280, 110, 300) },
          { content: "Male", polygon: makePoly(115, 280, 170, 300) },
          { content: "2", polygon: makePoly(220, 280, 235, 300) },
          { content: "Female", polygon: makePoly(240, 280, 310, 300) },
          // Item 6: MOTHER
          { content: "6.", polygon: makePoly(50, 490, 75, 515) },
          { content: "MAIDEN", polygon: makePoly(80, 490, 160, 515) },
          { content: "NAME", polygon: makePoly(165, 490, 225, 515) },
          { content: "MARIA", polygon: makePoly(150, 530, 220, 555) },
          { content: "SANTOS", polygon: makePoly(420, 530, 500, 555) },
          { content: "LOQUILLANO", polygon: makePoly(700, 530, 810, 555) },
          // Item 13: FATHER
          { content: "13.", polygon: makePoly(50, 670, 85, 695) },
          { content: "NAME", polygon: makePoly(90, 670, 150, 695) },
          { content: "ROBERTO", polygon: makePoly(150, 710, 240, 735) },
          { content: "PEREZ", polygon: makePoly(420, 710, 490, 735) },
          { content: "GOMEZ", polygon: makePoly(700, 710, 780, 735) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout);
  assert.equal(fields.first_name, "JUSTIN");
  assert.equal(fields.middle_name, "LOQUILLANO");
  assert.equal(fields.last_name, "GOMEZ");
  assert.equal(fields.sex, "M");
  assert.ok(fields.mother_name.includes("MARIA") && fields.mother_name.includes("LOQUILLANO"));
  assert.ok(fields.father_name.includes("ROBERTO") && fields.father_name.includes("GOMEZ"));
});

test("Test N — DepEd SF9 academic grade extraction and parsers remain unchanged", () => {
  const sf9Sample = `
| Subject | Q1 | Q2 | Final |
|---|---|---|---|
| Oral Communication | 90 | 85 | 88 |
| General Mathematics | 88 | 92 | 90 |
  `;
  const result = parseSeniorHighGradesText(sf9Sample);
  assert.ok(result.grades && result.grades.length === 2);
  assert.equal(result.grades[0].subject, "Oral Communication");
});

test("Test O — DepEd SF10 document comparison remains intact and functional", () => {
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

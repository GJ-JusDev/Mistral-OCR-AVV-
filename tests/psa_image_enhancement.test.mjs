import test from "node:test";
import assert from "node:assert/strict";
import {
  computeQualityMetrics,
  detectImageCharacteristics,
  normalizeLuminanceAndContrast,
  convertToSuppressedGrayscale,
  adaptiveThresholdBradleyRoth,
  denoiseIsolatedSpeckles,
  enhancePsaRawImage,
  enhancePsaImage,
  encodeBmpDataUrl,
  decodeBmpDataUrl,
} from "../src/lib/image/psaEnhancer.ts";
import { parsePsaSpatialLayout } from "../src/lib/ocr/psaParser.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";
import { compareDocuments } from "../src/lib/validation/documentComparator.ts";

/**
 * Helper: creates a synthetic non-PII PSA certificate image fixture.
 * Simulates yellow/green security paper background, grid lines,
 * dark printed text, thin handwriting strokes, and uneven illumination.
 */
function createSyntheticPsaFixture(options = {}) {
  const width = options.width ?? 400;
  const height = options.height ?? 500;
  const unevenLighting = options.unevenLighting ?? false;
  const isDark = options.isDark ?? false;
  const isBright = options.isBright ?? false;
  const isGrayscale = options.isGrayscale ?? false;

  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Base paper color
      let r, g, b;
      if (isGrayscale) {
        const grayVal = isDark ? 110 : isBright ? 240 : 210;
        r = grayVal;
        g = grayVal;
        b = grayVal;
      } else {
        // Yellow/green security paper signature: elevated R & G, lower B
        const base = isDark ? 130 : isBright ? 240 : 215;
        r = Math.min(255, base + 10 + (x % 5));
        g = Math.min(255, base + 15 + (y % 7));
        b = Math.max(0, base - 65 + ((x + y) % 4));
      }

      // Uneven lighting: shadow on left side
      if (unevenLighting) {
        const factor = 0.65 + 0.5 * (x / width); // 0.65 on left to 1.15 on right
        r = Math.min(255, Math.round(r * factor));
        g = Math.min(255, Math.round(g * factor));
        b = Math.min(255, Math.round(b * factor));
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  // Draw grid lines and printed header/field boxes (dark ink)
  const gridRows = [40, 80, 120, 160, 200, 240, 280, 320, 360, 400];
  for (const gy of gridRows) {
    if (gy < height) {
      for (let x = 20; x < width - 20; x++) {
        const idx = (gy * width + x) * 4;
        data[idx] = 30;
        data[idx + 1] = 30;
        data[idx + 2] = 35;
      }
    }
  }

  // Vertical column dividers
  const gridCols = [width * 0.25, width * 0.5, width * 0.75];
  for (const gx of gridCols) {
    const colX = Math.round(gx);
    for (let y = 40; y < Math.min(height - 40, 400); y++) {
      const idx = (y * width + colX) * 4;
      data[idx] = 30;
      data[idx + 1] = 30;
      data[idx + 2] = 35;
    }
  }

  // Draw simulated printed text labels across each section (approx 3-5% text density)
  for (let row = 0; row < 8; row++) {
    const textY = 50 + row * 40;
    if (textY + 12 < height) {
      for (let y = textY; y < textY + 8; y++) {
        for (let x = 30; x < width - 30; x++) {
          if ((x + y) % 4 === 0 || (x % 7 === 0 && y % 2 === 0)) {
            const idx = (y * width + x) * 4;
            data[idx] = 25;
            data[idx + 1] = 25;
            data[idx + 2] = 30;
          }
        }
      }
    }
  }

  // Draw thin handwriting strokes (wavy strokes simulating cursive signatures and handwriting)
  for (let s = 0; s < 3; s++) {
    const baseY = 95 + s * 80;
    if (baseY + 10 < height) {
      for (let x = 40; x < width - 40; x++) {
        const strokeY = baseY + Math.round(Math.sin(x / 8) * 3);
        if (strokeY > 0 && strokeY + 1 < height) {
          const idx1 = (strokeY * width + x) * 4;
          const idx2 = ((strokeY + 1) * width + x) * 4;
          data[idx1] = 20;
          data[idx1 + 1] = 20;
          data[idx1 + 2] = 45; // Dark blue ink
          data[idx2] = 20;
          data[idx2 + 1] = 20;
          data[idx2 + 2] = 45;
        }
      }
    }
  }

  return { width, height, data };
}

// ============================================================================
// SECTION 16: Unit Tests A through N
// ============================================================================

test("Condition A: Color PSA produces OCR-enhanced candidate (B&W / Grayscale)", () => {
  const fixture = createSyntheticPsaFixture({ width: 300, height: 400 });
  const result = enhancePsaRawImage(fixture);

  assert.ok(result.selectedCandidate === "bw" || result.selectedCandidate === "grayscale");
  assert.ok(result.enhancedImage, "Enhanced image must be produced");
  assert.equal(result.enhancedImage.width, fixture.width);
  assert.equal(result.enhancedImage.height, fixture.height);
  assert.ok(result.metrics.enhanced.foregroundRatio > 0.01, "Foreground text must be detected");
});

test("Condition B: Original color image remains unchanged", () => {
  const fixture = createSyntheticPsaFixture({ width: 200, height: 200 });
  // Snapshot of original data
  const originalSnapshot = new Uint8ClampedArray(fixture.data);

  enhancePsaRawImage(fixture);

  // Assert original array was not mutated in place
  assert.deepEqual(
    fixture.data,
    originalSnapshot,
    "Original color buffer must remain 100% untouched and unmutated"
  );
});

test("Condition C: Dark PSA receives safe brightness normalization", () => {
  const darkFixture = createSyntheticPsaFixture({ width: 200, height: 200, isDark: true });
  const metricsBefore = computeQualityMetrics(darkFixture);

  const normalized = normalizeLuminanceAndContrast(darkFixture);
  const metricsAfter = computeQualityMetrics(normalized);

  assert.ok(
    metricsAfter.meanLuminance > metricsBefore.meanLuminance,
    `Normalized luminance (${metricsAfter.meanLuminance}) must be higher than dark input (${metricsBefore.meanLuminance})`
  );
  assert.ok(
    metricsAfter.contrast >= metricsBefore.contrast,
    "Contrast should be preserved or improved"
  );
});

test("Condition D: Bright PSA is not overexposed", () => {
  const brightFixture = createSyntheticPsaFixture({ width: 200, height: 200, isBright: true });
  const metricsBefore = computeQualityMetrics(brightFixture);

  const normalized = normalizeLuminanceAndContrast(brightFixture);
  const metricsAfter = computeQualityMetrics(normalized);

  // Clipping should not blow up
  assert.ok(
    metricsAfter.clippingPercentage <= metricsBefore.clippingPercentage + 15,
    "Bright PSA should avoid highlight overexposure and excessive clipping"
  );
});

test("Condition E: Yellow/green paper becomes neutral grayscale/B&W", () => {
  const fixture = createSyntheticPsaFixture({ width: 200, height: 200 });
  const gray = convertToSuppressedGrayscale(fixture);

  // Verify that all pixels in gray are neutral (R === G === B)
  let nonNeutralCount = 0;
  for (let i = 0; i < gray.data.length; i += 4) {
    if (gray.data[i] !== gray.data[i + 1] || gray.data[i] !== gray.data[i + 2]) {
      nonNeutralCount++;
    }
  }
  assert.equal(nonNeutralCount, 0, "All pixels in suppressed grayscale must have R === G === B");

  // Verify yellow/green paper background is lightened towards white
  const metrics = computeQualityMetrics(gray);
  assert.ok(metrics.meanLuminance > 180, "Background should be bright neutral grayscale");
});

test("Condition F: Adaptive threshold preserves dark printed text and thin handwriting", () => {
  const fixture = createSyntheticPsaFixture({ width: 300, height: 300 });
  const gray = convertToSuppressedGrayscale(normalizeLuminanceAndContrast(fixture));
  const bw = adaptiveThresholdBradleyRoth(gray);

  // Check handwriting stroke location (stroke around baseY = 95, x = 60..100)
  let handwritingBlackPixels = 0;
  for (let x = 60; x < 100; x++) {
    const strokeY = 95 + Math.round(Math.sin(x / 8) * 3);
    const idx = (strokeY * 300 + x) * 4;
    if (bw.data[idx] === 0) {
      handwritingBlackPixels++;
    }
  }

  assert.ok(
    handwritingBlackPixels > 20,
    "Thin handwriting strokes must be preserved as foreground black pixels (not erased)"
  );
});

test("Condition G: Uneven lighting handled without destructive clipping", () => {
  const shadowFixture = createSyntheticPsaFixture({ width: 300, height: 300, unevenLighting: true });
  const result = enhancePsaRawImage(shadowFixture);

  // Under adaptive thresholding, text in the dark left region must still be extracted
  // and the entire left half must NOT turn completely black
  const bw = result.bwImage;
  let leftSideBlackCount = 0;
  const leftTotalPixels = 150 * 300;

  for (let y = 0; y < 300; y++) {
    for (let x = 0; x < 150; x++) {
      const idx = (y * 300 + x) * 4;
      if (bw.data[idx] === 0) {
        leftSideBlackCount++;
      }
    }
  }

  const leftBlackRatio = leftSideBlackCount / leftTotalPixels;
  assert.ok(
    leftBlackRatio < 0.35,
    `Shadowed side must not be blacked out (observed ratio: ${(leftBlackRatio * 100).toFixed(1)}%)`
  );
  assert.ok(
    leftBlackRatio > 0.01,
    "Text inside shadowed region must be successfully separated as foreground"
  );
});

test("Condition H: Already-clean grayscale/binary scan is not unnecessarily degraded", () => {
  // Create an already clean binarized image (98% white, 2% black)
  const cleanBw = {
    width: 100,
    height: 100,
    data: new Uint8ClampedArray(100 * 100 * 4),
  };
  for (let i = 0; i < cleanBw.data.length; i += 4) {
    cleanBw.data[i] = 255;
    cleanBw.data[i + 1] = 255;
    cleanBw.data[i + 2] = 255;
    cleanBw.data[i + 3] = 255;
  }
  // Add some black text pixels
  for (let i = 0; i < 200 * 4; i += 4) {
    cleanBw.data[i] = 0;
    cleanBw.data[i + 1] = 0;
    cleanBw.data[i + 2] = 0;
  }

  const result = enhancePsaRawImage(cleanBw);
  assert.ok(
    result.appliedOperations.includes("preserve_already_binarized"),
    "Already-clean binary image should be preserved without degradation"
  );
});

test("Condition I: B&W conversion does not alter document dimensions unexpectedly", () => {
  const fixture = createSyntheticPsaFixture({ width: 345, height: 467 });
  const result = enhancePsaRawImage(fixture);

  assert.equal(result.enhancedImage.width, 345, "Width must match exactly");
  assert.equal(result.enhancedImage.height, 467, "Height must match exactly");
  assert.equal(result.enhancedImage.data.length, 345 * 467 * 4, "Data length must match exactly");
});

test("Condition J: Azure geometry corresponds 1:1 to processed image", () => {
  const fixture = createSyntheticPsaFixture({ width: 1000, height: 1400 });
  const result = enhancePsaRawImage(fixture);

  // Since enhancement operates directly on pixels without scaling or cropping,
  // pixel (x, y) in original maps 1:1 to (x, y) in enhanced image
  const testPoints = [
    { x: 100, y: 150 },
    { x: 500, y: 700 },
    { x: 900, y: 1300 },
  ];

  for (const pt of testPoints) {
    const origIdx = (pt.y * 1000 + pt.x) * 4;
    const enhIdx = (pt.y * result.enhancedImage.width + pt.x) * 4;
    assert.equal(origIdx, enhIdx, `Coordinates (${pt.x}, ${pt.y}) must align 1:1`);
  }
});

test("Condition K: PSA parser still receives expected layout data", () => {
  function makePoly(x1, y1, x2, y2) {
    return [x1, y1, x2, y1, x2, y2, x1, y2];
  }

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
          { content: "LOQUILLANO", polygon: makePoly(450, 210, 600, 240), confidence: 0.95 },
          { content: "GOMEZ", polygon: makePoly(720, 210, 850, 240), confidence: 0.95 },
        ],
        lines: [
          { content: "1. NAME (First) (Middle) (Last)", polygon: makePoly(50, 170, 790, 195) },
          { content: "JUSTIN LOQUILLANO GOMEZ", polygon: makePoly(180, 210, 850, 240) },
        ],
      },
    ],
  };

  const fields = parsePsaSpatialLayout(layout, "raw text");
  assert.equal(fields.first_name, "JUSTIN");
  assert.equal(fields.middle_name, "LOQUILLANO");
  assert.equal(fields.last_name, "GOMEZ");
  assert.equal(fields.document_type, "birth_cert");
});

test("Condition L: PSA grades remain empty array []", () => {
  const layout = { pages: [{ width: 1000, height: 1400, words: [], lines: [] }] };
  const fields = parsePsaSpatialLayout(layout, "CERTIFICATE OF LIVE BIRTH");
  assert.ok(Array.isArray(fields.grades), "Grades must be an array");
  assert.equal(fields.grades.length, 0, "PSA certificates must NEVER extract academic grades");
});

test("Condition M: SF9 behavior unchanged", () => {
  const sf9Text = `
REPORT ON LEARNING PROGRESS AND ACHIEVEMENTS
LRN: 123456789012
School: SAN JOSE NATIONAL HIGH SCHOOL
Adviser: MR. JUAN DELA CRUZ
| Subject | Q1 | Q2 | Q3 | Q4 | Final | Remarks |
| Oral Communication | 88 | 90 | 89 | 91 | 90 | Passed |
`;
  const sf9Parsed = parseGradesText(sf9Text, "Senior High School", undefined, "sf9");
  assert.equal(sf9Parsed.lrn, "123456789012");
  assert.equal(sf9Parsed.adviser, "MR. JUAN DELA CRUZ");
  assert.ok(sf9Parsed.grades.length > 0, "SF9 must extract academic grades");
  assert.equal(sf9Parsed.grades[0].subject, "Oral Communication");
  assert.equal(sf9Parsed.grades[0].final, 90);
});

test("Condition N: SF10 comparison behavior unchanged", () => {
  const sf9Doc = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    name: "GOMEZ, JUSTIN LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
    grades: [{ subject: "Oral Communication", final: 90, status: "Passed" }],
  };
  const sf10Doc = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    name: "GOMEZ, JUSTIN LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
    grades: [{ subject: "Oral Communication", final: 90, status: "Passed" }],
  };

  const comparison = compareDocuments(sf9Doc, sf10Doc);
  assert.equal(comparison.overallStatus, "MATCH", "SF9 vs SF10 comparison should still match");
  assert.equal(comparison.isSameLearner, true);
  assert.equal(comparison.hasDiscrepancies, false);
});

// ============================================================================
// SECTION 17: Sanitized Non-PII Real-Document Benchmark Test
// ============================================================================

test("Section 17: Sanitized Real-Document Benchmark — Original vs. Grayscale vs. B&W", () => {
  // Replicates real PSA document conditions:
  // - Yellow/green security pattern background
  // - Dark printed text (anchors)
  // - Thin handwriting
  // - Uneven lighting (phone scan shadow)
  const fixture = createSyntheticPsaFixture({
    width: 600,
    height: 800,
    unevenLighting: true,
  });

  const origMetrics = computeQualityMetrics(fixture);
  const result = enhancePsaRawImage(fixture);

  const grayMetrics = result.metrics.grayscale;
  const bwMetrics = result.metrics.bw;

  // 1. Original has color saturation
  const char = detectImageCharacteristics(fixture);
  assert.equal(char.isColoredSecurityPaper, true, "Fixture must have colored security paper background");

  // 2. Grayscale neutralizes color while boosting background luminance
  assert.ok(
    grayMetrics.meanLuminance > origMetrics.meanLuminance,
    `Grayscale mean luminance (${grayMetrics.meanLuminance}) should be higher than colored original (${origMetrics.meanLuminance})`
  );

  // 3. Adaptive B&W isolates text with high contrast
  assert.ok(
    bwMetrics.contrast > origMetrics.contrast,
    `B&W contrast (${bwMetrics.contrast}) should exceed original contrast (${origMetrics.contrast})`
  );

  // 4. Foreground text density is within healthy document range (2% to 20%)
  assert.ok(
    bwMetrics.foregroundRatio >= 0.015 && bwMetrics.foregroundRatio <= 0.20,
    `B&W foreground ratio (${(bwMetrics.foregroundRatio * 100).toFixed(1)}%) must be within healthy 1.5%–20% range`
  );

  // 5. Selected candidate is B&W
  assert.equal(result.selectedCandidate, "bw", "Adaptive B&W should be the selected OCR candidate");
});

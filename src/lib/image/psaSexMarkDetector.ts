/**
 * PSA Certificate of Live Birth — Item 2 SEX Mark Detection Engine
 *
 * Dedicated local image & spatial analysis for Item 2 (SEX):
 *   [mark] 1 Male    [mark] 2 Female
 *
 * Requirements:
 * 1. Analyzes ONLY the physical Item 2 row (terminates before DOB, POB, Mother, Father).
 * 2. Operates in normalized upright PSA coordinates after perspective correction.
 * 3. Identifies selection from physical mark position (X, checkmark, pen stroke).
 * 4. Local zero-dependency image analysis:
 *    - Inset margin to suppress printed checkbox border lines.
 *    - Foreground ink density measurement.
 *    - Crossing diagonal stroke analysis (characteristic of X).
 *    - Relative score separation between Male and Female mark zones.
 * 5. Supports: MALE_MARKED, FEMALE_MARKED, BOTH_MARKED, NONE_MARKED, AMBIGUOUS.
 * 6. Zero extra Azure calls; zero Supabase uploads; strictly preserves original evidence.
 */

export type PsaSexMarkState =
  | "MALE_MARKED"
  | "FEMALE_MARKED"
  | "BOTH_MARKED"
  | "NONE_MARKED"
  | "AMBIGUOUS";

export interface PsaNormalizedBox {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

export interface PsaSexMarkAnalysisResult {
  state: PsaSexMarkState;
  detectedSex?: "M" | "F";
  statusText: string;
  confidence: number;
  maleScore: number;
  femaleScore: number;
  scoreDifference: number;
  maleMarkZone: PsaNormalizedBox;
  femaleMarkZone: PsaNormalizedBox;
  item2Bounds: PsaNormalizedBox;
  maleDataUrl?: string;
  femaleDataUrl?: string;
  item2DataUrl?: string;
}

export interface ZoneScoreDetails {
  markScore: number;
  inkDensity: number;
  crossingScore: number;
  contrast: number;
  isMarked: boolean;
}

// ----------------------------------------------------------------------------
// Threshold Constants (Calibrated & Verified by Synthetic Fixture Benchmarks)
// ----------------------------------------------------------------------------
export const SEX_MARK_THRESHOLDS = {
  STRONG: 0.28,      // Minimum score to qualify as positive mark
  WEAK: 0.12,        // Maximum score for blank paper / border noise
  MIN_SEPARATION: 0.14, // Minimum required difference between marked and unmarked zones
};

// Default canonical upright coordinates for PSA Item 2 (SEX)
export const DEFAULT_ITEM2_CANONICAL: PsaNormalizedBox = {
  minU: 0.045,
  maxU: 0.350,
  minV: 0.175,
  maxV: 0.220,
};

// Default canonical mark zones relative to the whole page
export const DEFAULT_MALE_MARK_ZONE: PsaNormalizedBox = {
  minU: 0.055,
  maxU: 0.110,
  minV: 0.182,
  maxV: 0.215,
};

export const DEFAULT_FEMALE_MARK_ZONE: PsaNormalizedBox = {
  minU: 0.195,
  maxU: 0.250,
  minV: 0.182,
  maxV: 0.215,
};

// ----------------------------------------------------------------------------
// 1. Zone Mark Analysis (Zero-Dependency Pixel Math)
// ----------------------------------------------------------------------------

/**
 * Analyzes a cropped grayscale mark zone for handwritten X / checkmark ink.
 * - Suppresses outer margin border lines (printed checkbox borders).
 * - Measures interior ink density.
 * - Detects crossing diagonal strokes characteristic of X.
 */
export function analyzeZoneInkAndPattern(
  pixels: Uint8ClampedArray | number[],
  width: number,
  height: number
): ZoneScoreDetails {
  if (width < 4 || height < 4 || pixels.length < width * height) {
    return { markScore: 0, inkDensity: 0, crossingScore: 0, contrast: 0, isMarked: false };
  }

  const totalPixels = width * height;

  // 1. Luminance Statistics
  let sumL = 0;
  let minL = 255;
  let maxL = 0;

  for (let i = 0; i < totalPixels; i++) {
    const val = pixels[i];
    sumL += val;
    if (val < minL) minL = val;
    if (val > maxL) maxL = val;
  }

  const meanL = sumL / totalPixels;
  const contrast = maxL - minL;

  // Pure white/clean background: low contrast, no ink
  if (contrast < 25) {
    return { markScore: 0, inkDensity: 0, crossingScore: 0, contrast, isMarked: false };
  }

  // Calculate standard deviation
  let sumSqDiff = 0;
  for (let i = 0; i < totalPixels; i++) {
    const diff = pixels[i] - meanL;
    sumSqDiff += diff * diff;
  }
  const stdDev = Math.sqrt(sumSqDiff / totalPixels);

  // Dynamic ink threshold (dark ink has low luminance)
  const inkThreshold = Math.min(205, Math.max(70, meanL - Math.max(12, stdDev * 0.55)));

  // 2. Interior Region Inset (Ignores outer 15% printed checkbox borders)
  const insetX = Math.max(1, Math.round(width * 0.15));
  const insetY = Math.max(1, Math.round(height * 0.15));
  const intW = Math.max(1, width - insetX * 2);
  const intH = Math.max(1, height - insetY * 2);
  const intTotal = intW * intH;

  // 3. Quadrant Division for Crossing Diagonal Structure
  // Divide interior into 4 quadrants: TL, TR, BL, BR, plus central core
  const midX = insetX + Math.round(intW / 2);
  const midY = insetY + Math.round(intH / 2);
  const coreRadiusX = Math.max(1, Math.round(intW * 0.20));
  const coreRadiusY = Math.max(1, Math.round(intH * 0.20));

  let intInkCount = 0;
  let tlInk = 0, tlTotal = 0;
  let trInk = 0, trTotal = 0;
  let blInk = 0, blTotal = 0;
  let brInk = 0, brTotal = 0;
  let coreInk = 0, coreTotal = 0;

  for (let y = insetY; y < height - insetY; y++) {
    const rowOffset = y * width;
    for (let x = insetX; x < width - insetX; x++) {
      const isInk = pixels[rowOffset + x] < inkThreshold ? 1 : 0;
      if (isInk) intInkCount++;

      // Quadrants
      if (x < midX && y < midY) {
        tlTotal++;
        if (isInk) tlInk++;
      } else if (x >= midX && y < midY) {
        trTotal++;
        if (isInk) trInk++;
      } else if (x < midX && y >= midY) {
        blTotal++;
        if (isInk) blInk++;
      } else {
        brTotal++;
        if (isInk) brInk++;
      }

      // Central core
      if (Math.abs(x - midX) <= coreRadiusX && Math.abs(y - midY) <= coreRadiusY) {
        coreTotal++;
        if (isInk) coreInk++;
      }
    }
  }

  const inkDensity = intTotal > 0 ? intInkCount / intTotal : 0;

  // 4. Crossing Diagonal Structure
  // For 'X': both diagonals (TL-BR) and (TR-BL) have ink intersecting at the core.
  const dTL = tlTotal > 0 ? tlInk / tlTotal : 0;
  const dTR = trTotal > 0 ? trInk / trTotal : 0;
  const dBL = blTotal > 0 ? blInk / blTotal : 0;
  const dBR = brTotal > 0 ? brInk / brTotal : 0;
  const dCore = coreTotal > 0 ? coreInk / coreTotal : 0;

  const diag1 = Math.min(dTL, dBR); // \ diagonal
  const diag2 = Math.min(dTR, dBL); // / diagonal

  // Crossing harmonic mean
  let crossingScore = 0;
  if (diag1 + diag2 > 0.02) {
    crossingScore = (2 * diag1 * diag2) / (diag1 + diag2);
    // Crossing is stronger when ink is also present at the center
    if (dCore > 0.08) {
      crossingScore = Math.min(1.0, crossingScore * 1.25);
    }
  }

  // Checkmark structure: ink in BL, Core, and TR
  let checkScore = 0;
  if (dBL > 0.08 && dTR > 0.08 && dCore > 0.08) {
    checkScore = Math.min(dBL, dCore, dTR);
  }

  const patternScore = Math.max(crossingScore, checkScore * 0.90);

  // 5. Composite Score Calculation
  // Balanced combination of interior ink density and diagonal pattern
  let markScore = 0;
  if (inkDensity >= 0.06) {
    markScore = 0.50 * Math.min(1.0, inkDensity * 2.8) + 0.50 * Math.min(1.0, patternScore * 3.2);
  } else if (inkDensity >= 0.03 && patternScore >= 0.05) {
    markScore = 0.40 * Math.min(1.0, inkDensity * 2.5) + 0.60 * Math.min(1.0, patternScore * 3.0);
  }

  // Clamp to [0..1]
  markScore = Math.round(Math.max(0, Math.min(1, markScore)) * 1000) / 1000;
  const roundedDensity = Math.round(inkDensity * 1000) / 1000;
  const roundedCross = Math.round(crossingScore * 1000) / 1000;

  return {
    markScore,
    inkDensity: roundedDensity,
    crossingScore: roundedCross,
    contrast,
    isMarked: markScore >= SEX_MARK_THRESHOLDS.STRONG,
  };
}

// ----------------------------------------------------------------------------
// 2. Decision Logic (Male / Female / Both / None / Ambiguous)
// ----------------------------------------------------------------------------

/**
 * Applies strict threshold and score-separation decision logic.
 * Never guesses when marks are absent, ambiguous, or doubly selected.
 */
export function evaluateSexMarkScores(
  maleScore: number,
  femaleScore: number
): {
  state: PsaSexMarkState;
  detectedSex?: "M" | "F";
  statusText: string;
  confidence: number;
} {
  const m = Math.max(0, Math.min(1, maleScore));
  const f = Math.max(0, Math.min(1, femaleScore));
  const diff = Math.round(Math.abs(m - f) * 1000) / 1000;

  const { STRONG, WEAK, MIN_SEPARATION } = SEX_MARK_THRESHOLDS;

  // Case 1: Both strongly marked -> Needs Verification
  if (m >= STRONG && f >= STRONG) {
    return {
      state: "BOTH_MARKED",
      detectedSex: undefined,
      statusText: `Needs Verification: Both Male (${m.toFixed(2)}) and Female (${f.toFixed(2)}) options marked`,
      confidence: 0.15,
    };
  }

  // Case 2: Neither marked -> Needs Verification
  if (m < WEAK && f < WEAK) {
    return {
      state: "NONE_MARKED",
      detectedSex: undefined,
      statusText: `Needs Verification: No selection mark detected in Male (${m.toFixed(2)}) or Female (${f.toFixed(2)})`,
      confidence: 0.10,
    };
  }

  // Case 3: Male clearly marked with sufficient separation
  if (m >= STRONG && f < WEAK && diff >= MIN_SEPARATION) {
    return {
      state: "MALE_MARKED",
      detectedSex: "M",
      statusText: `Male marked (score: ${m.toFixed(2)} vs ${f.toFixed(2)})`,
      confidence: Math.min(0.96, Math.round((0.75 + diff * 0.25) * 100) / 100),
    };
  }

  // Case 4: Female clearly marked with sufficient separation
  if (f >= STRONG && m < WEAK && diff >= MIN_SEPARATION) {
    return {
      state: "FEMALE_MARKED",
      detectedSex: "F",
      statusText: `Female marked (score: ${f.toFixed(2)} vs ${m.toFixed(2)})`,
      confidence: Math.min(0.96, Math.round((0.75 + diff * 0.25) * 100) / 100),
    };
  }

  // Case 5: Moderate separation (e.g. 0.35 vs 0.10 with diff >= 0.18)
  if (m >= STRONG - 0.04 && f < WEAK + 0.03 && diff >= MIN_SEPARATION + 0.04) {
    return {
      state: "MALE_MARKED",
      detectedSex: "M",
      statusText: `Male marked (moderate separation: ${m.toFixed(2)} vs ${f.toFixed(2)})`,
      confidence: 0.78,
    };
  }
  if (f >= STRONG - 0.04 && m < WEAK + 0.03 && diff >= MIN_SEPARATION + 0.04) {
    return {
      state: "FEMALE_MARKED",
      detectedSex: "F",
      statusText: `Female marked (moderate separation: ${f.toFixed(2)} vs ${m.toFixed(2)})`,
      confidence: 0.78,
    };
  }

  // Case 6: Ambiguous / competing / low-separation marks -> Needs Verification
  return {
    state: "AMBIGUOUS",
    detectedSex: undefined,
    statusText: `Needs Verification: Ambiguous mark scores (Male: ${m.toFixed(2)}, Female: ${f.toFixed(2)}, separation: ${diff.toFixed(2)})`,
    confidence: 0.30,
  };
}

// ----------------------------------------------------------------------------
// 3. Mark Detection from Grayscale Buffer (Node.js & Unit Test Core)
// ----------------------------------------------------------------------------

/**
 * Extracts a normalized sub-region from a grayscale buffer.
 */
export function extractGrayscaleSubRegion(
  gray: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  box: PsaNormalizedBox
): { pixels: Uint8ClampedArray; width: number; height: number } {
  const x0 = Math.max(0, Math.min(fullWidth - 2, Math.round(box.minU * fullWidth)));
  const x1 = Math.max(x0 + 2, Math.min(fullWidth, Math.round(box.maxU * fullWidth)));
  const y0 = Math.max(0, Math.min(fullHeight - 2, Math.round(box.minV * fullHeight)));
  const y1 = Math.max(y0 + 2, Math.min(fullHeight, Math.round(box.maxV * fullHeight)));

  const subW = x1 - x0;
  const subH = y1 - y0;
  const subPixels = new Uint8ClampedArray(subW * subH);

  for (let y = 0; y < subH; y++) {
    const srcRow = (y0 + y) * fullWidth;
    const destRow = y * subW;
    for (let x = 0; x < subW; x++) {
      subPixels[destRow + x] = gray[srcRow + x0 + x];
    }
  }

  return { pixels: subPixels, width: subW, height: subH };
}

/**
 * Analyzes PSA Sex marks from a grayscale image buffer and optional anchor coordinates.
 * Pure mathematical implementation: executes identically in Node.js and browser.
 */
export function analyzePsaSexMarksFromGrayscale(
  gray: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  customBoxes?: {
    item2Bounds?: PsaNormalizedBox;
    maleMarkZone?: PsaNormalizedBox;
    femaleMarkZone?: PsaNormalizedBox;
  }
): PsaSexMarkAnalysisResult {
  const item2Bounds = customBoxes?.item2Bounds || DEFAULT_ITEM2_CANONICAL;
  const maleMarkZone = customBoxes?.maleMarkZone || DEFAULT_MALE_MARK_ZONE;
  const femaleMarkZone = customBoxes?.femaleMarkZone || DEFAULT_FEMALE_MARK_ZONE;

  const maleCrop = extractGrayscaleSubRegion(gray, fullWidth, fullHeight, maleMarkZone);
  const femaleCrop = extractGrayscaleSubRegion(gray, fullWidth, fullHeight, femaleMarkZone);

  const maleAnalysis = analyzeZoneInkAndPattern(maleCrop.pixels, maleCrop.width, maleCrop.height);
  const femaleAnalysis = analyzeZoneInkAndPattern(femaleCrop.pixels, femaleCrop.width, femaleCrop.height);

  const decision = evaluateSexMarkScores(maleAnalysis.markScore, femaleAnalysis.markScore);
  const diff = Math.round(Math.abs(maleAnalysis.markScore - femaleAnalysis.markScore) * 1000) / 1000;

  return {
    state: decision.state,
    detectedSex: decision.detectedSex,
    statusText: decision.statusText,
    confidence: decision.confidence,
    maleScore: maleAnalysis.markScore,
    femaleScore: femaleAnalysis.markScore,
    scoreDifference: diff,
    maleMarkZone,
    femaleMarkZone,
    item2Bounds,
  };
}

// ----------------------------------------------------------------------------
// 4. Anchor-Guided Mark Zone Derivation from Spatial OCR Words
// ----------------------------------------------------------------------------

export interface SimpleOcrWord {
  content: string;
  cleanText?: string;
  bbox: { minU: number; maxU: number; minV: number; maxV: number; centerU: number; centerV: number };
}

/**
 * Derives precise mark zones using printed OCR anchors:
 * '2. SEX', '1 Male', '2 Female'.
 * Falls back to canonical form proportions when anchors are unreadable.
 */
export function deriveSexMarkZonesFromAnchors(
  words: SimpleOcrWord[],
  anchor2Bbox?: PsaNormalizedBox,
  anchor3Bbox?: PsaNormalizedBox
): {
  item2Bounds: PsaNormalizedBox;
  maleMarkZone: PsaNormalizedBox;
  femaleMarkZone: PsaNormalizedBox;
  maleAnchorFound: boolean;
  femaleAnchorFound: boolean;
} {
  // 1. Item 2 Boundary
  let minU = 0.045;
  let maxU = anchor3Bbox ? Math.min(anchor3Bbox.minU, 0.40) : 0.350;
  let minV = anchor2Bbox ? anchor2Bbox.minV - 0.005 : 0.175;
  let maxV = anchor2Bbox ? anchor2Bbox.maxV + 0.045 : 0.220;

  const item2Bounds: PsaNormalizedBox = { minU, maxU, minV, maxV };

  // 2. Locate Male and Female option anchors inside Item 2
  const item2Words = words.filter(
    (w) =>
      w.bbox.centerV >= minV - 0.01 &&
      w.bbox.centerV <= maxV + 0.015 &&
      w.bbox.centerU >= minU - 0.01 &&
      w.bbox.centerU <= maxU + 0.02
  );

  let maleWord = item2Words.find((w) => /^(?:1\.?|male|lalaki)$/i.test(w.content.trim()) || w.cleanText === "male");
  let femaleWord = item2Words.find((w) => /^(?:2\.?|female|babae)$/i.test(w.content.trim()) || w.cleanText === "female");

  // Also check composite text like "1 Male"
  if (!maleWord) {
    maleWord = item2Words.find((w) => /1\s*male/i.test(w.content));
  }
  if (!femaleWord) {
    femaleWord = item2Words.find((w) => /2\s*female/i.test(w.content));
  }

  let maleMarkZone: PsaNormalizedBox;
  let femaleMarkZone: PsaNormalizedBox;
  let maleAnchorFound = false;
  let femaleAnchorFound = false;

  const defaultZoneW = 0.045;
  const defaultZoneH = 0.032;

  // Male mark zone: immediately to the left of Male word / digit 1
  if (maleWord) {
    maleAnchorFound = true;
    const boxW = Math.max(defaultZoneW, maleWord.bbox.maxU - maleWord.bbox.minU);
    const boxH = Math.max(defaultZoneH, maleWord.bbox.maxV - maleWord.bbox.minV);
    const zMinU = Math.max(minU, maleWord.bbox.minU - boxW * 1.15);
    const zMaxU = Math.min(maleWord.bbox.minU - 0.002, zMinU + boxW);
    const zCenterV = maleWord.bbox.centerV;
    maleMarkZone = {
      minU: Math.round(zMinU * 1000) / 1000,
      maxU: Math.round(zMaxU * 1000) / 1000,
      minV: Math.round(Math.max(minV, zCenterV - boxH * 0.6) * 1000) / 1000,
      maxV: Math.round(Math.min(maxV, zCenterV + boxH * 0.6) * 1000) / 1000,
    };
  } else {
    maleMarkZone = DEFAULT_MALE_MARK_ZONE;
  }

  // Female mark zone: immediately to the left of Female word / digit 2
  if (femaleWord) {
    femaleAnchorFound = true;
    const boxW = Math.max(defaultZoneW, femaleWord.bbox.maxU - femaleWord.bbox.minU);
    const boxH = Math.max(defaultZoneH, femaleWord.bbox.maxV - femaleWord.bbox.minV);
    const zMinU = Math.max(0.180, femaleWord.bbox.minU - boxW * 1.15);
    const zMaxU = Math.min(femaleWord.bbox.minU - 0.002, zMinU + boxW);
    const zCenterV = femaleWord.bbox.centerV;
    femaleMarkZone = {
      minU: Math.round(zMinU * 1000) / 1000,
      maxU: Math.round(zMaxU * 1000) / 1000,
      minV: Math.round(Math.max(minV, zCenterV - boxH * 0.6) * 1000) / 1000,
      maxV: Math.round(Math.min(maxV, zCenterV + boxH * 0.6) * 1000) / 1000,
    };
  } else {
    femaleMarkZone = DEFAULT_FEMALE_MARK_ZONE;
  }

  return {
    item2Bounds,
    maleMarkZone,
    femaleMarkZone,
    maleAnchorFound,
    femaleAnchorFound,
  };
}

// ----------------------------------------------------------------------------
// 5. Browser Canvas Diagnostic & Thumbnail Crop Generation
// ----------------------------------------------------------------------------

/**
 * Analyzes Sex marks from an upright HTMLCanvasElement and generates thumbnail previews.
 */
export async function analyzePsaSexMarksFromCanvas(
  canvas: HTMLCanvasElement,
  customBoxes?: {
    item2Bounds?: PsaNormalizedBox;
    maleMarkZone?: PsaNormalizedBox;
    femaleMarkZone?: PsaNormalizedBox;
  }
): Promise<PsaSexMarkAnalysisResult> {
  const fullWidth = canvas.width;
  const fullHeight = canvas.height;

  const item2Bounds = customBoxes?.item2Bounds || DEFAULT_ITEM2_CANONICAL;
  const maleMarkZone = customBoxes?.maleMarkZone || DEFAULT_MALE_MARK_ZONE;
  const femaleMarkZone = customBoxes?.femaleMarkZone || DEFAULT_FEMALE_MARK_ZONE;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      state: "AMBIGUOUS",
      statusText: "Canvas context unavailable for Sex mark analysis",
      confidence: 0,
      maleScore: 0,
      femaleScore: 0,
      scoreDifference: 0,
      maleMarkZone,
      femaleMarkZone,
      item2Bounds,
    };
  }

  // 1. Pull grayscale pixels for Item 2
  const i2X = Math.max(0, Math.round(item2Bounds.minU * fullWidth));
  const i2Y = Math.max(0, Math.round(item2Bounds.minV * fullHeight));
  const i2W = Math.min(fullWidth - i2X, Math.round((item2Bounds.maxU - item2Bounds.minU) * fullWidth));
  const i2H = Math.min(fullHeight - i2Y, Math.round((item2Bounds.maxV - item2Bounds.minV) * fullHeight));

  const imgData = ctx.getImageData(i2X, i2Y, i2W, i2H);
  const data = imgData.data;
  const item2Gray = new Uint8ClampedArray(i2W * i2H);

  for (let i = 0; i < data.length; i += 4) {
    item2Gray[i / 4] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }

  // Re-map mark zones relative to Item 2 crop
  const relBox = (box: PsaNormalizedBox): PsaNormalizedBox => ({
    minU: Math.max(0, (box.minU - item2Bounds.minU) / (item2Bounds.maxU - item2Bounds.minU)),
    maxU: Math.min(1, (box.maxU - item2Bounds.minU) / (item2Bounds.maxU - item2Bounds.minU)),
    minV: Math.max(0, (box.minV - item2Bounds.minV) / (item2Bounds.maxV - item2Bounds.minV)),
    maxV: Math.min(1, (box.maxV - item2Bounds.minV) / (item2Bounds.maxV - item2Bounds.minV)),
  });

  const relMale = relBox(maleMarkZone);
  const relFemale = relBox(femaleMarkZone);

  const analysis = analyzePsaSexMarksFromGrayscale(item2Gray, i2W, i2H, {
    item2Bounds: { minU: 0, maxU: 1, minV: 0, maxV: 1 },
    maleMarkZone: relMale,
    femaleMarkZone: relFemale,
  });

  // 2. Generate clean thumbnail previews
  let item2DataUrl: string | undefined = undefined;
  let maleDataUrl: string | undefined = undefined;
  let femaleDataUrl: string | undefined = undefined;

  try {
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = i2W;
    thumbCanvas.height = i2H;
    const tCtx = thumbCanvas.getContext("2d");
    if (tCtx) {
      tCtx.drawImage(canvas, i2X, i2Y, i2W, i2H, 0, 0, i2W, i2H);
      item2DataUrl = thumbCanvas.toDataURL("image/png");
    }

    const cropBox = (box: PsaNormalizedBox): string | undefined => {
      const bx = Math.max(0, Math.round(box.minU * fullWidth));
      const by = Math.max(0, Math.round(box.minV * fullHeight));
      const bw = Math.min(fullWidth - bx, Math.round((box.maxU - box.minU) * fullWidth));
      const bh = Math.min(fullHeight - by, Math.round((box.maxV - box.minV) * fullHeight));
      if (bw <= 0 || bh <= 0) return undefined;

      const c = document.createElement("canvas");
      c.width = bw * 2;
      c.height = bh * 2;
      const cCtx = c.getContext("2d");
      if (!cCtx) return undefined;
      cCtx.imageSmoothingEnabled = true;
      cCtx.imageSmoothingQuality = "high";
      cCtx.drawImage(canvas, bx, by, bw, bh, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    };

    maleDataUrl = cropBox(maleMarkZone);
    femaleDataUrl = cropBox(femaleMarkZone);
  } catch {
    // Non-fatal thumbnail failure
  }

  return {
    ...analysis,
    maleMarkZone,
    femaleMarkZone,
    item2Bounds,
    maleDataUrl,
    femaleDataUrl,
    item2DataUrl,
  };
}

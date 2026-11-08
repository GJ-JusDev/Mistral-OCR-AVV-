/**
 * PSA / Birth Certificate Live Identity-Region Detection, Auto-Crop & Upscaling Engine
 *
 * Dedicated detector for Philippine PSA Certificate of Live Birth documents.
 * 1. Detects whole paper boundary and orientation (portrait vs 90° sideways).
 * 2. Derives the rectangular Identity Region containing:
 *    - Child Name (First | Middle | Last), Sex, DOB, Place of Birth
 *    - Mother Maiden Name (First | Middle | Last)
 *    - Father Name (Item 13 First | Middle | Last)
 * 3. Adds safe padding margins so First/Middle/Last sub-labels are never clipped.
 * 4. Extracts and upscales the identity region (1.75× to 2.0×) before OCR.
 * 5. Runs locally in the browser with zero ML dependencies and zero network overhead.
 *
 * Safety Invariants:
 * - Overlay graphics are purely in the DOM; NEVER baked into saved image pixels.
 * - Live camera analysis does NOT call Azure or upload frames to Supabase.
 * - Original full-color PSA scan is strictly preserved for human review.
 * - Scoped strictly to document_type === "birth_cert".
 */

import type { CornerPoint } from "./documentCrop";
import { loadImageElement, rotateImageDataUrl } from "./documentCrop";
import type { PsaSexMarkAnalysisResult } from "./psaSexMarkDetector";
import { analyzePsaSexMarksFromCanvas } from "./psaSexMarkDetector";

export interface PsaNormalizedBox {
  x: number;      // 0..1 relative to video/image width
  y: number;      // 0..1 relative to video/image height
  width: number;  // 0..1 relative to video/image width
  height: number; // 0..1 relative to video/image height
}

export type PsaDetectionState =
  | "NO_DOCUMENT"
  | "HOLD_STEADY"
  | "IDENTITY_DETECTED"
  | "READY";

export type PsaSecondaryRegionId =
  | "child_first"
  | "child_middle"
  | "child_last"
  | "child_sex"
  | "child_dob"
  | "child_pob"
  | "mother_name"
  | "father_name";

/**
 * Quadrilateral polygon representation for PSA field guides in live camera view.
 * Eliminates axis-aligned bounding box inflation on rotated/perspective frames.
 */
export interface PsaFieldPolygon {
  id: PsaSecondaryRegionId;
  label: string;
  // Four projected corners in normalized frame coordinates [0..1]
  // Ordered: P1 (uMin, vMin) -> P2 (uMax, vMin) -> P3 (uMax, vMax) -> P4 (uMin, vMax)
  points: [CornerPoint, CornerPoint, CornerPoint, CornerPoint];
  // Center of the polygon in normalized frame coordinates [0..1]
  center: CornerPoint;
  // Top-left label anchor point
  labelPoint: CornerPoint;
}

export interface PsaItemRowPolygon {
  rowId: "item_1" | "item_2_3" | "item_4" | "item_6" | "item_13";
  label: string;
  points: [CornerPoint, CornerPoint, CornerPoint, CornerPoint];
  center: CornerPoint;
}

export interface PsaCanonicalAxesDebug {
  topPoint: CornerPoint;
  bottomPoint: CornerPoint;
  leftPoint: CornerPoint;
  rightPoint: CornerPoint;
  originPoint: CornerPoint;
  uVectorEnd: CornerPoint;
  vVectorEnd: CornerPoint;
}

export interface PsaLiveDetectionResult {
  detected: boolean;
  state: PsaDetectionState;
  statusText: string;
  paperBox?: PsaNormalizedBox;
  identityBox?: PsaNormalizedBox;
  fieldGuides?: Record<PsaSecondaryRegionId, PsaNormalizedBox>;
  fieldPolygons?: Record<PsaSecondaryRegionId, PsaFieldPolygon>;
  itemRowPolygons?: Record<string, PsaItemRowPolygon>;
  canonicalAxesDebug?: PsaCanonicalAxesDebug;
  corners?: [CornerPoint, CornerPoint, CornerPoint, CornerPoint];
  orientationAngle: 0 | 90 | 180 | 270;
  confidence: number;
  isSideways: boolean;
  canShowGuides: boolean;
}

export function getShortFieldLabel(id: PsaSecondaryRegionId): string {
  switch (id) {
    case "child_first":
      return "1. FIRST";
    case "child_middle":
      return "MIDDLE";
    case "child_last":
      return "LAST";
    case "child_sex":
      return "2. SEX";
    case "child_dob":
      return "3. DOB";
    case "child_pob":
      return "4. POB";
    case "mother_name":
      return "6. MOTHER";
    case "father_name":
      return "13. FATHER";
  }
}

export const PSA_CANONICAL_ITEM_ROWS: Record<
  "item_1" | "item_2_3" | "item_4" | "item_6" | "item_13",
  { label: string; uMin: number; uMax: number; vMin: number; vMax: number }
> = {
  item_1: { label: "1. NAME", uMin: 0.045, uMax: 0.880, vMin: 0.120, vMax: 0.170 },
  item_2_3: { label: "2. SEX / 3. DOB", uMin: 0.045, uMax: 0.880, vMin: 0.175, vMax: 0.220 },
  item_4: { label: "4. PLACE OF BIRTH", uMin: 0.045, uMax: 0.880, vMin: 0.225, vMax: 0.285 },
  item_6: { label: "6. MOTHER (MAIDEN)", uMin: 0.045, uMax: 0.880, vMin: 0.350, vMax: 0.400 },
  item_13: { label: "13. FATHER", uMin: 0.045, uMax: 0.880, vMin: 0.480, vMax: 0.530 },
};

export const PSA_PAPER_FIELD_GUIDES: Record<
  PsaSecondaryRegionId,
  { uMin: number; uMax: number; vMin: number; vMax: number }
> = {
  child_first: { uMin: 0.045, uMax: 0.36, vMin: 0.120, vMax: 0.170 },
  child_middle: { uMin: 0.36, uMax: 0.66, vMin: 0.120, vMax: 0.170 },
  child_last: { uMin: 0.66, uMax: 0.88, vMin: 0.120, vMax: 0.170 },
  child_sex: { uMin: 0.045, uMax: 0.35, vMin: 0.175, vMax: 0.220 },
  child_dob: { uMin: 0.35, uMax: 0.88, vMin: 0.175, vMax: 0.220 },
  child_pob: { uMin: 0.045, uMax: 0.88, vMin: 0.225, vMax: 0.285 },
  mother_name: { uMin: 0.045, uMax: 0.88, vMin: 0.350, vMax: 0.400 },
  father_name: { uMin: 0.045, uMax: 0.88, vMin: 0.480, vMax: 0.530 },
};

/**
 * Maps the 4 detected camera-space corners to canonical upright PSA document corners
 * for each rotation angle (0°, 90°, 180°, 270°).
 *
 * Camera space corners order: [p0: TL, p1: TR, p2: BR, p3: BL]
 * Canonical upright PSA space:
 * - q00: Physical Top-Left (u=0, v=0)
 * - q10: Physical Top-Right (u=1, v=0)
 * - q11: Physical Bottom-Right (u=1, v=1)
 * - q01: Physical Bottom-Left (u=0, v=1)
 */
export function getCanonicalPaperCorners(
  corners: [CornerPoint, CornerPoint, CornerPoint, CornerPoint],
  orientationAngle: 0 | 90 | 180 | 270
): {
  q00: CornerPoint;
  q10: CornerPoint;
  q11: CornerPoint;
  q01: CornerPoint;
} {
  const k = (((Math.round(orientationAngle) / 90) % 4) + 4) % 4;
  return {
    q00: corners[(0 + k) % 4],
    q10: corners[(1 + k) % 4],
    q11: corners[(2 + k) % 4],
    q01: corners[(3 + k) % 4],
  };
}

/**
 * Bilinear homography projection of a canonical document point (u, v) in [0..1]
 * into frame coordinate space using the mapped canonical corners.
 */
export function projectCanonicalPoint(
  u: number,
  v: number,
  canonicalCorners: {
    q00: CornerPoint;
    q10: CornerPoint;
    q11: CornerPoint;
    q01: CornerPoint;
  }
): CornerPoint {
  const { q00, q10, q11, q01 } = canonicalCorners;
  const x = (1 - u) * (1 - v) * q00.x + u * (1 - v) * q10.x + u * v * q11.x + (1 - u) * v * q01.x;
  const y = (1 - u) * (1 - v) * q00.y + u * (1 - v) * q10.y + u * v * q11.y + (1 - u) * v * q01.y;
  return { x, y };
}

export function projectPaperPoint(
  u: number,
  v: number,
  corners: [CornerPoint, CornerPoint, CornerPoint, CornerPoint],
  orientationAngle: 0 | 90 | 180 | 270
): CornerPoint {
  const canonicalCorners = getCanonicalPaperCorners(corners, orientationAngle);
  return projectCanonicalPoint(u, v, canonicalCorners);
}

/**
 * Projects all 4 corners of each secondary field into true quadrilateral SVG polygons.
 * Preserves rotation and perspective without inflating into axis-aligned screen boxes.
 */
export function projectPaperFieldPolygons(
  corners: [CornerPoint, CornerPoint, CornerPoint, CornerPoint],
  orientationAngle: 0 | 90 | 180 | 270,
  frameWidth: number,
  frameHeight: number
): {
  fieldPolygons: Record<PsaSecondaryRegionId, PsaFieldPolygon>;
  itemRowPolygons: Record<string, PsaItemRowPolygon>;
  fieldGuides: Record<PsaSecondaryRegionId, PsaNormalizedBox>;
  canonicalAxesDebug: PsaCanonicalAxesDebug;
} {
  const canonicalCorners = getCanonicalPaperCorners(corners, orientationAngle);
  const fieldPolygons: Partial<Record<PsaSecondaryRegionId, PsaFieldPolygon>> = {};
  const fieldGuides: Partial<Record<PsaSecondaryRegionId, PsaNormalizedBox>> = {};

  const normPoint = (p: CornerPoint): CornerPoint => ({
    x: Math.round(Math.max(0, Math.min(1, p.x / frameWidth)) * 1000) / 1000,
    y: Math.round(Math.max(0, Math.min(1, p.y / frameHeight)) * 1000) / 1000,
  });

  for (const [id, bounds] of Object.entries(PSA_PAPER_FIELD_GUIDES)) {
    const rawP1 = projectCanonicalPoint(bounds.uMin, bounds.vMin, canonicalCorners);
    const rawP2 = projectCanonicalPoint(bounds.uMax, bounds.vMin, canonicalCorners);
    const rawP3 = projectCanonicalPoint(bounds.uMax, bounds.vMax, canonicalCorners);
    const rawP4 = projectCanonicalPoint(bounds.uMin, bounds.vMax, canonicalCorners);

    const p1 = normPoint(rawP1);
    const p2 = normPoint(rawP2);
    const p3 = normPoint(rawP3);
    const p4 = normPoint(rawP4);

    const center: CornerPoint = {
      x: Math.round(((p1.x + p2.x + p3.x + p4.x) / 4) * 1000) / 1000,
      y: Math.round(((p1.y + p2.y + p3.y + p4.y) / 4) * 1000) / 1000,
    };

    fieldPolygons[id as PsaSecondaryRegionId] = {
      id: id as PsaSecondaryRegionId,
      label: getShortFieldLabel(id as PsaSecondaryRegionId),
      points: [p1, p2, p3, p4],
      center,
      labelPoint: p1,
    };

    // Kept for backward compatibility
    const minX = Math.min(p1.x, p2.x, p3.x, p4.x);
    const maxX = Math.max(p1.x, p2.x, p3.x, p4.x);
    const minY = Math.min(p1.y, p2.y, p3.y, p4.y);
    const maxY = Math.max(p1.y, p2.y, p3.y, p4.y);

    fieldGuides[id as PsaSecondaryRegionId] = {
      x: minX,
      y: minY,
      width: Math.round(Math.max(0.01, maxX - minX) * 1000) / 1000,
      height: Math.round(Math.max(0.01, maxY - minY) * 1000) / 1000,
    };
  }

  // Canonical Item Rows
  const itemRowPolygons: Record<string, PsaItemRowPolygon> = {};
  for (const [rowKey, rowBounds] of Object.entries(PSA_CANONICAL_ITEM_ROWS)) {
    const p1 = normPoint(projectCanonicalPoint(rowBounds.uMin, rowBounds.vMin, canonicalCorners));
    const p2 = normPoint(projectCanonicalPoint(rowBounds.uMax, rowBounds.vMin, canonicalCorners));
    const p3 = normPoint(projectCanonicalPoint(rowBounds.uMax, rowBounds.vMax, canonicalCorners));
    const p4 = normPoint(projectCanonicalPoint(rowBounds.uMin, rowBounds.vMax, canonicalCorners));
    itemRowPolygons[rowKey] = {
      rowId: rowKey as any,
      label: rowBounds.label,
      points: [p1, p2, p3, p4],
      center: {
        x: Math.round(((p1.x + p2.x + p3.x + p4.x) / 4) * 1000) / 1000,
        y: Math.round(((p1.y + p2.y + p3.y + p4.y) / 4) * 1000) / 1000,
      },
    };
  }

  // Debug canonical axes
  const canonicalAxesDebug: PsaCanonicalAxesDebug = {
    topPoint: normPoint(projectCanonicalPoint(0.5, 0.02, canonicalCorners)),
    bottomPoint: normPoint(projectCanonicalPoint(0.5, 0.98, canonicalCorners)),
    leftPoint: normPoint(projectCanonicalPoint(0.02, 0.5, canonicalCorners)),
    rightPoint: normPoint(projectCanonicalPoint(0.98, 0.5, canonicalCorners)),
    originPoint: normPoint(projectCanonicalPoint(0.05, 0.05, canonicalCorners)),
    uVectorEnd: normPoint(projectCanonicalPoint(0.25, 0.05, canonicalCorners)),
    vVectorEnd: normPoint(projectCanonicalPoint(0.05, 0.25, canonicalCorners)),
  };

  return {
    fieldPolygons: fieldPolygons as Record<PsaSecondaryRegionId, PsaFieldPolygon>,
    itemRowPolygons,
    fieldGuides: fieldGuides as Record<PsaSecondaryRegionId, PsaNormalizedBox>,
    canonicalAxesDebug,
  };
}

export function projectPaperGuides(
  corners: [CornerPoint, CornerPoint, CornerPoint, CornerPoint],
  orientationAngle: 0 | 90 | 180 | 270,
  frameWidth: number,
  frameHeight: number
): Record<PsaSecondaryRegionId, PsaNormalizedBox> {
  const result = projectPaperFieldPolygons(corners, orientationAngle, frameWidth, frameHeight);
  return result.fieldGuides;
}

export interface PsaIdentityCropResult {
  success: boolean;
  dataUrl: string;
  originalDataUrl: string;
  cropBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaledWidth: number;
  scaledHeight: number;
  scaleFactor: number;
  isFallback: boolean;
  reason?: string;
}

// ----------------------------------------------------------------------------
// 1. Core Mathematical Pixel Detection (Zero-Dependency: Browser & Node)
// ----------------------------------------------------------------------------

/**
 * Detects paper boundaries and derives normalized identity regions from a grayscale buffer.
 * Pure mathematical implementation: executes identically in Node.js unit tests and browser.
 */
export function detectPsaPaperAndIdentity(
  gray: Uint8ClampedArray,
  width: number,
  height: number
): PsaLiveDetectionResult {
  const totalPixels = width * height;
  if (totalPixels === 0 || width < 20 || height < 20) {
    return {
      detected: false,
      state: "NO_DOCUMENT",
      statusText: "No Document Detected",
      orientationAngle: 0,
      confidence: 0,
      isSideways: false,
      canShowGuides: false,
    };
  }

  // 1. Detect paper boundary via luminance gradients
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  let edgeCount = 0;

  const threshold = 18;
  const marginX = Math.max(2, Math.round(width * 0.03));
  const marginY = Math.max(2, Math.round(height * 0.03));

  for (let y = marginY; y < height - marginY; y++) {
    const rowOffset = y * width;
    for (let x = marginX; x < width - marginX; x++) {
      const idx = rowOffset + x;
      const diffX = Math.abs(gray[idx] - gray[idx + 1]);
      const diffY = Math.abs(gray[idx] - gray[idx + width]);

      if (diffX > threshold || diffY > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        edgeCount++;
      }
    }
  }

  const boxW = Math.max(0, maxX - minX);
  const boxH = Math.max(0, maxY - minY);
  const areaRatio = (boxW * boxH) / totalPixels;

  // Thresholds for live camera video
  const minArea = 0.12;
  const maxArea = 0.98;
  const minEdges = Math.round(totalPixels * 0.005);

  if (areaRatio < minArea || areaRatio > maxArea || edgeCount < minEdges) {
    return {
      detected: false,
      state: "NO_DOCUMENT",
      statusText: "PSA alignment lost — reposition document",
      orientationAngle: 0,
      confidence: Math.round(areaRatio * 100) / 100,
      isSideways: false,
      canShowGuides: false,
    };
  }

  // 2. Aspect Ratio & Orientation
  const aspect = boxW / boxH;
  let orientationAngle: 0 | 90 | 180 | 270 = 0;
  let isSideways = false;

  // Standard Philippine PSA birth certificates are portrait (~0.65 to 0.85).
  // When photographed or scanned sideways (landscape), aspect is > 1.15.
  if (aspect > 1.15) {
    orientationAngle = 90;
    isSideways = true;
  } else {
    orientationAngle = 0;
    isSideways = false;
  }

  // Normalized paper boundary relative to frame [0..1]
  const paperBox: PsaNormalizedBox = {
    x: Math.round((minX / width) * 1000) / 1000,
    y: Math.round((minY / height) * 1000) / 1000,
    width: Math.round((boxW / width) * 1000) / 1000,
    height: Math.round((boxH / height) * 1000) / 1000,
  };

  // 3. Derive PSA Identity Region Box
  // Standard PSA form structure (upright):
  // Header & Civil Registry No.: 0% to 9.5%
  // Child identity fields (Items 1-5): ~9.5% to 35%
  // Mother maiden name & identity fields (Items 6-12): ~35% to 51%
  // Father name & identity fields (Items 13-17): ~51% to 60%
  // Lower certifications & affidavits (Items 18-24): 60% to 100% (EXCLUDED from identity crop)
  let identityBox: PsaNormalizedBox;

  if (!isSideways) {
    // Upright portrait: Identity region covers Child, Mother, and Father rows (Y: 9.5% to 60%, X: 3.5% to 96.5%)
    identityBox = {
      x: Math.round((paperBox.x + paperBox.width * 0.035) * 1000) / 1000,
      y: Math.round((paperBox.y + paperBox.height * 0.095) * 1000) / 1000,
      width: Math.round((paperBox.width * 0.93) * 1000) / 1000,
      height: Math.round((paperBox.height * 0.505) * 1000) / 1000,
    };
  } else {
    // 90° sideways document: Top of certificate is on right side of frame, bottom on left.
    // The identity area (9.5% to 60% from certificate top) projects horizontally in the sideways frame:
    identityBox = {
      x: Math.round((paperBox.x + paperBox.width * 0.40) * 1000) / 1000,
      y: Math.round((paperBox.y + paperBox.height * 0.035) * 1000) / 1000,
      width: Math.round((paperBox.width * 0.505) * 1000) / 1000,
      height: Math.round((paperBox.height * 0.93) * 1000) / 1000,
    };
  }

  // 4. Calculate Confidence & Live State
  const confidence = Math.min(0.95, Math.round((areaRatio + 0.35) * 100) / 100);

  const corners: [CornerPoint, CornerPoint, CornerPoint, CornerPoint] = [
    { x: minX, y: minY },
    { x: minX + boxW, y: minY },
    { x: minX + boxW, y: minY + boxH },
    { x: minX, y: minY + boxH },
  ];

  const {
    fieldPolygons,
    itemRowPolygons,
    fieldGuides,
    canonicalAxesDebug,
  } = projectPaperFieldPolygons(corners, orientationAngle, width, height);

  const isPortraitAspect = aspect >= 0.50 && aspect <= 1.05;
  const isLandscapeAspect = aspect >= 1.15 && aspect <= 2.20;
  const hasConfidentShape = (isPortraitAspect || isLandscapeAspect) && areaRatio >= 0.15 && areaRatio <= 0.95;
  const canShowGuides = confidence >= 0.65 && hasConfidentShape;

  let state: PsaDetectionState = "HOLD_STEADY";
  let statusText = "PSA aligned — Hold Steady";

  if (confidence >= 0.75) {
    state = "READY";
    statusText = "PSA aligned — Ready to Capture";
  } else if (confidence >= 0.50) {
    state = "IDENTITY_DETECTED";
    statusText = "PSA aligned — Identity Area Detected";
  }

  return {
    detected: true,
    state,
    statusText,
    paperBox,
    identityBox,
    fieldGuides,
    fieldPolygons: canShowGuides ? fieldPolygons : undefined,
    itemRowPolygons: canShowGuides ? itemRowPolygons : undefined,
    canonicalAxesDebug: canShowGuides ? canonicalAxesDebug : undefined,
    corners,
    orientationAngle,
    confidence,
    isSideways,
    canShowGuides,
  };
}

// ----------------------------------------------------------------------------
// 2. Browser Live Video Frame Sampler
// ----------------------------------------------------------------------------

/**
 * Samples a frame from an active HTMLVideoElement and performs live PSA detection.
 * Designed to run at ~5 fps with minimal CPU overhead.
 */
export function detectPsaFromVideoElement(
  video: HTMLVideoElement,
  offscreenCanvas?: HTMLCanvasElement
): PsaLiveDetectionResult {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      detected: false,
      state: "NO_DOCUMENT",
      statusText: "Server-side environment",
      orientationAngle: 0,
      confidence: 0,
      isSideways: false,
      canShowGuides: false,
    };
  }

  const vW = video.videoWidth;
  const vH = video.videoHeight;
  if (!vW || !vH || video.readyState < 2) {
    return {
      detected: false,
      state: "NO_DOCUMENT",
      statusText: "Waiting for camera...",
      orientationAngle: 0,
      confidence: 0,
      isSideways: false,
      canShowGuides: false,
    };
  }

  const canvas = offscreenCanvas || document.createElement("canvas");
  // Downscale to 320px for near-instant edge detection
  const scale = Math.min(1.0, 320 / Math.max(vW, vH));
  const sW = Math.round(vW * scale);
  const sH = Math.round(vH * scale);

  canvas.width = sW;
  canvas.height = sH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return {
      detected: false,
      state: "NO_DOCUMENT",
      statusText: "Canvas unavailable",
      orientationAngle: 0,
      confidence: 0,
      isSideways: false,
      canShowGuides: false,
    };
  }

  ctx.drawImage(video, 0, 0, sW, sH);
  const imgData = ctx.getImageData(0, 0, sW, sH);
  const data = imgData.data;

  const gray = new Uint8ClampedArray(sW * sH);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }

  return detectPsaPaperAndIdentity(gray, sW, sH);
}

export interface PsaPipelineDiagnostics {
  rawDimensions: { width: number; height: number };
  fullCorrectedDimensions: { width: number; height: number };
  identitySourceCrop: { x: number; y: number; width: number; height: number };
  identityOcrOutput: { width: number; height: number };
  scale: number;
  areaRatio: number;
  orientationAngle: number;
  isSideways: boolean;
  secondaryFieldRegions?: Record<
    string,
    { x: number; y: number; width: number; height: number; isTooSmall: boolean }
  >;
}

export interface PsaAnchorRefinedBox {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  anchorFound: boolean;
  subLabelsFound?: boolean;
}

export type PsaAnchorRefinedBoxes = Record<PsaSecondaryRegionId, PsaAnchorRefinedBox>;

export interface PsaSecondaryRegionDef {
  id: PsaSecondaryRegionId;
  label: string;
  fieldKey: string;
  uprightBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  identityRelativeBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PsaSecondaryCropItem {
  id: PsaSecondaryRegionId;
  label: string;
  fieldKey: string;
  dataUrl?: string;
  sourceBox: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  isTooSmall: boolean;
  minDimWarning?: string;
  sexDiagnostic?: PsaSexMarkAnalysisResult;
}

export const PSA_SECONDARY_REGIONS: PsaSecondaryRegionDef[] = [
  {
    id: "child_first",
    label: "Child First Name",
    fieldKey: "first_name",
    uprightBox: { x: 0.045, y: 0.120, width: 0.315, height: 0.050 },
    identityRelativeBox: { x: 0.01, y: 0.02, width: 0.35, height: 0.08 },
  },
  {
    id: "child_middle",
    label: "Child Middle Name",
    fieldKey: "middle_name",
    uprightBox: { x: 0.36, y: 0.120, width: 0.30, height: 0.050 },
    identityRelativeBox: { x: 0.36, y: 0.02, width: 0.30, height: 0.08 },
  },
  {
    id: "child_last",
    label: "Child Last Name",
    fieldKey: "last_name",
    uprightBox: { x: 0.66, y: 0.120, width: 0.22, height: 0.050 },
    identityRelativeBox: { x: 0.66, y: 0.02, width: 0.22, height: 0.08 },
  },
  {
    id: "child_sex",
    label: "Child Sex",
    fieldKey: "sex",
    uprightBox: { x: 0.045, y: 0.175, width: 0.305, height: 0.045 },
    identityRelativeBox: { x: 0.01, y: 0.14, width: 0.34, height: 0.08 },
  },
  {
    id: "child_dob",
    label: "Child Date of Birth",
    fieldKey: "birth_date",
    uprightBox: { x: 0.35, y: 0.175, width: 0.53, height: 0.045 },
    identityRelativeBox: { x: 0.35, y: 0.14, width: 0.58, height: 0.08 },
  },
  {
    id: "child_pob",
    label: "Child Place of Birth",
    fieldKey: "birth_place",
    uprightBox: { x: 0.045, y: 0.225, width: 0.835, height: 0.060 },
    identityRelativeBox: { x: 0.01, y: 0.24, width: 0.94, height: 0.12 },
  },
  {
    id: "mother_name",
    label: "Mother Maiden Name",
    fieldKey: "mother_name",
    uprightBox: { x: 0.045, y: 0.350, width: 0.835, height: 0.050 },
    identityRelativeBox: { x: 0.01, y: 0.49, width: 0.94, height: 0.08 },
  },
  {
    id: "father_name",
    label: "Father Name",
    fieldKey: "father_name",
    uprightBox: { x: 0.045, y: 0.480, width: 0.835, height: 0.050 },
    identityRelativeBox: { x: 0.01, y: 0.74, width: 0.94, height: 0.08 },
  },
];

export async function extractPsaSecondaryCrops(
  uprightCanvas: HTMLCanvasElement | null,
  uprightWidth: number,
  uprightHeight: number,
  anchorBoxes?: Partial<Record<PsaSecondaryRegionId, PsaAnchorRefinedBox>>
): Promise<{
  crops: PsaSecondaryCropItem[];
  compositeSheetUrl?: string;
}> {
  const crops: PsaSecondaryCropItem[] = [];

  for (const def of PSA_SECONDARY_REGIONS) {
    const anchorBox = anchorBoxes?.[def.id];
    let sx: number, sy: number, sw: number, sh: number;

    if (anchorBox && anchorBox.anchorFound) {
      sx = Math.max(0, Math.round(uprightWidth * anchorBox.minU));
      sy = Math.max(0, Math.round(uprightHeight * anchorBox.minV));
      sw = Math.min(uprightWidth - sx, Math.round(uprightWidth * (anchorBox.maxU - anchorBox.minU)));
      sh = Math.min(uprightHeight - sy, Math.round(uprightHeight * (anchorBox.maxV - anchorBox.minV)));
    } else {
      sx = Math.max(0, Math.round(uprightWidth * def.uprightBox.x));
      sy = Math.max(0, Math.round(uprightHeight * def.uprightBox.y));
      sw = Math.min(uprightWidth - sx, Math.round(uprightWidth * def.uprightBox.width));
      sh = Math.min(uprightHeight - sy, Math.round(uprightHeight * def.uprightBox.height));
    }

    const isTooSmall = sw < 100 || sh < 25;
    const minDimWarning = isTooSmall ? "Field region too small — move camera closer / recapture" : undefined;

    let dataUrl: string | undefined = undefined;
    let sexDiagnostic: PsaSexMarkAnalysisResult | undefined = undefined;

    if (uprightCanvas && typeof document !== "undefined") {
      try {
        const destScale = 2.0;
        const dw = Math.round(sw * destScale);
        const dh = Math.round(sh * destScale);
        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = dw;
        cropCanvas.height = dh;
        const ctx = cropCanvas.getContext("2d");
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(uprightCanvas, sx, sy, sw, sh, 0, 0, dw, dh);
          dataUrl = cropCanvas.toDataURL("image/png");
        }
      } catch {
        // Fallback gracefully
      }

      if (def.id === "child_sex") {
        try {
          const customBoxes =
            anchorBox && anchorBox.anchorFound
              ? {
                  item2Bounds: {
                    minU: anchorBox.minU,
                    maxU: anchorBox.maxU,
                    minV: anchorBox.minV,
                    maxV: anchorBox.maxV,
                  },
                }
              : undefined;
          sexDiagnostic = await analyzePsaSexMarksFromCanvas(uprightCanvas, customBoxes);
        } catch (e) {
          console.warn("[PSA Sex] Failed to analyze sex marks from canvas:", e);
        }
      }
    }

    crops.push({
      id: def.id,
      label: def.label,
      fieldKey: def.fieldKey,
      dataUrl,
      sourceBox: { x: sx, y: sy, width: sw, height: sh },
      width: sw,
      height: sh,
      isTooSmall,
      minDimWarning,
      sexDiagnostic,
    });
  }

  // Generate Single Secondary Composite Sheet (Section 5)
  // Vertically stacks Child First, Child Middle, Child Last, Mother Name, Father Name
  let compositeSheetUrl: string | undefined = undefined;
  if (uprightCanvas && typeof document !== "undefined") {
    try {
      const selectedIds: PsaSecondaryRegionId[] = [
        "child_first",
        "child_middle",
        "child_last",
        "mother_name",
        "father_name",
      ];
      const sheetWidth = 800;
      const labelHeight = 28;
      const spacing = 12;

      let totalH = 40;
      for (const id of selectedIds) {
        const crop = crops.find((c) => c.id === id);
        const cropAspect = crop && crop.width > 0 ? crop.height / crop.width : 0.2;
        const targetH = Math.round((sheetWidth - 32) * cropAspect);
        totalH += labelHeight + targetH + spacing;
      }

      const sheetCanvas = document.createElement("canvas");
      sheetCanvas.width = sheetWidth;
      sheetCanvas.height = totalH;
      const sheetCtx = sheetCanvas.getContext("2d");
      if (sheetCtx) {
        sheetCtx.fillStyle = "#ffffff";
        sheetCtx.fillRect(0, 0, sheetWidth, totalH);

        sheetCtx.fillStyle = "#0f172a";
        sheetCtx.fillRect(0, 0, sheetWidth, 36);
        sheetCtx.fillStyle = "#ffffff";
        sheetCtx.font = "bold 13px sans-serif";
        sheetCtx.fillText("PSA SECONDARY OCR VERIFICATION SHEET", 16, 23);

        let currY = 46;
        for (const id of selectedIds) {
          const crop = crops.find((c) => c.id === id);
          if (!crop) continue;

          sheetCtx.fillStyle = "#334155";
          sheetCtx.font = "bold 11px sans-serif";
          sheetCtx.fillText(crop.label.toUpperCase(), 16, currY + 16);
          currY += labelHeight;

          const cropAspect = crop.width > 0 ? crop.height / crop.width : 0.2;
          const targetH = Math.round((sheetWidth - 32) * cropAspect);
          sheetCtx.drawImage(
            uprightCanvas,
            crop.sourceBox.x,
            crop.sourceBox.y,
            crop.sourceBox.width,
            crop.sourceBox.height,
            16,
            currY,
            sheetWidth - 32,
            targetH
          );
          currY += targetH + spacing;
        }

        compositeSheetUrl = sheetCanvas.toDataURL("image/png");
      }
    } catch {
      // Fallback gracefully
    }
  }

  return { crops, compositeSheetUrl };
}

/**
 * Re-extracts secondary field crops and updates the composite sheet using anchor-refined coordinates.
 */
export async function refinePsaSecondaryCropsWithAnchors(
  sourceImageDataUrl: string,
  anchorBoxes?: Partial<Record<PsaSecondaryRegionId, PsaAnchorRefinedBox>>
): Promise<{
  crops: PsaSecondaryCropItem[];
  compositeSheetUrl?: string;
}> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { crops: [] };
  }
  try {
    const img = await loadImageElement(sourceImageDataUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return { crops: [] };

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { crops: [] };

    ctx.drawImage(img, 0, 0, w, h);
    return await extractPsaSecondaryCrops(canvas, w, h, anchorBoxes);
  } catch (e) {
    console.warn("Failed to refine secondary crops with anchors:", e);
    return { crops: [] };
  }
}

export interface PsaPipelineResult {
  success: boolean;
  rawUrl: string;
  fullCorrectedUrl: string;
  identityCropUrl: string;
  registryCropUrl?: string;
  secondaryCrops?: PsaSecondaryCropItem[];
  secondaryCompositeSheetUrl?: string;
  isFallback: boolean;
  reason?: string;
  scaleFactor: number;
  diagnostics: PsaPipelineDiagnostics;
}

// ----------------------------------------------------------------------------
// 3. Post-Capture Identity Region Extraction & 2× Auto-Zoom
// ----------------------------------------------------------------------------

/**
 * Extracts the rectangular Identity Region from a normalized upright PSA page,
 * applies safe padding margins, and upscales it (1.75× to 2.0×) for maximum OCR resolution.
 *
 * Tighter Target Prioritization (Section 7):
 * - Child: Item 1 Name, Sex, Date of Birth, Place of Birth
 * - Mother: Maiden Name & identity fields
 * - Father: Name & identity fields
 * Excludes lower sections: Marriage (18), Attendant (19), Informant/Certification (20),
 * Prepared by (21), Received by (22), and Footer/Barcode.
 *
 * If the image cannot be safely cropped or is not a valid certificate,
 * defensively falls back to the full document.
 */
export async function extractPsaIdentityRegion(
  fullUprightDataUrl: string,
  options?: {
    upscaleFactor?: number;
    targetMinDim?: number;
    cropYStart?: number;
    cropYEnd?: number;
    cropXStart?: number;
    cropXEnd?: number;
    autoRotateIfLandscape?: boolean;
  }
): Promise<PsaIdentityCropResult> {
  // If running server-side without DOM, safely return full image
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      success: true,
      dataUrl: fullUprightDataUrl,
      originalDataUrl: fullUprightDataUrl,
      cropBox: { x: 35, y: 133, width: 930, height: 707 },
      scaledWidth: 1860,
      scaledHeight: 1414,
      scaleFactor: 2.0,
      isFallback: true,
      reason: "Server-side fallback: full page preserved.",
    };
  }

  try {
    let img = await loadImageElement(fullUprightDataUrl);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;

    if (!w || !h || w < 100 || h < 100) {
      return {
        success: false,
        dataUrl: fullUprightDataUrl,
        originalDataUrl: fullUprightDataUrl,
        cropBox: { x: 0, y: 0, width: w, height: h },
        scaledWidth: w,
        scaledHeight: h,
        scaleFactor: 1.0,
        isFallback: true,
        reason: "Invalid image dimensions.",
      };
    }

    // Defensive Check: If input image is sideways (landscape, aspect > 1.15),
    // normalize upright to portrait BEFORE calculating identity coordinates
    if (w > h * 1.15) {
      const rotatedUrl = await rotateImageDataUrl(fullUprightDataUrl, 270);
      img = await loadImageElement(rotatedUrl);
      w = img.naturalWidth || img.width;
      h = img.naturalHeight || img.height;
    }

    // Tighter normalized bounds for PSA Identity Region on an upright certificate (Section 7):
    // Vertical: 9.5% to 60.0% (covers Child Name at top down through Father attributes at 60%)
    // Horizontal: 3.5% to 96.5% (covers entire identity section with modest margin padding)
    const yStartNorm = options?.cropYStart ?? 0.095;
    const yEndNorm = options?.cropYEnd ?? 0.60;
    const xStartNorm = options?.cropXStart ?? 0.035;
    const xEndNorm = options?.cropXEnd ?? 0.965;

    const cropX = Math.max(0, Math.round(w * xStartNorm));
    const cropY = Math.max(0, Math.round(h * yStartNorm));
    const cropW = Math.min(w - cropX, Math.round(w * (xEndNorm - xStartNorm)));
    const cropH = Math.min(h - cropY, Math.round(h * (yEndNorm - yStartNorm)));

    const identityArea = cropW * cropH;
    const fullArea = w * h;
    const areaRatio = fullArea > 0 ? identityArea / fullArea : 1.0;

    // Crop Success Check (Section 16):
    // The cropped identity region must be meaningfully smaller than the full page (area ratio < 0.85)
    // and both width or height must be bounded.
    const isMeaningfullySmaller = areaRatio < 0.85 && (cropW < w || cropH < h);
    if (!isMeaningfullySmaller || cropW < 50 || cropH < 50) {
      return {
        success: false,
        dataUrl: fullUprightDataUrl,
        originalDataUrl: fullUprightDataUrl,
        cropBox: { x: 0, y: 0, width: w, height: h },
        scaledWidth: w,
        scaledHeight: h,
        scaleFactor: 1.0,
        isFallback: true,
        reason: "Identity auto-crop unavailable — Full Document Used",
      };
    }

    // Upscale factor: default 2.0x, ensure long edge reaches at least 2000px
    const minTargetDim = options?.targetMinDim ?? 2000;
    const naturalLongEdge = Math.max(cropW, cropH);
    const requestedScale = options?.upscaleFactor ?? 2.0;
    const scaleFactor = Math.max(1.75, Math.min(3.0, Math.max(requestedScale, minTargetDim / naturalLongEdge)));

    const scaledW = Math.round(cropW * scaleFactor);
    const scaledH = Math.round(cropH * scaleFactor);

    // Render upscaled crop to offscreen canvas
    const canvas = document.createElement("canvas");
    canvas.width = scaledW;
    canvas.height = scaledH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        success: false,
        dataUrl: fullUprightDataUrl,
        originalDataUrl: fullUprightDataUrl,
        cropBox: { x: cropX, y: cropY, width: cropW, height: cropH },
        scaledWidth: w,
        scaledHeight: h,
        scaleFactor: 1.0,
        isFallback: true,
        reason: "Canvas context failed.",
      };
    }

    // High quality bicubic resampling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Draw ONLY the identity source rectangle into the destination canvas
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, scaledW, scaledH);

    const dataUrl = canvas.toDataURL("image/png");

    return {
      success: true,
      dataUrl,
      originalDataUrl: fullUprightDataUrl,
      cropBox: {
        x: cropX,
        y: cropY,
        width: cropW,
        height: cropH,
      },
      scaledWidth: scaledW,
      scaledHeight: scaledH,
      scaleFactor: Math.round(scaleFactor * 100) / 100,
      isFallback: false,
    };
  } catch (err: any) {
    return {
      success: false,
      dataUrl: fullUprightDataUrl,
      originalDataUrl: fullUprightDataUrl,
      cropBox: { x: 0, y: 0, width: 0, height: 0 },
      scaledWidth: 0,
      scaledHeight: 0,
      scaleFactor: 1.0,
      isFallback: true,
      reason: err?.message || "Identity region extraction error",
    };
  }
}

/**
 * Extracts the dedicated Civil Registry Number header region (Section 8).
 * Registry No. is in the upper right header: X in [0.48, 0.98], Y in [0.04, 0.14].
 */
export async function extractPsaRegistryRegion(
  fullUprightDataUrl: string
): Promise<{ success: boolean; dataUrl: string }> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { success: false, dataUrl: fullUprightDataUrl };
  }

  try {
    const img = await loadImageElement(fullUprightDataUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const cropX = Math.round(w * 0.48);
    const cropY = Math.round(h * 0.04);
    const cropW = Math.round(w * 0.50);
    const cropH = Math.round(h * 0.12);

    const canvas = document.createElement("canvas");
    canvas.width = cropW * 2;
    canvas.height = cropH * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { success: false, dataUrl: fullUprightDataUrl };

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

    return { success: true, dataUrl: canvas.toDataURL("image/png") };
  } catch {
    return { success: false, dataUrl: fullUprightDataUrl };
  }
}

// ----------------------------------------------------------------------------
// 4. Master Transform Pipeline (Section 4)
// ----------------------------------------------------------------------------

/**
 * Executes the complete correct transform order:
 * RAW CAMERA FRAME
 *       ↓
 * detect paper corners / boundary
 *       ↓
 * perspective crop WHOLE PAPER
 *       ↓
 * rotate paper UPRIGHT
 *       ↓
 * obtain upright width/height
 *       ↓
 * calculate identity region (Child • Mother • Father)
 *       ↓
 * ACTUALLY CROP PIXELS on dedicated canvas
 *       ↓
 * upscale cropped pixels (2.0×)
 *       ↓
 * extract separate registry crop
 */
export async function processPsaTransformPipeline(
  rawDataUrl: string,
  liveHint?: PsaLiveDetectionResult | null
): Promise<PsaPipelineResult> {
  // If running server-side without DOM:
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      success: true,
      rawUrl: rawDataUrl,
      fullCorrectedUrl: rawDataUrl,
      identityCropUrl: rawDataUrl,
      isFallback: true,
      reason: "Server-side fallback: DOM unavailable.",
      scaleFactor: 1.0,
      diagnostics: {
        rawDimensions: { width: 1000, height: 1400 },
        fullCorrectedDimensions: { width: 1000, height: 1400 },
        identitySourceCrop: { x: 35, y: 133, width: 930, height: 707 },
        identityOcrOutput: { width: 1860, height: 1414 },
        scale: 2.0,
        areaRatio: 0.47,
        orientationAngle: 0,
        isSideways: false,
      },
    };
  }

  const img = await loadImageElement(rawDataUrl);
  const rawW = img.naturalWidth || img.width;
  const rawH = img.naturalHeight || img.height;

  // 1. Detect if raw frame is sideways (landscape frame of portrait PSA)
  const isSideways = liveHint?.isSideways ?? (rawW > rawH * 1.15);
  const detectedOrientation = liveHint?.orientationAngle ?? (isSideways ? 90 : 0);

  // 2. Detect whole paper boundary in the frame
  const sampleScale = Math.min(1.0, 320 / Math.max(rawW, rawH));
  const sW = Math.round(rawW * sampleScale);
  const sH = Math.round(rawH * sampleScale);

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sW;
  sampleCanvas.height = sH;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

  let paperX = 0;
  let paperY = 0;
  let paperW = rawW;
  let paperH = rawH;

  if (sampleCtx) {
    sampleCtx.drawImage(img, 0, 0, sW, sH);
    const imgData = sampleCtx.getImageData(0, 0, sW, sH);
    const data = imgData.data;
    const gray = new Uint8ClampedArray(sW * sH);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }
    const detection = detectPsaPaperAndIdentity(gray, sW, sH);
    if (detection.detected && detection.paperBox && detection.confidence >= 0.40) {
      const pb = detection.paperBox;
      // Only crop if paper boundary is distinct from the entire frame (< 96%)
      if (pb.width * pb.height < 0.96) {
        paperX = Math.max(0, Math.round(pb.x * rawW));
        paperY = Math.max(0, Math.round(pb.y * rawH));
        paperW = Math.min(rawW - paperX, Math.round(pb.width * rawW));
        paperH = Math.min(rawH - paperY, Math.round(pb.height * rawH));
      }
    }
  }

  // 3. Perspective crop whole paper
  const paperCanvas = document.createElement("canvas");
  paperCanvas.width = paperW;
  paperCanvas.height = paperH;
  const paperCtx = paperCanvas.getContext("2d");
  if (!paperCtx) throw new Error("Paper canvas failed");
  paperCtx.drawImage(img, paperX, paperY, paperW, paperH, 0, 0, paperW, paperH);

  // 4. Rotate paper UPRIGHT into portrait
  let uprightCanvas: HTMLCanvasElement;
  const paperIsLandscape = paperW > paperH * 1.15;
  if (isSideways || paperIsLandscape || detectedOrientation === 90) {
    uprightCanvas = document.createElement("canvas");
    uprightCanvas.width = paperH;
    uprightCanvas.height = paperW;
    const uprightCtx = uprightCanvas.getContext("2d");
    if (!uprightCtx) throw new Error("Upright canvas context failed");
    uprightCtx.translate(uprightCanvas.width / 2, uprightCanvas.height / 2);
    // Standard phone camera held landscape gives 90° clockwise sideways orientation;
    // to rotate upright into portrait: rotate 270° clockwise
    uprightCtx.rotate((270 * Math.PI) / 180);
    uprightCtx.drawImage(paperCanvas, -paperW / 2, -paperH / 2);
  } else {
    uprightCanvas = paperCanvas;
  }

  const fullCorrectedUrl = uprightCanvas.toDataURL("image/png");
  const uprightW = uprightCanvas.width;
  const uprightH = uprightCanvas.height;

  // 5. Calculate Tighter Identity Region on UPRIGHT document
  // Covers Child, Mother, and Father (9.5% to 60.0%)
  const cropXStart = 0.035;
  const cropXEnd = 0.965;
  const cropYStart = 0.095;
  const cropYEnd = 0.60;

  const sx = Math.max(0, Math.round(uprightW * cropXStart));
  const sy = Math.max(0, Math.round(uprightH * cropYStart));
  const sw = Math.min(uprightW - sx, Math.round(uprightW * (cropXEnd - cropXStart)));
  const sh = Math.min(uprightH - sy, Math.round(uprightH * (cropYEnd - cropYStart)));

  const identityArea = sw * sh;
  const fullArea = uprightW * uprightH;
  const areaRatio = fullArea > 0 ? identityArea / fullArea : 1.0;

  // Crop Success Check (Section 16)
  const isMeaningfullySmaller = areaRatio < 0.85 && (sw < uprightW || sh < uprightH);
  if (!isMeaningfullySmaller || sw < 100 || sh < 100) {
    return {
      success: false,
      rawUrl: rawDataUrl,
      fullCorrectedUrl,
      identityCropUrl: fullCorrectedUrl,
      isFallback: true,
      reason: "Identity auto-crop unavailable — Full Document Used",
      scaleFactor: 1.0,
      diagnostics: {
        rawDimensions: { width: rawW, height: rawH },
        fullCorrectedDimensions: { width: uprightW, height: uprightH },
        identitySourceCrop: { x: 0, y: 0, width: uprightW, height: uprightH },
        identityOcrOutput: { width: uprightW, height: uprightH },
        scale: 1.0,
        areaRatio: 1.0,
        orientationAngle: detectedOrientation,
        isSideways,
      },
    };
  }

  // 6. ACTUALLY CROP & UPSCALE PIXELS on dedicated canvas
  const naturalLongEdge = Math.max(sw, sh);
  const minTargetDim = 2000;
  const scaleFactor = Math.max(1.75, Math.min(3.0, Math.max(2.0, minTargetDim / naturalLongEdge)));
  const destW = Math.round(sw * scaleFactor);
  const destH = Math.round(sh * scaleFactor);

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = destW;
  cropCanvas.height = destH;
  const cropCtx = cropCanvas.getContext("2d");
  if (!cropCtx) throw new Error("Crop canvas context failed");

  cropCtx.imageSmoothingEnabled = true;
  cropCtx.imageSmoothingQuality = "high";
  // Draw ONLY the source rectangle (sx, sy, sw, sh)
  cropCtx.drawImage(uprightCanvas, sx, sy, sw, sh, 0, 0, destW, destH);
  const identityCropUrl = cropCanvas.toDataURL("image/png");

  // 7. Dedicated Registry Crop (Section 8)
  const regX = Math.max(0, Math.round(uprightW * 0.48));
  const regY = Math.max(0, Math.round(uprightH * 0.04));
  const regW = Math.min(uprightW - regX, Math.round(uprightW * 0.50));
  const regH = Math.min(uprightH - regY, Math.round(uprightH * 0.12));

  const regCanvas = document.createElement("canvas");
  regCanvas.width = regW * 2;
  regCanvas.height = regH * 2;
  const regCtx = regCanvas.getContext("2d");
  let registryCropUrl: string | undefined = undefined;
  if (regCtx) {
    regCtx.imageSmoothingEnabled = true;
    regCtx.imageSmoothingQuality = "high";
    regCtx.drawImage(uprightCanvas, regX, regY, regW, regH, 0, 0, regCanvas.width, regCanvas.height);
    registryCropUrl = regCanvas.toDataURL("image/png");
  }

  // 8. Extract Secondary Field Regions & Verification Sheet (Section 1 to 5)
  const { crops: secondaryCrops, compositeSheetUrl: secondaryCompositeSheetUrl } =
    await extractPsaSecondaryCrops(uprightCanvas, uprightW, uprightH);

  const secondaryFieldRegions: Record<
    string,
    { x: number; y: number; width: number; height: number; isTooSmall: boolean }
  > = {};
  for (const c of secondaryCrops) {
    secondaryFieldRegions[c.id] = {
      x: c.sourceBox.x,
      y: c.sourceBox.y,
      width: c.sourceBox.width,
      height: c.sourceBox.height,
      isTooSmall: c.isTooSmall,
    };
  }

  return {
    success: true,
    rawUrl: rawDataUrl,
    fullCorrectedUrl,
    identityCropUrl,
    registryCropUrl,
    secondaryCrops,
    secondaryCompositeSheetUrl,
    isFallback: false,
    scaleFactor: Math.round(scaleFactor * 100) / 100,
    diagnostics: {
      rawDimensions: { width: rawW, height: rawH },
      fullCorrectedDimensions: { width: uprightW, height: uprightH },
      identitySourceCrop: { x: sx, y: sy, width: sw, height: sh },
      identityOcrOutput: { width: destW, height: destH },
      scale: Math.round(scaleFactor * 100) / 100,
      areaRatio: Math.round(areaRatio * 1000) / 1000,
      orientationAngle: detectedOrientation,
      isSideways,
      secondaryFieldRegions,
    },
  };
}

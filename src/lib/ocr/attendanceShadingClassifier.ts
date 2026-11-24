/**
 * AVV System — SF2 Attendance Cell Shading & Pattern Recognition Classifier
 *
 * Dedicated image-processing and pattern-recognition component for DepEd SF2 Daily Attendance.
 * Analyzes attendance cell regions to accurately distinguish:
 * 1. Full shade (Absent)
 * 2. Half shade (Tardy / Cutting class / Half-day)
 * 3. Unmarked (Present — standard DepEd SF2 convention)
 * 4. Unclear / needs teacher verification (Ambiguous smudge, faint mark, or scan artifact)
 *
 * NOTE: Operates as an independent image-processing component separate from Azure OCR/ICR.
 */

export type ShadingClassification =
  | "FULL_SHADE"
  | "HALF_SHADE"
  | "UNMARKED"
  | "UNCLEAR";

export type AttendanceGridStatus =
  | "PRESENT"
  | "ABSENT"
  | "TARDY"
  | "NEEDS_VERIFICATION";

export interface PixelMatrix {
  width: number;
  height: number;
  /** Grayscale values 0..255 (0 = pure black, 255 = pure white) or RGBA buffer */
  data: Uint8Array | number[];
  channels?: 1 | 3 | 4;
}

export interface AttendanceCellContext {
  day: number;
  learnerName?: string;
  cellText?: string;
  cellPolygon?: number[];
  pageNumber?: number;
  pixelData?: PixelMatrix;
  visualFillRatio?: number;
}

export interface CellShadingClassificationResult {
  day: number;
  classification: ShadingClassification;
  attendance_status: AttendanceGridStatus;
  confidence: number;
  fill_ratio: number;
  is_shaded: boolean;
  is_half_shaded: boolean;
  requires_teacher_verification: boolean;
  classifier_method: "pixel_density_pattern_analysis" | "visual_feature_analysis";
  explanation: string;
  cell_polygon?: number[];
  page_number?: number;
}

/**
 * Analyzes a raw raster pixel matrix representing an individual attendance cell.
 * Evaluates overall darkness fill factor, quadrant symmetry, and diagonal split.
 */
export function classifyCellFromPixels(pixels: PixelMatrix): {
  classification: ShadingClassification;
  confidence: number;
  fillRatio: number;
  diagonalUpperRatio: number;
  diagonalLowerRatio: number;
  asymmetryRatio: number;
  explanation: string;
} {
  const { width, height, data, channels = 1 } = pixels;
  if (width <= 0 || height <= 0 || !data || data.length === 0) {
    return {
      classification: "UNCLEAR",
      confidence: 0.5,
      fillRatio: 0,
      diagonalUpperRatio: 0,
      diagonalLowerRatio: 0,
      asymmetryRatio: 0,
      explanation: "Empty or invalid pixel matrix provided for cell region.",
    };
  }

  // Margin exclusion: crop 10% border to avoid counting cell grid lines
  const startX = Math.floor(width * 0.1);
  const endX = Math.ceil(width * 0.9);
  const startY = Math.floor(height * 0.1);
  const endY = Math.ceil(height * 0.9);

  const innerWidth = Math.max(1, endX - startX);
  const innerHeight = Math.max(1, endY - startY);
  let totalInnerPixels = 0;
  let darkInnerPixels = 0;

  let upperDiagDark = 0;
  let upperDiagTotal = 0;
  let lowerDiagDark = 0;
  let lowerDiagTotal = 0;

  let topDark = 0;
  let topTotal = 0;
  let bottomDark = 0;
  let bottomTotal = 0;

  // Midpoint references
  const midY = startY + innerHeight / 2;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      let luminance: number;

      if (channels === 1) {
        luminance = data[y * width + x] / 255;
      } else {
        const offset = (y * width + x) * channels;
        const r = data[offset] / 255;
        const g = data[offset + 1] / 255;
        const b = data[offset + 2] / 255;
        // Standard Rec. 601 luma formula
        luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      }

      // Dark threshold: luminance < 0.55 indicates ink / pencil shading
      const isDark = luminance < 0.55;
      totalInnerPixels++;
      if (isDark) darkInnerPixels++;

      // Diagonal split: normalized coordinates
      const normX = (x - startX) / innerWidth;
      const normY = (y - startY) / innerHeight;

      if (normY < normX) {
        upperDiagTotal++;
        if (isDark) upperDiagDark++;
      } else {
        lowerDiagTotal++;
        if (isDark) lowerDiagDark++;
      }

      if (y < midY) {
        topTotal++;
        if (isDark) topDark++;
      } else {
        bottomTotal++;
        if (isDark) bottomDark++;
      }
    }
  }

  const fillRatio = totalInnerPixels > 0 ? darkInnerPixels / totalInnerPixels : 0;
  const diagUpperRatio = upperDiagTotal > 0 ? upperDiagDark / upperDiagTotal : 0;
  const diagLowerRatio = lowerDiagTotal > 0 ? lowerDiagDark / lowerDiagTotal : 0;
  const topRatio = topTotal > 0 ? topDark / topTotal : 0;
  const bottomRatio = bottomTotal > 0 ? bottomDark / bottomTotal : 0;

  const diagDiff = Math.abs(diagUpperRatio - diagLowerRatio);
  const verticalDiff = Math.abs(topRatio - bottomRatio);
  const asymmetryRatio = Math.max(diagDiff, verticalDiff);

  // Classification Thresholds:
  // 1. FULL_SHADE: High uniform fill ratio (>= 0.55)
  if (fillRatio >= 0.55) {
    const confidence = Math.min(0.99, Math.round((0.85 + fillRatio * 0.14) * 100) / 100);
    return {
      classification: "FULL_SHADE",
      confidence,
      fillRatio: Math.round(fillRatio * 1000) / 1000,
      diagonalUpperRatio: Math.round(diagUpperRatio * 1000) / 1000,
      diagonalLowerRatio: Math.round(diagLowerRatio * 1000) / 1000,
      asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
      explanation: `Cell is fully shaded (density: ${(fillRatio * 100).toFixed(1)}%). Indicates Absent.`,
    };
  }

  // 2. UNMARKED: Very low fill ratio (< 0.12) indicating clean/blank white cell
  if (fillRatio < 0.12) {
    const confidence = Math.min(0.99, Math.round((0.90 + (0.12 - fillRatio) * 0.75) * 100) / 100);
    return {
      classification: "UNMARKED",
      confidence,
      fillRatio: Math.round(fillRatio * 1000) / 1000,
      diagonalUpperRatio: Math.round(diagUpperRatio * 1000) / 1000,
      diagonalLowerRatio: Math.round(diagLowerRatio * 1000) / 1000,
      asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
      explanation: `Cell is unmarked (density: ${(fillRatio * 100).toFixed(1)}%). Indicates Present.`,
    };
  }

  // 3. HALF_SHADE: Intermediate fill (0.20 <= fillRatio < 0.55) with pronounced asymmetry
  if (fillRatio >= 0.20 && asymmetryRatio >= 0.18) {
    const confidence = Math.min(0.95, Math.round((0.80 + asymmetryRatio * 0.25) * 100) / 100);
    return {
      classification: "HALF_SHADE",
      confidence,
      fillRatio: Math.round(fillRatio * 1000) / 1000,
      diagonalUpperRatio: Math.round(diagUpperRatio * 1000) / 1000,
      diagonalLowerRatio: Math.round(diagLowerRatio * 1000) / 1000,
      asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
      explanation: `Cell is half-shaded (density: ${(fillRatio * 100).toFixed(1)}%, asymmetry: ${(asymmetryRatio * 100).toFixed(1)}%). Indicates Tardy / Half-day.`,
    };
  }

  // 4. UNCLEAR: Ambiguous density (0.12..0.20) or symmetric smudge/scribble
  return {
    classification: "UNCLEAR",
    confidence: 0.60,
    fillRatio: Math.round(fillRatio * 1000) / 1000,
    diagonalUpperRatio: Math.round(diagUpperRatio * 1000) / 1000,
    diagonalLowerRatio: Math.round(diagLowerRatio * 1000) / 1000,
    asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
    explanation: `Ambiguous mark or smudge in cell (density: ${(fillRatio * 100).toFixed(1)}%). Requires teacher verification.`,
  };
}

/**
 * Classifies an SF2 daily attendance cell using image processing or visual feature analysis.
 */
export function classifyAttendanceCell(context: AttendanceCellContext): CellShadingClassificationResult {
  const { day, cellText = "", cellPolygon, pageNumber = 1, pixelData, visualFillRatio } = context;

  // 1. Direct pixel processing if raster matrix is provided
  if (pixelData && pixelData.width > 0 && pixelData.height > 0) {
    const res = classifyCellFromPixels(pixelData);
    const attendanceStatus: AttendanceGridStatus =
      res.classification === "FULL_SHADE"
        ? "ABSENT"
        : res.classification === "HALF_SHADE"
        ? "TARDY"
        : res.classification === "UNMARKED"
        ? "PRESENT"
        : "NEEDS_VERIFICATION";

    return {
      day,
      classification: res.classification,
      attendance_status: attendanceStatus,
      confidence: res.confidence,
      fill_ratio: res.fillRatio,
      is_shaded: res.classification === "FULL_SHADE",
      is_half_shaded: res.classification === "HALF_SHADE",
      requires_teacher_verification: res.classification === "UNCLEAR",
      classifier_method: "pixel_density_pattern_analysis",
      explanation: res.explanation,
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // 2. Direct density override if pre-computed
  if (typeof visualFillRatio === "number" && !isNaN(visualFillRatio)) {
    const simulatedPixels: PixelMatrix = {
      width: 10,
      height: 10,
      data: Array.from({ length: 100 }, (_, i) => {
        // synthesize upper diagonal half if between 0.2 and 0.55
        if (visualFillRatio >= 0.2 && visualFillRatio < 0.55) {
          const row = Math.floor(i / 10);
          const col = i % 10;
          return col > row ? 0 : 255;
        }
        return (i / 100) < visualFillRatio ? 0 : 255;
      }),
      channels: 1,
    };
    return classifyAttendanceCell({ ...context, pixelData: simulatedPixels });
  }

  // 3. Visual mark and pattern feature analysis from layout/OCR tokens
  const clean = cellText.trim().toLowerCase();

  // Pattern A: Full Shade representations
  if (
    clean === "full" ||
    clean === "shaded" ||
    clean === "x" ||
    clean === "×" ||
    clean === "✕" ||
    clean === "■" ||
    clean === "█" ||
    clean === "●" ||
    clean === "[x]" ||
    clean === "absent"
  ) {
    return {
      day,
      classification: "FULL_SHADE",
      attendance_status: "ABSENT",
      confidence: 0.94,
      fill_ratio: 0.85,
      is_shaded: true,
      is_half_shaded: false,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: `Fully shaded cell pattern identified ("${cellText}"). Classified as Absent.`,
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern B: Half Shade representations (diagonal triangles, half block, slash)
  if (
    clean === "half" ||
    clean === "half-shade" ||
    clean === "/" ||
    clean === "\\" ||
    clean === "◢" ||
    clean === "◣" ||
    clean === "◤" ||
    clean === "◥" ||
    clean === "▲" ||
    clean === "▼" ||
    clean === "t" ||
    clean === "tardy"
  ) {
    return {
      day,
      classification: "HALF_SHADE",
      attendance_status: "TARDY",
      confidence: 0.91,
      fill_ratio: 0.42,
      is_shaded: false,
      is_half_shaded: true,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: `Half-shaded diagonal pattern identified ("${cellText}"). Classified as Tardy / Half-day.`,
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern C: Unmarked (blank, clean cell, or explicit 'P' mark)
  if (clean === "" || clean === "p" || clean === "present" || clean === "-") {
    return {
      day,
      classification: "UNMARKED",
      attendance_status: "PRESENT",
      confidence: 0.96,
      fill_ratio: 0.02,
      is_shaded: false,
      is_half_shaded: false,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: "Cell is unmarked (clean white cell). Classified as Present per DepEd SF2 standard.",
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern D: Unclear / smudged / unreadable mark
  return {
    day,
    classification: "UNCLEAR",
    attendance_status: "NEEDS_VERIFICATION",
    confidence: 0.50,
    fill_ratio: 0.25,
    is_shaded: false,
    is_half_shaded: false,
    requires_teacher_verification: true,
    classifier_method: "visual_feature_analysis",
    explanation: `Unclear mark ("${cellText}") in attendance cell. Flagged for teacher verification.`,
    cell_polygon: cellPolygon,
    page_number: pageNumber,
  };
}

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
  | "BLANK"
  | "X_MARK"
  | "UPPER_HALF_SHADE"
  | "LOWER_HALF_SHADE"
  | "FULL_COLUMN_SHADE"
  | "IMPROPER_FULL_CELL_SHADE"
  | "FULL_SHADE"
  | "HALF_SHADE"
  | "UNMARKED"
  | "UNCLEAR";

export type AttendanceGridStatus =
  | "PRESENT"
  | "ABSENT"
  | "TARDY"
  | "HOLIDAY"
  | "NO_CLASS"
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
  imageBuffer?: Buffer | Uint8Array;
  isColumnHoliday?: boolean;
}

export function detectHolidayColumn(
  columnCells: Array<{ fillRatio?: number; isShaded?: boolean }>,
  threshold: number = 0.65
): boolean {
  if (!columnCells || columnCells.length === 0) return false;
  const shadedCount = columnCells.filter((c) => (c.fillRatio ?? 0) >= 0.50 || c.isShaded).length;
  return shadedCount / columnCells.length >= threshold;
}

export interface CellShadingClassificationResult {
  isAbsent?: boolean;
  isTardy?: boolean;
  isPresent?: boolean;
  isHoliday?: boolean;
  day: number;
  classification: ShadingClassification;
  attendance_status: AttendanceGridStatus;
  confidence: number;
  fill_ratio: number;
  is_shaded: boolean;
  is_half_shaded: boolean;
  is_holiday?: boolean;
  is_improper_shade?: boolean;
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
export function classifyCellFromPixels(
  pixels: PixelMatrix | { fillRatio: number; upperFillRatio?: number; lowerFillRatio?: number; isColumnHoliday?: boolean },
  options?: { isColumnHoliday?: boolean }
): {
  classification: ShadingClassification;
  confidence: number;
  fillRatio: number;
  diagonalUpperRatio: number;
  diagonalLowerRatio: number;
  asymmetryRatio: number;
  explanation: string;
  isAbsent?: boolean;
  isTardy?: boolean;
  isPresent?: boolean;
  isHoliday?: boolean;
  isImproperFullShade?: boolean;
} {
  if ("fillRatio" in pixels && typeof (pixels as any).fillRatio === "number" && !("data" in pixels)) {
    const p = pixels as { fillRatio: number; upperFillRatio?: number; lowerFillRatio?: number; isColumnHoliday?: boolean };
    const isColHol = p.isColumnHoliday ?? options?.isColumnHoliday ?? false;
    const upperRatio = p.upperFillRatio ?? p.fillRatio;
    const lowerRatio = p.lowerFillRatio ?? p.fillRatio;
    const asymmetry = Math.abs(upperRatio - lowerRatio) / Math.max(0.01, (upperRatio + lowerRatio) / 2);

    let classification: ShadingClassification = "BLANK";
    let isAbsent = false;
    let isTardy = false;
    let isPresent = true;
    let isHoliday = false;
    let isImproperFullShade = false;

    if (isColHol) {
      classification = "FULL_COLUMN_SHADE";
      isHoliday = true;
      isPresent = false;
    } else if (p.fillRatio >= 0.72) {
      classification = "IMPROPER_FULL_CELL_SHADE";
      isImproperFullShade = true;
      isPresent = true;
    } else if (upperRatio >= 0.35 && lowerRatio < 0.25) {
      classification = "UPPER_HALF_SHADE";
      isTardy = true;
      isPresent = true;
    } else if (lowerRatio >= 0.35 && upperRatio < 0.25) {
      classification = "LOWER_HALF_SHADE";
      isTardy = true;
      isPresent = true;
    } else if (p.fillRatio < 0.15) {
      classification = "BLANK";
      isPresent = true;
    } else {
      classification = "UNCLEAR";
    }

    return {
      classification,
      confidence: 0.95,
      fillRatio: p.fillRatio,
      diagonalUpperRatio: upperRatio,
      diagonalLowerRatio: lowerRatio,
      asymmetryRatio: asymmetry,
      explanation: "Direct ratio evaluation",
      isAbsent,
      isTardy,
      isPresent,
      isHoliday,
      isImproperFullShade,
    };
  }

  const res = classifyCellFromPixelsImpl(pixels as PixelMatrix, options);
  const isAbsent = res.classification === "X_MARK" || res.classification === "FULL_SHADE";
  const isTardy = res.classification === "UPPER_HALF_SHADE" || res.classification === "LOWER_HALF_SHADE" || res.classification === "HALF_SHADE";
  const isHoliday = res.classification === "FULL_COLUMN_SHADE";
  const isPresent = !isAbsent && !isHoliday;
  return {
    ...res,
    isAbsent,
    isTardy,
    isPresent,
    isHoliday,
    isImproperFullShade: res.classification === "IMPROPER_FULL_CELL_SHADE",
  };
}

function classifyCellFromPixelsImpl(
  pixels: PixelMatrix,
  options?: { isColumnHoliday?: boolean }
): {
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
        luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      }

      const isDark = luminance < 0.55;
      totalInnerPixels++;
      if (isDark) darkInnerPixels++;

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

  if (fillRatio >= 0.35 || (fillRatio >= 0.30 && asymmetryRatio < 0.20)) {
    if (options?.isColumnHoliday) {
      return {
        classification: "FULL_COLUMN_SHADE",
        confidence: 0.98,
        fillRatio: Math.round(fillRatio * 1000) / 1000,
        diagonalUpperRatio: Math.round(diagUpperRatio * 1000) / 1000,
        diagonalLowerRatio: Math.round(diagLowerRatio * 1000) / 1000,
        asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
        explanation: `Date column is fully shaded vertically (Holiday / No Class). Excluded from total school days.`,
      };
    }
    return {
      classification: "IMPROPER_FULL_CELL_SHADE",
      confidence: 0.70,
      fillRatio: Math.round(fillRatio * 1000) / 1000,
      diagonalUpperRatio: Math.round(diagUpperRatio * 1000) / 1000,
      diagonalLowerRatio: Math.round(diagLowerRatio * 1000) / 1000,
      asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
      explanation: `Cell is fully shaded solid black on regular school day (density: ${(fillRatio * 100).toFixed(1)}%). Formatting violation (improper full-cell shading).`,
    };
  }

  if (fillRatio < 0.12) {
    const confidence = Math.min(0.99, Math.round((0.90 + (0.12 - fillRatio) * 0.75) * 100) / 100);
    return {
      classification: "BLANK",
      confidence,
      fillRatio: Math.round(fillRatio * 1000) / 1000,
      diagonalUpperRatio: Math.round(diagUpperRatio * 1000) / 1000,
      diagonalLowerRatio: Math.round(diagLowerRatio * 1000) / 1000,
      asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
      explanation: `Cell is blank/unmarked (density: ${(fillRatio * 100).toFixed(1)}%). Indicates Present per DepEd SF2 standard.`,
    };
  }

  if (fillRatio >= 0.15 && asymmetryRatio >= 0.15) {
    const isUpper = diagUpperRatio >= diagLowerRatio || topRatio >= bottomRatio;
    const confidence = Math.min(0.95, Math.round((0.80 + asymmetryRatio * 0.25) * 100) / 100);
    if (isUpper) {
      return {
        classification: "UPPER_HALF_SHADE",
        confidence,
        fillRatio: Math.round(fillRatio * 1000) / 1000,
        diagonalUpperRatio: Math.round(diagUpperRatio * 1000) / 1000,
        diagonalLowerRatio: Math.round(diagLowerRatio * 1000) / 1000,
        asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
        explanation: `Cell upper-half/triangle is shaded (density: ${(fillRatio * 100).toFixed(1)}%). Indicates Tardy — Late Comer.`,
      };
    } else {
      return {
        classification: "LOWER_HALF_SHADE",
        confidence,
        fillRatio: Math.round(fillRatio * 1000) / 1000,
        diagonalUpperRatio: Math.round(diagUpperRatio * 1000) / 1000,
        diagonalLowerRatio: Math.round(diagLowerRatio * 1000) / 1000,
        asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
        explanation: `Cell lower-half/triangle is shaded (density: ${(fillRatio * 100).toFixed(1)}%). Indicates Tardy — Cutting Classes.`,
      };
    }
  }

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
export function classifyAttendanceCell(
  contextOrText: AttendanceCellContext | string,
  visualFillRatioArg?: number,
  optionsArg?: { isColumnHoliday?: boolean; isHoliday?: boolean }
): CellShadingClassificationResult {
  const context: AttendanceCellContext =
    typeof contextOrText === "string"
      ? {
          day: 1,
          cellText: contextOrText,
          visualFillRatio: visualFillRatioArg,
          isColumnHoliday: optionsArg?.isColumnHoliday ?? optionsArg?.isHoliday,
        }
      : contextOrText;
  const raw = classifyAttendanceCellInternal(context);
  const isAbsent = raw.attendance_status === "ABSENT";
  const isTardy = raw.attendance_status === "TARDY";
  const isHoliday = raw.attendance_status === "HOLIDAY" || Boolean(raw.is_holiday);
  const isPresent = !isAbsent && !isHoliday;
  return {
    ...raw,
    isAbsent,
    isTardy,
    isPresent,
    isHoliday,
  };
}

function classifyAttendanceCellInternal(context: AttendanceCellContext): CellShadingClassificationResult {
  const { day, cellText = "", cellPolygon, pageNumber = 1, pixelData, visualFillRatio, isColumnHoliday } = context;
  const clean = cellText.trim().toLowerCase();

  // Explicit text mark checks before pixel simulation
  if (clean === "x" || clean === "×" || clean === "✕" || clean === "x_mark" || clean === "[x]" || clean === "absent") {
    return {
      day,
      classification: "X_MARK",
      attendance_status: "ABSENT",
      confidence: 0.96,
      fill_ratio: typeof visualFillRatio === "number" ? visualFillRatio : 0.28,
      is_shaded: false,
      is_half_shaded: false,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: "Cell contains explicit 'X' mark (Absent). Adds +1 to gridAbsentCount.",
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  if ((clean === "" || clean === "blank" || clean === "unmarked" || clean === "present") && (visualFillRatio === undefined || visualFillRatio < 0.15) && !pixelData && !isColumnHoliday) {
    return {
      day,
      classification: "BLANK",
      attendance_status: "PRESENT",
      confidence: 0.99,
      fill_ratio: typeof visualFillRatio === "number" ? visualFillRatio : 0.02,
      is_shaded: false,
      is_half_shaded: false,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: "Empty cell with minimal ink density. Counts as Present (adds 0 to Absent, 0 to Tardy).",
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // 0. Holiday column override: Entire date column shaded vertically
  if (isColumnHoliday) {
    return {
      day,
      classification: "FULL_COLUMN_SHADE",
      attendance_status: "HOLIDAY",
      confidence: 0.98,
      fill_ratio: 0.95,
      is_shaded: true,
      is_half_shaded: false,
      is_holiday: true,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: "Entire date column shaded vertically (Holiday / No Class). Excluded from total school days.",
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // 1. Direct pixel processing if raster matrix is provided
  if (pixelData && pixelData.width > 0 && pixelData.height > 0) {
    const res = classifyCellFromPixels(pixelData, { isColumnHoliday });
    let attendanceStatus: AttendanceGridStatus = "PRESENT";
    if (res.classification === "FULL_COLUMN_SHADE") {
      attendanceStatus = "HOLIDAY";
    } else if (res.classification === "X_MARK" || res.classification === "FULL_SHADE") {
      attendanceStatus = "ABSENT";
    } else if (
      res.classification === "UPPER_HALF_SHADE" ||
      res.classification === "LOWER_HALF_SHADE" ||
      res.classification === "HALF_SHADE"
    ) {
      attendanceStatus = "TARDY";
    } else if (res.classification === "BLANK" || res.classification === "UNMARKED") {
      attendanceStatus = "PRESENT";
    } else if (res.classification === "IMPROPER_FULL_CELL_SHADE") {
      attendanceStatus = "PRESENT"; // Counted as present or audited, flagged as improper formatting
    } else {
      attendanceStatus = "NEEDS_VERIFICATION";
    }

    const isImproper = res.classification === "IMPROPER_FULL_CELL_SHADE";
    const isHalfShaded =
      res.classification === "UPPER_HALF_SHADE" ||
      res.classification === "LOWER_HALF_SHADE" ||
      res.classification === "HALF_SHADE";

    return {
      day,
      classification: res.classification,
      attendance_status: attendanceStatus,
      confidence: res.confidence,
      fill_ratio: res.fillRatio,
      is_shaded: res.classification === "FULL_COLUMN_SHADE" || isImproper || res.classification === "FULL_SHADE",
      is_half_shaded: isHalfShaded,
      is_holiday: res.classification === "FULL_COLUMN_SHADE",
      is_improper_shade: isImproper,
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
        if (visualFillRatio >= 0.15 && visualFillRatio < 0.55) {
          const row = Math.floor(i / 10);
          const col = i % 10;
          return col > row ? 0 : 255;
        }
        return i / 100 < visualFillRatio ? 0 : 255;
      }),
      channels: 1,
    };
    return classifyAttendanceCell({ ...context, pixelData: simulatedPixels });
  }

  // 3. Visual mark and pattern feature analysis from layout/OCR tokens
  // Pattern A: Holiday / Full Column Shade
  if (
    clean === "holiday" ||
    clean === "no class" ||
    clean === "no_class" ||
    clean === "no-class" ||
    clean === "full_column_shade" ||
    clean === "column_shade" ||
    clean === "column_shaded"
  ) {
    return {
      day,
      classification: "FULL_COLUMN_SHADE",
      attendance_status: "HOLIDAY",
      confidence: 0.98,
      fill_ratio: 0.95,
      is_shaded: true,
      is_half_shaded: false,
      is_holiday: true,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: `Entire column shaded vertically (Holiday / No Class). Excluded from total school days.`,
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern B: Blank / Present (Official DepEd convention: clean/unmarked cell indicates Present)
  if (
    clean === "" ||
    clean === "blank" ||
    clean === "unmarked" ||
    clean === "clean" ||
    clean === "white" ||
    clean === "p" ||
    clean === "present" ||
    clean === "-"
  ) {
    return {
      day,
      classification: "BLANK",
      attendance_status: "PRESENT",
      confidence: 0.96,
      fill_ratio: 0.02,
      is_shaded: false,
      is_half_shaded: false,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: "Cell is blank (unmarked). Classified as Present per DepEd SF2 standard (adds 0 to ABSENT, 0 to TARDY).",
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern C: 'X' Mark / Absent (Official DepEd convention: 'x' indicates Absent)
  if (
    clean === "x" ||
    clean === "×" ||
    clean === "✕" ||
    clean === "[x]" ||
    clean === "(x)" ||
    clean === "absent" ||
    clean === "x_mark" ||
    clean === "x mark" ||
    clean === "cross"
  ) {
    return {
      day,
      classification: "X_MARK",
      attendance_status: "ABSENT",
      confidence: 0.95,
      fill_ratio: 0.40,
      is_shaded: false,
      is_half_shaded: false,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: `Cell contains 'X' mark. Classified as Absent (adds +1 to gridAbsentCount).`,
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern D: Upper Half Shade (Late Comer — Tardy)
  if (
    clean === "upper_half_shade" ||
    clean === "upper_half" ||
    clean === "upper_triangle" ||
    clean === "upper" ||
    clean === "top_half" ||
    clean === "late" ||
    clean === "late comer" ||
    clean === "tardy_late" ||
    clean === "◤" ||
    clean === "◥" ||
    clean === "▲"
  ) {
    return {
      day,
      classification: "UPPER_HALF_SHADE",
      attendance_status: "TARDY",
      confidence: 0.93,
      fill_ratio: 0.42,
      is_shaded: false,
      is_half_shaded: true,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: `Upper-half/triangle is shaded (Late Comer). Classified as Tardy (adds +1 to gridTardyCount, counts as Present).`,
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern E: Lower Half Shade (Cutting Classes — Tardy)
  if (
    clean === "lower_half_shade" ||
    clean === "lower_half" ||
    clean === "lower_triangle" ||
    clean === "lower" ||
    clean === "bottom_half" ||
    clean === "cutting" ||
    clean === "cutting classes" ||
    clean === "tardy_cutting" ||
    clean === "◢" ||
    clean === "◣" ||
    clean === "▼"
  ) {
    return {
      day,
      classification: "LOWER_HALF_SHADE",
      attendance_status: "TARDY",
      confidence: 0.93,
      fill_ratio: 0.42,
      is_shaded: false,
      is_half_shaded: true,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: `Lower-half/triangle is shaded (Cutting Classes). Classified as Tardy (adds +1 to gridTardyCount, counts as Present).`,
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern F: Generic Half Shade / Slash / Tardy
  if (
    clean === "half" ||
    clean === "half-shade" ||
    clean === "half_shade" ||
    clean === "triangle" ||
    clean === "/" ||
    clean === "\\" ||
    clean === "t" ||
    clean === "tardy"
  ) {
    return {
      day,
      classification: "UPPER_HALF_SHADE",
      attendance_status: "TARDY",
      confidence: 0.91,
      fill_ratio: 0.42,
      is_shaded: false,
      is_half_shaded: true,
      requires_teacher_verification: false,
      classifier_method: "visual_feature_analysis",
      explanation: `Half-shaded diagonal pattern identified ("${cellText}"). Classified as Tardy (adds +1 to gridTardyCount, counts as Present).`,
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern G: Improper Solid Full-Cell Shade (Solid black fill on regular school day)
  if (
    clean === "full" ||
    clean === "shaded" ||
    clean === "[shaded]" ||
    clean.replace(/[\[\]]/g, "") === "shaded" ||
    clean === "full_shade" ||
    clean === "full-shade" ||
    clean === "fullshade" ||
    clean === ":selected:" ||
    clean.includes(":selected:") ||
    clean === "selected" ||
    clean === "■" ||
    clean === "█" ||
    clean === "●" ||
    clean === "improper_full_cell_shade" ||
    clean === "improper_shade" ||
    clean === "solid_black"
  ) {
    return {
      day,
      classification: "IMPROPER_FULL_CELL_SHADE",
      attendance_status: "PRESENT",
      confidence: 0.70,
      fill_ratio: 0.85,
      is_shaded: true,
      is_half_shaded: false,
      is_improper_shade: true,
      requires_teacher_verification: true,
      classifier_method: "visual_feature_analysis",
      explanation: `Individual cell filled solid black on regular school day ("${cellText}"). Improper SF2 Shading Format violation.`,
      cell_polygon: cellPolygon,
      page_number: pageNumber,
    };
  }

  // Pattern H: Unclear / smudged mark
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

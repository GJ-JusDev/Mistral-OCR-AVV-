/**
 * PSA Document OCR Preprocessing Module
 *
 * Implements:
 * 1. Automatic Black-and-White / Grayscale Enhancement for PSA Birth Certificates.
 * 2. Document Orientation Inspection & Counter-Clockwise / Clockwise Normalization.
 * 3. Targeted Child Section and Item 1 (Child Name) Proportional Cropping for OCR.
 *
 * Key Design Invariants:
 * 1. The original uploaded image is ALWAYS preserved unchanged for human review and traceability.
 * 2. Uses soft adaptive thresholding (Bradley-Roth local window) that eliminates colored SECPA security
 *    background patterns while strictly preserving thin printed characters, ballpen handwriting,
 *    signatures, registry stamps, and delicate typewriter dots.
 * 3. Does NOT crop borders, margins, or document text on the full processing copy.
 * 4. Preserves original resolution and aspect ratio (1:1 pixel mapping).
 * 5. Supports JPG, JPEG, and PNG.
 * 6. For PDF documents, preserves the original PDF stream without rasterizing.
 * 7. If preprocessing encounters an error, it safely falls back to the original image and reports
 *    that preprocessing was skipped without interrupting the OCR workflow.
 */

export interface PsaCropRegion {
  /** Top boundary offset as proportion of image height (0.0 - 1.0) */
  top: number;
  /** Bottom boundary offset as proportion of image height (0.0 - 1.0) */
  bottom: number;
  /** Left boundary offset as proportion of image width (0.0 - 1.0) */
  left: number;
  /** Right boundary offset as proportion of image width (0.0 - 1.0) */
  right: number;
}

export interface PsaCropRegionsConfig {
  /** Child section (Items 1 - 5: Name, Sex, DOB, Place of Birth, Type/Order/Weight of Birth) */
  childSection: PsaCropRegion;
  /** Item 1 Name-only crop (First, Middle, Last Name boxes and labels) */
  childNameOnly: PsaCropRegion;
}

/**
 * Authoritative proportional crop regions for upright Philippine PSA Certificate of Live Birth (Form 102).
 * These boundaries are proportional to image dimensions and accommodate variations in scanner margins.
 */
export const DEFAULT_PSA_CROP_REGIONS: PsaCropRegionsConfig = {
  // Items 1 - 5: Child Section (roughly top 12% to 36% of upright height)
  childSection: {
    top: 0.12,
    bottom: 0.36,
    left: 0.02,
    right: 0.98,
  },
  // Item 1: Name-only (First Name, Middle Name, Last Name boxes and Item 1 header)
  childNameOnly: {
    top: 0.11,
    bottom: 0.24,
    left: 0.02,
    right: 0.98,
  },
};

export interface PsaOrientationInspection {
  isLandscape: boolean;
  isUpright: boolean;
  aspectRatio: number;
  /** Suggested rotation in degrees to bring document upright: 0, 90, 180, or 270 (270° CW = 90° CCW) */
  suggestedRotation: number;
}

/**
 * Inspects image dimensions to determine orientation for Philippine PSA Birth Certificates.
 * Standard PSA Birth Certificates are strictly portrait documents (height > width).
 * Any image with width > height (aspectRatio > 1.0) is scanned/captured in landscape orientation.
 */
export function inspectPsaOrientation(width: number, height: number): PsaOrientationInspection {
  if (!width || !height) {
    return { isLandscape: false, isUpright: true, aspectRatio: 1, suggestedRotation: 0 };
  }
  const aspectRatio = width / height;
  const isLandscape = aspectRatio > 1.0;
  const isUpright = !isLandscape;
  // If landscape, rotating 270 degrees clockwise (90 degrees counter-clockwise) restores upright portrait
  const suggestedRotation = isLandscape ? 270 : 0;

  return {
    isLandscape,
    isUpright,
    aspectRatio,
    suggestedRotation,
  };
}

export interface PsaPreprocessingOptions {
  /** Window radius relative to image width. Default is max(8, Math.round(width / 32)). */
  windowRadius?: number;
  /** Sensitivity threshold percentage for local mean. Default is 0.10 (10%). */
  thresholdPercent?: number;
  /** Contrast stretch factor (1.0 = normal, 1.25 = enhanced). Default is 1.2. */
  contrastFactor?: number;
  /** Output image format when running in canvas: 'image/jpeg' or 'image/png'. Default is 'image/jpeg'. */
  outputFormat?: "image/jpeg" | "image/png";
  /** JPEG quality 0.0 - 1.0. Default is 0.95. */
  outputQuality?: number;
  /**
   * Explicit rotation to apply in degrees (0, 90, 180, 270).
   * Note: 270° clockwise is equivalent to 90° counter-clockwise.
   */
  rotation?: number;
  /**
   * Whether to automatically detect landscape orientation and apply 90° CCW rotation.
   * Default is false (prefers explicit inspection or manual control).
   */
  autoRotate?: boolean;
  /**
   * Whether to generate targeted crops (Child section and Item 1 Name-only).
   * Default is true.
   */
  generateCrops?: boolean;
  /** Custom crop regions overriding DEFAULT_PSA_CROP_REGIONS */
  cropRegions?: Partial<PsaCropRegionsConfig>;
}

export interface PsaPreprocessingResult {
  originalDataUrl: string;
  processedDataUrl: string;
  wasProcessed: boolean;
  format: "jpeg" | "png" | "pdf" | "unknown";
  width?: number;
  height?: number;
  rotationApplied?: number;
  /** Targeted crop covering Items 1 - 5 (Child section: Name, Sex, DOB, Place of Birth) */
  childSectionDataUrl?: string;
  /** Targeted tighter crop covering Item 1 (Child Name only: First, Middle, Last) */
  childNameDataUrl?: string;
  skippedReason?: string;
}

/**
 * Pure-pixel buffer rotation for RGBA typed arrays.
 * Operates without DOM or Canvas, supporting browser, Node.js, and automated test runners.
 */
export function rotatePixelBuffer(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  degrees: number
): { data: Uint8ClampedArray; width: number; height: number } {
  const normalized = ((Math.round(degrees) % 360) + 360) % 360;
  if (normalized === 0) {
    return { data: new Uint8ClampedArray(rgbaData), width, height };
  }

  const isSideways = normalized === 90 || normalized === 270;
  const newWidth = isSideways ? height : width;
  const newHeight = isSideways ? width : height;
  const out = new Uint8ClampedArray(newWidth * newHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dstX = x;
      let dstY = y;

      if (normalized === 90) {
        // 90° clockwise
        dstX = height - 1 - y;
        dstY = x;
      } else if (normalized === 180) {
        // 180°
        dstX = width - 1 - x;
        dstY = height - 1 - y;
      } else if (normalized === 270) {
        // 270° clockwise = 90° counter-clockwise
        dstX = y;
        dstY = width - 1 - x;
      }

      const srcIdx = (y * width + x) * 4;
      const dstIdx = (dstY * newWidth + dstX) * 4;

      out[dstIdx] = rgbaData[srcIdx];
      out[dstIdx + 1] = rgbaData[srcIdx + 1];
      out[dstIdx + 2] = rgbaData[srcIdx + 2];
      out[dstIdx + 3] = rgbaData[srcIdx + 3];
    }
  }

  return { data: out, width: newWidth, height: newHeight };
}

/**
 * Pure-pixel buffer cropping for RGBA typed arrays.
 * Extracts a proportional rectangular region without loss of resolution.
 */
export function cropPixelBuffer(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  region: PsaCropRegion
): { data: Uint8ClampedArray; width: number; height: number } {
  const startX = Math.max(0, Math.min(width - 1, Math.round(region.left * width)));
  const endX = Math.max(startX + 1, Math.min(width, Math.round(region.right * width)));
  const startY = Math.max(0, Math.min(height - 1, Math.round(region.top * height)));
  const endY = Math.max(startY + 1, Math.min(height, Math.round(region.bottom * height)));

  const cropW = endX - startX;
  const cropH = endY - startY;
  const out = new Uint8ClampedArray(cropW * cropH * 4);

  for (let cy = 0; cy < cropH; cy++) {
    const srcY = startY + cy;
    for (let cx = 0; cx < cropW; cx++) {
      const srcX = startX + cx;
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (cy * cropW + cx) * 4;

      out[dstIdx] = rgbaData[srcIdx];
      out[dstIdx + 1] = rgbaData[srcIdx + 1];
      out[dstIdx + 2] = rgbaData[srcIdx + 2];
      out[dstIdx + 3] = rgbaData[srcIdx + 3];
    }
  }

  return { data: out, width: cropW, height: cropH };
}

/**
 * Pure-pixel buffer adaptive binarization and contrast enhancement.
 * Operates on a Uint8ClampedArray (RGBA format, length = width * height * 4).
 * Mutates the buffer in place or returns a new enhanced RGBA buffer.
 */
export function enhancePsaPixelBuffer(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  options?: PsaPreprocessingOptions
): Uint8ClampedArray {
  const numPixels = width * height;
  const gray = new Uint8Array(numPixels);

  const contrastFactor = options?.contrastFactor ?? 1.2;
  const thresholdPercent = options?.thresholdPercent ?? 0.10;
  const radius = options?.windowRadius ?? Math.max(8, Math.min(64, Math.round(width / 32)));

  // Step 1: Grayscale conversion with luminance weights & contrast expansion
  let minGray = 255;
  let maxGray = 0;

  for (let i = 0; i < numPixels; i++) {
    const r = rgbaData[i * 4];
    const g = rgbaData[i * 4 + 1];
    const b = rgbaData[i * 4 + 2];
    // Luminance formula
    const val = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    gray[i] = val;
    if (val < minGray) minGray = val;
    if (val > maxGray) maxGray = val;
  }

  // Step 2: Global contrast enhancement (min/max stretch)
  const range = maxGray - minGray;
  if (range > 10) {
    for (let i = 0; i < numPixels; i++) {
      let stretched = Math.round(((gray[i] - minGray) / range) * 255);
      // Contrast curve centered at 128
      stretched = Math.round(128 + (stretched - 128) * contrastFactor);
      gray[i] = Math.max(0, Math.min(255, stretched));
    }
  }

  // Step 3: Fast integral image for O(1) local neighborhood calculation
  const integral = new Float64Array((width + 1) * (height + 1));
  const stride = width + 1;

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const grayRowOffset = y * width;
    const intRowOffset = (y + 1) * stride;
    const prevIntRowOffset = y * stride;

    for (let x = 0; x < width; x++) {
      rowSum += gray[grayRowOffset + x];
      integral[intRowOffset + (x + 1)] = integral[prevIntRowOffset + (x + 1)] + rowSum;
    }
  }

  // Step 4: Soft adaptive binarization (protects thin strokes, typewriter dots, ballpen signatures)
  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height - 1, y + radius);

    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width - 1, x + radius);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      const sum =
        integral[(y2 + 1) * stride + (x2 + 1)] -
        integral[y1 * stride + (x2 + 1)] -
        integral[(y2 + 1) * stride + x1] +
        integral[y1 * stride + x1];

      const localMean = sum / count;
      const pixelVal = gray[y * width + x];
      const thresholdVal = localMean * (1 - thresholdPercent);

      // Step 4: True Black & White Adaptive Binarization (Sauvola / Bradley-Roth)
      // Converts yellow SECPA security background to pure white (255) and printed/ballpen text to pure black (0)
      const finalVal = pixelVal < thresholdVal ? 0 : 255;

      const pixelIdx = (y * width + x) * 4;
      rgbaData[pixelIdx] = finalVal;
      rgbaData[pixelIdx + 1] = finalVal;
      rgbaData[pixelIdx + 2] = finalVal;
      rgbaData[pixelIdx + 3] = 255;
    }
  }

  return rgbaData;
}

/**
 * Preprocesses a base64 data URL for PSA OCR.
 *
 * Capabilities:
 * 1. Orientation Inspection & Upright Rotation (Counter-Clockwise or Clockwise).
 * 2. Soft Adaptive Black-and-White / Grayscale Binarization.
 * 3. Targeted Child Section and Item 1 Name-only Cropping.
 *
 * Safe Invariants:
 * 1. If PDF: returns original data URL without rasterizing.
 * 2. In browser: creates an offscreen canvas, applies rotation and enhancement, generates crops.
 * 3. In non-browser / headless (Node.js without DOM): returns original safely with wasProcessed: false.
 * 4. On any exception: catches error, logs warning, returns originalDataUrl safely.
 */
export async function preprocessPsaImage(
  dataUrl: string,
  options?: PsaPreprocessingOptions
): Promise<PsaPreprocessingResult> {
  if (!dataUrl || typeof dataUrl !== "string") {
    return {
      originalDataUrl: "",
      processedDataUrl: "",
      wasProcessed: false,
      format: "unknown",
      skippedReason: "Invalid or empty image payload",
    };
  }

  // 1. PDF Documents: preserve original vector/page stream directly
  if (dataUrl.startsWith("data:application/pdf")) {
    return {
      originalDataUrl: dataUrl,
      processedDataUrl: dataUrl,
      wasProcessed: false,
      format: "pdf",
      skippedReason: "PDF documents preserve original vector/page stream for direct OCR ingestion",
    };
  }

  const isPng = dataUrl.startsWith("data:image/png");
  const isJpeg = dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg");
  const format: "jpeg" | "png" | "unknown" = isPng ? "png" : isJpeg ? "jpeg" : "unknown";

  // 2. Non-browser environment check
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      originalDataUrl: dataUrl,
      processedDataUrl: dataUrl,
      wasProcessed: false,
      format,
      skippedReason: "Browser Canvas is not available in server/headless environment; preserving original file",
    };
  }

  try {
    // 3. Browser-based canvas execution
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = (err) => reject(new Error(`Failed to load PSA image for preprocessing: ${err}`));
      el.src = dataUrl;
    });

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    if (!origW || !origH || origW < 10 || origH < 10) {
      return {
        originalDataUrl: dataUrl,
        processedDataUrl: dataUrl,
        wasProcessed: false,
        format,
        skippedReason: "Invalid image dimensions",
      };
    }

    // 4. Orientation Inspection & Determination
    let rotationToApply = 0;
    if (options?.rotation !== undefined && options.rotation !== 0) {
      // Explicit manual rotation (e.g. user clicked 90, 180, 270)
      rotationToApply = ((Math.round(options.rotation) % 360) + 360) % 360;
    } else {
      // Auto-detect orientation: if width > height, rotate 90° CCW (270° CW) so header is at the top
      const shouldAutoRotate = options?.autoRotate !== false;
      if (shouldAutoRotate) {
        const inspection = inspectPsaOrientation(origW, origH);
        if (inspection.isLandscape) {
          rotationToApply = inspection.suggestedRotation; // 270° CW = 90° CCW
        }
      }
    }

    const isSideways = rotationToApply === 90 || rotationToApply === 270;
    const targetW = isSideways ? origH : origW;
    const targetH = isSideways ? origW : origH;

    // 5. Draw onto rotated canvas
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return {
        originalDataUrl: dataUrl,
        processedDataUrl: dataUrl,
        wasProcessed: false,
        format,
        width: targetW,
        height: targetH,
        skippedReason: "Could not create 2D canvas context",
      };
    }

    if (rotationToApply !== 0) {
      ctx.translate(targetW / 2, targetH / 2);
      ctx.rotate((rotationToApply * Math.PI) / 180);
      ctx.drawImage(img, -origW / 2, -origH / 2);
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    } else {
      ctx.drawImage(img, 0, 0, targetW, targetH);
    }

    // 6. B&W Enhancement on full upright image
    const imgData = ctx.getImageData(0, 0, targetW, targetH);
    enhancePsaPixelBuffer(imgData.data, targetW, targetH, options);
    ctx.putImageData(imgData, 0, 0);

    const outFormat = options?.outputFormat || (isPng ? "image/png" : "image/jpeg");
    const outQuality = options?.outputQuality ?? 0.95;
    const processedDataUrl = canvas.toDataURL(outFormat, outQuality);

    // 7. Targeted Cropping (Child Section & Item 1 Name-only)
    let childSectionDataUrl: string | undefined;
    let childNameDataUrl: string | undefined;

    const generateCrops = options?.generateCrops !== false;
    if (generateCrops) {
      const cropCfg: PsaCropRegionsConfig = {
        childSection: {
          ...DEFAULT_PSA_CROP_REGIONS.childSection,
          ...(options?.cropRegions?.childSection || {}),
        },
        childNameOnly: {
          ...DEFAULT_PSA_CROP_REGIONS.childNameOnly,
          ...(options?.cropRegions?.childNameOnly || {}),
        },
      };

      const generateCropDataUrl = (region: PsaCropRegion): string | undefined => {
        const sx = Math.max(0, Math.min(targetW - 1, Math.round(region.left * targetW)));
        const ex = Math.max(sx + 1, Math.min(targetW, Math.round(region.right * targetW)));
        const sy = Math.max(0, Math.min(targetH - 1, Math.round(region.top * targetH)));
        const ey = Math.max(sy + 1, Math.min(targetH, Math.round(region.bottom * targetH)));
        const cw = ex - sx;
        const ch = ey - sy;

        if (cw < 20 || ch < 20) return undefined;

        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = cw;
        cropCanvas.height = ch;
        const cropCtx = cropCanvas.getContext("2d");
        if (!cropCtx) return undefined;

        cropCtx.drawImage(canvas, sx, sy, cw, ch, 0, 0, cw, ch);
        return cropCanvas.toDataURL(outFormat, outQuality);
      };

      childSectionDataUrl = generateCropDataUrl(cropCfg.childSection);
      childNameDataUrl = generateCropDataUrl(cropCfg.childNameOnly);
    }

    return {
      originalDataUrl: dataUrl,
      processedDataUrl,
      wasProcessed: true,
      format: outFormat === "image/png" ? "png" : "jpeg",
      width: targetW,
      height: targetH,
      rotationApplied: rotationToApply,
      childSectionDataUrl,
      childNameDataUrl,
    };
  } catch (err: any) {
    console.warn("[psaPreprocessing] Preprocessing error, safely falling back to original image:", err?.message || err);
    return {
      originalDataUrl: dataUrl,
      processedDataUrl: dataUrl,
      wasProcessed: false,
      format,
      skippedReason: `Preprocessing error: ${err?.message || "Unknown error"}`,
    };
  }
}

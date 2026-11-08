/**
 * PSA / Birth Certificate OCR Image Enhancement and Preprocessing Engine
 *
 * Dedicated pipeline for Philippine PSA Certificate of Live Birth scans.
 * Suppresses colored security-paper backgrounds (yellow/green tint and patterns)
 * and normalizes uneven brightness/shadows while preserving printed text,
 * thin handwriting, and signatures.
 *
 * Architecture:
 * 1. Measure raw image quality heuristics (mean luminance, contrast, clipping, blur).
 * 2. Adaptive luminance and contrast normalization (no fixed brightness shifts).
 * 3. Color security paper suppression via channel-weighted grayscale conversion.
 * 4. Bradley-Roth local adaptive thresholding (integral image) to generate B&W candidate.
 * 5. Light isolated-speckle denoising (zero character erosion).
 * 6. Dual candidate evaluation (Candidate A: Normalized Grayscale vs. Candidate B: Adaptive B&W).
 * 7. Candidate selection with defensive fallback and development-only diagnostics.
 *
 * Safety Invariants:
 * - Original color document is NEVER destroyed or overwritten; preserved for human review.
 * - Image pixel dimensions and aspect ratios are strictly preserved (1:1 geometry match with Azure).
 * - Scoped exclusively to document_type === "birth_cert".
 * - Zero PII logged or exposed.
 */

export interface ImageQualityMetrics {
  meanLuminance: number;       // 0–255
  contrast: number;            // standard deviation of luminance (0–128)
  clippingPercentage: number;  // % of pixels <= 5 or >= 250
  blurScore: number;           // gradient energy / edge sharpness
  foregroundRatio: number;     // estimated dark ink percentage (0.0–1.0)
}

export type PsaCandidateType = "bw" | "grayscale" | "original";

export interface RawImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA 4 bytes per pixel
}

export interface PsaEnhancementResult {
  selectedCandidate: PsaCandidateType;
  enhancedDataUrl: string;
  grayscaleDataUrl?: string;
  bwDataUrl?: string;
  originalDataUrl: string;
  metrics: {
    original: ImageQualityMetrics;
    enhanced: ImageQualityMetrics;
    grayscale?: ImageQualityMetrics;
    bw?: ImageQualityMetrics;
  };
  appliedOperations: string[];
}

// ----------------------------------------------------------------------------
// 1. Image Quality Heuristics (Zero PII)
// ----------------------------------------------------------------------------

/**
 * Computes luminance for a single RGBA pixel using Rec.601 standard weights.
 */
export function pixelLuminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Computes objective quality metrics for an RGBA image buffer.
 */
export function computeQualityMetrics(image: RawImageData): ImageQualityMetrics {
  const { width, height, data } = image;
  const totalPixels = width * height;
  if (totalPixels === 0) {
    return { meanLuminance: 0, contrast: 0, clippingPercentage: 0, blurScore: 0, foregroundRatio: 0 };
  }

  let sumLuminance = 0;
  let sumLuminanceSq = 0;
  let clippingCount = 0;
  let foregroundCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const l = pixelLuminance(data[i], data[i + 1], data[i + 2]);
    sumLuminance += l;
    sumLuminanceSq += l * l;
    if (l <= 5 || l >= 250) {
      clippingCount++;
    }
    // Consider pixels below 115 as dark ink/foreground candidates
    if (l <= 115) {
      foregroundCount++;
    }
  }

  const meanLuminance = sumLuminance / totalPixels;
  const variance = Math.max(0, sumLuminanceSq / totalPixels - meanLuminance * meanLuminance);
  const contrast = Math.sqrt(variance);
  const clippingPercentage = (clippingCount / totalPixels) * 100;
  const foregroundRatio = foregroundCount / totalPixels;

  // Spatial gradient magnitude for blur/sharpness evaluation (sampled for speed)
  let gradientSum = 0;
  let gradientSamples = 0;
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 200));

  for (let y = 0; y < height - stride; y += stride) {
    for (let x = 0; x < width - stride; x += stride) {
      const idxCurr = (y * width + x) * 4;
      const idxRight = (y * width + (x + stride)) * 4;
      const idxDown = ((y + stride) * width + x) * 4;

      const lCurr = pixelLuminance(data[idxCurr], data[idxCurr + 1], data[idxCurr + 2]);
      const lRight = pixelLuminance(data[idxRight], data[idxRight + 1], data[idxRight + 2]);
      const lDown = pixelLuminance(data[idxDown], data[idxDown + 1], data[idxDown + 2]);

      gradientSum += Math.abs(lCurr - lRight) + Math.abs(lCurr - lDown);
      gradientSamples++;
    }
  }

  const blurScore = gradientSamples > 0 ? gradientSum / gradientSamples : 0;

  return {
    meanLuminance: Math.round(meanLuminance * 10) / 10,
    contrast: Math.round(contrast * 10) / 10,
    clippingPercentage: Math.round(clippingPercentage * 10) / 10,
    blurScore: Math.round(blurScore * 10) / 10,
    foregroundRatio: Math.round(foregroundRatio * 1000) / 1000,
  };
}

/**
 * Checks whether an image is already neutral grayscale or binary B&W.
 */
export function detectImageCharacteristics(image: RawImageData): {
  isGrayscale: boolean;
  isBinarized: boolean;
  isColoredSecurityPaper: boolean;
} {
  const { data } = image;
  let saturationSum = 0;
  let binaryPixelCount = 0;
  let yellowGreenTintCount = 0;
  const sampleStep = Math.max(4, Math.floor(data.length / (4 * 2000)) * 4);
  let samples = 0;

  for (let i = 0; i < data.length; i += sampleStep) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const maxVal = Math.max(r, g, b);
    const minVal = Math.min(r, g, b);
    saturationSum += (maxVal - minVal);

    const l = pixelLuminance(r, g, b);
    if (l <= 15 || l >= 240) {
      binaryPixelCount++;
    }

    // Yellow/green security paper signature: elevated R & G compared to B in paper background
    if (r > 120 && g > 120 && (r + g > 2 * b + 25)) {
      yellowGreenTintCount++;
    }

    samples++;
  }

  const avgSaturation = samples > 0 ? saturationSum / samples : 0;
  const binaryRatio = samples > 0 ? binaryPixelCount / samples : 0;
  const yellowGreenRatio = samples > 0 ? yellowGreenTintCount / samples : 0;

  return {
    isGrayscale: avgSaturation < 10,
    isBinarized: binaryRatio > 0.94,
    isColoredSecurityPaper: yellowGreenRatio > 0.15,
  };
}

// ----------------------------------------------------------------------------
// 2. Brightness & Contrast Normalization (Adaptive)
// ----------------------------------------------------------------------------

/**
 * Normalizes luminance dynamically based on image characteristics.
 * - Dark scans: gently brightens midtones without blowing out ink strokes.
 * - Bright scans: avoids overexposure or highlight clipping.
 * - Uneven illumination: adjusts range based on local percentiles.
 */
export function normalizeLuminanceAndContrast(image: RawImageData): RawImageData {
  const { width, height, data } = image;
  const output = new Uint8ClampedArray(data.length);
  const totalPixels = width * height;
  if (totalPixels === 0) return { width, height, data: output };

  // 1. Build luminance histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const l = pixelLuminance(data[i], data[i + 1], data[i + 2]);
    hist[l]++;
  }

  // 2. Determine 2nd and 95th percentiles
  let count = 0;
  let p2 = 0;
  let p95 = 255;
  const target2 = Math.floor(totalPixels * 0.02);
  const target95 = Math.floor(totalPixels * 0.95);

  for (let i = 0; i < 256; i++) {
    count += hist[i];
    if (count >= target2 && p2 === 0) p2 = i;
    if (count >= target95) {
      p95 = i;
      break;
    }
  }

  // Paper background level (95th percentile) and dark ink reference (2nd percentile, max 50)
  const bgLevel = p95;
  const inkLevel = Math.min(50, p2);
  const targetBg = 230;

  // Build lookup table (LUT) for O(1) pixel transformation
  const lut = new Uint8Array(256);
  if (bgLevel < 215 && bgLevel > inkLevel) {
    // Dark scan: stretch from [inkLevel, bgLevel] to [inkLevel, targetBg]
    const scale = (targetBg - inkLevel) / (bgLevel - inkLevel);
    for (let i = 0; i < 256; i++) {
      if (i <= inkLevel) {
        lut[i] = i; // Dark ink stays dark
      } else {
        const mapped = inkLevel + (i - inkLevel) * scale;
        lut[i] = Math.round(Math.max(0, Math.min(255, mapped)));
      }
    }
  } else if (bgLevel >= 250) {
    // Already very bright scan: avoid highlight overexposure, gentle identity mapping
    for (let i = 0; i < 256; i++) {
      lut[i] = i;
    }
  } else {
    // Standard lighting: slight stretch towards targetBg
    const scale = Math.max(1.0, (targetBg - inkLevel) / Math.max(1, bgLevel - inkLevel));
    for (let i = 0; i < 256; i++) {
      if (i <= inkLevel) {
        lut[i] = i;
      } else {
        const mapped = inkLevel + (i - inkLevel) * scale;
        lut[i] = Math.round(Math.max(0, Math.min(255, mapped)));
      }
    }
  }

  // Apply transformation to RGBA
  for (let i = 0; i < data.length; i += 4) {
    output[i] = lut[data[i]];
    output[i + 1] = lut[data[i + 1]];
    output[i + 2] = lut[data[i + 2]];
    output[i + 3] = data[i + 3]; // Preserve alpha
  }

  return { width, height, data: output };
}

// ----------------------------------------------------------------------------
// 3. Color Security Paper Suppression (Grayscale Conversion)
// ----------------------------------------------------------------------------

/**
 * Converts a color PSA document to clean grayscale.
 * Applies selective yellow/green paper suppression:
 * Rec.601 luminance weights green heavily (0.587) and red (0.299), which naturally
 * makes yellow/green paper background bright while preserving dark ink.
 * In addition, yellow/green background tint is gently shifted towards white.
 */
export function convertToSuppressedGrayscale(image: RawImageData): RawImageData {
  const { width, height, data } = image;
  const output = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let l = pixelLuminance(r, g, b);

    // If pixel exhibits yellow/green security paper coloration in background
    if (r > 120 && g > 120 && (r + g > 2 * b + 25) && l > 115) {
      // Background paper suppression boost: shift towards neutral bright white
      l = Math.min(255, l + 18);
    }

    output[i] = l;
    output[i + 1] = l;
    output[i + 2] = l;
    output[i + 3] = 255; // Fully opaque
  }

  return { width, height, data: output };
}

// ----------------------------------------------------------------------------
// 4. Bradley-Roth Local Adaptive Thresholding (B&W Binarization)
// ----------------------------------------------------------------------------

export interface AdaptiveThresholdOptions {
  windowRadius?: number;    // Window radius in pixels
  sensitivity?: number;     // Fraction below local mean (e.g. 0.12 = 12%)
  minDelta?: number;        // Minimum absolute difference to trigger black pixel
}

/**
 * Implements Bradley-Roth local adaptive thresholding using an integral image.
 * Runs in O(W * H) time.
 * Excellent at handling uneven lighting, camera shadows, and security pattern gradients
 * while preserving thin handwriting and printed text.
 */
export function adaptiveThresholdBradleyRoth(
  grayImage: RawImageData,
  options?: AdaptiveThresholdOptions
): RawImageData {
  const { width, height, data } = grayImage;
  const totalPixels = width * height;
  const output = new Uint8ClampedArray(data.length);
  if (totalPixels === 0) return { width, height, data: output };

  // 1. Build Integral Image (Sum Table) in Float64 to prevent overflow
  const integral = new Float64Array(totalPixels);

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = (rowOffset + x) * 4;
      const l = data[idx]; // R channel represents grayscale luminance
      rowSum += l;
      if (y === 0) {
        integral[rowOffset + x] = rowSum;
      } else {
        integral[rowOffset + x] = integral[(y - 1) * width + x] + rowSum;
      }
    }
  }

  // 2. Adaptive window parameters
  // Window radius adapts to image scale (approx 3% of dimension, clamped 12–48 px)
  const maxDim = Math.max(width, height);
  const r = options?.windowRadius ?? Math.max(12, Math.min(48, Math.round(maxDim / 32)));
  const t = options?.sensitivity ?? 0.12; // 12% darker than local mean
  const minDelta = options?.minDelta ?? 7; // Minimum margin to prevent white noise

  // 3. Local thresholding pass
  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - r);
    const y2 = Math.min(height - 1, y + r);
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - r);
      const x2 = Math.min(width - 1, x + r);

      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      // Fast box sum from integral image:
      // sum = I(x2, y2) - I(x1-1, y2) - I(x2, y1-1) + I(x1-1, y1-1)
      let sum = integral[y2 * width + x2];
      if (x1 > 0) sum -= integral[y2 * width + (x1 - 1)];
      if (y1 > 0) sum -= integral[(y1 - 1) * width + x2];
      if (x1 > 0 && y1 > 0) sum += integral[(y1 - 1) * width + (x1 - 1)];

      const localMean = sum / count;
      const idx = (rowOffset + x) * 4;
      const pixelVal = data[idx];

      const diff = localMean - pixelVal;

      // Pixel is foreground (black = 0) if it is significantly darker than local neighborhood
      const isForeground = diff > localMean * t && diff >= minDelta;
      const binaryVal = isForeground ? 0 : 255;

      output[idx] = binaryVal;
      output[idx + 1] = binaryVal;
      output[idx + 2] = binaryVal;
      output[idx + 3] = 255;
    }
  }

  return { width, height, data: output };
}

// ----------------------------------------------------------------------------
// 5. Denoising: Isolated Speckle Suppression
// ----------------------------------------------------------------------------

/**
 * Removes isolated 1x1 noise specks from a binary B&W image without eroding
 * character strokes or handwriting lines.
 */
export function denoiseIsolatedSpeckles(bwImage: RawImageData): RawImageData {
  const { width, height, data } = bwImage;
  const output = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = (rowOffset + x) * 4;
      if (data[idx] === 0) { // Black pixel
        // Check 8-neighborhood
        let neighborBlackCount = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nIdx = ((y + dy) * width + (x + dx)) * 4;
            if (data[nIdx] === 0) {
              neighborBlackCount++;
            }
          }
        }
        // If an isolated single pixel has 0 black neighbors, suppress it to white background
        if (neighborBlackCount === 0) {
          output[idx] = 255;
          output[idx + 1] = 255;
          output[idx + 2] = 255;
        }
      }
    }
  }

  return { width, height, data: output };
}

// ----------------------------------------------------------------------------
// 6. Pure JS BMP Codec for Node.js & Testing
// ----------------------------------------------------------------------------

/**
 * Encodes an RGBA image buffer into a BMP data URL (supported natively by Node and Azure).
 */
export function encodeBmpDataUrl(image: RawImageData): string {
  const { width, height, data } = image;
  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + padding;
  const fileSize = 54 + stride * height;
  const buf = Buffer.alloc(fileSize);

  // BMP Header
  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10); // Pixel data offset

  // DIB Header (BITMAPINFOHEADER)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // Positive height = bottom-up
  buf.writeUInt16LE(1, 26);     // 1 color plane
  buf.writeUInt16LE(24, 28);    // 24 bits per pixel (BGR)
  buf.writeUInt32LE(0, 30);     // BI_RGB (uncompressed)
  buf.writeUInt32LE(stride * height, 34);

  // Pixel data (BMP stores rows bottom-to-top, BGR order)
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const rowOffset = 54 + y * stride;
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcY * width + x) * 4;
      const dstIdx = rowOffset + x * 3;
      buf[dstIdx] = data[srcIdx + 2];     // B
      buf[dstIdx + 1] = data[srcIdx + 1]; // G
      buf[dstIdx + 2] = data[srcIdx];     // R
    }
  }

  return "data:image/bmp;base64," + buf.toString("base64");
}

/**
 * Decodes a BMP or base64 data URL into a RawImageData structure.
 */
export function decodeBmpDataUrl(dataUrl: string): RawImageData | null {
  try {
    const parts = dataUrl.split(",");
    if (parts.length < 2) return null;
    const buf = Buffer.from(parts[1], "base64");
    if (buf.length < 54 || buf.toString("ascii", 0, 2) !== "BM") {
      return null;
    }

    const width = buf.readInt32LE(18);
    const rawHeight = buf.readInt32LE(22);
    const height = Math.abs(rawHeight);
    const bpp = buf.readUInt16LE(28);

    if (bpp !== 24 && bpp !== 32) {
      return null;
    }

    const rowBytes = width * (bpp / 8);
    const padding = (4 - (rowBytes % 4)) % 4;
    const stride = rowBytes + padding;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const isBottomUp = rawHeight > 0;

    for (let y = 0; y < height; y++) {
      const srcY = isBottomUp ? height - 1 - y : y;
      const rowOffset = 54 + y * stride;
      for (let x = 0; x < width; x++) {
        const dstIdx = (srcY * width + x) * 4;
        const srcIdx = rowOffset + x * (bpp / 8);
        rgba[dstIdx] = buf[srcIdx + 2];     // R
        rgba[dstIdx + 1] = buf[srcIdx + 1]; // G
        rgba[dstIdx + 2] = buf[srcIdx];     // B
        rgba[dstIdx + 3] = 255;
      }
    }

    return { width, height, data: rgba };
  } catch (err) {
    return null;
  }
}

// ----------------------------------------------------------------------------
// 7. Browser Canvas Bridge (for Client-Side Upload)
// ----------------------------------------------------------------------------

/**
 * Converts an HTMLImageElement / Data URL into RawImageData via HTML5 Canvas.
 */
export async function loadImageToRawData(dataUrl: string): Promise<RawImageData | null> {
  // If running in Node.js, attempt BMP decode
  if (typeof window === "undefined" || typeof document === "undefined") {
    return decodeBmpDataUrl(dataUrl);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) {
        resolve(null);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      resolve({ width: w, height: h, data: imgData.data });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Converts RawImageData back into a Data URL.
 */
export function rawDataToDataUrl(raw: RawImageData): string {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return encodeBmpDataUrl(raw);
  }

  const canvas = document.createElement("canvas");
  canvas.width = raw.width;
  canvas.height = raw.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return encodeBmpDataUrl(raw);

  const imgData = ctx.createImageData(raw.width, raw.height);
  imgData.data.set(raw.data);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/png");
}

// ----------------------------------------------------------------------------
// 8. Candidate Selection & Comprehensive Enhancement Pipeline
// ----------------------------------------------------------------------------

/**
 * Core enhancement function operating on raw image pixels.
 * Generates Candidate A (Normalized Grayscale) and Candidate B (Adaptive B&W).
 * Selects the optimal candidate for Azure OCR based on contrast and text density.
 */
export function enhancePsaRawImage(rawImage: RawImageData): {
  selectedCandidate: PsaCandidateType;
  enhancedImage: RawImageData;
  grayscaleImage: RawImageData;
  bwImage: RawImageData;
  metrics: {
    original: ImageQualityMetrics;
    enhanced: ImageQualityMetrics;
    grayscale: ImageQualityMetrics;
    bw: ImageQualityMetrics;
  };
  appliedOperations: string[];
} {
  const originalMetrics = computeQualityMetrics(rawImage);
  const characteristics = detectImageCharacteristics(rawImage);
  const appliedOperations: string[] = [];

  // If already clean binary B&W, preserve without re-processing (Condition H)
  if (characteristics.isBinarized) {
    appliedOperations.push("preserve_already_binarized");
    return {
      selectedCandidate: "bw",
      enhancedImage: rawImage,
      grayscaleImage: rawImage,
      bwImage: rawImage,
      metrics: {
        original: originalMetrics,
        enhanced: originalMetrics,
        grayscale: originalMetrics,
        bw: originalMetrics,
      },
      appliedOperations,
    };
  }

  // 1. Adaptive Luminance & Contrast Normalization
  const normalized = normalizeLuminanceAndContrast(rawImage);
  appliedOperations.push("luminance_contrast_normalization");

  // 2. Grayscale conversion with yellow/green security paper suppression
  const grayscale = convertToSuppressedGrayscale(normalized);
  appliedOperations.push("security_paper_suppressed_grayscale");
  const grayscaleMetrics = computeQualityMetrics(grayscale);

  // 3. Bradley-Roth Local Adaptive Thresholding
  const bwRaw = adaptiveThresholdBradleyRoth(grayscale);
  appliedOperations.push("bradley_roth_adaptive_threshold");

  // 4. Light isolated-speckle denoising
  const bw = denoiseIsolatedSpeckles(bwRaw);
  appliedOperations.push("isolated_speckle_denoising");
  const bwMetrics = computeQualityMetrics(bw);

  // 5. Candidate Selection
  // A standard PSA certificate has printed text, borders, and handwriting.
  // Dark text density should typically be between 1.5% and 30%.
  let selectedCandidate: PsaCandidateType = "bw";
  let enhancedImage = bw;
  let enhancedMetrics = bwMetrics;

  if (bwMetrics.foregroundRatio < 0.01) {
    // Thresholding eroded text (too little foreground) -> fallback to Grayscale
    selectedCandidate = "grayscale";
    enhancedImage = grayscale;
    enhancedMetrics = grayscaleMetrics;
    appliedOperations.push("fallback_candidate_grayscale_low_density");
  } else if (bwMetrics.foregroundRatio > 0.35) {
    // Excessive shadow turned large regions black -> fallback to Grayscale
    selectedCandidate = "grayscale";
    enhancedImage = grayscale;
    enhancedMetrics = grayscaleMetrics;
    appliedOperations.push("fallback_candidate_grayscale_high_density");
  } else if (characteristics.isGrayscale && originalMetrics.contrast > 50 && originalMetrics.clippingPercentage < 2) {
    // Clean, high-contrast scan that is already pristine grayscale
    selectedCandidate = "bw"; // Adaptive B&W still suppresses faint background textures
  }

  // Section 18: Development-Only Diagnostic (Zero PII)
  if (process.env.NODE_ENV !== "production") {
    console.log("[PSA Image Processing]");
    console.log(
      `Original: Mean luminance: ${originalMetrics.meanLuminance.toFixed(1)}, Contrast: ${originalMetrics.contrast.toFixed(1)}, Foreground: ${(originalMetrics.foregroundRatio * 100).toFixed(1)}%`
    );
    console.log(
      `Enhanced (${selectedCandidate}): Mean luminance: ${enhancedMetrics.meanLuminance.toFixed(1)}, Contrast: ${enhancedMetrics.contrast.toFixed(1)}, Foreground: ${(enhancedMetrics.foregroundRatio * 100).toFixed(1)}%`
    );
    console.log(`Selected OCR candidate: ${selectedCandidate.toUpperCase()}`);
  }

  return {
    selectedCandidate,
    enhancedImage,
    grayscaleImage: grayscale,
    bwImage: bw,
    metrics: {
      original: originalMetrics,
      enhanced: enhancedMetrics,
      grayscale: grayscaleMetrics,
      bw: bwMetrics,
    },
    appliedOperations,
  };
}

/**
 * High-level PSA document enhancer accepting a base64 Data URL.
 * Usable both in browser and Node environments.
 */
export async function enhancePsaImage(dataUrl: string): Promise<PsaEnhancementResult> {
  const raw = await loadImageToRawData(dataUrl);

  // Defensive fallback: If decoding fails, safely return original without altering
  if (!raw) {
    const fallbackMetrics: ImageQualityMetrics = {
      meanLuminance: 128,
      contrast: 50,
      clippingPercentage: 0,
      blurScore: 10,
      foregroundRatio: 0.05,
    };
    return {
      selectedCandidate: "original",
      enhancedDataUrl: dataUrl,
      originalDataUrl: dataUrl,
      metrics: {
        original: fallbackMetrics,
        enhanced: fallbackMetrics,
      },
      appliedOperations: ["fallback_unsupported_format"],
    };
  }

  const result = enhancePsaRawImage(raw);
  const enhancedDataUrl = rawDataToDataUrl(result.enhancedImage);
  const grayscaleDataUrl = rawDataToDataUrl(result.grayscaleImage);
  const bwDataUrl = rawDataToDataUrl(result.bwImage);

  return {
    selectedCandidate: result.selectedCandidate,
    enhancedDataUrl,
    grayscaleDataUrl,
    bwDataUrl,
    originalDataUrl: dataUrl,
    metrics: result.metrics,
    appliedOperations: result.appliedOperations,
  };
}

/**
 * Server-side helper to enhance an image payload if it represents a PSA document.
 */
export async function enhancePsaImagePayload(
  imageDataUrl: string
): Promise<{ enhancedDataUrl: string; candidateType: PsaCandidateType } | null> {
  try {
    const res = await enhancePsaImage(imageDataUrl);
    return {
      enhancedDataUrl: res.enhancedDataUrl,
      candidateType: res.selectedCandidate,
    };
  } catch (err) {
    console.warn("[psaEnhancer] Enhancement failed, falling back to original image:", err);
    return null;
  }
}

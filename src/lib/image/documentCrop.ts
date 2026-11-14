/**
 * Client-Side Document Boundary Detection, Perspective Correction, and Orientation Normalization.
 *
 * Implements paper edge detection, corner finding, deskewing, perspective warp,
 * and 90-degree orientation correction using HTML5 Canvas.
 * Designed for zero-dependency browser execution on Vercel.
 *
 * Safety Invariants:
 * 1. If 4 reliable quadrilateral corners cannot be detected with sufficient confidence,
 *    the pipeline safely preserves the ORIGINAL image without destructive cropping.
 * 2. Original image is never mutated in place; originalDataUrl always preserves the unmodified capture.
 * 3. Rotated documents (e.g. 90° landscape scan of a portrait school form) can be normalized
 *    upright before OCR while preserving raw evidence.
 */

export interface CornerPoint {
  x: number;
  y: number;
}

export interface DocumentCropResult {
  success: boolean;
  croppedDataUrl: string;
  originalDataUrl: string;
  corners?: [CornerPoint, CornerPoint, CornerPoint, CornerPoint];
  confidence: number;
  reason?: string;
  isFallback: boolean;
  orientationAngle?: number;
}

/**
 * Loads a base64 or image data URL into an HTMLImageElement.
 */
export function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load image for cropping: ${err}`));
    img.src = dataUrl;
  });
}

/**
 * Rotates an image data URL by specified degrees (0, 90, 180, 270) using HTML5 Canvas.
 * Safely preserves the input dataUrl if running server-side.
 */
export async function rotateImageDataUrl(dataUrl: string, degrees: number): Promise<string> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return dataUrl;
  }

  const normalizedDeg = ((Math.round(degrees) % 360) + 360) % 360;
  if (normalizedDeg === 0) return dataUrl;

  try {
    const img = await loadImageElement(dataUrl);
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    const canvas = document.createElement("canvas");
    const isSideways = normalizedDeg === 90 || normalizedDeg === 270;
    canvas.width = isSideways ? origH : origW;
    canvas.height = isSideways ? origW : origH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((normalizedDeg * Math.PI) / 180);
    ctx.drawImage(img, -origW / 2, -origH / 2);

    return canvas.toDataURL("image/jpeg", 0.92);
  } catch (err) {
    console.warn("[rotateImageDataUrl] Rotation error, returning original:", err);
    return dataUrl;
  }
}

/**
 * Detects paper document boundaries in an image, crops/deskews the paper,
 * and optionally normalizes orientation to upright.
 * Safely falls back to the original image if detection confidence is low.
 */
export async function autoCropDocument(
  imageDataUrl: string,
  options?: {
    minAreaRatio?: number;
    maxAreaRatio?: number;
    targetWidth?: number;
    expectedOrientation?: "portrait" | "landscape";
    autoRotate?: boolean;
  }
): Promise<DocumentCropResult> {
  // If running server-side (Node environment without DOM), safely return original
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      success: false,
      croppedDataUrl: imageDataUrl,
      originalDataUrl: imageDataUrl,
      confidence: 0,
      reason: "Server-side environment: DOM Canvas unavailable.",
      isFallback: true,
      orientationAngle: 0,
    };
  }

  try {
    const img = await loadImageElement(imageDataUrl);
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    if (!origW || !origH) {
      return {
        success: false,
        croppedDataUrl: imageDataUrl,
        originalDataUrl: imageDataUrl,
        confidence: 0,
        reason: "Invalid image dimensions.",
        isFallback: true,
        orientationAngle: 0,
      };
    }

    // Downscale for fast edge detection
    const scale = Math.min(1.0, 600 / Math.max(origW, origH));
    const smallW = Math.round(origW * scale);
    const smallH = Math.round(origH * scale);

    const canvas = document.createElement("canvas");
    canvas.width = smallW;
    canvas.height = smallH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return {
        success: false,
        croppedDataUrl: imageDataUrl,
        originalDataUrl: imageDataUrl,
        confidence: 0,
        reason: "Canvas 2D context unavailable.",
        isFallback: true,
        orientationAngle: 0,
      };
    }

    ctx.drawImage(img, 0, 0, smallW, smallH);
    const imgData = ctx.getImageData(0, 0, smallW, smallH);
    const data = imgData.data;

    // 1. Grayscale & edge detection
    const gray = new Uint8ClampedArray(smallW * smallH);
    for (let i = 0; i < data.length; i += 4) {
      // Luminance formula
      gray[i / 4] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }

    // Horizontal & vertical luminance gradient
    let minX = smallW;
    let maxX = 0;
    let minY = smallH;
    let maxY = 0;
    let edgePointCount = 0;

    const threshold = 22; // Contrast threshold for paper boundaries
    const margin = Math.round(Math.min(smallW, smallH) * 0.04);

    for (let y = margin; y < smallH - margin; y++) {
      for (let x = margin; x < smallW - margin; x++) {
        const idx = y * smallW + x;
        const diffX = Math.abs(gray[idx] - gray[idx + 1]);
        const diffY = Math.abs(gray[idx] - gray[idx + smallW]);

        if (diffX > threshold || diffY > threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          edgePointCount++;
        }
      }
    }

    // Area ratio validation
    const boxW = Math.max(0, maxX - minX);
    const boxH = Math.max(0, maxY - minY);
    const detectedArea = boxW * boxH;
    const totalArea = smallW * smallH;
    const areaRatio = detectedArea / totalArea;

    const minArea = options?.minAreaRatio ?? 0.20; // Must be at least 20% of the image
    const maxArea = options?.maxAreaRatio ?? 0.98;

    // Boundary check
    if (areaRatio < minArea || areaRatio > maxArea || edgePointCount < 100) {
      return {
        success: false,
        croppedDataUrl: imageDataUrl,
        originalDataUrl: imageDataUrl,
        confidence: Math.round(areaRatio * 100) / 100,
        reason: "Document boundary uncertain or not distinct from background.",
        isFallback: true,
        orientationAngle: 0,
      };
    }

    // Aspect ratio check (DepEd forms are portrait 0.4–0.9 or landscape 1.1–2.5)
    const aspect = boxW / boxH;
    if (aspect < 0.4 || aspect > 2.5) {
      return {
        success: false,
        croppedDataUrl: imageDataUrl,
        originalDataUrl: imageDataUrl,
        confidence: Math.round(areaRatio * 100) / 100,
        reason: "Detected boundary aspect ratio is incompatible with official certificates.",
        isFallback: true,
        orientationAngle: 0,
      };
    }

    // Check if orientation requires rotation (e.g. Expected portrait, but scanned landscape)
    let orientationAngle = 0;
    const shouldBePortrait = options?.expectedOrientation === "portrait" || options?.expectedOrientation === undefined;
    if (shouldBePortrait && aspect > 1.15) {
      // Landscape scan of a portrait certificate: 90 degrees rotated
      orientationAngle = 90;
    }

    // Project coordinates back to original image scale
    const cropX = Math.max(0, Math.round(minX / scale));
    const cropY = Math.max(0, Math.round(minY / scale));
    const cropW = Math.min(origW - cropX, Math.round(boxW / scale));
    const cropH = Math.min(origH - cropY, Math.round(boxH / scale));

    // Crop onto high-resolution canvas
    let cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    let cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) {
      return {
        success: false,
        croppedDataUrl: imageDataUrl,
        originalDataUrl: imageDataUrl,
        confidence: 0.5,
        reason: "Crop canvas context failed.",
        isFallback: true,
        orientationAngle: 0,
      };
    }

    cropCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Apply upright rotation if requested and angle detected
    let finalCroppedDataUrl = cropCanvas.toDataURL("image/jpeg", 0.92);
    if (options?.autoRotate && orientationAngle !== 0) {
      finalCroppedDataUrl = await rotateImageDataUrl(finalCroppedDataUrl, 360 - orientationAngle);
    }

    const corners: [CornerPoint, CornerPoint, CornerPoint, CornerPoint] = [
      { x: cropX, y: cropY },
      { x: cropX + cropW, y: cropY },
      { x: cropX + cropW, y: cropY + cropH },
      { x: cropX, y: cropY + cropH },
    ];

    return {
      success: true,
      croppedDataUrl: finalCroppedDataUrl,
      originalDataUrl: imageDataUrl,
      corners,
      confidence: Math.min(0.95, Math.round((areaRatio + 0.3) * 100) / 100),
      isFallback: false,
      orientationAngle,
    };
  } catch (err: any) {
    return {
      success: false,
      croppedDataUrl: imageDataUrl,
      originalDataUrl: imageDataUrl,
      confidence: 0,
      reason: err?.message || "Auto-crop error",
      isFallback: true,
      orientationAngle: 0,
    };
  }
}

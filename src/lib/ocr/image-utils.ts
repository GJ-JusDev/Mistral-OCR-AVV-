/**
 * Client-side image processing utilities.
 *
 * Extracted from the old monolithic TrocrCamera component.
 * Used for upscaling, brightness/contrast adjustment, and sharpening
 * before sending images to the OCR API.
 */

/** Minimum long-edge size (px) images are upscaled to before OCR. */
export const MIN_OCR_DIMENSION = 1600;

/** Standard deviation threshold below which a crop is considered blank. */
export const BLANK_STD_DEV_THRESHOLD = 12;

export const BLANK_CROP_MESSAGE =
  "No visible text detected in this crop — try a tighter selection around the writing.";

export type ImageAdjustments = {
  brightness: number; // percentage, default 200
  contrast: number;   // percentage, default 100
  sharpness: number;  // 0–100
};

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 200,
  contrast: 100,
  sharpness: 0,
};

/**
 * Compute the standard deviation of grayscale pixel values in an ImageData.
 * Used to detect blank/empty crops that would cause OCR hallucinations.
 */
export function computeStdDev(imageData: ImageData): number {
  const { data } = imageData;
  const n = data.length / 4;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += gray;
    sumSq += gray * gray;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

/**
 * 3×3 unsharp-mask-style convolution: boosts center pixel and subtracts
 * neighbors so edges (text strokes) pop out more.
 *
 * @param imageData - The ImageData to sharpen (mutated in place).
 * @param amount    - Sharpening strength 0–1.
 */
export function sharpenImageData(
  imageData: ImageData,
  amount: number
): ImageData {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const k = amount;
  const kernel = [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let ki = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = Math.min(height - 1, Math.max(0, y + dy));
            const nx = Math.min(width - 1, Math.max(0, x + dx));
            sum += src[(ny * width + nx) * 4 + c] * kernel[ki++];
          }
        }
        data[(y * width + x) * 4 + c] = sum;
      }
    }
  }
  return imageData;
}

/**
 * Render the source image onto an offscreen canvas with brightness, contrast,
 * optional sharpening, and upscaling for small images.
 *
 * @param source      - The source HTMLImageElement.
 * @param adjustments - Brightness, contrast, and sharpness values.
 * @returns A PNG data URL of the processed image.
 */
export function processImage(
  source: HTMLImageElement,
  adjustments: ImageAdjustments
): string {
  const { brightness, contrast, sharpness } = adjustments;

  const scale = Math.max(
    1,
    MIN_OCR_DIMENSION / Math.max(source.naturalWidth, source.naturalHeight)
  );
  const width = Math.round(source.naturalWidth * scale);
  const height = Math.round(source.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source.src;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
  ctx.drawImage(source, 0, 0, width, height);
  ctx.filter = "none";

  if (sharpness > 0) {
    const imageData = ctx.getImageData(0, 0, width, height);
    ctx.putImageData(sharpenImageData(imageData, sharpness / 100), 0, 0);
  }

  return canvas.toDataURL("image/png");
}

/**
 * Compute the rendered rect of an object-fit:contain image inside its
 * container. Needed to correctly map pointer coordinates during cropping.
 */
export function getContainedImageRect(
  container: HTMLElement,
  img: HTMLImageElement
): { offsetX: number; offsetY: number; width: number; height: number } {
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const imageAspect = img.naturalWidth / img.naturalHeight;
  const containerAspect = containerWidth / containerHeight;

  let width: number;
  let height: number;
  if (imageAspect > containerAspect) {
    width = containerWidth;
    height = containerWidth / imageAspect;
  } else {
    height = containerHeight;
    width = containerHeight * imageAspect;
  }
  const offsetX = (containerWidth - width) / 2;
  const offsetY = (containerHeight - height) / 2;
  return { offsetX, offsetY, width, height };
}

/**
 * Read a File as a base64 data URL.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read that file."));
    reader.readAsDataURL(file);
  });
}

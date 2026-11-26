import type { IOcrProvider, OcrInput, OcrProviderResult } from "./types";
import { OcrProviderError } from "./types";
import { parseRetryAfterHeader } from "../mistral";
import { compressServerImageBuffer } from "../serverImageCompressor";
import { extractEmbeddedPdfText, getPdfPageCount } from "../pdfTextExtractor";

export interface AzureProviderConfig {
  endpoint?: string;
  apiKey?: string;
  apiVersion?: string;
  modelId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/**
 * Safely extracts detailed error information from Azure Document Intelligence response.
 *
 * Priority:
 * 1. innererror.message
 * 2. details[0].message
 * 3. topLevel message (if not generic "Invalid request.")
 * 4. Fallback default message
 *
 * Diagnostic code priority:
 * 1. innererror.code
 * 2. details[0].code
 * 3. topLevel code
 * 4. default code
 */
export function extractAzureErrorInfo(
  errorData: any,
  defaultMsg: string = "Invalid document request.",
  defaultCode: string = "BAD_REQUEST"
): {
  message: string;
  azureErrorCode?: string;
  innerCode?: string;
  diagnosticCode?: string;
} {
  const err = errorData?.error || errorData || {};
  const topLevelCode = typeof err.code === "string" ? err.code : undefined;
  const topLevelMsg = typeof err.message === "string" ? err.message.trim() : "";

  const innerCode = typeof err.innererror?.code === "string" ? err.innererror.code : undefined;
  const innerMsg = typeof err.innererror?.message === "string" ? err.innererror.message.trim() : "";

  const firstDetail = Array.isArray(err.details) && err.details.length > 0 ? err.details[0] : undefined;
  const detailCode = typeof firstDetail?.code === "string" ? firstDetail.code : undefined;
  const detailMsg = typeof firstDetail?.message === "string" ? firstDetail.message.trim() : "";

  let chosenMsg = innerMsg || detailMsg;
  if (!chosenMsg) {
    if (topLevelMsg && !/^invalid request\.?$/i.test(topLevelMsg)) {
      chosenMsg = topLevelMsg;
    } else {
      chosenMsg = topLevelMsg || defaultMsg;
    }
  }

  // Redact URLs and tokens to prevent leaking sensitive information
  const safeMsg = chosenMsg.replace(/https?:\/\/[^\s]+/g, "[redacted-url]");
  const diagnosticCode = innerCode || detailCode || topLevelCode || defaultCode;

  return {
    message: safeMsg,
    azureErrorCode: topLevelCode,
    innerCode: innerCode || detailCode,
    diagnosticCode,
  };
}

/**
 * Extracts width and height for PNG and JPEG image buffers without native dependencies.
 */
export function getImageDimensionsFromBuffer(
  buffer: Buffer,
  mimeType: string
): { width: number; height: number } | null {
  if (mimeType === "image/png" && buffer.length >= 24) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
      };
    }
  } else if ((mimeType === "image/jpeg" || mimeType === "image/jpg") && buffer.length >= 4) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buffer[offset + 1];
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    }
  }
  return null;
}

export class AzureDocumentIntelligenceProvider implements IOcrProvider {
  public readonly name = "azure" as const;
  private endpoint?: string;
  private apiKey?: string;
  private apiVersion: string;
  private modelId: string;
  private timeoutMs: number;
  private pollIntervalMs: number;

  constructor(config?: AzureProviderConfig) {
    this.endpoint =
      config?.endpoint ||
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    this.apiKey =
      config?.apiKey ||
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    this.apiVersion =
      config?.apiVersion ||
      process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION ||
      "2024-11-30";
    this.modelId =
      config?.modelId ||
      process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL ||
      "prebuilt-read";

    const envTimeoutStr = process.env.AZURE_OCR_TIMEOUT_MS;
    const parsedTimeout = envTimeoutStr ? parseInt(envTimeoutStr, 10) : undefined;
    this.timeoutMs =
      config?.timeoutMs ??
      (parsedTimeout && !isNaN(parsedTimeout) && parsedTimeout > 0
        ? parsedTimeout
        : 45000);

    this.pollIntervalMs = config?.pollIntervalMs ?? 1000;
  }

  public setCredentials(endpoint?: string, apiKey?: string): void {
    if (endpoint !== undefined) this.endpoint = endpoint;
    if (apiKey !== undefined) this.apiKey = apiKey;
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }

  public async isAvailable(): Promise<boolean> {
    const ep = (this.endpoint || "").trim();
    const key = (this.apiKey || "").trim();
    return ep.length > 0 && key.length > 0;
  }

  public async recognize(input: OcrInput): Promise<OcrProviderResult> {
    const endpoint = (this.endpoint || process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || "").trim();
    const apiKey = (this.apiKey || process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || "").trim();

    if (!endpoint || !apiKey) {
      throw new OcrProviderError(
        "Azure Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.",
        {
          provider: "azure",
          status: 500,
          code: "INVALID_API_KEY",
        }
      );
    }

    if (!input.image || typeof input.image !== "string") {
      throw new OcrProviderError("A valid image or document payload is required.", {
        provider: "azure",
        status: 400,
        code: "BAD_REQUEST",
      });
    }

    // Parse data URL or raw base64
    let mimeType = "image/png";
    let base64Content = input.image;

    const dataUrlMatch = input.image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1].toLowerCase();
      base64Content = dataUrlMatch[2];
    } else if (input.image.startsWith("data:")) {
      throw new OcrProviderError(
        "Invalid data URL format. A valid base64 image or PDF data URL is required.",
        {
          provider: "azure",
          status: 400,
          code: "BAD_REQUEST",
        }
      );
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new OcrProviderError(
        `Unsupported document format (${mimeType}). Allowed formats are JPEG, PNG, WebP, and PDF.`,
        {
          provider: "azure",
          status: 400,
          code: "BAD_REQUEST",
        }
      );
    }

    if (!base64Content || base64Content.trim().length === 0) {
      throw new OcrProviderError("Document payload cannot be empty.", {
        provider: "azure",
        status: 400,
        code: "BAD_REQUEST",
      });
    }

    // Azure Document Intelligence service limit check (50MB binary ceiling for images, ~68MB base64)
    const binarySizeEstimate = Math.floor((base64Content.length * 3) / 4);
    if (binarySizeEstimate > 50 * 1024 * 1024) {
      throw new OcrProviderError(
        "The input image is too large. Refer to documentation for the maximum file size.",
        {
          provider: "azure",
          status: 400,
          code: "BAD_REQUEST",
          diagnosticCode: "InvalidContentLength",
          innerCode: "InvalidContentLength",
          azureErrorCode: "InvalidRequest",
        }
      );
    }

    let cleanEndpoint = endpoint.replace(/\/+$/, "");
    if ((cleanEndpoint.startsWith('"') && cleanEndpoint.endsWith('"')) || (cleanEndpoint.startsWith("'") && cleanEndpoint.endsWith("'"))) {
      cleanEndpoint = cleanEndpoint.slice(1, -1).trim().replace(/\/+$/, "");
    }
    try {
      const parsedUrl = new URL(cleanEndpoint);
      if (!/^https?:$/.test(parsedUrl.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      throw new OcrProviderError(
        "Invalid Azure Document Intelligence endpoint format. Expected a valid HTTPS URL.",
        {
          provider: "azure",
          status: 500,
          code: "BAD_REQUEST",
          diagnosticCode: "INVALID_ENDPOINT_FORMAT",
        }
      );
    }

    let apiVersion = (this.apiVersion || "").trim();
    if ((apiVersion.startsWith('"') && apiVersion.endsWith('"')) || (apiVersion.startsWith("'") && apiVersion.endsWith("'"))) {
      apiVersion = apiVersion.slice(1, -1).trim();
    }
    if (!/^\d{4}-\d{2}-\d{2}(-preview)?$/.test(apiVersion)) {
      throw new OcrProviderError(
        `Invalid Azure Document Intelligence API version format (${apiVersion}). Expected YYYY-MM-DD or YYYY-MM-DD-preview (e.g. '2024-11-30').`,
        {
          provider: "azure",
          status: 500,
          code: "BAD_REQUEST",
          diagnosticCode: "INVALID_API_VERSION",
        }
      );
    }

    const isStructuredTableDoc =
      input.documentType?.toLowerCase() === "sf9" ||
      input.documentType?.toLowerCase() === "sf10" ||
      input.documentSide === "back";
    let effectiveModelId = (
      input.modelId ||
      (isStructuredTableDoc && !process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL ? "prebuilt-layout" : this.modelId) ||
      ""
    ).trim();
    if ((effectiveModelId.startsWith('"') && effectiveModelId.endsWith('"')) || (effectiveModelId.startsWith("'") && effectiveModelId.endsWith("'"))) {
      effectiveModelId = effectiveModelId.slice(1, -1).trim();
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(effectiveModelId)) {
      throw new OcrProviderError(
        `Invalid Azure Document Intelligence model ID (${effectiveModelId}). Expected a valid model identifier.`,
        {
          provider: "azure",
          status: 500,
          code: "BAD_REQUEST",
          diagnosticCode: "INVALID_MODEL_ID",
        }
      );
    }

    const apiBasePath = apiVersion.startsWith("2022-") || apiVersion.startsWith("2023-07")
      ? "formrecognizer"
      : "documentintelligence";
    let analyzeUrl = `${cleanEndpoint}/${apiBasePath}/documentModels/${effectiveModelId}:analyze?api-version=${apiVersion}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Step 1: Submit Document for Asynchronous Analysis
      let binaryBody: Buffer = Buffer.from(base64Content, "base64");
      const normalizedMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
      const validAzureMimes = new Set([
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/bmp",
        "image/heif",
      ]);
      let effectiveContentType = validAzureMimes.has(normalizedMime)
        ? normalizedMime
        : "application/octet-stream";

      // Auto-compress / downscale images > 2400px or > 2.5 MB to JPEG (< 3.0 MB)
      if (effectiveContentType !== "application/pdf") {
        try {
          const compRes = await compressServerImageBuffer(binaryBody, effectiveContentType, {
            maxDimension: 2400,
            maxSizeBytes: 2.5 * 1024 * 1024,
            quality: 85,
          });
          if (compRes.wasCompressed) {
            binaryBody = Buffer.from(compRes.buffer);
            effectiveContentType = compRes.mimeType;
          }
        } catch (compErr) {
          console.warn("[azureProvider] Image pre-compression error:", compErr);
        }
      }

      // Handle multi-page PDFs: extract embedded text and constrain F0 requests to pages=1-2 if > 2 pages
      let embeddedPdfText = "";
      if (effectiveContentType === "application/pdf") {
        embeddedPdfText = extractEmbeddedPdfText(binaryBody);
        const pageCount = getPdfPageCount(binaryBody);
        if (pageCount > 2 && !analyzeUrl.includes("pages=")) {
          analyzeUrl += (analyzeUrl.includes("?") ? "&" : "?") + "pages=1-2";
        }
      }

      // Application-level dimension validation for image payloads
      const dimensions = getImageDimensionsFromBuffer(binaryBody, normalizedMime);
      if (dimensions) {
        if (dimensions.width < 50 || dimensions.height < 50) {
          throw new OcrProviderError(
            `The input image dimensions (${dimensions.width}x${dimensions.height}) are too small: minimum supported dimension is 50x50 pixels.`,
            {
              provider: "azure",
              status: 400,
              code: "BAD_REQUEST",
              diagnosticCode: "InvalidContentDimensions",
              innerCode: "InvalidContentDimensions",
              azureErrorCode: "InvalidRequest",
            }
          );
        }
        if (dimensions.width > 10000 || dimensions.height > 10000) {
          throw new OcrProviderError(
            `The input image dimensions (${dimensions.width}x${dimensions.height}) exceed Azure Document Intelligence maximum limit of 10000x10000 pixels.`,
            {
              provider: "azure",
              status: 400,
              code: "BAD_REQUEST",
              diagnosticCode: "InvalidContentDimensions",
              innerCode: "InvalidContentDimensions",
              azureErrorCode: "InvalidRequest",
            }
          );
        }
      }

      const pollOpLocation = async (opLoc: string): Promise<OcrProviderResult> => {
        const startTime = Date.now();
        while (Date.now() - startTime < this.timeoutMs) {
          await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

          const pollRes = await fetch(opLoc, {
            method: "GET",
            headers: {
              "Ocp-Apim-Subscription-Key": apiKey,
            },
            signal: controller.signal,
          });

          if (pollRes.status === 429) {
            const retryAfter = parseRetryAfterHeader(pollRes.headers.get("Retry-After"));
            throw new OcrProviderError(
              "Azure Document Intelligence rate limit exceeded during operation polling.",
              {
                provider: "azure",
                status: 429,
                code: "RATE_LIMIT_EXCEEDED",
                retryAfter,
              }
            );
          }

          if (!pollRes.ok) {
            const status = pollRes.status;
            throw new OcrProviderError(
              `Azure Document Intelligence polling failed with HTTP status ${status}.`,
              {
                provider: "azure",
                status: status >= 500 ? status : 502,
                code: "UPSTREAM_ERROR",
              }
            );
          }

          const pollData = await pollRes.json().catch(() => ({}));
          const opStatus = pollData.status;

          if (opStatus === "succeeded") {
            clearTimeout(timeoutId);
            const res = this.processAnalyzeResult(pollData.analyzeResult, effectiveModelId);
            if (embeddedPdfText && embeddedPdfText.trim().length > 0) {
              if (!res.text.includes(embeddedPdfText.trim().slice(0, 30))) {
                res.text = res.text ? `${res.text}\n\n${embeddedPdfText}` : embeddedPdfText;
              }
            }
            return res;
          }

          if (opStatus === "failed") {
            clearTimeout(timeoutId);
            const extracted = extractAzureErrorInfo(
              pollData,
              "Azure Document Intelligence operation reported failure.",
              "UPSTREAM_ERROR"
            );
            throw new OcrProviderError(extracted.message, {
              provider: "azure",
              status: 502,
              code: "UPSTREAM_ERROR",
              diagnosticCode: extracted.diagnosticCode,
              innerCode: extracted.innerCode,
              azureErrorCode: extracted.azureErrorCode,
            });
          }
        }

        clearTimeout(timeoutId);
        throw new OcrProviderError(
          `Azure Document Intelligence operation timed out after ${this.timeoutMs}ms.`,
          {
            provider: "azure",
            status: 504,
            code: "TIMEOUT",
          }
        );
      };

      let submitRes = await fetch(analyzeUrl, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Content-Type": effectiveContentType,
        },
        body: binaryBody as unknown as BodyInit,
        signal: controller.signal,
      });

      if (submitRes.status === 400 && effectiveContentType === "application/pdf" && !analyzeUrl.includes("pages=")) {
        const fallbackUrl = analyzeUrl + (analyzeUrl.includes("?") ? "&" : "?") + "pages=1-2";
        try {
          const retryRes = await fetch(fallbackUrl, {
            method: "POST",
            headers: {
              "Ocp-Apim-Subscription-Key": apiKey,
              "Content-Type": effectiveContentType,
            },
            body: binaryBody as unknown as BodyInit,
            signal: controller.signal,
          });
          if (retryRes.ok || retryRes.status === 202) {
            submitRes = retryRes;
          }
        } catch {
          // keep original submitRes
        }
      }

      if (submitRes.status === 401 || submitRes.status === 403) {
        throw new OcrProviderError(
          "Azure Document Intelligence authentication failed. Please verify the configured endpoint and API key.",
          {
            provider: "azure",
            status: submitRes.status,
            code: "INVALID_API_KEY",
          }
        );
      }

      if (submitRes.status === 429) {
        const retryAfter = parseRetryAfterHeader(submitRes.headers.get("Retry-After"));
        throw new OcrProviderError(
          "Azure Document Intelligence rate limit exceeded. Please wait a moment before trying again.",
          {
            provider: "azure",
            status: 429,
            code: "RATE_LIMIT_EXCEEDED",
            retryAfter,
          }
        );
      }

      if (submitRes.status === 400) {
        const errorData = await submitRes.json().catch(() => ({}));
        const extracted = extractAzureErrorInfo(errorData, "Invalid document request.", "BAD_REQUEST");
        throw new OcrProviderError(extracted.message, {
          provider: "azure",
          status: 400,
          code: "BAD_REQUEST",
          diagnosticCode: extracted.diagnosticCode,
          innerCode: extracted.innerCode,
          azureErrorCode: extracted.azureErrorCode,
        });
      }

      if (!submitRes.ok) {
        const status = submitRes.status;
        const errorData = await submitRes.json().catch(() => ({}));
        const extracted = extractAzureErrorInfo(
          errorData,
          `Azure Document Intelligence submission failed with HTTP status ${status}.`,
          "UPSTREAM_ERROR"
        );
        throw new OcrProviderError(extracted.message, {
          provider: "azure",
          status: status >= 500 ? status : 502,
          code: "UPSTREAM_ERROR",
          diagnosticCode: extracted.diagnosticCode,
          innerCode: extracted.innerCode,
          azureErrorCode: extracted.azureErrorCode,
        });
      }

      // Step 2: Read Operation-Location Header
      const operationLocation = submitRes.headers.get("Operation-Location");
      if (!operationLocation) {
        throw new OcrProviderError(
          "Azure Document Intelligence did not return an Operation-Location header for asynchronous analysis.",
          {
            provider: "azure",
            status: 502,
            code: "UPSTREAM_ERROR",
          }
        );
      }

      // Step 3: Poll the Asynchronous Operation
      return await pollOpLocation(operationLocation);

      // Polling exceeded server-side timeout window
      clearTimeout(timeoutId);
      throw new OcrProviderError(
        `Azure Document Intelligence operation timed out after ${this.timeoutMs}ms.`,
        {
          provider: "azure",
          status: 504,
          code: "TIMEOUT",
        }
      );
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err instanceof OcrProviderError) {
        throw err;
      }
      if (err?.name === "AbortError") {
        throw new OcrProviderError(
          `Azure Document Intelligence request timed out after ${this.timeoutMs}ms.`,
          {
            provider: "azure",
            status: 504,
            code: "TIMEOUT",
          }
        );
      }
      throw new OcrProviderError(
        err?.message ? `Azure Document Intelligence network error: ${err.message}` : "Azure Document Intelligence request failed.",
        {
          provider: "azure",
          status: 502,
          code: "UPSTREAM_ERROR",
        }
      );
    }
  }

  /**
   * Transforms Azure analyzeResult into AVV's standard OcrProviderResult.
   * Truthful confidence: computes arithmetic mean across all recognized words having confidence.
   * Never defaults missing confidence to 1.0.
   * 
   * Extracts and correlates Azure Intelligent Character Recognition (ICR) styles:
   * Maps `isHandwritten` and style confidence to words and lines based on character spans.
   * Preserves bounding polygons, page numbers, and word-level coordinates for full traceability.
   */
  private processAnalyzeResult(analyzeResult?: any, usedModelId?: string): OcrProviderResult {
    const effectiveModel = usedModelId || this.modelId;
    if (!analyzeResult) {
      return {
        text: "",
        model: `azure/${effectiveModel}`,
        pageCount: 1,
        provider: "azure",
      };
    }

    const text = typeof analyzeResult.content === "string" ? analyzeResult.content : "";
    const pages = Array.isArray(analyzeResult.pages) ? analyzeResult.pages : [];
    const pageCount = pages.length > 0 ? pages.length : 1;
    const rawStyles = Array.isArray(analyzeResult.styles) ? analyzeResult.styles : [];

    // Helper to test if a word or span overlaps with any handwritten span in styles
    const checkHandwrittenSpan = (span?: { offset: number; length: number }): { isHandwritten: boolean; styleConfidence?: number } => {
      if (!span || typeof span.offset !== "number" || typeof span.length !== "number") {
        return { isHandwritten: false };
      }
      const spanStart = span.offset;
      const spanEnd = span.offset + span.length;

      for (const style of rawStyles) {
        if (!Array.isArray(style.spans)) continue;
        for (const s of style.spans) {
          if (typeof s.offset !== "number" || typeof s.length !== "number") continue;
          const sStart = s.offset;
          const sEnd = s.offset + s.length;

          // Check for character range overlap
          if (spanStart < sEnd && spanEnd > sStart) {
            if (style.isHandwritten === true) {
              return {
                isHandwritten: true,
                styleConfidence: typeof style.confidence === "number" ? style.confidence : undefined,
              };
            }
          }
        }
      }
      return { isHandwritten: false };
    };

    // Calculate truthful confidence from words & correlate handwriting styles
    const confidences: number[] = [];
    const handwrittenConfidences: number[] = [];
    const printedConfidences: number[] = [];
    const allWords: any[] = [];

    const mappedPages = pages.map((p: any) => {
      const pageNum = typeof p.pageNumber === "number" ? p.pageNumber : 1;

      const words = Array.isArray(p.words)
        ? p.words.map((w: any) => {
            const wordConfidence = typeof w.confidence === "number" && !isNaN(w.confidence) ? w.confidence : undefined;
            if (wordConfidence !== undefined) {
              confidences.push(wordConfidence);
            }

            const hwInfo = checkHandwrittenSpan(w.span);
            if (hwInfo.isHandwritten) {
              if (wordConfidence !== undefined) handwrittenConfidences.push(wordConfidence);
            } else {
              if (wordConfidence !== undefined) printedConfidences.push(wordConfidence);
            }

            const mappedWord = {
              content: typeof w.content === "string" ? w.content : "",
              polygon: Array.isArray(w.polygon) ? w.polygon : undefined,
              confidence: wordConfidence,
              span: w.span,
              isHandwritten: hwInfo.isHandwritten,
              styleConfidence: hwInfo.styleConfidence,
              pageNumber: pageNum,
            };

            allWords.push(mappedWord);
            return mappedWord;
          })
        : [];

      const lines = Array.isArray(p.lines)
        ? p.lines.map((l: any) => {
            let lineHandwritten = false;
            if (Array.isArray(l.spans)) {
              for (const sp of l.spans) {
                if (checkHandwrittenSpan(sp).isHandwritten) {
                  lineHandwritten = true;
                  break;
                }
              }
            }

            return {
              content: typeof l.content === "string" ? l.content : "",
              polygon: Array.isArray(l.polygon) ? l.polygon : undefined,
              spans: l.spans,
              isHandwritten: lineHandwritten,
              pageNumber: pageNum,
            };
          })
        : [];

      return {
        pageNumber: pageNum,
        width: p.width,
        height: p.height,
        unit: p.unit,
        angle: p.angle,
        lines,
        words,
      };
    });

    let overallConfidence: number | undefined = undefined;
    if (confidences.length > 0) {
      const sum = confidences.reduce((acc, val) => acc + val, 0);
      overallConfidence = Math.round((sum / confidences.length) * 10000) / 10000;
    }

    let handwritingConfidence: number | undefined = undefined;
    if (handwrittenConfidences.length > 0) {
      const sum = handwrittenConfidences.reduce((acc, val) => acc + val, 0);
      handwritingConfidence = Math.round((sum / handwrittenConfidences.length) * 10000) / 10000;
    }

    let printedConfidence: number | undefined = undefined;
    if (printedConfidences.length > 0) {
      const sum = printedConfidences.reduce((acc, val) => acc + val, 0);
      printedConfidence = Math.round((sum / printedConfidences.length) * 10000) / 10000;
    }

    const handwrittenWordCount = allWords.filter((w) => w.isHandwritten).length;
    const printedWordCount = allWords.filter((w) => !w.isHandwritten).length;
    const hasHandwriting = handwrittenWordCount > 0;

    // Preserve full layout and ICR metadata (pages, lines, words, polygons, spans, tables, styles)
    const rawLayout = {
      pages: mappedPages,
      styles: rawStyles,
      tables: Array.isArray(analyzeResult.tables) ? analyzeResult.tables : [],
      paragraphs: Array.isArray(analyzeResult.paragraphs) ? analyzeResult.paragraphs : [],
      handwrittenWordCount,
      printedWordCount,
      hasHandwriting,
      handwritingConfidence,
      printedConfidence,
      words: allWords,
    };

    return {
      text,
      confidence: overallConfidence,
      model: `azure/${effectiveModel}`,
      pageCount,
      provider: "azure",
      rawLayout,
    };
  }
}

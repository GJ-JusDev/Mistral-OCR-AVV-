import type { IOcrProvider, OcrInput, OcrProviderResult } from "./types";
import { OcrProviderError } from "./types";
import { parseRetryAfterHeader } from "../mistral";

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

    // 15MB limit check (base64 string length ~22MB)
    if (base64Content.length > 22 * 1024 * 1024) {
      throw new OcrProviderError(
        "Document payload exceeds the maximum size limit of 15MB.",
        {
          provider: "azure",
          status: 400,
          code: "BAD_REQUEST",
        }
      );
    }

    const cleanEndpoint = endpoint.replace(/\/+$/, "");
    const effectiveModelId = input.modelId || (input.documentSide === "back" ? "prebuilt-layout" : this.modelId);
    const analyzeUrl = `${cleanEndpoint}/documentintelligence/documentModels/${effectiveModelId}:analyze?api-version=${this.apiVersion}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // Step 1: Submit Document for Asynchronous Analysis
      const binaryBody = Buffer.from(base64Content, "base64");
      const normalizedMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
      const validAzureMimes = new Set([
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/tiff",
        "image/bmp",
        "image/heif",
      ]);
      const effectiveContentType = validAzureMimes.has(normalizedMime)
        ? normalizedMime
        : "application/octet-stream";

      const submitRes = await fetch(analyzeUrl, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Content-Type": effectiveContentType,
        },
        body: binaryBody,
        signal: controller.signal,
      });

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
        const rawMsg = errorData.error?.message || errorData.error?.innererror?.message || "Invalid document request.";
        // Sanitize message to ensure no credentials or sensitive URLs leak
        const safeMsg = rawMsg.replace(/https?:\/\/[^\s]+/g, "[redacted-url]");
        throw new OcrProviderError(safeMsg, {
          provider: "azure",
          status: 400,
          code: "BAD_REQUEST",
        });
      }

      if (!submitRes.ok) {
        const status = submitRes.status;
        throw new OcrProviderError(
          `Azure Document Intelligence submission failed with HTTP status ${status}.`,
          {
            provider: "azure",
            status: status >= 500 ? status : 502,
            code: "UPSTREAM_ERROR",
          }
        );
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

      // Step 3: Poll the Asynchronous Operation until terminal state or timeout
      const startTime = Date.now();
      while (Date.now() - startTime < this.timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

        const pollRes = await fetch(operationLocation, {
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
          return this.processAnalyzeResult(pollData.analyzeResult, effectiveModelId);
        }

        if (opStatus === "failed") {
          clearTimeout(timeoutId);
          const errDetail = pollData.error?.message || "Azure Document Intelligence operation reported failure.";
          const safeMsg = errDetail.replace(/https?:\/\/[^\s]+/g, "[redacted-url]");
          throw new OcrProviderError(safeMsg, {
            provider: "azure",
            status: 502,
            code: "UPSTREAM_ERROR",
          });
        }

        // Status is 'notStarted' or 'running': continue polling
      }

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

/**
 * Mistral OCR client — wraps the Mistral OCR API for server-side use.
 */

export type MistralOcrErrorCode =
  | "RATE_LIMIT_EXCEEDED"
  | "QUOTA_EXHAUSTED"
  | "INVALID_API_KEY"
  | "BAD_REQUEST"
  | "UPSTREAM_ERROR";

export class MistralOcrError extends Error {
  public readonly status: number;
  public readonly code: MistralOcrErrorCode;
  public readonly retryAfter?: number;
  public readonly isRateLimit: boolean;
  public readonly isQuotaExhausted: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      code: MistralOcrErrorCode;
      retryAfter?: number;
    }
  ) {
    super(message);
    this.name = "MistralOcrError";
    this.status = options.status;
    this.code = options.code;
    this.retryAfter = options.retryAfter;
    this.isRateLimit = options.code === "RATE_LIMIT_EXCEEDED";
    this.isQuotaExhausted = options.code === "QUOTA_EXHAUSTED";
  }
}

/**
 * Parses HTTP Retry-After header into integer seconds.
 * Handles both delta-seconds ("5") and HTTP-date strings.
 */
export function parseRetryAfterHeader(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  const numericSeconds = parseInt(trimmed, 10);
  if (!isNaN(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds;
  }
  const parsedDate = Date.parse(trimmed);
  if (!isNaN(parsedDate)) {
    const diffSeconds = Math.ceil((parsedDate - Date.now()) / 1000);
    return diffSeconds > 0 ? diffSeconds : 0;
  }
  return undefined;
}

/**
 * Distinguishes account quota exhaustion from temporary burst rate limits.
 */
export function isQuotaExhaustedMessage(msg: string): boolean {
  return /quota|budget|credit|billing|exceeded your balance|insufficient_quota/i.test(msg);
}

type MistralOcrPage = {
  markdown?: string;
};

type MistralOcrResponse = {
  pages?: MistralOcrPage[];
  error?: { message?: string; type?: string; code?: string };
  message?: string;
  detail?: string;
};

export type MistralOcrResult = {
  /** Raw markdown text from all pages concatenated. */
  text: string;
  /** Number of pages in the response. */
  pageCount: number;
};

/**
 * Call the Mistral OCR API with a base64-encoded image.
 *
 * @param imageDataUrl  Full data URL (e.g., "data:image/png;base64,...")
 * @param apiKey        Mistral API key
 * @returns Extracted text and page count.
 * @throws MistralOcrError if the API call fails or returns an error.
 */
export async function callMistralOcr(
  imageDataUrl: string,
  apiKey: string
): Promise<MistralOcrResult> {
  if (!apiKey) {
    throw new MistralOcrError("Mistral OCR is not configured. Set MISTRAL_API_KEY.", {
      status: 500,
      code: "INVALID_API_KEY",
    });
  }

  const isImage = imageDataUrl?.startsWith("data:image/");
  const isPdf = imageDataUrl?.startsWith("data:application/pdf");
  if (!imageDataUrl || (!isImage && !isPdf)) {
    throw new MistralOcrError("A valid base64 image or PDF data URL is required.", {
      status: 400,
      code: "BAD_REQUEST",
    });
  }

  const documentPayload = isPdf
    ? { type: "document_url", document_url: imageDataUrl }
    : { type: "image_url", image_url: imageDataUrl };

  const response = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "mistral-ocr-latest",
      document: documentPayload,
    }),
  });

  let result: MistralOcrResponse = {};
  try {
    result = (await response.json()) as MistralOcrResponse;
  } catch {
    // Non-JSON response from upstream
  }

  if (!response.ok) {
    const rawMessage =
      result.error?.message ??
      result.message ??
      result.detail ??
      `Mistral OCR request failed (${response.status}).`;

    if (response.status === 429) {
      const parsedRetryAfter = parseRetryAfterHeader(response.headers.get("retry-after"));
      const isQuota = isQuotaExhaustedMessage(rawMessage);

      if (isQuota) {
        throw new MistralOcrError(
          "OCR provider account quota or credit limit exhausted. Please check your provider account or contact an administrator.",
          {
            status: 429,
            code: "QUOTA_EXHAUSTED",
          }
        );
      }

      throw new MistralOcrError(
        "OCR request rate limit exceeded. Please wait a moment before trying again.",
        {
          status: 429,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: parsedRetryAfter ?? 5,
        }
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new MistralOcrError(
        "Mistral OCR authentication failed. Please verify the configured server API key.",
        {
          status: response.status,
          code: "INVALID_API_KEY",
        }
      );
    }

    if (response.status === 400) {
      throw new MistralOcrError(rawMessage, {
        status: 400,
        code: "BAD_REQUEST",
      });
    }

    throw new MistralOcrError(rawMessage, {
      status: response.status,
      code: "UPSTREAM_ERROR",
    });
  }

  const pages = result.pages ?? [];
  const text = pages.map((page) => page.markdown ?? "").join("\n\n");

  return {
    text,
    pageCount: pages.length,
  };
}

export type RetryOptions = {
  maxRetries?: number;
  maxServerWaitSeconds?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  jitterMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Calls Mistral OCR with bounded exponential backoff and jitter for transient 429 rate limits.
 * Differentiates temporary rate limits from exhausted account quota or invalid API keys.
 * Never retries quota exhaustion, invalid credentials, or bad requests.
 */
export async function callMistralOcrWithRetry(
  imageDataUrl: string,
  apiKey: string,
  options?: RetryOptions
): Promise<MistralOcrResult> {
  const maxRetries = options?.maxRetries ?? 2;
  const maxServerWaitSeconds = options?.maxServerWaitSeconds ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 800;
  const backoffFactor = options?.backoffFactor ?? 2;
  const jitterMs = options?.jitterMs ?? 250;
  const sleep = options?.sleepFn ?? defaultSleep;

  let attempt = 0;
  while (true) {
    try {
      return await callMistralOcr(imageDataUrl, apiKey);
    } catch (error: any) {
      if (!(error instanceof MistralOcrError)) {
        throw error;
      }

      const isRetriable =
        error.code === "RATE_LIMIT_EXCEEDED" ||
        error.status === 503 ||
        error.status === 504;

      if (!isRetriable || attempt >= maxRetries) {
        throw error;
      }

      // If the provider specifically requested a long cooldown (> maxServerWaitSeconds),
      // do not hold the server connection open — fail fast so the client UI can show the countdown.
      if (error.retryAfter && error.retryAfter > maxServerWaitSeconds) {
        throw error;
      }

      const baseDelay =
        error.retryAfter !== undefined
          ? error.retryAfter * 1000
          : initialDelayMs * Math.pow(backoffFactor, attempt);

      const jitter = Math.floor(Math.random() * jitterMs);
      const delay = baseDelay + jitter;

      await sleep(delay);
      attempt++;
    }
  }
}

/**
 * Common request handler for the OCR endpoint.
 * Dispatches OCR requests, applies bounded backoff, formats 429 responses with Retry-After,
 * and ensures API keys are never leaked to clients.
 */
export async function handleOcrRoute(
  request: Request,
  apiKey: string | undefined,
  fieldParser?: (text: string, gradeLevel?: string, rawLayout?: any, docType?: string) => any,
  ocrCaller: typeof callMistralOcrWithRetry = callMistralOcrWithRetry
): Promise<Response> {
  const providerEnv = process.env.OCR_PRIMARY_PROVIDER?.toLowerCase().trim();
  const isCustomCaller = ocrCaller !== callMistralOcrWithRetry;
  const isAzureConfigured = Boolean(
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT &&
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
  );
  const isAzurePrimary =
    !isCustomCaller &&
    (providerEnv === "azure" || (!providerEnv && isAzureConfigured));
  const isMistralPrimary = !isAzurePrimary;

  if (isMistralPrimary && !apiKey && !isCustomCaller) {
    return Response.json(
      {
        error: "Mistral OCR is not configured. Set MISTRAL_API_KEY.",
        code: "INVALID_API_KEY",
      },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = (await request.json()) as any;
  } catch (parseErr: any) {
    console.error("[ocr] Failed to parse request body as JSON:", parseErr?.message || parseErr);
    return Response.json(
      {
        error: "Invalid request payload: could not parse JSON. The upload stream may have been interrupted or exceeded size limits.",
        code: "BAD_REQUEST",
      },
      { status: 400 }
    );
  }

  try {
    const { image, frontImage, backImage, images, extractFields, gradeLevel, documentSide, documentType, docType } = body || {};
    const effectiveDocType = (documentType || docType || "").toLowerCase().trim();

    const ALLOWED_OCR_MIME_TYPES = new Set([
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]);

    const effectiveFrontImage = frontImage || images?.front || (image && documentSide !== "back" ? image : undefined);
    const effectiveBackImage = backImage || images?.back || (image && documentSide === "back" ? image : undefined);
    const isTwoSided = Boolean((frontImage || images?.front) && (backImage || images?.back));

    function validatePayload(img: any): { error?: string; status?: number; mimeType?: string; base64Content?: string } {
      if (typeof img !== "string") {
        return { error: "A valid base64 image or PDF data URL is required.", status: 400 };
      }
      const match = img.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!match) {
        return { error: "Invalid data URL format. A valid base64 image or PDF data URL is required.", status: 400 };
      }
      const mimeType = match[1].toLowerCase();
      const base64Content = match[2];
      if (!ALLOWED_OCR_MIME_TYPES.has(mimeType)) {
        return { error: `Unsupported document format (${mimeType}). Allowed formats are JPEG, PNG, WebP, and PDF.`, status: 400 };
      }
      if (!base64Content || base64Content.trim().length === 0) {
        return { error: "Document payload cannot be empty.", status: 400 };
      }
      if (base64Content.length > 22 * 1024 * 1024) {
        return { error: "Document payload exceeds the maximum size limit of 15MB.", status: 400 };
      }
      return { mimeType, base64Content };
    }

    let mimeType = "image/png";
    let base64Content = "";

    if (isTwoSided) {
      const frontVal = validatePayload(effectiveFrontImage);
      if (frontVal.error) {
        return Response.json({ error: `Front side: ${frontVal.error}`, code: "BAD_REQUEST" }, { status: frontVal.status });
      }
      const backVal = validatePayload(effectiveBackImage);
      if (backVal.error) {
        return Response.json({ error: `Back side: ${backVal.error}`, code: "BAD_REQUEST" }, { status: backVal.status });
      }
      mimeType = frontVal.mimeType!;
      base64Content = frontVal.base64Content!;
    } else {
      const singleImg = image || effectiveFrontImage || effectiveBackImage;
      const singleVal = validatePayload(singleImg);
      if (singleVal.error) {
        return Response.json({ error: singleVal.error, code: "BAD_REQUEST" }, { status: singleVal.status });
      }
      mimeType = singleVal.mimeType!;
      base64Content = singleVal.base64Content!;
    }

    // If Azure Document Intelligence is configured as primary, route through OcrOrchestrator
    if (isAzurePrimary) {
      try {
        const { OcrOrchestrator } = await import("./providers/orchestrator");
        const orchestrator = new OcrOrchestrator();

        if (isTwoSided) {
          const [frontResult, backResult] = await Promise.all([
            orchestrator.execute({
              image: effectiveFrontImage,
              extractFields,
              gradeLevel,
              documentSide: "front",
            }),
            orchestrator.execute({
              image: effectiveBackImage,
              extractFields,
              gradeLevel,
              documentSide: "back",
            }),
          ]);

          let frontFields: any = {};
          let backFields: any = {};
          if (extractFields && fieldParser) {
            frontFields = fieldParser(frontResult.text, gradeLevel, frontResult.rawLayout, effectiveDocType);
            backFields = fieldParser(backResult.text, gradeLevel, backResult.rawLayout, effectiveDocType);
          }

          const combinedText = `=== FRONT (IDENTITY) ===\n${frontResult.text}\n\n=== BACK (GRADES) ===\n${backResult.text}`;
          const confidences = [frontResult.confidence, backResult.confidence].filter(
            (c): c is number => typeof c === "number"
          );
          const avgConfidence =
            confidences.length > 0
              ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 10000) / 10000
              : undefined;

          const unifiedFields: any = {
            ...frontFields,
            grades:
              backFields.grades && backFields.grades.length > 0
                ? backFields.grades
                : frontFields.grades || [],
            attendance:
              backFields.attendance && backFields.attendance.length > 0
                ? backFields.attendance
                : frontFields.attendance || [],
            attendance_months: backFields.attendance_months || frontFields.attendance_months,
            general_average: backFields.general_average ?? frontFields.general_average,
            ocr_provider: frontResult.provider || "azure",
            ocr_model: `${frontResult.model}+${backResult.model.replace(/^azure\//, "")}`,
          };
          if (typeof avgConfidence === "number") {
            unifiedFields.ocr_confidence = avgConfidence;
          }

          const responseData: any = {
            text: combinedText,
            model: unifiedFields.ocr_model,
            provider: frontResult.provider || "azure",
            fields: unifiedFields,
          };
          if (typeof avgConfidence === "number") {
            responseData.confidence = avgConfidence;
          }
          return Response.json(responseData);
        }

        let imageToExecute = image || effectiveFrontImage || effectiveBackImage;
        if (effectiveDocType === "birth_cert" && imageToExecute) {
          try {
            const { enhancePsaImagePayload } = await import("../image/psaEnhancer");
            const enhanced = await enhancePsaImagePayload(imageToExecute);
            if (enhanced?.enhancedDataUrl) {
              imageToExecute = enhanced.enhancedDataUrl;
            }
          } catch (e) {
            console.warn("[ocr] Server-side PSA enhancement fallback:", e);
          }
        }

        const ocrResult = await orchestrator.execute({
          image: imageToExecute,
          extractFields,
          gradeLevel,
          documentSide,
          ...(effectiveDocType === "sf10" &&
          extractFields &&
          !process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL
            ? { modelId: "prebuilt-layout" }
            : {}),
        });

        let fields: any = undefined;
        if (extractFields && fieldParser) {
          fields = fieldParser(ocrResult.text, gradeLevel, ocrResult.rawLayout, effectiveDocType);
        }

        const responseData: any = {
          text: ocrResult.text,
          model: ocrResult.model,
          provider: ocrResult.provider || "azure",
        };
        if (typeof ocrResult.confidence === "number") {
          responseData.confidence = ocrResult.confidence;
        }
        if (fields) {
          fields.ocr_provider = ocrResult.provider || "azure";
          fields.ocr_model = ocrResult.model;
          if (typeof ocrResult.confidence === "number") {
            fields.ocr_confidence = ocrResult.confidence;
          }
          responseData.fields = fields;
        }
        return Response.json(responseData);
      } catch (azureErr: any) {
        console.error("[ocr] Azure Document Intelligence processing failure:", azureErr?.message || azureErr);
        const status = azureErr?.status || (azureErr?.code === "TIMEOUT" ? 504 : 503);
        const headers: Record<string, string> = {};
        if (azureErr?.retryAfter) {
          headers["Retry-After"] = String(azureErr.retryAfter);
        }
        return Response.json(
          {
            error: azureErr?.message || "Azure Document Intelligence processing failed.",
            code: azureErr?.code || "UPSTREAM_ERROR",
            ...(azureErr?.retryAfter ? { retryAfter: azureErr.retryAfter } : {}),
          },
          { status, headers }
        );
      }
    }

    if (!apiKey) {
      return Response.json(
        {
          error: "Mistral OCR is not configured. Set MISTRAL_API_KEY.",
          code: "INVALID_API_KEY",
        },
        { status: 500 }
      );
    }

    let ocrResult: any;
    try {
      if (isTwoSided) {
        const [mFront, mBack] = await Promise.all([
          ocrCaller(effectiveFrontImage, apiKey),
          ocrCaller(effectiveBackImage, apiKey),
        ]);
        let frontFields: any = undefined;
        let backFields: any = undefined;
        if (extractFields && fieldParser) {
          frontFields = fieldParser(mFront.text, gradeLevel, undefined, effectiveDocType);
          backFields = fieldParser(mBack.text, gradeLevel, undefined, effectiveDocType);
        }
        const combinedText = `=== FRONT (IDENTITY) ===\n${mFront.text}\n\n=== BACK (GRADES) ===\n${mBack.text}`;
        const unifiedFields: any = {
          ...frontFields,
          grades: backFields?.grades?.length ? backFields.grades : frontFields?.grades || [],
          attendance: backFields?.attendance?.length ? backFields.attendance : frontFields?.attendance || [],
          attendance_months: backFields?.attendance_months || frontFields?.attendance_months,
          general_average: backFields?.general_average ?? frontFields?.general_average,
          ocr_provider: "mistral",
          ocr_model: "mistral-ocr-latest",
        };
        return Response.json({
          text: combinedText,
          model: "mistral-ocr-latest",
          provider: "mistral",
          fields: unifiedFields,
        });
      }

      ocrResult = await ocrCaller(image || effectiveFrontImage || effectiveBackImage, apiKey);
    } catch (error: any) {
      console.error("[ocr] Mistral OCR error", error);

      // Check if Azure fallback provider is enabled and available when Mistral is primary
      if (process.env.OCR_FALLBACK_ENABLED === "true") {
        const isRetriable =
          error instanceof MistralOcrError
            ? error.isRateLimit || error.isQuotaExhausted || error.status >= 500
            : /rate limit|quota|50[23]/i.test(error?.message || "");

        if (isRetriable) {
          try {
            const { AzureDocumentIntelligenceProvider } = await import("./providers/azureProvider");
            const fallbackProvider = new AzureDocumentIntelligenceProvider();
            const isReady = await fallbackProvider.isAvailable();
            if (isReady) {
              console.warn("[ocr] Mistral OCR rate-limited or unavailable; falling back to Azure Document Intelligence...");
              const fallbackRes = await fallbackProvider.recognize({
                image: image || effectiveFrontImage || effectiveBackImage,
                extractFields,
                gradeLevel,
                ...(effectiveDocType === "sf10" &&
                extractFields &&
                !process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL
                  ? { modelId: "prebuilt-layout" }
                  : {}),
              });
              let fallbackFields: any = undefined;
              if (extractFields && fieldParser) {
                fallbackFields = fieldParser(fallbackRes.text, gradeLevel, fallbackRes.rawLayout, effectiveDocType);
              }
              const fallbackResponse: any = {
                text: fallbackRes.text,
                model: fallbackRes.model || "azure/prebuilt-read",
                provider: "azure",
              };
              if (typeof fallbackRes.confidence === "number") {
                fallbackResponse.confidence = fallbackRes.confidence;
              }
              if (fallbackFields) {
                fallbackFields.ocr_provider = "azure";
                fallbackFields.ocr_model = fallbackRes.model || "azure/prebuilt-read";
                if (typeof fallbackRes.confidence === "number") {
                  fallbackFields.ocr_confidence = fallbackRes.confidence;
                }
                fallbackResponse.fields = fallbackFields;
              }
              return Response.json(fallbackResponse);
            }
          } catch (fallbackErr: any) {
            console.error("[ocr] Fallback provider failed, reverting to primary error:", fallbackErr?.message);
          }
        }
      }

      if (error instanceof MistralOcrError) {
        if (error.isRateLimit) {
          const retryAfter = error.retryAfter ?? 5;
          return Response.json(
            {
              error: error.message,
              code: error.code,
              retryAfter,
            },
            {
              status: 429,
              headers: {
                "Retry-After": String(retryAfter),
              },
            }
          );
        }

        if (error.isQuotaExhausted) {
          return Response.json(
            {
              error: error.message,
              code: error.code,
            },
            { status: 429 }
          );
        }

        if (error.code === "INVALID_API_KEY") {
          return Response.json(
            {
              error: error.message,
              code: error.code,
            },
            { status: 500 }
          );
        }

        return Response.json(
          {
            error: error.message,
            code: error.code,
          },
          { status: error.status || 502 }
        );
      }

      const message = error?.message || "Mistral OCR request failed.";
      if (/rate limit/i.test(message)) {
        return Response.json(
          {
            error: "OCR request rate limit exceeded. Please wait a moment before trying again.",
            code: "RATE_LIMIT_EXCEEDED",
            retryAfter: 5,
          },
          {
            status: 429,
            headers: { "Retry-After": "5" },
          }
        );
      }

      const isClientError = /4\d\d/.test(message);
      return Response.json(
        {
          error: message,
          code: isClientError ? "BAD_REQUEST" : "UPSTREAM_ERROR",
        },
        { status: isClientError ? 400 : 502 }
      );
    }

    const { text } = ocrResult;

    let fields: any = undefined;
    if (extractFields && fieldParser) {
      fields = fieldParser(text, gradeLevel, undefined, effectiveDocType);
    }

    const responseData: any = {
      text,
      model: ocrResult?.model || "mistral-ocr-latest",
      provider: "mistral",
    };

    if (typeof ocrResult?.confidence === "number") {
      responseData.confidence = ocrResult.confidence;
    }

    if (fields) {
      fields.ocr_provider = "mistral";
      fields.ocr_model = ocrResult?.model || "mistral-ocr-latest";
      responseData.fields = fields;
    }

    return Response.json(responseData);
  } catch (error: any) {
    console.error("[ocr] Internal error processing OCR request:", error);
    const message = error instanceof Error ? error.message : "OCR request processing failed.";
    const code = error?.code || "INTERNAL_ERROR";
    const status = typeof error?.status === "number" && error.status >= 400 && error.status < 600 ? error.status : 500;
    return Response.json(
      {
        error: message,
        code,
      },
      { status }
    );
  }
}



/**
 * Mistral OCR client — wraps the Mistral OCR API for server-side use.
 */

import { normalizeObservedValueMarking, sanitizeLearnersObservedValues } from "../validation/gradeUtils";
import { detectPsaSexFromMarkBoxInk } from "./psaParser";

export { normalizeObservedValueMarking, sanitizeLearnersObservedValues };

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
 * Calculates OCR readability confidence percentage (0-100%) and
 * extracted field completeness percentage (0-100%).
 */
export function calculateOcrMetrics(
  confidence: number | undefined,
  fields: any,
  docType?: string
): { ocrConfidencePercent: number; extractedFieldCompletenessPercent: number } {
  let ocrConfidencePercent: number;
  if (typeof confidence === "number" && !isNaN(confidence)) {
    ocrConfidencePercent = confidence <= 1 ? Math.round(confidence * 100) : Math.min(100, Math.round(confidence));
  } else if (fields?.ocr_confidence !== undefined && typeof fields.ocr_confidence === "number") {
    ocrConfidencePercent = fields.ocr_confidence <= 1 ? Math.round(fields.ocr_confidence * 100) : Math.min(100, Math.round(fields.ocr_confidence));
  } else if (fields?.ocr_provider === "excel" || fields?.model === "sheetjs-xlsx") {
    ocrConfidencePercent = 100;
  } else {
    ocrConfidencePercent = 95;
  }

  let extractedFieldCompletenessPercent = 100;
  if (fields && typeof fields === "object") {
    const dt = (docType || fields.document_type || "").toLowerCase();
    let expectedFields: string[] = [];
    if (dt === "sf10") {
      expectedFields = ["lrn", "last_name", "first_name", "birth_date", "school_name", "grade_level", "track_strand", "grades"];
    } else if (dt === "sf9") {
      expectedFields = ["lrn", "last_name", "grade_level", "school_year", "grades", "attendance"];
    } else if (dt === "sf1") {
      expectedFields = ["school_id", "school_name", "school_year", "grade_level", "section", "learners"];
    } else if (dt === "sf2") {
      expectedFields = ["school_id", "school_name", "school_year", "attendance"];
    } else if (dt === "birth_cert" || dt === "psa") {
      expectedFields = ["registry_number", "last_name", "first_name", "birth_date", "sex", "birth_place"];
    } else {
      expectedFields = ["lrn", "last_name", "first_name", "grade_level", "school_year"];
    }

    let populatedCount = 0;
    for (const f of expectedFields) {
      const val = fields[f];
      if (Array.isArray(val) ? val.length > 0 : (val !== undefined && val !== null && String(val).trim() !== "" && val !== "—")) {
        populatedCount++;
      }
    }
    extractedFieldCompletenessPercent = Math.min(100, Math.max(10, Math.round((populatedCount / expectedFields.length) * 100)));
  }

  return { ocrConfidencePercent, extractedFieldCompletenessPercent };
}

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
  fieldParser?: (text: string, gradeLevel?: string, rawLayout?: any, docType?: string, options?: { targetStudentName?: string; targetLrn?: string }) => any,
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
    const { image, frontImage, backImage, images, extractFields, gradeLevel, documentSide, documentType, docType, targetStudentName, targetLrn } = body || {};
    const effectiveDocType = (documentType || docType || "").toLowerCase().trim();
    const targetOptions = {
      targetStudentName: typeof targetStudentName === "string" ? targetStudentName : undefined,
      targetLrn: typeof targetLrn === "string" ? targetLrn : undefined,
    };

    const validOcrDocTypes = ["sf1", "sf2", "sf9", "sf10", "birth_cert", "psa"];
    if (effectiveDocType && !validOcrDocTypes.includes(effectiveDocType)) {
      return Response.json(
        {
          error: `Unsupported document type: '${effectiveDocType}'. The active AVV Senior High School scope supports SF1, SF2, SF9, SF10, and PSA Birth Certificate.`,
          code: "DOCUMENT_TYPE_NOT_SUPPORTED",
        },
        { status: 400 }
      );
    }

    const ALLOWED_OCR_MIME_TYPES = new Set([
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
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
        return { error: `Unsupported document format (${mimeType}). Allowed formats are JPEG, PNG, WebP, PDF, XLSX, XLS, and CSV.`, status: 400 };
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

    // Built-in Spreadsheet Reader (.xlsx, .xls, .csv) for SF1, SF2, SF9, and SF10
    const { isExcelOrCsvMimeOrExt, extractExcelDocument } = await import("./excelDocumentExtractor");
    if (isExcelOrCsvMimeOrExt(mimeType) || isExcelOrCsvMimeOrExt(body?.fileName || body?.name)) {
      try {
        const excelBuffer = Buffer.from(base64Content, "base64");
        const excelDoc = extractExcelDocument(excelBuffer);
        const rawLayout: any = {
          tables: excelDoc.tables,
          reconstructedRows: excelDoc.allReconstructedRows,
          sheets: excelDoc.sheets,
          isExcel: true,
        };

        let fields: any = undefined;
        if (extractFields && fieldParser) {
          fields = fieldParser(excelDoc.fullRawText, gradeLevel, rawLayout, effectiveDocType, targetOptions);
        }

        const { ocrConfidencePercent, extractedFieldCompletenessPercent } = calculateOcrMetrics(1.0, fields, effectiveDocType);
        const responseData: any = {
          text: excelDoc.fullRawText,
          model: "sheetjs-xlsx",
          provider: "excel",
          confidence: 1.0,
          ocrConfidencePercent,
          extractedFieldCompletenessPercent,
          rawLayout,
        };

        if (fields) {
          fields.ocr_provider = "excel";
          fields.ocr_model = "sheetjs-xlsx";
          fields.ocr_confidence = 1.0;
          fields.ocr_confidence_percent = ocrConfidencePercent;
          fields.field_completeness_percent = extractedFieldCompletenessPercent;
          if (fields.observed_values) {
            fields.observed_values = sanitizeLearnersObservedValues(fields.observed_values);
          }
          responseData.fields = fields;
        }

        return Response.json(responseData);
      } catch (excelErr: any) {
        console.error("[ocr] Excel document extraction error:", excelErr);
        return Response.json(
          {
            error: `Failed to parse spreadsheet document: ${excelErr?.message || String(excelErr)}`,
            code: "SPREADSHEET_PARSE_ERROR",
          },
          { status: 400 }
        );
      }
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
            frontFields = fieldParser(frontResult.text, gradeLevel, frontResult.rawLayout, effectiveDocType, targetOptions);
            backFields = fieldParser(backResult.text, gradeLevel, backResult.rawLayout, effectiveDocType, targetOptions);
          }

          const combinedText = `=== FRONT (IDENTITY) ===\n${frontResult.text}\n\n=== BACK (GRADES) ===\n${backResult.text}`;
          const confidences = [frontResult.confidence, backResult.confidence].filter(
            (c): c is number => typeof c === "number"
          );
          const avgConfidence =
            confidences.length > 0
              ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 10000) / 10000
              : undefined;

          const { evaluateTwoSidedSf9Identity } = await import("../teacher/sectionScanner");
          const crossSideCheck = evaluateTwoSidedSf9Identity({
            frontFields: frontFields || {},
            backFields: backFields || {},
            frontRawText: frontResult.text,
            backRawText: backResult.text,
            frontConfidence: frontResult.confidence,
            backConfidence: backResult.confidence,
          });

          const unifiedFields: any = {
            ...frontFields,
            ...crossSideCheck.mergedFields,
            grades:
              backFields?.grades && backFields.grades.length > 0
                ? backFields.grades
                : crossSideCheck.mergedFields.grades || frontFields?.grades || [],
            attendance:
              backFields?.attendance && backFields.attendance.length > 0
                ? backFields.attendance
                : frontFields?.attendance || [],
            attendance_months: backFields?.attendance_months || frontFields?.attendance_months,
            attendance_totals: backFields?.attendance_totals || frontFields?.attendance_totals,
            attendance_percentage: backFields?.attendance_percentage ?? frontFields?.attendance_percentage,
            absence_percentage: backFields?.absence_percentage ?? frontFields?.absence_percentage,
            attendance_risk_status: backFields?.attendance_risk_status || frontFields?.attendance_risk_status,
            attendance_discrepancy_details: backFields?.attendance_discrepancy_details || frontFields?.attendance_discrepancy_details,
            general_average: backFields?.general_average ?? frontFields?.general_average,
            observed_values: sanitizeLearnersObservedValues(
              backFields?.observed_values || frontFields?.observed_values || crossSideCheck.mergedFields.observed_values
            ),
            learner_progress_achievement: backFields?.learner_progress_achievement || frontFields?.learner_progress_achievement || crossSideCheck.mergedFields.learner_progress_achievement,
            grading_scale: backFields?.grading_scale || frontFields?.grading_scale || crossSideCheck.mergedFields.grading_scale,
            ocr_provider: frontResult.provider || "azure",
            ocr_model: `${frontResult.model}+${backResult.model.replace(/^azure\//, "")}`,
          };
          if (Array.isArray(unifiedFields.grades) && unifiedFields.grades.length > 0) {
            const { normalizeGradeRecords, updateExtractedFieldsAverages } = await import("../validation/gradeUtils");
            unifiedFields.grades = normalizeGradeRecords(unifiedFields.grades, unifiedFields.semester);
            Object.assign(unifiedFields, updateExtractedFieldsAverages(unifiedFields));
          }
          if (typeof avgConfidence === "number") {
            unifiedFields.ocr_confidence = avgConfidence;
          }

          const { ocrConfidencePercent, extractedFieldCompletenessPercent } = calculateOcrMetrics(avgConfidence, unifiedFields, effectiveDocType);
          unifiedFields.ocr_confidence_percent = ocrConfidencePercent;
          unifiedFields.field_completeness_percent = extractedFieldCompletenessPercent;

          const responseData: any = {
            text: combinedText,
            model: unifiedFields.ocr_model,
            provider: frontResult.provider || "azure",
            fields: unifiedFields,
            ocrConfidencePercent,
            extractedFieldCompletenessPercent,
          };
          if (typeof avgConfidence === "number") {
            responseData.confidence = avgConfidence;
          }
          return Response.json(responseData);
        }

        const imageToExecute = image || effectiveFrontImage || effectiveBackImage;

        const ocrResult = await orchestrator.execute({
          image: imageToExecute,
          extractFields,
          gradeLevel,
          documentSide,
          documentType: effectiveDocType,
          ...((effectiveDocType === "sf10" || effectiveDocType === "sf9" || effectiveDocType === "sf2" || effectiveDocType === "sf1" || effectiveDocType === "psa" || effectiveDocType === "birth_cert") &&
          extractFields &&
          !process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL
            ? { modelId: "prebuilt-layout" }
            : {}),
        });

        let fields: any = undefined;
        if (extractFields && fieldParser) {
          fields = fieldParser(ocrResult.text, gradeLevel, ocrResult.rawLayout, effectiveDocType, targetOptions);
        }

        let sexDiagnostic: any = undefined;
        if (effectiveDocType === "birth_cert" || effectiveDocType === "psa") {
          const currentSex = fields?.sex || fields?.identity?.sex;
          const currentSexConf = fields?.field_statuses?.sex?.confidence ?? 0;
          const rawImageCandidate = body.upperSectionImage || body.originalImage || effectiveFrontImage || body.image;

          if ((!currentSex || currentSexConf < 75) && rawImageCandidate && typeof rawImageCandidate === "string") {
            try {
              const b64 = rawImageCandidate.includes(",") ? rawImageCandidate.split(",")[1] : rawImageCandidate;
              const imgBuf = Buffer.from(b64, "base64");
              const inkRes = await detectPsaSexFromMarkBoxInk({
                uprightImageBuffer: imgBuf,
                rawLayout: ocrResult.rawLayout,
              });
              if (inkRes.sex) {
                if (!fields) fields = {};
                fields.sex = inkRes.sex;
                if (!fields.identity) fields.identity = {};
                fields.identity.sex = inkRes.sex === "Male" ? "M" : "F";
                fields.identity.sex_label = inkRes.sex;
                if (!fields.field_statuses) fields.field_statuses = {};
                fields.field_statuses.sex = {
                  value: inkRes.sex,
                  status: "extracted",
                  confidence: inkRes.confidence || 92,
                };
                if (Array.isArray(fields.warnings)) {
                  fields.warnings = fields.warnings.filter((w: string) => !w.toLowerCase().includes("sex could not be reliably extracted"));
                }
              }
              sexDiagnostic = {
                leftInkRatio: inkRes.leftInkRatio,
                rightInkRatio: inkRes.rightInkRatio,
                source: inkRes.source || (inkRes.sex ? (inkRes.sex === "Male" ? "pixel_ink_left_box" : "pixel_ink_right_box") : "not_detected"),
                matchedLines: inkRes.matchedLines || [],
              };
            } catch (inkErr) {
              console.warn("[handleOcrRoute] detectPsaSexFromMarkBoxInk error:", inkErr);
            }
          }

          if (!sexDiagnostic) {
            sexDiagnostic = {
              leftInkRatio: 0,
              rightInkRatio: 0,
              source: (fields?.sex || fields?.identity?.sex) ? "text_x_mark" : "not_detected",
              matchedLines: [],
            };
          }
        }

        const { ocrConfidencePercent, extractedFieldCompletenessPercent } = calculateOcrMetrics(ocrResult.confidence, fields, effectiveDocType);

        const responseData: any = {
          text: ocrResult.text,
          rawText: ocrResult.text,
          raw_ocr_text: ocrResult.text,
          model: ocrResult.model,
          provider: ocrResult.provider || "azure",
          ocrConfidencePercent,
          extractedFieldCompletenessPercent,
        };
        if (typeof ocrResult.confidence === "number") {
          responseData.confidence = ocrResult.confidence;
        }
        if (sexDiagnostic) {
          responseData.sexDiagnostic = sexDiagnostic;
          if (fields?.sex || fields?.identity?.sex) {
            responseData.sex = fields.sex || fields.identity?.sex;
          }
          if (fields?.field_statuses) {
            responseData.field_statuses = fields.field_statuses;
          }
        }
        if (fields) {
          if (sexDiagnostic) {
            fields.sexDiagnostic = sexDiagnostic;
          }
          fields.rawText = ocrResult.text;
          fields.raw_ocr_text = ocrResult.text;
          fields.ocr_provider = ocrResult.provider || "azure";
          fields.ocr_model = ocrResult.model;
          fields.ocr_confidence_percent = ocrConfidencePercent;
          fields.field_completeness_percent = extractedFieldCompletenessPercent;
          if (typeof ocrResult.confidence === "number") {
            fields.ocr_confidence = ocrResult.confidence;
          }
          if (fields.observed_values) {
            fields.observed_values = sanitizeLearnersObservedValues(fields.observed_values);
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
          frontFields = fieldParser(mFront.text, gradeLevel, undefined, effectiveDocType, targetOptions);
          backFields = fieldParser(mBack.text, gradeLevel, undefined, effectiveDocType, targetOptions);
        }
        const combinedText = `=== FRONT (IDENTITY) ===\n${mFront.text}\n\n=== BACK (GRADES) ===\n${mBack.text}`;
        const { evaluateTwoSidedSf9Identity } = await import("../teacher/sectionScanner");
        const crossSideCheck = evaluateTwoSidedSf9Identity({
          frontFields: frontFields || {},
          backFields: backFields || {},
          frontRawText: mFront.text,
          backRawText: mBack.text,
        });

        const unifiedFields: any = {
          ...frontFields,
          ...crossSideCheck.mergedFields,
          grades: backFields?.grades?.length ? backFields.grades : crossSideCheck.mergedFields.grades || frontFields?.grades || [],
          attendance: backFields?.attendance?.length ? backFields.attendance : frontFields?.attendance || [],
          attendance_months: backFields?.attendance_months || frontFields?.attendance_months,
          attendance_totals: backFields?.attendance_totals || frontFields?.attendance_totals,
          attendance_percentage: backFields?.attendance_percentage ?? frontFields?.attendance_percentage,
          absence_percentage: backFields?.absence_percentage ?? frontFields?.absence_percentage,
          attendance_risk_status: backFields?.attendance_risk_status || frontFields?.attendance_risk_status,
          attendance_discrepancy_details: backFields?.attendance_discrepancy_details || frontFields?.attendance_discrepancy_details,
          general_average: backFields?.general_average ?? frontFields?.general_average,
          observed_values: sanitizeLearnersObservedValues(
            backFields?.observed_values || frontFields?.observed_values || crossSideCheck.mergedFields.observed_values
          ),
          learner_progress_achievement: backFields?.learner_progress_achievement || frontFields?.learner_progress_achievement || crossSideCheck.mergedFields.learner_progress_achievement,
          grading_scale: backFields?.grading_scale || frontFields?.grading_scale || crossSideCheck.mergedFields.grading_scale,
          ocr_provider: "mistral",
          ocr_model: "mistral-ocr-latest",
        };
        if (Array.isArray(unifiedFields.grades) && unifiedFields.grades.length > 0) {
          const { normalizeGradeRecords, updateExtractedFieldsAverages } = await import("../validation/gradeUtils");
          unifiedFields.grades = normalizeGradeRecords(unifiedFields.grades, unifiedFields.semester);
          Object.assign(unifiedFields, updateExtractedFieldsAverages(unifiedFields));
        }
        const { ocrConfidencePercent: mTwoConf, extractedFieldCompletenessPercent: mTwoComp } = calculateOcrMetrics(undefined, unifiedFields, effectiveDocType);
        unifiedFields.ocr_confidence_percent = mTwoConf;
        unifiedFields.field_completeness_percent = mTwoComp;

        return Response.json({
          text: combinedText,
          model: "mistral-ocr-latest",
          provider: "mistral",
          fields: unifiedFields,
          ocrConfidencePercent: mTwoConf,
          extractedFieldCompletenessPercent: mTwoComp,
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
                documentType: effectiveDocType,
                ...((effectiveDocType === "sf10" || effectiveDocType === "sf9" || effectiveDocType === "sf2" || effectiveDocType === "sf1" || effectiveDocType === "psa" || effectiveDocType === "birth_cert") &&
                extractFields &&
                !process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL
                  ? { modelId: "prebuilt-layout" }
                  : {}),
              });
              let fallbackFields: any = undefined;
              if (extractFields && fieldParser) {
                fallbackFields = fieldParser(fallbackRes.text, gradeLevel, fallbackRes.rawLayout, effectiveDocType, targetOptions);
              }

              let fallbackSexDiagnostic: any = undefined;
              if (effectiveDocType === "birth_cert" || effectiveDocType === "psa") {
                const currentSex = fallbackFields?.sex || fallbackFields?.identity?.sex;
                const currentSexConf = fallbackFields?.field_statuses?.sex?.confidence ?? 0;
                const rawImageCandidate = body.upperSectionImage || body.originalImage || effectiveFrontImage || body.image;

                if ((!currentSex || currentSexConf < 75) && rawImageCandidate && typeof rawImageCandidate === "string") {
                  try {
                    const b64 = rawImageCandidate.includes(",") ? rawImageCandidate.split(",")[1] : rawImageCandidate;
                    const imgBuf = Buffer.from(b64, "base64");
                    const inkRes = await detectPsaSexFromMarkBoxInk({
                      uprightImageBuffer: imgBuf,
                      rawLayout: fallbackRes.rawLayout,
                    });
                    if (inkRes.sex) {
                      if (!fallbackFields) fallbackFields = {};
                      fallbackFields.sex = inkRes.sex;
                      if (!fallbackFields.identity) fallbackFields.identity = {};
                      fallbackFields.identity.sex = inkRes.sex === "Male" ? "M" : "F";
                      fallbackFields.identity.sex_label = inkRes.sex;
                      if (!fallbackFields.field_statuses) fallbackFields.field_statuses = {};
                      fallbackFields.field_statuses.sex = {
                        value: inkRes.sex,
                        status: "extracted",
                        confidence: inkRes.confidence || 92,
                      };
                      if (Array.isArray(fallbackFields.warnings)) {
                        fallbackFields.warnings = fallbackFields.warnings.filter((w: string) => !w.toLowerCase().includes("sex could not be reliably extracted"));
                      }
                    }
                    fallbackSexDiagnostic = {
                      leftInkRatio: inkRes.leftInkRatio,
                      rightInkRatio: inkRes.rightInkRatio,
                      source: inkRes.source || (inkRes.sex ? (inkRes.sex === "Male" ? "pixel_ink_left_box" : "pixel_ink_right_box") : "not_detected"),
                      matchedLines: inkRes.matchedLines || [],
                    };
                  } catch (inkErr) {
                    console.warn("[handleOcrRoute fallback] detectPsaSexFromMarkBoxInk error:", inkErr);
                  }
                }

                if (!fallbackSexDiagnostic) {
                  fallbackSexDiagnostic = {
                    leftInkRatio: 0,
                    rightInkRatio: 0,
                    source: (fallbackFields?.sex || fallbackFields?.identity?.sex) ? "text_x_mark" : "not_detected",
                    matchedLines: [],
                  };
                }
              }

              const { ocrConfidencePercent: fbConf, extractedFieldCompletenessPercent: fbComp } = calculateOcrMetrics(fallbackRes.confidence, fallbackFields, effectiveDocType);
              const fallbackResponse: any = {
                text: fallbackRes.text,
                rawText: fallbackRes.text,
                raw_ocr_text: fallbackRes.text,
                model: fallbackRes.model || "azure/prebuilt-read",
                provider: "azure",
                ocrConfidencePercent: fbConf,
                extractedFieldCompletenessPercent: fbComp,
              };
              if (typeof fallbackRes.confidence === "number") {
                fallbackResponse.confidence = fallbackRes.confidence;
              }
              if (fallbackSexDiagnostic) {
                fallbackResponse.sexDiagnostic = fallbackSexDiagnostic;
                if (fallbackFields?.sex || fallbackFields?.identity?.sex) {
                  fallbackResponse.sex = fallbackFields.sex || fallbackFields.identity?.sex;
                }
                if (fallbackFields?.field_statuses) {
                  fallbackResponse.field_statuses = fallbackFields.field_statuses;
                }
              }
              if (fallbackFields) {
                if (fallbackSexDiagnostic) {
                  fallbackFields.sexDiagnostic = fallbackSexDiagnostic;
                }
                fallbackFields.rawText = fallbackRes.text;
                fallbackFields.raw_ocr_text = fallbackRes.text;
                fallbackFields.ocr_provider = "azure";
                fallbackFields.ocr_model = fallbackRes.model || "azure/prebuilt-read";
                fallbackFields.ocr_confidence_percent = fbConf;
                fallbackFields.field_completeness_percent = fbComp;
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
      fields = fieldParser(text, gradeLevel, undefined, effectiveDocType, targetOptions);
    }

    const { ocrConfidencePercent: mSingleConf, extractedFieldCompletenessPercent: mSingleComp } = calculateOcrMetrics(ocrResult?.confidence, fields, effectiveDocType);

    const responseData: any = {
      text,
      model: ocrResult?.model || "mistral-ocr-latest",
      provider: "mistral",
      ocrConfidencePercent: mSingleConf,
      extractedFieldCompletenessPercent: mSingleComp,
    };

    if (typeof ocrResult?.confidence === "number") {
      responseData.confidence = ocrResult.confidence;
    }

    if (fields) {
      fields.ocr_provider = "mistral";
      fields.ocr_model = ocrResult?.model || "mistral-ocr-latest";
      fields.ocr_confidence_percent = mSingleConf;
      fields.field_completeness_percent = mSingleComp;
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



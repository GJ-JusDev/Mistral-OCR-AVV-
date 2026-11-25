import type { IOcrProvider, OcrInput, OcrProviderResult, OcrProviderName } from "./types";
import { MistralOcrProvider } from "./mistralProvider";
import { AzureDocumentIntelligenceProvider } from "./azureProvider";

export interface OrchestratorOptions {
  primaryProvider?: IOcrProvider;
  fallbackProvider?: IOcrProvider;
  enableFallback?: boolean;
}

function resolveProvider(name: string | undefined, defaultName: OcrProviderName): IOcrProvider {
  const chosen = (name || defaultName).toLowerCase().trim();
  switch (chosen) {
    case "azure":
      return new AzureDocumentIntelligenceProvider();
    case "mistral":
      return new MistralOcrProvider();
    default:
      if (defaultName === "mistral") return new MistralOcrProvider();
      return new AzureDocumentIntelligenceProvider();
  }
}

/**
 * OCR ORCHESTRATOR (TWO-TIER PRODUCTION STRATEGY)
 *
 * Tier 1 (Primary): Azure AI Document Intelligence
 *   - Form-aware, high-precision geometry, complex tables, cell coordinates for SF9/SF10.
 * Tier 2 (Fallback): Mistral OCR
 *   - Highly resilient cloud backup for rate-limiting, upstream timeout, or quota exhaustion.
 */
export class OcrOrchestrator {
  private primary: IOcrProvider;
  private fallback?: IOcrProvider;
  private enableFallback: boolean;

  constructor(options?: OrchestratorOptions) {
    const selectedPrimary = (process.env.OCR_PRIMARY_PROVIDER as OcrProviderName) || "azure";
    const selectedFallback =
      (process.env.OCR_FALLBACK_PROVIDER as OcrProviderName) ||
      (selectedPrimary === "azure" ? "mistral" : "azure");

    // Primary Provider (default: Azure AI Document Intelligence)
    if (options?.primaryProvider) {
      this.primary = options.primaryProvider;
    } else {
      this.primary = resolveProvider(selectedPrimary, "azure");
    }

    // Fallback Provider (default: Mistral OCR)
    if ("fallbackProvider" in (options || {})) {
      this.fallback = options?.fallbackProvider;
    } else {
      this.fallback = resolveProvider(selectedFallback, "mistral");
    }

    // Fallback enabled policy
    if (options?.enableFallback !== undefined) {
      this.enableFallback = options.enableFallback;
    } else if (process.env.OCR_FALLBACK_ENABLED !== undefined) {
      this.enableFallback = process.env.OCR_FALLBACK_ENABLED === "true";
    } else {
      this.enableFallback = true;
    }
  }

  public getPrimaryProvider(): IOcrProvider {
    return this.primary;
  }

  public getFallbackProvider(): IOcrProvider | undefined {
    return this.fallback;
  }

  // Deprecated backward-compatibility accessors
  public getFirstFallbackProvider(): IOcrProvider | undefined {
    return this.fallback;
  }

  public getSecondFallbackProvider(): IOcrProvider | undefined {
    return undefined;
  }

  public setEnableFallback(enabled: boolean): void {
    this.enableFallback = enabled;
  }

  /**
   * ERROR RETRIABILITY CHECK
   *
   * Only retry retriable server errors (rate limits, upstream timeouts, 502/503/504).
   * Unrecoverable client errors (400 Bad Request, unreadable format) fail immediately.
   */
  public isRetriableError(error: any): boolean {
    if (!error) return false;
    return Boolean(
      error.isRateLimit ||
      error.isQuotaExhausted ||
      error.status === 429 ||
      error.status === 500 ||
      error.status === 502 ||
      error.status === 503 ||
      error.status === 504 ||
      error.code === "RATE_LIMIT_EXCEEDED" ||
      error.code === "QUOTA_EXHAUSTED" ||
      error.code === "UPSTREAM_ERROR" ||
      error.code === "SERVICE_UNAVAILABLE" ||
      error.code === "TIMEOUT" ||
      error.name === "AbortError" ||
      /timeout|connection|econnrefused|fetch failed|network/i.test(error.message || "")
    );
  }

  /**
   * FALLBACK ELIGIBILITY CHECK
   *
   * Azure AI Document Intelligence MUST remain the primary OCR provider throughout the AVV System.
   * Azure is ALWAYS attempted first.
   *
   * Only specifically identified Azure provider limitations that Mistral OCR can reasonably
   * handle (such as Azure-specific image-dimension boundaries or Azure format rejections)
   * are eligible for fallback.
   *
   * Strictly EXCLUDED from fallback:
   * - Authentication errors (401, 403, INVALID_API_KEY)
   * - Missing required Azure configuration
   * - Malformed application payloads (bad JSON, missing image data, corrupt data URLs)
   * - Unsupported user upload types (e.g., text/plain, audio)
   * - Generic 400 Bad Requests without an eligible Azure restriction code
   */
  public isEligibleForFallback(error: any): boolean {
    if (!error) return false;

    // 1. Never fallback for authentication, permission, or missing configuration errors
    if (
      error.status === 401 ||
      error.status === 403 ||
      error.code === "INVALID_API_KEY" ||
      error.code === "UNAUTHORIZED" ||
      error.code === "FORBIDDEN" ||
      /authentication failed|not configured|invalid api key|invalid endpoint format|invalid api version/i.test(
        error.message || ""
      )
    ) {
      return false;
    }

    // 2. Never fallback for client payload validation errors or unsupported upload formats
    if (
      error.code === "UNSUPPORTED_FORMAT" ||
      /invalid data url|payload cannot be empty|unsupported document format|valid image or document payload is required/i.test(
        error.message || ""
      )
    ) {
      return false;
    }

    // 3. Transient server errors, rate limits, timeouts, and network connection drops remain eligible
    if (this.isRetriableError(error)) {
      return true;
    }

    // 4. Specifically identified Azure-specific 400 restrictions that Mistral can reasonably handle:
    // e.g. Azure image dimension limits (min 50x50, max 10000x10000), Azure tier file-size limits
    // (e.g. Free Tier 4MB limit / sync limits), or Azure-specific content/format constraints
    if (error.status === 400 && error.provider === "azure") {
      const codeStr = `${error.diagnosticCode || ""} ${error.innerCode || ""} ${error.azureErrorCode || ""}`.toLowerCase();
      const msgStr = (error.message || "").toLowerCase();

      const isAzureServiceLimitOrFormatRestriction =
        codeStr.includes("invalidcontentdimensions") ||
        codeStr.includes("invalidcontentlength") ||
        codeStr.includes("invalidimagesize") ||
        codeStr.includes("invalidimage") ||
        codeStr.includes("invalidcontent") ||
        codeStr.includes("invalidpayload") ||
        codeStr.includes("unsupportedmediatype") ||
        msgStr.includes("dimension") ||
        msgStr.includes("dimensions are out of range") ||
        msgStr.includes("input image dimensions") ||
        msgStr.includes("too large") ||
        msgStr.includes("maximum file size") ||
        msgStr.includes("file size") ||
        msgStr.includes("content length");

      if (isAzureServiceLimitOrFormatRestriction) {
        return true;
      }
    }

    return false;
  }

  /**
   * EXECUTE OCR PIPELINE WITH DIRECT FAILOVER
   *
   * 1. Attempts Primary Provider (Azure AI Document Intelligence) first.
   * 2. On eligible failure (rate limit 429, timeout, service down, or eligible Azure dimension restriction),
   *    falls directly back to Mistral OCR.
   * 3. Seamlessly returns extracted text and candidate fields to maintain review pipeline.
   */
  public async execute(input: OcrInput): Promise<OcrProviderResult> {
    try {
      // Step 1: Attempt Primary Provider (Azure AI Document Intelligence)
      return await this.primary.recognize(input);
    } catch (primaryError: any) {
      const canFallback = this.enableFallback && this.isEligibleForFallback(primaryError);

      if (!canFallback) {
        throw primaryError;
      }

      // Step 2: Direct Fallback to Mistral OCR
      if (!this.fallback) {
        throw primaryError;
      }

      console.warn(
        `[OcrOrchestrator] Primary provider (${this.primary.name}) failed with ${primaryError.code || primaryError.message}. Attempting direct fallback to ${this.fallback.name}...`
      );

      const isFallbackReady = await this.fallback.isAvailable().catch(() => false);
      if (!isFallbackReady) {
        console.warn(
          `[OcrOrchestrator] Fallback provider (${this.fallback.name}) is unconfigured or unavailable.`
        );
        throw primaryError;
      }

      try {
        const fallbackResult = await this.fallback.recognize(input);
        console.log(
          `[OcrOrchestrator] Fallback to ${this.fallback.name} succeeded.`
        );
        return fallbackResult;
      } catch (fallbackError: any) {
        console.error(
          `[OcrOrchestrator] Fallback provider (${this.fallback.name}) also failed:`,
          fallbackError.message
        );
        throw primaryError;
      }
    }
  }
}

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
   * EXECUTE OCR PIPELINE WITH DIRECT FAILOVER
   *
   * 1. Attempts Primary Provider (Azure AI Document Intelligence).
   * 2. On retriable failure (rate limit 429, timeout, service down), falls directly
   *    back to Mistral OCR without contacting any deleted local service.
   * 3. Seamlessly returns extracted text and candidate fields to maintain review pipeline.
   */
  public async execute(input: OcrInput): Promise<OcrProviderResult> {
    try {
      // Step 1: Attempt Primary Provider (Azure AI Document Intelligence)
      return await this.primary.recognize(input);
    } catch (primaryError: any) {
      const isRetriable = this.enableFallback && this.isRetriableError(primaryError);

      if (!isRetriable) {
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

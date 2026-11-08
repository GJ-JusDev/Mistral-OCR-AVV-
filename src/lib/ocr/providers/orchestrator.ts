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
 * OCR ORCHESTRATOR (DUAL-PROVIDER STRATEGY)
 *
 * Bakit ito ginawa:
 * Ito ang "traffic controller" ng ating OCR subsystem para sa BSIT Capstone Defense.
 * Gumagamit tayo ng Dual-Provider Architecture:
 * 1. Primary Provider: Azure AI Document Intelligence
 *    - Napakagaling magbasa ng complex tables, cell coordinates, at DepEd forms (SF9, SF10, PSA).
 * 2. Fallback Provider: Mistral OCR
 *    - Nagsisilbing maaasahang backup sakaling magkaroon ng network issue, 429 rate limit, o quota limit si Azure.
 *
 * Paano gumagana:
 * Una laging tinatawag si Azure. Kung magkaproblema sa upstream connection o maabot ang rate limit,
 * kusa at awtomatikong lilipat kay Mistral nang hindi nagka-crash ang system at tuloy-tuloy ang workflow ng teacher.
 */
export class OcrOrchestrator {
  private primary: IOcrProvider;
  private fallback?: IOcrProvider;
  private enableFallback: boolean;

  constructor(options?: OrchestratorOptions) {
    // Default configuration: Azure bilang primary, Mistral bilang fallback
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

    // Fallback enabled policy: laging naka-enable sa production para sa high availability
    if (options?.enableFallback !== undefined) {
      this.enableFallback = options.enableFallback;
    } else if (process.env.OCR_FALLBACK_ENABLED !== undefined) {
      this.enableFallback = process.env.OCR_FALLBACK_ENABLED === "true";
    } else {
      // Enabled by default in production
      this.enableFallback = true;
    }
  }

  public getPrimaryProvider(): IOcrProvider {
    return this.primary;
  }

  public getFallbackProvider(): IOcrProvider | undefined {
    return this.fallback;
  }

  public setEnableFallback(enabled: boolean): void {
    this.enableFallback = enabled;
  }

  /**
   * ERROR RETRIABILITY CHECK
   *
   * Bakit kailangang suriin ang error bago mag-fallback:
   * Hindi lahat ng error ay dapat i-retry sa secondary provider.
   * Halimbawa: kung unreadable o corrupted ang image, pareho silang mag-e-error.
   * Pero kung HTTP 429 (Too Many Requests), 503 (Server Unavailable), o network timeout,
   * ibig sabihin problema lang ito sa server ng primary provider, kaya safe subukan si Fallback.
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
   * EXECUTE OCR PIPELINE WITH RESILIENCY
   *
   * Main function na nagpapatakbo ng OCR:
   * 1. Unang susubukan i-extract ang document gamit ang Primary Provider (Azure).
   * 2. Kapag nagkaroon ng retriable error (e.g. rate limit o service down),
   *    sasalo agad ang Fallback Provider (Mistral).
   * 3. Kapag nag-succeed ang fallback, may return result pa rin ang user at hindi mapuputol ang review queue.
   */
  public async execute(input: OcrInput): Promise<OcrProviderResult> {
    try {
      // Step 1: Subukan muna kay Primary (Azure)
      return await this.primary.recognize(input);
    } catch (primaryError: any) {
      // Step 2: Suriin kung pwedeng ilipat sa backup
      const isRetriable = this.enableFallback && this.isRetriableError(primaryError);

      if (!isRetriable || !this.fallback) {
        throw primaryError;
      }

      console.warn(
        `[OcrOrchestrator] Primary provider (${this.primary.name}) failed with ${primaryError.code || primaryError.message}. Attempting fallback to ${this.fallback.name}...`
      );

      // Siguraduhing may API credentials ang fallback provider bago tawagin
      const isFallbackReady = await this.fallback.isAvailable().catch(() => false);
      if (!isFallbackReady) {
        console.warn(
          `[OcrOrchestrator] Fallback provider (${this.fallback.name}) is unconfigured or unavailable.`
        );
        throw primaryError;
      }

      try {
        // Step 3: Isagawa ang OCR gamit ang Fallback (Mistral)
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

import type { IOcrProvider, OcrInput, OcrProviderResult, OcrProviderName } from "./types";
import { OcrProviderError } from "./types";

export interface TrOcrProviderConfig {
  serviceUrl?: string;
  timeoutMs?: number;
}

/**
 * @deprecated TrOCR has been removed from the active AVV OCR pipeline in favor of
 * the two-tier cloud architecture (Azure AI Document Intelligence -> Mistral OCR).
 * Retained on disk for historical reference only.
 */
export class TrOcrProvider implements IOcrProvider {
  public readonly name = "trocr" as unknown as OcrProviderName;
  private serviceUrl: string;
  private timeoutMs: number;

  constructor(config?: TrOcrProviderConfig) {
    this.serviceUrl =
      config?.serviceUrl ||
      process.env.LOCAL_OCR_URL ||
      "http://127.0.0.1:5001";

    const envTimeoutStr = process.env.LOCAL_OCR_TIMEOUT_MS;
    const parsedEnvTimeout = envTimeoutStr ? parseInt(envTimeoutStr, 10) : undefined;
    // Default 60,000ms (60s) for dual-core CPU multi-line handwriting inference
    const defaultCpuTimeout = 60000;
    this.timeoutMs =
      config?.timeoutMs ??
      (parsedEnvTimeout && !isNaN(parsedEnvTimeout) && parsedEnvTimeout > 0
        ? parsedEnvTimeout
        : defaultCpuTimeout);
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }

  public setServiceUrl(url: string): void {
    this.serviceUrl = url;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);

      const res = await fetch(`${this.serviceUrl}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      return data.status === "ok" || data.status === "ready";
    } catch {
      return false;
    }
  }

  public async recognize(input: OcrInput): Promise<OcrProviderResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.serviceUrl}/ocr/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: input.image,
          grade_level: input.gradeLevel,
          extract_fields: input.extractFields,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const message = errorData.detail || errorData.error || `Local OCR failed with status ${res.status}`;
        throw new OcrProviderError(message, {
          provider: "trocr" as unknown as OcrProviderName,
          status: res.status,
          code: res.status >= 500 ? "UPSTREAM_ERROR" : "BAD_REQUEST",
        });
      }

      const data = await res.json();
      return {
        text: data.text || "",
        confidence: typeof data.confidence === "number" ? data.confidence : undefined,
        model: data.model || "trocr-base-handwritten",
        fields: data.fields,
        provider: "trocr" as unknown as OcrProviderName,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err instanceof OcrProviderError) {
        throw err;
      }
      if (err.name === "AbortError") {
        throw new OcrProviderError(
          `Local OCR service request timed out after ${this.timeoutMs}ms.`,
          {
            provider: "trocr" as unknown as OcrProviderName,
            status: 504,
            code: "TIMEOUT",
          }
        );
      }
      throw new OcrProviderError(
        `Local OCR service is unavailable at ${this.serviceUrl}. Make sure the Python service is running.`,
        {
          provider: "trocr" as unknown as OcrProviderName,
          status: 503,
          code: "SERVICE_UNAVAILABLE",
        }
      );
    }
  }
}

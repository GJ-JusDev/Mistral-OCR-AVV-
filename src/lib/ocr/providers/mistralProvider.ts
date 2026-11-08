import type { IOcrProvider, OcrInput, OcrProviderResult } from "./types";
import { OcrProviderError } from "./types";
import { callMistralOcrWithRetry, MistralOcrError } from "../mistral";
import type { RetryOptions } from "../mistral";

export interface MistralProviderConfig {
  apiKey?: string;
  retryOptions?: RetryOptions;
}

export class MistralOcrProvider implements IOcrProvider {
  public readonly name = "mistral" as const;
  private apiKey?: string;
  private retryOptions?: RetryOptions;

  constructor(config?: MistralProviderConfig) {
    this.apiKey = config?.apiKey || process.env.MISTRAL_API_KEY;
    this.retryOptions = config?.retryOptions;
  }

  public setApiKey(key: string | undefined): void {
    this.apiKey = key;
  }

  public async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public async recognize(input: OcrInput): Promise<OcrProviderResult> {
    const key = this.apiKey || process.env.MISTRAL_API_KEY;
    if (!key) {
      throw new OcrProviderError("Mistral OCR is not configured. Set MISTRAL_API_KEY.", {
        provider: "mistral",
        status: 500,
        code: "INVALID_API_KEY",
      });
    }

    try {
      const result = await callMistralOcrWithRetry(input.image, key, this.retryOptions);
      return {
        text: result.text,
        confidence: undefined,
        model: "mistral-ocr-latest",
        pageCount: result.pageCount,
        provider: "mistral",
      };
    } catch (error: any) {
      if (error instanceof MistralOcrError) {
        throw new OcrProviderError(error.message, {
          provider: "mistral",
          status: error.status,
          code: error.code,
          retryAfter: error.retryAfter,
        });
      }
      throw error;
    }
  }
}

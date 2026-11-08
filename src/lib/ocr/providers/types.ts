import type { ExtractedFields } from "@/types/documents";
import type { MistralOcrErrorCode } from "../mistral";

export type OcrProviderName = "azure" | "mistral" | "mock";

export interface OcrInput {
  image: string; // base64 data URL
  extractFields?: boolean;
  gradeLevel?: string;
  documentSide?: "front" | "back";
  modelId?: string;
}

export interface OcrProviderResult {
  text: string;
  confidence?: number;
  model: string;
  fields?: ExtractedFields;
  pageCount?: number;
  provider: OcrProviderName;
  cached?: boolean;
  rawLayout?: any;
}

export class OcrProviderError extends Error {
  public readonly provider: OcrProviderName;
  public readonly status: number;
  public readonly code: MistralOcrErrorCode | "SERVICE_UNAVAILABLE" | "TIMEOUT" | "UNSUPPORTED_FORMAT";
  public readonly retryAfter?: number;
  public readonly isRateLimit: boolean;
  public readonly isQuotaExhausted: boolean;

  constructor(
    message: string,
    options: {
      provider: OcrProviderName;
      status: number;
      code: MistralOcrErrorCode | "SERVICE_UNAVAILABLE" | "TIMEOUT" | "UNSUPPORTED_FORMAT";
      retryAfter?: number;
    }
  ) {
    super(message);
    this.name = "OcrProviderError";
    this.provider = options.provider;
    this.status = options.status;
    this.code = options.code;
    this.retryAfter = options.retryAfter;
    this.isRateLimit = options.code === "RATE_LIMIT_EXCEEDED";
    this.isQuotaExhausted = options.code === "QUOTA_EXHAUSTED";
  }
}

export interface IOcrProvider {
  readonly name: OcrProviderName;
  isAvailable(): Promise<boolean>;
  recognize(input: OcrInput): Promise<OcrProviderResult>;
}

import { handleOcrRoute } from "@/lib/ocr/mistral";
import { parseGradesText } from "@/lib/ocr/gradesParser";
import type { ExtractedFields } from "@/types/documents";

export type OcrResponse = {
  text?: string;
  fields?: ExtractedFields;
  confidence?: number;
  model?: string;
  error?: string;
  code?: string;
  retryAfter?: number;
};

export async function POST(request: Request) {
  const apiKey = process.env.MISTRAL_API_KEY;
  return handleOcrRoute(request, apiKey, parseGradesText);
}
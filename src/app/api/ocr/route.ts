import { handleOcrRoute } from "@/lib/ocr/mistral";
import { parseGradesText } from "@/lib/ocr/gradesParser";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import type { ExtractedFields } from "@/types/documents";

export type OcrResponse = {
  text?: string;
  fields?: ExtractedFields;
  confidence?: number;
  model?: string;
  provider?: string;
  error?: string;
  code?: string;
  retryAfter?: number;
};

export async function POST(request: Request) {
  const startTime = Date.now();
  const apiKey = process.env.MISTRAL_API_KEY;

  let documentType = "sf9";
  let gradeLevel = "Senior High School";

  try {
    const cloned = request.clone();
    const body = await cloned.json();
    documentType = body.documentType || "sf9";
    gradeLevel = body.gradeLevel || "Senior High School";
  } catch {
    // Cloned read fallback
  }

  const res = await handleOcrRoute(request, apiKey, parseGradesText);
  const durationMs = Date.now() - startTime;

  try {
    const resClone = res.clone();
    const data = await resClone.json();

    if (res.ok) {
      await logAuditEvent({
        category: "OCR",
        action: "OCR_PROCESSING_COMPLETED",
        outcome: "SUCCESS",
        targetType: "ocr_job",
        targetLabel: `${documentType.toUpperCase()} OCR Job (${data.provider || "azure"})`,
        reason: `OCR extraction succeeded in ${durationMs}ms`,
        details: {
          provider: data.provider || "azure",
          model: data.model || "azure-layout",
          durationMs,
          documentType,
          confidence: data.confidence,
          hasGrades: Boolean(data.fields?.grades?.length),
          subjectCount: data.fields?.grades?.length || 0,
        },
      });
    } else {
      await logAuditEvent({
        category: "OCR",
        action: "OCR_PROCESSING_FAILED",
        outcome: "FAILURE",
        targetType: "ocr_job",
        targetLabel: `${documentType.toUpperCase()} OCR Job`,
        reason: data.error || `OCR error with status ${res.status}`,
        details: {
          code: data.code,
          status: res.status,
          durationMs,
          documentType,
        },
      });
    }
  } catch {
    // Non-blocking for client response
  }

  return res;
}

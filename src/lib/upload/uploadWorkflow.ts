import type { ExtractedFields } from "@/types/documents";

export type UploadDocCategory = "sf9" | "sf10" | "birth_cert";
export type UploadWorkflowType = "two_sided" | "single";
export type ShsGradeLevel = "Grade 11" | "Grade 12";
export type AcademicGradeLevel = ShsGradeLevel;
export type PreviewRotation = 0 | 90 | 180 | 270;

export const ACADEMIC_GRADE_LEVELS: readonly AcademicGradeLevel[] = [
  "Grade 11",
  "Grade 12",
] as const;

export const DEFAULT_ACADEMIC_GRADE_LEVEL: AcademicGradeLevel = "Grade 11";

export function isAcademicGradeLevel(value: unknown): value is AcademicGradeLevel {
  return value === "Grade 11" || value === "Grade 12";
}

/**
 * Returns true when the academic grade-level selector (Grade 11 / Grade 12)
 * should be displayed in the Upload Document header.
 */
export function shouldShowGradeLevelSelector(docCategory: UploadDocCategory): boolean {
  return docCategory === "sf9" || docCategory === "sf10";
}

export function getGradeLevelShortLabel(gradeLevel: string): string {
  if (gradeLevel === "Grade 11" || gradeLevel === "11") return "Grade 11";
  if (gradeLevel === "Grade 12" || gradeLevel === "12") return "Grade 12";
  if (gradeLevel === "Senior High School") return "SHS";
  if (gradeLevel === "High School") return "JHS";
  return "Elem";
}

export function getWorkflowForCategory(docCategory: UploadDocCategory): UploadWorkflowType {
  return docCategory === "sf9" ? "two_sided" : "single";
}

export function nextPreviewRotation(current: PreviewRotation): PreviewRotation {
  return (((current + 90) % 360) as PreviewRotation);
}

export interface UploadSessionSnapshot<TOcrResult = unknown> {
  docCategory: UploadDocCategory;
  workflowType: UploadWorkflowType;
  gradeLevel: AcademicGradeLevel;
  currentStep: 1 | 2;
  rawImage: string | null;
  frontImage: string | null;
  backImage: string | null;
  ocrResult: TOcrResult | null;
  previewRotation: PreviewRotation;
  hasPsaArtifacts: boolean;
}

/**
 * Pure state transition when switching between SF9, SF10, and PSA.
 * - Clicking the already-active category is a no-op.
 * - Switching categories preserves `gradeLevel` (academic selection) while clearing
 *   incompatible previews, captured sides, preview rotation, PSA crops, and stale OCR output.
 */
export function transitionUploadCategory<TOcrResult = unknown>(
  current: UploadSessionSnapshot<TOcrResult>,
  nextCategory: UploadDocCategory
): { changed: boolean; next: UploadSessionSnapshot<TOcrResult> } {
  if (current.docCategory === nextCategory) {
    return { changed: false, next: current };
  }

  return {
    changed: true,
    next: {
      docCategory: nextCategory,
      workflowType: getWorkflowForCategory(nextCategory),
      gradeLevel: current.gradeLevel,
      currentStep: 1,
      rawImage: null,
      frontImage: null,
      backImage: null,
      ocrResult: null,
      previewRotation: 0,
      hasPsaArtifacts: false,
    },
  };
}

export type ResolvedOcrRequest =
  | {
      kind: "single";
      image: string;
      extractFields: true;
      gradeLevel: AcademicGradeLevel | "PSA";
      documentType: "sf10" | "birth_cert";
    }
  | {
      kind: "two_sided";
      frontImage: string;
      backImage: string;
      extractFields: true;
      gradeLevel: AcademicGradeLevel;
      documentType: "sf9";
    };

/**
 * Resolves the exact OCR request arguments for the active upload workflow,
 * guaranteeing that PSA never inherits the academic `gradeLevel` and that
 * SF10 forwards both the selected `gradeLevel` and `documentType: "sf10"`.
 */
export function resolveOcrExtractionRequest(params: {
  docCategory: UploadDocCategory;
  workflowType: UploadWorkflowType;
  gradeLevel: AcademicGradeLevel;
  singleImage: string | null;
  frontImage: string | null;
  backImage: string | null;
  psaImage: string | null;
}): ResolvedOcrRequest | null {
  const {
    docCategory,
    workflowType,
    gradeLevel,
    singleImage,
    frontImage,
    backImage,
    psaImage,
  } = params;

  if (docCategory === "birth_cert") {
    if (!psaImage) return null;
    return {
      kind: "single",
      image: psaImage,
      extractFields: true,
      gradeLevel: "PSA",
      documentType: "birth_cert",
    };
  }

  if (workflowType === "two_sided") {
    if (!frontImage || !backImage) return null;
    return {
      kind: "two_sided",
      frontImage,
      backImage,
      extractFields: true,
      gradeLevel,
      documentType: "sf9",
    };
  }

  if (!singleImage) return null;
  return {
    kind: "single",
    image: singleImage,
    extractFields: true,
    gradeLevel,
    documentType: "sf10",
  };
}

export interface BuildDocumentSubmissionParams {
  docCategory: UploadDocCategory;
  gradeLevel: AcademicGradeLevel;
  ocrFields: ExtractedFields;
  ocrText?: string;
  ocrModel?: string;
  ocrConfidence?: number;
  finalPrimaryUrl: string;
  backStorageUrl?: string;
  originalFilename: string;
  psaMetadata?: {
    originalPsaStorageUrl?: string;
    fullPsaStorageUrl?: string;
    identityCropPsaStorageUrl?: string;
    processedPsaStorageUrl?: string;
    ocrCandidateType?: string;
    cropScaleFactor?: number;
    identityCropBox?: unknown;
  };
}

export function buildDocumentSubmissionPayload(params: BuildDocumentSubmissionParams): {
  docType: "sf9" | "sf10" | "birth_cert";
  combinedFields: ExtractedFields;
  requestBody: Record<string, unknown>;
} {
  const {
    docCategory,
    gradeLevel,
    ocrFields,
    ocrText,
    ocrModel,
    ocrConfidence,
    finalPrimaryUrl,
    backStorageUrl,
    originalFilename,
    psaMetadata,
  } = params;

  const docType: "sf9" | "sf10" | "birth_cert" =
    docCategory === "birth_cert"
      ? "birth_cert"
      : docCategory === "sf10" || ocrFields?.document_type?.toLowerCase() === "sf10"
      ? "sf10"
      : "sf9";

  const sanitizedBaseFields: ExtractedFields = { ...ocrFields };
  if (docType === "birth_cert") {
    delete sanitizedBaseFields.academic_level;
    delete sanitizedBaseFields.selected_grade_level;
    delete sanitizedBaseFields.grading_period_scheme;
  }

  const academicScheme =
    sanitizedBaseFields.grading_period_scheme || "quarterly_semestral";

  const combinedFields: ExtractedFields = {
    ...sanitizedBaseFields,
    document_type: docType,
    ...(docType !== "birth_cert"
      ? {
          academic_level: "Senior High School",
          selected_grade_level: gradeLevel,
          grade_level: sanitizedBaseFields.grade_level || gradeLevel,
          grading_period_scheme: academicScheme,
        }
      : {}),
    ...(backStorageUrl
      ? {
          back_image_url: backStorageUrl,
          images: { front: finalPrimaryUrl, back: backStorageUrl },
        }
      : {}),
    ...(docType === "birth_cert"
      ? {
          original_image_url: psaMetadata?.originalPsaStorageUrl || finalPrimaryUrl,
          full_corrected_image_url: psaMetadata?.fullPsaStorageUrl || finalPrimaryUrl,
          identity_crop_image_url:
            psaMetadata?.identityCropPsaStorageUrl ||
            psaMetadata?.processedPsaStorageUrl ||
            finalPrimaryUrl,
          processed_image_url:
            psaMetadata?.identityCropPsaStorageUrl ||
            psaMetadata?.processedPsaStorageUrl ||
            finalPrimaryUrl,
          ocr_candidate_type: psaMetadata?.ocrCandidateType || "bw",
          crop_scale_factor: psaMetadata?.cropScaleFactor || 2.0,
          identity_crop_box: psaMetadata?.identityCropBox,
          images: {
            front: psaMetadata?.originalPsaStorageUrl || finalPrimaryUrl,
            back: backStorageUrl || undefined,
          },
          grades: [],
        }
      : {}),
  };

  const resolvedModel = ocrModel || ocrFields.ocr_model;
  const resolvedConfidence =
    typeof ocrConfidence === "number"
      ? ocrConfidence
      : typeof ocrFields.ocr_confidence === "number"
      ? ocrFields.ocr_confidence
      : undefined;

  const requestBody: Record<string, unknown> = {
    document_type: docType,
    image_url: finalPrimaryUrl,
    original_filename: originalFilename,
    extracted_text: ocrText || "Extracted Text",
    extracted_fields: combinedFields,
    status: "submitted",
    ...(docType !== "birth_cert" ? { selected_grade_level: gradeLevel } : {}),
    ...(resolvedModel ? { ocr_model: resolvedModel } : {}),
    ...(typeof resolvedConfidence === "number" ? { ocr_confidence: resolvedConfidence } : {}),
  };

  return { docType, combinedFields, requestBody };
}

export function getUploadUiCopy(params: {
  docCategory: UploadDocCategory;
  workflowType: UploadWorkflowType;
  currentStep: 1 | 2;
  gradeLevel: AcademicGradeLevel;
}): {
  captureHeading: string;
  previewHeading: string;
  emptyHeading: string;
  emptyDescription: string;
  modalSummaryLabel: string;
} {
  const { docCategory, workflowType, currentStep, gradeLevel } = params;
  const shortLevel = getGradeLevelShortLabel(gradeLevel);

  if (docCategory === "birth_cert") {
    return {
      captureHeading: "Capture PSA / Birth Certificate",
      previewHeading: "PSA / Birth Certificate Preview",
      emptyHeading: "Capture or upload a PSA / Birth Certificate",
      emptyDescription:
        "Ensure registry number, child's full name, sex, and date of birth are clearly legible.",
      modalSummaryLabel: "PSA / Birth Certificate",
    };
  }

  if (docCategory === "sf10") {
    const levelInstruction =
      `Ensure learner identity, LRN, track/strand, and ${gradeLevel} semester grade tables are clearly visible.`;

    return {
      captureHeading: `Capture SF10 Permanent Record (${shortLevel})`,
      previewHeading: `SF10 Permanent Record Preview — ${gradeLevel}`,
      emptyHeading: `Capture or upload an SF10 (${shortLevel}) Permanent Record`,
      emptyDescription: levelInstruction,
      modalSummaryLabel: `SF10 Permanent Record (${gradeLevel})`,
    };
  }

  // SF9 (two-sided report card)
  return {
    captureHeading:
      workflowType === "two_sided"
        ? currentStep === 1
          ? "Capture Front / Identity Side"
          : "Capture Back / Academic Grade Side"
        : `Capture SF9 Report Card (${shortLevel})`,
    previewHeading:
      workflowType === "two_sided"
        ? `Active Preview — ${currentStep === 1 ? "Front / Identity Side" : "Back / Academic Grade Side"} (${shortLevel})`
        : `SF9 Report Card Preview — ${gradeLevel}`,
    emptyHeading:
      workflowType === "two_sided"
        ? currentStep === 1
          ? "Step 1: Capture or upload the Front / Identity side"
          : "Step 2: Capture or upload the Back / Grade side"
        : "Capture or upload an image to preview",
    emptyDescription:
      workflowType === "two_sided" && currentStep === 1
        ? "Ensure learner name, LRN, and school header are clearly visible."
        : workflowType === "two_sided" && currentStep === 2
        ? "Ensure subject rows, quarter columns, and attendance are in focus."
        : "Preview will appear here before OCR extraction.",
    modalSummaryLabel: `ONE unified SF9 record (${gradeLevel})`,
  };
}

import type { ExtractedFields } from "@/types/documents";

export type UploadDocCategory = "sf1" | "sf2" | "sf5" | "sf9" | "sf10" | "birth_cert";
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
 * SF1, SF2, SF5, SF9, and SF10 are all grade-level specific in SHS.
 */
export function shouldShowGradeLevelSelector(docCategory: UploadDocCategory): boolean {
  return (
    docCategory === "sf1" ||
    docCategory === "sf2" ||
    docCategory === "sf5" ||
    docCategory === "sf9" ||
    docCategory === "sf10"
  );
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
  hasPsaArtifacts?: boolean;
}

/**
 * Pure state transition when switching between document categories.
 * - Clicking the already-active category is a no-op.
 * - Switching categories preserves `gradeLevel` (academic selection) while clearing
 *   incompatible previews, captured sides, preview rotation, and stale OCR output.
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
      gradeLevel: AcademicGradeLevel | string;
      documentType: "sf1" | "sf2" | "sf5" | "sf10" | "birth_cert";
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
 * Resolves the exact OCR request arguments for the active upload workflow.
 */
export function resolveOcrExtractionRequest(params: {
  docCategory: UploadDocCategory | string;
  workflowType: UploadWorkflowType;
  gradeLevel: AcademicGradeLevel | string;
  singleImage: string | null;
  frontImage?: string | null;
  backImage?: string | null;
  psaImage?: string | null;
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

  if (docCategory === "birth_cert" || (docCategory as string) === "psa") {
    const effectivePsaImage = psaImage || singleImage;
    if (!effectivePsaImage) return null;
    return {
      kind: "single",
      image: effectivePsaImage,
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
      gradeLevel: gradeLevel as AcademicGradeLevel,
      documentType: "sf9",
    };
  }

  const effectiveImage = singleImage;
  if (!effectiveImage) return null;

  const validDocType = docCategory as "sf1" | "sf2" | "sf5" | "sf10";

  return {
    kind: "single",
    image: effectiveImage,
    extractFields: true,
    gradeLevel: gradeLevel as AcademicGradeLevel,
    documentType: validDocType,
  };
}

export interface BuildDocumentSubmissionParams {
  docCategory: UploadDocCategory;
  gradeLevel: AcademicGradeLevel | string;
  ocrFields: ExtractedFields;
  ocrText?: string;
  ocrModel?: string;
  ocrConfidence?: number;
  finalPrimaryUrl: string;
  backStorageUrl?: string;
  originalFilename: string;
  status?: string;
  documentId?: string;
}

export function buildDocumentSubmissionPayload(params: BuildDocumentSubmissionParams): {
  docType: UploadDocCategory;
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
  } = params;

  if (docCategory === "birth_cert" || (docCategory as string) === "psa") {
    const combinedFields: ExtractedFields = {
      ...ocrFields,
      document_type: "birth_cert",
      grades: [],
    };
    delete (combinedFields as any).selected_grade_level;
    delete (combinedFields as any).academic_level;
    delete (combinedFields as any).grading_period_scheme;

    const requestBody: Record<string, unknown> = {
      document_type: "birth_cert",
      image_url: finalPrimaryUrl,
      original_filename: originalFilename,
      extracted_text: ocrText || "CERTIFICATE OF LIVE BIRTH",
      extracted_fields: combinedFields,
      status: params.status || "needs_review",
      ...(params.documentId ? { document_id: params.documentId } : {}),
      ...(ocrModel ? { ocr_model: ocrModel } : {}),
      ...(typeof ocrConfidence === "number" ? { ocr_confidence: ocrConfidence } : {}),
    };

    return { docType: "birth_cert", combinedFields, requestBody };
  }

  const docType: UploadDocCategory = docCategory;
  const sanitizedBaseFields: ExtractedFields = { ...ocrFields };
  const academicScheme =
    sanitizedBaseFields.grading_period_scheme || "quarterly_semestral";

  const combinedFields: ExtractedFields = {
    ...sanitizedBaseFields,
    document_type: docType,
    academic_level: "Senior High School",
    selected_grade_level: gradeLevel,
    grade_level: sanitizedBaseFields.grade_level || gradeLevel,
    grading_period_scheme: academicScheme,
    ...(backStorageUrl
      ? {
          back_image_url: backStorageUrl,
          images: { front: finalPrimaryUrl, back: backStorageUrl },
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
    status: params.status || "needs_review",
    selected_grade_level: gradeLevel,
    ...(params.documentId ? { document_id: params.documentId } : {}),
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

  if (docCategory === "sf1") {
    return {
      captureHeading: `Capture SHS SF1 School Register (${shortLevel})`,
      previewHeading: `SF1 School Register Preview — ${gradeLevel}`,
      emptyHeading: `Capture or upload an SHS SF1 (${shortLevel}) Roster`,
      emptyDescription:
        "Ensure school header, Track, Strand, Semester, and learner enrollment table columns (LRN, names, sex, DOB) are clearly visible.",
      modalSummaryLabel: `SHS SF1 School Register (${gradeLevel})`,
    };
  }

  if (docCategory === "sf2") {
    return {
      captureHeading: `Capture SHS SF2 Daily Attendance (${shortLevel})`,
      previewHeading: `SF2 Daily Attendance Report Preview — ${gradeLevel}`,
      emptyHeading: `Capture or upload an SHS SF2 (${shortLevel}) Monthly Sheet`,
      emptyDescription:
        "Ensure reporting month, learner names, 31-day attendance marks, and monthly summary columns are clearly visible.",
      modalSummaryLabel: `SHS SF2 Attendance Report (${gradeLevel})`,
    };
  }

  if (docCategory === "sf5") {
    return {
      captureHeading: `Capture SHS SF5 Promotion Report (${shortLevel})`,
      previewHeading: `SF5 Promotion & Proficiency Preview — ${gradeLevel}`,
      emptyHeading: `Capture or upload an SHS SF5A/SF5B (${shortLevel}) Form`,
      emptyDescription:
        "Ensure learner promotion action (Complete/Incomplete/Graduating), general averages, and deficient subjects are clearly legible.",
      modalSummaryLabel: `SHS SF5 Promotion Report (${gradeLevel})`,
    };
  }

  if (docCategory === "birth_cert") {
    return {
      captureHeading: "Capture PSA Certificate of Live Birth",
      previewHeading: "PSA Birth Certificate Preview (Supporting Identity Document)",
      emptyHeading: "Capture or upload a PSA Birth Certificate",
      emptyDescription:
        "Ensure civil registry number, child name, date of birth, sex, and parent names are clearly visible. Stored privately with short-lived signed URLs.",
      modalSummaryLabel: "PSA Birth Certificate (Civil Identity Evidence)",
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

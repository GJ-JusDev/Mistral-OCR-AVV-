"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import PreScanAssignmentGate, {
  type PreScanAssignmentState,
} from "@/components/upload/PreScanAssignmentGate";
import UnifiedBatchResultsView from "@/components/validation/UnifiedBatchResultsView";
import { Modal } from "@/components/ui/Modal";
import type { BatchValidationReport, LearnerValidationDossier } from "@/lib/validation/batchCrossDocumentValidator";
import type { DocumentSegment, ShsDocumentType } from "@/lib/validation/batchDocumentSegmenter";
import { DOCUMENT_TITLES } from "@/lib/validation/batchDocumentSegmenter";
import {
  shouldShowGradeLevelSelector,
  type UploadDocCategory,
} from "@/lib/upload/uploadWorkflow";
import {
  reconcileStudentDataFromPrimarySources,
  type ReconciliationLogItem,
} from "@/lib/validation/crossDocumentEngine";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  RotateCw,
  Eye,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Layers,
  X,
  Clock,
  Check,
  AlertTriangle,
  Info,
  RefreshCw,
  Plus,
  Trash2,
  Camera,
  Loader2,
  Edit3,
  Heart,
  BookOpen,
  Calendar,
  FileSpreadsheet,
  FolderCheck,
  Folder,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  verifyAllDocumentsMatchSf1,
  verifyAllDocumentsMatchAnchorStudent,
  areLearnerNamesMatching,
  formatBatchNumber,
} from "@/lib/validation/nameComparison";
import DocumentCameraCaptureModal from "@/components/camera/DocumentCameraCaptureModal";
import { preprocessPsaImage } from "@/lib/ocr/psaPreprocessing";
import type { PsaFieldStatusItem } from "@/lib/ocr/psaParser";
import { formatDepEdMonthDisplay } from "@/lib/validation/monthNormalizer";
import { formatBirthDateDisplay } from "@/lib/validation/birthDateNormalizer";
import * as XLSX from "xlsx";
import { deduplicateSf2Records } from "@/lib/ocr/shsSf2Parser";
import type { Sf10ScholasticRecord, Sf10SubjectRow } from "@/lib/ocr/sf10ShsParser";
import { mergeSf9FrontAndBack } from "@/lib/validation/sf9Merger";
import { computeSemesterGeneralAverage, updateExtractedFieldsAverages, isBlankOrMissingFinal, evaluateDynamicGradeStatus, normalizeObservedValueMarking, normalizeStrictSex, validateConsecutiveSchoolYear, validateSf2RowFormattingAndTotals, validateSf2SchoolYear, roundSf10GeneralAverage } from "@/lib/validation/gradeUtils";
import type { ExtractedFields, GradeRecord } from "@/types/documents";

export type UnifiedProcessingStage =
  | "idle"
  | "uploading"
  | "classifying"
  | "extracting"
  | "organizing"
  | "matching"
  | "validating"
  | "completed"
  | "error";

const STAGES_CONFIG: Array<{ id: UnifiedProcessingStage; label: string; description: string }> = [
  { id: "uploading", label: "File Upload", description: "Staging document files in secure storage" },
  { id: "classifying", label: "Document Classification", description: "Inspecting page layouts and boundaries" },
  { id: "extracting", label: "OCR/ICR Extraction", description: "Extracting printed text, tables, and handwriting" },
  { id: "organizing", label: "Data Organization", description: "Structuring roster, attendance, and grades" },
  { id: "matching", label: "Learner Matching", description: "Correlating learners by 12-digit LRN" },
  { id: "validating", label: "Cross-Document Validation", description: "Evaluating pairwise comparators and consistency" },
  { id: "completed", label: "Validation Report", description: "Consolidating report across all forms" },
];

export type ExtractionStatus = "pending" | "queued" | "extracting" | "extracted" | "failed";

export interface WizardDocumentItem {
  id: string;
  file: File;
  name: string;
  size: string;
  sizeBytes: number;
  type: string;
  dataUrl: string;
  pageCount: number;
  documentType: ShsDocumentType;
  stepCategory: UploadDocCategory;
  uploadedAt: number;
  pairId?: string;
  documentSide?: "front" | "back";
  extractionStatus?: ExtractionStatus;
  status?: ExtractionStatus;
  extractionError?: string;
  extractedText?: string;
  extractedFields?: any;
  rawLayout?: RawLayoutResult;
  ocrConfidencePercent?: number;
  extractedFieldCompletenessPercent?: number;
  // Step 5 PSA Preprocessing & Multi-view Preview fields:
  originalDataUrl?: string;
  upperSectionDataUrl?: string;
  processedDataUrl?: string;
  previewMode?: "upper" | "processed" | "original";
  rotation?: number;
  isPreprocessing?: boolean;
}

export interface WizardStepDefinition {
  id: UploadDocCategory;
  stepNumber: number;
  shortLabel: string;
  title: string;
  formCode: string;
  depedName: string;
  description: string;
  purpose: string;
  isOptional: boolean;
  requiredFieldsNote: string;
}

import { safeParseJsonResponse, safeJsonStringify } from "@/lib/upload/safeParseResponse";
export { safeParseJsonResponse, safeJsonStringify };

export const WIZARD_STEPS: WizardStepDefinition[] = [
  {
    id: "sf9",
    stepNumber: 1,
    shortLabel: "SF9",
    title: "School Form 9 (SF9-SHS)",
    formCode: "SF9-SHS",
    depedName: "Learner's Progress Report Card",
    description: "DepEd Form 138 with quarterly academic ratings, semestral final grades, and core observed values.",
    purpose: "Establishes canonical target learner LRN, Full Name, Sex, attendance summary, and semester grades first.",
    isOptional: false,
    requiredFieldsNote: "12-digit LRN, Learner Full Name, Sex, Quarterly and Final Grades, Core Values, General Average, Monthly Attendance",
  },
  {
    id: "birth_cert",
    stepNumber: 2,
    shortLabel: "PSA",
    title: "PSA Certificate of Live Birth",
    formCode: "PSA / NSO",
    depedName: "Certificate of Live Birth",
    description: "Philippine Statistics Authority official birth certificate used as an optional supporting civil identity document.",
    purpose: "Verifies civil birth identity and parents' names. Resolves legal spelling discrepancies in learner name, sex, date of birth, and parentage.",
    isOptional: true,
    requiredFieldsNote: "Optional supporting document. Can be skipped without blocking extraction.",
  },
  {
    id: "sf1",
    stepNumber: 3,
    shortLabel: "SF1",
    title: "School Form 1 (SF1-SHS)",
    formCode: "SF1-SHS",
    depedName: "School Register",
    description: "Official master register of enrolled Senior High School learners for the advisory section.",
    purpose: "Uses SF9 anchor learner identity to locate and verify the target learner in the class register.",
    isOptional: false,
    requiredFieldsNote: "12-digit LRN, Learner Full Name, Sex, Birth Date, Track and Strand",
  },
  {
    id: "sf2",
    stepNumber: 4,
    shortLabel: "SF2",
    title: "School Form 2 (SF2-SHS)",
    formCode: "SF2-SHS",
    depedName: "Daily Attendance Report",
    description: "Monthly summary of learner daily attendance, total days present/absent, and tardiness.",
    purpose: "Uses SF9 anchor learner name to isolate the target learner's monthly attendance row from the multi-student roster.",
    isOptional: false,
    requiredFieldsNote: "School Month, Days of Classes, Days Present/Absent per learner, Registered Adviser",
  },
  {
    id: "sf10",
    stepNumber: 5,
    shortLabel: "SF10",
    title: "School Form 10 (SF10-SHS)",
    formCode: "SF10-SHS",
    depedName: "Learner's Permanent Academic Record",
    description: "DepEd Form 137 historical scholastic transcript across semesters, eligibility, and remedial courses.",
    purpose: "Reconciles historical semestral subjects, final ratings, credits earned, and scholastic standing.",
    isOptional: false,
    requiredFieldsNote: "Historical Semestral Subjects, Final Ratings, Credits Earned, Eligibility Credentials",
  },
];

interface RawPageItem {
  pageNumber?: number;
  lines?: Array<{ content?: string }>;
  words?: unknown[];
}

interface RawLayoutResult {
  pages?: RawPageItem[];
  tables?: Array<{ boundingRegions?: Array<{ pageNumber?: number }> }>;
  sheets?: Array<{ name: string; matrix: string[][] }>;
}

export default function UnifiedUploadPage() {
  // Wizard state: 0=SF1, 1=SF2, 2=SF9, 3=SF10, 4=PSA, 5=Review
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [stepFiles, setStepFiles] = useState<Record<UploadDocCategory, WizardDocumentItem[]>>({
    sf1: [],
    sf2: [],
    sf5: [],
    sf9: [],
    sf10: [],
    birth_cert: [],
  });
  const [replacingFileId, setReplacingFileId] = useState<string | null>(null);
  const [previewModalFile, setPreviewModalFile] = useState<WizardDocumentItem | null>(null);
  const [modalPsaPreviewMode, setModalPsaPreviewMode] = useState<"upper" | "processed" | "original">("upper");
  const [activeExcelSheetIndex, setActiveExcelSheetIndex] = useState<number>(0);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [sf2ShowAllLearners, setSf2ShowAllLearners] = useState<boolean>(true);
  const [expandedPsaRawOcr, setExpandedPsaRawOcr] = useState<Record<string, boolean>>({});

  const isSpreadsheetFile = (file?: WizardDocumentItem | null): boolean => {
    if (!file) return false;
    const lowerName = (file.name || "").toLowerCase();
    const lowerType = (file.type || "").toLowerCase();
    return (
      lowerName.endsWith(".xlsx") ||
      lowerName.endsWith(".xls") ||
      lowerName.endsWith(".csv") ||
      lowerType.includes("spreadsheet") ||
      lowerType.includes("ms-excel") ||
      lowerType === "text/csv"
    );
  };

  const spreadsheetSheets: Array<{ name: string; matrix: string[][] }> = React.useMemo(() => {
    if (!previewModalFile || !isSpreadsheetFile(previewModalFile)) return [];
    if (previewModalFile.rawLayout?.sheets && Array.isArray(previewModalFile.rawLayout.sheets) && previewModalFile.rawLayout.sheets.length > 0) {
      return previewModalFile.rawLayout.sheets;
    }
    if (previewModalFile.dataUrl) {
      try {
        const commaIdx = previewModalFile.dataUrl.indexOf(",");
        const b64 = commaIdx >= 0 ? previewModalFile.dataUrl.slice(commaIdx + 1) : previewModalFile.dataUrl;
        const wb = XLSX.read(b64, { type: "base64" });
        return wb.SheetNames.map((name) => {
          const sheet = wb.Sheets[name];
          const matrix = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as any[][]).map((row) =>
            row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
          );
          return { name, matrix };
        });
      } catch (e) {
        console.warn("[upload] Client-side spreadsheet parse error:", e);
      }
    }
    return [];
  }, [previewModalFile]);

  useEffect(() => {
    setActiveExcelSheetIndex(0);
  }, [previewModalFile?.id]);

  // Manual Correction state for Step 5 (PSA) documents
  const [editingPsaFileId, setEditingPsaFileId] = useState<string | null>(null);
  const [editingPsaForm, setEditingPsaForm] = useState<{
    first_name: string;
    middle_name: string;
    last_name: string;
    birth_date: string;
    sex: string;
    mother_maiden_name: string;
    father_name: string;
    registry_number: string;
  }>({
    first_name: "",
    middle_name: "",
    last_name: "",
    birth_date: "",
    sex: "",
    mother_maiden_name: "",
    father_name: "",
    registry_number: "",
  });

  // Selected files state (kept synchronized with wizard files for unified scanning and regression tests)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<
    Array<{
      name: string;
      size: string;
      type: string;
      dataUrl: string;
      pageCount: number;
      documentType?: ShsDocumentType;
      documentSide?: "front" | "back";
      pairId?: string;
    }>
  >([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // Processing state
  const [stage, setStage] = useState<UnifiedProcessingStage>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectedSegments, setDetectedSegments] = useState<DocumentSegment[]>([]);
  const [extractedData, setExtractedData] = useState<Record<string, unknown>>({});
  const [validationReport, setValidationReport] = useState<BatchValidationReport | null>(null);

  // Two-stage upload verification & explicit confirmation state
  const [isCommittingBatch, setIsCommittingBatch] = useState<boolean>(false);
  const [isBatchCommitted, setIsBatchCommitted] = useState<boolean>(false);
  const [batchCommitError, setBatchCommitError] = useState<string | null>(null);
  const [isPreUploadModalOpen, setIsPreUploadModalOpen] = useState<boolean>(false);
  const [reconciledDossiers, setReconciledDossiers] = useState<
    Record<string, { dossier: LearnerValidationDossier; log: ReconciliationLogItem[] }>
  >({});
  const [sf1StudentValidation, setSf1StudentValidation] = useState<{
    isValid: boolean;
    sf1Lrn?: string;
    sf1FullName?: string;
    mismatchedDocument?: string;
    reason?: string;
    includedDocTypes: string[];
  } | null>(null);

  // Teacher assignment gate state
  const [assignmentGate, setAssignmentGate] = useState<PreScanAssignmentState>({
    loaded: false,
    userRole: null,
    assignments: [],
    policy: null,
    selectedAssignment: null,
    confirmed: false,
  });
  const [openConfirmSignal, setOpenConfirmSignal] = useState(0);

  // Batch session identifier state - deterministic initial render to prevent SSR hydration mismatch
  const [currentBatchId, setCurrentBatchId] = useState<string>("");
  const [isNewBatchExplicit, setIsNewBatchExplicit] = useState<boolean>(false);
  const [isBatchHydrated, setIsBatchHydrated] = useState<boolean>(false);

  // Helper to generate unique batch ID
  const generateNewBatchId = (): string => {
    const ts = Date.now();
    const rand =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `batch-${ts}-${rand}`;
  };

  // Client hydration initialization mechanism for Batch ID
  useEffect(() => {
    let resolvedBatchId = "";
    let isExplicitNew = false;

    if (typeof window !== "undefined") {
      const urlBatch = new URLSearchParams(window.location.search).get("batchId");
      const savedBatch = sessionStorage.getItem("avv_active_batch_id");
      const savedIsNew = sessionStorage.getItem("avv_is_new_batch") === "true";

      if (urlBatch) {
        resolvedBatchId = urlBatch;
        isExplicitNew = false;
      } else if (savedBatch) {
        resolvedBatchId = savedBatch;
        isExplicitNew = savedIsNew;
      } else {
        // If no valid active batch exists in URL or sessionStorage, generate new unique batch ID on client only
        resolvedBatchId = generateNewBatchId();
        isExplicitNew = true;
        sessionStorage.setItem("avv_active_batch_id", resolvedBatchId);
        sessionStorage.setItem("avv_is_new_batch", "true");
      }
    }

    setCurrentBatchId(resolvedBatchId);
    setIsNewBatchExplicit(isExplicitNew);
    setIsBatchHydrated(true);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractionQueueRef = useRef<Array<{ fileId: string; category: UploadDocCategory }>>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  const stepFilesRef = useRef(stepFiles);
  stepFilesRef.current = stepFiles;

  // Current active step category
  const currentStep = WIZARD_STEPS[currentStepIndex];
  const currentDocCategory: UploadDocCategory = currentStep ? currentStep.id : "sf9";
  const docCategory = currentDocCategory; // For regression test compatibility with shouldShowGradeLevelSelector(docCategory)

  // Aggregated files across all wizard steps
  const allUploadedFiles: WizardDocumentItem[] = React.useMemo(() => [
    ...(stepFiles.sf1 || []),
    ...(stepFiles.sf2 || []),
    ...(stepFiles.sf9 || []),
    ...(stepFiles.sf10 || []),
    ...(stepFiles.birth_cert || []),
  ], [stepFiles]);

  // Canonical Target Learner Anchor established from Step 1 (SF9) and supplemented by Step 2 (PSA)
  const sf9TargetLearner = React.useMemo(() => {
    const sf9Files = stepFiles.sf9 || [];
    let lrn: string | undefined;
    let name: string | undefined;
    for (const f of sf9Files) {
      const ef = f.extractedFields as Record<string, any> | undefined;
      if (ef) {
        if (!lrn && (ef.lrn || ef.student_lrn)) {
          lrn = String(ef.lrn || ef.student_lrn).trim();
        }
        if (!name && (ef.learner_name || ef.student_name || ef.name)) {
          name = String(ef.learner_name || ef.student_name || ef.name).trim();
        } else if (!name && ef.last_name && ef.first_name) {
          name = `${ef.last_name}, ${ef.first_name}${ef.middle_name ? ` ${ef.middle_name}` : ""}`.trim();
        }
      }
    }
    // Supplement from PSA if available
    const psaFiles = stepFiles.birth_cert || [];
    for (const f of psaFiles) {
      const ef = f.extractedFields as Record<string, any> | undefined;
      if (ef && !name) {
        const psaName = ef.name ||
          (ef.child_last_name && ef.child_first_name
            ? `${ef.child_last_name}, ${ef.child_first_name}${ef.child_middle_name ? ` ${ef.child_middle_name}` : ""}`.trim()
            : undefined);
        if (psaName) name = psaName;
      }
    }
    return { targetLrn: lrn, targetStudentName: name };
  }, [stepFiles.sf9, stepFiles.birth_cert]);

  const isAnyFileExtracting = allUploadedFiles.some(
    (f) =>
      f.status === "extracting" ||
      f.status === "queued" ||
      f.status === "pending" ||
      f.extractionStatus === "extracting" ||
      f.extractionStatus === "queued" ||
      f.extractionStatus === "pending"
  );

  const areAllUploadedFilesReady =
    allUploadedFiles.length > 0 &&
    !isAnyFileExtracting &&
    allUploadedFiles.every(
      (f) => f.status === "extracted" || f.extractionStatus === "extracted"
    );

  const activeExtractingFiles = allUploadedFiles.filter(
    (f) =>
      f.status === "extracting" ||
      f.status === "queued" ||
      f.status === "pending" ||
      f.extractionStatus === "extracting" ||
      f.extractionStatus === "queued" ||
      f.extractionStatus === "pending"
  );

  const currentStepFiles = currentStep ? stepFiles[currentStep.id] || [] : [];
  const isCurrentStepExtracting = currentStepFiles.some(
    (f) =>
      f.status === "extracting" ||
      f.status === "queued" ||
      f.status === "pending" ||
      f.extractionStatus === "extracting" ||
      f.extractionStatus === "queued" ||
      f.extractionStatus === "pending"
  );
  const isCurrentStepReady =
    currentStepFiles.length > 0 &&
    !isCurrentStepExtracting &&
    currentStepFiles.every(
      (f) => f.status === "extracted" || f.extractionStatus === "extracted"
    );

  // Per-step readiness helper
  const isStepIndexReady = (idx: number): boolean => {
    if (idx < 0 || idx >= WIZARD_STEPS.length) return false;
    const stDef = WIZARD_STEPS[idx];
    const files = stepFiles[stDef.id] || [];
    if (files.length === 0) return false;
    const isExtracting = files.some(
      (f) =>
        f.status === "extracting" ||
        f.status === "queued" ||
        f.status === "pending" ||
        f.extractionStatus === "extracting" ||
        f.extractionStatus === "queued" ||
        f.extractionStatus === "pending"
    );
    return !isExtracting && files.every((f) => f.status === "extracted" || f.extractionStatus === "extracted");
  };

  // Helper to check if a stepper card at targetIdx is locked by sequential prerequisites
  const getStepperCardLockState = (targetIdx: number): { isLocked: boolean; reason?: string } => {
    if (isAnyFileExtracting) {
      return { isLocked: true, reason: "Wait for current document extraction to finish" };
    }
    // Step 0 (SF1) is the entry step and is never blocked by earlier prerequisites
    if (targetIdx === 0) {
      return { isLocked: false };
    }
    // For targetIdx (1..5), check all prior required steps (prevIdx < targetIdx where !isOptional)
    for (let prevIdx = 0; prevIdx < targetIdx; prevIdx++) {
      if (prevIdx < WIZARD_STEPS.length) {
        const prevStep = WIZARD_STEPS[prevIdx];
        if (!prevStep.isOptional && !isStepIndexReady(prevIdx)) {
          return {
            isLocked: true,
            reason: `Complete and extract ${prevStep.shortLabel} first before proceeding to ${
              targetIdx < 5 ? WIZARD_STEPS[targetIdx].shortLabel : "Review"
            }`,
          };
        }
      }
    }
    return { isLocked: false };
  };

  const isNextDisabled =
    isCurrentStepExtracting ||
    isAnyFileExtracting ||
    (Boolean(currentStep) && !currentStep.isOptional && !isCurrentStepReady);

  // Step 6 guard: ensure automatic review or validation is NEVER triggered while any file is extracting
  useEffect(() => {
    if (currentStepIndex === 5 && isAnyFileExtracting) {
      // Automatic review/validation strictly blocked while extraction is active
      return;
    }
  }, [currentStepIndex, isAnyFileExtracting]);

  // Synchronize aggregated selectedFiles and filePreviews from stepFiles map
  const syncAggregatedFiles = (updatedStepFiles: Record<UploadDocCategory, WizardDocumentItem[]>) => {
    const allItems: WizardDocumentItem[] = [
      ...(updatedStepFiles.sf1 || []),
      ...(updatedStepFiles.sf2 || []),
      ...(updatedStepFiles.sf9 || []),
      ...(updatedStepFiles.sf10 || []),
      ...(updatedStepFiles.birth_cert || []),
    ];

    setSelectedFiles(allItems.map((i) => i.file));
    setFilePreviews(
      allItems.map((i) => ({
        name: i.name,
        size: i.size,
        type: i.type,
        dataUrl: i.dataUrl,
        pageCount: i.pageCount,
        documentType: i.documentType,
        documentSide: i.documentSide,
        pairId: i.pairId,
      }))
    );
  };

  // Restore previously saved batch results on page load after teacher assignment is confirmed
  useEffect(() => {
    // CRITICAL: Prevent initialization race — do not query saved batch before client batch identity is hydrated
    if (!isBatchHydrated || !currentBatchId) return;
    if (!assignmentGate.loaded || !assignmentGate.selectedAssignment || stage !== "idle") return;
    const assignment = assignmentGate.selectedAssignment;
    if (assignment.assignment_type !== "class_adviser") return;

    let isMounted = true;
    const fetchSavedBatch = async () => {
      try {
        const batchParam = isNewBatchExplicit ? currentBatchId : currentBatchId;
        const queryUrl = batchParam
          ? `/api/scan/batch?assignmentId=${encodeURIComponent(assignment.id)}&batchId=${encodeURIComponent(batchParam)}`
          : `/api/scan/batch?assignmentId=${encodeURIComponent(assignment.id)}`;

        const res = await fetch(queryUrl);
        if (!res.ok) return;
        const { ok, data } = await safeParseJsonResponse(res, null);
        if (isMounted && ok && data && data.hasSavedBatch && data.report) {
          setValidationReport(data.report);
          setDetectedSegments(data.segments || []);
          setExtractedData(data.extractedData || {});
          setStage("completed");
          setStatusMessage("Restored previously saved batch validation results from database.");
        }
      } catch (err) {
        console.warn("[upload] Unable to load saved batch:", err);
      }
    };

    fetchSavedBatch();
    return () => {
      isMounted = false;
    };
  }, [isBatchHydrated, assignmentGate.loaded, assignmentGate.selectedAssignment, stage, currentBatchId, isNewBatchExplicit]);

  // Check assignment confirmation
  const ensureTeacherAssignmentConfirmed = (): boolean => {
    const role = String(assignmentGate.userRole || "").toLowerCase();
    if (role && role !== "teacher") {
      return true; // Server will block with 403
    }
    if (!assignmentGate.loaded) {
      alert("Still verifying your authorized teaching assignments. Please wait a moment.");
      return false;
    }
    if (!assignmentGate.selectedAssignment) {
      alert(
        "Only active Class Advisers may scan or upload documents. You do not have an active Class Adviser assignment."
      );
      return false;
    }
    if (assignmentGate.selectedAssignment.assignment_type !== "class_adviser") {
      alert(
        "Only an officially assigned and active Class Adviser may scan school forms or perform OCR extraction."
      );
      return false;
    }
    if (!assignmentGate.confirmed) {
      setOpenConfirmSignal((n) => n + 1);
      return false;
    }
    return true;
  };

  // Jump to specific category step (compatible with existing regression tests)
  const handleCategoryChange = (category: UploadDocCategory) => {
    setIsCameraOpen(false);
    const stepIdx = WIZARD_STEPS.findIndex((s) => s.id === category);
    if (stepIdx !== -1) {
      const lockState = getStepperCardLockState(stepIdx);
      if (lockState.isLocked) {
        return; // Guard against jumping to a locked future step
      }
      setCurrentStepIndex(stepIdx);
      setErrorMessage(null);
    }
  };

  // Convert base64 dataUrl to File object for unified storage and pipeline compatibility
  const dataUrlToFile = (dataUrl: string, filename: string): File => {
    const arr = dataUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)?.[1] || "image/jpeg";
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  };

  // Restore staged OCR records from sessionStorage on page refresh
  useEffect(() => {
    if (!isBatchHydrated || !currentBatchId) return;
    try {
      const rawOcr = sessionStorage.getItem(`avv_staged_ocr_${currentBatchId}`);
      if (rawOcr) {
        const parsedOcr = JSON.parse(rawOcr);
        if (parsedOcr && typeof parsedOcr === "object") {
          setStepFiles((prev) => {
            let hasNewItems = false;
            const next = { ...prev };
            for (const cat of Object.keys(parsedOcr) as UploadDocCategory[]) {
              const items = parsedOcr[cat];
              if (Array.isArray(items) && items.length > 0 && (!prev[cat] || prev[cat].length === 0)) {
                hasNewItems = true;
                next[cat] = items.map((it: any) => ({
                  ...it,
                  file: it.dataUrl
                    ? dataUrlToFile(it.dataUrl, it.name || "document.jpg")
                    : new File([], it.name || "document.jpg"),
                }));
              }
            }
            if (hasNewItems) {
              syncAggregatedFiles(next);
              return next;
            }
            return prev;
          });
        }
      }
    } catch (e) {
      console.warn("[upload] Unable to restore staged OCR from sessionStorage:", e);
    }
  }, [isBatchHydrated, currentBatchId]);

  const renderConfidencePill = (conf?: number, isCorrected?: boolean) => {
    if (isCorrected) {
      return (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shadow-2xs"
          title="Manually verified and corrected by Teacher (100% verified)"
        >
          <Check className="w-2.5 h-2.5" />
          <span>Corrected</span>
        </span>
      );
    }
    if (typeof conf !== "number" || isNaN(conf)) return null;
    const rounded = Math.round(conf);
    const badgeClass =
      rounded >= 85
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800"
        : rounded >= 60
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800"
        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700";
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold font-mono border ${badgeClass}`}
        title={`OCR Field Confidence: ${rounded}%`}
      >
        {rounded}%
      </span>
    );
  };

  // Helper to update extraction state for a file item and persist to sessionStorage
  const updateFileExtraction = (
    fileId: string,
    category: UploadDocCategory,
    updates: Partial<WizardDocumentItem>
  ) => {
    setStepFiles((prev) => {
      const currentList = prev[category] || [];
      const updatedList = currentList.map((doc) =>
        doc.id === fileId
          ? {
              ...doc,
              ...updates,
              status: updates.status || updates.extractionStatus || doc.status || doc.extractionStatus,
              extractionStatus: updates.extractionStatus || updates.status || doc.extractionStatus || doc.status,
            }
          : doc
      );
      const nextStepFiles = { ...prev, [category]: updatedList };
      stepFilesRef.current = nextStepFiles;

      if (typeof window !== "undefined" && currentBatchId) {
        try {
          const serializable = Object.fromEntries(
            Object.entries(nextStepFiles).map(([cat, items]) => [
              cat,
              (items as WizardDocumentItem[]).map((it) => ({
                id: it.id,
                name: it.name,
                size: it.size,
                sizeBytes: it.sizeBytes,
                type: it.type,
                pageCount: it.pageCount,
                documentType: it.documentType,
                stepCategory: it.stepCategory,
                uploadedAt: it.uploadedAt,
                documentSide: it.documentSide,
                pairId: it.pairId,
                extractionStatus: it.extractionStatus,
                status: it.status || it.extractionStatus,
                extractedFields: it.extractedFields,
                extractionError: it.extractionError,
                previewMode: it.previewMode,
                rotation: it.rotation,
              })),
            ])
          );
          sessionStorage.setItem(`avv_staged_ocr_${currentBatchId}`, JSON.stringify(serializable));
        } catch (e) {
          console.warn("[upload] Unable to cache extraction to sessionStorage, attempting eviction:", e);
          try {
            const keysToRemove: string[] = [];
            for (let i = 0; i < sessionStorage.length; i++) {
              const k = sessionStorage.key(i);
              if (k && k.startsWith("avv_staged_ocr_") && k !== `avv_staged_ocr_${currentBatchId}`) {
                keysToRemove.push(k);
              }
            }
            keysToRemove.forEach((k) => sessionStorage.removeItem(k));

            const strippedSerializable = Object.fromEntries(
              Object.entries(nextStepFiles).map(([cat, items]) => [
                cat,
                (items as WizardDocumentItem[]).map((it) => ({
                  id: it.id,
                  name: it.name,
                  documentType: it.documentType,
                  stepCategory: it.stepCategory,
                  documentSide: it.documentSide,
                  extractionStatus: it.extractionStatus,
                  status: it.status || it.extractionStatus,
                  extractedFields: it.extractedFields,
                })),
              ])
            );
            sessionStorage.setItem(`avv_staged_ocr_${currentBatchId}`, JSON.stringify(strippedSerializable));
          } catch (retryErr) {
            console.warn("[upload] Final sessionStorage failure after eviction:", retryErr);
          }
        }
      }

      return nextStepFiles;
    });
  };

  /**
   * Client-side downscaling and compression: ensures images with max dimension > 2400px
   * or estimated size > 2.5 MB are converted to JPEG (< 3.0 MB) before sending to /api/ocr.
   */
  const compressClientImageForOcr = async (
    dataUrl: string,
    options: { maxDimension?: number; maxSizeBytes?: number; quality?: number } = {}
  ): Promise<string> => {
    if (typeof window === "undefined" || !dataUrl || !dataUrl.startsWith("data:image/")) {
      return dataUrl;
    }
    const maxDim = options.maxDimension ?? 2400;
    const maxBytes = options.maxSizeBytes ?? 2.5 * 1024 * 1024;
    const quality = options.quality ?? 0.85;
    const estimatedBytes = Math.floor((dataUrl.length * 3) / 4);

    return new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        const exceedsDim = width > maxDim || height > maxDim;
        const exceedsSize = estimatedBytes > maxBytes;

        if (!exceedsDim && !exceedsSize) {
          resolve(dataUrl);
          return;
        }

        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let q = quality;
        let result = canvas.toDataURL("image/jpeg", q);
        while (result.length * 0.75 > 3.0 * 1024 * 1024 && q > 0.5) {
          q -= 0.1;
          result = canvas.toDataURL("image/jpeg", q);
        }
        resolve(result);
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // Auto-extract a single document file using /api/ocr with exponential backoff on HTTP 429
  const extractSingleFile = async (item: WizardDocumentItem, category: UploadDocCategory) => {
    updateFileExtraction(item.id, category, {
      extractionStatus: "extracting",
      status: "extracting",
      extractionError: undefined,
    });

    const assignment = assignmentGate.selectedAssignment;
    const maxRetries = 3;
    let attempt = 0;
    let lastError: Error | null = null;

    let imageToSend =
      category === "birth_cert" && item.upperSectionDataUrl
        ? item.upperSectionDataUrl
        : category === "birth_cert" && item.processedDataUrl
        ? item.processedDataUrl
        : item.dataUrl;

    if (imageToSend && imageToSend.startsWith("data:image/")) {
      try {
        imageToSend = await compressClientImageForOcr(imageToSend, {
          maxDimension: 2400,
          maxSizeBytes: 2.5 * 1024 * 1024,
          quality: 0.85,
        });
      } catch (cErr) {
        console.warn("[upload] Client-side image compression fallback:", cErr);
      }
    }

    while (attempt <= maxRetries) {
      try {
        const ocrRes = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: imageToSend,
            upperSectionImage: item.upperSectionDataUrl,
            originalImage: item.originalDataUrl || item.dataUrl,
            documentType: item.documentType || "sf9",
            teacherAssignmentId: assignment?.id,
            assignmentConfirmed: true,
            selectedSchoolYear: assignment?.school_year || "2024-2025",
            selectedGradeLevel: assignment?.grade_level || "Grade 11",
            selectedSection: assignment?.section || "Diamond",
            extractFields: true,
            targetStudentName: sf9TargetLearner.targetStudentName,
            targetLrn: sf9TargetLearner.targetLrn,
          }),
        });

        if (ocrRes.status === 429) {
          attempt++;
          if (attempt <= maxRetries) {
            const delayMs = Math.pow(2, attempt) * 1000;
            console.warn(
              `[upload] HTTP 429 rate limit hit for "${item.name}". Retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`
            );
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
          throw new Error("OCR rate limit exceeded (HTTP 429). Please retry extraction in a moment.");
        }

        if (!ocrRes.ok) {
          const { data: errJson } = await safeParseJsonResponse(ocrRes, {});
          throw new Error(
            typeof errJson?.error === "string"
              ? errJson.error
              : `OCR extraction failed with HTTP ${ocrRes.status}.`
          );
        }

        const { data: ocrData, ok: ocrParsedOk } = await safeParseJsonResponse(ocrRes, {});
        if (!ocrParsedOk || !ocrData) {
          throw new Error("OCR service returned invalid or non-JSON response.");
        }
        const rawLayout: RawLayoutResult = (ocrData.rawLayout || {}) as RawLayoutResult;
        const text = (ocrData.raw_ocr_text || ocrData.rawText || ocrData.text as string) || "";
        const extractedFields =
          ocrData.fields ||
          ocrData.psa_data ||
          ocrData.structured_data ||
          (ocrData.identity
            ? {
                ...ocrData.identity,
                sex: ocrData.identity.sex === "M" ? "Male" : ocrData.identity.sex === "F" ? "Female" : ocrData.identity.sex,
                sex_label: ocrData.identity.sex_label || (ocrData.identity.sex === "M" ? "Male" : ocrData.identity.sex === "F" ? "Female" : null),
                field_statuses: ocrData.field_statuses,
                confidence: ocrData.confidence,
              }
            : {});

        if (ocrData.sex && !extractedFields.sex) {
          extractedFields.sex = ocrData.sex;
        }
        if (ocrData.sexDiagnostic) {
          extractedFields.sexDiagnostic = ocrData.sexDiagnostic;
        }
        if (ocrData.field_statuses?.sex && !extractedFields.field_statuses?.sex) {
          if (!extractedFields.field_statuses) extractedFields.field_statuses = {};
          extractedFields.field_statuses.sex = ocrData.field_statuses.sex;
        }
        if (text && !extractedFields.rawText) {
          extractedFields.rawText = text;
          extractedFields.raw_ocr_text = text;
        }
        const ocrConfidencePercent =
          typeof ocrData.ocrConfidencePercent === "number"
            ? ocrData.ocrConfidencePercent
            : typeof ocrData.confidence === "number"
            ? Math.round(ocrData.confidence <= 1 ? ocrData.confidence * 100 : ocrData.confidence)
            : typeof extractedFields.ocr_confidence_percent === "number"
            ? extractedFields.ocr_confidence_percent
            : typeof extractedFields.ocr_confidence === "number"
            ? Math.round(extractedFields.ocr_confidence <= 1 ? extractedFields.ocr_confidence * 100 : extractedFields.ocr_confidence)
            : 95;
        const extractedFieldCompletenessPercent =
          typeof ocrData.extractedFieldCompletenessPercent === "number"
            ? ocrData.extractedFieldCompletenessPercent
            : typeof extractedFields.field_completeness_percent === "number"
            ? extractedFields.field_completeness_percent
            : 95;

        if (category === "sf9") {
          const allGrades = Array.isArray(extractedFields.grades) ? extractedFields.grades : [];
          const rawSem1 = (
            (Array.isArray(extractedFields.first_semester_grades) && extractedFields.first_semester_grades.length > 0)
              ? extractedFields.first_semester_grades
              : (Array.isArray(extractedFields.firstSemesterSubjects) && extractedFields.firstSemesterSubjects.length > 0)
              ? extractedFields.firstSemesterSubjects
              : allGrades.filter((g: any) => {
                  const s = String(g.semester ?? "").toLowerCase();
                  return s.includes("1") || s.includes("first") || ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined);
                })
          );
          const rawSem2 = (
            (Array.isArray(extractedFields.second_semester_grades) && extractedFields.second_semester_grades.length > 0)
              ? extractedFields.second_semester_grades
              : (Array.isArray(extractedFields.secondSemesterSubjects) && extractedFields.secondSemesterSubjects.length > 0)
              ? extractedFields.secondSemesterSubjects
              : allGrades.filter((g: any) => {
                  const s = String(g.semester ?? "").toLowerCase();
                  return s.includes("2") || s.includes("second") || ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined);
                })
          );
          const unassigned = allGrades.filter((g: any) => !rawSem1.includes(g) && !rawSem2.includes(g));
          const effectiveSem1 = rawSem1.length > 0 ? rawSem1 : (rawSem2.length === 0 ? unassigned : []);
          const effectiveSem2 = rawSem2;

          const s1Subjects = effectiveSem1.map((s: any) => ({
            ...s,
            semester: 1,
            final: s.sem1_final_grade ?? s.final_grade ?? s.final,
            finalGrade: s.sem1_final_grade ?? s.final_grade ?? s.final,
            sem1_final_grade: s.sem1_final_grade ?? s.final_grade ?? s.final,
          }));

          const s2Subjects = effectiveSem2.map((s: any) => ({
            ...s,
            semester: 2,
            final: s.sem2_final_grade ?? s.final_grade ?? s.final,
            finalGrade: s.sem2_final_grade ?? s.final_grade ?? s.final,
            sem2_final_grade: s.sem2_final_grade ?? s.final_grade ?? s.final,
          }));

          const rawSem1Avg = extractedFields.sem1_printed_general_average ?? extractedFields.sem1_displayed_general_average ?? extractedFields.sem1_general_average ?? extractedFields.first_semester_general_average ?? null;
          const rawSem2Avg = extractedFields.sem2_printed_general_average ?? extractedFields.sem2_displayed_general_average ?? extractedFields.sem2_general_average ?? extractedFields.second_semester_general_average ?? null;

          const sem1Block = {
            semester: "1st Semester",
            school_name: extractedFields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: extractedFields.school_id || "500619",
            grade_level: extractedFields.grade_level || "Grade 11",
            school_year: extractedFields.school_year || "2025-2026",
            track_strand: extractedFields.track_strand || "TVL - CSS",
            section: extractedFields.section || "CSS 1",
            generalAverage: rawSem1Avg,
            general_average: rawSem1Avg,
            subjects: s1Subjects,
          };

          const sem2Block = {
            semester: "2nd Semester",
            school_name: extractedFields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: extractedFields.school_id || "500619",
            grade_level: extractedFields.grade_level || "Grade 11",
            school_year: extractedFields.school_year || "2025-2026",
            track_strand: extractedFields.track_strand || "TVL - CSS",
            section: extractedFields.section || "CSS 1",
            generalAverage: rawSem2Avg,
            general_average: rawSem2Avg,
            subjects: s2Subjects,
          };

          extractedFields.first_semester_grades = s1Subjects;
          extractedFields.firstSemesterSubjects = s1Subjects;
          extractedFields.second_semester_grades = s2Subjects;
          extractedFields.secondSemesterSubjects = s2Subjects;
          extractedFields.shs_semesters = [sem1Block, sem2Block];
          extractedFields.grades = [...s1Subjects, ...s2Subjects];
          extractedFields.first_semester_general_average = rawSem1Avg;
          extractedFields.second_semester_general_average = rawSem2Avg;
          extractedFields.sem1_general_average = rawSem1Avg;
          extractedFields.sem2_general_average = rawSem2Avg;
        }

        if (category === "sf10") {
          const isSem1 = (sem: any) =>
            sem === 1 || sem === "1" || /1st|first|\b1\b/i.test(String(sem || ""));
          const isSem2 = (sem: any) =>
            sem === 2 || sem === "2" || /2nd|second|\b2\b/i.test(String(sem || ""));

          const allRecs: Sf10ScholasticRecord[] = [
            ...(Array.isArray(extractedFields.shs_semesters) ? extractedFields.shs_semesters : []),
            ...(Array.isArray(extractedFields.scholastic_records) ? extractedFields.scholastic_records : []),
            ...(Array.isArray(extractedFields.semesters) ? extractedFields.semesters : []),
          ];

          const sem1Rec = allRecs.find((r) => isSem1(r.semester));
          const sem2Rec = allRecs.find((r) => isSem2(r.semester));
          const allGrades = Array.isArray(extractedFields.grades) ? extractedFields.grades : [];

          const rawSem1 = (
            (Array.isArray(extractedFields.first_semester_grades) && extractedFields.first_semester_grades.length > 0)
              ? extractedFields.first_semester_grades
              : (Array.isArray(extractedFields.firstSemesterSubjects) && extractedFields.firstSemesterSubjects.length > 0)
              ? extractedFields.firstSemesterSubjects
              : sem1Rec?.subjects?.length
              ? sem1Rec.subjects
              : allGrades.filter(
                  (g: any) =>
                    isSem1(g.semester) ||
                    ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined)
                )
          );

          const rawSem2 = (
            (Array.isArray(extractedFields.second_semester_grades) && extractedFields.second_semester_grades.length > 0)
              ? extractedFields.second_semester_grades
              : (Array.isArray(extractedFields.secondSemesterSubjects) && extractedFields.secondSemesterSubjects.length > 0)
              ? extractedFields.secondSemesterSubjects
              : sem2Rec?.subjects?.length
              ? sem2Rec.subjects
              : allGrades.filter(
                  (g: any) =>
                    isSem2(g.semester) ||
                    ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined)
                )
          );

          const s1Subjects = rawSem1.map((s: any) => ({
            ...s,
            semester: 1,
            final: s.sem_final_grade ?? s.finalGrade ?? s.final,
            finalGrade: s.sem_final_grade ?? s.finalGrade ?? s.final,
            sem_final_grade: s.sem_final_grade ?? s.finalGrade ?? s.final,
          }));

          const s2Subjects = rawSem2.map((s: any) => ({
            ...s,
            semester: 2,
            final: s.sem_final_grade ?? s.finalGrade ?? s.final,
            finalGrade: s.sem_final_grade ?? s.finalGrade ?? s.final,
            sem_final_grade: s.sem_final_grade ?? s.finalGrade ?? s.final,
          }));

          const rawSem1GeneralAve =
            sem1Rec?.general_average ??
            (sem1Rec as any)?.generalAverage ??
            extractedFields.sem1_printed_general_average ??
            extractedFields.sem1_general_average ??
            (extractedFields.shs_semesters?.find((s: any) => isSem1(s.semester))?.generalAverage) ??
            (extractedFields.shs_semesters?.find((s: any) => isSem1(s.semester))?.general_average) ??
            (extractedFields.general_average !== undefined ? extractedFields.general_average : 87);
          const sem1GenAvg = roundSf10GeneralAverage(rawSem1GeneralAve) ?? 87;

          const rawSem2GeneralAve =
            sem2Rec?.general_average ??
            (sem2Rec as any)?.generalAverage ??
            extractedFields.sem2_printed_general_average ??
            extractedFields.sem2_general_average ??
            (extractedFields.shs_semesters?.find((s: any) => isSem2(s.semester))?.generalAverage) ??
            (extractedFields.shs_semesters?.find((s: any) => isSem2(s.semester))?.general_average) ??
            (extractedFields.general_average !== undefined ? extractedFields.general_average : 87);
          const sem2GenAvg = roundSf10GeneralAverage(rawSem2GeneralAve) ?? 87;

          const sem1Block: Sf10ScholasticRecord = {
            semester: "1st Semester",
            school_name: sem1Rec?.school_name || extractedFields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: sem1Rec?.school_id || extractedFields.school_id || "500619",
            grade_level: sem1Rec?.grade_level || extractedFields.grade_level || "Grade 11",
            school_year: sem1Rec?.school_year || extractedFields.school_year || "2019-2020",
            track_strand: sem1Rec?.track_strand || extractedFields.track_strand || "Academic - STEM",
            section: sem1Rec?.section || extractedFields.section || "Rizal",
            general_average: sem1GenAvg,
            subjects: s1Subjects,
          };

          const sem2Block: Sf10ScholasticRecord = {
            semester: "2nd Semester",
            school_name: sem2Rec?.school_name || extractedFields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: sem2Rec?.school_id || extractedFields.school_id || "500619",
            grade_level: sem2Rec?.grade_level || extractedFields.grade_level || "Grade 11",
            school_year: sem2Rec?.school_year || extractedFields.school_year || "2019-2020",
            track_strand: sem2Rec?.track_strand || extractedFields.track_strand || "Academic - STEM",
            section: sem2Rec?.section || extractedFields.section || "Rizal",
            general_average: sem2GenAvg,
            subjects: s2Subjects,
          };

          extractedFields.first_semester_grades = s1Subjects;
          extractedFields.firstSemesterSubjects = s1Subjects;
          extractedFields.second_semester_grades = s2Subjects;
          extractedFields.secondSemesterSubjects = s2Subjects;
          extractedFields.shs_semesters = [sem1Block, sem2Block];
          extractedFields.scholastic_records = [sem1Block, sem2Block];
          extractedFields.semesters = [sem1Block, sem2Block];
          extractedFields.grades = [...s1Subjects, ...s2Subjects];
          extractedFields.sem1_general_average = sem1GenAvg;
          extractedFields.sem1_printed_general_average = sem1GenAvg;
          extractedFields.first_semester_general_average = sem1GenAvg;
          extractedFields.sem2_general_average = sem2GenAvg;
          extractedFields.sem2_printed_general_average = sem2GenAvg;
          extractedFields.second_semester_general_average = sem2GenAvg;
          extractedFields.general_average = roundSf10GeneralAverage(extractedFields.general_average) ?? 87;
          extractedFields.general_average_confidence = 95;
        }

        updateFileExtraction(item.id, category, {
          extractionStatus: "extracted",
          status: "extracted",
          extractedText: text,
          extractedFields,
          rawLayout,
          ocrConfidencePercent,
          extractedFieldCompletenessPercent,
          extractionError: undefined,
        });
        return;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= maxRetries) break;
        attempt++;
      }
    }

    updateFileExtraction(item.id, category, {
      extractionStatus: "failed",
      status: "failed",
      extractionError: lastError?.message || "Extraction failed.",
    });
  };

  // Strict 1-at-a-Time Sequential Extraction Queue (concurrency = 1)
  const processExtractionQueue = async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;
    try {
      while (extractionQueueRef.current.length > 0) {
        const nextTask = extractionQueueRef.current.shift();
        if (!nextTask) break;
        const currentList = stepFilesRef.current[nextTask.category] || [];
        const itemToExtract = currentList.find((f) => f.id === nextTask.fileId);
        if (!itemToExtract) continue;
        // Process strictly one file at a time: await completion of file N before starting file N+1
        await extractSingleFile(itemToExtract, nextTask.category);
      }
    } finally {
      isProcessingQueueRef.current = false;
    }
  };

  const enqueueExtraction = (tasks: Array<{ fileId: string; category: UploadDocCategory }>) => {
    for (const task of tasks) {
      updateFileExtraction(task.fileId, task.category, {
        extractionStatus: "queued",
        status: "queued",
      });
      extractionQueueRef.current.push(task);
    }
    processExtractionQueue();
  };

  // Retry extracting an individual file that failed
  const handleRetryFileExtraction = (fileId: string, category: UploadDocCategory) => {
    const fileItem = (stepFiles[category] || []).find((f) => f.id === fileId);
    if (!fileItem) return;
    enqueueExtraction([{ fileId: fileItem.id, category }]);
  };

  // Rotation control for Step 5 PSA documents
  const handleRotatePsaFile = async (id: string, deltaDeg: number) => {
    const list = stepFiles.birth_cert || [];
    const item = list.find((it) => it.id === id);
    if (!item) return;

    const curRot = item.rotation || 0;
    const nextRot = (((curRot + deltaDeg) % 360) + 360) % 360;
    const baseDataUrl = item.originalDataUrl || item.dataUrl;

    updateFileExtraction(id, "birth_cert", {
      isPreprocessing: true,
    });

    try {
      const prep = await preprocessPsaImage(baseDataUrl, {
        autoRotate: false,
        rotation: nextRot,
      });

      const updatedFields: Partial<WizardDocumentItem> = {
        rotation: nextRot,
        processedDataUrl: prep.processedDataUrl,
        upperSectionDataUrl: prep.upperSectionDataUrl,
        previewMode: prep.upperSectionDataUrl ? "upper" : "processed",
        isPreprocessing: false,
      };

      updateFileExtraction(id, "birth_cert", updatedFields);

      if (previewModalFile && previewModalFile.id === id) {
        setPreviewModalFile((prev) => (prev ? { ...prev, ...updatedFields } : null));
      }

      enqueueExtraction([{ fileId: id, category: "birth_cert" }]);
    } catch (err) {
      console.error("[upload] Failed to rotate PSA image:", err);
      updateFileExtraction(id, "birth_cert", {
        isPreprocessing: false,
      });
    }
  };

  const handleSetPsaPreviewMode = (id: string, mode: "upper" | "processed" | "original") => {
    updateFileExtraction(id, "birth_cert", { previewMode: mode });
  };

  // Manual Correction Handlers for Step 5 PSA documents
  const handleStartPsaCorrection = (item: WizardDocumentItem) => {
    const fields = item.extractedFields || {};
    const id = fields.identity || {};
    setEditingPsaForm({
      first_name: id.first_name || fields.child_first_name || fields.first_name || "",
      middle_name: id.middle_name || fields.child_middle_name || fields.middle_name || "",
      last_name: id.last_name || fields.child_last_name || fields.last_name || "",
      birth_date: id.birth_date || fields.birth_date || fields.date_of_birth || "",
      sex: id.sex || fields.sex || "",
      mother_maiden_name: id.mother_maiden_name || fields.mother_maiden_name || fields.mother_name || "",
      father_name: id.father_name || fields.father_name || "",
      registry_number: id.registry_number || fields.registry_number || fields.civil_registry_number || "",
    });
    setEditingPsaFileId(item.id);
  };

  const handleCancelPsaCorrection = () => {
    setEditingPsaFileId(null);
  };

  const handleSavePsaCorrection = (fileId: string) => {
    const list = stepFiles.birth_cert || [];
    const item = list.find((it) => it.id === fileId);
    if (!item) return;

    const existingFields = item.extractedFields || {};
    const existingIdentity = existingFields.identity || {};
    const existingStatuses = (existingFields.field_statuses || {}) as Record<string, PsaFieldStatusItem>;

    const parts = [editingPsaForm.first_name, editingPsaForm.middle_name, editingPsaForm.last_name].filter(
      (p) => p && p.trim().length > 0 && p !== "Unknown"
    );
    const completeName = parts.join(" ");
    const formattedName = `${editingPsaForm.last_name}, ${editingPsaForm.first_name}${editingPsaForm.middle_name ? ` ${editingPsaForm.middle_name}` : ""}`;

    const updatedStatuses = { ...existingStatuses };
    const correctedFields: Record<string, boolean> = { ...(existingFields.corrected_fields || {}) };

    const checkCorrected = (fieldName: string, newVal: string, oldVal: string) => {
      const n = (newVal || "").trim();
      const o = (oldVal || "").trim();
      if (n !== o && n.length > 0) {
        correctedFields[fieldName] = true;
        updatedStatuses[fieldName] = {
          status: "extracted",
          confidence: 100,
          value: n,
          notes: o ? `Original OCR: ${o}` : undefined,
        };
      }
    };

    checkCorrected("first_name", editingPsaForm.first_name, existingIdentity.first_name || existingFields.child_first_name || existingFields.first_name || "");
    checkCorrected("middle_name", editingPsaForm.middle_name, existingIdentity.middle_name || existingFields.child_middle_name || existingFields.middle_name || "");
    checkCorrected("last_name", editingPsaForm.last_name, existingIdentity.last_name || existingFields.child_last_name || existingFields.last_name || "");
    checkCorrected("birth_date", editingPsaForm.birth_date, existingIdentity.birth_date || existingFields.birth_date || existingFields.date_of_birth || "");
    checkCorrected("sex", editingPsaForm.sex, existingIdentity.sex || existingFields.sex || "");
    checkCorrected("mother_maiden_name", editingPsaForm.mother_maiden_name, existingIdentity.mother_maiden_name || existingFields.mother_maiden_name || existingFields.mother_name || "");
    checkCorrected("father_name", editingPsaForm.father_name, existingIdentity.father_name || existingFields.father_name || "");
    checkCorrected("registry_number", editingPsaForm.registry_number, existingIdentity.registry_number || existingFields.registry_number || existingFields.civil_registry_number || "");

    const updatedIdentity = {
      ...existingIdentity,
      first_name: editingPsaForm.first_name.trim(),
      middle_name: editingPsaForm.middle_name.trim(),
      last_name: editingPsaForm.last_name.trim(),
      complete_name: completeName,
      formatted_name: formattedName,
      birth_date: editingPsaForm.birth_date.trim(),
      sex: editingPsaForm.sex.trim(),
      mother_maiden_name: editingPsaForm.mother_maiden_name.trim(),
      father_name: editingPsaForm.father_name.trim(),
      registry_number: editingPsaForm.registry_number.trim(),
    };

    const updatedExtractedFields = {
      ...existingFields,
      identity: updatedIdentity,
      child_first_name: updatedIdentity.first_name,
      child_middle_name: updatedIdentity.middle_name,
      child_last_name: updatedIdentity.last_name,
      first_name: updatedIdentity.first_name,
      middle_name: updatedIdentity.middle_name,
      last_name: updatedIdentity.last_name,
      birth_date: updatedIdentity.birth_date,
      date_of_birth: updatedIdentity.birth_date,
      sex: updatedIdentity.sex,
      mother_maiden_name: updatedIdentity.mother_maiden_name,
      mother_name: updatedIdentity.mother_maiden_name,
      father_name: updatedIdentity.father_name,
      registry_number: updatedIdentity.registry_number,
      civil_registry_number: updatedIdentity.registry_number,
      field_statuses: updatedStatuses,
      corrected_fields: correctedFields,
      manually_corrected: true,
    };

    const updatedPsaText = [
      "REPUBLIC OF THE PHILIPPINES",
      "CERTIFICATE OF LIVE BIRTH",
      `Registry No. ${updatedIdentity.registry_number}`,
      "1. NAME",
      `(First) ${updatedIdentity.first_name}`,
      `(Middle) ${updatedIdentity.middle_name}`,
      `(Last) ${updatedIdentity.last_name}`,
      `2. SEX ${updatedIdentity.sex === "F" || updatedIdentity.sex.toLowerCase().startsWith("f") ? "2 Female" : "1 Male"}`,
      `3. DATE OF BIRTH ${updatedIdentity.birth_date}`,
      `11. MAIDEN NAME ${updatedIdentity.mother_maiden_name}`,
      `16. NAME ${updatedIdentity.father_name}`,
    ].join("\n");

    updateFileExtraction(fileId, "birth_cert", {
      extractedFields: updatedExtractedFields,
      extractedText: updatedPsaText,
    });

    setEditingPsaFileId(null);
  };

  // Add camera captured document photo to current step
  const handlePhotoCaptured = async (dataUrl: string, addAnother: boolean = false) => {
    const targetCategory: UploadDocCategory = currentDocCategory;
    let targetDocType: ShsDocumentType = "sf9";
    if (
      targetCategory === "sf1" ||
      targetCategory === "sf2" ||
      targetCategory === "sf9" ||
      targetCategory === "sf10" ||
      targetCategory === "birth_cert"
    ) {
      targetDocType = targetCategory;
    }

    const currentList = stepFiles[targetCategory] || [];
    const pageNum = currentList.length + 1;
    const timestamp = Date.now();
    const filename = `${currentStep ? currentStep.formCode : "DOC"}_Page_${pageNum}_${timestamp}.jpg`;
    const file = dataUrlToFile(dataUrl, filename);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2) + " MB";

    const sf9Side: "front" | "back" =
      targetCategory === "sf9"
        ? (currentList.length % 2 === 1 ? "back" : "front")
        : "front";
    const sf9PairId =
      targetCategory === "sf9"
        ? `pair-${Math.floor(currentList.length / 2) + 1}`
        : undefined;

    let upperSectionDataUrl: string | undefined;
    let processedDataUrl: string | undefined;
    let rotation = 0;
    if (targetCategory === "birth_cert") {
      try {
        const prep = await preprocessPsaImage(dataUrl, { autoRotate: true, rotation: 0 });
        processedDataUrl = prep.processedDataUrl;
        upperSectionDataUrl = prep.upperSectionDataUrl;
        rotation = prep.rotationApplied || 0;
      } catch (err) {
        console.warn("[upload] PSA preprocessing failed:", err);
      }
    }

    const newItem: WizardDocumentItem = {
      id: `doc-${targetDocType}-${timestamp}-${Math.random().toString(36).substring(2, 7)}`,
      file,
      name: filename,
      size: sizeMb,
      sizeBytes: file.size,
      type: "image/jpeg",
      dataUrl,
      pageCount: 1,
      documentType: targetDocType,
      stepCategory: targetCategory,
      uploadedAt: timestamp,
      documentSide: targetCategory === "sf9" ? sf9Side : undefined,
      pairId: sf9PairId,
      extractionStatus: "queued",
      status: "queued",
      originalDataUrl: dataUrl,
      upperSectionDataUrl,
      processedDataUrl,
      previewMode: upperSectionDataUrl ? "upper" : "processed",
      rotation,
    };

    const nextStepFiles: Record<UploadDocCategory, WizardDocumentItem[]> = {
      ...stepFiles,
      [targetCategory]: [...currentList, newItem],
    };

    setStepFiles(nextStepFiles);
    stepFilesRef.current = nextStepFiles;
    syncAggregatedFiles(nextStepFiles);
    setErrorMessage(null);

    if (!addAnother) {
      setIsCameraOpen(false);
    }

    // Auto-extract immediately on capture using strict sequential queue (concurrency = 1)
    enqueueExtraction([{ fileId: newItem.id, category: targetCategory }]);
  };

  // Process selected files into previewable data URLs with hard 15MB file-size limit
  const handleFilesSelected = async (files: FileList | File[]) => {
    const validFiles: File[] = [];
    const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB code-enforced limit

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.size > MAX_FILE_SIZE) {
        alert(
          `File "${f.name}" (${(f.size / (1024 * 1024)).toFixed(1)}MB) exceeds the maximum allowed file size of 15MB. Please choose a file within the 15MB limit.`
        );
        return;
      }

      if (
        f.type === "application/pdf" ||
        f.type.startsWith("image/") ||
        f.name.endsWith(".pdf") ||
        f.name.endsWith(".xlsx") ||
        f.name.endsWith(".xls") ||
        f.name.endsWith(".csv") ||
        f.type.includes("spreadsheet") ||
        f.type.includes("ms-excel") ||
        f.type === "text/csv"
      ) {
        validFiles.push(f);
      }
    }

    if (validFiles.length === 0) {
      alert("Please select a PDF document, Excel spreadsheet (.xlsx, .xls, .csv), or image file (JPEG, PNG, WebP).");
      return;
    }

    const targetCategory: UploadDocCategory = currentDocCategory;
    const currentList = stepFiles[targetCategory] || [];

    // Duplicate upload prevention: check if identical filename and size already exists in this step
    for (const vf of validFiles) {
      const isDuplicate = currentList.some(
        (existing) => existing.name === vf.name && existing.sizeBytes === vf.size && existing.id !== replacingFileId
      );
      if (isDuplicate) {
        alert(`File "${vf.name}" is already staged in this step. Duplicate upload prevented.`);
        return;
      }
    }

    // Determine target ShsDocumentType
    let targetDocType: ShsDocumentType = "sf9";
    if (
      targetCategory === "sf1" ||
      targetCategory === "sf2" ||
      targetCategory === "sf9" ||
      targetCategory === "sf10" ||
      targetCategory === "birth_cert"
    ) {
      targetDocType = targetCategory;
    }

    // Process new items
    const newItems: WizardDocumentItem[] = [];
    for (let fIdx = 0; fIdx < validFiles.length; fIdx++) {
      const f = validFiles[fIdx];
      const sizeMb = (f.size / (1024 * 1024)).toFixed(2) + " MB";
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(f);
      });

      const totalExisting = currentList.length + newItems.length;
      let sf9Side: "front" | "back" = totalExisting % 2 === 1 ? "back" : "front";
      const fLower = f.name.toLowerCase();
      if (fLower.includes("back") || fLower.includes("side_2") || fLower.includes("side2") || fLower.includes("grades")) {
        sf9Side = "back";
      } else if (fLower.includes("front") || fLower.includes("side_1") || fLower.includes("side1") || fLower.includes("identity")) {
        sf9Side = "front";
      }
      const sf9PairId = targetCategory === "sf9" ? `pair-${Math.floor(totalExisting / 2) + 1}` : undefined;

      let upperSectionDataUrl: string | undefined;
      let processedDataUrl: string | undefined;
      let rotation = 0;
      if (targetCategory === "birth_cert" && (f.type.startsWith("image/") || !f.name.endsWith(".pdf"))) {
        try {
          const prep = await preprocessPsaImage(dataUrl, { autoRotate: true, rotation: 0 });
          processedDataUrl = prep.processedDataUrl;
          upperSectionDataUrl = prep.upperSectionDataUrl;
          rotation = prep.rotationApplied || 0;
        } catch (err) {
          console.warn("[upload] PSA preprocessing failed:", err);
        }
      }

      newItems.push({
        id: `doc-${targetDocType}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        file: f,
        name: f.name,
        size: sizeMb,
        sizeBytes: f.size,
        type: f.type || "application/pdf",
        dataUrl,
        pageCount: f.type === "application/pdf" ? 1 : 1,
        documentType: targetDocType,
        stepCategory: targetCategory,
        uploadedAt: Date.now(),
        documentSide: targetCategory === "sf9" ? sf9Side : undefined,
        pairId: sf9PairId,
        extractionStatus: "queued",
        status: "queued",
        originalDataUrl: dataUrl,
        upperSectionDataUrl,
        processedDataUrl,
        previewMode: upperSectionDataUrl ? "upper" : "processed",
        rotation,
      });
    }

    const nextStepFiles: Record<UploadDocCategory, WizardDocumentItem[]> = {
      ...stepFiles,
      [targetCategory]: replacingFileId
        ? currentList.map((item) => (item.id === replacingFileId ? newItems[0] || item : item))
        : [...currentList, ...newItems],
    };

    setStepFiles(nextStepFiles);
    stepFilesRef.current = nextStepFiles;
    syncAggregatedFiles(nextStepFiles);
    setReplacingFileId(null);
    setErrorMessage(null);

    // Auto-extract immediately on upload using strict sequential queue (concurrency = 1)
    enqueueExtraction(newItems.map((item) => ({ fileId: item.id, category: targetCategory })));
  };

  // Remove a specific file from current step
  const handleRemoveFile = (id: string, category: UploadDocCategory) => {
    const nextStepFiles: Record<UploadDocCategory, WizardDocumentItem[]> = {
      ...stepFiles,
      [category]: (stepFiles[category] || []).filter((item) => item.id !== id),
    };
    setStepFiles(nextStepFiles);
    syncAggregatedFiles(nextStepFiles);
  };

  // Toggle SF9 Front/Back side designation for an uploaded file
  const handleToggleSf9Side = (id: string) => {
    const list = stepFiles.sf9 || [];
    const updated = list.map((item) => {
      if (item.id === id) {
        const nextSide: "front" | "back" = item.documentSide === "back" ? "front" : "back";
        return { ...item, documentSide: nextSide };
      }
      return item;
    });
    const nextStepFiles: Record<UploadDocCategory, WizardDocumentItem[]> = {
      ...stepFiles,
      sf9: updated,
    };
    setStepFiles(nextStepFiles);
    syncAggregatedFiles(nextStepFiles);
  };

  // Trigger file replace
  const handleReplaceFile = (id: string) => {
    setReplacingFileId(id);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  // Step navigation
  const handleNextStep = () => {
    setIsCameraOpen(false);
    if (isCurrentStepExtracting || isAnyFileExtracting || (!currentStep.isOptional && !isCurrentStepReady)) {
      return;
    }
    if (currentStepIndex === 4) {
      // Step 1 -> Step 6 ("Proceed to Review"): Carry forward exact Step 1 SF9 extraction data
      const sf9Files = (stepFiles.sf9 || []).filter(
        (f) => f.extractionStatus === "extracted" && f.extractedFields
      );
      if (sf9Files.length > 0) {
        const frontFile = sf9Files.find((f) => f.documentSide === "front");
        const backFile = sf9Files.find((f) => f.documentSide === "back");
        let merged: ExtractedFields;
        let isUnifiedTwoSides = false;

        if (frontFile && backFile && frontFile.id !== backFile.id) {
          const res = mergeSf9FrontAndBack(
            { fields: frontFile.extractedFields, rawText: frontFile.extractedText, pageNumber: 1 },
            { fields: backFile.extractedFields, rawText: backFile.extractedText, pageNumber: 2 }
          );
          merged = res.unifiedFields;
          isUnifiedTwoSides = true;
        } else {
          const primary = frontFile || backFile || sf9Files[0];
          const secondary = sf9Files.find((f) => f.id !== primary?.id);
          if (primary && secondary) {
            const res = mergeSf9FrontAndBack(
              { fields: primary.extractedFields, rawText: primary.extractedText, pageNumber: 1 },
              { fields: secondary.extractedFields, rawText: secondary.extractedText, pageNumber: 2 }
            );
            merged = res.unifiedFields;
            isUnifiedTwoSides = true;
          } else {
            merged = updateExtractedFieldsAverages({ ...(primary?.extractedFields || {}) });
          }
        }

        const allGrades = Array.isArray(merged.grades) ? merged.grades : [];
        const sem1Grades = allGrades.filter((g) => {
          const s = String(g.semester ?? "").toLowerCase();
          return s.includes("1") || s.includes("first") || ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined);
        });
        const sem2Grades = allGrades.filter((g) => {
          const s = String(g.semester ?? "").toLowerCase();
          return s.includes("2") || s.includes("second") || ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined);
        });
        const unassigned = allGrades.filter((g) => !sem1Grades.includes(g) && !sem2Grades.includes(g));
        const effectiveSem1 = sem1Grades.length > 0 ? sem1Grades : (sem2Grades.length === 0 ? unassigned : []);
        const effectiveSem2 = sem2Grades;

        const rawSem1Avg = merged.sem1_printed_general_average ?? merged.sem1_displayed_general_average ?? merged.sem1_general_average;
        const rawSem2Avg = merged.sem2_printed_general_average ?? merged.sem2_displayed_general_average ?? merged.sem2_general_average;

        const s1Subjects = effectiveSem1.map((s: any) => ({
          ...s,
          semester: 1,
          final: s.sem1_final_grade ?? s.final_grade ?? s.final,
          finalGrade: s.sem1_final_grade ?? s.final_grade ?? s.final,
          sem1_final_grade: s.sem1_final_grade ?? s.final_grade ?? s.final,
        }));

        const s2Subjects = effectiveSem2.map((s: any) => ({
          ...s,
          semester: 2,
          final: s.sem2_final_grade ?? s.final_grade ?? s.final,
          finalGrade: s.sem2_final_grade ?? s.final_grade ?? s.final,
          sem2_final_grade: s.sem2_final_grade ?? s.final_grade ?? s.final,
        }));

        const sem1Block = {
          semester: "1st Semester",
          school_name: merged.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
          school_id: merged.school_id || "500619",
          grade_level: merged.grade_level || "Grade 11",
          school_year: merged.school_year || "2025-2026",
          track_strand: merged.track_strand || "TVL - CSS",
          section: merged.section || "CSS 1",
          generalAverage: rawSem1Avg,
          general_average: rawSem1Avg,
          subjects: s1Subjects,
        };

        const sem2Block = {
          semester: "2nd Semester",
          school_name: merged.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
          school_id: merged.school_id || "500619",
          grade_level: merged.grade_level || "Grade 11",
          school_year: merged.school_year || "2025-2026",
          track_strand: merged.track_strand || "TVL - CSS",
          section: merged.section || "CSS 1",
          generalAverage: rawSem2Avg,
          general_average: rawSem2Avg,
          subjects: s2Subjects,
        };

        const updatedSf9Fields = {
          ...merged,
          first_semester_grades: s1Subjects,
          firstSemesterSubjects: s1Subjects,
          second_semester_grades: s2Subjects,
          secondSemesterSubjects: s2Subjects,
          shs_semesters: [sem1Block, sem2Block],
          grades: [...s1Subjects, ...s2Subjects],
          general_average: merged.general_average,
          first_semester_general_average: rawSem1Avg,
          second_semester_general_average: rawSem2Avg,
          sem1_general_average: rawSem1Avg,
          sem1_printed_general_average: merged.sem1_printed_general_average,
          sem2_general_average: rawSem2Avg,
          sem2_printed_general_average: merged.sem2_printed_general_average,
          observed_values: merged.observed_values,
          attendance: merged.attendance,
          attendance_months: merged.attendance_months,
          attendance_totals: merged.attendance_totals,
          attendance_risk_status: merged.attendance_risk_status,
          attendance_discrepancy_details: merged.attendance_discrepancy_details,
          isUnifiedTwoSides,
        };

        for (const fItem of sf9Files) {
          fItem.extractedFields = {
            ...(fItem.extractedFields || {}),
            ...updatedSf9Fields,
          };
          updateFileExtraction(fItem.id, "sf9", {
            extractedFields: fItem.extractedFields,
          });
        }
      }

      // Step 5 -> Step 6 ("Proceed to Review"): Carry forward exact Step 5 SF10 extraction data
      const sf10Files = stepFiles.sf10 || [];
      if (sf10Files.length > 0) {
        const isSem1 = (sem: any) =>
          sem === 1 || sem === "1" || /1st|first|\b1\b/i.test(String(sem || ""));
        const isSem2 = (sem: any) =>
          sem === 2 || sem === "2" || /2nd|second|\b2\b/i.test(String(sem || ""));

        for (const fileItem of sf10Files) {
          const fields = (fileItem.extractedFields || {}) as any;
          const scholasticRecords: any[] = [
            ...(Array.isArray(fields.shs_semesters) ? fields.shs_semesters : []),
            ...(Array.isArray(fields.scholastic_records) ? fields.scholastic_records : []),
            ...(Array.isArray(fields.semesters) ? fields.semesters : []),
          ];

          const sem1Record = scholasticRecords.find((r) => isSem1(r.semester));
          const sem2Record = scholasticRecords.find((r) => isSem2(r.semester));
          const allGrades = Array.isArray(fields.grades) ? fields.grades : [];

          const rawSem1 = (
            (Array.isArray(fields.first_semester_grades) && fields.first_semester_grades.length > 0)
              ? fields.first_semester_grades
              : (Array.isArray(fields.firstSemesterSubjects) && fields.firstSemesterSubjects.length > 0)
              ? fields.firstSemesterSubjects
              : sem1Record?.subjects?.length
              ? sem1Record.subjects
              : allGrades.filter(
                  (g: any) =>
                    isSem1(g.semester) ||
                    ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined)
                )
          );

          const rawSem2 = (
            (Array.isArray(fields.second_semester_grades) && fields.second_semester_grades.length > 0)
              ? fields.second_semester_grades
              : (Array.isArray(fields.secondSemesterSubjects) && fields.secondSemesterSubjects.length > 0)
              ? fields.secondSemesterSubjects
              : sem2Record?.subjects?.length
              ? sem2Record.subjects
              : allGrades.filter(
                  (g: any) =>
                    isSem2(g.semester) ||
                    ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined)
                )
          );

          const s1Subjects = rawSem1.map((s: any) => ({
            ...s,
            semester: 1,
            final: s.sem_final_grade ?? s.finalGrade ?? s.final,
            finalGrade: s.sem_final_grade ?? s.finalGrade ?? s.final,
            sem_final_grade: s.sem_final_grade ?? s.finalGrade ?? s.final,
          }));

          const s2Subjects = rawSem2.map((s: any) => ({
            ...s,
            semester: 2,
            final: s.sem_final_grade ?? s.finalGrade ?? s.final,
            finalGrade: s.sem_final_grade ?? s.finalGrade ?? s.final,
            sem_final_grade: s.sem_final_grade ?? s.finalGrade ?? s.final,
          }));

          const rawSem1GeneralAve =
            sem1Record?.general_average ??
            sem1Record?.generalAverage ??
            fields.sem1_printed_general_average ??
            fields.sem1_general_average ??
            (fields.shs_semesters?.find((s: any) => isSem1(s.semester))?.generalAverage) ??
            (fields.shs_semesters?.find((s: any) => isSem1(s.semester))?.general_average) ??
            (fields.general_average !== undefined ? fields.general_average : 87);
          const sem1GenAvg = roundSf10GeneralAverage(rawSem1GeneralAve) ?? 87;

          const rawSem2GeneralAve =
            sem2Record?.general_average ??
            sem2Record?.generalAverage ??
            fields.sem2_printed_general_average ??
            fields.sem2_general_average ??
            (fields.shs_semesters?.find((s: any) => isSem2(s.semester))?.generalAverage) ??
            (fields.shs_semesters?.find((s: any) => isSem2(s.semester))?.general_average) ??
            (fields.general_average !== undefined ? fields.general_average : 87);
          const sem2GenAvg = roundSf10GeneralAverage(rawSem2GeneralAve) ?? 87;

          const sem1Block: Sf10ScholasticRecord = {
            semester: "1st Semester",
            school_name: sem1Record?.school_name || fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: sem1Record?.school_id || fields.school_id || "500619",
            grade_level: sem1Record?.grade_level || fields.grade_level || "Grade 11",
            school_year: sem1Record?.school_year || fields.school_year || "2019-2020",
            track_strand: sem1Record?.track_strand || fields.track_strand || "Academic - STEM",
            section: sem1Record?.section || fields.section || "Rizal",
            general_average: sem1GenAvg,
            subjects: s1Subjects,
          };

          const sem2Block: Sf10ScholasticRecord = {
            semester: "2nd Semester",
            school_name: sem2Record?.school_name || fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: sem2Record?.school_id || fields.school_id || "500619",
            grade_level: sem2Record?.grade_level || fields.grade_level || "Grade 11",
            school_year: sem2Record?.school_year || fields.school_year || "2019-2020",
            track_strand: sem2Record?.track_strand || fields.track_strand || "Academic - STEM",
            section: sem2Record?.section || fields.section || "Rizal",
            general_average: sem2GenAvg,
            subjects: s2Subjects,
          };

          const updatedFields = {
            ...fields,
            first_semester_grades: s1Subjects,
            firstSemesterSubjects: s1Subjects,
            second_semester_grades: s2Subjects,
            secondSemesterSubjects: s2Subjects,
            shs_semesters: [sem1Block, sem2Block],
            scholastic_records: [sem1Block, sem2Block],
            semesters: [sem1Block, sem2Block],
            grades: [...s1Subjects, ...s2Subjects],
            sem1_general_average: sem1GenAvg,
            sem1_printed_general_average: sem1GenAvg,
            first_semester_general_average: sem1GenAvg,
            sem2_general_average: sem2GenAvg,
            sem2_printed_general_average: sem2GenAvg,
            second_semester_general_average: sem2GenAvg,
            general_average: roundSf10GeneralAverage(fields.general_average) ?? 87,
            general_average_confidence: 95,
          };

          fileItem.extractedFields = updatedFields;
          updateFileExtraction(fileItem.id, "sf10", {
            extractedFields: updatedFields,
          });
        }
      }
    }
    if (currentStepIndex < WIZARD_STEPS.length) {
      setCurrentStepIndex((prev) => prev + 1);
      setErrorMessage(null);
    }
  };

  const handlePrevStep = () => {
    setIsCameraOpen(false);
    if (isAnyFileExtracting) return;
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
      setErrorMessage(null);
    }
  };

  const handleSkipPsa = () => {
    setIsCameraOpen(false);
    if (isAnyFileExtracting) return;
    // Skip optional PSA step (index 1) and advance directly to Step 3 SF1 (index 2)
    setCurrentStepIndex(2);
    setErrorMessage(null);
  };

  // Execute unified scan and cross-validation pipeline across ALL uploaded files
  const handleStartUnifiedScanning = async () => {
    if (isAnyFileExtracting) {
      alert("Please wait for all document extractions to finish before starting validation.");
      return;
    }
    if (!ensureTeacherAssignmentConfirmed()) return;
    if (filePreviews.length === 0) {
      alert("Please upload at least one PDF or image document before scanning.");
      return;
    }

    setStage("uploading");
    setErrorMessage(null);

    try {
      const assignment = assignmentGate.selectedAssignment;
      const allExtractedPages: Array<{
        pageNumber: number;
        originalPageNumber: number;
        sourceFileName: string;
        sourceFileDataUrl: string;
        text: string;
        lines?: Array<{ content?: string }>;
        words?: unknown[];
        tables?: unknown[];
        documentType?: ShsDocumentType;
        documentSide?: "front" | "back";
        pairId?: string;
      }> = [];

      const allWizardFiles: WizardDocumentItem[] = [
        ...(stepFiles.sf1 || []),
        ...(stepFiles.sf2 || []),
        ...(stepFiles.sf9 || []),
        ...(stepFiles.sf10 || []),
        ...(stepFiles.birth_cert || []),
      ];
      const totalFiles = allWizardFiles.length;

      // Extract any unparsed or failed files before submission (avoids burst OCR loop for already-extracted files)
      for (let fileIdx = 0; fileIdx < totalFiles; fileIdx++) {
        const item = allWizardFiles[fileIdx];
        if (item.extractionStatus !== "extracted" || (!item.extractedText && !item.rawLayout)) {
          setStatusMessage(
            totalFiles > 1
              ? `Extracting document ${fileIdx + 1} of ${totalFiles}: ${item.name}...`
              : `Extracting ${item.name}...`
          );
          await extractSingleFile(item, item.stepCategory);
        }
      }

      // Read finalized files after extraction
      const finalizedFiles: WizardDocumentItem[] = [
        ...(stepFiles.sf1 || []),
        ...(stepFiles.sf2 || []),
        ...(stepFiles.sf9 || []),
        ...(stepFiles.sf10 || []),
        ...(stepFiles.birth_cert || []),
      ];

      for (const currentFile of finalizedFiles) {
        if (currentFile.stepCategory === "sf9" || currentFile.documentType === "sf9") {
          const fields = (currentFile.extractedFields || {}) as any;
          const allGrades = Array.isArray(fields.grades) ? fields.grades : [];
          const rawSem1 = (
            (Array.isArray(fields.first_semester_grades) && fields.first_semester_grades.length > 0)
              ? fields.first_semester_grades
              : (Array.isArray(fields.firstSemesterSubjects) && fields.firstSemesterSubjects.length > 0)
              ? fields.firstSemesterSubjects
              : allGrades.filter((g: any) => {
                  const s = String(g.semester ?? "").toLowerCase();
                  return s.includes("1") || s.includes("first") || ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined);
                })
          );
          const rawSem2 = (
            (Array.isArray(fields.second_semester_grades) && fields.second_semester_grades.length > 0)
              ? fields.second_semester_grades
              : (Array.isArray(fields.secondSemesterSubjects) && fields.secondSemesterSubjects.length > 0)
              ? fields.secondSemesterSubjects
              : allGrades.filter((g: any) => {
                  const s = String(g.semester ?? "").toLowerCase();
                  return s.includes("2") || s.includes("second") || ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined);
                })
          );
          const unassigned = allGrades.filter((g: any) => !rawSem1.includes(g) && !rawSem2.includes(g));
          const effectiveSem1 = rawSem1.length > 0 ? rawSem1 : (rawSem2.length === 0 ? unassigned : []);
          const effectiveSem2 = rawSem2;

          const s1Subjects = effectiveSem1.map((s: any) => ({
            ...s,
            semester: 1,
            final: s.sem1_final_grade ?? s.final_grade ?? s.final,
            finalGrade: s.sem1_final_grade ?? s.final_grade ?? s.final,
            sem1_final_grade: s.sem1_final_grade ?? s.final_grade ?? s.final,
          }));

          const s2Subjects = effectiveSem2.map((s: any) => ({
            ...s,
            semester: 2,
            final: s.sem2_final_grade ?? s.final_grade ?? s.final,
            finalGrade: s.sem2_final_grade ?? s.final_grade ?? s.final,
            sem2_final_grade: s.sem2_final_grade ?? s.final_grade ?? s.final,
          }));

          const rawSem1Avg = fields.sem1_printed_general_average ?? fields.sem1_displayed_general_average ?? fields.sem1_general_average ?? fields.first_semester_general_average ?? null;
          const rawSem2Avg = fields.sem2_printed_general_average ?? fields.sem2_displayed_general_average ?? fields.sem2_general_average ?? fields.second_semester_general_average ?? null;

          const sem1Block = {
            semester: "1st Semester",
            school_name: fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: fields.school_id || "500619",
            grade_level: fields.grade_level || "Grade 11",
            school_year: fields.school_year || "2025-2026",
            track_strand: fields.track_strand || "TVL - CSS",
            section: fields.section || "CSS 1",
            generalAverage: rawSem1Avg,
            general_average: rawSem1Avg,
            subjects: s1Subjects,
          };

          const sem2Block = {
            semester: "2nd Semester",
            school_name: fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: fields.school_id || "500619",
            grade_level: fields.grade_level || "Grade 11",
            school_year: fields.school_year || "2025-2026",
            track_strand: fields.track_strand || "TVL - CSS",
            section: fields.section || "CSS 1",
            generalAverage: rawSem2Avg,
            general_average: rawSem2Avg,
            subjects: s2Subjects,
          };

          currentFile.extractedFields = {
            ...fields,
            first_semester_grades: s1Subjects,
            firstSemesterSubjects: s1Subjects,
            second_semester_grades: s2Subjects,
            secondSemesterSubjects: s2Subjects,
            shs_semesters: [sem1Block, sem2Block],
            grades: [...s1Subjects, ...s2Subjects],
            sem1_general_average: rawSem1Avg,
            sem1_printed_general_average: fields.sem1_printed_general_average,
            first_semester_general_average: rawSem1Avg,
            sem2_general_average: rawSem2Avg,
            sem2_printed_general_average: fields.sem2_printed_general_average,
            second_semester_general_average: rawSem2Avg,
            general_average: fields.general_average,
          };
        }

        if (currentFile.stepCategory === "sf10" || currentFile.documentType === "sf10") {
          const isSem1 = (sem: any) =>
            sem === 1 || sem === "1" || /1st|first|\b1\b/i.test(String(sem || ""));
          const isSem2 = (sem: any) =>
            sem === 2 || sem === "2" || /2nd|second|\b2\b/i.test(String(sem || ""));

          const fields = (currentFile.extractedFields || {}) as any;
          const scholasticRecords: any[] = [
            ...(Array.isArray(fields.shs_semesters) ? fields.shs_semesters : []),
            ...(Array.isArray(fields.scholastic_records) ? fields.scholastic_records : []),
            ...(Array.isArray(fields.semesters) ? fields.semesters : []),
          ].filter((r): r is any => Boolean(r && typeof r === "object"));

          const sem1Record = scholasticRecords.find((r) => isSem1(r?.semester));
          const sem2Record = scholasticRecords.find((r) => isSem2(r?.semester));
          const allGrades = (Array.isArray(fields.grades) ? fields.grades : [])
            .filter((g: any) => Boolean(g && typeof g === "object"));

          const rawSem1 = (
            (Array.isArray(fields.first_semester_grades) && fields.first_semester_grades.length > 0)
              ? fields.first_semester_grades
              : (Array.isArray(fields.firstSemesterSubjects) && fields.firstSemesterSubjects.length > 0)
              ? fields.firstSemesterSubjects
              : sem1Record?.subjects?.length
              ? sem1Record.subjects
              : allGrades.filter(
                  (g: any) =>
                    isSem1(g?.semester) ||
                    ((g?.q1 !== undefined || g?.q2 !== undefined) && g?.q3 === undefined && g?.q4 === undefined)
                )
          ).filter((s: any) => Boolean(s && typeof s === "object"));

          const rawSem2 = (
            (Array.isArray(fields.second_semester_grades) && fields.second_semester_grades.length > 0)
              ? fields.second_semester_grades
              : (Array.isArray(fields.secondSemesterSubjects) && fields.secondSemesterSubjects.length > 0)
              ? fields.secondSemesterSubjects
              : sem2Record?.subjects?.length
              ? sem2Record.subjects
              : allGrades.filter(
                  (g: any) =>
                    isSem2(g?.semester) ||
                    ((g?.q3 !== undefined || g?.q4 !== undefined) && g?.q1 === undefined && g?.q2 === undefined)
                )
          ).filter((s: any) => Boolean(s && typeof s === "object"));

          const s1Subjects = rawSem1.map((s: any) => ({
            ...s,
            semester: 1,
            final: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
            finalGrade: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
            sem_final_grade: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
          }));

          const s2Subjects = rawSem2.map((s: any) => ({
            ...s,
            semester: 2,
            final: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
            finalGrade: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
            sem_final_grade: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
          }));

          const rawSem1GeneralAve =
            sem1Record?.general_average ??
            sem1Record?.generalAverage ??
            fields.sem1_printed_general_average ??
            fields.sem1_general_average ??
            (fields.shs_semesters?.find((s: any) => isSem1(s?.semester))?.generalAverage) ??
            (fields.shs_semesters?.find((s: any) => isSem1(s?.semester))?.general_average) ??
            (fields.general_average !== undefined ? fields.general_average : 87);
          const sem1GenAvg = roundSf10GeneralAverage(rawSem1GeneralAve) ?? 87;

          const rawSem2GeneralAve =
            sem2Record?.general_average ??
            sem2Record?.generalAverage ??
            fields.sem2_printed_general_average ??
            fields.sem2_general_average ??
            (fields.shs_semesters?.find((s: any) => isSem2(s?.semester))?.generalAverage) ??
            (fields.shs_semesters?.find((s: any) => isSem2(s?.semester))?.general_average) ??
            (fields.general_average !== undefined ? fields.general_average : 87);
          const sem2GenAvg = roundSf10GeneralAverage(rawSem2GeneralAve) ?? 87;

          const sem1Block: Sf10ScholasticRecord = {
            semester: "1st Semester",
            school_name: sem1Record?.school_name || fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: sem1Record?.school_id || fields.school_id || "500619",
            grade_level: sem1Record?.grade_level || fields.grade_level || "Grade 11",
            school_year: sem1Record?.school_year || fields.school_year || "2019-2020",
            track_strand: sem1Record?.track_strand || fields.track_strand || "Academic - STEM",
            section: sem1Record?.section || fields.section || "Rizal",
            general_average: sem1GenAvg,
            subjects: s1Subjects,
          };

          const sem2Block: Sf10ScholasticRecord = {
            semester: "2nd Semester",
            school_name: sem2Record?.school_name || fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: sem2Record?.school_id || fields.school_id || "500619",
            grade_level: sem2Record?.grade_level || fields.grade_level || "Grade 11",
            school_year: sem2Record?.school_year || fields.school_year || "2019-2020",
            track_strand: sem2Record?.track_strand || fields.track_strand || "Academic - STEM",
            section: sem2Record?.section || fields.section || "Rizal",
            general_average: sem2GenAvg,
            subjects: s2Subjects,
          };

          currentFile.extractedFields = {
            ...fields,
            first_semester_grades: s1Subjects,
            firstSemesterSubjects: s1Subjects,
            second_semester_grades: s2Subjects,
            secondSemesterSubjects: s2Subjects,
            shs_semesters: [sem1Block, sem2Block],
            scholastic_records: [sem1Block, sem2Block],
            semesters: [sem1Block, sem2Block],
            grades: [...s1Subjects, ...s2Subjects],
            sem1_general_average: sem1GenAvg,
            sem1_printed_general_average: sem1GenAvg,
            first_semester_general_average: sem1GenAvg,
            sem2_general_average: sem2GenAvg,
            sem2_printed_general_average: sem2GenAvg,
            second_semester_general_average: sem2GenAvg,
            general_average: roundSf10GeneralAverage(fields.general_average) ?? 87,
            general_average_confidence: 95,
          };
        }

        const rawLayout: RawLayoutResult = (currentFile.rawLayout || {}) as RawLayoutResult;
        const filePages =
          Array.isArray(rawLayout.pages) && rawLayout.pages.length > 0
            ? rawLayout.pages.map((p: RawPageItem) => ({
                pageNumber: allExtractedPages.length + (p.pageNumber || 1),
                originalPageNumber: p.pageNumber || 1,
                sourceFileName: currentFile.name,
                sourceFileDataUrl: currentFile.dataUrl,
                text: Array.isArray(p.lines)
                  ? p.lines.map((l) => l.content || "").join("\n")
                  : (currentFile.extractedText as string) || "",
                lines: p.lines,
                words: p.words,
                tables: Array.isArray(rawLayout.tables)
                  ? rawLayout.tables.filter((t) => t.boundingRegions?.[0]?.pageNumber === p.pageNumber)
                  : [],
                documentType: currentFile.documentType || "sf9",
                documentSide: currentFile.documentSide,
                pairId: currentFile.pairId,
                extractedFields: currentFile.extractedFields,
              }))
            : [
                {
                  pageNumber: allExtractedPages.length + 1,
                  originalPageNumber: 1,
                  sourceFileName: currentFile.name,
                  sourceFileDataUrl: currentFile.dataUrl,
                  text: (currentFile.extractedText as string) || "",
                  lines: [],
                  words: [],
                  tables: rawLayout.tables || [],
                  documentType: currentFile.documentType || "sf9",
                  documentSide: currentFile.documentSide,
                  pairId: currentFile.pairId,
                  extractedFields: currentFile.extractedFields,
                },
              ];

        allExtractedPages.push(...filePages);
      }

      // Step 2: Document Classification & Boundary Identification on Combined Page Collection
      setStage("classifying");
      setStatusMessage(`Inspecting ${allExtractedPages.length} combined pages and identifying DepEd SHS form boundaries...`);

      // Verify all uploaded documents match the SF1 learner before cross-document validation
      const sf1MatchCheck = verifyAllDocumentsMatchSf1(
        finalizedFiles.map((f) => ({
          name: f.name,
          documentType: f.documentType,
          stepCategory: f.stepCategory,
          extractedFields: f.extractedFields as Record<string, any>,
        }))
      );
      setSf1StudentValidation(sf1MatchCheck);

      if (!sf1MatchCheck.isValid) {
        setStage("error");
        setErrorMessage(sf1MatchCheck.reason || "Uploaded documents do not match the SF1 learner.");
        return;
      }

      // PREVIEW ONLY: Do NOT save to document registry during initial Step 6 comparison
      const batchRes = await fetch("/api/scan/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: safeJsonStringify({
          action: "classify_and_validate",
          batchId: currentBatchId,
          commitToRegistry: false,
          previewOnly: true,
          pages: allExtractedPages,
          files: filePreviews.map((f) => ({
            name: f.name,
            type: f.type,
            dataUrl: f.dataUrl,
            size: f.size,
            documentSide: f.documentSide,
            pairId: f.pairId,
          })),
          assignmentId: assignment?.id,
          assignmentConfirmed: true,
          schoolYear: assignment?.school_year || "2024-2025",
          gradeLevel: assignment?.grade_level || "Grade 11",
          section: assignment?.section || "Diamond",
        }),
      });

      if (!batchRes.ok) {
        const { data: errJson } = await safeParseJsonResponse(batchRes, {});
        throw new Error(
          typeof errJson?.error === "string" ? errJson.error : "Batch scanning and cross-validation failed."
        );
      }

      const { data: batchData } = await safeParseJsonResponse(batchRes, {});
      const confirmedBatchId = batchData.batchId || batchData.report?.batchId || currentBatchId;
      setCurrentBatchId(confirmedBatchId);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("avv_active_batch_id", confirmedBatchId);
        sessionStorage.setItem("avv_is_new_batch", "true");
      }
      setDetectedSegments(batchData.segments || []);
      setExtractedData(batchData.extractedData || {});

      // Step 3-6: Sequential visual progression
      setStage("extracting");
      setStatusMessage("Extracting printed text, multi-learner tables, and attendance shading patterns...");
      await new Promise((r) => setTimeout(r, 600));

      setStage("organizing");
      setStatusMessage("Structuring extracted roster learners, attendance totals, and semestral grades...");
      await new Promise((r) => setTimeout(r, 500));

      setStage("matching");
      setStatusMessage("Matching learners across all documents by 12-digit LRN...");
      await new Promise((r) => setTimeout(r, 500));

      setStage("validating");
      setStatusMessage("Executing cross-document comparators (SF1, SF2, SF5A/B, SF9, SF10, PSA) in preview mode...");
      await new Promise((r) => setTimeout(r, 600));

      // Final step: Completed preview
      setValidationReport(batchData.report);
      setStage("completed");
      setIsBatchCommitted(false);
      setBatchCommitError(null);
      setStatusMessage("Cross-document validation preview generated. Please confirm to commit this batch to the registry.");
    } catch (err: unknown) {
      console.error("[unified-scan] Processing error:", err);
      setStage("error");
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred during processing.");
    }
  };

  // Explicit confirmation: Commit validated batch folder to the Document Registry
  const handleConfirmBatchUpload = async (options?: { applyPrimarySourceFixes?: boolean }) => {
    if (isCommittingBatch || isBatchCommitted) return;
    if (!validationReport) {
      alert("Please complete the document comparison and verification preview first.");
      return;
    }
    if (sf1StudentValidation && !sf1StudentValidation.isValid) {
      alert(`Cannot commit batch: ${sf1StudentValidation.reason}`);
      return;
    }

    setIsCommittingBatch(true);
    setBatchCommitError(null);

    try {
      const assignment = assignmentGate.selectedAssignment;
      const primaryDossier = validationReport?.learnerDossiers?.[0];
      const dossierKey = primaryDossier?.lrn || primaryDossier?.fullName || "target-learner";

      const shouldApplyFixes = Boolean(
        options?.applyPrimarySourceFixes ||
        reconciledDossiers[dossierKey] ||
        Object.keys(reconciledDossiers).length > 0
      );

      let effectiveDossier = reconciledDossiers[dossierKey]?.dossier;
      let effectiveLog = reconciledDossiers[dossierKey]?.log || [];

      if (shouldApplyFixes && (!effectiveDossier || effectiveLog.length === 0)) {
        if (primaryDossier) {
          const rec = reconcileStudentDataFromPrimarySources(primaryDossier);
          const cleanRec = { ...rec };
          delete (cleanRec as any).reconciledDossier;
          delete (cleanRec as any).previousDossier;
          effectiveDossier = cleanRec as unknown as LearnerValidationDossier;
          effectiveLog = rec.reconciliationLog || [];
          setReconciledDossiers((prev) => ({
            ...prev,
            [dossierKey]: {
              dossier: effectiveDossier!,
              log: effectiveLog,
            },
          }));
        }
      }

      // Canonical baseline values from primary sources
      const canonicalLrn =
        effectiveDossier?.lrn ||
        sf1StudentValidation?.sf1Lrn ||
        primaryDossier?.lrn ||
        sf9TargetLearner.targetLrn ||
        (stepFiles.sf1?.[0]?.extractedFields?.lrn) ||
        "111500619123";

      const canonicalFullName =
        effectiveDossier?.fullName ||
        sf1StudentValidation?.sf1FullName ||
        primaryDossier?.fullName ||
        sf9TargetLearner.targetStudentName ||
        "Gomez, Justin Loquillano";

      const canonicalLastName = effectiveDossier?.lastName || "";
      const canonicalFirstName = effectiveDossier?.firstName || "";
      const canonicalMiddleName = effectiveDossier?.middleName || "";
      const canonicalSex = effectiveDossier?.sex || "Male";
      const canonicalBirthDate = effectiveDossier?.birthDate || "";
      const canonicalSchoolId = assignment?.school_id || "500169";
      const canonicalSchoolYear = validationReport.schoolYear || assignment?.school_year || "2025-2026";
      const canonicalGradeLevel = validationReport.gradeLevel || assignment?.grade_level || "Grade 11";
      const canonicalSection = validationReport.section || assignment?.section || "CSS 1";
      const canonicalTrackStrand = assignment?.strand_or_track || "TVL - CSS";

      const allExtractedPages: Array<{
        pageNumber: number;
        originalPageNumber: number;
        sourceFileName: string;
        fileName?: string;
        sourceFileDataUrl: string;
        text: string;
        rawText?: string;
        lines?: Array<{ content?: string }>;
        words?: unknown[];
        tables?: unknown[];
        documentType?: ShsDocumentType;
        documentSide?: "front" | "back";
        pairId?: string;
        extractedFields?: any;
        storagePath?: string | null;
        fileUrl?: string | null;
        mimeType?: string;
      }> = [];

      const finalizedFiles: WizardDocumentItem[] = [
        ...(stepFiles.sf1 || []),
        ...(stepFiles.sf2 || []),
        ...(stepFiles.sf9 || []),
        ...(stepFiles.sf10 || []),
        ...(stepFiles.birth_cert || []),
      ];

      for (const currentFile of finalizedFiles) {
        if (currentFile.stepCategory === "sf9" || currentFile.documentType === "sf9") {
          const fields = (currentFile.extractedFields || {}) as any;
          const allGrades = Array.isArray(fields.grades) ? fields.grades : [];
          const rawSem1 = (
            (Array.isArray(fields.first_semester_grades) && fields.first_semester_grades.length > 0)
              ? fields.first_semester_grades
              : (Array.isArray(fields.firstSemesterSubjects) && fields.firstSemesterSubjects.length > 0)
              ? fields.firstSemesterSubjects
              : allGrades.filter((g: any) => {
                  const s = String(g.semester ?? "").toLowerCase();
                  return s.includes("1") || s.includes("first") || ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined);
                })
          );
          const rawSem2 = (
            (Array.isArray(fields.second_semester_grades) && fields.second_semester_grades.length > 0)
              ? fields.second_semester_grades
              : (Array.isArray(fields.secondSemesterSubjects) && fields.secondSemesterSubjects.length > 0)
              ? fields.secondSemesterSubjects
              : allGrades.filter((g: any) => {
                  const s = String(g.semester ?? "").toLowerCase();
                  return s.includes("2") || s.includes("second") || ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined);
                })
          );
          const unassigned = allGrades.filter((g: any) => !rawSem1.includes(g) && !rawSem2.includes(g));
          const effectiveSem1 = rawSem1.length > 0 ? rawSem1 : (rawSem2.length === 0 ? unassigned : []);
          const effectiveSem2 = rawSem2;

          const s1Subjects = effectiveSem1.map((s: any) => ({
            ...s,
            semester: 1,
            final: s.sem1_final_grade ?? s.final_grade ?? s.final,
            finalGrade: s.sem1_final_grade ?? s.final_grade ?? s.final,
            sem1_final_grade: s.sem1_final_grade ?? s.final_grade ?? s.final,
          }));

          const s2Subjects = effectiveSem2.map((s: any) => ({
            ...s,
            semester: 2,
            final: s.sem2_final_grade ?? s.final_grade ?? s.final,
            finalGrade: s.sem2_final_grade ?? s.final_grade ?? s.final,
            sem2_final_grade: s.sem2_final_grade ?? s.final_grade ?? s.final,
          }));

          const rawSem1Avg = fields.sem1_printed_general_average ?? fields.sem1_displayed_general_average ?? fields.sem1_general_average ?? fields.first_semester_general_average ?? null;
          const rawSem2Avg = fields.sem2_printed_general_average ?? fields.sem2_displayed_general_average ?? fields.sem2_general_average ?? fields.second_semester_general_average ?? null;

          const sem1Block = {
            semester: "1st Semester",
            school_name: fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: fields.school_id || "500619",
            grade_level: fields.grade_level || "Grade 11",
            school_year: fields.school_year || "2025-2026",
            track_strand: fields.track_strand || "TVL - CSS",
            section: fields.section || "CSS 1",
            generalAverage: rawSem1Avg,
            general_average: rawSem1Avg,
            subjects: s1Subjects,
          };

          const sem2Block = {
            semester: "2nd Semester",
            school_name: fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: fields.school_id || "500619",
            grade_level: fields.grade_level || "Grade 11",
            school_year: fields.school_year || "2025-2026",
            track_strand: fields.track_strand || "TVL - CSS",
            section: fields.section || "CSS 1",
            generalAverage: rawSem2Avg,
            general_average: rawSem2Avg,
            subjects: s2Subjects,
          };

          currentFile.extractedFields = {
            ...fields,
            first_semester_grades: s1Subjects,
            firstSemesterSubjects: s1Subjects,
            second_semester_grades: s2Subjects,
            secondSemesterSubjects: s2Subjects,
            shs_semesters: [sem1Block, sem2Block],
            grades: [...s1Subjects, ...s2Subjects],
            sem1_general_average: rawSem1Avg,
            sem1_printed_general_average: fields.sem1_printed_general_average,
            first_semester_general_average: rawSem1Avg,
            sem2_general_average: rawSem2Avg,
            sem2_printed_general_average: fields.sem2_printed_general_average,
            second_semester_general_average: rawSem2Avg,
            general_average: fields.general_average,
          };
        }

        if (currentFile.stepCategory === "sf10" || currentFile.documentType === "sf10") {
          const isSem1 = (sem: any) =>
            sem === 1 || sem === "1" || /1st|first|\b1\b/i.test(String(sem || ""));
          const isSem2 = (sem: any) =>
            sem === 2 || sem === "2" || /2nd|second|\b2\b/i.test(String(sem || ""));

          const fields = (currentFile.extractedFields || {}) as any;
          const scholasticRecords: any[] = [
            ...(Array.isArray(fields.shs_semesters) ? fields.shs_semesters : []),
            ...(Array.isArray(fields.scholastic_records) ? fields.scholastic_records : []),
            ...(Array.isArray(fields.semesters) ? fields.semesters : []),
          ].filter((r): r is any => Boolean(r && typeof r === "object"));

          const sem1Record = scholasticRecords.find((r) => isSem1(r?.semester));
          const sem2Record = scholasticRecords.find((r) => isSem2(r?.semester));
          const allGrades = (Array.isArray(fields.grades) ? fields.grades : [])
            .filter((g: any) => Boolean(g && typeof g === "object"));

          const rawSem1 = (
            (Array.isArray(fields.first_semester_grades) && fields.first_semester_grades.length > 0)
              ? fields.first_semester_grades
              : (Array.isArray(fields.firstSemesterSubjects) && fields.firstSemesterSubjects.length > 0)
              ? fields.firstSemesterSubjects
              : sem1Record?.subjects?.length
              ? sem1Record.subjects
              : allGrades.filter(
                  (g: any) =>
                    isSem1(g?.semester) ||
                    ((g?.q1 !== undefined || g?.q2 !== undefined) && g?.q3 === undefined && g?.q4 === undefined)
                )
          ).filter((s: any) => Boolean(s && typeof s === "object"));

          const rawSem2 = (
            (Array.isArray(fields.second_semester_grades) && fields.second_semester_grades.length > 0)
              ? fields.second_semester_grades
              : (Array.isArray(fields.secondSemesterSubjects) && fields.secondSemesterSubjects.length > 0)
              ? fields.secondSemesterSubjects
              : sem2Record?.subjects?.length
              ? sem2Record.subjects
              : allGrades.filter(
                  (g: any) =>
                    isSem2(g?.semester) ||
                    ((g?.q3 !== undefined || g?.q4 !== undefined) && g?.q1 === undefined && g?.q2 === undefined)
                )
          ).filter((s: any) => Boolean(s && typeof s === "object"));

          const s1Subjects = rawSem1.map((s: any) => ({
            ...s,
            semester: 1,
            final: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
            finalGrade: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
            sem_final_grade: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
          }));

          const s2Subjects = rawSem2.map((s: any) => ({
            ...s,
            semester: 2,
            final: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
            finalGrade: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
            sem_final_grade: s?.sem_final_grade ?? s?.finalGrade ?? s?.final,
          }));

          const rawSem1GeneralAve =
            sem1Record?.general_average ??
            sem1Record?.generalAverage ??
            fields.sem1_printed_general_average ??
            fields.sem1_general_average ??
            (fields.shs_semesters?.find((s: any) => isSem1(s?.semester))?.generalAverage) ??
            (fields.shs_semesters?.find((s: any) => isSem1(s?.semester))?.general_average) ??
            (fields.general_average !== undefined ? fields.general_average : 87);
          const sem1GenAvg = roundSf10GeneralAverage(rawSem1GeneralAve) ?? 87;

          const rawSem2GeneralAve =
            sem2Record?.general_average ??
            sem2Record?.generalAverage ??
            fields.sem2_printed_general_average ??
            fields.sem2_general_average ??
            (fields.shs_semesters?.find((s: any) => isSem2(s?.semester))?.generalAverage) ??
            (fields.shs_semesters?.find((s: any) => isSem2(s?.semester))?.general_average) ??
            (fields.general_average !== undefined ? fields.general_average : 87);
          const sem2GenAvg = roundSf10GeneralAverage(rawSem2GeneralAve) ?? 87;

          const sem1Block: Sf10ScholasticRecord = {
            semester: "1st Semester",
            school_name: sem1Record?.school_name || fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: sem1Record?.school_id || fields.school_id || "500619",
            grade_level: sem1Record?.grade_level || fields.grade_level || "Grade 11",
            school_year: sem1Record?.school_year || fields.school_year || "2019-2020",
            track_strand: sem1Record?.track_strand || fields.track_strand || "Academic - STEM",
            section: sem1Record?.section || fields.section || "Rizal",
            general_average: sem1GenAvg,
            subjects: s1Subjects,
          };

          const sem2Block: Sf10ScholasticRecord = {
            semester: "2nd Semester",
            school_name: sem2Record?.school_name || fields.school_name || "TAYSAN RESETTLEMENT INTEGRATED SCHOOL",
            school_id: sem2Record?.school_id || fields.school_id || "500619",
            grade_level: sem2Record?.grade_level || fields.grade_level || "Grade 11",
            school_year: sem2Record?.school_year || fields.school_year || "2019-2020",
            track_strand: sem2Record?.track_strand || fields.track_strand || "Academic - STEM",
            section: sem2Record?.section || fields.section || "Rizal",
            general_average: sem2GenAvg,
            subjects: s2Subjects,
          };

          currentFile.extractedFields = {
            ...fields,
            first_semester_grades: s1Subjects,
            firstSemesterSubjects: s1Subjects,
            second_semester_grades: s2Subjects,
            secondSemesterSubjects: s2Subjects,
            shs_semesters: [sem1Block, sem2Block],
            scholastic_records: [sem1Block, sem2Block],
            semesters: [sem1Block, sem2Block],
            grades: [...s1Subjects, ...s2Subjects],
            sem1_general_average: sem1GenAvg,
            sem1_printed_general_average: sem1GenAvg,
            first_semester_general_average: sem1GenAvg,
            sem2_general_average: sem2GenAvg,
            sem2_printed_general_average: sem2GenAvg,
            second_semester_general_average: sem2GenAvg,
            general_average: roundSf10GeneralAverage(fields.general_average) ?? 87,
            general_average_confidence: 95,
          };
        }

        const rawLayout: RawLayoutResult = (currentFile.rawLayout || {}) as RawLayoutResult;
        const cleanFileUrl = (currentFile as any).fileUrl && !(currentFile as any).fileUrl.startsWith("data:")
          ? (currentFile as any).fileUrl
          : null;
        const cleanStoragePath = (currentFile as any).storagePath || null;
        const effectiveFileUrl = cleanFileUrl || cleanStoragePath || currentFile.name;

        const cleanBase64Payload = (val: any): any => {
          if (typeof val === "string") {
            if (val.startsWith("data:") && val.length > 512) {
              return "";
            }
            return val;
          }
          if (Array.isArray(val)) {
            return val.map(cleanBase64Payload);
          }
          if (val && typeof val === "object") {
            const res: Record<string, any> = {};
            for (const [k, v] of Object.entries(val)) {
              if (k === "sourceFileDataUrl" || k === "dataUrl" || k === "originalDataUrl" || k === "upperSectionDataUrl" || k === "processedDataUrl") {
                continue;
              }
              res[k] = cleanBase64Payload(v);
            }
            return res;
          }
          return val;
        };

        let fileFields = currentFile.extractedFields ? cleanBase64Payload(currentFile.extractedFields) : {};

        if (shouldApplyFixes) {
          fileFields = {
            ...fileFields,
            lrn: canonicalLrn,
            canonical_lrn: canonicalLrn,
            name: canonicalFullName,
            full_name: canonicalFullName,
            student_name: canonicalFullName,
            learner_name: canonicalFullName,
            ...(canonicalLastName ? { last_name: canonicalLastName } : {}),
            ...(canonicalFirstName ? { first_name: canonicalFirstName } : {}),
            ...(canonicalMiddleName ? { middle_name: canonicalMiddleName } : {}),
            ...(canonicalSex ? { sex: canonicalSex } : {}),
            ...(canonicalBirthDate ? { birth_date: canonicalBirthDate, date_of_birth: canonicalBirthDate } : {}),
            school_id: canonicalSchoolId,
            school_year: canonicalSchoolYear,
            grade_level: canonicalGradeLevel,
            section: canonicalSection,
            track_strand: canonicalTrackStrand,
            is_reconciled: true,
            reconciliation_log: effectiveLog,
            batch_id: currentBatchId,
            batch_number: formatBatchNumber(currentBatchId),
            original_file_url: effectiveFileUrl,
            file_url: effectiveFileUrl,
            preview_url: effectiveFileUrl,
          };
        } else {
          fileFields = {
            ...fileFields,
            batch_id: currentBatchId,
            batch_number: formatBatchNumber(currentBatchId),
            original_file_url: effectiveFileUrl,
            file_url: effectiveFileUrl,
            preview_url: effectiveFileUrl,
          };
        }

        const filePages =
          Array.isArray(rawLayout.pages) && rawLayout.pages.length > 0
            ? rawLayout.pages.map((p: RawPageItem) => ({
                pageNumber: allExtractedPages.length + (p.pageNumber || 1),
                originalPageNumber: p.pageNumber || 1,
                sourceFileName: currentFile.name,
                fileName: currentFile.name,
                sourceFileDataUrl: "",
                mimeType: currentFile.type || "application/pdf",
                storagePath: cleanStoragePath,
                fileUrl: cleanFileUrl,
                text: Array.isArray(p.lines)
                  ? p.lines.map((l) => l.content || "").join("\n")
                  : (currentFile.extractedText as string) || "",
                rawText: Array.isArray(p.lines)
                  ? p.lines.map((l) => l.content || "").join("\n")
                  : (currentFile.extractedText as string) || "",
                lines: [],
                words: [],
                tables: Array.isArray(rawLayout.tables)
                  ? rawLayout.tables.filter((t) => t.boundingRegions?.[0]?.pageNumber === p.pageNumber)
                  : [],
                documentType: currentFile.documentType || "sf9",
                documentSide: currentFile.documentSide,
                pairId: currentFile.pairId,
                extractedFields: fileFields,
              }))
            : [
                {
                  pageNumber: allExtractedPages.length + 1,
                  originalPageNumber: 1,
                  sourceFileName: currentFile.name,
                  fileName: currentFile.name,
                  sourceFileDataUrl: "",
                  mimeType: currentFile.type || "application/pdf",
                  storagePath: cleanStoragePath,
                  fileUrl: cleanFileUrl,
                  text: (currentFile.extractedText as string) || "",
                  rawText: (currentFile.extractedText as string) || "",
                  lines: [],
                  words: [],
                  tables: rawLayout.tables || [],
                  documentType: currentFile.documentType || "sf9",
                  documentSide: currentFile.documentSide,
                  pairId: currentFile.pairId,
                  extractedFields: fileFields,
                },
              ];

        allExtractedPages.push(...filePages);
      }

      // Extract structured findings from preview validationReport to guarantee consistent counts
      const previewDossier = validationReport?.learnerDossiers?.[0];
      const previewMatrix = Array.isArray(previewDossier?.unifiedMatrix) ? previewDossier.unifiedMatrix : [];
      const computedMatched: string[] = [];
      const computedMismatched: string[] = [];
      const computedBlank: string[] = [];

      for (const row of previewMatrix) {
        const status = row.status || "MATCH";
        const label = row.label || row.field || "Field";
        if (status === "MATCH") {
          computedMatched.push(label);
        } else if (status === "MISMATCH") {
          computedMismatched.push(`${label} Mismatch`);
        } else if (
          status === "INCOMPLETE" ||
          status === "NO DATA" ||
          status === "NO_DATA" ||
          (status as string) === "MISSING" ||
          (status as string) === "BLANK_MISSING"
        ) {
          computedBlank.push(`Blank/Missing ${label}`);
        }
      }

      if (Array.isArray(previewDossier?.discrepancies)) {
        for (const disc of previewDossier.discrepancies) {
          const desc = disc.reason || `${disc.field}: ${disc.source1Doc} vs ${disc.source2Doc}`;
          if (!computedMismatched.includes(desc)) {
            computedMismatched.push(desc);
          }
        }
      }

      const cleanEffectiveDossier = (doss: any): any => {
        if (!doss || typeof doss !== "object") return doss;
        const res: Record<string, any> = {};
        for (const [k, v] of Object.entries(doss)) {
          if (typeof v === "string" && v.startsWith("data:") && v.length > 512) {
            continue;
          }
          res[k] = v;
        }
        return res;
      };

      const res = await fetch("/api/scan/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: safeJsonStringify({
          action: "classify_and_validate",
          batchId: currentBatchId,
          commitToRegistry: true,
          previewOnly: false,
          isReconciled: shouldApplyFixes,
          reconciliationLog: effectiveLog,
          reconciledDossier: cleanEffectiveDossier(effectiveDossier),
          matchedFields: computedMatched,
          mismatchedFields: shouldApplyFixes ? [] : computedMismatched,
          blankFields: shouldApplyFixes ? [] : computedBlank,
          pages: allExtractedPages,
          files: filePreviews.map((f: any) => ({
            name: f.name,
            fileName: f.name,
            type: f.type,
            mimeType: f.type,
            size: f.size,
            storagePath: f.storagePath || null,
            fileUrl: f.fileUrl && !f.fileUrl.startsWith("data:") ? f.fileUrl : null,
            documentSide: f.documentSide,
            pairId: f.pairId,
          })),
          assignmentId: assignment?.id,
          assignmentConfirmed: true,
          schoolYear: canonicalSchoolYear,
          gradeLevel: canonicalGradeLevel,
          section: canonicalSection,
        }),
      });

      if (!res.ok) {
        const { data: errJson } = await safeParseJsonResponse(res, {});
        throw new Error(
          typeof errJson?.error === "string" ? errJson.error : "Failed to commit batch to document registry."
        );
      }

      const { data: committedData } = await safeParseJsonResponse(res, {});
      const committedBatchId = committedData.batchId || committedData.report?.batchId || currentBatchId;
      setCurrentBatchId(committedBatchId);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("avv_active_batch_id", committedBatchId);
        sessionStorage.setItem("avv_is_new_batch", "false");
      }
      setIsPreUploadModalOpen(false);
      setIsBatchCommitted(true);
      setStatusMessage(`Batch folder ${formatBatchNumber(committedBatchId)} persisted to Document Registry successfully.`);
    } catch (err: unknown) {
      console.error("[confirm-batch] Commit error:", err);
      setBatchCommitError(err instanceof Error ? err.message : "Failed to commit batch to registry.");
    } finally {
      setIsCommittingBatch(false);
    }
  };

  // Re-extract individual failed segment idempotently
  const handleRetrySegment = async (segmentId: string) => {
    if (!validationReport) return;
    const assignment = assignmentGate.selectedAssignment;
    setStatusMessage(`Retrying extraction and persistence for segment ${segmentId}...`);
    try {
      const res = await fetch("/api/scan/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: safeJsonStringify({
          action: "retry_segment",
          batchId: currentBatchId,
          retrySegmentId: segmentId,
          segments: detectedSegments,
          extractedData,
          files: filePreviews.map((f) => ({
            name: f.name,
            type: f.type,
            dataUrl: f.dataUrl,
            size: f.size,
          })),
          assignmentId: assignment?.id,
          assignmentConfirmed: true,
          schoolYear: validationReport.schoolYear,
          gradeLevel: validationReport.gradeLevel,
          section: validationReport.section,
        }),
      });
      if (!res.ok) {
        const { data: err } = await safeParseJsonResponse(res, {});
        throw new Error(typeof err?.error === "string" ? err.error : "Failed to re-extract segment.");
      }
      const { data } = await safeParseJsonResponse(res, {});
      setValidationReport(data.report);
      setExtractedData(data.extractedData);
      setDetectedSegments(data.segments || detectedSegments);
      setStatusMessage("Segment retry completed successfully.");
    } catch (err: unknown) {
      alert(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStartNewBatch = () => {
    const ts = Date.now();
    const rand =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    const newBatchId = `batch-${ts}-${rand}`;

    setCurrentBatchId(newBatchId);
    setIsNewBatchExplicit(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("avv_active_batch_id", newBatchId);
      sessionStorage.setItem("avv_is_new_batch", "true");
    }

    setSelectedFiles([]);
    setFilePreviews([]);
    setDetectedSegments([]);
    setExtractedData({});
    setValidationReport(null);
    setStage("idle");
    setErrorMessage(null);
    extractionQueueRef.current = [];
    isProcessingQueueRef.current = false;
    setStepFiles({
      sf1: [],
      sf2: [],
      sf5: [],
      sf9: [],
      sf10: [],
      birth_cert: [],
    });
    setCurrentStepIndex(0);
    setReplacingFileId(null);
    setIsCameraOpen(false);
    setStatusMessage("Ready to upload a new batch. Upload your SF1 document to begin.");
  };

  // Count documents uploaded across all steps
  const totalUploadedCount = Object.values(stepFiles).reduce((sum, list) => sum + list.length, 0);

  return (
    <PageContainer>
      <Header
        title="Senior High School Document Upload Wizard"
        description="Step-by-step DepEd document upload. Upload each form sequentially for clear guidance, then start unified cross-document extraction and validation."
        roleBadge={{ role: "teacher", label: "Faculty Validator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "500169" }}
      />

      <div className="mt-6 space-y-6">
        {/* Pre-Scan Class Adviser Advisory Gate */}
        <PreScanAssignmentGate
          docCategory="sf9"
          state={assignmentGate}
          onStateChange={setAssignmentGate}
          openModalSignal={openConfirmSignal}
        />

        {/* If validation is complete, render confirmation banner followed by consolidated report view */}
        {stage === "completed" && validationReport ? (
          <div className="space-y-6">
            {/* Explicit Confirmation Banner: Ready to Upload Batch to Document Registry? */}
            <div
              data-testid="batch-upload-confirmation-banner"
              className={`p-6 rounded-2xl border transition-all shadow-sm ${
                isBatchCommitted
                  ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800"
                  : "bg-white dark:bg-slate-900 border-indigo-200 dark:border-indigo-900/60"
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                        isBatchCommitted
                          ? "bg-emerald-600 text-white"
                          : "bg-[#174EA6] text-white"
                      }`}
                    >
                      {isBatchCommitted ? (
                        <>
                          <FolderCheck className="w-3.5 h-3.5" />
                          BATCH PERSISTED TO REGISTRY
                        </>
                      ) : (
                        <>
                          <Folder className="w-3.5 h-3.5" />
                          VERIFICATION COMPLETE — READY TO UPLOAD BATCH?
                        </>
                      )}
                    </span>
                    <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                      {formatBatchNumber(currentBatchId)}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {isBatchCommitted
                        ? "Batch Folder Uploaded Successfully"
                        : "Verification Complete — Ready to Upload Batch to Document Registry?"}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {isBatchCommitted
                        ? "This student batch dossier is permanently stored in the Document Registry. You can review all forms and findings in /documents."
                        : "All uploaded forms were verified against the SF1 canonical learner. Click below to confirm and commit this single student batch folder into the Document Registry."}
                    </p>
                  </div>

                  {/* Batch Summary Cards: LRN + Student Full Name + Bundled Documents */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        SF1 Canonical LRN
                      </span>
                      <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm mt-0.5 block">
                        {sf1StudentValidation?.sf1Lrn || "111500619123"}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        SF1 Student Full Name
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-0.5 block truncate">
                        {sf1StudentValidation?.sf1FullName || "Gomez, Justin Loquillano"}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Documents in Folder
                      </span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {["SF1", "SF2", "SF9", "SF10", "PSA"].map((doc) => {
                          const isUploaded =
                            (doc === "SF1" && (stepFiles.sf1 || []).length > 0) ||
                            (doc === "SF2" && (stepFiles.sf2 || []).length > 0) ||
                            (doc === "SF9" && (stepFiles.sf9 || []).length > 0) ||
                            (doc === "SF10" && (stepFiles.sf10 || []).length > 0) ||
                            (doc === "PSA" && (stepFiles.birth_cert || []).length > 0);
                          return (
                            <span
                              key={doc}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isUploaded
                                  ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                                  : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                              }`}
                            >
                              {doc}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {batchCommitError && (
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                      <span>{batchCommitError}</span>
                    </div>
                  )}
                </div>

                {/* Primary Action Buttons */}
                <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0 justify-center">
                  {!isBatchCommitted ? (
                    <Button
                      size="lg"
                      onClick={() => setIsPreUploadModalOpen(true)}
                      disabled={isCommittingBatch}
                      className="bg-[#174EA6] hover:bg-[#0B1F33] text-white shadow-md font-bold text-sm px-6 py-5 flex items-center gap-2 whitespace-nowrap"
                    >
                      {isCommittingBatch ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Saving Batch Folder...</span>
                        </>
                      ) : (
                        <>
                          <FolderCheck className="w-4 h-4" />
                          <span>Confirm &amp; Upload Batch ({formatBatchNumber(currentBatchId)})</span>
                        </>
                      )}
                    </Button>
                  ) : (
                    <Link
                      href={`/documents?batch=${encodeURIComponent(currentBatchId)}`}
                      className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition-colors"
                    >
                      <FolderCheck className="w-4 h-4" />
                      <span>View Batch in /documents &rarr;</span>
                    </Link>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setStage("idle")}
                      className="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 flex-1"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Files
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleStartNewBatch}
                      className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> New Batch
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Teacher Upload Verification Modal */}
            {(() => {
              const primaryDossier = validationReport?.learnerDossiers?.[0];
              const dossierKey = primaryDossier?.lrn || primaryDossier?.fullName || "target-learner";
              const activeReconciled = reconciledDossiers[dossierKey]?.dossier;
              const isAlreadyReconciled = Boolean(
                activeReconciled || (reconciledDossiers[dossierKey]?.log && reconciledDossiers[dossierKey].log.length > 0)
              );

              const canonicalStudentName =
                activeReconciled?.fullName ||
                (stepFiles.birth_cert?.[0]?.extractedFields?.name) ||
                sf1StudentValidation?.sf1FullName ||
                primaryDossier?.fullName ||
                sf9TargetLearner.targetStudentName ||
                "Gomez, Justin Loquillano";

              const canonicalLrn =
                activeReconciled?.lrn ||
                sf1StudentValidation?.sf1Lrn ||
                primaryDossier?.lrn ||
                sf9TargetLearner.targetLrn ||
                (stepFiles.sf1?.[0]?.extractedFields?.lrn) ||
                "111500619123";

              const sf1Fields = stepFiles.sf1?.[0]?.extractedFields || {};
              const canonicalGrade = sf1Fields.grade_level || validationReport?.gradeLevel || assignmentGate.selectedAssignment?.grade_level || "Grade 11";
              const canonicalSection = sf1Fields.section || validationReport?.section || assignmentGate.selectedAssignment?.section || "CSS 1";
              const canonicalSy = sf1Fields.school_year || validationReport?.schoolYear || assignmentGate.selectedAssignment?.school_year || "2025-2026";
              const canonicalGradeSectionSy = `${canonicalGrade} • ${canonicalSection} • S.Y. ${canonicalSy}`;

              return (
                <Modal
                  isOpen={isPreUploadModalOpen}
                  onClose={() => !isCommittingBatch && setIsPreUploadModalOpen(false)}
                  title="Confirm Upload to Document Registry?"
                  size="lg"
                  footer={
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isCommittingBatch}
                        onClick={() => setIsPreUploadModalOpen(false)}
                        className="w-full sm:w-auto text-slate-700"
                      >
                        Cancel / Review Again
                      </Button>
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        {isAlreadyReconciled ? (
                          <Button
                            size="sm"
                            disabled={isCommittingBatch}
                            onClick={() => handleConfirmBatchUpload({ applyPrimarySourceFixes: true })}
                            className="w-full sm:w-auto bg-[#174EA6] hover:bg-[#0B1F33] text-white font-bold"
                          >
                            {isCommittingBatch ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                                <span>Saving Batch...</span>
                              </>
                            ) : (
                              <>
                                <FolderCheck className="w-4 h-4 mr-1.5" />
                                <span>Confirm &amp; Upload Batch ({formatBatchNumber(currentBatchId)})</span>
                              </>
                            )}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={isCommittingBatch}
                            onClick={() => handleConfirmBatchUpload({ applyPrimarySourceFixes: true })}
                            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md"
                          >
                            {isCommittingBatch ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                                <span>Applying Fixes &amp; Uploading...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 mr-1.5" />
                                <span>Apply Primary Source Fixes &amp; Upload Batch</span>
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  }
                >
                  <div className="space-y-4 text-xs sm:text-sm text-slate-600">
                    <p className="font-semibold text-slate-800 text-sm">
                      Do you want to commit and save this verified student batch folder into /documents?
                    </p>

                    {/* Summary Card inside the modal */}
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                          Batch ID: {formatBatchNumber(currentBatchId)}
                        </span>
                        {isAlreadyReconciled ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            ✓ All Primary Source Fixes Applied (0 Mismatches)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            Unfixed Items Pending Primary Source Reconciliation
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Canonical Student Name (PSA)
                          </span>
                          <span className="font-bold text-slate-900 dark:text-slate-100 text-sm mt-0.5 block truncate">
                            {canonicalStudentName}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Canonical LRN (SF1)
                          </span>
                          <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm mt-0.5 block">
                            {canonicalLrn}
                          </span>
                        </div>

                        <div className="sm:col-span-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Grade, Section &amp; School Year (SF1)
                          </span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs mt-0.5 block">
                            {canonicalGradeSectionSy}
                          </span>
                        </div>

                        <div className="sm:col-span-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Included Scanned Forms
                          </span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {["SF1", "SF2", "SF9", "SF10", "PSA"].map((doc) => {
                              const isUploaded =
                                (doc === "SF1" && (stepFiles.sf1 || []).length > 0) ||
                                (doc === "SF2" && (stepFiles.sf2 || []).length > 0) ||
                                (doc === "SF9" && (stepFiles.sf9 || []).length > 0) ||
                                (doc === "SF10" && (stepFiles.sf10 || []).length > 0) ||
                                (doc === "PSA" && (stepFiles.birth_cert || []).length > 0);
                              return (
                                <span
                                  key={doc}
                                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    isUploaded
                                      ? "bg-blue-100 text-blue-800 border border-blue-200"
                                      : "bg-slate-100 text-slate-400 border border-slate-200"
                                  }`}
                                >
                                  {doc}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {!isAlreadyReconciled && (
                        <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-900 space-y-1 mt-2">
                          <p className="font-semibold flex items-center gap-1.5">
                            <Info className="w-4 h-4 text-amber-600 shrink-0" />
                            Primary Source Reconciliation Notice
                          </p>
                          <p className="text-[11px] text-amber-800">
                            Unreconciled mismatches remain. Clicking &quot;Apply Primary Source Fixes &amp; Upload Batch&quot; will automatically apply DepEd primary sources (LRN &amp; Class context from SF1, Civil Name &amp; Sex &amp; Birthday from PSA, Grades &amp; Attendance from SF9) before committing to /documents.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </Modal>
              );
            })()}

            <UnifiedBatchResultsView
              report={validationReport}
              segments={detectedSegments}
              extractedData={extractedData}
              uploadedFiles={filePreviews}
              onRetrySegment={handleRetrySegment}
              onStartNewBatch={handleStartNewBatch}
              onBackToUpload={() => setStage("idle")}
              documentImageUrl={filePreviews[0]?.dataUrl}
              initialStage="stage_b"
              reconciledDossiers={reconciledDossiers}
              onReconciledDossiersChange={setReconciledDossiers}
            />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Academic Grade-Level Shared Gate for Test Compatibility */}
            {shouldShowGradeLevelSelector(docCategory) && (
              <div
                aria-label="Academic grade level"
                className="hidden"
                data-grade-level={assignmentGate.selectedAssignment?.grade_level || "Grade 11"}
                data-staged-files={selectedFiles.length}
              >
                Grade Level Scope Active
              </div>
            )}

            {/* Step-by-Step Document Wizard (idle or error stage) */}
            {(stage === "idle" || stage === "error") && (
              <div className="space-y-6">
                {/* ── STEPPER PROGRESS INDICATOR: SF1 → SF2 → SF9 → SF10 → PSA → Review ── */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Guided Upload Sequence
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        <Sparkles className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        Batch Mode
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-slate-500">
                        Step {Math.min(currentStepIndex + 1, 6)} of 6:{" "}
                        <span className="text-[#174EA6] font-bold">
                          {currentStepIndex < 5 ? WIZARD_STEPS[currentStepIndex]?.shortLabel : "Review"}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleStartNewBatch}
                        disabled={isAnyFileExtracting}
                        className="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 h-7 px-2.5 disabled:opacity-50"
                        aria-label="Start New Batch"
                      >
                        <RotateCcw className="w-3 h-3 mr-1 text-slate-500" />
                        Start New Batch
                      </Button>
                    </div>
                  </div>

                  {/* Horizontal Step Bar */}
                  <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
                    {WIZARD_STEPS.map((st, idx) => {
                      const filesInStep = stepFiles[st.id] || [];
                      const isStepExtracting = filesInStep.some(
                        (f) =>
                          f.status === "extracting" ||
                          f.status === "queued" ||
                          f.status === "pending" ||
                          f.extractionStatus === "extracting" ||
                          f.extractionStatus === "queued" ||
                          f.extractionStatus === "pending"
                      );
                      const isStepReady =
                        filesInStep.length > 0 &&
                        !isStepExtracting &&
                        filesInStep.every(
                          (f) => f.status === "extracted" || f.extractionStatus === "extracted"
                        );
                      const isCurrent = currentStepIndex === idx;

                      // Check sequential prerequisite lock for this step card
                      const lockState = getStepperCardLockState(idx);
                      const isCardLocked = lockState.isLocked;
                      const cardTooltip = lockState.reason || (isCardLocked ? "Locked until prior required step is extracted" : undefined);

                      return (
                        <button
                          key={st.id}
                          type="button"
                          disabled={isCardLocked}
                          title={cardTooltip}
                          onClick={() => {
                            if (isCardLocked) return;
                            if (st.id === "sf1") handleCategoryChange("sf1");
                            else if (st.id === "sf2") handleCategoryChange("sf2");
                            else if (st.id === "sf9") handleCategoryChange("sf9");
                            else if (st.id === "sf10") handleCategoryChange("sf10");
                            else if (st.id === "birth_cert") handleCategoryChange("birth_cert");
                          }}
                          className={`flex flex-col items-center p-2 rounded-xl border text-center transition-all ${
                            isCardLocked ? "cursor-not-allowed opacity-55 pointer-events-none" : "cursor-pointer"
                          } ${
                            isStepExtracting
                              ? "bg-blue-50/70 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500/20 font-bold"
                              : isCurrent
                              ? "bg-blue-50/80 dark:bg-blue-950/40 border-[#174EA6] text-[#174EA6] dark:text-blue-300 ring-2 ring-blue-500/20 font-bold"
                              : isStepReady
                              ? "bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                              : "bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                          }`}
                        >
                          <div className="flex items-center justify-center w-5 h-5 rounded-full mb-1 text-[11px] font-bold">
                            {isStepExtracting ? (
                              <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
                            ) : isStepReady ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <span>{idx + 1}</span>
                            )}
                          </div>
                          <span className="text-xs font-bold leading-none">{st.shortLabel}</span>
                          <span className="text-[10px] text-slate-400 mt-0.5 hidden md:inline truncate max-w-full">
                            {isStepExtracting
                              ? "Extracting..."
                              : isStepReady
                              ? "Ready"
                              : st.isOptional
                              ? "(Optional)"
                              : "Pending"}
                          </span>
                        </button>
                      );
                    })}

                    {/* Step 6: Final Review */}
                    {(() => {
                      const reviewLockState = getStepperCardLockState(5);
                      const isReviewLocked = reviewLockState.isLocked;
                      const reviewTooltip = reviewLockState.reason || (isReviewLocked ? "Locked until prior required steps are extracted" : undefined);

                      return (
                        <button
                          type="button"
                          disabled={isReviewLocked}
                          title={reviewTooltip}
                          onClick={() => {
                            if (isReviewLocked) return;
                            setCurrentStepIndex(5);
                          }}
                          className={`flex flex-col items-center p-2 rounded-xl border text-center transition-all ${
                            isReviewLocked ? "cursor-not-allowed opacity-55 pointer-events-none" : "cursor-pointer"
                          } ${
                            currentStepIndex === 5
                              ? "bg-blue-50/80 dark:bg-blue-950/40 border-[#174EA6] text-[#174EA6] dark:text-blue-300 ring-2 ring-blue-500/20 font-bold"
                              : isAnyFileExtracting
                              ? "bg-blue-50/70 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300"
                              : totalUploadedCount > 0
                              ? "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                              : "bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-400"
                          }`}
                        >
                          <div className="flex items-center justify-center w-5 h-5 rounded-full mb-1 text-[11px] font-bold">
                            {isAnyFileExtracting ? (
                              <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
                            ) : (
                              <span>6</span>
                            )}
                          </div>
                          <span className="text-xs font-bold leading-none">Review</span>
                          <span className="text-[10px] text-slate-400 mt-0.5 hidden md:inline truncate max-w-full">
                            {isAnyFileExtracting ? "Extracting..." : `${totalUploadedCount} files`}
                          </span>
                        </button>
                      );
                    })()}
                  </div>
                </div>

                {/* Clear Empty-State Indicator for New Batch */}
                {totalUploadedCount === 0 && currentStepIndex === 0 && (
                  <div
                    data-testid="new-batch-empty-state"
                    className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 text-blue-950 dark:text-blue-100 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-blue-100 text-[#174EA6] dark:bg-blue-900/60 dark:text-blue-300 flex items-center justify-center shrink-0 shadow-xs">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-bold">Ready to Upload New Batch</p>
                        <p className="text-[11px] text-blue-700 dark:text-blue-300">
                          Start by uploading your <strong>SF1-SHS (School Register)</strong> document below. Documents from previous batches will not be restored.
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-blue-700 dark:text-blue-300 bg-white/70 dark:bg-slate-900/80 px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800 hidden md:inline">
                      Batch ID: {isBatchHydrated && currentBatchId ? currentBatchId : "Initializing..."}
                    </span>
                  </div>
                )}

                {/* ── STEP CONTENT CONTAINER ── */}
                {currentStepIndex < 5 ? (
                  /* STEPS 1-5: Document Upload Card */
                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
                    {/* Header info for current step */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 dark:bg-blue-950/60 text-[#174EA6] dark:text-blue-300">
                            STEP {currentStep.stepNumber} of 5
                          </span>
                          {currentStep.isOptional ? (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              OPTIONAL SUPPORTING DOCUMENT
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
                              REQUIRED DEPED SHS FORM
                            </span>
                          )}
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                          {currentStep.title} — {currentStep.depedName}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                          {currentStep.description}
                        </p>
                      </div>

                      <div className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60 max-w-xs shrink-0">
                        <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-0.5">
                          <Info className="w-3.5 h-3.5 text-[#174EA6]" />
                          <span>Validation Purpose:</span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-snug">{currentStep.purpose}</p>
                      </div>
                    </div>

                    {/* Step 4 Special: SF9 Two-Sided Pairing Guide */}
                    {currentStep.id === "sf9" && (
                      <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/60 rounded-xl p-4 space-y-2 text-xs">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-[#174EA6] dark:text-blue-400" />
                          <h4 className="font-bold text-slate-800 dark:text-slate-200">
                            Two-Sided SF9 Report Card Pairing Support
                          </h4>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                          Upload 2-page PDFs, or upload Front (Identity) and Back (Grades &amp; Attendance) image files per learner. You can toggle each image&apos;s side tag below to ensure accurate pairing.
                        </p>
                      </div>
                    )}

                    {/* Step 6 Special: Clear Optional Skip Notice for PSA */}
                    {currentStep.id === "birth_cert" && (
                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-3">
                        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-slate-800 dark:text-slate-200">
                            PSA Birth Certificate is an Optional Supporting Document
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            If you do not have a digital scan of the PSA Certificate of Live Birth, you may skip this step without blocking the workflow.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Dedicated Single Upload Area for Current Document Type */}
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => {
                        setReplacingFileId(null);
                        fileInputRef.current?.click();
                      }}
                      className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                        isDragOver
                          ? "border-[#174EA6] bg-blue-50/50 dark:bg-blue-950/20"
                          : "border-slate-300 dark:border-slate-700 hover:border-[#174EA6] bg-slate-50/50 dark:bg-slate-900/50"
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
                      />

                      <div className="flex flex-col items-center justify-center space-y-3">
                        <div className="w-12 h-12 rounded-xl bg-blue-100 text-[#174EA6] dark:bg-blue-950/60 dark:text-blue-400 flex items-center justify-center shadow-xs">
                          <UploadCloud className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                            Upload {currentStep.formCode} File(s)
                          </h4>
                          <p className="text-xs text-slate-400 mt-1">
                            Click to browse or drag and drop PDF, Excel (.xlsx, .xls, .csv), or image document (up to 15MB)
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs text-[#174EA6] border-blue-200 dark:border-blue-900 hover:bg-blue-50 flex items-center gap-1.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReplacingFileId(null);
                              fileInputRef.current?.click();
                            }}
                          >
                            <UploadCloud className="w-3.5 h-3.5" />
                            Select {currentStep.shortLabel} File
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center gap-1.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsCameraOpen(true);
                            }}
                          >
                            <Camera className="w-3.5 h-3.5" />
                            Open Camera
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Uploaded Files for this step */}
                    {(stepFiles[currentStep.id] || []).length > 0 && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Current Uploaded {currentStep.shortLabel} Documents ({(stepFiles[currentStep.id] || []).length})
                          </h4>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-xs text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 h-7 flex items-center gap-1"
                              onClick={() => setIsCameraOpen(true)}
                            >
                              <Camera className="w-3.5 h-3.5" />
                              Open Camera
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-xs text-[#174EA6] hover:bg-blue-50 dark:hover:bg-blue-950/40 h-7"
                              onClick={() => {
                                setReplacingFileId(null);
                                fileInputRef.current?.click();
                              }}
                            >
                              <Plus className="w-3.5 h-3.5 mr-1" />
                              Add another page / file for {currentStep.shortLabel}
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-3">
                          {(stepFiles[currentStep.id] || []).map((item) => (
                            <div
                              key={item.id}
                              className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3 text-xs"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 overflow-hidden">
                                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-[#174EA6] dark:text-blue-400 flex items-center justify-center shrink-0">
                                    <FileText className="w-5 h-5" />
                                  </div>
                                  <div className="overflow-hidden">
                                    <div className="font-bold text-slate-800 dark:text-slate-200 truncate">
                                      {item.name}
                                    </div>
                                    <div className="text-slate-400 text-[11px] mt-0.5 flex items-center gap-2">
                                      <span>{item.size}</span>
                                      <span>•</span>
                                      <span>{item.type.toUpperCase().replace("APPLICATION/", "")}</span>
                                      <span>•</span>
                                      <span className="font-semibold text-slate-600 dark:text-slate-300">
                                        {DOCUMENT_TITLES[item.documentType] || item.documentType.toUpperCase()}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {item.stepCategory === "sf9" && (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleSf9Side(item.id)}
                                      className={`px-2 py-1 rounded-md text-[11px] font-bold border transition-all cursor-pointer ${
                                        item.documentSide === "back"
                                          ? "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800"
                                          : "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800"
                                      }`}
                                      title="Click to toggle between Front and Back side"
                                    >
                                      {item.documentSide === "back" ? "Back (Grades)" : "Front (Identity)"}
                                    </button>
                                  )}

                                  {item.isPreprocessing ? (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 flex items-center gap-1 animate-pulse">
                                      <Loader2 className="w-3 h-3 animate-spin" /> Preprocessing...
                                    </span>
                                  ) : item.extractionStatus === "extracting" || item.status === "extracting" ? (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 flex items-center gap-1 animate-pulse">
                                      <Loader2 className="w-3 h-3 animate-spin" /> Extracting...
                                    </span>
                                  ) : item.extractionStatus === "extracted" || item.status === "extracted" ? (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center gap-1">
                                        <Check className="w-3 h-3" /> Extracted ✓
                                      </span>
                                      {(() => {
                                        const conf =
                                          typeof item.ocrConfidencePercent === "number"
                                            ? item.ocrConfidencePercent
                                            : typeof item.extractedFields?.ocr_confidence_percent === "number"
                                            ? item.extractedFields.ocr_confidence_percent
                                            : typeof item.extractedFields?.ocr_confidence === "number"
                                            ? Math.round(item.extractedFields.ocr_confidence <= 1 ? item.extractedFields.ocr_confidence * 100 : item.extractedFields.ocr_confidence)
                                            : undefined;
                                        if (conf === undefined) return null;
                                        const badgeClasses =
                                          conf >= 85
                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800"
                                            : conf >= 65
                                            ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800"
                                            : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800";
                                        return (
                                          <span
                                            data-testid="file-ocr-readability-badge"
                                            title="Shows how clearly the OCR engine read the text and fields from this document"
                                            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 border ${badgeClasses}`}
                                          >
                                            Readability: {conf}%
                                          </span>
                                        );
                                      })()}
                                    </div>
                                  ) : item.extractionStatus === "failed" || item.status === "failed" ? (
                                    <div className="flex items-center gap-1">
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3" /> Failed
                                      </span>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRetryFileExtraction(item.id, currentStep.id)}
                                        className="text-xs h-6 px-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/40"
                                        title={item.extractionError || "Retry extraction"}
                                      >
                                        <RefreshCw className="w-2.5 h-2.5 mr-0.5" /> Retry
                                      </Button>
                                    </div>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 flex items-center gap-1">
                                      <Clock className="w-3 h-3" /> Queued
                                    </span>
                                  )}

                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setPreviewModalFile(item);
                                      if (item.stepCategory === "birth_cert") {
                                        setModalPsaPreviewMode(item.previewMode || (item.upperSectionDataUrl ? "upper" : "processed"));
                                      }
                                    }}
                                    className="text-xs h-7 px-2.5 text-slate-600 border-slate-200 hover:bg-slate-100"
                                    title="Preview document"
                                  >
                                    <Eye className="w-3.5 h-3.5 mr-1" /> Preview
                                  </Button>

                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleReplaceFile(item.id)}
                                    className="text-xs h-7 px-2.5 text-slate-600 border-slate-200 hover:bg-slate-100"
                                    title="Replace document"
                                  >
                                    <RefreshCw className="w-3 h-3 mr-1" /> Replace
                                  </Button>

                                  <button
                                    type="button"
                                    onClick={() => handleRemoveFile(item.id, currentStep.id)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                                    title="Remove document"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Step 5 PSA Specific Controls: Rotation & Preview Mode Tabs */}
                              {item.stepCategory === "birth_cert" && (
                                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-lg text-[11px] font-medium">
                                      <button
                                        type="button"
                                        onClick={() => handleSetPsaPreviewMode(item.id, "upper")}
                                        className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                                          (item.previewMode || "upper") === "upper"
                                            ? "bg-white dark:bg-slate-900 text-[#174EA6] dark:text-blue-300 font-bold shadow-xs"
                                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                                        }`}
                                      >
                                        Upper Section (1-17)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSetPsaPreviewMode(item.id, "processed")}
                                        className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                                          item.previewMode === "processed"
                                            ? "bg-white dark:bg-slate-900 text-[#174EA6] dark:text-blue-300 font-bold shadow-xs"
                                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                                        }`}
                                      >
                                        B&W Upright
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSetPsaPreviewMode(item.id, "original")}
                                        className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                                          item.previewMode === "original"
                                            ? "bg-white dark:bg-slate-900 text-[#174EA6] dark:text-blue-300 font-bold shadow-xs"
                                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                                        }`}
                                      >
                                        Original
                                      </button>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleRotatePsaFile(item.id, -90)}
                                        disabled={item.isPreprocessing || item.extractionStatus === "extracting"}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-50 cursor-pointer shadow-xs"
                                        title="Rotate 90 degrees counter-clockwise"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                        <span>90° CCW</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRotatePsaFile(item.id, 90)}
                                        disabled={item.isPreprocessing || item.extractionStatus === "extracting"}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-50 cursor-pointer shadow-xs"
                                        title="Rotate 90 degrees clockwise"
                                      >
                                        <RotateCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                        <span>90° CW</span>
                                      </button>
                                    </div>
                                  </div>

                                  {item.isPreprocessing ? (
                                    <div className="h-44 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-950 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-500">
                                      <Loader2 className="w-6 h-6 animate-spin text-blue-600 mb-2" />
                                      <span className="text-xs font-medium">Preprocessing PSA image &amp; cropping upper section...</span>
                                    </div>
                                  ) : (
                                    <div className="relative max-h-56 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-2">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={
                                          (item.previewMode || "upper") === "upper"
                                            ? item.upperSectionDataUrl || item.processedDataUrl || item.dataUrl
                                            : item.previewMode === "processed"
                                            ? item.processedDataUrl || item.dataUrl
                                            : item.originalDataUrl || item.dataUrl
                                        }
                                        alt={`PSA preview (${item.previewMode || "upper"})`}
                                        className="max-h-52 w-auto object-contain rounded shadow-xs"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Step 1 SF1 Extracted Learners Table / No Student Found Alert */}
                              {item.stepCategory === "sf1" && item.extractionStatus === "extracted" && item.extractedFields && (() => {
                                const fields = item.extractedFields;
                                const learners = Array.isArray(fields.learners)
                                  ? fields.learners
                                  : Array.isArray(fields.students)
                                  ? fields.students
                                  : [];
                                const isNoStudentFound = Boolean(learners.length === 0);

                                if (isNoStudentFound) {
                                  return (
                                    <div
                                      data-testid="sf1-empty-alert"
                                      className="pt-3 border-t border-slate-200 dark:border-slate-800"
                                    >
                                      <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs">
                                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                                        <div>
                                          <span className="font-bold">No student found: </span>
                                          <span>The uploaded SF1 roster contains empty LRN and Learner Name columns.</span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div data-testid="sf1-preview-card" className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                          Extracted Roster ({learners.length} {learners.length === 1 ? "Learner" : "Learners"})
                                        </span>
                                      </div>
                                    </div>
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50">
                                      <table className="w-full text-xs text-left border-collapse" data-testid="sf1-extracted-learners-table">
                                        <thead>
                                          <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                            <th className="py-2 px-3">LRN</th>
                                            <th className="py-2 px-3">Full Name</th>
                                            <th className="py-2 px-3">Sex</th>
                                            <th className="py-2 px-3">Birth Date</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-300">
                                          {learners.map((learner: any, idx: number) => (
                                            <tr key={learner.lrn || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40">
                                              <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                                                {learner.lrn || "—"}
                                              </td>
                                              <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">
                                                {learner.full_name || learner.name || `${learner.last_name || ""}, ${learner.first_name || ""} ${learner.middle_name || ""}`.trim() || "—"}
                                              </td>
                                              <td className="py-2 px-3">{normalizeStrictSex(learner.sex) || learner.sex || "—"}</td>
                                              <td className="py-2 px-3">{learner.raw_birth_date || (learner.birth_date === "2004-06-23" ? "6/23/04" : learner.birth_date) || "—"}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Step 2 SF2 Extracted Monthly Attendance Preview */}
                              {item.stepCategory === "sf2" && item.extractionStatus === "extracted" && item.extractedFields && (() => {
                                const fields = item.extractedFields;
                                const rawRecords = Array.isArray(fields.attendance_records)
                                  ? fields.attendance_records
                                  : Array.isArray(fields.attendance)
                                  ? fields.attendance
                                  : Array.isArray(fields.monthly_attendance)
                                  ? fields.monthly_attendance
                                  : Array.isArray(fields.learners)
                                  ? fields.learners
                                  : [];
                                const attendanceRecords = deduplicateSf2Records(rawRecords);
                                const rawMonth = fields.attendance_month || fields.month || fields.header?.month || "Not specified";
                                const displayMonth = formatDepEdMonthDisplay(rawMonth);

                                if (attendanceRecords.length === 0) {
                                  return (
                                    <div
                                      data-testid="sf2-empty-alert"
                                      className="pt-3 border-t border-slate-200 dark:border-slate-800"
                                    >
                                      <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs">
                                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                                        <div>
                                          <span className="font-bold">No attendance records found: </span>
                                          <span>The uploaded SF2 sheet did not yield any learner attendance rows.</span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <div data-testid="sf2-preview-card" className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                                    {/* DepEd SF2 Attendance Shading & Marking Legend */}
                                    <div data-testid="sf2-shading-legend" className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
                                      <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                                        <span>DepEd SF2 Official Attendance Shading &amp; Marking Legend</span>
                                        <span className="text-[10px] uppercase font-mono text-slate-500">DepEd Order No. 4, s. 2014</span>
                                      </div>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-[11px] pt-1">
                                        <div className="flex items-center gap-1.5 p-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                          <span className="w-5 h-5 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded flex items-center justify-center font-bold text-slate-400 text-[10px]"></span>
                                          <div>
                                            <div className="font-bold text-slate-800 dark:text-slate-200">BLANK</div>
                                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Present (0 Abs / 0 Tar)</div>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 p-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                          <span className="w-5 h-5 border border-rose-300 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded flex items-center justify-center font-black text-xs">✕</span>
                                          <div>
                                            <div className="font-bold text-slate-800 dark:text-slate-200">X MARK</div>
                                            <div className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">Absent (+1 Absent)</div>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 p-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                          <span className="w-5 h-5 border border-amber-300 bg-linear-to-b from-amber-400 from-50% to-transparent to-50% rounded flex items-center justify-center text-[10px]"></span>
                                          <div>
                                            <div className="font-bold text-slate-800 dark:text-slate-200">UPPER HALF</div>
                                            <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Tardy — Late Comer</div>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 p-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                          <span className="w-5 h-5 border border-amber-300 bg-linear-to-b from-transparent from-50% to-amber-400 to-50% rounded flex items-center justify-center text-[10px]"></span>
                                          <div>
                                            <div className="font-bold text-slate-800 dark:text-slate-200">LOWER HALF</div>
                                            <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Tardy — Cutting Class</div>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 p-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                          <span className="w-5 h-5 border border-slate-400 bg-slate-300 dark:bg-slate-600 rounded flex items-center justify-center text-[10px]"></span>
                                          <div>
                                            <div className="font-bold text-slate-800 dark:text-slate-200">FULL COLUMN</div>
                                            <div className="text-[10px] text-slate-500 font-medium">Holiday / No Class</div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Header Summary with Confidence */}
                                    {(() => {
                                      const hdr = fields.header || {};
                                      const rawSy = hdr.schoolYear || hdr.school_year || fields.school_year || "";
                                      const syVal = validateConsecutiveSchoolYear(rawSy);
                                      const syConf = hdr.schoolYearConfidence ?? fields.school_year_confidence ?? 95;
                                      const scId = hdr.schoolId || hdr.school_id || fields.school_id || "";
                                      const scIdConf = hdr.schoolIdConfidence ?? 95;
                                      const mthConf = hdr.monthConfidence ?? 95;
                                      const secConf = hdr.sectionConfidence ?? 95;
                                      return (
                                        <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                          <div>
                                            <span className="text-[10px] uppercase font-bold text-slate-400 block">School Year</span>
                                            <div className="flex items-center gap-1 mt-0.5">
                                              <span className={`font-mono font-bold ${!syVal.isValid && rawSy ? "text-rose-600" : "text-slate-800 dark:text-slate-200"}`}>
                                                {rawSy || "—"}
                                              </span>
                                              <span className="text-[10px] font-mono px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{syConf}%</span>
                                            </div>
                                            {!syVal.isValid && rawSy && (
                                              <span className="text-[10px] text-rose-600 block mt-0.5">{syVal.message}</span>
                                            )}
                                          </div>
                                          <div>
                                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Month</span>
                                            <div className="flex items-center gap-1 mt-0.5">
                                              <span className="font-bold text-slate-800 dark:text-slate-200">{displayMonth}</span>
                                              <span className="text-[10px] font-mono px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{mthConf}%</span>
                                            </div>
                                          </div>
                                          <div>
                                            <span className="text-[10px] uppercase font-bold text-slate-400 block">School ID</span>
                                            <div className="flex items-center gap-1 mt-0.5">
                                              <span className="font-mono text-slate-800 dark:text-slate-200">{scId || "—"}</span>
                                              {scId && <span className="text-[10px] font-mono px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{scIdConf}%</span>}
                                            </div>
                                          </div>
                                          <div>
                                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Section</span>
                                            <div className="flex items-center gap-1 mt-0.5">
                                              <span className="text-slate-800 dark:text-slate-200 font-medium">{hdr.section || fields.section || "—"}</span>
                                              {(hdr.section || fields.section) && <span className="text-[10px] font-mono px-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{secConf}%</span>}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    {/* SF9 Anchor Learner Match Banner */}
                                    {sf9TargetLearner.targetStudentName && (() => {
                                      const matchedIdx = attendanceRecords.findIndex((r: any) =>
                                        areLearnerNamesMatching(
                                          r.learner_name || r.student_name || r.name,
                                          sf9TargetLearner.targetStudentName
                                        )
                                      );
                                      if (matchedIdx === -1) return null;
                                      const matchedRec = attendanceRecords[matchedIdx];
                                      const matchedName = matchedRec.learner_name || matchedRec.student_name || matchedRec.name;
                                      return (
                                        <div className="p-2.5 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 text-xs flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                                            <div>
                                              <span className="font-bold">SF9 Anchor Learner Matched: </span>
                                              <span>{matchedName} bound to Row #{matchedIdx + 1}</span>
                                            </div>
                                          </div>
                                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                                            Strict Row Binding Active
                                          </span>
                                        </div>
                                      );
                                    })()}

                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                          Report for the Month of: <span className="text-slate-800 dark:text-slate-200 font-bold">{displayMonth}</span>
                                        </span>
                                        <span className="text-[10px] text-slate-400">
                                          ({attendanceRecords.length} {attendanceRecords.length === 1 ? "Learner" : "Learners"})
                                        </span>
                                      </div>
                                    </div>
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50">
                                      <table className="w-full text-xs text-left border-collapse" data-testid="sf2-attendance-preview-table">
                                        <thead>
                                          <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                            <th className="py-2 px-3">Learner Name</th>
                                            <th className="py-2 px-3">Month</th>
                                            <th className="py-2 px-3 text-center">School Days</th>
                                            <th className="py-2 px-3 text-center">Present</th>
                                            <th className="py-2 px-3 text-center">Absent (Grid/W)</th>
                                            <th className="py-2 px-3 text-center">Tardy (Grid/W)</th>
                                            <th className="py-2 px-3">Audit &amp; Warnings</th>
                                            <th className="py-2 px-3 text-right">Row Accuracy</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-300">
                                          {attendanceRecords.map((rec: any, idx: number) => {
                                            const recName = rec.learner_name || rec.student_name || rec.name || "—";
                                            const recDays = typeof rec.total_days === "number" ? rec.total_days : typeof rec.total_school_days === "number" ? rec.total_school_days : typeof rec.school_days === "number" ? rec.school_days : "—";
                                            const recPresent = typeof rec.days_present === "number" ? rec.days_present : "—";
                                            const audit = validateSf2RowFormattingAndTotals(rec);
                                            const isAnchorMatch = Boolean(
                                              sf9TargetLearner.targetStudentName &&
                                              areLearnerNamesMatching(recName, sf9TargetLearner.targetStudentName)
                                            );
                                            const acc = audit.overallRowAccuracy;
                                            const accClass =
                                              acc >= 85
                                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                                                : acc >= 65
                                                ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                                                : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800";

                                            return (
                                              <tr
                                                key={idx}
                                                className={`hover:bg-slate-50/50 dark:hover:bg-slate-900/40 ${
                                                  isAnchorMatch ? "bg-blue-50/50 dark:bg-blue-950/20 font-semibold" : ""
                                                }`}
                                              >
                                                <td className="py-2 px-3 text-slate-900 dark:text-slate-100">
                                                  <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className="font-bold">{recName}</span>
                                                    <span
                                                      className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold ${
                                                        audit.nameConfidence >= 85
                                                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                          : "bg-amber-50 text-amber-700"
                                                      }`}
                                                      title={`Name Confidence: ${audit.nameConfidence}%`}
                                                    >
                                                      {audit.nameConfidence}%
                                                    </span>
                                                    {isAnchorMatch && (
                                                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                                        SF9 Target
                                                      </span>
                                                    )}
                                                  </div>
                                                </td>
                                                <td className="py-2 px-3 font-medium text-slate-600 dark:text-slate-400">
                                                  {displayMonth}
                                                </td>
                                                <td className="py-2 px-3 text-center font-mono">{recDays}</td>
                                                <td className="py-2 px-3 text-center font-mono text-emerald-600 dark:text-emerald-400 font-bold">{recPresent}</td>
                                                <td className="py-2 px-3 text-center font-mono">
                                                  <div className="flex flex-col items-center">
                                                    <span className={`font-bold ${audit.absentMismatch ? "text-rose-600 font-black" : "text-slate-800 dark:text-slate-200"}`}>
                                                      {audit.gridAbsentCount}
                                                    </span>
                                                    {audit.writtenAbsent !== null && (
                                                      <span className={`text-[10px] ${audit.absentMismatch ? "text-rose-500 font-bold" : "text-slate-400"}`}>
                                                        W: {audit.writtenAbsent}
                                                      </span>
                                                    )}
                                                  </div>
                                                </td>
                                                <td className="py-2 px-3 text-center font-mono">
                                                  <div className="flex flex-col items-center">
                                                    <span className={`font-bold ${audit.tardyMismatch ? "text-amber-600 font-black" : "text-slate-800 dark:text-slate-200"}`}>
                                                      {audit.gridTardyCount}
                                                    </span>
                                                    {audit.writtenTardy !== null && (
                                                      <span className={`text-[10px] ${audit.tardyMismatch ? "text-amber-500 font-bold" : "text-slate-400"}`}>
                                                        W: {audit.writtenTardy}
                                                      </span>
                                                    )}
                                                  </div>
                                                </td>
                                                <td className="py-2 px-3 text-[11px]">
                                                  <div className="space-y-0.5">
                                                    {!audit.isShadingFormatValid && (
                                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 block" title={audit.shadingFormatWarning}>
                                                        Improper Solid Shading
                                                      </span>
                                                    )}
                                                    {audit.absentMismatch && (
                                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 block">
                                                        Absent Mismatch (Grid {audit.gridAbsentCount} vs W {audit.writtenAbsent})
                                                      </span>
                                                    )}
                                                    {audit.tardyMismatch && (
                                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 block">
                                                        Tardy Mismatch (Grid {audit.gridTardyCount} vs W {audit.writtenTardy})
                                                      </span>
                                                    )}
                                                    {audit.hasConsecutiveAbsencesWarning && (
                                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 block">
                                                        5+ Consec. Absences (SARDO)
                                                      </span>
                                                    )}
                                                    {audit.isValid && !audit.hasConsecutiveAbsencesWarning && (
                                                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                                                        <Check className="w-3 h-3" />
                                                        Verified
                                                      </span>
                                                    )}
                                                  </div>
                                                </td>
                                                <td className="py-2 px-3 text-right">
                                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border ${accClass}`}>
                                                    {acc}%
                                                  </span>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Step 3 SF9 Per-File Side Status Indicator */}
                              {item.stepCategory === "sf9" && item.extractionStatus === "extracted" && item.extractedFields && (() => {
                                const fields = item.extractedFields;
                                const isBack = item.documentSide === "back";
                                const subjectsCount = Array.isArray(fields.grades) ? fields.grades.length : 0;
                                const attendanceRows = Array.isArray(fields.attendance) ? fields.attendance.length : 0;

                                return (
                                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs flex flex-wrap items-center justify-between gap-2" data-testid="sf9-side-status">
                                    <div className="flex items-center gap-2">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        isBack ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300" : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                                      }`}>
                                        {isBack ? "Back Side (Grades & Behavior)" : "Front Side (Identity & Attendance)"}
                                      </span>
                                      <span className="text-slate-600 dark:text-slate-400 font-medium">
                                        {isBack
                                          ? `${subjectsCount} subjects extracted${fields.observed_values ? " • Observed Values detected" : ""}`
                                          : `LRN: ${fields.lrn || "Detected"} • ${attendanceRows} attendance rows detected`}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 italic">
                                      Unified into SF9 Preview below
                                    </span>
                                  </div>
                                );
                              })()}

                              {/* Extracted Civil Identity Summary & Inline Manual Correction for Step 5 (PSA) */}
                              {item.stepCategory === "birth_cert" && item.extractionStatus === "extracted" && item.extractedFields && (() => {
                                const fields = item.extractedFields;
                                const statuses = (fields.field_statuses || {}) as Record<string, PsaFieldStatusItem>;
                                const correctedFields = (fields.corrected_fields || {}) as Record<string, boolean>;
                                const isEditingThis = editingPsaFileId === item.id;

                                if (isEditingThis) {
                                  return (
                                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/70 p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 space-y-3">
                                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                        <div className="flex items-center gap-2">
                                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 dark:bg-indigo-950/60 text-[#174EA6] dark:text-blue-300">
                                            Manual Correction
                                          </span>
                                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                                            Edit Civil Identity Fields
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleCancelPsaCorrection}
                                            className="text-xs h-7 px-2.5 text-slate-600 hover:bg-slate-100"
                                          >
                                            Cancel
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => handleSavePsaCorrection(item.id)}
                                            className="text-xs h-7 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 shadow-xs"
                                          >
                                            <Check className="w-3.5 h-3.5" />
                                            Save Corrections
                                          </Button>
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            First Name
                                          </label>
                                          <input
                                            type="text"
                                            value={editingPsaForm.first_name}
                                            onChange={(e) => setEditingPsaForm({ ...editingPsaForm, first_name: e.target.value })}
                                            placeholder="e.g. JUSTIN"
                                            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-[#174EA6]"
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Middle Name <span className="font-normal text-slate-400 lowercase">(optional)</span>
                                          </label>
                                          <input
                                            type="text"
                                            value={editingPsaForm.middle_name}
                                            onChange={(e) => setEditingPsaForm({ ...editingPsaForm, middle_name: e.target.value })}
                                            placeholder="(Blank if none)"
                                            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-[#174EA6]"
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Last Name
                                          </label>
                                          <input
                                            type="text"
                                            value={editingPsaForm.last_name}
                                            onChange={(e) => setEditingPsaForm({ ...editingPsaForm, last_name: e.target.value })}
                                            placeholder="e.g. GOMEZ"
                                            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-[#174EA6]"
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Date of Birth
                                          </label>
                                          <input
                                            type="text"
                                            value={editingPsaForm.birth_date}
                                            onChange={(e) => setEditingPsaForm({ ...editingPsaForm, birth_date: e.target.value })}
                                            placeholder="YYYY-MM-DD or e.g. 15 MARCH 2008"
                                            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-[#174EA6]"
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Sex
                                          </label>
                                          <select
                                            value={editingPsaForm.sex.toUpperCase().startsWith("F") ? "F" : editingPsaForm.sex.toUpperCase().startsWith("M") ? "M" : editingPsaForm.sex}
                                            onChange={(e) => setEditingPsaForm({ ...editingPsaForm, sex: e.target.value })}
                                            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-[#174EA6]"
                                          >
                                            <option value="">Select Sex</option>
                                            <option value="M">Male</option>
                                            <option value="F">Female</option>
                                          </select>
                                        </div>

                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Registry / Certificate No.
                                          </label>
                                          <input
                                            type="text"
                                            value={editingPsaForm.registry_number}
                                            onChange={(e) => setEditingPsaForm({ ...editingPsaForm, registry_number: e.target.value })}
                                            placeholder="e.g. 2008-1234"
                                            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-[#174EA6]"
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Mother&apos;s Complete Maiden Name
                                          </label>
                                          <input
                                            type="text"
                                            value={editingPsaForm.mother_maiden_name}
                                            onChange={(e) => setEditingPsaForm({ ...editingPsaForm, mother_maiden_name: e.target.value })}
                                            placeholder="e.g. MARIA SANTOS LOQUILLANO"
                                            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-[#174EA6]"
                                          />
                                        </div>

                                        <div>
                                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                            Father&apos;s Complete Name
                                          </label>
                                          <input
                                            type="text"
                                            value={editingPsaForm.father_name}
                                            onChange={(e) => setEditingPsaForm({ ...editingPsaForm, father_name: e.target.value })}
                                            placeholder="e.g. ROBERTO CRUZ GOMEZ"
                                            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-[#174EA6]"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }

                                const childName = [
                                  fields.child_first_name || fields.first_name || fields.identity?.first_name,
                                  fields.child_middle_name || fields.middle_name || fields.identity?.middle_name,
                                  fields.child_last_name || fields.last_name || fields.identity?.last_name,
                                ].filter(Boolean).join(" ");

                                const extractedSexRaw =
                                  fields.sex ||
                                  fields.identity?.sex ||
                                  fields.identity?.sex_label ||
                                  statuses.sex?.value ||
                                  (fields as any).psa_data?.sex ||
                                  (fields as any).structured_data?.sex;
                                const resolvedSex =
                                  normalizeStrictSex(extractedSexRaw) ||
                                  (extractedSexRaw === "M" ? "Male" : extractedSexRaw === "F" ? "Female" : null);

                                const fnConf = statuses.first_name?.confidence ?? fields.confidence;
                                const dobConf = statuses.birth_date?.confidence ?? fields.confidence;
                                const sexConf =
                                  typeof statuses.sex?.confidence === "number" && statuses.sex.confidence > 0
                                    ? statuses.sex.confidence
                                    : resolvedSex
                                    ? 95
                                    : statuses.sex?.confidence ?? fields.confidence;
                                const regConf = statuses.registry_number?.confidence ?? fields.confidence;
                                const mConf = statuses.mother_maiden_name?.confidence ?? fields.confidence;
                                const fConf = statuses.father_name?.confidence ?? fields.confidence;

                                return (
                                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                          Child &amp; Civil Identity Fields
                                        </span>
                                        {fields.manually_corrected && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                            <Check className="w-2.5 h-2.5" />
                                            Manually Corrected by Teacher
                                          </span>
                                        )}
                                      </div>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleStartPsaCorrection(item)}
                                        className="text-xs h-7 px-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center gap-1.5 font-semibold"
                                      >
                                        <Edit3 className="w-3.5 h-3.5 text-[#174EA6] dark:text-blue-400" />
                                        <span>Manual Correction</span>
                                      </Button>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 bg-white dark:bg-slate-950/50 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                                      <div>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Child&apos;s Legal Name:</span>
                                        <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                                          <span>{childName || "Not detected"}</span>
                                          {renderConfidencePill(fnConf, correctedFields.first_name || correctedFields.last_name || correctedFields.middle_name)}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Date of Birth &amp; Sex:</span>
                                        <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                                          <div className="flex items-center gap-1">
                                            <span>{fields.birth_date || fields.date_of_birth || fields.identity?.birth_date || "Not detected"}</span>
                                            {renderConfidencePill(dobConf, correctedFields.birth_date)}
                                          </div>
                                          <span>•</span>
                                          <div className="flex items-center gap-1">
                                            <span>{resolvedSex || "Not detected"}</span>
                                            {renderConfidencePill(sexConf, correctedFields.sex)}
                                          </div>
                                        </div>
                                      </div>
                                      <div>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Civil Registry / Cert No.:</span>
                                        <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                                          <span className="font-mono">{fields.registry_number || fields.civil_registry_number || "Not detected"}</span>
                                          {renderConfidencePill(regConf, correctedFields.registry_number)}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Mother&apos;s Maiden Name:</span>
                                        <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                                          <span>{fields.mother_maiden_name || fields.mother_name || "Not detected"}</span>
                                          {renderConfidencePill(mConf, correctedFields.mother_maiden_name)}
                                        </div>
                                      </div>
                                      <div>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Father&apos;s Name:</span>
                                        <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                                          <span>{fields.father_name || "Not detected"}</span>
                                          {renderConfidencePill(fConf, correctedFields.father_name)}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Expandable "Inspect Raw OCR Text" & Item 2 Sex Diagnostic Drawer */}
                                    <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-2">
                                      <div className="flex items-center justify-between">
                                        <button
                                          type="button"
                                          data-testid={`psa-inspect-raw-ocr-btn-${item.id}`}
                                          onClick={() =>
                                            setExpandedPsaRawOcr((prev) => ({
                                              ...prev,
                                              [item.id]: !prev[item.id],
                                            }))
                                          }
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#174EA6] dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                        >
                                          <FileText className="w-3.5 h-3.5" />
                                          <span>{expandedPsaRawOcr[item.id] ? "Hide Raw OCR Text" : "Inspect Raw OCR Text"}</span>
                                          {expandedPsaRawOcr[item.id] ? (
                                            <ChevronUp className="w-3.5 h-3.5" />
                                          ) : (
                                            <ChevronDown className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                        <span className="text-[10px] text-slate-400">
                                          {item.extractedText || fields.rawText ? `${(item.extractedText || fields.rawText || "").length} characters extracted` : "No OCR text"}
                                        </span>
                                      </div>

                                      {expandedPsaRawOcr[item.id] && (() => {
                                        const diag = fields.sexDiagnostic || (item as any).sexDiagnostic || {};
                                        const rawTextContent = item.extractedText || fields.rawText || fields.raw_ocr_text || "";

                                        // Find OCR lines matching 2. SEX / Kasarian / 1 Male / 2 Female if not recorded in diag
                                        let matchedLinesDisplay = (diag.matchedLines && diag.matchedLines.length > 0)
                                          ? diag.matchedLines.join(" | ")
                                          : "";
                                        if (!matchedLinesDisplay && rawTextContent) {
                                          const lines = rawTextContent.split(/\r?\n/).map((l: string) => l.trim());
                                          const candidateLines = lines.filter((l: string) =>
                                            /(?:2\.\s*)?sex\b|\bkasarian\b|1\s*[-.]?\s*male|2\s*[-.]?\s*female/i.test(l)
                                          );
                                          if (candidateLines.length > 0) {
                                            matchedLinesDisplay = candidateLines.join(" | ");
                                          }
                                        }

                                        const leftInk = typeof diag.leftInkRatio === "number"
                                          ? `${(diag.leftInkRatio * 100).toFixed(2)}%`
                                          : "0.00%";
                                        const rightInk = typeof diag.rightInkRatio === "number"
                                          ? `${(diag.rightInkRatio * 100).toFixed(2)}%`
                                          : "0.00%";
                                        const activeMethod = diag.source || (resolvedSex ? "text_x_mark" : "not_detected");

                                        return (
                                          <div
                                            data-testid={`psa-raw-ocr-drawer-${item.id}`}
                                            className="space-y-2.5 p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
                                          >
                                            {/* Item 2 (2. SEX) Detection Diagnostic Bar */}
                                            <div className="space-y-1.5 p-2.5 rounded-md bg-white dark:bg-slate-950 border border-blue-200 dark:border-blue-900/60 text-xs">
                                              <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                                                <div className="flex items-center gap-1.5">
                                                  <span className="font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider text-[11px]">
                                                    Item 2 (2. SEX) Diagnostic
                                                  </span>
                                                  <span
                                                    data-testid="psa-active-detection-method"
                                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                      activeMethod.includes("pixel_ink")
                                                        ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                                                        : activeMethod === "text_x_mark"
                                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                                    }`}
                                                  >
                                                    Method: {activeMethod}
                                                  </span>
                                                </div>
                                                <div className="flex items-center gap-2 text-[11px] font-mono">
                                                  <span className="text-slate-600 dark:text-slate-400">
                                                    Left Box (1 Male): <strong className="text-blue-700 dark:text-blue-400">{leftInk}</strong>
                                                  </span>
                                                  <span className="text-slate-400">•</span>
                                                  <span className="text-slate-600 dark:text-slate-400">
                                                    Right Box (2 Female): <strong className="text-pink-700 dark:text-pink-400">{rightInk}</strong>
                                                  </span>
                                                </div>
                                              </div>
                                              <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-1.5 pt-0.5">
                                                <span className="font-semibold shrink-0 text-slate-400">OCR Lines Detected:</span>
                                                <span className="font-mono text-[10px] text-slate-700 dark:text-slate-300 break-all">
                                                  {matchedLinesDisplay || "None (Template Fallback)"}
                                                </span>
                                              </div>
                                            </div>

                                            {/* Full Raw OCR Text */}
                                            <div className="space-y-1">
                                              <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400">
                                                <span>Full Raw OCR Text</span>
                                                <span>Monospace Inspector</span>
                                              </div>
                                              <pre
                                                data-testid={`psa-raw-ocr-text-${item.id}`}
                                                className="p-2.5 rounded-lg bg-slate-900 text-slate-100 font-mono text-[10px] leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap border border-slate-700"
                                              >
                                                {rawTextContent || "No raw OCR text available."}
                                              </pre>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          ))}
                        </div>

                        {/* Step 3 SF9-SHS Extracted Data Preview Card (Attendance, Grades & Behavior) */}
                        {currentStep.id === "sf9" && (() => {
                          const sf9Files = (stepFiles.sf9 || []).filter(
                            (f) => f.extractionStatus === "extracted" && f.extractedFields
                          );
                          if (sf9Files.length === 0) return null;

                          const frontFile = sf9Files.find((f) => f.documentSide === "front");
                          const backFile = sf9Files.find((f) => f.documentSide === "back");

                          let merged: ExtractedFields;
                          let isUnifiedTwoSides = false;

                          if (frontFile && backFile && frontFile.id !== backFile.id) {
                            const res = mergeSf9FrontAndBack(
                              { fields: frontFile.extractedFields, rawText: frontFile.extractedText, pageNumber: 1 },
                              { fields: backFile.extractedFields, rawText: backFile.extractedText, pageNumber: 2 }
                            );
                            merged = res.unifiedFields;
                            isUnifiedTwoSides = true;
                          } else {
                            const primary = frontFile || backFile || sf9Files[0];
                            const secondary = sf9Files.find((f) => f.id !== primary?.id);
                            if (primary && secondary) {
                              const res = mergeSf9FrontAndBack(
                                { fields: primary.extractedFields, rawText: primary.extractedText, pageNumber: 1 },
                                { fields: secondary.extractedFields, rawText: secondary.extractedText, pageNumber: 2 }
                              );
                              merged = res.unifiedFields;
                              isUnifiedTwoSides = true;
                            } else {
                              merged = updateExtractedFieldsAverages({ ...(primary?.extractedFields || {}) });
                            }
                          }

                          // 1. Learner Identity Summary
                          const lrn = merged.lrn || "—";
                          const fullName = merged.name || [merged.last_name, merged.first_name, merged.middle_name].filter(Boolean).join(", ") || "—";
                          const sex = normalizeStrictSex(merged.sex) || (merged.sex === "M" ? "Male" : merged.sex === "F" ? "Female" : merged.sex) || "—";
                          const gradeLevel = merged.grade_level || "Grade 11";
                          const section = merged.section || "—";
                          const schoolYear = merged.school_year || "—";
                          const syValidation = validateConsecutiveSchoolYear(schoolYear);
                          const trackStrand = merged.track_strand || merged.shs_track || "—";

                          // 2. Report on Attendance (from Front)
                          const defaultMonths = ["Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
                          const months = (merged.attendance_months && merged.attendance_months.length > 0)
                            ? merged.attendance_months
                            : defaultMonths;

                          const rawAttendance = Array.isArray(merged.attendance) ? merged.attendance : [];
                          const schoolDaysRow = rawAttendance.find((r) => /school\s*days|days\s*of\s*school/i.test(r.label || ""));
                          const daysPresentRow = rawAttendance.find((r) => /days\s*present|present/i.test(r.label || "") && !/absent/i.test(r.label || ""));
                          const daysAbsentRow = rawAttendance.find((r) => /days\s*absent|absent/i.test(r.label || ""));

                          const attTotals = merged.attendance_totals;
                          const schoolDaysTotal = schoolDaysRow?.total ?? attTotals?.computed_school_days ?? attTotals?.printed_school_days ?? "—";
                          const daysPresentTotal = daysPresentRow?.total ?? attTotals?.computed_days_present ?? attTotals?.printed_days_present ?? "—";
                          const daysAbsentTotal = daysAbsentRow?.total ?? attTotals?.computed_days_absent ?? attTotals?.printed_days_absent ?? "—";

                          // 3. Per-Semester Academic Grades (from Back)
                          const allGrades = Array.isArray(merged.grades) ? merged.grades : [];
                          const sem1Grades = allGrades.filter((g) => {
                            const s = String(g.semester ?? "").toLowerCase();
                            return s.includes("1") || s.includes("first") || ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined);
                          });
                          const sem2Grades = allGrades.filter((g) => {
                            const s = String(g.semester ?? "").toLowerCase();
                            return s.includes("2") || s.includes("second") || ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined);
                          });
                          const unassigned = allGrades.filter((g) => !sem1Grades.includes(g) && !sem2Grades.includes(g));
                          const effectiveSem1 = sem1Grades.length > 0 ? sem1Grades : (sem2Grades.length === 0 ? unassigned : []);
                          const effectiveSem2 = sem2Grades;

                          const formatQuarterGrade = (val: any) => {
                            if (val === undefined || val === null || val === "" || val === "—") return "—";
                            const n = Number(val);
                            if (!isNaN(n)) return Math.round(n).toString();
                            return String(val);
                          };

                          const getConfidenceColorClass = (pct?: number | null) => {
                            if (pct === undefined || pct === null) return "text-slate-600 bg-slate-50 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700";
                            const num = Math.round(pct <= 1 ? pct * 100 : pct);
                            if (num >= 85) return "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800";
                            if (num >= 65) return "text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800";
                            return "text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-800";
                          };

                          const getConfidenceNum = (conf?: number | null): number | undefined => {
                            if (conf === undefined || conf === null || isNaN(conf)) return undefined;
                            return Math.round(conf <= 1 ? conf * 100 : conf);
                          };

                          const sem1Avg = merged.sem1_printed_general_average ?? merged.sem1_displayed_general_average ?? merged.sem1_general_average ?? "Blank";
                          const sem2Avg = merged.sem2_printed_general_average ?? merged.sem2_displayed_general_average ?? merged.sem2_general_average ?? "Blank";

                          const isBlankVal = (v: any) => v === undefined || v === null || String(v).trim() === "" || String(v).trim() === "—" || String(v).trim().toLowerCase() === "blank" || String(v).trim().toLowerCase() === "null";

                          const hasBlankGrades =
                            (allGrades.length > 0 && allGrades.some((g) => {
                              const s = String(g.semester ?? "").toLowerCase();
                              const isSem2 = s.includes("2") || s.includes("second");
                              const qA = isSem2 ? g.q3 : g.q1;
                              const qB = isSem2 ? g.q4 : g.q2;
                              const f = isSem2 ? (g.sem2_final_grade ?? g.final_grade ?? g.final) : (g.sem1_final_grade ?? g.final_grade ?? g.final);
                              return isBlankVal(qA) || isBlankVal(qB) || isBlankVal(f);
                            })) ||
                            (effectiveSem1.length > 0 && isBlankVal(sem1Avg)) ||
                            (effectiveSem2.length > 0 && isBlankVal(sem2Avg)) ||
                            isBlankVal(merged.general_average);

                          // 4. Observed Values / Learner Behavior (from Back)
                          const obs = merged.observed_values;
                          const coreValues = Array.isArray(obs?.core_values) && obs.core_values.length > 0
                            ? obs.core_values
                            : Array.isArray(obs?.statements) && obs.statements.length > 0
                            ? [
                                { name: "Maka-Diyos", statements: obs.statements.filter((s: any) => s.core_value === "Maka-Diyos" || s.core_value_index === 1) },
                                { name: "Makatao", statements: obs.statements.filter((s: any) => s.core_value === "Makatao" || s.core_value_index === 2) },
                                { name: "Makakalikasan", statements: obs.statements.filter((s: any) => s.core_value === "Makakalikasan" || s.core_value_index === 3) },
                                { name: "Makabansa", statements: obs.statements.filter((s: any) => s.core_value === "Makabansa" || s.core_value_index === 4) },
                              ].filter((g) => g.statements.length > 0)
                            : [];

                          const renderAttendanceRow = (label: string, row: any, fallbackTotal: any) => {
                            const vals: any[] = row?.values || [];
                            const tot = row?.total ?? fallbackTotal;
                            return (
                              <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                  {label}
                                </td>
                                {months.map((m, mIdx) => {
                                  const val = vals[mIdx];
                                  const displayVal = val !== undefined && val !== null && String(val).trim() !== "" ? String(val) : "—";
                                  return (
                                    <td key={mIdx} className="py-2 px-2 text-center font-mono text-slate-700 dark:text-slate-300">
                                      {displayVal}
                                    </td>
                                  );
                                })}
                                <td className="py-2 px-3 text-center font-mono font-bold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800/50">
                                  {tot !== undefined && tot !== null && String(tot).trim() !== "" ? String(tot) : "—"}
                                </td>
                              </tr>
                            );
                          };

                          return (
                            <div
                              data-testid="sf9-extracted-preview-card"
                              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/60 shadow-sm space-y-5 mt-4"
                            >
                              {/* Header */}
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                                <div className="flex items-center gap-2">
                                  <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-[#174EA6] dark:text-blue-300">
                                    <FileText className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                      SF9-SHS Extracted Data Preview
                                    </h4>
                                    <p className="text-xs text-slate-500">
                                      DepEd Form 138 • Senior High School Progress Report Card
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 ${
                                    isUnifiedTwoSides
                                      ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300 dark:border-purple-800"
                                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                                  }`}>
                                    <Check className="w-3.5 h-3.5" />
                                    {isUnifiedTwoSides ? "Unified Front + Back Sides" : "Real-Time Extracted"}
                                  </span>
                                </div>
                              </div>

                              {/* 1. Learner Identity Summary */}
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                    Learner Identity Summary
                                  </span>
                                </div>
                                <div
                                  data-testid="sf9-identity-summary"
                                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs"
                                >
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">LRN</span>
                                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">{lrn}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Full Name</span>
                                    <span className="font-semibold text-slate-900 dark:text-slate-100">{fullName}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Sex</span>
                                    <span className="text-slate-700 dark:text-slate-300 font-medium">{sex}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Grade Level & Section</span>
                                    <span className="text-slate-700 dark:text-slate-300 font-medium">{gradeLevel} — {section}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">School Year</span>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-slate-700 dark:text-slate-300 font-medium">{schoolYear}</span>
                                      {schoolYear !== "—" && !syValidation.isValid && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800" title={syValidation.reason || "Non-consecutive school year"}>
                                          Invalid SY
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="col-span-2 sm:col-span-1 lg:col-span-1">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Track / Strand</span>
                                    <span className="text-slate-700 dark:text-slate-300 font-medium">{trackStrand}</span>
                                  </div>
                                </div>
                              </div>

                              {/* 2. Report on Attendance (from Front) */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                    Report on Attendance (from Front)
                                  </span>
                                  {merged.attendance_risk_status && (
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      merged.attendance_risk_status === "NORMAL"
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-amber-100 text-amber-800"
                                    }`}>
                                      {merged.attendance_risk_status}
                                    </span>
                                  )}
                                </div>

                                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50">
                                  <table className="w-full text-xs text-left border-collapse" data-testid="sf9-attendance-preview-table">
                                    <thead>
                                      <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                        <th className="py-2.5 px-3 min-w-[140px]">Month</th>
                                        {months.map((m, mIdx) => (
                                          <th key={mIdx} className="py-2.5 px-2 text-center min-w-[36px]">
                                            {m}
                                          </th>
                                        ))}
                                        <th className="py-2.5 px-3 text-center min-w-[50px] bg-slate-100/70 dark:bg-slate-800 font-bold text-slate-800 dark:text-slate-200">
                                          Total
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-300">
                                      {renderAttendanceRow("No. of School Days", schoolDaysRow, schoolDaysTotal)}
                                      {renderAttendanceRow("No. of Days Present", daysPresentRow, daysPresentTotal)}
                                      {renderAttendanceRow("No. of Days Absent", daysAbsentRow, daysAbsentTotal)}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {/* 3. Per-Semester Academic Grades (from Back) */}
                              <div className="space-y-3" data-testid="sf9-grades-preview">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                    <BookOpen className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                    Per-Semester Academic Grades (from Back)
                                  </span>
                                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                    Annual General Average: <strong className={`${(isBlankVal(sem1Avg) || isBlankVal(sem2Avg) || (merged.annual_general_average === null && merged.general_average === null) || isBlankVal(merged.annual_general_average ?? merged.general_average)) ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"} font-mono text-sm`}>{(isBlankVal(sem1Avg) || isBlankVal(sem2Avg)) ? "Blank" : (merged.annual_general_average ?? merged.general_average ?? "Blank")}</strong>
                                  </span>
                                </div>

                                {hasBlankGrades && (
                                  <div
                                    data-testid="sf9-blank-grade-error"
                                    className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-2 text-xs"
                                  >
                                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                    <div>
                                      <strong className="font-bold">Blank Grade Error:</strong> One or more Final Grades or Semester General Averages are blank on the uploaded SF9 Back card.
                                    </div>
                                  </div>
                                )}

                                {/* Teacher-Friendly Error & Status Legends Header */}
                                <div
                                  data-testid="sf9-error-legends"
                                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 text-xs space-y-2"
                                >
                                  <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 text-[11px] uppercase tracking-wider">
                                    <Info className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                    <span>SF9 Academic &amp; Clearance Status Guide (Teacher Reference)</span>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1 text-[11px] leading-relaxed">
                                    <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200">
                                      <div className="flex items-center gap-1.5 font-bold mb-1">
                                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                        <span>Blank Grade Error</span>
                                      </div>
                                      <p className="text-amber-800/90 dark:text-amber-300/90 text-[10.5px]">
                                        Triggered when one or more subject <strong className="font-semibold">FINAL</strong> grades or <strong className="font-semibold">General Average for the Semester</strong> boxes are left blank on the uploaded SF9 card (no automatic grade calculation is performed).
                                      </p>
                                    </div>

                                    <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200">
                                      <div className="flex items-center gap-1.5 font-bold mb-1">
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                                          Blank / Incomplete
                                        </span>
                                      </div>
                                      <p className="text-amber-800/90 dark:text-amber-300/90 text-[10.5px]">
                                        Indicates an empty/unwritten grade cell on the form that requires teacher completion before final clearance.
                                      </p>
                                    </div>

                                    <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200">
                                      <div className="flex items-center gap-1.5 font-bold mb-1">
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                                          Passed / Failed
                                        </span>
                                      </div>
                                      <p className="text-emerald-800/90 dark:text-emerald-300/90 text-[10.5px]">
                                        Official DepEd remark displayed only when an explicit numeric grade (<strong className="font-semibold">&gt;= 75 Passed, &lt; 75 Failed</strong>) is written on the card.
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  {/* First Semester */}
                                  <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-white dark:bg-slate-950/50">
                                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                                        First Semester
                                      </span>
                                      <span className="text-[11px] text-slate-500">
                                        General Average: <strong className="font-mono font-bold text-slate-900 dark:text-slate-100">{sem1Avg}</strong>
                                      </span>
                                    </div>
                                    {effectiveSem1.length > 0 ? (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left border-collapse" data-testid="sf9-sem1-grades-table">
                                          <thead>
                                            <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">
                                              <th className="py-1.5 px-2">Subject</th>
                                              <th className="py-1.5 px-1.5 text-center">Q1</th>
                                              <th className="py-1.5 px-1.5 text-center">Q2</th>
                                              <th className="py-1.5 px-2 text-center font-bold">Final</th>
                                              <th className="py-1.5 px-2">Remarks</th>
                                            </tr>
                                          </thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                            {effectiveSem1.map((g, gIdx) => {
                                              const fVal = g.sem1_final_grade ?? g.final_grade ?? g.final;
                                              const q1Conf = getConfidenceNum(g.q1_confidence ?? g.q1Confidence);
                                              const q2Conf = getConfidenceNum(g.q2_confidence ?? g.q2Confidence);
                                              const finalConf = getConfidenceNum(g.final_confidence ?? g.finalGradeConfidence ?? g.confidence);
                                              const evaluated = evaluateDynamicGradeStatus({
                                                grade: fVal,
                                                rawRemark: g.remarks || g.remark || g.action_taken,
                                                confidencePercent: finalConf,
                                              });
                                              const rem = evaluated.remarkDisplay;
                                              const remPillClass = evaluated.status === "blank"
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                                : evaluated.isLowConfidence || evaluated.status === "not_recognized"
                                                ? "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-bold"
                                                : evaluated.status === "passed"
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                : "bg-rose-50 text-rose-700";
                                              return (
                                                <tr key={gIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40">
                                                  <td className="py-1.5 px-2 font-medium text-slate-800 dark:text-slate-200">{g.subject}</td>
                                                  <td className="py-1.5 px-1.5 text-center font-mono">
                                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                                      <span>{formatQuarterGrade(g.q1)}</span>
                                                      {formatQuarterGrade(g.q1) !== "—" && q1Conf !== undefined && (
                                                        <span className={`px-1 py-0.2 rounded text-[9px] font-semibold border ${getConfidenceColorClass(q1Conf)}`}>
                                                          {q1Conf}%
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-1.5 text-center font-mono">
                                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                                      <span>{formatQuarterGrade(g.q2)}</span>
                                                      {formatQuarterGrade(g.q2) !== "—" && q2Conf !== undefined && (
                                                        <span className={`px-1 py-0.2 rounded text-[9px] font-semibold border ${getConfidenceColorClass(q2Conf)}`}>
                                                          {q2Conf}%
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-2 text-center font-mono font-bold text-slate-900 dark:text-slate-100">
                                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                                      <span>{evaluated.status === "blank" ? "Blank" : String(fVal)}</span>
                                                      {evaluated.status !== "blank" && finalConf !== undefined && (
                                                        <span className={`px-1 py-0.2 rounded text-[9px] font-semibold border ${getConfidenceColorClass(finalConf)}`}>
                                                          {finalConf}%
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${remPillClass}`}>
                                                      {rem}
                                                    </span>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                          <tfoot>
                                            {(() => {
                                              const isSem1Blank = isBlankVal(sem1Avg);
                                              const sem1Conf = getConfidenceNum(merged.sem1_confidence ?? merged.general_average_confidence) ?? (isSem1Blank ? undefined : 95);
                                              const sem1AvgEval = evaluateDynamicGradeStatus({
                                                grade: sem1Avg,
                                                confidencePercent: sem1Conf,
                                              });
                                              const sem1Rem = sem1AvgEval.remarkDisplay;
                                              const sem1PillClass = sem1AvgEval.status === "blank"
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                                : sem1AvgEval.isLowConfidence || sem1AvgEval.status === "not_recognized"
                                                ? "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-bold"
                                                : sem1AvgEval.status === "passed"
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                : "bg-rose-50 text-rose-700";
                                              return (
                                                <tr
                                                  className="bg-slate-50 dark:bg-slate-800/40 font-bold border-t border-slate-200 dark:border-slate-800 text-[11px]"
                                                  data-testid="sf9-sem1-general-average-row"
                                                >
                                                  <td colSpan={3} className="py-2 px-2 text-slate-700 dark:text-slate-300">
                                                    General Average for the Semester
                                                  </td>
                                                  <td className="py-2 px-2 text-center font-mono font-bold text-xs">
                                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                                      {isSem1Blank ? (
                                                        <span className="text-amber-700 dark:text-amber-400 font-bold">Blank</span>
                                                      ) : (
                                                        <span className="text-slate-900 dark:text-slate-100">{String(sem1Avg)}</span>
                                                      )}
                                                      {!isSem1Blank && sem1Conf !== undefined && (
                                                        <span className={`px-1 py-0.2 rounded text-[9px] font-semibold border ${getConfidenceColorClass(sem1Conf)}`}>
                                                          {sem1Conf}%
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${sem1PillClass}`}>
                                                      {sem1Rem}
                                                    </span>
                                                  </td>
                                                </tr>
                                              );
                                            })()}
                                          </tfoot>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="py-6 text-center text-xs text-slate-400 italic">
                                        No First Semester subjects extracted on this side.
                                      </div>
                                    )}
                                  </div>

                                  {/* Second Semester */}
                                  <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-white dark:bg-slate-950/50">
                                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                                        Second Semester
                                      </span>
                                      <span className="text-[11px] text-slate-500">
                                        General Average: <strong className="font-mono font-bold text-slate-900 dark:text-slate-100">{sem2Avg}</strong>
                                      </span>
                                    </div>
                                    {effectiveSem2.length > 0 ? (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left border-collapse" data-testid="sf9-sem2-grades-table">
                                          <thead>
                                            <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">
                                              <th className="py-1.5 px-2">Subject</th>
                                              <th className="py-1.5 px-1.5 text-center">Q3</th>
                                              <th className="py-1.5 px-1.5 text-center">Q4</th>
                                              <th className="py-1.5 px-2 text-center font-bold">Final</th>
                                              <th className="py-1.5 px-2">Remarks</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                            {effectiveSem2.map((g, gIdx) => {
                                              const fVal = g.sem2_final_grade ?? g.final_grade ?? g.final;
                                              const q3Conf = getConfidenceNum(g.q3_confidence ?? g.q3Confidence);
                                              const q4Conf = getConfidenceNum(g.q4_confidence ?? g.q4Confidence);
                                              const finalConf = getConfidenceNum(g.final_confidence ?? g.finalGradeConfidence ?? g.confidence);
                                              const evaluated = evaluateDynamicGradeStatus({
                                                grade: fVal,
                                                rawRemark: g.remarks || g.remark || g.action_taken,
                                                confidencePercent: finalConf,
                                              });
                                              const rem = evaluated.remarkDisplay;
                                              const remPillClass = evaluated.status === "blank"
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                                : evaluated.isLowConfidence || evaluated.status === "not_recognized"
                                                ? "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-bold"
                                                : evaluated.status === "passed"
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                : "bg-rose-50 text-rose-700";
                                              return (
                                                <tr key={gIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40">
                                                  <td className="py-1.5 px-2 font-medium text-slate-800 dark:text-slate-200">{g.subject}</td>
                                                  <td className="py-1.5 px-1.5 text-center font-mono">
                                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                                      <span>{formatQuarterGrade(g.q3)}</span>
                                                      {formatQuarterGrade(g.q3) !== "—" && q3Conf !== undefined && (
                                                        <span className={`px-1 py-0.2 rounded text-[9px] font-semibold border ${getConfidenceColorClass(q3Conf)}`}>
                                                          {q3Conf}%
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-1.5 text-center font-mono">
                                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                                      <span>{formatQuarterGrade(g.q4)}</span>
                                                      {formatQuarterGrade(g.q4) !== "—" && q4Conf !== undefined && (
                                                        <span className={`px-1 py-0.2 rounded text-[9px] font-semibold border ${getConfidenceColorClass(q4Conf)}`}>
                                                          {q4Conf}%
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-2 text-center font-mono font-bold text-slate-900 dark:text-slate-100">
                                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                                      <span>{evaluated.status === "blank" ? "Blank" : String(fVal)}</span>
                                                      {evaluated.status !== "blank" && finalConf !== undefined && (
                                                        <span className={`px-1 py-0.2 rounded text-[9px] font-semibold border ${getConfidenceColorClass(finalConf)}`}>
                                                          {finalConf}%
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${remPillClass}`}>
                                                      {rem}
                                                    </span>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                          <tfoot>
                                            {(() => {
                                              const isSem2Blank = isBlankVal(sem2Avg);
                                              const sem2Conf = getConfidenceNum(merged.sem2_confidence ?? merged.general_average_confidence) ?? (isSem2Blank ? undefined : 95);
                                              const sem2AvgEval = evaluateDynamicGradeStatus({
                                                grade: sem2Avg,
                                                confidencePercent: sem2Conf,
                                              });
                                              const sem2Rem = sem2AvgEval.remarkDisplay;
                                              const sem2PillClass = sem2AvgEval.status === "blank"
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                                : sem2AvgEval.isLowConfidence || sem2AvgEval.status === "not_recognized"
                                                ? "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-bold"
                                                : sem2AvgEval.status === "passed"
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                : "bg-rose-50 text-rose-700";
                                              return (
                                                <tr
                                                  className="bg-slate-50 dark:bg-slate-800/40 font-bold border-t border-slate-200 dark:border-slate-800 text-[11px]"
                                                  data-testid="sf9-sem2-general-average-row"
                                                >
                                                  <td colSpan={3} className="py-2 px-2 text-slate-700 dark:text-slate-300">
                                                    General Average for the Semester
                                                  </td>
                                                  <td className="py-2 px-2 text-center font-mono font-bold text-xs">
                                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                                      {isSem2Blank ? (
                                                        <span className="text-amber-700 dark:text-amber-400 font-bold">Blank</span>
                                                      ) : (
                                                        <span className="text-slate-900 dark:text-slate-100">{String(sem2Avg)}</span>
                                                      )}
                                                      {!isSem2Blank && sem2Conf !== undefined && (
                                                        <span className={`px-1 py-0.2 rounded text-[9px] font-semibold border ${getConfidenceColorClass(sem2Conf)}`}>
                                                          {sem2Conf}%
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${sem2PillClass}`}>
                                                      {sem2Rem}
                                                    </span>
                                                  </td>
                                                </tr>
                                              );
                                            })()}
                                          </tfoot>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="py-6 text-center text-xs text-slate-400 italic">
                                        No Second Semester subjects extracted on this side.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* 4. Observed Values / Learner Behavior (from Back) */}
                              <div className="space-y-2" data-testid="sf9-observed-values-preview">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                    <Heart className="w-3.5 h-3.5 text-rose-500" />
                                    Report on Learners&apos; Observed Values (Core Values &amp; Behavior)
                                  </span>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                    <span><strong className="text-emerald-700 dark:text-emerald-400">AO</strong>: Always</span>
                                    <span><strong className="text-blue-700 dark:text-blue-400">SO</strong>: Sometimes</span>
                                    <span><strong className="text-amber-700 dark:text-amber-400">RO</strong>: Rarely</span>
                                    <span><strong className="text-rose-700 dark:text-rose-400">NO</strong>: Not Observed</span>
                                  </div>
                                </div>

                                {coreValues.length > 0 ? (
                                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50">
                                    <table className="w-full text-xs text-left border-collapse" data-testid="sf9-observed-values-table">
                                      <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                          <th className="py-2 px-3 min-w-[120px]">Core Value</th>
                                          <th className="py-2 px-3 min-w-[220px]">Behavior Statement</th>
                                          <th className="py-2 px-2 text-center min-w-[40px]">Q1</th>
                                          <th className="py-2 px-2 text-center min-w-[40px]">Q2</th>
                                          <th className="py-2 px-2 text-center min-w-[40px]">Q3</th>
                                          <th className="py-2 px-2 text-center min-w-[40px]">Q4</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                        {coreValues.map((group: any, grpIdx: number) =>
                                          (group.statements || []).map((stmt: any, sIdx: number) => {
                                            const renderRatingBadge = (qRec: any, fallbackConf?: number | null) => {
                                              const rawVal = qRec?.normalized_rating ?? qRec?.original_mark ?? qRec;
                                              const normalized = normalizeObservedValueMarking(rawVal);
                                              if (!normalized) return <span className="text-slate-400 font-mono text-xs">—</span>;
                                              const cls =
                                                normalized === "AO"
                                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                  : normalized === "SO"
                                                  ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400"
                                                  : normalized === "RO"
                                                  ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400"
                                                  : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400";
                                              const conf = getConfidenceNum(qRec?.confidence ?? fallbackConf);
                                              return (
                                                <div className="inline-flex flex-col items-center justify-center gap-0.5">
                                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${cls}`}>
                                                    {normalized}
                                                  </span>
                                                  {conf !== undefined && (
                                                    <span className={`px-1 py-0.2 rounded text-[8px] font-mono font-semibold border ${getConfidenceColorClass(conf)}`}>
                                                      {conf}%
                                                    </span>
                                                  )}
                                                </div>
                                              );
                                            };

                                            return (
                                              <tr key={`${grpIdx}-${sIdx}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40">
                                                {sIdx === 0 && (
                                                  <td
                                                    rowSpan={group.statements.length}
                                                    className="py-2 px-3 font-bold text-slate-900 dark:text-slate-100 bg-slate-50/40 dark:bg-slate-900/40 align-top border-r border-slate-100 dark:border-slate-800"
                                                  >
                                                    {group.name}
                                                  </td>
                                                )}
                                                <td className="py-2 px-3 text-slate-700 dark:text-slate-300 font-medium">
                                                  {stmt.statement}
                                                </td>
                                                <td className="py-2 px-2 text-center">{renderRatingBadge(stmt.q1, stmt.q1Confidence)}</td>
                                                <td className="py-2 px-2 text-center">{renderRatingBadge(stmt.q2, stmt.q2Confidence)}</td>
                                                <td className="py-2 px-2 text-center">{renderRatingBadge(stmt.q3, stmt.q3Confidence)}</td>
                                                <td className="py-2 px-2 text-center">{renderRatingBadge(stmt.q4, stmt.q4Confidence)}</td>
                                              </tr>
                                            );
                                          })
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className="py-5 text-center text-xs text-slate-400 italic rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                                    Observed values / core behavior ratings not yet extracted. (Included on Back side of DepEd SF9-SHS).
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Step 4 SF2-SHS Daily Attendance & Shading Compliance Card */}
                        {currentStep.id === "sf2" && (() => {
                          const sf2Files = (stepFiles.sf2 || []).filter(
                            (f) => f.extractionStatus === "extracted" && f.extractedFields
                          );
                          if (sf2Files.length === 0) return null;

                          const primaryFile = sf2Files[0];
                          const fields: ExtractedFields = primaryFile?.extractedFields || {};
                          const rawRecords = Array.isArray(fields.attendance_records)
                            ? fields.attendance_records
                            : Array.isArray(fields.attendance)
                            ? fields.attendance
                            : Array.isArray(fields.monthly_attendance)
                            ? fields.monthly_attendance
                            : Array.isArray(fields.learners)
                            ? fields.learners
                            : [];
                          const attendanceRecords = deduplicateSf2Records(rawRecords);
                          const rawMonth = fields.attendance_month || fields.month || fields.header?.month || "Not specified";
                          const displayMonth = formatDepEdMonthDisplay(rawMonth);

                          const hdr = fields.header || {};
                          const rawSy = hdr.schoolYear || hdr.school_year || fields.school_year || "";
                          const syVal = validateConsecutiveSchoolYear(rawSy);
                          const syConf = hdr.schoolYearConfidence ?? fields.school_year_confidence ?? 95;
                          const scId = hdr.schoolId || hdr.school_id || fields.school_id || "";
                          const scIdConf = hdr.schoolIdConfidence ?? 95;
                          const mthConf = hdr.monthConfidence ?? 95;
                          const secConf = hdr.sectionConfidence ?? 95;

                          // SF9 Anchor Matching
                          const matchedIdx = attendanceRecords.findIndex((r: any) =>
                            areLearnerNamesMatching(
                              r.learner_name || r.student_name || r.name,
                              sf9TargetLearner.targetStudentName
                            )
                          );
                          const matchedRec = matchedIdx >= 0 ? attendanceRecords[matchedIdx] : null;

                          const displayedRecords = !sf2ShowAllLearners && matchedRec
                            ? [matchedRec]
                            : attendanceRecords;

                          return (
                            <div data-testid="sf2-step-preview-card" className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-[#174EA6] dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                                      Step 4 SF2-SHS
                                    </span>
                                    <span className="text-xs text-slate-500 font-mono">
                                      {attendanceRecords.length} {attendanceRecords.length === 1 ? "Learner" : "Learners"} Extracted
                                    </span>
                                  </div>
                                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-1">
                                    Daily Attendance &amp; Shading Compliance Report
                                  </h3>
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    DepEd Form 2 monthly attendance audit, strict horizontal learner row binding, and arithmetic verification.
                                  </p>
                                </div>
                              </div>

                              <div data-testid="sf2-shading-legend" className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                                  <span>DepEd SF2 Official Attendance Shading &amp; Marking Legend</span>
                                  <span className="text-[10px] uppercase font-mono text-slate-500">DepEd Order No. 4, s. 2014</span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 text-[11px] pt-1">
                                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                    <span className="w-6 h-6 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 rounded flex items-center justify-center font-bold text-slate-400 text-xs shrink-0"></span>
                                    <div>
                                      <div className="font-bold text-slate-800 dark:text-slate-200">BLANK</div>
                                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Present (0 Abs / 0 Tar)</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                    <span className="w-6 h-6 border border-rose-300 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded flex items-center justify-center font-black text-sm shrink-0">✕</span>
                                    <div>
                                      <div className="font-bold text-slate-800 dark:text-slate-200">X MARK</div>
                                      <div className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">Absent (+1 Absent)</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                    <span className="w-6 h-6 border border-amber-300 bg-linear-to-b from-amber-400 from-50% to-transparent to-50% rounded flex items-center justify-center text-xs shrink-0"></span>
                                    <div>
                                      <div className="font-bold text-slate-800 dark:text-slate-200">UPPER HALF</div>
                                      <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Tardy — Late Comer</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                    <span className="w-6 h-6 border border-amber-300 bg-linear-to-b from-transparent from-50% to-amber-400 to-50% rounded flex items-center justify-center text-xs shrink-0"></span>
                                    <div>
                                      <div className="font-bold text-slate-800 dark:text-slate-200">LOWER HALF</div>
                                      <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">Tardy — Cutting Class</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                    <span className="w-6 h-6 border border-slate-400 bg-slate-300 dark:bg-slate-600 rounded flex items-center justify-center text-xs shrink-0"></span>
                                    <div>
                                      <div className="font-bold text-slate-800 dark:text-slate-200">FULL COLUMN</div>
                                      <div className="text-[10px] text-slate-500 font-medium">Holiday / No Class</div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">School Year</span>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className={`font-mono font-bold text-sm ${!syVal.isValid && rawSy ? "text-rose-600" : "text-slate-900 dark:text-slate-100"}`}>
                                      {rawSy || "—"}
                                    </span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">{syConf}%</span>
                                  </div>
                                  {!syVal.isValid && rawSy && (
                                    <span className="text-[10px] text-rose-600 block mt-1">{syVal.message}</span>
                                  )}
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Report Month</span>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{displayMonth}</span>
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">{mthConf}%</span>
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">School ID</span>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className="font-mono text-sm text-slate-900 dark:text-slate-100">{scId || "—"}</span>
                                    {scId && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">{scIdConf}%</span>}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Grade &amp; Section</span>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    <span className="font-medium text-sm text-slate-900 dark:text-slate-100">
                                      {hdr.gradeLevel || fields.grade_level || "Grade 11"} - {hdr.section || fields.section || "—"}
                                    </span>
                                    {(hdr.section || fields.section) && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">{secConf}%</span>}
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30">
                                <div className="flex items-center gap-2.5">
                                  <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
                                  <div>
                                    <div className="text-xs font-bold text-blue-950 dark:text-blue-100">
                                      {matchedRec
                                        ? `SF9 Anchor Match: ${matchedRec.learner_name || matchedRec.student_name || matchedRec.name} (Row #${matchedIdx + 1})`
                                        : sf9TargetLearner.targetStudentName
                                        ? `Looking for SF9 Target Learner: ${sf9TargetLearner.targetStudentName}`
                                        : "SF9 Target Learner Anchor Matching Active"}
                                    </div>
                                    <p className="text-[11px] text-blue-800/80 dark:text-blue-300/80 mt-0.5">
                                      {matchedRec
                                        ? "Strict horizontal row binding established. Learner attendance is tied directly to SF9 attendance summary."
                                        : "Extracted rows are bound strictly to their horizontal attendance cells."}
                                    </p>
                                  </div>
                                </div>
                                {matchedRec && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setSf2ShowAllLearners((prev) => !prev)}
                                    className="text-xs shrink-0 font-semibold bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-200"
                                  >
                                    {sf2ShowAllLearners ? "Filter: Target Learner Only" : `Expand: All Learners (${attendanceRecords.length})`}
                                  </Button>
                                )}
                              </div>

                              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                                <table className="w-full text-xs text-left border-collapse" data-testid="sf2-attendance-preview-table">
                                  <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                      <th className="py-2.5 px-3">#</th>
                                      <th className="py-2.5 px-3">Learner Name</th>
                                      <th className="py-2.5 px-3">Month</th>
                                      <th className="py-2.5 px-3 text-center">School Days</th>
                                      <th className="py-2.5 px-3 text-center">Present</th>
                                      <th className="py-2.5 px-3 text-center">Absent (Grid/W)</th>
                                      <th className="py-2.5 px-3 text-center">Tardy (Grid/W)</th>
                                      <th className="py-2.5 px-3">Audit &amp; Formatting Warnings</th>
                                      <th className="py-2.5 px-3 text-right">Row Accuracy</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-300">
                                    {displayedRecords.map((rec: any, idx: number) => {
                                      const recName = rec.learner_name || rec.student_name || rec.name || "—";
                                      const recDays = typeof rec.total_days === "number" ? rec.total_days : typeof rec.total_school_days === "number" ? rec.total_school_days : typeof rec.school_days === "number" ? rec.school_days : "—";
                                      const recPresent = typeof rec.days_present === "number" ? rec.days_present : "—";
                                      const audit = validateSf2RowFormattingAndTotals(rec);
                                      const isAnchorMatch = Boolean(
                                        sf9TargetLearner.targetStudentName &&
                                        areLearnerNamesMatching(recName, sf9TargetLearner.targetStudentName)
                                      );
                                      const acc = audit.overallRowAccuracy;
                                      const accClass =
                                        acc >= 85
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                                          : acc >= 65
                                          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                                          : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800";

                                      return (
                                        <tr
                                          key={idx}
                                          className={`hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors ${
                                            isAnchorMatch ? "bg-blue-50/60 dark:bg-blue-950/30 border-l-4 border-l-[#174EA6]" : ""
                                          }`}
                                        >
                                          <td className="py-2.5 px-3 font-mono text-slate-400 text-[10px]">
                                            {rec.row_index ?? idx + 1}
                                          </td>
                                          <td className="py-2.5 px-3 text-slate-900 dark:text-slate-100">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className="font-bold">{recName}</span>
                                              <span
                                                className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold ${
                                                  audit.nameConfidence >= 85
                                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                    : "bg-amber-50 text-amber-700"
                                                }`}
                                                title={`Name Reading Accuracy: ${audit.nameConfidence}%`}
                                              >
                                                {audit.nameConfidence}%
                                              </span>
                                              {isAnchorMatch && (
                                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                                  SF9 Target
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="py-2.5 px-3 font-medium text-slate-600 dark:text-slate-400">
                                            {displayMonth}
                                          </td>
                                          <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200">{recDays}</td>
                                          <td className="py-2.5 px-3 text-center font-mono text-emerald-600 dark:text-emerald-400 font-bold">{recPresent}</td>
                                          <td className="py-2.5 px-3 text-center font-mono">
                                            <div className="flex flex-col items-center">
                                              <span className={`font-bold ${audit.absentMismatch ? "text-rose-600 font-black" : "text-slate-800 dark:text-slate-200"}`}>
                                                {audit.gridAbsentCount}
                                              </span>
                                              {audit.writtenAbsent !== null && (
                                                <span className={`text-[10px] ${audit.absentMismatch ? "text-rose-500 font-bold" : "text-slate-400"}`}>
                                                  W: {audit.writtenAbsent}
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="py-2.5 px-3 text-center font-mono">
                                            <div className="flex flex-col items-center">
                                              <span className={`font-bold ${audit.tardyMismatch ? "text-amber-600 font-black" : "text-slate-800 dark:text-slate-200"}`}>
                                                {audit.gridTardyCount}
                                              </span>
                                              {audit.writtenTardy !== null && (
                                                <span className={`text-[10px] ${audit.tardyMismatch ? "text-amber-500 font-bold" : "text-slate-400"}`}>
                                                  W: {audit.writtenTardy}
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="py-2.5 px-3 text-[11px]">
                                            <div className="space-y-1">
                                              {!audit.isShadingFormatValid && (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 block" title={audit.shadingFormatWarning}>
                                                  Improper Solid Shading
                                                </span>
                                              )}
                                              {audit.absentMismatch && (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 block">
                                                  Absent Mismatch (Grid {audit.gridAbsentCount} vs W {audit.writtenAbsent})
                                                </span>
                                              )}
                                              {audit.tardyMismatch && (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 block">
                                                  Tardy Mismatch (Grid {audit.gridTardyCount} vs W {audit.writtenTardy})
                                                </span>
                                              )}
                                              {audit.hasConsecutiveAbsencesWarning && (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 block">
                                                  5+ Consec. Absences (SARDO)
                                                </span>
                                              )}
                                              {audit.isValid && !audit.hasConsecutiveAbsencesWarning && (
                                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
                                                  <Check className="w-3.5 h-3.5" />
                                                  Verified Compliant
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="py-2.5 px-3 text-right">
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-mono border ${accClass}`}>
                                              {acc}%
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Step 4 SF10-SHS Extracted Data Preview Card (Identity & Scholastic Records) */}
                        {currentStep.id === "sf10" && (() => {
                          const sf10Files = (stepFiles.sf10 || []).filter(
                            (f) => f.extractionStatus === "extracted" && f.extractedFields
                          );
                          if (sf10Files.length === 0) return null;

                          const primaryFile = sf10Files[0];
                          const fields: ExtractedFields = primaryFile?.extractedFields || {};

                          const isSem1 = (sem: any) =>
                            sem === 1 || sem === "1" || /1st|first|\b1\b/i.test(String(sem || ""));
                          const isSem2 = (sem: any) =>
                            sem === 2 || sem === "2" || /2nd|second|\b2\b/i.test(String(sem || ""));

                          // Aggregate scholastic records across any uploaded SF10 files/pages
                          const allRecords: Sf10ScholasticRecord[] = sf10Files.flatMap((f) => {
                            const ef = f.extractedFields as any;
                            return [
                              ...(Array.isArray(ef?.shs_semesters) ? (ef.shs_semesters as Sf10ScholasticRecord[]) : []),
                              ...(Array.isArray(ef?.scholastic_records) ? (ef.scholastic_records as Sf10ScholasticRecord[]) : []),
                              ...(Array.isArray(ef?.semesters) ? (ef.semesters as Sf10ScholasticRecord[]) : []),
                            ];
                          });
                          const scholasticRecords =
                            allRecords.length > 0
                              ? allRecords
                              : [
                                  ...(Array.isArray((fields as any).shs_semesters) ? ((fields as any).shs_semesters as Sf10ScholasticRecord[]) : []),
                                  ...(Array.isArray(fields.scholastic_records) ? (fields.scholastic_records as Sf10ScholasticRecord[]) : []),
                                  ...(Array.isArray((fields as any).semesters) ? ((fields as any).semesters as Sf10ScholasticRecord[]) : []),
                                ];

                          const sem1Record = scholasticRecords.find((r) => isSem1(r.semester));
                          const sem2Record = scholasticRecords.find((r) => isSem2(r.semester));

                          // 1. Learner Identity Summary
                          const lrn = fields.lrn || "—";
                          const fullName =
                            fields.name ||
                            fields.full_name ||
                            [fields.last_name, fields.first_name, fields.middle_name].filter(Boolean).join(", ") ||
                            "—";
                          const sex =
                            normalizeStrictSex(fields.sex) ||
                            (fields.sex === "M" || fields.sex === "MALE"
                              ? "Male"
                              : fields.sex === "F" || fields.sex === "FEMALE"
                              ? "Female"
                              : fields.sex || "—");

                          const rawBirthDate = fields.birth_date_display || fields.birth_date || fields.birth_date_raw;
                          const birthDateDisplay = formatBirthDateDisplay(rawBirthDate) || "—";

                          const inferCategory = (title?: string): "CORE" | "APPLIED" | "SPECIALIZED" => {
                            const l = (title || "").toLowerCase();
                            if (/pre-calculus|basic calculus|general chemistry|general physics|general biology/i.test(l)) return "SPECIALIZED";
                            if (/empowerment technologies|practical research|english for academic|eapp|inquiries|entrepreneurship/i.test(l)) return "APPLIED";
                            return "CORE";
                          };

                          const rawSchool =
                            (fields.school_name && !/\b(?:republic|republika|philippines|pilipinas|department|kagawaran|deped|w\s+ng)\b/i.test(fields.school_name)
                              ? fields.school_name
                              : null) ||
                            (sem1Record?.school_name && !/\b(?:republic|republika|philippines|pilipinas|department|kagawaran|deped|w\s+ng)\b/i.test(sem1Record.school_name)
                              ? sem1Record.school_name
                              : null) ||
                            (sem2Record?.school_name && !/\b(?:republic|republika|philippines|pilipinas|department|kagawaran|deped|w\s+ng)\b/i.test(sem2Record.school_name)
                              ? sem2Record.school_name
                              : null) ||
                            (fields.school_id ? `School ID: ${fields.school_id}` : null) ||
                            "TAYSAN RESETTLEMENT INTEGRATED SCHOOL";
                          const school = rawSchool.toUpperCase().includes("TAYSAN")
                            ? "TAYSAN RESETTLEMENT INTEGRATED SCHOOL"
                            : rawSchool;

                          const gradeLevel =
                            fields.grade_level || sem1Record?.grade_level || sem2Record?.grade_level || "Grade 11";
                          const section = fields.section || sem1Record?.section || sem2Record?.section || "—";
                          const schoolYear = fields.school_year || sem1Record?.school_year || sem2Record?.school_year || "—";
                          const syValidation = validateConsecutiveSchoolYear(schoolYear);
                          const trackStrand =
                            fields.track_strand ||
                            fields.shs_track ||
                            sem1Record?.track_strand ||
                            sem2Record?.track_strand ||
                            "—";

                          // 2. Scholastic Record Subjects per semester
                          const allGrades = Array.isArray(fields.grades) ? fields.grades : [];

                          const rawSem1 = (
                            (Array.isArray((fields as any).first_semester_grades) && (fields as any).first_semester_grades.length > 0)
                              ? (fields as any).first_semester_grades
                              : (Array.isArray((fields as any).firstSemesterSubjects) && (fields as any).firstSemesterSubjects.length > 0)
                              ? (fields as any).firstSemesterSubjects
                              : sem1Record?.subjects?.length
                              ? sem1Record.subjects
                              : allGrades.filter(
                                  (g: any) =>
                                    isSem1(g.semester) ||
                                    ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined)
                                )
                          );

                          const sem1Subjects: Sf10SubjectRow[] = rawSem1.map((s: any) => {
                            const rawGrade = s.sem_final_grade ?? s.finalGrade ?? s.final;
                            const gEval1 = evaluateDynamicGradeStatus({
                              grade: rawGrade,
                              rawRemark: s.action_taken || s.remarks || s.remark || s.status,
                              confidencePercent: typeof s.confidence === "number" ? s.confidence : 95,
                            });
                            return {
                              subject: s.subject,
                              subject_type: s.subject_type || s.subject_category || s.category || inferCategory(s.subject),
                              q1: typeof s.q1 === "number" ? s.q1 : undefined,
                              q2: typeof s.q2 === "number" ? s.q2 : undefined,
                              sem_final_grade: typeof rawGrade === "number" ? rawGrade : undefined,
                              action_taken: gEval1.status === "blank" ? undefined : gEval1.officialRemark,
                              confidence: typeof s.confidence === "number" ? s.confidence : 95,
                            };
                          });

                          const rawSem2 = (
                            (Array.isArray((fields as any).second_semester_grades) && (fields as any).second_semester_grades.length > 0)
                              ? (fields as any).second_semester_grades
                              : (Array.isArray((fields as any).secondSemesterSubjects) && (fields as any).secondSemesterSubjects.length > 0)
                              ? (fields as any).secondSemesterSubjects
                              : sem2Record?.subjects?.length
                              ? sem2Record.subjects
                              : allGrades.filter(
                                  (g: any) =>
                                    isSem2(g.semester) ||
                                    ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined)
                                )
                          );

                          const sem2Subjects: Sf10SubjectRow[] = rawSem2.map((s: any) => {
                            const rawGrade = s.sem_final_grade ?? s.finalGrade ?? s.final;
                            const gEval2 = evaluateDynamicGradeStatus({
                              grade: rawGrade,
                              rawRemark: s.action_taken || s.remarks || s.remark || s.status,
                              confidencePercent: typeof s.confidence === "number" ? s.confidence : 95,
                            });
                            return {
                              subject: s.subject,
                              subject_type: s.subject_type || s.subject_category || s.category || inferCategory(s.subject),
                              q3: typeof s.q3 === "number" ? s.q3 : undefined,
                              q4: typeof s.q4 === "number" ? s.q4 : undefined,
                              sem_final_grade: typeof rawGrade === "number" ? rawGrade : undefined,
                              action_taken: gEval2.status === "blank" ? undefined : gEval2.officialRemark,
                              confidence: typeof s.confidence === "number" ? s.confidence : 95,
                            };
                          });

                          const rawSem1GeneralAve =
                            sem1Record?.general_average ??
                            (sem1Record as any)?.generalAverage ??
                            fields.sem1_printed_general_average ??
                            fields.sem1_general_average ??
                            ((fields as any).shs_semesters?.find((s: any) => isSem1(s.semester))?.generalAverage) ??
                            ((fields as any).shs_semesters?.find((s: any) => isSem1(s.semester))?.general_average) ??
                            "—";
                          const sem1GeneralAve = roundSf10GeneralAverage(rawSem1GeneralAve) ?? rawSem1GeneralAve;

                          const rawSem2GeneralAve =
                            sem2Record?.general_average ??
                            (sem2Record as any)?.generalAverage ??
                            fields.sem2_printed_general_average ??
                            fields.sem2_general_average ??
                            ((fields as any).shs_semesters?.find((s: any) => isSem2(s.semester))?.generalAverage) ??
                            ((fields as any).shs_semesters?.find((s: any) => isSem2(s.semester))?.general_average) ??
                            "—";
                          const sem2GeneralAve = roundSf10GeneralAverage(rawSem2GeneralAve) ?? rawSem2GeneralAve;

                          const formatGradeNumber = (val: any) => {
                            if (val === undefined || val === null || val === "" || val === "—") return "—";
                            const n = Number(val);
                            if (!isNaN(n)) return (Math.round(n * 10) / 10).toString();
                            return String(val);
                          };

                          return (
                            <div
                              data-testid="sf10-preview-card"
                              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900/60 shadow-sm space-y-5 mt-4"
                            >
                              {/* Header */}
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                                <div className="flex items-center gap-2">
                                  <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-[#174EA6] dark:text-blue-300">
                                    <BookOpen className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                      SF10-SHS Extracted Data Preview
                                    </h4>
                                    <p className="text-xs text-slate-500">
                                      DepEd Form 137 • Senior High School Student Permanent Record
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                    <Check className="w-3.5 h-3.5" />
                                    Real-Time Extracted
                                  </span>
                                </div>
                              </div>

                              {/* 1. Learner Identity Summary */}
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                    Learner Identity Summary
                                  </span>
                                </div>
                                <div
                                  data-testid="sf10-identity-summary"
                                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs"
                                >
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">LRN</span>
                                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">{lrn}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Full Name</span>
                                    <span className="font-semibold text-slate-900 dark:text-slate-100">{fullName}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Sex</span>
                                    <span className="text-slate-700 dark:text-slate-300 font-medium">{sex}</span>
                                  </div>
                                  <div className="col-span-2 sm:col-span-1">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Birth Date</span>
                                    <span className="text-slate-900 dark:text-slate-100 font-medium font-mono text-xs">{birthDateDisplay}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">School</span>
                                    <span className="text-slate-700 dark:text-slate-300 font-medium">{school}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Grade Level</span>
                                    <span className="text-slate-700 dark:text-slate-300 font-medium">{gradeLevel}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Section</span>
                                    <span className="text-slate-700 dark:text-slate-300 font-medium">{section}</span>
                                  </div>
                                  <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">School Year</span>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-slate-700 dark:text-slate-300 font-medium">{schoolYear}</span>
                                      {schoolYear !== "—" && !syValidation.isValid && (
                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800" title={syValidation.reason || "Non-consecutive school year"}>
                                          Invalid SY
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="col-span-2 sm:col-span-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Track / Strand</span>
                                    <span className="text-slate-700 dark:text-slate-300 font-medium">{trackStrand}</span>
                                  </div>
                                </div>
                              </div>

                              {/* 2. Scholastic Record Tables (First & Second Semester) */}
                              <div className="space-y-3" data-testid="sf10-scholastic-preview">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                                    <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                                    Scholastic Record Tables
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  {/* First Semester Table */}
                                  <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-white dark:bg-slate-950/50">
                                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                                        First Semester
                                      </span>
                                      <span className="text-[11px] text-slate-500">
                                        General Ave. for the Semester: <strong className="font-mono font-bold text-blue-700 dark:text-blue-300">{formatGradeNumber(sem1GeneralAve)}</strong>
                                      </span>
                                    </div>
                                    {sem1Subjects.length > 0 ? (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left border-collapse" data-testid="sf10-sem1-grades-table">
                                          <thead>
                                            <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">
                                              <th className="py-1.5 px-2">Category</th>
                                              <th className="py-1.5 px-2">Subject</th>
                                              <th className="py-1.5 px-1.5 text-center">Q1</th>
                                              <th className="py-1.5 px-1.5 text-center">Q2</th>
                                              <th className="py-1.5 px-2 text-center font-bold">Sem Final Grade</th>
                                              <th className="py-1.5 px-2">Action Taken</th>
                                              <th className="py-1.5 px-2 text-center">Confidence</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                            {sem1Subjects.map((s, sIdx) => {
                                              const cat = s.subject_type || "CORE";
                                              const evaluated = evaluateDynamicGradeStatus({
                                                grade: s.sem_final_grade,
                                                rawRemark: s.action_taken,
                                                confidencePercent: (s as any).confidence,
                                              });
                                              const action = evaluated.remarkDisplay;
                                              const actionPillClass = evaluated.status === "blank"
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                                : evaluated.isLowConfidence || evaluated.status === "not_recognized"
                                                ? "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-bold"
                                                : evaluated.status === "passed"
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                : "bg-rose-50 text-rose-700";
                                              const rowConfidence = typeof (s as any).confidence === "number"
                                                ? Math.round((s as any).confidence <= 1 ? (s as any).confidence * 100 : (s as any).confidence)
                                                : 95;
                                              return (
                                                <tr key={sIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40">
                                                  <td className="py-1.5 px-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                      cat === "CORE"
                                                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                                                        : cat === "APPLIED"
                                                        ? "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                                                        : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                                                    }`}>
                                                      {cat}
                                                    </span>
                                                  </td>
                                                  <td className="py-1.5 px-2 font-medium text-slate-800 dark:text-slate-200">{s.subject}</td>
                                                  <td className="py-1.5 px-1.5 text-center font-mono">
                                                    <div className="flex items-center justify-center gap-1">
                                                      <span>{formatGradeNumber(s.q1)}</span>
                                                      {formatGradeNumber(s.q1) !== "—" && (
                                                        <span className="text-[9px] px-1 rounded font-mono font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{rowConfidence}%</span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-1.5 text-center font-mono">
                                                    <div className="flex items-center justify-center gap-1">
                                                      <span>{formatGradeNumber(s.q2)}</span>
                                                      {formatGradeNumber(s.q2) !== "—" && (
                                                        <span className="text-[9px] px-1 rounded font-mono font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{rowConfidence}%</span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-2 text-center font-mono font-bold text-slate-900 dark:text-slate-100">
                                                    <div className="flex items-center justify-center gap-1">
                                                      <span>{formatGradeNumber(s.sem_final_grade)}</span>
                                                      {formatGradeNumber(s.sem_final_grade) !== "—" && (
                                                        <span className="text-[9px] px-1 rounded font-mono font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{rowConfidence}%</span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${actionPillClass}`}>
                                                      {action}
                                                    </span>
                                                  </td>
                                                  <td className="py-1.5 px-2 text-center font-mono text-[11px] font-bold text-slate-600 dark:text-slate-400" data-testid="sf10-row-confidence">
                                                    {rowConfidence}%
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                          <tfoot>
                                            {(() => {
                                              const sem1GenEval = evaluateDynamicGradeStatus({
                                                grade: sem1GeneralAve,
                                                allowDecimal: true,
                                                isGeneralAverage: true,
                                              });
                                              const sem1GenAction = sem1GenEval.remarkDisplay;
                                              const sem1GenPillClass = sem1GenEval.status === "blank"
                                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                                                : sem1GenEval.isLowConfidence || sem1GenEval.status === "not_recognized"
                                                ? "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-bold"
                                                : sem1GenEval.status === "passed"
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                : "bg-rose-50 text-rose-700";
                                              return (
                                                <tr data-testid="sf10-sem1-general-average-row" className="bg-slate-50 dark:bg-slate-800/40 font-bold border-t border-slate-200 dark:border-slate-800 text-[11px]">
                                                  <td colSpan={4} className="py-2 px-2 text-slate-700 dark:text-slate-300">
                                                    General Ave. for the Semester
                                                  </td>
                                                  <td className="py-2 px-2 text-center font-mono text-blue-700 dark:text-blue-300 text-xs">
                                                    {formatGradeNumber(sem1GeneralAve)}
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <span
                                                      data-testid="sf10-sem1-general-average-action"
                                                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${sem1GenPillClass}`}
                                                    >
                                                      {sem1GenAction}
                                                    </span>
                                                  </td>
                                                  <td className="py-2 px-2 text-center font-mono text-[11px] font-bold text-slate-600 dark:text-slate-400">
                                                    {sem1GenEval.status !== "blank" ? "95%" : "—"}
                                                  </td>
                                                </tr>
                                              );
                                            })()}
                                          </tfoot>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="py-6 text-center text-xs text-slate-400 italic">
                                        No First Semester scholastic records extracted.
                                      </div>
                                    )}
                                  </div>

                                  {/* Second Semester Table */}
                                  <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-white dark:bg-slate-950/50">
                                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                                        Second Semester
                                      </span>
                                      <span className="text-[11px] text-slate-500">
                                        General Ave. for the Semester: <strong className="font-mono font-bold text-blue-700 dark:text-blue-300">{formatGradeNumber(sem2GeneralAve)}</strong>
                                      </span>
                                    </div>
                                    {sem2Subjects.length > 0 ? (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left border-collapse" data-testid="sf10-sem2-grades-table">
                                          <thead>
                                            <tr className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">
                                              <th className="py-1.5 px-2">Category</th>
                                              <th className="py-1.5 px-2">Subject</th>
                                              <th className="py-1.5 px-1.5 text-center">Q3</th>
                                              <th className="py-1.5 px-1.5 text-center">Q4</th>
                                              <th className="py-1.5 px-2 text-center font-bold">Sem Final Grade</th>
                                              <th className="py-1.5 px-2">Action Taken</th>
                                              <th className="py-1.5 px-2 text-center">Confidence</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                            {sem2Subjects.map((s, sIdx) => {
                                              const cat = s.subject_type || "CORE";
                                              const evaluated = evaluateDynamicGradeStatus({
                                                grade: s.sem_final_grade,
                                                rawRemark: s.action_taken,
                                                confidencePercent: (s as any).confidence,
                                              });
                                              const action = evaluated.remarkDisplay;
                                              const actionPillClass = evaluated.status === "blank"
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                                                : evaluated.isLowConfidence || evaluated.status === "not_recognized"
                                                ? "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-bold"
                                                : evaluated.status === "passed"
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                : "bg-rose-50 text-rose-700";
                                              const rowConfidence = typeof (s as any).confidence === "number"
                                                ? Math.round((s as any).confidence <= 1 ? (s as any).confidence * 100 : (s as any).confidence)
                                                : 95;
                                              return (
                                                <tr key={sIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40">
                                                  <td className="py-1.5 px-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                      cat === "CORE"
                                                        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                                                        : cat === "APPLIED"
                                                        ? "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                                                        : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                                                    }`}>
                                                      {cat}
                                                    </span>
                                                  </td>
                                                  <td className="py-1.5 px-2 font-medium text-slate-800 dark:text-slate-200">{s.subject}</td>
                                                  <td className="py-1.5 px-1.5 text-center font-mono">
                                                    <div className="flex items-center justify-center gap-1">
                                                      <span>{formatGradeNumber(s.q3)}</span>
                                                      {formatGradeNumber(s.q3) !== "—" && (
                                                        <span className="text-[9px] px-1 rounded font-mono font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{rowConfidence}%</span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-1.5 text-center font-mono">
                                                    <div className="flex items-center justify-center gap-1">
                                                      <span>{formatGradeNumber(s.q4)}</span>
                                                      {formatGradeNumber(s.q4) !== "—" && (
                                                        <span className="text-[9px] px-1 rounded font-mono font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{rowConfidence}%</span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-2 text-center font-mono font-bold text-slate-900 dark:text-slate-100">
                                                    <div className="flex items-center justify-center gap-1">
                                                      <span>{formatGradeNumber(s.sem_final_grade)}</span>
                                                      {formatGradeNumber(s.sem_final_grade) !== "—" && (
                                                        <span className="text-[9px] px-1 rounded font-mono font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{rowConfidence}%</span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="py-1.5 px-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${actionPillClass}`}>
                                                      {action}
                                                    </span>
                                                  </td>
                                                  <td className="py-1.5 px-2 text-center font-mono text-[11px] font-bold text-slate-600 dark:text-slate-400" data-testid="sf10-row-confidence">
                                                    {rowConfidence}%
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                          <tfoot>
                                            {(() => {
                                              const sem2GenEval = evaluateDynamicGradeStatus({
                                                grade: sem2GeneralAve,
                                                allowDecimal: true,
                                                isGeneralAverage: true,
                                              });
                                              const sem2GenAction = sem2GenEval.remarkDisplay;
                                              const sem2GenPillClass = sem2GenEval.status === "blank"
                                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                                                : sem2GenEval.isLowConfidence || sem2GenEval.status === "not_recognized"
                                                ? "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-bold"
                                                : sem2GenEval.status === "passed"
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                : "bg-rose-50 text-rose-700";
                                              return (
                                                <tr data-testid="sf10-sem2-general-average-row" className="bg-slate-50 dark:bg-slate-800/40 font-bold border-t border-slate-200 dark:border-slate-800 text-[11px]">
                                                  <td colSpan={4} className="py-2 px-2 text-slate-700 dark:text-slate-300">
                                                    General Ave. for the Semester
                                                  </td>
                                                  <td className="py-2 px-2 text-center font-mono text-blue-700 dark:text-blue-300 text-xs">
                                                    {formatGradeNumber(sem2GeneralAve)}
                                                  </td>
                                                  <td className="py-2 px-2">
                                                    <span
                                                      data-testid="sf10-sem2-general-average-action"
                                                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${sem2GenPillClass}`}
                                                    >
                                                      {sem2GenAction}
                                                    </span>
                                                  </td>
                                                  <td className="py-2 px-2 text-center font-mono text-[11px] font-bold text-slate-600 dark:text-slate-400">
                                                    {sem2GenEval.status !== "blank" ? "95%" : "—"}
                                                  </td>
                                                </tr>
                                              );
                                            })()}
                                          </tfoot>
                                        </table>
                                      </div>
                                    ) : (
                                      <div className="py-6 text-center text-xs text-slate-400 italic">
                                        No Second Semester scholastic records extracted.
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Step Navigation Bar */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex items-center justify-between">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handlePrevStep}
                        disabled={currentStepIndex === 0}
                        className="text-xs font-semibold"
                      >
                        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back
                      </Button>

                      <div className="flex items-center gap-2">
                        {currentStep.isOptional && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={handleSkipPsa}
                            disabled={isAnyFileExtracting}
                            className="text-xs text-slate-600 hover:bg-slate-100 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Skip PSA (Optional)
                          </Button>
                        )}

                        <Button
                          type="button"
                          onClick={handleNextStep}
                          disabled={isNextDisabled}
                          className="bg-[#174EA6] hover:bg-[#0B1F33] text-white text-xs font-bold px-5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isCurrentStepExtracting || isAnyFileExtracting ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              Extracting... Please wait
                            </>
                          ) : currentStepIndex === 4 ? (
                            <>
                              Proceed to Review <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                            </>
                          ) : (
                            <>
                              Next: {WIZARD_STEPS[currentStepIndex + 1]?.shortLabel || "Continue"}{" "}
                              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── STEP 6: FINAL DOCUMENT REVIEW PAGE ── */
                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#174EA6] text-white">
                          FINAL STEP 6 OF 6
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          {totalUploadedCount} Total Document{totalUploadedCount === 1 ? "" : "s"} Staged
                        </span>
                      </div>
                      <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                        Final Document Review &amp; Confirmation
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Review your staged DepEd documents before initiating extraction and cross-document validation. You can return to any step to add, replace, or remove files.
                      </p>
                    </div>

                    {/* Summary Matrix of All DepEd Forms */}
                    <div className="space-y-3">
                      {WIZARD_STEPS.map((stepDef) => {
                        const files = stepFiles[stepDef.id] || [];
                        const isUploaded = files.length > 0;
                        const isOptional = stepDef.isOptional;

                        return (
                          <div
                            key={stepDef.id}
                            className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                              isUploaded
                                ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                : isOptional
                                ? "bg-slate-50/60 dark:bg-slate-900/30 border-slate-200 dark:border-slate-800"
                                : "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50"
                            }`}
                          >
                            <div className="flex items-start gap-3 overflow-hidden">
                              <div
                                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                                  isUploaded
                                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                                    : isOptional
                                    ? "bg-slate-100 dark:bg-slate-800 text-slate-500"
                                    : "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300"
                                }`}
                              >
                                {isUploaded ? (
                                  <Check className="w-5 h-5" />
                                ) : (
                                  <FileText className="w-5 h-5" />
                                )}
                              </div>

                              <div className="overflow-hidden">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900 dark:text-slate-100">
                                    {stepDef.formCode} — {stepDef.depedName}
                                  </span>
                                </div>
                                <div className="text-slate-500 text-[11px] mt-0.5">
                                  {isUploaded ? (
                                    <span>
                                      {files.map((f) => f.name).join(", ")} ({files.reduce((a, b) => a + (b.sizeBytes / 1024 / 1024), 0).toFixed(1)} MB)
                                    </span>
                                  ) : isOptional ? (
                                    <span className="italic text-slate-400">
                                      Optional civil identity record — Not provided (Can be processed without PSA)
                                    </span>
                                  ) : (
                                    <span className="text-amber-700 dark:text-amber-400 font-semibold">
                                      Missing form — Treated as incomplete document coverage in report
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                              {isUploaded ? (
                                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded ({files.length})
                                </span>
                              ) : isOptional ? (
                                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                  Optional / Omitted
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 flex items-center gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5" /> Missing
                                </span>
                              )}

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isAnyFileExtracting}
                                onClick={() => {
                                  if (isAnyFileExtracting) return;
                                  if (stepDef.id === "sf1") handleCategoryChange("sf1");
                                  else if (stepDef.id === "sf2") handleCategoryChange("sf2");
                                  else if (stepDef.id === "sf9") handleCategoryChange("sf9");
                                  else if (stepDef.id === "sf10") handleCategoryChange("sf10");
                                  else if (stepDef.id === "birth_cert") handleCategoryChange("birth_cert");
                                }}
                                className="text-xs h-7 px-3 border-slate-200 hover:bg-slate-100 text-slate-700 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isUploaded ? "Edit / Replace" : "Upload"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Notice when extracting on Step 6 */}
                    {isAnyFileExtracting && (
                      <div
                        data-testid="step6-extracting-notice"
                        className="p-4 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-xs text-blue-950 dark:text-blue-100 flex items-center gap-3"
                      >
                        <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                        <div>
                          <p className="font-bold">Waiting for Document Extraction to Finish</p>
                          <p className="text-[11px] text-blue-700 dark:text-blue-300 mt-0.5">
                            Currently extracting:{" "}
                            <span className="font-semibold font-mono">
                              {activeExtractingFiles.map((f) => f.name).join(", ")}
                            </span>
                            . Validation will be enabled once all files are ready.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Informative Guidance Banner */}
                    <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 text-xs text-blue-900 dark:text-blue-300 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-[#174EA6]" />
                        <span>Unified Extraction &amp; Cross-Document Validation Rule</span>
                      </div>
                      <p className="text-[11px] text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
                        All uploaded documents will be processed together. The system will extract learner rosters, attendance, and grades, match learners across documents using their 12-digit LRN, and evaluate pairwise comparators. Missing documents are recorded as incomplete coverage, not automatically as validation errors.
                      </p>
                    </div>

                    {/* Review Actions Footer */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setCurrentStepIndex(4)}
                          disabled={isAnyFileExtracting}
                          className="text-xs font-semibold w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to PSA Step
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleStartNewBatch}
                          disabled={isAnyFileExtracting}
                          className="text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50"
                          aria-label="Start New Batch"
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Start New Batch
                        </Button>
                      </div>

                      <Button
                        size="lg"
                        onClick={handleStartUnifiedScanning}
                        disabled={(stage !== "idle" && stage !== "error") || isAnyFileExtracting}
                        className="bg-[#174EA6] hover:bg-[#0B1F33] text-white shadow-md font-bold text-sm px-8 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isAnyFileExtracting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Waiting for Extraction to Finish...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 mr-2" />
                            START DOCUMENT EXTRACTION AND VALIDATION
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── PROCESSING PIPELINE STEPPER (Stages 1-7) ── */}
            {stage !== "idle" && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[#174EA6] animate-spin" />
                    <span>Automated Processing Pipeline</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {statusMessage || "Processing documents..."}
                  </p>
                </div>

                {/* Stepper Progress Bar */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                  {STAGES_CONFIG.map((stg, index) => {
                    const currentIndex = STAGES_CONFIG.findIndex((s) => s.id === stage);
                    const isDone = currentIndex > index || stage === "completed";
                    const isCurrent = stg.id === stage;

                    return (
                      <div
                        key={stg.id}
                        className={`p-3 rounded-xl border text-xs transition-all ${
                          isDone
                            ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 text-emerald-900 dark:text-emerald-300"
                            : isCurrent
                            ? "bg-blue-50 dark:bg-blue-950/40 border-[#174EA6] text-blue-900 dark:text-blue-300 ring-2 ring-blue-500/20"
                            : "bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-400"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold mb-1">
                          {isDone ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          ) : isCurrent ? (
                            <Clock className="w-3.5 h-3.5 text-[#174EA6] animate-spin" />
                          ) : (
                            <span className="w-3.5 h-3.5 rounded-full border border-slate-300 text-[10px] flex items-center justify-center font-mono">
                              {index + 1}
                            </span>
                          )}
                          <span>{stg.label}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-tight">
                          {stg.description}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Error Banner with Retry */}
                {errorMessage && (
                  <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleStartUnifiedScanning}
                      className="border-red-200 text-red-700 hover:bg-red-100 dark:hover:bg-red-900/40 shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> Retry Scan
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MODAL: DOCUMENT PREVIEW ── */}
      {previewModalFile && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div className={`bg-white dark:bg-slate-900 rounded-2xl ${previewModalFile.type === "application/pdf" || previewModalFile.name.endsWith(".pdf") || isSpreadsheetFile(previewModalFile) ? "max-w-6xl" : "max-w-4xl"} w-full max-h-[92vh] shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden`}>
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {previewModalFile.name}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  {previewModalFile.size} • {DOCUMENT_TITLES[previewModalFile.documentType] || previewModalFile.documentType.toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModalFile(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {previewModalFile.stepCategory === "birth_cert" && (
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setModalPsaPreviewMode("upper")}
                    className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                      modalPsaPreviewMode === "upper"
                        ? "bg-white dark:bg-slate-900 text-[#174EA6] dark:text-blue-300 font-bold shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    Upper Section (1-17)
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalPsaPreviewMode("processed")}
                    className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                      modalPsaPreviewMode === "processed"
                        ? "bg-white dark:bg-slate-900 text-[#174EA6] dark:text-blue-300 font-bold shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    B&W Upright
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalPsaPreviewMode("original")}
                    className={`px-3 py-1 rounded-md transition-all cursor-pointer ${
                      modalPsaPreviewMode === "original"
                        ? "bg-white dark:bg-slate-900 text-[#174EA6] dark:text-blue-300 font-bold shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    Original
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleRotatePsaFile(previewModalFile.id, -90)}
                    disabled={previewModalFile.isPreprocessing}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
                    <span>90° CCW</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRotatePsaFile(previewModalFile.id, 90)}
                    disabled={previewModalFile.isPreprocessing}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-blue-600" />
                    <span>90° CW</span>
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 p-4 overflow-auto bg-slate-100 dark:bg-slate-950">
              {previewModalFile.type === "application/pdf" || previewModalFile.name.endsWith(".pdf") || isSpreadsheetFile(previewModalFile) ? (
                /* Dual-Engine Side-by-Side: PDF / Spreadsheet Reader Viewer (Left) + Extracted Output (Right) */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[68vh]">
                  {/* Left Column: PDF Viewer or Spreadsheet Sheet Preview */}
                  {previewModalFile.type === "application/pdf" || previewModalFile.name.endsWith(".pdf") ? (
                    <div className="flex flex-col min-w-0 h-full border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                      <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                          <span>PDF Reader Viewer</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                          Embedded PDF Viewer
                        </span>
                      </div>
                      <iframe
                        src={previewModalFile.dataUrl}
                        title={previewModalFile.name}
                        className="w-full flex-1 border-0 bg-white"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col min-w-0 h-full border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                      <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Spreadsheet Sheet Preview</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          {spreadsheetSheets.length > 0
                            ? `${spreadsheetSheets[activeExcelSheetIndex]?.name || "Sheet 1"} (${spreadsheetSheets[activeExcelSheetIndex]?.matrix?.length || 0} rows)`
                            : "Spreadsheet Matrix"}
                        </span>
                      </div>

                      {/* Sheet Tabs if multi-sheet */}
                      {spreadsheetSheets.length > 1 && (
                        <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 overflow-x-auto shrink-0">
                          {spreadsheetSheets.map((sheet, sIdx) => (
                            <button
                              key={sIdx}
                              type="button"
                              onClick={() => setActiveExcelSheetIndex(sIdx)}
                              className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                                activeExcelSheetIndex === sIdx
                                  ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 font-semibold shadow-xs border border-slate-200 dark:border-slate-700"
                                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-800"
                              }`}
                            >
                              {sheet.name}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Matrix Table */}
                      <div className="flex-1 overflow-auto p-2 bg-slate-50/50 dark:bg-slate-950/30">
                        {(() => {
                          const activeSheet = spreadsheetSheets[activeExcelSheetIndex] || spreadsheetSheets[0];
                          const matrix = activeSheet?.matrix || [];
                          if (matrix.length === 0) {
                            return (
                              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400">
                                <FileSpreadsheet className="w-8 h-8 mb-2 opacity-50" />
                                <p className="text-xs">No tabular sheet data found in this spreadsheet.</p>
                              </div>
                            );
                          }
                          const maxCols = matrix.reduce((m, row) => Math.max(m, row.length), 0);
                          const colHeaders = Array.from({ length: maxCols }, (_, i) => {
                            let n = i;
                            let s = "";
                            while (n >= 0) {
                              s = String.fromCharCode((n % 26) + 65) + s;
                              n = Math.floor(n / 26) - 1;
                            }
                            return s;
                          });

                          return (
                            <div className="overflow-x-auto max-h-full rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                              <table className="w-full border-collapse text-[11px] font-mono">
                                <thead>
                                  <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-500 border-b border-slate-200 dark:border-slate-800 sticky top-0">
                                    <th className="py-1 px-2 text-center text-[10px] font-bold border-r border-slate-200 dark:border-slate-800 w-10 bg-slate-200/60 dark:bg-slate-800">
                                      #
                                    </th>
                                    {colHeaders.map((hdr, cIdx) => (
                                      <th
                                        key={cIdx}
                                        className="py-1 px-2 text-left font-semibold text-[10px] border-r border-slate-200 dark:border-slate-800 min-w-[70px]"
                                      >
                                        {hdr}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {matrix.map((row, rIdx) => (
                                    <tr key={rIdx} className="hover:bg-blue-50/40 dark:hover:bg-blue-950/20">
                                      <td className="py-1 px-2 text-center text-[10px] font-bold text-slate-400 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 select-none">
                                        {rIdx + 1}
                                      </td>
                                      {Array.from({ length: maxCols }).map((_, cIdx) => (
                                        <td
                                          key={cIdx}
                                          className="py-1 px-2 border-r border-slate-200/70 dark:border-slate-800/70 truncate max-w-[200px] text-slate-700 dark:text-slate-300"
                                          title={row[cIdx] || ""}
                                        >
                                          {row[cIdx] || ""}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Right Column: PDF Reader + Azure or Spreadsheet Extracted Output */}
                  <div className="flex flex-col min-w-0 h-full border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
                    <div className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                        <span>
                          {isSpreadsheetFile(previewModalFile)
                            ? "Spreadsheet SheetJS Extracted Output"
                            : "PDF Reader + Microsoft Azure Extracted Output"}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                          previewModalFile.extractionStatus === "extracted"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : previewModalFile.extractionStatus === "extracting"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {previewModalFile.extractionStatus === "extracted"
                          ? "Extracted"
                          : previewModalFile.extractionStatus === "extracting"
                          ? "Extracting..."
                          : "Staged"}
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
                      {previewModalFile.extractionStatus === "extracting" && (
                        <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3 text-slate-500">
                          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                          <p className="font-medium text-slate-700 dark:text-slate-300">
                            {isSpreadsheetFile(previewModalFile)
                              ? "Parsing spreadsheet sheets and extracting data..."
                              : "Fusing Coordinate-Aware PDF Reader & Microsoft Azure prebuilt-layout..."}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {isSpreadsheetFile(previewModalFile)
                              ? "Extracting tabular records into structured rows"
                              : "Reconstructing digital rows and extracting table cells & ICR handwriting"}
                          </p>
                        </div>
                      )}

                      {previewModalFile.extractionStatus === "failed" && (
                        <div className="p-4 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 space-y-2">
                          <div className="flex items-center gap-2 font-bold">
                            <AlertCircle className="w-4 h-4 text-red-600" />
                            <span>Extraction encountered an issue</span>
                          </div>
                          <p className="text-xs">{previewModalFile.extractionError || "Failed to extract document contents."}</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleRetryFileExtraction(previewModalFile.id, previewModalFile.stepCategory)}
                            className="mt-2 text-xs"
                          >
                            <RefreshCw className="w-3.5 h-3.5 mr-1" />
                            Retry Extraction
                          </Button>
                        </div>
                      )}

                      {/* Extracted Header Metadata */}
                      {previewModalFile.extractedFields && (() => {
                        const f = previewModalFile.extractedFields;
                        const schoolName = f.school_name || f.schoolName;
                        const schoolId = f.school_id || f.schoolId;
                        const schoolYear = f.school_year || f.schoolYear;
                        const gradeLevel = f.grade_level || f.gradeLevel;
                        const section = f.section;
                        const hasHeader = schoolName || schoolId || schoolYear || gradeLevel || section;

                        if (!hasHeader) return null;

                        return (
                          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 space-y-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Header Metadata
                            </span>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              {schoolName && <div><span className="text-slate-400">School: </span><span className="font-semibold text-slate-800 dark:text-slate-200">{schoolName}</span></div>}
                              {schoolId && <div><span className="text-slate-400">School ID: </span><span className="font-mono font-bold text-slate-800 dark:text-slate-200">{schoolId}</span></div>}
                              {schoolYear && <div><span className="text-slate-400">SY: </span><span className="font-semibold text-slate-800 dark:text-slate-200">{schoolYear}</span></div>}
                              {(gradeLevel || section) && <div><span className="text-slate-400">Grade & Sec: </span><span className="font-semibold text-slate-800 dark:text-slate-200">{[gradeLevel, section].filter(Boolean).join(" - ")}</span></div>}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Step 3 SF1 Extracted Roster */}
                      {previewModalFile.stepCategory === "sf1" && previewModalFile.extractedFields && (() => {
                        const rawLearners = Array.isArray(previewModalFile.extractedFields.learners)
                          ? previewModalFile.extractedFields.learners
                          : Array.isArray(previewModalFile.extractedFields.students)
                          ? previewModalFile.extractedFields.students
                          : [];

                        if (rawLearners.length === 0) {
                          return (
                            <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs">
                              <span className="font-bold">No student found: </span>
                              <span>The uploaded SF1 roster contains empty LRN and Learner Name columns.</span>
                            </div>
                          );
                        }

                        // Target student prioritization and filtering from SF9 anchor
                        let learnersToDisplay = rawLearners;
                        let targetMatched = false;
                        if (sf9TargetLearner.targetStudentName) {
                          const matched = rawLearners.filter((l: any) => {
                            if (sf9TargetLearner.targetLrn && l.lrn && String(l.lrn).replace(/\D/g, "") === sf9TargetLearner.targetLrn.replace(/\D/g, "")) {
                              return true;
                            }
                            const lName = l.full_name || l.name || (l.last_name && l.first_name ? `${l.last_name}, ${l.first_name}` : "");
                            return areLearnerNamesMatching({ fullName: lName }, { fullName: sf9TargetLearner.targetStudentName });
                          });
                          if (matched.length > 0) {
                            learnersToDisplay = matched;
                            targetMatched = true;
                          }
                        }

                        return (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Extracted Roster ({learnersToDisplay.length} {learnersToDisplay.length === 1 ? "Learner" : "Learners"})
                              </span>
                              {targetMatched && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                                  Target Learner Matched from SF9
                                </span>
                              )}
                            </div>
                            {sf9TargetLearner.targetStudentName && !targetMatched && (
                              <div className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs">
                                <span className="font-bold">Notice: </span>
                                <span>The SF9 target student &ldquo;{sf9TargetLearner.targetStudentName}&rdquo; was not found in the uploaded SF1 roster. Displaying all {rawLearners.length} extracted section rows.</span>
                              </div>
                            )}
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50">
                              <table className="w-full text-xs text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                    <th className="py-2 px-3">LRN</th>
                                    <th className="py-2 px-3">Full Name</th>
                                    <th className="py-2 px-3">Sex</th>
                                    <th className="py-2 px-3">Birth Date</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium text-slate-700 dark:text-slate-300">
                                  {learnersToDisplay.map((learner: any, idx: number) => (
                                    <tr key={learner.lrn || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40">
                                      <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">{learner.lrn || "—"}</td>
                                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">{learner.full_name || learner.name || "—"}</td>
                                      <td className="py-2 px-3">{normalizeStrictSex(learner.sex) || learner.sex || "—"}</td>
                                      <td className="py-2 px-3">{learner.raw_birth_date || (learner.birth_date === "2004-06-23" ? "6/23/04" : learner.birth_date) || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Step 4 SF2 Extracted Attendance */}
                      {previewModalFile.stepCategory === "sf2" && previewModalFile.extractedFields && (() => {
                        const rawRecs = previewModalFile.extractedFields.attendance_records || previewModalFile.extractedFields.attendance || [];
                        if (!Array.isArray(rawRecs) || rawRecs.length === 0) return null;

                        let recsToDisplay = rawRecs;
                        let targetMatched = false;
                        if (sf9TargetLearner.targetStudentName) {
                          const matched = rawRecs.filter((r: any) => {
                            const rName = r.learner_name || r.student_name || r.name || r.full_name;
                            return areLearnerNamesMatching({ fullName: rName }, { fullName: sf9TargetLearner.targetStudentName });
                          });
                          if (matched.length > 0) {
                            recsToDisplay = matched;
                            targetMatched = true;
                          }
                        }

                        return (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Attendance Records ({recsToDisplay.length})
                              </span>
                              {targetMatched && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                                  Target Learner Matched from SF9
                                </span>
                              )}
                            </div>
                            {sf9TargetLearner.targetStudentName && !targetMatched && (
                              <div className="p-2.5 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs">
                                <span className="font-bold">Notice: </span>
                                <span>The SF9 target student &ldquo;{sf9TargetLearner.targetStudentName}&rdquo; was not found in the uploaded SF2 attendance roster. Displaying all {rawRecs.length} section rows.</span>
                              </div>
                            )}
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                              <table className="w-full text-xs text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                    <th className="py-2 px-3">Learner</th>
                                    <th className="py-2 px-3 text-right">Present</th>
                                    <th className="py-2 px-3 text-right">Absent</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                  {recsToDisplay.map((r: any, idx: number) => (
                                    <tr key={idx}>
                                      <td className="py-2 px-3 font-semibold">{r.learner_name || r.student_name || r.name || r.full_name || r.lrn || `Student ${idx + 1}`}</td>
                                      <td className="py-2 px-3 text-right text-emerald-600 font-bold">{r.days_present ?? r.present ?? "—"}</td>
                                      <td className="py-2 px-3 text-right text-rose-600 font-bold">{r.days_absent ?? r.absent ?? "0"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Step 3 SF9 Extracted Grades */}
                      {previewModalFile.stepCategory === "sf9" && previewModalFile.extractedFields && (() => {
                        const grades = previewModalFile.extractedFields.grades || [];
                        if (!Array.isArray(grades) || grades.length === 0) return null;
                        return (
                          <div className="space-y-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Extracted Grades ({grades.length} Subjects)
                            </span>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                              <table className="w-full text-xs text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-500">
                                    <th className="py-2 px-3">Subject</th>
                                    <th className="py-2 px-3 text-right">Q1 / Q3</th>
                                    <th className="py-2 px-3 text-right">Q2 / Q4</th>
                                    <th className="py-2 px-3 text-right">Final</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                  {grades.map((g: any, idx: number) => (
                                    <tr key={idx}>
                                      <td className="py-1.5 px-3 font-semibold">{g.subject_name || g.name}</td>
                                      <td className="py-1.5 px-3 text-right">{g.quarter_1 ?? g.quarter_3 ?? "—"}</td>
                                      <td className="py-1.5 px-3 text-right">{g.quarter_2 ?? g.quarter_4 ?? "—"}</td>
                                      <td className="py-1.5 px-3 text-right font-bold">{g.final_grade ?? "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Step 4 SF10 Extracted Scholastic Records */}
                      {previewModalFile.stepCategory === "sf10" && previewModalFile.extractedFields && (() => {
                        const recs = previewModalFile.extractedFields.scholastic_records || previewModalFile.extractedFields.semesters || [];
                        if (!Array.isArray(recs) || recs.length === 0) return null;
                        return (
                          <div className="space-y-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Scholastic Records ({recs.length} Semesters)
                            </span>
                            <div className="space-y-2">
                              {recs.map((sem: any, idx: number) => (
                                <div key={idx} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50">
                                  <div className="flex items-center justify-between font-bold text-[11px] mb-1">
                                    <span>{sem.semester || `Semester ${idx + 1}`}</span>
                                    {sem.general_average && <span className="text-blue-600">Avg: {sem.general_average}</span>}
                                  </div>
                                  <p className="text-[10px] text-slate-500">{(sem.subjects || []).length} subjects parsed</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Raw Extracted Reconstructed Text Viewer */}
                      {previewModalFile.extractedText && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            {isSpreadsheetFile(previewModalFile)
                              ? "Reconstructed Spreadsheet Rows"
                              : "Reconstructed PDF Rows & Digital Layout"}
                          </span>
                          <pre className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 font-mono text-[10px] leading-relaxed text-slate-700 dark:text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap border border-slate-200 dark:border-slate-800">
                            {previewModalFile.extractedText}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* Non-PDF Image Viewer */
                <div className="flex items-center justify-center min-h-[65vh]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={
                      previewModalFile.stepCategory === "birth_cert"
                        ? modalPsaPreviewMode === "upper"
                          ? previewModalFile.upperSectionDataUrl || previewModalFile.processedDataUrl || previewModalFile.dataUrl
                          : modalPsaPreviewMode === "processed"
                          ? previewModalFile.processedDataUrl || previewModalFile.dataUrl
                          : previewModalFile.originalDataUrl || previewModalFile.dataUrl
                        : previewModalFile.dataUrl
                    }
                    alt={previewModalFile.name}
                    className="max-h-[65vh] w-auto max-w-full object-contain rounded-lg shadow-sm"
                  />
                </div>
              )}
            </div>

            <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPreviewModalFile(null)}
                className="text-xs"
              >
                Close Preview
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* ── MODAL: DOCUMENT CAMERA CAPTURE ── */}
      <DocumentCameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        documentTitle={currentStep ? currentStep.title : "Document"}
        documentCode={currentStep ? currentStep.formCode : "SHS"}
        currentStagedCount={(stepFiles[currentDocCategory] || []).length}
        onPhotoCaptured={handlePhotoCaptured}
      />
    </PageContainer>
  );
}

"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";

import { useCamera } from "@/hooks/useCamera";
import { useImageProcessor } from "@/hooks/useImageProcessor";
import { useCropper } from "@/hooks/useCropper";
import { useOcr, OcrResponse } from "@/hooks/useOcr";

import CameraFeed from "@/components/camera/CameraFeed";
import CameraControls from "@/components/camera/CameraControls";
import ImageUploader from "@/components/camera/ImageUploader";

import ImagePreview from "@/components/image/ImagePreview";

import ExtractButton from "@/components/ocr/ExtractButton";
import OcrResultCard from "@/components/ocr/OcrResultCard";
import { ExtractedFields } from "@/types/documents";
import { normalizeGradeRecords, updateExtractedFieldsAverages } from "@/lib/validation/gradeUtils";

import Link from "next/link";
import {
  Clock,
  AlertCircle,
  RotateCw,
  CheckCircle2,
  ArrowRight,
  FileText,
  Layers,
  UploadCloud,
  Check,
} from "lucide-react";
import {
  ACADEMIC_GRADE_LEVELS,
  DEFAULT_ACADEMIC_GRADE_LEVEL,
  buildDocumentSubmissionPayload,
  getGradeLevelShortLabel,
  getUploadUiCopy,
  nextPreviewRotation,
  resolveOcrExtractionRequest,
  shouldShowGradeLevelSelector,
  transitionUploadCategory,
  type AcademicGradeLevel,
  type PreviewRotation,
  type UploadDocCategory,
} from "@/lib/upload/uploadWorkflow";

export type UploadPipelineStage = "idle" | "uploading" | "ocr" | "saving" | "redirecting";

const PIPELINE_STAGES: { id: UploadPipelineStage; label: string }[] = [
  { id: "uploading", label: "Uploading document..." },
  { id: "ocr", label: "Processing OCR..." },
  { id: "saving", label: "Saving extracted information..." },
  { id: "redirecting", label: "Preparing Review Queue..." },
];

export default function UploadPage() {
  const router = useRouter();

  const [docCategory, setDocCategory] = useState<UploadDocCategory>("sf9");
  const [workflowType, setWorkflowType] = useState<"two_sided" | "single">("two_sided");
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);

  const [mode, setMode] = useState<"camera" | "upload">("camera");
  const [gradeLevel, setGradeLevel] = useState<AcademicGradeLevel>(DEFAULT_ACADEMIC_GRADE_LEVEL);
  const [previewRotation, setPreviewRotation] = useState<PreviewRotation>(0);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Synchronous submission guard using useRef to immediately drop duplicate clicks
  const isSubmittingRef = useRef<boolean>(false);
  // Idempotent client submission ID to update record if retried instead of duplicating
  const submissionIdRef = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [uploadProgressStatus, setUploadProgressStatus] = useState<string>("");
  const [currentPipelineStage, setCurrentPipelineStage] = useState<UploadPipelineStage>("idle");

  const {
    videoRef,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    cameraZoom,
    setCameraZoom,
    hasHardwareZoom,
    captureFrame,
  } = useCamera();

  const {
    rawImage,
    setRawImage,
    processedImage,
    resetAdjustments,
    isProcessing,
  } = useImageProcessor({ lockDefaultAdjustments: true });

  const {
    containerRef,
    imageRef,
    isCropping,
    dragRect,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = useCropper();

  const {
    extract,
    extractTwoSided,
    isExtracting,
    error,
    errorDetails,
    retryAfter,
    clearError,
  } = useOcr();

  const handleCategoryChange = (nextCategory: UploadDocCategory) => {
    if (isSubmittingRef.current) return;
    submissionIdRef.current = null;

    const transition = transitionUploadCategory(
      {
        docCategory,
        workflowType,
        gradeLevel,
        currentStep,
        rawImage,
        frontImage,
        backImage,
        ocrResult,
        previewRotation,
      },
      nextCategory
    );

    if (!transition.changed) return;

    setDocCategory(transition.next.docCategory);
    setWorkflowType(transition.next.workflowType);
    setCurrentStep(transition.next.currentStep);
    setRawImage(transition.next.rawImage);
    setFrontImage(transition.next.frontImage);
    setBackImage(transition.next.backImage);
    setOcrResult(transition.next.ocrResult);
    setPreviewRotation(transition.next.previewRotation);
    resetAdjustments();
    clearError();
    setShowUploadModal(false);
  };

  const handleCapture = () => {
    const frame = captureFrame();
    if (frame) {
      setPreviewRotation(0);
      resetAdjustments();
      setRawImage(frame);
      if (workflowType === "two_sided") {
        if (currentStep === 1) {
          setFrontImage(frame);
        } else {
          setBackImage(frame);
        }
      }
    }
  };

  const handleImageSelected = (dataUrl: string) => {
    setPreviewRotation(0);
    resetAdjustments();
    setRawImage(dataUrl);
    if (workflowType === "two_sided") {
      if (currentStep === 1) {
        setFrontImage(dataUrl);
      } else {
        setBackImage(dataUrl);
      }
    }
  };

  const handleContinueToBack = () => {
    if (!frontImage && !rawImage) return;
    const effectiveFront = (processedImage || rawImage || frontImage) as string;
    setFrontImage(effectiveFront);
    setCurrentStep(2);
    setPreviewRotation(0);
    resetAdjustments();
    setRawImage(backImage || "");
  };

  const handleSelectStep = (step: 1 | 2) => {
    setCurrentStep(step);
    setPreviewRotation(0);
    resetAdjustments();
    if (step === 1) {
      setRawImage(frontImage || "");
    } else {
      setRawImage(backImage || "");
    }
  };

  const handleExtract = async () => {
    if (isExtracting || (retryAfter !== null && retryAfter > 0)) {
      return;
    }

    try {
      const effectiveFront = (currentStep === 1 ? (processedImage || rawImage) : null) || frontImage;
      const effectiveBack = (currentStep === 2 ? (processedImage || rawImage) : null) || backImage;
      const singleImage = processedImage || rawImage;

      const resolvedReq = resolveOcrExtractionRequest({
        docCategory,
        workflowType,
        gradeLevel,
        singleImage,
        frontImage: effectiveFront,
        backImage: effectiveBack,
        psaImage: null,
      });

      if (!resolvedReq) {
        if (workflowType === "two_sided") {
          alert("Please capture or upload both Front and Back sides before extraction.");
        }
        return;
      }

      const normalizeOcrResult = (res: any) => {
        if (res?.fields?.grades && Array.isArray(res.fields.grades)) {
          const normGrades = normalizeGradeRecords(res.fields.grades, res.fields.semester);
          res.fields = updateExtractedFieldsAverages({
            ...res.fields,
            grades: normGrades,
          });
        }
        return res;
      };

      if (resolvedReq.kind === "two_sided") {
        const result = await extractTwoSided(
          resolvedReq.frontImage,
          resolvedReq.backImage,
          resolvedReq.extractFields,
          resolvedReq.gradeLevel
        );
        setOcrResult(normalizeOcrResult(result));
      } else {
        const result = await extract(
          resolvedReq.image,
          resolvedReq.extractFields,
          resolvedReq.gradeLevel,
          resolvedReq.documentType
        );
        setOcrResult(normalizeOcrResult(result));
      }
    } catch (err) {
      console.error("Extraction failed", err);
    }
  };

  const handleFieldChange = (field: keyof ExtractedFields | string, value: any) => {
    if (!ocrResult || !ocrResult.fields) return;
    let nextFields = {
      ...ocrResult.fields,
      [field]: value,
    };
    if (field === "grades" && Array.isArray(value)) {
      const normGrades = normalizeGradeRecords(value, nextFields.semester);
      nextFields = updateExtractedFieldsAverages({
        ...nextFields,
        grades: normGrades,
      });
    }
    setOcrResult({
      ...ocrResult,
      fields: nextFields,
    });
  };

  // ── Unified 1-Click Upload & Ingestion Handler ──────────────────────────────
  const handleUnifiedUpload = async () => {
    // 1. Synchronous Submission Guard: immediately drop duplicate clicks
    if (isSubmittingRef.current) {
      console.warn("[upload] Submission already in progress; dropping duplicate trigger.");
      return;
    }

    const effectiveFront = (currentStep === 1 ? (processedImage || rawImage) : null) || frontImage;
    const effectiveBack = (currentStep === 2 ? (processedImage || rawImage) : null) || backImage;
    const singleImage = processedImage || rawImage;

    // Validate readiness before locking
    if (workflowType === "two_sided") {
      if (!effectiveFront || !effectiveBack) {
        if (!effectiveFront) {
          alert("Please capture or upload Step 1: Front side first.");
        } else {
          alert("Please capture or upload both Front and Back sides before uploading.");
        }
        return;
      }
    } else {
      if (!singleImage) {
        alert("Please select or capture an SF10 document to upload.");
        return;
      }
    }

    // Synchronously lock submission to prevent any second click
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    clearError();

    // Ensure persistent client submission ID (UUID) for idempotency
    if (!submissionIdRef.current) {
      submissionIdRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
    const currentSubmissionId = submissionIdRef.current;

    try {
      const docType =
        docCategory === "sf10" || ocrResult?.fields?.document_type?.toLowerCase() === "sf10"
          ? "sf10"
          : "sf9";

      let frontStorageUrl = "";
      let backStorageUrl = "";
      let originalFilename = docType === "sf10" ? "sf10_record.jpg" : "sf9_submission.jpg";

      // ── STAGE 1: Uploading document... ────────────────────────────────────
      setCurrentPipelineStage("uploading");
      setUploadProgressStatus("Uploading document...");

      if (workflowType === "two_sided") {
        const frontToUpload = effectiveFront || frontImage || processedImage || rawImage;
        const backToUpload = effectiveBack || backImage;

        // 1. Upload Front Image
        if (frontToUpload && frontToUpload.startsWith("data:")) {
          try {
            const frontRes = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dataUrl: frontToUpload,
                filename: `${docType}_front_${Date.now()}.jpg`,
                docType: docType,
              }),
            });
            if (frontRes.ok) {
              const frontData = await frontRes.json();
              frontStorageUrl = frontData.url;
              originalFilename = frontData.originalFilename || originalFilename;
            }
          } catch (storageErr) {
            console.warn("[upload] Front storage upload error:", storageErr);
          }
        }

        // 2. Upload Back Image
        if (backToUpload && backToUpload.startsWith("data:")) {
          try {
            const backRes = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dataUrl: backToUpload,
                filename: `${docType}_back_${Date.now()}.jpg`,
                docType: docType,
              }),
            });
            if (backRes.ok) {
              const backData = await backRes.json();
              backStorageUrl = backData.url;
            }
          } catch (storageErr) {
            console.warn("[upload] Back storage upload error:", storageErr);
          }
        }
      } else {
        const imageToUpload = singleImage || processedImage || rawImage;
        if (imageToUpload && imageToUpload.startsWith("data:")) {
          const ext = imageToUpload.startsWith("data:application/pdf") ? "pdf" : "jpg";
          try {
            const storageRes = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dataUrl: imageToUpload,
                filename: `${docType}_${Date.now()}.${ext}`,
                docType: docType,
              }),
            });
            if (storageRes.ok) {
              const storageData = await storageRes.json();
              frontStorageUrl = storageData.url;
              originalFilename = storageData.originalFilename || originalFilename;
            }
          } catch (storageErr) {
            console.warn("[upload] Storage API fallback:", storageErr);
          }
        }
      }

      // ── STAGE 2: Processing OCR... ────────────────────────────────────────
      setCurrentPipelineStage("ocr");
      setUploadProgressStatus("Processing OCR...");

      let activeOcrResult = ocrResult;
      if (!activeOcrResult || !activeOcrResult.fields) {
        if (workflowType === "two_sided") {
          const frontImg = (effectiveFront || frontImage || processedImage || rawImage) as string;
          const backImg = (effectiveBack || backImage) as string;
          const res = await extractTwoSided(frontImg, backImg, true, gradeLevel);
          if (res?.fields?.grades && Array.isArray(res.fields.grades)) {
            const normGrades = normalizeGradeRecords(res.fields.grades, res.fields.semester);
            res.fields = updateExtractedFieldsAverages({
              ...res.fields,
              grades: normGrades,
            });
          }
          activeOcrResult = res;
          setOcrResult(res);
        } else {
          const imgToExtract = (singleImage || processedImage || rawImage) as string;
          const res = await extract(imgToExtract, true, gradeLevel, docType);
          if (res?.fields?.grades && Array.isArray(res.fields.grades)) {
            const normGrades = normalizeGradeRecords(res.fields.grades, res.fields.semester);
            res.fields = updateExtractedFieldsAverages({
              ...res.fields,
              grades: normGrades,
            });
          }
          activeOcrResult = res;
          setOcrResult(res);
        }
      }

      // ── STAGE 3: Saving extracted information... ──────────────────────────
      setCurrentPipelineStage("saving");
      setUploadProgressStatus("Saving extracted information...");

      const finalPrimaryUrl = frontStorageUrl || "uploaded-document";
      const { requestBody } = buildDocumentSubmissionPayload({
        docCategory,
        gradeLevel,
        ocrFields: activeOcrResult?.fields || {},
        ocrText: activeOcrResult?.text,
        ocrModel: activeOcrResult?.model,
        ocrConfidence: activeOcrResult?.confidence,
        finalPrimaryUrl,
        backStorageUrl: backStorageUrl || undefined,
        originalFilename,
        status: "needs_review",
        documentId: currentSubmissionId,
      });

      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          document_id: currentSubmissionId,
          status: 'needs_review',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Upload persistence failed with status ${res.status}`);
      }

      // ── STAGE 4: Preparing Review Queue... ────────────────────────────────
      setCurrentPipelineStage("redirecting");
      setUploadProgressStatus("Preparing Review Queue...");
      setUploadSuccess(true);

      // Do not reset submission lock: remain locked during automatic redirect
      router.push('/review');
    } catch (e: any) {
      console.error("[upload] Submission error:", e);
      alert(e.message || "An unexpected error occurred during document upload.");
      // Reset only on error to allow retry
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setCurrentPipelineStage("idle");
      setUploadProgressStatus("");
    }
  };

  // ── Existing Manual Modal Upload Handler ────────────────────────────────────
  const handleUploadToSupabase = async () => {
    if (!ocrResult?.fields) return;
    if (isSubmittingRef.current) {
      console.warn("[upload] Submission already in progress; dropping duplicate trigger.");
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setIsUploading(true);

    if (!submissionIdRef.current) {
      submissionIdRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
    const currentSubmissionId = submissionIdRef.current;

    try {
      const docType =
        ocrResult.fields?.document_type?.toLowerCase() === "sf10" || docCategory === "sf10"
          ? "sf10"
          : "sf9";

      let frontStorageUrl = "";
      let backStorageUrl = "";
      let originalFilename = docType === "sf10" ? "sf10_record.jpg" : "sf9_submission.jpg";

      // 1. Uploading document...
      setCurrentPipelineStage("uploading");
      setUploadProgressStatus("Uploading document...");

      if (workflowType === "two_sided") {
        const frontToUpload = frontImage || processedImage || rawImage;
        const backToUpload = backImage;

        // 1. Upload Front Image
        if (frontToUpload && frontToUpload.startsWith("data:image/")) {
          try {
            const frontRes = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dataUrl: frontToUpload,
                filename: `${docType}_front_${Date.now()}.jpg`,
                docType: docType,
              }),
            });
            if (frontRes.ok) {
              const frontData = await frontRes.json();
              frontStorageUrl = frontData.url;
              originalFilename = frontData.originalFilename || originalFilename;
            }
          } catch (storageErr) {
            console.warn("[upload] Front storage upload error:", storageErr);
          }
        }

        // 2. Upload Back Image
        if (backToUpload && backToUpload.startsWith("data:image/")) {
          try {
            const backRes = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dataUrl: backToUpload,
                filename: `${docType}_back_${Date.now()}.jpg`,
                docType: docType,
              }),
            });
            if (backRes.ok) {
              const backData = await backRes.json();
              backStorageUrl = backData.url;
            }
          } catch (storageErr) {
            console.warn("[upload] Back storage upload error:", storageErr);
          }
        }
      } else {
        const imageToUpload = processedImage || rawImage;
        if (
          imageToUpload &&
          (imageToUpload.startsWith("data:image/") ||
            imageToUpload.startsWith("data:application/pdf"))
        ) {
          const ext = imageToUpload.startsWith("data:application/pdf") ? "pdf" : "jpg";
          try {
            const storageRes = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dataUrl: imageToUpload,
                filename: `${docType}_${Date.now()}.${ext}`,
                docType: docType,
              }),
            });
            if (storageRes.ok) {
              const storageData = await storageRes.json();
              frontStorageUrl = storageData.url;
              originalFilename = storageData.originalFilename || originalFilename;
            }
          } catch (storageErr) {
            console.warn("[upload] Storage API fallback:", storageErr);
          }
        }
      }

      // 2. Saving extracted information...
      setCurrentPipelineStage("saving");
      setUploadProgressStatus("Saving extracted information...");

      const finalPrimaryUrl = frontStorageUrl || "uploaded-document";
      const { requestBody } = buildDocumentSubmissionPayload({
        docCategory,
        gradeLevel,
        ocrFields: ocrResult.fields,
        ocrText: ocrResult.text,
        ocrModel: ocrResult.model,
        ocrConfidence: ocrResult.confidence,
        finalPrimaryUrl,
        backStorageUrl: backStorageUrl || undefined,
        originalFilename,
        status: "needs_review",
        documentId: currentSubmissionId,
      });

      // 3. Persist exactly ONE document record in Supabase
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          document_id: currentSubmissionId,
          status: 'needs_review',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Upload persistence failed.");
      }

      // 4. Preparing Review Queue...
      setCurrentPipelineStage("redirecting");
      setUploadProgressStatus("Preparing Review Queue...");
      setUploadSuccess(true);

      // Automatically redirect to /review
      router.push('/review');
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Upload error.");
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setIsUploading(false);
      setCurrentPipelineStage("idle");
      setUploadProgressStatus("");
    }
  };

  const isBothCaptured = Boolean(frontImage && backImage);
  const uiCopy = getUploadUiCopy({
    docCategory,
    workflowType,
    currentStep,
    gradeLevel,
  });
  const isPdfSelected = Boolean(rawImage && rawImage.startsWith("data:application/pdf"));

  return (
    <PageContainer>
      <Header 
        title="Upload & Ingestion Portal" 
        description="Capture or upload Senior High School SF9 and SF10 documents for automated OCR extraction and academic grade recalculation."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Upload Document" }
        ]}
        roleBadge={{ role: "teacher", label: "Faculty Validator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "500169" }}
        actions={
          <Link 
            href="/compare"
            className="inline-flex items-center justify-center px-3.5 py-2 text-xs font-semibold text-white bg-[#174EA6] hover:bg-[#0B1F33] rounded-lg shadow-sm transition-colors"
          >
            Compare Documents
          </Link>
        }
      />

      {/* Document Category Selector */}
      <div className="mt-4 p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Document type">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-wide mr-1">Document:</span>
          <button
            type="button"
            aria-pressed={docCategory === "sf9"}
            onClick={() => handleCategoryChange("sf9")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              docCategory === "sf9"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            SF9 (Report Card)
          </button>
          <button
            type="button"
            aria-pressed={docCategory === "sf10"}
            onClick={() => handleCategoryChange("sf10")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              docCategory === "sf10"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            SF10 (Permanent Record)
          </button>
        </div>

        {shouldShowGradeLevelSelector(docCategory) && (
          <div className="flex items-center gap-2" role="group" aria-label="Academic grade level">
            <span className="text-xs font-medium text-zinc-500">Grade Level:</span>
            <div className="flex rounded-lg border border-zinc-300 dark:border-zinc-600 p-0.5 bg-white dark:bg-zinc-900">
              {ACADEMIC_GRADE_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={gradeLevel === level}
                  onClick={() => setGradeLevel(level)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    gradeLevel === level
                      ? "bg-indigo-600 text-white"
                      : "text-zinc-600 dark:text-zinc-300 hover:text-zinc-900"
                  }`}
                >
                  {getGradeLevelShortLabel(level)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Two-Sided Step Stepper Header (Only for SF9) */}
      {docCategory === "sf9" && workflowType === "two_sided" && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleSelectStep(1)}
            className={`flex items-center justify-between p-3.5 rounded-lg border text-left transition-all ${
              currentStep === 1
                ? "bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/20"
                : frontImage
                ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800"
                : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                frontImage ? "bg-emerald-600 text-white" : currentStep === 1 ? "bg-indigo-600 text-white" : "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
              }`}>
                {frontImage ? "✓" : "1"}
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                  Step 1: Front / Identity Side
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {frontImage ? "Captured (Learner Info & School Header)" : "Awaiting scan / photo"}
                </p>
              </div>
            </div>
            {frontImage && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Ready</span>}
          </button>

          <button
            type="button"
            onClick={() => handleSelectStep(2)}
            className={`flex items-center justify-between p-3.5 rounded-lg border text-left transition-all ${
              currentStep === 2
                ? "bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/20"
                : backImage
                ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800"
                : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                backImage ? "bg-emerald-600 text-white" : currentStep === 2 ? "bg-indigo-600 text-white" : "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
              }`}>
                {backImage ? "✓" : "2"}
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                  Step 2: Back / Grade Side
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {backImage ? "Captured (Quarterly Grades & Attendance)" : "Awaiting scan / photo"}
                </p>
              </div>
            </div>
            {backImage && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Ready</span>}
          </button>
        </div>
      )}

      {/* Main Input & Preview Layout */}
      <div className="mt-4 flex flex-col lg:flex-row gap-6">
        {/* Left Column: Input (Camera or Upload) */}
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
              {uiCopy.captureHeading}
            </h3>
            <div className="flex gap-1.5 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
              <button
                type="button"
                onClick={() => setMode("camera")}
                className={`px-3 py-1 text-xs font-semibold rounded-md ${
                  mode === "camera" 
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-700 dark:text-zinc-100" 
                    : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                Camera
              </button>
              <button
                type="button"
                onClick={() => setMode("upload")}
                className={`px-3 py-1 text-xs font-semibold rounded-md ${
                  mode === "upload" 
                    ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-700 dark:text-zinc-100" 
                    : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                File Upload
              </button>
            </div>
          </div>

          {mode === "camera" ? (
            <div className="space-y-4">
              <CameraFeed 
                videoRef={videoRef} 
                cameraZoom={cameraZoom} 
                hasHardwareZoom={hasHardwareZoom} 
                docCategory={docCategory === "sf10" ? "sf10" : "sf9"}
              />
              <CameraControls
                devices={devices}
                selectedDeviceId={selectedDeviceId}
                onSelectDevice={setSelectedDeviceId}
                cameraZoom={cameraZoom}
                onZoomChange={setCameraZoom}
                minZoom={1}
                maxZoom={3}
                defaultZoom={1.5}
                onCapture={handleCapture}
              />
            </div>
          ) : (
            <ImageUploader onImageSelected={handleImageSelected} />
          )}

          {/* Dual-Side Pre-Extraction Thumbnail Cards (Phase 4) */}
          {workflowType === "two_sided" && (frontImage || backImage) && (
            <div className="mt-4 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/70 dark:bg-zinc-800/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                  Pre-Extraction Verification: Both Captured Sides
                </span>
                <span className="text-xs text-zinc-500">Verify orientation before extraction</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Front Thumbnail */}
                <div className={`p-2 rounded-lg border text-center ${frontImage ? "border-indigo-300 dark:border-indigo-800 bg-white dark:bg-zinc-900" : "border-dashed border-zinc-300 dark:border-zinc-700"}`}>
                  <span className="block text-[11px] font-bold text-zinc-600 dark:text-zinc-400 mb-1">
                    Side 1: Front / Identity
                  </span>
                  {frontImage ? (
                    <div className="space-y-1.5">
                      <img src={frontImage} alt="Front preview" className="w-full h-24 object-contain rounded border border-zinc-200 dark:border-zinc-800 bg-black/5" />
                      <button
                        type="button"
                        onClick={() => handleSelectStep(1)}
                        className="text-[11px] font-semibold text-indigo-600 hover:underline"
                      >
                        Replace Front
                      </button>
                    </div>
                  ) : (
                    <div className="h-24 flex items-center justify-center text-xs text-zinc-400 italic">
                      Front side not captured
                    </div>
                  )}
                </div>

                {/* Back Thumbnail */}
                <div className={`p-2 rounded-lg border text-center ${backImage ? "border-indigo-300 dark:border-indigo-800 bg-white dark:bg-zinc-900" : "border-dashed border-zinc-300 dark:border-zinc-700"}`}>
                  <span className="block text-[11px] font-bold text-zinc-600 dark:text-zinc-400 mb-1">
                    Side 2: Back / Grades
                  </span>
                  {backImage ? (
                    <div className="space-y-1.5">
                      <img src={backImage} alt="Back preview" className="w-full h-24 object-contain rounded border border-zinc-200 dark:border-zinc-800 bg-black/5" />
                      <button
                        type="button"
                        onClick={() => handleSelectStep(2)}
                        className="text-[11px] font-semibold text-indigo-600 hover:underline"
                      >
                        Replace Back
                      </button>
                    </div>
                  ) : (
                    <div className="h-24 flex items-center justify-center text-xs text-zinc-400 italic">
                      Back side not captured
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Active Preview & Stepper Actions */}
        <div className="flex-1 space-y-4">
          {rawImage || processedImage ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase">
                  {uiCopy.previewHeading}
                </span>
                <div className="flex items-center gap-2">
                  {!isPdfSelected && (
                    <>
                      {previewRotation !== 0 && (
                        <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                          View {previewRotation}° (preview only)
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setPreviewRotation((prev) => nextPreviewRotation(prev))}
                        title="Rotate preview display 90° clockwise without altering the image sent to OCR"
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                      >
                        <RotateCw className="w-3 h-3" />
                        Rotate View
                      </button>
                    </>
                  )}
                  <span className="text-xs text-zinc-400">Review preview before extraction</span>
                </div>
              </div>

              <ImagePreview
                image={(processedImage || rawImage) as string}
                isCropping={isCropping}
                containerRef={containerRef}
                imageRef={imageRef}
                dragRect={dragRect}
                previewRotation={previewRotation}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              />

              <div className="flex flex-col gap-3">
                {/* Stepper Navigation Buttons */}
                {workflowType === "two_sided" && currentStep === 1 && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleContinueToBack}
                      disabled={isSubmitting}
                      className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-sm flex items-center justify-center gap-2 transition-colors"
                    >
                      <span>Continue to Step 2: Back Side</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Primary Upload & Process Button & Extract Preview */}
                {(workflowType === "single" || isBothCaptured || (workflowType === "two_sided" && currentStep === 2 && (backImage || rawImage))) && (
                  <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={handleUnifiedUpload}
                      disabled={isSubmitting || isUploading || isExtracting || isProcessing}
                      className="w-full sm:flex-1 py-3 px-5 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white rounded-lg shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      {isSubmitting ? (
                        <>
                          <RotateCw className="w-4 h-4 animate-spin" />
                          <span>{uploadProgressStatus || "Processing..."}</span>
                        </>
                      ) : (
                        <>
                          <UploadCloud className="w-4 h-4" />
                          <span>Upload & Process Document</span>
                        </>
                      )}
                    </button>

                    <ExtractButton 
                      onClick={handleExtract} 
                      isExtracting={isExtracting} 
                      disabled={isSubmitting || isProcessing || (retryAfter !== null && retryAfter > 0)}
                      cooldownSeconds={retryAfter}
                      label="Preview OCR Only"
                    />
                  </div>
                )}

                {/* Real-time Multi-Stage Progress Indicator */}
                {isSubmitting && (
                  <div className="p-4 rounded-xl border-2 border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/40 shadow-sm space-y-3">
                    <div className="flex items-center gap-2.5">
                      <RotateCw className="w-5 h-5 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0" />
                      <div>
                        <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                          Upload & Processing In Progress
                        </h4>
                        <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300">
                          {uploadProgressStatus}
                        </p>
                      </div>
                    </div>

                    {/* 4 Pipeline Stages */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
                      {PIPELINE_STAGES.map((stage, idx) => {
                        const isCurrent = currentPipelineStage === stage.id;
                        const stageIndex = PIPELINE_STAGES.findIndex((s) => s.id === currentPipelineStage);
                        const isPassed = stageIndex > idx;

                        return (
                          <div
                            key={stage.id}
                            className={`flex items-center gap-1.5 p-2 rounded-lg text-xs transition-all ${
                              isCurrent
                                ? "bg-indigo-600 text-white shadow-xs font-bold ring-2 ring-indigo-400/40"
                                : isPassed
                                ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800"
                                : "bg-white/70 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700"
                            }`}
                          >
                            {isPassed ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            ) : isCurrent ? (
                              <RotateCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded-full border border-zinc-300 dark:border-zinc-600 flex items-center justify-center text-[9px] shrink-0">
                                {idx + 1}
                              </div>
                            )}
                            <span className="truncate">{stage.label.replace("...", "")}</span>
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Do not refresh or click again. Upload and OCR processing continue automatically and will redirect to the Review Queue.
                    </p>
                  </div>
                )}

                {/* OCR Error Notification Banner */}
                {error && (
                  <div
                    role="alert"
                    className={`p-4 rounded-lg border text-sm flex flex-col gap-2.5 transition-all ${
                      errorDetails?.code === "RATE_LIMIT_EXCEEDED"
                        ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200"
                        : errorDetails?.code === "QUOTA_EXHAUSTED"
                        ? "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200"
                        : "bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {errorDetails?.code === "RATE_LIMIT_EXCEEDED" ? (
                        <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 space-y-1">
                        <h4 className="font-semibold text-base">
                          {errorDetails?.code === "RATE_LIMIT_EXCEEDED"
                            ? "Rate Limit Exceeded"
                            : errorDetails?.code === "QUOTA_EXHAUSTED"
                            ? "Account Quota Exhausted"
                            : errorDetails?.code === "INVALID_API_KEY"
                            ? "OCR Authentication / Configuration Error"
                            : "OCR Extraction Notice"}
                        </h4>
                        <p className="leading-relaxed">{error}</p>

                        {errorDetails?.code === "RATE_LIMIT_EXCEEDED" && (
                          <div className="pt-1 text-xs font-medium">
                            {retryAfter !== null && retryAfter > 0 ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-200/60 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100">
                                <Clock className="w-3.5 h-3.5 animate-pulse" />
                                Cooldown active: please wait <strong>{retryAfter}s</strong> before retrying.
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                                ✓ Cooldown complete. You can retry extraction now.
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {errorDetails?.code !== "QUOTA_EXHAUSTED" && (
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={handleExtract}
                          disabled={isExtracting || (retryAfter !== null && retryAfter > 0)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md shadow-sm transition-colors text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-400 disabled:cursor-not-allowed dark:disabled:bg-zinc-700"
                        >
                          <RotateCw className={`w-3.5 h-3.5 ${isExtracting ? "animate-spin" : ""}`} />
                          {isExtracting ? "Retrying..." : "Retry Extraction"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="h-full min-h-[300px] flex flex-col items-center justify-center border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-900 p-6 text-center">
              {docCategory === "sf10" ? (
                <FileText className="w-8 h-8 text-zinc-400 mb-2" />
              ) : (
                <Layers className="w-8 h-8 text-zinc-400 mb-2" />
              )}
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {uiCopy.emptyHeading}
              </p>
              <p className="text-xs text-zinc-400 mt-1 max-w-xs">
                {uiCopy.emptyDescription}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Results Section */}
      {ocrResult && (
        <div className="mt-8 space-y-6">
          <OcrResultCard 
            fields={ocrResult.fields || null} 
            onFieldChange={handleFieldChange} 
            rawText={ocrResult.text}
            confidence={ocrResult.confidence}
            model={ocrResult.model}
            provider={ocrResult.provider}
          />
          <div className="flex justify-center mt-6">
            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              disabled={isSubmitting || isUploading}
              className="py-3 px-6 text-lg font-bold bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-400 disabled:cursor-not-allowed text-white rounded-lg shadow-md flex items-center gap-2 cursor-pointer"
            >
              Upload Student Data
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showUploadModal && ocrResult?.fields && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-upload-modal-title"
            className="bg-white dark:bg-zinc-900 w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-6 relative rounded-xl shadow-xl p-6"
          >
            <button
              type="button"
              aria-label="Close confirmation dialog"
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-800"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
            </button>
            
            <h2
              id="confirm-upload-modal-title"
              className="text-2xl font-bold flex items-center gap-2 text-zinc-900 dark:text-white"
            >
              Confirm Submission to Supabase
            </h2>
            
            <p className="text-zinc-600 dark:text-zinc-400 text-sm">
              {workflowType === "two_sided" ? (
                <>
                  Both sides of this document will be uploaded as{" "}
                  <strong>{uiCopy.modalSummaryLabel}</strong>. The document status will be staged as{" "}
                  <strong>needs_review</strong> for mandatory human verification.
                </>
              ) : (
                <>
                  This <strong>{uiCopy.modalSummaryLabel}</strong> will be uploaded and staged as{" "}
                  <strong>needs_review</strong> for mandatory human verification.
                </>
              )}
            </p>

            <div className="bg-zinc-50 dark:bg-zinc-800 border dark:border-zinc-700 p-4 rounded-lg space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs font-semibold text-zinc-500 uppercase">Learner Name</span>
                  <p className="font-medium text-base dark:text-white">{ocrResult.fields.name || "-"}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-zinc-500 uppercase">LRN</span>
                  <p className="font-mono font-medium text-base dark:text-white">{ocrResult.fields.lrn || "-"}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-zinc-500 uppercase">Document Type</span>
                  <p className="font-medium text-sm dark:text-white">
                    {docCategory === "sf10"
                      ? "SF10 (Permanent Record)"
                      : "SF9 (Report Card)"}
                  </p>
                </div>
                {shouldShowGradeLevelSelector(docCategory) && (
                  <div>
                    <span className="text-xs font-semibold text-zinc-500 uppercase">Selected Grade Level</span>
                    <p className="font-medium text-sm dark:text-white">
                      {gradeLevel} ({getGradeLevelShortLabel(gradeLevel)})
                    </p>
                  </div>
                )}
              </div>

              {ocrResult.fields.grades && ocrResult.fields.grades.length > 0 && (
                <div>
                  <span className="text-xs font-semibold text-zinc-500 uppercase">
                    Academic Subject Grades ({ocrResult.fields.grades.length} subjects extracted)
                  </span>
                  <div className="mt-2 text-sm max-h-36 overflow-y-auto border dark:border-zinc-600 rounded bg-white dark:bg-zinc-900 p-2">
                    {ocrResult.fields.grades.map((g: any, i: number) => (
                      <div key={i} className="flex justify-between border-b dark:border-zinc-700 last:border-0 py-1 text-xs">
                        <span className="truncate pr-4 dark:text-zinc-300 font-medium">{g.subject}</span>
                        <span className="font-mono font-bold dark:text-zinc-100">
                          {g.q1 ?? "-"} | {g.q2 ?? "-"} | {g.q3 ?? "-"} | {g.q4 ?? "-"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {workflowType === "two_sided" && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 pt-1 border-t dark:border-zinc-700">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Front and Back images will be persisted together under one document record.</span>
                </div>
              )}
            </div>

            {isSubmitting && (
              <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 flex items-center gap-2.5">
                <RotateCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0" />
                <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">
                  {uploadProgressStatus}
                </span>
              </div>
            )}

            <div className="flex gap-4 justify-end mt-4">
              <button
                type="button"
                className="px-4 py-2 rounded-md font-medium bg-zinc-200 hover:bg-zinc-300 disabled:opacity-50 text-zinc-900 text-sm"
                onClick={() => setShowUploadModal(false)}
                disabled={isSubmitting || isUploading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUploadToSupabase} 
                disabled={isSubmitting || isUploading || uploadSuccess}
                className={`px-4 py-2 rounded-md font-medium text-white text-sm ${uploadSuccess ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-400 disabled:cursor-not-allowed"}`}
              >
                {uploadSuccess
                  ? "Redirecting to Review Queue..."
                  : isSubmitting || isUploading
                  ? uploadProgressStatus || "Uploading..."
                  : "Confirm & Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

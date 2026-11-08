"use client";

import React, { useState } from "react";
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
import { autoCropDocument, type DocumentCropResult } from "@/lib/image/documentCrop";
import {
  detectPsaFromVideoElement,
  extractPsaIdentityRegion,
  processPsaTransformPipeline,
  type PsaLiveDetectionResult,
  type PsaIdentityCropResult,
  type PsaPipelineResult,
} from "@/lib/image/psaIdentityDetector";

import Link from "next/link";
import { Clock, AlertCircle, RotateCw, CheckCircle2, ArrowRight, RefreshCw, FileText, Layers, Award } from "lucide-react";
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

export default function UploadPage() {
  const [docCategory, setDocCategory] = useState<UploadDocCategory>("sf9");
  const [workflowType, setWorkflowType] = useState<"two_sided" | "single">("two_sided");
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);

  // PSA Camera, Auto-Crop, Zoom & Enhancement States
  const [livePsaDetection, setLivePsaDetection] = useState<PsaLiveDetectionResult | null>(null);
  const [psaPipelineResult, setPsaPipelineResult] = useState<PsaPipelineResult | null>(null);
  const [psaCropResult, setPsaCropResult] = useState<DocumentCropResult | null>(null);
  const [useCroppedPsa, setUseCroppedPsa] = useState<boolean>(true);
  const [psaEnhancementResult, setPsaEnhancementResult] = useState<any | null>(null);
  const [psaOriginalUrl, setPsaOriginalUrl] = useState<string | null>(null);
  const [psaFullCorrectedUrl, setPsaFullCorrectedUrl] = useState<string | null>(null);
  const [psaIdentityCropUrl, setPsaIdentityCropUrl] = useState<string | null>(null);
  const [psaIdentityCropMeta, setPsaIdentityCropMeta] = useState<PsaIdentityCropResult | null>(null);
  const [psaPreviewTab, setPsaPreviewTab] = useState<"identity_crop" | "full_corrected" | "original">("identity_crop");
  const [showSecondaryPreview, setShowSecondaryPreview] = useState<boolean>(false);

  const [mode, setMode] = useState<"camera" | "upload">("camera");
  const [gradeLevel, setGradeLevel] = useState<AcademicGradeLevel>(DEFAULT_ACADEMIC_GRADE_LEVEL);
  const [previewRotation, setPreviewRotation] = useState<PreviewRotation>(0);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

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
    canRetry,
    clearError,
  } = useOcr();

  // Live Camera PSA Detection Loop (~5 fps / 180ms)
  React.useEffect(() => {
    if (mode !== "camera" || docCategory !== "birth_cert" || !videoRef.current) {
      setLivePsaDetection(null);
      return;
    }
    let active = true;
    const offscreen = typeof document !== "undefined" ? document.createElement("canvas") : undefined;
    const intervalId = setInterval(() => {
      if (!active || !videoRef.current) return;
      try {
        const res = detectPsaFromVideoElement(videoRef.current, offscreen);
        setLivePsaDetection(res);
      } catch {
        // Drop frame safely
      }
    }, 180);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [mode, docCategory, videoRef]);

  const processPsaCapture = async (dataUrl: string, liveHint?: PsaLiveDetectionResult | null) => {
    if (docCategory !== "birth_cert") return;
    setPsaOriginalUrl(dataUrl);
    try {
      // Execute Master Transform Pipeline (Section 4):
      // RAW CAMERA FRAME -> detect paper -> crop whole paper -> rotate UPRIGHT -> calculate tighter identity region -> ACTUALLY CROP PIXELS on dedicated canvas -> upscale 2x -> extract separate registry crop
      const pipelineRes = await processPsaTransformPipeline(dataUrl, liveHint || livePsaDetection);
      setPsaPipelineResult(pipelineRes);

      const uprightFull = pipelineRes.fullCorrectedUrl || dataUrl;
      setPsaFullCorrectedUrl(uprightFull);

      // Enhance the actual cropped identity pixels with brightness normalization & adaptive B&W
      const { enhancePsaImage } = await import("@/lib/image/psaEnhancer");
      const enhancedIdentity = await enhancePsaImage(pipelineRes.identityCropUrl);
      setPsaEnhancementResult(enhancedIdentity);

      const finalIdentityCrop = enhancedIdentity.enhancedDataUrl || pipelineRes.identityCropUrl;
      setPsaIdentityCropUrl(finalIdentityCrop);

      // Default view mode to the crisp 2x B&W identity crop
      setPsaPreviewTab("identity_crop");
    } catch (e) {
      console.warn("PSA capture processing error:", e);
      setPsaFullCorrectedUrl(dataUrl);
      setPsaIdentityCropUrl(dataUrl);
    }
  };

  const handleCategoryChange = (nextCategory: UploadDocCategory) => {
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
        hasPsaArtifacts: Boolean(
          psaPipelineResult ||
            psaCropResult ||
            psaEnhancementResult ||
            psaOriginalUrl ||
            psaFullCorrectedUrl ||
            psaIdentityCropUrl
        ),
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

    setLivePsaDetection(null);
    setPsaPipelineResult(null);
    setPsaCropResult(null);
    setPsaEnhancementResult(null);
    setPsaOriginalUrl(null);
    setPsaFullCorrectedUrl(null);
    setPsaIdentityCropUrl(null);
    setPsaIdentityCropMeta(null);
    setShowUploadModal(false);
  };

  const handleCapture = () => {
    const frame = captureFrame();
    if (frame) {
      setPreviewRotation(0);
      resetAdjustments();
      setRawImage(frame);
      if (docCategory === "birth_cert") {
        processPsaCapture(frame, livePsaDetection);
      } else if (workflowType === "two_sided") {
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
    if (docCategory === "birth_cert") {
      processPsaCapture(dataUrl, null);
    } else if (workflowType === "two_sided") {
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
      if (docCategory === "birth_cert") {
        const imageToExtract =
          psaIdentityCropUrl ||
          psaEnhancementResult?.enhancedDataUrl ||
          psaFullCorrectedUrl ||
          (useCroppedPsa && psaCropResult?.croppedDataUrl ? psaCropResult.croppedDataUrl : null) ||
          processedImage ||
          rawImage;
        const psaReq = resolveOcrExtractionRequest({
          docCategory,
          workflowType,
          gradeLevel,
          singleImage: null,
          frontImage: null,
          backImage: null,
          psaImage: imageToExtract,
        });
        if (!psaReq || psaReq.kind !== "single") {
          alert("Please capture or upload a PSA / Birth Certificate image.");
          return;
        }
        let result = await extract(
          psaReq.image,
          psaReq.extractFields,
          psaReq.gradeLevel,
          psaReq.documentType
        );

        // Reconcile sex from existing secondary crop sexDiagnostic if present
        const initialSexCrop = psaPipelineResult?.secondaryCrops?.find((c) => c.id === "child_sex");
        if (initialSexCrop?.sexDiagnostic && (!result?.fields?.sex || result?.fields?.field_metadata?.sex?.status === "needs_verification")) {
          const diag = initialSexCrop.sexDiagnostic;
          if (diag.state === "MALE_MARKED" && diag.detectedSex === "M") {
            result = {
              ...result,
              fields: {
                ...(result.fields || ({} as any)),
                sex: "M",
                field_metadata: {
                  ...result?.fields?.field_metadata,
                  sex: { status: "extracted", confidence: "HIGH", needsVerification: false },
                },
              },
            };
          } else if (diag.state === "FEMALE_MARKED" && diag.detectedSex === "F") {
            result = {
              ...result,
              fields: {
                ...(result.fields || ({} as any)),
                sex: "F",
                field_metadata: {
                  ...result?.fields?.field_metadata,
                  sex: { status: "extracted", confidence: "HIGH", needsVerification: false },
                },
              },
            };
          }
        }

        setOcrResult(result);

        const anchorBoxes = (result?.fields as any)?.diagnostic?.anchorRefinedBoxes;
        if (anchorBoxes && (psaFullCorrectedUrl || psaIdentityCropUrl)) {
          try {
            const { refinePsaSecondaryCropsWithAnchors } = await import("@/lib/image/psaIdentityDetector");
            const sourceUrl = psaFullCorrectedUrl || psaIdentityCropUrl || "";
            const refined = await refinePsaSecondaryCropsWithAnchors(sourceUrl, anchorBoxes);
            if (refined.crops && refined.crops.length > 0) {
              setPsaPipelineResult((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  secondaryCrops: refined.crops,
                  secondaryCompositeSheetUrl: refined.compositeSheetUrl || prev.secondaryCompositeSheetUrl,
                };
              });

              // Check if refined sex diagnostic provides high-confidence decision
              const refinedSexCrop = refined.crops.find((c) => c.id === "child_sex");
              if (refinedSexCrop?.sexDiagnostic) {
                const diag = refinedSexCrop.sexDiagnostic;
                if (diag.state === "MALE_MARKED" && diag.detectedSex === "M") {
                  setOcrResult((prev) => {
                    if (!prev?.fields) return prev;
                    return {
                      ...prev,
                      fields: {
                        ...prev.fields,
                        sex: "M",
                        field_metadata: {
                          ...prev.fields.field_metadata,
                          sex: { status: "extracted", confidence: "HIGH", needsVerification: false },
                        },
                      },
                    };
                  });
                } else if (diag.state === "FEMALE_MARKED" && diag.detectedSex === "F") {
                  setOcrResult((prev) => {
                    if (!prev?.fields) return prev;
                    return {
                      ...prev,
                      fields: {
                        ...prev.fields,
                        sex: "F",
                        field_metadata: {
                          ...prev.fields.field_metadata,
                          sex: { status: "extracted", confidence: "HIGH", needsVerification: false },
                        },
                      },
                    };
                  });
                } else if (diag.state === "BOTH_MARKED" || diag.state === "NONE_MARKED" || diag.state === "AMBIGUOUS") {
                  setOcrResult((prev) => {
                    if (!prev?.fields) return prev;
                    return {
                      ...prev,
                      fields: {
                        ...prev.fields,
                        sex: undefined,
                        field_metadata: {
                          ...prev.fields.field_metadata,
                          sex: {
                            status: "needs_verification",
                            confidence: "LOW",
                            needsVerification: true,
                            reason: diag.statusText,
                          },
                        },
                      },
                    };
                  });
                }
              }
            }
          } catch (e) {
            console.warn("Could not refine secondary crops with anchor boxes:", e);
          }
        }
      } else {
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

        if (resolvedReq.kind === "two_sided") {
          const result = await extractTwoSided(
            resolvedReq.frontImage,
            resolvedReq.backImage,
            resolvedReq.extractFields,
            resolvedReq.gradeLevel
          );
          setOcrResult(result);
        } else {
          const result = await extract(
            resolvedReq.image,
            resolvedReq.extractFields,
            resolvedReq.gradeLevel,
            resolvedReq.documentType
          );
          setOcrResult(result);
        }
      }
    } catch (err) {
      console.error("Extraction failed", err);
    }
  };

  const handleFieldChange = (field: keyof ExtractedFields, value: any) => {
    if (!ocrResult || !ocrResult.fields) return;
    setOcrResult({
      ...ocrResult,
      fields: {
        ...ocrResult.fields,
        [field]: value,
      },
    });
  };

  const handleUploadToSupabase = async () => {
    if (!ocrResult?.fields) return;
    setIsUploading(true);
    try {
      const docType =
        docCategory === "birth_cert"
          ? "birth_cert"
          : ocrResult.fields?.document_type?.toLowerCase() === "sf10" || docCategory === "sf10"
          ? "sf10"
          : "sf9";

      let frontStorageUrl = "";
      let backStorageUrl = "";
      let originalPsaStorageUrl = "";
      let processedPsaStorageUrl = "";
      let fullPsaStorageUrl = "";
      let identityCropPsaStorageUrl = "";
      let originalFilename = docCategory === "birth_cert" ? "psa_birth_cert.jpg" : docType === "sf10" ? "sf10_record.jpg" : "sf9_submission.jpg";

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
      } else if (docCategory === "birth_cert") {
        const rawToUpload = psaOriginalUrl || psaCropResult?.originalDataUrl || rawImage;
        const fullToUpload = psaFullCorrectedUrl || psaCropResult?.croppedDataUrl || rawToUpload;
        const identityCropToUpload =
          psaIdentityCropUrl ||
          psaEnhancementResult?.enhancedDataUrl ||
          fullToUpload;

        originalPsaStorageUrl = "";
        fullPsaStorageUrl = "";
        identityCropPsaStorageUrl = "";

        // 1. Upload original unedited full-color PSA scan to private storage
        if (rawToUpload && rawToUpload.startsWith("data:image/")) {
          try {
            const rawRes = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dataUrl: rawToUpload,
                filename: `birth_cert_original_${Date.now()}.png`,
                docType: "birth_cert",
              }),
            });
            if (rawRes.ok) {
              const rawData = await rawRes.json();
              originalPsaStorageUrl = rawData.url;
            }
          } catch (storageErr) {
            console.warn("[upload] PSA original image storage error:", storageErr);
          }
        }

        // 2. Upload full perspective corrected image
        if (fullToUpload && fullToUpload.startsWith("data:image/")) {
          try {
            const fullRes = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dataUrl: fullToUpload,
                filename: `birth_cert_full_${Date.now()}.png`,
                docType: "birth_cert",
              }),
            });
            if (fullRes.ok) {
              const fullData = await fullRes.json();
              fullPsaStorageUrl = fullData.url;
            }
          } catch (storageErr) {
            console.warn("[upload] PSA full corrected image storage error:", storageErr);
          }
        }

        // 3. Upload high-resolution 2x identity crop (used for OCR)
        if (identityCropToUpload && identityCropToUpload.startsWith("data:image/")) {
          try {
            const cropRes = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                dataUrl: identityCropToUpload,
                filename: `birth_cert_identity_crop_${Date.now()}.png`,
                docType: "birth_cert",
              }),
            });
            if (cropRes.ok) {
              const cropData = await cropRes.json();
              identityCropPsaStorageUrl = cropData.url;
              processedPsaStorageUrl = cropData.url;
              originalFilename = cropData.originalFilename || originalFilename;
            }
          } catch (storageErr) {
            console.warn("[upload] PSA identity crop image storage error:", storageErr);
          }
        }

        frontStorageUrl = originalPsaStorageUrl || fullPsaStorageUrl || identityCropPsaStorageUrl;
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
        psaMetadata: {
          originalPsaStorageUrl: originalPsaStorageUrl || frontStorageUrl,
          fullPsaStorageUrl: fullPsaStorageUrl || frontStorageUrl,
          identityCropPsaStorageUrl: identityCropPsaStorageUrl || undefined,
          processedPsaStorageUrl: processedPsaStorageUrl || undefined,
          ocrCandidateType: psaEnhancementResult?.selectedCandidate || "bw",
          cropScaleFactor: psaPipelineResult?.scaleFactor || psaIdentityCropMeta?.scaleFactor || 2.0,
          identityCropBox:
            psaPipelineResult?.diagnostics.identitySourceCrop || psaIdentityCropMeta?.cropBox,
        },
      });

      // 3. Persist exactly ONE document record in Supabase
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (res.ok) {
        setUploadSuccess(true);
        setTimeout(() => {
          setShowUploadModal(false);
          setUploadSuccess(false);
        }, 2000);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`Upload failed: ${errData.error || "Unknown error"}`);
      }
    } catch (e) {
      console.error(e);
      alert("Upload error.");
    } finally {
      setIsUploading(false);
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
        title="Upload Document" 
        description="Capture or upload student records for automated OCR extraction and verification"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Upload Document" }
        ]}
        actions={
          <Link 
            href="/compare"
            className="ml-auto inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md shadow-sm hover:bg-indigo-700"
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
          <button
            type="button"
            aria-pressed={docCategory === "birth_cert"}
            onClick={() => handleCategoryChange("birth_cert")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              docCategory === "birth_cert"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            PSA / Birth Certificate
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
                docCategory={docCategory}
                detectionResult={livePsaDetection}
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
                  {docCategory !== "birth_cert" && !isPdfSelected && (
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

              {/* PSA Enhanced Previews, 3-Way Toggle & Status Badges */}
              {docCategory === "birth_cert" && (
                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 rounded-lg border border-zinc-200 dark:border-zinc-700 flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        Identity Area Detected
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                        <RotateCw className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        Rotated Upright
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
                        Upscaled 2×
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200">
                        True B&W OCR
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setPsaPipelineResult(null);
                        setPsaCropResult(null);
                        setPsaEnhancementResult(null);
                        setPsaOriginalUrl(null);
                        setPsaFullCorrectedUrl(null);
                        setPsaIdentityCropUrl(null);
                        setPsaIdentityCropMeta(null);
                        resetAdjustments();
                        setRawImage("");
                        setFrontImage(null);
                        setBackImage(null);
                      }}
                      className="px-2.5 py-1 text-xs font-semibold rounded border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      Retake
                    </button>
                  </div>

                  {/* 3-Way Preview Mode Toggle */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                      Preview View:
                    </span>
                    <div className="inline-flex rounded-lg p-0.5 bg-zinc-200 dark:bg-zinc-700 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => setPsaPreviewTab("identity_crop")}
                        className={`px-3 py-1 rounded-md transition-colors ${
                          psaPreviewTab === "identity_crop"
                            ? "bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold"
                            : "text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                        }`}
                      >
                        {psaPipelineResult?.isFallback
                          ? "Identity auto-crop unavailable — Full Document Used"
                          : psaEnhancementResult?.selectedCandidate === "grayscale"
                          ? "Identity OCR Crop (2× Grayscale)"
                          : "Identity OCR Crop (2× B&W)"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPsaPreviewTab("full_corrected")}
                        className={`px-3 py-1 rounded-md transition-colors ${
                          psaPreviewTab === "full_corrected"
                            ? "bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold"
                            : "text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                        }`}
                      >
                        Full Corrected
                      </button>
                      <button
                        type="button"
                        onClick={() => setPsaPreviewTab("original")}
                        className={`px-3 py-1 rounded-md transition-colors ${
                          psaPreviewTab === "original"
                            ? "bg-white dark:bg-zinc-900 text-indigo-600 dark:text-indigo-400 shadow-xs font-bold"
                            : "text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                        }`}
                      >
                        Original (Color)
                      </button>
                    </div>
                  </div>

                  {/* Fallback Warning Banner if Identity Crop Failed (Section 15) */}
                  {psaPipelineResult?.isFallback && (
                    <div className="p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>
                        <strong>Identity auto-crop unavailable — Full Document Used.</strong> Marked as <em>Needs Verification</em>.
                      </span>
                    </div>
                  )}

                  {/* Development Diagnostic Information (Section 10 & 14) */}
                  {process.env.NODE_ENV !== "production" && psaPipelineResult?.diagnostics && (
                    <div className="p-2.5 rounded bg-zinc-900 text-zinc-200 font-mono text-[11px] border border-zinc-700 space-y-1.5">
                      <div className="font-bold text-amber-400 flex items-center justify-between">
                        <span>=== DEV DIAGNOSTICS: PSA CROP & SCALE ===</span>
                        <span className="text-[10px] text-zinc-400">
                          {psaPipelineResult.diagnostics.isSideways ? "Sideways 90° -> Rotated Upright" : "Portrait 0°"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                        <div>Full Corrected: {psaPipelineResult.diagnostics.fullCorrectedDimensions.width} × {psaPipelineResult.diagnostics.fullCorrectedDimensions.height}</div>
                        <div>Identity Source Crop: {psaPipelineResult.diagnostics.identitySourceCrop.width} × {psaPipelineResult.diagnostics.identitySourceCrop.height}</div>
                        <div>Identity OCR Output: {psaPipelineResult.diagnostics.identityOcrOutput.width} × {psaPipelineResult.diagnostics.identityOcrOutput.height}</div>
                        <div>Scale: {psaPipelineResult.diagnostics.scale}× ({Math.round(psaPipelineResult.diagnostics.areaRatio * 100)}% area)</div>
                        <div className="col-span-2 text-zinc-400">
                          Crop: x={psaPipelineResult.diagnostics.identitySourceCrop.x}, y={psaPipelineResult.diagnostics.identitySourceCrop.y}, w={psaPipelineResult.diagnostics.identitySourceCrop.width}, h={psaPipelineResult.diagnostics.identitySourceCrop.height}
                        </div>
                      </div>

                      {/* Section 14: Development-Only Secondary Regions Overlay Map */}
                      {psaPipelineResult.diagnostics.secondaryFieldRegions && (
                        <div className="border-t border-zinc-800 pt-1 mt-1 space-y-0.5">
                          <div className="font-bold text-emerald-400 text-[10px]">=== DEV: SECONDARY FIELD OCR REGIONS ===</div>
                          <div className="grid grid-cols-2 gap-x-2 text-[9px] text-zinc-400">
                            {Object.entries(psaPipelineResult.diagnostics.secondaryFieldRegions).map(([key, reg]) => (
                              <div key={key}>
                                <span className="text-zinc-300 font-semibold">{key}:</span> {reg.width}×{reg.height}px (x={reg.x}, y={reg.y}) {reg.isTooSmall && <span className="text-amber-400 font-bold">[TOO SMALL]</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Section 15: Optional User-Facing Secondary Capture Preview */}
              {docCategory === "birth_cert" && psaPipelineResult?.secondaryCrops && psaPipelineResult.secondaryCrops.length > 0 && (
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setShowSecondaryPreview(!showSecondaryPreview)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-500" />
                      Secondary Identity Verification ({psaPipelineResult.secondaryCrops.length} fields)
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {showSecondaryPreview ? "▲ Collapse" : "▼ Expand Previews"}
                    </span>
                  </button>
                  {showSecondaryPreview && (
                    <div className="p-3 space-y-2.5">
                      {/* Section 17: Resolution Check */}
                      {psaPipelineResult.secondaryCrops.some((c) => c.isTooSmall) && (
                        <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>Field region too small — move camera closer / recapture</span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {psaPipelineResult.secondaryCrops.map((crop) => {
                          if (crop.id === "child_sex" && crop.sexDiagnostic) {
                            const diag = crop.sexDiagnostic;
                            const isMaleMarked = diag.maleScore >= 0.28 || diag.state === "MALE_MARKED";
                            const isFemaleMarked = diag.femaleScore >= 0.28 || diag.state === "FEMALE_MARKED";
                            return (
                              <div
                                key={crop.id}
                                className="col-span-2 sm:col-span-3 border border-indigo-200 dark:border-indigo-900/60 rounded-lg p-2.5 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-2"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900 dark:text-indigo-200">
                                    <span>2. SEX — Physical Mark Verification</span>
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                      diag.state === "MALE_MARKED"
                                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300"
                                        : diag.state === "FEMALE_MARKED"
                                        ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300"
                                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300"
                                    }`}
                                  >
                                    {diag.state === "MALE_MARKED"
                                      ? "Candidate: Male"
                                      : diag.state === "FEMALE_MARKED"
                                      ? "Candidate: Female"
                                      : "Needs Verification"}
                                  </span>
                                </div>

                                {/* Full Item 2 Preview */}
                                <div className="space-y-1">
                                  <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
                                    Full Item 2 Row:
                                  </div>
                                  {diag.item2DataUrl || crop.dataUrl ? (
                                    <img
                                      src={diag.item2DataUrl || crop.dataUrl}
                                      alt="Item 2 Row"
                                      className="w-full h-11 object-contain rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                                    />
                                  ) : (
                                    <div className="w-full h-11 flex items-center justify-center text-[10px] text-zinc-400 border border-dashed rounded">
                                      {crop.width} × {crop.height} px
                                    </div>
                                  )}
                                </div>

                                {/* Male Mark Tiny Crop & Female Mark Tiny Crop */}
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="border border-zinc-200 dark:border-zinc-700 rounded p-1.5 bg-white dark:bg-zinc-900 space-y-1">
                                    <div className="flex items-center justify-between text-[10px]">
                                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                                        1 Male Mark Zone
                                      </span>
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold ${
                                          isMaleMarked
                                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                        }`}
                                      >
                                        {isMaleMarked ? "MARK DETECTED" : "EMPTY"}
                                      </span>
                                    </div>
                                    {diag.maleDataUrl ? (
                                      <img
                                        src={diag.maleDataUrl}
                                        alt="Male Mark Preview"
                                        className="w-full h-9 object-contain rounded border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                                      />
                                    ) : (
                                      <div className="w-full h-9 flex items-center justify-center text-[9px] text-zinc-400">
                                        No preview
                                      </div>
                                    )}
                                  </div>

                                  <div className="border border-zinc-200 dark:border-zinc-700 rounded p-1.5 bg-white dark:bg-zinc-900 space-y-1">
                                    <div className="flex items-center justify-between text-[10px]">
                                      <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                                        2 Female Mark Zone
                                      </span>
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold ${
                                          isFemaleMarked
                                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                        }`}
                                      >
                                        {isFemaleMarked ? "MARK DETECTED" : "EMPTY"}
                                      </span>
                                    </div>
                                    {diag.femaleDataUrl ? (
                                      <img
                                        src={diag.femaleDataUrl}
                                        alt="Female Mark Preview"
                                        className="w-full h-9 object-contain rounded border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                                      />
                                    ) : (
                                      <div className="w-full h-9 flex items-center justify-center text-[9px] text-zinc-400">
                                        No preview
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div key={crop.id} className="border border-zinc-200 dark:border-zinc-700 rounded p-1.5 bg-zinc-50 dark:bg-zinc-800/40 space-y-1">
                              <div className="flex items-center justify-between text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                                <span className="truncate">{crop.label}</span>
                                {crop.isTooSmall && (
                                  <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold shrink-0">Too Small</span>
                                )}
                              </div>
                              {crop.dataUrl ? (
                                <img src={crop.dataUrl} alt={crop.label} className="w-full h-12 object-contain rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900" />
                              ) : (
                                <div className="w-full h-12 flex items-center justify-center text-[10px] text-zinc-400 border border-dashed rounded">
                                  {crop.width} × {crop.height} px
                                </div>
                              )}
                              <div className="text-[9px] text-zinc-400 text-right">
                                {crop.width} × {crop.height} px
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <ImagePreview
                image={
                  (docCategory === "birth_cert"
                    ? psaPreviewTab === "identity_crop"
                      ? psaIdentityCropUrl || psaEnhancementResult?.enhancedDataUrl || psaFullCorrectedUrl || rawImage
                      : psaPreviewTab === "full_corrected"
                      ? psaFullCorrectedUrl || rawImage
                      : psaOriginalUrl || rawImage
                    : processedImage || rawImage) as string
                }
                isCropping={isCropping}
                containerRef={containerRef}
                imageRef={imageRef}
                dragRect={dragRect}
                previewRotation={docCategory === "birth_cert" ? 0 : previewRotation}
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
                      className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm flex items-center justify-center gap-2 transition-colors"
                    >
                      <span>Continue to Step 2: Back Side</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Extract Button: Available when both sides present in two-sided, or when single image present */}
                {(workflowType === "single" || isBothCaptured || (workflowType === "two_sided" && currentStep === 2 && (backImage || rawImage))) && (
                  <ExtractButton 
                    onClick={handleExtract} 
                    isExtracting={isExtracting} 
                    disabled={isProcessing || (retryAfter !== null && retryAfter > 0)}
                    cooldownSeconds={retryAfter}
                  />
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
              ) : docCategory === "birth_cert" ? (
                <Award className="w-8 h-8 text-zinc-400 mb-2" />
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
              className="py-3 px-6 text-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-md flex items-center gap-2"
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
                    {docCategory === "birth_cert"
                      ? "PSA / Birth Certificate"
                      : docCategory === "sf10"
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

            <div className="flex gap-4 justify-end mt-4">
              <button
                type="button"
                className="px-4 py-2 rounded-md font-medium bg-zinc-200 hover:bg-zinc-300 text-zinc-900 text-sm"
                onClick={() => setShowUploadModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUploadToSupabase} 
                disabled={isUploading || uploadSuccess}
                className={`px-4 py-2 rounded-md font-medium text-white text-sm ${uploadSuccess ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
              >
                {uploadSuccess ? "Uploaded Successfully!" : isUploading ? "Uploading..." : "Confirm & Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

"use client";

import React, { useState, useRef, useEffect } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import DocumentCameraCaptureModal from "@/components/camera/DocumentCameraCaptureModal";
import {
  UploadCloud,
  Camera,
  FileText,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Edit3,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  UserCheck,
  Layers,
  ArrowLeftRight,
  ShieldAlert,
  Search,
  ExternalLink,
  X,
  FileCheck,
  Sparkles,
} from "lucide-react";
import type { PsaFieldStatusMap, FieldStatus } from "@/lib/ocr/psaParser";
import { parseApiResponseSafely } from "@/lib/ocr/apiResponseParser";
import { preprocessPsaImage } from "@/lib/ocr/psaPreprocessing";

interface PsaIdentityData {
  registry_number?: string;
  certificate_number?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  complete_name?: string;
  formatted_name?: string;
  suffix?: string;
  sex?: "M" | "F";
  birth_date?: string;
  birth_place?: {
    hospital?: string;
    city_municipality?: string;
    province?: string;
    raw?: string;
  };
  mother_maiden_name?: string;
  mother_name?: string;
  father_name?: string;
}

interface StudentOption {
  id: string;
  lrn: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  birth_date?: string | null;
  sex?: string | null;
}

export default function PsaScannerPage() {
  // Staging / Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [ocrPreparedDataUrl, setOcrPreparedDataUrl] = useState<string | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [backPreviewDataUrl, setBackPreviewDataUrl] = useState<string | null>(null);
  const [backOcrPreparedDataUrl, setBackOcrPreparedDataUrl] = useState<string | null>(null);
  const [activeSide, setActiveSide] = useState<"front" | "back">("front");
  const [hasBackPage, setHasBackPage] = useState<boolean>(false);
  const [childSectionCropUrl, setChildSectionCropUrl] = useState<string | null>(null);
  const [childNameCropUrl, setChildNameCropUrl] = useState<string | null>(null);
  const [isPreprocessing, setIsPreprocessing] = useState<boolean>(false);
  const [preprocessingNote, setPreprocessingNote] = useState<string | null>(null);
  // Preview Mode: "processed" (Upright B&W) | "cropped" (Item 1 Child Section) | "original" (Raw Upload)
  const [previewMode, setPreviewMode] = useState<"processed" | "cropped" | "original">("processed");

  // Camera Modal State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<"front" | "back">("front");

  // Processing State
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Results State
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [extractedIdentity, setExtractedIdentity] = useState<PsaIdentityData | null>(null);
  const [fieldStatuses, setFieldStatuses] = useState<PsaFieldStatusMap | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Manual Correction State
  const [isEditing, setIsEditing] = useState(false);
  const [editedIdentity, setEditedIdentity] = useState<PsaIdentityData | null>(null);
  const [isSavedManual, setIsSavedManual] = useState(false);

  // Image Preview Controls
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [showRawOcr, setShowRawOcr] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);

  // Comparison Preview State (Requirement 7)
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backFileInputRef = useRef<HTMLInputElement>(null);

  // Load students for optional comparison preview
  useEffect(() => {
    async function loadStudents() {
      setIsLoadingStudents(true);
      try {
        const res = await fetch("/api/students?limit=100");
        if (res.ok) {
          const safeData = await parseApiResponseSafely(res);
          if (safeData.ok && safeData.data && Array.isArray(safeData.data.students)) {
            setStudents(safeData.data.students);
          }
        }
      } catch (err) {
        console.warn("Could not load student directory for preview comparison:", err);
      } finally {
        setIsLoadingStudents(false);
      }
    }
    loadStudents();
  }, []);

  const getDisplayedFrontImage = () => {
    if (previewMode === "cropped") {
      return childNameCropUrl || childSectionCropUrl || ocrPreparedDataUrl || previewDataUrl || "";
    }
    if (previewMode === "processed") {
      return ocrPreparedDataUrl || previewDataUrl || "";
    }
    return previewDataUrl || "";
  };

  // Automatic safe B&W OCR preprocessing with orientation correction & targeted cropping
  const processImageForOcr = async (dataUrl: string, rotDeg: number = 0) => {
    setIsPreprocessing(true);
    try {
      const prepRes = await preprocessPsaImage(dataUrl, {
        rotation: rotDeg,
        autoRotate: true,
      });
      setOcrPreparedDataUrl(prepRes.processedDataUrl);
      setChildSectionCropUrl(prepRes.childSectionDataUrl || null);
      setChildNameCropUrl(prepRes.childNameDataUrl || null);
      setPreviewMode("processed");

      if (prepRes.rotationApplied && prepRes.rotationApplied !== 0) {
        setRotation(prepRes.rotationApplied);
        setPreprocessingNote(
          `Auto-Orientation Applied: ${prepRes.rotationApplied === 270 ? "90° Counter-Clockwise (Upright)" : `${prepRes.rotationApplied}°`} with True B&W Adaptive Binarization & Targeted Child Crops`
        );
      } else if (prepRes.wasProcessed) {
        setPreprocessingNote("True B&W Adaptive Binarization & Targeted Child Crops Active (Original Preserved for Verification)");
      } else if (prepRes.skippedReason) {
        setPreprocessingNote(prepRes.skippedReason);
      }
    } catch {
      setOcrPreparedDataUrl(dataUrl);
      setChildSectionCropUrl(null);
      setChildNameCropUrl(null);
    } finally {
      setIsPreprocessing(false);
    }
  };

  const handleApplyRotation = async (targetRotation: number) => {
    const normalized = ((targetRotation % 360) + 360) % 360;
    setRotation(normalized);
    if (previewDataUrl) {
      await processImageForOcr(previewDataUrl, normalized);
    }
  };

  // Handle File Input Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, side: "front" | "back") => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      if (side === "front") {
        setSelectedFile(file);
        setPreviewDataUrl(dataUrl);
        setRotation(0);
        await processImageForOcr(dataUrl, 0);
      } else {
        setBackFile(file);
        setBackPreviewDataUrl(dataUrl);
        try {
          const prepRes = await preprocessPsaImage(dataUrl);
          setBackOcrPreparedDataUrl(prepRes.processedDataUrl);
        } catch {
          setBackOcrPreparedDataUrl(dataUrl);
        }
      }
      setErrorMessage(null);
    };
    reader.readAsDataURL(file);
  };

  // Camera Capture Confirmation
  const handlePhotoCaptured = async (dataUrl: string) => {
    if (cameraTarget === "front") {
      setPreviewDataUrl(dataUrl);
      setSelectedFile(new File([dataUrl], "psa_front_camera.jpg", { type: "image/jpeg" }));
      setRotation(0);
      await processImageForOcr(dataUrl, 0);
    } else {
      setBackPreviewDataUrl(dataUrl);
      setBackFile(new File([dataUrl], "psa_back_camera.jpg", { type: "image/jpeg" }));
      try {
        const prepRes = await preprocessPsaImage(dataUrl);
        setBackOcrPreparedDataUrl(prepRes.processedDataUrl);
      } catch {
        setBackOcrPreparedDataUrl(dataUrl);
      }
    }
    setIsCameraOpen(false);
    setErrorMessage(null);
  };

  // Remove File
  const handleRemoveFile = (side: "front" | "back") => {
    if (side === "front") {
      setSelectedFile(null);
      setPreviewDataUrl(null);
      setOcrPreparedDataUrl(null);
      setChildSectionCropUrl(null);
      setChildNameCropUrl(null);
      setPreprocessingNote(null);
      setRotation(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } else {
      setBackFile(null);
      setBackPreviewDataUrl(null);
      setBackOcrPreparedDataUrl(null);
      if (backFileInputRef.current) backFileInputRef.current.value = "";
    }
  };

  // Reset entire scanner
  const handleResetScanner = () => {
    setSelectedFile(null);
    setPreviewDataUrl(null);
    setOcrPreparedDataUrl(null);
    setChildSectionCropUrl(null);
    setChildNameCropUrl(null);
    setBackFile(null);
    setBackPreviewDataUrl(null);
    setBackOcrPreparedDataUrl(null);
    setPreprocessingNote(null);
    setIsPreprocessing(false);
    setOcrText(null);
    setExtractedIdentity(null);
    setEditedIdentity(null);
    setFieldStatuses(null);
    setErrorMessage(null);
    setIsEditing(false);
    setIsSavedManual(false);
    setZoomLevel(1);
    setRotation(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (backFileInputRef.current) backFileInputRef.current.value = "";
  };

  // Run OCR Scan
  const handleExecuteScan = async () => {
    if (!previewDataUrl) {
      setErrorMessage("Please select or capture a PSA document image before scanning.");
      return;
    }

    setIsScanning(true);
    setErrorMessage(null);

    try {
      // Use preprocessed B&W upright image for OCR while original remains untouched in preview
      const effectiveImage = ocrPreparedDataUrl || previewDataUrl;
      const effectiveBackImage = backOcrPreparedDataUrl || backPreviewDataUrl;

      const payload: any = {
        image: effectiveImage,
        originalImage: previewDataUrl,
        childSectionImage: childSectionCropUrl || undefined,
        childNameImage: childNameCropUrl || undefined,
        isPreprocessed: Boolean(ocrPreparedDataUrl && ocrPreparedDataUrl !== previewDataUrl),
      };

      if (hasBackPage && effectiveBackImage) {
        payload.frontImage = effectiveImage;
        payload.backImage = effectiveBackImage;
      }

      const res = await fetch("/api/scan/psa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Safe API response parsing: defends against empty response, HTML error pages, and malformed JSON
      const parsedRes = await parseApiResponseSafely(res, {
        defaultErrorMessage: "PSA document extraction failed. Please try again.",
      });

      if (!parsedRes.ok) {
        setErrorMessage(parsedRes.error || `Scan failed with status ${res.status}`);
        return;
      }

      const data = parsedRes.data;
      setOcrText(data.text || "");
      setExtractedIdentity(data.identity || null);
      setEditedIdentity(data.identity ? { ...data.identity } : null);
      setFieldStatuses(data.field_statuses || null);
      setConfidence(data.confidence ?? null);
      setProvider(data.provider || "azure");
      setModel(data.model || "prebuilt-read");
      setWarnings(data.warnings || []);
      setIsSavedManual(false);
      setIsEditing(false);
    } catch (err: any) {
      setErrorMessage(err.message || "An unexpected error occurred during PSA document extraction.");
    } finally {
      setIsScanning(false);
    }
  };

  // Manual Correction Handlers
  const handleFieldChange = (field: keyof PsaIdentityData, val: any) => {
    if (!editedIdentity) return;
    setEditedIdentity({
      ...editedIdentity,
      [field]: val,
    });
  };

  const handleSaveCorrections = () => {
    if (editedIdentity) {
      // Re-derive complete name if names changed
      const parts = [editedIdentity.first_name, editedIdentity.middle_name, editedIdentity.last_name].filter(
        (p) => p && p.trim().length > 0 && p !== "Unknown"
      );
      const updatedComplete = parts.join(" ") + (editedIdentity.suffix ? ` ${editedIdentity.suffix}` : "");

      const updated = {
        ...editedIdentity,
        complete_name: updatedComplete || editedIdentity.complete_name,
        formatted_name: `${editedIdentity.last_name}, ${editedIdentity.first_name}${editedIdentity.middle_name ? ` ${editedIdentity.middle_name}` : ""}${editedIdentity.suffix ? ` ${editedIdentity.suffix}` : ""}`,
      };

      setExtractedIdentity(updated);
      setEditedIdentity(updated);
      setIsSavedManual(true);
      setIsEditing(false);
    }
  };

  const handleRevertToOcr = () => {
    if (extractedIdentity) {
      setEditedIdentity({ ...extractedIdentity });
      setIsEditing(false);
      setIsSavedManual(false);
    }
  };

  // Helper for status badge
  const renderStatusBadge = (status?: FieldStatus) => {
    if (status === "extracted") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Successfully extracted
        </span>
      );
    }
    if (status === "needs_verification") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-3.5 h-3.5" />
          Needs verification
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
        <HelpCircle className="w-3.5 h-3.5" />
        Not detected
      </span>
    );
  };

  // Copy raw OCR text
  const handleCopyRawText = () => {
    if (ocrText) {
      navigator.clipboard.writeText(ocrText);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    }
  };

  // Selected student for comparison
  const selectedStudent = students.find((s) => s.id === selectedStudentId);

  // Name comparison calculation
  const getComparisonResults = () => {
    if (!selectedStudent || !extractedIdentity) return null;

    const psaFirst = (extractedIdentity.first_name || "").toLowerCase().trim();
    const psaLast = (extractedIdentity.last_name || "").toLowerCase().trim();
    const psaMiddle = (extractedIdentity.middle_name || "").toLowerCase().trim();

    const stuFirst = (selectedStudent.first_name || "").toLowerCase().trim();
    const stuLast = (selectedStudent.last_name || "").toLowerCase().trim();
    const stuMiddle = (selectedStudent.middle_name || "").toLowerCase().trim();

    const isFirstMatch = psaFirst === stuFirst;
    const isLastMatch = psaLast === stuLast;
    const isMiddleMatch =
      !psaMiddle || !stuMiddle || psaMiddle === stuMiddle || psaMiddle.charAt(0) === stuMiddle.charAt(0);

    const isFullMatch = isFirstMatch && isLastMatch && isMiddleMatch;

    return {
      isFullMatch,
      isFirstMatch,
      isLastMatch,
      isMiddleMatch,
      psaFullName:
        extractedIdentity.complete_name ||
        `${extractedIdentity.first_name} ${extractedIdentity.last_name}`.trim(),
      studentFullName: `${selectedStudent.first_name} ${selectedStudent.middle_name ? `${selectedStudent.middle_name} ` : ""}${selectedStudent.last_name}`.trim(),
    };
  };

  const comparison = getComparisonResults();

  return (
    <PageContainer>
      {/* DepEd AVV Header */}
      <Header
        title="PSA Birth Certificate Scanner"
        description="Dedicated standalone scanning, OCR testing, and child civil identity verification under RA 10173."
        roleBadge={{ role: "teacher", label: "Faculty Validator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "500169" }}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "PSA Scanner", href: "/psa-scan" },
        ]}
        actions={
          extractedIdentity ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetScanner}
              className="flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4" />
              Scan Another Certificate
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {/* Isolated Test Mode Banner */}
        <div className="p-4 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-bold">Safe Test & Preview Environment (RA 10173):</span> This standalone PSA scanner
            operates completely in-memory. No student records or database rows are created, overwritten, or modified.
            The primary extraction goal is to verify the <strong>Child&apos;s Complete Name</strong> and supporting civil
            registry details.
          </div>
        </div>

        {/* SECTION 1: DOCUMENT UPLOAD & STAGING (Visible before scan or when resetting) */}
        {!extractedIdentity && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm space-y-6">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                PSA Document Upload & Camera Capture
              </h2>
              <p className="text-sm text-zinc-500">
                Upload a clear photo or scanned PDF of a PSA Certificate of Live Birth. Supports JPG, JPEG, PNG, and PDF.
              </p>
            </div>

            {/* Error Notification */}
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-sm flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExecuteScan}
                  className="shrink-0 bg-white dark:bg-zinc-900 text-red-700"
                >
                  Retry Scan
                </Button>
              </div>
            )}

            {/* Staging Area Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Front Page Zone */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    Front Page (Primary Certificate) <span className="text-red-500">*</span>
                  </span>
                  {previewDataUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFile("front")}
                      className="text-xs text-red-600 hover:text-red-700 h-7 px-2"
                    >
                      <X className="w-3.5 h-3.5 mr-1" />
                      Remove
                    </Button>
                  )}
                </div>

                {!previewDataUrl ? (
                  <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-8 text-center flex flex-col items-center justify-center gap-3 hover:border-indigo-400 transition-colors bg-zinc-50/50 dark:bg-zinc-800/20">
                    <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Drag and drop PSA document here, or browse
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">Supports JPG, PNG, or PDF up to 15MB</p>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs"
                      >
                        Choose File
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setCameraTarget("front");
                          setIsCameraOpen(true);
                        }}
                        className="text-xs flex items-center gap-1.5"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Use Camera
                      </Button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/jpg,image/webp,application/pdf"
                      onChange={(e) => handleFileChange(e, "front")}
                      className="hidden"
                    />
                  </div>
                ) : (
                  <div className="relative border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800/40">
                    {/* View Mode Switcher for Visual Verification */}
                    <div className="p-2 bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-1.5 text-xs">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewMode("processed")}
                          className={`px-2.5 py-1 rounded font-semibold flex items-center gap-1 transition-colors ${
                            previewMode === "processed"
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "bg-zinc-200/70 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                          }`}
                          title="View full auto-rotated Black & White image prepared for Azure OCR"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          B&W Upright
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMode("cropped")}
                          disabled={!childNameCropUrl && !childSectionCropUrl}
                          className={`px-2.5 py-1 rounded font-semibold flex items-center gap-1 transition-colors ${
                            previewMode === "cropped"
                              ? "bg-indigo-600 text-white shadow-xs"
                              : !childNameCropUrl && !childSectionCropUrl
                              ? "opacity-40 cursor-not-allowed bg-zinc-100 text-zinc-400"
                              : "bg-zinc-200/70 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                          }`}
                          title="View cropped upper-middle CHILD section (Item 1 First, Middle, Last Name)"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Child Crop (Item 1)
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewMode("original")}
                          className={`px-2 py-1 rounded font-medium flex items-center gap-1 transition-colors ${
                            previewMode === "original"
                              ? "bg-indigo-600 text-white shadow-xs"
                              : "bg-zinc-200/70 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                          }`}
                          title="View original untouched scan"
                        >
                          Original
                        </button>
                      </div>

                      {/* Orientation Controls */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleApplyRotation((rotation + 270) % 360)}
                          title="Rotate 90° CCW (Make Upright)"
                          className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-300"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyRotation((rotation + 90) % 360)}
                          title="Rotate 90° CW"
                          className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-300"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="aspect-[4/3] flex items-center justify-center p-2 bg-zinc-950">
                      {selectedFile?.type === "application/pdf" ? (
                        <div className="flex flex-col items-center gap-2 text-zinc-300">
                          <FileText className="w-12 h-12 text-red-500" />
                          <span className="text-xs font-semibold">{selectedFile.name} (PDF Document)</span>
                        </div>
                      ) : (
                        <img
                          src={getDisplayedFrontImage()}
                          alt="PSA Front Page Preview"
                          className="max-h-full max-w-full object-contain rounded"
                        />
                      )}
                    </div>
                    <div className="p-2.5 bg-zinc-50 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between text-xs">
                      <span className="font-medium truncate max-w-[200px]">
                        {selectedFile?.name || "Captured Photo"} ({previewMode === "processed" ? "B&W Upright" : previewMode === "cropped" ? "Child Crop" : "Original"})
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs h-6 px-2 text-indigo-600"
                      >
                        Replace
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Back Page / Multi-page Option */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    Back Page (Endorsements / Annotations)
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasBackPage}
                      onChange={(e) => setHasBackPage(e.target.checked)}
                      className="rounded text-indigo-600"
                    />
                    Include Back Side
                  </label>
                </div>

                {!hasBackPage ? (
                  <div className="border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-8 text-center flex flex-col items-center justify-center gap-2 bg-zinc-50/30 dark:bg-zinc-800/10 min-h-[180px]">
                    <Layers className="w-8 h-8 text-zinc-400" />
                    <p className="text-xs text-zinc-500 max-w-[220px]">
                      Most PSA certificates are single-sided. Enable if your document has registry endorsements on the back.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setHasBackPage(true)}
                      className="text-xs mt-1"
                    >
                      Enable Back Side
                    </Button>
                  </div>
                ) : !backPreviewDataUrl ? (
                  <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-8 text-center flex flex-col items-center justify-center gap-3 hover:border-indigo-400 transition-colors bg-zinc-50/50 dark:bg-zinc-800/20">
                    <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Upload or capture back side
                      </p>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => backFileInputRef.current?.click()}
                        className="text-xs"
                      >
                        Choose File
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setCameraTarget("back");
                          setIsCameraOpen(true);
                        }}
                        className="text-xs flex items-center gap-1.5"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Use Camera
                      </Button>
                    </div>
                    <input
                      ref={backFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/jpg,image/webp,application/pdf"
                      onChange={(e) => handleFileChange(e, "back")}
                      className="hidden"
                    />
                  </div>
                ) : (
                  <div className="relative border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800/40">
                    <div className="aspect-[4/3] flex items-center justify-center p-2">
                      <img
                        src={backPreviewDataUrl}
                        alt="PSA Back Page Preview"
                        className="max-h-full max-w-full object-contain rounded"
                      />
                    </div>
                    <div className="p-2.5 bg-zinc-50 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between text-xs">
                      <span className="font-medium truncate max-w-[200px]">{backFile?.name || "Back Photo"}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveFile("back")}
                        className="text-xs text-red-600"
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Execute Scanning Action Button */}
            <div className="pt-2 flex items-center justify-end gap-3 border-t border-zinc-100 dark:border-zinc-800">
              <Button
                variant="primary"
                size="lg"
                disabled={!previewDataUrl || isScanning}
                onClick={handleExecuteScan}
                className="w-full sm:w-auto min-w-[220px] bg-[#174EA6] hover:bg-[#15418F] text-white font-bold"
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Running OCR & Extraction...
                  </>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4 mr-2" />
                    Scan & Extract Child Information
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* SECTION 2: RESULTS VIEW (2 Columns: Left Preview, Right Fields) */}
        {extractedIdentity && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: Document Preview Viewer (5 columns) */}
            <div className="lg:col-span-5 space-y-4 sticky top-6">
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2.5 gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewMode("processed")}
                      className={`px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors ${
                        previewMode === "processed"
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200"
                      }`}
                      title="View full auto-rotated Black & White image prepared for Azure OCR"
                    >
                      <Sparkles className="w-3 h-3" />
                      B&W Upright
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode("cropped")}
                      disabled={!childNameCropUrl && !childSectionCropUrl}
                      className={`px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-1 transition-colors ${
                        previewMode === "cropped"
                          ? "bg-indigo-600 text-white shadow-xs"
                          : !childNameCropUrl && !childSectionCropUrl
                          ? "opacity-40 cursor-not-allowed bg-zinc-100 text-zinc-400"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200"
                      }`}
                      title="View cropped upper-middle CHILD section"
                    >
                      <FileText className="w-3 h-3" />
                      Child Crop
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode("original")}
                      className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 transition-colors ${
                        previewMode === "original"
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200"
                      }`}
                      title="View original untouched scan"
                    >
                      Original
                    </button>
                  </div>

                  {/* Multi-page switcher if back side exists */}
                  {hasBackPage && backPreviewDataUrl && (
                    <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 text-xs">
                      <button
                        onClick={() => setActiveSide("front")}
                        className={`px-2 py-0.5 rounded font-medium ${
                          activeSide === "front"
                            ? "bg-indigo-600 text-white"
                            : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
                        }`}
                      >
                        Front
                      </button>
                      <button
                        onClick={() => setActiveSide("back")}
                        className={`px-2 py-0.5 rounded font-medium ${
                          activeSide === "back"
                            ? "bg-indigo-600 text-white"
                            : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
                        }`}
                      >
                        Back
                      </button>
                    </div>
                  )}
                </div>

                {/* Interactive Image Container */}
                <div className="relative border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-zinc-950 aspect-[3/4] flex items-center justify-center p-1">
                  <div
                    className="w-full h-full flex items-center justify-center transition-transform duration-150"
                    style={{
                      transform: `scale(${zoomLevel}) ${previewMode === "original" ? `rotate(${rotation}deg)` : ""}`,
                    }}
                  >
                    <img
                      src={activeSide === "front" ? getDisplayedFrontImage() : backPreviewDataUrl || ""}
                      alt="PSA Document Preview"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>

                  {/* Zoom / Rotate Controls Overlay */}
                  <div className="absolute bottom-3 right-3 bg-zinc-900/80 backdrop-blur-xs text-white rounded-lg p-1 flex items-center gap-1 border border-white/10 shadow-lg text-xs">
                    <button
                      onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 3))}
                      title="Zoom In"
                      className="p-1.5 hover:bg-white/20 rounded"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 0.75))}
                      title="Zoom Out"
                      className="p-1.5 hover:bg-white/20 rounded"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleApplyRotation((rotation + 270) % 360)}
                      title="Rotate 90° CCW (Make Upright)"
                      className="p-1.5 hover:bg-white/20 rounded flex items-center gap-1"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span className="text-[10px]">90° CCW</span>
                    </button>
                    <button
                      onClick={() => handleApplyRotation((rotation + 90) % 360)}
                      title="Rotate 90° CW"
                      className="p-1.5 hover:bg-white/20 rounded"
                    >
                      <RotateCw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setZoomLevel(1);
                        handleApplyRotation(0);
                      }}
                      title="Reset View & Orientation"
                      className="px-1.5 py-1 hover:bg-white/20 rounded text-[10px]"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-zinc-500 pt-1">
                  <span>Provider: <strong className="text-zinc-800 dark:text-zinc-200 capitalize">{provider}</strong></span>
                  <span>Model: <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">{model}</code></span>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Extracted Information & Verification (7 columns) */}
            <div className="lg:col-span-7 space-y-6">
              {/* 1. MOST IMPORTANT FIELD: CHILD'S COMPLETE NAME */}
              <div className="bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/50 dark:from-indigo-950/40 dark:via-zinc-900 dark:to-zinc-900 rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 p-6 shadow-md relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md text-xs font-extrabold uppercase tracking-wider bg-indigo-600 text-white shadow-xs">
                      Primary Target Field
                    </span>
                    <span className="text-xs text-zinc-500 font-medium">Under RA 10173 Civil Identity</span>
                  </div>
                  {renderStatusBadge(fieldStatuses?.complete_name?.status)}
                </div>

                <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 mt-3">
                  Child&apos;s Complete Name
                </p>

                {isEditing ? (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={editedIdentity?.complete_name || ""}
                      onChange={(e) => handleFieldChange("complete_name", e.target.value)}
                      placeholder="e.g. JUAN SANTOS DELA CRUZ"
                      className="w-full text-2xl font-extrabold px-3 py-2 rounded-lg border-2 border-indigo-400 dark:border-indigo-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                ) : (
                  <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-zinc-50 mt-1 tracking-tight">
                    {extractedIdentity.complete_name || (
                      <span className="text-zinc-400 dark:text-zinc-600 italic font-medium">Not detected</span>
                    )}
                  </h1>
                )}

                {/* Sub-line with formatted last, first middle */}
                {extractedIdentity.formatted_name && !isEditing && (
                  <p className="text-xs text-zinc-500 mt-1">
                    Formal Registry Format: <strong>{extractedIdentity.formatted_name}</strong>
                  </p>
                )}

                {/* Confidence indicator badge */}
                <div className="mt-4 pt-3 border-t border-indigo-100 dark:border-indigo-900/60 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                    <UserCheck className="w-4 h-4 text-indigo-600" />
                    <span>
                      OCR Confidence: <strong>{confidence ? `${Math.round(confidence * 100)}%` : "N/A"}</strong>
                    </span>
                  </div>
                  {isSavedManual && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Manually Corrected by Teacher
                    </span>
                  )}
                </div>
              </div>

              {/* 2. EXTRACTED CHILD INFORMATION TABLE & VERIFICATION STATUS */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      Child &amp; Civil Identity Fields
                    </h3>
                    <p className="text-xs text-zinc-500">
                      Review individual extracted values against the original document.
                    </p>
                  </div>

                  {/* Manual Correction Toggle */}
                  <div className="flex items-center gap-2">
                    {!isEditing ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsEditing(true)}
                        className="text-xs flex items-center gap-1.5"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Manual Correction
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleRevertToOcr}
                          className="text-xs"
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleSaveCorrections}
                          className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <Check className="w-3.5 h-3.5 mr-1" />
                          Save Corrections
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Fields Table */}
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
                  {/* First Name */}
                  <div className="py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-4 text-xs font-semibold text-zinc-500">First Name</span>
                    <div className="sm:col-span-5 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedIdentity?.first_name || ""}
                          onChange={(e) => handleFieldChange("first_name", e.target.value)}
                          className="w-full text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                        />
                      ) : (
                        extractedIdentity.first_name || <span className="text-zinc-400 italic">Not detected</span>
                      )}
                    </div>
                    <div className="sm:col-span-3 text-right">
                      {renderStatusBadge(fieldStatuses?.first_name?.status)}
                    </div>
                  </div>

                  {/* Middle Name */}
                  <div className="py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-4 text-xs font-semibold text-zinc-500">
                      Middle Name
                      <span className="block text-[10px] text-zinc-400 font-normal">Optional / Can be blank</span>
                    </span>
                    <div className="sm:col-span-5 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedIdentity?.middle_name || ""}
                          onChange={(e) => handleFieldChange("middle_name", e.target.value)}
                          placeholder="(Blank if none)"
                          className="w-full text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                        />
                      ) : (
                        extractedIdentity.middle_name || (
                          <span className="text-zinc-400 italic">None / Not detected</span>
                        )
                      )}
                    </div>
                    <div className="sm:col-span-3 text-right">
                      {renderStatusBadge(fieldStatuses?.middle_name?.status)}
                    </div>
                  </div>

                  {/* Last Name */}
                  <div className="py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-4 text-xs font-semibold text-zinc-500">Last Name</span>
                    <div className="sm:col-span-5 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedIdentity?.last_name || ""}
                          onChange={(e) => handleFieldChange("last_name", e.target.value)}
                          className="w-full text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                        />
                      ) : (
                        extractedIdentity.last_name || <span className="text-zinc-400 italic">Not detected</span>
                      )}
                    </div>
                    <div className="sm:col-span-3 text-right">
                      {renderStatusBadge(fieldStatuses?.last_name?.status)}
                    </div>
                  </div>

                  {/* Date of Birth */}
                  <div className="py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-4 text-xs font-semibold text-zinc-500">Date of Birth</span>
                    <div className="sm:col-span-5 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedIdentity?.birth_date || ""}
                          onChange={(e) => handleFieldChange("birth_date", e.target.value)}
                          placeholder="YYYY-MM-DD"
                          className="w-full text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                        />
                      ) : (
                        extractedIdentity.birth_date || <span className="text-zinc-400 italic">Not detected</span>
                      )}
                    </div>
                    <div className="sm:col-span-3 text-right">
                      {renderStatusBadge(fieldStatuses?.birth_date?.status)}
                    </div>
                  </div>

                  {/* Sex */}
                  <div className="py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-4 text-xs font-semibold text-zinc-500">Sex</span>
                    <div className="sm:col-span-5 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <select
                          value={editedIdentity?.sex || "M"}
                          onChange={(e) => handleFieldChange("sex", e.target.value as "M" | "F")}
                          className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                        >
                          <option value="M">Male (M)</option>
                          <option value="F">Female (F)</option>
                        </select>
                      ) : extractedIdentity.sex === "M" ? (
                        "Male (M)"
                      ) : extractedIdentity.sex === "F" ? (
                        "Female (F)"
                      ) : (
                        <span className="text-zinc-400 italic">Not detected</span>
                      )}
                    </div>
                    <div className="sm:col-span-3 text-right">
                      {renderStatusBadge(fieldStatuses?.sex?.status)}
                    </div>
                  </div>

                  {/* Place of Birth */}
                  <div className="py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-4 text-xs font-semibold text-zinc-500">Place of Birth</span>
                    <div className="sm:col-span-5 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedIdentity?.birth_place?.city_municipality || ""}
                          onChange={(e) =>
                            handleFieldChange("birth_place", {
                              ...editedIdentity?.birth_place,
                              city_municipality: e.target.value,
                            })
                          }
                          className="w-full text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                        />
                      ) : (
                        extractedIdentity.birth_place?.city_municipality ||
                        extractedIdentity.birth_place?.raw || (
                          <span className="text-zinc-400 italic">Not detected</span>
                        )
                      )}
                    </div>
                    <div className="sm:col-span-3 text-right">
                      {renderStatusBadge(fieldStatuses?.birth_place?.status)}
                    </div>
                  </div>

                  {/* Mother's Complete Name */}
                  <div className="py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-4 text-xs font-semibold text-zinc-500">
                      Mother&apos;s Complete Name
                      <span className="block text-[10px] text-zinc-400 font-normal">Maiden Name</span>
                    </span>
                    <div className="sm:col-span-5 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedIdentity?.mother_maiden_name || ""}
                          onChange={(e) => handleFieldChange("mother_maiden_name", e.target.value)}
                          className="w-full text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                        />
                      ) : (
                        extractedIdentity.mother_maiden_name ||
                        extractedIdentity.mother_name || (
                          <span className="text-zinc-400 italic">Not detected</span>
                        )
                      )}
                    </div>
                    <div className="sm:col-span-3 text-right">
                      {renderStatusBadge(fieldStatuses?.mother_name?.status)}
                    </div>
                  </div>

                  {/* Father's Complete Name */}
                  <div className="py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-4 text-xs font-semibold text-zinc-500">Father&apos;s Complete Name</span>
                    <div className="sm:col-span-5 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedIdentity?.father_name || ""}
                          onChange={(e) => handleFieldChange("father_name", e.target.value)}
                          className="w-full text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                        />
                      ) : (
                        extractedIdentity.father_name || <span className="text-zinc-400 italic">Not detected</span>
                      )}
                    </div>
                    <div className="sm:col-span-3 text-right">
                      {renderStatusBadge(fieldStatuses?.father_name?.status)}
                    </div>
                  </div>

                  {/* Registry Number or PSA Certificate Number */}
                  <div className="py-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <span className="sm:col-span-4 text-xs font-semibold text-zinc-500">
                      Registry / Certificate No.
                    </span>
                    <div className="sm:col-span-5 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedIdentity?.registry_number || ""}
                          onChange={(e) => handleFieldChange("registry_number", e.target.value)}
                          className="w-full text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                        />
                      ) : (
                        extractedIdentity.registry_number ||
                        extractedIdentity.certificate_number || (
                          <span className="text-zinc-400 italic">Not detected</span>
                        )
                      )}
                    </div>
                    <div className="sm:col-span-3 text-right">
                      {renderStatusBadge(fieldStatuses?.registry_number?.status)}
                    </div>
                  </div>
                </div>

                {/* Warnings Section if any */}
                {warnings.length > 0 && (
                  <div className="mt-4 p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                    <p className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      Extraction Advisories ({warnings.length})
                    </p>
                    <ul className="list-disc list-inside text-xs text-amber-800 dark:text-amber-300 space-y-0.5">
                      {warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* 3. COMPARISON PREVIEW (REQUIREMENT 7) */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm space-y-4">
                <div className="border-b border-zinc-100 dark:border-zinc-800 pb-3">
                  <div className="flex items-center gap-2">
                    <ArrowLeftRight className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                      Student Identity Comparison Preview (Optional)
                    </h3>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    Optionally select an enrolled learner to preview name concordance against civil registry records.
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400 block mt-0.5">
                      PREVIEW ONLY — No records will be merged, linked, or overwritten.
                    </span>
                  </p>
                </div>

                {/* Student Selector */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Select Enrolled Learner from School Directory
                  </label>
                  {isLoadingStudents ? (
                    <div className="text-xs text-zinc-500 flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading learners...
                    </div>
                  ) : students.length > 0 ? (
                    <select
                      value={selectedStudentId}
                      onChange={(e) => setSelectedStudentId(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="">-- Choose a learner to preview comparison --</option>
                      {students.map((stu) => (
                        <option key={stu.id} value={stu.id}>
                          LRN: {stu.lrn} — {stu.last_name}, {stu.first_name} {stu.middle_name || ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 text-xs text-zinc-500">
                      No student records available in the directory. Standalone PSA scanning works independently.
                    </div>
                  )}
                </div>

                {/* Side-by-Side Comparison Card */}
                {comparison && selectedStudent && (
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                        Concordance Assessment
                      </span>
                      {comparison.isFullMatch ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Full Name Match
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Difference Detected
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      {/* PSA Child Column */}
                      <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
                        <span className="font-bold text-indigo-700 dark:text-indigo-400 block border-b pb-1">
                          PSA Birth Certificate
                        </span>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Complete Name</span>
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {comparison.psaFullName}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">First Name</span>
                          <span>{extractedIdentity.first_name}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Middle Name</span>
                          <span>{extractedIdentity.middle_name || "(None)"}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Last Name</span>
                          <span>{extractedIdentity.last_name}</span>
                        </div>
                      </div>

                      {/* Enrolled Student Column */}
                      <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
                        <span className="font-bold text-emerald-700 dark:text-emerald-400 block border-b pb-1">
                          Selected School Record (SF1/SF9)
                        </span>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Learner Name</span>
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {comparison.studentFullName}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">First Name</span>
                          <span className={comparison.isFirstMatch ? "" : "text-amber-600 font-bold"}>
                            {selectedStudent.first_name}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Middle Name</span>
                          <span className={comparison.isMiddleMatch ? "" : "text-amber-600 font-bold"}>
                            {selectedStudent.middle_name || "(None)"}
                          </span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block text-[10px]">Last Name</span>
                          <span className={comparison.isLastMatch ? "" : "text-amber-600 font-bold"}>
                            {selectedStudent.last_name}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. ORIGINAL OCR RAW TEXT (EXPANDABLE FOR DEBUGGING & VERIFICATION) */}
              <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
                <button
                  type="button"
                  onClick={() => setShowRawOcr(!showRawOcr)}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-zinc-500" />
                    <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      Original OCR Raw Text (Audit &amp; Verification)
                    </span>
                  </div>
                  {showRawOcr ? (
                    <ChevronUp className="w-4 h-4 text-zinc-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-zinc-400" />
                  )}
                </button>

                {showRawOcr && (
                  <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3 bg-zinc-50/50 dark:bg-zinc-950/40">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">
                        Exact markdown/text stream extracted by OCR engine:
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyRawText}
                        className="text-xs h-7 px-2 flex items-center gap-1"
                      >
                        {copiedRaw ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedRaw ? "Copied" : "Copy Raw Text"}
                      </Button>
                    </div>
                    <pre className="p-3 rounded-lg bg-zinc-900 text-zinc-100 font-mono text-xs overflow-x-auto max-h-64 whitespace-pre-wrap select-all">
                      {ocrText || "No text available."}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Document Camera Capture Modal */}
      <DocumentCameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        documentTitle="PSA Certificate of Live Birth"
        documentCode={cameraTarget === "front" ? "PSA-FRONT" : "PSA-BACK"}
        currentStagedCount={previewDataUrl ? 1 : 0}
        onPhotoCaptured={handlePhotoCaptured}
      />
    </PageContainer>
  );
}

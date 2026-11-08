"use client";

import React, { useState, useMemo } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import ImageUploader from "@/components/camera/ImageUploader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useOcr } from "@/hooks/useOcr";
import type { ExtractedFields, GradeRecord } from "@/types/documents";
import { getAuthoritativeSemesterFinalGrade } from "@/lib/validation/gradeUtils";
import {
  compareDocuments,
  type DocumentComparisonSummary,
  type ComparisonStatus,
} from "@/lib/validation/documentComparator";
import {
  mergeSf9FrontAndBack,
  mergeSf10Pages,
  type MergedSf9Result,
} from "@/lib/validation/sf9Merger";
import {
  classifyDocument,
  detectDuplicatePages,
  type DocumentClassificationResult,
} from "@/lib/validation/documentClassifier";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Camera,
  Upload,
  UploadCloud,
  FileCheck2,
  ArrowLeftRight,
  Plus,
  Trash2,
  ShieldCheck,
  FileText,
  Info,
  Layers,
  Sparkles,
} from "lucide-react";
import CameraCaptureView from "@/components/camera/CameraCaptureView";
import { logComparisonEvent } from "@/actions/audit";

interface Sf10PageSlot {
  id: string;
  pageNumber: number;
  image: string | null;
  mode: "upload" | "camera";
  result?: ExtractedFields | null;
  rawText?: string;
  classification?: DocumentClassificationResult | null;
}

export default function ComparePage() {
  // ---------------------------------------------------------------------------
  // State: SF9 Front and Back Uploads
  // ---------------------------------------------------------------------------
  const [sf9FrontImage, setSf9FrontImage] = useState<string | null>(null);
  const [sf9BackImage, setSf9BackImage] = useState<string | null>(null);
  const [sf9FrontMode, setSf9FrontMode] = useState<"upload" | "camera">("upload");
  const [sf9BackMode, setSf9BackMode] = useState<"upload" | "camera">("upload");

  const [sf9FrontResult, setSf9FrontResult] = useState<ExtractedFields | null>(null);
  const [sf9BackResult, setSf9BackResult] = useState<ExtractedFields | null>(null);
  const [sf9FrontText, setSf9FrontText] = useState<string>("");
  const [sf9BackText, setSf9BackText] = useState<string>("");

  const [sf9Merged, setSf9Merged] = useState<MergedSf9Result | null>(null);

  // ---------------------------------------------------------------------------
  // State: SF10 Multi-Page Uploads
  // ---------------------------------------------------------------------------
  const [sf10Pages, setSf10Pages] = useState<Sf10PageSlot[]>([
    { id: "sf10-p1", pageNumber: 1, image: null, mode: "upload" },
  ]);
  const [unifiedSf10, setUnifiedSf10] = useState<ExtractedFields | null>(null);

  // ---------------------------------------------------------------------------
  // State: Optional PSA Birth Certificate
  // ---------------------------------------------------------------------------
  const [psaImage, setPsaImage] = useState<string | null>(null);
  const [psaMode, setPsaMode] = useState<"upload" | "camera">("upload");
  const [psaResult, setPsaResult] = useState<ExtractedFields | null>(null);
  const [showPsaSlot, setShowPsaSlot] = useState(false);

  // ---------------------------------------------------------------------------
  // State: Workflow, Modals & Filters
  // ---------------------------------------------------------------------------
  const [extractionStep, setExtractionStep] = useState<string>("");
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [semesterFilter, setSemesterFilter] = useState<"ALL" | "1ST" | "2ND">("ALL");

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const { extract, isExtracting, error, errorDetails, retryAfter } = useOcr();

  // ---------------------------------------------------------------------------
  // SF9 Front & Back Actions (Swap, Replace, Remove)
  // ---------------------------------------------------------------------------
  const handleSwapSf9Sides = () => {
    const tempImage = sf9FrontImage;
    const tempResult = sf9FrontResult;
    const tempText = sf9FrontText;

    setSf9FrontImage(sf9BackImage);
    setSf9FrontResult(sf9BackResult);
    setSf9FrontText(sf9BackText);

    setSf9BackImage(tempImage);
    setSf9BackResult(tempResult);
    setSf9BackText(tempText);

    if (sf9Merged) {
      // Re-run merge with swapped sides
      const remerged = mergeSf9FrontAndBack(
        { fields: sf9BackResult, rawText: sf9BackText, pageNumber: 1 },
        { fields: tempResult, rawText: tempText, pageNumber: 2 }
      );
      setSf9Merged(remerged);
    }
  };

  const handleSf9FrontSelected = (dataUrl: string) => {
    setSf9FrontImage(dataUrl);
    setSf9FrontResult(null);
    checkDuplicateSf9(dataUrl, sf9BackImage);
  };

  const handleSf9BackSelected = (dataUrl: string) => {
    setSf9BackImage(dataUrl);
    setSf9BackResult(null);
    checkDuplicateSf9(sf9FrontImage, dataUrl);
  };

  const checkDuplicateSf9 = (frontUrl: string | null, backUrl: string | null) => {
    if (frontUrl && backUrl && frontUrl === backUrl) {
      setDuplicateWarning("Duplicate upload detected: SF9 Front and Back contain the identical file.");
    } else {
      setDuplicateWarning(null);
    }
  };

  // ---------------------------------------------------------------------------
  // SF10 Multi-Page Actions
  // ---------------------------------------------------------------------------
  const handleAddSf10Page = () => {
    const nextNum = sf10Pages.length + 1;
    setSf10Pages((prev) => [
      ...prev,
      {
        id: `sf10-p${nextNum}-${Date.now()}`,
        pageNumber: nextNum,
        image: null,
        mode: "upload",
      },
    ]);
  };

  const handleRemoveSf10Page = (index: number) => {
    if (sf10Pages.length <= 1) {
      // Just clear image
      setSf10Pages([{ id: "sf10-p1", pageNumber: 1, image: null, mode: "upload" }]);
      return;
    }
    const updated = sf10Pages
      .filter((_, i) => i !== index)
      .map((p, idx) => ({ ...p, pageNumber: idx + 1 }));
    setSf10Pages(updated);
  };

  const handleSf10ImageSelected = (index: number, dataUrl: string) => {
    setSf10Pages((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], image: dataUrl, result: null, rawText: "" };
      return copy;
    });
  };

  // ---------------------------------------------------------------------------
  // Extraction & Logical Merging Orchestrator
  // ---------------------------------------------------------------------------
  const handleCompare = async () => {
    const hasSf9 = Boolean(sf9FrontImage || sf9BackImage);
    const hasSf10 = sf10Pages.some((p) => Boolean(p.image));

    if (!hasSf9 || !hasSf10 || isExtracting || (retryAfter !== null && retryAfter > 0)) {
      return;
    }

    try {
      // 1. Extract SF9 Front Side
      let fResult = sf9FrontResult;
      let fText = sf9FrontText;
      if (sf9FrontImage && !fResult) {
        setExtractionStep("Extracting SF9 Front Side (Identity & Academic Records)...");
        const resFront = await extract(sf9FrontImage, true, "Senior High School", "sf9");
        fResult = resFront.fields || null;
        fText = resFront.text || "";
        setSf9FrontResult(fResult);
        setSf9FrontText(fText);
      }

      // 2. Extract SF9 Back Side
      let bResult = sf9BackResult;
      let bText = sf9BackText;
      if (sf9BackImage && !bResult) {
        setExtractionStep("Extracting SF9 Back Side (Academic Grades & Attendance)...");
        const resBack = await extract(sf9BackImage, true, "Senior High School", "sf9");
        bResult = resBack.fields || null;
        bText = resBack.text || "";
        setSf9BackResult(bResult);
        setSf9BackText(bText);
      }

      // 3. Logically Merge SF9 Front & Back
      setExtractionStep("Synthesizing SF9 Front & Back into authoritative logical record...");
      const merged = mergeSf9FrontAndBack(
        { fields: fResult, rawText: fText, pageNumber: 1 },
        { fields: bResult, rawText: bText, pageNumber: 2 }
      );
      setSf9Merged(merged);

      // 4. Extract SF10 Multi-Page Record
      const updatedPages = [...sf10Pages];
      for (let i = 0; i < updatedPages.length; i++) {
        const slot = updatedPages[i];
        if (slot.image && !slot.result) {
          setExtractionStep(`Extracting SF10 Permanent Record (Page ${slot.pageNumber} of ${updatedPages.length})...`);
          const res10 = await extract(slot.image, true, "Senior High School", "sf10");
          slot.result = res10.fields || null;
          slot.rawText = res10.text || "";
        }
      }
      setSf10Pages(updatedPages);

      // Consolidate SF10 pages
      const consolidated10 = mergeSf10Pages(
        updatedPages
          .filter((p) => Boolean(p.result))
          .map((p) => ({ fields: p.result, rawText: p.rawText, pageNumber: p.pageNumber }))
      );
      setUnifiedSf10(consolidated10.unifiedFields);

      // 5. Optional PSA Birth Certificate Extraction
      if (psaImage && !psaResult) {
        setExtractionStep("Extracting PSA Certificate of Live Birth...");
        const resPsa = await extract(psaImage, true, "PSA", "birth_cert");
        setPsaResult(resPsa.fields || null);
      }

      setExtractionStep("");
    } catch (err) {
      console.error("[compare] Extraction sequence failed:", err);
      setExtractionStep("");
    }
  };

  // ---------------------------------------------------------------------------
  // Comparison Engine Execution
  // ---------------------------------------------------------------------------
  const effectiveSf9 = sf9Merged?.unifiedFields || sf9FrontResult || sf9BackResult;
  const effectiveSf10 = unifiedSf10 || sf10Pages[0]?.result;

  const comparison: DocumentComparisonSummary | null = useMemo(() => {
    if (!effectiveSf9 && !effectiveSf10) return null;

    return compareDocuments(
      effectiveSf9 || {},
      effectiveSf10 || {},
      psaResult || undefined,
      {
        targetGradeLevel: effectiveSf9?.grade_level || "Grade 11",
        sf9Meta: {
          isTwoSided: Boolean(sf9FrontImage && sf9BackImage),
          hasIdentityConflict: sf9Merged?.hasIdentityConflict,
          identityConflicts: sf9Merged?.identityConflicts,
        },
      }
    );
  }, [effectiveSf9, effectiveSf10, psaResult, sf9Merged, sf9FrontImage, sf9BackImage]);

  // Record audit event for comparison execution
  const loggedComparisonRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!comparison) return;
    const key = `${effectiveSf9?.lrn}_${effectiveSf10?.lrn}_${comparison.overallStatus}`;
    if (loggedComparisonRef.current === key) return;
    loggedComparisonRef.current = key;

    logComparisonEvent({
      isSameLearner: comparison.isSameLearner,
      hasDiscrepancies: comparison.hasDiscrepancies,
      summaryMetrics: comparison.summaryMetrics,
      learnerLrn: effectiveSf9?.lrn || effectiveSf10?.lrn,
      learnerName: effectiveSf9?.name || effectiveSf10?.name,
    }).catch(() => {});
  }, [comparison, effectiveSf9, effectiveSf10]);

  // ---------------------------------------------------------------------------
  // Filtered Academic Results
  // ---------------------------------------------------------------------------
  const filteredAcademicResults = useMemo(() => {
    if (!comparison) return [];
    if (semesterFilter === "ALL") return comparison.academicResults;
    const targetSem = semesterFilter === "1ST" ? "1st semester" : "2nd semester";
    return comparison.academicResults.filter((item) => {
      if (item.subject === "General Average") return true;
      const itemSem = (item.semester || "").toLowerCase().trim();
      return itemSem.includes(targetSem);
    });
  }, [comparison, semesterFilter]);

  // ---------------------------------------------------------------------------
  // Upload to Supabase Action
  // ---------------------------------------------------------------------------
  const handleUploadToSupabase = async () => {
    setIsUploading(true);
    try {
      const imageToUpload = sf10Pages[0]?.image || sf9FrontImage || sf9BackImage;
      let finalImageUrl = imageToUpload || "uploaded-from-compare";
      let originalFilename = "verified_sf9_sf10_record.jpg";

      if (imageToUpload && imageToUpload.startsWith("data:image/")) {
        try {
          const storageRes = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataUrl: imageToUpload,
              filename: `comparison_${Date.now()}.jpg`,
              docType: "sf10",
            }),
          });
          if (storageRes.ok) {
            const storageData = await storageRes.json();
            if (storageData.url) {
              finalImageUrl = storageData.url;
              originalFilename = storageData.originalFilename || originalFilename;
            }
          }
        } catch (storageErr) {
          console.warn("[upload] Storage API fallback:", storageErr);
        }
      }

      const mergedPayload: ExtractedFields = {
        ...effectiveSf10,
        ...effectiveSf9,
        grades: effectiveSf10?.grades?.length ? effectiveSf10.grades : effectiveSf9?.grades || [],
        attendance: effectiveSf9?.attendance || effectiveSf10?.attendance || [],
      };

      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_type: "sf10",
          image_url: finalImageUrl,
          original_filename: originalFilename,
          extracted_text: "Verified via SF9 Front/Back & SF10 Multi-Page Comparison",
          extracted_fields: mergedPayload,
          status: comparison?.hasDiscrepancies ? "needs_review" : "submitted",
        }),
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

  // ---------------------------------------------------------------------------
  // Status Badge Helper
  // ---------------------------------------------------------------------------
  const renderStatusBadge = (status: ComparisonStatus) => {
    switch (status) {
      case "MATCH":
        return (
          <span className="inline-flex items-center text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" /> MATCH
          </span>
        );
      case "MISMATCH":
        return (
          <span className="inline-flex items-center text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 px-2 py-0.5 rounded text-xs font-bold">
            <XCircle className="w-3.5 h-3.5 mr-1 text-rose-500" /> MISMATCH
          </span>
        );
      case "NEEDS_VERIFICATION":
        return (
          <span className="inline-flex items-center text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded text-xs font-bold">
            <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-500" /> NEEDS VERIFICATION
          </span>
        );
      case "MISSING_DATA":
        return (
          <span className="inline-flex items-center text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs font-medium">
            <HelpCircle className="w-3.5 h-3.5 mr-1 text-zinc-400" /> MISSING DATA
          </span>
        );
      case "NOT_APPLICABLE":
      default:
        return (
          <span className="inline-flex items-center text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs font-medium">
            N/A
          </span>
        );
    }
  };

  const hasAnySf9 = Boolean(sf9FrontImage || sf9BackImage);
  const hasAnySf10 = sf10Pages.some((p) => Boolean(p.image));

  return (
    <PageContainer>
      {/* Institutional DepEd Header */}
      <Header
        title="Verify SF9 and SF10"
        description="Cross-check two-sided SF9 Learner Progress Report Card against multi-page SF10 Student Permanent Record under DepEd DO 8, s. 2015."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Upload", href: "/upload" },
          { label: "Verify & Compare" },
        ]}
      />

      {/* School Invariant Badge */}
      <div className="mt-4 flex items-center justify-between flex-wrap gap-2 px-4 py-2 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg text-xs text-slate-700 dark:text-zinc-300">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span className="font-semibold">Taysan Resettlement Integrated School (TRIS)</span>
          <span className="text-zinc-400">•</span>
          <span>DepEd School ID: <strong>300792</strong></span>
        </div>
        <div className="flex items-center gap-2 text-zinc-500">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Azure AI Layout Primary • Strict DepEd DO 8 / DO 55 Isolation</span>
        </div>
      </div>

      {duplicateWarning && (
        <div className="mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm font-medium">{duplicateWarning}</p>
        </div>
      )}

      {/* Document Upload Sections Grid */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* =================================================================== */}
        {/* Panel 1: SF9 Two-Sided Upload (Front & Back)                        */}
        {/* =================================================================== */}
        <Card padding="md" className="flex flex-col gap-4 border-slate-200 dark:border-zinc-800">
          <div className="flex justify-between items-center border-b pb-2">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                Document 1: SF9 Report Card (Two-Sided)
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Front: Learner Identity & 1st Sem • Back: 2nd Sem & Attendance
              </p>
            </div>
            {sf9FrontImage && sf9BackImage && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSwapSf9Sides}
                className="text-xs flex items-center gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
                title="Swap Front and Back sides"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Swap Sides
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Front Side Slot */}
            <div className="p-3 border rounded-lg bg-slate-50/50 dark:bg-zinc-900/50 flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-700 dark:text-zinc-300">
                <span>Front Side (Identity)</span>
                {!sf9FrontImage && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSf9FrontMode("upload")}
                      className={`p-1 rounded ${sf9FrontMode === "upload" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100"}`}
                      title="Upload Front Image"
                    >
                      <Upload className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setSf9FrontMode("camera")}
                      className={`p-1 rounded ${sf9FrontMode === "camera" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100"}`}
                      title="Camera Front"
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {!sf9FrontImage ? (
                sf9FrontMode === "camera" ? (
                  <CameraCaptureView
                    onCapture={(img) => { setSf9FrontImage(img); setSf9FrontMode("upload"); checkDuplicateSf9(img, sf9BackImage); }}
                    onCancel={() => setSf9FrontMode("upload")}
                  />
                ) : (
                  <ImageUploader onImageSelected={handleSf9FrontSelected} />
                )
              ) : (
                <div className="relative group">
                  <img
                    src={sf9FrontImage}
                    alt="SF9 Front"
                    className="w-full h-40 object-contain rounded border bg-black/5"
                  />
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setSf9FrontImage(null); setSf9FrontResult(null); setSf9Merged(null); }}
                      className="bg-rose-600 text-white rounded px-2 py-1 text-xs shadow hover:bg-rose-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Back Side Slot */}
            <div className="p-3 border rounded-lg bg-slate-50/50 dark:bg-zinc-900/50 flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-700 dark:text-zinc-300">
                <span>Back Side (Grades & Attendance)</span>
                {!sf9BackImage && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSf9BackMode("upload")}
                      className={`p-1 rounded ${sf9BackMode === "upload" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100"}`}
                      title="Upload Back Image"
                    >
                      <Upload className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setSf9BackMode("camera")}
                      className={`p-1 rounded ${sf9BackMode === "camera" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-zinc-500 hover:bg-zinc-100"}`}
                      title="Camera Back"
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {!sf9BackImage ? (
                sf9BackMode === "camera" ? (
                  <CameraCaptureView
                    onCapture={(img) => { setSf9BackImage(img); setSf9BackMode("upload"); checkDuplicateSf9(sf9FrontImage, img); }}
                    onCancel={() => setSf9BackMode("upload")}
                  />
                ) : (
                  <ImageUploader onImageSelected={handleSf9BackSelected} />
                )
              ) : (
                <div className="relative group">
                  <img
                    src={sf9BackImage}
                    alt="SF9 Back"
                    className="w-full h-40 object-contain rounded border bg-black/5"
                  />
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setSf9BackImage(null); setSf9BackResult(null); setSf9Merged(null); }}
                      className="bg-rose-600 text-white rounded px-2 py-1 text-xs shadow hover:bg-rose-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Merge Status Indicator */}
          {sf9Merged && (
            <div className={`p-3 rounded-lg text-xs flex items-center justify-between ${
              sf9Merged.hasIdentityConflict
                ? "bg-rose-50 text-rose-800 border border-rose-200"
                : "bg-indigo-50 text-indigo-800 border border-indigo-200"
            }`}>
              <span className="font-medium flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                {sf9Merged.summaryMessage}
              </span>
              <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border">
                {sf9Merged.unifiedFields.grades?.length || 0} subjects synthesized
              </span>
            </div>
          )}
        </Card>

        {/* =================================================================== */}
        {/* Panel 2: SF10 Multi-Page Permanent Record                           */}
        {/* =================================================================== */}
        <Card padding="md" className="flex flex-col gap-4 border-slate-200 dark:border-zinc-800">
          <div className="flex justify-between items-center border-b pb-2">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-600" />
                Document 2: SF10 Permanent Record (Multi-Page)
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Multi-year academic history (Grade 11 & Grade 12 records)
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddSf10Page}
              className="text-xs flex items-center gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300"
            >
              <Plus className="w-3.5 h-3.5" /> Add Page
            </Button>
          </div>

          <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
            {sf10Pages.map((slot, idx) => (
              <div
                key={slot.id}
                className="p-3 border rounded-lg bg-slate-50/50 dark:bg-zinc-900/50 flex flex-col gap-2"
              >
                <div className="flex justify-between items-center text-xs font-semibold text-slate-700 dark:text-zinc-300">
                  <span className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                      Page {slot.pageNumber}
                    </span>
                    {slot.result?.grade_level && (
                      <span className="text-zinc-500 font-normal">({slot.result.grade_level})</span>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    {!slot.image && (
                      <>
                        <button
                          onClick={() => {
                            setSf10Pages((prev) => {
                              const c = [...prev];
                              c[idx] = { ...c[idx], mode: "upload" };
                              return c;
                            });
                          }}
                          className={`p-1 rounded ${slot.mode === "upload" ? "bg-emerald-100 text-emerald-700" : "text-zinc-500 hover:bg-zinc-100"}`}
                          title="Upload Image"
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setSf10Pages((prev) => {
                              const c = [...prev];
                              c[idx] = { ...c[idx], mode: "camera" };
                              return c;
                            });
                          }}
                          className={`p-1 rounded ${slot.mode === "camera" ? "bg-emerald-100 text-emerald-700" : "text-zinc-500 hover:bg-zinc-100"}`}
                          title="Camera"
                        >
                          <Camera className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {sf10Pages.length > 1 && (
                      <button
                        onClick={() => handleRemoveSf10Page(idx)}
                        className="p-1 text-zinc-400 hover:text-rose-600 rounded"
                        title="Remove Page"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {!slot.image ? (
                  slot.mode === "camera" ? (
                    <CameraCaptureView
                      onCapture={(img) => {
                        handleSf10ImageSelected(idx, img);
                        setSf10Pages((prev) => {
                          const c = [...prev];
                          c[idx] = { ...c[idx], mode: "upload" };
                          return c;
                        });
                      }}
                      onCancel={() => {
                        setSf10Pages((prev) => {
                          const c = [...prev];
                          c[idx] = { ...c[idx], mode: "upload" };
                          return c;
                        });
                      }}
                    />
                  ) : (
                    <ImageUploader onImageSelected={(img) => handleSf10ImageSelected(idx, img)} />
                  )
                ) : (
                  <div className="relative group">
                    <img
                      src={slot.image}
                      alt={`SF10 Page ${slot.pageNumber}`}
                      className="w-full h-32 object-contain rounded border bg-black/5"
                    />
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setSf10Pages((prev) => {
                            const c = [...prev];
                            c[idx] = { ...c[idx], image: null, result: null, rawText: "" };
                            return c;
                          });
                          setUnifiedSf10(null);
                        }}
                        className="bg-rose-600 text-white rounded px-2 py-1 text-xs shadow hover:bg-rose-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {unifiedSf10 && (
            <div className="p-3 rounded-lg text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center justify-between">
              <span className="font-medium">
                Unified SF10 permanent record active across {sf10Pages.filter((p) => p.image).length} pages.
              </span>
              <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border">
                {unifiedSf10.grades?.length || 0} subjects recorded
              </span>
            </div>
          )}
        </Card>
      </div>

      {/* =================================================================== */}
      {/* Panel 3: Optional PSA Birth Certificate Slot                        */}
      {/* =================================================================== */}
      {showPsaSlot ? (
        <div className="mt-6">
          <Card padding="md" className="flex flex-col gap-4 border-slate-200 dark:border-zinc-800">
            <div className="flex justify-between items-center border-b pb-2">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-purple-600" />
                  Document 3: PSA Certificate of Live Birth (Optional 3-Way Identity Match)
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Authoritative birth name, birth date, and sex verification anchor
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!psaImage && (
                  <>
                    <button
                      onClick={() => setPsaMode("upload")}
                      className={`p-1 rounded ${psaMode === "upload" ? "bg-purple-100 text-purple-700" : "text-zinc-500 hover:bg-zinc-100"}`}
                      title="Upload PSA"
                    >
                      <Upload className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setPsaMode("camera")}
                      className={`p-1 rounded ${psaMode === "camera" ? "bg-purple-100 text-purple-700" : "text-zinc-500 hover:bg-zinc-100"}`}
                      title="Camera PSA"
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => { setShowPsaSlot(false); setPsaImage(null); setPsaResult(null); }}
                  className="p-1 text-zinc-400 hover:text-rose-600 rounded"
                  title="Close PSA Slot"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            </div>

            {!psaImage ? (
              psaMode === "camera" ? (
                <CameraCaptureView
                  onCapture={(img) => { setPsaImage(img); setPsaMode("upload"); }}
                  onCancel={() => setPsaMode("upload")}
                />
              ) : (
                <ImageUploader onImageSelected={(img) => { setPsaImage(img); setPsaResult(null); }} />
              )
            ) : (
              <div className="relative group max-w-sm mx-auto">
                <img
                  src={psaImage}
                  alt="PSA Birth Certificate"
                  className="w-full h-40 object-contain rounded border bg-black/5"
                />
                <button
                  onClick={() => { setPsaImage(null); setPsaResult(null); }}
                  className="absolute top-2 right-2 bg-rose-600 text-white rounded px-2 py-1 text-xs shadow hover:bg-rose-700 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Remove
                </button>
              </div>
            )}
          </Card>
        </div>
      ) : (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setShowPsaSlot(true)}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 hover:underline inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add PSA / Birth Certificate for 3-Way Identity Verification
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* Verify & Compare Action Button                                      */}
      {/* =================================================================== */}
      <div className="mt-8 flex flex-col items-center gap-2">
        <Button
          onClick={handleCompare}
          disabled={!hasAnySf9 || !hasAnySf10 || isExtracting || (retryAfter !== null && retryAfter > 0)}
          className="w-full max-w-lg py-6 text-base font-bold shadow-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
        >
          {isExtracting ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {extractionStep || "Extracting & Comparing..."}
            </span>
          ) : retryAfter !== null && retryAfter > 0 ? (
            `Provider cooldown active: retry in ${retryAfter}s`
          ) : (
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              Verify SF9 and SF10 Academic Records
            </span>
          )}
        </Button>

        {isExtracting && extractionStep && (
          <p className="text-xs text-zinc-500 animate-pulse">{extractionStep}</p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 max-w-lg mx-auto p-4 rounded-lg border text-sm text-center bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200"
        >
          <p className="font-semibold">{errorDetails?.code || "Extraction Error"}</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {/* =================================================================== */}
      {/* Explainable Comparison Report View                                  */}
      {/* =================================================================== */}
      {comparison && (
        <div className="mt-10 space-y-6">
          {/* Executive Summary Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="p-3 rounded-lg border bg-white dark:bg-zinc-900 shadow-sm flex flex-col justify-between">
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Learner Identity</span>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm font-bold">{renderStatusBadge(comparison.summaryMetrics.identityStatus)}</span>
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-white dark:bg-zinc-900 shadow-sm flex flex-col justify-between">
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide">Subjects Compared</span>
              <div className="mt-2">
                <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">
                  {comparison.summaryMetrics.totalAcademicFieldsCompared}
                </span>
                <span className="text-[10px] text-zinc-400 ml-1">fields</span>
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-white dark:bg-zinc-900 shadow-sm flex flex-col justify-between">
              <span className="text-[11px] font-medium text-emerald-600 uppercase tracking-wide">Matching Grades</span>
              <div className="mt-2">
                <span className="text-xl font-bold font-mono text-emerald-600">
                  {comparison.summaryMetrics.matchingFieldsCount}
                </span>
                <span className="text-[10px] text-zinc-400 ml-1">matches</span>
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-white dark:bg-zinc-900 shadow-sm flex flex-col justify-between">
              <span className="text-[11px] font-medium text-rose-600 uppercase tracking-wide">Discrepancies</span>
              <div className="mt-2">
                <span className="text-xl font-bold font-mono text-rose-600">
                  {comparison.summaryMetrics.discrepanciesCount}
                </span>
                <span className="text-[10px] text-zinc-400 ml-1">flagged</span>
              </div>
            </div>

            <div className="p-3 rounded-lg border bg-white dark:bg-zinc-900 shadow-sm flex flex-col justify-between">
              <span className="text-[11px] font-medium text-amber-600 uppercase tracking-wide">Needs Verification</span>
              <div className="mt-2">
                <span className="text-xl font-bold font-mono text-amber-600">
                  {comparison.summaryMetrics.missingOrUnverifiedCount}
                </span>
                <span className="text-[10px] text-zinc-400 ml-1">pending</span>
              </div>
            </div>
          </div>

          {/* DepEd DO 8 s. 2015 Mandatory Teacher Review Notice Banner */}
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <span className="font-bold block text-sm mb-1 text-amber-950 dark:text-amber-100">
                DepEd Order No. 8, s. 2015 & DO 55, s. 2016 Mandatory Teacher Review Notice
              </span>
              Automated OCR field extraction and multi-page alignment serve exclusively as decision-support aids.
              Before any digital record is certified or submitted for Principal confirmation, the reviewing authorized Teacher
              must physically inspect physical SF9 cards and SF10 permanent records to verify all flagged discrepancies.
            </div>
          </div>

          {/* Overall Status Banner */}
          {!comparison.isSameLearner ? (
            <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm">Learner Identity Mismatch Detected</h4>
                <p className="text-xs mt-1">
                  {comparison.summaryMessage} Academic grade comparison has been blocked to prevent mixing unrelated student records.
                </p>
              </div>
            </div>
          ) : comparison.hasDiscrepancies ? (
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm">Academic Discrepancies Identified</h4>
                <p className="text-xs mt-1">{comparison.summaryMessage}</p>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm">All Verified Identity & Academic Records Match</h4>
                <p className="text-xs mt-1">{comparison.summaryMessage}</p>
              </div>
            </div>
          )}

          {/* =================================================================== */}
          {/* Section 1: Learner Identity Verification Table                      */}
          {/* =================================================================== */}
          <Card padding="lg" className="border-slate-200 dark:border-zinc-800">
            <h3 className="text-base sm:text-lg font-bold mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-indigo-600" />
                Learner Identity Verification
              </span>
              {renderStatusBadge(comparison.summaryMetrics.identityStatus)}
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-slate-50/50 dark:bg-zinc-800/50 text-xs text-zinc-500 uppercase">
                    <th className="py-2.5 px-3 font-semibold">Identity Field</th>
                    <th className="py-2.5 px-3 font-semibold">SF9 (Report Card)</th>
                    <th className="py-2.5 px-3 font-semibold">SF10 (Permanent Record)</th>
                    {showPsaSlot && <th className="py-2.5 px-3 font-semibold">PSA Birth Cert</th>}
                    <th className="py-2.5 px-3 font-semibold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs sm:text-sm">
                  {comparison.identityResults.map((item, idx) => (
                    <tr
                      key={idx}
                      className={item.status === "MISMATCH" ? "bg-rose-50/40 dark:bg-rose-950/20" : ""}
                    >
                      <td className="py-2.5 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                        {item.label}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs">{item.doc1Value ?? "-"}</td>
                      <td className="py-2.5 px-3 font-mono text-xs">{item.doc2Value ?? "-"}</td>
                      {showPsaSlot && <td className="py-2.5 px-3 font-mono text-xs">{item.doc3Value ?? "N/A"}</td>}
                      <td className="py-2.5 px-3 text-right">{renderStatusBadge(item.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* =================================================================== */}
          {/* Section 2: Academic Grades Verification Table                       */}
          {/* =================================================================== */}
          {comparison.academicResults.length > 0 && (
            <Card padding="lg" className="border-slate-200 dark:border-zinc-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-emerald-600" />
                    Academic Records Verification (DepEd Senior High School)
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Field-by-field comparison of quarterly breakdown and authoritative semester final ratings
                  </p>
                </div>

                {/* Semester Filter Tabs */}
                <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg text-xs self-start sm:self-auto">
                  <button
                    onClick={() => setSemesterFilter("ALL")}
                    className={`px-2.5 py-1 rounded font-medium ${
                      semesterFilter === "ALL"
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                    }`}
                  >
                    All ({comparison.academicResults.length})
                  </button>
                  <button
                    onClick={() => setSemesterFilter("1ST")}
                    className={`px-2.5 py-1 rounded font-medium ${
                      semesterFilter === "1ST"
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                    }`}
                  >
                    1st Semester
                  </button>
                  <button
                    onClick={() => setSemesterFilter("2ND")}
                    className={`px-2.5 py-1 rounded font-medium ${
                      semesterFilter === "2ND"
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                    }`}
                  >
                    2nd Semester
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-slate-50/50 dark:bg-zinc-800/50 text-xs text-zinc-500 uppercase">
                      <th className="py-2.5 px-3 font-semibold">Subject Title</th>
                      <th className="py-2.5 px-3 font-semibold">Term / Level</th>
                      <th className="py-2.5 px-3 font-semibold text-center">SF9 Grade</th>
                      <th className="py-2.5 px-3 font-semibold text-center">SF10 Grade</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Verification Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs sm:text-sm">
                    {filteredAcademicResults.map((g, idx) => (
                      <tr
                        key={idx}
                        className={`transition-colors ${
                          g.status === "MISMATCH"
                            ? "bg-rose-50/50 dark:bg-rose-950/20"
                            : g.status === "NEEDS_VERIFICATION"
                            ? "bg-amber-50/30 dark:bg-amber-950/10"
                            : ""
                        }`}
                      >
                        <td className="py-2.5 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                          <span className="block">{g.subject}</span>
                          {/* Quarter breakdown details if available */}
                          {(g.doc1Quarter || g.doc2Quarter) && (
                            <div className="flex gap-2 text-[10px] text-zinc-500 font-mono mt-0.5">
                              {g.doc1Quarter && (
                                <span>
                                  SF9: Q1={g.doc1Quarter.q1 ?? "-"} Q2={g.doc1Quarter.q2 ?? "-"}
                                </span>
                              )}
                              {g.doc2Quarter && (
                                <span>
                                  SF10: Q1={g.doc2Quarter.q1 ?? "-"} Q2={g.doc2Quarter.q2 ?? "-"}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-zinc-500 text-xs">
                          <span className="block font-medium text-zinc-700 dark:text-zinc-300">
                            {g.semester || "-"}
                          </span>
                          {g.gradeLevel && (
                            <span className="text-[10px] text-zinc-400">Grade {g.gradeLevel}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono">
                          <div className="inline-flex flex-col items-center">
                            <span className="font-bold">{g.doc1Grade}</span>
                            {g.doc1SourceSide && (
                              <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-600 uppercase font-sans">
                                {g.doc1SourceSide}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono">
                          <div className="inline-flex flex-col items-center">
                            <span className="font-bold">{g.doc2Grade}</span>
                            {g.doc2SourcePage && (
                              <span className="text-[9px] px-1 rounded bg-emerald-100 text-emerald-700 uppercase font-sans">
                                P{g.doc2SourcePage}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            {renderStatusBadge(g.status)}
                            {g.details && (
                              <span className="text-[10px] text-zinc-500 max-w-[240px] truncate" title={g.details}>
                                {g.details}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* =================================================================== */}
          {/* Action Footer: Stage Verified Record to Supabase                   */}
          {/* =================================================================== */}
          <div className="mt-8 flex justify-center">
            <Button
              onClick={() => setShowUploadModal(true)}
              className="py-6 px-12 text-base font-bold bg-indigo-600 hover:bg-indigo-700 shadow-lg"
              disabled={!comparison.isSameLearner || comparison.hasDiscrepancies}
            >
              <UploadCloud className="w-5 h-5 mr-2" />
              Stage Verified Record to Supabase
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card padding="lg" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-6 relative">
            <button
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-800"
            >
              <XCircle className="w-6 h-6" />
            </button>

            <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
              <UploadCloud className="w-6 h-6 text-indigo-600" />
              Confirm Staging to Supabase
            </h2>

            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              This record will be staged in the documents table under <strong>submitted (needs review)</strong>.
              In compliance with DepEd rules, final student directory enrollment and grade certification require
              authorized review.
            </p>

            <div className="bg-zinc-50 dark:bg-zinc-800 border p-4 rounded-lg space-y-3 text-sm">
              <div>
                <span className="text-xs font-semibold text-zinc-500 uppercase">Learner Name</span>
                <p className="font-semibold text-base text-slate-900 dark:text-white">
                  {effectiveSf9?.name || effectiveSf10?.name || "(Unstated)"}
                </p>
              </div>

              <div>
                <span className="text-xs font-semibold text-zinc-500 uppercase">Learner Reference Number (LRN)</span>
                <p className="font-mono">{effectiveSf9?.lrn || effectiveSf10?.lrn || "(Not Extracted)"}</p>
              </div>

              <div>
                <span className="text-xs font-semibold text-zinc-500 uppercase">Academic Scope</span>
                <p>{effectiveSf9?.grade_level || "Grade 11"} • Taysan Resettlement Integrated School (300792)</p>
              </div>
            </div>

            <div className="flex gap-3 justify-end mt-2">
              <Button variant="outline" onClick={() => setShowUploadModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleUploadToSupabase}
                disabled={isUploading || uploadSuccess}
                className={uploadSuccess ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"}
              >
                {uploadSuccess ? "Staged Successfully!" : isUploading ? "Staging..." : "Confirm & Stage"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}

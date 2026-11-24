"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import PreScanAssignmentGate, {
  type PreScanAssignmentState,
} from "@/components/upload/PreScanAssignmentGate";
import UnifiedBatchResultsView from "@/components/validation/UnifiedBatchResultsView";
import type { BatchValidationReport } from "@/lib/validation/batchCrossDocumentValidator";
import type { DocumentSegment, ShsDocumentType } from "@/lib/validation/batchDocumentSegmenter";
import { DOCUMENT_TITLES } from "@/lib/validation/batchDocumentSegmenter";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Eye,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Layers,
  X,
  Clock,
  Check,
  AlertTriangle,
} from "lucide-react";

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

export default function UnifiedUploadPage() {
  const router = useRouter();

  // Selected files state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<Array<{ name: string; size: string; type: string; dataUrl: string; pageCount: number }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // Processing state
  const [stage, setStage] = useState<UnifiedProcessingStage>("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectedSegments, setDetectedSegments] = useState<DocumentSegment[]>([]);
  const [extractedData, setExtractedData] = useState<Record<string, any>>({});
  const [validationReport, setValidationReport] = useState<BatchValidationReport | null>(null);

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore previously saved batch results on page load after teacher assignment is confirmed
  useEffect(() => {
    if (!assignmentGate.loaded || !assignmentGate.selectedAssignment || stage !== "idle") return;
    const assignment = assignmentGate.selectedAssignment;
    if (assignment.assignment_type !== "class_adviser") return;

    let isMounted = true;
    const fetchSavedBatch = async () => {
      try {
        const res = await fetch(`/api/scan/batch?assignmentId=${encodeURIComponent(assignment.id)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data.hasSavedBatch && data.report) {
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
  }, [assignmentGate.loaded, assignmentGate.selectedAssignment?.id]);

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
        f.name.endsWith(".pdf")
      ) {
        validFiles.push(f);
      }
    }

    if (validFiles.length === 0) {
      alert("Please select a PDF document or image file (JPEG, PNG, WebP).");
      return;
    }

    setSelectedFiles(validFiles);
    setErrorMessage(null);

    // Generate previews
    const previews: Array<{ name: string; size: string; type: string; dataUrl: string; pageCount: number }> = [];
    for (const f of validFiles) {
      const sizeMb = (f.size / (1024 * 1024)).toFixed(2) + " MB";
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(f);
      });
      previews.push({
        name: f.name,
        size: sizeMb,
        type: f.type || "application/pdf",
        dataUrl,
        pageCount: f.type === "application/pdf" ? 1 : 1, // Will be updated by OCR
      });
    }
    setFilePreviews(previews);
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

  // Execute unified scan and cross-validation pipeline across ALL uploaded files
  const handleStartUnifiedScanning = async () => {
    if (!ensureTeacherAssignmentConfirmed()) return;
    if (filePreviews.length === 0) {
      alert("Please upload at least one PDF or image document before scanning.");
      return;
    }

    setStage("uploading");
    setErrorMessage(null);

    try {
      const assignment = assignmentGate.selectedAssignment;
      const allExtractedPages: any[] = [];
      const totalFiles = filePreviews.length;

      // Priority 4: Process EVERY uploaded file via OCR/ICR
      for (let fileIdx = 0; fileIdx < totalFiles; fileIdx++) {
        const currentFile = filePreviews[fileIdx];
        setStatusMessage(
          totalFiles > 1
            ? `Running OCR extraction on file ${fileIdx + 1} of ${totalFiles}: ${currentFile.name}...`
            : "Staging document and sending to Azure Document Intelligence OCR..."
        );

        const ocrRes = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: currentFile.dataUrl,
            teacherAssignmentId: assignment?.id,
            assignmentConfirmed: true,
            selectedSchoolYear: assignment?.school_year || "2024-2025",
            selectedGradeLevel: assignment?.grade_level || "Grade 11",
            selectedSection: assignment?.section || "Diamond",
            extractFields: true,
          }),
        });

        if (!ocrRes.ok) {
          const errJson = await ocrRes.json().catch(() => ({}));
          throw new Error(errJson.error || `OCR processing failed for "${currentFile.name}" with HTTP status ${ocrRes.status}.`);
        }

        const ocrData = await ocrRes.json();
        const rawLayout = ocrData.rawLayout || {};
        const filePages = Array.isArray(rawLayout.pages) && rawLayout.pages.length > 0
          ? rawLayout.pages.map((p: any) => ({
              pageNumber: allExtractedPages.length + (p.pageNumber || 1),
              originalPageNumber: p.pageNumber || 1,
              sourceFileName: currentFile.name,
              sourceFileDataUrl: currentFile.dataUrl,
              text: Array.isArray(p.lines) ? p.lines.map((l: any) => l.content).join("\n") : ocrData.text || "",
              lines: p.lines,
              words: p.words,
              tables: Array.isArray(rawLayout.tables) ? rawLayout.tables.filter((t: any) => t.boundingRegions?.[0]?.pageNumber === p.pageNumber) : [],
            }))
          : [
              {
                pageNumber: allExtractedPages.length + 1,
                originalPageNumber: 1,
                sourceFileName: currentFile.name,
                sourceFileDataUrl: currentFile.dataUrl,
                text: ocrData.text || "",
                lines: [],
                words: [],
                tables: rawLayout.tables || [],
              },
            ];

        allExtractedPages.push(...filePages);
      }

      // Step 2: Document Classification & Boundary Identification on Combined Page Collection
      setStage("classifying");
      setStatusMessage(`Inspecting ${allExtractedPages.length} combined pages and identifying DepEd SHS form boundaries...`);

      const batchRes = await fetch("/api/scan/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "classify_and_validate",
          pages: allExtractedPages,
          files: filePreviews.map((f) => ({
            name: f.name,
            type: f.type,
            dataUrl: f.dataUrl,
            size: f.size,
          })),
          assignmentId: assignment?.id,
          assignmentConfirmed: true,
          schoolYear: assignment?.school_year || "2024-2025",
          gradeLevel: assignment?.grade_level || "Grade 11",
          section: assignment?.section || "Diamond",
        }),
      });

      if (!batchRes.ok) {
        const errJson = await batchRes.json().catch(() => ({}));
        throw new Error(errJson.error || "Batch scanning and cross-validation failed.");
      }

      const batchData = await batchRes.json();
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
      setStatusMessage("Executing cross-document comparators (SF1, SF2, SF5A/B, SF9, SF10, PSA) and saving to database...");
      await new Promise((r) => setTimeout(r, 600));

      // Final step: Completed
      setValidationReport(batchData.report);
      setStage("completed");
      setStatusMessage("Cross-document validation report generated and persisted successfully.");
    } catch (err: any) {
      console.error("[unified-scan] Processing error:", err);
      setStage("error");
      setErrorMessage(err.message || "An unexpected error occurred during processing.");
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
        body: JSON.stringify({
          action: "retry_segment",
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
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to re-extract segment.");
      }
      const data = await res.json();
      setValidationReport(data.report);
      setExtractedData(data.extractedData);
      setDetectedSegments(data.segments || detectedSegments);
      setStatusMessage("Segment retry completed successfully.");
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    }
  };

  const handleStartNewBatch = () => {
    setSelectedFiles([]);
    setFilePreviews([]);
    setDetectedSegments([]);
    setExtractedData({});
    setValidationReport(null);
    setStage("idle");
    setErrorMessage(null);
  };

  return (
    <PageContainer>
      <Header
        title="Unified Document Scanning & Validation"
        description="Centralized document scanning area. Upload a combined multi-page PDF or batch files to automatically identify, extract, and cross-validate DepEd SHS forms."
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

        {/* If validation is complete, render the consolidated report view */}
        {stage === "completed" && validationReport ? (
          <UnifiedBatchResultsView
            report={validationReport}
            onRetrySegment={handleRetrySegment}
            onStartNewBatch={handleStartNewBatch}
            documentImageUrl={filePreviews[0]?.dataUrl}
          />
        ) : (
          <div className="space-y-6">
            {/* Single Unified Upload Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <UploadCloud className="w-5 h-5 text-[#174EA6]" />
                  <span>Combined PDF & Batch Document Upload</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Upload ONE combined multi-page PDF containing multiple forms (SF1, SF2, SF5A/B, SF9, SF10, PSA) or multiple files. The AVV System automatically identifies document boundaries and classifies each form.
                </p>
              </div>

              {/* Drag-and-Drop Area */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all ${
                  isDragOver
                    ? "border-[#174EA6] bg-blue-50/50 dark:bg-blue-950/20"
                    : "border-slate-300 dark:border-slate-700 hover:border-[#174EA6] bg-slate-50/50 dark:bg-slate-900/50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
                />

                <div className="flex flex-col items-center justify-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-blue-100 text-[#174EA6] dark:bg-blue-950/60 dark:text-blue-400 flex items-center justify-center shadow-xs">
                    <UploadCloud className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                      Drag and drop your combined PDF or batch documents here
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Supports multi-page PDF documents and images (up to 15MB)
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 text-xs text-[#174EA6] border-blue-200 dark:border-blue-900 hover:bg-blue-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Browse Files
                  </Button>
                </div>
              </div>

              {/* Uploaded Files Information & Preview */}
              {filePreviews.length > 0 && (
                <div className="space-y-4 pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Uploaded Documents ({filePreviews.length})
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filePreviews.map((file, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-[#174EA6] dark:text-blue-400 flex items-center justify-center shrink-0">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="overflow-hidden">
                            <div className="font-bold text-slate-800 dark:text-slate-200 truncate">
                              {file.name}
                            </div>
                            <div className="text-slate-400 text-[11px] mt-0.5">
                              {file.size} • {file.type.toUpperCase().replace("APPLICATION/", "")}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            Ready
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFiles([]);
                              setFilePreviews([]);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-slate-600"
                            title="Remove file"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Primary Action Button */}
                  <div className="pt-2 flex justify-end">
                    <Button
                      size="lg"
                      onClick={handleStartUnifiedScanning}
                      disabled={stage !== "idle" && stage !== "error"}
                      className="bg-[#174EA6] hover:bg-[#0B1F33] text-white shadow-md font-bold text-sm px-6"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Start Unified Scanning & Validation
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Processing Stepper (Stages 1-7) */}
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
    </PageContainer>
  );
}

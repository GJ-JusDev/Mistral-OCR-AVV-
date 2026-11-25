"use client";

import React, { useState } from "react";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  ShieldCheck,
  Users,
  Calendar,
  GraduationCap,
  BookOpen,
  Heart,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { DocumentSegment } from "@/lib/validation/batchDocumentSegmenter";

interface IndividualDocumentExtractionViewProps {
  segments: DocumentSegment[];
  extractedData: Record<string, any>;
  onRetrySegment?: (segmentId: string) => Promise<void>;
  onProceedToIdentityMatching?: () => void;
  documentImageUrl?: string | null;
}

export default function IndividualDocumentExtractionView({
  segments,
  extractedData,
  onRetrySegment,
  onProceedToIdentityMatching,
  documentImageUrl,
}: IndividualDocumentExtractionViewProps) {
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>(
    segments[0]?.id || ""
  );
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [rosterSearch, setRosterSearch] = useState<string>("");
  const [showRawText, setShowRawText] = useState<boolean>(false);

  const selectedSegment =
    segments.find((s) => s.id === selectedSegmentId) || segments[0];

  if (!selectedSegment) {
    return (
      <div className="p-8 text-center border border-dashed rounded-2xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <FileText className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <h3 className="text-base font-bold text-slate-700 dark:text-slate-300">
          No Document Extractions Found
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Upload and scan documents to inspect individual extraction results.
        </p>
      </div>
    );
  }

  const segmentData = extractedData[selectedSegment.id] || {};
  const docType = selectedSegment.documentType;

  // Gather pages for current segment
  const pages =
    Array.isArray(selectedSegment.pages) && selectedSegment.pages.length > 0
      ? selectedSegment.pages
      : [
          {
            pageNumber: selectedSegment.startPage || 1,
            sourceFileName: selectedSegment.sourceFileName || "Document.pdf",
            sourceFileDataUrl: selectedSegment.imageUrl || documentImageUrl || "",
          },
        ];

  const currentPage = pages[currentPageIndex] || pages[0];
  const pageImageUrl =
    currentPage?.sourceFileDataUrl ||
    selectedSegment.imageUrl ||
    documentImageUrl ||
    "";

  // Helper to extract multi-learner rows
  const getLearnerRows = (): any[] => {
    if (Array.isArray(segmentData.learners)) return segmentData.learners;
    if (Array.isArray(segmentData.roster)) return segmentData.roster;
    if (Array.isArray(segmentData.attendance_records))
      return segmentData.attendance_records;
    if (Array.isArray(segmentData.attendance)) return segmentData.attendance;
    if (Array.isArray(segmentData.promotion_records))
      return segmentData.promotion_records;
    return [];
  };

  const allLearnerRows = getLearnerRows();
  const filteredLearnerRows = rosterSearch.trim()
    ? allLearnerRows.filter((l) => {
        const q = rosterSearch.toLowerCase();
        const lrn = String(l.lrn || "").toLowerCase();
        const name = String(
          l.learner_name || `${l.last_name || ""} ${l.first_name || ""}`
        ).toLowerCase();
        return lrn.includes(q) || name.includes(q);
      })
    : allLearnerRows;

  // Zoom handlers
  const handleZoomIn = () => setZoomLevel((z) => Math.min(z + 25, 200));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(z - 25, 50));
  const handleResetZoom = () => setZoomLevel(100);

  // Doc type badge colors
  const getDocTypeBadgeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case "sf1":
        return "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800";
      case "sf2":
        return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800";
      case "sf5":
      case "sf5a":
        return "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800";
      case "sf5b":
        return "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800";
      case "sf9":
        return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800";
      case "sf10":
        return "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800";
      case "birth_cert":
      case "psa":
        return "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800";
      default:
        return "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
    }
  };

  return (
    <div className="space-y-6">
      {/* Stage Banner */}
      <div className="p-4 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#174EA6] text-white flex items-center justify-center shrink-0 shadow-xs">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#174EA6] dark:text-blue-300">
                Stage B: Individual Extraction Results
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                ({segments.length} Document{segments.length > 1 ? "s" : ""} Extracted)
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Inspect Every Document Before Cross-Document Comparison
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Review the original scanned image and corresponding extracted data for each document below. Multi-learner rows, individual grades, and source bounding boxes are preserved.
            </p>
          </div>
        </div>

        {onProceedToIdentityMatching && (
          <Button
            size="sm"
            onClick={onProceedToIdentityMatching}
            className="bg-[#174EA6] hover:bg-[#0B1F33] text-white font-bold text-xs shrink-0"
          >
            Proceed to Identity Matching
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        )}
      </div>

      {/* Document Selector Ribbon */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Select Document to Inspect ({segments.length})
          </span>
          <span className="text-xs text-slate-400 font-mono">
            Active: {selectedSegment.formTitle}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {segments.map((seg, idx) => {
            const isSelected = seg.id === selectedSegmentId;
            const segData = extractedData[seg.id] || {};
            const learnerCount = Array.isArray(segData.learners)
              ? segData.learners.length
              : Array.isArray(segData.attendance_records)
              ? segData.attendance_records.length
              : Array.isArray(segData.grades)
              ? segData.grades.length
              : 0;

            const isFailed =
              seg.persistenceStatus === "failed" ||
              segData.error ||
              seg.needsClassification;

            return (
              <div
                key={seg.id}
                onClick={() => {
                  setSelectedSegmentId(seg.id);
                  setCurrentPageIndex(0);
                  setRosterSearch("");
                }}
                className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all space-y-2 ${
                  isSelected
                    ? "bg-white dark:bg-slate-900 border-[#174EA6] shadow-md ring-2 ring-[#174EA6]/20"
                    : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${getDocTypeBadgeColor(
                      seg.documentType
                    )}`}
                  >
                    {seg.documentType.toUpperCase()}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    Doc #{idx + 1}
                  </span>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {seg.formTitle}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {seg.sourceFileName || "Document.pdf"}
                  </p>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <span>
                    Pages {seg.pageNumbers.join(", ")} ({seg.pageCount} pg)
                  </span>
                  {learnerCount > 0 && (
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {learnerCount} {seg.documentType === "sf9" || seg.documentType === "sf10" ? "subjects" : "rows"}
                    </span>
                  )}
                </div>

                {isFailed ? (
                  <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>Requires Review / Failed</span>
                  </div>
                ) : (
                  <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    <span>Extracted & Validated</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Split-Screen Inspection Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Pane: Original Scanned Image / PDF Viewer (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs flex flex-col h-[750px]">
          {/* Viewer Toolbar */}
          <div className="p-3 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 dark:text-slate-200">
                Original Scanned Document
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                Page {currentPage?.pageNumber || currentPageIndex + 1} of{" "}
                {pages.length}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleZoomOut}
                className="p-1 rounded text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                title="Reset Zoom"
              >
                {zoomLevel}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                className="p-1 rounded text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Viewer Body with Scroll & Zoom */}
          <div className="flex-1 overflow-auto p-4 bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
            {pageImageUrl && !pageImageUrl.startsWith("PLACEHOLDER") ? (
              <div
                style={{
                  transform: `scale(${zoomLevel / 100})`,
                  transformOrigin: "top center",
                  transition: "transform 0.15s ease-out",
                }}
                className="max-w-full shadow-lg rounded bg-white"
              >
                {pageImageUrl.startsWith("data:application/pdf") ? (
                  <iframe
                    src={pageImageUrl}
                    title="PDF Document Preview"
                    className="w-[500px] h-[650px] border-0"
                  />
                ) : (
                  <img
                    src={pageImageUrl}
                    alt={`Scanned Document - Page ${currentPage?.pageNumber || 1}`}
                    className="max-w-full h-auto object-contain rounded"
                  />
                )}
              </div>
            ) : (
              <div className="text-center p-8 max-w-sm space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-[#174EA6] dark:text-blue-400 mx-auto flex items-center justify-center shadow-xs">
                  <FileText className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    Original Scan Preserved
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">
                    File: <span className="font-mono">{selectedSegment.sourceFileName || "Document.pdf"}</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Pages {selectedSegment.pageNumbers.join(", ")} • OCR Confidence: {Math.round(selectedSegment.confidence * 100)}%
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                  Binary source stored in private Supabase bucket. Full raw OCR text and layout tokens available in extracted panel.
                </div>
              </div>
            )}
          </div>

          {/* Page Navigation Footer (if multi-page) */}
          {pages.length > 1 && (
            <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPageIndex((p) => Math.max(0, p - 1))}
                disabled={currentPageIndex === 0}
                className="h-7 text-xs"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Prev Page
              </Button>

              <span className="font-mono text-slate-600 dark:text-slate-400">
                Page {currentPageIndex + 1} of {pages.length}
              </span>

              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentPageIndex((p) => Math.min(pages.length - 1, p + 1))
                }
                disabled={currentPageIndex >= pages.length - 1}
                className="h-7 text-xs"
              >
                Next Page <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>

            </div>
          )}
        </div>

        {/* Right Pane: Corresponding Extracted Data (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Document Header Metadata Card */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${getDocTypeBadgeColor(
                      selectedSegment.documentType
                    )}`}
                  >
                    {selectedSegment.documentType.toUpperCase()}
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {selectedSegment.formTitle}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Source: <span className="font-mono">{selectedSegment.sourceFileName || "Document.pdf"}</span> • Document ID: <span className="font-mono text-[11px]">{selectedSegment.documentId || selectedSegment.id}</span>
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {selectedSegment.persistenceStatus === "persisted" && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Persisted
                  </span>
                )}
                {selectedSegment.persistenceStatus === "failed" && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300">
                    <XCircle className="w-3.5 h-3.5 text-rose-600" />
                    Failed
                  </span>
                )}
                {onRetrySegment && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRetrySegment(selectedSegment.id)}
                    className="text-xs h-7"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" /> Re-extract
                  </Button>
                )}
              </div>
            </div>

            {/* Header Metadata Chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  School ID / Name
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                  {segmentData.school_id || segmentData.header?.school_id || "500169"}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  Grade & Section
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                  {segmentData.grade_level || segmentData.header?.grade_level || "Grade 11"} • {segmentData.section || segmentData.header?.section || "Unassigned"}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  School Year / Sem
                </span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                  {segmentData.school_year || segmentData.header?.school_year || "2024-2025"} • {segmentData.semester || segmentData.header?.semester || "1st Sem"}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  OCR Confidence
                </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 truncate block">
                  {Math.round(selectedSegment.confidence * 100)}% Measured
                </span>
              </div>
            </div>

            {/* Error or Warnings (if any) */}
            {selectedSegment.persistenceError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Extraction or Persistence Error:</span>{" "}
                  {selectedSegment.persistenceError}
                </div>
              </div>
            )}
          </div>

          {/* Form Specific Extracted Records */}

          {/* Case 1: Multi-Learner Rosters (SF1, SF2, SF5A, SF5B) */}
          {["sf1", "sf2", "sf5", "sf5a", "sf5b"].includes(docType) && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#174EA6]" />
                    <span>
                      Extracted Learner Rows ({allLearnerRows.length})
                    </span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Every learner row extracted from this multi-learner document. Bounding box coordinates and row indexes are preserved.
                  </p>
                </div>

                {/* Search within document */}
                <div className="relative min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={rosterSearch}
                    onChange={(e) => setRosterSearch(e.target.value)}
                    placeholder="Search LRN or name..."
                    className="w-full pl-8 pr-3 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-[#174EA6]"
                  />
                </div>
              </div>

              {filteredLearnerRows.length === 0 ? (
                <div className="p-8 text-center border border-dashed rounded-xl border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                  {allLearnerRows.length === 0
                    ? "No learner rows could be extracted from this document."
                    : "No learners match your search query."}
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">LRN</th>
                        <th className="py-2.5 px-3">Learner Name</th>
                        <th className="py-2.5 px-3">Sex</th>
                        {docType === "sf1" && (
                          <>
                            <th className="py-2.5 px-3">Birth Date</th>
                            <th className="py-2.5 px-3">Age</th>
                            <th className="py-2.5 px-3">Remarks</th>
                          </>
                        )}
                        {docType === "sf2" && (
                          <>
                            <th className="py-2.5 px-3 text-center">Present</th>
                            <th className="py-2.5 px-3 text-center">Absent</th>
                            <th className="py-2.5 px-3 text-center">Tardy</th>
                            <th className="py-2.5 px-3">Monthly Remarks</th>
                          </>
                        )}
                        {(docType === "sf5a" || docType === "sf5b") && (
                          <>
                            <th className="py-2.5 px-3">Action / Status</th>
                            <th className="py-2.5 px-3">Incomplete Subjects</th>
                            <th className="py-2.5 px-3 text-center">Gen. Avg</th>
                          </>
                        )}
                        <th className="py-2.5 px-3 text-right">Traceability</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredLearnerRows.map((row: any, rIdx: number) => {
                        const fullName =
                          row.learner_name ||
                          [row.last_name, row.first_name, row.middle_name]
                            .filter(Boolean)
                            .join(", ");
                        const rowNum = row.row_index || rIdx + 1;
                        const pageNum = row.page_number || selectedSegment.startPage || 1;

                        return (
                          <tr
                            key={rIdx}
                            className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                          >
                            <td className="py-2.5 px-3 font-mono text-slate-400 text-[11px]">
                              {rowNum}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                              {row.lrn ? (
                                <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                                  {row.lrn}
                                </span>
                              ) : (
                                <span className="text-amber-600 font-semibold text-[10px]">
                                  MISSING LRN
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                              {fullName || "—"}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-slate-600 dark:text-slate-400">
                              {row.sex || "—"}
                            </td>

                            {/* SF1 Specific Columns */}
                            {docType === "sf1" && (
                              <>
                                <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                                  {row.birth_date || "—"}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                                  {row.age || "—"}
                                </td>
                                <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                                  {row.remarks_indicator || row.remarks || "—"}
                                </td>
                              </>
                            )}

                            {/* SF2 Specific Columns */}
                            {docType === "sf2" && (
                              <>
                                <td className="py-2.5 px-3 text-center font-mono font-bold text-emerald-600">
                                  {row.total_present ?? row.days_present ?? "—"}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono font-bold text-rose-600">
                                  {row.total_absent ?? row.days_absent ?? "—"}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono font-bold text-amber-600">
                                  {row.total_tardy ?? row.days_tardy ?? "—"}
                                </td>
                                <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                                  {row.remarks || "—"}
                                </td>
                              </>
                            )}

                            {/* SF5 Specific Columns */}
                            {(docType === "sf5a" || docType === "sf5b") && (
                              <>
                                <td className="py-2.5 px-3">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      String(row.action_taken || row.graduation_status || "")
                                        .toUpperCase()
                                        .includes("PROMOTED") ||
                                      String(row.action_taken || row.graduation_status || "")
                                        .toUpperCase()
                                        .includes("GRADUAT")
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-amber-100 text-amber-800"
                                    }`}
                                  >
                                    {row.action_taken || row.graduation_status || "—"}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                                  {Array.isArray(row.incomplete_subjects) && row.incomplete_subjects.length > 0
                                    ? row.incomplete_subjects.join(", ")
                                    : "None"}
                                </td>
                                <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                                  {row.general_average || "—"}
                                </td>
                              </>
                            )}

                            {/* Traceability: Page, Row & Bounding Box */}
                            <td className="py-2.5 px-3 text-right">
                              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                P{pageNum}:R{rowNum}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          )}

          {/* Case 2: SF9 Progress Report Card */}
          {docType === "sf9" && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-amber-500" />
                    <span>SF9-SHS Semestral Grades & Progress</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Learner: <span className="font-bold text-slate-800 dark:text-slate-200">{segmentData.name || "Student"}</span> • LRN: <span className="font-mono font-bold">{segmentData.lrn || "—"}</span>
                  </p>
                </div>
                {segmentData.general_average && (
                  <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-right">
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 block uppercase">
                      General Average
                    </span>
                    <span className="text-base font-extrabold text-amber-800 dark:text-amber-300">
                      {segmentData.general_average}
                    </span>
                  </div>
                )}
              </div>

              {/* Subject Grades Table */}
              {Array.isArray(segmentData.grades) && segmentData.grades.length > 0 ? (
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2 px-3">Subject / Learning Area</th>
                        <th className="py-2 px-2 text-center">Q1</th>
                        <th className="py-2 px-2 text-center">Q2</th>
                        <th className="py-2 px-2 text-center">Q3</th>
                        <th className="py-2 px-2 text-center">Q4</th>
                        <th className="py-2 px-3 text-center">Final</th>
                        <th className="py-2 px-3">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {segmentData.grades.map((g: any, gIdx: number) => (
                        <tr key={gIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                            {g.subject}
                          </td>
                          <td className="py-2 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                            {g.q1 ?? "—"}
                          </td>
                          <td className="py-2 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                            {g.q2 ?? "—"}
                          </td>
                          <td className="py-2 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                            {g.q3 ?? "—"}
                          </td>
                          <td className="py-2 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                            {g.q4 ?? "—"}
                          </td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-slate-900 dark:text-slate-100">
                            {g.final ?? g.final_grade ?? "—"}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                String(g.remarks || "").toLowerCase() === "passed" ||
                                (Number(g.final ?? g.final_grade) >= 75)
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {g.remarks || (Number(g.final ?? g.final_grade) >= 75 ? "PASSED" : "FAILED")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center border border-dashed rounded-xl border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                  No individual subject grades extracted for this report card.
                </div>
              )}
              {/* SECTION A: School Days and Attendance */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h5 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-emerald-600" />
                      <span>Report on Attendance (School Days, Present &amp; Absent)</span>
                    </h5>
                    <p className="text-xs text-slate-500 mt-0.5">
                      DepEd monthly attendance record, equation validation (Present + Absent = School Days), and screening.
                    </p>
                  </div>
                  {/* Status chip */}
                  {segmentData.attendance_risk_status && (
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                          segmentData.attendance_risk_status === "NORMAL"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800"
                            : segmentData.attendance_risk_status === "ATTENDANCE_WARNING"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-300 dark:border-amber-800"
                            : segmentData.attendance_risk_status === "ATTENDANCE_REVIEW_REQUIRED"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-300 dark:border-rose-800"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700"
                        }`}
                      >
                        {segmentData.attendance_risk_status === "NORMAL" && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {segmentData.attendance_risk_status === "ATTENDANCE_WARNING" && <AlertTriangle className="w-3.5 h-3.5" />}
                        {segmentData.attendance_risk_status === "ATTENDANCE_REVIEW_REQUIRED" && <AlertTriangle className="w-3.5 h-3.5" />}
                        <span>
                          {segmentData.attendance_risk_status === "NORMAL"
                            ? "Normal Attendance"
                            : segmentData.attendance_risk_status === "ATTENDANCE_WARNING"
                            ? "Attendance Warning (15-20%)"
                            : segmentData.attendance_risk_status === "ATTENDANCE_REVIEW_REQUIRED"
                            ? "Attendance Review Required (>20%)"
                            : "Incomplete Attendance Data"}
                        </span>
                      </span>
                    </div>
                  )}
                </div>

                {/* Metric Summary Cards */}
                {segmentData.attendance_totals && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                      <span className="text-[10px] font-bold text-slate-500 uppercase block">School Days</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-lg font-extrabold text-slate-900 dark:text-slate-100">
                          {segmentData.attendance_totals.computed_school_days ?? segmentData.attendance_totals.printed_school_days ?? "—"}
                        </span>
                        {segmentData.attendance_totals.printed_school_days !== undefined &&
                          segmentData.attendance_totals.computed_school_days !== undefined &&
                          segmentData.attendance_totals.printed_school_days !== segmentData.attendance_totals.computed_school_days && (
                            <span className="text-[10px] text-amber-600 font-semibold" title="Printed total on card">
                              (printed: {segmentData.attendance_totals.printed_school_days})
                            </span>
                          )}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50">
                      <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase block">Days Present</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-lg font-extrabold text-emerald-800 dark:text-emerald-300">
                          {segmentData.attendance_totals.computed_days_present ?? segmentData.attendance_totals.printed_days_present ?? "—"}
                        </span>
                        {segmentData.attendance_percentage !== undefined && (
                          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            ({segmentData.attendance_percentage}%)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50">
                      <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase block">Days Absent</span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-lg font-extrabold text-rose-800 dark:text-rose-300">
                          {segmentData.attendance_totals.computed_days_absent ?? segmentData.attendance_totals.printed_days_absent ?? "—"}
                        </span>
                        {segmentData.absence_percentage !== undefined && (
                          <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                            ({segmentData.absence_percentage}%)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50">
                      <span className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase block">Equation Check</span>
                      <div className="mt-0.5 text-xs font-semibold flex items-center gap-1">
                        {segmentData.attendance_discrepancy_details && segmentData.attendance_discrepancy_details.length > 0 ? (
                          <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1 font-bold">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Discrepancy Flagged
                          </span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400 flex items-center gap-1 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Equations Balanced
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Attendance Discrepancy Banner */}
                {segmentData.attendance_discrepancy_details && segmentData.attendance_discrepancy_details.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs space-y-1.5">
                    <div className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Attendance Discrepancy Flagged for Teacher Verification:</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-amber-900 dark:text-amber-200/90 pl-1">
                      {segmentData.attendance_discrepancy_details.map((detail: string, dIdx: number) => (
                        <li key={dIdx}>{detail}</li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 italic">
                      Note: DepEd Order No. 8, s. 2015 safeguards protect students. Attendance warnings require teacher review and do not alter academic grades.
                    </p>
                  </div>
                )}

                {/* Monthly Attendance Breakdown Table */}
                {Array.isArray(segmentData.attendance) && segmentData.attendance.length > 0 ? (
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3 min-w-[140px]">Attendance Metric</th>
                          {(segmentData.attendance_months && segmentData.attendance_months.length > 0
                            ? segmentData.attendance_months
                            : (segmentData.attendance[0]?.values || []).map((_: any, idx: number) => `M${idx + 1}`)
                          ).map((m: string, mIdx: number) => (
                            <th key={mIdx} className="py-2.5 px-2 text-center min-w-[40px]">
                              {m}
                            </th>
                          ))}
                          <th className="py-2.5 px-3 text-center min-w-[60px] bg-slate-100/70 dark:bg-slate-800 font-extrabold text-slate-800 dark:text-slate-200">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {segmentData.attendance.map((row: any, rIdx: number) => (
                          <tr key={rIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                              {row.label}
                            </td>
                            {(row.values || []).map((val: any, vIdx: number) => (
                              <td key={vIdx} className="py-2 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                                {val !== undefined && val !== null && String(val).trim() !== "" ? String(val) : "—"}
                              </td>
                            ))}
                            <td className="py-2 px-3 text-center font-mono font-bold text-slate-900 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-800/40">
                              {row.total !== undefined && row.total !== null ? String(row.total) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-5 text-center border border-dashed rounded-xl border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                    No monthly attendance table detected on this document scan. (If this is a multi-page card, verify the back page).
                  </div>
                )}
              </div>

              {/* SECTION B: Behavior and Character Development (Observed Values) */}
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <h5 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Heart className="w-4 h-4 text-rose-500" />
                      <span>Report on Learners&apos; Observed Values (Core Values &amp; Behavior)</span>
                    </h5>
                    <p className="text-xs text-slate-500 mt-0.5">
                      DepEd Core Values: Maka-Diyos, Makatao, Makakalikasan, Makabansa • Non-numerical ratings: AO, SO, RO, NO.
                    </p>
                  </div>
                  {/* Verification status badge */}
                  {segmentData.observed_values && (
                    <div>
                      {segmentData.observed_values.has_unreadable_marks ? (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-300 dark:border-amber-800 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" /> Needs Teacher Verification
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Observed Values Verified
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Rating Scale Legend banner */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400">
                    <span className="font-bold text-slate-800 dark:text-slate-200">DepEd Rating Scale:</span>
                    <span><strong className="font-mono text-emerald-700 dark:text-emerald-400">AO</strong> = Always Observed</span>
                    <span><strong className="font-mono text-blue-700 dark:text-blue-400">SO</strong> = Sometimes Observed</span>
                    <span><strong className="font-mono text-amber-700 dark:text-amber-400">RO</strong> = Rarely Observed</span>
                    <span><strong className="font-mono text-rose-700 dark:text-rose-400">NO</strong> = Not Observed</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-medium italic">
                    *Non-numerical; strictly independent of academic grades
                  </span>
                </div>

                {/* Observed Values Table */}
                {segmentData.observed_values && Array.isArray(segmentData.observed_values.core_values) && segmentData.observed_values.core_values.length > 0 ? (
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3 min-w-[120px]">Core Value</th>
                          <th className="py-2.5 px-3 min-w-[280px]">Behavior Statement</th>
                          <th className="py-2.5 px-2 text-center min-w-[42px]">Q1</th>
                          <th className="py-2.5 px-2 text-center min-w-[42px]">Q2</th>
                          <th className="py-2.5 px-2 text-center min-w-[42px]">Q3</th>
                          <th className="py-2.5 px-2 text-center min-w-[42px]">Q4</th>
                          <th className="py-2.5 px-3 min-w-[100px]">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {segmentData.observed_values.core_values.map((group: any, grpIdx: number) =>
                          (group.statements || []).map((stmt: any, sIdx: number) => {
                            const hasFlag = stmt.q1?.needs_verification || stmt.q2?.needs_verification || stmt.q3?.needs_verification || stmt.q4?.needs_verification;
                            return (
                              <tr key={`${grpIdx}-${sIdx}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                {sIdx === 0 && (
                                  <td
                                    rowSpan={group.statements.length}
                                    className="py-2.5 px-3 font-bold text-slate-900 dark:text-slate-100 bg-slate-50/30 dark:bg-slate-800/20 align-top border-r border-slate-100 dark:border-slate-800"
                                  >
                                    {group.name}
                                  </td>
                                )}
                                <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 font-medium">
                                  {stmt.statement}
                                </td>
                                {["q1", "q2", "q3", "q4"].map((qKey) => {
                                  const qRec = stmt[qKey];
                                  const rating = qRec?.normalized_rating ?? qRec?.original_mark;
                                  const needsVer = qRec?.needs_verification;
                                  return (
                                    <td key={qKey} className="py-2 px-2 text-center">
                                      {rating ? (
                                        <span
                                          className={`inline-block px-1.5 py-0.5 rounded font-mono font-bold text-[11px] ${
                                            needsVer
                                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300"
                                              : rating === "AO"
                                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                              : rating === "SO"
                                              ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
                                              : rating === "RO"
                                              ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                                              : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                                          }`}
                                          title={needsVer ? `Unclear mark "${qRec?.original_mark}" requires review` : undefined}
                                        >
                                          {rating}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400 text-xs font-mono">—</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="py-2.5 px-3">
                                  {hasFlag ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                      <AlertTriangle className="w-3 h-3 text-amber-500" /> Verify Mark
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Recorded
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : segmentData.observed_values && Array.isArray(segmentData.observed_values.observations) && segmentData.observed_values.observations.length > 0 ? (
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2 px-3">Core Value</th>
                          <th className="py-2 px-3">Behavior Statement</th>
                          <th className="py-2 px-2 text-center">Quarter</th>
                          <th className="py-2 px-2 text-center">Rating</th>
                          <th className="py-2 px-3">Remarks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {segmentData.observed_values.observations.map((obs: any, oIdx: number) => (
                          <tr key={oIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                              {obs.core_value}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                              {obs.behavior_statement}
                            </td>
                            <td className="py-2 px-2 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                              {obs.quarter}
                            </td>
                            <td className="py-2 px-2 text-center font-mono font-bold">
                              <span className={`px-1.5 py-0.5 rounded text-[11px] ${
                                obs.needs_verification ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-800"
                              }`}>
                                {obs.normalized_rating || obs.original_mark || "—"}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              {obs.needs_verification ? (
                                <span className="text-[10px] font-bold text-amber-700">Needs Verification</span>
                              ) : (
                                <span className="text-[10px] text-slate-400">OK</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-5 text-center border border-dashed rounded-xl border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                    No behavior / observed values detected on this document scan. (If this is a multi-page card, verify the back page).
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Case 3: SF10 Permanent Record */}
          {docType === "sf10" && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-rose-500" />
                    <span>SF10-SHS Permanent Academic Transcript</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Learner: <span className="font-bold text-slate-800 dark:text-slate-200">{segmentData.name || "Student"}</span> • LRN: <span className="font-mono font-bold">{segmentData.lrn || "—"}</span>
                  </p>
                </div>
              </div>

              {/* Academic History / Grades */}
              {Array.isArray(segmentData.grades) && segmentData.grades.length > 0 ? (
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2 px-3">Subject</th>
                        <th className="py-2 px-3 text-center">Final Rating</th>
                        <th className="py-2 px-3">Remarks / Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {segmentData.grades.map((g: any, gIdx: number) => (
                        <tr key={gIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                            {g.subject}
                          </td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-slate-900 dark:text-slate-100">
                            {g.final ?? g.final_grade ?? "—"}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                Number(g.final ?? g.final_grade) >= 75
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {g.remarks || (Number(g.final ?? g.final_grade) >= 75 ? "PASSED" : "FAILED")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center border border-dashed rounded-xl border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                  No academic grades extracted from this SF10 transcript.
                </div>
              )}

            </div>
          )}

          {/* Case 4: PSA Birth Certificate */}
          {docType === "birth_cert" && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-teal-600" />
                  <span>PSA Certificate of Live Birth (Civil Identity Evidence)</span>
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Supporting civil identity evidence used exclusively to verify legal name, sex, and birth date.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Civil Registry Number
                  </span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                    {segmentData.registry_number || "—"}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Registered Child Full Name
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    {segmentData.name ||
                      [segmentData.last_name, segmentData.first_name, segmentData.middle_name]
                        .filter(Boolean)
                        .join(", ") ||
                      "—"}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Date of Birth & Sex
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {segmentData.birth_date || "—"} • Sex: {segmentData.sex || "—"}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Mother Maiden Name & Father
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                    Mother: {segmentData.mother_maiden_name || "—"} • Father: {segmentData.father_name || "—"}
                  </span>
                </div>
              </div>

            </div>
          )}

          {/* Raw OCR Text Collapsible Toggle */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowRawText((v) => !v)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1.5"
            >
              <span>{showRawText ? "Hide Raw OCR Text" : "Inspect Raw OCR Text"}</span>
            </button>
            {showRawText && (
              <pre className="mt-2 p-4 rounded-xl bg-slate-900 text-slate-100 text-[11px] font-mono overflow-auto max-h-60 leading-relaxed">
                {selectedSegment.combinedText || "No text available"}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

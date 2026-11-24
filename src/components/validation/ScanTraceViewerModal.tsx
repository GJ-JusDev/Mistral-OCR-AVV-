"use client";

import React, { useState } from "react";
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  FileText,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { BatchDiscrepancyItem } from "@/lib/validation/batchCrossDocumentValidator";

interface ScanTraceViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  discrepancy?: BatchDiscrepancyItem | null;
  documentTitle?: string;
  pageNumber?: number;
  totalPages?: number;
  imageUrl?: string | null;
  fileName?: string | null;
  source2ImageUrl?: string | null;
  source2FileName?: string | null;
  extractedFields?: Record<string, any> | null;
}

export default function ScanTraceViewerModal({
  isOpen,
  onClose,
  discrepancy,
  documentTitle = "Original Document Scan",
  pageNumber = 1,
  totalPages = 1,
  imageUrl,
  fileName,
  source2ImageUrl,
  source2FileName,
  extractedFields,
}: ScanTraceViewerModalProps) {
  const [zoom, setZoom] = useState<number>(100);
  const [activeSource, setActiveSource] = useState<"source1" | "source2">("source1");
  const [currentPage, setCurrentPage] = useState<number>(pageNumber || 1);

  if (!isOpen) return null;

  // Determine effective display image and filename based on activeSource
  const effectiveImageUrl =
    activeSource === "source1"
      ? discrepancy?.source1DataUrl || imageUrl
      : discrepancy?.source2DataUrl || source2ImageUrl || imageUrl;

  const effectiveFileName =
    activeSource === "source1"
      ? discrepancy?.source1FileName || fileName || "Document Scan"
      : discrepancy?.source2FileName || source2FileName || "Comparison Document";

  const effectiveDocTitle =
    activeSource === "source1"
      ? discrepancy?.source1Doc || documentTitle
      : discrepancy?.source2Doc || "Comparison Document";

  const effectivePageNumber =
    activeSource === "source1"
      ? discrepancy?.source1Page || pageNumber || 1
      : discrepancy?.source2Page || 1;

  const handleZoomIn = () => setZoom((z) => Math.min(z + 25, 200));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 25, 50));
  const handleResetZoom = () => setZoom(100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl h-[90vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#174EA6]/10 text-[#174EA6] dark:bg-[#174EA6]/20">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>{effectiveDocTitle}</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  Page {effectivePageNumber}
                </span>
                {effectiveFileName && (
                  <span className="text-xs font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                    {effectiveFileName}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inspect original scanned text and coordinates side-by-side with cross-document findings
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {discrepancy?.source2DataUrl && (
              <div className="flex items-center bg-slate-200 dark:bg-slate-800 p-0.5 rounded-lg text-xs mr-2">
                <button
                  type="button"
                  onClick={() => setActiveSource("source1")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    activeSource === "source1"
                      ? "bg-white dark:bg-slate-900 text-[#174EA6] dark:text-blue-400 shadow-xs"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Source 1 ({discrepancy.source1Doc.slice(0, 4)})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSource("source2")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    activeSource === "source2"
                      ? "bg-white dark:bg-slate-900 text-[#174EA6] dark:text-blue-400 shadow-xs"
                      : "text-slate-600 dark:text-slate-400"
                  }`}
                >
                  Source 2 ({discrepancy.source2Doc.slice(0, 4)})
                </button>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Modal Body: Split-Screen View */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Panel: Original Scan Preview */}
          <div className="lg:col-span-7 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 relative overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={handleZoomOut} disabled={zoom <= 50} className="h-7 px-2">
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <span className="font-mono text-slate-600 dark:text-slate-300 w-12 text-center">{zoom}%</span>
                <Button variant="outline" size="sm" onClick={handleZoomIn} disabled={zoom >= 200} className="h-7 px-2">
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleResetZoom} className="h-7 px-2 text-slate-500">
                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
                </Button>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                    disabled={currentPage <= 1}
                    className="h-7 px-2"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <span className="text-slate-600 dark:text-slate-300 font-medium px-2">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                    disabled={currentPage >= totalPages}
                    className="h-7 px-2"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Scanned Image Container */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
              {effectiveImageUrl ? (
                <div
                  className="transition-transform duration-200 ease-out origin-center rounded-lg shadow-md border border-slate-300 dark:border-slate-700 overflow-hidden bg-white w-full h-full flex items-center justify-center"
                  style={{ transform: `scale(${zoom / 100})` }}
                >
                  {effectiveFileName.toLowerCase().endsWith(".pdf") || effectiveImageUrl.toLowerCase().includes(".pdf") ? (
                    <iframe
                      src={`${effectiveImageUrl}#page=${effectivePageNumber}&toolbar=0&navpanes=0`}
                      title={`Scanned document ${effectiveFileName}`}
                      className="w-full h-[70vh] border-0"
                    />
                  ) : (
                    <img
                      src={effectiveImageUrl}
                      alt={`Scanned page ${effectivePageNumber}`}
                      className="max-w-full max-h-[70vh] object-contain select-none"
                    />
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-8 max-w-sm">
                  <div className="w-12 h-12 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
                    <FileText className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {effectiveFileName} (Page {effectivePageNumber})
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    Document layout and extracted text traces are captured directly from the OCR engine.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Extraction & Discrepancy Verification */}
          <div className="lg:col-span-5 flex flex-col bg-white dark:bg-slate-900 overflow-y-auto p-6 space-y-6">
            {/* If opening from a specific discrepancy */}
            {discrepancy ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
                      Detected Discrepancy
                    </h4>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      {discrepancy.field}
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{discrepancy.learnerName}</span>
                    <span className="font-mono">{discrepancy.lrn}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Source 1: {discrepancy.source1Doc}
                        {discrepancy.source1Page && ` (Page ${discrepancy.source1Page})`}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {String(discrepancy.source1Value ?? "N/A")}
                      </span>
                      {discrepancy.source1FileName && (
                        <span className="text-[10px] text-slate-400 block mt-1 truncate">
                          File: {discrepancy.source1FileName}
                        </span>
                      )}
                    </div>

                    <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Source 2: {discrepancy.source2Doc}
                        {discrepancy.source2Page && ` (Page ${discrepancy.source2Page})`}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {String(discrepancy.source2Value ?? "N/A")}
                      </span>
                      {discrepancy.source2FileName && (
                        <span className="text-[10px] text-slate-400 block mt-1 truncate">
                          File: {discrepancy.source2FileName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 text-xs border-t border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400 font-semibold block mb-0.5">Discrepancy Details:</span>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{discrepancy.reason}</p>
                  </div>

                  <div className="pt-2 text-xs border-t border-slate-200 dark:border-slate-800 bg-blue-50/50 dark:bg-blue-950/20 -mx-4 -mb-4 p-4 rounded-b-xl">
                    <span className="text-[#174EA6] dark:text-blue-400 font-semibold block mb-0.5">
                      Recommended Action:
                    </span>
                    <p className="text-slate-600 dark:text-slate-300">{discrepancy.recommendedAction}</p>
                  </div>
                </div>
              </div>
            ) : extractedFields ? (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Extracted Form Metadata</h3>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-2 text-xs">
                  <pre className="font-mono text-[11px] overflow-x-auto text-slate-800 dark:text-slate-200">
                    {JSON.stringify(extractedFields, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-8 text-slate-400">
                <FileText className="w-10 h-10 mb-2 opacity-50" />
                <p className="text-xs">Select a discrepancy or segment to inspect side-by-side details.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

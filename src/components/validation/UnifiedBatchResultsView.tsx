"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileQuestion,
  FileText,
  Layers,
  Users,
  Search,
  ArrowRight,
  Eye,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Download,
  Heart,
  Award,
  Calendar,
  GraduationCap,
  BookOpen,
  UserCheck,
  UploadCloud,
  ArrowLeft,
  PlusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import ScanTraceViewerModal from "./ScanTraceViewerModal";
import IndividualDocumentExtractionView from "./IndividualDocumentExtractionView";
import LearnerIdentityMatchingView from "./LearnerIdentityMatchingView";
import type {
  BatchValidationReport,
  BatchDiscrepancyItem,
  LearnerValidationDossier,
} from "@/lib/validation/batchCrossDocumentValidator";
import type { DocumentSegment } from "@/lib/validation/batchDocumentSegmenter";
import type { UnifiedFieldComparisonRow } from "@/lib/validation/crossDocumentEngine";

export type UnifiedWorkflowStage =
  | "stage_a" // Stage A: Uploaded Documents
  | "stage_b" // Stage B: Individual Extraction Results
  | "stage_c" // Stage C: Unified Learner Identity Matching
  | "stage_d" // Stage D: Unified Cross-Document Comparison
  | "stage_e"; // Stage E: Discrepancies and Human Review

export interface UnifiedBatchResultsViewProps {
  report: BatchValidationReport;
  segments?: DocumentSegment[];
  extractedData?: Record<string, any>;
  uploadedFiles?: Array<{
    name: string;
    size: string;
    type: string;
    dataUrl: string;
    pageCount: number;
  }>;
  onRetrySegment?: (segmentId: string) => Promise<void>;
  onStartNewBatch?: () => void;
  onBackToUpload?: () => void;
  documentImageUrl?: string | null;
  initialStage?: UnifiedWorkflowStage;
}

type ResultTab =
  | "all_issues"
  | "mismatches"
  | "missing"
  | "incomplete"
  | "needs_verification";

export default function UnifiedBatchResultsView({
  report,
  segments: propSegments,
  extractedData: propExtractedData = {},
  uploadedFiles = [],
  onRetrySegment,
  onStartNewBatch,
  onBackToUpload,
  documentImageUrl,
  initialStage = "stage_b",
}: UnifiedBatchResultsViewProps) {
  const [currentStage, setCurrentStage] = useState<UnifiedWorkflowStage>(initialStage);
  const [activeTab, setActiveTab] = useState<ResultTab>("all_issues");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDiscrepancy, setSelectedDiscrepancy] = useState<BatchDiscrepancyItem | null>(null);
  const [isTraceModalOpen, setIsTraceModalOpen] = useState(false);
  const [expandedDossierLrn, setExpandedDossierLrn] = useState<string | null>(null);
  const [dossierViewTab, setDossierViewTab] = useState<
    Record<string, "matrix" | "observed_values" | "discrepancies" | "sources">
  >({});
  const [matrixCategoryFilter, setMatrixCategoryFilter] = useState<Record<string, string>>({});
  const [expandedCvIndex, setExpandedCvIndex] = useState<Record<string, boolean>>({
    "1": true,
    "2": true,
    "3": true,
    "4": true,
  });

  const toggleDossierCv = (indexStr: string) => {
    setExpandedCvIndex((prev) => ({
      ...prev,
      [indexStr]: !prev[indexStr],
    }));
  };

  const { summary, categorizedResults, learnerDossiers } = report;
  const segments =
    propSegments && propSegments.length > 0
      ? propSegments
      : report.segments && report.segments.length > 0
      ? report.segments
      : [];

  // Synthesize fallback extracted data if prop is empty
  const effectiveExtractedData: Record<string, any> = { ...propExtractedData };
  for (const seg of segments) {
    if (!effectiveExtractedData[seg.id]) {
      effectiveExtractedData[seg.id] = {
        document_type: seg.documentType,
        form_title: seg.formTitle,
        school_year: report.schoolYear,
        grade_level: report.gradeLevel,
        section: report.section,
        learners: learnerDossiers
          .map((d) => {
            const src =
              seg.documentType === "sf1"
                ? d.matchedSources.sf1
                : seg.documentType === "sf2"
                ? d.matchedSources.sf2
                : seg.documentType === "sf5a"
                ? d.matchedSources.sf5a
                : seg.documentType === "sf5b"
                ? d.matchedSources.sf5b
                : null;
            return src?.raw;
          })
          .filter(Boolean),
      };
    }
  }

  // Filter discrepancies based on active tab and search query
  const getVisibleDiscrepancies = () => {
    let items: BatchDiscrepancyItem[] = [];
    if (activeTab === "all_issues") {
      items = [
        ...categorizedResults.mismatchedInformation,
        ...categorizedResults.missingDocuments,
        ...categorizedResults.incompleteData,
        ...categorizedResults.needsManualVerification,
      ];
    } else if (activeTab === "mismatches") {
      items = categorizedResults.mismatchedInformation;
    } else if (activeTab === "missing") {
      items = categorizedResults.missingDocuments;
    } else if (activeTab === "incomplete") {
      items = categorizedResults.incompleteData;
    } else if (activeTab === "needs_verification") {
      items = categorizedResults.needsManualVerification;
    }

    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase().trim();
    return items.filter(
      (item) =>
        item.learnerName.toLowerCase().includes(q) ||
        item.lrn.toLowerCase().includes(q) ||
        item.field.toLowerCase().includes(q) ||
        item.reason.toLowerCase().includes(q)
    );
  };

  const getVisibleDossiers = () => {
    if (!searchQuery.trim()) return learnerDossiers;
    const q = searchQuery.toLowerCase().trim();
    return learnerDossiers.filter(
      (d) =>
        d.fullName.toLowerCase().includes(q) ||
        d.lrn.toLowerCase().includes(q) ||
        (d.section && d.section.toLowerCase().includes(q))
    );
  };

  const renderCellValue = (val: any) => {
    if (val === undefined || val === null || val === "") {
      return <span className="text-slate-300 dark:text-slate-600 font-mono text-[11px]">—</span>;
    }
    if (typeof val === "boolean") {
      return <span className="font-mono text-xs font-semibold">{val ? "Yes" : "No"}</span>;
    }
    return <span className="font-medium text-xs text-slate-800 dark:text-slate-200">{String(val)}</span>;
  };

  const getRowStatusBadge = (status: string) => {
    switch (status) {
      case "MATCH":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" /> MATCH
          </span>
        );
      case "MISMATCH":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
            <XCircle className="w-3 h-3 text-rose-600 shrink-0" /> MISMATCH
          </span>
        );
      case "NEEDS_VERIFICATION":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" /> VERIFY
          </span>
        );
      case "INCOMPLETE_COVERAGE":
      case "MISSING_SOURCE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            INCOMPLETE COVERAGE
          </span>
        );
      case "NOT_APPLICABLE":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            N/A
          </span>
        );
    }
  };

  const handleOpenTraceModal = (disc: BatchDiscrepancyItem) => {
    setSelectedDiscrepancy(disc);
    setIsTraceModalOpen(true);
  };

  const totalIssuesCount =
    summary.mismatchedInformationCount +
    summary.missingDocumentsCount +
    summary.incompleteDataCount +
    summary.needsManualVerificationCount;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header Card */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#0B1F33] to-[#102A43] text-white shadow-xl border border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> DepEd SHS Unified Document Verification
            </span>
            <span className="text-xs text-slate-300 font-mono">
              Section: {report.section} • {report.gradeLevel} • S.Y. {report.schoolYear}
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">
            Unified Senior High School Extraction & Validation
          </h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            {segments.length} document{segments.length > 1 ? "s" : ""} extracted individually • {summary.totalLearnersDetected} learners correlated across records • {summary.consistentRecordsCount} consistent profiles.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onStartNewBatch && (
            <Button
              variant="outline"
              size="sm"
              onClick={onStartNewBatch}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 font-medium"
              aria-label="Start New Batch"
              data-testid="start-new-batch-button"
            >
              <PlusCircle className="w-4 h-4 mr-1.5" /> Start New Batch
            </Button>
          )}
        </div>
      </div>

      {/* 5 Clearly Distinguishable Workflow Stages Navigation Bar */}
      <div className="bg-white dark:bg-slate-900 p-2 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center gap-1.5">
        {/* Stage A */}
        <button
          type="button"
          onClick={() => setCurrentStage("stage_a")}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
            currentStage === "stage_a"
              ? "bg-[#174EA6] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
            A
          </span>
          <span>Uploaded Documents</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono">
            {uploadedFiles.length > 0 ? uploadedFiles.length : segments.length}
          </span>
        </button>

        {/* Stage B */}
        <button
          type="button"
          onClick={() => setCurrentStage("stage_b")}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
            currentStage === "stage_b"
              ? "bg-[#174EA6] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
            B
          </span>
          <span>Individual Extraction Results</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono">
            {segments.length}
          </span>
        </button>

        {/* Stage C */}
        <button
          type="button"
          onClick={() => setCurrentStage("stage_c")}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
            currentStage === "stage_c"
              ? "bg-[#174EA6] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
            C
          </span>
          <span>Unified Learner Identity Matching</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono">
            {learnerDossiers.length}
          </span>
        </button>

        {/* Stage D */}
        <button
          type="button"
          onClick={() => setCurrentStage("stage_d")}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
            currentStage === "stage_d"
              ? "bg-[#174EA6] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
            D
          </span>
          <span>Unified Cross-Document Comparison</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono">
            {learnerDossiers.length}
          </span>
        </button>

        {/* Stage E */}
        <button
          type="button"
          onClick={() => setCurrentStage("stage_e")}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
            currentStage === "stage_e"
              ? "bg-[#174EA6] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
            E
          </span>
          <span>Discrepancies & Review</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono">
            {totalIssuesCount}
          </span>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* STAGE A: Uploaded Documents View */}
      {/* ===================================================================== */}
      {currentStage === "stage_a" && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <span className="text-[10px] uppercase font-bold text-[#174EA6] dark:text-blue-400 tracking-wider">
                  Stage A: Uploaded Documents
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  Uploaded Document Files & Source Batch
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review the source files uploaded for Section {report.section} ({report.gradeLevel}, S.Y. {report.schoolYear}).
                </p>
              </div>

              <div className="flex items-center gap-2">
                {onStartNewBatch && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onStartNewBatch}
                    className="text-xs"
                    aria-label="Start New Batch"
                  >
                    <PlusCircle className="w-3.5 h-3.5 mr-1.5" /> Start New Batch
                  </Button>
                )}
                {onBackToUpload && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onBackToUpload}
                    className="text-xs"
                  >
                    <UploadCloud className="w-3.5 h-3.5 mr-1.5" /> Upload More Files
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => setCurrentStage("stage_b")}
                  className="bg-[#174EA6] hover:bg-[#0B1F33] text-white text-xs font-bold"
                >
                  Inspect Extractions <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>
            </div>

            {/* Uploaded Files Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {(uploadedFiles.length > 0 ? uploadedFiles : segments.map((s) => ({
                name: s.sourceFileName || "Document.pdf",
                size: `${s.pageCount} page(s)`,
                type: s.documentType.toUpperCase(),
                dataUrl: s.imageUrl || "",
                pageCount: s.pageCount,
              }))).map((file, fIdx) => (
                <div
                  key={fIdx}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 text-[#174EA6] dark:bg-blue-950 dark:text-blue-300 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="overflow-hidden">
                      <div className="font-bold text-slate-900 dark:text-slate-100 truncate">
                        {file.name}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {file.size} • {file.type}
                      </div>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 shrink-0">
                    Uploaded
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STAGE B: Individual Extraction Results View */}
      {/* ===================================================================== */}
      {currentStage === "stage_b" && (
        <IndividualDocumentExtractionView
          segments={segments}
          extractedData={effectiveExtractedData}
          onRetrySegment={onRetrySegment}
          onProceedToIdentityMatching={() => setCurrentStage("stage_c")}
          documentImageUrl={documentImageUrl}
        />
      )}

      {/* ===================================================================== */}
      {/* STAGE C: Unified Learner Identity Matching View */}
      {/* ===================================================================== */}
      {currentStage === "stage_c" && (
        <LearnerIdentityMatchingView
          report={report}
          onSelectLearnerForComparison={(lrn) => {
            setExpandedDossierLrn(lrn);
            setCurrentStage("stage_d");
          }}
          onProceedToCrossComparison={() => setCurrentStage("stage_d")}
        />
      )}

      {/* ===================================================================== */}
      {/* STAGE D: Unified Cross-Document Comparison View */}
      {/* ===================================================================== */}
      {currentStage === "stage_d" && (
        <div className="space-y-6">
          {/* Stage Banner */}
          <div className="p-4 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#174EA6] text-white flex items-center justify-center shrink-0 shadow-xs">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#174EA6] dark:text-blue-300">
                    Stage D: Unified Cross-Document Comparison
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    ({learnerDossiers.length} Correlated Learners)
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Student-Centered Cross-Document Matrix & Source Records
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Complete comparison across all available forms (SF1, SF2, SF5A/B, SF9, SF10, PSA). Missing forms are classified as incomplete coverage, not automatic mismatch.
                </p>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => setCurrentStage("stage_e")}
              className="bg-[#174EA6] hover:bg-[#0B1F33] text-white font-bold text-xs shrink-0"
            >
              Review Discrepancies ({totalIssuesCount})
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>

          {/* Search bar */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="relative min-w-[280px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search learner by name or LRN..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#174EA6]"
              />
            </div>
            <span className="text-xs text-slate-500">
              Showing {getVisibleDossiers().length} of {learnerDossiers.length} learners
            </span>
          </div>

          {/* Learner Dossiers List Table */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">LRN</th>
                    <th className="py-3 px-4">Learner Name</th>
                    <th className="py-3 px-4">Section / Grade</th>
                    <th className="py-3 px-4 text-center">Available Forms</th>
                    <th className="py-3 px-4 text-center">Persistence Status</th>
                    <th className="py-3 px-4 text-center">Overall Status</th>
                    <th className="py-3 px-4 text-right">Discrepancies</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {getVisibleDossiers().map((d) => {
                    const isExpanded = expandedDossierLrn === (d.lrn || d.fullName);
                    const sf9Data = d.matchedSources.sf9?.raw;
                    const ovData = sf9Data?.observed_values;
                    const achData = sf9Data?.learner_progress_achievement || sf9Data?.grading_scale;

                    return (
                      <React.Fragment key={d.lrn || d.fullName}>
                        <tr
                          onClick={() =>
                            setExpandedDossierLrn(isExpanded ? null : (d.lrn || d.fullName))
                          }
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer ${
                            isExpanded ? "bg-slate-50/80 dark:bg-slate-800/40" : ""
                          }`}
                        >
                          <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                            )}
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {d.lrn || "N/A"}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                            {d.fullName}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                            {d.section || "Unassigned"} ({d.gradeLevel || "SHS"})
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center gap-1">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  d.documentPresence.sf1
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-slate-100 text-slate-400"
                                }`}
                              >
                                SF1
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  d.documentPresence.sf2
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-slate-100 text-slate-400"
                                }`}
                              >
                                SF2
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  d.documentPresence.sf5a
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-slate-100 text-slate-400"
                                }`}
                              >
                                SF5A
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  d.documentPresence.sf5b
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-slate-100 text-slate-400"
                                }`}
                              >
                                SF5B
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  d.documentPresence.sf9
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-slate-100 text-slate-400"
                                }`}
                              >
                                SF9
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  d.documentPresence.sf10
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-slate-100 text-slate-400"
                                }`}
                              >
                                SF10
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  d.documentPresence.psa
                                    ? "bg-teal-100 text-teal-800"
                                    : "bg-slate-100 text-slate-400"
                                }`}
                              >
                                PSA
                              </span>
                            </div>
                          </td>

                          {/* Persistence Status */}
                          <td className="py-3 px-4 text-center">
                            {d.validationPersistence?.status === "PERSISTED" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Persisted
                              </span>
                            ) : d.validationPersistence?.status === "REQUIRES_IDENTITY_RESOLUTION" ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300">
                                Identity Resolution
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-300">
                                Computed Preview
                              </span>
                            )}
                          </td>

                          {/* Overall Status */}
                          <td className="py-3 px-4 text-center">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                d.overallStatus === "MATCH"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : d.overallStatus === "MISMATCH"
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {d.overallStatus}
                            </span>
                          </td>

                          {/* Discrepancies Count */}
                          <td className="py-3 px-4 text-right font-medium">
                            {d.discrepancies.length > 0 ? (
                              <span className="text-rose-600 font-bold">
                                {d.discrepancies.length} issues
                              </span>
                            ) : (
                              <span className="text-emerald-600 font-medium">Reconciled</span>
                            )}
                          </td>
                        </tr>

                        {/* Expanded Learner Dossier Details */}
                        {isExpanded && (
                          <tr className="bg-slate-50/70 dark:bg-slate-900/60">
                            <td colSpan={7} className="p-4 sm:p-6 space-y-4">
                              {/* Learner Dossier Header */}
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                                <div className="flex items-center gap-2.5">
                                  <span className="p-2 rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                                    <Layers className="w-4 h-4" />
                                  </span>
                                  <div>
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                      Unified Cross-Document Validation Dossier • {d.fullName}
                                    </h4>
                                    <p className="text-xs text-slate-500 font-mono">
                                      LRN: {d.lrn} • {d.gradeLevel || "SHS"} • Section: {d.section || "Unassigned"} {d.trackStrand ? `• ${d.trackStrand}` : ""}
                                    </p>
                                  </div>
                                </div>

                                {/* Available Document Scans Quick-Inspect Pills */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mr-1">
                                    Inspect Scans:
                                  </span>
                                  {d.matchedSources.sf1 && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenTraceModal({
                                          id: `sf1-${d.lrn}`,
                                          learnerName: d.fullName,
                                          lrn: d.lrn,
                                          field: "SF1 School Register",
                                          source1Doc: "SF1-SHS School Register",
                                          source1Page: d.matchedSources.sf1?.pageNumber || 1,
                                          source1FileName: d.matchedSources.sf1?.fileName,
                                          source1DataUrl: d.matchedSources.sf1?.dataUrl || documentImageUrl || undefined,
                                          source1Value: `${d.fullName} (Enrolled)`,
                                          source2Doc: "Official DepEd SF1 Register",
                                          source2Value: "Learner Profile Record",
                                          severity: "INFO",
                                          category: "NEEDS_VERIFICATION",
                                          reason: "Teacher visual verification of scanned SF1 school register.",
                                          recommendedAction: "Review roster and profile data.",
                                        });
                                      }}
                                      className="text-[11px] h-6 px-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300"
                                    >
                                      <Eye className="w-3 h-3 mr-1" /> SF1
                                    </Button>
                                  )}
                                  {d.matchedSources.sf2 && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenTraceModal({
                                          id: `sf2-${d.lrn}`,
                                          learnerName: d.fullName,
                                          lrn: d.lrn,
                                          field: "SF2 Daily Attendance Report",
                                          source1Doc: "SF2-SHS Daily Attendance",
                                          source1Page: d.matchedSources.sf2?.pageNumber || 1,
                                          source1FileName: d.matchedSources.sf2?.fileName,
                                          source1DataUrl: d.matchedSources.sf2?.dataUrl || documentImageUrl || undefined,
                                          source1Value: `${d.matchedSources.sf2?.raw?.month || "Monthly"}: Pres ${d.matchedSources.sf2?.raw?.days_present ?? "-"}, Abs ${d.matchedSources.sf2?.raw?.days_absent ?? "-"}`,
                                          source2Doc: "Official DepEd SF2 Sheet",
                                          source2Value: "Monthly Attendance Record",
                                          severity: "INFO",
                                          category: "NEEDS_VERIFICATION",
                                          reason: "Teacher visual verification of SF2 daily attendance sheet.",
                                          recommendedAction: "Inspect daily grid and monthly totals.",
                                        });
                                      }}
                                      className="text-[11px] h-6 px-2 border-sky-200 text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300"
                                    >
                                      <Eye className="w-3 h-3 mr-1" /> SF2
                                    </Button>
                                  )}
                                  {d.matchedSources.sf9 && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenTraceModal({
                                          id: `sf9-${d.lrn}`,
                                          learnerName: d.fullName,
                                          lrn: d.lrn,
                                          field: "SF9 Complete Document Scan",
                                          source1Doc: "SF9-SHS Report Card",
                                          source1Page: d.matchedSources.sf9?.pageNumber || 1,
                                          source1FileName: d.matchedSources.sf9?.fileName,
                                          source1DataUrl: d.matchedSources.sf9?.dataUrl || documentImageUrl || undefined,
                                          source1Value: "Report Card Grades & Attendance",
                                          source2Doc: "Official DepEd SF9 Standard",
                                          source2Value: "Ratings & Scale",
                                          severity: "INFO",
                                          category: "NEEDS_VERIFICATION",
                                          reason: "Teacher verification of scanned SF9 against extracted ratings.",
                                          recommendedAction: "Review ratings beside the original scan.",
                                        });
                                      }}
                                      className="text-[11px] h-6 px-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
                                    >
                                      <Eye className="w-3 h-3 mr-1" /> SF9
                                    </Button>
                                  )}
                                  {d.matchedSources.sf10 && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenTraceModal({
                                          id: `sf10-${d.lrn}`,
                                          learnerName: d.fullName,
                                          lrn: d.lrn,
                                          field: "SF10 Permanent Record",
                                          source1Doc: "SF10-SHS Permanent Transcript",
                                          source1Page: d.matchedSources.sf10?.pageNumber || 1,
                                          source1FileName: d.matchedSources.sf10?.fileName,
                                          source1DataUrl: d.matchedSources.sf10?.dataUrl || documentImageUrl || undefined,
                                          source1Value: "Scholastic History & General Average",
                                          source2Doc: "Official DepEd SF10 Form 137",
                                          source2Value: "Transcript Standard",
                                          severity: "INFO",
                                          category: "NEEDS_VERIFICATION",
                                          reason: "Teacher verification of SF10 permanent transcript.",
                                          recommendedAction: "Verify historical grades and prerequisites.",
                                        });
                                      }}
                                      className="text-[11px] h-6 px-2 border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300"
                                    >
                                      <Eye className="w-3 h-3 mr-1" /> SF10
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {/* View Switcher Tabs inside Dossier */}
                              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDossierViewTab((prev) => ({ ...prev, [d.lrn]: "matrix" }))
                                  }
                                  className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                    (dossierViewTab[d.lrn] || "matrix") === "matrix"
                                      ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                  }`}
                                >
                                  <Layers className="w-3.5 h-3.5" />
                                  <span>Cross-Document Matrix ({d.unifiedMatrix?.length || 0})</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setDossierViewTab((prev) => ({ ...prev, [d.lrn]: "sources" }))
                                  }
                                  className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                    dossierViewTab[d.lrn] === "sources"
                                      ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                  }`}
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  <span>Extracted Records by Source</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setDossierViewTab((prev) => ({
                                      ...prev,
                                      [d.lrn]: "observed_values",
                                    }))
                                  }
                                  className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                    dossierViewTab[d.lrn] === "observed_values"
                                      ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                  }`}
                                >
                                  <Heart className="w-3.5 h-3.5 text-rose-500" />
                                  <span>Observed Values & Scale</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setDossierViewTab((prev) => ({
                                      ...prev,
                                      [d.lrn]: "discrepancies",
                                    }))
                                  }
                                  className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                    dossierViewTab[d.lrn] === "discrepancies"
                                      ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                      : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                  }`}
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                  <span>Discrepancies ({d.discrepancies.length})</span>
                                </button>
                              </div>

                              {/* View 1: Unified Comparison Matrix */}
                              {(dossierViewTab[d.lrn] || "matrix") === "matrix" && (
                                <div className="space-y-3">
                                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900">
                                    <table className="w-full text-left text-xs">
                                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 text-[10px] font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                                        <tr>
                                          <th className="py-2 px-3">Field Name</th>
                                          <th className="py-2 px-2 text-center">PSA</th>
                                          <th className="py-2 px-2 text-center">SF1</th>
                                          <th className="py-2 px-2 text-center">SF2</th>
                                          <th className="py-2 px-2 text-center">SF5A/B</th>
                                          <th className="py-2 px-2 text-center">SF9</th>
                                          <th className="py-2 px-2 text-center">SF10</th>
                                          <th className="py-2 px-3 text-center">Status</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {(d.unifiedMatrix || []).map((row, rIdx) => (
                                          <tr key={rIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                            <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                                              {row.label || row.field}
                                            </td>
                                            <td className="py-2 px-2 text-center">
                                              {renderCellValue(row.psaValue)}
                                            </td>
                                            <td className="py-2 px-2 text-center">
                                              {renderCellValue(row.sf1Value)}
                                            </td>
                                            <td className="py-2 px-2 text-center">
                                              {renderCellValue(row.sf2Value)}
                                            </td>
                                            <td className="py-2 px-2 text-center">
                                              {renderCellValue(row.sf5aValue ?? row.sf5bValue)}
                                            </td>
                                            <td className="py-2 px-2 text-center">
                                              {renderCellValue(row.sf9Value)}
                                            </td>
                                            <td className="py-2 px-2 text-center">
                                              {renderCellValue(row.sf10Value)}
                                            </td>
                                            <td className="py-2 px-3 text-center">
                                              {getRowStatusBadge(row.status)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* View 2: Extracted Data From Sources */}
                              {dossierViewTab[d.lrn] === "sources" && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                  {d.matchedSources.sf1 && (
                                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5">
                                      <div className="flex items-center justify-between border-b pb-2">
                                        <span className="font-bold text-blue-700 dark:text-blue-400">
                                          SF1-SHS School Register
                                        </span>
                                        <span className="font-mono text-[10px] text-slate-400">
                                          P{d.matchedSources.sf1.pageNumber ?? 1}:R{d.matchedSources.sf1.raw?.row_index ?? "—"}
                                        </span>
                                      </div>
                                      <div className="space-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                        <div>LRN: <span className="font-bold">{d.matchedSources.sf1.raw?.lrn}</span></div>
                                        <div>Name: {d.matchedSources.sf1.raw?.last_name}, {d.matchedSources.sf1.raw?.first_name} {d.matchedSources.sf1.raw?.middle_name}</div>
                                        <div>Sex: {d.matchedSources.sf1.raw?.sex} • Birth Date: {d.matchedSources.sf1.raw?.birth_date || "—"}</div>
                                        <div>Remarks: {d.matchedSources.sf1.raw?.remarks_indicator || "—"}</div>
                                      </div>
                                    </div>
                                  )}

                                  {d.matchedSources.sf2 && (
                                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5">
                                      <div className="flex items-center justify-between border-b pb-2">
                                        <span className="font-bold text-emerald-700 dark:text-emerald-400">
                                          SF2-SHS Daily Attendance ({d.allSf2Records?.length || 1} Month)
                                        </span>
                                        <span className="font-mono text-[10px] text-slate-400">
                                          P{d.matchedSources.sf2.pageNumber ?? 1}:R{d.matchedSources.sf2.raw?.row_index ?? "—"}
                                        </span>
                                      </div>
                                      <div className="space-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                        <div>Month: {d.matchedSources.sf2.raw?.month || "August"}</div>
                                        <div>Present: <span className="font-bold text-emerald-600">{d.matchedSources.sf2.raw?.days_present ?? d.matchedSources.sf2.raw?.total_present ?? "—"}</span> • Absent: <span className="font-bold text-rose-600">{d.matchedSources.sf2.raw?.days_absent ?? d.matchedSources.sf2.raw?.total_absent ?? "—"}</span></div>
                                        <div>Remarks: {d.matchedSources.sf2.raw?.remarks || "—"}</div>
                                      </div>
                                    </div>
                                  )}

                                  {d.matchedSources.sf9 && (
                                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5">
                                      <div className="flex items-center justify-between border-b pb-2">
                                        <span className="font-bold text-amber-700 dark:text-amber-400">
                                          SF9-SHS Report Card
                                        </span>
                                        <span className="font-mono text-[10px] text-slate-400">
                                          P{d.matchedSources.sf9.pageNumber ?? 1}
                                        </span>
                                      </div>
                                      <div className="space-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                        <div>General Average: <span className="font-bold text-amber-700">{d.matchedSources.sf9.raw?.general_average ?? "—"}</span></div>
                                        <div>Subject Count: {Array.isArray(d.matchedSources.sf9.raw?.grades) ? d.matchedSources.sf9.raw.grades.length : 0}</div>
                                      </div>
                                    </div>
                                  )}

                                  {d.matchedSources.sf10 && (
                                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5">
                                      <div className="flex items-center justify-between border-b pb-2">
                                        <span className="font-bold text-rose-700 dark:text-rose-400">
                                          SF10-SHS Permanent Transcript
                                        </span>
                                        <span className="font-mono text-[10px] text-slate-400">
                                          P{d.matchedSources.sf10.pageNumber ?? 1}
                                        </span>
                                      </div>
                                      <div className="space-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                        <div>General Average: <span className="font-bold text-rose-700">{d.matchedSources.sf10.raw?.general_average ?? "—"}</span></div>
                                        <div>Back-subjects: {d.matchedSources.sf10.raw?.has_unresolved_back_subjects ? "YES (Deficiencies Found)" : "None"}</div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* View 3: Observed Values */}
                              {dossierViewTab[d.lrn] === "observed_values" && (
                                <div className="space-y-3">
                                  {ovData ? (
                                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                                      <h5 className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                                        <Heart className="w-3.5 h-3.5 text-rose-500" />
                                        <span>Learner Observed Values Rating</span>
                                      </h5>
                                      <div className="text-xs text-slate-600 dark:text-slate-400">
                                        Ratings: AO (Always Observed), SO (Sometimes Observed), RO (Rarely Observed), NO (Not Observed).
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="p-6 text-center border border-dashed rounded-xl text-xs text-slate-400">
                                      No Observed Values extracted for this learner yet.
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* View 4: Discrepancies Details */}
                              {dossierViewTab[d.lrn] === "discrepancies" && (
                                <div className="space-y-2.5">
                                  {d.discrepancies.length === 0 ? (
                                    <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 text-center text-xs text-emerald-700 dark:text-emerald-300">
                                      <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-emerald-600" />
                                      No discrepancies found across all uploaded documents for this learner.
                                    </div>
                                  ) : (
                                    d.discrepancies.map((disc) => (
                                      <div
                                        key={disc.id}
                                        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs ${
                                          disc.severity === "CRITICAL"
                                            ? "bg-rose-50/50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900"
                                            : "bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
                                        }`}
                                      >
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-900 dark:text-slate-100">
                                              {disc.field}
                                            </span>
                                            <span
                                              className={`px-2 py-0.2 rounded text-[10px] font-bold ${
                                                disc.severity === "CRITICAL"
                                                  ? "bg-rose-100 text-rose-800"
                                                  : "bg-amber-100 text-amber-800"
                                              }`}
                                            >
                                              {disc.severity}
                                            </span>
                                          </div>
                                          <p className="text-slate-700 dark:text-slate-300 text-[11px]">
                                            {disc.reason}
                                          </p>
                                          <p className="text-[10px] text-slate-500 font-mono">
                                            {disc.source1Doc}: <span className="font-semibold text-slate-700 dark:text-slate-300">{String(disc.source1Value ?? "—")}</span> vs {disc.source2Doc}: <span className="font-semibold text-slate-700 dark:text-slate-300">{String(disc.source2Value ?? "—")}</span>
                                          </p>
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenTraceModal(disc);
                                          }}
                                          className="shrink-0 text-xs h-7"
                                        >
                                          <Eye className="w-3.5 h-3.5 mr-1" /> Inspect
                                        </Button>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STAGE E: Discrepancies and Human Review View */}
      {/* ===================================================================== */}
      {currentStage === "stage_e" && (
        <div className="space-y-6">
          {/* 6 User-Specified KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
            {/* 1. Successfully Matched */}
            <div
              onClick={() => setActiveTab("all_issues")}
              className="p-4 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 cursor-pointer hover:border-emerald-300"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Successfully Matched
                </span>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                  {summary.successfullyMatchedCount}
                </span>
                <span className="text-xs text-slate-400">learners</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                100% matched across forms
              </p>
            </div>

            {/* 2. Consistent Records */}
            <div
              onClick={() => setActiveTab("all_issues")}
              className="p-4 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 cursor-pointer hover:border-blue-300"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                  Consistent Records
                </span>
                <ShieldCheck className="w-4 h-4 text-[#174EA6]" />
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                  {summary.consistentRecordsCount}
                </span>
                <span className="text-xs text-slate-400">learners</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Zero critical discrepancies
              </p>
            </div>

            {/* 3. Mismatched Information */}
            <div
              onClick={() => setActiveTab("mismatches")}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeTab === "mismatches"
                  ? "bg-rose-50/80 dark:bg-rose-950/40 border-rose-400 shadow-sm"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                  Mismatched Info
                </span>
                <XCircle className="w-4 h-4 text-rose-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">
                  {summary.mismatchedInformationCount}
                </span>
                <span className="text-xs text-slate-400">issues</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Conflicting grades or fields
              </p>
            </div>

            {/* 4. Missing Documents */}
            <div
              onClick={() => setActiveTab("missing")}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeTab === "missing"
                  ? "bg-amber-50/80 dark:bg-amber-950/40 border-amber-400 shadow-sm"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Missing Documents
                </span>
                <FileQuestion className="w-4 h-4 text-amber-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">
                  {summary.missingDocumentsCount}
                </span>
                <span className="text-xs text-slate-400">forms</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Enrollees lacking forms
              </p>
            </div>

            {/* 5. Incomplete Data */}
            <div
              onClick={() => setActiveTab("incomplete")}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeTab === "incomplete"
                  ? "bg-orange-50/80 dark:bg-orange-950/40 border-orange-400 shadow-sm"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-orange-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-orange-700 dark:text-orange-400">
                  Incomplete Data
                </span>
                <AlertTriangle className="w-4 h-4 text-orange-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-orange-600 dark:text-orange-400">
                  {summary.incompleteDataCount}
                </span>
                <span className="text-xs text-slate-400">entries</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Missing LRN or marks
              </p>
            </div>

            {/* 6. Needs Manual Verification */}
            <div
              onClick={() => setActiveTab("needs_verification")}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                activeTab === "needs_verification"
                  ? "bg-purple-50/80 dark:bg-purple-950/40 border-purple-400 shadow-sm"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-purple-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">
                  Needs Verification
                </span>
                <Sparkles className="w-4 h-4 text-purple-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-purple-600 dark:text-purple-400">
                  {summary.needsManualVerificationCount}
                </span>
                <span className="text-xs text-slate-400">cases</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Teacher review needed
              </p>
            </div>
          </div>

          {/* Navigation Tabs & Search Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setActiveTab("all_issues")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === "all_issues"
                    ? "bg-[#174EA6] text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                All Issues ({totalIssuesCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("mismatches")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === "mismatches"
                    ? "bg-rose-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                Mismatches ({summary.mismatchedInformationCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("missing")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === "missing"
                    ? "bg-amber-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                Missing Docs ({summary.missingDocumentsCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("incomplete")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === "incomplete"
                    ? "bg-orange-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                Incomplete Data ({summary.incompleteDataCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("needs_verification")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeTab === "needs_verification"
                    ? "bg-purple-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                Needs Verification ({summary.needsManualVerificationCount})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by learner, LRN, field..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#174EA6]"
              />
            </div>
          </div>

          {/* Discrepancies List */}
          <div className="space-y-4">
            {getVisibleDiscrepancies().length === 0 ? (
              <div className="text-center py-12 p-6 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/50">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <h4 className="text-base font-bold text-slate-800 dark:text-slate-200">
                  No Discrepancies in this View
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  All records matching this category have been reconciled with zero conflicts.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5">
                {getVisibleDiscrepancies().map((disc) => (
                  <div
                    key={disc.id}
                    className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            disc.severity === "CRITICAL"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                        >
                          {disc.severity}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {disc.learnerName}
                        </h4>
                        <span className="font-mono text-xs text-slate-500">
                          LRN: {disc.lrn}
                        </span>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenTraceModal(disc)}
                        className="text-xs h-7 text-[#174EA6] hover:bg-blue-50 border-blue-200 dark:border-blue-900/50"
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" /> Inspect Original Scan
                      </Button>
                    </div>

                    {/* Compared Values Box */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                          Source 1: {disc.source1Doc} {disc.source1Page ? `(Page ${disc.source1Page})` : ""}
                        </span>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          <span className="text-slate-500 font-normal">{disc.field}: </span>
                          {String(disc.source1Value ?? "N/A")}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                          Source 2: {disc.source2Doc} {disc.source2Page ? `(Page ${disc.source2Page})` : ""}
                        </span>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          <span className="text-slate-500 font-normal">{disc.field}: </span>
                          {String(disc.source2Value ?? "N/A")}
                        </div>
                      </div>
                    </div>

                    {/* Reason & Recommended Action */}
                    <div className="space-y-1.5 pt-1 text-xs">
                      <div className="text-slate-700 dark:text-slate-300">
                        <span className="font-bold text-slate-900 dark:text-slate-100">Reason: </span>
                        {disc.reason}
                      </div>
                      <div className="text-[#174EA6] dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/30 p-2.5 rounded-lg border border-blue-200 dark:border-blue-900/40">
                        <span className="font-bold">Recommended Action: </span>
                        {disc.recommendedAction}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Split-Screen Trace Viewer Modal */}
      <ScanTraceViewerModal
        isOpen={isTraceModalOpen}
        onClose={() => setIsTraceModalOpen(false)}
        discrepancy={selectedDiscrepancy}
        documentTitle={selectedDiscrepancy?.source1Doc || "Document Scan Inspection"}
        pageNumber={selectedDiscrepancy?.source1Page || 1}
        totalPages={segments.length}
        imageUrl={selectedDiscrepancy?.source1DataUrl || documentImageUrl}
        fileName={selectedDiscrepancy?.source1FileName || undefined}
        source2ImageUrl={selectedDiscrepancy?.source2DataUrl || undefined}
        source2FileName={selectedDiscrepancy?.source2FileName || undefined}
      />
    </div>
  );
}

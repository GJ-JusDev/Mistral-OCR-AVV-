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
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import ScanTraceViewerModal from "./ScanTraceViewerModal";
import type {
  BatchValidationReport,
  BatchDiscrepancyItem,
  LearnerValidationDossier,
} from "@/lib/validation/batchCrossDocumentValidator";
import type { DocumentSegment } from "@/lib/validation/batchDocumentSegmenter";
import type { UnifiedFieldComparisonRow } from "@/lib/validation/crossDocumentEngine";

interface UnifiedBatchResultsViewProps {
  report: BatchValidationReport;
  onRetrySegment?: (segmentId: string) => Promise<void>;
  onStartNewBatch?: () => void;
  documentImageUrl?: string | null;
}

type ResultTab =
  | "all_issues"
  | "mismatches"
  | "missing"
  | "incomplete"
  | "needs_verification"
  | "dossiers"
  | "segments";

export default function UnifiedBatchResultsView({
  report,
  onRetrySegment,
  onStartNewBatch,
  documentImageUrl,
}: UnifiedBatchResultsViewProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>("all_issues");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDiscrepancy, setSelectedDiscrepancy] = useState<BatchDiscrepancyItem | null>(null);
  const [selectedSegmentForPreview, setSelectedSegmentForPreview] = useState<DocumentSegment | null>(null);
  const [isTraceModalOpen, setIsTraceModalOpen] = useState(false);
  const [expandedDossierLrn, setExpandedDossierLrn] = useState<string | null>(null);
  const [dossierViewTab, setDossierViewTab] = useState<Record<string, "matrix" | "observed_values" | "discrepancies">>({});
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

  const { summary, categorizedResults, learnerDossiers, segments } = report;

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
      case "NOT_APPLICABLE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            N/A
          </span>
        );
      case "MISSING_SOURCE":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            MISSING
          </span>
        );
    }
  };

  const handleOpenTraceModal = (disc: BatchDiscrepancyItem) => {
    setSelectedDiscrepancy(disc);
    setIsTraceModalOpen(true);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header Overview Card */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#0B1F33] to-[#102A43] text-white shadow-xl border border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> DepEd SHS Cross-Document Validation
            </span>
            <span className="text-xs text-slate-300 font-mono">
              Batch: {report.section} • {report.gradeLevel} • S.Y. {report.schoolYear}
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Consolidated Validation Report</h2>
          <p className="text-sm text-slate-300 mt-1 max-w-2xl">
            Automated cross-document verification completed across {segments.length} document segments and {summary.totalLearnersDetected} detected learners.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onStartNewBatch && (
            <Button
              variant="outline"
              size="sm"
              onClick={onStartNewBatch}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
            >
              Scan Another Batch
            </Button>
          )}
        </div>
      </div>

      {/* 6 User-Specified KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* 1. Successfully Matched */}
        <div
          onClick={() => setActiveTab("dossiers")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeTab === "dossiers"
              ? "bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-400 shadow-sm"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300"
          }`}
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
          onClick={() => setActiveTab("dossiers")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeTab === "dossiers"
              ? "bg-blue-50/80 dark:bg-blue-950/40 border-blue-400 shadow-sm"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-300"
          }`}
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
            onClick={() => setActiveTab("all_issues")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              activeTab === "all_issues"
                ? "bg-[#174EA6] text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            All Issues ({summary.mismatchedInformationCount + summary.missingDocumentsCount + summary.incompleteDataCount + summary.needsManualVerificationCount})
          </button>
          <button
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
            onClick={() => setActiveTab("needs_verification")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              activeTab === "needs_verification"
                ? "bg-purple-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            Needs Verification ({summary.needsManualVerificationCount})
          </button>
          <button
            onClick={() => setActiveTab("dossiers")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              activeTab === "dossiers"
                ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            Learner Dossiers ({summary.totalLearnersDetected})
          </button>
          <button
            onClick={() => setActiveTab("segments")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              activeTab === "segments"
                ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            Document Segments ({segments.length})
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

      {/* Main Tab Content */}

      {/* 1. Discrepancy Cards View (All Issues, Mismatches, Missing, Incomplete, Needs Verification) */}
      {["all_issues", "mismatches", "missing", "incomplete", "needs_verification"].includes(activeTab) && (
        <div className="space-y-4">
          {getVisibleDiscrepancies().length === 0 ? (
            <div className="text-center py-12 p-6 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/50">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <h4 className="text-base font-bold text-slate-800 dark:text-slate-200">No Discrepancies in this View</h4>
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
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                            : disc.severity === "WARNING"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                        }`}
                      >
                        {disc.category.replace(/_/g, " ")}
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
      )}

      {/* 2. Learner Dossiers View */}
      {activeTab === "dossiers" && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">LRN</th>
                  <th className="py-3 px-4">Learner Name</th>
                  <th className="py-3 px-4">Section / Grade</th>
                  <th className="py-3 px-4 text-center">Available Forms</th>
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
                          {d.lrn || "N/A"}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                          {d.fullName}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                          {d.section || "Unassigned"} ({d.gradeLevel || "SHS"})
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.documentPresence.sf1 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>
                              SF1
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.documentPresence.sf2 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>
                              SF2
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.documentPresence.sf5a ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>
                              SF5A
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.documentPresence.sf5b ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>
                              SF5B
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.documentPresence.sf9 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>
                              SF9
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.documentPresence.sf10 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>
                              SF10
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.documentPresence.psa ? "bg-purple-100 text-purple-800" : "bg-slate-100 text-slate-400"}`}>
                              PSA
                            </span>
                          </div>
                        </td>
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
                        <td className="py-3 px-4 text-right font-medium">
                          {d.discrepancies.length > 0 ? (
                            <span className="text-rose-600 font-bold">{d.discrepancies.length} issues</span>
                          ) : (
                            <span className="text-emerald-600 font-medium">Reconciled</span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded Learner Dossier Details */}
                      {isExpanded && (
                        <tr className="bg-slate-50/70 dark:bg-slate-900/60">
                          <td colSpan={6} className="p-4 sm:p-6 space-y-4">
                            {/* Learner Dossier Header */}
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                              <div className="flex items-center gap-2.5">
                                <span className="p-2 rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                                  <Layers className="w-4 h-4" />
                                </span>
                                <div>
                                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                    Unified 360° Cross-Document Validation Dossier &bull; {d.fullName}
                                  </h4>
                                  <p className="text-xs text-slate-500 font-mono">
                                    LRN: {d.lrn} &bull; {d.gradeLevel || "SHS"} &bull; Section: {d.section || "Unassigned"} {d.trackStrand ? `• ${d.trackStrand}` : ""}
                                  </p>
                                </div>
                              </div>

                              {/* Available Document Scans Quick-Inspect Pills */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mr-1">Inspect Scans:</span>
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
                                {d.matchedSources.sf5a && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenTraceModal({
                                        id: `sf5a-${d.lrn}`,
                                        learnerName: d.fullName,
                                        lrn: d.lrn,
                                        field: "SF5A Promotion Status",
                                        source1Doc: "SF5A-SHS Promotion Report",
                                        source1Page: d.matchedSources.sf5a?.pageNumber || 1,
                                        source1FileName: d.matchedSources.sf5a?.fileName,
                                        source1DataUrl: d.matchedSources.sf5a?.dataUrl || documentImageUrl || undefined,
                                        source1Value: d.matchedSources.sf5a?.raw?.action_taken || "PROMOTED",
                                        source2Doc: "DepEd SF5A Standard",
                                        source2Value: "Promotion Criteria",
                                        severity: "INFO",
                                        category: "NEEDS_VERIFICATION",
                                        reason: "Visual verification of SF5A promotion record.",
                                        recommendedAction: "Confirm promotion decision.",
                                      });
                                    }}
                                    className="text-[11px] h-6 px-2 border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300"
                                  >
                                    <Eye className="w-3 h-3 mr-1" /> SF5A
                                  </Button>
                                )}
                                {d.matchedSources.sf5b && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenTraceModal({
                                        id: `sf5b-${d.lrn}`,
                                        learnerName: d.fullName,
                                        lrn: d.lrn,
                                        field: "SF5B Graduation Candidacy",
                                        source1Doc: "SF5B-SHS Graduation Candidates",
                                        source1Page: d.matchedSources.sf5b?.pageNumber || 1,
                                        source1FileName: d.matchedSources.sf5b?.fileName,
                                        source1DataUrl: d.matchedSources.sf5b?.dataUrl || documentImageUrl || undefined,
                                        source1Value: d.matchedSources.sf5b?.raw?.graduation_status || "GRADUATING",
                                        source2Doc: "DepEd SF5B Standard",
                                        source2Value: "Graduation Criteria",
                                        severity: "INFO",
                                        category: "NEEDS_VERIFICATION",
                                        reason: "Visual verification of SF5B graduation candidate record.",
                                        recommendedAction: "Confirm graduation eligibility.",
                                      });
                                    }}
                                    className="text-[11px] h-6 px-2 border-orange-200 text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300"
                                  >
                                    <Eye className="w-3 h-3 mr-1" /> SF5B
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
                                {d.matchedSources.psa && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenTraceModal({
                                        id: `psa-${d.lrn}`,
                                        learnerName: d.fullName,
                                        lrn: d.lrn,
                                        field: "PSA Certificate of Live Birth",
                                        source1Doc: "PSA Certificate of Live Birth",
                                        source1Page: d.matchedSources.psa?.pageNumber || 1,
                                        source1FileName: d.matchedSources.psa?.fileName,
                                        source1DataUrl: d.matchedSources.psa?.dataUrl || documentImageUrl || undefined,
                                        source1Value: `Registry: ${d.matchedSources.psa?.raw?.registry_number || "Civil Registry"}`,
                                        source2Doc: "DepEd Enrollment Identity Requirement",
                                        source2Value: "Birth Registry Record",
                                        severity: "INFO",
                                        category: "NEEDS_VERIFICATION",
                                        reason: "Visual verification of civil birth certificate.",
                                        recommendedAction: "Confirm civil identity parameters.",
                                      });
                                    }}
                                    className="text-[11px] h-6 px-2 border-purple-200 text-purple-700 hover:bg-purple-50 dark:border-purple-800 dark:text-purple-300"
                                  >
                                    <Eye className="w-3 h-3 mr-1" /> PSA
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* Duplicate Scan Warning Banner */}
                            {d.duplicateWarnings && d.duplicateWarnings.length > 0 && (
                              <div className="p-3.5 rounded-xl border border-amber-300 bg-amber-50/80 dark:bg-amber-950/40 dark:border-amber-800 space-y-2">
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                  <h5 className="text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                                    Duplicate Document Scans Detected ({d.duplicateWarnings.length})
                                  </h5>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                  {d.duplicateWarnings.map((dup, dupIdx) => (
                                    <div
                                      key={dupIdx}
                                      className="p-2.5 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-amber-200 dark:border-amber-800/60 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                                    >
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-slate-800 dark:text-slate-200">{dup.documentType}</span>
                                          <span
                                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                              dup.isIdentical
                                                ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                                : "bg-rose-100 text-rose-800 border border-rose-300"
                                            }`}
                                          >
                                            {dup.isIdentical ? "Identical Scan (Original Preserved)" : "Conflicting Values Detected"}
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{dup.details}</p>
                                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                                          Preserved Original: <span className="font-semibold text-slate-700 dark:text-slate-300">{dup.existingSource}</span> &bull; Duplicate: <span className="font-semibold text-slate-700 dark:text-slate-300">{dup.newSource}</span>
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* View Switcher Tabs inside Dossier */}
                            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
                              <button
                                type="button"
                                onClick={() => setDossierViewTab((prev) => ({ ...prev, [d.lrn]: "matrix" }))}
                                className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                  (dossierViewTab[d.lrn] || "matrix") === "matrix"
                                    ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                }`}
                              >
                                <Layers className="w-3.5 h-3.5" />
                                <span>Unified Cross-Document Matrix</span>
                                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                                  {d.unifiedMatrix?.length || 0}
                                </span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setDossierViewTab((prev) => ({ ...prev, [d.lrn]: "observed_values" }))}
                                className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                  dossierViewTab[d.lrn] === "observed_values"
                                    ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                }`}
                              >
                                <Heart className="w-3.5 h-3.5 text-rose-500" />
                                <span>SF9 Observed Values & Grading Scale</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setDossierViewTab((prev) => ({ ...prev, [d.lrn]: "discrepancies" }))}
                                className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                  dossierViewTab[d.lrn] === "discrepancies"
                                    ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                }`}
                              >
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                <span>Discrepancies ({d.discrepancies?.length || 0})</span>
                              </button>
                            </div>

                            {/* View 1: Unified 8-Column Cross-Document Matrix */}
                            {(dossierViewTab[d.lrn] || "matrix") === "matrix" && (
                              <div className="space-y-3">
                                {/* Category Filters */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {["ALL", "IDENTITY", "SCHOOL_CONTEXT", "ATTENDANCE", "ACADEMIC", "PROMOTION", "GRADUATION"].map((cat) => {
                                    const isSelected = (matrixCategoryFilter[d.lrn] || "ALL") === cat;
                                    const catLabel = cat === "ALL" ? "All Fields" : cat.replace("_", " ");
                                    const count = cat === "ALL"
                                      ? (d.unifiedMatrix || []).length
                                      : (d.unifiedMatrix || []).filter((r) => r.category === cat).length;

                                    return (
                                      <button
                                        key={cat}
                                        type="button"
                                        onClick={() => setMatrixCategoryFilter((prev) => ({ ...prev, [d.lrn]: cat }))}
                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5 ${
                                          isSelected
                                            ? "bg-indigo-600 text-white shadow-xs"
                                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                                        }`}
                                      >
                                        <span>{catLabel}</span>
                                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-500"}`}>
                                          {count}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>

                                {/* Matrix Table */}
                                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs border-collapse">
                                      <thead>
                                        <tr className="bg-slate-100/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 font-bold text-[10px] uppercase tracking-wider">
                                          <th className="py-2.5 px-3 min-w-[170px]">Field / Attribute</th>
                                          <th className="py-2.5 px-2 text-center min-w-[85px] bg-purple-50/40 dark:bg-purple-950/20 text-purple-900 dark:text-purple-300">PSA</th>
                                          <th className="py-2.5 px-2 text-center min-w-[85px] bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-300">SF1</th>
                                          <th className="py-2.5 px-2 text-center min-w-[95px] bg-sky-50/40 dark:bg-sky-950/20 text-sky-900 dark:text-sky-300">SF2</th>
                                          <th className="py-2.5 px-2 text-center min-w-[85px] bg-amber-50/40 dark:bg-amber-950/20 text-amber-900 dark:text-amber-300">SF5A</th>
                                          <th className="py-2.5 px-2 text-center min-w-[85px] bg-orange-50/40 dark:bg-orange-950/20 text-orange-900 dark:text-orange-300">SF5B</th>
                                          <th className="py-2.5 px-2 text-center min-w-[95px] bg-indigo-50/40 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-300">SF9</th>
                                          <th className="py-2.5 px-2 text-center min-w-[95px] bg-blue-50/40 dark:bg-blue-950/20 text-blue-900 dark:text-blue-300">SF10</th>
                                          <th className="py-2.5 px-3 text-center min-w-[110px]">Status</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {(d.unifiedMatrix || [])
                                          .filter((row: UnifiedFieldComparisonRow) => {
                                            const selectedCat = matrixCategoryFilter[d.lrn] || "ALL";
                                            if (selectedCat === "ALL") return true;
                                            return row.category === selectedCat;
                                          })
                                          .map((row: UnifiedFieldComparisonRow, rIdx: number) => {
                                            const isMismatch = row.status === "MISMATCH";
                                            const isVerify = row.status === "NEEDS_VERIFICATION";

                                            return (
                                              <tr
                                                key={rIdx}
                                                className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                                                  isMismatch
                                                    ? "bg-rose-50/30 dark:bg-rose-950/20"
                                                    : isVerify
                                                    ? "bg-amber-50/30 dark:bg-amber-950/20"
                                                    : ""
                                                }`}
                                              >
                                                <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                                                  <div className="flex items-center gap-1.5">
                                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                                      {row.category.slice(0, 4)}
                                                    </span>
                                                    <span>{row.label || row.field}</span>
                                                  </div>
                                                  {row.notes && (
                                                    <p className="text-[10px] text-slate-500 mt-0.5 italic">
                                                      {row.notes}
                                                    </p>
                                                  )}
                                                </td>
                                                <td className="py-2.5 px-2 text-center font-mono">
                                                  {renderCellValue(row.psaValue)}
                                                </td>
                                                <td className="py-2.5 px-2 text-center font-mono">
                                                  {renderCellValue(row.sf1Value)}
                                                </td>
                                                <td className="py-2.5 px-2 text-center font-mono">
                                                  {renderCellValue(row.sf2Value)}
                                                </td>
                                                <td className="py-2.5 px-2 text-center font-mono">
                                                  {renderCellValue(row.sf5aValue)}
                                                </td>
                                                <td className="py-2.5 px-2 text-center font-mono">
                                                  {renderCellValue(row.sf5bValue)}
                                                </td>
                                                <td className="py-2.5 px-2 text-center font-mono">
                                                  {renderCellValue(row.sf9Value)}
                                                </td>
                                                <td className="py-2.5 px-2 text-center font-mono">
                                                  {renderCellValue(row.sf10Value)}
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                  {getRowStatusBadge(row.status)}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* View 2: SF9 Observed Values */}
                            {dossierViewTab[d.lrn] === "observed_values" && (
                              <div className="space-y-4">
                                {ovData ? (
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                                        <Heart className="w-3.5 h-3.5 text-rose-500" />
                                        <span>Report on Learner&apos;s Observed Values</span>
                                      </div>
                                      <span className="text-[10px] text-slate-500 font-mono">
                                        AO (Always) &bull; SO (Sometimes) &bull; RO (Rarely) &bull; NO (Not Observed)
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-1 gap-2.5">
                                      {(ovData.core_values || []).map((cv: any) => {
                                        const cvExpanded = expandedCvIndex[String(cv.index)] !== false;
                                        return (
                                          <div
                                            key={cv.index}
                                            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
                                          >
                                            <button
                                              type="button"
                                              onClick={() => toggleDossierCv(String(cv.index))}
                                              className="w-full flex items-center justify-between px-3 py-2 bg-slate-100/60 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                                            >
                                              <div className="flex items-center gap-2">
                                                {cvExpanded ? (
                                                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                                                ) : (
                                                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                                                )}
                                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                                  {cv.index}. {cv.name}
                                                </span>
                                              </div>
                                              <span className="text-[10px] font-mono text-slate-400">
                                                {cvExpanded ? "Collapse" : "Expand"}
                                              </span>
                                            </button>

                                            {cvExpanded && (
                                              <div className="overflow-x-auto">
                                                <table className="w-full text-left text-xs">
                                                  <thead>
                                                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 text-slate-500 text-[10px] uppercase">
                                                      <th className="py-2 px-3">Behavior Statement</th>
                                                      <th className="py-2 px-2 text-center w-14">Q1</th>
                                                      <th className="py-2 px-2 text-center w-14">Q2</th>
                                                      <th className="py-2 px-2 text-center w-14">Q3</th>
                                                      <th className="py-2 px-2 text-center w-14">Q4</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                    {cv.statements.map((stmt: any) => (
                                                      <tr key={stmt.statement_id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/20">
                                                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                                                          {stmt.statement}
                                                        </td>
                                                        {(["q1", "q2", "q3", "q4"] as const).map((qKey) => {
                                                          const qRec = stmt[qKey];
                                                          const mark = qRec?.normalized_rating ?? (qRec?.original_mark || "—");
                                                          const isBlank = !qRec?.original_mark && !qRec?.normalized_rating;
                                                          const isFlagged = qRec?.needs_verification;

                                                          return (
                                                            <td key={qKey} className="py-2 px-2 text-center font-mono font-bold">
                                                              <span
                                                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                                                                  isFlagged
                                                                    ? "bg-amber-100 text-amber-900 ring-1 ring-amber-400"
                                                                    : isBlank
                                                                    ? "text-slate-300 dark:text-slate-600 font-normal"
                                                                    : mark === "AO"
                                                                    ? "bg-emerald-100 text-emerald-800"
                                                                    : mark === "SO"
                                                                    ? "bg-blue-100 text-blue-800"
                                                                    : mark === "RO"
                                                                    ? "bg-amber-100 text-amber-800"
                                                                    : "bg-purple-100 text-purple-800"
                                                                }`}
                                                              >
                                                                {mark || "—"}
                                                              </span>
                                                            </td>
                                                          );
                                                        })}
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                                    No Observed Values extracted for this learner yet.
                                  </div>
                                )}

                                {/* Learner Progress and Achievement (Grading Scale) */}
                                {achData && (
                                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
                                      <Award className="w-3.5 h-3.5 text-indigo-500" />
                                      <span>Learner Progress and Achievement (Grading Scale)</span>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                                      {((achData.scale_items || (Array.isArray(achData) ? achData : [])) as any[]).map((item: any, i: number) => (
                                        <div key={i} className="p-2 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center">
                                          <div className="font-bold text-[11px] text-slate-800 dark:text-slate-200">{item.descriptor}</div>
                                          <div className="font-mono text-[10px] text-slate-500">{item.grading_scale}</div>
                                          <span className={`inline-block mt-1 px-1.5 py-0.2 rounded text-[9px] font-bold ${item.remarks?.toLowerCase() === "passed" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                                            {item.remarks}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* View 3: Discrepancies Details */}
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
                                          <span className="font-bold text-slate-900 dark:text-slate-100">{disc.field}</span>
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
                                        <p className="text-slate-700 dark:text-slate-300 text-[11px]">{disc.reason}</p>
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
      )}

      {/* 3. Document Segments View */}
      {activeTab === "segments" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {segments.map((seg) => (
            <div
              key={seg.id}
              className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {seg.documentType.toUpperCase()}
                </span>
                <span className="text-xs text-slate-500">
                  Pages {seg.pageNumbers.join(", ")} ({seg.pageCount} pg)
                </span>
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{seg.formTitle}</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Confidence: {Math.round(seg.confidence * 100)}%
                </p>
              </div>

              {seg.needsClassification && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
                  Needs Teacher Confirmation
                </div>
              )}

              {seg.persistenceStatus === "failed" && (
                <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-[11px] text-rose-700 dark:text-rose-300">
                  Database Persistence Failed: {seg.persistenceError || "Database error"}
                </div>
              )}

              {seg.persistenceStatus === "persisted" && (
                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
                  <span>Persisted to Supabase</span>
                  {seg.documentId && <span className="font-mono text-[10px]">{seg.documentId.slice(0, 8)}</span>}
                </div>
              )}

              <div className="pt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
                <span className="text-[11px] text-slate-400">ID: {seg.id}</span>
                {onRetrySegment && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRetrySegment(seg.id)}
                    className="text-xs h-7 text-slate-600 hover:text-slate-900"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" /> Re-extract
                  </Button>
                )}
              </div>
            </div>
          ))}
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

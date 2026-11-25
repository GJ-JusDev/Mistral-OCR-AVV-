"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileQuestion,
  Users,
  Search,
  ArrowRight,
  Eye,
  Filter,
  Sparkles,
  Layers,
  FileText,
  UserCheck,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type {
  BatchValidationReport,
  LearnerValidationDossier,
} from "@/lib/validation/batchCrossDocumentValidator";
import { isValidLrn } from "@/lib/validation/patterns";

interface LearnerIdentityMatchingViewProps {
  report: BatchValidationReport;
  onSelectLearnerForComparison?: (lrn: string) => void;
  onProceedToCrossComparison?: () => void;
}

export default function LearnerIdentityMatchingView({
  report,
  onSelectLearnerForComparison,
  onProceedToCrossComparison,
}: LearnerIdentityMatchingViewProps) {
  const [filterTab, setFilterTab] = useState<
    "all" | "verified" | "resolution_required" | "conflicts"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");

  const dossiers = report.learnerDossiers || [];

  // Categorize learners by identity status
  const verifiedLrnDossiers = dossiers.filter(
    (d) =>
      isValidLrn(d.lrn) &&
      d.validationPersistence?.status !== "REQUIRES_IDENTITY_RESOLUTION" &&
      !d.discrepancies.some((disc) => disc.field.toLowerCase().includes("lrn") && disc.severity === "CRITICAL")
  );

  const resolutionRequiredDossiers = dossiers.filter(
    (d) =>
      !isValidLrn(d.lrn) ||
      d.lrn.startsWith("UNREGISTERED") ||
      d.validationPersistence?.status === "REQUIRES_IDENTITY_RESOLUTION"
  );

  const conflictDossiers = dossiers.filter(
    (d) =>
      d.duplicateWarnings.some((w) => !w.isIdentical) ||
      d.discrepancies.some(
        (disc) =>
          (disc.field.toLowerCase().includes("name") ||
            disc.field.toLowerCase().includes("lrn") ||
            disc.field.toLowerCase().includes("birth")) &&
          disc.severity === "CRITICAL"
      )
  );

  // Filtered list
  const getVisibleDossiers = () => {
    let list = dossiers;
    if (filterTab === "verified") list = verifiedLrnDossiers;
    else if (filterTab === "resolution_required") list = resolutionRequiredDossiers;
    else if (filterTab === "conflicts") list = conflictDossiers;

    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(
      (d) =>
        d.fullName.toLowerCase().includes(q) ||
        d.lrn.toLowerCase().includes(q) ||
        (d.section && d.section.toLowerCase().includes(q))
    );
  };

  const visibleDossiers = getVisibleDossiers();

  return (
    <div className="space-y-6">
      {/* Stage Banner */}
      <div className="p-4 rounded-xl bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-700 text-white flex items-center justify-center shrink-0 shadow-xs">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                Stage C: Unified Learner Identity Matching
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                ({dossiers.length} Correlated Learners)
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Identity Matching Priority: 12-Digit LRN & Secondary Name Verification
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Primary key: 12-digit LRN. Learners are never merged on name alone. Missing or invalid LRNs are quarantined in identity resolution.
            </p>
          </div>
        </div>

        {onProceedToCrossComparison && (
          <Button
            size="sm"
            onClick={onProceedToCrossComparison}
            className="bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs shrink-0"
          >
            Proceed to Unified Comparison
            <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        )}
      </div>

      {/* DepEd SHS Identity Matching Principles Architecture Card */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-purple-600" />
          <span>DepEd Identity Resolution Architecture & Invariants</span>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1">
            <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-[10px] font-bold">
                1
              </span>
              <span>12-Digit LRN Primary Key</span>
            </div>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              The 12-digit Learner Reference Number (LRN) serves as the primary unique matching key across SF1, SF2, SF5, SF9, and SF10.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1">
            <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center text-[10px] font-bold">
                2
              </span>
              <span>Secondary Name Verification</span>
            </div>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              Learner name is used strictly as secondary verification. Never merge learners using name alone to prevent false identity unifications.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1">
            <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-purple-100 text-purple-800 flex items-center justify-center text-[10px] font-bold">
                3
              </span>
              <span>Quarantine & Conflict Detection</span>
            </div>
            <p className="text-slate-500 text-[11px] leading-relaxed">
              Records with missing LRNs are quarantined in identity resolution. Conflicting name/LRN pairs flag an immediate manual review.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div
          onClick={() => setFilterTab("all")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterTab === "all"
              ? "bg-slate-100 dark:bg-slate-800 border-slate-400 shadow-xs"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300"
          }`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
            Total Correlated Learners
          </span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
              {dossiers.length}
            </span>
            <span className="text-xs text-slate-400">learners</span>
          </div>
        </div>

        <div
          onClick={() => setFilterTab("verified")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterTab === "verified"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 shadow-xs"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Verified LRN Matches
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
              {verifiedLrnDossiers.length}
            </span>
            <span className="text-xs text-slate-400">learners</span>
          </div>
        </div>

        <div
          onClick={() => setFilterTab("resolution_required")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterTab === "resolution_required"
              ? "bg-purple-50 dark:bg-purple-950/40 border-purple-400 shadow-xs"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-purple-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">
              Requires Identity Resolution
            </span>
            <AlertCircle className="w-4 h-4 text-purple-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold text-purple-700 dark:text-purple-400">
              {resolutionRequiredDossiers.length}
            </span>
            <span className="text-xs text-slate-400">learners</span>
          </div>
        </div>

        <div
          onClick={() => setFilterTab("conflicts")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterTab === "conflicts"
              ? "bg-rose-50 dark:bg-rose-950/40 border-rose-400 shadow-xs"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
              Identity Conflicts Detected
            </span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">
              {conflictDossiers.length}
            </span>
            <span className="text-xs text-slate-400">cases</span>
          </div>
        </div>
      </div>

      {/* Toolbar & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setFilterTab("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              filterTab === "all"
                ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            All Correlated ({dossiers.length})
          </button>
          <button
            onClick={() => setFilterTab("verified")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              filterTab === "verified"
                ? "bg-emerald-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            Verified LRN Matches ({verifiedLrnDossiers.length})
          </button>
          <button
            onClick={() => setFilterTab("resolution_required")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              filterTab === "resolution_required"
                ? "bg-purple-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            Requires Identity Resolution ({resolutionRequiredDossiers.length})
          </button>
          <button
            onClick={() => setFilterTab("conflicts")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              filterTab === "conflicts"
                ? "bg-rose-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            Identity Conflicts ({conflictDossiers.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by learner name or LRN..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-purple-600"
          />
        </div>
      </div>

      {/* Learner Identity Matching Directory Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        {visibleDossiers.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            No learners match the selected filter and search query.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Learner Matching Key (LRN)</th>
                  <th className="py-3 px-4">Learner Name & Details</th>
                  <th className="py-3 px-4">Identity Status</th>
                  <th className="py-3 px-4">Contributed Documents</th>
                  <th className="py-3 px-4">Preserved Original Values</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleDossiers.map((d, idx) => {
                  const hasValidLrn = isValidLrn(d.lrn);
                  const isResolutionReq =
                    !hasValidLrn ||
                    d.validationPersistence?.status === "REQUIRES_IDENTITY_RESOLUTION";
                  const hasConflicts = conflictDossiers.includes(d);

                  // Collect original extracted values from each source
                  const sourceValues: Array<{ doc: string; name: string; lrn: string; ref: string }> = [];
                  if (d.matchedSources.sf1) {
                    sourceValues.push({
                      doc: "SF1",
                      name: `${d.matchedSources.sf1.raw?.last_name || ""}, ${d.matchedSources.sf1.raw?.first_name || ""}`,
                      lrn: d.matchedSources.sf1.raw?.lrn || "—",
                      ref: `P${d.matchedSources.sf1.pageNumber ?? 1}:R${d.matchedSources.sf1.raw?.row_index ?? "—"}`,
                    });
                  }
                  if (d.matchedSources.sf2) {
                    sourceValues.push({
                      doc: "SF2",
                      name: d.matchedSources.sf2.raw?.learner_name || d.matchedSources.sf2.raw?.last_name || "—",
                      lrn: d.matchedSources.sf2.raw?.lrn || "—",
                      ref: `P${d.matchedSources.sf2.pageNumber ?? 1}:R${d.matchedSources.sf2.raw?.row_index ?? "—"}`,
                    });
                  }
                  if (d.matchedSources.sf9) {
                    sourceValues.push({
                      doc: "SF9",
                      name: d.matchedSources.sf9.raw?.name || `${d.matchedSources.sf9.raw?.last_name || ""}, ${d.matchedSources.sf9.raw?.first_name || ""}`,
                      lrn: d.matchedSources.sf9.raw?.lrn || "—",
                      ref: `P${d.matchedSources.sf9.pageNumber ?? 1}`,
                    });
                  }
                  if (d.matchedSources.sf10) {
                    sourceValues.push({
                      doc: "SF10",
                      name: d.matchedSources.sf10.raw?.name || `${d.matchedSources.sf10.raw?.last_name || ""}, ${d.matchedSources.sf10.raw?.first_name || ""}`,
                      lrn: d.matchedSources.sf10.raw?.lrn || "—",
                      ref: `P${d.matchedSources.sf10.pageNumber ?? 1}`,
                    });
                  }
                  if (d.matchedSources.psa) {
                    sourceValues.push({
                      doc: "PSA",
                      name: d.matchedSources.psa.raw?.name || `${d.matchedSources.psa.raw?.last_name || ""}, ${d.matchedSources.psa.raw?.first_name || ""}`,
                      lrn: "N/A",
                      ref: `P${d.matchedSources.psa.pageNumber ?? 1}`,
                    });
                  }

                  return (
                    <tr
                      key={d.lrn || idx}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      {/* Column 1: LRN */}
                      <td className="py-3 px-4 font-mono">
                        {hasValidLrn ? (
                          <div className="space-y-0.5">
                            <span className="font-bold text-slate-900 dark:text-slate-100 text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                              {d.lrn}
                            </span>
                            <span className="block text-[10px] text-emerald-600 font-semibold">
                              ✓ Verified 12-Digit Key
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                              QUARANTINED
                            </span>
                            <span className="block text-[10px] text-slate-400 font-mono">
                              {d.lrn}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Column 2: Name */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                          {d.fullName || "Unnamed Learner"}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {d.section ? `Section: ${d.section}` : ""} • {d.gradeLevel || "Grade 11"}
                        </div>
                      </td>

                      {/* Column 3: Status */}
                      <td className="py-3 px-4">
                        {hasConflicts ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            CONFLICT DETECTED
                          </span>
                        ) : isResolutionReq ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300">
                            <AlertCircle className="w-3 h-3 text-purple-600" />
                            RESOLUTION REQUIRED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            VERIFIED MATCH
                          </span>
                        )}
                      </td>

                      {/* Column 4: Documents Contributed */}
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {d.documentPresence.sf1 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200">
                              SF1
                            </span>
                          )}
                          {d.documentPresence.sf2 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200">
                              SF2 ({d.allSf2Records?.length || 1} mo)
                            </span>
                          )}
                          {d.documentPresence.sf5a && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200">
                              SF5A
                            </span>
                          )}
                          {d.documentPresence.sf5b && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200">
                              SF5B
                            </span>
                          )}
                          {d.documentPresence.sf9 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200">
                              SF9 ({d.allSf9Records?.length || 1})
                            </span>
                          )}
                          {d.documentPresence.sf10 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200">
                              SF10 ({d.allSf10Records?.length || 1})
                            </span>
                          )}
                          {d.documentPresence.psa && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200">
                              PSA
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">
                          {d.documentPresence.totalAvailable} of 7 forms present
                        </div>
                      </td>

                      {/* Column 5: Exact Preserved Values */}
                      <td className="py-3 px-4">
                        <div className="space-y-1 max-w-xs">
                          {sourceValues.map((sv, sIdx) => (
                            <div
                              key={sIdx}
                              className="text-[11px] font-mono text-slate-600 dark:text-slate-400 flex items-center justify-between gap-2"
                            >
                              <span className="font-bold text-slate-700 dark:text-slate-300">
                                {sv.doc}:
                              </span>
                              <span className="truncate">{sv.name}</span>
                              <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 rounded">
                                {sv.ref}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Column 6: Actions */}
                      <td className="py-3 px-4 text-right">
                        {onSelectLearnerForComparison && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onSelectLearnerForComparison(d.lrn)}
                            className="text-xs h-7"
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" /> Compare
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

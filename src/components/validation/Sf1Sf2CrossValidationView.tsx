"use client";

import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  Users,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  ArrowLeftRight,
  Search,
  Filter,
  ShieldCheck,
  Eye,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type { SectionSf1Sf2ValidationResult, DiscrepancyItem } from "@/lib/validation/crossDocumentEngine";

interface Sf1Sf2CrossValidationViewProps {
  initialSf1Id?: string;
  initialSf2Id?: string;
}

export default function Sf1Sf2CrossValidationView({
  initialSf1Id,
  initialSf2Id,
}: Sf1Sf2CrossValidationViewProps) {
  const [sf1Documents, setSf1Documents] = useState<any[]>([]);
  const [sf2Documents, setSf2Documents] = useState<any[]>([]);
  const [selectedSf1Id, setSelectedSf1Id] = useState<string>(initialSf1Id || "");
  const [selectedSf2Id, setSelectedSf2Id] = useState<string>(initialSf2Id || "");
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);

  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<SectionSf1Sf2ValidationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"matched" | "discrepancies" | "missing_sf2" | "missing_sf1">("matched");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewSide, setPreviewSide] = useState<"sf1" | "sf2" | "both">("both");

  // Fetch teacher's available SF1 and SF2 documents
  useEffect(() => {
    async function loadDocuments() {
      setIsLoadingDocs(true);
      try {
        const res = await fetch("/api/documents?limit=100");
        if (res.ok) {
          const data = await res.json();
          const docs = data.documents || [];
          const sf1s = docs.filter((d: any) => d.document_type === "sf1");
          const sf2s = docs.filter((d: any) => d.document_type === "sf2");
          setSf1Documents(sf1s);
          setSf2Documents(sf2s);

          if (!selectedSf1Id && sf1s.length > 0) {
            setSelectedSf1Id(sf1s[0].id);
          }
          if (!selectedSf2Id && sf2s.length > 0) {
            setSelectedSf2Id(sf2s[0].id);
          }
        }
      } catch (err: any) {
        console.error("Failed to load section documents:", err);
      } finally {
        setIsLoadingDocs(false);
      }
    }
    loadDocuments();
  }, []);

  // Run validation
  const runCrossValidation = async () => {
    if (!selectedSf1Id || !selectedSf2Id) {
      setErrorMessage("Please select both an SF1 (School Register) and an SF2 (Daily Attendance) document.");
      return;
    }

    setIsValidating(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/validation/cross-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "SF1_SF2",
          sf1DocumentId: selectedSf1Id,
          sf2DocumentId: selectedSf2Id,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Cross-validation failed with status ${res.status}`);
      }

      const data = await res.json();
      setValidationResult(data.validation);
      if (data.validation.discrepancyCount > 0) {
        setActiveTab("discrepancies");
      } else {
        setActiveTab("matched");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to execute SF1/SF2 cross-document validation.");
    } finally {
      setIsValidating(false);
    }
  };

  // Trigger automatically if IDs were provided in props
  useEffect(() => {
    if (initialSf1Id && initialSf2Id && !validationResult) {
      runCrossValidation();
    }
  }, [initialSf1Id, initialSf2Id]);

  const selectedSf1Doc = sf1Documents.find((d) => d.id === selectedSf1Id);
  const selectedSf2Doc = sf2Documents.find((d) => d.id === selectedSf2Id);

  // Filter matched learners by search
  const filteredMatched = (validationResult?.matchedLearners || []).filter((l) => {
    const q = searchQuery.toLowerCase();
    return l.name.toLowerCase().includes(q) || l.lrn.includes(q);
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Selector & Header Card */}
      <Card padding="md" className="border-indigo-100 dark:border-indigo-950/60 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-indigo-600" />
              SF1 ↔ SF2 Section Batch Cross-Validation
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              Cross-reconcile SF1-SHS (School Register Roster) against SF2-SHS (Daily Attendance Report) using 12-digit LRN primary matching.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={runCrossValidation}
              disabled={isValidating || !selectedSf1Id || !selectedSf2Id}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2"
            >
              {isValidating ? (
                <>
                  <LoadingSpinner className="w-3.5 h-3.5 mr-2" />
                  Reconciling Records...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  Run Cross-Validation
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Document Selection Pickers */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-indigo-600" />
              Select Source 1: SF1 School Register
            </label>
            <select
              value={selectedSf1Id}
              onChange={(e) => setSelectedSf1Id(e.target.value)}
              className="w-full text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-2.5 text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500"
            >
              {sf1Documents.length === 0 ? (
                <option value="">No SF1 documents found</option>
              ) : (
                sf1Documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.original_filename || "SF1 Document"} — S.Y. {doc.school_year || "Unknown"} {doc.grade_level || ""} {doc.section || ""} ({new Date(doc.created_at).toLocaleDateString()})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-sky-600" />
              Select Source 2: SF2 Daily Attendance
            </label>
            <select
              value={selectedSf2Id}
              onChange={(e) => setSelectedSf2Id(e.target.value)}
              className="w-full text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-2.5 text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-indigo-500"
            >
              {sf2Documents.length === 0 ? (
                <option value="">No SF2 documents found</option>
              ) : (
                sf2Documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.original_filename || "SF2 Document"} — Month: {doc.reporting_month || (doc.extracted_fields as any)?.attendance_month || "Unknown"} (S.Y. {doc.school_year || ""})
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-lg text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
            <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}
      </Card>

      {/* Side-by-Side Scanned Document Previews */}
      {(selectedSf1Doc || selectedSf2Doc) && (
        <Card padding="md" className="border-zinc-200 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b pb-2 dark:border-zinc-800">
            <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
              <Eye className="w-4 h-4 text-indigo-600" />
              Scanned Source Document Verification
            </h3>
            <div className="inline-flex rounded-lg p-0.5 bg-zinc-100 dark:bg-zinc-800 text-xs font-medium">
              <button
                type="button"
                onClick={() => setPreviewSide("both")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  previewSide === "both"
                    ? "bg-white dark:bg-zinc-900 text-indigo-600 font-bold shadow-xs"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                }`}
              >
                Side-by-Side
              </button>
              <button
                type="button"
                onClick={() => setPreviewSide("sf1")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  previewSide === "sf1"
                    ? "bg-white dark:bg-zinc-900 text-indigo-600 font-bold shadow-xs"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                }`}
              >
                SF1 Only
              </button>
              <button
                type="button"
                onClick={() => setPreviewSide("sf2")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  previewSide === "sf2"
                    ? "bg-white dark:bg-zinc-900 text-indigo-600 font-bold shadow-xs"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                }`}
              >
                SF2 Only
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(previewSide === "both" || previewSide === "sf1") && selectedSf1Doc && (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-zinc-50 dark:bg-zinc-900/60 flex flex-col items-center">
                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2 self-start flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  SF1 Original Scanned Register ({selectedSf1Doc.original_filename || "SF1"})
                </span>
                {selectedSf1Doc.image_url && selectedSf1Doc.image_url !== "uploaded-document" ? (
                  <img
                    src={selectedSf1Doc.image_url}
                    alt="SF1 Scan"
                    className="max-h-80 w-auto rounded border border-zinc-300 dark:border-zinc-700 shadow-xs object-contain"
                  />
                ) : (
                  <div className="text-zinc-400 text-xs italic py-16 text-center">
                    Original scan image stored in private school vault.
                  </div>
                )}
              </div>
            )}

            {(previewSide === "both" || previewSide === "sf2") && selectedSf2Doc && (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-zinc-50 dark:bg-zinc-900/60 flex flex-col items-center">
                <span className="text-xs font-semibold text-sky-600 dark:text-sky-400 mb-2 self-start flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  SF2 Original Scanned Attendance ({selectedSf2Doc.original_filename || "SF2"})
                </span>
                {selectedSf2Doc.image_url && selectedSf2Doc.image_url !== "uploaded-document" ? (
                  <img
                    src={selectedSf2Doc.image_url}
                    alt="SF2 Scan"
                    className="max-h-80 w-auto rounded border border-zinc-300 dark:border-zinc-700 shadow-xs object-contain"
                  />
                ) : (
                  <div className="text-zinc-400 text-xs italic py-16 text-center">
                    Original scan image stored in private school vault.
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Validation Results Display */}
      {validationResult && (
        <div className="flex flex-col gap-5">
          {/* Status Banner */}
          <div
            className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs ${
              validationResult.status === "MATCH"
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100"
                : validationResult.status === "MISMATCH"
                ? "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100"
                : "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100"
            }`}
          >
            <div className="flex items-center gap-3">
              {validationResult.status === "MATCH" ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              ) : validationResult.status === "MISMATCH" ? (
                <XCircle className="w-6 h-6 text-rose-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
              )}
              <div>
                <h3 className="font-bold text-sm">
                  {validationResult.status === "MATCH"
                    ? "CERTIFIED: 100% Enrollment & Attendance Match"
                    : validationResult.status === "MISMATCH"
                    ? "CRITICAL MISMATCH DETECTED"
                    : "DISCREPANCIES FOUND — ADVISER REVIEW REQUIRED"}
                </h3>
                <p className="text-xs opacity-90 mt-0.5">{validationResult.summaryMessage}</p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full uppercase self-start sm:self-auto border bg-white/60 dark:bg-zinc-900/60">
              {validationResult.status}
            </span>
          </div>

          {/* Metrics Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-center">
              <span className="text-[11px] text-zinc-500 uppercase font-medium block">SF1 Enrollees</span>
              <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                {validationResult.totalSf1Learners}
              </span>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-center">
              <span className="text-[11px] text-zinc-500 uppercase font-medium block">SF2 Attendees</span>
              <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                {validationResult.totalSf2Learners}
              </span>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-center">
              <span className="text-[11px] text-emerald-600 uppercase font-medium block">Reconciled (LRN)</span>
              <span className="text-lg font-bold text-emerald-600 font-mono">
                {validationResult.matchedCount}
              </span>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-center">
              <span className="text-[11px] text-amber-600 uppercase font-medium block">Missing in SF2</span>
              <span className="text-lg font-bold text-amber-600 font-mono">
                {validationResult.missingInSf2Count}
              </span>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-center">
              <span className="text-[11px] text-rose-600 uppercase font-medium block">Missing in SF1</span>
              <span className="text-lg font-bold text-rose-600 font-mono">
                {validationResult.missingInSf1Count}
              </span>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-center">
              <span className="text-[11px] text-zinc-500 uppercase font-medium block">Total Flags</span>
              <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                {validationResult.discrepancyCount}
              </span>
            </div>
          </div>

          {/* Interactive Results Tabs */}
          <Card padding="none" className="overflow-hidden border-zinc-200 dark:border-zinc-800">
            <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab("matched")}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === "matched"
                    ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-zinc-900"
                    : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                }`}
              >
                Reconciled Learners ({validationResult.matchedCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("discrepancies")}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === "discrepancies"
                    ? "border-rose-600 text-rose-600 dark:text-rose-400 bg-white dark:bg-zinc-900"
                    : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                }`}
              >
                Discrepancy Audit ({validationResult.discrepancyCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("missing_sf2")}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === "missing_sf2"
                    ? "border-amber-600 text-amber-600 dark:text-amber-400 bg-white dark:bg-zinc-900"
                    : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                }`}
              >
                Missing in SF2 ({validationResult.missingInSf2Count})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("missing_sf1")}
                className={`px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === "missing_sf1"
                    ? "border-rose-600 text-rose-600 dark:text-rose-400 bg-white dark:bg-zinc-900"
                    : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900"
                }`}
              >
                Unenrolled Attendees ({validationResult.missingInSf1Count})
              </button>
            </div>

            {/* Tab 1: Reconciled Learners Table */}
            {activeTab === "matched" && (
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="relative w-full max-w-xs">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Search learner name or LRN..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 w-full"
                    />
                  </div>
                  <span className="text-xs text-zinc-500 font-medium">
                    Showing {filteredMatched.length} of {validationResult.matchedCount} matched learners
                  </span>
                </div>

                <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full text-left text-xs text-zinc-700 dark:text-zinc-300">
                    <thead className="bg-zinc-50 dark:bg-zinc-800 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 border-b">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">LRN (12-Digit)</th>
                        <th className="py-2.5 px-3">Learner Name</th>
                        <th className="py-2.5 px-3">Sex</th>
                        <th className="py-2.5 px-3">Birth Date</th>
                        <th className="py-2.5 px-3">School Days</th>
                        <th className="py-2.5 px-3">Present</th>
                        <th className="py-2.5 px-3">Absent</th>
                        <th className="py-2.5 px-3">Tardy</th>
                        <th className="py-2.5 px-3">Reconciliation Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {filteredMatched.map((l, idx) => (
                        <tr key={l.lrn} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
                          <td className="py-2 px-3 font-mono text-zinc-400">{idx + 1}</td>
                          <td className="py-2 px-3 font-mono font-bold text-zinc-900 dark:text-zinc-100">{l.lrn}</td>
                          <td className="py-2 px-3 font-semibold text-zinc-900 dark:text-zinc-100">{l.name}</td>
                          <td className="py-2 px-3">{l.sex || "-"}</td>
                          <td className="py-2 px-3 font-mono">{l.birthDate || "-"}</td>
                          <td className="py-2 px-3 font-mono">{l.totalSchoolDays}</td>
                          <td className="py-2 px-3 font-mono text-emerald-600 font-semibold">{l.daysPresent}</td>
                          <td className="py-2 px-3 font-mono text-rose-600 font-semibold">{l.daysAbsent}</td>
                          <td className="py-2 px-3 font-mono text-amber-600 font-semibold">{l.daysTardy}</td>
                          <td className="py-2 px-3">
                            {l.status === "MATCH" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                Reconciled
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                {l.discrepancies.length} Alert(s)
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab 2: Discrepancy Audit Details */}
            {activeTab === "discrepancies" && (
              <div className="p-4 flex flex-col gap-3">
                {validationResult.discrepancies.length === 0 ? (
                  <div className="py-12 text-center text-zinc-400 text-xs flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      Zero discrepancies detected across SF1 and SF2!
                    </span>
                    <span>All enrollees are fully reconciled with daily attendance records.</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <table className="w-full text-left text-xs text-zinc-700 dark:text-zinc-300">
                      <thead className="bg-zinc-50 dark:bg-zinc-800 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 border-b">
                        <tr>
                          <th className="py-2.5 px-3">Severity</th>
                          <th className="py-2.5 px-3">Field / Rule</th>
                          <th className="py-2.5 px-3">SF1 Source Value</th>
                          <th className="py-2.5 px-3">SF2 Extracted Value</th>
                          <th className="py-2.5 px-3">Audit Finding & DepEd Rule Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {validationResult.discrepancies.map((d, idx) => (
                          <tr key={idx} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
                            <td className="py-2 px-3">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  d.severity === "CRITICAL"
                                    ? "bg-rose-100 text-rose-800 border border-rose-300"
                                    : "bg-amber-100 text-amber-800 border border-amber-300"
                                }`}
                              >
                                {d.severity}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-semibold text-zinc-900 dark:text-zinc-100">
                              {d.field.replace(/_/g, " ").toUpperCase()}
                            </td>
                            <td className="py-2 px-3 font-mono text-zinc-600 dark:text-zinc-400">
                              {d.sourceValue !== null && d.sourceValue !== undefined ? String(d.sourceValue) : "NULL"}
                            </td>
                            <td className="py-2 px-3 font-mono text-zinc-600 dark:text-zinc-400">
                              {d.targetValue !== null && d.targetValue !== undefined ? String(d.targetValue) : "NULL"}
                            </td>
                            <td className="py-2 px-3 text-zinc-800 dark:text-zinc-200">{d.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Missing in SF2 */}
            {activeTab === "missing_sf2" && (
              <div className="p-4 flex flex-col gap-3">
                {validationResult.missingInSf2.length === 0 ? (
                  <div className="py-8 text-center text-zinc-400 text-xs">
                    All SF1 enrolled learners have corresponding attendance entries in SF2.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-amber-50 dark:bg-amber-950/40 text-[11px] font-semibold text-amber-900 dark:text-amber-200 border-b">
                        <tr>
                          <th className="py-2.5 px-3">LRN</th>
                          <th className="py-2.5 px-3">Enrolled Learner Name</th>
                          <th className="py-2.5 px-3">Section</th>
                          <th className="py-2.5 px-3">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {validationResult.missingInSf2.map((m) => (
                          <tr key={m.lrn} className="hover:bg-amber-50/30">
                            <td className="py-2 px-3 font-mono font-bold text-zinc-900 dark:text-zinc-100">{m.lrn}</td>
                            <td className="py-2 px-3 font-semibold">{m.name}</td>
                            <td className="py-2 px-3">{m.sf1Entry?.section || "-"}</td>
                            <td className="py-2 px-3 text-amber-800 dark:text-amber-300">{m.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: Missing in SF1 */}
            {activeTab === "missing_sf1" && (
              <div className="p-4 flex flex-col gap-3">
                {validationResult.missingInSf1.length === 0 ? (
                  <div className="py-8 text-center text-zinc-400 text-xs">
                    No unenrolled attendees found on SF2 attendance sheet.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-rose-50 dark:bg-rose-950/40 text-[11px] font-semibold text-rose-900 dark:text-rose-200 border-b">
                        <tr>
                          <th className="py-2.5 px-3">Extracted LRN</th>
                          <th className="py-2.5 px-3">Attendee Name</th>
                          <th className="py-2.5 px-3">Month</th>
                          <th className="py-2.5 px-3">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {validationResult.missingInSf1.map((m) => (
                          <tr key={m.lrn} className="hover:bg-rose-50/30">
                            <td className="py-2 px-3 font-mono font-bold text-rose-600">{m.lrn}</td>
                            <td className="py-2 px-3 font-semibold">{m.name}</td>
                            <td className="py-2 px-3 font-medium">{m.sf2Attendance?.[0]?.month || "-"}</td>
                            <td className="py-2 px-3 text-rose-800 dark:text-rose-300">{m.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

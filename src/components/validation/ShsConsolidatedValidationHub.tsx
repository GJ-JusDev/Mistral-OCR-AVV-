"use client";

import React, { useEffect, useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCw,
  FileText,
  Layers,
  Calendar,
  Award,
  Users,
  Download,
  Check,
} from "lucide-react";
import type {
  CrossDocumentValidationStatus,
  CrossDocumentValidationType,
} from "@/types/database";
import {
  buildDocumentCompletenessChecklist,
  deriveDocumentPresenceFromMatrix,
  evaluateRequiredDocumentCoverage,
  type ConsolidatedShsEvaluationResult,
  type PairwiseValidationResult,
  type UnifiedFieldComparisonRow,
} from "@/lib/validation/crossDocumentEngine";
import { readPersistedValidationResponse } from "@/lib/validation/studentCrossDocumentValidation";

interface ShsConsolidatedValidationHubProps {
  student: {
    id: string;
    school_id: string;
    lrn: string;
    first_name: string;
    middle_name?: string | null;
    last_name: string;
    suffix?: string | null;
    grade_level?: string;
    section?: string;
    strand?: string;
  };
  initialMatrix?: UnifiedFieldComparisonRow[] | null;
  initialValidationRecord?: any | null;
  initialPairwiseResults?: PairwiseValidationResult[] | null;
  initialError?: string | null;
  initialLoading?: boolean;
  schoolYear: string;
  gradeLevel?: string;
  section?: string;
  onRefreshValidation?: () => Promise<void>;
}

function getPersistedHubData(record: any, studentId: string, schoolId: string, gradeLevel?: string) {
  if (!record) return null;
  const matrix = Array.isArray(record.comparison_results) ? record.comparison_results : [];
  const presence = deriveDocumentPresenceFromMatrix(matrix);
  const coverage = evaluateRequiredDocumentCoverage(presence);
  const discrepancies = Array.isArray(record.discrepancy_details) ? record.discrepancy_details : [];
  const status = record.status === "RESOLVED" ? "RESOLVED" : record.status;
  return {
    studentId,
    schoolId: record.school_id || schoolId,
    schoolYear: record.school_year || "",
    gradeLevel: record.grade_level || gradeLevel,
    overallStatus: status as CrossDocumentValidationStatus,
    needsHumanReview: Boolean(record.needs_human_review),
    documentCompleteness: {
      sf1: presence.sf1,
      sf2: presence.sf2,
      sf5: coverage.sf5Satisfied,
      sf5a: presence.sf5a,
      sf5b: presence.sf5b,
      sf9: presence.sf9,
      sf10: presence.sf10,
      birth_cert: presence.psa,
      totalAvailable: coverage.requiredAvailable,
      totalRequired: coverage.totalRequired,
      requiredAvailable: coverage.requiredAvailable,
      hasRequiredCoverage: coverage.hasRequiredCoverage,
    },
    pairwiseResults: [],
    criticalDiscrepanciesCount: discrepancies.filter((item: any) => item.severity === "CRITICAL").length,
    warningDiscrepanciesCount: discrepancies.filter((item: any) => item.severity === "WARNING").length,
    summaryMessage:
      status === "MATCH" || status === "RESOLVED"
        ? "Persisted cross-document comparison is consistent."
        : `${discrepancies.length} persisted discrepancy or verification item(s) require review.`,
  };
}

export default function ShsConsolidatedValidationHub({
  student,
  initialMatrix,
  initialValidationRecord,
  initialPairwiseResults = [],
  initialError,
  initialLoading,
  schoolYear,
  gradeLevel,
  section,
  onRefreshValidation,
}: ShsConsolidatedValidationHubProps) {
  const activeValidationRecord = initialValidationRecord &&
    initialValidationRecord.student_id === student.id &&
    initialValidationRecord.school_id === student.school_id &&
    (!schoolYear || initialValidationRecord.school_year === schoolYear) &&
    (!gradeLevel || initialValidationRecord.grade_level === gradeLevel) &&
    (!section || initialValidationRecord.section === section)
    ? initialValidationRecord
    : null;
  const [data, setData] = useState<ConsolidatedShsEvaluationResult | null>(
    activeValidationRecord
      ? getPersistedHubData(activeValidationRecord, student.id, activeValidationRecord.school_id || "", student.grade_level)
      : null
  );
  const [matrix, setMatrix] = useState<UnifiedFieldComparisonRow[] | null>(
    activeValidationRecord
      ? initialMatrix || (Array.isArray(activeValidationRecord.comparison_results)
        ? activeValidationRecord.comparison_results
        : null)
      : null
  );
  const [persistedDiscrepancies, setPersistedDiscrepancies] = useState<any[]>(
    Array.isArray(activeValidationRecord?.discrepancy_details) ? activeValidationRecord.discrepancy_details : []
  );
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [pairwiseResults, setPairwiseResults] = useState<PairwiseValidationResult[]>(initialPairwiseResults || []);
  const [loading, setLoading] = useState(false);
  const [persistedLoading, setPersistedLoading] = useState(Boolean(initialLoading));
  const [error, setError] = useState<string | null>(initialError || null);

  const studentFullName = `${student.last_name}, ${student.first_name} ${student.middle_name || ""}${student.suffix ? " " + student.suffix : ""}`.trim();
  const displayGradeLevel = gradeLevel || student.grade_level;

  useEffect(() => {
    const timer = setTimeout(() => {
      setData(
        activeValidationRecord
          ? getPersistedHubData(activeValidationRecord, student.id, activeValidationRecord.school_id || "", displayGradeLevel)
          : null
      );
      setMatrix(
        activeValidationRecord
          ? initialMatrix || (Array.isArray(activeValidationRecord.comparison_results)
            ? activeValidationRecord.comparison_results
            : null)
          : null
      );
      setPairwiseResults(initialPairwiseResults || []);
      setPersistedDiscrepancies(
        Array.isArray(activeValidationRecord?.discrepancy_details) ? activeValidationRecord.discrepancy_details : []
      );
      setError(initialError || null);
      setPersistedLoading(Boolean(initialLoading));
    }, 0);
    return () => clearTimeout(timer);
  }, [student.id, student.school_id, schoolYear, gradeLevel, section, activeValidationRecord, initialMatrix, initialPairwiseResults, initialError, initialLoading, displayGradeLevel]);

  const handleRunValidation = async () => {
    if (!student.school_id || !schoolYear || !section) {
      setError("Select a school, school year, grade level, and section before running validation.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/validation/cross-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: student.id,
          schoolId: student.school_id,
          schoolYear,
          gradeLevel: displayGradeLevel,
          section,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Cross-document validation execution failed");
      }
      const params = new URLSearchParams({
        studentId: student.id,
        schoolId: student.school_id,
        schoolYear,
        ...(displayGradeLevel ? { gradeLevel: displayGradeLevel } : {}),
        section,
      });
      const savedRes = await fetch(`/api/validation/cross-document?${params.toString()}`);
      const saved = await readPersistedValidationResponse(savedRes);
      const record = saved.consolidated;
      setData(
        record
          ? getPersistedHubData(record, student.id, record.school_id || "", student.grade_level)
          : null
      );
      setMatrix(record ? saved.matrix : null);
      setPersistedDiscrepancies(record ? saved.discrepancies : []);
      setPairwiseResults(saved.pairwiseResults);
      if (onRefreshValidation) await onRefreshValidation();
    } catch (err: any) {
      setData(null);
      setMatrix(null);
      setPersistedDiscrepancies([]);
      setPairwiseResults([]);
      setError(err.message || "Failed to execute validation");
    } finally {
      setLoading(false);
    }
  };

  const renderCellValue = (val: any) => {
    if (val === undefined || val === null || val === "") {
      return <span className="text-zinc-300 dark:text-zinc-600 font-mono text-[11px]">—</span>;
    }
    if (typeof val === "boolean") {
      return <span className="font-mono text-xs font-semibold">{val ? "Yes" : "No"}</span>;
    }
    return <span className="font-medium text-xs text-zinc-800 dark:text-zinc-200">{String(val)}</span>;
  };

  const getStatusChip = (status: CrossDocumentValidationStatus) => {
    switch (status) {
      case "MATCH":
      case "RESOLVED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            MATCH
          </span>
        );
      case "MISMATCH":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            MISMATCH
          </span>
        );
      case "DISCREPANCIES_FOUND":
      case "NEEDS_VERIFICATION":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            NEEDS REVIEW
          </span>
        );
      case "NOT_APPLICABLE":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-600 border border-zinc-200">
            NOT APPLICABLE
          </span>
        );
    }
  };

  const getDocTypeIcon = (type: string) => {
    switch (type) {
      case "sf1":
        return <Users className="w-4 h-4 text-indigo-600" />;
      case "sf2":
        return <Calendar className="w-4 h-4 text-sky-600" />;
      case "sf5":
        return <Award className="w-4 h-4 text-amber-600" />;
      case "sf9":
        return <Layers className="w-4 h-4 text-purple-600" />;
      case "sf10":
        return <FileText className="w-4 h-4 text-blue-600" />;
      case "birth_cert":
      default:
        return <ShieldCheck className="w-4 h-4 text-emerald-600" />;
    }
  };

  const completeness = data?.documentCompleteness;
  // The checklist follows exactly the engine rule: SF5A OR SF5B satisfies one requirement.
  const { items: docs, coverage: completenessCoverage } = buildDocumentCompletenessChecklist({
    sf1: Boolean(completeness?.sf1),
    sf2: Boolean(completeness?.sf2),
    sf5a: Boolean(completeness?.sf5a ?? (completeness?.sf5 && !completeness?.sf5b)),
    sf5b: Boolean(completeness?.sf5b),
    sf9: Boolean(completeness?.sf9),
    sf10: Boolean(completeness?.sf10),
    psa: Boolean(completeness?.birth_cert),
  });

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-xs space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
              TRIS DepEd ID: 500169
            </span>
            <span className="text-xs font-semibold text-zinc-500">
              {schoolYear || "Select school year"} · {displayGradeLevel || "SHS"}
            </span>
          </div>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {studentFullName}
          </h2>
          <p className="text-xs text-zinc-500 font-mono">
            LRN: {student.lrn} &bull;             {displayGradeLevel || "Grade not selected"} &bull; {section || student.section || "No section"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {data && getStatusChip(data.overallStatus)}
          <button
            type="button"
            disabled={loading || persistedLoading || !schoolYear}
            onClick={handleRunValidation}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-xs transition-colors"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading || persistedLoading ? "animate-spin" : ""}`} />
            Run 360° SHS Validation
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-800 dark:text-rose-200 rounded-xl text-xs">
          {error}
        </div>
      )}
      {!schoolYear && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 text-amber-800 dark:text-amber-200 rounded-xl text-xs">
          Select an available school-year context to load persisted validation results.
        </div>
      )}
      {schoolYear && persistedLoading && (
        <div className="p-3 text-xs text-zinc-500" role="status">
          Loading persisted validation results for {schoolYear}...
        </div>
      )}

      {/* Document Completeness Checklist */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-3">
          Document Completeness Matrix ({completenessCoverage.requiredAvailable}/{completenessCoverage.totalRequired} Required Forms)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {docs.map((doc, dIdx) => (
            <div
              key={dIdx}
              className={`p-3 rounded-xl border flex flex-col justify-between text-xs transition-colors ${
                doc.present
                  ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
                  : "bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700 opacity-75"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                {getDocTypeIcon(doc.key)}
                {doc.present ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <span className="text-[10px] text-zinc-400 font-medium">Missing</span>
                )}
              </div>
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-[11px] leading-tight">
                  {doc.label}
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  {doc.required ? "Required" : "Supporting"}
                  {doc.present && doc.key === "sf5" && doc.satisfiedBy.length > 0
                    ? ` · Satisfied by ${doc.satisfiedBy.join(" + ")}`
                    : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Unified 8-Column Cross-Document Validation Matrix Table */}
      {matrix && matrix.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-600" />
              Unified Cross-Document Comparison Matrix ({matrix.length} Fields Compared)
            </h3>
            {/* Category Filter Pills */}
            <div className="flex flex-wrap items-center gap-1">
              {["ALL", "IDENTITY", "SCHOOL_CONTEXT", "ATTENDANCE", "ACADEMIC", "PROMOTION", "GRADUATION"].map((cat) => {
                const isSelected = selectedCategory === cat;
                const catLabel = cat === "ALL" ? "All" : cat.replace("_", " ");
                const count = cat === "ALL" ? matrix.length : matrix.filter((r) => r.category === cat).length;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors flex items-center gap-1 ${
                      isSelected
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200"
                    }`}
                  >
                    <span>{catLabel}</span>
                    <span className={`text-[9px] px-1 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-zinc-200 dark:bg-zinc-700"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-zinc-100/90 dark:bg-zinc-800/90 text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700 font-bold text-[10px] uppercase tracking-wider">
                    <th className="py-2.5 px-3 min-w-[160px]">Field / Attribute</th>
                    <th className="py-2.5 px-2 text-center min-w-[85px] bg-purple-50/40 dark:bg-purple-950/20 text-purple-900 dark:text-purple-300">PSA</th>
                    <th className="py-2.5 px-2 text-center min-w-[85px] bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-300">SF1</th>
                    <th className="py-2.5 px-2 text-center min-w-[95px] bg-sky-50/40 dark:bg-sky-950/20 text-sky-900 dark:text-sky-300">SF2</th>
                    <th className="py-2.5 px-2 text-center min-w-[95px] bg-indigo-50/40 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-300">SF9</th>
                    <th className="py-2.5 px-2 text-center min-w-[95px] bg-blue-50/40 dark:bg-blue-950/20 text-blue-900 dark:text-blue-300">SF10</th>
                    <th className="py-2.5 px-3 text-center min-w-[100px]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {matrix
                    .filter((row) => (selectedCategory === "ALL" ? true : row.category === selectedCategory))
                    .map((row, rIdx) => {
                      const isMismatch = row.status === "MISMATCH";
                      const isVerify = row.status === "NEEDS_VERIFICATION";

                      return (
                        <tr
                          key={rIdx}
                          className={`transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${
                            isMismatch ? "bg-rose-50/30 dark:bg-rose-950/20" : isVerify ? "bg-amber-50/30 dark:bg-amber-950/20" : ""
                          }`}
                        >
                          <td className="py-2.5 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                {row.category.slice(0, 4)}
                              </span>
                              <span>{row.label || row.field}</span>
                            </div>
                            {row.notes && (
                              <p className="text-[10px] text-zinc-500 mt-0.5 italic">{row.notes}</p>
                            )}
                            {row.sourceTraces && row.sourceTraces.length > 0 && (
                              <p className="text-[9px] text-zinc-400 mt-1 break-all">
                                Source trace: {row.sourceTraces.map((trace) => [
                                  `${trace.documentType} ${trace.documentId}`,
                                  trace.pageNumber !== undefined ? `Page ${trace.pageNumber}` : null,
                                  trace.rowIndex !== undefined ? `Row ${trace.rowIndex}` : null,
                                  trace.academicContext?.semester,
                                ].filter(Boolean).join(" · ")).join("; ")}
                              </p>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono">{renderCellValue(row.psaValue)}</td>
                          <td className="py-2.5 px-2 text-center font-mono">{renderCellValue(row.sf1Value)}</td>
                          <td className="py-2.5 px-2 text-center font-mono">{renderCellValue(row.sf2Value)}</td>
                          <td className="py-2.5 px-2 text-center font-mono">{renderCellValue(row.sf9Value)}</td>
                          <td className="py-2.5 px-2 text-center font-mono">{renderCellValue(row.sf10Value)}</td>
                          <td className="py-2.5 px-3 text-center">
                            {getStatusChip(row.status === "MISSING_SOURCE" ? "NEEDS_VERIFICATION" : row.status)}
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

      {schoolYear && !persistedLoading && !error && (!matrix || matrix.length === 0) && (
        <div className="p-4 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-xs text-zinc-500">
          No persisted unified validation exists for {schoolYear} ({displayGradeLevel || "SHS"}). Run validation to create one.
        </div>
      )}

      {/* Pairwise Results Section */}
      {pairwiseResults.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
            Pairwise Cross-Document Consistency Audits ({pairwiseResults.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pairwiseResults.map((pr: PairwiseValidationResult, idx: number) => (
              <div
                key={idx}
                className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-col justify-between space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    {pr.validationType}
                  </span>
                  {getStatusChip(pr.status)}
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {pr.summaryMessage}
                </p>
                {pr.discrepancies.length > 0 && (
                  <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700/60 space-y-1">
                    {pr.discrepancies.map((d, dIdx) => (
                      <p
                        key={dIdx}
                        className={`text-[11px] ${
                          d.severity === "CRITICAL"
                            ? "text-rose-600 dark:text-rose-400 font-medium"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        &bull; {d.description}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Message Banner */}
      {data && (
        <div
          className={`p-4 rounded-xl text-xs flex items-start gap-3 ${
            data.overallStatus === "MATCH"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
              : data.overallStatus === "MISMATCH"
              ? "bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200"
              : "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200"
          }`}
        >
          {data.overallStatus === "MATCH" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : data.overallStatus === "MISMATCH" ? (
            <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div>
            <strong className="block font-bold mb-0.5">360° SHS Validation Certification Outcome:</strong>
            <p className="leading-relaxed">{data.summaryMessage}</p>
          </div>
        </div>
      )}
      {persistedDiscrepancies.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Persisted Discrepancies ({persistedDiscrepancies.length})
          </h3>
          {persistedDiscrepancies.map((item, index) => (
            <p
              key={`${item.field || "finding"}-${index}`}
              className={`text-xs ${
                item.severity === "CRITICAL"
                  ? "text-rose-700 dark:text-rose-300"
                  : "text-amber-700 dark:text-amber-200"
              }`}
            >
              {item.description || item.notes || item.field || "Validation finding"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

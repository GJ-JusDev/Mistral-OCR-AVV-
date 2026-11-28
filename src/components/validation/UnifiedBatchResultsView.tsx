"use client";

import React, { useState, useMemo } from "react";
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
  Info,
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
import {
  evaluate4StateRowStatus,
  formatBirthDateWithDocLabel,
  reconcileStudentDataFromPrimarySources,
  normalizeAttendanceMonthKey,
  type UnifiedFieldComparisonRow,
  type ReconciliationLogItem,
} from "@/lib/validation/crossDocumentEngine";
import { extractNameComponents } from "@/lib/validation/nameComparison";
import { levenshteinDistance } from "@/lib/validation/studentMatcher";
import { normalizeObservedValueMarking } from "@/lib/validation/gradeUtils";

function areLearnerNamesMatching(
  cand: { lastName?: string; firstName?: string; middleName?: string; fullName?: string },
  target: { lastName?: string; firstName?: string; middleName?: string; fullName?: string }
): boolean {
  const normCand = extractNameComponents(cand);
  const normTarget = extractNameComponents(target);

  if (normCand.lastName && normTarget.lastName) {
    const lastA = normCand.lastName;
    const lastB = normTarget.lastName;
    const isExactLast = lastA === lastB;
    const maxLenLast = Math.max(lastA.length, lastB.length);
    const distLast = levenshteinDistance(lastA, lastB);
    const isLastMatch = isExactLast || distLast <= (maxLenLast >= 6 ? 2 : 1);
    if (!isLastMatch) return false;
  } else {
    return false;
  }

  if (normCand.firstName && normTarget.firstName) {
    const firstA = normCand.firstName;
    const firstB = normTarget.firstName;
    const isExactFirst = firstA === firstB || firstA.includes(firstB) || firstB.includes(firstA);
    const wordsA = firstA.split(" ");
    const wordsB = firstB.split(" ");
    const hasOverlap = wordsA.some((w) => wordsB.includes(w));
    const maxLenFirst = Math.max(firstA.length, firstB.length);
    const distFirst = levenshteinDistance(firstA, firstB);
    const isFirstMatch = isExactFirst || hasOverlap || distFirst <= (maxLenFirst >= 6 ? 2 : 1);
    if (!isFirstMatch) return false;
  } else {
    return false;
  }

  if (normCand.middleName && normTarget.middleName) {
    const midA = normCand.middleName;
    const midB = normTarget.middleName;
    const isExactMid = midA === midB;
    const isInitial = (midA.length === 1 && midB.startsWith(midA)) || (midB.length === 1 && midA.startsWith(midB));
    const maxLenMid = Math.max(midA.length, midB.length);
    const distMid = levenshteinDistance(midA, midB);
    const isMidMatch = isExactMid || isInitial || distMid <= (maxLenMid >= 6 ? 2 : 1);
    if (!isMidMatch) return false;
  }

  return true;
}

export type UnifiedWorkflowStage =
  | "stage_a" // Stage A: Uploaded Documents
  | "stage_b" // Stage B: Individual Extraction Results
  | "stage_c" // Stage C: Unified Learner Identity Matching
  | "stage_d" // Stage D: Unified Cross-Document Comparison
  | "stage_e"; // Stage E: Discrepancies and Human Review

export const CANONICAL_DOC_ORDER: Record<string, number> = {
  sf1: 1,
  sf2: 2,
  sf9: 3,
  sf10: 4,
  birth_cert: 5,
  psa: 5,
};

interface UnifiedBatchResultsViewProps {
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
  persistenceWarnings?: string[];
  reconciledDossiers?: Record<string, { dossier: LearnerValidationDossier; log: ReconciliationLogItem[] }>;
  onReconciledDossiersChange?: (
    dossiers: Record<string, { dossier: LearnerValidationDossier; log: ReconciliationLogItem[] }>
  ) => void;
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
  persistenceWarnings = [],
  reconciledDossiers: propReconciledDossiers,
  onReconciledDossiersChange,
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

  const [internalReconciledDossiers, setInternalReconciledDossiers] = useState<
    Record<string, { dossier: LearnerValidationDossier; log: ReconciliationLogItem[] }>
  >({});
  const reconciledDossiers = propReconciledDossiers || internalReconciledDossiers;
  const [reconcileAuditOpen, setReconcileAuditOpen] = useState<Record<string, boolean>>({});

  const handleFixStudentData = (dossierKey: string, targetDossier: LearnerValidationDossier) => {
    const reconciled = reconcileStudentDataFromPrimarySources(targetDossier);
    const cleanDossier = { ...reconciled };
    delete (cleanDossier as any).reconciledDossier;
    delete (cleanDossier as any).previousDossier;
    const next = {
      ...reconciledDossiers,
      [dossierKey]: {
        dossier: cleanDossier as unknown as LearnerValidationDossier,
        log: reconciled.reconciliationLog || [],
      },
    };
    if (onReconciledDossiersChange) {
      onReconciledDossiersChange(next);
    } else {
      setInternalReconciledDossiers(next);
    }
    setReconcileAuditOpen((prev) => ({
      ...prev,
      [dossierKey]: true,
    }));
  };

  const handleRevertStudentData = (dossierKey: string) => {
    const next = { ...reconciledDossiers };
    delete next[dossierKey];
    if (onReconciledDossiersChange) {
      onReconciledDossiersChange(next);
    } else {
      setInternalReconciledDossiers(next);
    }
  };

  const toggleAuditOpen = (dossierKey: string) => {
    setReconcileAuditOpen((prev) => ({
      ...prev,
      [dossierKey]: !prev[dossierKey],
    }));
  };

  const toggleDossierCv = (indexStr: string) => {
    setExpandedCvIndex((prev) => ({
      ...prev,
      [indexStr]: !prev[indexStr],
    }));
  };

  const { summary, categorizedResults, learnerDossiers: rawLearnerDossiers = [] } = report;

  const learnerDossiers = useMemo(() => {
    const rawList = rawLearnerDossiers || [];
    const mergedList: LearnerValidationDossier[] = [];

    const filterAndDeduplicateMatrix = (matrix: UnifiedFieldComparisonRow[]) => {
      const seenMonths = new Set<string>();
      return (matrix || [])
        .filter((row) => row.field !== "mother_maiden_name" && row.label !== "Mother's Maiden Name")
        .filter((row) => {
          if (row.category === "ATTENDANCE" || row.field.startsWith("attendance_")) {
            const mKey = normalizeAttendanceMonthKey(row.field.replace(/^attendance_/, "") || row.label || "");
            if (mKey && mKey !== "total" && mKey !== "annual_summary") {
              if (seenMonths.has(mKey)) return false;
              seenMonths.add(mKey);
            }
          }
          return true;
        })
        .map((row) => ({
          ...row,
          status: evaluate4StateRowStatus(row),
          isMatch: evaluate4StateRowStatus(row) === "MATCH",
        }));
    };

    for (const d of rawList) {
      const existing = mergedList.find((m) =>
        areLearnerNamesMatching(
          { lastName: m.lastName, firstName: m.firstName, middleName: m.middleName, fullName: m.fullName },
          { lastName: d.lastName, firstName: d.firstName, middleName: d.middleName, fullName: d.fullName }
        )
      );
      if (existing) {
        // Merge matched sources across all 5 forms
        existing.matchedSources = {
          ...existing.matchedSources,
          ...(d.matchedSources.sf1 ? { sf1: d.matchedSources.sf1 } : {}),
          ...(d.matchedSources.sf2 ? { sf2: d.matchedSources.sf2 } : {}),
          ...(d.matchedSources.sf9 ? { sf9: d.matchedSources.sf9 } : {}),
          ...(d.matchedSources.sf10 ? { sf10: d.matchedSources.sf10 } : {}),
          ...(d.matchedSources.psa ? { psa: d.matchedSources.psa } : {}),
        };
        existing.documentPresence = {
          ...existing.documentPresence,
          sf1: existing.documentPresence.sf1 || d.documentPresence.sf1,
          sf2: existing.documentPresence.sf2 || d.documentPresence.sf2,
          sf9: existing.documentPresence.sf9 || d.documentPresence.sf9,
          sf10: existing.documentPresence.sf10 || d.documentPresence.sf10,
          psa: existing.documentPresence.psa || d.documentPresence.psa,
          totalAvailable: [
            existing.documentPresence.sf1 || d.documentPresence.sf1,
            existing.documentPresence.sf2 || d.documentPresence.sf2,
            existing.documentPresence.sf9 || d.documentPresence.sf9,
            existing.documentPresence.sf10 || d.documentPresence.sf10,
            existing.documentPresence.psa || d.documentPresence.psa,
          ].filter(Boolean).length,
        };
        if ((!existing.lrn || existing.lrn.startsWith("UNREGISTERED")) && d.lrn && !d.lrn.startsWith("UNREGISTERED")) {
          existing.lrn = d.lrn;
        }
        if (d.unifiedMatrix && existing.unifiedMatrix) {
          for (const dRow of d.unifiedMatrix) {
            if (dRow.field === "mother_maiden_name" || dRow.label === "Mother's Maiden Name") continue;
            const eRow = existing.unifiedMatrix.find((r) => r.field === dRow.field);
            if (eRow) {
              if (eRow.psaValue === undefined && dRow.psaValue !== undefined) eRow.psaValue = dRow.psaValue;
              if (eRow.sf1Value === undefined && dRow.sf1Value !== undefined) eRow.sf1Value = dRow.sf1Value;
              if (eRow.sf2Value === undefined && dRow.sf2Value !== undefined) eRow.sf2Value = dRow.sf2Value;
              if (eRow.sf9Value === undefined && dRow.sf9Value !== undefined) eRow.sf9Value = dRow.sf9Value;
              if (eRow.sf10Value === undefined && dRow.sf10Value !== undefined) eRow.sf10Value = dRow.sf10Value;
              eRow.status = evaluate4StateRowStatus(eRow);
              eRow.isMatch = eRow.status === "MATCH";
            } else {
              existing.unifiedMatrix.push({
                ...dRow,
                status: evaluate4StateRowStatus(dRow),
                isMatch: evaluate4StateRowStatus(dRow) === "MATCH",
              });
            }
          }
          existing.unifiedMatrix = filterAndDeduplicateMatrix(existing.unifiedMatrix);
        }
      } else {
        mergedList.push({
          ...d,
          unifiedMatrix: filterAndDeduplicateMatrix(d.unifiedMatrix || []),
        });
      }
    }
    return mergedList;
  }, [rawLearnerDossiers]);
  const rawSegments =
    propSegments && propSegments.length > 0
      ? propSegments
      : report.segments && report.segments.length > 0
      ? report.segments
      : [];
  const segments = useMemo(() => {
    const sorted = [...rawSegments].sort((a, b) => {
      const orderA = CANONICAL_DOC_ORDER[a.documentType?.toLowerCase()] ?? 99;
      const orderB = CANONICAL_DOC_ORDER[b.documentType?.toLowerCase()] ?? 99;
      return orderA - orderB;
    });

    // Unify any split SF9 segments if multiple exist in the raw list
    const sf9Segments = sorted.filter((s) => s.documentType === "sf9");
    if (sf9Segments.length > 1) {
      const primarySf9 = sf9Segments[0];
      const allSf9Pages = sf9Segments.flatMap((s) => s.pages || []);
      const mergedSf9: DocumentSegment = {
        ...primarySf9,
        pageCount: allSf9Pages.length || primarySf9.pageCount,
        pageNumbers: Array.from(new Set(sf9Segments.flatMap((s) => s.pageNumbers || []))).sort((a, b) => a - b),
        pages: allSf9Pages,
        combinedText: sf9Segments.map((s) => s.combinedText).filter(Boolean).join("\n\n"),
      };
      const nonSf9 = sorted.filter((s) => s.documentType !== "sf9");
      return [...nonSf9, mergedSf9].sort((a, b) => {
        const orderA = CANONICAL_DOC_ORDER[a.documentType?.toLowerCase()] ?? 99;
        const orderB = CANONICAL_DOC_ORDER[b.documentType?.toLowerCase()] ?? 99;
        return orderA - orderB;
      });
    }

    return sorted;
  }, [rawSegments]);

  // Synthesize fallback extracted data if prop is empty
  const effectiveExtractedData: Record<string, any> = { ...propExtractedData };
  for (const seg of segments) {
    if (!effectiveExtractedData[seg.id]) {
      const isSf9 = seg.documentType === "sf9";
      const sf9Source = isSf9 ? learnerDossiers.map((d) => d.matchedSources.sf9?.raw).find(Boolean) : null;
      effectiveExtractedData[seg.id] = {
        document_type: seg.documentType,
        form_title: seg.formTitle,
        school_year: report.schoolYear,
        grade_level: report.gradeLevel,
        section: report.section,
        ...(sf9Source ? {
          grades: sf9Source.grades || [],
          first_semester_grades: sf9Source.first_semester_grades || sf9Source.firstSemesterSubjects,
          firstSemesterSubjects: sf9Source.firstSemesterSubjects || sf9Source.first_semester_grades,
          second_semester_grades: sf9Source.second_semester_grades || sf9Source.secondSemesterSubjects,
          secondSemesterSubjects: sf9Source.secondSemesterSubjects || sf9Source.second_semester_grades,
          shs_semesters: sf9Source.shs_semesters,
          attendance: sf9Source.attendance,
          attendance_months: sf9Source.attendance_months,
          attendance_totals: sf9Source.attendance_totals,
          attendance_percentage: sf9Source.attendance_percentage,
          absence_percentage: sf9Source.absence_percentage,
          attendance_risk_status: sf9Source.attendance_risk_status,
          attendance_discrepancy_details: sf9Source.attendance_discrepancy_details,
          general_average: sf9Source.general_average,
          first_semester_general_average: sf9Source.first_semester_general_average ?? sf9Source.sem1_general_average,
          second_semester_general_average: sf9Source.second_semester_general_average ?? sf9Source.sem2_general_average,
          sem1_general_average: sf9Source.sem1_general_average ?? sf9Source.first_semester_general_average,
          sem1_printed_general_average: sf9Source.sem1_printed_general_average,
          sem2_general_average: sf9Source.sem2_general_average ?? sf9Source.second_semester_general_average,
          sem2_printed_general_average: sf9Source.sem2_printed_general_average,
          identity: sf9Source.identity,
          observed_values: sf9Source.observed_values,
          name: sf9Source.name,
          lrn: sf9Source.lrn,
        } : {}),
        learners: learnerDossiers
          .map((d) => {
            const src =
              seg.documentType === "sf1"
                ? d.matchedSources.sf1
                : seg.documentType === "sf2"
                ? d.matchedSources.sf2
                : seg.documentType === "sf9"
                ? d.matchedSources.sf9
                : seg.documentType === "sf10"
                ? d.matchedSources.sf10
                : seg.documentType === "birth_cert"
                ? d.matchedSources.psa
                : null;
            return src?.raw;
          })
          .filter(Boolean),
      };
    } else if (seg.documentType === "sf9") {
      // Ensure SF9 existing data has grades and attendance if missing
      const cur = effectiveExtractedData[seg.id] || {};
      const sf9Source = learnerDossiers.map((d) => d.matchedSources.sf9?.raw).find(Boolean);
      if (sf9Source) {
        if (!cur.grades || (Array.isArray(cur.grades) && cur.grades.length === 0)) {
          cur.grades = sf9Source.grades || [];
        }
        if (!cur.first_semester_grades && (sf9Source.first_semester_grades || sf9Source.firstSemesterSubjects)) {
          cur.first_semester_grades = sf9Source.first_semester_grades || sf9Source.firstSemesterSubjects;
          cur.firstSemesterSubjects = sf9Source.firstSemesterSubjects || sf9Source.first_semester_grades;
        }
        if (!cur.second_semester_grades && (sf9Source.second_semester_grades || sf9Source.secondSemesterSubjects)) {
          cur.second_semester_grades = sf9Source.second_semester_grades || sf9Source.secondSemesterSubjects;
          cur.secondSemesterSubjects = sf9Source.secondSemesterSubjects || sf9Source.second_semester_grades;
        }
        if (!cur.shs_semesters && sf9Source.shs_semesters) {
          cur.shs_semesters = sf9Source.shs_semesters;
        }
        if (cur.first_semester_general_average === undefined && (sf9Source.first_semester_general_average !== undefined || sf9Source.sem1_general_average !== undefined)) {
          cur.first_semester_general_average = sf9Source.first_semester_general_average ?? sf9Source.sem1_general_average;
        }
        if (cur.second_semester_general_average === undefined && (sf9Source.second_semester_general_average !== undefined || sf9Source.sem2_general_average !== undefined)) {
          cur.second_semester_general_average = sf9Source.second_semester_general_average ?? sf9Source.sem2_general_average;
        }
        if (cur.sem1_general_average === undefined && sf9Source.sem1_general_average !== undefined) {
          cur.sem1_general_average = sf9Source.sem1_general_average;
        }
        if (cur.sem2_general_average === undefined && sf9Source.sem2_general_average !== undefined) {
          cur.sem2_general_average = sf9Source.sem2_general_average;
        }
        if (!cur.general_average && sf9Source.general_average) {
          cur.general_average = sf9Source.general_average;
        }
        if (!cur.observed_values && sf9Source.observed_values) {
          cur.observed_values = sf9Source.observed_values;
        }
        if (!cur.attendance && sf9Source.attendance) {
          cur.attendance = sf9Source.attendance;
        }
        if (!cur.attendance_totals && sf9Source.attendance_totals) {
          cur.attendance_totals = sf9Source.attendance_totals;
        }
        if (!cur.attendance_months && sf9Source.attendance_months) {
          cur.attendance_months = sf9Source.attendance_months;
        }
        if (cur.attendance_percentage === undefined && sf9Source.attendance_percentage !== undefined) {
          cur.attendance_percentage = sf9Source.attendance_percentage;
        }
        if (cur.absence_percentage === undefined && sf9Source.absence_percentage !== undefined) {
          cur.absence_percentage = sf9Source.absence_percentage;
        }
        if (!cur.attendance_risk_status && sf9Source.attendance_risk_status) {
          cur.attendance_risk_status = sf9Source.attendance_risk_status;
        }
        if (!cur.attendance_discrepancy_details && sf9Source.attendance_discrepancy_details) {
          cur.attendance_discrepancy_details = sf9Source.attendance_discrepancy_details;
        }
        if (!cur.identity && sf9Source.identity) {
          cur.identity = sf9Source.identity;
        }
        if (!cur.name && sf9Source.name) {
          cur.name = sf9Source.name;
        }
        if (!cur.lrn && sf9Source.lrn) {
          cur.lrn = sf9Source.lrn;
        }
      }
      effectiveExtractedData[seg.id] = cur;
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

  const isBlankVal = (v: any) =>
    v === undefined ||
    v === null ||
    String(v).trim() === "" ||
    String(v).trim() === "—" ||
    String(v).trim() === "-" ||
    String(v).trim().toLowerCase() === "blank" ||
    String(v).trim().toLowerCase() === "null" ||
    String(v).trim().toLowerCase() === "undefined";

  const renderCellValue = (val: any) => {
    if (isBlankVal(val)) {
      return <span className="text-slate-300 dark:text-slate-600 font-mono text-[11px]">—</span>;
    }
    if (typeof val === "boolean") {
      return <span className="font-mono text-xs font-semibold">{val ? "Yes" : "No"}</span>;
    }
    if (String(val).includes("Civil Document")) {
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
          {String(val)}
        </span>
      );
    }
    return <span className="font-medium text-xs text-slate-800 dark:text-slate-200">{String(val)}</span>;
  };

  const isBirthDateRow = (row: UnifiedFieldComparisonRow) =>
    row.field === "birth_date" ||
    row.field === "date_of_birth" ||
    row.label?.toLowerCase().includes("date of birth") ||
    row.label?.toLowerCase().includes("birth date");

  const renderMatrixCell = (val: any, docLabel: string, isBirthDate: boolean) => {
    if (isBlankVal(val)) {
      return <span className="text-slate-300 dark:text-slate-600 font-mono text-[11px]">—</span>;
    }
    if (isBirthDate) {
      const formatted = formatBirthDateWithDocLabel(val, docLabel);
      return <span className="font-medium text-xs text-slate-800 dark:text-slate-200">{formatted}</span>;
    }
    return renderCellValue(val);
  };

  const getRowStatusBadge = (status: string, row?: UnifiedFieldComparisonRow) => {
    const computedStatus = row ? evaluate4StateRowStatus(row) : status;
    const finalStatus = computedStatus === "NO_DATA" ? "NO DATA" : computedStatus;
    switch (finalStatus) {
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
      case "INCOMPLETE":
      case "NEEDS_VERIFICATION":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" /> INCOMPLETE
          </span>
        );
      case "NO DATA":
      case "NOT_APPLICABLE":
      case "INCOMPLETE_COVERAGE":
      case "MISSING_SOURCE":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            NO DATA
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

  const hasAnySf9BlankGradeError =
    learnerDossiers.some((d) => {
      const sf9 = d.matchedSources.sf9?.raw;
      if (!sf9) return false;
      if (sf9.has_blank_grade_error) return true;
      const grades = Array.isArray(sf9.grades) ? sf9.grades : [];
      if (grades.length === 0) return false;
      const hasBlankSubj = grades.some((g: any) => isBlankVal(g.final ?? g.final_grade ?? g.sem1_final_grade ?? g.sem2_final_grade));
      const hasBlankAvg = isBlankVal(sf9.general_average);
      return hasBlankSubj || hasBlankAvg;
    }) ||
    segments.some((seg) => {
      if (seg.documentType !== "sf9") return false;
      const data = effectiveExtractedData[seg.id];
      if (!data) return false;
      if (data.has_blank_grade_error) return true;
      const grades = Array.isArray(data.grades) ? data.grades : [];
      if (grades.length === 0) return false;
      const hasBlankSubj = grades.some((g: any) => isBlankVal(g.final ?? g.final_grade ?? g.sem1_final_grade ?? g.sem2_final_grade));
      const hasBlankAvg = isBlankVal(data.general_average);
      return hasBlankSubj || hasBlankAvg;
    });

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
            {segments.length} document{segments.length > 1 ? "s" : ""} extracted individually • {summary.totalLearnersDetected} learners correlated across records •{" "}
            {Object.keys(reconciledDossiers).length > 0
              ? `${summary.totalLearnersDetected || 1} consistent profile • All Verified`
              : `${summary.consistentRecordsCount} consistent profiles.`}
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
              {(uploadedFiles.length > 0 ? uploadedFiles : segments.map((s: any) => ({
                name: s.sourceFileName || "Document.pdf",
                size: `${s.pageCount} page(s)`,
                type: s.documentType.toUpperCase(),
                dataUrl: s.imageUrl || "",
                pageCount: s.pageCount,
              }))).map((file: any, fIdx: number) => (
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
          batchContext={{
            section: report?.section,
            gradeLevel: report?.gradeLevel,
            schoolYear: report?.schoolYear,
          }}
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

          {/* Blank Grade Error Alert */}
          {hasAnySf9BlankGradeError && (
            <div
              data-testid="sf9-blank-grade-error"
              className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-2 text-xs"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold">Blank Grade Error:</strong> One or more Final Grades or Semester General Averages are blank on the uploaded SF9 Back card.
              </div>
            </div>
          )}

          {/* Teacher-Friendly Error & Status Legends Header */}
          <div
            data-testid="sf9-error-legends"
            className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 text-xs space-y-2"
          >
            <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 text-[11px] uppercase tracking-wider">
              <Info className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>SF9 Academic &amp; Clearance Status Guide (Teacher Reference)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1 text-[11px] leading-relaxed">
              <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200">
                <div className="flex items-center gap-1.5 font-bold mb-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Blank Grade Error</span>
                </div>
                <p className="text-amber-800/90 dark:text-amber-300/90 text-[10.5px]">
                  Triggered when one or more subject <strong className="font-semibold">FINAL</strong> grades or <strong className="font-semibold">General Average for the Semester</strong> boxes are left blank on the uploaded SF9 card (no automatic grade calculation is performed).
                </p>
              </div>

              <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200">
                <div className="flex items-center gap-1.5 font-bold mb-1">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                    Blank / Incomplete
                  </span>
                </div>
                <p className="text-amber-800/90 dark:text-amber-300/90 text-[10.5px]">
                  Indicates an empty/unwritten grade cell on the form that requires teacher completion before final clearance.
                </p>
              </div>

              <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200">
                <div className="flex items-center gap-1.5 font-bold mb-1">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                    Passed / Failed
                  </span>
                </div>
                <p className="text-emerald-800/90 dark:text-emerald-300/90 text-[10.5px]">
                  Official DepEd remark displayed only when an explicit numeric grade (<strong className="font-semibold">&gt;= 75 Passed, &lt; 75 Failed</strong>) is written on the card.
                </p>
              </div>
            </div>
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
                  {getVisibleDossiers().map((rawD) => {
                    const dossierKey = rawD.lrn || rawD.fullName;
                    const reconciledEntry = reconciledDossiers[dossierKey];
                    const d = reconciledEntry ? reconciledEntry.dossier : rawD;
                    const isFixed = Boolean(reconciledEntry);
                    const isExpanded = expandedDossierLrn === dossierKey;
                    const sf9Data = d.matchedSources.sf9?.raw;
                    const ovData = sf9Data?.observed_values;
                    const achData = sf9Data?.learner_progress_achievement || sf9Data?.grading_scale;

                    return (
                      <React.Fragment key={dossierKey}>
                        <tr
                          onClick={() =>
                            setExpandedDossierLrn(isExpanded ? null : dossierKey)
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
                            {isFixed ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> MATCHED / VERIFIED
                              </span>
                            ) : (
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
                            )}
                          </td>

                          {/* Discrepancies Count */}
                          <td className="py-3 px-4 text-right font-medium">
                            {isFixed ? (
                              <span className="text-emerald-600 font-medium">Reconciled (0 issues)</span>
                            ) : d.discrepancies.length > 0 ? (
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
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-1">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDossierViewTab((prev) => ({ ...prev, [dossierKey]: "matrix" }))
                                    }
                                    className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                      (dossierViewTab[dossierKey] || "matrix") === "matrix"
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
                                      setDossierViewTab((prev) => ({ ...prev, [dossierKey]: "sources" }))
                                    }
                                    className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                      dossierViewTab[dossierKey] === "sources"
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
                                        [dossierKey]: "observed_values",
                                      }))
                                    }
                                    className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                      dossierViewTab[dossierKey] === "observed_values"
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
                                        [dossierKey]: "discrepancies",
                                      }))
                                    }
                                    className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-1.5 ${
                                      dossierViewTab[dossierKey] === "discrepancies"
                                        ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                                        : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                    }`}
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                    <span>Discrepancies ({d.discrepancies.length})</span>
                                  </button>
                                </div>

                                {/* Top Matrix Header Action: One-Click Fix Student Data Button */}
                                <div className="ml-auto flex items-center gap-2 pb-1.5">
                                  {!isFixed ? (
                                    <button
                                      type="button"
                                      onClick={() => handleFixStudentData(dossierKey, rawD)}
                                      title="Pull baseline data from Primary Sources — SF1: LRN • PSA: Full Name, Sex, Birthday • SF9: Grades"
                                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 cursor-pointer"
                                    >
                                      <Sparkles className="w-3.5 h-3.5" />
                                      <span>
                                        Fix Student Data
                                        {(() => {
                                          const count = (d.unifiedMatrix || []).filter(
                                            (r) => r.status === "MISMATCH" || r.status === "INCOMPLETE"
                                          ).length || d.discrepancies.length;
                                          return count > 0 ? ` (${count})` : "";
                                        })()}
                                      </span>
                                    </button>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <span
                                        title="Pull baseline data from Primary Sources — SF1: LRN • PSA: Full Name, Sex, Birthday • SF9: Grades"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 cursor-default"
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                        ✓ Student Data Fixed (All Matched)
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => toggleAuditOpen(dossierKey)}
                                        className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                                      >
                                        {reconcileAuditOpen[dossierKey] ? "Hide Summary" : "Primary Source Summary"} ({reconciledEntry.log.length})
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* View 1: Unified Comparison Matrix */}
                              {(dossierViewTab[dossierKey] || "matrix") === "matrix" && (
                                <div className="space-y-3">
                                  {/* Collapsible Primary Source Reconciliation Summary */}
                                  {isFixed && (
                                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5 space-y-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                          <span className="p-1 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
                                            <CheckCircle2 className="w-4 h-4" />
                                          </span>
                                          <div>
                                            <h5 className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                                              Primary Source Reconciliation Summary
                                            </h5>
                                            <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                                              Fields reconciled from uploaded Primary Source Documents: SF1 (LRN & Enrollment), PSA (Civil Identity), and SF9 (Grades & Attendance Baseline).
                                            </p>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleRevertStudentData(dossierKey)}
                                            className="text-xs h-7 px-2.5 text-slate-600 hover:text-rose-600 border-slate-300 dark:border-slate-700 flex items-center gap-1 cursor-pointer"
                                          >
                                            <RotateCcw className="w-3 h-3" /> Revert Changes
                                          </Button>
                                          <button
                                            type="button"
                                            onClick={() => toggleAuditOpen(dossierKey)}
                                            className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:underline cursor-pointer"
                                          >
                                            {reconcileAuditOpen[dossierKey] ? "Collapse Summary" : `View ${reconciledEntry.log.length} Reconciled Fields`}
                                          </button>
                                        </div>
                                      </div>

                                      {reconcileAuditOpen[dossierKey] && reconciledEntry.log.length > 0 && (
                                        <div className="overflow-x-auto rounded-lg border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900">
                                          <table className="w-full text-left text-xs">
                                            <thead className="bg-emerald-100/60 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 text-[10px] font-bold uppercase tracking-wider">
                                              <tr>
                                                <th className="py-2 px-3">Field Name</th>
                                                <th className="py-2 px-3 text-center">Primary Source</th>
                                                <th className="py-2 px-3">Baseline Value</th>
                                                <th className="py-2 px-3">Updated Form(s)</th>
                                                <th className="py-2 px-3 text-center">Previous Status</th>
                                                <th className="py-2 px-3 text-center">Reconciled Status</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-emerald-100 dark:divide-emerald-900/50">
                                              {reconciledEntry.log.map((item, idx) => (
                                                <tr key={idx} className="hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30">
                                                  <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                                                    {item.fieldName}
                                                  </td>
                                                  <td className="py-2 px-3 text-center">
                                                    <span
                                                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                        item.primarySource === "SF1"
                                                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-900 dark:text-emerald-200"
                                                          : item.primarySource === "PSA"
                                                          ? "bg-purple-100 text-purple-800 border border-purple-300 dark:bg-purple-900 dark:text-purple-200"
                                                          : "bg-indigo-100 text-indigo-800 border border-indigo-300 dark:bg-indigo-900 dark:text-indigo-200"
                                                      }`}
                                                    >
                                                      {item.primarySource}
                                                    </span>
                                                  </td>
                                                  <td className="py-2 px-3 font-mono font-medium text-slate-700 dark:text-slate-300">
                                                    {item.baselineValue}
                                                  </td>
                                                  <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                                                    {item.updatedForms.join(", ")}
                                                  </td>
                                                  <td className="py-2 px-3 text-center">
                                                    <span
                                                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                        item.previousStatus === "MISMATCH"
                                                          ? "bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-950 dark:text-rose-300"
                                                          : "bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950 dark:text-amber-300"
                                                      }`}
                                                    >
                                                      {item.previousStatus}
                                                    </span>
                                                  </td>
                                                  <td className="py-2 px-3 text-center">
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300">
                                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> MATCH
                                                    </span>
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900">
                                    <table className="w-full text-left text-xs">
                                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 text-[10px] font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                                        <tr>
                                          <th className="py-2 px-3">Field Name</th>
                                          <th className="py-2 px-2 text-center">PSA</th>
                                          <th className="py-2 px-2 text-center">SF1</th>
                                          <th className="py-2 px-2 text-center">SF2</th>
                                          <th className="py-2 px-2 text-center">SF9</th>
                                          <th className="py-2 px-2 text-center">SF10</th>
                                          <th className="py-2 px-3 text-center">Status</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {(d.unifiedMatrix || []).map((row, rIdx) => {
                                          const isDob = isBirthDateRow(row);
                                          const fLower = (row.field || "").toLowerCase();
                                          const catUpper = (row.category || "").toUpperCase();
                                          const isDepEdOnly =
                                            catUpper === "SCHOOL_CONTEXT" ||
                                            catUpper === "ATTENDANCE" ||
                                            catUpper === "ACADEMIC" ||
                                            catUpper === "PROMOTION" ||
                                            fLower === "school_id" ||
                                            fLower === "school_year" ||
                                            fLower === "grade_level" ||
                                            fLower === "section" ||
                                            fLower === "track_strand" ||
                                            fLower.startsWith("attendance_") ||
                                            fLower.startsWith("grade_") ||
                                            fLower === "general_average";
                                          const psaVal =
                                            row.psaValue ??
                                            (isDepEdOnly && (d.documentPresence?.psa || Boolean(d.matchedSources?.psa))
                                              ? "Civil Document (N/A)"
                                              : undefined);
                                          return (
                                            <tr key={rIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                              <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                                                {row.label || row.field}
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                {renderMatrixCell(psaVal, "PSA", isDob)}
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                {renderMatrixCell(row.sf1Value, "SF1", isDob)}
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                {renderMatrixCell(row.sf2Value, "SF2", isDob)}
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                {renderMatrixCell(row.sf9Value, "SF9", isDob)}
                                              </td>
                                              <td className="py-2 px-2 text-center">
                                                {renderMatrixCell(row.sf10Value, "SF10", isDob)}
                                              </td>
                                              <td className="py-2 px-3 text-center">
                                                {getRowStatusBadge(row.status, row)}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* View 2: Extracted Data From Sources */}
                              {dossierViewTab[dossierKey] === "sources" && (
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
                                        <div className="flex items-center gap-2">
                                          {((d.matchedSources.sf2.raw?.overallRowAccuracy ?? d.matchedSources.sf2.raw?.rowAccuracyPercent) !== undefined) && (
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                              (d.matchedSources.sf2.raw?.overallRowAccuracy ?? d.matchedSources.sf2.raw?.rowAccuracyPercent) >= 85
                                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                                : (d.matchedSources.sf2.raw?.overallRowAccuracy ?? d.matchedSources.sf2.raw?.rowAccuracyPercent) >= 65
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                                : "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                                            }`}>
                                              {d.matchedSources.sf2.raw?.overallRowAccuracy ?? d.matchedSources.sf2.raw?.rowAccuracyPercent}% accuracy
                                            </span>
                                          )}
                                          <span className="font-mono text-[10px] text-slate-400">
                                            P{d.matchedSources.sf2.pageNumber ?? 1}:R{d.matchedSources.sf2.raw?.row_index ?? "—"}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="space-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                                        <div>Month: <span className="font-bold">{(d.matchedSources.sf2 as any)?.month || d.matchedSources.sf2.raw?.month || "June"}</span></div>
                                        <div>
                                          Present: <span className="font-bold text-emerald-600">{d.matchedSources.sf2.raw?.days_present ?? d.matchedSources.sf2.raw?.total_present ?? "—"}</span>
                                          {" • "}Absent: <span className="font-bold text-rose-600">{d.matchedSources.sf2.raw?.days_absent ?? d.matchedSources.sf2.raw?.total_absent ?? "0"}</span>
                                          {((d.matchedSources.sf2.raw?.days_tardy ?? d.matchedSources.sf2.raw?.gridTardyCount ?? d.matchedSources.sf2.raw?.writtenTardy) !== undefined) && (
                                            <>
                                              {" • "}Tardy: <span className="font-bold text-amber-600">{d.matchedSources.sf2.raw?.days_tardy ?? d.matchedSources.sf2.raw?.gridTardyCount ?? d.matchedSources.sf2.raw?.writtenTardy ?? 0}</span>
                                            </>
                                          )}
                                          {d.matchedSources.sf2.raw?.total_school_days !== undefined && (
                                            <>
                                              {" • "}Total Days: <span className="font-bold text-slate-600 dark:text-slate-400">{d.matchedSources.sf2.raw?.total_school_days}</span>
                                            </>
                                          )}
                                        </div>
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
                                        <div>General Average: <span className="font-bold text-amber-700">{d.matchedSources.sf9.raw?.general_average ?? "Blank"}</span></div>
                                        <div>Subject Count: {Array.isArray(d.matchedSources.sf9.raw?.grades) ? d.matchedSources.sf9.raw.grades.length : 0}</div>
                                      </div>
                                      {(Boolean(d.matchedSources.sf9.raw?.has_blank_grade_error) ||
                                        (Array.isArray(d.matchedSources.sf9.raw?.grades) && d.matchedSources.sf9.raw.grades.length > 0 &&
                                          (d.matchedSources.sf9.raw.grades.some((g: any) => isBlankVal(g.final ?? g.final_grade ?? g.sem1_final_grade ?? g.sem2_final_grade)) ||
                                           isBlankVal(d.matchedSources.sf9.raw.general_average)))) && (
                                        <div
                                          data-testid="sf9-blank-grade-error"
                                          className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-1.5 text-[11px] mt-2"
                                        >
                                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                          <span>Blank Grade Error: One or more Final Grades or Semester General Averages are blank on the uploaded SF9 Back card.</span>
                                        </div>
                                      )}
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
                              {dossierViewTab[dossierKey] === "observed_values" && (
                                <div className="space-y-3">
                                  {ovData ? (
                                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
                                      <div className="flex items-center justify-between">
                                        <h5 className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                                          <Heart className="w-3.5 h-3.5 text-rose-500" />
                                          <span>Report on Learner&apos;s Observed Values</span>
                                        </h5>
                                        <div className="flex items-center gap-1.5 text-[10px] font-mono">
                                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">AO</span>
                                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-bold">SO</span>
                                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-bold">RO</span>
                                          <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold">NO</span>
                                        </div>
                                      </div>
                                      {(() => {
                                        const renderBadge = (val: any) => {
                                          const norm = normalizeObservedValueMarking(val?.normalized_rating ?? val?.original_mark ?? val);
                                          if (!norm) return <span className="text-slate-400 font-mono text-xs">—</span>;
                                          const cls =
                                            norm === "AO"
                                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400"
                                              : norm === "SO"
                                              ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400"
                                              : norm === "RO"
                                              ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400"
                                              : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400";
                                          return (
                                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${cls}`}>
                                              {norm}
                                            </span>
                                          );
                                        };

                                        const groups = Array.isArray(ovData.core_values) && ovData.core_values.length > 0
                                          ? ovData.core_values
                                          : null;

                                        if (groups) {
                                          return (
                                            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                                              <table className="w-full text-xs text-left">
                                                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase text-[10px] font-bold border-b border-slate-200 dark:border-slate-800">
                                                  <tr>
                                                    <th className="py-2 px-3">Core Values</th>
                                                    <th className="py-2 px-3">Behavior Statements</th>
                                                    <th className="py-2 px-2 text-center w-12">Q1</th>
                                                    <th className="py-2 px-2 text-center w-12">Q2</th>
                                                    <th className="py-2 px-2 text-center w-12">Q3</th>
                                                    <th className="py-2 px-2 text-center w-12">Q4</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                  {groups.map((group: any, gIdx: number) =>
                                                    (group.statements || []).map((stmt: any, sIdx: number) => (
                                                      <tr key={`${gIdx}-${sIdx}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                                        {sIdx === 0 && (
                                                          <td
                                                            rowSpan={group.statements.length}
                                                            className="py-2 px-3 font-bold text-slate-900 dark:text-slate-100 bg-slate-50/30 dark:bg-slate-800/20 align-top border-r border-slate-100 dark:border-slate-800"
                                                          >
                                                            {group.name}
                                                          </td>
                                                        )}
                                                        <td className="py-2 px-3 text-slate-700 dark:text-slate-300 font-medium">
                                                          {stmt.statement}
                                                        </td>
                                                        <td className="py-2 px-2 text-center">{renderBadge(stmt.q1)}</td>
                                                        <td className="py-2 px-2 text-center">{renderBadge(stmt.q2)}</td>
                                                        <td className="py-2 px-2 text-center">{renderBadge(stmt.q3)}</td>
                                                        <td className="py-2 px-2 text-center">{renderBadge(stmt.q4)}</td>
                                                      </tr>
                                                    ))
                                                  )}
                                                </tbody>
                                              </table>
                                            </div>
                                          );
                                        }

                                        return (
                                          <div className="text-xs text-slate-500 italic">
                                            Observed values ratings recorded: AO (Always Observed), SO (Sometimes Observed), RO (Rarely Observed), NO (Not Observed).
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  ) : (
                                    <div className="p-6 text-center border border-dashed rounded-xl text-xs text-slate-400">
                                      No Observed Values extracted for this learner yet.
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* View 4: Discrepancies Details */}
                              {dossierViewTab[dossierKey] === "discrepancies" && (
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

            {/* Non-blocking database persistence warnings notice */}
            {persistenceWarnings && persistenceWarnings.length > 0 && (
              <div
                data-testid="persistence-warnings-banner"
                className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200 space-y-2 shadow-xs"
              >
                <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Database Persistence Notice ({persistenceWarnings.length})</span>
                </div>
                <p className="text-[11px] text-amber-700 dark:text-amber-300/90 leading-relaxed">
                  Validation report and cross-document comparison were generated successfully. However, one or more non-blocking database persistence warnings occurred on secondary tables:
                </p>
                <ul className="list-disc list-inside space-y-1 font-mono text-[11px] text-amber-800 dark:text-amber-300/80 bg-amber-100/50 dark:bg-amber-900/30 p-2.5 rounded-lg border border-amber-200/60 dark:border-amber-800/60">
                  {persistenceWarnings.map((warn, wIdx) => (
                    <li key={wIdx} className="break-all">{warn}</li>
                  ))}
                </ul>
              </div>
            )}
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
                  {Object.keys(reconciledDossiers).length > 0
                    ? (summary.totalLearnersDetected || 1)
                    : summary.consistentRecordsCount}
                </span>
                <span className="text-xs text-slate-400">learners</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {Object.keys(reconciledDossiers).length > 0
                  ? "All primary source fixes applied • 0 Mismatches"
                  : "Zero critical discrepancies"}
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

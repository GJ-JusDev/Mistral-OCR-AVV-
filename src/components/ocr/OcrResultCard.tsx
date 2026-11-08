"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import FieldEditor from "./FieldEditor";
import { ExtractedFields, GradeRecord, AttendanceRecord } from "@/types/documents";
import { AlertTriangle, CheckCircle, FileText, User, Users, Award, ShieldCheck } from "lucide-react";
import { recalculateSubjectGradeStatus } from "@/lib/validation/gradeUtils";

export interface OcrResultCardProps {
  fields: ExtractedFields | null;
  onFieldChange?: (field: keyof ExtractedFields | string, value: any) => void;
  rawText?: string;
  confidence?: number;
  model?: string;
  provider?: string;
}

export default function OcrResultCard({
  fields,
  onFieldChange,
  rawText,
  confidence,
  model,
  provider,
}: OcrResultCardProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (!fields) return null;

  // Determine effective confidence without fabricating 1.0 or 0.95
  const effectiveConfidence =
    typeof confidence === "number"
      ? confidence
      : typeof fields.ocr_confidence === "number"
      ? fields.ocr_confidence
      : undefined;

  const isMeasured = typeof effectiveConfidence === "number";

  const effectiveModel =
    model || fields.ocr_model || "azure/prebuilt-read";

  const rawProvider =
    provider ||
    fields.ocr_provider ||
    (effectiveModel.toLowerCase().includes("azure") || effectiveModel.toLowerCase().includes("prebuilt-read")
      ? "azure"
      : "mistral");

  const isAzure = rawProvider.toLowerCase().includes("azure");

  const providerLabel = isAzure
    ? "Azure Document Intelligence"
    : "Mistral OCR";

  const providerBadgeClass = isAzure
    ? "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 border border-sky-300 dark:border-sky-800"
    : "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-300 dark:border-blue-800";

  const isLowConfidence = isMeasured && effectiveConfidence < 0.85;

  const confidenceBadgeText = isAzure
    ? `Azure OCR Avg. Word Confidence: ${(effectiveConfidence! * 100).toFixed(0)}%`
    : `Mistral OCR Confidence: ${(effectiveConfidence! * 100).toFixed(0)}%`;

  const headerAction = (
    <div className="flex items-center gap-3">
      {/* OCR Provider & Confidence Badge */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${providerBadgeClass}`}
        >
          {providerLabel}
        </span>
        {isMeasured ? (
          <span
            title="Provider-level average word recognition confidence. Structured field correctness requires human review."
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
              effectiveConfidence >= 0.9
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                : effectiveConfidence >= 0.75
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
            }`}
          >
            {confidenceBadgeText}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700">
            Field Confidence: Unmeasured
          </span>
        )}
      </div>

      <button
        onClick={() => setShowRaw(!showRaw)}
        className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline font-medium"
      >
        {showRaw ? "Show Fields" : "Show Raw OCR"}
      </button>
    </div>
  );

  const handleGradeCellChange = (
    index: number,
    key: keyof GradeRecord | "sem1_final_grade" | "sem2_final_grade",
    valStr: string
  ) => {
    if (!onFieldChange || !Array.isArray(fields.grades)) return;
    const updatedGrades = [...fields.grades];
    const target = { ...updatedGrades[index] };

    if (key === "subject" || key === "category" || key === "semester") {
      target[key] = valStr;
    } else {
      const trimmed = valStr.trim();
      let parsedVal: number | string | undefined;
      if (trimmed === "") {
        parsedVal = undefined;
      } else if (!isNaN(Number(trimmed))) {
        parsedVal = parseFloat(trimmed);
      } else {
        // Official DepEd non-numeric marks (e.g. "INC", "DRP", "N/A")
        parsedVal = trimmed.toUpperCase();
        target.needsVerification = true;
      }

      (target as any)[key] = parsedVal;

      // Sync semester final grades with candidate final grade
      if (key === "final") {
        if (target.semester === "1st Semester") {
          target.sem1_final_grade = parsedVal;
        } else if (target.semester === "2nd Semester") {
          target.sem2_final_grade = parsedVal;
        }
      } else if (key === "sem1_final_grade") {
        target.sem1_final_grade = parsedVal;
        target.final = parsedVal;
      } else if (key === "sem2_final_grade") {
        target.sem2_final_grade = parsedVal;
        target.final = parsedVal;
      }
    }

    // Recalculate subject status and verification flags on any grade edit
    const normalizedTarget = recalculateSubjectGradeStatus(target);
    updatedGrades[index] = normalizedTarget;
    onFieldChange("grades", updatedGrades);
  };

  const handleAttendanceCellChange = (
    recordIndex: number,
    valueIndex: number,
    valStr: string
  ) => {
    if (!onFieldChange || !Array.isArray(fields.attendance)) return;
    const updatedAttendance = [...fields.attendance];
    const rec = { ...updatedAttendance[recordIndex] };
    const newValues = [...(rec.values || [])];
    newValues[valueIndex] = valStr;
    rec.values = newValues;
    updatedAttendance[recordIndex] = rec;
    onFieldChange("attendance", updatedAttendance);
  };

  const handleAttendanceTotalChange = (
    recordIndex: number,
    valStr: string
  ) => {
    if (!onFieldChange || !Array.isArray(fields.attendance)) return;
    const updatedAttendance = [...fields.attendance];
    const rec = { ...updatedAttendance[recordIndex] };
    rec.total = valStr.trim() === "" ? undefined : valStr;
    updatedAttendance[recordIndex] = rec;
    onFieldChange("attendance", updatedAttendance);
  };

  return (
    <Card
      title="Extraction & Verification Panel"
      description="Compare extracted values against document image. Click any grade cell to correct before approval."
      headerAction={headerAction}
      className="w-full mt-4"
    >
      {/* Confidence and verification notice */}
      {(!isMeasured || isLowConfidence) && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <strong>Verification Notice:</strong>{" "}
            {!isMeasured
              ? "OCR provider does not supply token-level confidence scores. Please verify student details and subject marks against the original scanned document before authorizing approval."
              : "Some fields were extracted with low OCR confidence or via local fallback. Please carefully verify student details and marks against the scanned document before authorizing approval."}
          </div>
        </div>
      )}

      {showRaw ? (
        <div className="bg-zinc-100 dark:bg-zinc-900 p-4 rounded-md overflow-auto max-h-96 whitespace-pre-wrap font-mono text-sm text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800">
          {rawText || "No raw text available."}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section 1: Student Information Header Fields */}
          {fields.document_type === "birth_cert" ? (
            <div className="space-y-6">
              {/* Notice Banner */}
              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span><strong>Philippine Statistics Authority (PSA)</strong> &bull; Certificate of Live Birth</span>
                </div>
                <span className="font-medium bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded text-[11px]">
                  Civil Registry Record
                </span>
              </div>

              {/* 1. Child Information */}
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3 border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                    <User className="w-4 h-4 text-blue-600" />
                    Child Information
                  </h4>
                  <span className="text-[11px] text-zinc-400">Box 1, 2, 3 &amp; 4</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { key: "last_name", label: "Last Name" },
                    { key: "first_name", label: "First Name" },
                    { key: "middle_name", label: "Middle Name" },
                    { key: "sex", label: "Sex" },
                    { key: "birth_date", label: "Date of Birth" },
                    { key: "birth_place", label: "Place of Birth" },
                  ].map(({ key, label }) => {
                    const val = (fields as any)[key] ?? "";
                    const meta = fields.field_metadata?.[key];
                    const isMissing = !val || String(val).trim() === "";
                    const isUncertain = meta?.needsVerification || isMissing;
                    const isHigh = meta?.confidence === "HIGH" && !isMissing && !meta?.needsVerification;

                    const badge = isMissing ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        Needs Verification
                      </span>
                    ) : isUncertain ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        Uncertain
                      </span>
                    ) : isHigh ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded">
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                        High Conf.
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                        Extracted
                      </span>
                    );

                    if (onFieldChange) {
                      return (
                        <FieldEditor
                          key={key}
                          label={label}
                          value={String(val)}
                          onChange={(newVal) => onFieldChange(key, newVal)}
                          badge={badge}
                        />
                      );
                    }

                    return (
                      <div key={key} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-medium text-zinc-500">{label}</span>
                          {badge}
                        </div>
                        <div className={`px-3 py-2 rounded-md border text-sm font-medium ${
                          isMissing
                            ? "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-400 italic"
                            : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                        }`}>
                          {val || "Could not reliably extract"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. Parent Information */}
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3 border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-600" />
                    Parent Information
                  </h4>
                  <span className="text-[11px] text-zinc-400">Box 6 &amp; 13</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { key: "mother_name", label: "Mother's Maiden Name" },
                    { key: "father_name", label: "Father's Name" },
                  ].map(({ key, label }) => {
                    const val = (fields as any)[key] ?? "";
                    const meta = fields.field_metadata?.[key];
                    const isMissing = !val || String(val).trim() === "";
                    const isUncertain = meta?.needsVerification || isMissing;
                    const isHigh = meta?.confidence === "HIGH" && !isMissing && !meta?.needsVerification;

                    const badge = isMissing ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        Needs Verification
                      </span>
                    ) : isUncertain ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        Uncertain
                      </span>
                    ) : isHigh ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded">
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                        High Conf.
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                        Extracted
                      </span>
                    );

                    if (onFieldChange) {
                      return (
                        <FieldEditor
                          key={key}
                          label={label}
                          value={String(val)}
                          onChange={(newVal) => onFieldChange(key, newVal)}
                          badge={badge}
                        />
                      );
                    }

                    return (
                      <div key={key} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-medium text-zinc-500">{label}</span>
                          {badge}
                        </div>
                        <div className={`px-3 py-2 rounded-md border text-sm font-medium ${
                          isMissing
                            ? "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-400 italic"
                            : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                        }`}>
                          {val || "Could not reliably extract"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Registry Information */}
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3 border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <h4 className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-600" />
                    Registry Information
                  </h4>
                  <span className="text-[11px] text-zinc-400">Civil Registry Office Record</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { key: "registry_number", label: "Civil Registry Number" },
                  ].map(({ key, label }) => {
                    const val = (fields as any)[key] ?? "";
                    const meta = fields.field_metadata?.[key];
                    const isMissing = !val || String(val).trim() === "";
                    const isUncertain = meta?.needsVerification || isMissing;
                    const isHigh = meta?.confidence === "HIGH" && !isMissing && !meta?.needsVerification;

                    const badge = isMissing ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        Needs Verification
                      </span>
                    ) : isUncertain ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        Uncertain
                      </span>
                    ) : isHigh ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded">
                        <CheckCircle className="w-3 h-3 text-emerald-600" />
                        High Conf.
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                        Extracted
                      </span>
                    );

                    if (onFieldChange) {
                      return (
                        <FieldEditor
                          key={key}
                          label={label}
                          value={String(val)}
                          onChange={(newVal) => onFieldChange(key, newVal)}
                          badge={badge}
                        />
                      );
                    }

                    return (
                      <div key={key} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-medium text-zinc-500">{label}</span>
                          {badge}
                        </div>
                        <div className={`px-3 py-2 rounded-md border text-sm font-medium ${
                          isMissing
                            ? "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-400 italic"
                            : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                        }`}>
                          {val || "Could not reliably extract"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">
                Learner Identity &amp; Form Details
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { key: "lrn", label: "Learner Reference No. (LRN)" },
                  { key: "name", label: "Full Name (Source)" },
                  { key: "last_name", label: "Last Name" },
                  { key: "first_name", label: "First Name" },
                  { key: "middle_name", label: "Middle Name" },
                  { key: "school_name", label: "School Name" },
                  { key: "school_id", label: "School ID" },
                  { key: "grade_level", label: "Grade Level" },
                  { key: "school_year", label: "School Year" },
                  { key: "track_strand", label: "Track / Strand" },
                  { key: "section", label: "Section" },
                  { key: "adviser", label: "Class Adviser" },
                ].map(({ key, label }) => {
                  const val = (fields as any)[key] ?? "";
                  const isSchoolConfig =
                    (key === "school_id" || key === "school_name") &&
                    ((fields as any).school_id_source === "school_configuration" ||
                     fields.school_id === "300792" ||
                     (fields as any).trusted_school_verified === true);

                  if (isSchoolConfig) {
                    const displayLabel = key === "school_id" ? "DepEd School ID" : "School";
                    const displayVal =
                      key === "school_id"
                        ? (fields.school_id || "300792")
                        : (fields.school_name || "Taysan Resettlement Integrated School");

                    return (
                      <div key={key} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-zinc-500">{displayLabel}</span>
                          <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                            School Configuration
                          </span>
                        </div>
                        <div className="bg-zinc-100 dark:bg-zinc-800/80 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-900 dark:text-zinc-100 select-none">
                          {displayVal}
                        </div>
                      </div>
                    );
                  }

                  if (onFieldChange) {
                    return (
                      <FieldEditor
                        key={key}
                        label={label}
                        value={String(val)}
                        onChange={(newVal) => onFieldChange(key, newVal)}
                      />
                    );
                  }
                  return (
                    <div key={key} className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-zinc-500">{label}</span>
                      <div className="bg-zinc-50 dark:bg-zinc-800 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {val || <span className="text-zinc-400 italic">Empty</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 2: Subject Grades Tables */}
          {Array.isArray(fields.grades) && fields.grades.length > 0 && (() => {
            const isShsSemestral = fields.grades.some(
              (g) => g.semester === "1st Semester" || g.semester === "2nd Semester" || g.grading_period_scheme === "quarterly_semestral"
            );

            if (isShsSemestral) {
              const indexedGrades = fields.grades.map((g, idx) => ({ ...g, origIndex: idx }));
              const sem1Grades = indexedGrades.filter(
                (g) => g.semester === "1st Semester" || (!g.semester && (g.q1 !== undefined || g.q2 !== undefined))
              );
              const sem2Grades = indexedGrades.filter(
                (g) => g.semester === "2nd Semester" || (!g.semester && (g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined)
              );
              const unassignedGrades = indexedGrades.filter(
                (g) => !sem1Grades.includes(g) && !sem2Grades.includes(g)
              );

              return (
                <div className="flex flex-col gap-6">
                  {/* First Semester Table */}
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center bg-zinc-100 dark:bg-zinc-800/80 px-3 py-2 rounded-t-lg border border-zinc-200 dark:border-zinc-700 border-b-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                          First Semester
                        </span>
                        <span className="text-xs text-zinc-500 font-mono">
                          ({sem1Grades.length} {sem1Grades.length === 1 ? "subject" : "subjects"})
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                        Quarter 1 &bull; Quarter 2 &bull; Semester Final Grade
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-b-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
                      <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-zinc-50 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700">
                          <tr>
                            <th className="py-2.5 px-3">Subject / Learning Area</th>
                            <th className="py-2.5 px-2 text-center w-20">Quarter 1</th>
                            <th className="py-2.5 px-2 text-center w-20">Quarter 2</th>
                            <th className="py-2.5 px-2 text-center w-32">Sem. Final Grade</th>
                            <th className="py-2.5 px-3 text-right w-24">Status</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                          {sem1Grades.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-4 px-3 text-center text-xs text-zinc-400 italic">
                                No First Semester subjects recorded.
                              </td>
                            </tr>
                          ) : (
                            sem1Grades.map((item, s1Idx) => {
                              const showCat =
                                item.category &&
                                (s1Idx === 0 || sem1Grades[s1Idx - 1].category !== item.category);

                              return (
                                <React.Fragment key={item.origIndex}>
                                  {showCat && (
                                    <tr className="bg-zinc-100/60 dark:bg-zinc-800/40">
                                      <td
                                        colSpan={5}
                                        className="py-1 px-3 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider"
                                      >
                                        {item.category}
                                      </td>
                                    </tr>
                                  )}
                                  <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                    <td className="py-2 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                                      {onFieldChange ? (
                                        <input
                                          type="text"
                                          value={item.subject || ""}
                                          onChange={(e) =>
                                            handleGradeCellChange(item.origIndex, "subject", e.target.value)
                                          }
                                          className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 focus:border-blue-500 focus:outline-none px-1 py-0.5"
                                        />
                                      ) : (
                                        item.subject
                                      )}
                                    </td>
                                    <td className="py-2 px-2 text-center">
                                      {onFieldChange ? (
                                        <input
                                          type="text"
                                          inputMode="text"
                                          value={item.q1 !== undefined ? String(item.q1) : ""}
                                          onChange={(e) =>
                                            handleGradeCellChange(item.origIndex, "q1", e.target.value)
                                          }
                                          className="w-14 text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1 py-0.5 text-xs font-semibold focus:border-blue-500 focus:outline-none"
                                        />
                                      ) : (
                                        <span className="text-zinc-700 dark:text-zinc-300 text-xs font-mono">
                                          {item.q1 ?? "-"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 px-2 text-center">
                                      {onFieldChange ? (
                                        <input
                                          type="text"
                                          inputMode="text"
                                          value={item.q2 !== undefined ? String(item.q2) : ""}
                                          onChange={(e) =>
                                            handleGradeCellChange(item.origIndex, "q2", e.target.value)
                                          }
                                          className="w-14 text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1 py-0.5 text-xs font-semibold focus:border-blue-500 focus:outline-none"
                                        />
                                      ) : (
                                        <span className="text-zinc-700 dark:text-zinc-300 text-xs font-mono">
                                          {item.q2 ?? "-"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 px-2 text-center">
                                      {onFieldChange ? (
                                        <input
                                          type="text"
                                          inputMode="text"
                                          value={
                                            item.sem1_final_grade !== undefined
                                              ? String(item.sem1_final_grade)
                                              : item.final !== undefined
                                              ? String(item.final)
                                              : ""
                                          }
                                          onChange={(e) =>
                                            handleGradeCellChange(item.origIndex, "sem1_final_grade", e.target.value)
                                          }
                                          className="w-16 text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:border-blue-500 focus:outline-none"
                                        />
                                      ) : (
                                        <span className="font-bold text-zinc-900 dark:text-zinc-100 text-xs font-mono">
                                          {item.sem1_final_grade ?? item.final ?? "-"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                      <span
                                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                          item.status === "Passed"
                                            ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400"
                                            : item.status === "Failed"
                                            ? "text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400"
                                            : "text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400"
                                        }`}
                                      >
                                        {item.status || (item.needsVerification ? "Needs Verification" : "Missing")}
                                      </span>
                                    </td>
                                  </tr>
                                  {(item.status === "Failed" || item.remedial_class_mark !== undefined || item.recomputed_final_grade !== undefined) && (
                                    <tr className="bg-amber-50/60 dark:bg-amber-950/20 text-xs">
                                      <td colSpan={5} className="py-1.5 px-3">
                                        <div className="flex flex-wrap items-center gap-3 text-[11px]">
                                          <span className="font-semibold text-amber-900 dark:text-amber-300">
                                            Remedial Record:
                                          </span>
                                          <div className="flex items-center gap-1">
                                            <span className="text-zinc-600 dark:text-zinc-400">Class Mark:</span>
                                            {onFieldChange ? (
                                              <input
                                                type="text"
                                                value={item.remedial_class_mark !== undefined ? String(item.remedial_class_mark) : ""}
                                                placeholder="e.g. 78"
                                                onChange={(e) => handleGradeCellChange(item.origIndex, "remedial_class_mark" as any, e.target.value)}
                                                className="w-14 text-center bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 font-mono focus:border-blue-500 focus:outline-none"
                                              />
                                            ) : (
                                              <span className="font-mono font-semibold">{item.remedial_class_mark ?? "None"}</span>
                                            )}
                                          </div>
                                          {item.recomputed_final_grade !== undefined && (
                                            <div className="flex items-center gap-1">
                                              <span className="text-zinc-600 dark:text-zinc-400">Recomputed Final:</span>
                                              <span className={`font-mono font-bold ${Number(item.recomputed_final_grade) >= 75 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                                                {item.recomputed_final_grade}
                                              </span>
                                              <span className="text-[10px] text-zinc-500 italic">
                                                ({Number(item.recomputed_final_grade) >= 75 ? "Passed" : "Failed"} via round((orig+mark)/2))
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Second Semester Table */}
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center bg-zinc-100 dark:bg-zinc-800/80 px-3 py-2 rounded-t-lg border border-zinc-200 dark:border-zinc-700 border-b-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                          Second Semester
                        </span>
                        <span className="text-xs text-zinc-500 font-mono">
                          ({sem2Grades.length} {sem2Grades.length === 1 ? "subject" : "subjects"})
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                        Quarter 3 &bull; Quarter 4 &bull; Semester Final Grade
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-b-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
                      <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-zinc-50 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700">
                          <tr>
                            <th className="py-2.5 px-3">Subject / Learning Area</th>
                            <th className="py-2.5 px-2 text-center w-20">Quarter 3</th>
                            <th className="py-2.5 px-2 text-center w-20">Quarter 4</th>
                            <th className="py-2.5 px-2 text-center w-32">Sem. Final Grade</th>
                            <th className="py-2.5 px-3 text-right w-24">Status</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                          {sem2Grades.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-4 px-3 text-center text-xs text-zinc-400 italic">
                                No Second Semester subjects recorded (not yet enrolled or unscanned).
                              </td>
                            </tr>
                          ) : (
                            sem2Grades.map((item, s2Idx) => {
                              const showCat =
                                item.category &&
                                (s2Idx === 0 || sem2Grades[s2Idx - 1].category !== item.category);

                              return (
                                <React.Fragment key={item.origIndex}>
                                  {showCat && (
                                    <tr className="bg-zinc-100/60 dark:bg-zinc-800/40">
                                      <td
                                        colSpan={5}
                                        className="py-1 px-3 text-[11px] font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider"
                                      >
                                        {item.category}
                                      </td>
                                    </tr>
                                  )}
                                  <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                    <td className="py-2 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                                      {onFieldChange ? (
                                        <input
                                          type="text"
                                          value={item.subject || ""}
                                          onChange={(e) =>
                                            handleGradeCellChange(item.origIndex, "subject", e.target.value)
                                          }
                                          className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 focus:border-blue-500 focus:outline-none px-1 py-0.5"
                                        />
                                      ) : (
                                        item.subject
                                      )}
                                    </td>
                                    <td className="py-2 px-2 text-center">
                                      {onFieldChange ? (
                                        <input
                                          type="text"
                                          inputMode="text"
                                          value={item.q3 !== undefined ? String(item.q3) : ""}
                                          onChange={(e) =>
                                            handleGradeCellChange(item.origIndex, "q3", e.target.value)
                                          }
                                          className="w-14 text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1 py-0.5 text-xs font-semibold focus:border-blue-500 focus:outline-none"
                                        />
                                      ) : (
                                        <span className="text-zinc-700 dark:text-zinc-300 text-xs font-mono">
                                          {item.q3 ?? "-"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 px-2 text-center">
                                      {onFieldChange ? (
                                        <input
                                          type="text"
                                          inputMode="text"
                                          value={item.q4 !== undefined ? String(item.q4) : ""}
                                          onChange={(e) =>
                                            handleGradeCellChange(item.origIndex, "q4", e.target.value)
                                          }
                                          className="w-14 text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1 py-0.5 text-xs font-semibold focus:border-blue-500 focus:outline-none"
                                        />
                                      ) : (
                                        <span className="text-zinc-700 dark:text-zinc-300 text-xs font-mono">
                                          {item.q4 ?? "-"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 px-2 text-center">
                                      {onFieldChange ? (
                                        <input
                                          type="text"
                                          inputMode="text"
                                          value={
                                            item.sem2_final_grade !== undefined
                                              ? String(item.sem2_final_grade)
                                              : item.final !== undefined
                                              ? String(item.final)
                                              : ""
                                          }
                                          onChange={(e) =>
                                            handleGradeCellChange(item.origIndex, "sem2_final_grade", e.target.value)
                                          }
                                          className="w-16 text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:border-blue-500 focus:outline-none"
                                        />
                                      ) : (
                                        <span className="font-bold text-zinc-900 dark:text-zinc-100 text-xs font-mono">
                                          {item.sem2_final_grade ?? item.final ?? "-"}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                      <span
                                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                          item.status === "Passed"
                                            ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400"
                                            : item.status === "Failed"
                                            ? "text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400"
                                            : "text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400"
                                        }`}
                                      >
                                        {item.status || (item.needsVerification ? "Needs Verification" : "Missing")}
                                      </span>
                                    </td>
                                  </tr>
                                  {(item.status === "Failed" || item.remedial_class_mark !== undefined || item.recomputed_final_grade !== undefined) && (
                                    <tr className="bg-amber-50/60 dark:bg-amber-950/20 text-xs">
                                      <td colSpan={5} className="py-1.5 px-3">
                                        <div className="flex flex-wrap items-center gap-3 text-[11px]">
                                          <span className="font-semibold text-amber-900 dark:text-amber-300">
                                            Remedial Record:
                                          </span>
                                          <div className="flex items-center gap-1">
                                            <span className="text-zinc-600 dark:text-zinc-400">Class Mark:</span>
                                            {onFieldChange ? (
                                              <input
                                                type="text"
                                                value={item.remedial_class_mark !== undefined ? String(item.remedial_class_mark) : ""}
                                                placeholder="e.g. 78"
                                                onChange={(e) => handleGradeCellChange(item.origIndex, "remedial_class_mark" as any, e.target.value)}
                                                className="w-14 text-center bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 font-mono focus:border-blue-500 focus:outline-none"
                                              />
                                            ) : (
                                              <span className="font-mono font-semibold">{item.remedial_class_mark ?? "None"}</span>
                                            )}
                                          </div>
                                          {item.recomputed_final_grade !== undefined && (
                                            <div className="flex items-center gap-1">
                                              <span className="text-zinc-600 dark:text-zinc-400">Recomputed Final:</span>
                                              <span className={`font-mono font-bold ${Number(item.recomputed_final_grade) >= 75 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                                                {item.recomputed_final_grade}
                                              </span>
                                              <span className="text-[10px] text-zinc-500 italic">
                                                ({Number(item.recomputed_final_grade) >= 75 ? "Passed" : "Failed"} via round((orig+mark)/2))
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Fallback for any unassigned subjects if present */}
                  {unassignedGrades.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                        Other Subjects ({unassignedGrades.length})
                      </span>
                      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                        <table className="w-full text-left text-sm border-collapse">
                          <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                            {unassignedGrades.map((item) => (
                              <tr key={item.origIndex} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                <td className="py-2 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                                  {item.subject}
                                </td>
                                <td className="py-2 px-3 text-right font-bold text-xs">
                                  {item.final ?? "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // Elementary or Junior High School (Full-Year Quarterly) presentation
            return (
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                    Academic Subject Grades ({fields.grades.length} subjects &bull; Full Year)
                  </span>
                  <span className="text-xs text-zinc-400 italic">
                    Editable &bull; Click any cell to correct misread marks
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      <tr className="border-b border-zinc-200 dark:border-zinc-700">
                        <th className="py-2.5 px-3">Subject / Learning Area</th>
                        <th className="py-2.5 px-2 text-center w-16">Q1</th>
                        <th className="py-2.5 px-2 text-center w-16">Q2</th>
                        <th className="py-2.5 px-2 text-center w-16">Q3</th>
                        <th className="py-2.5 px-2 text-center w-16">Q4</th>
                        <th className="py-2.5 px-2 text-center w-20">Final</th>
                        <th className="py-2.5 px-3 text-right w-24">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                      {fields.grades.map((g, idx) => (
                        <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                          <td className="py-2 px-3 font-medium text-zinc-900 dark:text-zinc-100">
                            {onFieldChange ? (
                              <input
                                type="text"
                                value={g.subject || ""}
                                onChange={(e) => handleGradeCellChange(idx, "subject", e.target.value)}
                                className="w-full bg-transparent border-b border-transparent hover:border-zinc-300 focus:border-blue-500 focus:outline-none px-1 py-0.5"
                              />
                            ) : (
                              g.subject
                            )}
                          </td>
                          {(["q1", "q2", "q3", "q4"] as const).map((qKey) => (
                            <td key={qKey} className="py-2 px-2 text-center">
                              {onFieldChange ? (
                                <input
                                  type="text"
                                  inputMode="text"
                                  value={g[qKey] !== undefined ? String(g[qKey]) : ""}
                                  onChange={(e) => handleGradeCellChange(idx, qKey, e.target.value)}
                                  className="w-12 text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1 py-0.5 text-xs font-semibold focus:border-blue-500 focus:outline-none"
                                />
                              ) : (
                                <span className="text-zinc-700 dark:text-zinc-300 text-xs font-mono">
                                  {g[qKey] ?? "-"}
                                </span>
                              )}
                            </td>
                          ))}
                          <td className="py-2 px-2 text-center">
                            {onFieldChange ? (
                              <input
                                type="text"
                                inputMode="text"
                                value={g.final !== undefined ? String(g.final) : ""}
                                onChange={(e) => handleGradeCellChange(idx, "final", e.target.value)}
                                className="w-14 text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:border-blue-500 focus:outline-none"
                              />
                            ) : (
                              <span className="font-bold text-zinc-900 dark:text-zinc-100 text-xs font-mono">
                                {g.final ?? "-"}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                                g.status === "Passed"
                                  ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400"
                                  : g.status === "Failed"
                                  ? "text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400"
                                  : "text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400"
                              }`}
                            >
                              {g.status || (g.needsVerification ? "Needs Verification" : "Missing")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* Section 2B: General Average Summary Row / Card (Distinct from Subjects) */}
          {fields.general_average !== undefined && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-zinc-50 dark:bg-zinc-800/70 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  General Average for the Semester / School Year
                </span>
                <span className="text-[11px] text-zinc-500 italic">
                  Raw candidate average recognized from document (DepEd AVV rule: zero calculation performed)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {onFieldChange ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={fields.general_average !== undefined ? String(fields.general_average) : ""}
                    onChange={(e) => {
                      const trimmed = e.target.value.trim();
                      if (trimmed === "") {
                        onFieldChange("general_average", undefined);
                      } else if (!isNaN(Number(trimmed))) {
                        onFieldChange("general_average", parseFloat(trimmed));
                      } else {
                        onFieldChange("general_average", trimmed);
                      }
                    }}
                    className="w-20 text-center font-mono font-bold text-sm bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-zinc-900 dark:text-zinc-100 focus:border-blue-500 focus:outline-none"
                  />
                ) : (
                  <span className="font-mono font-bold text-base text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-900 px-3 py-1 rounded border border-zinc-300 dark:border-zinc-600">
                    {fields.general_average}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Section 3: Attendance Summary */}
          {Array.isArray(fields.attendance) && fields.attendance.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Learner Attendance Record
              </span>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                      <th className="py-2.5 px-3">Metric</th>
                      {fields.attendance_months && fields.attendance_months.length > 0 ? (
                        <>
                          {fields.attendance_months.map((m: string, i: number) => (
                            <th key={i} className="py-2.5 px-2 font-semibold text-center text-xs">
                              {m}
                            </th>
                          ))}
                          <th className="py-2.5 px-2 font-bold text-center text-xs bg-zinc-200/50 dark:bg-zinc-700/50">
                            Total
                          </th>
                        </>
                      ) : (
                        <th className="py-2.5 px-3">Values</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                    {fields.attendance.map((a: AttendanceRecord, rIdx: number) => (
                      <tr key={rIdx}>
                        <td className="py-2 px-3 font-medium text-zinc-900 dark:text-zinc-100 text-xs">
                          {a.label}
                        </td>
                        {fields.attendance_months && fields.attendance_months.length > 0 ? (
                          <>
                            {fields.attendance_months.map((_, cIdx: number) => (
                              <td key={cIdx} className="py-2 px-1 text-center">
                                {onFieldChange ? (
                                  <input
                                    type="text"
                                    value={a.values[cIdx] || ""}
                                    onChange={(e) =>
                                      handleAttendanceCellChange(rIdx, cIdx, e.target.value)
                                    }
                                    className="w-10 text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1 py-0.5 text-xs focus:border-blue-500 focus:outline-none"
                                  />
                                ) : (
                                  <span className="text-xs font-mono">{a.values[cIdx] || "-"}</span>
                                )}
                              </td>
                            ))}
                            <td className="py-2 px-2 text-center bg-zinc-50/50 dark:bg-zinc-800/50 font-bold text-xs">
                              {onFieldChange ? (
                                <input
                                  type="text"
                                  value={a.total !== undefined ? String(a.total) : ""}
                                  onChange={(e) =>
                                    handleAttendanceTotalChange(rIdx, e.target.value)
                                  }
                                  className="w-12 text-center bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:border-blue-500 focus:outline-none"
                                />
                              ) : (
                                <span className="font-mono text-zinc-900 dark:text-zinc-100">
                                  {a.total !== undefined ? a.total : "-"}
                                </span>
                              )}
                            </td>
                          </>
                        ) : (
                          <td className="py-2 px-3 text-xs font-mono">
                            {a.values.join("  ")}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Computed Attendance Summary & Risk Banner */}
              {fields.attendance_totals && (
                <div className="mt-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-zinc-700 dark:text-zinc-300">Total School Days: </span>
                      <span className="font-mono">{fields.attendance_totals.computed_school_days ?? "-"}</span>
                      {fields.attendance_totals.printed_school_days !== undefined && (
                        <span className="text-zinc-500 text-[0.7rem] ml-1">
                          (Printed: {fields.attendance_totals.printed_school_days})
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="font-bold text-zinc-700 dark:text-zinc-300">Present: </span>
                      <span className="font-mono text-emerald-600">{fields.attendance_totals.computed_days_present ?? "-"}</span>
                      {fields.attendance_percentage !== undefined && (
                        <span className="text-zinc-500 text-[0.7rem] ml-1">({fields.attendance_percentage}%)</span>
                      )}
                    </div>
                    <div>
                      <span className="font-bold text-zinc-700 dark:text-zinc-300">Absent: </span>
                      <span className="font-mono text-red-600">{fields.attendance_totals.computed_days_absent ?? "-"}</span>
                      {fields.absence_percentage !== undefined && (
                        <span className="text-zinc-500 text-[0.7rem] ml-1">({fields.absence_percentage}%)</span>
                      )}
                    </div>
                  </div>

                  {/* Attendance Risk Banner */}
                  {fields.attendance_risk_status && fields.attendance_risk_status !== "NORMAL" && (
                    <div className={`p-2.5 rounded text-xs border ${
                      fields.attendance_risk_status === "ATTENDANCE_REVIEW_REQUIRED"
                        ? "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300"
                        : "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300"
                    }`}>
                      <span className="font-bold block mb-0.5">
                        {fields.attendance_risk_status === "ATTENDANCE_REVIEW_REQUIRED"
                          ? "ATTENDANCE REVIEW REQUIRED (>20% Absences)"
                          : "ATTENDANCE EARLY WARNING (15-20% Absences)"}
                      </span>
                      <p className="text-[0.7rem]">
                        {fields.attendance_risk_status === "ATTENDANCE_REVIEW_REQUIRED"
                          ? "Posibleng lumagpas sa attendance limit ang student. Warning lang ito, hindi automatic failure. Kailangan ng verification ng guro."
                          : "Mataas ang recorded absences ng student. Kailangan i-verify ng Teacher ang attendance record at i-review ang applicable school policy."}
                      </p>
                    </div>
                  )}

                  {fields.attendance_discrepancy_details && fields.attendance_discrepancy_details.length > 0 && (
                    <div className="p-2 rounded bg-amber-50 text-amber-900 border border-amber-200 text-xs space-y-1">
                      <span className="font-semibold block">Discrepancy Alerts:</span>
                      {fields.attendance_discrepancy_details.map((d: string, i: number) => (
                        <p key={i} className="text-[0.7rem]">&bull; {d}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

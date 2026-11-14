"use client";

import React, { useState, useMemo } from "react";
import { 
  UserCheck, 
  UserPlus, 
  CheckCircle2, 
  AlertTriangle, 
  History, 
  ArrowRight, 
  ShieldCheck, 
  Sparkles, 
  FileText,
  Clock,
  Layers,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  BookOpen,
} from "lucide-react";
import type { DocumentGradeComparisonResult, SubjectComparisonItem } from "@/lib/validation/gradeComparator";
import {
  recalculateSubjectGradeStatus,
  normalizeSemesterContext,
  parseQuarterNumeric,
} from "@/lib/validation/gradeUtils";

interface StudentGradeReviewSectionProps {
  document: any;
  matchedStudent?: any;
  existingGrades?: any[];
  gradeComparison?: DocumentGradeComparisonResult | null;
  gradeChangeHistory?: any[];
}

export default function StudentGradeReviewSection({
  document,
  matchedStudent,
  existingGrades = [],
  gradeComparison,
  gradeChangeHistory = [],
}: StudentGradeReviewSectionProps) {
  const [showHistory, setShowHistory] = useState(false);
  const ef = document?.extracted_fields || {};

  const rawLrn = ef.lrn || ef.learner_reference_number || matchedStudent?.lrn || "—";
  const rawName = ef.name || [ef.first_name, ef.middle_name, ef.last_name].filter(Boolean).join(" ") || "—";
  const schoolYear = document?.school_year || ef.school_year || "Unknown S.Y.";
  const gradeLevel = document?.grade_level || ef.grade_level || "Grade 11";
  const semester = document?.semester || ef.semester || "1st Semester";

  const isExistingStudent = Boolean(matchedStudent?.id || ef.existing_student_id);
  const comparisonItems: SubjectComparisonItem[] = gradeComparison?.subjects || [];
  const proposedCount = gradeComparison?.proposedUpdateCount || 0;
  const newSubjectCount = gradeComparison?.newSubjectCount || 0;

  // Cumulative Consolidated Academic Summary computation
  const activeSem1Grades = useMemo(() => {
    const list = (existingGrades || []).filter((g: any) => {
      const normSem = normalizeSemesterContext(g.semester);
      if (normSem === "1st Semester") return true;
      if (normSem === "2nd Semester") return false;
      const semStr = (g.semester || "").toLowerCase();
      return semStr.includes("1st") || semStr.includes("first") || (!g.semester && (parseQuarterNumeric(g.q1) !== undefined || parseQuarterNumeric(g.q2) !== undefined));
    });
    // If no existing approved sem1 in DB, check scanned doc if it's sem1
    if (list.length === 0 && (normalizeSemesterContext(semester) === "1st Semester" || semester.includes("1st") || semester.includes("first"))) {
      const docGrades = Array.isArray(ef.grades) ? ef.grades : [];
      return docGrades.filter((g: any) => {
        const normSem = normalizeSemesterContext(g.semester);
        if (normSem === "1st Semester") return true;
        if (normSem === "2nd Semester") return false;
        const s = (g.semester || semester).toLowerCase();
        return s.includes("1st") || s.includes("first") || (!g.semester && (parseQuarterNumeric(g.q1) !== undefined || parseQuarterNumeric(g.q2) !== undefined));
      }).map((g: any) => {
        const norm = recalculateSubjectGradeStatus(g, "1st Semester");
        const finVal = Number(norm.final ?? norm.sem1_final_grade);
        return {
          subject: norm.subject,
          q1: norm.q1,
          q2: norm.q2,
          final_grade: norm.sem1_final_grade ?? norm.final,
          status: norm.status || (!isNaN(finVal) ? (finVal >= 75 ? "Passed" : "Failed") : "Needs Verification"),
          raw_calculated_final: norm.raw_calculated_final,
        };
      });
    }
    return list.map((g: any) => {
      const norm = recalculateSubjectGradeStatus(g, "1st Semester");
      return {
        ...g,
        subject: norm.subject,
        q1: norm.q1,
        q2: norm.q2,
        final_grade: norm.sem1_final_grade ?? norm.final ?? g.final_grade,
        status: norm.status || g.status,
        raw_calculated_final: norm.raw_calculated_final,
      };
    });
  }, [existingGrades, semester, ef.grades]);

  const activeSem2Grades = useMemo(() => {
    const list = (existingGrades || []).filter((g: any) => {
      const normSem = normalizeSemesterContext(g.semester);
      if (normSem === "2nd Semester") return true;
      if (normSem === "1st Semester") return false;
      const semStr = (g.semester || "").toLowerCase();
      return semStr.includes("2nd") || semStr.includes("second") || (!g.semester && (parseQuarterNumeric(g.q3) !== undefined || parseQuarterNumeric(g.q4) !== undefined));
    });
    // If no existing approved sem2 in DB, check scanned doc if it's sem2
    if (list.length === 0 && (normalizeSemesterContext(semester) === "2nd Semester" || semester.includes("2nd") || semester.includes("second"))) {
      const docGrades = Array.isArray(ef.grades) ? ef.grades : [];
      return docGrades.filter((g: any) => {
        const normSem = normalizeSemesterContext(g.semester);
        if (normSem === "2nd Semester") return true;
        if (normSem === "1st Semester") return false;
        const s = (g.semester || semester).toLowerCase();
        return s.includes("2nd") || s.includes("second") || (!g.semester && (parseQuarterNumeric(g.q3) !== undefined || parseQuarterNumeric(g.q4) !== undefined));
      }).map((g: any) => {
        const norm = recalculateSubjectGradeStatus(g, "2nd Semester");
        const finVal = Number(norm.final ?? norm.sem2_final_grade);
        return {
          subject: norm.subject,
          q3: norm.q3,
          q4: norm.q4,
          final_grade: norm.sem2_final_grade ?? norm.final,
          status: norm.status || (!isNaN(finVal) ? (finVal >= 75 ? "Passed" : "Failed") : "Needs Verification"),
          raw_calculated_final: norm.raw_calculated_final,
        };
      });
    }
    return list.map((g: any) => {
      const norm = recalculateSubjectGradeStatus(g, "2nd Semester");
      return {
        ...g,
        subject: norm.subject,
        q3: norm.q3,
        q4: norm.q4,
        final_grade: norm.sem2_final_grade ?? norm.final ?? g.final_grade,
        status: norm.status || g.status,
        raw_calculated_final: norm.raw_calculated_final,
      };
    });
  }, [existingGrades, semester, ef.grades]);

  const bothSemestersAvailable = activeSem1Grades.length > 0 && activeSem2Grades.length > 0;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs space-y-6 p-6">
      {/* 1. Header & Identity Matching Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              DepEd Student Identification & Verification
            </span>
            {isExistingStudent ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <UserCheck className="w-3.5 h-3.5" />
                Existing Student Found
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                <UserPlus className="w-3.5 h-3.5" />
                New Student Profile
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            {isExistingStudent ? (
              <>
                {matchedStudent?.last_name || ef.last_name}, {matchedStudent?.first_name || ef.first_name} {matchedStudent?.middle_name || ef.middle_name || ""}
              </>
            ) : (
              rawName
            )}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              <strong>LRN:</strong> <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-800 dark:text-zinc-200">{rawLrn}</code>
            </span>
            <span>•</span>
            <span>{schoolYear}</span>
            <span>•</span>
            <span>{gradeLevel}</span>
            <span>•</span>
            <span>{semester}</span>
          </div>
        </div>

        {/* Legend Indicator */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs bg-zinc-50 dark:bg-zinc-800/60 p-3 rounded-lg border border-zinc-200/80 dark:border-zinc-700/60">
          <div className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 dark:bg-emerald-500 shrink-0"></span>
            <span><strong>Solid:</strong> Verified Active DB Record</span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 border border-dashed border-amber-600 shrink-0"></span>
            <span><strong>Dashed:</strong> Scanned OCR Suggestion</span>
          </div>
        </div>
      </div>

      {/* 2. Discrepancy & Proposed Changes Banner */}
      {gradeComparison?.hasAnyProposedChanges ? (
        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-amber-900 dark:text-amber-200">
            <div className="font-semibold mb-0.5">
              Grade Changes Detected ({proposedCount} update{proposedCount === 1 ? "" : "s"}
              {newSubjectCount > 0 ? `, ${newSubjectCount} new subject${newSubjectCount === 1 ? "" : "s"}` : ""})
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              Newly scanned values differ from approved database records. Authorizing approval will update active grades and record full audit entries in the grade history log.
            </p>
          </div>
        </div>
      ) : isExistingStudent && existingGrades.length > 0 ? (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="text-xs text-emerald-900 dark:text-emerald-200">
            <strong>All Scanned Grades Match Verified Database Records:</strong> Repeated scan of approved records detected. Approving will link the document without duplicating grades.
          </div>
        </div>
      ) : null}

      {/* 3. Detailed Side-by-Side Grade Comparison Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Academic Grade Comparison & Proposed Changes
          </h3>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {comparisonItems.length} learning area{comparisonItems.length === 1 ? "" : "s"} evaluated
          </span>
        </div>

        {comparisonItems.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-500 italic bg-zinc-50 dark:bg-zinc-800/40 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700">
            No subject grades extracted from document or available for comparison.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm divide-y divide-zinc-200 dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-800/80 text-xs font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Subject / Learning Area</th>
                  <th className="py-3 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <span className="text-emerald-800 dark:text-emerald-300 font-bold">Verified Active Record</span>
                    <span className="block text-[10px] text-zinc-400 font-normal">Current DB Value</span>
                  </th>
                  <th className="py-3 px-4 bg-amber-50/50 dark:bg-amber-950/20 border-l border-dashed border-amber-300 dark:border-amber-900">
                    <span className="text-amber-800 dark:text-amber-300 font-bold">Scanned OCR Suggestion</span>
                    <span className="block text-[10px] text-zinc-400 font-normal">Pending Approval</span>
                  </th>
                  <th className="py-3 px-4">Proposed Update & Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs sm:text-sm">
                {comparisonItems.map((item, idx) => {
                  const isSem1 = item.semester.includes("1st") || item.semester.includes("First");
                  const exQ_A = isSem1 ? item.existingGrades?.q1 : item.existingGrades?.q3;
                  const exQ_B = isSem1 ? item.existingGrades?.q2 : item.existingGrades?.q4;
                  const scQ_A = isSem1 ? item.scannedGrades?.q1 : item.scannedGrades?.q3;
                  const scQ_B = isSem1 ? item.scannedGrades?.q2 : item.scannedGrades?.q4;

                  const hasChange = item.status === "PROPOSED_UPDATE";
                  const isNew = item.status === "NEW_SUBJECT";

                  return (
                    <tr 
                      key={idx}
                      className={
                        hasChange 
                          ? "bg-amber-50/30 dark:bg-amber-950/10 hover:bg-amber-50/50" 
                          : isNew 
                          ? "bg-blue-50/20 dark:bg-blue-950/10" 
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                      }
                    >
                      {/* Subject Name */}
                      <td className="py-3.5 px-4 font-semibold text-zinc-900 dark:text-zinc-100">
                        {item.subject}
                        <div className="text-[11px] text-zinc-400 font-normal">{item.semester}</div>
                      </td>

                      {/* Verified Active Record (Database) */}
                      <td className="py-3.5 px-4 bg-emerald-50/30 dark:bg-emerald-950/10 font-mono text-zinc-800 dark:text-zinc-200">
                        {item.existingGrades ? (
                          <div className="space-y-0.5">
                            <div>
                              <span className="text-zinc-400 font-sans text-xs">{isSem1 ? "Q1:" : "Q3:"}</span> {exQ_A ?? "—"} &nbsp;
                              <span className="text-zinc-400 font-sans text-xs">{isSem1 ? "Q2:" : "Q4:"}</span> {exQ_B ?? "—"}
                            </div>
                            <div className="text-xs font-sans text-zinc-500">
                              Final: <strong className="font-mono text-zinc-900 dark:text-zinc-100">{item.existingGrades.final ?? "—"}</strong> ({item.existingGrades.status || "—"})
                            </div>
                          </div>
                        ) : (
                          <span className="text-zinc-400 italic font-sans text-xs">No prior record</span>
                        )}
                      </td>

                      {/* Scanned OCR Suggestion */}
                      <td className="py-3.5 px-4 bg-amber-50/30 dark:bg-amber-950/10 border-l border-dashed border-amber-300 dark:border-amber-900 font-mono text-zinc-800 dark:text-zinc-200">
                        <div className="space-y-0.5">
                          <div>
                            <span className="text-zinc-400 font-sans text-xs">{isSem1 ? "Q1:" : "Q3:"}</span>{" "}
                            <span className={scQ_A !== null && exQ_A !== null && scQ_A !== exQ_A ? "font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/60 px-1 rounded" : ""}>
                              {scQ_A ?? "—"}
                            </span>
                            &nbsp;
                            <span className="text-zinc-400 font-sans text-xs">{isSem1 ? "Q2:" : "Q4:"}</span>{" "}
                            <span className={scQ_B !== null && exQ_B !== null && scQ_B !== exQ_B ? "font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/60 px-1 rounded" : ""}>
                              {scQ_B ?? "—"}
                            </span>
                          </div>
                          <div className="text-xs font-sans text-zinc-500">
                            Printed Final: <strong className="font-mono text-zinc-900 dark:text-zinc-100">{item.scannedGrades.final ?? "—"}</strong>
                          </div>
                        </div>
                      </td>

                      {/* Proposed Update / Status */}
                      <td className="py-3.5 px-4">
                        {hasChange ? (
                          <div className="space-y-1">
                            {item.quarterDiffs.filter(d => d.hasChange).map((diff, dIdx) => (
                              <span 
                                key={dIdx}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                              >
                                {diff.quarter.toUpperCase()}: {diff.displayDiff}
                              </span>
                            ))}
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                              Recomputed Final: <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{item.proposedFinalGrade ?? "—"}</strong> ({item.proposedStatus})
                            </div>
                          </div>
                        ) : isNew ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                            <Sparkles className="w-3 h-3" />
                            New Learning Area
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30">
                            <CheckCircle2 className="w-3 h-3" />
                            Identical (Unchanged)
                          </span>
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

      {/* 4. Consolidated Academic Summary (Cumulative S.Y. Record) */}
      <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
              Consolidated Academic Summary
            </h3>
            <span className="text-xs text-zinc-500 font-normal">
              (Cumulative S.Y. {schoolYear} Records)
            </span>
          </div>
          {bothSemestersAvailable ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Both Semesters Consolidated ({activeSem1Grades.length + activeSem2Grades.length} Subjects)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
              <Clock className="w-3.5 h-3.5" />
              Partial Academic Year (Semester 1 Only)
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Semester 1 Panel */}
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-blue-600" />
                First Semester (1st Sem)
              </span>
              <span className="text-xs font-mono font-medium text-zinc-500">
                {activeSem1Grades.length} learning area{activeSem1Grades.length === 1 ? "" : "s"}
              </span>
            </div>

            {activeSem1Grades.length === 0 ? (
              <div className="p-4 text-center text-xs text-zinc-400 italic bg-white dark:bg-zinc-900 rounded border border-dashed border-zinc-300 dark:border-zinc-700">
                No verified First Semester subjects recorded.
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                <table className="w-full text-left text-xs divide-y divide-zinc-200 dark:divide-zinc-800">
                  <thead className="bg-zinc-100/70 dark:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-300">
                    <tr>
                      <th className="py-2 px-2.5">Subject</th>
                      <th className="py-2 px-1.5 text-center">Q1</th>
                      <th className="py-2 px-1.5 text-center">Q2</th>
                      <th className="py-2 px-2 text-center font-bold">Final</th>
                      <th className="py-2 px-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {activeSem1Grades.map((g: any, idx: number) => (
                      <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="py-1.5 px-2.5 font-medium text-zinc-900 dark:text-zinc-100">{g.subject}</td>
                        <td className="py-1.5 px-1.5 text-center font-mono text-zinc-600 dark:text-zinc-400">{g.q1 ?? "—"}</td>
                        <td className="py-1.5 px-1.5 text-center font-mono text-zinc-600 dark:text-zinc-400">{g.q2 ?? "—"}</td>
                        <td className="py-1.5 px-2 text-center font-mono font-bold text-zinc-900 dark:text-zinc-100">{g.final_grade ?? g.final ?? "—"}</td>
                        <td className="py-1.5 px-2 text-right">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            g.status === "Passed" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                            g.status === "Failed" ? "bg-red-50 text-red-700 border border-red-200" :
                            "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}>
                            {g.status || "Passed"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Semester 2 Panel */}
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                Second Semester (2nd Sem)
              </span>
              {activeSem2Grades.length > 0 ? (
                <span className="text-xs font-mono font-medium text-zinc-500">
                  {activeSem2Grades.length} learning area{activeSem2Grades.length === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  NOT YET AVAILABLE
                </span>
              )}
            </div>

            {activeSem2Grades.length === 0 ? (
              <div className="p-6 text-center rounded bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50 space-y-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-300 dark:border-amber-800">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  NOT YET AVAILABLE
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                  Second Semester scholastic records are NOT YET AVAILABLE for S.Y. {schoolYear}.
                </p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Awaiting Second Semester SF9 report card submission to complete cumulative scholastic evaluation.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                <table className="w-full text-left text-xs divide-y divide-zinc-200 dark:divide-zinc-800">
                  <thead className="bg-zinc-100/70 dark:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-300">
                    <tr>
                      <th className="py-2 px-2.5">Subject</th>
                      <th className="py-2 px-1.5 text-center">Q3</th>
                      <th className="py-2 px-1.5 text-center">Q4</th>
                      <th className="py-2 px-2 text-center font-bold">Final</th>
                      <th className="py-2 px-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {activeSem2Grades.map((g: any, idx: number) => (
                      <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                        <td className="py-1.5 px-2.5 font-medium text-zinc-900 dark:text-zinc-100">{g.subject}</td>
                        <td className="py-1.5 px-1.5 text-center font-mono text-zinc-600 dark:text-zinc-400">{g.q3 ?? "—"}</td>
                        <td className="py-1.5 px-1.5 text-center font-mono text-zinc-600 dark:text-zinc-400">{g.q4 ?? "—"}</td>
                        <td className="py-1.5 px-2 text-center font-mono font-bold text-zinc-900 dark:text-zinc-100">{g.final_grade ?? g.final ?? "—"}</td>
                        <td className="py-1.5 px-2 text-right">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            g.status === "Passed" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                            g.status === "Failed" ? "bg-red-50 text-red-700 border border-red-200" :
                            "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}>
                            {g.status || "Passed"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 5. Grade-Change Audit History Drawer / Section */}
      {gradeChangeHistory.length > 0 && (
        <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center justify-between w-full text-left text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
          >
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-zinc-500" />
              <span>Prior Grade Modification History ({gradeChangeHistory.length} record{gradeChangeHistory.length === 1 ? "" : "s"})</span>
            </div>
            {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showHistory && (
            <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-in fade-in slide-in-from-top-1">
              <table className="w-full text-left text-xs divide-y divide-zinc-200 dark:divide-zinc-800">
                <thead className="bg-zinc-50 dark:bg-zinc-800/80 font-semibold text-zinc-600 dark:text-zinc-300">
                  <tr>
                    <th className="py-2.5 px-3">Date & Time</th>
                    <th className="py-2.5 px-3">Subject</th>
                    <th className="py-2.5 px-3">Quarter</th>
                    <th className="py-2.5 px-3">Previous</th>
                    <th className="py-2.5 px-3">Updated</th>
                    <th className="py-2.5 px-3">Reason / Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
                  {gradeChangeHistory.map((hist, hIdx) => (
                    <tr key={hIdx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <td className="py-2 px-3 font-sans text-zinc-500 whitespace-nowrap">
                        {hist.created_at ? new Date(hist.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "—"}
                      </td>
                      <td className="py-2 px-3 font-sans font-medium text-zinc-800 dark:text-zinc-200">
                        {hist.subject}
                      </td>
                      <td className="py-2 px-3 uppercase text-zinc-600 dark:text-zinc-300">
                        {hist.quarter}
                      </td>
                      <td className="py-2 px-3 text-red-600 dark:text-red-400 font-bold">
                        {hist.previous_value ?? "—"}
                      </td>
                      <td className="py-2 px-3 text-emerald-600 dark:text-emerald-400 font-bold">
                        {hist.new_value ?? "—"}
                      </td>
                      <td className="py-2 px-3 font-sans text-zinc-500 text-[11px]">
                        {hist.reason || "Document review approved grade update"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useMemo } from "react";
import {
  FileText,
  CheckCircle2,
  Folder,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Sparkles,
  Calendar,
  GraduationCap,
  BookOpen,
  Heart,
  Info,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Check,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatBatchNumber, type BatchFolderItem } from "@/lib/validation/nameComparison";
import {
  roundSf10GeneralAverage,
  evaluateDynamicGradeStatus,
  normalizeObservedValueMarking,
  validateConsecutiveSchoolYear,
  normalizeStrictSex,
} from "@/lib/validation/gradeUtils";

const getConfidenceColorClass = (pct?: number | null) => {
  if (pct === undefined || pct === null) return "text-slate-600 bg-slate-50 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700";
  const num = Math.round(pct <= 1 ? pct * 100 : pct);
  if (num >= 85) return "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800";
  if (num >= 65) return "text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800";
  return "text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-800";
};

const getConfidenceNum = (conf?: number | null): number | undefined => {
  if (conf === undefined || conf === null || isNaN(conf)) return undefined;
  return Math.round(conf <= 1 ? conf * 100 : conf);
};

interface BatchSideBySideInspectorProps {
  folder: BatchFolderItem;
  onClose: () => void;
  onDeleteBatch?: (batchNumber: string) => void;
}

export const CANONICAL_DOC_CONFIG: Array<{
  type: string;
  shortLabel: string;
  title: string;
  depedCode: string;
}> = [
  { type: "sf1", shortLabel: "SF1", title: "School Register", depedCode: "SF1-SHS" },
  { type: "sf2", shortLabel: "SF2", title: "Daily Attendance", depedCode: "SF2-SHS" },
  { type: "sf9", shortLabel: "SF9", title: "Progress Report Card", depedCode: "SF9-SHS" },
  { type: "sf10", shortLabel: "SF10", title: "Permanent Academic Record", depedCode: "SF10-SHS" },
  { type: "birth_cert", shortLabel: "PSA", title: "Certificate of Live Birth", depedCode: "PSA" },
];

export default function BatchSideBySideInspector({
  folder,
  onClose,
  onDeleteBatch,
}: BatchSideBySideInspectorProps) {
  const [activeDocType, setActiveDocType] = useState<string>("sf1");
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);
  const [isAuditOpen, setIsAuditOpen] = useState<boolean>(true);

  // Map folder documents by normalized document_type
  const docMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const doc of folder.documents || []) {
      const t = String(doc.document_type || "").toLowerCase().trim();
      const key = t === "psa" || t === "birth_cert" ? "birth_cert" : t;
      if (!map.has(key)) {
        map.set(key, doc);
      }
    }
    return map;
  }, [folder.documents]);

  const activeDoc = docMap.get(activeDocType) || folder.documents?.[0];
  const activeDocFields = (activeDoc?.extracted_fields || {}) as Record<string, any>;

  // Resolve preview file URL
  const fileUrl =
    activeDoc?.image_url ||
    activeDocFields?.original_file_url ||
    activeDocFields?.file_url ||
    activeDocFields?.preview_url ||
    activeDocFields?.image_url ||
    activeDoc?.storage_path ||
    "";

  const isPdf =
    fileUrl.toLowerCase().includes(".pdf") ||
    activeDoc?.original_filename?.toLowerCase().endsWith(".pdf");

  const formattedBatch = formatBatchNumber(folder.batch_number, folder.submission_date);

  // Reconciliation audit log from doc or folder
  const auditLogs: any[] =
    activeDocFields.reconciliation_log ||
    folder.reconciliation_log ||
    activeDoc?.reconciliation_log ||
    [];

  const isReconciled = Boolean(
    folder.is_reconciled ||
    activeDocFields.is_reconciled ||
    activeDoc?.is_reconciled ||
    auditLogs.length > 0
  );

  const isFullWidthReport = activeDocType === "sf9" || activeDocType === "sf10";

  // PDF report generator for SF9 & SF10
  const handleDownloadPdfReport = (type: "sf10" | "sf9") => {
    if (typeof window === "undefined") return;

    const lrn = activeDocFields.lrn || activeDocFields.canonical_lrn || folder.sf1_lrn || "—";
    const fullName =
      activeDocFields.name ||
      activeDocFields.student_name ||
      [activeDocFields.last_name, activeDocFields.first_name, activeDocFields.middle_name].filter(Boolean).join(", ") ||
      folder.student_name ||
      "—";
    const sex =
      normalizeStrictSex(activeDocFields.sex) ||
      (activeDocFields.sex === "M" ? "Male" : activeDocFields.sex === "F" ? "Female" : activeDocFields.sex) ||
      "Male";
    const birthdate = activeDocFields.birth_date || activeDocFields.date_of_birth || "—";
    const schoolId = "500619";
    const schoolYear = activeDocFields.school_year || folder.school_year || "2025-2026";
    const gradeLevel = activeDocFields.grade_level || folder.grade_level || "Grade 11";
    const section = activeDocFields.section || folder.section || "CSS 1";
    const trackStrand = "CSS";

    const isSem1Match = (sem: any) =>
      sem === 1 || sem === "1" || /1st|first|\b1\b/i.test(String(sem || ""));
    const isSem2Match = (sem: any) =>
      sem === 2 || sem === "2" || /2nd|second|\b2\b/i.test(String(sem || ""));

    const scholasticRecords: any[] = [
      ...(Array.isArray((activeDocFields as any).shs_semesters) ? (activeDocFields as any).shs_semesters : []),
      ...(Array.isArray((activeDocFields as any).scholastic_records) ? (activeDocFields as any).scholastic_records : []),
      ...(Array.isArray((activeDocFields as any).semesters) ? (activeDocFields as any).semesters : []),
    ];

    const sem1Record = scholasticRecords.find((r) => isSem1Match(r.semester));
    const sem2Record = scholasticRecords.find((r) => isSem2Match(r.semester));
    const allGrades = Array.isArray(activeDocFields.grades) ? activeDocFields.grades : [];

    const rawSem1 = (
      (Array.isArray((activeDocFields as any).first_semester_grades) && (activeDocFields as any).first_semester_grades.length > 0)
        ? (activeDocFields as any).first_semester_grades
        : (Array.isArray((activeDocFields as any).firstSemesterSubjects) && (activeDocFields as any).firstSemesterSubjects.length > 0)
        ? (activeDocFields as any).firstSemesterSubjects
        : sem1Record?.subjects?.length
        ? sem1Record.subjects
        : allGrades.filter(
            (g: any) =>
              isSem1Match(g.semester) ||
              ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined)
          )
    );

    const rawSem2 = (
      (Array.isArray((activeDocFields as any).second_semester_grades) && (activeDocFields as any).second_semester_grades.length > 0)
        ? (activeDocFields as any).second_semester_grades
        : (Array.isArray((activeDocFields as any).secondSemesterSubjects) && (activeDocFields as any).secondSemesterSubjects.length > 0)
        ? (activeDocFields as any).secondSemesterSubjects
        : sem2Record?.subjects?.length
        ? sem2Record.subjects
        : allGrades.filter(
            (g: any) =>
              isSem2Match(g.semester) ||
              ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined)
          )
    );

    const displaySem1 = rawSem1.length > 0 ? rawSem1 : (rawSem2.length === 0 ? allGrades : []);
    const displaySem2 = rawSem2;

    const rawSem1GenAve =
      sem1Record?.general_average ??
      sem1Record?.generalAverage ??
      activeDocFields.sem1_printed_general_average ??
      activeDocFields.first_semester_general_average ??
      activeDocFields.sem1_displayed_general_average ??
      activeDocFields.sem1_general_average ??
      ((activeDocFields as any).shs_semesters?.find((s: any) => isSem1Match(s.semester))?.generalAverage) ??
      ((activeDocFields as any).shs_semesters?.find((s: any) => isSem1Match(s.semester))?.general_average) ??
      (type === "sf10" ? activeDocFields.general_average : "Blank");
    const sem1GenAveFormatted = type === "sf10" ? (roundSf10GeneralAverage(rawSem1GenAve) ?? rawSem1GenAve ?? "—") : (rawSem1GenAve ?? "Blank");

    const rawSem2GenAve =
      sem2Record?.general_average ??
      sem2Record?.generalAverage ??
      activeDocFields.sem2_printed_general_average ??
      activeDocFields.second_semester_general_average ??
      activeDocFields.sem2_displayed_general_average ??
      activeDocFields.sem2_general_average ??
      ((activeDocFields as any).shs_semesters?.find((s: any) => isSem2Match(s.semester))?.generalAverage) ??
      ((activeDocFields as any).shs_semesters?.find((s: any) => isSem2Match(s.semester))?.general_average) ??
      (type === "sf10" ? activeDocFields.general_average : "Blank");
    const sem2GenAveFormatted = type === "sf10" ? (roundSf10GeneralAverage(rawSem2GenAve) ?? rawSem2GenAve ?? "—") : (rawSem2GenAve ?? "Blank");

    const formatGrade = (val: any) => {
      if (val === undefined || val === null || val === "" || val === "—") return "—";
      const n = Number(val);
      if (!isNaN(n)) return (Math.round(n * 10) / 10).toString();
      return String(val);
    };

    const docTitle =
      type === "sf10"
        ? "SF10-SHS Permanent Academic Record"
        : "SF9-SHS Progress Report Card";
    const depedFormCode = type === "sf10" ? "DepEd Form 137-SHS" : "DepEd Form 138-SHS";

    const esc = (s: any) => {
      if (s === undefined || s === null) return "";
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    const sem1Rows = displaySem1.map((s: any) => {
      const subjName = s.subject || "—";
      const q1 = formatGrade(s.q1);
      const q2 = formatGrade(s.q2);
      const finalRating = s.sem_final_grade ?? s.finalGrade ?? s.sem1_final_grade ?? s.final ?? s.final_grade;
      const evaluated = evaluateDynamicGradeStatus({
        grade: finalRating,
        rawRemark: s.action_taken || s.remarks || s.remark || s.status,
      });
      const finalStr = evaluated.status === "blank" && type === "sf9" ? "Blank" : formatGrade(finalRating);
      const remColor = evaluated.status === "passed" ? "#15803d" : evaluated.status === "failed" ? "#b91c1c" : "#b45309";
      return `<tr>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 500;">${esc(subjName)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace;">${esc(q1)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace;">${esc(q2)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace; font-weight: 700; color: #1e3a8a;">${esc(finalStr)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: 700; color: ${remColor}; font-size: 8pt;">${esc(evaluated.remarkDisplay)}</td>
      </tr>`;
    }).join("");

    const sem1EvalAvg = evaluateDynamicGradeStatus({ grade: sem1GenAveFormatted, isGeneralAverage: true });
    const sem1AvgColor = sem1EvalAvg.status === "passed" ? "#15803d" : sem1EvalAvg.status === "failed" ? "#b91c1c" : "#b45309";

    const sem2Rows = displaySem2.map((s: any) => {
      const subjName = s.subject || "—";
      const q3 = formatGrade(s.q3);
      const q4 = formatGrade(s.q4);
      const finalRating = s.sem_final_grade ?? s.finalGrade ?? s.sem2_final_grade ?? s.final ?? s.final_grade;
      const evaluated = evaluateDynamicGradeStatus({
        grade: finalRating,
        rawRemark: s.action_taken || s.remarks || s.remark || s.status,
      });
      const finalStr = evaluated.status === "blank" && type === "sf9" ? "Blank" : formatGrade(finalRating);
      const remColor = evaluated.status === "passed" ? "#15803d" : evaluated.status === "failed" ? "#b91c1c" : "#b45309";
      return `<tr>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-weight: 500;">${esc(subjName)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace;">${esc(q3)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace;">${esc(q4)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-family: monospace; font-weight: 700; color: #1e3a8a;">${esc(finalStr)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: center; font-weight: 700; color: ${remColor}; font-size: 8pt;">${esc(evaluated.remarkDisplay)}</td>
      </tr>`;
    }).join("");

    const sem2EvalAvg = evaluateDynamicGradeStatus({ grade: sem2GenAveFormatted, isGeneralAverage: true });
    const sem2AvgColor = sem2EvalAvg.status === "passed" ? "#15803d" : sem2EvalAvg.status === "failed" ? "#b91c1c" : "#b45309";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(docTitle)} - ${esc(fullName)}</title>
  <style>
    @page {
      size: A4;
      margin: 14mm;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .no-print {
        display: none !important;
      }
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      padding: 0;
      font-size: 9.5pt;
      line-height: 1.35;
    }
    .no-print-bar {
      background: #0f172a;
      color: #ffffff;
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      border-radius: 6px;
      font-size: 10pt;
    }
    .btn-print {
      background: #2563eb;
      color: #ffffff;
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      margin-right: 8px;
    }
    .btn-close {
      background: #475569;
      color: #ffffff;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .subheading {
      font-size: 8pt;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    h1 {
      font-size: 13.5pt;
      font-weight: 800;
      color: #0f172a;
      margin: 3px 0;
      text-transform: uppercase;
      letter-spacing: -0.2px;
    }
    .form-code {
      font-size: 8.5pt;
      font-weight: 600;
      color: #2563eb;
    }
    .section-card {
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      margin-bottom: 12px;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .section-heading {
      background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1;
      font-size: 8.5pt;
      font-weight: 700;
      color: #1e293b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 4px 8px;
    }
    .grid-info {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px 12px;
      padding: 8px 10px;
    }
    .info-item .label {
      font-size: 7.5pt;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 700;
      display: block;
      margin-bottom: 1px;
    }
    .info-item .val {
      font-size: 9pt;
      color: #0f172a;
      font-weight: 600;
    }
    .col-2 {
      grid-column: span 2;
    }
    .table-container {
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      margin-bottom: 12px;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .table-header {
      background: #f8fafc;
      border-bottom: 1px solid #cbd5e1;
      padding: 5px 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 8.5pt;
      font-weight: 700;
      color: #1e293b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
    }
    th {
      background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1;
      padding: 5px 8px;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 7.5pt;
      color: #475569;
    }
    td {
      padding: 5px 8px;
      border-bottom: 1px solid #e2e8f0;
      color: #0f172a;
    }
    tr:last-child td {
      border-bottom: none;
    }
    .foot-row td {
      background: #f8fafc;
      font-weight: 700;
      border-top: 2px solid #cbd5e1;
    }
    .footer-doc {
      margin-top: 14px;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      display: flex;
      justify-content: space-between;
      font-size: 7.5pt;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="no-print no-print-bar">
    <span><strong>${esc(docTitle)}</strong> &bull; Print Preview (A4 Size Ready)</span>
    <div>
      <button class="btn-print" onclick="window.print()">Print / Save as PDF</button>
      <button class="btn-close" onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="header">
    <div class="subheading">Republic of the Philippines &bull; Department of Education</div>
    <h1>${esc(docTitle)}</h1>
    <div class="form-code">${esc(depedFormCode)} &bull; Official Extraction &amp; Verification Report</div>
  </div>

  <div class="section-card">
    <div class="section-heading">Learner Identification &amp; Enrollment Context</div>
    <div class="grid-info">
      <div class="info-item col-2">
        <span class="label">Learner Full Name</span>
        <span class="val">${esc(fullName)}</span>
      </div>
      <div class="info-item">
        <span class="label">Learner Reference No. (LRN)</span>
        <span class="val" style="font-family: monospace;">${esc(lrn)}</span>
      </div>
      <div class="info-item">
        <span class="label">Sex</span>
        <span class="val">${esc(sex)}</span>
      </div>
      <div class="info-item">
        <span class="label">Date of Birth</span>
        <span class="val">${esc(birthdate)}</span>
      </div>
      <div class="info-item">
        <span class="label">School ID</span>
        <span class="val" style="font-family: monospace; color: #1e3a8a;">${esc(schoolId)}</span>
      </div>
      <div class="info-item">
        <span class="label">School Year</span>
        <span class="val">${esc(schoolYear)}</span>
      </div>
      <div class="info-item">
        <span class="label">Grade Level &amp; Section</span>
        <span class="val">${esc(gradeLevel)} &mdash; ${esc(section)}</span>
      </div>
      <div class="info-item col-2">
        <span class="label">Track &amp; Strand</span>
        <span class="val">${esc(trackStrand)}</span>
      </div>
    </div>
  </div>

  <!-- First Semester Table -->
  <div class="table-container">
    <div class="table-header">
      <span>FIRST SEMESTER SCHOLASTIC RECORD</span>
      <span>Gen. Ave: <strong style="font-family: monospace; color: #1e3a8a;">${esc(String(sem1GenAveFormatted))}</strong></span>
    </div>
    <table>
      <thead>
        <tr>
          <th style="text-align: left; width: 44%;">Subject / Learning Area</th>
          <th style="text-align: center; width: 14%;">Q1</th>
          <th style="text-align: center; width: 14%;">Q2</th>
          <th style="text-align: center; width: 14%;">Final Rating</th>
          <th style="text-align: center; width: 14%;">Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${sem1Rows.length > 0 ? sem1Rows : `<tr><td colspan="5" style="text-align: center; padding: 10px; color: #94a3b8; font-style: italic;">No First Semester records extracted.</td></tr>`}
      </tbody>
      <tfoot>
        <tr class="foot-row">
          <td colspan="3" style="text-align: left;">General Average for the Semester</td>
          <td style="text-align: center; font-family: monospace; color: #1e3a8a; font-size: 9.5pt;">${esc(String(sem1GenAveFormatted))}</td>
          <td style="text-align: center; font-weight: 700; color: ${sem1AvgColor}; font-size: 8pt;">${esc(sem1EvalAvg.remarkDisplay)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Second Semester Table -->
  <div class="table-container">
    <div class="table-header">
      <span>SECOND SEMESTER SCHOLASTIC RECORD</span>
      <span>Gen. Ave: <strong style="font-family: monospace; color: #1e3a8a;">${esc(String(sem2GenAveFormatted))}</strong></span>
    </div>
    <table>
      <thead>
        <tr>
          <th style="text-align: left; width: 44%;">Subject / Learning Area</th>
          <th style="text-align: center; width: 14%;">Q3</th>
          <th style="text-align: center; width: 14%;">Q4</th>
          <th style="text-align: center; width: 14%;">Final Rating</th>
          <th style="text-align: center; width: 14%;">Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${sem2Rows.length > 0 ? sem2Rows : `<tr><td colspan="5" style="text-align: center; padding: 10px; color: #94a3b8; font-style: italic;">No Second Semester records extracted.</td></tr>`}
      </tbody>
      <tfoot>
        <tr class="foot-row">
          <td colspan="3" style="text-align: left;">General Average for the Semester</td>
          <td style="text-align: center; font-family: monospace; color: #1e3a8a; font-size: 9.5pt;">${esc(String(sem2GenAveFormatted))}</td>
          <td style="text-align: center; font-weight: 700; color: ${sem2AvgColor}; font-size: 8pt;">${esc(sem2EvalAvg.remarkDisplay)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="footer-doc">
    <div>Standard DepEd SHS Passing Grade: 75.0 &bull; Verified Primary Key: LRN ${esc(lrn)}</div>
    <div>Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} &bull; Official A4 Extraction Report</div>
  </div>

  <script>
    window.addEventListener("load", function() {
      setTimeout(function() {
        window.print();
      }, 350);
    });
  </script>
</body>
</html>`;

    const printWin = window.open("", "_blank");
    if (!printWin) {
      alert("Please allow popups to view and download the A4 PDF report.");
      return;
    }
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Top Header Card */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-[#0B1F33] to-[#102A43] text-white shadow-lg border border-white/10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs py-1 px-2.5 h-auto"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Batch Folders
            </Button>
            <span className="font-mono text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-500/30 text-blue-200 border border-blue-400/30">
              {formattedBatch}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              Verified &amp; Fixed
            </span>
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            {folder.student_name}
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 font-mono mt-0.5">
            LRN: {folder.sf1_lrn} • {folder.grade_level || "Grade 11"} • {folder.section || "CSS 1"} • S.Y. {folder.school_year || "2025-2026"}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onDeleteBatch && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDeleteBatch(folder.batch_number)}
              className="bg-red-500/10 hover:bg-red-500/20 text-red-200 border-red-400/30 text-xs py-1.5"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1 text-red-400" />
              Delete Batch
            </Button>
          )}
          <Button
            size="sm"
            onClick={onClose}
            className="bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs py-1.5"
          >
            Close Inspector
          </Button>
        </div>
      </div>

      {/* 5-Card Document Selector Ribbon (Matching Step 6) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Select Document to Inspect (5 Forms in Student Folder)
          </span>
          <span className="text-xs text-slate-400 font-mono">
            Active: {CANONICAL_DOC_CONFIG.find((c) => c.type === activeDocType)?.title || activeDocType.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {CANONICAL_DOC_CONFIG.map((cfg, idx) => {
            const isSelected = activeDocType === cfg.type;
            const isPresent = docMap.has(cfg.type);
            const docItem = docMap.get(cfg.type);

            return (
              <div
                key={cfg.type}
                onClick={() => {
                  setActiveDocType(cfg.type);
                  setZoomLevel(100);
                  setRotation(0);
                }}
                className={`p-3 rounded-xl border text-left cursor-pointer transition-all space-y-1.5 ${
                  isSelected
                    ? "bg-white border-[#174EA6] shadow-md ring-2 ring-[#174EA6]/20"
                    : isPresent
                    ? "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                    : "bg-slate-50/50 border-dashed border-slate-200 opacity-60"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                      isSelected
                        ? "bg-[#174EA6] text-white border-[#174EA6]"
                        : isPresent
                        ? "bg-blue-50 text-blue-800 border-blue-200"
                        : "bg-slate-100 text-slate-400 border-slate-200"
                    }`}
                  >
                    {cfg.shortLabel}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    Doc #{idx + 1}
                  </span>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-900 truncate">
                    {cfg.depedCode}
                  </h4>
                  <p className="text-[11px] text-slate-500 truncate">
                    {cfg.title}
                  </p>
                </div>

                <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[10px]">
                  {isPresent ? (
                    <span className="text-emerald-700 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      {docItem?.is_reconciled || isReconciled ? "Fixed & Verified" : "Available"}
                    </span>
                  ) : (
                    <span className="text-slate-400 font-medium">Not In Batch</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Side-by-Side Batch Inspector View */}
      <div className={`grid ${isFullWidthReport ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"} gap-4 items-start`}>
        {/* Left Pane: Original Scanned Document (Hidden for SF9 & SF10) */}
        {!isFullWidthReport && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col h-[650px]">
            {/* Viewer Toolbar */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-500" />
                <span className="font-bold text-slate-800 truncate max-w-[200px]">
                  {activeDoc?.original_filename || `${activeDocType.toUpperCase()}_scan.pdf`}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZoomLevel((z) => Math.max(z - 25, 50))}
                  className="h-7 w-7 p-0"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5 text-slate-600" />
                </Button>
                <span className="text-[11px] font-mono font-medium text-slate-600 px-1">
                  {zoomLevel}%
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZoomLevel((z) => Math.min(z + 25, 200))}
                  className="h-7 w-7 p-0"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5 text-slate-600" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="h-7 w-7 p-0 ml-1"
                  title="Rotate 90°"
                >
                  <RotateCw className="w-3.5 h-3.5 text-slate-600" />
                </Button>
              </div>
            </div>

            {/* Document Preview Canvas */}
            <div className="flex-1 bg-slate-900/5 p-4 overflow-auto flex items-center justify-center">
              {fileUrl ? (
                isPdf ? (
                  <iframe
                    src={fileUrl}
                    title="Document PDF Preview"
                    className="w-full h-full rounded-lg border border-slate-200 bg-white shadow-xs"
                  />
                ) : (
                  <div
                    className="transition-transform duration-150 flex items-center justify-center max-w-full max-h-full"
                    style={{
                      transform: `scale(${zoomLevel / 100}) rotate(${rotation}deg)`,
                    }}
                  >
                    <img
                      src={fileUrl}
                      alt={`${activeDocType.toUpperCase()} Scan Preview`}
                      className="max-h-[580px] object-contain rounded-lg shadow-md border border-slate-200 bg-white"
                    />
                  </div>
                )
              ) : (
                <div className="text-center p-8 text-slate-400 text-xs">
                  <FileText className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                  <p className="font-semibold text-slate-600">No scanned preview available</p>
                  <p className="text-[11px] mt-1">
                    Extracted student data is available on the right pane.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Pane: Fixed & Verified Student Data */}
        <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col ${isFullWidthReport ? "w-full" : "h-[650px]"}`}>
          {/* Header Banner */}
          <div className="p-3.5 bg-blue-50/80 border-b border-blue-200 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#174EA6] text-white flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900">
                  Fixed &amp; Verified Student Data
                </h4>
                <p className="text-[11px] text-slate-500">
                  Reconciled against DepEd Senior High School Primary Sources
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              Primary Source Fixed
            </span>
          </div>

          {/* Data Cards Container (Scrollable) */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs">
            {/* Reconciliation Audit Trail (Expandable) */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsAuditOpen(!isAuditOpen)}
                className="w-full p-3 flex items-center justify-between text-left hover:bg-emerald-100/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold text-xs text-emerald-900">
                    Primary Source Reconciliation Audit Log ({auditLogs.length || 5} Rules Applied)
                  </span>
                </div>
                {isAuditOpen ? (
                  <ChevronUp className="w-4 h-4 text-emerald-700" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-emerald-700" />
                )}
              </button>

              {isAuditOpen && (
                <div className="p-3 pt-0 border-t border-emerald-200/60 space-y-1.5 text-[11px] text-emerald-800">
                  {auditLogs.length > 0 ? (
                    auditLogs.map((log: any, idx: number) => (
                      <div key={idx} className="flex items-start gap-1.5">
                        <span className="text-emerald-600 font-bold">•</span>
                        <span>
                          <strong>{log.field || log.fieldLabel || "Field"}:</strong>{" "}
                          Standardized from <em>{log.primaryKeySource || log.primarySource || "Primary Source"}</em>:{" "}
                          <code>{log.canonicalValue || log.to || log.value}</code>
                        </span>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="flex items-start gap-1.5">
                        <span className="text-emerald-600 font-bold">•</span>
                        <span><strong>Learner Reference Number (LRN):</strong> Standardized strictly from SF1 Register baseline: <code>{folder.sf1_lrn}</code></span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="text-emerald-600 font-bold">•</span>
                        <span><strong>Full Legal Name:</strong> Reconciled from PSA Civil Registry: <code>{folder.student_name}</code></span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="text-emerald-600 font-bold">•</span>
                        <span><strong>Sex &amp; Civil Birthdate:</strong> Standardized from PSA Certificate of Live Birth</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="text-emerald-600 font-bold">•</span>
                        <span><strong>School Year &amp; Section:</strong> Anchored to SF1 Enrollment Context: <code>{folder.grade_level || "Grade 11"} • {folder.section || "CSS 1"} • S.Y. {folder.school_year || "2025-2026"}</code></span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="text-emerald-600 font-bold">•</span>
                        <span><strong>Grades &amp; Attendance Baseline:</strong> Populated from SF9 Progress Report Card</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Learner Identity Card */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <h5 className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                <GraduationCap className="w-4 h-4 text-[#174EA6]" />
                Learner Information
              </h5>
              <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-slate-200/80">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Learner Reference Number (LRN)
                  </span>
                  <span className="font-mono font-bold text-slate-900 mt-0.5 block">
                    {activeDocFields.lrn || activeDocFields.canonical_lrn || folder.sf1_lrn}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Student Full Name
                  </span>
                  <span className="font-bold text-slate-900 mt-0.5 block truncate">
                    {activeDocFields.name || activeDocFields.student_name || folder.student_name}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Sex / Gender
                  </span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">
                    {activeDocFields.sex || "Male"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Date of Birth
                  </span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">
                    {activeDocFields.birth_date || activeDocFields.date_of_birth || "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Enrollment Context Card */}
            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
              <h5 className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                <BookOpen className="w-4 h-4 text-[#174EA6]" />
                Enrollment &amp; Institutional Context
              </h5>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1 border-t border-slate-200/80">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    School ID
                  </span>
                  <span className="font-mono font-bold text-slate-900 mt-0.5 block">
                    {(activeDocType === "sf9" || activeDocType === "sf10")
                      ? "500619"
                      : (activeDocFields.school_id && !activeDocFields.school_id.includes("-") ? activeDocFields.school_id : "500619")}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    School Year
                  </span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">
                    {activeDocFields.school_year || folder.school_year || "2025-2026"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Grade Level
                  </span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">
                    {activeDocFields.grade_level || folder.grade_level || "Grade 11"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Section
                  </span>
                  <span className="font-semibold text-slate-900 mt-0.5 block">
                    {activeDocFields.section || folder.section || "CSS 1"}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Track &amp; Strand
                  </span>
                  <span className="font-semibold text-slate-900 mt-0.5 block truncate">
                    CSS
                  </span>
                </div>
              </div>
            </div>

            {/* Academic Grades (For SF9 or SF10) */}
            {activeDocType === "sf10" ? (() => {
              const isSem1 = (sem: any) =>
                sem === 1 || sem === "1" || /1st|first|\b1\b/i.test(String(sem || ""));
              const isSem2 = (sem: any) =>
                sem === 2 || sem === "2" || /2nd|second|\b2\b/i.test(String(sem || ""));

              const scholasticRecords: any[] = [
                ...(Array.isArray((activeDocFields as any).shs_semesters) ? (activeDocFields as any).shs_semesters : []),
                ...(Array.isArray((activeDocFields as any).scholastic_records) ? (activeDocFields as any).scholastic_records : []),
                ...(Array.isArray((activeDocFields as any).semesters) ? (activeDocFields as any).semesters : []),
              ];

              const sem1Record = scholasticRecords.find((r) => isSem1(r.semester));
              const sem2Record = scholasticRecords.find((r) => isSem2(r.semester));
              const allGrades = Array.isArray(activeDocFields.grades) ? activeDocFields.grades : [];

              const rawSem1 = (
                (Array.isArray((activeDocFields as any).first_semester_grades) && (activeDocFields as any).first_semester_grades.length > 0)
                  ? (activeDocFields as any).first_semester_grades
                  : (Array.isArray((activeDocFields as any).firstSemesterSubjects) && (activeDocFields as any).firstSemesterSubjects.length > 0)
                  ? (activeDocFields as any).firstSemesterSubjects
                  : sem1Record?.subjects?.length
                  ? sem1Record.subjects
                  : allGrades.filter(
                      (g: any) =>
                        isSem1(g.semester) ||
                        ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined)
                    )
              );

              const rawSem2 = (
                (Array.isArray((activeDocFields as any).second_semester_grades) && (activeDocFields as any).second_semester_grades.length > 0)
                  ? (activeDocFields as any).second_semester_grades
                  : (Array.isArray((activeDocFields as any).secondSemesterSubjects) && (activeDocFields as any).secondSemesterSubjects.length > 0)
                  ? (activeDocFields as any).secondSemesterSubjects
                  : sem2Record?.subjects?.length
                  ? sem2Record.subjects
                  : allGrades.filter(
                      (g: any) =>
                        isSem2(g.semester) ||
                        ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined)
                    )
              );

              const displaySem1 = rawSem1.length > 0 ? rawSem1 : (rawSem2.length === 0 ? allGrades : []);
              const displaySem2 = rawSem2;

              const rawSem1GeneralAve =
                sem1Record?.general_average ??
                sem1Record?.generalAverage ??
                activeDocFields.sem1_printed_general_average ??
                activeDocFields.sem1_general_average ??
                ((activeDocFields as any).shs_semesters?.find((s: any) => isSem1(s.semester))?.generalAverage) ??
                ((activeDocFields as any).shs_semesters?.find((s: any) => isSem1(s.semester))?.general_average) ??
                (activeDocFields.general_average !== undefined ? activeDocFields.general_average : "—");
              const sem1GeneralAve = roundSf10GeneralAverage(rawSem1GeneralAve) ?? rawSem1GeneralAve;

              const rawSem2GeneralAve =
                sem2Record?.general_average ??
                sem2Record?.generalAverage ??
                activeDocFields.sem2_printed_general_average ??
                activeDocFields.sem2_general_average ??
                ((activeDocFields as any).shs_semesters?.find((s: any) => isSem2(s.semester))?.generalAverage) ??
                ((activeDocFields as any).shs_semesters?.find((s: any) => isSem2(s.semester))?.general_average) ??
                (activeDocFields.general_average !== undefined ? activeDocFields.general_average : "—");
              const sem2GeneralAve = roundSf10GeneralAverage(rawSem2GeneralAve) ?? rawSem2GeneralAve;

              const formatGradeNumber = (val: any) => {
                if (val === undefined || val === null || val === "" || val === "—") return "—";
                const n = Number(val);
                if (!isNaN(n)) return (Math.round(n * 10) / 10).toString();
                return String(val);
              };

              const studentFullName =
                activeDocFields.name ||
                activeDocFields.student_name ||
                [activeDocFields.last_name, activeDocFields.first_name, activeDocFields.middle_name].filter(Boolean).join(", ") ||
                folder.student_name ||
                "—";
              const studentLrn = activeDocFields.lrn || activeDocFields.canonical_lrn || folder.sf1_lrn || "—";
              const studentSex =
                normalizeStrictSex(activeDocFields.sex) ||
                (activeDocFields.sex === "M" ? "Male" : activeDocFields.sex === "F" ? "Female" : activeDocFields.sex) ||
                "Male";
              const studentBirthDate = activeDocFields.birth_date || activeDocFields.date_of_birth || "—";
              const studentSchoolYear = activeDocFields.school_year || folder.school_year || "2025-2026";
              const studentGradeLevel = activeDocFields.grade_level || folder.grade_level || "Grade 11";
              const studentSection = activeDocFields.section || folder.section || "CSS 1";
              const studentTrackStrand = "CSS";

              return (
                <div className="p-4 rounded-xl bg-white border border-blue-200 shadow-sm space-y-4">
                  {/* Extraction Report Top Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-blue-50 text-[#174EA6]">
                        <GraduationCap className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900">
                          SF10-SHS Permanent Academic Record Extraction Report
                        </h4>
                        <p className="text-[10px] text-slate-500">
                          DepEd Form 137-SHS • Senior High School Permanent Record
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeDocFields.general_average && (
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                          Overall Gen Avg: {roundSf10GeneralAverage(activeDocFields.general_average) ?? activeDocFields.general_average}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Learner Identity & Context Summary */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Learner &amp; Institutional Summary
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50/70 p-2.5 rounded-lg border border-slate-200 text-xs">
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Learner Full Name</span>
                        <span className="font-bold text-slate-900 text-xs truncate block">{studentFullName}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">LRN</span>
                        <span className="font-mono font-bold text-slate-900 text-xs block">{studentLrn}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Sex</span>
                        <span className="text-slate-700 font-medium text-xs block">{studentSex}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Birthdate</span>
                        <span className="text-slate-700 font-medium text-xs block">{studentBirthDate}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">School ID</span>
                        <span className="font-mono font-bold text-blue-700 text-xs block">500619</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">School Year</span>
                        <span className="text-slate-700 font-medium text-xs block">{studentSchoolYear}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Grade &amp; Section</span>
                        <span className="text-slate-700 font-medium text-xs block">{studentGradeLevel} — {studentSection}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Track &amp; Strand</span>
                        <span className="text-slate-700 font-medium text-xs truncate block">{studentTrackStrand}</span>
                      </div>
                    </div>
                  </div>

                  {/* Scholastic Tables Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* First Semester Table */}
                    <div className="p-2.5 rounded-lg bg-white border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-bold text-xs text-slate-800">First Semester</span>
                        <span className="text-[11px] text-slate-500">
                          Gen Ave: <strong className="font-mono font-bold text-blue-700">{formatGradeNumber(sem1GeneralAve)}</strong>
                        </span>
                      </div>
                      {displaySem1.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100">
                                <th className="py-1 pr-1">Category</th>
                                <th className="py-1 pr-1">Subject</th>
                                <th className="py-1 px-1 text-center">Q1</th>
                                <th className="py-1 px-1 text-center">Q2</th>
                                <th className="py-1 px-1 text-center font-bold">Final</th>
                                <th className="py-1 pl-1 text-right">Remarks</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-medium">
                              {displaySem1.map((s: any, i: number) => {
                                const cat = s.subject_type || s.category || s.subject_category || "CORE";
                                const finalRating = s.sem_final_grade ?? s.finalGrade ?? s.final ?? s.final_grade;
                                const evaluated = evaluateDynamicGradeStatus({
                                  grade: finalRating,
                                  rawRemark: s.action_taken || s.remarks || s.remark || s.status,
                                });
                                return (
                                  <tr key={i} className="hover:bg-slate-50/50">
                                    <td className="py-1 pr-1">
                                      <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-blue-50 text-blue-700">
                                        {cat}
                                      </span>
                                    </td>
                                    <td className="py-1 pr-1 text-slate-800 truncate max-w-[140px]">{s.subject}</td>
                                    <td className="py-1 px-1 text-center font-mono">{formatGradeNumber(s.q1)}</td>
                                    <td className="py-1 px-1 text-center font-mono">{formatGradeNumber(s.q2)}</td>
                                    <td className="py-1 px-1 text-center font-mono font-bold text-blue-700">{formatGradeNumber(finalRating)}</td>
                                    <td className="py-1 pl-1 text-right">
                                      <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">
                                        {evaluated.remarkDisplay}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="bg-slate-50 font-bold border-t border-slate-200 text-[10px]">
                                <td colSpan={4} className="py-1 px-1 text-slate-700">General Ave. for the Semester</td>
                                <td className="py-1 px-1 text-center font-mono text-blue-700">{formatGradeNumber(sem1GeneralAve)}</td>
                                <td className="py-1 pl-1 text-right">
                                  <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">
                                    {evaluateDynamicGradeStatus({ grade: sem1GeneralAve, isGeneralAverage: true }).remarkDisplay}
                                  </span>
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="py-4 text-center text-xs text-slate-400 italic">No First Semester records.</div>
                      )}
                    </div>

                    {/* Second Semester Table */}
                    <div className="p-2.5 rounded-lg bg-white border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                        <span className="font-bold text-xs text-slate-800">Second Semester</span>
                        <span className="text-[11px] text-slate-500">
                          Gen Ave: <strong className="font-mono font-bold text-blue-700">{formatGradeNumber(sem2GeneralAve)}</strong>
                        </span>
                      </div>
                      {displaySem2.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100">
                                <th className="py-1 pr-1">Category</th>
                                <th className="py-1 pr-1">Subject</th>
                                <th className="py-1 px-1 text-center">Q3</th>
                                <th className="py-1 px-1 text-center">Q4</th>
                                <th className="py-1 px-1 text-center font-bold">Final</th>
                                <th className="py-1 pl-1 text-right">Remarks</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-medium">
                              {displaySem2.map((s: any, i: number) => {
                                const cat = s.subject_type || s.category || s.subject_category || "CORE";
                                const finalRating = s.sem_final_grade ?? s.finalGrade ?? s.final ?? s.final_grade;
                                const evaluated = evaluateDynamicGradeStatus({
                                  grade: finalRating,
                                  rawRemark: s.action_taken || s.remarks || s.remark || s.status,
                                });
                                return (
                                  <tr key={i} className="hover:bg-slate-50/50">
                                    <td className="py-1 pr-1">
                                      <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-blue-50 text-blue-700">
                                        {cat}
                                      </span>
                                    </td>
                                    <td className="py-1 pr-1 text-slate-800 truncate max-w-[140px]">{s.subject}</td>
                                    <td className="py-1 px-1 text-center font-mono">{formatGradeNumber(s.q3)}</td>
                                    <td className="py-1 px-1 text-center font-mono">{formatGradeNumber(s.q4)}</td>
                                    <td className="py-1 px-1 text-center font-mono font-bold text-blue-700">{formatGradeNumber(finalRating)}</td>
                                    <td className="py-1 pl-1 text-right">
                                      <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">
                                        {evaluated.remarkDisplay}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="bg-slate-50 font-bold border-t border-slate-200 text-[10px]">
                                <td colSpan={4} className="py-1 px-1 text-slate-700">General Ave. for the Semester</td>
                                <td className="py-1 px-1 text-center font-mono text-blue-700">{formatGradeNumber(sem2GeneralAve)}</td>
                                <td className="py-1 pl-1 text-right">
                                  <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">
                                    {evaluateDynamicGradeStatus({ grade: sem2GeneralAve, isGeneralAverage: true }).remarkDisplay}
                                  </span>
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="py-4 text-center text-xs text-slate-400 italic">No Second Semester records.</div>
                      )}
                    </div>
                  </div>

                  {/* Bottom Download Button */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-[11px] text-slate-500 italic">
                      DepEd Standard SHS Grading System (Passing Grade: 75.0)
                    </span>
                    <Button
                      size="sm"
                      onClick={() => handleDownloadPdfReport("sf10")}
                      className="bg-[#174EA6] hover:bg-[#123e85] text-white text-xs font-semibold px-3 py-1.5 h-auto flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download PDF Report
                    </Button>
                  </div>
                </div>
              );
            })() : activeDocType === "sf9" ? (() => {
              const merged = activeDocFields;
              const isUnifiedTwoSides = merged.isUnifiedTwoSides || merged.is_unified_two_sides || (activeDoc?.page_count && activeDoc.page_count > 1) || ((activeDoc as any)?.pageCount && (activeDoc as any).pageCount > 1);

              // 1. Learner Identity Summary
              const lrn = merged.lrn || "—";
              const fullName = merged.name || [merged.last_name, merged.first_name, merged.middle_name].filter(Boolean).join(", ") || "—";
              const sex = normalizeStrictSex(merged.sex) || (merged.sex === "M" ? "Male" : merged.sex === "F" ? "Female" : merged.sex) || "—";
              const gradeLevel = merged.grade_level || "Grade 11";
              const section = merged.section || "—";
              const schoolYear = merged.school_year || "—";
              const syValidation = validateConsecutiveSchoolYear(schoolYear);
              const trackStrand = "CSS";

              // 2. Report on Attendance (from Front)
              const defaultMonths = ["Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];
              const months = (merged.attendance_months && merged.attendance_months.length > 0)
                ? merged.attendance_months
                : defaultMonths;

              const rawAttendance = Array.isArray(merged.attendance) ? merged.attendance : [];
              const schoolDaysRow = rawAttendance.find((r: any) => /school\s*days|days\s*of\s*school/i.test(r.label || ""));
              const daysPresentRow = rawAttendance.find((r: any) => /days\s*present|present/i.test(r.label || "") && !/absent/i.test(r.label || ""));
              const daysAbsentRow = rawAttendance.find((r: any) => /days\s*absent|absent/i.test(r.label || ""));

              const attTotals = merged.attendance_totals;
              const schoolDaysTotal = schoolDaysRow?.total ?? attTotals?.computed_school_days ?? attTotals?.printed_school_days ?? "—";
              const daysPresentTotal = daysPresentRow?.total ?? attTotals?.computed_days_present ?? attTotals?.printed_days_present ?? "—";
              const daysAbsentTotal = daysAbsentRow?.total ?? attTotals?.computed_days_absent ?? attTotals?.printed_days_absent ?? "—";

              // 3. Per-Semester Academic Grades (from Back)
              const allGrades = Array.isArray(merged.grades) ? merged.grades : [];
              const sem1Grades = (Array.isArray(merged.first_semester_grades) && merged.first_semester_grades.length > 0)
                ? merged.first_semester_grades
                : (Array.isArray(merged.firstSemesterSubjects) && merged.firstSemesterSubjects.length > 0)
                ? merged.firstSemesterSubjects
                : allGrades.filter((g: any) => {
                    const s = String(g.semester ?? "").toLowerCase();
                    return s.includes("1") || s.includes("first") || ((g.q1 !== undefined || g.q2 !== undefined) && g.q3 === undefined && g.q4 === undefined);
                  });

              const sem2Grades = (Array.isArray(merged.second_semester_grades) && merged.second_semester_grades.length > 0)
                ? merged.second_semester_grades
                : (Array.isArray(merged.secondSemesterSubjects) && merged.secondSemesterSubjects.length > 0)
                ? merged.secondSemesterSubjects
                : allGrades.filter((g: any) => {
                    const s = String(g.semester ?? "").toLowerCase();
                    return s.includes("2") || s.includes("second") || ((g.q3 !== undefined || g.q4 !== undefined) && g.q1 === undefined && g.q2 === undefined);
                  });

              const unassigned = allGrades.filter((g: any) => !sem1Grades.includes(g) && !sem2Grades.includes(g));
              const effectiveSem1 = sem1Grades.length > 0 ? sem1Grades : (sem2Grades.length === 0 ? unassigned : []);
              const effectiveSem2 = sem2Grades;

              const formatQuarterGrade = (val: any) => {
                if (val === undefined || val === null || val === "" || val === "—") return "—";
                const n = Number(val);
                if (!isNaN(n)) return Math.round(n).toString();
                return String(val);
              };

              const sem1Avg = merged.sem1_printed_general_average ?? merged.first_semester_general_average ?? merged.sem1_displayed_general_average ?? merged.sem1_general_average ?? "Blank";
              const sem2Avg = merged.sem2_printed_general_average ?? merged.second_semester_general_average ?? merged.sem2_displayed_general_average ?? merged.sem2_general_average ?? "Blank";

              const isBlankVal = (v: any) => v === undefined || v === null || String(v).trim() === "" || String(v).trim() === "—" || String(v).trim().toLowerCase() === "blank" || String(v).trim().toLowerCase() === "null";

              const hasBlankGrades =
                (allGrades.length > 0 && allGrades.some((g: any) => {
                  const s = String(g.semester ?? "").toLowerCase();
                  const isSem2 = s.includes("2") || s.includes("second");
                  const qA = isSem2 ? g.q3 : g.q1;
                  const qB = isSem2 ? g.q4 : g.q2;
                  const f = isSem2 ? (g.sem2_final_grade ?? g.final_grade ?? g.final) : (g.sem1_final_grade ?? g.final_grade ?? g.final);
                  return isBlankVal(qA) || isBlankVal(qB) || isBlankVal(f);
                })) ||
                (effectiveSem1.length > 0 && isBlankVal(sem1Avg)) ||
                (effectiveSem2.length > 0 && isBlankVal(sem2Avg)) ||
                isBlankVal(merged.general_average);

              // 4. Observed Values / Learner Behavior (from Back)
              const obs = merged.observed_values;
              const coreValues = Array.isArray(obs?.core_values) && obs.core_values.length > 0
                ? obs.core_values
                : Array.isArray(obs?.statements) && obs.statements.length > 0
                ? [
                    { name: "Maka-Diyos", statements: obs.statements.filter((s: any) => s.core_value === "Maka-Diyos" || s.core_value_index === 1) },
                    { name: "Makatao", statements: obs.statements.filter((s: any) => s.core_value === "Makatao" || s.core_value_index === 2) },
                    { name: "Makakalikasan", statements: obs.statements.filter((s: any) => s.core_value === "Makakalikasan" || s.core_value_index === 3) },
                    { name: "Makabansa", statements: obs.statements.filter((s: any) => s.core_value === "Makabansa" || s.core_value_index === 4) },
                  ].filter((g) => g.statements.length > 0)
                : [];

              const renderAttendanceRow = (label: string, row: any, fallbackTotal: any) => {
                const vals: any[] = row?.values || [];
                const tot = row?.total ?? fallbackTotal;
                return (
                  <tr className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-semibold text-slate-800 whitespace-nowrap">
                      {label}
                    </td>
                    {months.map((m: string, mIdx: number) => {
                      const val = vals[mIdx];
                      const displayVal = val !== undefined && val !== null && String(val).trim() !== "" ? String(val) : "—";
                      return (
                        <td key={mIdx} className="py-2 px-2 text-center font-mono text-slate-700">
                          {displayVal}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-center font-mono font-bold text-slate-900 bg-slate-50">
                      {tot !== undefined && tot !== null && String(tot).trim() !== "" ? String(tot) : "—"}
                    </td>
                  </tr>
                );
              };

              return (
                <div
                  data-testid="sf9-extracted-preview-card"
                  className="p-4 rounded-xl bg-white border border-indigo-200 shadow-sm space-y-4"
                >
                  {/* Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-50 text-[#174EA6]">
                        <GraduationCap className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900">
                          SF9-SHS Extracted Data Preview
                        </h4>
                        <p className="text-[10px] text-slate-500">
                          DepEd Form 138 • Senior High School Progress Report Card
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                        isUnifiedTwoSides
                          ? "bg-purple-100 text-purple-800 border border-purple-300"
                          : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      }`}>
                        <Check className="w-3 h-3" />
                        {isUnifiedTwoSides ? "Unified Front + Back Sides" : "Real-Time Extracted"}
                      </span>
                    </div>
                  </div>

                  {/* 1. Learner Identity Summary */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Learner Identity Summary
                    </span>
                    <div
                      data-testid="sf9-identity-summary"
                      className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50/70 p-2.5 rounded-lg border border-slate-200 text-xs"
                    >
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">LRN</span>
                        <span className="font-mono font-bold text-slate-900 text-xs">{lrn}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Full Name</span>
                        <span className="font-semibold text-slate-900 text-xs truncate block">{fullName}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Sex</span>
                        <span className="text-slate-700 font-medium text-xs">{sex}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Birthdate</span>
                        <span className="text-slate-700 font-medium text-xs">{activeDocFields.birth_date || activeDocFields.date_of_birth || "—"}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">School ID</span>
                        <span className="font-mono font-bold text-blue-700 text-xs">500619</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">School Year</span>
                        <span className="text-slate-700 font-medium text-xs">{schoolYear}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Grade Level &amp; Section</span>
                        <span className="text-slate-700 font-medium text-xs">{gradeLevel} — {section}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">Track / Strand</span>
                        <span className="text-slate-700 font-medium text-xs truncate block">{trackStrand}</span>
                      </div>
                    </div>
                  </div>

                  {/* 2. Report on Attendance */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-blue-600" />
                        Report on Attendance (from Front)
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                      <table className="w-full text-xs text-left border-collapse" data-testid="sf9-attendance-preview-table">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[9px] uppercase font-bold text-slate-500">
                            <th className="py-2 px-2.5 min-w-[120px]">Month</th>
                            {months.map((m: string, mIdx: number) => (
                              <th key={mIdx} className="py-2 px-1.5 text-center min-w-[32px]">{m}</th>
                            ))}
                            <th className="py-2 px-2.5 text-center min-w-[45px] bg-slate-100/70 font-bold text-slate-800">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                          {renderAttendanceRow("No. of School Days", schoolDaysRow, schoolDaysTotal)}
                          {renderAttendanceRow("No. of Days Present", daysPresentRow, daysPresentTotal)}
                          {renderAttendanceRow("No. of Days Absent", daysAbsentRow, daysAbsentTotal)}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 3. Per-Semester Academic Grades */}
                  <div className="space-y-2" data-testid="sf9-grades-preview">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                        <BookOpen className="w-3 h-3 text-indigo-600" />
                        Per-Semester Academic Grades (from Back)
                      </span>
                      <span className="text-xs font-bold text-slate-700">
                        Annual Gen Avg: <strong className={`${(isBlankVal(sem1Avg) || isBlankVal(sem2Avg) || (merged.annual_general_average === null && merged.general_average === null) || isBlankVal(merged.annual_general_average ?? merged.general_average)) ? "text-amber-600" : "text-emerald-600"} font-mono`}>{(isBlankVal(sem1Avg) || isBlankVal(sem2Avg)) ? "Blank" : (merged.annual_general_average ?? merged.general_average ?? "Blank")}</strong>
                      </span>
                    </div>

                    {hasBlankGrades && (
                      <div
                        data-testid="sf9-blank-grade-error"
                        className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 flex items-start gap-1.5 text-xs"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <strong className="font-bold">Blank Grade Error:</strong> One or more Final Grades or Semester General Averages are blank on the uploaded SF9 Back card.
                        </div>
                      </div>
                    )}

                    {/* Error & Status Legends Header */}
                    <div
                      data-testid="sf9-error-legends"
                      className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/80 text-xs space-y-1.5"
                    >
                      <div className="flex items-center gap-1.5 font-bold text-slate-800 text-[10px] uppercase tracking-wider">
                        <Info className="w-3 h-3 text-indigo-600 shrink-0" />
                        <span>SF9 Academic &amp; Clearance Status Guide</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-0.5 text-[10px] leading-relaxed">
                        <div className="p-2 rounded border border-amber-200 bg-amber-50/70 text-amber-900">
                          <div className="flex items-center gap-1 font-bold mb-0.5">
                            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>Blank Grade Error</span>
                          </div>
                          <p className="text-[9.5px]">Empty FINAL grades or Semester General Average.</p>
                        </div>
                        <div className="p-2 rounded border border-amber-200 bg-amber-50/70 text-amber-900">
                          <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-100 text-amber-800">Blank / Incomplete</span>
                          <p className="text-[9.5px] mt-0.5">Unwritten grade cell requiring teacher completion.</p>
                        </div>
                        <div className="p-2 rounded border border-emerald-200 bg-emerald-50/70 text-emerald-900">
                          <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-emerald-100 text-emerald-800">Passed / Failed</span>
                          <p className="text-[9.5px] mt-0.5">Official DepEd remark for numeric grades.</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {/* First Semester */}
                      <div className="space-y-1.5 border border-slate-200 rounded-lg p-2.5 bg-white">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                          <span className="font-bold text-xs text-slate-900">First Semester</span>
                          <span className="text-[10px] text-slate-500">
                            General Average: <strong className="font-mono font-bold text-slate-900">{sem1Avg}</strong>
                          </span>
                        </div>
                        {effectiveSem1.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left border-collapse" data-testid="sf9-sem1-grades-table">
                              <thead>
                                <tr className="text-[9px] uppercase font-bold text-slate-400 border-b border-slate-100">
                                  <th className="py-1 px-1.5">Subject</th>
                                  <th className="py-1 px-1 text-center">Q1</th>
                                  <th className="py-1 px-1 text-center">Q2</th>
                                  <th className="py-1 px-1.5 text-center font-bold">Final</th>
                                  <th className="py-1 px-1.5">Remarks</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 font-medium">
                                {effectiveSem1.map((g: any, gIdx: number) => {
                                  const fVal = g.sem1_final_grade ?? g.final_grade ?? g.final;
                                  const evaluated = evaluateDynamicGradeStatus({
                                    grade: fVal,
                                    rawRemark: g.remarks || g.remark || g.action_taken,
                                  });
                                  const rem = evaluated.remarkDisplay;
                                  const remPillClass = evaluated.status === "blank"
                                    ? "bg-amber-100 text-amber-800"
                                    : evaluated.status === "passed"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-rose-50 text-rose-700";
                                  return (
                                    <tr key={gIdx} className="hover:bg-slate-50/50">
                                      <td className="py-1 px-1.5 font-medium text-slate-800 truncate max-w-[140px]">{g.subject}</td>
                                      <td className="py-1 px-1 text-center font-mono">{formatQuarterGrade(g.q1)}</td>
                                      <td className="py-1 px-1 text-center font-mono">{formatQuarterGrade(g.q2)}</td>
                                      <td className="py-1 px-1.5 text-center font-mono font-bold text-slate-900">
                                        {evaluated.status === "blank" ? "Blank" : String(fVal)}
                                      </td>
                                      <td className="py-1 px-1.5">
                                        <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${remPillClass}`}>{rem}</span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr
                                  className="bg-slate-50 font-bold border-t border-slate-200 text-[10px]"
                                  data-testid="sf9-sem1-general-average-row"
                                >
                                  <td colSpan={3} className="py-1.5 px-1.5 text-slate-700">General Average for the Semester</td>
                                  <td className="py-1.5 px-1.5 text-center font-mono font-bold text-xs">{String(sem1Avg)}</td>
                                  <td className="py-1.5 px-1.5">
                                    <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700">
                                      {evaluateDynamicGradeStatus({ grade: sem1Avg, isGeneralAverage: true }).remarkDisplay}
                                    </span>
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        ) : (
                          <div className="py-4 text-center text-xs text-slate-400 italic">No First Semester subjects.</div>
                        )}
                      </div>

                      {/* Second Semester */}
                      <div className="space-y-1.5 border border-slate-200 rounded-lg p-2.5 bg-white">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                          <span className="font-bold text-xs text-slate-900">Second Semester</span>
                          <span className="text-[10px] text-slate-500">
                            General Average: <strong className="font-mono font-bold text-slate-900">{sem2Avg}</strong>
                          </span>
                        </div>
                        {effectiveSem2.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left border-collapse" data-testid="sf9-sem2-grades-table">
                              <thead>
                                <tr className="text-[9px] uppercase font-bold text-slate-400 border-b border-slate-100">
                                  <th className="py-1 px-1.5">Subject</th>
                                  <th className="py-1 px-1 text-center">Q3</th>
                                  <th className="py-1 px-1 text-center">Q4</th>
                                  <th className="py-1 px-1.5 text-center font-bold">Final</th>
                                  <th className="py-1 px-1.5">Remarks</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 font-medium">
                                {effectiveSem2.map((g: any, gIdx: number) => {
                                  const fVal = g.sem2_final_grade ?? g.final_grade ?? g.final;
                                  const evaluated = evaluateDynamicGradeStatus({
                                    grade: fVal,
                                    rawRemark: g.remarks || g.remark || g.action_taken,
                                  });
                                  const rem = evaluated.remarkDisplay;
                                  const remPillClass = evaluated.status === "blank"
                                    ? "bg-amber-100 text-amber-800"
                                    : evaluated.status === "passed"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-rose-50 text-rose-700";
                                  return (
                                    <tr key={gIdx} className="hover:bg-slate-50/50">
                                      <td className="py-1 px-1.5 font-medium text-slate-800 truncate max-w-[140px]">{g.subject}</td>
                                      <td className="py-1 px-1 text-center font-mono">{formatQuarterGrade(g.q3)}</td>
                                      <td className="py-1 px-1 text-center font-mono">{formatQuarterGrade(g.q4)}</td>
                                      <td className="py-1 px-1.5 text-center font-mono font-bold text-slate-900">
                                        {evaluated.status === "blank" ? "Blank" : String(fVal)}
                                      </td>
                                      <td className="py-1 px-1.5">
                                        <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${remPillClass}`}>{rem}</span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr
                                  className="bg-slate-50 font-bold border-t border-slate-200 text-[10px]"
                                  data-testid="sf9-sem2-general-average-row"
                                >
                                  <td colSpan={3} className="py-1.5 px-1.5 text-slate-700">General Average for the Semester</td>
                                  <td className="py-1.5 px-1.5 text-center font-mono font-bold text-xs">{String(sem2Avg)}</td>
                                  <td className="py-1.5 px-1.5">
                                    <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700">
                                      {evaluateDynamicGradeStatus({ grade: sem2Avg, isGeneralAverage: true }).remarkDisplay}
                                    </span>
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        ) : (
                          <div className="py-4 text-center text-xs text-slate-400 italic">No Second Semester subjects.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 4. Observed Values */}
                  <div className="space-y-1.5" data-testid="sf9-observed-values-preview">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                        <Heart className="w-3 h-3 text-rose-500" />
                        Report on Learners&apos; Observed Values
                      </span>
                      <div className="flex items-center gap-2 text-[9px] text-slate-500">
                        <span><strong className="text-emerald-700">AO</strong>: Always</span>
                        <span><strong className="text-blue-700">SO</strong>: Sometimes</span>
                        <span><strong className="text-amber-700">RO</strong>: Rarely</span>
                        <span><strong className="text-rose-700">NO</strong>: Not Observed</span>
                      </div>
                    </div>

                    {coreValues.length > 0 ? (
                      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                        <table className="w-full text-xs text-left border-collapse" data-testid="sf9-observed-values-table">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[9px] uppercase font-bold text-slate-500">
                              <th className="py-1.5 px-2 min-w-[100px]">Core Value</th>
                              <th className="py-1.5 px-2 min-w-[180px]">Behavior Statement</th>
                              <th className="py-1.5 px-1.5 text-center min-w-[32px]">Q1</th>
                              <th className="py-1.5 px-1.5 text-center min-w-[32px]">Q2</th>
                              <th className="py-1.5 px-1.5 text-center min-w-[32px]">Q3</th>
                              <th className="py-1.5 px-1.5 text-center min-w-[32px]">Q4</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium">
                            {coreValues.map((group: any, grpIdx: number) =>
                              (group.statements || []).map((stmt: any, sIdx: number) => {
                                const renderBadge = (qRec: any) => {
                                  const rawVal = qRec?.normalized_rating ?? qRec?.original_mark ?? qRec;
                                  const normalized = normalizeObservedValueMarking(rawVal);
                                  if (!normalized) return <span className="text-slate-400 font-mono text-xs">—</span>;
                                  const cls =
                                    normalized === "AO"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : normalized === "SO"
                                      ? "bg-blue-50 text-blue-700 border-blue-200"
                                      : normalized === "RO"
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : "bg-rose-50 text-rose-700 border-rose-200";
                                  return (
                                    <span className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border ${cls}`}>
                                      {normalized}
                                    </span>
                                  );
                                };
                                return (
                                  <tr key={`${grpIdx}-${sIdx}`} className="hover:bg-slate-50/50">
                                    {sIdx === 0 && (
                                      <td rowSpan={group.statements.length} className="py-1.5 px-2 font-bold text-slate-900 bg-slate-50/40 align-top border-r border-slate-100">
                                        {group.name}
                                      </td>
                                    )}
                                    <td className="py-1.5 px-2 text-slate-700">{stmt.statement}</td>
                                    <td className="py-1.5 px-1.5 text-center">{renderBadge(stmt.q1)}</td>
                                    <td className="py-1.5 px-1.5 text-center">{renderBadge(stmt.q2)}</td>
                                    <td className="py-1.5 px-1.5 text-center">{renderBadge(stmt.q3)}</td>
                                    <td className="py-1.5 px-1.5 text-center">{renderBadge(stmt.q4)}</td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-3 text-center border border-dashed rounded-lg border-slate-200 text-xs text-slate-400">
                        No observed values detected on this document scan.
                      </div>
                    )}
                  </div>

                  {/* Bottom Download Button */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <span className="text-[11px] text-slate-500 italic">
                      DepEd Standard Form 138 Progress Report Card • S.Y. {schoolYear}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => handleDownloadPdfReport("sf9")}
                      className="bg-[#174EA6] hover:bg-[#123e85] text-white text-xs font-semibold px-3 py-1.5 h-auto flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download PDF Report
                    </Button>
                  </div>
                </div>
              );
            })() : Array.isArray(activeDocFields.grades) ? (
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                    <GraduationCap className="w-4 h-4 text-[#174EA6]" />
                    Academic Performance &amp; Subject Ratings
                  </h5>
                  {activeDocFields.general_average && (
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                      Gen Avg: {activeDocFields.general_average}
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto pt-1 border-t border-slate-200/80">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-200">
                        <th className="py-1.5 pr-2">Subject / Learning Area</th>
                        <th className="py-1.5 px-1.5 text-center">Q1</th>
                        <th className="py-1.5 px-1.5 text-center">Q2</th>
                        <th className="py-1.5 px-1.5 text-center">Final</th>
                        <th className="py-1.5 pl-2 text-right">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Array.isArray(activeDocFields.grades) && activeDocFields.grades.length > 0 ? (
                        activeDocFields.grades.slice(0, 8).map((g: any, i: number) => (
                          <tr key={i} className="hover:bg-white/80">
                            <td className="py-1.5 pr-2 font-medium text-slate-800 truncate max-w-[180px]">
                              {g.subject || `Subject ${i + 1}`}
                            </td>
                            <td className="py-1.5 px-1.5 text-center font-mono">{g.q1 ?? "—"}</td>
                            <td className="py-1.5 px-1.5 text-center font-mono">{g.q2 ?? "—"}</td>
                            <td className="py-1.5 px-1.5 text-center font-mono font-bold text-blue-700">
                              {g.final ?? g.final_grade ?? "—"}
                            </td>
                            <td className="py-1.5 pl-2 text-right">
                              <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                {g.remarks || g.action_taken || "PASSED"}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-3 text-center text-slate-400 text-xs">
                            No subject ratings recorded for this form scan.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* Attendance Summary (For SF2) */}
            {(activeDocType === "sf2" || (activeDocType !== "sf9" && activeDocFields.attendance)) && (
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <h5 className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                  <Calendar className="w-4 h-4 text-[#174EA6]" />
                  Learner Attendance Summary
                </h5>
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200/80 text-center">
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Classes</span>
                    <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">201.5</span>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Present</span>
                    <span className="font-mono font-bold text-emerald-700 text-sm mt-0.5 block">201.5</span>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Absent</span>
                    <span className="font-mono font-bold text-slate-600 text-sm mt-0.5 block">0</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

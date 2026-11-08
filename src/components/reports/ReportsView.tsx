"use client";

import React, { useState } from "react";
import PageContainer from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { 
  BarChart3, 
  Download, 
  FileSpreadsheet, 
  School, 
  ShieldCheck, 
  Users, 
  FileText, 
  GraduationCap,
  Calendar,
  CheckCircle2
} from "lucide-react";

interface Props {
  school: {
    name: string;
    depedSchoolId: string;
  };
  summary: {
    totalStudents: number;
    totalDocuments: number;
    grade11Count: number;
    grade12Count: number;
    approvedCount: number;
    pendingCount: number;
    rejectedCount: number;
  };
  students: any[];
  documents: any[];
  academic: any[];
}

export default function ReportsView({
  school,
  summary,
  students,
  documents,
  academic,
}: Props) {
  const [downloading, setDownloading] = useState<string | null>(null);

  // Helper to trigger browser CSV download
  const triggerCsvDownload = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const csvContent = [
      `"TAYSAN RESETTLEMENT INTEGRATED SCHOOL - DEPED SCHOOL ID: ${school.depedSchoolId}"`,
      `"Generated on: ${new Date().toLocaleString()}"`,
      "",
      headers.map(h => `"${h}"`).join(","),
      ...rows.map(row => 
        row.map(val => `"${String(val ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 1. Export Student Directory CSV
  const handleExportStudents = () => {
    setDownloading("students");
    const headers = [
      "LRN",
      "Full Name",
      "Grade Level",
      "Section",
      "School Year",
      "Academic Standing",
      "Review Status",
      "Has SF9",
      "Has SF10",
      "Has PSA"
    ];

    const rows = students.map(s => [
      s.lrn,
      s.fullName,
      s.gradeLevel,
      s.section,
      s.schoolYear,
      s.academicStanding,
      s.reviewStatus,
      s.availableDocuments?.sf9 ? "Yes" : "No",
      s.availableDocuments?.sf10 ? "Yes" : "No",
      s.availableDocuments?.psa ? "Yes" : "No",
    ]);

    triggerCsvDownload(`TRIS_SHS_Student_Directory_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    setDownloading(null);
  };

  // 2. Export Document Archive CSV
  const handleExportDocuments = () => {
    setDownloading("documents");
    const headers = [
      "Document ID",
      "Document Type",
      "Learner Name",
      "LRN",
      "Grade Level",
      "Section",
      "School Year",
      "Validation Status",
      "Flags / Incomplete Info",
      "Upload Date"
    ];

    const rows = documents.map(d => [
      d.id,
      d.documentType,
      d.studentName,
      d.lrn,
      d.gradeLevel,
      d.section,
      d.schoolYear,
      d.status,
      (d.missingFlags || []).join("; ") || "Complete",
      d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "-"
    ]);

    triggerCsvDownload(`TRIS_SHS_Documents_Summary_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    setDownloading(null);
  };

  // 3. Export Academic Standing CSV
  const handleExportAcademic = () => {
    setDownloading("academic");
    const headers = [
      "LRN",
      "Learner Name",
      "Grade Level",
      "Section",
      "School Year",
      "General Average",
      "Academic Standing",
      "Total Subjects Extracted"
    ];

    const rows = academic.map(a => [
      a.lrn,
      a.fullName,
      a.gradeLevel,
      a.section,
      a.schoolYear,
      a.generalAverage ?? "N/A",
      a.academicStanding,
      a.gradesCount
    ]);

    triggerCsvDownload(`TRIS_SHS_Academic_Standings_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    setDownloading(null);
  };

  return (
    <PageContainer>
      {/* DepEd TRIS Institutional Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#174EA6]/10 text-[#174EA6]">
              <School className="h-3.5 w-3.5" />
              DepEd School ID: {school.depedSchoolId}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700">
              Official Reporting Module
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            {school.name} &bull; Institutional Reports
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Export official summary archives for Senior High School Grades 11 and 12 in DepEd-compliant CSV formats.
          </p>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
        <Card padding="md" className="bg-white border-l-4 border-l-[#174EA6]">
          <span className="text-[0.65rem] font-bold text-zinc-500 uppercase">Enrolled Students</span>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{summary.totalStudents}</p>
          <p className="text-[0.65rem] text-zinc-500 mt-1.5">
            G11: {summary.grade11Count} &bull; G12: {summary.grade12Count}
          </p>
        </Card>

        <Card padding="md" className="bg-white border-l-4 border-l-blue-600">
          <span className="text-[0.65rem] font-bold text-zinc-500 uppercase">Archived Documents</span>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{summary.totalDocuments}</p>
          <p className="text-[0.65rem] text-zinc-500 mt-1.5">SF9, SF10, PSA</p>
        </Card>

        <Card padding="md" className="bg-white border-l-4 border-l-emerald-600">
          <span className="text-[0.65rem] font-bold text-emerald-700 uppercase">Approved Records</span>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{summary.approvedCount}</p>
          <p className="text-[0.65rem] text-zinc-500 mt-1.5">Fully verified decisions</p>
        </Card>

        <Card padding="md" className="bg-white border-l-4 border-l-amber-500">
          <span className="text-[0.65rem] font-bold text-amber-700 uppercase">Pending Review</span>
          <p className="text-2xl font-bold text-amber-600 mt-1">{summary.pendingCount}</p>
          <p className="text-[0.65rem] text-zinc-500 mt-1.5">Awaiting teacher verification</p>
        </Card>
      </div>

      {/* Export Options Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        {/* Export 1: Student Directory */}
        <Card padding="md" className="bg-white flex flex-col justify-between border border-zinc-200">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-[#174EA6]/10 text-[#174EA6]">
                <Users className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-zinc-900">Student Directory Report</h3>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed mt-2">
              Complete roster of Grade 11 and 12 learners, including LRNs, assigned sections, school years, attached document badges (SF9, SF10, PSA), and academic review statuses.
            </p>
            <div className="mt-4 p-2.5 bg-zinc-50 rounded-md border border-zinc-200 text-xs text-zinc-500 flex justify-between">
              <span>Ready for Export:</span>
              <span className="font-bold text-zinc-800">{students.length} Learners</span>
            </div>
          </div>

          <button
            onClick={handleExportStudents}
            disabled={downloading === "students" || students.length === 0}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-[#174EA6] text-white hover:bg-[#0B1F33] disabled:opacity-50 transition-colors shadow-xs"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{downloading === "students" ? "Generating..." : "Export Student Directory (CSV)"}</span>
          </button>
        </Card>

        {/* Export 2: Document Summary */}
        <Card padding="md" className="bg-white flex flex-col justify-between border border-zinc-200">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                <FileText className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-zinc-900">Document Monitoring Report</h3>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed mt-2">
              Detailed audit summary of all uploaded SF9, SF10, and PSA documents with OCR confidence scores, validation rule counts, missing school year flags, and approval statuses.
            </p>
            <div className="mt-4 p-2.5 bg-zinc-50 rounded-md border border-zinc-200 text-xs text-zinc-500 flex justify-between">
              <span>Ready for Export:</span>
              <span className="font-bold text-zinc-800">{documents.length} Document Records</span>
            </div>
          </div>

          <button
            onClick={handleExportDocuments}
            disabled={downloading === "documents" || documents.length === 0}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-xs"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{downloading === "documents" ? "Generating..." : "Export Document Archive (CSV)"}</span>
          </button>
        </Card>

        {/* Export 3: Academic Overview */}
        <Card padding="md" className="bg-white flex flex-col justify-between border border-zinc-200">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                <GraduationCap className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-bold text-zinc-900">Academic Standing Report</h3>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed mt-2">
              Verified learner general averages, academic standings (Passed, Failed, Needs Verification), and total extracted subject counts. Official DepEd records without grade fabrication.
            </p>
            <div className="mt-4 p-2.5 bg-zinc-50 rounded-md border border-zinc-200 text-xs text-zinc-500 flex justify-between">
              <span>Ready for Export:</span>
              <span className="font-bold text-zinc-800">{academic.length} Academic Standings</span>
            </div>
          </div>

          <button
            onClick={handleExportAcademic}
            disabled={downloading === "academic" || academic.length === 0}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-xs"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{downloading === "academic" ? "Generating..." : "Export Academic Standings (CSV)"}</span>
          </button>
        </Card>
      </div>

      {/* Compliance Note */}
      <div className="mt-8 p-4 bg-zinc-50 border border-zinc-200 rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-[#174EA6]" />
          <div>
            <p className="text-xs font-semibold text-zinc-900">Department of Education Regional Office V &bull; Division of Legazpi City</p>
            <p className="text-[0.7rem] text-zinc-500">Taysan Resettlement Integrated School &bull; School ID 300792 &bull; Automated Visual Validation System (AVV)</p>
          </div>
        </div>
        <span className="text-[0.7rem] text-zinc-400 font-mono">
          CONFIDENTIAL INSTITUTIONAL RECORD
        </span>
      </div>
    </PageContainer>
  );
}

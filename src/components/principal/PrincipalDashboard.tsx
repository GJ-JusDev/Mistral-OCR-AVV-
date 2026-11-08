"use client";

import React from "react";
import Link from "next/link";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import { 
  Users, 
  FileText, 
  GraduationCap, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Layers, 
  ArrowRight, 
  School, 
  CopyCheck, 
  ShieldCheck,
  Calendar,
  BarChart3
} from "lucide-react";

interface PrincipalDashboardData {
  school: {
    id: string;
    name: string;
    depedSchoolId: string;
  };
  summaryCards: {
    totalStudents: number;
    totalDocuments: number;
    grade11Count: number;
    grade12Count: number;
    awaitingReviewCount: number;
    approvedDocumentCount: number;
    rejectedDocumentCount: number;
    completeDocumentSetsCount?: number;
    missingDocumentsCount?: number;
    eligibleProgressionCount?: number;
    eligibleGraduationCount?: number;
    notEligibleCount?: number;
    awaitingPrincipalActionCount?: number;
  };
  studentDistribution: {
    gradeLevels: { grade: string; count: number }[];
    sections: { section: string; count: number }[];
    schoolYears: { schoolYear: string; count: number }[];
  };
  documentStats: {
    sf9Count: number;
    sf10Count: number;
    psaCount: number;
    pendingDocCount: number;
    approvedDocCount: number;
    rejectedDocCount: number;
    duplicateScanCount: number;
    uniqueDocumentCoverage: number;
  };
  recentDocuments: {
    id: string;
    documentType: string;
    status: string;
    gradeLevel: string;
    schoolYear: string;
    createdAt: string;
    studentName: string;
    lrn: string;
  }[];
}

export default function PrincipalDashboard({ 
  data,
  userName = "Principal"
}: { 
  data: PrincipalDashboardData;
  userName?: string;
}) {
  const { school, summaryCards, studentDistribution, documentStats, recentDocuments } = data;

  const totalGradeStudents = summaryCards.grade11Count + summaryCards.grade12Count;
  const grade11Percent = totalGradeStudents > 0 ? Math.round((summaryCards.grade11Count / totalGradeStudents) * 100) : 0;
  const grade12Percent = totalGradeStudents > 0 ? Math.round((summaryCards.grade12Count / totalGradeStudents) * 100) : 0;

  return (
    <PageContainer>
      {/* Institutional School Head Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#7c3aed]/10 text-[#7c3aed]">
              <School className="h-3.5 w-3.5" />
              DepEd School ID: {school.depedSchoolId}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700">
              <ShieldCheck className="h-3.5 w-3.5 text-[#7c3aed]" />
              Executive Monitoring
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            {school.name}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Senior High School Principal Monitoring Dashboard &bull; Welcome back, {userName}
          </p>
        </div>

        <div className="mt-4 sm:mt-0 flex items-center gap-2">
          <Link
            href="/principal/students"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-[#7c3aed] hover:bg-[#6d28d9] rounded-md shadow-sm transition-colors"
          >
            <Users className="h-4 w-4" />
            <span>Student Records</span>
          </Link>
          <Link
            href="/reports"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-md transition-colors"
          >
            <BarChart3 className="h-4 w-4 text-zinc-500" />
            <span>Reports & Exports</span>
          </Link>
        </div>
      </div>

      {/* Phase 2: Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {/* Total Registered Students */}
        <Card padding="md" className="border-l-4 border-l-[#7c3aed] bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Registered Students</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{summaryCards.totalStudents}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-[#7c3aed]/10 text-[#7c3aed]">
              <Users className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-3 flex items-center gap-1">
            <span className="font-medium text-[#7c3aed]">Senior High School</span> &bull; Grades 11 & 12
          </p>
        </Card>

        {/* Total Scanned Documents */}
        <Card padding="md" className="border-l-4 border-l-blue-600 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Scanned Documents</p>
              <p className="text-2xl font-bold text-zinc-900 mt-1">{summaryCards.totalDocuments}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600">
              <FileText className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            Across SF9, SF10, and PSA archives
          </p>
        </Card>

        {/* Complete Document Sets */}
        <Card padding="md" className="border-l-4 border-l-emerald-500 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Complete Document Sets</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">{summaryCards.completeDocumentSetsCount ?? 0}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            All 3 documents (SF9, SF10, PSA) verified
          </p>
        </Card>

        {/* Incomplete / Missing Documents */}
        <Card padding="md" className="border-l-4 border-l-amber-500 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Incomplete / Missing Docs</p>
              <p className="text-2xl font-bold text-amber-600 mt-1">{summaryCards.missingDocumentsCount ?? 0}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            Missing PSA, SF9, or SF10 in file
          </p>
        </Card>
      </div>

      {/* DepEd Academic Eligibility & Progression Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        {/* Grade 11 Eligible for Progression */}
        <Card padding="md" className="border border-zinc-200 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[0.7rem] font-semibold text-zinc-500 uppercase tracking-wider">G11 Progression Eligible</p>
              <p className="text-xl font-bold text-emerald-600 mt-1">{summaryCards.eligibleProgressionCount ?? 0}</p>
            </div>
            <span className="p-2 rounded-md bg-emerald-50 text-emerald-600">
              <GraduationCap className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[0.7rem] text-zinc-500 mt-2">
            Passed all G11 subjects with complete documents
          </p>
        </Card>

        {/* Grade 12 Eligible for Graduation */}
        <Card padding="md" className="border border-zinc-200 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[0.7rem] font-semibold text-zinc-500 uppercase tracking-wider">G12 Graduation Eligible</p>
              <p className="text-xl font-bold text-indigo-600 mt-1">{summaryCards.eligibleGraduationCount ?? 0}</p>
            </div>
            <span className="p-2 rounded-md bg-indigo-50 text-indigo-600">
              <GraduationCap className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[0.7rem] text-zinc-500 mt-2">
            Met all SHS graduation curriculum requirements
          </p>
        </Card>

        {/* Academically Not Eligible */}
        <Card padding="md" className="border border-zinc-200 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[0.7rem] font-semibold text-zinc-500 uppercase tracking-wider">Academically Ineligible</p>
              <p className="text-xl font-bold text-red-600 mt-1">{summaryCards.notEligibleCount ?? 0}</p>
            </div>
            <span className="p-2 rounded-md bg-red-50 text-red-600">
              <XCircle className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[0.7rem] text-zinc-500 mt-2">
            Failing grades (&lt;75); strictly not due to missing docs
          </p>
        </Card>

        {/* Awaiting Principal Approval */}
        <Card padding="md" className="border border-zinc-200 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[0.7rem] font-semibold text-zinc-500 uppercase tracking-wider">Awaiting Principal Action</p>
              <p className="text-xl font-bold text-[#7c3aed] mt-1">{summaryCards.awaitingPrincipalActionCount ?? 0}</p>
            </div>
            <span className="p-2 rounded-md bg-[#7c3aed]/10 text-[#7c3aed]">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <p className="text-[0.7rem] text-zinc-500 mt-2">
            Verified records ready for Principal sign-off
          </p>
        </Card>
      </div>

      {/* Grade Level Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <Card padding="md" className="bg-white border border-zinc-200">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[#7c3aed]" />
              <h3 className="text-sm font-semibold text-zinc-900">Grade 11 Enrolled</h3>
            </div>
            <span className="text-lg font-bold text-zinc-900">{summaryCards.grade11Count}</span>
          </div>
          <div className="mt-3">
            <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-[#7c3aed] h-2 rounded-full transition-all duration-300" 
                style={{ width: `${grade11Percent}%` }} 
              />
            </div>
            <p className="text-xs text-zinc-500 mt-1.5 flex justify-between">
              <span>Share of SHS Population</span>
              <span className="font-semibold text-zinc-700">{grade11Percent}%</span>
            </p>
          </div>
        </Card>

        <Card padding="md" className="bg-white border border-zinc-200">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
              <h3 className="text-sm font-semibold text-zinc-900">Grade 12 Enrolled</h3>
            </div>
            <span className="text-lg font-bold text-zinc-900">{summaryCards.grade12Count}</span>
          </div>
          <div className="mt-3">
            <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-indigo-600 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${grade12Percent}%` }} 
              />
            </div>
            <p className="text-xs text-zinc-500 mt-1.5 flex justify-between">
              <span>Share of SHS Population</span>
              <span className="font-semibold text-zinc-700">{grade12Percent}%</span>
            </p>
          </div>
        </Card>
      </div>

      {/* Phase 2: Document Statistics & Duplicate Detection */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Document Composition */}
        <Card padding="md" className="bg-white lg:col-span-2">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-zinc-100">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Scanned Document Breakdown</h3>
              <p className="text-xs text-zinc-500">Distribution across supported official document types</p>
            </div>
            <span className="text-xs font-medium text-zinc-500 bg-zinc-100 px-2.5 py-1 rounded">
              Total: {summaryCards.totalDocuments}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-3.5 rounded-lg border border-zinc-200 bg-zinc-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-600">Old SHS SF9</span>
                <span className="px-2 py-0.5 rounded text-[0.65rem] font-bold bg-[#7c3aed]/10 text-[#7c3aed]">
                  Report Card
                </span>
              </div>
              <p className="text-2xl font-bold text-zinc-900 mt-2">{documentStats.sf9Count}</p>
              <p className="text-xs text-zinc-500 mt-1">Learner progress report cards</p>
            </div>

            <div className="p-3.5 rounded-lg border border-zinc-200 bg-zinc-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-600">Old SHS SF10</span>
                <span className="px-2 py-0.5 rounded text-[0.65rem] font-bold bg-blue-50 text-blue-700">
                  Permanent Record
                </span>
              </div>
              <p className="text-2xl font-bold text-zinc-900 mt-2">{documentStats.sf10Count}</p>
              <p className="text-xs text-zinc-500 mt-1">Official transcripts & academic history</p>
            </div>

            <div className="p-3.5 rounded-lg border border-zinc-200 bg-zinc-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-600">PSA Birth Cert</span>
                <span className="px-2 py-0.5 rounded text-[0.65rem] font-bold bg-emerald-50 text-emerald-700">
                  Civil Registry
                </span>
              </div>
              <p className="text-2xl font-bold text-zinc-900 mt-2">{documentStats.psaCount}</p>
              <p className="text-xs text-zinc-500 mt-1">Identity & birth validation records</p>
            </div>
          </div>

          {/* Status Bar */}
          <div className="mt-5 pt-4 border-t border-zinc-100">
            <div className="flex items-center justify-between text-xs text-zinc-600 mb-2">
              <span>Validation Lifecycle Progress</span>
              <span className="font-medium text-zinc-700">
                {documentStats.approvedDocCount} Approved &bull; {documentStats.pendingDocCount} Pending &bull; {documentStats.rejectedDocCount} Rejected
              </span>
            </div>
            <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden flex">
              {summaryCards.totalDocuments > 0 ? (
                <>
                  <div 
                    className="bg-emerald-500 h-full" 
                    style={{ width: `${(documentStats.approvedDocCount / summaryCards.totalDocuments) * 100}%` }} 
                    title={`Approved: ${documentStats.approvedDocCount}`}
                  />
                  <div 
                    className="bg-amber-400 h-full" 
                    style={{ width: `${(documentStats.pendingDocCount / summaryCards.totalDocuments) * 100}%` }} 
                    title={`Pending: ${documentStats.pendingDocCount}`}
                  />
                  <div 
                    className="bg-red-500 h-full" 
                    style={{ width: `${(documentStats.rejectedDocCount / summaryCards.totalDocuments) * 100}%` }} 
                    title={`Rejected: ${documentStats.rejectedDocCount}`}
                  />
                </>
              ) : (
                <div className="bg-zinc-200 w-full h-full" />
              )}
            </div>
          </div>
        </Card>

        {/* Duplicate Prevention & Coverage Card */}
        <Card padding="md" className="bg-white flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-md bg-[#7c3aed]/10 text-[#7c3aed]">
                <CopyCheck className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-900">Duplicate Prevention</h3>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Automatic collision and uniqueness checks prevent duplicate counting when a student has multiple scanned documents or repeated uploads.
            </p>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between p-2.5 rounded-md bg-zinc-50 border border-zinc-200">
                <span className="text-xs text-zinc-600">Unique Learner Document Sets</span>
                <span className="text-sm font-bold text-zinc-900">{documentStats.uniqueDocumentCoverage}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-md bg-zinc-50 border border-zinc-200">
                <span className="text-xs text-zinc-600">Re-scans / Collisions Flagged</span>
                <span className="text-sm font-bold text-amber-600">{documentStats.duplicateScanCount}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-zinc-100">
            <Link
              href="/principal/documents"
              className="text-xs font-medium text-[#7c3aed] hover:underline flex items-center justify-between"
            >
              <span>Inspect Document Monitoring Queue</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Card>
      </div>

      {/* Phase 2: Student Distribution (Sections & School Years) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Section Distribution */}
        <Card padding="md" className="bg-white">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-[#7c3aed]" />
              <h3 className="text-sm font-semibold text-zinc-900">Student Distribution by Section</h3>
            </div>
            <span className="text-xs text-zinc-500">{studentDistribution.sections.length} Sections</span>
          </div>

          {studentDistribution.sections.length > 0 ? (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {studentDistribution.sections.map((sec) => {
                const maxCount = Math.max(...studentDistribution.sections.map(s => s.count), 1);
                const pct = Math.round((sec.count / maxCount) * 100);
                return (
                  <div key={sec.section} className="text-xs">
                    <div className="flex justify-between font-medium text-zinc-700 mb-1">
                      <span>{sec.section}</span>
                      <span className="font-semibold text-zinc-900">{sec.count} students</span>
                    </div>
                    <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-[#7c3aed] h-1.5 rounded-full" 
                        style={{ width: `${pct}%` }} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-zinc-500">
              No section-assigned student records found yet.
            </div>
          )}
        </Card>

        {/* School Year Distribution */}
        <Card padding="md" className="bg-white">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-semibold text-zinc-900">Records by School Year</h3>
            </div>
            <span className="text-xs text-zinc-500">{studentDistribution.schoolYears.length} School Years</span>
          </div>

          {studentDistribution.schoolYears.length > 0 ? (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {studentDistribution.schoolYears.map((sy) => {
                const maxCount = Math.max(...studentDistribution.schoolYears.map(s => s.count), 1);
                const pct = Math.round((sy.count / maxCount) * 100);
                return (
                  <div key={sy.schoolYear} className="text-xs">
                    <div className="flex justify-between font-medium text-zinc-700 mb-1">
                      <span>S.Y. {sy.schoolYear}</span>
                      <span className="font-semibold text-zinc-900">{sy.count} records</span>
                    </div>
                    <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-indigo-600 h-1.5 rounded-full" 
                        style={{ width: `${pct}%` }} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-zinc-500">
              No school year metadata recorded yet.
            </div>
          )}
        </Card>
      </div>

      {/* Recent Scanned Documents Activity Feed */}
      <Card padding="none" className="bg-white mt-6 overflow-hidden">
        <div className="p-4 flex items-center justify-between border-b border-zinc-200">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Recent Scanned Documents Activity</h3>
            <p className="text-xs text-zinc-500">Latest school documents processed by AVV for TRIS</p>
          </div>
          <Link
            href="/principal/documents"
            className="text-xs font-semibold text-[#7c3aed] hover:text-[#6d28d9] flex items-center gap-1"
          >
            <span>View All Scans</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recentDocuments.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document Type</TableHead>
                  <TableHead>Learner Name</TableHead>
                  <TableHead>LRN</TableHead>
                  <TableHead>Grade Level</TableHead>
                  <TableHead>School Year</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentDocuments.map((doc) => (
                  <TableRow key={doc.id} className="hover:bg-zinc-50/80">
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-zinc-100 text-zinc-800">
                        {String(doc.documentType).toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium text-zinc-900">
                      {doc.studentName}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-600">
                      {doc.lrn}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-700">
                      {doc.gradeLevel}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-600">
                      {doc.schoolYear}
                    </TableCell>
                    <TableCell>
                      <DocumentStatusBadge status={doc.status as any} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="text-xs font-medium text-[#7c3aed] hover:underline"
                      >
                        View Scans
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-zinc-500">
            No scanned school documents have been uploaded yet.
          </div>
        )}
      </Card>
    </PageContainer>
  );
}

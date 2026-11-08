"use client";

import React from "react";
import Link from "next/link";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
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
  BarChart3,
  Award,
  CheckCircle
} from "lucide-react";
import { Button } from "@/components/ui/Button";

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
      <Header
        title={school.name}
        description={`Senior High School Principal Executive Monitoring Dashboard &bull; Welcome back, ${userName}`}
        roleBadge={{ role: "principal", label: "School Principal" }}
        schoolInfo={{ schoolName: school.name, depedSchoolId: school.depedSchoolId }}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/principal/students">
              <Button
                size="sm"
                className="bg-[#174EA6] hover:bg-[#0B1F33] text-white"
                leftIcon={<Users className="h-4 w-4" />}
              >
                Student Records
              </Button>
            </Link>
            <Link href="/reports">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<BarChart3 className="h-4 w-4" />}
              >
                Reports
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* Tier 1: Core Registry & Document Health KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Registered Students"
            value={summaryCards.totalStudents}
            subtitle="Grades 11 & 12 Enrolled"
            icon={<Users className="h-5 w-5 text-[#174EA6]" />}
            variant="royal"
          />
          <StatCard
            title="Total Scanned Documents"
            value={summaryCards.totalDocuments}
            subtitle="Across SF9, SF10 & PSA"
            icon={<FileText className="h-5 w-5 text-slate-700" />}
            variant="default"
          />
          <StatCard
            title="Complete Document Sets"
            value={summaryCards.completeDocumentSetsCount ?? 0}
            subtitle="All 3 records on file"
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
            variant="success"
          />
          <StatCard
            title="Missing Required Forms"
            value={summaryCards.missingDocumentsCount ?? 0}
            subtitle="Pending PSA / SF9 / SF10"
            icon={<Clock className="h-5 w-5 text-amber-600" />}
            variant={summaryCards.missingDocumentsCount ? "warning" : "default"}
          />
        </div>

        {/* Tier 2: DepEd Academic Progression & Graduation Eligibility */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-[#174EA6]" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-[#0B1F33]">
                DepEd SHS Academic Eligibility & Progression Status
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-medium">DepEd DO 8, s. 2015 & DO 55, s. 2016</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Grade 11 Progression Eligible */}
            <div className="bg-white rounded-xl border border-emerald-200/80 p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    G11 Progression Eligible
                  </span>
                  <div className="text-2xl font-bold text-emerald-600 mt-1">
                    {summaryCards.eligibleProgressionCount ?? 0}
                  </div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <GraduationCap className="h-5 w-5" />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                Passed all G11 subjects with complete documents
              </p>
            </div>

            {/* Grade 12 Graduation Eligible */}
            <div className="bg-white rounded-xl border border-[#174EA6]/30 p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    G12 Graduation Eligible
                  </span>
                  <div className="text-2xl font-bold text-[#174EA6] mt-1">
                    {summaryCards.eligibleGraduationCount ?? 0}
                  </div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#174EA6]/10 text-[#174EA6]">
                  <GraduationCap className="h-5 w-5" />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                Met all SHS graduation curriculum requirements
              </p>
            </div>

            {/* Academically Ineligible */}
            <div className="bg-white rounded-xl border border-red-200/80 p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Academically Ineligible
                  </span>
                  <div className="text-2xl font-bold text-red-600 mt-1">
                    {summaryCards.notEligibleCount ?? 0}
                  </div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-700">
                  <XCircle className="h-5 w-5" />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                Failing grades (&lt;75); not due to missing forms
              </p>
            </div>

            {/* Awaiting Principal Sign-Off */}
            <div className="bg-white rounded-xl border border-amber-200/80 p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Ready for Principal Action
                  </span>
                  <div className="text-2xl font-bold text-amber-700 mt-1">
                    {summaryCards.awaitingPrincipalActionCount ?? 0}
                  </div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                  <ShieldCheck className="h-5 w-5" />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                Complete and verified for official approval
              </p>
            </div>
          </div>
        </div>

        {/* Grade 11 & Grade 12 Enrollment Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DashboardCard padding="md" title="Grade 11 Learner Population">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-2xl font-bold text-[#0B1F33]">{summaryCards.grade11Count}</span>
              <span className="text-xs font-semibold text-slate-600">{grade11Percent}% of SHS</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-[#174EA6] h-2 rounded-full transition-all duration-300" 
                style={{ width: `${grade11Percent}%` }} 
              />
            </div>
          </DashboardCard>

          <DashboardCard padding="md" title="Grade 12 Learner Population">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-2xl font-bold text-[#0B1F33]">{summaryCards.grade12Count}</span>
              <span className="text-xs font-semibold text-slate-600">{grade12Percent}% of SHS</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-[#0B1F33] h-2 rounded-full transition-all duration-300" 
                style={{ width: `${grade12Percent}%` }} 
              />
            </div>
          </DashboardCard>
        </div>

        {/* Document Composition & Collision Protection */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Document Breakdown (2 cols) */}
          <div className="lg:col-span-2">
            <DashboardCard
              title="Scanned Document Breakdown"
              description="Archive distribution across supported official DepEd forms"
              padding="md"
              headerAction={
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  Total: {summaryCards.totalDocuments}
                </span>
              }
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50">
                  <span className="text-[11px] font-bold text-slate-600 uppercase">Old SHS SF9</span>
                  <div className="text-2xl font-bold text-[#0B1F33] mt-1">{documentStats.sf9Count}</div>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">Learner progress report cards</span>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50">
                  <span className="text-[11px] font-bold text-slate-600 uppercase">Old SHS SF10</span>
                  <div className="text-2xl font-bold text-[#0B1F33] mt-1">{documentStats.sf10Count}</div>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">Permanent academic records</span>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50">
                  <span className="text-[11px] font-bold text-slate-600 uppercase">PSA Birth Certificate</span>
                  <div className="text-2xl font-bold text-[#0B1F33] mt-1">{documentStats.psaCount}</div>
                  <span className="text-[11px] text-slate-500 mt-0.5 block">Civil registry & identity</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-5 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
                  <span className="font-medium">Validation Lifecycle Status</span>
                  <span className="font-semibold text-slate-700">
                    {documentStats.approvedDocCount} Approved &bull; {documentStats.pendingDocCount} Pending &bull; {documentStats.rejectedDocCount} Rejected
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex">
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
                    <div className="bg-slate-200 w-full h-full" />
                  )}
                </div>
              </div>
            </DashboardCard>
          </div>

          {/* Duplicate Prevention Card (1 col) */}
          <div className="lg:col-span-1">
            <DashboardCard
              title="Integrity & Collision Guard"
              description="Automatic uniqueness verification"
              icon={<CopyCheck className="h-4 w-4 text-[#174EA6]" />}
              padding="md"
            >
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                Automated LRN matching and referential checks prevent duplicate counting when a student has multiple scanned documents.
              </p>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <span className="text-slate-600 font-medium">Unique Student Document Sets</span>
                  <span className="font-bold text-[#0B1F33]">{documentStats.uniqueDocumentCoverage}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  <span className="text-slate-600 font-medium">Re-scans Flagged</span>
                  <span className="font-bold text-amber-700">{documentStats.duplicateScanCount}</span>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100">
                <Link
                  href="/principal/documents"
                  className="text-xs font-semibold text-[#174EA6] hover:text-[#0B1F33] hover:underline flex items-center justify-between"
                >
                  <span>Inspect Document Monitoring Queue</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </DashboardCard>
          </div>
        </div>

        {/* Section & School Year Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Section Distribution */}
          <DashboardCard
            title="Distribution by Section"
            description={`${studentDistribution.sections.length} active sections recorded`}
            padding="md"
            icon={<Layers className="h-4 w-4 text-[#174EA6]" />}
          >
            {studentDistribution.sections.length > 0 ? (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {studentDistribution.sections.map((sec) => {
                  const maxCount = Math.max(...studentDistribution.sections.map(s => s.count), 1);
                  const pct = Math.round((sec.count / maxCount) * 100);
                  return (
                    <div key={sec.section} className="text-xs">
                      <div className="flex justify-between font-medium text-slate-700 mb-1">
                        <span>{sec.section}</span>
                        <span className="font-bold text-[#0B1F33]">{sec.count} students</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-[#174EA6] h-2 rounded-full" 
                          style={{ width: `${pct}%` }} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">
                No section-assigned student records found.
              </div>
            )}
          </DashboardCard>

          {/* School Year Distribution */}
          <DashboardCard
            title="Records by School Year"
            description={`${studentDistribution.schoolYears.length} academic calendar cycles`}
            padding="md"
            icon={<Calendar className="h-4 w-4 text-[#174EA6]" />}
          >
            {studentDistribution.schoolYears.length > 0 ? (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {studentDistribution.schoolYears.map((sy) => {
                  const maxCount = Math.max(...studentDistribution.schoolYears.map(s => s.count), 1);
                  const pct = Math.round((sy.count / maxCount) * 100);
                  return (
                    <div key={sy.schoolYear} className="text-xs">
                      <div className="flex justify-between font-medium text-slate-700 mb-1">
                        <span>S.Y. {sy.schoolYear}</span>
                        <span className="font-bold text-[#0B1F33]">{sy.count} records</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-[#0B1F33] h-2 rounded-full" 
                          style={{ width: `${pct}%` }} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">
                No school year metadata recorded.
              </div>
            )}
          </DashboardCard>
        </div>

        {/* Recent Scanned Documents Activity Feed */}
        <DashboardCard
          title="Recent Scanned Documents Activity"
          description="Latest school records processed for Taysan Resettlement Integrated School"
          padding="none"
          headerAction={
            <Link
              href="/principal/documents"
              className="text-xs font-semibold text-[#174EA6] hover:text-[#0B1F33] hover:underline flex items-center gap-1"
            >
              <span>View All Scans &rarr;</span>
            </Link>
          }
        >
          {recentDocuments.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
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
                    <TableRow key={doc.id} className="hover:bg-slate-50/80">
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                          {String(doc.documentType).toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell className="font-semibold text-slate-900 text-xs sm:text-sm">
                        {doc.studentName}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {doc.lrn}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">
                        {doc.gradeLevel}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {doc.schoolYear}
                      </TableCell>
                      <TableCell>
                        <DocumentStatusBadge status={doc.status as any} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="inline-flex items-center justify-center px-2.5 py-1 text-xs font-semibold text-[#174EA6] bg-[#174EA6]/10 hover:bg-[#174EA6]/20 rounded-md transition-colors"
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
            <div className="py-12 text-center text-xs text-slate-400">
              No scanned school documents have been uploaded yet.
            </div>
          )}
        </DashboardCard>
      </div>
    </PageContainer>
  );
}

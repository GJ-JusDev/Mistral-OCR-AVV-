import React from "react";
import Link from "next/link";
import { DashboardCard } from "@/components/ui/DashboardCard";
import {
  BookOpen,
  Users,
  Upload,
  Clock,
  GraduationCap,
  AlertCircle,
  ShieldAlert,
} from "lucide-react";
import type { TeacherAssignmentRecord, TeacherModulePolicy } from "@/lib/teacher/assignments";
import TeacherAdvisorySelectionArea from "./TeacherAdvisorySelectionArea";

interface AssignedSectionItem {
  key: string;
  school_year: string;
  grade_level: string;
  section: string;
  strand_or_track: string | null;
  roles: Array<"class_adviser" | "subject_teacher">;
  subjects: string[];
  primaryAssignmentId: string;
  canScan: boolean;
}

export interface TeacherAssignmentOverviewProps {
  advisoryClasses: TeacherAssignmentRecord[];
  subjectAssignments: TeacherAssignmentRecord[];
  assignedSections: AssignedSectionItem[];
  roster: any[];
  pendingDocuments: any[];
  policy: TeacherModulePolicy;
  canScanAny: boolean;
  requestedAdvisory?: any;
}

export default function TeacherAssignmentOverview({
  advisoryClasses,
  subjectAssignments,
  assignedSections,
  roster,
  pendingDocuments,
  policy: _policy,
  canScanAny,
  requestedAdvisory,
}: TeacherAssignmentOverviewProps) {
  const hasAnyActiveAssignment =
    advisoryClasses.length > 0 || subjectAssignments.length > 0;

  if (!hasAnyActiveAssignment) {
    return (
      <div className="space-y-6">
        <TeacherAdvisorySelectionArea
          advisoryClasses={advisoryClasses}
          initialRequestedAdvisory={requestedAdvisory}
        />
        <div
          role="region"
          aria-labelledby="no-active-assignment-heading"
          className="rounded-xl border border-amber-300 bg-amber-50 p-6 shadow-xs"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <ShieldAlert className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h2 id="no-active-assignment-heading" className="text-lg font-bold text-slate-900">
                No Active Teaching Assignments Found
              </h2>
              <p className="mt-1 text-sm text-slate-700">
                You currently do not have any active Class Adviser or Subject Teacher assignments.
                Submit an advisory class request above or contact your school administrator.
                SF9/SF10 scanning and roster viewing remain locked until an approved assignment is in place.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TeacherAdvisorySelectionArea
        advisoryClasses={advisoryClasses}
        initialRequestedAdvisory={requestedAdvisory}
      />
      {/* Row 1: Advisory Classes & Teaching Subjects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DashboardCard
          title="My Advisory Classes"
          description="Sections assigned to you as official Class Adviser"
          icon={<GraduationCap className="h-4 w-4 text-[#174EA6]" />}
        >
          {advisoryClasses.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              You have no active advisory class assignments.
            </p>
          ) : (
            <ul className="space-y-3">
              {advisoryClasses.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {a.grade_level} — {a.section}
                      {a.strand_or_track ? ` (${a.strand_or_track})` : ""}
                    </p>
                    <p className="text-xs text-slate-600">School Year {a.school_year} • Class Adviser</p>
                  </div>
                  <Link
                    href={`/upload?assignmentId=${encodeURIComponent(a.id)}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#174EA6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0B1F33] transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    Scan SF9 / SF10
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>

        <DashboardCard
          title="My Teaching Subjects"
          description="Subjects and sections assigned for grade verification"
          icon={<BookOpen className="h-4 w-4 text-sky-700" />}
        >
          {subjectAssignments.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              You have no active subject teacher assignments.
            </p>
          ) : (
            <ul className="space-y-3">
              {subjectAssignments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5"
                >
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {a.subject_taught}
                      {a.semester ? ` (${a.semester})` : ""}
                    </p>
                    <p className="text-xs text-slate-600">
                      {a.grade_level} — {a.section}
                      {a.strand_or_track ? ` — ${a.strand_or_track}` : ""} • SY {a.school_year}
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                    Grade Editing Only
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashboardCard>
      </div>

      {/* Row 2: Assigned Sections & SF9/SF10 Document Scanning Quick Launch */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <DashboardCard
            title="Assigned Sections & Student Rosters"
            description="Canonical students enrolled across your authorized sections"
            icon={<Users className="h-4 w-4 text-[#174EA6]" />}
            headerAction={
              <Link
                href="/students"
                className="text-xs font-semibold text-[#174EA6] hover:underline"
              >
                Full Directory &rarr;
              </Link>
            }
          >
            <div className="mb-4 flex flex-wrap gap-2">
              {assignedSections.map((sec) => (
                <span
                  key={sec.key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-900"
                >
                  {sec.grade_level} — {sec.section}
                  {sec.strand_or_track ? ` (${sec.strand_or_track})` : ""}
                  <span className="text-[11px] font-normal text-indigo-700">
                    • {sec.roles.includes("class_adviser") ? "Adviser" : "Subject Teacher"}
                  </span>
                </span>
              ))}
            </div>

            {roster.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">
                No enrolled learners recorded in your assigned sections yet. Scan an SF9 or SF10 to populate class rosters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs sm:text-sm border-collapse">
                  <caption className="sr-only">Student rosters for authorized assigned sections</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th scope="col" className="py-2 pr-3">LRN</th>
                      <th scope="col" className="py-2 pr-3">Student Name</th>
                      <th scope="col" className="py-2 pr-3">Section</th>
                      <th scope="col" className="py-2">Standing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {roster.slice(0, 10).map((r: any) => {
                      const stu = r.students;
                      const fullName = stu
                        ? `${stu.last_name}, ${stu.first_name}${stu.middle_name ? ` ${stu.middle_name}` : ""}`
                        : "Linked Student";
                      return (
                        <tr key={r.id}>
                          <td className="py-2.5 pr-3 font-mono text-xs text-slate-700">
                            {stu?.lrn || "Pending"}
                          </td>
                          <td className="py-2.5 pr-3 font-semibold text-slate-900">{fullName}</td>
                          <td className="py-2.5 pr-3 text-slate-600">
                            {r.grade_level} — {r.section}
                            {r.strand_or_track ? ` (${r.strand_or_track})` : ""}
                          </td>
                          <td className="py-2.5">
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                              {stu?.overall_status || "Needs Verification"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DashboardCard>
        </div>

        {/* SF9/SF10 Document Scanning + Pending Document Reviews */}
        <div className="space-y-6">
          <DashboardCard
            title="SF9 / SF10 Document Scanning"
            description="Select an authorized class assignment before scanning"
            icon={<Upload className="h-4 w-4 text-[#174EA6]" />}
          >
            {canScanAny ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  Every scan requires pre-scan confirmation of your School Year, Grade Level, Section, Strand, and Document Type.
                </p>
                <div className="flex flex-col gap-2">
                  <Link
                    href="/upload?docType=sf9"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#174EA6] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0B1F33] transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    Scan SF9 Report Card
                  </Link>
                  <Link
                    href="/upload?docType=sf10"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#174EA6] px-3 py-2 text-xs font-semibold text-[#174EA6] hover:bg-[#174EA6]/10 transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    Scan SF10 Permanent Record
                  </Link>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Document scanning and OCR extraction are restricted exclusively to officially assigned active Class Advisers.
                  You retain authorized viewing and grade editing access for your assigned teaching subjects.
                </span>
              </div>
            )}
          </DashboardCard>

          <DashboardCard
            title="Pending Document Reviews"
            description={`${pendingDocuments.length} pending item${pendingDocuments.length === 1 ? "" : "s"} in assigned classes`}
            icon={<Clock className="h-4 w-4 text-amber-600" />}
            headerAction={
              <Link href="/review" className="text-xs font-semibold text-[#174EA6] hover:underline">
                Queue &rarr;
              </Link>
            }
          >
            {pendingDocuments.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">No pending reviews in your assigned sections.</p>
            ) : (
              <ul className="space-y-2">
                {pendingDocuments.slice(0, 5).map((doc: any) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">
                        {doc.extracted_fields?.name || doc.original_filename || "Unnamed Learner"}
                      </p>
                      <p className="text-[11px] text-slate-500 uppercase">
                        {doc.document_type} • {doc.section || doc.grade_level || "Pending"}
                      </p>
                    </div>
                    <Link
                      href={`/documents/${doc.id}`}
                      className="shrink-0 rounded bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-[#174EA6] hover:bg-indigo-100"
                    >
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}

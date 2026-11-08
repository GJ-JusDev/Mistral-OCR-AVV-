"use client";

import React, { useState, useTransition } from "react";
import PageContainer from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import { 
  GraduationCap, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Search, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  ShieldCheck, 
  BookOpen,
  Layers,
  School
} from "lucide-react";
import { getPrincipalAcademicOverview } from "@/actions/principal";

interface SubjectGrade {
  subject: string;
  q1?: number | null;
  q2?: number | null;
  q3?: number | null;
  q4?: number | null;
  final_grade?: number | null;
  status: string;
}

interface AcademicStudent {
  id: string;
  lrn: string;
  fullName: string;
  gradeLevel: string;
  section: string;
  schoolYear: string;
  academicStanding: string;
  generalAverage?: number | null;
  gradesCount: number;
  grades: SubjectGrade[];
  isIncomplete: boolean;
}

interface SectionSummary {
  grade: string;
  section: string;
  total: number;
  passed: number;
  failed: number;
  needsVerification: number;
  passingRate: number;
}

interface Props {
  initialMetrics: {
    totalEvaluated: number;
    totalPassed: number;
    totalFailed: number;
    totalNeedsVerification: number;
    passingRate: number;
  };
  initialSectionSummaries: SectionSummary[];
  initialStudents: AcademicStudent[];
  totalCount: number;
}

export default function PrincipalAcademicView({
  initialMetrics,
  initialSectionSummaries,
  initialStudents,
  totalCount,
}: Props) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [sectionSummaries, setSectionSummaries] = useState<SectionSummary[]>(initialSectionSummaries);
  const [students, setStudents] = useState<AcademicStudent[]>(initialStudents);
  const [isPending, startTransition] = useTransition();

  // Filters
  const [grade, setGrade] = useState("All");
  const [section, setSection] = useState("All");
  const [schoolYear, setSchoolYear] = useState("All");
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);

  const applyFilters = (nextGrade = grade, nextSection = section, nextSY = schoolYear) => {
    startTransition(async () => {
      const res = await getPrincipalAcademicOverview({
        grade: nextGrade,
        section: nextSection,
        schoolYear: nextSY,
      });

      if (!("error" in res)) {
        setMetrics(res.metrics);
        setSectionSummaries(res.sectionSummaries);
        setStudents(res.students);
      }
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedStudentId(expandedStudentId === id ? null : id);
  };

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#7c3aed]/10 text-[#7c3aed]">
              <GraduationCap className="h-3.5 w-3.5" />
              Academic Performance Overview
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700">
              TRIS Senior High School
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Senior High School Academic Standing
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Verified academic performance metrics, section promotion summaries, and subject grade rosters.
          </p>
        </div>
      </div>

      {/* Authoritative Data Banner */}
      <div className="mt-6 p-3.5 bg-[#7c3aed]/5 border border-[#7c3aed]/20 rounded-lg flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-[#7c3aed] shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-700">
          <span className="font-semibold text-[#7c3aed]">DepEd Policy Compliance:</span> All grades, averages, and academic standings displayed below reflect authoritative database records verified from official SF9 and SF10 documents. In accordance with school policy, no grades are computed, predicted, or fabricated.
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-6">
        <Card padding="md" className="bg-white border-l-4 border-l-[#7c3aed]">
          <p className="text-[0.65rem] font-bold text-zinc-500 uppercase">Total Evaluated</p>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{metrics.totalEvaluated}</p>
          <p className="text-[0.65rem] text-zinc-500 mt-2">Active SHS records</p>
        </Card>

        <Card padding="md" className="bg-white border-l-4 border-l-emerald-500">
          <p className="text-[0.65rem] font-bold text-emerald-700 uppercase">Total Passed</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{metrics.totalPassed}</p>
          <p className="text-[0.65rem] text-zinc-500 mt-2">Met promotion criteria</p>
        </Card>

        <Card padding="md" className="bg-white border-l-4 border-l-red-500">
          <p className="text-[0.65rem] font-bold text-red-700 uppercase">Total Failed</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{metrics.totalFailed}</p>
          <p className="text-[0.65rem] text-zinc-500 mt-2">Failing marks recorded</p>
        </Card>

        <Card padding="md" className="bg-white border-l-4 border-l-amber-500">
          <p className="text-[0.65rem] font-bold text-amber-700 uppercase">Needs Verification</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{metrics.totalNeedsVerification}</p>
          <p className="text-[0.65rem] text-zinc-500 mt-2">Incomplete or pending</p>
        </Card>

        <Card padding="md" className="bg-white border-l-4 border-l-indigo-600">
          <p className="text-[0.65rem] font-bold text-indigo-700 uppercase">Passing Rate</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{metrics.passingRate}%</p>
          <p className="text-[0.65rem] text-zinc-500 mt-2">Of evaluated learners</p>
        </Card>
      </div>

      {/* Section Performance Summary Table */}
      <Card padding="none" className="bg-white mt-6 overflow-hidden shadow-xs border border-zinc-200">
        <div className="p-4 border-b border-zinc-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#7c3aed]" />
            <h3 className="text-sm font-semibold text-zinc-900">Performance Summary by Section</h3>
          </div>
          <span className="text-xs text-zinc-500">{sectionSummaries.length} Sections</span>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grade Level</TableHead>
                <TableHead>Section Name</TableHead>
                <TableHead className="text-center">Total Students</TableHead>
                <TableHead className="text-center">Passed</TableHead>
                <TableHead className="text-center">Failed</TableHead>
                <TableHead className="text-center">Needs Verification</TableHead>
                <TableHead className="text-right">Passing Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sectionSummaries.length > 0 ? (
                sectionSummaries.map((sec, idx) => (
                  <TableRow key={idx} className="hover:bg-zinc-50/80">
                    <TableCell className="font-semibold text-zinc-900 text-xs">
                      {sec.grade}
                    </TableCell>
                    <TableCell className="font-medium text-zinc-800 text-xs">
                      {sec.section}
                    </TableCell>
                    <TableCell className="text-center text-xs font-semibold text-zinc-900">
                      {sec.total}
                    </TableCell>
                    <TableCell className="text-center text-xs font-semibold text-emerald-600">
                      {sec.passed}
                    </TableCell>
                    <TableCell className="text-center text-xs font-semibold text-red-600">
                      {sec.failed}
                    </TableCell>
                    <TableCell className="text-center text-xs font-semibold text-amber-600">
                      {sec.needsVerification}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className="bg-[#7c3aed] h-1.5 rounded-full" 
                            style={{ width: `${sec.passingRate}%` }} 
                          />
                        </div>
                        <span className="text-xs font-bold text-zinc-900">{sec.passingRate}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-xs text-zinc-500">
                    No section summaries available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Learner Academic Rosters */}
      <div className="mt-6 flex flex-col gap-4">
        {/* Filters */}
        <Card padding="md" className="bg-white shadow-xs border border-zinc-200">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Filter Grade Level</label>
              <select
                value={grade}
                onChange={(e) => {
                  setGrade(e.target.value);
                  applyFilters(e.target.value, section, schoolYear);
                }}
                className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#7c3aed] focus:border-[#7c3aed]"
              >
                <option value="All">All Grades (11 & 12)</option>
                <option value="Grade 11">Grade 11</option>
                <option value="Grade 12">Grade 12</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Filter Section</label>
              <select
                value={section}
                onChange={(e) => {
                  setSection(e.target.value);
                  applyFilters(grade, e.target.value, schoolYear);
                }}
                className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#7c3aed] focus:border-[#7c3aed]"
              >
                <option value="All">All Sections</option>
                {Array.from(new Set(sectionSummaries.map(s => s.section))).map(sec => (
                  <option key={sec} value={sec}>{sec}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end justify-between">
              <span className="text-xs text-zinc-500">Showing {students.length} learner records</span>
              {isPending && <span className="text-xs text-[#7c3aed] font-medium">Updating...</span>}
            </div>
          </div>
        </Card>

        {/* Student Academic Standing Table */}
        <Card padding="none" className="bg-white overflow-hidden shadow-xs border border-zinc-200">
          <div className="p-4 border-b border-zinc-200">
            <h3 className="text-sm font-semibold text-zinc-900">Learner Academic Records & Subject Grades</h3>
            <p className="text-xs text-zinc-500">Click &ldquo;View Grades&rdquo; to expand official verified subject grades</p>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Learner Name</TableHead>
                  <TableHead>LRN</TableHead>
                  <TableHead>Grade & Section</TableHead>
                  <TableHead>School Year</TableHead>
                  <TableHead className="text-center">General Average</TableHead>
                  <TableHead>Academic Standing</TableHead>
                  <TableHead className="text-right">Subjects & Grades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.length > 0 ? (
                  students.map((st) => {
                    const isExpanded = expandedStudentId === st.id;
                    return (
                      <React.Fragment key={st.id}>
                        <TableRow className="hover:bg-zinc-50/80">
                          <TableCell className="font-semibold text-zinc-900 text-xs">
                            {st.fullName}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-zinc-600">
                            {st.lrn}
                          </TableCell>
                          <TableCell className="text-xs text-zinc-700">
                            {st.gradeLevel} &bull; {st.section}
                          </TableCell>
                          <TableCell className="text-xs text-zinc-600">
                            {st.schoolYear}
                          </TableCell>
                          <TableCell className="text-center font-bold text-xs text-zinc-900">
                            {st.generalAverage ? (
                              <span className="px-2 py-0.5 rounded bg-zinc-100">{st.generalAverage}</span>
                            ) : (
                              <span className="text-zinc-400 font-normal">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                              st.academicStanding === "Passed"
                                ? "bg-emerald-100 text-emerald-800"
                                : st.academicStanding === "Failed"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                            }`}>
                              {st.academicStanding === "Passed" ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : st.academicStanding === "Failed" ? (
                                <XCircle className="h-3 w-3" />
                              ) : (
                                <AlertTriangle className="h-3 w-3" />
                              )}
                              {st.academicStanding}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <button
                              onClick={() => toggleExpand(st.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-[#7c3aed] bg-[#7c3aed]/10 hover:bg-[#7c3aed]/20 transition-colors"
                            >
                              <span>{st.gradesCount} Subjects</span>
                              {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </TableCell>
                        </TableRow>

                        {/* Expanded Subject Grades Accordion */}
                        {isExpanded && (
                          <TableRow className="bg-zinc-50/80">
                            <TableCell colSpan={7} className="p-4">
                              <div className="p-3 bg-white rounded-md border border-zinc-200">
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-wider flex items-center gap-1.5">
                                    <BookOpen className="h-3.5 w-3.5 text-[#7c3aed]" />
                                    <span>Verified Subject Grades for {st.fullName}</span>
                                  </h4>
                                  <span className="text-[0.65rem] text-zinc-500">
                                    Extracted from Official Senior High School Form
                                  </span>
                                </div>

                                {st.grades && st.grades.length > 0 ? (
                                  <table className="w-full text-xs text-left">
                                    <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
                                      <tr>
                                        <th className="py-1.5 px-3">Subject / Learning Area</th>
                                        <th className="py-1.5 px-2 text-center">Q1</th>
                                        <th className="py-1.5 px-2 text-center">Q2</th>
                                        <th className="py-1.5 px-2 text-center">Q3</th>
                                        <th className="py-1.5 px-2 text-center">Q4</th>
                                        <th className="py-1.5 px-2 text-center font-bold">Final Grade</th>
                                        <th className="py-1.5 px-3 text-right">Remarks</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                      {st.grades.map((g, idx) => (
                                        <tr key={idx} className="hover:bg-zinc-50/50">
                                          <td className="py-1.5 px-3 font-medium text-zinc-800">{g.subject}</td>
                                          <td className="py-1.5 px-2 text-center text-zinc-600">{g.q1 ?? "-"}</td>
                                          <td className="py-1.5 px-2 text-center text-zinc-600">{g.q2 ?? "-"}</td>
                                          <td className="py-1.5 px-2 text-center text-zinc-600">{g.q3 ?? "-"}</td>
                                          <td className="py-1.5 px-2 text-center text-zinc-600">{g.q4 ?? "-"}</td>
                                          <td className="py-1.5 px-2 text-center font-bold text-zinc-900">{g.final_grade ?? "-"}</td>
                                          <td className="py-1.5 px-3 text-right">
                                            <span className={`px-1.5 py-0.5 rounded text-[0.65rem] font-semibold ${
                                              g.status === "Passed" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                                            }`}>
                                              {g.status}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <div className="py-4 text-center text-xs text-zinc-500">
                                    No subject grades are recorded for this student.
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-sm text-zinc-500">
                      No academic records match the specified filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}

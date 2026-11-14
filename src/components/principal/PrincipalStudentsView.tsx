"use client";

import React, { useState, useTransition } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import { 
  Users, 
  Search, 
  Filter, 
  Eye, 
  EyeOff, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  X,
  GraduationCap,
  Calendar,
  School,
  ExternalLink,
  ShieldCheck,
  Lock,
  Printer,
  Check,
  AlertCircle,
  FileCheck
} from "lucide-react";
import { 
  getPrincipalStudentRecords, 
  getPrincipalStudentDetails, 
  approveStudentEligibility 
} from "@/actions/principal";
import { maskLrn } from "@/lib/students/studentDirectory";
import DigitalAcademicRecordModal from "@/components/principal/DigitalAcademicRecordModal";

interface StudentRecord {
  id: string;
  lrn: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  suffix?: string | null;
  fullName: string;
  birthDate?: string | null;
  sex?: string | null;
  gradeLevel: string;
  section: string;
  schoolYear: string;
  reviewStatus: string;
  academicStanding: string;
  generalAverage?: string | number | null;
  availableDocuments: {
    sf9: { id: string; status: string; storagePath?: string | null } | null;
    sf10: { id: string; status: string; storagePath?: string | null } | null;
  };
  completeness: {
    status: "COMPLETE" | "INCOMPLETE" | "IDENTITY_REVIEW_REQUIRED";
    label: string;
    hasSf9: boolean;
    hasSf10: boolean;
  };
  eligibility: {
    gradeLevel: string;
    eligibilityType: string;
    status: "Eligible" | "Not Eligible" | "Needs Review";
    approvalDecision: "Approved" | "Not Approved" | "Pending";
    academicCategory?: string;
    attendanceCategory?: string;
    documentCategory?: string;
    taglishAdvisory?: string;
    reasons: string[];
    blockingFactors: string[];
    canPrincipalApprove: boolean;
  };
  academicStatus?: string;
  attendanceStatus?: string;
  documentStatus?: string;
  attendanceSummary?: any;
  taglishAdvisory?: string;
  identityComparison: {
    overallStatus: "MATCH" | "IDENTITY_REVIEW_REQUIRED";
    isSameLearner: boolean;
    canLink: boolean;
    discrepancies: string[];
    summaryMessage: string;
  };
  documentsCount: number;
  latestDocumentId?: string | null;
  isVerifiedStudent: boolean;
}

interface Props {
  initialStudents: StudentRecord[];
  initialSections: string[];
  initialSchoolYears: string[];
  totalCount: number;
}

export default function PrincipalStudentsView({
  initialStudents,
  initialSections,
  initialSchoolYears,
  totalCount,
}: Props) {
  const [students, setStudents] = useState<StudentRecord[]>(initialStudents);
  const [isPending, startTransition] = useTransition();

  // Filters
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState("All");
  const [section, setSection] = useState("All");
  const [schoolYear, setSchoolYear] = useState("All");
  const [status, setStatus] = useState("All");
  const [completenessFilter, setCompletenessFilter] = useState("All");
  const [eligibilityFilter, setEligibilityFilter] = useState("All");
  const [showFullLrn, setShowFullLrn] = useState(false);

  // Student Details Modal State
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [studentDetails, setStudentDetails] = useState<any | null>(null);

  // Eligibility Approval Action State
  const [approvalRemarks, setApprovalRemarks] = useState("");
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Digital Academic Record Modal State
  const [digitalRecordStudent, setDigitalRecordStudent] = useState<any | null>(null);

  const applyFilters = (
    nextQuery = query,
    nextGrade = grade,
    nextSection = section,
    nextSY = schoolYear,
    nextStatus = status,
    nextCompleteness = completenessFilter,
    nextEligibility = eligibilityFilter
  ) => {
    startTransition(async () => {
      const res = await getPrincipalStudentRecords({
        query: nextQuery,
        grade: nextGrade,
        section: nextSection,
        schoolYear: nextSY,
        status: nextStatus,
        completeness: nextCompleteness,
        eligibility: nextEligibility,
      });

      if (!("error" in res)) {
        setStudents(res.students);
      }
    });
  };

  const handleOpenDetails = async (id: string) => {
    setSelectedStudentId(id);
    setDetailsLoading(true);
    setStudentDetails(null);
    setApprovalRemarks("");
    setActionMessage(null);

    const res = await getPrincipalStudentDetails(id);
    if (!("error" in res)) {
      setStudentDetails(res);
    }
    setDetailsLoading(false);
  };

  const handleCloseModal = () => {
    setSelectedStudentId(null);
    setStudentDetails(null);
    setApprovalRemarks("");
    setActionMessage(null);
  };

  const handleOpenDigitalRecord = async (studentIdOrRecord: any) => {
    if (studentIdOrRecord?.grades && studentIdOrRecord?.documents) {
      setDigitalRecordStudent(studentIdOrRecord);
      return;
    }
    // Fetch full details if only lightweight record available
    const id = typeof studentIdOrRecord === "string" ? studentIdOrRecord : studentIdOrRecord.id;
    const res = await getPrincipalStudentDetails(id);
    if (!("error" in res)) {
      // Re-map to DigitalRecord format
      const formatted = {
        id: res.student.id,
        lrn: res.student.lrn,
        fullName: res.student.fullName,
        firstName: res.student.firstName,
        middleName: res.student.middleName,
        lastName: res.student.lastName,
        suffix: res.student.suffix,
        gradeLevel: res.student.gradeLevel,
        section: res.student.section,
        schoolYear: res.student.schoolYear,
        generalAverage: res.student.generalAverage,
        academicStanding: res.student.overallStatus || "Needs Verification",
        eligibility: res.eligibility,
        completeness: res.completeness,
        documents: res.documents,
        grades: res.grades,
        approvalRecord: res.approvalRecord,
      };
      setDigitalRecordStudent(formatted);
    }
  };

  const handleExecuteApproval = async (decision: "Approved" | "Not Approved") => {
    if (!studentDetails?.student) return;

    setIsSubmittingApproval(true);
    setActionMessage(null);

    const res = await approveStudentEligibility({
      studentId: studentDetails.student.id,
      gradeLevel: studentDetails.student.gradeLevel,
      schoolYear: studentDetails.student.schoolYear || "2024-2025",
      eligibilityType: studentDetails.eligibility.eligibilityType,
      decision,
      remarks: approvalRemarks,
    });

    setIsSubmittingApproval(false);

    if ("error" in res && res.error) {
      setActionMessage({ type: "error", text: res.error });
    } else {
      setActionMessage({
        type: "success",
        text: `Eligibility successfully marked as ${decision}.`,
      });
      // Refresh current details
      const updated = await getPrincipalStudentDetails(studentDetails.student.id);
      if (!("error" in updated)) {
        setStudentDetails(updated);
      }
      // Refresh students table
      applyFilters();
    }
  };

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#174EA6]/10 text-[#174EA6]">
              <Users className="h-3.5 w-3.5" />
              Unified Student Records Directory
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700">
              <School className="h-3.5 w-3.5 text-[#174EA6]" />
              TRIS DepEd ID: 500169
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Senior High School Student Monitoring & Eligibility
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Unified records organizing SF9 and SF10 with Principal eligibility approval.
          </p>
        </div>

        <div className="mt-4 sm:mt-0 flex items-center gap-2">
          <button
            onClick={() => setShowFullLrn(!showFullLrn)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 transition-colors shadow-xs"
            title="Toggle LRN Masking for Privacy"
          >
            {showFullLrn ? (
              <>
                <EyeOff className="h-3.5 w-3.5 text-zinc-500" />
                <span>Mask LRNs</span>
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 text-zinc-500" />
                <span>Reveal LRNs</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <Card padding="md" className="bg-white mt-6 shadow-xs border border-zinc-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search Query */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Search Learner</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Name or LRN..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  applyFilters(e.target.value, grade, section, schoolYear, status, completenessFilter, eligibilityFilter);
                }}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-zinc-300 focus:outline-none focus:ring-1 focus:ring-[#174EA6] focus:border-[#174EA6]"
              />
            </div>
          </div>

          {/* Grade Level Filter */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Grade Level</label>
            <select
              value={grade}
              onChange={(e) => {
                setGrade(e.target.value);
                applyFilters(query, e.target.value, section, schoolYear, status, completenessFilter, eligibilityFilter);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#174EA6] focus:border-[#174EA6]"
            >
              <option value="All">All Grades (11 & 12)</option>
              <option value="Grade 11">Grade 11</option>
              <option value="Grade 12">Grade 12</option>
            </select>
          </div>

          {/* Section Filter */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Section</label>
            <select
              value={section}
              onChange={(e) => {
                setSection(e.target.value);
                applyFilters(query, grade, e.target.value, schoolYear, status, completenessFilter, eligibilityFilter);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#174EA6] focus:border-[#174EA6]"
            >
              <option value="All">All Sections</option>
              {initialSections.map((sec) => (
                <option key={sec} value={sec}>{sec}</option>
              ))}
            </select>
          </div>

          {/* School Year Filter */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">School Year</label>
            <select
              value={schoolYear}
              onChange={(e) => {
                setSchoolYear(e.target.value);
                applyFilters(query, grade, section, e.target.value, status, completenessFilter, eligibilityFilter);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#174EA6] focus:border-[#174EA6]"
            >
              <option value="All">All School Years</option>
              {initialSchoolYears.map((sy) => (
                <option key={sy} value={sy}>S.Y. {sy}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Phase 6 & 7 Advanced Filters: Completeness & Eligibility */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3 pt-3 border-t border-zinc-100">
          {/* Document Completeness */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Document Completeness</label>
            <select
              value={completenessFilter}
              onChange={(e) => {
                setCompletenessFilter(e.target.value);
                applyFilters(query, grade, section, schoolYear, status, e.target.value, eligibilityFilter);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#174EA6] focus:border-[#174EA6]"
            >
              <option value="All">All Completeness Statuses</option>
              <option value="Complete">Complete (SF9, SF10)</option>
              <option value="Incomplete">Incomplete Document Sets</option>
              <option value="Missing SF9">Missing SF9 Report Card</option>
              <option value="Missing SF10">Missing SF10 Permanent Record</option>
              <option value="Identity Review Required">Identity Review Required</option>
            </select>
          </div>

          {/* Academic Eligibility */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Academic Eligibility</label>
            <select
              value={eligibilityFilter}
              onChange={(e) => {
                setEligibilityFilter(e.target.value);
                applyFilters(query, grade, section, schoolYear, status, completenessFilter, e.target.value);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#174EA6] focus:border-[#174EA6]"
            >
              <option value="All">All Eligibility Assessments</option>
              <option value="Eligible">Eligible (Progression or Graduation)</option>
              <option value="Not Eligible">Academically Ineligible (&lt;75)</option>
              <option value="Needs Review">Needs Review (Missing Docs)</option>
              <option value="Approved">Approved by Principal</option>
            </select>
          </div>

          {/* Review Status */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">OCR Document Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                applyFilters(query, grade, section, schoolYear, e.target.value, completenessFilter, eligibilityFilter);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#174EA6] focus:border-[#174EA6]"
            >
              <option value="All">All OCR Statuses</option>
              <option value="Approved">Approved</option>
              <option value="Pending Review">Pending Review</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100 text-xs text-zinc-500">
          <span>Showing {students.length} of {totalCount} records</span>
          {isPending && <span className="text-[#174EA6] font-medium animate-pulse">Filtering unified records...</span>}
        </div>
      </Card>

      {/* Unified Student Records Table */}
      <Card padding="none" className="bg-white mt-6 overflow-hidden shadow-xs border border-zinc-200">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Learner Name</TableHead>
                <TableHead>LRN</TableHead>
                <TableHead>Grade & Section</TableHead>
                <TableHead>School Year</TableHead>
                <TableHead>Academic Status</TableHead>
                <TableHead>Attendance Status</TableHead>
                <TableHead>Document Status</TableHead>
                <TableHead>Academic Eligibility</TableHead>
                <TableHead>Principal Action</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.length > 0 ? (
                students.map((st) => {
                  const displayLrn = showFullLrn ? st.lrn : maskLrn(st.lrn);
                  const isEligible = st.eligibility?.status === "Eligible";
                  const isApproved = st.eligibility?.approvalDecision === "Approved";
                  const isComplete = st.completeness?.status === "COMPLETE";
                  const isIdentityReview = st.completeness?.status === "IDENTITY_REVIEW_REQUIRED";

                  return (
                    <TableRow key={st.id} className="hover:bg-zinc-50/80">
                      <TableCell className="font-semibold text-zinc-900">
                        <div>
                          <span>{st.fullName}</span>
                          {!st.isVerifiedStudent && (
                            <span className="block text-[0.65rem] text-zinc-400 font-normal">Candidate Learner</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-zinc-600">
                        {displayLrn}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-medium text-zinc-800">{st.gradeLevel}</span>
                        <span className="text-zinc-500 block text-[0.7rem]">{st.section}</span>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-600">
                        {st.schoolYear}
                      </TableCell>

                      {/* 1. Academic Status */}
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.7rem] font-semibold ${
                          (st.academicStatus || st.eligibility?.academicCategory) === "Remedial Required"
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : (st.academicStatus || st.eligibility?.academicCategory) === "Remedial In Progress"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : (st.academicStatus || st.eligibility?.academicCategory) === "Academic Review Required"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}>
                          {st.academicStatus || st.eligibility?.academicCategory || "Passed"}
                        </span>
                      </TableCell>

                      {/* 2. Attendance Status */}
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.7rem] font-semibold ${
                          (st.attendanceStatus || st.eligibility?.attendanceCategory) === "Review Required"
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : (st.attendanceStatus || st.eligibility?.attendanceCategory) === "Warning"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : (st.attendanceStatus || st.eligibility?.attendanceCategory) === "Incomplete Data"
                            ? "bg-zinc-100 text-zinc-600 border border-zinc-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}>
                          {st.attendanceStatus || st.eligibility?.attendanceCategory || "Normal"}
                        </span>
                      </TableCell>

                      {/* 3. Document Status */}
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.7rem] font-semibold ${
                          isComplete || (st.documentStatus || st.eligibility?.documentCategory) === "Complete"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : isIdentityReview || (st.documentStatus || st.eligibility?.documentCategory) === "Identity Review Required"
                            ? "bg-purple-50 text-purple-700 border border-purple-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}>
                          {isComplete ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              Complete Set
                            </>
                          ) : (
                            st.documentStatus || st.eligibility?.documentCategory || "Incomplete"
                          )}
                        </span>
                      </TableCell>

                      {/* Academic Eligibility Assessment */}
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                          st.eligibility?.status === "Eligible"
                            ? "bg-emerald-50 text-emerald-700"
                            : st.eligibility?.status === "Not Eligible"
                            ? "bg-red-50 text-red-700"
                            : "bg-amber-50 text-amber-700"
                        }`}>
                          {st.eligibility?.status === "Eligible" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : st.eligibility?.status === "Not Eligible" ? (
                            <XCircle className="h-3 w-3" />
                          ) : (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {st.eligibility?.status || "Needs Review"}
                        </span>
                        <span className="block text-[0.65rem] text-zinc-500 mt-0.5">
                          {st.eligibility?.eligibilityType}
                        </span>
                      </TableCell>

                      {/* Principal Approval Status */}
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.7rem] font-semibold ${
                          isApproved
                            ? "bg-emerald-100 text-emerald-800"
                            : st.eligibility?.approvalDecision === "Not Approved"
                            ? "bg-red-100 text-red-800"
                            : "bg-zinc-100 text-zinc-700"
                        }`}>
                          {isApproved ? (
                            <>
                              <ShieldCheck className="h-3 w-3 text-emerald-600" />
                              Approved
                            </>
                          ) : st.eligibility?.approvalDecision === "Not Approved" ? (
                            <>
                              <XCircle className="h-3 w-3 text-red-600" />
                              Disapproved
                            </>
                          ) : (
                            <>
                              <Clock className="h-3 w-3 text-zinc-400" />
                              Pending
                            </>
                          )}
                        </span>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenDetails(st.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-[#174EA6] bg-[#174EA6]/10 hover:bg-[#174EA6]/20 transition-colors"
                          >
                            <span>Inspect</span>
                          </button>
                          <button
                            onClick={() => handleOpenDigitalRecord(st.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-colors"
                            title="Open Official Digital Academic Record"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-sm text-zinc-500">
                    No student records match the selected filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Phase 8 & 9: Detailed Unified Student Record & Principal Approval Modal */}
      {selectedStudentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-zinc-200 w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-200 bg-zinc-50 sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-[#174EA6]/10 text-[#174EA6]">
                  <GraduationCap className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">
                    Official Student Academic Profile &amp; Eligibility
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Taysan Resettlement Integrated School (DepEd ID: 500169)
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseModal}
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5">
              {detailsLoading ? (
                <div className="py-16 text-center text-sm text-zinc-500">
                  <Clock className="h-6 w-6 text-[#174EA6] animate-spin mx-auto mb-2" />
                  Loading verified student records and original files...
                </div>
              ) : studentDetails?.student ? (
                <div className="space-y-6">
                  {/* Basic Learner Header Banner */}
                  <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div>
                        <p className="text-[0.65rem] font-semibold text-zinc-500 uppercase">Learner Name</p>
                        <p className="text-sm font-bold text-zinc-900 mt-0.5">{studentDetails.student.fullName}</p>
                      </div>
                      <div>
                        <p className="text-[0.65rem] font-semibold text-zinc-500 uppercase">LRN</p>
                        <p className="text-sm font-mono font-medium text-zinc-800 mt-0.5">{studentDetails.student.lrn}</p>
                      </div>
                      <div>
                        <p className="text-[0.65rem] font-semibold text-zinc-500 uppercase">Grade & Section</p>
                        <p className="text-sm font-medium text-zinc-800 mt-0.5">
                          {studentDetails.student.gradeLevel} &bull; {studentDetails.student.section}
                        </p>
                      </div>
                      <div>
                        <p className="text-[0.65rem] font-semibold text-zinc-500 uppercase">School Year</p>
                        <p className="text-sm text-zinc-800 mt-0.5">{studentDetails.student.schoolYear || "N/A"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Phase 8: Three Independent Monitoring Categories & Taglish Guidance */}
                  <div className="p-4 rounded-lg border border-zinc-200 bg-white shadow-xs space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
                      <span className="text-xs font-bold uppercase tracking-wider text-zinc-900">
                        Official Monitoring Overview (3 Independent Categories)
                      </span>
                      <span className="text-[0.65rem] text-zinc-400 font-medium">TRIS School ID: 500169</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* 1. Academic Status */}
                      <div className="p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                        <span className="text-[0.65rem] font-bold text-zinc-500 uppercase block">Academic Status</span>
                        <p className="text-sm font-bold text-zinc-900 mt-0.5">
                          {studentDetails.academicStatus || studentDetails.eligibility?.academicCategory || "Passed"}
                        </p>
                        <p className="text-[0.7rem] text-zinc-500 mt-1">
                          {studentDetails.eligibility?.failedSubjectsCount > 0
                            ? `Affected: ${studentDetails.eligibility.failedSubjectsCount} subject(s)`
                            : "All evaluated subjects passing"}
                        </p>
                      </div>

                      {/* 2. Attendance Status */}
                      <div className="p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                        <span className="text-[0.65rem] font-bold text-zinc-500 uppercase block">Attendance Status</span>
                        <p className="text-sm font-bold text-zinc-900 mt-0.5">
                          {studentDetails.attendanceStatus || studentDetails.eligibility?.attendanceCategory || "Normal"}
                        </p>
                        <p className="text-[0.7rem] text-zinc-500 mt-1">
                          {studentDetails.attendanceSummary?.absencePercentage !== undefined
                            ? `${studentDetails.attendanceSummary.absencePercentage}% absences recorded`
                            : "Standard attendance range"}
                        </p>
                      </div>

                      {/* 3. Document Status */}
                      <div className="p-3 rounded-lg bg-zinc-50 border border-zinc-200">
                        <span className="text-[0.65rem] font-bold text-zinc-500 uppercase block">Document Status</span>
                        <p className="text-sm font-bold text-zinc-900 mt-0.5">
                          {studentDetails.documentStatus || studentDetails.eligibility?.documentCategory || "Complete"}
                        </p>
                        <p className="text-[0.7rem] text-zinc-500 mt-1">
                          {studentDetails.completeness?.hasSf9 && studentDetails.completeness?.hasSf10
                            ? "Complete (SF9, SF10)"
                            : "Incomplete document set"}
                        </p>
                      </div>
                    </div>

                    {/* Taglish Advisory Guidance */}
                    {studentDetails.taglishAdvisory && (
                      <div className="p-3 rounded-lg bg-purple-50 border border-purple-200 text-purple-900 text-xs">
                        <span className="font-bold block mb-0.5">Taglish Principal Advisory:</span>
                        <span>{studentDetails.taglishAdvisory}</span>
                      </div>
                    )}
                  </div>

                  {/* Phase 5: Cross-Document Identity Comparison Banner */}
                  <div className={`p-4 rounded-lg border ${
                    studentDetails.identityComparison?.overallStatus === "IDENTITY_REVIEW_REQUIRED"
                      ? "bg-purple-50 border-purple-200 text-purple-900"
                      : "bg-emerald-50 border-emerald-200 text-emerald-900"
                  }`}>
                    <div className="flex items-start gap-2.5">
                      {studentDetails.identityComparison?.overallStatus === "IDENTITY_REVIEW_REQUIRED" ? (
                        <AlertCircle className="h-5 w-5 text-[#174EA6] shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold uppercase tracking-wider">
                            Cross-Document Identity Verification (SF9 vs SF10)
                          </h4>
                          <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded ${
                            studentDetails.identityComparison?.overallStatus === "IDENTITY_REVIEW_REQUIRED"
                              ? "bg-purple-200 text-purple-900"
                              : "bg-emerald-200 text-emerald-900"
                          }`}>
                            {studentDetails.identityComparison?.overallStatus === "IDENTITY_REVIEW_REQUIRED"
                              ? "IDENTITY REVIEW REQUIRED"
                              : "MATCH VERIFIED"}
                          </span>
                        </div>
                        <p className="text-xs mt-1">
                          {studentDetails.identityComparison?.summaryMessage}
                        </p>
                        {studentDetails.identityComparison?.discrepancies?.length > 0 && (
                          <div className="mt-2.5 space-y-1">
                            {studentDetails.identityComparison.discrepancies.map((disc: string, idx: number) => (
                              <div key={idx} className="text-xs flex items-center gap-1.5 font-medium text-purple-800">
                                <span className="h-1.5 w-1.5 rounded-full bg-[#174EA6]" />
                                <span>{disc}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Phase 2: Complete Original Scanned Documents */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-wider flex items-center gap-1.5">
                        <FileCheck className="h-4 w-4 text-[#174EA6]" />
                        <span>Attached Original Scanned Documents ({studentDetails.documents?.length || 0})</span>
                      </h4>
                      <span className="text-[0.65rem] text-zinc-500">
                        Complete Original Files &bull; Private Supabase Storage
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {["sf9", "sf10"].map((docKey) => {
                        const doc = studentDetails.documents?.find((d: any) => d.rawType === docKey);

                        const docTitle = docKey === "sf9" ? "Old SHS SF9 (Report Card)" : "Old SHS SF10 (Permanent Record)";

                        return (
                          <div key={docKey} className="p-3 rounded-lg border border-zinc-200 bg-zinc-50 flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-zinc-800">{docTitle}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[0.65rem] font-bold ${
                                  doc ? (doc.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800") : "bg-zinc-200 text-zinc-500"
                                }`}>
                                  {doc ? doc.status : "Missing"}
                                </span>
                              </div>
                              <p className="text-[0.7rem] text-zinc-500 mt-1">
                                {doc ? `S.Y. ${doc.schoolYear}` : "Not uploaded to student file"}
                              </p>
                            </div>

                            <div className="mt-3 pt-2 border-t border-zinc-200">
                              {doc?.originalImageUrl ? (
                                <a
                                  href={doc.originalImageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md text-white bg-[#174EA6] hover:bg-[#0B1F33] transition-colors"
                                >
                                  <span>View Original File</span>
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="block text-center text-[0.7rem] text-zinc-400 py-1">
                                  No file stored
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Phase 7: Verified Subject Grades Table */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-wider">
                        Verified Subject Grades
                      </h4>
                      <span className="text-[0.65rem] text-zinc-500">Official Database Records &bull; Passing Mark: 75</span>
                    </div>

                    {studentDetails.grades && studentDetails.grades.length > 0 ? (
                      <div className="border border-zinc-200 rounded-md overflow-hidden">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
                            <tr>
                              <th className="py-2 px-3">Subject</th>
                              <th className="py-2 px-2 text-center">Semester</th>
                              <th className="py-2 px-2 text-center">Q1</th>
                              <th className="py-2 px-2 text-center">Q2</th>
                              <th className="py-2 px-2 text-center">Final</th>
                              <th className="py-2 px-3 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-200">
                            {studentDetails.grades.map((g: any, i: number) => (
                              <tr key={i} className="hover:bg-zinc-50/50">
                                <td className="py-2 px-3 font-medium text-zinc-800">{g.subject}</td>
                                <td className="py-2 px-2 text-center text-zinc-600">{g.semester || "-"}</td>
                                <td className="py-2 px-2 text-center text-zinc-600">{g.q1 ?? "-"}</td>
                                <td className="py-2 px-2 text-center text-zinc-600">{g.q2 ?? "-"}</td>
                                <td className="py-2 px-2 text-center font-bold text-zinc-900">{g.final_grade ?? g.finalGrade ?? "-"}</td>
                                <td className="py-2 px-3 text-right">
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
                      </div>
                    ) : (
                      <div className="p-4 rounded-md bg-zinc-50 border border-zinc-200 text-center text-xs text-zinc-500">
                        No official subject grades are attached to this record yet.
                      </div>
                    )}
                  </div>

                  {/* Phase 7 & 8: DepEd Academic Eligibility Assessment */}
                  <div className="p-4 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                      <div>
                        <span className="text-xs font-bold text-zinc-900 uppercase">
                          DepEd Academic Eligibility Assessment
                        </span>
                        <p className="text-[0.7rem] text-zinc-500">
                          {studentDetails.eligibility?.eligibilityType} &bull; S.Y. {studentDetails.student.schoolYear || "N/A"}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                        studentDetails.eligibility?.status === "Eligible"
                          ? "bg-emerald-100 text-emerald-800"
                          : studentDetails.eligibility?.status === "Not Eligible"
                          ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                      }`}>
                        {studentDetails.eligibility?.status === "Eligible" ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : studentDetails.eligibility?.status === "Not Eligible" ? (
                          <XCircle className="h-3.5 w-3.5" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        )}
                        {studentDetails.eligibility?.status}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      {studentDetails.eligibility?.reasons?.map((reason: string, idx: number) => (
                        <p key={idx} className="text-xs text-zinc-700 flex items-center gap-1.5">
                          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span>{reason}</span>
                        </p>
                      ))}

                      {studentDetails.eligibility?.blockingFactors?.map((factor: string, idx: number) => (
                        <p key={idx} className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <span>{factor}</span>
                        </p>
                      ))}
                    </div>

                    {/* Invariant Note */}
                    <div className="mt-3 pt-2 border-t border-zinc-200 text-[0.7rem] text-zinc-500 italic">
                      DepEd Policy Note: Missing required documents places eligibility on hold (Needs Review); academic failure is strictly reserved for failing grades (&lt;75).
                    </div>
                  </div>

                  {/* Phase 8: Principal Eligibility Approval Workflow */}
                  <div className="p-4 rounded-lg border border-purple-200 bg-purple-50/40">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-[#174EA6]" />
                        <h4 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">
                          Principal Eligibility Decision Action
                        </h4>
                      </div>
                      <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded ${
                        studentDetails.eligibility?.approvalDecision === "Approved"
                          ? "bg-emerald-100 text-emerald-800"
                          : studentDetails.eligibility?.approvalDecision === "Not Approved"
                          ? "bg-red-100 text-red-800"
                          : "bg-zinc-200 text-zinc-700"
                      }`}>
                        Decision: {studentDetails.eligibility?.approvalDecision || "Pending"}
                      </span>
                    </div>

                    {/* Existing Approval details */}
                    {studentDetails.approvalRecord && (
                      <div className="p-2.5 rounded bg-white border border-purple-100 text-xs text-zinc-700 mb-3">
                        <p className="font-semibold text-zinc-900">
                          Current Official Decision: {studentDetails.approvalRecord.decision}
                        </p>
                        <p className="text-[0.7rem] text-zinc-500 mt-0.5">
                          Action recorded at: {new Date(studentDetails.approvalRecord.approved_at).toLocaleString()}
                        </p>
                        {studentDetails.approvalRecord.remarks && (
                          <p className="text-[0.7rem] text-zinc-600 mt-1 italic">
                            Remarks: &ldquo;{studentDetails.approvalRecord.remarks}&rdquo;
                          </p>
                        )}
                      </div>
                    )}

                    {/* Action Alert message */}
                    {actionMessage && (
                      <div className={`p-2.5 rounded text-xs mb-3 ${
                        actionMessage.type === "success" 
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-red-100 text-red-800 border border-red-300"
                      }`}>
                        {actionMessage.text}
                      </div>
                    )}

                    {/* Remarks Input */}
                    <div className="mb-3">
                      <label className="block text-[0.7rem] font-medium text-zinc-700 mb-1">
                        Principal Remarks / Confirmation Notes (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Verified against physical records and confirmed eligible for progression..."
                        value={approvalRemarks}
                        onChange={(e) => setApprovalRemarks(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#174EA6]"
                      />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row items-center gap-2">
                      <button
                        onClick={() => handleExecuteApproval("Approved")}
                        disabled={isSubmittingApproval || !studentDetails.eligibility?.canPrincipalApprove}
                        className={`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md shadow-xs transition-colors ${
                          studentDetails.eligibility?.canPrincipalApprove
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                            : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
                        }`}
                        title={
                          !studentDetails.eligibility?.canPrincipalApprove
                            ? `Approval locked: ${studentDetails.eligibility?.blockingFactors?.join("; ") || "Incomplete requirements"}`
                            : "Confirm eligibility approval"
                        }
                      >
                        <Check className="h-4 w-4" />
                        <span>Approve Eligibility</span>
                      </button>

                      <button
                        onClick={() => handleExecuteApproval("Not Approved")}
                        disabled={isSubmittingApproval}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-white border border-red-200 text-red-700 hover:bg-red-50 transition-colors shadow-xs"
                      >
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span>Disapprove / Reject</span>
                      </button>

                      {!studentDetails.eligibility?.canPrincipalApprove && (
                        <p className="text-[0.7rem] text-amber-700 sm:ml-2">
                          <Lock className="h-3 w-3 inline mr-1" />
                          Principal approval is locked until all required documents and criteria are met.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-red-500">
                  Unable to load student profile details.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between p-4 border-t border-zinc-200 bg-zinc-50">
              <button
                onClick={() => handleOpenDigitalRecord(studentDetails)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-white bg-[#174EA6] hover:bg-[#0B1F33] transition-colors shadow-xs"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Open Digital Academic Record</span>
              </button>

              <button
                onClick={handleCloseModal}
                className="px-4 py-1.5 text-xs font-semibold rounded-md bg-zinc-200 text-zinc-800 hover:bg-zinc-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Digital Academic Record Modal */}
      {digitalRecordStudent && (
        <DigitalAcademicRecordModal
          student={digitalRecordStudent}
          onClose={() => setDigitalRecordStudent(null)}
        />
      )}
    </PageContainer>
  );
}

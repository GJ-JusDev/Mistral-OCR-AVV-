"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import ShsConsolidatedValidationHub from "@/components/validation/ShsConsolidatedValidationHub";
import {
  buildPersistedValidationUrl,
  chooseInitialStudentAcademicContext,
  getStudentAcademicContexts,
  type StudentAcademicContext,
} from "@/lib/validation/studentValidationContext";
import {
  ArrowLeft,
  GraduationCap,
  FileText,
  ShieldCheck,
  Calendar,
  Layers,
  Award,
  Users,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
} from "lucide-react";

export default function StudentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.id as string;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFullLrn, setShowFullLrn] = useState(false);
  const [activeTab, setActiveTab] = useState<"validation" | "documents" | "grades">("validation");
  const [selectedValidationContext, setSelectedValidationContext] = useState<StudentAcademicContext | null>(null);
  const [validationLoadError, setValidationLoadError] = useState<string | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);

  const fetchValidationData = async (context: StudentAcademicContext) => {
    const res = await fetch(buildPersistedValidationUrl(studentId, context));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to load persisted validation results.");
    }
    return res.json();
  };

  const refreshValidationData = async () => {
    if (!selectedValidationContext) return;
    const validationData = await fetchValidationData(selectedValidationContext);
    setData((current: any) =>
      current
        ? {
            ...current,
            validationRecord: validationData.consolidated,
            validationMatrix: validationData.matrix,
            validationDiscrepancies: validationData.discrepancies,
          }
        : current
    );
  };

  const fetchStudentData = async () => {
    try {
      const res = await fetch(`/api/students/${studentId}`);
      if (!res.ok) throw new Error("Failed to load student details");
      const json = await res.json();
      setData(json);
      const contexts = getStudentAcademicContexts(json.enrollments, json.cross_document_validations);
      setSelectedValidationContext(chooseInitialStudentAcademicContext(json.enrollments, contexts));
    } catch (err: any) {
      setError(err.message || "Failed to load student");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!studentId) return;
    fetchStudentData();
  }, [studentId]);

  useEffect(() => {
    if (!studentId || !selectedValidationContext) {
      setValidationLoading(false);
      return;
    }
    let active = true;
    setValidationLoadError(null);
    setValidationLoading(true);
    setData((current: any) => current ? {
      ...current,
      validationRecord: null,
      validationMatrix: [],
      validationDiscrepancies: [],
    } : current);
    fetchValidationData(selectedValidationContext)
      .then((validationData) => {
        if (!active) return;
        setData((current: any) => current ? {
          ...current,
          validationRecord: validationData.consolidated,
          validationMatrix: validationData.matrix,
          validationDiscrepancies: validationData.discrepancies,
        } : current);
      })
      .catch((err: any) => {
        if (active) setValidationLoadError(err.message || "Failed to load persisted validation results.");
      })
      .finally(() => {
        if (active) setValidationLoading(false);
      });
    return () => { active = false; };
  }, [studentId, selectedValidationContext?.schoolYear, selectedValidationContext?.gradeLevel, selectedValidationContext?.section]);

  if (loading) {
    return (
      <PageContainer>
        <Header title="Student Profile" />
        <div className="flex flex-col items-center justify-center p-16">
          <LoadingSpinner size="lg" />
          <p className="mt-3 text-xs text-zinc-500">Loading Senior High School learner profile...</p>
        </div>
      </PageContainer>
    );
  }

  if (error || !data?.student) {
    return (
      <PageContainer>
        <Header title="Student Profile" />
        <div className="mt-6 p-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl text-red-700 dark:text-red-300">
          <p className="font-semibold">{error || "Student not found."}</p>
          <button
            onClick={() => router.push("/students")}
            className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Directory
          </button>
        </div>
      </PageContainer>
    );
  }

  const { student, documents = [], rosters = {}, grades = [], attendance = [] } = data;
  const validationContexts = getStudentAcademicContexts(data.enrollments, data.cross_document_validations);
  const selectedContextValue = selectedValidationContext
    ? `${selectedValidationContext.schoolYear}|${selectedValidationContext.gradeLevel}|${selectedValidationContext.section || ""}`
    : "";
  const selectedEnrollment = selectedValidationContext
    ? (data.enrollments || []).find((row: any) =>
        String(row.school_year) === selectedValidationContext.schoolYear &&
        String(row.grade_level) === selectedValidationContext.gradeLevel &&
        (row.section || "") === (selectedValidationContext.section || "")
      )
    : null;
  const fullName = `${student.last_name}, ${student.first_name} ${student.middle_name || ""}${student.suffix ? " " + student.suffix : ""}`.trim();
  const maskedLrn = student.lrn ? `${student.lrn.slice(0, 4)}••••${student.lrn.slice(-4)}` : "—";
  const displayLrn = showFullLrn ? student.lrn : maskedLrn;

  return (
    <PageContainer>
      <div className="mb-4">
        <Link
          href="/students"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Student Directory</span>
        </Link>
      </div>

      <Header
        title={fullName}
        description={`DepEd TRIS Senior High School • School ID 500169`}
      />

      {/* Student Profile Card */}
      <div className="mt-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-950/60 rounded-xl text-blue-700 dark:text-blue-300 shrink-0">
              <GraduationCap className="w-8 h-8" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{fullName}</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  {student.grade_level || "SHS Learner"}
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {student.sex === "M" ? "Male" : student.sex === "F" ? "Female" : student.sex || "—"}
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Taysan Resettlement Integrated School • Division of Batangas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Learner Reference Number
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700">
                  {displayLrn}
                </span>
                <button
                  type="button"
                  onClick={() => setShowFullLrn(!showFullLrn)}
                  className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded"
                  title={showFullLrn ? "Mask LRN" : "Reveal full LRN"}
                >
                  {showFullLrn ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Context Bar */}
        <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-zinc-400 block font-medium">Assigned Track/Strand:</span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {student.strand || "Academic / TVL"}
            </span>
          </div>
          <div>
            <span className="text-zinc-400 block font-medium">Current Section:</span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {student.section || "—"}
            </span>
          </div>
          <div>
            <span className="text-zinc-400 block font-medium">Civil Identity Document:</span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1">
              {rosters.psa && rosters.psa.length > 0 ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>PSA Attached</span>
                </>
              ) : (
                <span className="text-zinc-400 font-normal">Optional / None</span>
              )}
            </span>
          </div>
          <div>
            <span className="text-zinc-400 block font-medium">Direct Documents:</span>
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {documents.length} recorded
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-8 border-b border-zinc-200 dark:border-zinc-800">
        <nav className="flex space-x-6 text-sm font-medium">
          <button
            onClick={() => setActiveTab("validation")}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === "validation"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>360° Consolidated Validation Hub</span>
          </button>
          <button
            onClick={() => setActiveTab("documents")}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === "documents"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Official SHS Documents ({documents.length + (rosters.sf1?.length || 0) + (rosters.sf2?.length || 0) + (rosters.sf5?.length || 0)})</span>
          </button>
          <button
            onClick={() => setActiveTab("grades")}
            className={`pb-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === "grades"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Subject Grades & Attendance ({grades.length})</span>
          </button>
        </nav>
      </div>

      {/* Tab 1: 360° Consolidated Validation Hub */}
      {activeTab === "validation" && (
        <div className="mt-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label htmlFor="validation-context" className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              Academic context
            </label>
            <select
              id="validation-context"
              value={selectedContextValue}
              onChange={(event) => {
                const context = validationContexts.find((item) =>
                  `${item.schoolYear}|${item.gradeLevel}|${item.section || ""}` === event.target.value
                );
                setData((current: any) => current ? {
                  ...current,
                  validationRecord: null,
                  validationMatrix: [],
                  validationDiscrepancies: [],
                } : current);
                setSelectedValidationContext(context || null);
              }}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs"
            >
              <option value="">Select a school-year context</option>
              {validationContexts.map((context) => (
                <option
                  key={`${context.schoolYear}|${context.gradeLevel}`}
                  value={`${context.schoolYear}|${context.gradeLevel}|${context.section || ""}`}
                >
                  {context.schoolYear} — {context.gradeLevel}{context.section ? ` — ${context.section}` : ""}
                </option>
              ))}
            </select>
            {validationLoadError && (
              <span className="text-xs text-rose-600" role="alert">{validationLoadError}</span>
            )}
          </div>
          <ShsConsolidatedValidationHub
            student={{
              id: student.id,
              lrn: student.lrn,
              first_name: student.first_name,
              middle_name: student.middle_name,
              last_name: student.last_name,
              suffix: student.suffix,
              grade_level: selectedValidationContext?.gradeLevel || student.grade_level,
              section: selectedValidationContext?.section || selectedEnrollment?.section || student.section,
              strand: student.strand,
            }}
            schoolYear={selectedValidationContext?.schoolYear || ""}
            gradeLevel={selectedValidationContext?.gradeLevel || student.grade_level}
            section={selectedValidationContext?.section || selectedEnrollment?.section || student.section}
            initialValidationRecord={data.validationRecord}
            initialMatrix={data.validationMatrix}
            initialError={validationLoadError}
            initialLoading={validationLoading}
            onRefreshValidation={refreshValidationData}
          />
        </div>
      )}

      {/* Tab 2: Linked Documents & Multi-Learner Roster Linkages */}
      {activeTab === "documents" && (
        <div className="mt-6 space-y-6">
          {/* Direct Documents (SF9, SF10, PSA) */}
          <div>
            <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider mb-3">
              Direct Uploaded Academic & Identity Documents
            </h3>
            {documents.length === 0 ? (
              <p className="text-xs text-zinc-500 italic p-4 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg">
                No direct single-learner documents uploaded yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {documents.map((doc: any) => (
                  <div
                    key={doc.id}
                    className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xs flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                          {doc.document_type}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            doc.status === "approved"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : doc.status === "rejected"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}
                        >
                          {doc.status}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {doc.original_filename || "Document"}
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        S.Y. {doc.school_year || "—"} • {doc.grade_level || "Grade 11"}
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:hover:text-blue-400 inline-flex items-center gap-1"
                      >
                        <FileText className="w-3.5 h-3.5" /> View Scanned Record
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Multi-Learner Roster Linkages (SF1, SF2, SF5) */}
          <div>
            <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider mb-3">
              Multi-Learner Section Roster Entries (SF1, SF2, SF5)
            </h3>
            <div className="space-y-3">
              {rosters.sf1 && rosters.sf1.length > 0 && (
                <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
                      SF1 School Register Entry
                    </span>
                    <span className="text-xs text-zinc-400">
                      Enrolled: {rosters.sf1[0].track} - {rosters.sf1[0].strand}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>Section: <strong>{rosters.sf1[0].section || "—"}</strong></div>
                    <div>Semester: <strong>{rosters.sf1[0].semester || "1st Sem"}</strong></div>
                    <div>Status: <span className="font-semibold text-emerald-600">{rosters.sf1[0].review_status || "VERIFIED"}</span></div>
                    <div>
                      {rosters.sf1[0].documents?.id && (
                        <Link href={`/documents/${rosters.sf1[0].documents.id}`} className="text-blue-600 underline">
                          View SF1 Roster
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {rosters.sf2 && rosters.sf2.length > 0 && (
                <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300">
                      SF2 Attendance Register Entry
                    </span>
                    <span className="text-xs text-zinc-400">
                      Month: {rosters.sf2[0].month || "—"}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>Days Present: <strong>{rosters.sf2[0].days_present ?? rosters.sf2[0].total_days_present ?? "—"}</strong></div>
                    <div>Days Absent: <strong>{rosters.sf2[0].days_absent ?? rosters.sf2[0].total_days_absent ?? "—"}</strong></div>
                    <div>Status: <span className="font-semibold text-emerald-600">{rosters.sf2[0].review_status || "VERIFIED"}</span></div>
                    <div>
                      {rosters.sf2[0].documents?.id && (
                        <Link href={`/documents/${rosters.sf2[0].documents.id}`} className="text-blue-600 underline">
                          View SF2 Roster
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {rosters.sf5 && rosters.sf5.length > 0 && (
                <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                      SF5 End-of-Semester Status Entry ({rosters.sf5[0].form_variant || "SF5A-SHS"})
                    </span>
                    <span className="text-xs text-zinc-400">
                      Status: {rosters.sf5[0].action_taken}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>Action Taken: <strong className={rosters.sf5[0].action_taken === "COMPLETE" ? "text-emerald-600" : "text-amber-600"}>{rosters.sf5[0].action_taken}</strong></div>
                    <div>Proficiency: <strong>{rosters.sf5[0].proficiency_level || "—"}</strong></div>
                    <div>Incomplete Subjects: <strong>{rosters.sf5[0].incomplete_subjects?.length || 0}</strong></div>
                    <div>
                      {rosters.sf5[0].documents?.id && (
                        <Link href={`/documents/${rosters.sf5[0].documents.id}`} className="text-blue-600 underline">
                          View SF5 Roster
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Subject Grades & Attendance */}
      {activeTab === "grades" && (
        <div className="mt-6 space-y-6">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
                Official Subject Grades
              </h3>
              <span className="text-xs text-zinc-500 font-medium">
                {grades.length} Subjects Evaluated
              </span>
            </div>
            {grades.length === 0 ? (
              <p className="text-xs text-zinc-500 italic p-6 text-center">
                No subject grades have been recorded yet. Grades will populate upon approving verified SF9 / SF10 records.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800 text-left text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/40 text-zinc-600 dark:text-zinc-400 font-semibold uppercase">
                    <tr>
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-3 py-3 text-center">Sem</th>
                      <th className="px-3 py-3 text-center">Q1</th>
                      <th className="px-3 py-3 text-center">Q2</th>
                      <th className="px-3 py-3 text-center">Final</th>
                      <th className="px-3 py-3 text-center">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-medium">
                    {grades.map((g: any) => (
                      <tr key={g.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                        <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">{g.subject}</td>
                        <td className="px-3 py-3 text-center text-zinc-500">{g.semester || "1st"}</td>
                        <td className="px-3 py-3 text-center font-mono">{g.q1 ?? "—"}</td>
                        <td className="px-3 py-3 text-center font-mono">{g.q2 ?? "—"}</td>
                        <td className="px-3 py-3 text-center font-mono font-bold">{g.final_grade ?? "—"}</td>
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              g.status === "Passed"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : g.status === "Failed"
                                ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            }`}
                          >
                            {g.status || "Evaluated"}
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
      )}
    </PageContainer>
  );
}

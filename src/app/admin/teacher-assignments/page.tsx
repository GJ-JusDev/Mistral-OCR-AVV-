"use client";

import React, { useEffect, useState, useCallback } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  UserCheck,
  Plus,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Power,
  RefreshCw,
} from "lucide-react";
import type { TeacherAssignmentRecord } from "@/lib/teacher/assignments";

interface TeacherOption {
  user_id: string;
  full_name: string;
  email: string | null;
  account_status: string;
}

interface ConflictRow {
  id: string;
  document_id: string | null;
  conflict_type: string;
  extracted_lrn: string | null;
  extracted_name: string | null;
  existing_student_id: string | null;
  expected_context: Record<string, any>;
  extracted_context: Record<string, any>;
  status: "pending" | "resolved" | "dismissed";
  resolution_notes: string | null;
  created_at: string;
}

export default function AdminTeacherAssignmentsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignmentRecord[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);

  // Form state
  const [teacherUserId, setTeacherUserId] = useState("");
  const [schoolYear, setSchoolYear] = useState("2025-2026");
  const [gradeLevel, setGradeLevel] = useState<"Grade 11" | "Grade 12">("Grade 11");
  const [section, setSection] = useState("");
  const [strandOrTrack, setStrandOrTrack] = useState("STEM");
  const [assignmentType, setAssignmentType] = useState<"class_adviser" | "subject_teacher">("class_adviser");
  const [subjectTaught, setSubjectTaught] = useState("");
  const [semester, setSemester] = useState<string>("1st Semester");
  const [assignmentStatus, setAssignmentStatus] = useState<"active" | "inactive">("active");
  const [submitting, setSubmitting] = useState(false);

  // Conflict resolution notes per conflict row
  const [resolutionNotesMap, setResolutionNotesMap] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/assignments");
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to load assignments.");
      }
      setTeachers(json.teachers || []);
      setAssignments(json.assignments || []);
      setConflicts(json.conflicts || []);
      if (!teacherUserId && json.teachers?.length > 0) {
        setTeacherUserId(json.teachers[0].user_id);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load assignments.");
    } finally {
      setLoading(false);
    }
  }, [teacherUserId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacher_user_id: teacherUserId,
          school_year: schoolYear,
          grade_level: gradeLevel,
          section,
          strand_or_track: strandOrTrack || null,
          assignment_type: assignmentType,
          subject_taught: assignmentType === "subject_teacher" ? subjectTaught : null,
          semester: assignmentType === "subject_teacher" ? semester : null,
          assignment_status: assignmentStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to create assignment.");
      }
      setStatusMessage("Teacher assignment created successfully.");
      setSection("");
      if (assignmentType === "subject_teacher") setSubjectTaught("");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not create assignment.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleAssignmentStatus = async (row: TeacherAssignmentRecord) => {
    const nextStatus = row.assignment_status === "active" ? "inactive" : "active";
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, assignment_status: nextStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Status update failed.");
      setStatusMessage(`Assignment updated to ${nextStatus}.`);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not update assignment status.");
    }
  };

  const handleResolveConflict = async (
    conflictId: string,
    resolutionStatus: "resolved" | "dismissed"
  ) => {
    setError(null);
    setStatusMessage(null);
    try {
      const notes = resolutionNotesMap[conflictId] || `Marked ${resolutionStatus} by administrator.`;
      const res = await fetch("/api/admin/conflicts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conflictId,
          resolutionStatus,
          resolutionNotes: notes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Conflict resolution failed.");
      setStatusMessage(`Quarantined conflict marked ${resolutionStatus}.`);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not resolve conflict.");
    }
  };

  return (
    <PageContainer>
      <Header
        title="Teacher Assignments & Section Controls"
        description="Assign verified teachers to Advisory Classes and Subject Sections, control scanning policy, and resolve quarantined identity or section conflicts."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Admin", href: "/admin/users" },
          { label: "Teacher Assignments" },
        ]}
        actions={
          <Button
            size="sm"
            variant="outline"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={loadData}
          >
            Refresh
          </Button>
        }
      />

      <div aria-live="polite" className="mt-4 space-y-2">
        {error && (
          <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {statusMessage && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Enforced Scanning Permission Policy Notice */}
          <Card className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-[#174EA6] mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Class Adviser-Only OCR &amp; Scanning Policy
                  </h2>
                  <p className="text-sm text-slate-600">
                    Only officially assigned and active Class Advisers may scan SF9/SF10 documents and perform OCR extraction
                    for their assigned advisory section. Subject Teacher scanning is permanently disabled; Subject Teachers retain
                    authorized subject grade viewing and editing permissions only.
                  </p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                Class Adviser-Only Enforced
              </span>
            </div>
          </Card>

          {/* Create Teacher Assignment Form */}
          <Card className="p-6">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-4">
              <UserCheck className="h-5 w-5 text-[#174EA6]" />
              Assign Teacher Role & Class Section
            </h2>

            <form onSubmit={handleCreateAssignment} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label htmlFor="ta-teacher" className="block text-xs font-semibold text-slate-700 mb-1">
                  Teacher Account
                </label>
                <select
                  id="ta-teacher"
                  required
                  value={teacherUserId}
                  onChange={(e) => setTeacherUserId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  {teachers.length === 0 && <option value="">No teachers in school</option>}
                  {teachers.map((t) => (
                    <option key={t.user_id} value={t.user_id}>
                      {t.full_name} ({t.account_status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="ta-type" className="block text-xs font-semibold text-slate-700 mb-1">
                  Assignment Type
                </label>
                <select
                  id="ta-type"
                  required
                  value={assignmentType}
                  onChange={(e) =>
                    setAssignmentType(e.target.value as "class_adviser" | "subject_teacher")
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="class_adviser">Class Adviser</option>
                  <option value="subject_teacher">Subject Teacher</option>
                </select>
              </div>

              <div>
                <label htmlFor="ta-sy" className="block text-xs font-semibold text-slate-700 mb-1">
                  School Year
                </label>
                <input
                  id="ta-sy"
                  type="text"
                  required
                  pattern="\d{4}\s*-\s*\d{4}"
                  placeholder="2025-2026"
                  value={schoolYear}
                  onChange={(e) => setSchoolYear(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label htmlFor="ta-grade" className="block text-xs font-semibold text-slate-700 mb-1">
                  Grade Level
                </label>
                <select
                  id="ta-grade"
                  required
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(e.target.value as "Grade 11" | "Grade 12")}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="Grade 11">Grade 11</option>
                  <option value="Grade 12">Grade 12</option>
                </select>
              </div>

              <div>
                <label htmlFor="ta-section" className="block text-xs font-semibold text-slate-700 mb-1">
                  Section
                </label>
                <input
                  id="ta-section"
                  type="text"
                  required
                  placeholder="e.g., Newton"
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label htmlFor="ta-strand" className="block text-xs font-semibold text-slate-700 mb-1">
                  Strand / Track (when applicable)
                </label>
                <input
                  id="ta-strand"
                  type="text"
                  placeholder="e.g., STEM, ABM, HUMSS, TVL-ICT"
                  value={strandOrTrack}
                  onChange={(e) => setStrandOrTrack(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>

              {assignmentType === "subject_teacher" && (
                <>
                  <div>
                    <label htmlFor="ta-subject" className="block text-xs font-semibold text-slate-700 mb-1">
                      Subject Taught
                    </label>
                    <input
                      id="ta-subject"
                      type="text"
                      required
                      placeholder="e.g., General Mathematics"
                      value={subjectTaught}
                      onChange={(e) => setSubjectTaught(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label htmlFor="ta-semester" className="block text-xs font-semibold text-slate-700 mb-1">
                      Semester
                    </label>
                    <select
                      id="ta-semester"
                      value={semester}
                      onChange={(e) => setSemester(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="1st Semester">1st Semester</option>
                      <option value="2nd Semester">2nd Semester</option>
                      <option value="Full Year">Full Year</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label htmlFor="ta-status" className="block text-xs font-semibold text-slate-700 mb-1">
                  Assignment Status
                </label>
                <select
                  id="ta-status"
                  value={assignmentStatus}
                  onChange={(e) => setAssignmentStatus(e.target.value as "active" | "inactive")}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="md:col-span-2 lg:col-span-4 flex justify-end pt-2">
                <Button
                  type="submit"
                  disabled={submitting || !teacherUserId}
                  leftIcon={<Plus className="h-4 w-4" />}
                  className="bg-[#174EA6] hover:bg-[#0B1F33] text-white"
                >
                  {submitting ? "Saving Assignment..." : "Assign Teacher"}
                </Button>
              </div>
            </form>
          </Card>

          {/* Existing Teacher Assignments Table */}
          <Card className="p-6 overflow-x-auto">
            <h2 className="text-base font-bold text-slate-900 mb-4">
              Configured Teacher Assignments ({assignments.length})
            </h2>
            <table className="min-w-full text-left text-sm border-collapse">
              <caption className="sr-only">Administrator-controlled teacher assignments</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th scope="col" className="py-2.5 pr-4">Teacher</th>
                  <th scope="col" className="py-2.5 pr-4">Role</th>
                  <th scope="col" className="py-2.5 pr-4">School Year</th>
                  <th scope="col" className="py-2.5 pr-4">Grade & Section</th>
                  <th scope="col" className="py-2.5 pr-4">Strand</th>
                  <th scope="col" className="py-2.5 pr-4">Subject / Sem</th>
                  <th scope="col" className="py-2.5 pr-4">Status</th>
                  <th scope="col" className="py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {assignments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No teacher assignments configured yet.
                    </td>
                  </tr>
                ) : (
                  assignments.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="py-3 pr-4 font-medium text-slate-900">
                        {a.teacher_name || a.teacher_user_id.slice(0, 8)}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            a.assignment_type === "class_adviser"
                              ? "bg-indigo-100 text-indigo-800"
                              : "bg-sky-100 text-sky-800"
                          }`}
                        >
                          {a.assignment_type === "class_adviser" ? "Class Adviser" : "Subject Teacher"}
                        </span>
                      </td>
                      <td className="py-3 pr-4">{a.school_year}</td>
                      <td className="py-3 pr-4 font-medium">
                        {a.grade_level} — {a.section}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">{a.strand_or_track || "—"}</td>
                      <td className="py-3 pr-4 text-slate-700">
                        {a.subject_taught ? `${a.subject_taught}${a.semester ? ` (${a.semester})` : ""}` : "All Advisory Subjects"}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            a.assignment_status === "active"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {a.assignment_status === "active" ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => handleToggleAssignmentStatus(a)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <Power className="h-3.5 w-3.5" />
                          {a.assignment_status === "active" ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>

          {/* Quarantined Identity & Section Conflicts */}
          <Card className="p-6 overflow-x-auto">
            <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Quarantined Identity & Section Conflicts ({conflicts.filter((c) => c.status === "pending").length} Pending)
            </h2>
            <table className="min-w-full text-left text-sm border-collapse">
              <caption className="sr-only">Quarantined identity and section conflicts awaiting resolution</caption>
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th scope="col" className="py-2.5 pr-4">Conflict Type</th>
                  <th scope="col" className="py-2.5 pr-4">Extracted Student / LRN</th>
                  <th scope="col" className="py-2.5 pr-4">Context</th>
                  <th scope="col" className="py-2.5 pr-4">Status</th>
                  <th scope="col" className="py-2.5">Resolution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {conflicts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No identity or section conflicts quarantined.
                    </td>
                  </tr>
                ) : (
                  conflicts.map((c) => (
                    <tr key={c.id}>
                      <td className="py-3 pr-4 font-mono text-xs font-semibold text-amber-800">
                        {c.conflict_type}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-medium text-slate-900">{c.extracted_name || "Unknown"}</div>
                        <div className="text-xs text-slate-500">LRN: {c.extracted_lrn || "None"}</div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-600">
                        <div>Expected: {JSON.stringify(c.expected_context)}</div>
                        <div>Extracted: {JSON.stringify(c.extracted_context)}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            c.status === "pending"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3">
                        {c.status === "pending" ? (
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              aria-label={`Resolution notes for conflict ${c.id}`}
                              placeholder="Resolution notes"
                              value={resolutionNotesMap[c.id] || ""}
                              onChange={(e) =>
                                setResolutionNotesMap((prev) => ({ ...prev, [c.id]: e.target.value }))
                              }
                              className="rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleResolveConflict(c.id, "resolved")}
                              className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                            >
                              Resolve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResolveConflict(c.id, "dismissed")}
                              className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100"
                            >
                              Dismiss
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-600">{c.resolution_notes || "Closed"}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}

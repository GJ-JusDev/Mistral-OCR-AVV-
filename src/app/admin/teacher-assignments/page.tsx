"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
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
  Layers,
  FolderPlus,
  Edit,
  Clock,
  XCircle,
  Users,
  Check,
  X,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import type { TeacherAssignmentRecord } from "@/lib/teacher/assignments";
import type { SchoolStrandRow, SchoolSectionRow, TeacherAdvisoryRequestItem } from "@/types/database";

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

  const [activeTab, setActiveTab] = useState<"strands_sections" | "advisory_requests" | "assignments" | "conflicts">("strands_sections");

  // Core Data
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [assignments, setAssignments] = useState<TeacherAssignmentRecord[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [strands, setStrands] = useState<SchoolStrandRow[]>([]);
  const [sections, setSections] = useState<SchoolSectionRow[]>([]);
  const [teacherRequests, setTeacherRequests] = useState<TeacherAdvisoryRequestItem[]>([]);

  // Selected Strand for Master-Detail view
  const [selectedStrandId, setSelectedStrandId] = useState<string>("");

  // Modals / Inline form states
  const [showAddStrand, setShowAddStrand] = useState(false);
  const [newStrandName, setNewStrandName] = useState("");
  const [newStrandCode, setNewStrandCode] = useState("");
  const [newStrandDesc, setNewStrandDesc] = useState("");

  const [editingStrand, setEditingStrand] = useState<SchoolStrandRow | null>(null);
  const [editStrandName, setEditStrandName] = useState("");
  const [editStrandCode, setEditStrandCode] = useState("");
  const [editStrandDesc, setEditStrandDesc] = useState("");

  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionCapacity, setNewSectionCapacity] = useState(40);

  const [editingSection, setEditingSection] = useState<SchoolSectionRow | null>(null);
  const [editSectionName, setEditSectionName] = useState("");
  const [editSectionCapacity, setEditSectionCapacity] = useState(40);

  // Manual Assignment Form state
  const [teacherUserId, setTeacherUserId] = useState("");
  const [schoolYear, setSchoolYear] = useState("2025-2026");
  const [gradeLevel, setGradeLevel] = useState<"Grade 11" | "Grade 12">("Grade 11");
  const [manualStrandId, setManualStrandId] = useState("");
  const [manualSectionName, setManualSectionName] = useState("");
  const [assignmentType, setAssignmentType] = useState<"class_adviser" | "subject_teacher">("class_adviser");
  const [subjectTaught, setSubjectTaught] = useState("");
  const [semester, setSemester] = useState<string>("1st Semester");
  const [assignmentStatus, setAssignmentStatus] = useState<"active" | "inactive">("active");
  const [submittingAssignment, setSubmittingAssignment] = useState(false);

  // Advisory Request Action state
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);

  // Conflict resolution notes per conflict row
  const [resolutionNotesMap, setResolutionNotesMap] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignmentsRes, strandsRes] = await Promise.all([
        fetch("/api/admin/assignments"),
        fetch("/api/admin/strands"),
      ]);

      const [assignJson, strandsJson] = await Promise.all([
        assignmentsRes.json(),
        strandsRes.json(),
      ]);

      if (!assignmentsRes.ok) throw new Error(assignJson.error || "Failed to load assignments.");
      if (!strandsRes.ok) throw new Error(strandsJson.error || "Failed to load strands.");

      setTeachers(assignJson.teachers || []);
      setAssignments(assignJson.assignments || []);
      setConflicts(assignJson.conflicts || []);

      const loadedStrands: SchoolStrandRow[] = strandsJson.strands || [];
      const loadedSections: SchoolSectionRow[] = strandsJson.sections || [];
      setStrands(loadedStrands);
      setSections(loadedSections);
      setTeacherRequests(strandsJson.teacherRequests || []);

      if (!selectedStrandId && loadedStrands.length > 0) {
        setSelectedStrandId(loadedStrands[0].id);
      }
      if (!manualStrandId && loadedStrands.length > 0) {
        setManualStrandId(loadedStrands[0].id);
      }
      if (!teacherUserId && assignJson.teachers?.length > 0) {
        setTeacherUserId(assignJson.teachers[0].user_id);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load management data.");
    } finally {
      setLoading(false);
    }
  }, [selectedStrandId, manualStrandId, teacherUserId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  // Selected Strand object
  const currentStrand = useMemo(
    () => strands.find((s) => s.id === selectedStrandId) || strands[0] || null,
    [strands, selectedStrandId]
  );

  // Sections under current strand
  const sectionsUnderCurrentStrand = useMemo(
    () => (currentStrand ? sections.filter((s) => s.strand_id === currentStrand.id) : []),
    [sections, currentStrand]
  );

  // Map active advisers by section name
  const activeAdviserBySection = useMemo(() => {
    const map = new Map<string, TeacherAssignmentRecord>();
    for (const a of assignments) {
      if (a.assignment_type === "class_adviser" && a.assignment_status === "active") {
        map.set(a.section.trim().toLowerCase(), a);
      }
    }
    return map;
  }, [assignments]);

  // Map requests by section name
  const requestsBySection = useMemo(() => {
    const map = new Map<string, TeacherAdvisoryRequestItem[]>();
    for (const r of teacherRequests) {
      if (r.requested_section) {
        const key = r.requested_section.trim().toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(r);
      }
    }
    return map;
  }, [teacherRequests]);

  // Manual assignment: sections for selected strand
  const sectionsForManualStrand = useMemo(
    () => sections.filter((s) => s.strand_id === manualStrandId && s.is_active),
    [sections, manualStrandId]
  );

  // ---------------------------------------------------------------------------
  // Handlers: Strands
  // ---------------------------------------------------------------------------
  const handleAddStrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStrandName.trim() || !newStrandCode.trim()) return;
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/strands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newStrandName.trim(),
          code: newStrandCode.trim(),
          description: newStrandDesc.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add strand.");
      setStatusMessage(`Strand '${newStrandName}' created successfully.`);
      setNewStrandName("");
      setNewStrandCode("");
      setNewStrandDesc("");
      setShowAddStrand(false);
      await loadData();
      if (json.data?.id) setSelectedStrandId(json.data.id);
    } catch (err: any) {
      setError(err?.message || "Could not add strand.");
    }
  };

  const handleEditStrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStrand || !editStrandName.trim() || !editStrandCode.trim()) return;
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/strands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingStrand.id,
          name: editStrandName.trim(),
          code: editStrandCode.trim(),
          description: editStrandDesc.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update strand.");
      setStatusMessage(`Strand '${editStrandName}' updated successfully.`);
      setEditingStrand(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not update strand.");
    }
  };

  const handleToggleStrandActive = async (strand: SchoolStrandRow) => {
    const nextStatus = !strand.is_active;
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/strands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: strand.id,
          is_active: nextStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to toggle strand status.");
      setStatusMessage(`Strand '${strand.code}' marked ${nextStatus ? "active" : "inactive"}.`);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not toggle strand status.");
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers: Sections
  // ---------------------------------------------------------------------------
  const handleAddSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentStrand || !newSectionName.trim()) return;
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strand_id: currentStrand.id,
          name: newSectionName.trim(),
          capacity: Number(newSectionCapacity) || 40,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add section.");
      setStatusMessage(`Section '${newSectionName}' added under ${currentStrand.code}.`);
      setNewSectionName("");
      setNewSectionCapacity(40);
      setShowAddSection(false);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not add section.");
    }
  };

  const handleEditSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSection || !editSectionName.trim()) return;
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingSection.id,
          name: editSectionName.trim(),
          capacity: Number(editSectionCapacity) || 40,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update section.");
      setStatusMessage(`Section '${editSectionName}' updated successfully.`);
      setEditingSection(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not update section.");
    }
  };

  const handleToggleSectionActive = async (sec: SchoolSectionRow) => {
    const nextStatus = !sec.is_active;
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sec.id,
          is_active: nextStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to toggle section status.");
      setStatusMessage(`Section '${sec.name}' marked ${nextStatus ? "active" : "inactive"}.`);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not toggle section status.");
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers: Advisory Requests Approval / Rejection
  // ---------------------------------------------------------------------------
  const handleApproveRequest = async (item: TeacherAdvisoryRequestItem) => {
    setProcessingRequestId(item.user_id);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/advisory-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          teacher_user_id: item.user_id,
          school_year: schoolYear,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to approve request.");
      setStatusMessage(`Advisory request for ${item.full_name} (${item.requested_section}) approved successfully.`);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not approve advisory request.");
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleRejectRequest = async (item: TeacherAdvisoryRequestItem) => {
    setProcessingRequestId(item.user_id);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/admin/advisory-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          teacher_user_id: item.user_id,
          reason: "Advisory request declined by administrator.",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to reject request.");
      setStatusMessage(`Advisory request for ${item.full_name} declined.`);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not reject advisory request.");
    } finally {
      setProcessingRequestId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers: Manual Assignment & Conflicts
  // ---------------------------------------------------------------------------
  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSectionName) {
      setError("Please select an active section.");
      return;
    }
    setSubmittingAssignment(true);
    setError(null);
    setStatusMessage(null);
    try {
      const chosenStrand = strands.find((s) => s.id === manualStrandId);
      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacher_user_id: teacherUserId,
          school_year: schoolYear,
          grade_level: gradeLevel,
          section: manualSectionName,
          strand_or_track: chosenStrand?.name || null,
          assignment_type: assignmentType,
          subject_taught: assignmentType === "subject_teacher" ? subjectTaught : null,
          semester: assignmentType === "subject_teacher" ? semester : null,
          assignment_status: assignmentStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create assignment.");
      setStatusMessage("Teacher assignment created successfully.");
      setManualSectionName("");
      if (assignmentType === "subject_teacher") setSubjectTaught("");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Could not create assignment.");
    } finally {
      setSubmittingAssignment(false);
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
        title="Senior High School Strands, Sections &amp; Teacher Assignments"
        description="Configure active Senior High School strands and sections, review teacher advisory requests, control scanning permissions, and prevent assignment conflicts."
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
          <div role="alert" className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {statusMessage && (
          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
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
          {/* Navigation Sub-Tabs */}
          <div className="flex border-b border-slate-200 space-x-1 sm:space-x-4 overflow-x-auto pb-px">
            <button
              onClick={() => setActiveTab("strands_sections")}
              className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === "strands_sections"
                  ? "border-[#174EA6] text-[#174EA6]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Layers className="h-4 w-4" />
              <span>Strand &amp; Section Management</span>
              <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700">
                {strands.length} Strands &bull; {sections.length} Sections
              </span>
            </button>

            <button
              onClick={() => setActiveTab("advisory_requests")}
              className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === "advisory_requests"
                  ? "border-[#174EA6] text-[#174EA6]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Clock className="h-4 w-4" />
              <span>Teacher Advisory Requests</span>
              {teacherRequests.filter((r) => r.request_status === "Pending").length > 0 && (
                <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] bg-amber-100 text-amber-800 font-bold">
                  {teacherRequests.filter((r) => r.request_status === "Pending").length} Pending
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("assignments")}
              className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === "assignments"
                  ? "border-[#174EA6] text-[#174EA6]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <UserCheck className="h-4 w-4" />
              <span>Assignments &amp; Scanning Policy</span>
              <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700">
                {assignments.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("conflicts")}
              className={`py-3 px-4 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
                activeTab === "conflicts"
                  ? "border-[#174EA6] text-[#174EA6]"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <AlertTriangle className="h-4 w-4" />
              <span>Quarantined Conflicts</span>
              {conflicts.filter((c) => c.status === "pending").length > 0 && (
                <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] bg-red-100 text-red-800 font-bold">
                  {conflicts.filter((c) => c.status === "pending").length}
                </span>
              )}
            </button>
          </div>

          {/* =============================================================== */}
          {/* TAB 1: STRAND & SECTION MANAGEMENT (Master-Detail)             */}
          {/* =============================================================== */}
          {activeTab === "strands_sections" && (
            <div className="space-y-6">
              {/* Add Strand Card / Form */}
              {showAddStrand ? (
                <Card className="p-5 border-[#174EA6]/30 bg-slate-50/50">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <FolderPlus className="h-4 w-4 text-[#174EA6]" />
                      Add Senior High School Strand
                    </h3>
                    <Button size="sm" variant="ghost" onClick={() => setShowAddStrand(false)}>
                      Cancel
                    </Button>
                  </div>
                  <form onSubmit={handleAddStrand} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Strand Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Humanities and Social Sciences (HUMSS)"
                        value={newStrandName}
                        onChange={(e) => setNewStrandName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Strand Code <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. HUMSS"
                        value={newStrandCode}
                        onChange={(e) => setNewStrandCode(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Description (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Senior High School Academic Track"
                        value={newStrandDesc}
                        onChange={(e) => setNewStrandDesc(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div className="sm:col-span-3 flex justify-end">
                      <Button type="submit" size="sm" className="bg-[#174EA6] text-white">
                        Save Strand
                      </Button>
                    </div>
                  </form>
                </Card>
              ) : null}

              {/* Edit Strand Modal */}
              {editingStrand && (
                <Card className="p-5 border-amber-300 bg-amber-50/30">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Edit className="h-4 w-4 text-amber-600" />
                      Edit Strand: {editingStrand.name}
                    </h3>
                    <Button size="sm" variant="ghost" onClick={() => setEditingStrand(null)}>
                      Cancel
                    </Button>
                  </div>
                  <form onSubmit={handleEditStrand} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Strand Full Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={editStrandName}
                        onChange={(e) => setEditStrandName(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Strand Code <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={editStrandCode}
                        onChange={(e) => setEditStrandCode(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Description (Optional)
                      </label>
                      <input
                        type="text"
                        value={editStrandDesc}
                        onChange={(e) => setEditStrandDesc(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div className="sm:col-span-3 flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingStrand(null)}>
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" className="bg-[#174EA6] text-white">
                        Update Strand
                      </Button>
                    </div>
                  </form>
                </Card>
              )}

              {/* Master-Detail Layout: Strands on Left/Top, Sections on Right/Bottom */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* MASTER: Available Strands */}
                <div className="lg:col-span-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-[#174EA6]" />
                      Available Strands ({strands.length})
                    </h2>
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => setShowAddStrand(true)}
                      className="text-xs"
                    >
                      Add Strand
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {strands.map((s) => {
                      const isSelected = currentStrand?.id === s.id;
                      const strandSections = sections.filter((sec) => sec.strand_id === s.id);
                      return (
                        <div
                          key={s.id}
                          onClick={() => setSelectedStrandId(s.id)}
                          className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                            isSelected
                              ? "bg-[#174EA6]/5 border-[#174EA6] shadow-sm"
                              : "bg-white border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-sm text-slate-900">{s.code}</span>
                                <span
                                  className={`inline-flex px-2 py-0.2 rounded-full text-[10px] font-semibold ${
                                    s.is_active
                                      ? "bg-emerald-100 text-emerald-800"
                                      : "bg-slate-100 text-slate-500"
                                  }`}
                                >
                                  {s.is_active ? "Active" : "Inactive"}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 line-clamp-1 mt-0.5">{s.name}</p>
                              <span className="text-[11px] text-slate-400 mt-1 inline-block">
                                {strandSections.length} sections configured
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <button
                                title="Edit Strand"
                                onClick={() => {
                                  setEditingStrand(s);
                                  setEditStrandName(s.name);
                                  setEditStrandCode(s.code);
                                  setEditStrandDesc(s.description || "");
                                }}
                                className="p-1 text-slate-400 hover:text-slate-700 rounded"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              <button
                                title={s.is_active ? "Deactivate Strand" : "Activate Strand"}
                                onClick={() => handleToggleStrandActive(s)}
                                className={`p-1 rounded ${
                                  s.is_active ? "text-emerald-600 hover:text-red-600" : "text-slate-400 hover:text-emerald-600"
                                }`}
                              >
                                <Power className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* DETAIL: Sections under Selected Strand */}
                <div className="lg:col-span-8 space-y-4">
                  {currentStrand ? (
                    <Card className="p-5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3 mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-slate-900">
                              Sections in {currentStrand.name}
                            </h3>
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                                currentStrand.is_active
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {currentStrand.is_active ? "Strand Active" : "Strand Inactive"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Strand Code: <strong>{currentStrand.code}</strong> &bull; Total Sections:{" "}
                            <strong>{sectionsUnderCurrentStrand.length}</strong>
                          </p>
                        </div>

                        <Button
                          size="sm"
                          leftIcon={<Plus className="h-3.5 w-3.5" />}
                          onClick={() => setShowAddSection(true)}
                          className="bg-[#174EA6] text-white text-xs"
                        >
                          Add Section
                        </Button>
                      </div>

                      {/* Add Section Form */}
                      {showAddSection && (
                        <div className="mb-4 p-4 rounded-xl border border-[#174EA6]/30 bg-slate-50">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-200 mb-3">
                            <span className="text-xs font-bold text-slate-800">
                              Add Section under {currentStrand.code}
                            </span>
                            <button
                              onClick={() => setShowAddSection(false)}
                              className="text-slate-400 hover:text-slate-600 text-xs"
                            >
                              ✕
                            </button>
                          </div>
                          <form onSubmit={handleAddSection} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                Section Name <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                required
                                placeholder={`e.g. ${currentStrand.code} 4`}
                                value={newSectionName}
                                onChange={(e) => setNewSectionName(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                Capacity (Students)
                              </label>
                              <input
                                type="number"
                                min={1}
                                required
                                value={newSectionCapacity}
                                onChange={(e) => setNewSectionCapacity(Number(e.target.value))}
                                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
                              />
                            </div>
                            <div className="flex items-end gap-2">
                              <Button type="submit" size="sm" className="bg-[#174EA6] text-white">
                                Save Section
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setShowAddSection(false)}>
                                Cancel
                              </Button>
                            </div>
                          </form>
                        </div>
                      )}

                      {/* Edit Section Form */}
                      {editingSection && (
                        <div className="mb-4 p-4 rounded-xl border border-amber-300 bg-amber-50/50">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-200 mb-3">
                            <span className="text-xs font-bold text-slate-800">
                              Edit Section: {editingSection.name}
                            </span>
                            <button
                              onClick={() => setEditingSection(null)}
                              className="text-slate-400 hover:text-slate-600 text-xs"
                            >
                              ✕
                            </button>
                          </div>
                          <form onSubmit={handleEditSection} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                Section Name <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                required
                                value={editSectionName}
                                onChange={(e) => setEditSectionName(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">
                                Capacity (Students)
                              </label>
                              <input
                                type="number"
                                min={1}
                                required
                                value={editSectionCapacity}
                                onChange={(e) => setEditSectionCapacity(Number(e.target.value))}
                                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
                              />
                            </div>
                            <div className="flex items-end gap-2">
                              <Button type="submit" size="sm" className="bg-[#174EA6] text-white">
                                Update
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingSection(null)}>
                                Cancel
                              </Button>
                            </div>
                          </form>
                        </div>
                      )}

                      {/* Sections Table */}
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                              <th scope="col" className="py-2.5 pr-4">Section Name</th>
                              <th scope="col" className="py-2.5 pr-4">Capacity</th>
                              <th scope="col" className="py-2.5 pr-4">Assigned Adviser</th>
                              <th scope="col" className="py-2.5 pr-4">Requested By</th>
                              <th scope="col" className="py-2.5 pr-4">Status</th>
                              <th scope="col" className="py-2.5">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {sectionsUnderCurrentStrand.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                                  No sections created under this strand yet. Click &quot;Add Section&quot; to configure one.
                                </td>
                              </tr>
                            ) : (
                              sectionsUnderCurrentStrand.map((sec) => {
                                const activeAdviser = activeAdviserBySection.get(sec.name.trim().toLowerCase());
                                const sectionRequests = requestsBySection.get(sec.name.trim().toLowerCase()) || [];

                                return (
                                  <tr key={sec.id} className="hover:bg-slate-50">
                                    <td className="py-3 pr-4 font-semibold text-slate-900">
                                      {sec.name}
                                    </td>
                                    <td className="py-3 pr-4 text-xs text-slate-600">
                                      {sec.capacity} seats
                                    </td>
                                    <td className="py-3 pr-4 text-xs">
                                      {activeAdviser ? (
                                        <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                                          {activeAdviser.teacher_name || activeAdviser.teacher_user_id.slice(0, 8)}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400 italic">Vacant</span>
                                      )}
                                    </td>
                                    <td className="py-3 pr-4 text-xs">
                                      {sectionRequests.length === 0 ? (
                                        <span className="text-slate-400">None</span>
                                      ) : (
                                        <div className="flex flex-wrap gap-1">
                                          {sectionRequests.map((r) => (
                                            <span
                                              key={r.user_id}
                                              className={`inline-flex px-1.5 py-0.5 rounded text-[11px] ${
                                                r.request_status === "Approved"
                                                  ? "bg-emerald-100 text-emerald-800"
                                                  : r.request_status === "Pending"
                                                  ? "bg-amber-100 text-amber-800"
                                                  : "bg-slate-100 text-slate-600"
                                              }`}
                                            >
                                              {r.full_name} ({r.request_status || "Pending"})
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-3 pr-4">
                                      <span
                                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                                          sec.is_active
                                            ? "bg-emerald-100 text-emerald-800"
                                            : "bg-slate-100 text-slate-500"
                                        }`}
                                      >
                                        {sec.is_active ? "Active" : "Inactive"}
                                      </span>
                                    </td>
                                    <td className="py-3 text-xs space-x-2">
                                      <button
                                        onClick={() => {
                                          setEditingSection(sec);
                                          setEditSectionName(sec.name);
                                          setEditSectionCapacity(sec.capacity);
                                        }}
                                        className="text-[#174EA6] hover:underline"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => handleToggleSectionActive(sec)}
                                        className={sec.is_active ? "text-amber-700 hover:underline" : "text-emerald-700 hover:underline"}
                                      >
                                        {sec.is_active ? "Deactivate" : "Activate"}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  ) : (
                    <div className="p-8 text-center text-slate-400">
                      No strand selected. Please add a strand first.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 2: TEACHER ADVISORY REQUESTS                               */}
          {/* =============================================================== */}
          {activeTab === "advisory_requests" && (
            <Card className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 mb-4 gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-amber-600" />
                    Teacher Advisory Class Requests ({teacherRequests.length})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Teachers select an available Senior High School strand and section after logging in. Admin approval officially assigns them and unlocks SHS document scanning.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th scope="col" className="py-2.5 pr-4">Teacher</th>
                      <th scope="col" className="py-2.5 pr-4">Requested Advisory</th>
                      <th scope="col" className="py-2.5 pr-4">Submitted At</th>
                      <th scope="col" className="py-2.5 pr-4">Current Conflict Status</th>
                      <th scope="col" className="py-2.5 pr-4">Request Status</th>
                      <th scope="col" className="py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {teacherRequests.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                          No teacher advisory requests submitted yet.
                        </td>
                      </tr>
                    ) : (
                      teacherRequests.map((item) => {
                        const secKey = item.requested_section ? item.requested_section.trim().toLowerCase() : "";
                        const existingAdviser = activeAdviserBySection.get(secKey);
                        const hasConflict =
                          existingAdviser &&
                          existingAdviser.teacher_user_id !== item.user_id &&
                          item.request_status === "Pending";

                        const isProcessing = processingRequestId === item.user_id;

                        return (
                          <tr key={item.user_id} className="hover:bg-slate-50">
                            <td className="py-3 pr-4">
                              <p className="font-semibold text-slate-900">{item.full_name}</p>
                              {item.email && <p className="text-xs text-slate-500">{item.email}</p>}
                            </td>
                            <td className="py-3 pr-4">
                              <p className="font-medium text-slate-900">
                                {item.requested_grade_level} — {item.requested_section}
                              </p>
                              <p className="text-xs text-slate-500">{item.requested_strand}</p>
                            </td>
                            <td className="py-3 pr-4 text-xs text-slate-600">
                              {item.request_submitted_at
                                ? new Date(item.request_submitted_at).toLocaleString()
                                : "N/A"}
                            </td>
                            <td className="py-3 pr-4 text-xs">
                              {hasConflict ? (
                                <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded font-semibold">
                                  <AlertTriangle className="h-3 w-3" />
                                  Conflict: {existingAdviser?.teacher_name || "Adviser"} already active
                                </span>
                              ) : (
                                <span className="text-emerald-700 font-medium">✓ Section Available</span>
                              )}
                            </td>
                            <td className="py-3 pr-4">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  item.request_status === "Approved"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : item.request_status === "Declined"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {item.request_status || "Pending"}
                              </span>
                            </td>
                            <td className="py-3 text-xs space-x-2">
                              {item.request_status === "Pending" ? (
                                <>
                                  <Button
                                    size="sm"
                                    disabled={isProcessing}
                                    onClick={() => handleApproveRequest(item)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1"
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isProcessing}
                                    onClick={() => handleRejectRequest(item)}
                                    className="border-red-300 text-red-700 hover:bg-red-50 text-xs px-2.5 py-1"
                                  >
                                    Reject
                                  </Button>
                                </>
                              ) : (
                                <span className="text-xs text-slate-400">Processed</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* =============================================================== */}
          {/* TAB 3: ASSIGNMENTS & SCANNING POLICY                           */}
          {/* =============================================================== */}
          {activeTab === "assignments" && (
            <div className="space-y-6">
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

              {/* Create Teacher Assignment Form (Now linked to Admin-controlled Strands & Sections) */}
              <Card className="p-6">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-4">
                  <UserCheck className="h-5 w-5 text-[#174EA6]" />
                  Direct Teacher Assignment
                </h2>

                <form onSubmit={handleCreateAssignment} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label htmlFor="ta-teacher" className="block text-xs font-semibold text-slate-700 mb-1">
                      Teacher Account <span className="text-red-500">*</span>
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
                      Assignment Type <span className="text-red-500">*</span>
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
                      School Year <span className="text-red-500">*</span>
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
                      Grade Level <span className="text-red-500">*</span>
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

                  {/* Admin-controlled Strand Dropdown */}
                  <div>
                    <label htmlFor="ta-strand-select" className="block text-xs font-semibold text-slate-700 mb-1">
                      Strand <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="ta-strand-select"
                      required
                      value={manualStrandId}
                      onChange={(e) => {
                        setManualStrandId(e.target.value);
                        setManualSectionName("");
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      <option value="">Select active strand</option>
                      {strands.filter((s) => s.is_active).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Admin-controlled Section Dropdown */}
                  <div>
                    <label htmlFor="ta-section-select" className="block text-xs font-semibold text-slate-700 mb-1">
                      Section <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="ta-section-select"
                      required
                      value={manualSectionName}
                      disabled={!manualStrandId}
                      onChange={(e) => setManualSectionName(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                    >
                      <option value="">
                        {!manualStrandId ? "Select strand first" : "Select section"}
                      </option>
                      {sectionsForManualStrand.map((sec) => (
                        <option key={sec.id} value={sec.name}>
                          {sec.name} (Cap: {sec.capacity})
                        </option>
                      ))}
                    </select>
                  </div>

                  {assignmentType === "subject_teacher" && (
                    <>
                      <div>
                        <label htmlFor="ta-subject" className="block text-xs font-semibold text-slate-700 mb-1">
                          Subject Taught <span className="text-red-500">*</span>
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
                      disabled={submittingAssignment || !teacherUserId || !manualSectionName}
                      leftIcon={<Plus className="h-4 w-4" />}
                      className="bg-[#174EA6] hover:bg-[#0B1F33] text-white"
                    >
                      {submittingAssignment ? "Saving Assignment..." : "Assign Teacher"}
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
                      <th scope="col" className="py-2.5 pr-4">Grade &amp; Section</th>
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
                          <td className="py-3 pr-4 text-slate-600">{a.school_year}</td>
                          <td className="py-3 pr-4 font-semibold text-slate-900">
                            {a.grade_level} - {a.section}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">{a.strand_or_track || "—"}</td>
                          <td className="py-3 pr-4 text-slate-600">
                            {a.assignment_type === "subject_teacher"
                              ? `${a.subject_taught || "—"} (${a.semester || "All"})`
                              : "—"}
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                                a.assignment_status === "active"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {a.assignment_status}
                            </span>
                          </td>
                          <td className="py-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleToggleAssignmentStatus(a)}
                              className="text-xs"
                            >
                              {a.assignment_status === "active" ? "Deactivate" : "Activate"}
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </Card>
            </div>
          )}

          {/* =============================================================== */}
          {/* TAB 4: QUARANTINED CONFLICTS                                   */}
          {/* =============================================================== */}
          {activeTab === "conflicts" && (
            <Card className="p-6 overflow-x-auto">
              <h2 className="text-base font-bold text-slate-900 mb-2">
                Quarantined Section &amp; Student Identity Conflicts ({conflicts.length})
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Identities or sections that conflicted during scanning are quarantined here for administrative audit and reconciliation.
              </p>
              <table className="min-w-full text-left text-sm border-collapse">
                <caption className="sr-only">Quarantined identity and section conflicts</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th scope="col" className="py-2.5 pr-4">Conflict Type</th>
                    <th scope="col" className="py-2.5 pr-4">Extracted Identity</th>
                    <th scope="col" className="py-2.5 pr-4">Expected vs Extracted</th>
                    <th scope="col" className="py-2.5 pr-4">Status</th>
                    <th scope="col" className="py-2.5 pr-4">Resolution Notes</th>
                    <th scope="col" className="py-2.5">Resolve</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {conflicts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No quarantined conflicts recorded.
                      </td>
                    </tr>
                  ) : (
                    conflicts.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="py-3 pr-4 font-medium text-amber-900">
                          {c.conflict_type}
                        </td>
                        <td className="py-3 pr-4">
                          <p className="font-semibold text-slate-900">{c.extracted_name || "—"}</p>
                          <p className="text-xs text-slate-500">LRN: {c.extracted_lrn || "—"}</p>
                        </td>
                        <td className="py-3 pr-4 text-xs">
                          <p className="text-slate-600">
                            Exp: {c.expected_context?.grade_level || "—"} - {c.expected_context?.section || "—"}
                          </p>
                          <p className="text-slate-900 font-medium">
                            Ext: {c.extracted_context?.grade_level || "—"} - {c.extracted_context?.section || "—"}
                          </p>
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                              c.status === "pending"
                                ? "bg-amber-100 text-amber-800"
                                : c.status === "resolved"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          {c.status === "pending" ? (
                            <input
                              type="text"
                              placeholder="Add resolution note..."
                              value={resolutionNotesMap[c.id] || ""}
                              onChange={(e) =>
                                setResolutionNotesMap({
                                  ...resolutionNotesMap,
                                  [c.id]: e.target.value,
                                })
                              }
                              className="rounded border border-slate-300 px-2 py-1 text-xs w-44"
                            />
                          ) : (
                            <span className="text-xs text-slate-600">{c.resolution_notes || "—"}</span>
                          )}
                        </td>
                        <td className="py-3 space-x-1.5">
                          {c.status === "pending" ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleResolveConflict(c.id, "resolved")}
                                className="bg-emerald-600 text-white text-xs px-2 py-1"
                              >
                                Resolve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleResolveConflict(c.id, "dismissed")}
                                className="text-xs px-2 py-1 text-slate-600"
                              >
                                Dismiss
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">Archived</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </PageContainer>
  );
}

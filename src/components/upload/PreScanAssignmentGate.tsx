"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  buildAssignmentConfirmationMessage,
  formatAssignmentRoleLabel,
  type TeacherAssignmentRecord,
  type TeacherModulePolicy,
} from "@/lib/teacher/assignments";
import { ShieldCheck, AlertTriangle, CheckCircle2, ClipboardCheck } from "lucide-react";

export interface PreScanAssignmentState {
  loaded: boolean;
  userRole: string | null;
  assignments: TeacherAssignmentRecord[];
  policy: TeacherModulePolicy | null;
  selectedAssignment: TeacherAssignmentRecord | null;
  confirmed: boolean;
}

interface PreScanAssignmentGateProps {
  docCategory: "sf9" | "sf10";
  state: PreScanAssignmentState;
  onStateChange: (next: PreScanAssignmentState) => void;
  onAssignmentGradeSync?: (gradeLevel: string) => void;
  openModalSignal?: number;
}

export default function PreScanAssignmentGate({
  docCategory,
  state,
  onStateChange,
  onAssignmentGradeSync,
  openModalSignal = 0,
}: PreScanAssignmentGateProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/teacher/assignments");
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Unable to verify teacher assignments.");
        }
        if (!active) return;

        const assignments: TeacherAssignmentRecord[] = json.assignments || [];
        const policy: TeacherModulePolicy = {
          school_id: json.policy?.school_id || "",
          allow_subject_teacher_scanning: false,
        };

        // Strict Class Adviser-only scanning policy: only active Class Adviser assignments can scan
        const advisoryAssignments = assignments.filter(
          (a) => a.assignment_type === "class_adviser"
        );

        let initialSelected: TeacherAssignmentRecord | null = advisoryAssignments[0] || null;
        if (typeof window !== "undefined") {
          const qs = new URLSearchParams(window.location.search);
          const requestedId = qs.get("assignmentId");
          if (requestedId) {
            const match = advisoryAssignments.find((a) => a.id === requestedId);
            if (match) initialSelected = match;
          }
        }

        onStateChange({
          loaded: true,
          userRole: json.role || null,
          assignments,
          policy,
          selectedAssignment: initialSelected,
          confirmed: false,
        });

        if (initialSelected?.grade_level && onAssignmentGradeSync) {
          onAssignmentGradeSync(initialSelected.grade_level);
        }
      } catch (err: any) {
        if (active) {
          setFetchError(err?.message || "Failed to load assignments.");
          onStateChange({ ...state, loaded: true });
        }
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (openModalSignal > 0 && state.selectedAssignment && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [openModalSignal, state.selectedAssignment]);

  const isTeacher = String(state.userRole || "").toLowerCase() === "teacher";
  const advisoryAssignments = state.assignments.filter(
    (a) => a.assignment_type === "class_adviser"
  );
  const selected = state.selectedAssignment;
  const selectedCanScan =
    !isTeacher ||
    (selected !== null && selected.assignment_type === "class_adviser");

  const openConfirmModal = () => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  };

  const handleConfirm = () => {
    onStateChange({ ...state, confirmed: true });
    dialogRef.current?.close("confirmed");
  };

  const handleSelectChange = (assignmentId: string) => {
    const next = advisoryAssignments.find((a) => a.id === assignmentId) || null;
    onStateChange({
      ...state,
      selectedAssignment: next,
      confirmed: false,
    });
    if (next?.grade_level && onAssignmentGradeSync) {
      onAssignmentGradeSync(next.grade_level);
    }
  };

  if (!state.loaded) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Verifying your authorized teaching assignments...
      </div>
    );
  }

  if (fetchError) {
    return (
      <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{fetchError}</span>
      </div>
    );
  }

  if (isTeacher && advisoryAssignments.length === 0) {
    const hasSubjectAssignments = state.assignments.length > 0;
    return (
      <div role="region" aria-label="Class Adviser Assignment Required" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-bold">
              {hasSubjectAssignments
                ? "Class Adviser Role Required for Scanning"
                : "No Active Class Adviser Assignment Found"}
            </p>
            <p className="mt-1">
              {hasSubjectAssignments
                ? "Only an officially assigned and active Class Adviser may scan SF9/SF10 documents or perform OCR extraction. You currently hold Subject Teacher assignment(s) only, which permit reviewing and editing grades for your assigned subjects without document scanning."
                : "You must hold an active Class Adviser assignment from your school administrator before scanning SF9 or SF10 documents. Please request an advisory assignment from your administrator."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isTeacher && advisoryAssignments.length === 0) {
    return null;
  }

  const reminderText = selected
    ? buildAssignmentConfirmationMessage({
        grade_level: selected.grade_level,
        section: selected.section,
        strand_or_track: selected.strand_or_track,
        school_year: selected.school_year,
      })
    : "";

  return (
    <section
      aria-labelledby="assignment-gate-title"
      className="mt-4 rounded-xl border border-indigo-200 bg-white p-4 shadow-xs"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#174EA6]" aria-hidden="true" />
            <h2 id="assignment-gate-title" className="text-sm font-bold text-slate-900">
              Authorized Class Assignment &amp; Pre-Scan Verification
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="scan-assignment-select" className="text-xs font-semibold text-slate-700">
              Advisory Section:
            </label>
            <select
              id="scan-assignment-select"
              value={selected?.id || ""}
              onChange={(e) => handleSelectChange(e.target.value)}
              className="min-w-[260px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900"
            >
              {advisoryAssignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.school_year} • {a.grade_level} — {a.section}
                  {a.strand_or_track ? ` (${a.strand_or_track})` : ""} —{" "}
                  {formatAssignmentRoleLabel(a.assignment_type)}
                </option>
              ))}
            </select>

            {selected && !selectedCanScan && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Scanning is restricted to officially assigned active Class Advisers
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {state.confirmed && selectedCanScan ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              <span>Confirmed for {selected?.grade_level} — {selected?.section}</span>
              <button
                type="button"
                onClick={openConfirmModal}
                className="underline ml-1 text-emerald-900 hover:text-emerald-700"
              >
                Review
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!selected || !selectedCanScan}
              onClick={openConfirmModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#174EA6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0B1F33] disabled:opacity-50 transition-colors"
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              Confirm Class Assignment Before Scanning
            </button>
          )}
        </div>
      </div>

      {/* Native Accessible Pre-Scan Confirmation Dialog */}
      <dialog
        ref={dialogRef}
        aria-labelledby="prescan-confirm-title"
        className="m-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl"
      >
        <h3 id="prescan-confirm-title" className="text-lg font-bold text-slate-900">
          Confirm Class Assignment Before Scanning
        </h3>

        {selected && (
          <div className="mt-4 space-y-4">
            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
              <div>
                <dt className="font-semibold text-slate-500">School Year</dt>
                <dd className="mt-0.5 font-bold text-slate-900">{selected.school_year}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Grade Level</dt>
                <dd className="mt-0.5 font-bold text-slate-900">{selected.grade_level}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Advisory Section</dt>
                <dd className="mt-0.5 font-bold text-slate-900">{selected.section}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Strand / Track (SHS)</dt>
                <dd className="mt-0.5 font-bold text-slate-900">{selected.strand_or_track || "N/A"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Teacher Role</dt>
                <dd className="mt-0.5 font-bold text-slate-900">
                  {formatAssignmentRoleLabel(selected.assignment_type)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Subject / Semester</dt>
                <dd className="mt-0.5 font-bold text-slate-900">
                  {selected.subject_taught
                    ? `${selected.subject_taught}${selected.semester ? ` (${selected.semester})` : ""}`
                    : "All Advisory Subjects"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="font-semibold text-slate-500">Document Type</dt>
                <dd className="mt-0.5 font-bold uppercase text-indigo-800">
                  {docCategory === "sf10" ? "SF10 (Permanent Academic Record)" : "SF9 (Learner Progress Report Card)"}
                </dd>
              </div>
            </dl>

            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs font-medium text-amber-950 leading-relaxed">
              {reminderText}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                autoFocus
                onClick={() => dialogRef.current?.close("cancel")}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded-lg bg-[#174EA6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0B1F33]"
              >
                Confirm &amp; Proceed
              </button>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

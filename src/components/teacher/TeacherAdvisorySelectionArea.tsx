"use client";

import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  GraduationCap,
  Layers,
  Send,
  Lock,
  RefreshCw,
  Edit2,
  XCircle,
} from "lucide-react";
import type { TeacherAssignmentRecord } from "@/lib/teacher/assignments";
import type { SchoolStrandRow } from "@/types/database";

interface SectionOption {
  id: string;
  strand_id: string;
  name: string;
  capacity: number;
  is_active: boolean;
  hasActiveAdviser?: boolean;
  isAvailable?: boolean;
}

interface RequestedAdvisoryData {
  requested_grade_level: string | null;
  requested_strand: string | null;
  requested_section: string | null;
  requested_strand_id?: string | null;
  requested_section_id?: string | null;
  request_status: string | null;
  request_submitted_at: string | null;
}

interface TeacherAdvisorySelectionAreaProps {
  advisoryClasses: TeacherAssignmentRecord[];
  initialRequestedAdvisory?: RequestedAdvisoryData | null;
}

export default function TeacherAdvisorySelectionArea({
  advisoryClasses,
  initialRequestedAdvisory,
}: TeacherAdvisorySelectionAreaProps) {
  const [requestedAdvisory, setRequestedAdvisory] = useState<RequestedAdvisoryData | null>(
    initialRequestedAdvisory || null
  );
  const [strands, setStrands] = useState<SchoolStrandRow[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [selectedGrade, setSelectedGrade] = useState<"Grade 11" | "Grade 12">("Grade 11");
  const [selectedStrandId, setSelectedStrandId] = useState<string>("");
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [isChangingRequest, setIsChangingRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const hasApprovedAdvisory = advisoryClasses.length > 0;
  const isPendingApproval = !hasApprovedAdvisory && requestedAdvisory?.request_status === "Pending";
  const isDeclined = !hasApprovedAdvisory && requestedAdvisory?.request_status === "Declined";

  // Load available strands and sections when not approved or when editing request
  const loadAvailableOptions = async () => {
    setLoadingData(true);
    try {
      const res = await fetch("/api/teacher/strands");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load options.");
      setStrands(json.strands || []);
      setSections(json.sections || []);
      if (!selectedStrandId && json.strands?.length > 0) {
        setSelectedStrandId(json.strands[0].id);
      }
    } catch (err: any) {
      setError(err?.message || "Could not load active strands and sections.");
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (!hasApprovedAdvisory) {
      void loadAvailableOptions();
    }
  }, [hasApprovedAdvisory]);

  // Filter sections belonging to the chosen strand
  const availableSectionsForStrand = sections.filter(
    (s) => s.strand_id === selectedStrandId && s.is_active
  );

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGrade || !selectedStrandId || !selectedSectionId) {
      setError("Please select a Grade Level, Strand, and Section.");
      return;
    }

    const chosenSection = sections.find((s) => s.id === selectedSectionId);
    if (!chosenSection || !chosenSection.is_active) {
      setError("The selected section is no longer active. Please choose another.");
      return;
    }

    if (chosenSection.hasActiveAdviser) {
      setError("This section already has an active Class Adviser. Please choose an available section.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/teacher/advisory-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade_level: selectedGrade,
          strand_id: selectedStrandId,
          section_id: selectedSectionId,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to submit advisory request.");

      const chosenStrand = strands.find((s) => s.id === selectedStrandId);

      setRequestedAdvisory({
        requested_grade_level: selectedGrade,
        requested_strand: chosenStrand?.name || "",
        requested_section: chosenSection.name,
        requested_strand_id: selectedStrandId,
        requested_section_id: selectedSectionId,
        request_status: "Pending",
        request_submitted_at: new Date().toISOString(),
      });

      setIsChangingRequest(false);
      setSuccessMessage("Advisory class request submitted successfully. Awaiting Administrator approval.");
      // Refresh options to reflect updated reservation
      void loadAvailableOptions();
    } catch (err: any) {
      setError(err?.message || "Could not submit advisory request.");
    } finally {
      setSubmitting(false);
    }
  };

  // Case 1: Approved Class Adviser assignment already active
  if (hasApprovedAdvisory) {
    const primaryAdvisory = advisoryClasses[0];
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  Approved Class Adviser Assignment
                </h3>
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-300">
                  Active &amp; Approved
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                You are officially assigned to{" "}
                <strong>
                  {primaryAdvisory.grade_level} — {primaryAdvisory.section}
                </strong>
                {primaryAdvisory.strand_or_track ? ` (${primaryAdvisory.strand_or_track})` : ""} for School Year{" "}
                <strong>{primaryAdvisory.school_year}</strong>.
              </p>
              <p className="text-xs text-emerald-800 mt-1">
                ✓ Authorized for Senior High School SF9 / SF10 document scanning and OCR grade recalculation.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Case 2: Pending Admin Approval
  if (isPendingApproval && !isChangingRequest) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Clock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  Advisory Class Request: Pending Admin Approval
                </h3>
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 border border-amber-300">
                  Pending Approval
                </span>
              </div>
              <p className="mt-1.5 text-sm text-slate-800">
                You have requested advisory assignment for{" "}
                <strong>
                  {requestedAdvisory?.requested_grade_level} — {requestedAdvisory?.requested_section}
                </strong>{" "}
                ({requestedAdvisory?.requested_strand}).
              </p>
              {requestedAdvisory?.request_submitted_at && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Submitted on: {new Date(requestedAdvisory.request_submitted_at).toLocaleString()}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2 text-xs font-medium text-amber-900 bg-amber-100/70 p-2.5 rounded-lg border border-amber-200">
                <Lock className="h-4 w-4 shrink-0 text-amber-700" />
                <span>
                  Document upload and SF9/SF10 scanning remain locked until your school administrator reviews and approves your advisory assignment.
                </span>
              </div>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            leftIcon={<Edit2 className="h-3.5 w-3.5" />}
            onClick={() => {
              setIsChangingRequest(true);
              setError(null);
            }}
            className="shrink-0 text-xs border-amber-300 bg-white text-slate-800 hover:bg-amber-100/50"
          >
            Change Selection
          </Button>
        </div>
      </div>
    );
  }

  // Case 3: Selection Form (No assignment or changing request)
  return (
    <Card className="p-6 border-slate-200 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#174EA6]/10 text-[#174EA6]">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Senior High School Advisory Class Selection
            </h3>
            <p className="text-xs text-slate-500">
              Select your intended strand and section from the school&apos;s available SHS offerings.
            </p>
          </div>
        </div>

        {isChangingRequest && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsChangingRequest(false)}
            className="text-xs text-slate-500"
          >
            Cancel
          </Button>
        )}
      </div>

      {isDeclined && (
        <div className="mb-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm flex items-start gap-2.5">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Previous request declined:</strong> Your earlier request for{" "}
            {requestedAdvisory?.requested_section} was declined by the administrator. Please select another available strand and section below.
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {loadingData ? (
        <div className="py-8 flex justify-center items-center gap-2 text-slate-500 text-sm">
          <LoadingSpinner />
          <span>Loading available strands and sections...</span>
        </div>
      ) : strands.length === 0 ? (
        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-sm">
          No active strands are currently configured by your school administrator. Please contact your administrator.
        </div>
      ) : (
        <form onSubmit={handleSubmitRequest} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Grade Level Selection */}
            <div>
              <label htmlFor="advisory-grade" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Grade Level <span className="text-red-500">*</span>
              </label>
              <select
                id="advisory-grade"
                required
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value as "Grade 11" | "Grade 12")}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
              >
                <option value="Grade 11">Grade 11</option>
                <option value="Grade 12">Grade 12</option>
              </select>
            </div>

            {/* Strand Selection (Admin Controlled Only) */}
            <div>
              <label htmlFor="advisory-strand" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Strand <span className="text-red-500">*</span>
              </label>
              <select
                id="advisory-strand"
                required
                value={selectedStrandId}
                onChange={(e) => {
                  setSelectedStrandId(e.target.value);
                  setSelectedSectionId("");
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all"
              >
                <option value="">Select an active strand</option>
                {strands.map((strand) => (
                  <option key={strand.id} value={strand.id}>
                    {strand.name} ({strand.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Section Selection (Belonging to selected strand only, prevent full/unavailable) */}
            <div>
              <label htmlFor="advisory-section" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Section <span className="text-red-500">*</span>
              </label>
              <select
                id="advisory-section"
                required
                disabled={!selectedStrandId}
                value={selectedSectionId}
                onChange={(e) => setSelectedSectionId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-[#174EA6] focus:ring-2 focus:ring-[#174EA6]/20 transition-all disabled:bg-slate-100 disabled:text-slate-400"
              >
                <option value="">
                  {!selectedStrandId
                    ? "Select a strand first"
                    : availableSectionsForStrand.length === 0
                    ? "No active sections available"
                    : "Select an available section"}
                </option>
                {availableSectionsForStrand.map((sec) => {
                  const isUnavailable = Boolean(sec.hasActiveAdviser);
                  return (
                    <option
                      key={sec.id}
                      value={sec.id}
                      disabled={isUnavailable}
                    >
                      {sec.name} {isUnavailable ? "(Adviser Assigned / Full)" : `(Available)`}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>
                Selection sends an advisory assignment request to the School Administrator for approval.
              </span>
            </div>

            <Button
              type="submit"
              disabled={submitting || !selectedStrandId || !selectedSectionId}
              leftIcon={<Send className="h-3.5 w-3.5" />}
              className="bg-[#174EA6] hover:bg-[#0B1F33] text-white text-xs sm:text-sm"
            >
              {submitting ? "Submitting Request..." : "Request Advisory Assignment"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

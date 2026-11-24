"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Users,
  Calendar,
  Award,
  CheckCircle2,
  AlertTriangle,
  Flag,
  FileText,
  Search,
  Filter,
  ArrowLeftRight,
} from "lucide-react";
import type {
  Sf1RosterEntry,
  Sf2AttendanceEntry,
  Sf5PromotionEntry,
} from "@/types/database";

interface ShsRosterReviewSectionProps {
  documentType: "sf1" | "sf2" | "sf5";
  documentId: string;
  entries: Array<Sf1RosterEntry | Sf2AttendanceEntry | Sf5PromotionEntry>;
  onVerifyEntry?: (id: string) => Promise<void>;
  onFlagEntry?: (id: string, reason: string) => Promise<void>;
}

export default function ShsRosterReviewSection({
  documentType,
  documentId,
  entries,
  onVerifyEntry,
  onFlagEntry,
}: ShsRosterReviewSectionProps) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const filteredEntries = entries.filter((e: any) => {
    const name = (e.learner_name || `${e.last_name || ""}, ${e.first_name || ""}`).toLowerCase();
    const lrn = (e.lrn || "").toLowerCase();
    const matchesSearch = name.includes(search.toLowerCase()) || lrn.includes(search.toLowerCase());
    const matchesStatus = filterStatus === "ALL" || e.review_status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "VERIFIED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Verified
          </span>
        );
      case "FLAGGED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
            <Flag className="w-3 h-3 text-rose-600" />
            Flagged
          </span>
        );
      case "NEEDS_REVIEW":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            Needs Review
          </span>
        );
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            {documentType === "sf1" && <Users className="w-5 h-5 text-indigo-600" />}
            {documentType === "sf2" && <Calendar className="w-5 h-5 text-sky-600" />}
            {documentType === "sf5" && <Award className="w-5 h-5 text-amber-600" />}
            {documentType === "sf1" && "SHS SF1 School Register Roster Entries"}
            {documentType === "sf2" && "SHS SF2 Monthly Daily Attendance Records"}
            {documentType === "sf5" && "SHS SF5 Promotion & Deficiency Candidates"}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Total {entries.length} extracted learner record(s) associated with document {documentId.slice(0, 8)}.
          </p>
        </div>

        {/* Filter & Cross-Validate controls */}
        <div className="flex flex-wrap items-center gap-2">
          {documentType === "sf1" && (
            <Link
              href={`/compare?mode=sf1_sf2&sf1Id=${documentId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 transition-colors shadow-xs"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Cross-Validate with SF2
            </Link>
          )}
          {documentType === "sf2" && (
            <Link
              href={`/compare?mode=sf1_sf2&sf2Id=${documentId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-900/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 transition-colors shadow-xs"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Cross-Validate with SF1
            </Link>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Search learner or LRN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
          >
            <option value="ALL">All Statuses</option>
            <option value="NEEDS_REVIEW">Needs Review</option>
            <option value="VERIFIED">Verified</option>
            <option value="FLAGGED">Flagged</option>
          </select>
        </div>
      </div>

      {/* Roster Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-left text-xs text-zinc-700 dark:text-zinc-300">
          <thead className="bg-zinc-50 dark:bg-zinc-800/80 uppercase text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
            <tr>
              <th className="py-2.5 px-3">#</th>
              <th className="py-2.5 px-3">LRN</th>
              <th className="py-2.5 px-3">Learner Name</th>
              {documentType === "sf1" && (
                <>
                  <th className="py-2.5 px-3">Sex</th>
                  <th className="py-2.5 px-3">Birth Date</th>
                  <th className="py-2.5 px-3">Age</th>
                  <th className="py-2.5 px-3">Remarks</th>
                </>
              )}
              {documentType === "sf2" && (
                <>
                  <th className="py-2.5 px-3">Month</th>
                  <th className="py-2.5 px-3">Present</th>
                  <th className="py-2.5 px-3">Absent</th>
                  <th className="py-2.5 px-3">Tardy</th>
                  <th className="py-2.5 px-3">Reconciled</th>
                </>
              )}
              {documentType === "sf5" && (
                <>
                  <th className="py-2.5 px-3">Variant</th>
                  <th className="py-2.5 px-3">Gen. Avg</th>
                  <th className="py-2.5 px-3">Action Taken</th>
                  <th className="py-2.5 px-3">Deficiencies</th>
                </>
              )}
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {filteredEntries.map((entry: any, idx: number) => {
              const name = entry.learner_name || `${entry.last_name || ""}, ${entry.first_name || ""} ${entry.middle_name || ""}`.trim();
              const isMatch = Boolean(entry.student_id);

              return (
                <tr key={entry.id || idx} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
                  <td className="py-2 px-3 font-mono text-zinc-400">{entry.row_index || idx + 1}</td>
                  <td className="py-2 px-3 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                    {entry.lrn || <span className="text-rose-500 font-semibold">MISSING</span>}
                  </td>
                  <td className="py-2 px-3 font-semibold text-zinc-900 dark:text-zinc-100">
                    {name}
                    {!isMatch && (
                      <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-normal">
                        Unmatched
                      </span>
                    )}
                  </td>

                  {documentType === "sf1" && (
                    <>
                      <td className="py-2 px-3">{entry.sex || "-"}</td>
                      <td className="py-2 px-3 font-mono">{entry.birth_date || "-"}</td>
                      <td className="py-2 px-3">{entry.age ?? "-"}</td>
                      <td className="py-2 px-3 text-zinc-500 italic">{entry.remarks_indicator || "None"}</td>
                    </>
                  )}

                  {documentType === "sf2" && (
                    <>
                      <td className="py-2 px-3 font-medium">{entry.month || "-"}</td>
                      <td className="py-2 px-3 font-mono text-emerald-600 font-semibold">{entry.days_present ?? 0}</td>
                      <td className="py-2 px-3 font-mono text-rose-600 font-semibold">{entry.days_absent ?? 0}</td>
                      <td className="py-2 px-3 font-mono text-amber-600 font-semibold">{entry.days_tardy ?? 0}</td>
                      <td className="py-2 px-3 font-mono">
                        {(entry.days_present ?? 0) + (entry.days_absent ?? 0) <= (entry.total_school_days ?? 25) ? (
                          <span className="text-emerald-600 font-semibold">✔ OK</span>
                        ) : (
                          <span className="text-rose-600 font-semibold">⚠ Discrepancy</span>
                        )}
                      </td>
                    </>
                  )}

                  {documentType === "sf5" && (
                    <>
                      <td className="py-2 px-3 font-semibold text-zinc-600">{entry.form_variant || "SF5A-SHS"}</td>
                      <td className="py-2 px-3 font-mono font-bold text-zinc-900 dark:text-zinc-100">
                        {entry.general_average != null ? Number(entry.general_average).toFixed(1) : "-"}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                            entry.action_taken === "COMPLETE" || entry.action_taken === "GRADUATING"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {entry.action_taken}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs">
                        {Array.isArray(entry.incomplete_subjects) && entry.incomplete_subjects.length > 0 ? (
                          <span className="text-rose-600 font-medium">
                            {entry.incomplete_subjects.map((s: any) => (typeof s === "string" ? s : s.subject)).join(", ")}
                          </span>
                        ) : (
                          <span className="text-zinc-400">None</span>
                        )}
                      </td>
                    </>
                  )}

                  <td className="py-2 px-3">{getStatusBadge(entry.review_status)}</td>

                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {onVerifyEntry && entry.review_status !== "VERIFIED" && (
                        <button
                          type="button"
                          onClick={() => onVerifyEntry(entry.id)}
                          className="px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition-colors"
                        >
                          Verify
                        </button>
                      )}
                      {onFlagEntry && entry.review_status !== "FLAGGED" && (
                        <button
                          type="button"
                          onClick={() => onFlagEntry(entry.id, "Flagged during roster examination")}
                          className="px-2 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 transition-colors"
                        >
                          Flag
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  FileText,
  Lock,
  UserCheck,
} from "lucide-react";
import type { PsaIdentityRecord, Sf1RosterEntry } from "@/types/database";

interface PsaIdentityVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  psaRecord: PsaIdentityRecord;
  sf1Entry?: Sf1RosterEntry | null;
  onConfirmVerification?: (psaId: string, notes?: string) => Promise<void>;
  onFlagConflict?: (psaId: string, conflictReason: string) => Promise<void>;
}

export default function PsaIdentityVerificationModal({
  isOpen,
  onClose,
  psaRecord,
  sf1Entry,
  onConfirmVerification,
  onFlagConflict,
}: PsaIdentityVerificationModalProps) {
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const psaFullName = `${psaRecord.last_name}, ${psaRecord.first_name} ${psaRecord.middle_name || ""}`.trim();
  const sf1FullName = sf1Entry
    ? `${sf1Entry.last_name}, ${sf1Entry.first_name} ${sf1Entry.middle_name || ""}`.trim()
    : "Not Linked";

  const isNameMatch =
    sf1Entry &&
    psaRecord.last_name.toLowerCase().trim() === sf1Entry.last_name.toLowerCase().trim() &&
    psaRecord.first_name.toLowerCase().trim() === sf1Entry.first_name.toLowerCase().trim();

  const isDobMatch =
    sf1Entry &&
    psaRecord.birth_date &&
    sf1Entry.birth_date &&
    psaRecord.birth_date === sf1Entry.birth_date;

  const isSexMatch =
    sf1Entry &&
    psaRecord.sex &&
    sf1Entry.sex &&
    psaRecord.sex.toUpperCase().charAt(0) === sf1Entry.sex.toUpperCase().charAt(0);

  const handleConfirm = async () => {
    if (!onConfirmVerification) return;
    setIsSubmitting(true);
    try {
      await onConfirmVerification(psaRecord.id, resolutionNotes);
      onClose();
    } catch (e: any) {
      alert(e.message || "Failed to confirm verification");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFlag = async () => {
    if (!onFlagConflict) return;
    const reason = resolutionNotes.trim() || "Civil identity mismatch flagged by faculty/registrar";
    setIsSubmitting(true);
    try {
      await onFlagConflict(psaRecord.id, reason);
      onClose();
    } catch (e: any) {
      alert(e.message || "Failed to flag conflict");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-2xl w-full border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 rounded-xl text-indigo-600 border border-indigo-200 dark:border-indigo-800">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                PSA Civil Identity Verification
              </h3>
              <p className="text-xs text-zinc-500">
                Taysan Resettlement Integrated School (TRIS) — DepEd ID: 500169
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Privacy Alert */}
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-amber-900 dark:text-amber-200 leading-relaxed text-[11px]">
              <strong>Privacy and Data Integrity Protection:</strong> PSA is strictly a supporting civil identity document. Under institutional policy, PSA data never overwrites a verified student profile automatically, nor does it calculate academic grades, attendance, or promotion status.
            </div>
          </div>

          {/* Side by side comparison table */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700 font-semibold text-zinc-600 dark:text-zinc-400 text-[11px] uppercase">
                <tr>
                  <th className="py-2 px-3">Field</th>
                  <th className="py-2 px-3">PSA Birth Certificate</th>
                  <th className="py-2 px-3">SF1 School Register</th>
                  <th className="py-2 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-zinc-500">Full Name</td>
                  <td className="py-2.5 px-3 font-bold text-zinc-900 dark:text-zinc-100">{psaFullName}</td>
                  <td className="py-2.5 px-3 font-bold text-zinc-900 dark:text-zinc-100">{sf1FullName}</td>
                  <td className="py-2.5 px-3 text-center">
                    {isNameMatch ? (
                      <span className="text-emerald-600 font-semibold flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Match
                      </span>
                    ) : (
                      <span className="text-rose-600 font-semibold flex items-center justify-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Mismatch
                      </span>
                    )}
                  </td>
                </tr>

                <tr>
                  <td className="py-2.5 px-3 font-semibold text-zinc-500">Date of Birth</td>
                  <td className="py-2.5 px-3 font-mono">{psaRecord.birth_date || "-"}</td>
                  <td className="py-2.5 px-3 font-mono">{sf1Entry?.birth_date || "-"}</td>
                  <td className="py-2.5 px-3 text-center">
                    {isDobMatch ? (
                      <span className="text-emerald-600 font-semibold flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Match
                      </span>
                    ) : (
                      <span className="text-rose-600 font-semibold flex items-center justify-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Conflict
                      </span>
                    )}
                  </td>
                </tr>

                <tr>
                  <td className="py-2.5 px-3 font-semibold text-zinc-500">Sex</td>
                  <td className="py-2.5 px-3">{psaRecord.sex === "M" ? "Male" : psaRecord.sex === "F" ? "Female" : psaRecord.sex}</td>
                  <td className="py-2.5 px-3">{sf1Entry?.sex || "-"}</td>
                  <td className="py-2.5 px-3 text-center">
                    {isSexMatch ? (
                      <span className="text-emerald-600 font-semibold flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Match
                      </span>
                    ) : (
                      <span className="text-rose-600 font-semibold flex items-center justify-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Conflict
                      </span>
                    )}
                  </td>
                </tr>

                <tr>
                  <td className="py-2.5 px-3 font-semibold text-zinc-500">Registry No.</td>
                  <td className="py-2.5 px-3 font-mono text-zinc-600 dark:text-zinc-400">
                    {psaRecord.registry_number || "Not detected"}
                  </td>
                  <td className="py-2.5 px-3 text-zinc-400">N/A (Civil only)</td>
                  <td className="py-2.5 px-3 text-center text-zinc-400">—</td>
                </tr>

                <tr>
                  <td className="py-2.5 px-3 font-semibold text-zinc-500">Mother Maiden Name</td>
                  <td className="py-2.5 px-3 text-zinc-700 dark:text-zinc-300">
                    {psaRecord.mother_maiden_name || "-"}
                  </td>
                  <td className="py-2.5 px-3 text-zinc-700 dark:text-zinc-300">
                    {sf1Entry?.parents_details?.mother_name || "-"}
                  </td>
                  <td className="py-2.5 px-3 text-center text-zinc-400">—</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Verification Notes */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Verification Notes / Conflict Justification (Recorded in Audit Trail):
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Verified against physical birth certificate presented during enrollment..."
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-zinc-50 dark:bg-zinc-800/80 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          {onFlagConflict && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleFlag}
              className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-lg transition-colors"
            >
              Flag Identity Conflict
            </button>
          )}
          {onConfirmVerification && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleConfirm}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
            >
              <UserCheck className="w-3.5 h-3.5" />
              Confirm Civil Verification
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

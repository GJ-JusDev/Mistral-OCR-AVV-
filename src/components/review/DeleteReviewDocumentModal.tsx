"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CONFIRMATION_PHRASE } from "@/types/reviewDeletion";
import { deleteReviewDocument } from "@/actions/reviewDeletion";
import {
  AlertTriangle,
  X,
  FileText,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
} from "lucide-react";

interface DeleteReviewDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentName?: string;
  studentName?: string;
  documentType?: string;
  onSuccess?: () => void;
}

export default function DeleteReviewDocumentModal({
  isOpen,
  onClose,
  documentId,
  documentName,
  studentName,
  documentType,
  onSuccess,
}: DeleteReviewDocumentModalProps) {
  const [confirmationInput, setConfirmationInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // The Delete button must remain disabled until the phrase matches exactly
  const isPhraseExact = confirmationInput.trim() === CONFIRMATION_PHRASE;

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isPhraseExact) {
      setErrorMessage(`Please type exactly: "${CONFIRMATION_PHRASE}"`);
      return;
    }

    setIsDeleting(true);
    try {
      const res = await deleteReviewDocument({
        documentId,
        confirmationPhrase: confirmationInput.trim(),
      });

      if (res.error) {
        setErrorMessage(res.error);
      } else {
        setSuccessMessage(
          "Document successfully deleted and archived. The action has been recorded in the Admin Audit Logs."
        );
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to delete review queue record.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    if (isDeleting) return;
    setConfirmationInput("");
    setErrorMessage(null);
    setSuccessMessage(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-red-50 to-rose-50/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100/80 text-red-700 border border-red-200">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="delete-modal-title"
                className="text-base sm:text-lg font-bold text-slate-900"
              >
                Delete Review Queue Record
              </h2>
              <p className="text-xs text-slate-500">
                Confirm removal of record from active verification queue
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isDeleting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/80 transition-colors disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleDelete} className="p-6 overflow-y-auto space-y-4">
          {/* Target Record Card */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span className="font-medium flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-slate-400" />
                Document Name:
              </span>
              <span className="font-semibold text-slate-800 truncate max-w-[240px]">
                {documentName || "Review Record"}
              </span>
            </div>
            {studentName && (
              <div className="flex items-center justify-between text-slate-600 border-t border-slate-200/60 pt-2">
                <span className="font-medium flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-slate-400" />
                  Student:
                </span>
                <span className="font-semibold text-slate-800">
                  {studentName}
                </span>
              </div>
            )}
            {documentType && (
              <div className="flex items-center justify-between text-slate-600 border-t border-slate-200/60 pt-2">
                <span className="font-medium">Form Category:</span>
                <span className="font-semibold uppercase tracking-wider text-slate-700 text-[11px]">
                  {documentType}
                </span>
              </div>
            )}
          </div>

          {/* Warning Banner */}
          <div className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-200 text-xs text-amber-900 leading-relaxed flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold block mb-0.5">Warning:</strong>
              This record will be removed from the active Review Queue. The deletion action will be recorded in the Admin Audit Logs.
            </div>
          </div>

          {/* Instruction & Confirmation Input */}
          <div className="space-y-2 pt-1">
            <label
              htmlFor="confirmation-input"
              className="block text-xs font-semibold text-slate-800"
            >
              To confirm deletion, type:{" "}
              <span className="font-mono font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                {CONFIRMATION_PHRASE}
              </span>
            </label>
            <input
              id="confirmation-input"
              type="text"
              autoComplete="off"
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder='Type "I am deleting this"'
              disabled={isDeleting || Boolean(successMessage)}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all font-mono"
              autoFocus
            />
            <p className="text-[11px] text-slate-500">
              The Delete button will activate once the confirmation phrase matches exactly.
            </p>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2 animate-in fade-in">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={isDeleting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={!isPhraseExact || isDeleting || Boolean(successMessage)}
              className="text-xs font-semibold px-4"
              leftIcon={
                isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )
              }
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

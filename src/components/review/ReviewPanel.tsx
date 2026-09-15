"use client";

import React, { useState } from "react";
import { Document } from "@/types/database";
import { Button } from "@/components/ui/Button";
import { Check, X, AlertCircle } from "lucide-react";

interface ReviewPanelProps {
  document: Document;
  onApprove: () => void;
  onReject: (reason: string) => void;
  isSubmitting?: boolean;
}

export default function ReviewPanel({ document, onApprove, onReject, isSubmitting }: ReviewPanelProps) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const handleReject = () => {
    if (rejectReason.trim()) {
      onReject(rejectReason);
      setIsRejecting(false);
      setRejectReason("");
    }
  };

  if (!document) return null;

  return (
    <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 shadow-sm">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Review Actions</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Approve this document to finalize validation, or reject it if there are unresolvable errors.
        </p>
      </div>

      {!isRejecting ? (
        <div className="flex flex-col sm:flex-row gap-4">
          <Button 
            onClick={onApprove} 
            disabled={isSubmitting || document.status === "approved" || document.status === "rejected"}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
          >
            <Check className="w-4 h-4 mr-2" />
            Approve Document
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setIsRejecting(true)}
            disabled={isSubmitting || document.status === "approved" || document.status === "rejected"}
            className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <X className="w-4 h-4 mr-2" />
            Reject Document
          </Button>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-950/30 rounded-md border border-red-100 dark:border-red-900/50">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <label htmlFor="reject-reason" className="block text-sm font-medium text-red-900 dark:text-red-200 mb-2">
                Reason for Rejection
              </label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please explain why this document is being rejected..."
                className="w-full p-3 text-sm rounded-md border border-red-200 dark:border-red-900/50 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-500/50 min-h-[100px] text-zinc-900 dark:text-zinc-100"
                autoFocus
              />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button 
              variant="outline" 
              onClick={() => {
                setIsRejecting(false);
                setRejectReason("");
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || isSubmitting}
            >
              Confirm Rejection
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

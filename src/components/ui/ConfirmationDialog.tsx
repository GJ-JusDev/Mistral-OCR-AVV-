"use client";

import React, { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { Button } from "./Button";

export interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "primary" | "success";
  isSubmitting?: boolean;
  isLoading?: boolean;
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  isSubmitting = false,
  isLoading = false,
}: ConfirmationDialogProps) {
  const activeLoading = isSubmitting || isLoading;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
        // Modern web guidance: autofocus on safe action
        cancelBtnRef.current?.focus();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !activeLoading) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, activeLoading, onClose]);

  if (!isOpen) return null;

  const iconVariants = {
    danger: <AlertTriangle className="h-6 w-6 text-red-600" />,
    warning: <AlertTriangle className="h-6 w-6 text-amber-600" />,
    primary: <Info className="h-6 w-6 text-[#174EA6]" />,
    success: <CheckCircle2 className="h-6 w-6 text-emerald-600" />,
  };

  const iconPills = {
    danger: "bg-red-100",
    warning: "bg-amber-100",
    primary: "bg-[#174EA6]/10",
    success: "bg-emerald-100",
  };

  const confirmVariants: Record<string, "danger" | "primary" | "secondary"> = {
    danger: "danger",
    warning: "danger",
    primary: "primary",
    success: "primary",
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      className="p-0 rounded-2xl bg-white shadow-2xl border border-slate-200/80 max-w-md w-full backdrop:bg-[#0B1F33]/60 backdrop:backdrop-blur-sm m-auto overflow-hidden animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconPills[variant]}`}
          >
            {iconVariants[variant]}
          </div>

          <div className="flex-1 min-w-0">
            <h3
              id="confirm-dialog-title"
              className="text-base sm:text-lg font-bold text-[#0B1F33]"
            >
              {title}
            </h3>
            <p
              id="confirm-dialog-desc"
              className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed"
            >
              {description}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={activeLoading}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
          <Button
            ref={cancelBtnRef}
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={activeLoading}
            className="w-full sm:w-auto"
          >
            {cancelLabel}
          </Button>

          <Button
            type="button"
            variant={confirmVariants[variant]}
            onClick={onConfirm}
            isLoading={activeLoading}
            disabled={activeLoading}
            className="w-full sm:w-auto"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

export default ConfirmationDialog;

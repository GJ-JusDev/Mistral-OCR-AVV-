"use client";

import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Clock, Check, HelpCircle, FileCheck } from "lucide-react";

export type StatusCategory =
  | "approved"
  | "validated"
  | "passed"
  | "complete"
  | "eligible"
  | "needs_review"
  | "pending"
  | "corrected"
  | "incomplete"
  | "not_eligible"
  | "rejected"
  | "declined"
  | "failed"
  | "extracted"
  | "submitted"
  | "default";

export interface StatusBadgeProps {
  status: string;
  category?: StatusCategory;
  showIcon?: boolean;
  size?: "sm" | "md";
  className?: string;
  customLabel?: string;
}

export function StatusBadge({
  status,
  category,
  showIcon = true,
  size = "sm",
  className = "",
  customLabel,
}: StatusBadgeProps) {
  if (!status) return null;

  const normalized = (category || status).toLowerCase().replace(/[\s-]/g, "_");

  // Determine styling based on category
  let badgeStyle = "bg-slate-100 text-slate-700 border-slate-200";
  let IconComponent = HelpCircle;

  if (
    normalized.includes("approved") ||
    normalized.includes("validated") ||
    normalized.includes("passed") ||
    normalized.includes("complete") ||
    normalized.includes("eligible_progression") ||
    normalized.includes("eligible_graduation") ||
    normalized === "eligible"
  ) {
    badgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-200/80";
    IconComponent = CheckCircle2;
  } else if (
    normalized.includes("needs_review") ||
    normalized.includes("pending") ||
    normalized.includes("corrected") ||
    normalized.includes("incomplete") ||
    normalized.includes("review")
  ) {
    badgeStyle = "bg-amber-50 text-amber-700 border-amber-200/80";
    IconComponent = normalized.includes("pending") ? Clock : AlertTriangle;
  } else if (
    normalized.includes("not_eligible") ||
    normalized.includes("rejected") ||
    normalized.includes("declined") ||
    normalized.includes("failed")
  ) {
    badgeStyle = "bg-red-50 text-red-700 border-red-200/80";
    IconComponent = XCircle;
  } else if (normalized.includes("extracted") || normalized.includes("submitted")) {
    badgeStyle = "bg-[#174EA6]/10 text-[#174EA6] border-[#174EA6]/20";
    IconComponent = FileCheck;
  }

  const sizes = {
    sm: "px-2.5 py-0.5 text-xs",
    md: "px-3 py-1 text-xs sm:text-sm",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
  };

  const label = customLabel || status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium border ${badgeStyle} ${sizes[size]} ${className}`}
    >
      {showIcon && <IconComponent className={`${iconSizes[size]} shrink-0`} />}
      <span>{label}</span>
    </span>
  );
}

export default StatusBadge;

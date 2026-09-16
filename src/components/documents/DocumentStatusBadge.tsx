"use client";

import React from "react";
import { Badge } from "@/components/ui/Badge";
import { DocumentStatus } from "@/types/database";

interface DocumentStatusBadgeProps {
  status: DocumentStatus;
}

export default function DocumentStatusBadge({ status }: DocumentStatusBadgeProps) {
  let variant: "default" | "info" | "success" | "warning" | "error" = "default";
  
  if (!status) return null;
  
  const label = String(status).replace(/_/g, " ").toUpperCase();

  switch (status) {
    case "submitted":
      variant = "default";
      break;
    case "extracted":
      variant = "info";
      break;
    case "validated":
    case "approved":
      variant = "success";
      break;
    case "needs_review":
      variant = "warning";
      break;
    case "rejected":
      variant = "error";
      break;
    default:
      variant = "default";
  }

  return <Badge variant={variant}>{label}</Badge>;
}

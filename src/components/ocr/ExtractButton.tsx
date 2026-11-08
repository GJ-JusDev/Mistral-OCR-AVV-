"use client";

import React from "react";
import { Button } from "@/components/ui/Button";

export interface ExtractButtonProps {
  onClick: () => void;
  isExtracting: boolean;
  disabled?: boolean;
  cooldownSeconds?: number | null;
  label?: string;
}

export default function ExtractButton({
  onClick,
  isExtracting,
  disabled = false,
  cooldownSeconds = null,
  label,
}: ExtractButtonProps) {
  const isCoolingDown = typeof cooldownSeconds === "number" && cooldownSeconds > 0;
  const buttonText = isExtracting
    ? "Extracting..."
    : isCoolingDown
    ? `Please wait (${cooldownSeconds}s)...`
    : label ?? "Extract Data";

  return (
    <Button
      onClick={onClick}
      disabled={disabled || isExtracting || isCoolingDown}
      isLoading={isExtracting}
      size="lg"
      className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
    >
      {buttonText}
    </Button>
  );
}

"use client";

import React from "react";
import { Button } from "@/components/ui/Button";

export interface ExtractButtonProps {
  onClick: () => void;
  isExtracting: boolean;
  disabled?: boolean;
}

export default function ExtractButton({
  onClick,
  isExtracting,
  disabled = false,
}: ExtractButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled || isExtracting}
      isLoading={isExtracting}
      size="lg"
      className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
    >
      {isExtracting ? "Extracting..." : "Extract Data"}
    </Button>
  );
}

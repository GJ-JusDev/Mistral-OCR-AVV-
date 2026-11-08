"use client";

import React from "react";
import Image from "next/image";

export interface LoadingStateProps {
  message?: string;
  subMessage?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = "Loading records...",
  subMessage = "Please wait while the system verifies data",
  size = "md",
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-xl bg-white/70 backdrop-blur-sm border border-slate-200/80 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="relative flex items-center justify-center mb-4">
        {/* Soft pulse glow */}
        <div className="absolute h-14 w-14 rounded-full bg-[#174EA6]/20 animate-ping" />
        {/* Spinner circle */}
        <div className="relative h-12 w-12 rounded-full border-3 border-slate-200 border-t-[#174EA6] animate-spin" />
      </div>

      <h4 className="text-sm sm:text-base font-semibold text-[#0B1F33]">
        {message}
      </h4>
      {subMessage && (
        <p className="mt-1 text-xs text-slate-500 max-w-xs">{subMessage}</p>
      )}
    </div>
  );
};

export default LoadingState;

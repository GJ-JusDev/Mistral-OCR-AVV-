"use client";

import React from "react";

export interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({
  title,
  description,
  children,
  className = "",
}: FormSectionProps) {
  return (
    <div className={`space-y-4 pt-2 ${className}`}>
      <div className="border-b border-slate-200/80 pb-2">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-[#0B1F33]">
          {title}
        </h4>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default FormSection;

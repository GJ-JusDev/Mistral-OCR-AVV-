"use client";

import React from "react";

export interface FormFieldProps {
  id?: string;
  label: string;
  required?: boolean;
  error?: string;
  helperText?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  id,
  label,
  required = false,
  error,
  helperText,
  children,
  className = "",
}: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      <label
        htmlFor={id}
        className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-1"
      >
        <span>{label}</span>
        {required && (
          <span className="text-red-500 font-bold" title="Required field">
            *
          </span>
        )}
      </label>

      {children}

      {helperText && !error && (
        <span className="text-[11px] sm:text-xs text-slate-500">{helperText}</span>
      )}

      {error && (
        <span
          role="alert"
          className="text-[11px] sm:text-xs font-medium text-red-600 flex items-center gap-1 mt-0.5"
        >
          {error}
        </span>
      )}
    </div>
  );
}

export default FormField;

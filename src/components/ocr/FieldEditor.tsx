"use client";

import React from "react";
import { Input } from "@/components/ui/Input";

export interface FieldEditorProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  originalValue?: string;
  error?: string;
}

export default function FieldEditor({
  label,
  value,
  onChange,
  originalValue,
  error,
}: FieldEditorProps) {
  const isModified = originalValue !== undefined && value !== originalValue;

  return (
    <div className="flex flex-col w-full">
      <div className="flex justify-between items-center mb-1">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
        {isModified && (
          <span className="text-xs text-amber-700 dark:text-amber-500 font-medium">
            Modified
          </span>
        )}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
      />
    </div>
  );
}

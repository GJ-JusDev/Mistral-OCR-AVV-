"use client";

import React, { forwardRef, ComponentPropsWithoutRef } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends ComponentPropsWithoutRef<'select'> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', label, error, options, placeholder, ...props }, ref) => {
    return (
      <div className="flex flex-col w-full">
        {label && <label className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>}
        <select
          ref={ref}
          className={`rounded-lg border bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-zinc-900 dark:text-zinc-100 ${
            error ? 'border-red-500 focus:ring-red-500' : 'border-zinc-300 dark:border-zinc-700'
          } ${className}`}
          {...props}
        >
          {placeholder && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <span className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
    );
  }
);
Select.displayName = 'Select';

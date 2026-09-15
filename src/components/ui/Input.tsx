"use client";

import React, { forwardRef, ComponentPropsWithoutRef } from 'react';

export interface InputProps extends ComponentPropsWithoutRef<'input'> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, ...props }, ref) => {
    return (
      <div className="flex flex-col w-full">
        {label && <label className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>}
        <input
          ref={ref}
          className={`rounded-lg border bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 ${
            error ? 'border-red-500 focus:ring-red-500' : 'border-zinc-300 dark:border-zinc-700'
          } ${className}`}
          {...props}
        />
        {error && <span className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
    );
  }
);
Input.displayName = 'Input';

"use client";

import React from "react";
import { Search } from "lucide-react";

export interface DataTableContainerProps {
  title?: string;
  description?: string;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  itemCount?: number;
  totalCount?: number;
  children: React.ReactNode;
  className?: string;
}

export function DataTableContainer({
  title,
  description,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search records...",
  actions,
  filters,
  itemCount,
  totalCount,
  children,
  className = "",
}: DataTableContainerProps) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden ${className}`}
    >
      {(title || description || actions || onSearchChange || filters) && (
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col gap-3">
          {/* Title & Actions Row */}
          {(title || actions) && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                {title && (
                  <h3 className="text-base font-semibold text-[#0B1F33]">
                    {title}
                  </h3>
                )}
                {description && (
                  <p className="text-xs text-slate-500 mt-0.5">{description}</p>
                )}
              </div>
              {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
            </div>
          )}

          {/* Search & Filter Toolbar */}
          {(onSearchChange || filters) && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              {onSearchChange && (
                <div className="relative flex-1 max-w-md">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    value={searchValue ?? ""}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm bg-slate-50/50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:bg-white focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
                  />
                </div>
              )}
              {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
            </div>
          )}
        </div>
      )}

      {/* Table Content */}
      <div className="overflow-x-auto">{children}</div>

      {/* Footer count indicator if provided */}
      {typeof itemCount === "number" && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-2.5 sm:px-6 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing <strong className="text-slate-700">{itemCount}</strong>
            {typeof totalCount === "number" && totalCount !== itemCount
              ? ` of ${totalCount} total`
              : " records"}
          </span>
        </div>
      )}
    </div>
  );
}

export default DataTableContainer;

"use client";

import React from "react";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { ValidationReport } from "@/types/validation";
import { filterValidationResults, normalizeValidationItem, NormalizedValidationItem } from "@/lib/validation/summaryUtils";

export { normalizeValidationItem, filterValidationResults };
export type { NormalizedValidationItem };

interface ValidationSummaryProps {
  report: ValidationReport;
}

export default function ValidationSummary({ report }: ValidationSummaryProps) {
  if (!report || !Array.isArray(report.results)) {
    return null;
  }

  // 1. Defensively normalize & filter out passing format rules for absent/empty fields
  const displayResults = filterValidationResults(report.results);

  const passedCount = displayResults.filter((r) => r.passed).length;
  const failedCount = displayResults.filter((r) => !r.passed && r.severity === "error").length;
  const warningCount = displayResults.filter((r) => !r.passed && r.severity === "warning").length;

  return (
    <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-6 border-b border-zinc-100 dark:border-zinc-900 pb-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Validation Summary</h3>
        <div className="flex gap-4 text-sm">
          <span className="text-emerald-600 dark:text-emerald-500 font-medium">{passedCount} Passed</span>
          {warningCount > 0 && <span className="text-amber-600 dark:text-amber-500 font-medium">{warningCount} Warnings</span>}
          {failedCount > 0 && <span className="text-red-600 dark:text-red-500 font-medium">{failedCount} Failed</span>}
        </div>
      </div>

      {displayResults.length === 0 ? (
        <p className="text-zinc-500 text-sm italic">No validation results available.</p>
      ) : (
        <ul className="space-y-3">
          {displayResults.map((result, index) => (
            <li
              key={index}
              className="flex items-start gap-3 p-3 rounded-md bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800/50"
            >
              <div className="mt-0.5 shrink-0">
                {result.passed ? (
                  <CheckCircle className="w-5 h-5 text-emerald-500" />
                ) : result.severity === "warning" ? (
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
              </div>
              <div className="flex-1">
                {(result.fieldName || result.ruleName) && (
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 capitalize">
                      {(result.fieldName || result.ruleName).replace(/_/g, " ")}
                    </p>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.2 rounded uppercase ${
                        result.passed
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : result.severity === "warning"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                          : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                      }`}
                    >
                      {result.passed ? "Pass" : result.severity}
                    </span>
                  </div>
                )}
                <p
                  className={`text-sm mt-0.5 ${
                    result.passed
                      ? "text-zinc-600 dark:text-zinc-400"
                      : result.severity === "warning"
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400 font-medium"
                  }`}
                >
                  {result.message}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

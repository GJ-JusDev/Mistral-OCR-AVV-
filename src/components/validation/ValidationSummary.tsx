"use client";

import React from "react";
import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { ValidationReport, ValidationRuleResult } from "@/types/validation";

interface ValidationSummaryProps {
  report: ValidationReport;
}

export default function ValidationSummary({ report }: ValidationSummaryProps) {
  if (!report || !report.results) {
    return null;
  }

  const passedCount = report.results.filter(r => r.severity === 'pass').length;
  const failedCount = report.results.filter(r => r.severity === 'error').length;
  const warningCount = report.results.filter(r => r.severity === 'warning').length;

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
      
      {report.results.length === 0 ? (
        <p className="text-zinc-500 text-sm italic">No validation results available.</p>
      ) : (
        <ul className="space-y-3">
          {report.results.map((result, index) => (
            <li key={index} className="flex items-start gap-3 p-3 rounded-md bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800/50">
              <div className="mt-0.5 shrink-0">
                {result.severity === 'pass' && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                {result.severity === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                {result.severity === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
              </div>
              <div>
                {result.fieldName && (
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 capitalize">
                    {result.fieldName.replace(/_/g, " ")}
                  </p>
                )}
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
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

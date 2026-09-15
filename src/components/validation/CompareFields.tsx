"use client";

import React from "react";
import { Student } from "@/types/database";
import { ExtractedFields } from "@/types/validation";
import { AlertCircle } from "lucide-react";

interface CompareFieldsProps {
  extractedFields: ExtractedFields;
  officialRecord?: Student | null;
}

export default function CompareFields({ extractedFields, officialRecord }: CompareFieldsProps) {
  if (!extractedFields) return null;

  if (!officialRecord) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-medium text-amber-900 dark:text-amber-200">No matching record found</h4>
            <p className="text-sm text-amber-700 dark:text-amber-400/80 mt-1">
              Could not find an official student record matching the extracted data. Please review carefully.
            </p>
          </div>
        </div>
        
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 font-medium">Field</th>
                <th className="px-4 py-3 font-medium">Extracted Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-950">
              {Object.entries(extractedFields).map(([key, value]) => (
                <tr key={key}>
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100 capitalize">
                    {key.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {String(value || "-")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const allKeys = Array.from(new Set([...Object.keys(extractedFields), ...Object.keys(officialRecord)]));
  const displayKeys = allKeys.filter(k => !['id', 'created_at', 'updated_at'].includes(k));

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400 uppercase text-xs">
          <tr>
            <th className="px-4 py-3 font-medium">Field</th>
            <th className="px-4 py-3 font-medium">Extracted (OCR)</th>
            <th className="px-4 py-3 font-medium">Official Record (DB)</th>
            <th className="px-4 py-3 font-medium w-24 text-center">Match</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-950">
          {displayKeys.map((key) => {
            const extValue = (extractedFields as any)[key];
            const offValue = (officialRecord as any)[key];
            
            const extStr = String(extValue || "").trim().toLowerCase();
            const offStr = String(offValue || "").trim().toLowerCase();
            const isMatch = extStr && offStr && extStr === offStr;
            
            return (
              <tr key={key}>
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100 capitalize">
                  {key.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{extValue ? String(extValue) : "-"}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{offValue ? String(offValue) : "-"}</td>
                <td className="px-4 py-3 text-center">
                  {isMatch ? (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-500 font-bold text-xs" title="Match">✓</span>
                  ) : extStr && offStr ? (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-500 font-bold text-xs" title="Mismatch">✗</span>
                  ) : (
                    <span className="text-zinc-400">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

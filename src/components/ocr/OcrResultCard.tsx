"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import FieldEditor from "./FieldEditor";
import { ExtractedFields } from "@/types/documents";

export interface OcrResultCardProps {
  fields: ExtractedFields | null;
  onFieldChange?: (field: keyof ExtractedFields, value: string) => void;
  rawText?: string;
}

export default function OcrResultCard({
  fields,
  onFieldChange,
  rawText,
}: OcrResultCardProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (!fields) return null;

  const headerAction = (
    <button
      onClick={() => setShowRaw(!showRaw)}
      className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
    >
      {showRaw ? "Show Fields" : "Show Raw Text"}
    </button>
  );

  return (
    <Card 
      title="Extraction Results" 
      description="Review and edit extracted fields"
      headerAction={headerAction}
      className="w-full mt-6"
    >
      {showRaw ? (
        <div className="bg-zinc-100 dark:bg-zinc-900 p-4 rounded-md overflow-auto max-h-96 whitespace-pre-wrap font-mono text-sm text-zinc-900 dark:text-zinc-100">
          {rawText || "No raw text available."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(fields).map(([key, value]) => {
            if (key === "grades" && Array.isArray(value)) {
              return (
                <div key={key} className="col-span-1 md:col-span-2 flex flex-col gap-2 mt-4">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    GRADES
                  </span>
                  <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-700">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead className="bg-zinc-50 dark:bg-zinc-800">
                        <tr className="border-b border-zinc-200 dark:border-zinc-700">
                          <th className="py-2 px-3 font-semibold text-zinc-600 dark:text-zinc-300">Category</th>
                          <th className="py-2 px-3 font-semibold text-zinc-600 dark:text-zinc-300">Subject</th>
                          <th className="py-2 px-3 font-semibold text-zinc-600 dark:text-zinc-300">Q1</th>
                          <th className="py-2 px-3 font-semibold text-zinc-600 dark:text-zinc-300">Q2</th>
                          <th className="py-2 px-3 font-semibold text-zinc-600 dark:text-zinc-300">Final</th>
                          <th className="py-2 px-3 font-semibold text-zinc-600 dark:text-zinc-300 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-zinc-900">
                        {value.map((g, idx) => (
                          <tr key={idx} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                            <td className="py-2 px-3 text-zinc-500">{g.category || "-"}</td>
                            <td className="py-2 px-3 font-medium text-zinc-900 dark:text-zinc-100">{g.subject}</td>
                            <td className="py-2 px-3 text-zinc-700 dark:text-zinc-300">{g.q1 ?? "-"}</td>
                            <td className="py-2 px-3 text-zinc-700 dark:text-zinc-300">{g.q2 ?? "-"}</td>
                            <td className="py-2 px-3 font-semibold text-zinc-900 dark:text-zinc-100">{g.final ?? "-"}</td>
                            <td className="py-2 px-3 text-right">
                              <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${
                                g.status === "Passed" ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400" :
                                g.status === "Failed" ? "text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400" :
                                "text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400"
                              }`}>
                                {g.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }

            if (key === "attendance" && Array.isArray(value)) {
              const months = fields.attendance_months || [];
              return (
                <div key={key} className="col-span-1 md:col-span-2 flex flex-col gap-2 mt-4">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    ATTENDANCE
                  </span>
                  <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-700">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead className="bg-zinc-50 dark:bg-zinc-800">
                        <tr className="border-b border-zinc-200 dark:border-zinc-700">
                          <th className="py-2 px-3 font-semibold text-zinc-600 dark:text-zinc-300">Metric</th>
                          {months.length > 0 ? (
                            months.map((m: string, i: number) => (
                              <th key={i} className="py-2 px-3 font-semibold text-zinc-600 dark:text-zinc-300 text-center">{m}</th>
                            ))
                          ) : (
                            <th className="py-2 px-3 font-semibold text-zinc-600 dark:text-zinc-300">Values</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-zinc-900">
                        {value.map((a: any, idx: number) => (
                          <tr key={idx} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                            <td className="py-2 px-3 font-medium text-zinc-900 dark:text-zinc-100">{a.label}</td>
                            {months.length > 0 ? (
                              months.map((_, i) => (
                                <td key={i} className="py-2 px-3 text-zinc-700 dark:text-zinc-300 text-center">
                                  {a.values[i] || "-"}
                                </td>
                              ))
                            ) : (
                              <td className="py-2 px-3 text-zinc-700 dark:text-zinc-300 font-mono text-xs">
                                {a.values.join("  ")}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }

            if (key === "attendance_months") return null;

            if (onFieldChange) {
              return (
                <FieldEditor
                  key={key}
                  label={key.replace(/_/g, ' ').toUpperCase()}
                  value={value as string}
                  onChange={(val) => onFieldChange(key, val)}
                />
              );
            }
            return (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  {key.replace(/_/g, ' ')}
                </span>
                <div className="bg-zinc-50 dark:bg-zinc-800 p-2 rounded-md border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100">
                  {value as string || <span className="text-zinc-400 italic">Empty</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export default function StudentsPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStudents() {
      try {
        const res = await fetch("/api/students");
        if (!res.ok) throw new Error("Failed to fetch students");
        const data = await res.json();
        setStudents(data.students || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchStudents();
  }, []);

  return (
    <PageContainer>
      <Header title="Student Directory" />
      
      <div className="mt-6">
        {loading ? (
          <div className="flex justify-center p-8">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-red-600 p-4 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-md">
            Error: {error}
          </div>
        ) : students.length === 0 ? (
          <div className="p-8 text-center bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <p className="text-zinc-500 dark:text-zinc-400">No students found.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
                <thead className="bg-zinc-50 dark:bg-zinc-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">LRN</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Grade</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">School</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                  {students.map((student, i) => (
                    <tr key={student.id || i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {student.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                        {student.lrn}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                        {student.grade}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                        {student.school}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          student.status === 'active' || !student.status
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' 
                            : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}>
                          {student.status || 'Active'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}

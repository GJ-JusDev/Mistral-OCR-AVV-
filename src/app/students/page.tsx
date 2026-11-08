"use client";

import React, { useEffect, useState, useMemo } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  StudentDirectoryItem,
  StudentDirectoryFilters,
  filterStudentDirectoryItems,
  getContextualGradeLevels,
  extractDistinctSections,
  extractDistinctSchoolYears,
  maskLrn,
} from "@/lib/students/studentDirectory";
import {
  Search,
  Filter,
  RotateCcw,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  FileText,
  GraduationCap,
} from "lucide-react";
import Link from "next/link";

// Backwards compatibility alias
export type Student = StudentDirectoryItem;

export default function StudentsPage() {
  const [allStudents, setAllStudents] = useState<StudentDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [schoolLevel, setSchoolLevel] = useState("Senior High School");
  const [gradeLevel, setGradeLevel] = useState("All");
  const [section, setSection] = useState("All");
  const [reviewStatus, setReviewStatus] = useState("All");
  const [validationStatus, setValidationStatus] = useState("All");
  const [schoolYear, setSchoolYear] = useState("All");

  // Privacy: LRN masking toggle
  const [showFullLrn, setShowFullLrn] = useState(false);

  // Fetch initial student records
  useEffect(() => {
    async function fetchStudents() {
      setLoading(true);
      try {
        const res = await fetch("/api/students");
        if (!res.ok) throw new Error("Failed to fetch students");
        const data = await res.json();
        const list: StudentDirectoryItem[] = Array.isArray(data)
          ? data
          : data.students || [];
        setAllStudents(list);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An unexpected error occurred while loading student directory.");
        }
      } finally {
        setLoading(false);
      }
    }
    fetchStudents();
  }, []);

  // Contextual Grade Options according to selected School Level
  const contextualGrades = useMemo(() => {
    return getContextualGradeLevels(schoolLevel);
  }, [schoolLevel]);

  // If selected gradeLevel is outside the new schoolLevel's range, reset to All
  const handleSchoolLevelChange = (newLevel: string) => {
    setSchoolLevel(newLevel);
    if (gradeLevel !== "All") {
      const allowed = getContextualGradeLevels(newLevel);
      if (!allowed.includes(gradeLevel)) {
        setGradeLevel("All");
      }
    }
  };

  // Distinct section choices dynamically narrowed to current school/grade level
  const dynamicSections = useMemo(() => {
    return extractDistinctSections(allStudents, schoolLevel, gradeLevel);
  }, [allStudents, schoolLevel, gradeLevel]);

  // Distinct school years from records
  const dynamicSchoolYears = useMemo(() => {
    return extractDistinctSchoolYears(allStudents);
  }, [allStudents]);

  // Filter combination with strict AND logic
  const filteredStudents = useMemo(() => {
    const filters: StudentDirectoryFilters = {
      query: searchQuery,
      school_level: schoolLevel,
      grade_level: gradeLevel,
      section: section,
      review_status: reviewStatus,
      validation_status: validationStatus,
      school_year: schoolYear,
    };
    return filterStudentDirectoryItems(allStudents, filters);
  }, [
    allStudents,
    searchQuery,
    schoolLevel,
    gradeLevel,
    section,
    reviewStatus,
    validationStatus,
    schoolYear,
  ]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    schoolLevel !== "Senior High School" ||
    gradeLevel !== "All" ||
    section !== "All" ||
    reviewStatus !== "All" ||
    validationStatus !== "All" ||
    schoolYear !== "All";

  const handleClearFilters = () => {
    setSearchQuery("");
    setSchoolLevel("Senior High School");
    setGradeLevel("All");
    setSection("All");
    setReviewStatus("All");
    setValidationStatus("All");
    setSchoolYear("All");
  };

  return (
    <PageContainer>
      <Header
        title="Student Directory"
        description="Official student profiles, enrollment, human document review status, and academic validation records."
      />

      <div className="mt-6 space-y-6">
        {/* Search and Filters Bar */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-sm space-y-4">
          {/* Top row: Search input + Actions */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search student name or LRN..."
                className="w-full pl-10 pr-4 py-2 text-sm bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* LRN Masking Toggle */}
              <button
                type="button"
                onClick={() => setShowFullLrn(!showFullLrn)}
                title={showFullLrn ? "Mask LRNs for privacy" : "Reveal full 12-digit LRNs"}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                {showFullLrn ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    <span>Mask LRNs</span>
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    <span>Reveal LRNs</span>
                  </>
                )}
              </button>

              {/* Clear Filters Button */}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Clear Filters</span>
                </button>
              )}
            </div>
          </div>

          {/* Filter dropdowns grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800/60">
            {/* School Level Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                School Level
              </label>
              <select
                value={schoolLevel}
                onChange={(e) => handleSchoolLevelChange(e.target.value)}
                className="w-full text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="Senior High School">Senior High School</option>
              </select>
            </div>

            {/* Grade Level Filter (Contextual) */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Grade Level
              </label>
              <select
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                className="w-full text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="All">All SHS Grades</option>
                {contextualGrades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {/* Section Filter (Dynamic) */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Section
              </label>
              <select
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="w-full text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="All">All Sections</option>
                {dynamicSections.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
            </div>

            {/* Review Status Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Review Status
              </label>
              <select
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value)}
                className="w-full text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="All">All Reviews</option>
                <option value="Approved">Approved</option>
                <option value="Pending Review">Pending Review</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>

            {/* Validation Status Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                Validation Status
              </label>
              <select
                value={validationStatus}
                onChange={(e) => setValidationStatus(e.target.value)}
                className="w-full text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="All">All Validations</option>
                <option value="Passed">Passed</option>
                <option value="Failed">Failed</option>
                <option value="Needs Verification">Needs Attention</option>
              </select>
            </div>

            {/* School Year Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                School Year
              </label>
              <select
                value={schoolYear}
                onChange={(e) => setSchoolYear(e.target.value)}
                className="w-full text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="All">All Years</option>
                {dynamicSchoolYears.map((sy) => (
                  <option key={sy} value={sy}>
                    {sy}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Results Count & Metadata Banner */}
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 px-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {hasActiveFilters ? (
                <>
                  Showing{" "}
                  <strong className="text-zinc-900 dark:text-zinc-100">
                    {filteredStudents.length}
                  </strong>{" "}
                  of {allStudents.length} {allStudents.length === 1 ? "student" : "students"}
                </>
              ) : (
                <>
                  <strong className="text-zinc-900 dark:text-zinc-100">
                    {allStudents.length}
                  </strong>{" "}
                  {allStudents.length === 1 ? "student" : "students"} in directory
                </>
              )}
            </span>
            {hasActiveFilters && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium border border-blue-200 dark:border-blue-800">
                Filtered
              </span>
            )}
          </div>

          <div className="text-[11px] italic">
            Review Status = Human Document Verification &bull; Validation Status = DepEd Academic Standing
          </div>
        </div>

        {/* Content Area: Loading, Error, Empty States, or Table */}
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
            <LoadingSpinner size="lg" />
            <p className="mt-3 text-xs text-zinc-500">Loading verified student records...</p>
          </div>
        ) : error ? (
          <div className="text-red-600 p-4 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-800 text-sm flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <strong>Error loading directory:</strong> {error}
            </div>
          </div>
        ) : allStudents.length === 0 ? (
          /* Empty State 1: Directory itself has zero students */
          <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
            <GraduationCap className="mx-auto h-12 w-12 text-zinc-300 dark:text-zinc-600 mb-3" />
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              No students found in the directory.
            </h3>
            <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">
              Verified learner records are automatically added when scanned SF9 / SF10 documents are reviewed and approved.
            </p>
          </div>
        ) : filteredStudents.length === 0 ? (
          /* Empty State 2: Filters produced zero matches */
          <div className="p-12 text-center bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-3">
            <Filter className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                No students match the selected filters.
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Try adjusting your search query, school level, or grade filters to broaden your search.
              </p>
            </div>
            <div>
              <button
                onClick={handleClearFilters}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Filters</span>
              </button>
            </div>
          </div>
        ) : (
          /* Directory Table */
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800 text-left text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-800/70 text-xs font-semibold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5">Student</th>
                    <th className="px-4 py-3.5">LRN</th>
                    <th className="px-4 py-3.5">School Level</th>
                    <th className="px-3 py-3.5 text-center">Grade</th>
                    <th className="px-4 py-3.5">Section</th>
                    <th className="px-4 py-3.5 text-center">Review Status</th>
                    <th className="px-4 py-3.5 text-center">Validation Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filteredStudents.map((student) => {
                    const displayLrn = showFullLrn ? student.lrn : student.masked_lrn;

                    return (
                      <tr
                        key={student.id}
                        className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                      >
                        {/* 1. Student / Learner Name */}
                        <td className="px-5 py-3.5">
                          <div className="flex flex-col">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                              {student.latest_document_id ? (
                                <Link
                                  href={`/documents/${student.latest_document_id}`}
                                  className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline flex items-center gap-1.5"
                                  title="View verified document"
                                >
                                  {student.full_name}
                                  <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                                </Link>
                              ) : (
                                student.full_name
                              )}
                            </span>
                            <span className="text-xs text-zinc-400 dark:text-zinc-500">
                              {student.school_name !== "-" ? student.school_name : "DepEd Learner Record"}
                            </span>
                          </div>
                        </td>

                        {/* 2. LRN (Masked / Revealed) */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className="font-mono text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700"
                            title={showFullLrn ? "Full LRN" : "Masked LRN for privacy"}
                          >
                            {displayLrn}
                          </span>
                        </td>

                        {/* 3. School Level */}
                        <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              student.school_level === "Senior High School"
                                ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800"
                                : student.school_level === "Junior High School"
                                ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
                                : student.school_level === "Elementary"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                                : "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
                            }`}
                          >
                            {student.school_level}
                          </span>
                        </td>

                        {/* 4. Grade */}
                        <td className="px-3 py-3.5 whitespace-nowrap text-xs font-medium text-center text-zinc-800 dark:text-zinc-200">
                          {student.grade_level}
                        </td>

                        {/* 5. Section */}
                        <td className="px-4 py-3.5 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400">
                          {student.section !== "-" ? (
                            <span className="font-medium text-zinc-800 dark:text-zinc-200">
                              {student.section}
                            </span>
                          ) : (
                            <span className="text-zinc-400 italic">-</span>
                          )}
                        </td>

                        {/* 6. Review Status (Document Human Verification) */}
                        <td className="px-4 py-3.5 whitespace-nowrap text-center">
                          {student.review_status === "Approved" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                              <CheckCircle2 className="h-3 w-3" />
                              Approved
                            </span>
                          ) : student.review_status === "Rejected" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border border-red-300 dark:border-red-800">
                              <XCircle className="h-3 w-3" />
                              Rejected
                            </span>
                          ) : student.review_status === "Pending Review" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                              <Clock className="h-3 w-3" />
                              Pending Review
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                              No Document
                            </span>
                          )}
                        </td>

                        {/* 7. Validation Status (DepEd Academic Standing) */}
                        <td className="px-4 py-3.5 whitespace-nowrap text-center">
                          {student.validation_status === "Passed" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                              <CheckCircle2 className="h-3 w-3" />
                              Passed
                            </span>
                          ) : student.validation_status === "Failed" ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                              <XCircle className="h-3 w-3" />
                              Failed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                              <AlertCircle className="h-3 w-3" />
                              Needs Attention
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}

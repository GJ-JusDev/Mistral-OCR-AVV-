/**
 * Student Directory Data Processing, Normalization, and Filtering Engine.
 *
 * Implements authoritative DepEd AVV student directory rules:
 * - Clear separation of Review Status (human verification) vs Validation Status (academic engine)
 * - School level derivation (Elementary, Junior High School, Senior High School)
 * - Case-insensitive multi-field search (first, middle, last, full name, LRN)
 * - Dynamic section discovery and contextual grade filtering
 * - Zero calculation of pass/fail (preserves authoritative overall_status)
 * - LRN privacy masking
 */

export type SchoolLevel = "Elementary" | "Junior High School" | "Senior High School" | "Unknown";

export type ReviewStatus = "Approved" | "Pending Review" | "Rejected" | "No Document";

export type ValidationStatus = "Passed" | "Failed" | "Needs Verification";

export interface StudentDirectoryItem {
  id: string;
  lrn: string;
  masked_lrn: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  suffix?: string | null;
  full_name: string;
  grade_level: string;
  normalized_grade: number | null;
  school_level: SchoolLevel;
  section: string;
  school_year: string;
  school_name: string;
  review_status: ReviewStatus;
  validation_status: ValidationStatus;
  student_status: string;
  latest_document_id?: string | null;
}

export interface StudentDirectoryFilters {
  query?: string;
  school_level?: string;
  grade_level?: string;
  section?: string;
  review_status?: string;
  validation_status?: string;
  school_year?: string;
}

/**
 * Mask LRN for privacy display (e.g. "********0043").
 */
export function maskLrn(lrn: string): string {
  if (!lrn || typeof lrn !== "string") return "************";
  const clean = lrn.trim();
  if (clean.length <= 4) return clean;
  return "********" + clean.slice(-4);
}

/**
 * Extract integer grade number from a grade string (e.g. "Grade 11" -> 11, "11" -> 11, "Kinder" -> 0).
 */
export function parseGradeNumber(rawGrade?: string | null): number | null {
  if (!rawGrade) return null;
  const lower = rawGrade.toLowerCase().trim();
  if (lower.includes("kinder")) return 0;

  // Check Roman numerals commonly used in DepEd
  const romanMap: Record<string, number> = {
    "xii": 12, "xi": 11, "x": 10, "ix": 9, "viii": 8, "vii": 7,
    "vi": 6, "v": 5, "iv": 4, "iii": 3, "ii": 2, "i": 1
  };
  for (const [roman, num] of Object.entries(romanMap)) {
    const rx = new RegExp(`\\b${roman}\\b`, "i");
    if (rx.test(lower)) return num;
  }

  const numMatch = lower.match(/\b(\d+)\b/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (!isNaN(val) && val >= 0 && val <= 12) return val;
  }
  return null;
}

/**
 * Determine School Level from authoritative grade level, document form version, or track.
 */
export function deriveSchoolLevel(
  gradeLevel?: string | null,
  docFormVersion?: string | null,
  shsTrack?: string | null,
  extractedFields?: any
): SchoolLevel {
  const gradeNum = parseGradeNumber(gradeLevel);

  if (gradeNum !== null) {
    if (gradeNum >= 0 && gradeNum <= 6) return "Elementary";
    if (gradeNum >= 7 && gradeNum <= 10) return "Junior High School";
    if (gradeNum >= 11 && gradeNum <= 12) return "Senior High School";
  }

  // Secondary metadata inspection
  const formLower = (docFormVersion || "").toLowerCase();
  if (formLower.includes("shs") || shsTrack || extractedFields?.track_strand) {
    return "Senior High School";
  }
  if (formLower.includes("jhs") || formLower.includes("junior")) {
    return "Junior High School";
  }
  if (formLower.includes("elem") || formLower.includes("primary")) {
    return "Elementary";
  }

  // Form type inspection from extracted fields
  const extractedLevel = (extractedFields?.school_level || "").toLowerCase();
  if (extractedLevel.includes("senior") || extractedLevel.includes("shs")) return "Senior High School";
  if (extractedLevel.includes("junior") || extractedLevel.includes("jhs")) return "Junior High School";
  if (extractedLevel.includes("elem")) return "Elementary";

  return "Unknown";
}

/**
 * Derive Review Status from linked documents.
 */
export function deriveReviewStatus(documents?: any[]): ReviewStatus {
  if (!Array.isArray(documents) || documents.length === 0) {
    return "No Document";
  }

  // If any document is approved, the student's record is Approved
  if (documents.some((d) => (d.status || "").toLowerCase() === "approved")) {
    return "Approved";
  }

  // If all documents are rejected, status is Rejected
  if (documents.every((d) => (d.status || "").toLowerCase() === "rejected")) {
    return "Rejected";
  }

  // Otherwise it is pending human review
  return "Pending Review";
}

/**
 * Derive Validation Status from authoritative overall_status.
 * Zero calculation is performed.
 */
export function deriveValidationStatus(overallStatus?: string | null): ValidationStatus {
  if (overallStatus === "Passed") return "Passed";
  if (overallStatus === "Failed") return "Failed";
  return "Needs Verification";
}

/**
 * Transform a database student row (with optional joined documents and schools)
 * into a normalized StudentDirectoryItem.
 */
export function deriveStudentDirectoryItem(student: any): StudentDirectoryItem {
  const lrn = String(student.lrn || "").trim();
  const firstName = String(student.first_name || "").trim();
  const middleName = student.middle_name ? String(student.middle_name).trim() : null;
  const lastName = String(student.last_name || "").trim();
  const suffix = student.suffix ? String(student.suffix).trim() : null;

  // Format full name: "Last Name, First Name Middle Name Suffix" or standard concatenation
  const nameParts = [firstName, middleName, lastName, suffix].filter(Boolean);
  const fullName = student.name || (lastName ? `${lastName}, ${[firstName, middleName, suffix].filter(Boolean).join(" ")}` : nameParts.join(" ")) || "Unknown Learner";

  // Documents attached to this student (sorted newest first if possible)
  const docs: any[] = Array.isArray(student.documents) ? [...student.documents] : [];
  docs.sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return timeB - timeA;
  });

  const latestDoc = docs[0];

  // Grade level preference: student.grade_level > latestDoc.grade_level > extracted_fields
  const rawGrade = student.grade_level || latestDoc?.grade_level || latestDoc?.extracted_fields?.grade_level || "";
  const gradeNum = parseGradeNumber(rawGrade);
  const displayGrade = gradeNum !== null ? (gradeNum === 0 ? "Kinder" : `Grade ${gradeNum}`) : (rawGrade || "-");

  // School level
  const schoolLevel = deriveSchoolLevel(
    rawGrade,
    latestDoc?.source_form_version,
    latestDoc?.shs_track,
    latestDoc?.extracted_fields
  );

  // Section
  const section =
    latestDoc?.extracted_fields?.section ||
    latestDoc?.extracted_fields?.sec ||
    student.section ||
    "-";

  // School Year
  const schoolYear =
    latestDoc?.school_year ||
    latestDoc?.extracted_fields?.school_year ||
    student.school_year ||
    "-";

  // School Name
  const schoolName = student.schools?.name || student.school || "-";

  // Review Status
  const reviewStatus = deriveReviewStatus(docs);

  // Validation Status (authoritative overall_status from database)
  const validationStatus = deriveValidationStatus(student.overall_status);

  return {
    id: student.id,
    lrn,
    masked_lrn: maskLrn(lrn),
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    suffix,
    full_name: fullName,
    grade_level: displayGrade,
    normalized_grade: gradeNum,
    school_level: schoolLevel,
    section: String(section).trim() || "-",
    school_year: String(schoolYear).trim() || "-",
    school_name: schoolName,
    review_status: reviewStatus,
    validation_status: validationStatus,
    student_status: student.status || "active",
    latest_document_id: latestDoc?.id || null,
  };
}

/**
 * Filter items according to active search and dropdown filter parameters.
 * Implements strict AND combination logic.
 */
export function filterStudentDirectoryItems(
  items: StudentDirectoryItem[],
  filters: StudentDirectoryFilters
): StudentDirectoryItem[] {
  return items.filter((item) => {
    // 1. Search Query (Case-insensitive across first, middle, last, full name, and LRN)
    if (filters.query && filters.query.trim().length > 0) {
      const q = filters.query.trim().toLowerCase();
      const matchesName =
        item.full_name.toLowerCase().includes(q) ||
        item.first_name.toLowerCase().includes(q) ||
        (item.middle_name && item.middle_name.toLowerCase().includes(q)) ||
        item.last_name.toLowerCase().includes(q);
      const matchesLrn = item.lrn.includes(q);

      if (!matchesName && !matchesLrn) {
        return false;
      }
    }

    // 2. School Level Filter
    if (filters.school_level && filters.school_level !== "All") {
      if (item.school_level !== filters.school_level) {
        return false;
      }
    }

    // 3. Grade Level Filter
    if (filters.grade_level && filters.grade_level !== "All") {
      const targetGradeNum = parseGradeNumber(filters.grade_level);
      if (targetGradeNum !== null) {
        if (item.normalized_grade !== targetGradeNum) {
          return false;
        }
      } else {
        if (item.grade_level.toLowerCase() !== filters.grade_level.toLowerCase()) {
          return false;
        }
      }
    }

    // 4. Section Filter
    if (filters.section && filters.section !== "All") {
      if (item.section.toLowerCase() !== filters.section.toLowerCase()) {
        return false;
      }
    }

    // 5. Review Status Filter
    if (filters.review_status && filters.review_status !== "All") {
      if (filters.review_status === "Pending Review") {
        if (item.review_status !== "Pending Review" && item.review_status !== "No Document") {
          return false;
        }
      } else if (item.review_status !== filters.review_status) {
        return false;
      }
    }

    // 6. Validation Status Filter
    if (filters.validation_status && filters.validation_status !== "All") {
      if (item.validation_status.toLowerCase() !== filters.validation_status.toLowerCase()) {
        return false;
      }
    }

    // 7. School Year Filter
    if (filters.school_year && filters.school_year !== "All") {
      if (item.school_year.toLowerCase() !== filters.school_year.toLowerCase()) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Contextual Grade Options according to selected School Level.
 */
export function getContextualGradeLevels(schoolLevel?: string): string[] {
  if (schoolLevel === "Elementary") {
    return ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
  }
  if (schoolLevel === "Junior High School") {
    return ["Grade 7", "Grade 8", "Grade 9", "Grade 10"];
  }
  if (schoolLevel === "Senior High School") {
    return ["Grade 11", "Grade 12"];
  }
  if (schoolLevel === "All") {
    return [
      "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
      "Grade 7", "Grade 8", "Grade 9", "Grade 10",
      "Grade 11", "Grade 12"
    ];
  }
  return ["Grade 11", "Grade 12"];
}

/**
 * Dynamically extract distinct section names from actual student records,
 * optionally narrowed to a selected School Level or Grade Level.
 */
export function extractDistinctSections(
  items: StudentDirectoryItem[],
  contextSchoolLevel?: string,
  contextGradeLevel?: string
): string[] {
  const filtered = items.filter((item) => {
    if (contextSchoolLevel && contextSchoolLevel !== "All" && item.school_level !== contextSchoolLevel) {
      return false;
    }
    if (contextGradeLevel && contextGradeLevel !== "All") {
      const gNum = parseGradeNumber(contextGradeLevel);
      if (gNum !== null && item.normalized_grade !== gNum) return false;
      if (gNum === null && item.grade_level.toLowerCase() !== contextGradeLevel.toLowerCase()) return false;
    }
    return true;
  });

  const sectionSet = new Set<string>();
  for (const item of filtered) {
    if (item.section && item.section !== "-") {
      sectionSet.add(item.section);
    }
  }

  return Array.from(sectionSet).sort((a, b) => a.localeCompare(b));
}

/**
 * Dynamically extract distinct school years from student records.
 */
export function extractDistinctSchoolYears(items: StudentDirectoryItem[]): string[] {
  const yearSet = new Set<string>();
  for (const item of items) {
    if (item.school_year && item.school_year !== "-") {
      yearSet.add(item.school_year);
    }
  }
  return Array.from(yearSet).sort((a, b) => b.localeCompare(a));
}

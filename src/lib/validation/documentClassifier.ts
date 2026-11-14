/**
 * AVV System — Document Classification & Plausibility Validation Engine
 *
 * Verifies that uploaded files are plausible DepEd SF9, SF10, or PSA documents
 * before attempting academic comparison.
 *
 * Safeguards:
 * 1. Rejects personal photographs and non-academic documents.
 * 2. Flags blurry or unreadable pages.
 * 3. Detects duplicate page uploads.
 * 4. Flags incomplete academic tables.
 * 5. Flags cross-page student identity mismatches.
 */

import type { ExtractedFields, GradeRecord } from "@/types/documents";

export type DetectedDocumentType = "sf9" | "sf10" | "birth_cert" | "unrelated_document" | "unreadable";

export interface DocumentClassificationResult {
  detectedType: DetectedDocumentType;
  expectedType?: string;
  isPlausible: boolean;
  confidence: number; // 0.0 - 1.0
  reasons: string[];
  warnings: string[];
  needsTeacherReview: boolean;
  pageSideHint?: "front" | "back" | "multi_page" | "unknown";
  hasAcademicGrades: boolean;
  hasLearnerIdentity: boolean;
  hasAttendance: boolean;
}

// ---------------------------------------------------------------------------
// Keywords & Signatures
// ---------------------------------------------------------------------------

const DEPED_HEADER_KEYWORDS = [
  "republic of the philippines",
  "department of education",
  "kagawaran ng edukasyon",
  "deped",
  "school id",
  "division of",
  "region",
  "taysan resettlement",
];

const SF9_SPECIFIC_KEYWORDS = [
  "sf9",
  "sf-9",
  "form 138",
  "progress report card",
  "report on learning progress",
  "report on attendance",
  "observed values",
  "report on learner's observed values",
  "maka-diyos",
  "makatao",
  "makakalikasan",
  "makabansa",
  "dear parent",
  "certificate of transfer",
];

const SF10_SPECIFIC_KEYWORDS = [
  "sf10",
  "sf-10",
  "form 137",
  "permanent record",
  "student permanent record",
  "learner's permanent academic record",
  "senior high school student permanent record",
  "scholastic record",
  "eligibility for shs enrollment",
  "remedial classes",
  "recomputed final grade",
  "track/strand",
  "general average",
];

const PSA_SPECIFIC_KEYWORDS = [
  "certificate of live birth",
  "philippine statistics authority",
  "national statistics office",
  "office of the civil registrar",
  "registry no",
  "child",
  "mother",
  "father",
  "date of birth",
];

const ACADEMIC_SUBJECT_KEYWORDS = [
  "oral communication",
  "komunikasyon",
  "pananaliksik",
  "general mathematics",
  "statistics and probability",
  "earth and life science",
  "physical science",
  "understanding culture",
  "personal development",
  "physical education",
  "pe and health",
  "english",
  "filipino",
  "science",
  "mathematics",
  "araling panlipunan",
  "edukasyon sa pagpapakatao",
  "core subjects",
  "applied subjects",
  "specialized subjects",
];

// ---------------------------------------------------------------------------
// Core Classification Functions
// ---------------------------------------------------------------------------

/**
 * Classifies an OCR extraction text into a document type and evaluates its plausibility.
 */
export function classifyDocument(
  text: string,
  rawLayout?: any,
  expectedType?: "sf9" | "sf10"
): DocumentClassificationResult {
  const lower = (text || "").toLowerCase().trim();
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. Check for completely empty or extremely short text
  if (!lower || lower.length < 25) {
    return {
      detectedType: "unreadable",
      expectedType,
      isPlausible: false,
      confidence: 0,
      reasons: ["Document text is empty or virtually unreadable. Check lighting and resolution."],
      warnings: ["Image appears unreadable or blank."],
      needsTeacherReview: true,
      hasAcademicGrades: false,
      hasLearnerIdentity: false,
      hasAttendance: false,
    };
  }

  // 2. Score keyword matches
  const depedHeaderMatches = DEPED_HEADER_KEYWORDS.filter((kw) => lower.includes(kw));
  const sf9Matches = SF9_SPECIFIC_KEYWORDS.filter((kw) => lower.includes(kw));
  const sf10Matches = SF10_SPECIFIC_KEYWORDS.filter((kw) => lower.includes(kw));
  const psaMatches = PSA_SPECIFIC_KEYWORDS.filter((kw) => lower.includes(kw));
  const subjectMatches = ACADEMIC_SUBJECT_KEYWORDS.filter((kw) => lower.includes(kw));

  const hasLrn = /\b\d{12}\b/.test(lower) || lower.includes("lrn") || lower.includes("learner reference");
  const hasAcademicTable =
    subjectMatches.length >= 2 ||
    ((lower.includes("quarter") || lower.includes("final grade") || lower.includes("semester")) && subjectMatches.length >= 1);
  const hasAttendanceTable =
    lower.includes("attendance") ||
    lower.includes("school days") ||
    lower.includes("days present") ||
    lower.includes("days absent");

  // 3. Detect Unrelated Documents (e.g. personal photograph, scenic photo, receipt, personal ID)
  const isDepEdRelated = depedHeaderMatches.length > 0 || hasLrn || sf9Matches.length > 0 || sf10Matches.length > 0;
  const isPsaRelated = psaMatches.length >= 2;

  if (!isDepEdRelated && !isPsaRelated && !hasAcademicTable) {
    reasons.push(
      "Non-academic document detected: File lacks standard DepEd school form headers, academic grading tables, and official institutional markings. Personal photos or unrelated files cannot be processed as academic records."
    );
    return {
      detectedType: "unrelated_document",
      expectedType,
      isPlausible: false,
      confidence: 0.1,
      reasons,
      warnings: ["Unrelated non-academic document detected."],
      needsTeacherReview: true,
      hasAcademicGrades: false,
      hasLearnerIdentity: false,
      hasAttendance: false,
    };
  }

  // 4. Distinguish PSA Birth Certificate (Explicitly rejected in AVV System)
  if (isPsaRelated && psaMatches.length >= 2 && !hasAcademicTable) {
    return {
      detectedType: "birth_cert",
      expectedType,
      isPlausible: false,
      confidence: 0.9,
      reasons: ["PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document."],
      warnings: ["PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document."],
      needsTeacherReview: true,
      hasAcademicGrades: false,
      hasLearnerIdentity: hasLrn || lower.includes("child") || lower.includes("name"),
      hasAttendance: false,
    };
  }

  // 5. Distinguish SF10 vs SF9
  let detectedType: DetectedDocumentType = "sf9";
  let confidence = 0.75;
  let pageSideHint: "front" | "back" | "multi_page" | "unknown" = "unknown";

  if (sf10Matches.length > sf9Matches.length || (lower.includes("permanent record") && !lower.includes("progress report card"))) {
    detectedType = "sf10";
    confidence = sf10Matches.length >= 2 ? 0.92 : 0.78;
    reasons.push(`Detected SF10 Student Permanent Record markers (${sf10Matches.join(", ")}).`);
    if (lower.includes("page 2") || lower.includes("page 3") || (lower.includes("grade 11") && lower.includes("grade 12"))) {
      pageSideHint = "multi_page";
    }
  } else {
    detectedType = "sf9";
    confidence = sf9Matches.length >= 2 ? 0.92 : 0.78;
    reasons.push(`Detected SF9 Learner Progress Report Card markers (${sf9Matches.join(", ")}).`);

    // Infer Front vs Back Side for SF9
    const hasFrontMarkers = lower.includes("certificate of transfer") || lower.includes("dear parent") || (hasLrn && lower.includes("birth"));
    const hasBackMarkers = hasAttendanceTable || lower.includes("observed values") || lower.includes("core values");

    if (hasFrontMarkers && !hasBackMarkers) {
      pageSideHint = "front";
    } else if (hasBackMarkers && !hasFrontMarkers) {
      pageSideHint = "back";
    } else if (hasAcademicTable && hasAttendanceTable) {
      pageSideHint = "unknown"; // Combined multi-page or standard layout
    }
  }

  // 6. Validate compatibility with expected type
  let isPlausible = true;
  if (expectedType && expectedType !== detectedType) {
    warnings.push(`Slot expected ${expectedType.toUpperCase()}, but content appears to be ${detectedType.toUpperCase()}.`);
    // If expected SF9 but uploaded SF10 or vice-versa, flag as needing teacher review
    isPlausible = false;
  }

  // 7. Check if academic tables are complete
  if ((detectedType === "sf9" || detectedType === "sf10") && !hasAcademicTable && !hasAttendanceTable && !hasLrn) {
    warnings.push("Academic grades and attendance tables were not detected on this page.");
  }

  return {
    detectedType,
    expectedType,
    isPlausible,
    confidence,
    reasons,
    warnings,
    needsTeacherReview: warnings.length > 0 || !isPlausible,
    pageSideHint,
    hasAcademicGrades: hasAcademicTable,
    hasLearnerIdentity: hasLrn || lower.includes("name") || lower.includes("pangalan"),
    hasAttendance: hasAttendanceTable,
  };
}

/**
 * Detects whether two uploaded files or pages are exact duplicates of each other.
 */
export function detectDuplicatePages(
  page1Text: string,
  page2Text: string,
  page1DataUrl?: string | null,
  page2DataUrl?: string | null
): boolean {
  if (page1DataUrl && page2DataUrl && page1DataUrl.length > 100 && page1DataUrl === page2DataUrl) {
    return true;
  }

  const p1 = (page1Text || "").replace(/\s+/g, " ").trim().toLowerCase();
  const p2 = (page2Text || "").replace(/\s+/g, " ").trim().toLowerCase();

  if (p1.length > 80 && p2.length > 80 && p1 === p2) {
    return true;
  }

  // Check high overlap ratio if both have significant length
  if (p1.length > 120 && p2.length > 120) {
    const minLen = Math.min(p1.length, p2.length);
    const maxLen = Math.max(p1.length, p2.length);
    if (minLen / maxLen > 0.95) {
      // Substring sample check
      const sample1 = p1.slice(0, 100);
      const sample2 = p2.slice(0, 100);
      if (sample1 === sample2) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates whether two sides of an SF9 (Front and Back) plausibly belong to the same student.
 */
export function validateSf9CrossSideCompatibility(
  frontFields: ExtractedFields,
  backFields: ExtractedFields
): { isCompatible: boolean; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let isCompatible = true;

  // 1. LRN check across sides (if both sides have LRN printed)
  const lrn1 = frontFields.lrn ? String(frontFields.lrn).replace(/[^0-9]/g, "") : "";
  const lrn2 = backFields.lrn ? String(backFields.lrn).replace(/[^0-9]/g, "") : "";

  if (lrn1 && lrn2 && lrn1.length === 12 && lrn2.length === 12) {
    if (lrn1 !== lrn2) {
      isCompatible = false;
      reasons.push(
        `Conflicting LRNs detected between SF9 Front (${lrn1}) and Back (${lrn2}). The uploaded sides belong to different students.`
      );
    }
  }

  // 2. Student Name check across sides (if both sides have Name printed)
  const name1 = (frontFields.name || frontFields.last_name || "").toLowerCase().replace(/[^a-z]/g, "");
  const name2 = (backFields.name || backFields.last_name || "").toLowerCase().replace(/[^a-z]/g, "");

  if (name1 && name2 && name1.length > 3 && name2.length > 3) {
    if (!name1.includes(name2) && !name2.includes(name1)) {
      isCompatible = false;
      reasons.push(
        `Conflicting student names detected between SF9 Front ("${frontFields.name}") and Back ("${backFields.name}").`
      );
    }
  }

  // 3. School Year check across sides
  const sy1 = (frontFields.school_year || "").replace(/[^0-9]/g, "");
  const sy2 = (backFields.school_year || "").replace(/[^0-9]/g, "");

  if (sy1 && sy2 && sy1.length === 8 && sy2.length === 8) {
    if (sy1 !== sy2) {
      warnings.push(
        `Different School Years extracted on SF9 Front (${frontFields.school_year}) vs Back (${backFields.school_year}). Review physical card.`
      );
    }
  }

  // 4. Grade Level check across sides
  const gl1 = (frontFields.grade_level || "").toLowerCase().replace(/[^0-9]/g, "");
  const gl2 = (backFields.grade_level || "").toLowerCase().replace(/[^0-9]/g, "");

  if (gl1 && gl2 && gl1 !== gl2) {
    warnings.push(
      `Different Grade Levels detected on SF9 Front (${frontFields.grade_level}) vs Back (${backFields.grade_level}).`
    );
  }

  return { isCompatible, reasons, warnings };
}

export const classifyDocumentLayout = classifyDocument;


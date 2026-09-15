/**
 * Field extraction / parsing from raw OCR markdown text.
 *
 * Parses school document OCR output into structured ExtractedFields.
 * Handles various DepEd document formats (SF9, SF10, School ID, etc.).
 */

import type { ExtractedFields } from "@/types/documents";
import { normalizeLrn, normalizeSex } from "../validation/patterns";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a field value from OCR text by matching a label, stopping at
 * subsequent labels. Cleans up markdown artifacts and extra whitespace.
 */
function extractField(
  text: string,
  label: string,
  followingLabels: string[]
): string {
  const labelsAlt = followingLabels.join("|");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      new RegExp(`\\b${label}\\b\\s*[:|\\-]?\\s*(.*)`, "i")
    );
    if (!match) continue;

    let value = match[1];
    // Truncate at the next known label on the same line.
    if (labelsAlt) {
      value = value.split(new RegExp(`\\b(?:${labelsAlt})\\b`, "i"), 1)[0];
    }
    // Clean markdown formatting artifacts.
    value = value
      .replace(/[|*_`]+/g, " ")
      .replace(/_{2,}/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (value) return value;
  }
  return "";
}

/**
 * Try to split a full name into first / middle / last components.
 * Handles "LAST, FIRST MIDDLE" and "FIRST MIDDLE LAST" formats.
 */
function splitName(fullName: string): {
  first_name: string;
  middle_name: string;
  last_name: string;
} {
  if (!fullName) return { first_name: "", middle_name: "", last_name: "" };

  // "DELA CRUZ, JUAN MIGUEL" format (comma-separated: last, first middle).
  if (fullName.includes(",")) {
    const [lastPart, ...rest] = fullName.split(",").map((s) => s.trim());
    const firstMiddle = rest.join(" ").trim().split(/\s+/);
    return {
      first_name: firstMiddle[0] ?? "",
      middle_name: firstMiddle.slice(1).join(" "),
      last_name: lastPart,
    };
  }

  // If no comma, assume Philippine school form format: LAST NAME, FIRST NAME, MIDDLE NAME
  // Heuristic: if ≤ 2 words, last = word[0], first = word[1].
  // If ≥ 3 words, last = word[0], middle = word[n], first = words[1..n-1].
  // Note: Compound last names without a comma are hard to parse perfectly, 
  // but this matches standard SF9 layout when OCR misses the comma.
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { first_name: parts[0] ?? "", middle_name: "", last_name: "" };
  }
  if (parts.length === 2) {
    return { first_name: parts[1], middle_name: "", last_name: parts[0] };
  }
  return {
    last_name: parts[0],
    first_name: parts.slice(1, -1).join(" "),
    middle_name: parts[parts.length - 1],
  };
}

/**
 * Attempt to extract name by looking for the line containing "Last Name" or "First Name", 
 * and grabbing the line immediately above it. This is very common in Philippine school 
 * forms where labels are printed below the blank line.
 */
function extractNameFromLabelsBelow(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (line.includes("last name") || line.includes("first name")) {
      const aboveLine = lines[i - 1];
      // Strip "Name:" prefix if it exists on that line
      const cleanAbove = aboveLine.replace(/^(Name|Student Name|Learner's Name)[\s:]*/i, "").trim();
      // Avoid grabbing random other labels
      if (cleanAbove && !ALL_LABELS.some(l => cleanAbove.toLowerCase() === l.toLowerCase()) && cleanAbove.length > 2) {
        return cleanAbove;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Exported labels list — defines what we look for and in what order
// ---------------------------------------------------------------------------

const ALL_LABELS = [
  "Name",
  "Last Name",
  "First Name",
  "Middle Name",
  "LRN",
  "Learner Reference Number",
  "Grade",
  "Grade Level",
  "Section",
  "School",
  "School Name",
  "School ID",
  "Track/Strand",
  "Track / Strand",
  "Track/ Strand",
  "Track",
  "Strand",
  "Sex",
  "Gender",
  "Address",
  "Division",
  "Region",
];

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse raw OCR markdown text into structured ExtractedFields.
 *
 * Tries multiple label variants to maximize extraction across different
 * DepEd form formats.
 */
export function parseOcrText(text: string): ExtractedFields {
  const otherLabels = ALL_LABELS;

  // First try the highly accurate heuristic: Name is printed directly above "Last Name First Name" labels
  let fullName = extractNameFromLabelsBelow(text);

  if (!fullName) {
    // Fallback to standard field extraction
    fullName =
      extractField(text, "Name", otherLabels) ||
      extractField(text, "Student Name", otherLabels) ||
      extractField(text, "Learner's Name", otherLabels) ||
      extractField(text, "Pangalan", otherLabels); // Filipino label
  }

  // Try extracting first/middle/last separately first.
  const directFirst = extractField(text, "First Name", otherLabels) ||
    extractField(text, "Given Name", otherLabels);
  const directMiddle = extractField(text, "Middle Name", otherLabels) ||
    extractField(text, "Middle Initial", otherLabels);
  const directLast = extractField(text, "Last Name", otherLabels) ||
    extractField(text, "Surname", otherLabels) ||
    extractField(text, "Family Name", otherLabels);

  // If we got direct parts, use them. Otherwise split the full name.
  const nameParts =
    directFirst || directLast
      ? { first_name: directFirst, middle_name: directMiddle, last_name: directLast }
      : splitName(fullName);

  // LRN
  const rawLrn =
    extractField(text, "LRN", otherLabels) ||
    extractField(text, "Learner Reference Number", otherLabels);
  const lrn = normalizeLrn(rawLrn);

  // Grade
  const gradeLevel =
    extractField(text, "Grade", otherLabels) ||
    extractField(text, "Grade Level", otherLabels) ||
    extractField(text, "Baitang", otherLabels); // Filipino label

  // School
  let schoolName =
    extractField(text, "School Name", otherLabels) ||
    extractField(text, "Name of School", otherLabels) ||
    extractField(text, "Paaralan", otherLabels); // Filipino label
    
  if (!schoolName) {
    const fallback = extractField(text, "School", otherLabels);
    if (fallback && !fallback.toLowerCase().startsWith("days")) {
      schoolName = fallback;
    }
  }

  // Heuristic: If we couldn't find a labeled school name, look for common school keywords in the text
  if (!schoolName || schoolName.length < 5 || schoolName.toLowerCase().includes("community and country")) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const schoolKeywords = ["high school", "elementary school", "academy", "university", "college", "institute", "integrated school", "national high", "memorial high"];
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      // Only match if it actually contains a school-like name, not just the word "School" as a label
      if (schoolKeywords.some(kw => lowerLine.includes(kw)) && lowerLine.length > 10) {
        // Strip markdown artifacts
        schoolName = line.replace(/[|*_`]+/g, "").trim();
        break;
      }
    }
  }

  // Track / Strand
  const trackStrand =
    extractField(text, "Track/Strand", otherLabels) ||
    extractField(text, "Track / Strand", otherLabels) ||
    extractField(text, "Track/ Strand", otherLabels) ||
    extractField(text, "Track", otherLabels) ||
    extractField(text, "Strand", otherLabels);

  // Sex
  const rawSex =
    extractField(text, "Sex", otherLabels) ||
    extractField(text, "Gender", otherLabels) ||
    extractField(text, "Kasarian", otherLabels); // Filipino label
  const sex = normalizeSex(rawSex) || rawSex;

  // Compose the full name for display.
  const composedName = fullName ||
    [nameParts.first_name, nameParts.middle_name, nameParts.last_name]
      .filter(Boolean)
      .join(" ");

  return {
    name: composedName,
    first_name: nameParts.first_name,
    middle_name: nameParts.middle_name,
    last_name: nameParts.last_name,
    lrn,
    grade_level: gradeLevel,
    school_name: schoolName,
    track_strand: trackStrand,
    sex,
  };
}

/**
 * Legacy helper: extract just Name and LRN as a formatted string.
 * Kept for backward compatibility with the old compare flow.
 */
export function extractNameAndLrn(text: string): string {
  const fields = parseOcrText(text);
  const name = fields.name || "Not found";
  const lrn = fields.lrn || "Not found";
  return `Name: ${name} | LRN: ${lrn}`;
}

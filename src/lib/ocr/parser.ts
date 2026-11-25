/**
 * Field extraction / parsing from raw OCR markdown text.
 *
 * Parses school document OCR output into structured ExtractedFields.
 * Handles various DepEd document formats (SF9, SF10, School ID, etc.).
 */

import type { ExtractedFields } from "@/types/documents";
import { normalizeLrn, normalizeSex, isValidLrn, isValidSchoolYear } from "../validation/patterns";
import {
  extractSpatialIdentity,
  extractAdviserFromText,
  cleanAdviserName,
  isValidAdviserCandidate,
  extractSchoolFromText,
  cleanSchoolName,
  isValidSchoolCandidate,
} from "./spatialIdentityParser";
import { buildDocumentRecognitionSummary } from "./handwritingExtractor";

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
    // If searching for student "Name", do not match "School Name" or "Name of School"
    if (label.toLowerCase() === "name" && /^\s*(?:school\s+name|name\s+of\s+school)\b/i.test(line)) {
      continue;
    }

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

function isBareNameLabel(line: string, label: "last" | "first" | "middle"): boolean {
  const trimmed = line.trim();
  const stripped = trimmed.replace(/^[\(\[\{]\s*/, "").replace(/\s*[\)\]\}]$/, "").trim();
  let labelRegex: RegExp;
  if (label === "last") {
    labelRegex = /^(?:last\s*name|surname|apelyido)(?:\s*\/\s*(?:last\s*name|surname|apelyido))?[:\s]*$/i;
  } else if (label === "first") {
    labelRegex = /^(?:first\s*name|given\s*name|pangalan)(?:\s*\/\s*(?:first\s*name|given\s*name|pangalan))?[:\s]*$/i;
  } else {
    labelRegex = /^(?:middle\s*name|gitnang\s*apelyido)(?:\s*\/\s*(?:middle\s*name|gitnang\s*apelyido))?[:\s]*$/i;
  }
  return labelRegex.test(stripped);
}

/**
 * Attempt to extract name by looking for the line containing "Last Name" or "First Name", 
 * and grabbing the line immediately above it. This is very common in Philippine school 
 * forms where labels are printed below the blank line.
 */
function extractNameFromLabelsBelow(text: string): { fullName: string; first_name?: string; middle_name?: string; last_name?: string } | string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isHeaderOrMeta = (s: string) =>
    s.includes(":") ||
    /\d/.test(s) ||
    /^(?:republic|department|region|division|district|school|report|sf\d|lrn|grade|section|track|strand|semester|quarter)/i.test(s) ||
    ALL_LABELS.some(lbl => s.toLowerCase() === lbl.toLowerCase());

  for (let i = 0; i < lines.length; i++) {
    // 1. Column-stacked layout: 3 name lines printed above "Last Name", "First Name", "Middle Name"
    if (isBareNameLabel(lines[i], "last")) {
      const next1 = lines[i + 1] || "";
      const next2 = lines[i + 2] || "";
      if (isBareNameLabel(next1, "first") && (isBareNameLabel(next2, "middle") || i >= 2)) {
        if (i >= 3) {
          const lName = lines[i - 3].replace(/^(Name|Student Name|Learner's Name)[\s:]*/i, "").trim();
          const fName = lines[i - 2].trim();
          const mName = lines[i - 1].trim();
          if (
            lName && fName && mName &&
            !isHeaderOrMeta(lName) &&
            !isHeaderOrMeta(fName) &&
            !isHeaderOrMeta(mName)
          ) {
            return {
              fullName: `${lName}, ${fName} ${mName}`,
              first_name: fName,
              middle_name: mName,
              last_name: lName,
            };
          }
        }
      }
    }

    // 2. Single line printed directly above bare label
    if (i >= 1 && (isBareNameLabel(lines[i], "last") || isBareNameLabel(lines[i], "first"))) {
      const aboveLine = lines[i - 1];
      // Strip "Name:" prefix if it exists on that line
      const cleanAbove = aboveLine.replace(/^(Name|Student Name|Learner's Name)[\s:]*/i, "").trim();
      if (cleanAbove && !isHeaderOrMeta(cleanAbove) && cleanAbove.length > 2) {
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
  "School Year",
  "School Yr",
  "SY",
  "S.Y.",
  "Taong Panuruan",
  "Birth Date",
  "Date of Birth",
  "DOB",
  "Kapanganakan",
  "Adviser",
  "Class Adviser",
  "Guro",
  "Semester",
  "Sex",
  "Gender",
  "Age",
  "Edad",
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
export function parseOcrText(text: string, rawLayout?: any): ExtractedFields {
  const otherLabels = ALL_LABELS;

  // If layout geometry is available, attempt spatial identity extraction first
  const spatial = rawLayout ? extractSpatialIdentity(rawLayout, text) : {};

  // First try spatial name if detected with high geometric confidence
  let fullName = spatial.name || "";
  let nameParts: { first_name: string; middle_name: string; last_name: string };

  if (spatial.last_name || spatial.first_name) {
    nameParts = {
      first_name: spatial.first_name || "",
      middle_name: spatial.middle_name || "",
      last_name: spatial.last_name || "",
    };
    if (!fullName) {
      if (nameParts.last_name && nameParts.first_name) {
        fullName = `${nameParts.last_name}, ${nameParts.first_name}${nameParts.middle_name ? " " + nameParts.middle_name : ""}`;
      } else {
        fullName = [nameParts.first_name, nameParts.middle_name, nameParts.last_name].filter(Boolean).join(" ");
      }
    }
  } else {
    // First try the highly accurate heuristic: Name is printed directly above "Last Name First Name" labels
    const labelsBelowRes = extractNameFromLabelsBelow(text);
    if (labelsBelowRes && typeof labelsBelowRes === "object") {
      fullName = labelsBelowRes.fullName;
      nameParts = {
        first_name: labelsBelowRes.first_name || "",
        middle_name: labelsBelowRes.middle_name || "",
        last_name: labelsBelowRes.last_name || "",
      };
    } else {
      if (typeof labelsBelowRes === "string") {
        fullName = labelsBelowRes;
      }

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
      nameParts =
        directFirst || directLast
          ? { first_name: directFirst, middle_name: directMiddle, last_name: directLast }
          : splitName(fullName);
    }
  }

  // Compose the full name for display and adviser name-collision checking
  const composedName = fullName ||
    [nameParts.first_name, nameParts.middle_name, nameParts.last_name]
      .filter(Boolean)
      .join(" ");

  // LRN
  let rawLrn =
    spatial.lrn ||
    extractField(text, "LRN", otherLabels) ||
    extractField(text, "Learner Reference Number", otherLabels);

  // If LRN label is on its own line followed by a 12-digit number on subsequent lines
  if (!rawLrn || !isValidLrn(normalizeLrn(rawLrn))) {
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    for (let i = 0; i < lines.length; i++) {
      if (/^\b(?:LRN|Learner Reference Number)\b[:\s]*$/i.test(lines[i])) {
        for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
          const m = lines[j].match(/^(\d{12})$/);
          if (m) {
            rawLrn = m[1];
            break;
          }
        }
        if (rawLrn) break;
      }
    }
  }

  // Fallback: If document contains a distinct standalone 12-digit number
  if (!rawLrn || !isValidLrn(normalizeLrn(rawLrn))) {
    const standaloneMatch = text.match(/(?:^|\n)\s*(\d{12})\s*(?:\r?\n|$)/);
    if (standaloneMatch) {
      rawLrn = standaloneMatch[1];
    }
  }

  const lrn = normalizeLrn(rawLrn);

  // Grade (exclude Grade / Grade Level from stop-labels so values like "Grade 8" are not self-truncated)
  const gradeStopLabels = otherLabels.filter((l) => !/^grade(?:\s+level)?$/i.test(l));
  const gradeLevel =
    extractField(text, "Classified as Grade", gradeStopLabels) ||
    extractField(text, "Grade Level", gradeStopLabels) ||
    extractField(text, "Grade", gradeStopLabels) ||
    extractField(text, "Baitang", gradeStopLabels); // Filipino label

  // School Name
  // 1. Spatial layout extraction
  let schoolName = (spatial as any).school_name || "";

  // 2. Proximity/relative text extraction (e.g. name printed directly above "School" label, or column between "Division" and "School")
  const schoolTextRes = extractSchoolFromText(text, {
    learnerName: composedName,
    learnerFirstName: nameParts.first_name,
    learnerLastName: nameParts.last_name,
  });

  if (!schoolName) {
    schoolName = schoolTextRes.schoolName;
  }

  // 3. Fallback to same-line extractField
  if (!schoolName) {
    const direct =
      extractField(text, "School Name", otherLabels) ||
      extractField(text, "Name of School", otherLabels) ||
      extractField(text, "Paaralan", otherLabels);
    if (
      direct &&
      isValidSchoolCandidate(direct, {
        learnerName: composedName,
        learnerFirstName: nameParts.first_name,
        learnerLastName: nameParts.last_name,
      })
    ) {
      schoolName = cleanSchoolName(direct);
    }
  }

  // 4. Keyword heuristic fallback (with strict exclusion of division/department/attendance headers)
  if (!schoolName || schoolName.length < 5 || schoolName.toLowerCase().includes("community and country")) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const schoolKeywords = [
      "high school",
      "elementary school",
      "academy",
      "university",
      "college",
      "institute",
      "integrated school",
      "national high",
      "memorial high",
    ];

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      // Skip lines that are division or department headers or attendance lines
      if (
        lowerLine.includes("division of") ||
        lowerLine.includes("department of education") ||
        lowerLine.includes("days") ||
        lowerLine.includes("republic of")
      ) {
        continue;
      }
      if (schoolKeywords.some((kw) => lowerLine.includes(kw)) && lowerLine.length > 5 && lowerLine.length < 90) {
        const cand = line.replace(/[|*_`]+/g, "").trim();
        if (
          isValidSchoolCandidate(cand, {
            learnerName: composedName,
            learnerFirstName: nameParts.first_name,
            learnerLastName: nameParts.last_name,
          })
        ) {
          schoolName = cleanSchoolName(cand);
          break;
        }
      }
    }
  }

  const hasSchoolLabel = schoolTextRes.hasSchoolLabel || /\b(?:school|paaralan)\b/i.test(text);

  // Track / Strand
  const trackStrand =
    extractField(text, "Track/Strand", otherLabels) ||
    extractField(text, "Track / Strand", otherLabels) ||
    extractField(text, "Track/ Strand", otherLabels) ||
    extractField(text, "Track", otherLabels) ||
    extractField(text, "Strand", otherLabels);

  // School Year
  let schoolYear =
    spatial.school_year ||
    extractField(text, "School Year", otherLabels) ||
    extractField(text, "School Yr", otherLabels) ||
    extractField(text, "SY", otherLabels) ||
    extractField(text, "S.Y.", otherLabels) ||
    extractField(text, "Taong Panuruan", otherLabels);

  if (!schoolYear) {
    // Regex match for YYYY-YYYY or SY YYYY-YYYY in text
    const syMatch = text.match(/\b(?:S\.?Y\.?\s*)?(20\d{2})\s*[-–/]\s*(20\d{2})\b/i);
    if (syMatch) {
      schoolYear = `${syMatch[1]}-${syMatch[2]}`;
    }
  } else {
    // Normalize format
    const syClean = schoolYear.match(/(20\d{2})\s*[-–/]\s*(20\d{2})/);
    if (syClean) {
      schoolYear = `${syClean[1]}-${syClean[2]}`;
    }
  }

  // School ID
  let schoolId =
    extractField(text, "School ID", otherLabels) ||
    extractField(text, "School Id", otherLabels);
  if (schoolId) {
    const idMatch = schoolId.match(/\b\d{6}\b/);
    if (idMatch) schoolId = idMatch[0];
  } else {
    const idMatch = text.match(/\b(?:School\s*ID|School\s*Id|ID ng Paaralan)[\s:]*(\d{6})\b/i);
    if (idMatch) schoolId = idMatch[1];
  }

  // Birth Date
  const birthDate =
    extractField(text, "Birth Date", otherLabels) ||
    extractField(text, "Date of Birth", otherLabels) ||
    extractField(text, "DOB", otherLabels) ||
    extractField(text, "Kapanganakan", otherLabels);

  // Adviser
  // 1. First prioritize spatial layout extraction if available
  let adviser = (spatial as any).adviser || "";

  // 2. Proximity/relative text extraction (e.g. name printed directly above "Adviser" label)
  const adviserTextRes = extractAdviserFromText(text, {
    learnerName: composedName,
    learnerFirstName: nameParts.first_name,
    learnerLastName: nameParts.last_name,
    learnerMiddleName: nameParts.middle_name,
    schoolName: schoolName,
  });

  if (!adviser) {
    adviser = adviserTextRes.adviser;
  }

  // 3. Fallback to same-line extractField (e.g. "Adviser: Maria Santos")
  if (!adviser) {
    const rawSameLine =
      extractField(text, "Adviser", otherLabels) ||
      extractField(text, "Class Adviser", otherLabels) ||
      extractField(text, "Guro", otherLabels);
    if (
      rawSameLine &&
      isValidAdviserCandidate(rawSameLine, {
        learnerName: composedName,
        learnerFirstName: nameParts.first_name,
        learnerLastName: nameParts.last_name,
        learnerMiddleName: nameParts.middle_name,
        schoolName: schoolName,
      })
    ) {
      adviser = cleanAdviserName(rawSameLine);
    }
  }

  const hasAdviserLabel = adviserTextRes.hasAdviserLabel || /\b(?:class\s+)?adviser\b/i.test(text);

  // Section
  const section =
    extractField(text, "Section", otherLabels) ||
    extractField(text, "Pangkat", otherLabels);

  // Semester
  const semester =
    extractField(text, "Semester", otherLabels) ||
    (text.match(/\b(1st|2nd|First|Second)\s+Semester\b/i)?.[0] || "");

  // Sex
  const rawSex =
    spatial.sex ||
    extractField(text, "Sex", otherLabels) ||
    extractField(text, "Gender", otherLabels) ||
    extractField(text, "Kasarian", otherLabels); // Filipino label
  const sex = normalizeSex(rawSex) || rawSex;

  // Age
  let age = spatial.age;
  if (!age) {
    const rawAge =
      extractField(text, "Age", otherLabels) ||
      extractField(text, "Edad", otherLabels);
    if (rawAge) {
      const match = rawAge.match(/\b\d{1,2}\b/);
      if (match) age = match[0];
    }
  }

  // Document Type detection (SHS Supported Forms: sf1, sf2, sf5, sf9, sf10, birth_cert)
  let detectedDocType: "sf1" | "sf2" | "sf5" | "sf9" | "sf10" | "birth_cert" = "sf9";
  if (/\b(?:SF1|SF-1|School Form 1|School Register)\b/i.test(text)) {
    detectedDocType = "sf1";
  } else if (/\b(?:SF2|SF-2|School Form 2|Daily Attendance)\b/i.test(text)) {
    detectedDocType = "sf2";
  } else if (/\b(?:SF5|SF-5|SF5A|SF5B|Report on Promotion)\b/i.test(text)) {
    detectedDocType = "sf5";
  } else if (/\b(?:Certificate of Live Birth|Birth Certificate|PSA|NSO)\b/i.test(text)) {
    detectedDocType = "birth_cert";
  } else if (/\b(?:SF10|SF-10|Form 137|Permanent Record)\b/i.test(text)) {
    detectedDocType = "sf10";
  } else if (/\b(?:SF9|SF-9|Form 138|Report Card)\b/i.test(text)) {
    detectedDocType = "sf9";
  }

  // Identify missing or uncertain fields without guessing
  const flags: string[] = [];
  if (!lrn || !isValidLrn(lrn)) {
    flags.push("missing_or_invalid_lrn");
  }
  if (!schoolYear || !isValidSchoolYear(schoolYear)) {
    flags.push("missing_or_uncertain_school_year");
  }
  if (!composedName || composedName.trim().length < 3) {
    flags.push("missing_student_name");
  }
  if (!schoolName) {
    if (hasSchoolLabel) {
      flags.push("school_name_unextracted");
    } else {
      flags.push("missing_school_name");
    }
  }
  if (!adviser && hasAdviserLabel) {
    flags.push("adviser_unextracted");
  }
  const hasSchoolIdLabel = /\b(?:school\s*id|id\s*ng\s*paaralan)\b/i.test(text);
  if (!schoolId && hasSchoolIdLabel) {
    flags.push("school_id_unextracted");
  }

  const recSummary = rawLayout ? buildDocumentRecognitionSummary(rawLayout, "azure", "azure/prebuilt-read") : undefined;

  return {
    name: composedName,
    first_name: nameParts.first_name,
    middle_name: nameParts.middle_name,
    last_name: nameParts.last_name,
    lrn,
    grade_level: gradeLevel,
    school_year: schoolYear,
    school_name: schoolName,
    school_name_unextracted: !schoolName && hasSchoolLabel,
    school_id: schoolId,
    school_id_unextracted: !schoolId && hasSchoolIdLabel,
    birth_date: birthDate,
    adviser,
    adviser_unextracted: !adviser && hasAdviserLabel,
    section,
    semester,
    track_strand: trackStrand,
    sex,
    age,
    document_type: detectedDocType,
    flags,
    recognition_summary: recSummary,
    has_handwritten_content: recSummary?.has_handwriting ?? false,
    icr_confidence: recSummary?.handwriting_confidence,
    handwritten_field_count: recSummary?.handwritten_word_count,
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

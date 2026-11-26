/**
 * Field extraction / parsing from raw OCR markdown text.
 *
 * Parses school document OCR output into structured ExtractedFields.
 * Handles various DepEd document formats (SF9, SF10, School ID, etc.).
 */

import type { ExtractedFields } from "@/types/documents";
import { normalizeLrn, normalizeSex, isValidLrn, isValidSchoolYear } from "../validation/patterns";
import { isBlacklistedStudentName } from "../validation/nameComparison";
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
import { parseShsSf1 } from "./shsSf1Parser";
import { parseSf10ShsText, isSf10SectionHeader } from "./sf10ShsParser";
import { normalizeBirthDate } from "../validation/birthDateNormalizer";

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
    /^(?:republic|department|region|division|district|school|report|sf\d|lrn|grade|section|track|strand|semester|quarter|learner|student|information|scholastic)/i.test(s) ||
    isBlacklistedStudentName(s) ||
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
            !isHeaderOrMeta(mName) &&
            !isBlacklistedStudentName(lName) &&
            !isBlacklistedStudentName(fName) &&
            !isBlacklistedStudentName(mName)
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
      if (cleanAbove && !isHeaderOrMeta(cleanAbove) && !isBlacklistedStudentName(cleanAbove) && cleanAbove.length > 2) {
        return cleanAbove;
      }
    }
  }
  return null;
}

/**
 * Extracts learner identity fields specifically tailored for SF10 (and SF9) documents,
 * extracting the actual LAST NAME, FIRST NAME, and MIDDLE NAME positioned after/below
 * the "LEARNER'S INFORMATION" heading, while strictly refusing blacklisted header strings.
 */
export function extractSf10LearnerIdentity(text: string): {
  fullName: string;
  first_name: string;
  middle_name: string;
  last_name: string;
} | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  // 1. Locate the LEARNER'S INFORMATION heading (or similar section header)
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const clean = lines[i].replace(/[|*_`#]+/g, " ").replace(/[^\w\s']/g, "").trim();
    if (
      /\b(?:LEARNER'?S?\s*INFORMATION|IMPORMASYON\s*NG\s*MAG-?AARAL)\b/i.test(clean) ||
      /\b(?:SCHOLASTIC\s*RECORD|PERMANENT\s*RECORD)\b/i.test(clean)
    ) {
      headerIndex = i;
      break;
    }
  }

  // If no explicit section header found, search from the beginning
  const startIndex = headerIndex !== -1 ? headerIndex + 1 : 0;
  // Consider lines in the learner info block (up to 35 lines or next major section)
  const maxLines = Math.min(lines.length, startIndex + 35);
  const blockLines: string[] = [];

  for (let i = startIndex; i < maxLines; i++) {
    const l = lines[i];
    // Stop if we hit a different major section (e.g. Scholastic Record table, Eligibility, Certification)
    if (
      headerIndex !== -1 &&
      i > startIndex + 1 &&
      /\b(?:ELIGIBILITY|CERTIFICATION|REMARKS|REPORT\s*ON\s*ATTENDANCE|ATTENDANCE\s*RECORD|SUMMARY\s*OF\s*ATTENDANCE)\b/i.test(l)
    ) {
      break;
    }
    blockLines.push(l);
  }

  const blockText = blockLines.join("\n");

  let lastName = "";
  let firstName = "";
  let middleName = "";

  // Strategy A: Markdown table row with Last Name, First Name, Middle Name
  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i];
    if (line.includes("|") && /last\s*name|surname|apelyido/i.test(line) && /first\s*name|given\s*name|pangalan/i.test(line)) {
      const headerCols = line.split("|").map((c) => c.trim().toLowerCase());
      const lastColIdx = headerCols.findIndex((c) => /last\s*name|surname|apelyido/.test(c));
      const firstColIdx = headerCols.findIndex((c) => /first\s*name|given\s*name|pangalan/.test(c));
      const middleColIdx = headerCols.findIndex((c) => /middle\s*name|gitnang\s*apelyido/.test(c));

      for (let j = i + 1; j < Math.min(blockLines.length, i + 4); j++) {
        const dataLine = blockLines[j];
        if (!dataLine.includes("|")) continue;
        if (/^[\s|:-]+$/.test(dataLine)) continue; // Separator row
        const dataCols = dataLine.split("|").map((c) => c.replace(/[|*_`]/g, "").trim());
        if (lastColIdx !== -1 && dataCols[lastColIdx]) {
          const cand = dataCols[lastColIdx];
          if (!isBlacklistedStudentName(cand)) lastName = cand;
        }
        if (firstColIdx !== -1 && dataCols[firstColIdx]) {
          const cand = dataCols[firstColIdx];
          if (!isBlacklistedStudentName(cand)) firstName = cand;
        }
        if (middleColIdx !== -1 && dataCols[middleColIdx]) {
          const cand = dataCols[middleColIdx];
          if (!isBlacklistedStudentName(cand)) middleName = cand;
        }
        if (lastName && firstName) break;
      }
      if (lastName && firstName) break;
    }
  }

  // Strategy B: Explicit labels on line with delimiter: "LAST NAME: GOMEZ", "FIRST NAME: JUSTIN", "MIDDLE NAME: LOQUILLANO"
  // or inline: "LAST NAME: GOMEZ  FIRST NAME: JUSTIN  MIDDLE NAME: LOQUILLANO"
  if (!lastName || !firstName) {
    const matchLast = blockText.match(/\b(?:LAST\s*NAME|SURNAME|APELYIDO)\b\s*[:\-]\s*([^\n\r|:,]+?)(?=\s*(?:\bFIRST\s*NAME\b|\bMIDDLE\s*NAME\b|\bNAME\s*EXT\b|\bLRN\b|\bDATE\b|\bSEX\b|\||\n|$))/i);
    if (matchLast && matchLast[1]) {
      const cand = matchLast[1].trim();
      if (!isBlacklistedStudentName(cand)) lastName = cand;
    }

    const matchFirst = blockText.match(/\b(?:FIRST\s*NAME|GIVEN\s*NAME|PANGALAN)\b\s*[:\-]\s*([^\n\r|:,]+?)(?=\s*(?:\bMIDDLE\s*NAME\b|\bLAST\s*NAME\b|\bNAME\s*EXT\b|\bLRN\b|\bDATE\b|\bSEX\b|\||\n|$))/i);
    if (matchFirst && matchFirst[1]) {
      const cand = matchFirst[1].trim();
      if (!isBlacklistedStudentName(cand)) firstName = cand;
    }

    const matchMiddle = blockText.match(/\b(?:MIDDLE\s*NAME|GITNANG\s*APELYIDO)\b\s*[:\-]\s*([^\n\r|:,]+?)(?=\s*(?:\bLAST\s*NAME\b|\bFIRST\s*NAME\b|\bNAME\s*EXT\b|\bLRN\b|\bDATE\b|\bSEX\b|\||\n|$))/i);
    if (matchMiddle && matchMiddle[1]) {
      const cand = matchMiddle[1].trim();
      if (!isBlacklistedStudentName(cand)) middleName = cand;
    }
  }

  // Strategy C: Alternating lines: Label line followed immediately by value line
  if (!lastName || !firstName) {
    for (let i = 0; i < blockLines.length; i++) {
      const line = blockLines[i].replace(/[|*_`#]+/g, "").trim();
      const cleanLabel = line.replace(/^[(\[{]\s*|\s*[)\]}]/g, "").trim();
      if (/^(?:LAST\s*NAME|SURNAME|APELYIDO)[:\s]*$/i.test(cleanLabel) && i + 1 < blockLines.length) {
        const next = blockLines[i + 1].replace(/[|*_`#]+/g, "").trim();
        if (next && !isBlacklistedStudentName(next) && !/^(?:FIRST|MIDDLE|LRN|SEX|BIRTH)/i.test(next)) {
          lastName = next;
        }
      }
      if (/^(?:FIRST\s*NAME|GIVEN\s*NAME|PANGALAN)[:\s]*$/i.test(cleanLabel) && i + 1 < blockLines.length) {
        const next = blockLines[i + 1].replace(/[|*_`#]+/g, "").trim();
        if (next && !isBlacklistedStudentName(next) && !/^(?:LAST|MIDDLE|LRN|SEX|BIRTH)/i.test(next)) {
          firstName = next;
        }
      }
      if (/^(?:MIDDLE\s*NAME|GITNANG\s*APELYIDO)[:\s]*$/i.test(cleanLabel) && i + 1 < blockLines.length) {
        const next = blockLines[i + 1].replace(/[|*_`#]+/g, "").trim();
        if (next && !isBlacklistedStudentName(next) && !/^(?:LAST|FIRST|LRN|SEX|BIRTH)/i.test(next)) {
          middleName = next;
        }
      }
    }
  }

  // Strategy D: Multi-column labels on a single line with values on the immediate next line
  // e.g. "(Last Name)   (First Name)   (Middle Name)"
  //      "GOMEZ         JUSTIN         LOQUILLANO"
  if (!lastName || !firstName) {
    for (let i = 0; i < blockLines.length - 1; i++) {
      const line = blockLines[i];
      if (
        /\b(?:last\s*name|surname|apelyido)\b/i.test(line) &&
        /\b(?:first\s*name|given\s*name|pangalan)\b/i.test(line)
      ) {
        const next = blockLines[i + 1].replace(/[|*_`#]+/g, "").trim();
        if (next && !isBlacklistedStudentName(next) && !next.includes(":")) {
          const parts = next.split(/\s{2,}|\t/).map((p) => p.trim()).filter(Boolean);
          if (parts.length >= 2 && !parts.some((p) => isBlacklistedStudentName(p))) {
            lastName = parts[0];
            firstName = parts[1];
            middleName = parts[2] || "";
            break;
          } else {
            const singleSpaceParts = next.split(/\s+/).filter(Boolean);
            if (singleSpaceParts.length >= 2 && !singleSpaceParts.some((p) => isBlacklistedStudentName(p))) {
              lastName = singleSpaceParts[0];
              firstName = singleSpaceParts[1];
              middleName = singleSpaceParts.slice(2).join(" ");
              break;
            }
          }
        }
      }
    }
  }

  // Strategy E: Comma-separated full name directly in the block (e.g. "GOMEZ, JUSTIN LOQUILLANO" or "Name: GOMEZ, JUSTIN LOQUILLANO")
  if (!lastName || !firstName) {
    for (const line of blockLines) {
      const cleanLine = line.replace(/^(?:Name|Student Name|Learner'?s?\s*Name)[\s:]*/i, "").replace(/[|*_`#]+/g, "").trim();
      if (cleanLine.includes(",") && !isBlacklistedStudentName(cleanLine)) {
        const [lPart, ...rest] = cleanLine.split(",").map((s) => s.trim());
        const fParts = rest.join(" ").trim().split(/\s+/);
        if (lPart && fParts[0] && !isBlacklistedStudentName(lPart) && !isBlacklistedStudentName(fParts[0])) {
          lastName = lPart;
          firstName = fParts[0];
          middleName = fParts.slice(1).join(" ");
          break;
        }
      }
    }
  }

  // Clean values from trailing artifacts
  lastName = lastName.replace(/^[|:*_\-\s]+|[|:*_\-\s]+$/g, "").trim();
  firstName = firstName.replace(/^[|:*_\-\s]+|[|:*_\-\s]+$/g, "").trim();
  middleName = middleName.replace(/^[|:*_\-\s]+|[|:*_\-\s]+$/g, "").trim();

  if (isBlacklistedStudentName(lastName)) lastName = "";
  if (isBlacklistedStudentName(firstName)) firstName = "";
  if (isBlacklistedStudentName(middleName)) middleName = "";

  if (lastName || firstName) {
    let fullName = "";
    if (lastName && firstName) {
      fullName = `${lastName}, ${firstName}${middleName ? ` ${middleName}` : ""}`;
    } else {
      fullName = [lastName, firstName, middleName].filter(Boolean).join(" ");
    }
    return {
      fullName,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
    };
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

  // 1. Try dedicated SF10 / DepEd "LEARNER'S INFORMATION" section extraction first
  const sf10Identity = extractSf10LearnerIdentity(text);
  let fullName = sf10Identity?.fullName || "";
  let nameParts: { first_name: string; middle_name: string; last_name: string } = {
    first_name: sf10Identity?.first_name || "",
    middle_name: sf10Identity?.middle_name || "",
    last_name: sf10Identity?.last_name || "",
  };

  // If layout geometry is available, attempt spatial identity extraction next if needed
  const spatial = rawLayout ? extractSpatialIdentity(rawLayout, text) : {};

  if (!fullName) {
    if (spatial.last_name || spatial.first_name) {
      const spFirst = !isBlacklistedStudentName(spatial.first_name) ? spatial.first_name || "" : "";
      const spLast = !isBlacklistedStudentName(spatial.last_name) ? spatial.last_name || "" : "";
      const spMiddle = !isBlacklistedStudentName(spatial.middle_name) ? spatial.middle_name || "" : "";
      if (spLast || spFirst) {
        nameParts = {
          first_name: spFirst,
          middle_name: spMiddle,
          last_name: spLast,
        };
        if (spLast && spFirst) {
          fullName = `${spLast}, ${spFirst}${spMiddle ? " " + spMiddle : ""}`;
        } else {
          fullName = [spFirst, spMiddle, spLast].filter(Boolean).join(" ");
        }
      }
    } else if (spatial.name && !isBlacklistedStudentName(spatial.name)) {
      fullName = spatial.name;
      nameParts = splitName(fullName);
    }
  }

  if (!fullName) {
    // Try the heuristic: Name is printed directly above "Last Name First Name" labels
    const labelsBelowRes = extractNameFromLabelsBelow(text);
    if (labelsBelowRes && typeof labelsBelowRes === "object") {
      const cFull = !isBlacklistedStudentName(labelsBelowRes.fullName) ? labelsBelowRes.fullName : "";
      const cFirst = !isBlacklistedStudentName(labelsBelowRes.first_name) ? labelsBelowRes.first_name || "" : "";
      const cLast = !isBlacklistedStudentName(labelsBelowRes.last_name) ? labelsBelowRes.last_name || "" : "";
      const cMiddle = !isBlacklistedStudentName(labelsBelowRes.middle_name) ? labelsBelowRes.middle_name || "" : "";
      if (cLast || cFirst || cFull) {
        fullName = cFull;
        nameParts = {
          first_name: cFirst,
          middle_name: cMiddle,
          last_name: cLast,
        };
      }
    } else {
      if (typeof labelsBelowRes === "string" && !isBlacklistedStudentName(labelsBelowRes)) {
        fullName = labelsBelowRes;
      }

      if (!fullName) {
        // Fallback to standard field extraction
        const cand =
          extractField(text, "Name", otherLabels) ||
          extractField(text, "Student Name", otherLabels) ||
          extractField(text, "Learner's Name", otherLabels) ||
          extractField(text, "Pangalan", otherLabels); // Filipino label
        if (!isBlacklistedStudentName(cand)) {
          fullName = cand;
        }
      }

      // Try extracting first/middle/last separately first.
      const directFirst = extractField(text, "First Name", otherLabels) ||
        extractField(text, "Given Name", otherLabels);
      const directMiddle = extractField(text, "Middle Name", otherLabels) ||
        extractField(text, "Middle Initial", otherLabels);
      const directLast = extractField(text, "Last Name", otherLabels) ||
        extractField(text, "Surname", otherLabels) ||
        extractField(text, "Family Name", otherLabels);

      const cFirst = !isBlacklistedStudentName(directFirst) ? directFirst : "";
      const cMiddle = !isBlacklistedStudentName(directMiddle) ? directMiddle : "";
      const cLast = !isBlacklistedStudentName(directLast) ? directLast : "";

      // If we got direct parts, use them. Otherwise split the full name.
      if (cFirst || cLast) {
        nameParts = { first_name: cFirst, middle_name: cMiddle, last_name: cLast };
        if (!fullName) {
          if (cLast && cFirst) {
            fullName = `${cLast}, ${cFirst}${cMiddle ? " " + cMiddle : ""}`;
          } else {
            fullName = [cFirst, cMiddle, cLast].filter(Boolean).join(" ");
          }
        }
      } else if (fullName) {
        nameParts = splitName(fullName);
      }
    }
  }

  // Strict sanitization of all name parts against blacklisted DepEd form headers
  if (isBlacklistedStudentName(fullName)) {
    fullName = "";
  }
  if (isBlacklistedStudentName(nameParts.last_name)) {
    nameParts.last_name = "";
  }
  if (isBlacklistedStudentName(nameParts.first_name)) {
    nameParts.first_name = "";
  }
  if (isBlacklistedStudentName(nameParts.middle_name)) {
    nameParts.middle_name = "";
  }

  // Compose the full name for display and adviser name-collision checking
  let composedName = fullName;
  if (!composedName && nameParts.last_name && nameParts.first_name) {
    composedName = `${nameParts.last_name}, ${nameParts.first_name}${nameParts.middle_name ? ` ${nameParts.middle_name}` : ""}`;
  } else if (!composedName) {
    composedName = [nameParts.first_name, nameParts.middle_name, nameParts.last_name]
      .filter(Boolean)
      .join(" ");
  }

  if (isBlacklistedStudentName(composedName)) {
    composedName = "";
  }

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

  let sf1Result: any = undefined;
  if (detectedDocType === "sf1") {
    sf1Result = parseShsSf1(text, rawLayout);
  }

  // SF10-SHS: dedicated Learner's Information + Scholastic Record extraction.
  const sf10Parsed = detectedDocType === "sf10" ? parseSf10ShsText(text) : undefined;
  const sf10Learner = sf10Parsed?.learner;
  const sf10First = sf10Parsed?.scholastic_records[0];
  const useSf10Name =
    !!sf10Learner?.full_name &&
    (!composedName || isBlacklistedStudentName(composedName) || isSf10SectionHeader(composedName) || !nameParts.last_name);

  // Universal birthdate normalization (SF10 MM/DD/YYYY, SF1 M/D/YY, PSA textual).
  const rawBirthDate = (sf10Learner?.birth_date_raw && !normalizeBirthDate(birthDate)) ? sf10Learner.birth_date_raw : birthDate;
  const birthNorm = normalizeBirthDate(rawBirthDate);

  const finalLrn = lrn && isValidLrn(lrn) ? lrn : sf10Learner?.lrn || lrn;
  const finalSex = sf10Learner?.sex || sex;

  return {
    name: useSf10Name ? sf10Learner!.full_name : composedName,
    first_name: useSf10Name ? sf10Learner!.first_name : nameParts.first_name,
    middle_name: useSf10Name ? sf10Learner!.middle_name : nameParts.middle_name,
    last_name: useSf10Name ? sf10Learner!.last_name : nameParts.last_name,
    lrn: finalLrn,
    grade_level: sf10First?.grade_level || gradeLevel,
    school_year: sf10First?.school_year || schoolYear,
    school_name: schoolName,
    school_name_unextracted: !schoolName && hasSchoolLabel,
    school_id: sf10First?.school_id || schoolId,
    school_id_unextracted: !(sf10First?.school_id || schoolId) && hasSchoolIdLabel,
    birth_date: birthNorm?.iso || rawBirthDate,
    birth_date_raw: rawBirthDate || undefined,
    birth_date_display: birthNorm?.display || undefined,
    adviser,
    adviser_unextracted: !adviser && hasAdviserLabel,
    section: sf10First?.section || section,
    semester: sf10First?.semester || semester,
    track_strand: sf10First?.track_strand || trackStrand,
    sex: finalSex,
    age,
    document_type: detectedDocType,
    ...(sf10Parsed
      ? {
          scholastic_records: sf10Parsed.scholastic_records,
          sf10_learner_information: sf10Parsed.learner,
          sf10_warnings: sf10Parsed.warnings,
        }
      : {}),
    learners: sf1Result?.learners,
    no_student_found: sf1Result ? sf1Result.learners.length === 0 : undefined,
    error: sf1Result ? (sf1Result.learners.length === 0 ? (sf1Result.error || "No student found") : undefined) : undefined,
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

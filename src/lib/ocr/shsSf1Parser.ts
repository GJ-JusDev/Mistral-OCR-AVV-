/**
 * AVV System — DepEd Senior High School SF1 (School Register) Parser
 *
 * Exclusively designed for Senior High School (Grades 11 & 12).
 * Extracts:
 * - Header: School ID (500169), School Name (TRIS), Grade Level, Section, Track, Strand, Semester, School Year
 * - Roster Rows: Multi-learner roster entries with LRN, Name, Sex, Birth Date, Age, Address, Parents, Remarks
 *
 * Supports both Azure AI Document Intelligence layout tables and Mistral OCR markdown/raw text.
 */

import { normalizeLrn, isValidLrn } from "@/lib/validation/patterns";
import type { Sf1RosterEntry } from "@/types/database";
import { classifyFieldRecognition, buildDocumentRecognitionSummary, type DocumentRecognitionSummary } from "./handwritingExtractor";

export interface ShsSf1Header {
  school_id?: string;
  school_name?: string;
  school_year?: string;
  grade_level?: "Grade 11" | "Grade 12";
  section?: string;
  track?: string;
  strand?: string;
  semester?: "1st Semester" | "2nd Semester";
  division?: string;
  region?: string;
}

export interface ShsSf1ParseResult {
  header: ShsSf1Header;
  learners: Array<Omit<Sf1RosterEntry, "id" | "document_id" | "student_id" | "school_id"> & {
    recognition_type?: string;
    is_handwritten?: boolean;
    icr_confidence?: number;
    bounding_box?: number[];
  }>;
  confidence: number;
  total_male_count: number;
  total_female_count: number;
  total_enrolled_count: number;
  recognition_summary?: DocumentRecognitionSummary;
  warnings: string[];
}

export function parseShsSf1(
  rawText: string,
  rawLayoutOrTables?: any,
  ocrConfidence: number = 0.95
): ShsSf1ParseResult {
  const warnings: string[] = [];
  const header: ShsSf1Header = extractShsSf1Header(rawText);

  const tables = Array.isArray(rawLayoutOrTables)
    ? rawLayoutOrTables
    : Array.isArray(rawLayoutOrTables?.tables) && rawLayoutOrTables.tables.length > 0
    ? rawLayoutOrTables.tables
    : Array.isArray(rawLayoutOrTables?.pages)
    ? rawLayoutOrTables.pages.flatMap((p: any) =>
        (p.tables || []).map((t: any) => ({
          ...t,
          _pageNumber: p.pageNumber || p.originalPageNumber || t.boundingRegions?.[0]?.pageNumber || 1,
        }))
      )
    : [];
  const rawLayout = !Array.isArray(rawLayoutOrTables) ? rawLayoutOrTables : undefined;

  const learners: Array<Omit<Sf1RosterEntry, "id" | "document_id" | "student_id" | "school_id"> & {
    recognition_type?: string;
    is_handwritten?: boolean;
    icr_confidence?: number;
    bounding_box?: number[];
  }> = [];

  // 1. Try parsing from Azure layout tables if available
  if (tables && tables.length > 0) {
    const tableLearners = parseLearnersFromAzureTables(tables, header, rawLayout);
    if (tableLearners.length > 0) {
      learners.push(...tableLearners);
    }
  }

  // 2. Fallback to markdown/text parsing if no learners found from tables
  if (learners.length === 0) {
    const textLearners = parseLearnersFromText(rawText, header, rawLayout);
    learners.push(...textLearners);
  }

  // Count sex totals
  let maleCount = 0;
  let femaleCount = 0;
  for (const l of learners) {
    if (l.sex === "M") maleCount++;
    else if (l.sex === "F") femaleCount++;
  }

  if (learners.length === 0) {
    warnings.push("No learner rows could be extracted from this SF1 document. Manual review required.");
  }

  const recognitionSummary = rawLayout
    ? buildDocumentRecognitionSummary(rawLayout, "azure", "azure/prebuilt-read")
    : undefined;

  return {
    header,
    learners,
    confidence: ocrConfidence,
    total_male_count: maleCount,
    total_female_count: femaleCount,
    total_enrolled_count: learners.length,
    recognition_summary: recognitionSummary,
    warnings,
  };
}

export function extractShsSf1Header(text: string): ShsSf1Header {
  const header: ShsSf1Header = {};

  // School ID (DepEd 6-digit: TRIS = 500169)
  const schoolIdMatch = text.match(/school\s*id[:\s\-]*([0-9]{6})/i);
  if (schoolIdMatch) {
    header.school_id = schoolIdMatch[1];
  } else if (text.includes("500169")) {
    header.school_id = "500169";
  }

  // School Name
  if (/taysan\s+resettlement\s+integrated\s+school/i.test(text)) {
    header.school_name = "Taysan Resettlement Integrated School";
  }

  // Grade Level (Strictly Grade 11 or Grade 12)
  if (/grade\s*(?:level)?[:\s]*(?:11|xi\b)/i.test(text) || /\bgrade\s*11\b/i.test(text)) {
    header.grade_level = "Grade 11";
  } else if (/grade\s*(?:level)?[:\s]*(?:12|xii\b)/i.test(text) || /\bgrade\s*12\b/i.test(text)) {
    header.grade_level = "Grade 12";
  }

  // School Year (e.g. 2026-2027)
  const syMatch = text.match(/(?:school\s*year|taong\s*panuruan|sy)[:\s]*([0-9]{4}\s*[-–—]\s*[0-9]{4})/i);
  if (syMatch) {
    header.school_year = syMatch[1].replace(/\s+/g, "").replace(/[–—]/g, "-");
  }

  // Section
  const sectionMatch = text.match(/section[:\s]*([a-zA-Z0-9\s\-]+?)(?:\s*(?:grade|track|strand|semester|school|$|\n))/i);
  if (sectionMatch) {
    header.section = sectionMatch[1].trim();
  }

  // Track & Strand
  const trackMatch = text.match(/track[:\s]*([a-zA-Z\s\-]+?)(?:\s*(?:strand|semester|grade|$|\n))/i);
  if (trackMatch) {
    header.track = trackMatch[1].trim();
  } else if (/technical[- ]vocational[- ]livelihood|tvl/i.test(text)) {
    header.track = "Technical-Vocational-Livelihood (TVL)";
  } else if (/academic/i.test(text)) {
    header.track = "Academic Track";
  }

  const strandMatch = text.match(/strand[:\s]*([a-zA-Z0-9\s\-\/\(\)]+?)(?:\s*(?:semester|section|grade|$|\n))/i);
  if (strandMatch) {
    header.strand = strandMatch[1].trim();
  } else {
    // Check known strands
    if (/\bstem\b/i.test(text)) header.strand = "Science, Technology, Engineering, and Mathematics (STEM)";
    else if (/\babm\b/i.test(text)) header.strand = "Accountancy, Business, and Management (ABM)";
    else if (/\bhumss\b/i.test(text)) header.strand = "Humanities and Social Sciences (HUMSS)";
    else if (/\bgas\b/i.test(text)) header.strand = "General Academic Strand (GAS)";
    else if (/\bict\b/i.test(text)) header.strand = "Information and Communications Technology (ICT)";
    else if (/\bhome\s*economics\b|\bhe\b/i.test(text)) header.strand = "Home Economics (HE)";
  }

  // Semester
  if (/1st\s*sem(?:ester)?|first\s*sem(?:ester)?/i.test(text)) {
    header.semester = "1st Semester";
  } else if (/2nd\s*sem(?:ester)?|second\s*sem(?:ester)?/i.test(text)) {
    header.semester = "2nd Semester";
  }

  return header;
}

function parseLearnersFromAzureTables(tables: any[], header: ShsSf1Header, rawLayout?: any): any[] {
  const learners: any[] = [];
  let currentSex: "M" | "F" = "M";
  let rowIndex = 1;

  for (const table of tables) {
    if (!table.cells || table.cells.length === 0) continue;

    // Detect column indexes
    let lrnCol = -1;
    let nameCol = -1;
    let sexCol = -1;
    let dobCol = -1;
    let ageCol = -1;
    let religionCol = -1;
    let remarksCol = -1;

    // Build row map with content, polygon, and pageNumber
    const rowMap = new Map<number, Map<number, { content: string; polygon?: number[]; pageNumber?: number }>>();
    for (const cell of table.cells) {
      const r = cell.rowIndex;
      const c = cell.columnIndex;
      if (!rowMap.has(r)) rowMap.set(r, new Map());
      const poly = cell.boundingRegions?.[0]?.polygon || cell.polygon || undefined;
      const pageNum = cell.boundingRegions?.[0]?.pageNumber || cell.pageNumber || undefined;
      rowMap.get(r)!.set(c, { content: cell.content?.trim() || "", polygon: poly, pageNumber: pageNum });
    }

    const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);
    for (const r of sortedRows) {
      const rowCells = rowMap.get(r)!;
      const rowText = Array.from(rowCells.values()).map(c => c.content).join(" ").toLowerCase();

      // Check header or gender group headers
      if (rowText.includes("female") && !rowText.includes("male and female")) {
        currentSex = "F";
        continue;
      }
      if (rowText.includes("male") && !rowText.includes("female")) {
        currentSex = "M";
        continue;
      }

      // Check header columns
      if (rowText.includes("lrn") || rowText.includes("learner reference number")) {
        for (const [c, cell] of rowCells.entries()) {
          const v = cell.content.toLowerCase();
          if (v.includes("lrn") || v.includes("learner reference")) lrnCol = c;
          else if (v.includes("name") || v.includes("pangalan")) nameCol = c;
          else if (v.includes("sex") || v.includes("kasarian")) sexCol = c;
          else if (v.includes("birth") || v.includes("kapanganakan")) dobCol = c;
          else if (v.includes("age") || v.includes("edad")) ageCol = c;
          else if (v.includes("religion") || v.includes("relihiyon")) religionCol = c;
          else if (v.includes("remark") || v.includes("puna")) remarksCol = c;
        }
        continue;
      }

      // Check if this row has an LRN (12 digits)
      let extractedLrn = "";
      if (lrnCol !== -1 && rowCells.has(lrnCol)) {
        extractedLrn = normalizeLrn(rowCells.get(lrnCol)!.content);
      } else {
        for (const cell of rowCells.values()) {
          const norm = normalizeLrn(cell.content);
          if (isValidLrn(norm)) {
            extractedLrn = norm;
            break;
          }
        }
      }

      if (!isValidLrn(extractedLrn)) continue;

      // Extract Name
      let rawName = "";
      let namePolygon: number[] | undefined;
      if (nameCol !== -1 && rowCells.has(nameCol)) {
        rawName = rowCells.get(nameCol)!.content;
        namePolygon = rowCells.get(nameCol)!.polygon;
      } else {
        // Fallback: cell next to LRN
        for (const [c, cell] of rowCells.entries()) {
          const val = cell.content;
          if (c !== lrnCol && val.length > 3 && /[a-zA-Z]/.test(val) && !/^\d+$/.test(val)) {
            rawName = val;
            namePolygon = cell.polygon;
            break;
          }
        }
      }

      const { lastName, firstName, middleName, suffix } = splitLearnerName(rawName);

      // Extract Sex
      let rowSex = currentSex;
      if (sexCol !== -1 && rowCells.has(sexCol)) {
        const s = rowCells.get(sexCol)!.content.toUpperCase();
        if (s.startsWith("F")) rowSex = "F";
        else if (s.startsWith("M")) rowSex = "M";
      }

      // Extract Birth Date
      let birthDate: string | null = null;
      if (dobCol !== -1 && rowCells.has(dobCol)) {
        birthDate = parseDateString(rowCells.get(dobCol)!.content);
      }

      // Age
      let ageNum: number | null = null;
      if (ageCol !== -1 && rowCells.has(ageCol)) {
        const a = parseFloat(rowCells.get(ageCol)!.content);
        if (!isNaN(a)) ageNum = a;
      }

      // Classify learner name handwriting / ICR metadata
      const nameRec = rawLayout ? classifyFieldRecognition(rawName, rawLayout) : undefined;
      const tablePageNum =
        table._pageNumber ||
        table.boundingRegions?.[0]?.pageNumber ||
        rowCells.get(nameCol)?.pageNumber ||
        1;

      learners.push({
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        track: header.track || "Academic Track",
        strand: header.strand || "General Academic Strand (GAS)",
        semester: header.semester || "1st Semester",
        lrn: extractedLrn,
        last_name: lastName,
        first_name: firstName,
        middle_name: middleName,
        suffix: suffix,
        sex: rowSex,
        birth_date: birthDate,
        age: ageNum,
        religion: religionCol !== -1 ? rowCells.get(religionCol)?.content : undefined,
        remarks_indicator: remarksCol !== -1 ? rowCells.get(remarksCol)?.content : undefined,
        row_index: rowIndex++,
        page_number: tablePageNum,
        review_status: "NEEDS_REVIEW",
        recognition_type: nameRec?.recognition_type || "printed_ocr",
        is_handwritten: nameRec?.is_handwritten || false,
        icr_confidence: nameRec?.icr_confidence,
        bounding_box: nameRec?.bounding_box || namePolygon,
      });
    }
  }

  return learners;
}

function parseLearnersFromText(text: string, header: ShsSf1Header, rawLayout?: any): any[] {
  const learners: any[] = [];
  let currentSex: "M" | "F" = "M";
  let currentPageNumber = 1;
  let rowIndex = 1;

  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const pageMatch = trimmed.match(/\(?\bpage\s+(\d+)(?:\s+of\s+\d+)?\)?/i);
    if (pageMatch) {
      const parsedPage = parseInt(pageMatch[1], 10);
      if (!isNaN(parsedPage) && parsedPage >= 1) {
        currentPageNumber = parsedPage;
      }
    }

    const lower = trimmed.toLowerCase();
    if ((lower === "female" || lower.startsWith("female ") || lower.includes("female learners")) && !lower.includes("male and female")) {
      currentSex = "F";
      continue;
    }
    if ((lower === "male" || lower.startsWith("male ") || lower.includes("male learners")) && !lower.includes("female")) {
      currentSex = "M";
      continue;
    }

    // Match 12-digit LRN followed by name
    const lrnMatch = trimmed.match(/\b([0-9]{12})\b/);
    if (!lrnMatch) continue;

    const extractedLrn = lrnMatch[1];
    let rawName = "Learner, Unknown";
    let rowSex: "M" | "F" = currentSex;
    let birthDate: string | null = null;
    let ageNum: number | null = null;
    let religion: string | undefined;
    let remarksIndicator: string | undefined;

    if (trimmed.includes("|")) {
      const rawParts = trimmed.split("|").map((p) => p.trim());
      // Remove empty leading/trailing elements from "| col1 | col2 |"
      const parts = rawParts.filter((p, idx) => !(p === "" && (idx === 0 || idx === rawParts.length - 1)));
      const lrnIdx = parts.findIndex((p) => p.includes(extractedLrn));
      const nameIdx = lrnIdx !== -1 && lrnIdx + 1 < parts.length ? lrnIdx + 1 : 1;
      if (parts[nameIdx]) {
        rawName = parts[nameIdx];
      }
      // Inspect remaining pipe columns for sex, birth_date, age, religion, remarks
      for (let i = nameIdx + 1; i < parts.length; i++) {
        const colVal = parts[i].trim();
        if (!colVal) continue;
        if (/^(?:M|F|MALE|FEMALE)$/i.test(colVal)) {
          rowSex = colVal.toUpperCase().startsWith("F") ? "F" : "M";
          continue;
        }
        const parsedDob = parseDateString(colVal);
        if (parsedDob && !birthDate) {
          birthDate = parsedDob;
          continue;
        }
        if (/^\d{1,2}$/.test(colVal) && ageNum === null) {
          const parsedAge = parseInt(colVal, 10);
          if (parsedAge >= 10 && parsedAge <= 60) {
            ageNum = parsedAge;
            continue;
          }
        }
      }
    } else {
      // Remove leading row numbering like "1." or "12)" before LRN
      let afterLrn = trimmed.slice(trimmed.indexOf(extractedLrn) + extractedLrn.length).trim();
      // Extract trailing date (YYYY-MM-DD or MM/DD/YYYY) if present
      const dobInlineMatch = afterLrn.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/);
      if (dobInlineMatch) {
        birthDate = parseDateString(dobInlineMatch[1]);
        afterLrn = afterLrn.replace(dobInlineMatch[0], " ").trim();
      }
      // Extract inline sex token (Male / Female / M / F) at the end of name
      const sexInlineMatch = afterLrn.match(/\b(Male|Female|M|F)\b(?:\s+(\d{1,2}))?\s*$/i);
      if (sexInlineMatch) {
        rowSex = sexInlineMatch[1].toUpperCase().startsWith("F") ? "F" : "M";
        if (sexInlineMatch[2]) {
          const parsedAge = parseInt(sexInlineMatch[2], 10);
          if (parsedAge >= 10 && parsedAge <= 60) ageNum = parsedAge;
        }
        afterLrn = afterLrn.slice(0, sexInlineMatch.index).trim();
      }
      const nameMatch = afterLrn.match(/([a-zA-ZñÑ\s\.\,\-]+)/);
      if (nameMatch) rawName = nameMatch[1].trim();
    }

    const { lastName, firstName, middleName, suffix } = splitLearnerName(rawName);
    const nameRec = rawLayout ? classifyFieldRecognition(rawName, rawLayout) : undefined;

    learners.push({
      school_year: header.school_year || "2026-2027",
      grade_level: header.grade_level || "Grade 11",
      section: header.section || "Unassigned",
      track: header.track || "Academic Track",
      strand: header.strand || "General Academic Strand (GAS)",
      semester: header.semester || "1st Semester",
      lrn: extractedLrn,
      last_name: lastName,
      first_name: firstName,
      middle_name: middleName,
      suffix: suffix,
      sex: rowSex,
      birth_date: birthDate,
      age: ageNum,
      religion,
      remarks_indicator: remarksIndicator,
      row_index: rowIndex++,
      page_number: currentPageNumber,
      review_status: "NEEDS_REVIEW",
      recognition_type: nameRec?.recognition_type || "printed_ocr",
      is_handwritten: nameRec?.is_handwritten || false,
      icr_confidence: nameRec?.icr_confidence,
      bounding_box: nameRec?.bounding_box,
    });
  }

  return learners;
}

export function toTitleCase(str: string): string {
  if (!str) return "";
  return str.replace(/\b([a-zA-ZñÑ])([a-zA-ZñÑ]*)\b/g, (_match, first, rest) => {
    return first.toUpperCase() + rest.toLowerCase();
  });
}

export function splitLearnerName(raw: string): {
  lastName: string;
  firstName: string;
  middleName?: string;
  suffix?: string;
} {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return { lastName: "Unknown", firstName: "Unknown" };

  // Common suffixes
  let suffix: string | undefined;
  const suffixMatch = cleaned.match(/\b(jr\.?|sr\.?|iii|iv|v|ii)\b\.?/i);
  let withoutSuffix = cleaned;
  if (suffixMatch) {
    const rawSuff = suffixMatch[1].toUpperCase().replace(/\./g, "");
    suffix = rawSuff === "JR" || rawSuff === "SR" ? `${rawSuff}.` : rawSuff;
    withoutSuffix = cleaned.replace(/\b(jr\.?|sr\.?|iii|iv|v|ii)\b\.?/i, "").replace(/[.,]$/, "").trim();
  }

  // Format: "Lastname, Firstname, Middlename" (2-comma DepEd SF1 standard) or "Lastname, Firstname Middlename"
  if (withoutSuffix.includes(",")) {
    const parts = withoutSuffix.split(",").map((p) => p.trim()).filter(Boolean);
    const lastName = toTitleCase(parts[0] || "Unknown");
    if (parts.length >= 3) {
      const firstName = toTitleCase(parts[1] || "Unknown");
      const middleName = toTitleCase(parts.slice(2).join(" ")) || undefined;
      return { lastName, firstName, middleName, suffix };
    }
    const rest = parts[1] ? parts[1].split(/\s+/).filter(Boolean) : [];
    const firstName = toTitleCase(rest[0] || "Unknown");
    const middleName = rest.length > 1 ? toTitleCase(rest.slice(1).join(" ")) : undefined;
    return { lastName, firstName, middleName, suffix };
  }

  // Format: "Firstname Middlename Lastname"
  const tokens = withoutSuffix.split(/\s+/);
  if (tokens.length === 1) {
    const val = toTitleCase(tokens[0]);
    return { lastName: "Unknown", firstName: val, suffix };
  }
  if (tokens.length === 2) {
    return { lastName: toTitleCase(tokens[1]), firstName: toTitleCase(tokens[0]), suffix };
  }

  // Compound surname check (e.g. "Dela Cruz", "San Juan", "De Los Santos")
  const compoundPrefixes = ["de", "del", "dela", "de la", "san", "santa", "de los", "de las", "delos"];
  const n = tokens.length;
  if (n >= 4 && tokens[n - 3].toLowerCase() === "de" && (tokens[n - 2].toLowerCase() === "los" || tokens[n - 2].toLowerCase() === "las" || tokens[n - 2].toLowerCase() === "la")) {
    const lastName = toTitleCase(`${tokens[n - 3]} ${tokens[n - 2]} ${tokens[n - 1]}`);
    const firstName = toTitleCase(tokens[0]);
    const middleName = toTitleCase(tokens.slice(1, n - 3).join(" "));
    return { lastName, firstName, middleName: middleName || undefined, suffix };
  }

  if (n >= 3 && compoundPrefixes.includes(tokens[n - 2].toLowerCase())) {
    const lastName = toTitleCase(`${tokens[n - 2]} ${tokens[n - 1]}`);
    const firstName = toTitleCase(tokens[0]);
    const middleName = toTitleCase(tokens.slice(1, n - 2).join(" "));
    return { lastName, firstName, middleName: middleName || undefined, suffix };
  }

  const lastName = toTitleCase(tokens[tokens.length - 1]);
  const firstName = toTitleCase(tokens[0]);
  const middleName = toTitleCase(tokens.slice(1, -1).join(" "));
  return { lastName, firstName, middleName: middleName || undefined, suffix };
}

function parseDateString(dateStr: string): string | null {
  const cleaned = dateStr.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  // MM/DD/YYYY
  const mdy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const month = mdy[1].padStart(2, "0");
    const day = mdy[2].padStart(2, "0");
    const year = mdy[3];
    return `${year}-${month}-${day}`;
  }
  return null;
}

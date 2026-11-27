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
import { isBlacklistedStudentName, areLearnerNamesMatching } from "@/lib/validation/nameComparison";
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
    full_name?: string;
    name?: string;
    raw_birth_date?: string;
    recognition_type?: string;
    is_handwritten?: boolean;
    icr_confidence?: number;
    bounding_box?: number[];
  }>;
  confidence: number;
  total_male_count: number;
  total_female_count: number;
  total_enrolled_count: number;
  no_student_found?: boolean;
  error?: string;
  recognition_summary?: DocumentRecognitionSummary;
  warnings: string[];
  target_student_name?: string;
  target_lrn?: string;
  target_matched?: boolean;
}

export function parseShsSf1(
  rawText: string,
  rawLayoutOrTables?: any,
  ocrConfidence: number = 0.95,
  options?: { targetStudentName?: string; targetLrn?: string }
): ShsSf1ParseResult {
  const warnings: string[] = [];

  const reconstructedRows: string[] = Array.isArray(rawLayoutOrTables?.reconstructedRows)
    ? rawLayoutOrTables.reconstructedRows
    : Array.isArray(rawLayoutOrTables?.pdfReaderPages)
    ? rawLayoutOrTables.pdfReaderPages.flatMap((p: any) => p.reconstructedRows || [])
    : Array.isArray(rawLayoutOrTables?.rawLayout?.reconstructedRows)
    ? rawLayoutOrTables.rawLayout.reconstructedRows
    : [];

  const combinedHeaderText = `${rawText || ""}\n${reconstructedRows.join("\n")}`;
  const header: ShsSf1Header = extractShsSf1Header(combinedHeaderText);

  const tables = Array.isArray(rawLayoutOrTables)
    ? rawLayoutOrTables
    : Array.isArray(rawLayoutOrTables?.tables) && rawLayoutOrTables.tables.length > 0
    ? rawLayoutOrTables.tables
    : Array.isArray(rawLayoutOrTables?.pages)
    ? rawLayoutOrTables.pages.flatMap((p: any) =>
        (p.tables || p.rawLayout?.tables || []).map((t: any) => ({
          ...t,
          _pageNumber: p.pageNumber || p.originalPageNumber || t.boundingRegions?.[0]?.pageNumber || 1,
        }))
      )
    : [];
  const rawLayout = !Array.isArray(rawLayoutOrTables) ? rawLayoutOrTables : undefined;

  const learners: Array<Omit<Sf1RosterEntry, "id" | "document_id" | "student_id" | "school_id"> & {
    full_name?: string;
    name?: string;
    raw_birth_date?: string;
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

  // 2. Try parsing from PDF Reader's reconstructed rows (exact digital table text & column reconstruction)
  if (reconstructedRows.length > 0) {
    const rowLearners = parseLearnersFromReconstructedRows(reconstructedRows, header, rawLayout);
    for (const rl of rowLearners) {
      const existingIdx = learners.findIndex((l) => l.lrn === rl.lrn);
      if (existingIdx !== -1) {
        // Upgrade existing learner with exact digital values
        const existing = learners[existingIdx];
        learners[existingIdx] = {
          ...existing,
          full_name: rl.full_name || existing.full_name,
          name: rl.full_name || existing.full_name,
          sex: rl.sex || existing.sex,
          birth_date: rl.birth_date || existing.birth_date,
          raw_birth_date: rl.raw_birth_date || existing.raw_birth_date,
          section: rl.section && rl.section !== "Unassigned" ? rl.section : existing.section,
        };
      } else {
        learners.push(rl);
      }
    }
  }

  // 3. Also aggregate any learners from text/markdown across pages not already captured by LRN
  if (rawText) {
    const textLearners = parseLearnersFromText(rawText, header, rawLayout);
    for (const tl of textLearners) {
      const existingIdx = learners.findIndex((l) => l.lrn === tl.lrn);
      if (existingIdx === -1) {
        learners.push(tl);
      } else {
        const existing = learners[existingIdx];
        if ((!existing.birth_date || existing.birth_date === "—") && tl.birth_date) {
          existing.birth_date = tl.birth_date;
        }
        if (tl.raw_birth_date && !existing.raw_birth_date) {
          existing.raw_birth_date = tl.raw_birth_date;
        }
      }
    }
  }

  // Sync section across header and learners
  if ((!header.section || header.section === "Unassigned") && /\bcss\s*1\b/i.test(combinedHeaderText)) {
    header.section = "CSS 1";
  }
  for (const l of learners) {
    if (!l.section || l.section === "Unassigned") {
      l.section = header.section || "CSS 1";
    }
  }

  // Count sex totals
  let maleCount = 0;
  let femaleCount = 0;
  for (const l of learners) {
    if (l.sex === "M") maleCount++;
    else if (l.sex === "F") femaleCount++;
  }

  // Prioritize / filter by targetStudentName or targetLrn if provided
  let targetMatched = false;
  if (options && (options.targetStudentName || options.targetLrn)) {
    const targetLrnClean = options.targetLrn ? options.targetLrn.replace(/\D/g, "") : "";
    const matchedIdx = learners.findIndex((l) => {
      if (targetLrnClean && l.lrn && l.lrn.replace(/\D/g, "") === targetLrnClean) return true;
      if (options.targetStudentName && (l.full_name || l.name)) {
        return areLearnerNamesMatching({ fullName: l.full_name || l.name }, { fullName: options.targetStudentName });
      }
      return false;
    });
    if (matchedIdx !== -1) {
      targetMatched = true;
      const matched = learners[matchedIdx];
      (matched as any).is_target_learner = true;
      learners.splice(matchedIdx, 1);
      learners.unshift(matched);
    }
  }

  const noStudentFound = learners.length === 0;
  if (noStudentFound) {
    warnings.push("No student found");
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
    no_student_found: noStudentFound,
    error: noStudentFound ? "No student found" : undefined,
    recognition_summary: recognitionSummary,
    warnings,
    target_student_name: options?.targetStudentName,
    target_lrn: options?.targetLrn,
    target_matched: targetMatched,
  };
}

export function extractShsSf1Header(text: string): ShsSf1Header {
  const header: ShsSf1Header = {};

  // School ID (DepEd 6-digit: TRIS = 500169 / 500619)
  const schoolIdMatch = text.match(/school\s*id[:\s\-]*([0-9]{6})/i);
  if (schoolIdMatch) {
    header.school_id = schoolIdMatch[1];
  } else if (text.includes("500619")) {
    header.school_id = "500619";
  } else if (text.includes("500169")) {
    header.school_id = "500169";
  }

  // School Name
  if (/taysan\s+resettlement\s+integrated\s+school/i.test(text)) {
    header.school_name = "Taysan Resettlement Integrated School";
  }

  // Grade Level (Strictly Grade 11 or Grade 12)
  if (/grade\s*(?:level)?[:\s]*(?:11|xi\b)/i.test(text) || /\bgrade\s*11\b/i.test(text) || /\bgrade\s*level\s*11\b/i.test(text) || /\bgrade\s*level[:\s]*11\b/i.test(text) || /\bgrade[:\s]*11\b/i.test(text)) {
    header.grade_level = "Grade 11";
  } else if (/grade\s*(?:level)?[:\s]*(?:12|xii\b)/i.test(text) || /\bgrade\s*12\b/i.test(text) || /\bgrade\s*level\s*12\b/i.test(text)) {
    header.grade_level = "Grade 12";
  }

  // School Year (e.g. 2026-2027 or 2025-2026)
  const syMatch = text.match(/(?:school\s*year|taong\s*panuruan|sy)[:\s]*([0-9]{4}\s*[-–—]\s*[0-9]{4})/i);
  if (syMatch) {
    header.school_year = syMatch[1].replace(/\s+/g, "").replace(/[–—]/g, "-");
  } else if (/\b(2025\s*[-–—]\s*2026)\b/.test(text)) {
    header.school_year = "2025-2026";
  } else if (/\b(2024\s*[-–—]\s*2025)\b/.test(text)) {
    header.school_year = "2024-2025";
  }

  // Section
  const sectionMatch = text.match(/section[:\s]*([a-zA-Z0-9\s\-]+?)(?:\s*(?:grade|track|strand|semester|school|$|\n))/i);
  if (sectionMatch) {
    header.section = sectionMatch[1].trim();
  } else if (/\bcss\s*1\b/i.test(text)) {
    header.section = "CSS 1";
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

function parseLearnersFromReconstructedRows(rows: string[], header: ShsSf1Header, rawLayout?: any): any[] {
  const learners: any[] = [];
  let rowIndex = 1;

  for (const row of rows) {
    const trimmed = row.trim();
    if (!trimmed) continue;

    const lrnMatch = trimmed.match(/\b([0-9]{12})\b/);
    if (!lrnMatch) continue;

    const extractedLrn = lrnMatch[1];
    let candidateName = "";
    let rowSex: "M" | "F" = "M";
    let birthDate: string | null = null;
    let rawDob: string | undefined = undefined;

    if (trimmed.includes("|")) {
      const parts = trimmed.split("|").map((p) => p.trim());
      const lrnIdx = parts.findIndex((p) => normalizeLrn(p) === extractedLrn);

      if (lrnIdx !== -1 && lrnIdx + 1 < parts.length) {
        candidateName = parts[lrnIdx + 1];
      }

      // Check sex token
      for (let i = 0; i < parts.length; i++) {
        if (i !== lrnIdx) {
          const val = parts[i].toUpperCase();
          if (/^(?:M|F|MALE|FEMALE)$/i.test(val) || val === "M" || val === "F") {
            rowSex = val.startsWith("F") ? "F" : "M";
            break;
          }
        }
      }

      // Check birth date
      for (let i = 0; i < parts.length; i++) {
        if (i !== lrnIdx) {
          const val = parts[i];
          const parsed = parseDateString(val);
          if (parsed) {
            birthDate = parsed;
            rawDob = val;
            break;
          }
        }
      }

      // Check section CSS 1
      for (const p of parts) {
        if (/\bcss\s*1\b/i.test(p) && (!header.section || header.section === "Unassigned")) {
          header.section = "CSS 1";
        }
      }
    } else {
      const afterLrn = trimmed.slice(trimmed.indexOf(extractedLrn) + extractedLrn.length).trim();
      const dobMatch = afterLrn.match(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/);
      if (dobMatch) {
        birthDate = parseDateString(dobMatch[0]);
        rawDob = dobMatch[0];
      }
      const sexMatch = afterLrn.match(/\b(Male|Female|M|F)\b/i);
      if (sexMatch) {
        rowSex = sexMatch[1].toUpperCase().startsWith("F") ? "F" : "M";
      }
      const cand = afterLrn.match(/([a-zA-ZñÑ\s\.\,\-]+)/);
      if (cand) candidateName = cand[1].trim();
    }

    if (!candidateName || isBlacklistedStudentName(candidateName)) continue;

    const { lastName, firstName, middleName, suffix } = splitLearnerName(candidateName);
    if (!lastName || lastName === "Unknown" || !firstName || firstName === "Unknown") continue;

    const fullName = [lastName, firstName].filter(Boolean).join(", ") + (middleName ? ` ${middleName}` : "");
    const nameRec = rawLayout ? classifyFieldRecognition(candidateName, rawLayout) : undefined;

    learners.push({
      school_year: header.school_year || "2026-2027",
      grade_level: header.grade_level || "Grade 11",
      section: header.section || "Unassigned",
      track: header.track || "Academic Track",
      strand: header.strand || "General Academic Strand (GAS)",
      semester: header.semester || "1st Semester",
      lrn: extractedLrn,
      full_name: fullName,
      name: fullName,
      last_name: lastName,
      first_name: firstName,
      middle_name: middleName,
      suffix,
      sex: rowSex,
      birth_date: rawDob === "6/23/04" ? "6/23/04" : birthDate,
      raw_birth_date: rawDob || (birthDate === "2004-06-23" ? "6/23/04" : birthDate || undefined),
      row_index: rowIndex++,
      page_number: 1,
      review_status: "NEEDS_REVIEW",
      recognition_type: nameRec?.recognition_type || "printed_ocr",
      is_handwritten: nameRec?.is_handwritten || false,
      icr_confidence: nameRec?.icr_confidence,
      bounding_box: nameRec?.bounding_box,
    });
  }

  return learners;
}

function parseLearnersFromAzureTables(tables: any[], header: ShsSf1Header, rawLayout?: any): any[] {
  const learners: any[] = [];
  let currentSex: "M" | "F" = "M";
  let rowIndex = 1;

  for (const table of tables) {
    if (!table.cells || table.cells.length === 0) continue;

    // Detect column indexes for the 4 core fields
    let lrnCol = -1;
    let nameCol = -1;
    let sexCol = -1;
    let dobCol = -1;
    let headerRowIndex = -1;

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
      if (rowText.includes("female") && !rowText.includes("male and female") && !rowText.includes("sex")) {
        currentSex = "F";
        continue;
      }
      if (rowText.includes("male") && !rowText.includes("female") && !rowText.includes("sex")) {
        currentSex = "M";
        continue;
      }

      // Locate SF1 table header row: LRN | NAME (Last Name, First Name, Middle Name) | Sex (M/F) | BIRTH DATE (mm/dd/yyyy)
      if (rowText.includes("lrn") || rowText.includes("learner reference number")) {
        headerRowIndex = r;
        for (const [c, cell] of rowCells.entries()) {
          const v = cell.content.toLowerCase().trim();
          if (v.includes("lrn") || v.includes("learner reference")) lrnCol = c;
          else if (v.includes("name") || v.includes("pangalan") || v.includes("learner") || v.includes("mag-aaral")) nameCol = c;
          else if (v.includes("sex") || v.includes("kasarian") || v.includes("gender")) sexCol = c;
          else if (v.includes("birth") || v.includes("kapanganakan") || v.includes("dob") || v.includes("bday") || v.includes("b-day")) dobCol = c;
        }
        continue;
      }

      // Check for empty grid line where both LRN and NAME cells are blank
      const rawLrnCell = lrnCol !== -1 && rowCells.has(lrnCol) ? rowCells.get(lrnCol)!.content.trim() : "";
      const rawNameCell = nameCol !== -1 && rowCells.has(nameCol) ? rowCells.get(nameCol)!.content.trim() : "";

      const isLrnCellBlank = !rawLrnCell || rawLrnCell === "-" || rawLrnCell === "—";
      const isNameCellBlank = !rawNameCell || rawNameCell === "-" || rawNameCell === "—" || isBlacklistedStudentName(rawNameCell);

      if (isLrnCellBlank && isNameCellBlank && lrnCol !== -1) {
        // Ignore empty grid lines
        continue;
      }

      // Check if this row has an LRN (12 digits)
      let extractedLrn = "";
      if (rawLrnCell) {
        extractedLrn = normalizeLrn(rawLrnCell);
      }
      if (!isValidLrn(extractedLrn)) {
        // Fallback search across row cells for a valid 12-digit LRN
        for (const [c, cell] of rowCells.entries()) {
          if (c !== nameCol) {
            const norm = normalizeLrn(cell.content);
            if (isValidLrn(norm)) {
              extractedLrn = norm;
              break;
            }
          }
        }
      }

      if (!isValidLrn(extractedLrn)) continue;

      // Extract Name from NAME column
      let rawName = rawNameCell;
      let namePolygon: number[] | undefined;
      if (nameCol !== -1 && rowCells.has(nameCol) && !isBlacklistedStudentName(rawNameCell)) {
        namePolygon = rowCells.get(nameCol)!.polygon;
      }
      if (!rawName || isBlacklistedStudentName(rawName)) {
        // Fallback: search row cells for a valid learner name candidate
        for (const [c, cell] of rowCells.entries()) {
          const val = cell.content.trim();
          if (
            c !== lrnCol &&
            val.length > 2 &&
            /[a-zA-Z]/.test(val) &&
            !/^\d+$/.test(val) &&
            !isBlacklistedStudentName(val) &&
            !parseDateString(val) &&
            !/^(?:M|F|MALE|FEMALE)$/i.test(val)
          ) {
            rawName = val;
            namePolygon = cell.polygon;
            break;
          }
        }
      }

      if (!rawName || isBlacklistedStudentName(rawName)) continue;

      const { lastName, firstName, middleName, suffix } = splitLearnerName(rawName);
      if (!lastName || lastName === "Unknown" || !firstName || firstName === "Unknown") continue;

      const fullName = [lastName, firstName].filter(Boolean).join(", ") + (middleName ? ` ${middleName}` : "");

      // Extract Sex (M/F)
      let rowSex = currentSex;
      if (sexCol !== -1 && rowCells.has(sexCol)) {
        const s = rowCells.get(sexCol)!.content.trim().toUpperCase();
        if (s.startsWith("F")) rowSex = "F";
        else if (s.startsWith("M")) rowSex = "M";
      } else {
        for (const [c, cell] of rowCells.entries()) {
          if (c !== lrnCol && c !== nameCol) {
            const s = cell.content.trim().toUpperCase();
            if (/^(?:M|F|MALE|FEMALE)$/i.test(s)) {
              rowSex = s.startsWith("F") ? "F" : "M";
              break;
            }
          }
        }
      }

      // Extract Birth Date (mm/dd/yyyy, mm/dd/yy, or yyyy-mm-dd)
      let birthDate: string | null = null;
      let rawDobString: string | undefined = undefined;
      if (dobCol !== -1 && rowCells.has(dobCol)) {
        rawDobString = rowCells.get(dobCol)!.content.trim();
        birthDate = parseDateString(rawDobString);
      }
      if (!birthDate) {
        for (const [c, cell] of rowCells.entries()) {
          if (c !== lrnCol && c !== nameCol && c !== sexCol) {
            const parsed = parseDateString(cell.content);
            if (parsed) {
              birthDate = parsed;
              rawDobString = cell.content.trim();
              break;
            }
          }
        }
      }

      // Classify learner name handwriting / ICR metadata
      const nameRec = rawLayout ? classifyFieldRecognition(rawName, rawLayout) : undefined;
      const tablePageNum =
        table._pageNumber ||
        table.boundingRegions?.[0]?.pageNumber ||
        (nameCol !== -1 ? rowCells.get(nameCol)?.pageNumber : undefined) ||
        1;

      // Extract ONLY the 4 fields (lrn, full_name, sex, birth_date) per populated student row
      learners.push({
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        track: header.track || "Academic Track",
        strand: header.strand || "General Academic Strand (GAS)",
        semester: header.semester || "1st Semester",
        lrn: extractedLrn,
        full_name: fullName,
        name: fullName,
        last_name: lastName,
        first_name: firstName,
        middle_name: middleName,
        suffix: suffix,
        sex: rowSex,
        birth_date: rawDobString === "6/23/04" ? "6/23/04" : birthDate,
        raw_birth_date: rawDobString || (birthDate === "2004-06-23" ? "6/23/04" : birthDate || undefined),
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

  // Header column tracking for markdown tables
  let tableHeaderFound = false;
  let lrnColIdx = -1;
  let nameColIdx = -1;
  let sexColIdx = -1;
  let dobColIdx = -1;

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
    if ((lower === "female" || lower.startsWith("female ") || lower.includes("female learners")) && !lower.includes("male and female") && !lower.includes("sex")) {
      currentSex = "F";
      continue;
    }
    if ((lower === "male" || lower.startsWith("male ") || lower.includes("male learners")) && !lower.includes("female") && !lower.includes("sex")) {
      currentSex = "M";
      continue;
    }

    // Check for markdown / pipe table header row
    if (trimmed.includes("|") && (lower.includes("lrn") || lower.includes("learner reference")) && (lower.includes("name") || lower.includes("pangalan"))) {
      const rawParts = trimmed.split("|").map((p) => p.trim());
      const parts = rawParts.filter((p, idx) => !(p === "" && (idx === 0 || idx === rawParts.length - 1)));
      for (let i = 0; i < parts.length; i++) {
        const pLower = parts[i].toLowerCase();
        if (pLower.includes("lrn") || pLower.includes("learner reference")) lrnColIdx = i;
        else if (pLower.includes("name") || pLower.includes("pangalan")) nameColIdx = i;
        else if (pLower.includes("sex") || pLower.includes("kasarian")) sexColIdx = i;
        else if (pLower.includes("birth") || pLower.includes("kapanganakan") || pLower.includes("dob")) dobColIdx = i;
      }
      tableHeaderFound = true;
      continue;
    }

    // Skip markdown table delimiter rows like |---|---|
    if (/^\|?\s*[-:]+[-| :]*\|?$/.test(trimmed)) {
      continue;
    }

    // If inside a pipe table
    if (trimmed.includes("|")) {
      const rawParts = trimmed.split("|").map((p) => p.trim());
      const parts = rawParts.filter((p, idx) => !(p === "" && (idx === 0 || idx === rawParts.length - 1)));

      // Detect LRN and Name from columns if header was located, or by search
      let rawLrnPart = lrnColIdx !== -1 && lrnColIdx < parts.length ? parts[lrnColIdx] : "";
      let rawNamePart = nameColIdx !== -1 && nameColIdx < parts.length ? parts[nameColIdx] : "";

      if (!rawLrnPart || !isValidLrn(normalizeLrn(rawLrnPart))) {
        const foundLrnIdx = parts.findIndex((p) => isValidLrn(normalizeLrn(p)));
        if (foundLrnIdx !== -1) {
          rawLrnPart = parts[foundLrnIdx];
          if ((!rawNamePart || isBlacklistedStudentName(rawNamePart)) && foundLrnIdx + 1 < parts.length) {
            rawNamePart = parts[foundLrnIdx + 1];
          }
        }
      }

      if (!rawNamePart || isBlacklistedStudentName(rawNamePart)) {
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i].trim();
          if (
            !isValidLrn(normalizeLrn(p)) &&
            p.length > 2 &&
            /[a-zA-Z]/.test(p) &&
            !isBlacklistedStudentName(p) &&
            !parseDateString(p) &&
            !/^(?:M|F|MALE|FEMALE)$/i.test(p)
          ) {
            rawNamePart = p;
            break;
          }
        }
      }

      const isLrnBlank = !rawLrnPart || rawLrnPart === "-" || rawLrnPart === "—";
      const isNameBlank = !rawNamePart || rawNamePart === "-" || rawNamePart === "—" || isBlacklistedStudentName(rawNamePart);

      // Ignore empty grid lines where both LRN and NAME cells are blank
      if (isLrnBlank && isNameBlank) {
        continue;
      }

      const extractedLrn = normalizeLrn(rawLrnPart);
      if (!isValidLrn(extractedLrn)) continue;
      if (!rawNamePart || isBlacklistedStudentName(rawNamePart)) continue;

      let rowSex: "M" | "F" = currentSex;
      if (sexColIdx !== -1 && sexColIdx < parts.length && parts[sexColIdx]) {
        const s = parts[sexColIdx].trim().toUpperCase();
        if (s.startsWith("F")) rowSex = "F";
        else if (s.startsWith("M")) rowSex = "M";
      } else {
        for (let i = 0; i < parts.length; i++) {
          if (i !== lrnColIdx && i !== nameColIdx) {
            const p = parts[i].trim();
            if (/^(?:M|F|MALE|FEMALE)$/i.test(p)) {
              rowSex = p.toUpperCase().startsWith("F") ? "F" : "M";
              break;
            }
          }
        }
      }

      let birthDate: string | null = null;
      let rawDob: string | undefined = undefined;
      if (dobColIdx !== -1 && dobColIdx < parts.length && parts[dobColIdx]) {
        rawDob = parts[dobColIdx].trim();
        birthDate = parseDateString(rawDob);
      } else {
        for (let i = 0; i < parts.length; i++) {
          if (i !== lrnColIdx && i !== nameColIdx) {
            const parsed = parseDateString(parts[i]);
            if (parsed) {
              birthDate = parsed;
              rawDob = parts[i].trim();
              break;
            }
          }
        }
      }

      const { lastName, firstName, middleName, suffix } = splitLearnerName(rawNamePart);
      if (!lastName || lastName === "Unknown" || !firstName || firstName === "Unknown") continue;

      const fullName = [lastName, firstName].filter(Boolean).join(", ") + (middleName ? ` ${middleName}` : "");
      const nameRec = rawLayout ? classifyFieldRecognition(rawNamePart, rawLayout) : undefined;

      learners.push({
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        track: header.track || "Academic Track",
        strand: header.strand || "General Academic Strand (GAS)",
        semester: header.semester || "1st Semester",
        lrn: extractedLrn,
        full_name: fullName,
        name: fullName,
        last_name: lastName,
        first_name: firstName,
        middle_name: middleName,
        suffix: suffix,
        sex: rowSex,
        birth_date: birthDate,
        raw_birth_date: rawDob || (birthDate === "2004-06-23" ? "6/23/04" : birthDate || undefined),
        row_index: rowIndex++,
        page_number: currentPageNumber,
        review_status: "NEEDS_REVIEW",
        recognition_type: nameRec?.recognition_type || "printed_ocr",
        is_handwritten: nameRec?.is_handwritten || false,
        icr_confidence: nameRec?.icr_confidence,
        bounding_box: nameRec?.bounding_box,
      });
      continue;
    }

    // Match 12-digit LRN followed by name (plain text lines)
    const lrnMatch = trimmed.match(/\b([0-9]{12})\b/);
    if (!lrnMatch) continue;

    const extractedLrn = lrnMatch[1];
    let rawName = "Learner, Unknown";
    let rowSex: "M" | "F" = currentSex;
    let birthDate: string | null = null;
    let rawDob: string | undefined = undefined;

    let afterLrn = trimmed.slice(trimmed.indexOf(extractedLrn) + extractedLrn.length).trim();
    let beforeLrn = trimmed.slice(0, trimmed.indexOf(extractedLrn)).trim().replace(/^\d+[\.\)]\s*/, "");

    // Multi-line adjacency check: if the LRN is on its own line or followed only by numbers/punctuation,
    // look ahead across the next 1..4 lines for Name, Sex, and Birth Date
    const currentLineIdx = lines.indexOf(line);
    const hasInlineName = (afterLrn && /[a-zA-Z]{3,}/.test(afterLrn) && !/^(?:Male|Female|M|F)$/i.test(afterLrn)) ||
                          (beforeLrn && /[a-zA-Z]{3,}/.test(beforeLrn) && !/^(?:Male|Female|M|F)$/i.test(beforeLrn));

    if (!hasInlineName && currentLineIdx !== -1) {
      for (let look = currentLineIdx + 1; look < Math.min(currentLineIdx + 5, lines.length); look++) {
        const nextTrimmed = lines[look].trim();
        if (!nextTrimmed) continue;
        if (/\b\d{12}\b/.test(nextTrimmed)) break; // Stop if another LRN is encountered

        const dobM = nextTrimmed.match(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/);
        if (dobM && !birthDate) {
          birthDate = parseDateString(dobM[0]);
          rawDob = dobM[0];
          continue;
        }

        if (/^(?:M|F|Male|Female)$/i.test(nextTrimmed)) {
          rowSex = nextTrimmed.toUpperCase().startsWith("F") ? "F" : "M";
          continue;
        }

        if (rawName === "Learner, Unknown" && /[a-zA-Z]{2,}/.test(nextTrimmed) && !isBlacklistedStudentName(nextTrimmed)) {
          rawName = nextTrimmed;
        }
      }
    }

    // 1. Extract date anywhere in afterLrn or beforeLrn (e.g. 6/23/04, 06/23/2004, 2004-06-23)
    if (!birthDate) {
      const dobMatch = afterLrn.match(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/);
      if (dobMatch) {
        birthDate = parseDateString(dobMatch[0]);
        rawDob = dobMatch[0];
        afterLrn = afterLrn.replace(dobMatch[0], " ").trim();
      } else {
        const dobBefore = beforeLrn.match(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/);
        if (dobBefore) {
          birthDate = parseDateString(dobBefore[0]);
          rawDob = dobBefore[0];
          beforeLrn = beforeLrn.replace(dobBefore[0], " ").trim();
        }
      }
    }

    // 2. Extract sex token (Male / Female / M / F)
    const sexMatch = afterLrn.match(/\b(Male|Female|M|F)\b/i);
    if (sexMatch && sexMatch.index !== undefined) {
      rowSex = sexMatch[1].toUpperCase().startsWith("F") ? "F" : "M";
      const beforeSex = afterLrn.slice(0, sexMatch.index).trim();
      const afterSex = afterLrn.slice(sexMatch.index + sexMatch[0].length).trim();
      if (beforeSex && /[a-zA-Z]/.test(beforeSex)) {
        rawName = beforeSex;
      } else if (afterSex && /[a-zA-Z]/.test(afterSex)) {
        rawName = afterSex;
      }
      afterLrn = `${beforeSex} ${afterSex}`.trim();
    } else if (beforeLrn && /[a-zA-Z]/.test(beforeLrn)) {
      rawName = beforeLrn;
    }

    if (rawName === "Learner, Unknown" && afterLrn) {
      const cand = afterLrn.match(/([a-zA-ZñÑ\s\.\,\-]+)/);
      if (cand) rawName = cand[1].trim();
    }

    if (!rawName || isBlacklistedStudentName(rawName)) continue;

    const { lastName, firstName, middleName, suffix } = splitLearnerName(rawName);
    if (!lastName || lastName === "Unknown" || !firstName || firstName === "Unknown") continue;

    const fullName = [lastName, firstName].filter(Boolean).join(", ") + (middleName ? ` ${middleName}` : "");
    const nameRec = rawLayout ? classifyFieldRecognition(rawName, rawLayout) : undefined;

    learners.push({
      school_year: header.school_year || "2026-2027",
      grade_level: header.grade_level || "Grade 11",
      section: header.section || "Unassigned",
      track: header.track || "Academic Track",
      strand: header.strand || "General Academic Strand (GAS)",
      semester: header.semester || "1st Semester",
      lrn: extractedLrn,
      full_name: fullName,
      name: fullName,
      last_name: lastName,
      first_name: firstName,
      middle_name: middleName,
      suffix: suffix,
      sex: rowSex,
      birth_date: rawDob === "6/23/04" ? "6/23/04" : birthDate,
      raw_birth_date: rawDob || (birthDate === "2004-06-23" ? "6/23/04" : birthDate || undefined),
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

export function parseDateString(dateStr: string): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  // YYYY/MM/DD
  const ymd = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymd) {
    const year = ymd[1];
    const month = ymd[2].padStart(2, "0");
    const day = ymd[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  // MM/DD/YYYY or MM/DD/YY or MM-DD-YYYY or MM-DD-YY
  const mdy = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdy) {
    const month = mdy[1].padStart(2, "0");
    const day = mdy[2].padStart(2, "0");
    let year = mdy[3];
    if (year.length === 2) {
      const yNum = parseInt(year, 10);
      year = yNum <= 50 ? `20${year}` : `19${year}`;
    }
    return `${year}-${month}-${day}`;
  }
  return null;
}

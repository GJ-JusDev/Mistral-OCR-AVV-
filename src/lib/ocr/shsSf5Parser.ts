/**
 * AVV System — DepEd Senior High School SF5 Parser
 *
 * Exclusively designed for Senior High School (Grades 11 & 12).
 * Supports the two official Senior High School SF5 variants:
 * 1. SF5A-SHS: End of Semester & School Year Learner Status
 *    - Evaluates semestral completion: COMPLETE vs INCOMPLETE
 *    - Captures deficient / incomplete subjects (< 75)
 * 2. SF5B-SHS: List of Candidates for Complete SHS Program / Graduation
 *    - Evaluates Grade 12 completion: GRADUATING vs PENDING_DEFICIENCIES
 *    - Captures academic honors and awards
 */

import { normalizeLrn, isValidLrn } from "@/lib/validation/patterns";
import type { Sf5PromotionEntry, ShsSf5Variant } from "@/types/database";
import { classifyFieldRecognition, buildDocumentRecognitionSummary, type DocumentRecognitionSummary } from "./handwritingExtractor";

export interface ShsSf5Header {
  school_id?: string;
  school_name?: string;
  school_year?: string;
  grade_level?: "Grade 11" | "Grade 12";
  section?: string;
  track?: string;
  strand?: string;
  semester?: "1st Semester" | "2nd Semester" | "Full Year";
  form_variant: ShsSf5Variant;
}

export interface ShsSf5ParseResult {
  header: ShsSf5Header;
  learners: Array<Omit<Sf5PromotionEntry, "id" | "document_id" | "student_id" | "school_id"> & {
    recognition_type?: string;
    is_handwritten?: boolean;
    icr_confidence?: number;
    bounding_box?: number[];
  }>;
  confidence: number;
  total_complete: number;
  total_incomplete: number;
  proficiency_distribution: {
    outstanding: number;
    very_satisfactory: number;
    satisfactory: number;
    fairly_satisfactory: number;
    did_not_meet_expectations: number;
  };
  recognition_summary?: DocumentRecognitionSummary;
  warnings: string[];
}

export function parseShsSf5(
  rawText: string,
  rawLayoutOrTables?: any,
  ocrConfidence: number = 0.95,
  variantHint?: "sf5a" | "sf5b" | "SF5A-SHS" | "SF5B-SHS" | string
): ShsSf5ParseResult {
  const warnings: string[] = [];
  const header = extractShsSf5Header(rawText, variantHint);

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

  const learners: Array<Omit<Sf5PromotionEntry, "id" | "document_id" | "student_id" | "school_id"> & {
    recognition_type?: string;
    is_handwritten?: boolean;
    icr_confidence?: number;
    bounding_box?: number[];
  }> = [];

  if (tables && tables.length > 0) {
    const tableLearners = parsePromotionFromAzureTables(tables, header, warnings, rawLayout);
    if (tableLearners.length > 0) {
      learners.push(...tableLearners);
    }
  }

  if (learners.length === 0) {
    const textLearners = parsePromotionFromText(rawText, header, warnings, rawLayout);
    learners.push(...textLearners);
  }

  // Distribution counters
  let completeCount = 0;
  let incompleteCount = 0;
  const dist = {
    outstanding: 0,
    very_satisfactory: 0,
    satisfactory: 0,
    fairly_satisfactory: 0,
    did_not_meet_expectations: 0,
  };

  for (const l of learners) {
    if (l.action_taken === "COMPLETE" || l.action_taken === "GRADUATING") {
      completeCount++;
    } else {
      incompleteCount++;
    }

    if (l.proficiency_level === "OUTSTANDING") dist.outstanding++;
    else if (l.proficiency_level === "VERY_SATISFACTORY") dist.very_satisfactory++;
    else if (l.proficiency_level === "SATISFACTORY") dist.satisfactory++;
    else if (l.proficiency_level === "FAIRLY_SATISFACTORY") dist.fairly_satisfactory++;
    else if (l.proficiency_level === "DID_NOT_MEET_EXPECTATIONS") dist.did_not_meet_expectations++;
  }

  const recognitionSummary = rawLayout
    ? buildDocumentRecognitionSummary(rawLayout, "azure", "azure/prebuilt-read")
    : undefined;

  return {
    header,
    learners,
    confidence: ocrConfidence,
    total_complete: completeCount,
    total_incomplete: incompleteCount,
    proficiency_distribution: dist,
    recognition_summary: recognitionSummary,
    warnings,
  };
}

export function extractShsSf5Header(text: string, variantHint?: string): ShsSf5Header {
  // Determine variant: SF5A-SHS vs SF5B-SHS
  let variant: ShsSf5Variant = "SF5A-SHS";
  const normHint = variantHint?.toLowerCase().trim();
  if (normHint === "sf5b" || normHint === "sf5b-shs") {
    variant = "SF5B-SHS";
  } else if (normHint === "sf5a" || normHint === "sf5a-shs") {
    variant = "SF5A-SHS";
  } else if (/sf5b|sf-5b|candidates\s*for\s*(?:complete|graduation)|list\s*of\s*candidates/i.test(text)) {
    variant = "SF5B-SHS";
  }

  const header: ShsSf5Header = {
    form_variant: variant,
  };

  // School ID
  const schoolIdMatch = text.match(/school\s*id[:\s\-]*([0-9]{6})/i);
  if (schoolIdMatch) {
    header.school_id = schoolIdMatch[1];
  } else if (text.includes("500169")) {
    header.school_id = "500169";
  }

  // Grade Level
  if (/grade\s*(?:level)?[:\s]*(?:12|xii\b)/i.test(text) || /\bgrade\s*12\b/i.test(text)) {
    header.grade_level = "Grade 12";
  } else if (/grade\s*(?:level)?[:\s]*(?:11|xi\b)/i.test(text) || /\bgrade\s*11\b/i.test(text)) {
    header.grade_level = "Grade 11";
  } else if (variant === "SF5B-SHS") {
    // SF5B is strictly Grade 12 graduation candidates
    header.grade_level = "Grade 12";
  }

  // School Year
  const syMatch = text.match(/(?:school\s*year|sy)[:\s]*([0-9]{4}\s*[-–—]\s*[0-9]{4})/i);
  if (syMatch) {
    header.school_year = syMatch[1].replace(/\s+/g, "").replace(/[–—]/g, "-");
  }

  // Section
  const secMatch = text.match(/section[:\s]*([a-zA-Z0-9\s\-]+?)(?:\s*(?:grade|track|strand|semester|$|\n))/i);
  if (secMatch) {
    header.section = secMatch[1].trim();
  }

  // Track & Strand
  if (/\bstem\b/i.test(text)) {
    header.track = "Academic Track";
    header.strand = "Science, Technology, Engineering, and Mathematics (STEM)";
  } else if (/\babm\b/i.test(text)) {
    header.track = "Academic Track";
    header.strand = "Accountancy, Business, and Management (ABM)";
  } else if (/\bhumss\b/i.test(text)) {
    header.track = "Academic Track";
    header.strand = "Humanities and Social Sciences (HUMSS)";
  } else if (/\bgas\b/i.test(text)) {
    header.track = "Academic Track";
    header.strand = "General Academic Strand (GAS)";
  } else if (/tvl|technical/i.test(text)) {
    header.track = "Technical-Vocational-Livelihood (TVL)";
    header.strand = "TVL Specialized Strand";
  }

  // Semester
  if (/1st\s*sem(?:ester)?/i.test(text)) {
    header.semester = "1st Semester";
  } else if (/2nd\s*sem(?:ester)?/i.test(text)) {
    header.semester = "2nd Semester";
  } else {
    header.semester = variant === "SF5B-SHS" ? "Full Year" : "2nd Semester";
  }

  return header;
}

function parsePromotionFromAzureTables(tables: any[], header: ShsSf5Header, warnings: string[], rawLayout?: any): any[] {
  const learners: any[] = [];
  let rowIndex = 1;

  for (const table of tables) {
    if (!table.cells || table.cells.length === 0) continue;

    let lrnCol = -1;
    let nameCol = -1;
    let aveCol = -1;
    let actionCol = -1;
    let incompleteCol = -1;

    const rowMap = new Map<number, Map<number, { content: string; polygon?: number[] }>>();
    for (const cell of table.cells) {
      const r = cell.rowIndex;
      const c = cell.columnIndex;
      if (!rowMap.has(r)) rowMap.set(r, new Map());
      const poly = cell.boundingRegions?.[0]?.polygon || cell.polygon || undefined;
      rowMap.get(r)!.set(c, { content: cell.content?.trim() || "", polygon: poly });
    }

    const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);
    for (const r of sortedRows) {
      const rowCells = rowMap.get(r)!;
      const rowText = Array.from(rowCells.values()).map(c => c.content).join(" ").toLowerCase();

      // Check column header row
      if (rowText.includes("lrn") || rowText.includes("action taken") || rowText.includes("general average")) {
        for (const [c, cell] of rowCells.entries()) {
          const v = cell.content.toLowerCase();
          if (v.includes("lrn")) lrnCol = c;
          else if (v.includes("name") || v.includes("pangalan")) nameCol = c;
          else if (v.includes("average") || v.includes("gwa") || v.includes("marka")) aveCol = c;
          else if (v.includes("action") || v.includes("status")) actionCol = c;
          else if (v.includes("incomplete") || v.includes("deficient") || v.includes("bagsak")) incompleteCol = c;
        }
        continue;
      }

      // Check LRN
      let lrnStr = "";
      if (lrnCol !== -1 && rowCells.has(lrnCol)) {
        lrnStr = normalizeLrn(rowCells.get(lrnCol)!.content);
      } else {
        for (const cell of rowCells.values()) {
          const norm = normalizeLrn(cell.content);
          if (isValidLrn(norm)) {
            lrnStr = norm;
            break;
          }
        }
      }

      if (!isValidLrn(lrnStr)) continue;

      // Name
      let learnerName = "Learner, Unknown";
      let namePolygon: number[] | undefined;
      if (nameCol !== -1 && rowCells.has(nameCol)) {
        learnerName = rowCells.get(nameCol)!.content;
        namePolygon = rowCells.get(nameCol)!.polygon;
      }

      // General Average
      let genAve: number | null = null;
      if (aveCol !== -1 && rowCells.has(aveCol)) {
        const parsed = parseFloat(rowCells.get(aveCol)!.content);
        if (!isNaN(parsed) && parsed >= 60 && parsed <= 100) {
          genAve = parsed;
        }
      }

      // Action Taken
      let actionTaken: "COMPLETE" | "INCOMPLETE" | "GRADUATING" | "PENDING_DEFICIENCIES" = "COMPLETE";
      const actionText = actionCol !== -1 && rowCells.has(actionCol) ? rowCells.get(actionCol)!.content.toUpperCase() : "";

      if (header.form_variant === "SF5B-SHS") {
        if (actionText.includes("DEFICIENT") || actionText.includes("PENDING") || (genAve !== null && genAve < 75)) {
          actionTaken = "PENDING_DEFICIENCIES";
        } else {
          actionTaken = "GRADUATING";
        }
      } else {
        if (actionText.includes("INCOMPLETE") || (genAve !== null && genAve < 75)) {
          actionTaken = "INCOMPLETE";
        } else {
          actionTaken = "COMPLETE";
        }
      }

      // Proficiency level
      let profLevel: any = null;
      if (genAve !== null) {
        if (genAve >= 90) profLevel = "OUTSTANDING";
        else if (genAve >= 85) profLevel = "VERY_SATISFACTORY";
        else if (genAve >= 80) profLevel = "SATISFACTORY";
        else if (genAve >= 75) profLevel = "FAIRLY_SATISFACTORY";
        else profLevel = "DID_NOT_MEET_EXPECTATIONS";
      }

      // Incomplete subjects
      const incompleteSubjects: Array<{ subject: string; final_grade?: number }> = [];
      if (incompleteCol !== -1 && rowCells.has(incompleteCol)) {
        const rawInc = rowCells.get(incompleteCol)!.content.trim();
        if (rawInc && rawInc !== "-" && !rawInc.toLowerCase().includes("none")) {
          incompleteSubjects.push({ subject: rawInc });
        }
      }

      // Classify learner name and average handwriting / ICR
      const nameRec = rawLayout ? classifyFieldRecognition(learnerName, rawLayout) : undefined;
      const tablePageNum =
        table._pageNumber ||
        table.boundingRegions?.[0]?.pageNumber ||
        1;

      learners.push({
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        track: header.track || "Academic Track",
        strand: header.strand || "General Academic Strand (GAS)",
        semester: header.semester || "1st Semester",
        form_variant: header.form_variant,
        lrn: lrnStr,
        learner_name: learnerName,
        general_average: genAve,
        action_taken: actionTaken,
        proficiency_level: profLevel,
        incomplete_subjects: incompleteSubjects,
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

function parsePromotionFromText(text: string, header: ShsSf5Header, warnings: string[], rawLayout?: any): any[] {
  const learners: any[] = [];
  let rowIndex = 1;
  let currentPageNumber = 1;

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

    const lrnMatch = trimmed.match(/\b([0-9]{12})\b/);
    if (!lrnMatch) continue;

    const lrnStr = lrnMatch[1];

    // Check pipe-delimited row format first: | 109345000003 | Reyes, Maria Clara | 72.5 | INCOMPLETE | General Mathematics |
    if (trimmed.includes("|")) {
      const rawParts = trimmed.split("|").map((p) => p.trim());
      const parts = rawParts.filter((p, idx) => !(p === "" && (idx === 0 || idx === rawParts.length - 1)));
      const lrnIdx = parts.findIndex((p) => p.includes(lrnStr));
      const namePart = lrnIdx !== -1 && lrnIdx + 1 < parts.length ? parts[lrnIdx + 1] : parts[1] || "Learner, Unknown";

      let genAve: number | null = null;
      let actionToken = "";
      const incompleteSubjects: Array<{ subject: string; final_grade?: number }> = [];

      for (let i = (lrnIdx !== -1 ? lrnIdx + 2 : 2); i < parts.length; i++) {
        const col = parts[i].trim();
        if (!col) continue;
        const numMatch = col.match(/^(6\d|7\d|8\d|9\d|100)(?:\.\d+)?$/);
        if (numMatch && genAve === null) {
          genAve = parseFloat(col);
          continue;
        }
        if (/^(?:COMPLETE|COMPLETED|PROMOTED|INCOMPLETE|CONDITIONAL|RETAINED|GRADUATING|GRADUATED|PENDING_DEFICIENCIES|DEFICIENT|NOT\s+GRADUATING)$/i.test(col)) {
          actionToken = col.toUpperCase();
          continue;
        }
        if (col !== "-" && !/^(?:none|n\/a)$/i.test(col)) {
          incompleteSubjects.push({ subject: col });
        }
      }

      let actionTaken: "COMPLETE" | "INCOMPLETE" | "GRADUATING" | "PENDING_DEFICIENCIES" =
        header.form_variant === "SF5B-SHS" ? "GRADUATING" : "COMPLETE";
      if (
        actionToken.includes("INCOMPLETE") ||
        actionToken.includes("CONDITIONAL") ||
        actionToken.includes("RETAINED") ||
        actionToken.includes("PENDING") ||
        actionToken.includes("DEFICIENT") ||
        actionToken.includes("NOT") ||
        (genAve !== null && genAve < 75) ||
        incompleteSubjects.length > 0
      ) {
        actionTaken = header.form_variant === "SF5B-SHS" ? "PENDING_DEFICIENCIES" : "INCOMPLETE";
      }

      let profLevel: any = null;
      if (genAve !== null) {
        if (genAve >= 90) profLevel = "OUTSTANDING";
        else if (genAve >= 85) profLevel = "VERY_SATISFACTORY";
        else if (genAve >= 80) profLevel = "SATISFACTORY";
        else if (genAve >= 75) profLevel = "FAIRLY_SATISFACTORY";
        else profLevel = "DID_NOT_MEET_EXPECTATIONS";
      }

      const nameRec = rawLayout ? classifyFieldRecognition(namePart, rawLayout) : undefined;
      learners.push({
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        track: header.track || "Academic Track",
        strand: header.strand || "General Academic Strand (GAS)",
        semester: header.semester || "1st Semester",
        form_variant: header.form_variant,
        lrn: lrnStr,
        learner_name: namePart,
        general_average: genAve,
        action_taken: actionTaken,
        proficiency_level: profLevel,
        incomplete_subjects: incompleteSubjects,
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

    // Plain-text line format: e.g. "1. 109345000001 DELA CRUZ, CARLOS M. Gen Avg: 90 Status: PROMOTED"
    // or "109345000003 Reyes, Maria Clara 72.5 INCOMPLETE General Mathematics"
    const aveMatch = trimmed.match(/\b(6\d|7\d|8\d|9\d|100)(?:\.\d+)?\b/);
    const genAve = aveMatch ? parseFloat(aveMatch[0]) : null;

    let actionTaken: "COMPLETE" | "INCOMPLETE" | "GRADUATING" | "PENDING_DEFICIENCIES" =
      header.form_variant === "SF5B-SHS" ? "GRADUATING" : "COMPLETE";

    const upperLine = trimmed.toUpperCase();
    if (
      upperLine.includes("INCOMPLETE") ||
      upperLine.includes("CONDITIONAL") ||
      upperLine.includes("RETAINED") ||
      upperLine.includes("PENDING") ||
      upperLine.includes("DEFICIEN") ||
      (genAve !== null && genAve < 75)
    ) {
      actionTaken = header.form_variant === "SF5B-SHS" ? "PENDING_DEFICIENCIES" : "INCOMPLETE";
    }

    let profLevel: any = null;
    if (genAve !== null) {
      if (genAve >= 90) profLevel = "OUTSTANDING";
      else if (genAve >= 85) profLevel = "VERY_SATISFACTORY";
      else if (genAve >= 80) profLevel = "SATISFACTORY";
      else if (genAve >= 75) profLevel = "FAIRLY_SATISFACTORY";
      else profLevel = "DID_NOT_MEET_EXPECTATIONS";
    }

    // Extract name and trailing incomplete subjects cleanly
    let afterLrn = trimmed.slice(trimmed.indexOf(lrnStr) + lrnStr.length).trim();
    const incompleteSubjects: Array<{ subject: string; final_grade?: number }> = [];

    // Check if there is a status token and trailing deficiency subject
    const statusKeywordMatch = afterLrn.match(
      /\b(?:Status[:\s]+|Action\s+Taken[:\s]+)?(INCOMPLETE|CONDITIONAL|RETAINED|PENDING_DEFICIENCIES|DEFICIENT|PROMOTED|COMPLETE|COMPLETED|GRADUATING|GRADUATED)\b(.*)$/i
    );
    if (statusKeywordMatch) {
      const trailingAfterStatus = (statusKeywordMatch[2] || "").replace(/^[:\-\s,]+/, "").trim();
      if (
        trailingAfterStatus &&
        trailingAfterStatus !== "-" &&
        !/^(?:none|n\/a|shs\s+requirements)$/i.test(trailingAfterStatus) &&
        (actionTaken === "INCOMPLETE" || actionTaken === "PENDING_DEFICIENCIES")
      ) {
        incompleteSubjects.push({ subject: trailingAfterStatus });
      }
      afterLrn = afterLrn.slice(0, statusKeywordMatch.index).trim();
    }

    // Strip Gen Avg / Track/Strand / Completed SHS Requirements labels from name
    const cleanedName = afterLrn
      .replace(/\b(?:Gen\.?\s*Avg\.?|General\s*Average|GWA)[:\s]*\d+(?:\.\d+)?/gi, "")
      .replace(/\b(?:Track\s*\/?\s*Strand|Track|Strand)[:\s]*[A-Za-z0-9\-]+/gi, "")
      .replace(/\bCompleted\s+SHS\s+Requirements\b/gi, "")
      .replace(/\b(6\d|7\d|8\d|9\d|100)(?:\.\d+)?\b/g, "")
      .replace(/\b(?:Status|Action\s*Taken)[:\s]*$/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const learnerName = cleanedName.length > 2 ? cleanedName : "Learner, Unknown";
    const nameRec = rawLayout ? classifyFieldRecognition(learnerName, rawLayout) : undefined;

    learners.push({
      school_year: header.school_year || "2026-2027",
      grade_level: header.grade_level || "Grade 11",
      section: header.section || "Unassigned",
      track: header.track || "Academic Track",
      strand: header.strand || "General Academic Strand (GAS)",
      semester: header.semester || "1st Semester",
      form_variant: header.form_variant,
      lrn: lrnStr,
      learner_name: learnerName,
      general_average: genAve,
      action_taken: actionTaken,
      proficiency_level: profLevel,
      incomplete_subjects: incompleteSubjects,
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

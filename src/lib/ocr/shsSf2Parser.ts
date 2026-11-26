/**
 * AVV System — DepEd Senior High School SF2 (Daily Attendance Report) Parser
 *
 * Exclusively designed for Senior High School (Grades 11 & 12).
 * Extracts:
 * - Header: School ID (500169), School Name (TRIS), Grade Level, Section, Month, Total School Days, School Year
 * - Roster Attendance: Monthly totals (days present, days absent, days tardy) and daily tick grid (days 1..31)
 *
 * CRITICAL SAFEGUARDS:
 * - Never fabricates daily tick marks.
 * - If daily tick marks are blurry or unreadable, extracts authoritative printed monthly totals
 *   and flags the daily grid as NEEDS_VERIFICATION.
 * - Reconciles printed totals against daily tick counts.
 */

import { normalizeLrn, isValidLrn } from "@/lib/validation/patterns";
import type { Sf2AttendanceEntry } from "@/types/database";
import { classifyAttendanceCell, type ShadingClassification } from "./attendanceShadingClassifier";
import { classifyFieldRecognition, buildDocumentRecognitionSummary, type DocumentRecognitionSummary } from "./handwritingExtractor";
import {
  normalizeDepEdMonthKey,
  DEPED_MONTH_CONFIG,
  DEPED_11_MONTHS,
  type CanonicalDepEdMonthKey,
} from "@/lib/validation/monthNormalizer";

export interface ShsSf2Header {
  school_id?: string;
  school_name?: string;
  school_year?: string;
  grade_level?: "Grade 11" | "Grade 12";
  section?: string;
  track?: string;
  strand?: string;
  month?: string;
  canonical_month?: CanonicalDepEdMonthKey | "";
  total_school_days?: number;
}

export interface ShsSf2ParseResult {
  header: ShsSf2Header;
  attendance: Array<Omit<Sf2AttendanceEntry, "id" | "document_id" | "student_id" | "school_id"> & {
    recognition_type?: string;
    is_handwritten?: boolean;
    icr_confidence?: number;
    bounding_box?: number[];
  }>;
  confidence: number;
  total_enrolled: number;
  summary_metrics: {
    average_daily_attendance?: number;
    attendance_rate?: number;
    learners_at_risk_absent_5_days?: number;
  };
  recognition_summary?: DocumentRecognitionSummary;
  warnings: string[];
}

export function parseShsSf2(
  rawText: string,
  rawLayoutOrTables?: any,
  ocrConfidence: number = 0.95
): ShsSf2ParseResult {
  const warnings: string[] = [];
  const header = extractShsSf2Header(rawText);

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

  const attendance: Array<Omit<Sf2AttendanceEntry, "id" | "document_id" | "student_id" | "school_id"> & {
    recognition_type?: string;
    is_handwritten?: boolean;
    icr_confidence?: number;
    bounding_box?: number[];
  }> = [];

  if (tables && tables.length > 0) {
    const tableEntries = parseAttendanceFromAzureTables(tables, header, warnings, rawLayout);
    if (tableEntries.length > 0) {
      attendance.push(...tableEntries);
    }
  }

  if (rawText) {
    const textEntries = parseAttendanceFromText(rawText, header, warnings, rawLayout);
    for (const te of textEntries) {
      if (!attendance.some((a) => a.lrn === te.lrn)) {
        attendance.push(te);
      }
    }
  }

  // Calculate summary metrics
  let totalPresent = 0;
  const totalSchoolDays = header.total_school_days || 20;
  let learnersWith5ConsecutiveAbsences = 0;

  for (const entry of attendance) {
    totalPresent += entry.days_present;
    if (entry.days_absent >= 5) {
      learnersWith5ConsecutiveAbsences++;
    }
  }

  const ada = attendance.length > 0 && totalSchoolDays > 0 ? totalPresent / totalSchoolDays : undefined;
  const rate = attendance.length > 0 && totalSchoolDays > 0 ? (totalPresent / (attendance.length * totalSchoolDays)) * 100 : undefined;

  const recognitionSummary = rawLayout
    ? buildDocumentRecognitionSummary(rawLayout, "azure", "azure/prebuilt-read")
    : undefined;

  return {
    header,
    attendance,
    confidence: ocrConfidence,
    total_enrolled: attendance.length,
    summary_metrics: {
      average_daily_attendance: ada ? parseFloat(ada.toFixed(2)) : undefined,
      attendance_rate: rate ? parseFloat(rate.toFixed(2)) : undefined,
      learners_at_risk_absent_5_days: learnersWith5ConsecutiveAbsences,
    },
    recognition_summary: recognitionSummary,
    warnings,
  };
}

export function extractShsSf2Header(text: string): ShsSf2Header {
  const header: ShsSf2Header = {};

  // School ID
  const schoolIdMatch = text.match(/school\s*id[:\s\-]*([0-9]{6})/i);
  if (schoolIdMatch) {
    header.school_id = schoolIdMatch[1];
  } else if (text.includes("500169")) {
    header.school_id = "500169";
  }

  // Grade Level (11 or 12)
  if (/grade\s*(?:level)?[:\s]*(?:11|xi\b)/i.test(text) || /\bgrade\s*11\b/i.test(text)) {
    header.grade_level = "Grade 11";
  } else if (/grade\s*(?:level)?[:\s]*(?:12|xii\b)/i.test(text) || /\bgrade\s*12\b/i.test(text)) {
    header.grade_level = "Grade 12";
  }

  // School Year
  const syMatch = text.match(/(?:school\s*year|sy)[:\s]*([0-9]{4}\s*[-–—]\s*[0-9]{4})/i);
  if (syMatch) {
    header.school_year = syMatch[1].replace(/\s+/g, "").replace(/[–—]/g, "-");
  }

  // Section
  const secMatch = text.match(/section[:\s]*([a-zA-Z0-9\s\-]+?)(?:\s*(?:grade|month|track|strand|$|\n))/i);
  if (secMatch) {
    header.section = secMatch[1].trim();
  }

  // Reporting Month (e.g. "Report for the Month of June", "buwan ng Agosto", "Month: August")
  const monthMatch = text.match(/(?:(?:report\s+for\s+the\s+)?month\s*of|buwan\s*ng|month)[:\s]*([a-zA-Z]+)/i);
  if (monthMatch) {
    const rawFound = monthMatch[1].trim();
    const normKey = normalizeDepEdMonthKey(rawFound);
    if (normKey && DEPED_MONTH_CONFIG[normKey]) {
      header.month = DEPED_MONTH_CONFIG[normKey].fullName;
      header.canonical_month = normKey;
    } else {
      header.month = capitalizeMonth(rawFound);
    }
  } else {
    // Search known DepEd months
    for (const key of DEPED_11_MONTHS) {
      const cfg = DEPED_MONTH_CONFIG[key];
      if (new RegExp(`\\b(?:${cfg.fullName}|${cfg.shortLabel})\\b`, "i").test(text)) {
        header.month = cfg.fullName;
        header.canonical_month = key;
        break;
      }
    }
  }

  // Total Number of School Days
  const daysMatch = text.match(/(?:total\s*(?:no\.?\s*of)?\s*school\s*days|bilang\s*ng\s*araw)[:\s]*([0-9]+)/i);
  if (daysMatch) {
    header.total_school_days = parseInt(daysMatch[1], 10);
  } else {
    header.total_school_days = 20; // default standard DepEd month
  }

  return header;
}

function parseAttendanceFromAzureTables(tables: any[], header: ShsSf2Header, warnings: string[], rawLayout?: any): any[] {
  const entries: any[] = [];
  let rowIndex = 1;

  for (const table of tables) {
    if (!table.cells || table.cells.length === 0) continue;

    // Detect columns
    let nameCol = -1;
    let lrnCol = -1;
    let presentCol = -1;
    let absentCol = -1;
    let tardyCol = -1;
    const dailyCols: { day: number; colIndex: number }[] = [];

    // Map table cells with content and polygon
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

      // Skip headers & totals
      if (
        rowText.includes("learner's name") ||
        rowText.includes("learner name") ||
        rowText.includes("pangalan") ||
        (rowText.includes("absent") && rowText.includes("tardy")) ||
        (rowText.includes("absent") && rowText.includes("present")) ||
        (rowText.includes("total") && (rowText.includes("month") || rowText.includes("absent") || rowText.includes("tardy")))
      ) {
        for (const [c, cell] of rowCells.entries()) {
          const v = cell.content.toLowerCase().trim();
          if (v.includes("name") || v.includes("pangalan")) nameCol = c;
          else if (v.includes("lrn")) lrnCol = c;
          else if (v.includes("present") || v.includes("kabuuang araw")) presentCol = c;
          else if (v.includes("absent") || v.includes("liban")) absentCol = c;
          else if (v.includes("tardy") || v.includes("huli")) tardyCol = c;
          else {
            const dayNum = parseInt(v, 10);
            if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
              dailyCols.push({ day: dayNum, colIndex: c });
            } else if (/^(?:m|t|w|th|f|mon|tue|wed|thu|fri)$/i.test(v)) {
              dailyCols.push({ day: dailyCols.length + 1, colIndex: c });
            }
          }
        }
        continue;
      }

      // If daily columns were not explicitly identified in the header, infer them from intermediate columns
      if (dailyCols.length === 0 && absentCol !== -1) {
        const leftBound = Math.max(nameCol, lrnCol, 0);
        const rightBound = absentCol;
        for (let c = leftBound + 1; c < rightBound; c++) {
          dailyCols.push({ day: dailyCols.length + 1, colIndex: c });
        }
      }

      // Check for learner name
      let learnerName = "";
      let namePolygon: number[] | undefined;
      if (nameCol !== -1 && rowCells.has(nameCol)) {
        learnerName = rowCells.get(nameCol)!.content;
        namePolygon = rowCells.get(nameCol)!.polygon;
      } else {
        for (const [c, cell] of rowCells.entries()) {
          const val = cell.content;
          if (val.length > 4 && /[a-zA-Z]/.test(val) && !/^\d+$/.test(val) && !val.toLowerCase().includes("total")) {
            learnerName = val;
            namePolygon = cell.polygon;
            break;
          }
        }
      }

      if (!learnerName || learnerName.toLowerCase().includes("total") || learnerName.toLowerCase().includes("male") || learnerName.toLowerCase().includes("female")) {
        continue;
      }

      // LRN
      let lrnStr: string | null = null;
      if (lrnCol !== -1 && rowCells.has(lrnCol)) {
        const norm = normalizeLrn(rowCells.get(lrnCol)!.content);
        if (isValidLrn(norm)) lrnStr = norm;
      }

      // Extract Azure ICR written monthly totals
      let writtenAbsent: number | undefined = undefined;
      let writtenPresent: number | undefined = undefined;
      let writtenTardy: number | undefined = undefined;

      if (absentCol !== -1 && rowCells.has(absentCol)) {
        const rawAbs = rowCells.get(absentCol)!.content.replace(/[^0-9\.]/g, "").trim();
        if (rawAbs !== "") {
          const a = parseFloat(rawAbs);
          if (!isNaN(a)) writtenAbsent = a;
        }
      }

      if (presentCol !== -1 && rowCells.has(presentCol)) {
        const rawPres = rowCells.get(presentCol)!.content.replace(/[^0-9\.]/g, "").trim();
        if (rawPres !== "") {
          const p = parseFloat(rawPres);
          if (!isNaN(p)) writtenPresent = p;
        }
      }

      if (tardyCol !== -1 && rowCells.has(tardyCol)) {
        const rawTardy = rowCells.get(tardyCol)!.content.replace(/[^0-9\.]/g, "").trim();
        if (rawTardy !== "") {
          const t = parseFloat(rawTardy);
          if (!isNaN(t)) writtenTardy = t;
        }
      }

      // Pre-evaluate visual shading across daily cells
      const evaluatedDaily = dailyCols.map((dc) => {
        const cellData = rowCells.get(dc.colIndex);
        const rawMark = (cellData?.content || "").trim();
        const cellPolygon = cellData?.polygon;
        const shadingResult = classifyAttendanceCell({
          day: dc.day,
          learnerName,
          cellText: rawMark,
          cellPolygon,
          pageNumber: 1,
        });
        return { dc, rawMark, cellPolygon, shadingResult };
      });

      const fullShadedCount = evaluatedDaily.filter((e) => e.shadingResult.classification === "FULL_SHADE").length;
      const halfShadedCount = evaluatedDaily.filter((e) => e.shadingResult.classification === "HALF_SHADE").length;
      const totalDaysConfig = header.total_school_days || 20;

      let totalDays = totalDaysConfig;
      let daysPresent = totalDaysConfig;
      let daysAbsent = 0;
      let daysTardy = 0;
      let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "VERIFIED";
      let rowConfidence = 96;

      const dailyGrid: Array<{
        day: number;
        status: "PRESENT" | "ABSENT" | "TARDY" | "UNKNOWN" | "UNRECORDED";
        raw_mark?: string;
        shading_classification?: ShadingClassification;
        shading_confidence?: number;
        fill_ratio?: number;
        cell_polygon?: number[];
        requires_teacher_verification?: boolean;
        recognition_method?: string;
      }> = [];

      // Case A: Active-Day Shading with Written ABSENT = 0 / TARDY = 0
      // When Azure ICR reads ABSENT = 0 (and TARDY = 0 or blank) in Total for the Month while N cells
      // (e.g. 21 shaded boxes across the 25-column M-F grid, with remaining out-of-month cells blank)
      // are shaded as active school days:
      const isActiveDayShading =
        writtenAbsent === 0 &&
        (writtenTardy === 0 || writtenTardy === undefined) &&
        fullShadedCount > 0;

      if (isActiveDayShading) {
        totalDays = fullShadedCount;
        daysPresent = fullShadedCount;
        daysAbsent = 0;
        daysTardy = 0;
        reviewStatus = "VERIFIED";
        rowConfidence = 98;

        for (const item of evaluatedDaily) {
          const isShadedActive = item.shadingResult.classification === "FULL_SHADE";
          dailyGrid.push({
            day: item.dc.day,
            status: isShadedActive ? "PRESENT" : "UNRECORDED",
            raw_mark: item.rawMark || undefined,
            shading_classification: item.shadingResult.classification,
            shading_confidence: item.shadingResult.confidence,
            fill_ratio: item.shadingResult.fill_ratio,
            cell_polygon: item.cellPolygon,
            requires_teacher_verification: false,
            recognition_method: "active_day_shading_reconciled",
          });
        }
      } else {
        // Case B: Standard DepEd Absence/Tardy Shading
        // When ABSENT > 0 or TARDY > 0 (or unshaded = Present, full-shaded = Absent,
        // upper-left triangle = Late/Tardy, lower-right triangle = Cutting/Tardy):
        daysAbsent = writtenAbsent !== undefined ? writtenAbsent : fullShadedCount;
        daysTardy = writtenTardy !== undefined ? writtenTardy : halfShadedCount;

        if (writtenPresent !== undefined) {
          daysPresent = writtenPresent;
        } else if (dailyCols.length > 0) {
          const dailyPresentCount = evaluatedDaily.filter(
            (e) => e.shadingResult.attendance_status === "PRESENT"
          ).length;
          // Days present cannot exceed total active school days minus absences;
          // out-of-month empty grid slots must never inflate daysPresent.
          daysPresent = Math.min(dailyPresentCount, Math.max(0, totalDays - daysAbsent));
        } else {
          daysPresent = Math.max(0, totalDays - daysAbsent);
        }

        let hasUnknownMarks = false;
        for (const item of evaluatedDaily) {
          let status: "PRESENT" | "ABSENT" | "TARDY" | "UNKNOWN" | "UNRECORDED";
          if (item.shadingResult.attendance_status === "ABSENT") {
            status = "ABSENT";
          } else if (item.shadingResult.attendance_status === "TARDY") {
            status = "TARDY";
          } else if (item.shadingResult.attendance_status === "PRESENT") {
            status = "PRESENT";
          } else {
            status = "UNKNOWN";
            hasUnknownMarks = true;
            warnings.push(
              `Learner "${learnerName}": Unrecognized attendance mark "${item.rawMark}" on day ${item.dc.day} (${item.shadingResult.explanation}) flagged as UNKNOWN for manual review.`
            );
          }

          dailyGrid.push({
            day: item.dc.day,
            status,
            raw_mark: item.rawMark || undefined,
            shading_classification: item.shadingResult.classification,
            shading_confidence: item.shadingResult.confidence,
            fill_ratio: item.shadingResult.fill_ratio,
            cell_polygon: item.cellPolygon,
            requires_teacher_verification: item.shadingResult.requires_teacher_verification,
            recognition_method: item.shadingResult.classifier_method,
          });
        }

        if (hasUnknownMarks) {
          reviewStatus = "NEEDS_REVIEW";
          rowConfidence = 76;
        } else if (writtenAbsent !== undefined && fullShadedCount > 0 && Math.abs(writtenAbsent - fullShadedCount) > 0.01) {
          reviewStatus = "FLAGGED";
          rowConfidence = 82;
          warnings.push(`Learner "${learnerName}": Daily absences count (${fullShadedCount}) does not match written total absences (${writtenAbsent}).`);
        } else {
          reviewStatus = "VERIFIED";
          rowConfidence = 96;
        }
      }

      // Classify learner name handwriting / ICR metadata
      const nameRec = rawLayout ? classifyFieldRecognition(learnerName, rawLayout) : undefined;
      const tablePageNum =
        table._pageNumber ||
        table.boundingRegions?.[0]?.pageNumber ||
        1;

      entries.push({
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        month: header.month || "June",
        lrn: lrnStr,
        learner_name: learnerName,
        student_name: learnerName,
        name: learnerName,
        total_school_days: totalDays,
        total_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_tardy: daysTardy,
        daily_grid: dailyGrid,
        row_index: rowIndex++,
        page_number: tablePageNum,
        review_status: reviewStatus,
        status: (daysAbsent === 0 ? "PRESENT" : "ABSENT") as "PRESENT" | "ABSENT",
        confidence: rowConfidence,
        recognition_type: nameRec?.recognition_type || "printed_ocr",
        is_handwritten: nameRec?.is_handwritten || false,
        icr_confidence: nameRec?.icr_confidence,
        bounding_box: nameRec?.bounding_box || namePolygon,
      });
    }
  }

  return entries;
}

function parseAttendanceFromText(text: string, header: ShsSf2Header, warnings: string[], rawLayout?: any): any[] {
  const entries: any[] = [];
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

    const lower = trimmed.toLowerCase();
    if (
      lower.includes("school form 2") ||
      lower.includes("daily attendance") ||
      lower.includes("total school days") ||
      lower.includes("average daily attendance") ||
      lower.startsWith("for the month") ||
      lower.startsWith("grade ")
    ) {
      continue;
    }

    const totalDays = header.total_school_days || 20;

    // 1. Check pipe-delimited row format: | 109345000001 | DELA CRUZ, CARLOS M. | 21 | 1 | 0 |
    if (trimmed.includes("|")) {
      const rawParts = trimmed.split("|").map((p) => p.trim());
      const parts = rawParts.filter((p, idx) => !(p === "" && (idx === 0 || idx === rawParts.length - 1)));
      if (parts.length >= 3) {
        const lrnMatch = trimmed.match(/\b([0-9]{12})\b/);
        const extractedLrn = lrnMatch ? lrnMatch[1] : null;
        const namePart = parts.find(
          (p) =>
            p.length > 3 &&
            /[a-zA-Z]/.test(p) &&
            !p.includes(extractedLrn || "__NO_LRN__") &&
            !/^(?:learner|name|pangalan|lrn|present|absent|tardy|total)/i.test(p)
        );
        const numericCols = parts
          .filter((p) => /^\d+(\.\d+)?$/.test(p) && parseFloat(p) <= 31)
          .map((p) => parseFloat(p));

        if (namePart && numericCols.length >= 2) {
          // Detect daily cell tokens in parts (e.g. full, shaded, upper_triangle, blank)
          const cellTokens = parts.filter((p) => /^(?:full|shaded|full_shade|upper_triangle|lower_triangle|half|blank|unmarked|x|■)$/i.test(p));
          const fullShadedCount = cellTokens.filter((p) => /^(?:full|shaded|full_shade|x|■)$/i.test(p)).length;

          let daysPresent = numericCols[0];
          let daysAbsent = numericCols[1];
          let daysTardy = numericCols[2] ?? 0;
          let entrySchoolDays = totalDays;

          // Case A check in text/markdown: written absent is 0, full shaded cells present
          if (daysAbsent === 0 && fullShadedCount > 0) {
            entrySchoolDays = fullShadedCount;
            daysPresent = fullShadedCount;
            daysAbsent = 0;
            daysTardy = 0;
          }

          let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "VERIFIED";
          if (header.total_school_days && daysPresent + daysAbsent > entrySchoolDays) {
            reviewStatus = "FLAGGED";
            warnings.push(
              `Learner "${namePart}": Sum of days present (${daysPresent}) and days absent (${daysAbsent}) exceeds total school days (${entrySchoolDays}).`
            );
          }
          const nameRec = rawLayout ? classifyFieldRecognition(namePart, rawLayout) : undefined;
          entries.push({
            school_year: header.school_year || "2026-2027",
            grade_level: header.grade_level || "Grade 11",
            section: header.section || "Unassigned",
            month: header.month || "June",
            lrn: extractedLrn,
            learner_name: namePart,
            student_name: namePart,
            name: namePart,
            total_school_days: entrySchoolDays,
            total_days: entrySchoolDays,
            days_present: daysPresent,
            days_absent: daysAbsent,
            days_tardy: daysTardy,
            daily_grid: [],
            row_index: rowIndex++,
            page_number: currentPageNumber,
            review_status: reviewStatus,
            confidence: 96,
            recognition_type: nameRec?.recognition_type || "printed_ocr",
            is_handwritten: nameRec?.is_handwritten || false,
            icr_confidence: nameRec?.icr_confidence,
            bounding_box: nameRec?.bounding_box,
          });
          continue;
        }
      }
    }

    // 2. Check labeled format: "1. 109345000001 DELA CRUZ, CARLOS M. Present: 22 Absent: 0 Tardy: 0"
    const labeledMatch = trimmed.match(
      /^(?:\d+[\.\)\s]+)?(?:([0-9]{12})\s+)?([a-zA-ZñÑ\s\.\,\-]+?)\s+present[:\s]+(\d+)\s+absent[:\s]+(\d+)(?:\s+tardy[:\s]+(\d+))?$/i
    );
    if (labeledMatch) {
      const extractedLrn = labeledMatch[1] || null;
      const name = labeledMatch[2].trim();
      const daysPresent = parseInt(labeledMatch[3], 10);
      const daysAbsent = parseInt(labeledMatch[4], 10);
      const daysTardy = labeledMatch[5] ? parseInt(labeledMatch[5], 10) : 0;
      let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "NEEDS_REVIEW";
      if (header.total_school_days && daysPresent + daysAbsent > totalDays) {
        reviewStatus = "FLAGGED";
        warnings.push(
          `Learner "${name}": Sum of days present (${daysPresent}) and days absent (${daysAbsent}) exceeds total school days (${totalDays}).`
        );
      }
      const nameRec = rawLayout ? classifyFieldRecognition(name, rawLayout) : undefined;
      entries.push({
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        month: header.month || "June",
        lrn: extractedLrn,
        learner_name: name,
        student_name: name,
        name: name,
        total_school_days: totalDays,
        total_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_tardy: daysTardy,
        daily_grid: [],
        row_index: rowIndex++,
        page_number: currentPageNumber,
        review_status: reviewStatus,
        confidence: 96,
        recognition_type: nameRec?.recognition_type || "printed_ocr",
        is_handwritten: nameRec?.is_handwritten || false,
        icr_confidence: nameRec?.icr_confidence,
        bounding_box: nameRec?.bounding_box,
      });
      continue;
    }

    // 3. Look for lines containing optional LRN, learner name, and numbers at the end
    const match = trimmed.match(/^(?:\d+[\.\)\s]+)?(?:([0-9]{12})\s+)?([a-zA-ZñÑ\s\.\,\-]+?)\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
    if (match) {
      const extractedLrn = match[1] || null;
      const name = match[2].trim();
      const num1 = parseInt(match[3], 10);
      const num2 = parseInt(match[4], 10);
      const num3 = match[5] ? parseInt(match[5], 10) : 0;

      // In DepEd SF2, printed summary is usually (Days Present, Days Absent, Days Tardy)
      const daysPresent = num1;
      const daysAbsent = num2;
      const daysTardy = num3;
      let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "NEEDS_REVIEW";
      if (header.total_school_days && daysPresent + daysAbsent > totalDays) {
        reviewStatus = "FLAGGED";
        warnings.push(
          `Learner "${name}": Sum of days present (${daysPresent}) and days absent (${daysAbsent}) exceeds total school days (${totalDays}).`
        );
      }

      const nameRec = rawLayout ? classifyFieldRecognition(name, rawLayout) : undefined;

      entries.push({
        school_year: header.school_year || "2026-2027",
        grade_level: header.grade_level || "Grade 11",
        section: header.section || "Unassigned",
        month: header.month || "June",
        lrn: extractedLrn,
        learner_name: name,
        student_name: name,
        name: name,
        total_school_days: totalDays,
        total_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_tardy: daysTardy,
        daily_grid: [],
        row_index: rowIndex++,
        page_number: currentPageNumber,
        review_status: reviewStatus,
        confidence: 96,
        recognition_type: nameRec?.recognition_type || "printed_ocr",
        is_handwritten: nameRec?.is_handwritten || false,
        icr_confidence: nameRec?.icr_confidence,
        bounding_box: nameRec?.bounding_box,
      });
    }
  }

  return entries;
}

function capitalizeMonth(str: string): string {
  if (!str) return "September";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

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

export interface ShsSf2Header {
  school_id?: string;
  school_name?: string;
  school_year?: string;
  grade_level?: "Grade 11" | "Grade 12";
  section?: string;
  track?: string;
  strand?: string;
  month?: string;
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

  if (attendance.length === 0) {
    const textEntries = parseAttendanceFromText(rawText, header, warnings, rawLayout);
    attendance.push(...textEntries);
  }

  // Calculate summary metrics
  let totalPresent = 0;
  let totalSchoolDays = header.total_school_days || 20;
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

  // Reporting Month (e.g. "for the month of September")
  const monthMatch = text.match(/(?:month\s*of|buwan\s*ng|month)[:\s]*([a-zA-Z]+)/i);
  if (monthMatch) {
    header.month = capitalizeMonth(monthMatch[1].trim());
  } else {
    // Search known months
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    for (const m of months) {
      if (new RegExp(`\\b${m}\\b`, "i").test(text)) {
        header.month = m;
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
        (rowText.includes("absent") && rowText.includes("present"))
      ) {
        for (const [c, cell] of rowCells.entries()) {
          const v = cell.content.toLowerCase();
          if (v.includes("name") || v.includes("pangalan")) nameCol = c;
          else if (v.includes("lrn")) lrnCol = c;
          else if (v.includes("present") || v.includes("kabuuang araw")) presentCol = c;
          else if (v.includes("absent") || v.includes("liban")) absentCol = c;
          else if (v.includes("tardy") || v.includes("huli")) tardyCol = c;
          else {
            const dayNum = parseInt(v, 10);
            if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
              dailyCols.push({ day: dayNum, colIndex: c });
            }
          }
        }
        continue;
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

      // Monthly totals
      const totalDays = header.total_school_days || 20;
      let daysPresent = totalDays;
      let daysAbsent = 0;
      let daysTardy = 0;

      if (absentCol !== -1 && rowCells.has(absentCol)) {
        const a = parseFloat(rowCells.get(absentCol)!.content);
        if (!isNaN(a)) daysAbsent = a;
      }

      if (presentCol !== -1 && rowCells.has(presentCol)) {
        const p = parseFloat(rowCells.get(presentCol)!.content);
        if (!isNaN(p)) daysPresent = p;
      } else {
        daysPresent = Math.max(0, totalDays - daysAbsent);
      }

      if (tardyCol !== -1 && rowCells.has(tardyCol)) {
        const t = parseFloat(rowCells.get(tardyCol)!.content);
        if (!isNaN(t)) daysTardy = t;
      }

      // Daily tick grid & shading classification
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
      let dailyAbsencesCount = 0;
      let hasUnknownMarks = false;

      for (const dc of dailyCols) {
        const cellData = rowCells.get(dc.colIndex);
        const rawMark = (cellData?.content || "").trim();
        const cellPolygon = cellData?.polygon;

        // Run through specialized Attendance Shading & Pattern Classifier
        const shadingResult = classifyAttendanceCell({
          day: dc.day,
          learnerName,
          cellText: rawMark,
          cellPolygon,
          pageNumber: 1,
        });

        let status: "PRESENT" | "ABSENT" | "TARDY" | "UNKNOWN" | "UNRECORDED";

        if (shadingResult.attendance_status === "ABSENT") {
          status = "ABSENT";
          dailyAbsencesCount++;
        } else if (shadingResult.attendance_status === "TARDY") {
          status = "TARDY";
        } else if (shadingResult.attendance_status === "PRESENT") {
          status = "PRESENT";
        } else {
          // UNCLEAR mark or ambiguous scan artifact — require teacher verification
          status = "UNKNOWN";
          hasUnknownMarks = true;
          warnings.push(`Learner "${learnerName}": Unrecognized attendance mark "${rawMark}" on day ${dc.day} (${shadingResult.explanation}) flagged as UNKNOWN for manual review.`);
        }

        dailyGrid.push({
          day: dc.day,
          status,
          raw_mark: rawMark || undefined,
          shading_classification: shadingResult.classification,
          shading_confidence: shadingResult.confidence,
          fill_ratio: shadingResult.fill_ratio,
          cell_polygon: cellPolygon,
          requires_teacher_verification: shadingResult.requires_teacher_verification,
          recognition_method: shadingResult.classifier_method,
        });
      }

      // Reconciliation safeguard
      let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "VERIFIED";
      if (hasUnknownMarks) {
        reviewStatus = "NEEDS_REVIEW";
      }

      // Safeguard: Ensure attendance totals do not count UNKNOWN or UNRECORDED as PRESENT
      if (dailyCols.length > 0) {
        const dailyPresentCount = dailyGrid.filter((d) => d.status === "PRESENT").length;
        const dailyUnknownCount = dailyGrid.filter((d) => d.status === "UNKNOWN").length;
        const dailyUnrecordedCount = dailyGrid.filter((d) => d.status === "UNRECORDED").length;

        if (presentCol === -1) {
          daysPresent = dailyPresentCount;
        } else if (daysPresent > totalDays - daysAbsent - dailyUnknownCount - dailyUnrecordedCount) {
          warnings.push(`Learner "${learnerName}": Printed days present (${daysPresent}) exceeds verifiable days (${totalDays - daysAbsent - dailyUnknownCount - dailyUnrecordedCount}) due to unreadable / unrecorded marks.`);
          reviewStatus = "FLAGGED";
        }
      }

      if (dailyCols.length > 0 && dailyAbsencesCount !== daysAbsent) {
        reviewStatus = "FLAGGED";
        warnings.push(`Learner "${learnerName}": Daily absences count (${dailyAbsencesCount}) does not match printed total absences (${daysAbsent}).`);
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
        month: header.month || "September",
        lrn: lrnStr,
        learner_name: learnerName,
        total_school_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_tardy: daysTardy,
        daily_grid: dailyGrid,
        row_index: rowIndex++,
        page_number: tablePageNum,
        review_status: reviewStatus,
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
          .filter((p) => /^\d+$/.test(p) && p.length <= 2)
          .map((p) => parseInt(p, 10));

        if (namePart && numericCols.length >= 2) {
          const daysPresent = numericCols[0];
          const daysAbsent = numericCols[1];
          const daysTardy = numericCols[2] ?? 0;
          let reviewStatus: "NEEDS_REVIEW" | "VERIFIED" | "FLAGGED" = "NEEDS_REVIEW";
          if (header.total_school_days && daysPresent + daysAbsent > totalDays) {
            reviewStatus = "FLAGGED";
            warnings.push(
              `Learner "${namePart}": Sum of days present (${daysPresent}) and days absent (${daysAbsent}) exceeds total school days (${totalDays}).`
            );
          }
          const nameRec = rawLayout ? classifyFieldRecognition(namePart, rawLayout) : undefined;
          entries.push({
            school_year: header.school_year || "2026-2027",
            grade_level: header.grade_level || "Grade 11",
            section: header.section || "Unassigned",
            month: header.month || "September",
            lrn: extractedLrn,
            learner_name: namePart,
            total_school_days: totalDays,
            days_present: daysPresent,
            days_absent: daysAbsent,
            days_tardy: daysTardy,
            daily_grid: [],
            row_index: rowIndex++,
            page_number: currentPageNumber,
            review_status: reviewStatus,
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
        month: header.month || "September",
        lrn: extractedLrn,
        learner_name: name,
        total_school_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_tardy: daysTardy,
        daily_grid: [],
        row_index: rowIndex++,
        page_number: currentPageNumber,
        review_status: reviewStatus,
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
        month: header.month || "September",
        lrn: extractedLrn,
        learner_name: name,
        total_school_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_tardy: daysTardy,
        daily_grid: [],
        row_index: rowIndex++,
        page_number: currentPageNumber,
        review_status: reviewStatus,
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

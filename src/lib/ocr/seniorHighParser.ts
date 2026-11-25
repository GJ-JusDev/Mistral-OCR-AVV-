import type { ExtractedFields, GradeRecord, AttendanceRecord } from "@/types/documents";
import { parseOcrText } from "./parser";
import { parseAzureLayoutGrades } from "./tableGradesParser";
import { evaluateAttendanceData } from "../attendance/attendanceEvaluator";
import { normalizeGradeRecords, updateExtractedFieldsAverages } from "../validation/gradeUtils";
import { parseTextObservedValuesAndAchievement } from "./observedValuesParser";

/**
 * MGA KEYWORDS NA HINDI DAPAT ITURING NA ACADEMIC SUBJECT
 *
 * Bakit ito kailangan:
 * Sa opisyal na DepEd SF9 (Report Card), mayroong hiwalay na table para sa "Learner's Observed Values"
 * (hal. Maka-Diyos, Makatao, Makakalikasan, Makabansa).
 * Kung hindi ito sasalain, mapagkakamalan ng OCR na regular academic subjects ang mga ito!
 */
const EXCLUDED_OBSERVED_VALUES_KEYWORDS = [
  "core values",
  "behavior statements",
  "maka-diyos",
  "makatao",
  "makakalikasan",
  "makabansa",
  "expresses one's spiritual",
  "ethical principles",
  "observed values",
  "report on learner's observed values",
];

/**
 * MGA KEYWORDS NG GRADING DESCRIPTORS AT SCALE
 *
 * Bakit ito kailangan:
 * May legend sa ibaba ng SF9/SF10 tulad ng "90-100 Outstanding", "85-89 Very Satisfactory", at "Below 75 Did Not Meet Expectations".
 * Kapag binasa ito ng OCR, baka isipin ng system na subject ang "Outstanding" at 90 ang grade.
 * Kaya mahigpit nating binabale-wala ang mga rows na naglalaman ng mga salitang ito.
 */
const EXCLUDED_GRADING_SCALE_KEYWORDS = [
  "grading scale",
  "descriptors",
  "did not meet expectation",
  "did not meet expectations",
  "very satisfactory",
  "fairly satisfactory",
  "satisfactory",
  "outstanding",
  "90-100",
  "85-89",
  "80-84",
  "75-79",
  "below 75",
];

const CATEGORY_KEYWORDS = [
  "core subject",
  "core subjects",
  "applied subject",
  "applied subjects",
  "specialized subject",
  "specialized subjects",
  "applied and specialized",
  "applied and specialized subjects",
  "applied & specialized",
  "applied & specialized subjects",
  "institutional subjects",
  "other subjects",
];

function isCategoryHeader(subjectText: string): { isCategory: boolean; normalizedCategory?: string } {
  const lower = subjectText.toLowerCase().replace(/[\s\t]+/g, " ").trim();
  if (
    lower === "core subjects" ||
    lower === "core subject" ||
    lower.startsWith("core subjects") ||
    lower.startsWith("core subject")
  ) {
    return { isCategory: true, normalizedCategory: "Core Subjects" };
  }
  if (
    lower === "applied and specialized subjects" ||
    lower === "applied and specialized" ||
    lower === "applied & specialized subjects" ||
    lower === "applied & specialized" ||
    lower === "applied subjects" ||
    lower === "specialized subjects" ||
    lower.startsWith("applied and specialized") ||
    lower.startsWith("applied & specialized")
  ) {
    return { isCategory: true, normalizedCategory: "Applied and Specialized Subjects" };
  }
  const isMatch = CATEGORY_KEYWORDS.some((kw) => lower === kw || lower.includes(kw));
  return { isCategory: isMatch, normalizedCategory: isMatch ? subjectText.trim() : undefined };
}

/**
 * PARSER PARA SA SENIOR HIGH SCHOOL GRADES AT ATTENDANCE (SF9 / SF10)
 *
 * Paano ito nag-e-extract:
 * 1. Inuuna ang Table-Aware Parsing kung galing sa Azure Document Intelligence
 *    dahil may exact bounding boxes at row/column indices ito.
 * 2. Kung plain text o Mistral OCR, gumagamit ng Markdown pipe-table parser.
 * 3. Hinihiwalay ang 1st Semester (Q1, Q2) sa 2nd Semester (Q3, Q4) para maiwasan
 *    ang "cross-semester contamination" o paghalo ng mga grado.
 */
export function parseSeniorHighGradesText(text: string, rawLayout?: any): ExtractedFields {
  // Kunin muna ang student identity sa itaas (Name, LRN, School, Section)
  const fields = parseOcrText(text, rawLayout); 

  const layoutTables = Array.isArray(rawLayout?.tables) && rawLayout.tables.length > 0
    ? rawLayout.tables
    : Array.isArray(rawLayout?.pages)
    ? rawLayout.pages.flatMap((p: any) =>
        (p.tables || []).map((t: any) => ({
          ...t,
          _pageNumber: p.pageNumber || p.originalPageNumber || t.boundingRegions?.[0]?.pageNumber || 1,
        }))
      )
    : [];

  // Phase 9: Table-Aware Extraction kung available ang Azure structured layout tables
  if (layoutTables.length > 0) {
    const tableResult = parseAzureLayoutGrades(layoutTables, rawLayout);
    if (tableResult.observed_values) {
      fields.observed_values = tableResult.observed_values;
    }
    if (tableResult.learner_progress_achievement) {
      fields.learner_progress_achievement = tableResult.learner_progress_achievement;
      fields.grading_scale = tableResult.grading_scale || tableResult.learner_progress_achievement;
    }
    if (tableResult.grades && tableResult.grades.length > 0) {
      fields.grades = tableResult.grades;
      if (tableResult.attendance && tableResult.attendance.length > 0) {
        fields.attendance = tableResult.attendance;
      }
      if (tableResult.attendance_months && tableResult.attendance_months.length > 0) {
        fields.attendance_months = tableResult.attendance_months;
      }
      if (tableResult.attendance_totals) {
        fields.attendance_totals = tableResult.attendance_totals;
      }
      if (tableResult.attendance_percentage !== undefined) {
        fields.attendance_percentage = tableResult.attendance_percentage;
      }
      if (tableResult.absence_percentage !== undefined) {
        fields.absence_percentage = tableResult.absence_percentage;
      }
      if (tableResult.attendance_risk_status !== undefined) {
        fields.attendance_risk_status = tableResult.attendance_risk_status;
      }
      if (tableResult.attendance_discrepancy_details) {
        fields.attendance_discrepancy_details = tableResult.attendance_discrepancy_details;
      }
      if (tableResult.general_average !== undefined) {
        fields.general_average = tableResult.general_average;
      }
      Object.assign(fields, updateExtractedFieldsAverages(fields));

      // FIX 3: Before returning early with Azure academic grades, fallback to text
      // if Azure layout tables did not detect the Observed Values or Grading Scale tables
      if (!fields.observed_values || !fields.learner_progress_achievement) {
        const textOv = parseTextObservedValuesAndAchievement(text);
        if (!fields.observed_values && textOv.observedValues) {
          fields.observed_values = textOv.observedValues;
        }
        if (!fields.learner_progress_achievement && textOv.learnerProgressAchievement) {
          fields.learner_progress_achievement = textOv.learnerProgressAchievement;
          fields.grading_scale = textOv.learnerProgressAchievement;
        }
      }

      return fields;
    }
  }

  // Phase 14: Fallback sa Markdown pipe table parser (para sa Mistral OCR o text-only output)
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const grades: GradeRecord[] = [];
  const attendance: AttendanceRecord[] = [];
  let attendanceTotalColIdx = -1;

  let currentCategory = "";
  let currentSemester: "1st Semester" | "2nd Semester" | undefined = undefined;
  let currentGradeLevel: "Grade 11" | "Grade 12" | undefined =
    fields.grade_level === "Grade 12" ? "Grade 12" : fields.grade_level === "Grade 11" ? "Grade 11" : undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Check for grade level and semester markers outside or inside table rows
    if (/\bgrade\s*(?:level)?[:\s]*(?:12|xii)\b/i.test(line)) {
      currentGradeLevel = "Grade 12";
    } else if (/\bgrade\s*(?:level)?[:\s]*(?:11|xi)\b/i.test(line)) {
      currentGradeLevel = "Grade 11";
    }
    if (lowerLine.includes("first semester") || lowerLine.includes("1st semester")) {
      currentSemester = "1st Semester";
    } else if (lowerLine.includes("second semester") || lowerLine.includes("2nd semester")) {
      currentSemester = "2nd Semester";
    }

    // Check if it's a markdown table row
    if (line.startsWith("|")) {
      const cells = line.split("|").map(c => c.trim()).filter((c, index, arr) => {
        // Filter out empty outer boundaries from split("|")
        return !(index === 0 && c === "") && !(index === arr.length - 1 && c === "");
      });
      
      if (cells.length < 2) continue;

      const cellsText = cells.join(" ").toLowerCase();

      // Check for semester indications in table header rows
      if (cellsText.includes("first semester") || cellsText.includes("1st semester")) {
        currentSemester = "1st Semester";
      } else if (cellsText.includes("second semester") || cellsText.includes("2nd semester")) {
        currentSemester = "2nd Semester";
      }

      // Detect header indicating quarters
      if (cellsText.includes("quarter 3") || cellsText.includes("quarter 4") || cellsText.includes("q3") || cellsText.includes("q4")) {
        if (!cellsText.includes("quarter 1") && !cellsText.includes("q1")) {
          currentSemester = "2nd Semester";
        }
      } else if ((cellsText.includes("quarter 1") || cellsText.includes("q1")) && !cellsText.includes("quarter 3")) {
        currentSemester = "1st Semester";
      }

      // Skip table header and separator rows like |---|---|
      const firstCellClean = cells[0].toLowerCase().trim();
      if (
        cells[0].includes("---") ||
        firstCellClean === "subject" ||
        firstCellClean === "subjects" ||
        firstCellClean === "learning area" ||
        firstCellClean === "learning areas" ||
        firstCellClean === "first semester" ||
        firstCellClean === "second semester" ||
        firstCellClean.includes("report on learning")
      ) {
        continue;
      }

      // Skip Observed Values / Core Values table rows
      if (EXCLUDED_OBSERVED_VALUES_KEYWORDS.some((kw) => cellsText.includes(kw))) {
        continue;
      }

      // Skip grading scale / legend table rows
      if (EXCLUDED_GRADING_SCALE_KEYWORDS.some((kw) => cellsText.includes(kw))) {
        continue;
      }

      // Check if this row is the month header for attendance
      const monthKeywords = ["jun", "jul", "aug", "sept", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may"];
      const hasMonths = cells.some(c => {
        const lower = c.toLowerCase();
        return monthKeywords.some(kw => lower === kw || lower.includes(kw));
      });
      if (hasMonths && cells.length >= 5) {
        const foundTotal = cells.findIndex((c, idx) => idx > 0 && c.toLowerCase().includes("total"));
        if (foundTotal > 0) {
          attendanceTotalColIdx = foundTotal;
          fields.attendance_months = cells.slice(1, attendanceTotalColIdx).filter(c => c.length > 0 && c !== "-");
        } else {
          fields.attendance_months = cells.slice(1).filter(c => {
            const l = c.toLowerCase();
            return monthKeywords.some(kw => l === kw || l.includes(kw));
          });
        }
        continue;
      }

      // First cell is usually the subject name or category
      const subject = cells[0];
      const subjectLower = subject.toLowerCase();
      
      // If the subject is very short skip it
      if (subject.length < 2) {
        continue;
      }

      // Check if category header (e.g. "Core Subjects", "Applied and Specialized Subjects")
      const catCheck = isCategoryHeader(subject);
      if (catCheck.isCategory) {
        currentCategory = catCheck.normalizedCategory || subject;
        continue;
      }

      // Check if it's an attendance row
      const isAttendance = [
        "no. of school days",
        "no. of days",
        "days present",
        "days absent",
        "attendance"
      ].some(kw => subjectLower.includes(kw));

      if (isAttendance) {
        let values: string[] = [];
        let totalVal: string | undefined = undefined;

        if (attendanceTotalColIdx > 0 && attendanceTotalColIdx < cells.length) {
          values = cells.slice(1, attendanceTotalColIdx).map(c => c.trim());
          const rawTotal = cells[attendanceTotalColIdx]?.trim();
          totalVal = rawTotal && rawTotal !== "" && rawTotal !== "-" && rawTotal !== "—" ? rawTotal : undefined;
        } else {
          values = cells.slice(1).map(c => c.trim());
        }

        attendance.push({
          label: subject,
          values,
          total: totalVal,
        });
        continue;
      }

      // Try to parse grades from subsequent cells
      let q1: number | string | undefined;
      let q2: number | string | undefined;
      let q3: number | string | undefined;
      let q4: number | string | undefined;
      let final: number | string | undefined;

      const numericCells = cells.slice(1).map(c => {
        const numMatch = c.match(/(\d+(\.\d+)?)/);
        return numMatch ? parseFloat(numMatch[1]) : undefined;
      });

      const validNumbers = numericCells.filter(n => n !== undefined) as number[];
      
      if (validNumbers.length === 0) {
        // Check if DepEd non-numeric marks exist (INC, DRP)
        const hasNonNumeric = cells.slice(1).some(c => {
          const u = c.trim().toUpperCase();
          return u === "INC" || u === "DRP" || u === "DROP";
        });
        if (hasNonNumeric) {
          final = "INC";
        } else {
          // If no numbers and no category match, record as Missing grade
          grades.push({
            category: currentCategory || undefined,
            subject,
            semester: currentSemester,
            grading_period_scheme: currentSemester ? "quarterly_semestral" : "quarterly",
            status: "Missing",
            needsVerification: true
          });
          continue;
        }
      }

      // Check if this row is the General Average row explicitly printed on the form
      const isGeneralAverage = [
        "general average",
        "gen. ave",
        "general weighted average",
        "gwa"
      ].some(kw => subjectLower.includes(kw));

      if (isGeneralAverage) {
        if (validNumbers.length > 0) {
          fields.general_average = validNumbers[validNumbers.length - 1];
        }
        continue;
      }

      // Map to quarters/semesters based on semester and how many numbers we found.
      // Do NOT invent a missing final grade or average!
      if (currentSemester === "2nd Semester") {
        if (numericCells.length >= 3 && (numericCells[0] !== undefined || numericCells[1] !== undefined)) {
          q3 = numericCells[0];
          q4 = numericCells[1];
          final = numericCells[2];
        } else if (validNumbers.length >= 3) {
          [q3, q4, final] = validNumbers;
        } else if (validNumbers.length === 2) {
          [q3, q4] = validNumbers;
          final = undefined;
        } else if (validNumbers.length === 1) {
          [final] = validNumbers;
        }
      } else if (currentSemester === "1st Semester") {
        if (numericCells.length >= 3 && (numericCells[0] !== undefined || numericCells[1] !== undefined)) {
          q1 = numericCells[0];
          q2 = numericCells[1];
          final = numericCells[2];
        } else if (validNumbers.length >= 3) {
          [q1, q2, final] = validNumbers;
        } else if (validNumbers.length === 2) {
          [q1, q2] = validNumbers;
          final = undefined;
        } else if (validNumbers.length === 1) {
          [final] = validNumbers;
        }
      } else {
        // Undefined semester / Full-Year (Elementary or JHS)
        if (validNumbers.length >= 5) {
          [q1, q2, q3, q4, final] = validNumbers;
        } else if (validNumbers.length === 4) {
          [q1, q2, q3, q4] = validNumbers;
          final = undefined;
        } else if (validNumbers.length === 3) {
          [q1, q2, final] = validNumbers;
        } else if (validNumbers.length === 2) {
          [q1, q2] = validNumbers;
        } else if (validNumbers.length === 1) {
          [final] = validNumbers;
        }
      }

      // Evaluate status based on final grade
      let status: "Passed" | "Failed" | "Missing" = "Missing";
      let needsVerification = false;
      
      if (final !== undefined) {
        if (typeof final === "number") {
          status = final < 75 ? "Failed" : "Passed";
          if (final >= 72 && final <= 77) {
            needsVerification = true;
          }
        } else {
          status = "Missing";
          needsVerification = true;
        }
      } else {
        status = "Missing";
        needsVerification = true;
      }

      const record: GradeRecord = {
        category: currentCategory || undefined,
        subject,
        semester: currentSemester,
        grade_level: currentGradeLevel,
        grading_period_scheme: currentSemester ? "quarterly_semestral" : "quarterly",
        q1,
        q2,
        q3,
        q4,
        final,
        status,
        needsVerification
      };

      if (currentSemester === "1st Semester") {
        record.sem1_final_grade = final;
      } else if (currentSemester === "2nd Semester") {
        record.sem2_final_grade = final;
      }

      // Scope merge by grade_level + semester so different grade levels or semesters NEVER merge
      const existingIdx = grades.findIndex(
        g =>
          g.grade_level === currentGradeLevel &&
          g.semester === currentSemester &&
          g.subject.toLowerCase() === subject.toLowerCase()
      );
      if (existingIdx >= 0) {
        grades[existingIdx] = record;
      } else {
        grades.push(record);
      }
    } else {
      // Plain-text subject grade line support (for SF9/SF10 lines without markdown pipes)
      // Pattern 1: "Oral Communication Q1: 88 Q2: 90 Final: 89" or "Core Subjects: Oral Communication Q1: 88 Q2: 90 Final: 89"
      const cleanedPlain = line
        .replace(/^(?:Core\s+Subjects?|Applied\s+(?:and|&)\s+Specialized\s+Subjects?|Applied\s+Subjects?|Specialized\s+Subjects?)[:\s]+/i, "")
        .trim();

      const q12Match = cleanedPlain.match(
        /^([A-Za-z0-9\s\-\/\(\)&,\.]+?)\s+Q([13])[:\s]+(\d+(?:\.\d+)?)\s+Q([24])[:\s]+(\d+(?:\.\d+)?)(?:\s+Final(?:\s+Grade)?[:\s]+(\d+(?:\.\d+)?))?$/i
      );
      if (q12Match) {
        const subject = q12Match[1].trim();
        const qAIndex = q12Match[2];
        const qAVal = parseFloat(q12Match[3]);
        const qBVal = parseFloat(q12Match[5]);
        const finalVal = q12Match[6] !== undefined ? parseFloat(q12Match[6]) : undefined;
        const semForLine: "1st Semester" | "2nd Semester" =
          qAIndex === "3" || currentSemester === "2nd Semester" ? "2nd Semester" : "1st Semester";

        const record: GradeRecord = {
          category: currentCategory || undefined,
          subject,
          semester: semForLine,
          grade_level: currentGradeLevel,
          grading_period_scheme: "quarterly_semestral",
          q1: semForLine === "1st Semester" ? qAVal : undefined,
          q2: semForLine === "1st Semester" ? qBVal : undefined,
          q3: semForLine === "2nd Semester" ? qAVal : undefined,
          q4: semForLine === "2nd Semester" ? qBVal : undefined,
          final: finalVal,
          sem1_final_grade: semForLine === "1st Semester" ? finalVal : undefined,
          sem2_final_grade: semForLine === "2nd Semester" ? finalVal : undefined,
          status: finalVal !== undefined ? (finalVal < 75 ? "Failed" : "Passed") : "Missing",
          needsVerification: finalVal === undefined || (finalVal >= 72 && finalVal <= 77),
        };
        const existingIdx = grades.findIndex(
          g =>
            g.grade_level === currentGradeLevel &&
            g.semester === semForLine &&
            g.subject.toLowerCase() === subject.toLowerCase()
        );
        if (existingIdx >= 0) grades[existingIdx] = record;
        else grades.push(record);
        continue;
      }

      // Pattern 2: "Oral Communication Final: 89" (common on SF10 permanent records)
      const finalOnlyMatch = cleanedPlain.match(
        /^([A-Za-z0-9\s\-\/\(\)&,\.]+?)\s+Final(?:\s+Grade|\s+Rating)?[:\s]+(\d+(?:\.\d+)?|INC|DRP)$/i
      );
      if (
        finalOnlyMatch &&
        !/^(?:general\s+average|semestral\s+general\s+average|gen\.?\s*ave)/i.test(finalOnlyMatch[1].trim())
      ) {
        const subject = finalOnlyMatch[1].trim();
        const rawFin = finalOnlyMatch[2].toUpperCase();
        const finalVal: number | string =
          rawFin === "INC" || rawFin === "DRP" ? rawFin : parseFloat(rawFin);
        const semForLine = currentSemester || "1st Semester";
        const isNum = typeof finalVal === "number" && !isNaN(finalVal);

        const record: GradeRecord = {
          category: currentCategory || undefined,
          subject,
          semester: semForLine,
          grade_level: currentGradeLevel,
          grading_period_scheme: "quarterly_semestral",
          final: finalVal,
          sem1_final_grade: semForLine === "1st Semester" ? finalVal : undefined,
          sem2_final_grade: semForLine === "2nd Semester" ? finalVal : undefined,
          status: isNum ? ((finalVal as number) < 75 ? "Failed" : "Passed") : "Missing",
          needsVerification: !isNum || ((finalVal as number) >= 72 && (finalVal as number) <= 77),
        };
        const existingIdx = grades.findIndex(
          g =>
            g.grade_level === currentGradeLevel &&
            g.semester === semForLine &&
            g.subject.toLowerCase() === subject.toLowerCase()
        );
        if (existingIdx >= 0) grades[existingIdx] = record;
        else grades.push(record);
        continue;
      }

      // Pattern 3: Subject line with inline numbers, e.g. "Oral Communication 88 88 88" or "Oral Communication 88 88"
      const inlineNumsMatch = cleanedPlain.match(
        /^([A-Za-z0-9\s\-\/\(\)&,\.]{3,}?)\s+(\d{2}(?:\.\d+)?)\s+(\d{2}(?:\.\d+)?)(?:\s+(\d{2}(?:\.\d+)?))?$/
      );
      if (
        inlineNumsMatch &&
        !/^(?:general\s+average|gen\.?\s*ave|quarter|semester|subjects?)/i.test(inlineNumsMatch[1].trim()) &&
        !EXCLUDED_OBSERVED_VALUES_KEYWORDS.some(kw => inlineNumsMatch[1].toLowerCase().includes(kw)) &&
        !EXCLUDED_GRADING_SCALE_KEYWORDS.some(kw => inlineNumsMatch[1].toLowerCase().includes(kw))
      ) {
        const subject = inlineNumsMatch[1].trim();
        const numA = parseFloat(inlineNumsMatch[2]);
        const numB = parseFloat(inlineNumsMatch[3]);
        const numC = inlineNumsMatch[4] !== undefined ? parseFloat(inlineNumsMatch[4]) : undefined;
        const semForLine = currentSemester || "1st Semester";

        let qA: number | undefined;
        let qB: number | undefined;
        let finalVal: number | undefined;

        if (numC !== undefined) {
          qA = numA;
          qB = numB;
          finalVal = numC;
        } else {
          qA = numA;
          qB = numB;
          finalVal = undefined;
        }

        const isSem2 = semForLine === "2nd Semester";
        const record: GradeRecord = {
          category: currentCategory || undefined,
          subject,
          semester: semForLine,
          grade_level: currentGradeLevel,
          grading_period_scheme: "quarterly_semestral",
          q1: !isSem2 ? qA : undefined,
          q2: !isSem2 ? qB : undefined,
          q3: isSem2 ? qA : undefined,
          q4: isSem2 ? qB : undefined,
          final: finalVal,
          sem1_final_grade: !isSem2 ? finalVal : undefined,
          sem2_final_grade: isSem2 ? finalVal : undefined,
          status: finalVal !== undefined ? (finalVal < 75 ? "Failed" : "Passed") : "Missing",
          needsVerification: finalVal === undefined || (finalVal >= 72 && finalVal <= 77),
        };

        const existingIdx = grades.findIndex(
          g =>
            g.grade_level === currentGradeLevel &&
            g.semester === semForLine &&
            g.subject.toLowerCase() === subject.toLowerCase()
        );
        if (existingIdx >= 0) grades[existingIdx] = record;
        else grades.push(record);
        continue;
      }

      // Pattern 4: Plain multiline list where Subject is on line i, and consecutive numbers are on lines i+1, i+2, i+3
      // e.g.:
      // Oral Communication
      // 88
      // 88
      // 88
      if (
        currentSemester &&
        /^[A-Za-z]/.test(cleanedPlain) &&
        cleanedPlain.length >= 3 &&
        !/^\d+$/.test(cleanedPlain) &&
        !cleanedPlain.includes(":") &&
        !CATEGORY_KEYWORDS.some(kw => cleanedPlain.toLowerCase() === kw || cleanedPlain.toLowerCase().includes(kw)) &&
        !EXCLUDED_OBSERVED_VALUES_KEYWORDS.some(kw => cleanedPlain.toLowerCase().includes(kw)) &&
        !EXCLUDED_GRADING_SCALE_KEYWORDS.some(kw => cleanedPlain.toLowerCase().includes(kw)) &&
        !/^(?:general\s+average|gen\.?\s*ave|quarter|subjects?|semester\s+final\s+grade|first\s+semester|second\s+semester)/i.test(cleanedPlain)
      ) {
        const subject = cleanedPlain;
        const nums: (number | string)[] = [];
        let j = i + 1;
        while (j < lines.length && nums.length < 3) {
          const nextLine = lines[j].trim();
          if (/^\d{2}(?:\.\d+)?$/.test(nextLine)) {
            nums.push(parseFloat(nextLine));
            j++;
          } else if (nextLine.toUpperCase() === "INC" || nextLine.toUpperCase() === "DRP") {
            nums.push(nextLine.toUpperCase());
            j++;
          } else {
            break;
          }
        }

        if (nums.length >= 1) {
          const semForLine = currentSemester;
          const isSem2 = semForLine === "2nd Semester";
          let qA: number | undefined;
          let qB: number | undefined;
          let finalVal: number | string | undefined;

          if (nums.length >= 3) {
            qA = typeof nums[0] === "number" ? nums[0] : undefined;
            qB = typeof nums[1] === "number" ? nums[1] : undefined;
            finalVal = nums[2];
          } else if (nums.length === 2) {
            qA = typeof nums[0] === "number" ? nums[0] : undefined;
            qB = typeof nums[1] === "number" ? nums[1] : undefined;
            finalVal = undefined;
          } else if (nums.length === 1) {
            finalVal = nums[0];
          }

          const isNum = typeof finalVal === "number" && !isNaN(finalVal);
          const record: GradeRecord = {
            category: currentCategory || undefined,
            subject,
            semester: semForLine,
            grade_level: currentGradeLevel,
            grading_period_scheme: "quarterly_semestral",
            q1: !isSem2 ? qA : undefined,
            q2: !isSem2 ? qB : undefined,
            q3: isSem2 ? qA : undefined,
            q4: isSem2 ? qB : undefined,
            final: finalVal,
            sem1_final_grade: !isSem2 ? (isNum ? (finalVal as number) : undefined) : undefined,
            sem2_final_grade: isSem2 ? (isNum ? (finalVal as number) : undefined) : undefined,
            status: finalVal !== undefined ? (isNum ? ((finalVal as number) < 75 ? "Failed" : "Passed") : "Missing") : "Missing",
            needsVerification: finalVal === undefined || (!isNum) || ((finalVal as number) >= 72 && (finalVal as number) <= 77),
          };

          const existingIdx = grades.findIndex(
            g =>
              g.grade_level === currentGradeLevel &&
              g.semester === semForLine &&
              g.subject.toLowerCase() === subject.toLowerCase()
          );
          if (existingIdx >= 0) grades[existingIdx] = record;
          else grades.push(record);

          i = j - 1; // Advance loop past consumed numeric lines
          continue;
        }
      }
    }
  }

  // Multiline Attendance Extraction Fallback (when attendance tables were not markdown pipes)
  if (attendance.length === 0) {
    const monthKeywords = ["jun", "jon", "jul", "aug", "sept", "sep", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may"];
    let detectedMonths: string[] = [];

    for (let idx = 0; idx < lines.length; idx++) {
      const lower = lines[idx].toLowerCase();
      if (lower.includes("report on attendance") || lower.includes("attendance")) {
        for (let j = idx + 1; j < Math.min(idx + 25, lines.length); j++) {
          const tokens = lines[j].trim().split(/\s+/);
          for (const tok of tokens) {
            const cMonth = tok.toLowerCase().replace(/[^a-z]/g, "");
            if (monthKeywords.includes(cMonth)) {
              const norm = cMonth === "jon" ? "Jun" : tok;
              if (!detectedMonths.includes(norm)) {
                detectedMonths.push(norm);
              }
            } else if (cMonth === "total") {
              break;
            }
          }
          if (lines[j].toLowerCase().includes("no. of school days") || detectedMonths.length >= 10) {
            break;
          }
        }
      }

      const isMetric = [
        "no. of school days",
        "school days",
        "days present",
        "no. of days present",
        "days absent",
        "no. of days absent",
      ].some((m) => lower === m || lower.startsWith(m));

      if (isMetric && detectedMonths.length > 0) {
        const label = lines[idx];
        const values: string[] = [];
        let totalVal: string | undefined = undefined;

        let j = idx + 1;
        while (j < lines.length) {
          const next = lines[j].trim();
          if (!next) {
            j++;
            continue;
          }
          // Handle repeated 0s e.g. "000000000000"
          if (/^0{5,}$/.test(next)) {
            for (let k = 0; k < detectedMonths.length; k++) {
              values.push("0");
            }
            totalVal = "0";
            j++;
            break;
          }

          const tokens = next.split(/\s+/);
          const isAttendanceToken = (tok: string) =>
            /^\d+(?:\.\d+)?$/.test(tok) ||
            /^[-—–_]$/.test(tok) ||
            /^(?:blank|none|n\/?a|na|null|missing|unreadable|:unselected:)$/i.test(tok);

          if (tokens.length > 0 && tokens.every(isAttendanceToken)) {
            values.push(...tokens);
            j++;
            if (values.length >= detectedMonths.length + 1) {
              totalVal = values.pop();
              break;
            } else if (values.length === detectedMonths.length) {
              break;
            }
          } else {
            break;
          }
        }

        if (values.length > 0) {
          attendance.push({ label, values, total: totalVal });
          idx = j - 1;
        }
      }
    }

    if (detectedMonths.length > 0 && attendance.length > 0) {
      fields.attendance_months = detectedMonths;
    }
  }

  if (grades.length > 0) {
    fields.grades = normalizeGradeRecords(grades, currentSemester);
    Object.assign(fields, updateExtractedFieldsAverages(fields));
  }
  if (attendance.length > 0) {
    fields.attendance = attendance;
    if (fields.attendance_months && fields.attendance_months.length > 0) {
      const schoolDaysRec = attendance.find((a) =>
        a.label.toLowerCase().includes("school days") || a.label.toLowerCase().includes("bilang ng araw ng pasok")
      );
      const daysPresentRec = attendance.find((a) =>
        a.label.toLowerCase().includes("present") || a.label.toLowerCase().includes("pumasok")
      );
      const daysAbsentRec = attendance.find((a) =>
        a.label.toLowerCase().includes("absent") || a.label.toLowerCase().includes("lumiban")
      );

      const evaluated = evaluateAttendanceData({
        months: fields.attendance_months,
        schoolDaysRow: schoolDaysRec?.values,
        daysPresentRow: daysPresentRec?.values,
        daysAbsentRow: daysAbsentRec?.values,
        printedSchoolDaysTotal: schoolDaysRec?.total,
        printedDaysPresentTotal: daysPresentRec?.total,
        printedDaysAbsentTotal: daysAbsentRec?.total,
      });

      fields.attendance_totals = {
        computed_school_days: evaluated.computedSchoolDays,
        computed_days_present: evaluated.computedDaysPresent,
        computed_days_absent: evaluated.computedDaysAbsent,
        is_school_days_complete: evaluated.isSchoolDaysComplete,
        is_days_present_complete: evaluated.isDaysPresentComplete,
        is_days_absent_complete: evaluated.isDaysAbsentComplete,
        printed_school_days: evaluated.printedSchoolDays,
        printed_days_present: evaluated.printedDaysPresent,
        printed_days_absent: evaluated.printedDaysAbsent,
      };
      fields.attendance_percentage = evaluated.attendancePercentage;
      fields.absence_percentage = evaluated.absencePercentage;
      fields.attendance_risk_status = evaluated.riskStatus;
      fields.attendance_discrepancy_details = evaluated.discrepancyDetails;
    }
  }

  // Extract Observed Values and Achievement if not already populated via Azure tables
  if (!fields.observed_values || !fields.learner_progress_achievement) {
    const textOv = parseTextObservedValuesAndAchievement(text);
    if (!fields.observed_values && textOv.observedValues) {
      fields.observed_values = textOv.observedValues;
    }
    if (!fields.learner_progress_achievement && textOv.learnerProgressAchievement) {
      fields.learner_progress_achievement = textOv.learnerProgressAchievement;
      fields.grading_scale = textOv.learnerProgressAchievement;
    }
  }

  return fields;
}

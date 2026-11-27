/**
 * AVV System — DepEd SF2 Attendance Formatting & Computation Validator
 *
 * Audits extracted SF2 learner rows for:
 * 1. Shading Format Compliance (DepEd SF2 Standard: Blank = Present, 'X' = Absent, Half-shade = Tardy)
 *    - Flags IMPROPER_FULL_CELL_SHADE (solid black cells on regular school days)
 * 2. Grid vs. Written Totals Reconciliation:
 *    - Reconciles gridAbsentCount ('X' marks) against written ABSENT column
 *    - Reconciles gridTardyCount (upper + lower half shades) against written TARDY column
 * 3. Consecutive Absences Detection (5+ consecutive absences flags Learner at Risk / SARDO)
 * 4. Per-Row & Per-Cell Reading Accuracy Percentages (XX%)
 */

import { validateConsecutiveSchoolYear } from "./gradeUtils";
import type { ShadingClassification } from "@/lib/ocr/attendanceShadingClassifier";

export interface Sf2DailyCellRecord {
  day: number;
  status?: string;
  raw_mark?: string;
  shading_classification?: ShadingClassification | string;
  shading_confidence?: number;
  fill_ratio?: number;
  cell_polygon?: number[];
  requires_teacher_verification?: boolean;
  recognition_method?: string;
  is_holiday?: boolean;
}

export interface Sf2RowValidationInput {
  rowIndex?: number;
  learnerName?: string;
  studentName?: string;
  dailyCells?: Sf2DailyCellRecord[];
  daily_grid?: Sf2DailyCellRecord[];
  gridAbsentCount?: number;
  gridTardyCount?: number;
  writtenAbsent?: number | null;
  writtenTardy?: number | null;
  writtenPresent?: number | null;
  days_absent?: number | null;
  days_tardy?: number | null;
  days_present?: number | null;
  daysPresent?: number | null;
  daysAbsent?: number | null;
  daysTardy?: number | null;
  totalSchoolDays?: number;
  total_days?: number;
  total_school_days?: number;
  nameConfidence?: number;
  gridShadingConfidence?: number;
  writtenAbsentConfidence?: number;
  writtenTardyConfidence?: number;
}

export interface Sf2RowValidationResult {
  rowIndex?: number;
  learnerName: string;
  isShadingFormatValid: boolean;
  shadingFormatWarning?: string;
  hasImproperFullCellShading: boolean;
  gridAbsentCount: number;
  gridTardyCount: number;
  writtenAbsent?: number | null;
  writtenTardy?: number | null;
  writtenPresent?: number | null;
  absentMismatch: boolean;
  tardyMismatch: boolean;
  discrepancyWarnings: string[];
  reconciliationWarnings: string[];
  allWarnings: string[];
  hasConsecutiveAbsencesWarning: boolean;
  consecutiveAbsencesCount: number;
  isValid: boolean;
  nameConfidence: number;
  gridShadingConfidence: number;
  writtenAbsentConfidence: number;
  writtenTardyConfidence: number;
  rowAccuracyPercent: number; // 0..100
  overallRowAccuracy: number; // alias
}

/**
 * Validates a single DepEd SF2 learner attendance row against official DepEd formatting rules
 * and reconciles daily attendance grid markings against handwritten/printed summary totals.
 */
export function validateSf2RowFormattingAndTotals(
  row: Sf2RowValidationInput
): Sf2RowValidationResult {
  const learnerName = row.learnerName || row.studentName || "Learner";
  const cells: Sf2DailyCellRecord[] = Array.isArray(row.dailyCells)
    ? row.dailyCells
    : Array.isArray(row.daily_grid)
    ? row.daily_grid
    : [];

  // 1. Grid Mark Counting & Shading Format Audit
  let calculatedAbsent = 0;
  let calculatedTardy = 0;
  let hasImproperFullCellShading = false;
  let cellConfSum = 0;
  let cellConfCount = 0;

  // Track consecutive school day absences (ignoring holidays / weekends)
  let currentConsecutive = 0;
  let maxConsecutive = 0;

  // Sort daily cells by day index
  const sortedCells = [...cells].sort((a, b) => (a.day || 0) - (b.day || 0));

  for (const cell of sortedCells) {
    const raw = (cell.raw_mark || (cell as any).raw_mark || (cell as any).rawMark || (cell as any).mark || "").trim().toLowerCase();
    const cls = (cell.shading_classification || (cell as any).classification || "").toUpperCase();
    const isHoliday =
      cell.is_holiday ||
      cls === "FULL_COLUMN_SHADE" ||
      cell.status === "HOLIDAY" ||
      cell.status === "NO_CLASS";

    const conf = typeof cell.shading_confidence === "number" ? cell.shading_confidence : 0.95;
    cellConfSum += conf;
    cellConfCount++;

    if (isHoliday) {
      // Holidays are excluded from school days and do not count toward absences
      continue;
    }

    // Check for Absent ('X' mark or full absence shading)
    const isAbsent =
      cls === "X_MARK" ||
      cls === "FULL_SHADE" ||
      cell.status === "ABSENT" ||
      raw === "x" ||
      raw === "×" ||
      raw === "✕" ||
      raw === "[x]" ||
      raw === "absent" ||
      raw === "full_shade" ||
      raw === "full-shade";

    // Check for Tardy (Upper / Lower half shade)
    const isTardy =
      cls === "UPPER_HALF_SHADE" ||
      cls === "LOWER_HALF_SHADE" ||
      cls === "HALF_SHADE" ||
      cell.status === "TARDY" ||
      raw === "upper_triangle" ||
      raw === "lower_triangle" ||
      raw === "half_shade" ||
      raw === "half" ||
      raw === "late" ||
      raw === "cutting" ||
      raw === "tardy" ||
      raw === "▲" ||
      raw === "▼" ||
      raw === "◤" ||
      raw === "◥";

    // Active-day shading reconciliation check
    const isReconciledActive =
      cell.recognition_method === "active_day_shading_reconciled" ||
      (cell.status === "PRESENT" && (cls === "FULL_SHADE" || cls === "SHADED") && row.writtenAbsent === 0);

    // Check for Improper Full-Cell Shading on regular school days
    // (Solid black fill used for present days instead of leaving them blank)
    const isImproperShade =
      !isHoliday &&
      !isReconciledActive &&
      !isTardy &&
      !isAbsent &&
      (cls === "IMPROPER_FULL_CELL_SHADE" ||
        raw === "improper_full_cell_shade" ||
        raw === "improper_shade" ||
        raw === "solid_black" ||
        (cell.fill_ratio !== undefined && cell.fill_ratio >= 0.72));

    if (isImproperShade) {
      hasImproperFullCellShading = true;
    }

    if (isAbsent) {
      calculatedAbsent++;
      currentConsecutive++;
      if (currentConsecutive > maxConsecutive) {
        maxConsecutive = currentConsecutive;
      }
    } else {
      // Present or Tardy resets consecutive absence streak
      currentConsecutive = 0;
      if (isTardy) {
        calculatedTardy++;
      }
    }
  }

  // Use explicit grid counts if passed, otherwise use evaluated counts
  const gridAbsentCount =
    typeof row.gridAbsentCount === "number" ? row.gridAbsentCount : calculatedAbsent;
  const gridTardyCount =
    typeof row.gridTardyCount === "number" ? row.gridTardyCount : calculatedTardy;

  // Resolve written summary numbers
  const writtenAbsent =
    row.writtenAbsent !== undefined
      ? row.writtenAbsent
      : row.days_absent !== undefined
      ? row.days_absent
      : row.daysAbsent !== undefined
      ? row.daysAbsent
      : null;

  const writtenTardy =
    row.writtenTardy !== undefined
      ? row.writtenTardy
      : row.days_tardy !== undefined
      ? row.days_tardy
      : row.daysTardy !== undefined
      ? row.daysTardy
      : null;

  const writtenPresent =
    row.writtenPresent !== undefined
      ? row.writtenPresent
      : row.days_present !== undefined
      ? row.days_present
      : row.daysPresent !== undefined
      ? row.daysPresent
      : null;

  // 2. Shading Format Check
  const discrepancyWarnings: string[] = [];
  let isShadingFormatValid = true;
  let shadingFormatWarning: string | undefined = undefined;

  if (hasImproperFullCellShading) {
    isShadingFormatValid = false;
    shadingFormatWarning =
      "Improper SF2 Shading Format: Present days must be left BLANK, 'X' for Absent, and half-shaded (upper/lower) for Tardy—solid full-cell shading detected on regular school days";
    discrepancyWarnings.push(shadingFormatWarning);
  }

  // 3. Grid vs Written Totals Reconciliation
  let absentMismatch = false;
  if (writtenAbsent !== null && writtenAbsent !== undefined && !isNaN(writtenAbsent)) {
    if (gridAbsentCount !== writtenAbsent) {
      absentMismatch = true;
      discrepancyWarnings.push(
        `Absent count mismatch: grid shows ${gridAbsentCount} 'X' mark${gridAbsentCount === 1 ? "" : "s"}, but written ABSENT column says ${writtenAbsent}`
      );
    }
  }

  let tardyMismatch = false;
  if (writtenTardy !== null && writtenTardy !== undefined && !isNaN(writtenTardy)) {
    if (gridTardyCount !== writtenTardy) {
      tardyMismatch = true;
      discrepancyWarnings.push(
        `Tardy count mismatch: grid shows ${gridTardyCount} half-shaded cell${gridTardyCount === 1 ? "" : "s"}, but written TARDY column says ${writtenTardy}`
      );
    }
  }

  // 4. Consecutive Absences Detection (5+ consecutive absences)
  const hasConsecutiveAbsencesWarning = maxConsecutive >= 5;
  if (hasConsecutiveAbsencesWarning) {
    discrepancyWarnings.push(
      `5 or more consecutive absences detected (${maxConsecutive} consecutive days) — Learner at Risk of Dropping Out (SARDO)`
    );
  }

  // 5. Accuracy Percentages (XX%)
  const nameConfidence =
    typeof row.nameConfidence === "number"
      ? Math.round(row.nameConfidence <= 1 ? row.nameConfidence * 100 : row.nameConfidence)
      : learnerName && learnerName.length >= 4 && !learnerName.includes("Learner")
      ? 96
      : 75;

  let baseGridShadingConf =
    cellConfCount > 0
      ? (cellConfSum / cellConfCount) * 100
      : typeof row.gridShadingConfidence === "number"
      ? (row.gridShadingConfidence <= 1 ? row.gridShadingConfidence * 100 : row.gridShadingConfidence)
      : 95;

  // Automatically lower gridShadingConfidence if improper shading or unclear marks occur
  if (hasImproperFullCellShading) {
    baseGridShadingConf = Math.min(baseGridShadingConf, 65);
  }
  const gridShadingConfidence = Math.max(10, Math.min(100, Math.round(baseGridShadingConf)));

  const writtenAbsentConfidence =
    typeof row.writtenAbsentConfidence === "number"
      ? Math.round(row.writtenAbsentConfidence <= 1 ? row.writtenAbsentConfidence * 100 : row.writtenAbsentConfidence)
      : writtenAbsent !== null && !isNaN(writtenAbsent)
      ? 95
      : 65;

  const writtenTardyConfidence =
    typeof row.writtenTardyConfidence === "number"
      ? Math.round(row.writtenTardyConfidence <= 1 ? row.writtenTardyConfidence * 100 : row.writtenTardyConfidence)
      : writtenTardy !== null && !isNaN(writtenTardy)
      ? 95
      : 65;

  // Weighted overall row accuracy (0..100)
  let rawScore =
    0.25 * nameConfidence +
    0.45 * gridShadingConfidence +
    0.15 * writtenAbsentConfidence +
    0.15 * writtenTardyConfidence;

  // Deductions for arithmetic mismatches or improper formatting
  if (absentMismatch) rawScore -= 15;
  if (tardyMismatch) rawScore -= 15;
  if (!isShadingFormatValid) rawScore -= 20;

  const rowAccuracyPercent = Math.max(0, Math.min(100, Math.round(rawScore)));
  const isValid = isShadingFormatValid && !absentMismatch && !tardyMismatch;

  // Add consecutive absences warning to discrepancy warnings if flagged
  if (hasConsecutiveAbsencesWarning) {
    discrepancyWarnings.push("SARDO Alert: Learner has 5 or more consecutive absences");
  }

  return {
    rowIndex: row.rowIndex,
    learnerName,
    reconciliationWarnings: discrepancyWarnings,
    allWarnings: discrepancyWarnings,
    isShadingFormatValid,
    shadingFormatWarning,
    hasImproperFullCellShading,
    gridAbsentCount,
    gridTardyCount,
    writtenAbsent,
    writtenTardy,
    writtenPresent,
    absentMismatch,
    tardyMismatch,
    discrepancyWarnings,
    hasConsecutiveAbsencesWarning,
    consecutiveAbsencesCount: maxConsecutive,
    isValid,
    nameConfidence,
    gridShadingConfidence,
    writtenAbsentConfidence,
    writtenTardyConfidence,
    rowAccuracyPercent,
    overallRowAccuracy: rowAccuracyPercent,
  };
}

/**
 * Validates SF2 Header School Year using the strict consecutive school year validator.
 */
export function validateSf2SchoolYear(schoolYear?: string | null) {
  return validateConsecutiveSchoolYear(schoolYear);
}

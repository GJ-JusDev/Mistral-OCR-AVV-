/**
 * ATTENDANCE EVALUATION & SCREENING ENGINE
 * 
 * Bakit ito kailangan para sa Taysan Resettlement Integrated School (School ID 500169):
 * 1. Ang Report on Attendance table sa SF9 ay naglalaman ng bilang ng school days, days present,
 *    at days absent para sa bawat buwan (Jun hanggang Apr), kasama ang opisyal na Total column.
 * 2. Kinakalkula ng engine ang:
 *    - Total School Days = Sum ng verified monthly school days
 *    - Total Days Present = Sum ng verified monthly days present
 *    - Total Days Absent = Sum ng verified monthly days absent
 *    - Attendance Percentage = (Total Days Present / Total School Days) * 100
 *    - Absence Percentage = (Total Days Absent / Total School Days) * 100
 * 3. Attendance Screening Statuses:
 *    - NORMAL: Absence < 15% (Walang warning)
 *    - ATTENDANCE_WARNING: Absence mula 15% hanggang 20% (Early warning para sa school intervention)
 *    - ATTENDANCE_REVIEW_REQUIRED: Absence > 20% (Ayon sa DepEd 20% rule; kailangan ng principal review)
 *    - INCOMPLETE_ATTENDANCE_DATA: Kulang o unreadable ang talaan
 * 4. Proteksyon para sa Mag-aaral (DepEd Safeguards):
 *    - Warning lang ito! HINDI awtomatikong ibinabagsak, dina-drop, o pinaparusahan ang student.
 *    - Hindi binabago ang academic grades dahil sa attendance warning.
 *    - Ang Total school days sa SF9 ay hindi pwedeng gamiting conclusive proof ng subject-level violation
 *      nang walang opisyal na ebidensya at desisyon ng School Head.
 */

export type AttendanceRiskStatus =
  | "NORMAL"
  | "ATTENDANCE_WARNING"
  | "ATTENDANCE_REVIEW_REQUIRED"
  | "INCOMPLETE_ATTENDANCE_DATA";

export type AttendanceVerificationStatus =
  | "PENDING"
  | "ATTENDANCE_VERIFIED"
  | "FLAGGED_FOR_REVIEW";

export interface MonthlyAttendanceItem {
  month: string;
  schoolDays?: number;
  daysPresent?: number;
  daysAbsent?: number;
  isEquationValid?: boolean;
  isComplete?: boolean;
}

export interface AttendanceEvaluationInput {
  months: string[];
  schoolDaysRow?: (number | string | undefined | null)[];
  daysPresentRow?: (number | string | undefined | null)[];
  daysAbsentRow?: (number | string | undefined | null)[];
  printedSchoolDaysTotal?: number | string | null;
  printedDaysPresentTotal?: number | string | null;
  printedDaysAbsentTotal?: number | string | null;
  verificationStatus?: AttendanceVerificationStatus;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  earlyWarningThresholdPercent?: number; // Default: 15%
  reviewRequiredThresholdPercent?: number; // Default: 20%
}

export interface AttendanceEvaluationResult {
  monthlyBreakdown: MonthlyAttendanceItem[];
  computedSchoolDays?: number;
  computedDaysPresent?: number;
  computedDaysAbsent?: number;
  isSchoolDaysComplete?: boolean;
  isDaysPresentComplete?: boolean;
  isDaysAbsentComplete?: boolean;
  printedSchoolDays?: number;
  printedDaysPresent?: number;
  printedDaysAbsent?: number;
  attendancePercentage: number;
  absencePercentage: number;
  hasTotalsDiscrepancy: boolean;
  hasEquationDiscrepancy: boolean;
  discrepancyDetails: string[];
  riskStatus: AttendanceRiskStatus;
  verificationStatus: AttendanceVerificationStatus;
  requiresReview: boolean;
  advisoryMessage: string;
  isComplete: boolean;
}

/**
 * PARSE ATTENDANCE NUMERIC VALUE
 *
 * Sinusuportahan ang buo (integer) at fractional/decimal na araw (hal. 0.5, 19.5).
 * Ang unreadable, blank, hyphen, o dash ay ibinabalik bilang undefined (HINDI zero).
 */
export function parseAttendanceNumber(val: any): number | undefined {
  if (val === undefined || val === null) return undefined;
  const str = String(val).trim();
  const lower = str.toLowerCase();
  if (
    str === "" ||
    str === "-" ||
    str === "—" ||
    str === "–" ||
    str === "_" ||
    str === ":unselected:" ||
    str === ":selected:" ||
    lower === "null" ||
    lower === "undefined" ||
    lower === "blank" ||
    lower === "none" ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "missing" ||
    lower === "unreadable" ||
    lower === "incomplete" ||
    lower === "unknown"
  ) {
    return undefined;
  }
  const match = str.match(/^-?(\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  return isNaN(num) ? undefined : num;
}

/**
 * EVALUATE ATTENDANCE DATA & THRESHOLDS
 *
 * Kinukwenta ang mga kabuuan at percentage ng attendance at sinusuri ang risk status.
 */
export function evaluateAttendanceData(input: AttendanceEvaluationInput): AttendanceEvaluationResult {
  const months = input.months || [];
  const schoolDaysRow = input.schoolDaysRow || [];
  const daysPresentRow = input.daysPresentRow || [];
  const daysAbsentRow = input.daysAbsentRow || [];

  const earlyWarningThreshold = input.earlyWarningThresholdPercent ?? 15;
  const reviewRequiredThreshold = input.reviewRequiredThresholdPercent ?? 20;

  const monthlyBreakdown: MonthlyAttendanceItem[] = [];
  let sumSchoolDays = 0;
  let sumDaysPresent = 0;
  let sumDaysAbsent = 0;

  let countSchoolDaysPopulated = 0;
  let countDaysPresentPopulated = 0;
  let countDaysAbsentPopulated = 0;

  let hasTotalsDiscrepancy = false;
  let hasEquationDiscrepancy = false;
  const discrepancyDetails: string[] = [];

  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    const sd = parseAttendanceNumber(schoolDaysRow[i]);
    const dp = parseAttendanceNumber(daysPresentRow[i]);
    const da = parseAttendanceNumber(daysAbsentRow[i]);

    if (sd !== undefined) {
      sumSchoolDays += sd;
      countSchoolDaysPopulated++;
    }
    if (dp !== undefined) {
      sumDaysPresent += dp;
      countDaysPresentPopulated++;
    }
    if (da !== undefined) {
      sumDaysAbsent += da;
      countDaysAbsentPopulated++;
    }

    let isEquationValid: boolean | undefined = undefined;
    const isItemComplete = sd !== undefined && dp !== undefined && da !== undefined;
    if (isItemComplete) {
      const sumPresAbs = Math.round((dp + da) * 100) / 100;
      const expectedSd = Math.round(sd * 100) / 100;
      if (sumPresAbs === expectedSd) {
        isEquationValid = true;
      } else {
        isEquationValid = false;
        hasTotalsDiscrepancy = true;
        hasEquationDiscrepancy = true;
        discrepancyDetails.push(
          `Discrepancy sa Attendance Equation sa buwan ng ${month}: Days Present (${dp}) + Days Absent (${da}) = ${sumPresAbs}, ngunit ang School Days ay ${sd}.`
        );
      }
    }

    monthlyBreakdown.push({
      month,
      schoolDays: sd,
      daysPresent: dp,
      daysAbsent: da,
      isEquationValid,
      isComplete: isItemComplete,
    });
  }

  // Completeness flags per metric row
  const isSchoolDaysComplete = months.length > 0 && countSchoolDaysPopulated === months.length;
  const isDaysPresentComplete = months.length > 0 && countDaysPresentPopulated === months.length;
  const isDaysAbsentComplete = months.length > 0 && countDaysAbsentPopulated === months.length;

  // Requirement: Compute totals ONLY from complete, valid monthly data.
  // If a row or month is incomplete, do NOT compute or report an incomplete total as official.
  const computedSchoolDays = isSchoolDaysComplete ? Math.round(sumSchoolDays * 100) / 100 : undefined;
  const computedDaysPresent = isDaysPresentComplete ? Math.round(sumDaysPresent * 100) / 100 : undefined;
  const computedDaysAbsent = isDaysAbsentComplete ? Math.round(sumDaysAbsent * 100) / 100 : undefined;

  // Percentage calculations
  const attendancePercentage =
    computedSchoolDays !== undefined && computedDaysPresent !== undefined && computedSchoolDays > 0
      ? Math.round((computedDaysPresent / computedSchoolDays) * 10000) / 100
      : 0;

  const absencePercentage =
    computedSchoolDays !== undefined && computedDaysAbsent !== undefined && computedSchoolDays > 0
      ? Math.round((computedDaysAbsent / computedSchoolDays) * 10000) / 100
      : 0;

  // Printed totals
  const printedSchoolDays = parseAttendanceNumber(input.printedSchoolDaysTotal);
  const printedDaysPresent = parseAttendanceNumber(input.printedDaysPresentTotal);
  const printedDaysAbsent = parseAttendanceNumber(input.printedDaysAbsentTotal);

  if (printedSchoolDays !== undefined && computedSchoolDays !== undefined && printedSchoolDays !== computedSchoolDays) {
    hasTotalsDiscrepancy = true;
    discrepancyDetails.push(
      `Discrepancy sa Total School Days: Nakaimprenta sa form ay ${printedSchoolDays}, ngunit ang sum ng buwanan ay ${computedSchoolDays}.`
    );
  }

  if (printedDaysPresent !== undefined && computedDaysPresent !== undefined && printedDaysPresent !== computedDaysPresent) {
    hasTotalsDiscrepancy = true;
    discrepancyDetails.push(
      `Discrepancy sa Total Days Present: Nakaimprenta sa form ay ${printedDaysPresent}, ngunit ang sum ng buwanan ay ${computedDaysPresent}.`
    );
  }

  if (printedDaysAbsent !== undefined && computedDaysAbsent !== undefined && printedDaysAbsent !== computedDaysAbsent) {
    hasTotalsDiscrepancy = true;
    discrepancyDetails.push(
      `Discrepancy sa Total Days Absent: Nakaimprenta sa form ay ${printedDaysAbsent}, ngunit ang sum ng buwanan ay ${computedDaysAbsent}.`
    );
  }

  // Equation checks on Printed Totals
  if (printedSchoolDays !== undefined && printedDaysPresent !== undefined && printedDaysAbsent !== undefined) {
    const sumPrinted = Math.round((printedDaysPresent + printedDaysAbsent) * 100) / 100;
    const expPrintedSd = Math.round(printedSchoolDays * 100) / 100;
    if (sumPrinted !== expPrintedSd) {
      hasTotalsDiscrepancy = true;
      hasEquationDiscrepancy = true;
      discrepancyDetails.push(
        `Discrepancy sa Attendance Equation sa Printed Totals: Days Present (${printedDaysPresent}) + Days Absent (${printedDaysAbsent}) = ${sumPrinted}, ngunit ang School Days ay ${printedSchoolDays}.`
      );
    }
  }

  // Equation checks on Computed Totals
  if (
    computedSchoolDays !== undefined &&
    computedDaysPresent !== undefined &&
    computedDaysAbsent !== undefined &&
    computedSchoolDays > 0
  ) {
    const sumComputed = Math.round((computedDaysPresent + computedDaysAbsent) * 100) / 100;
    if (sumComputed !== computedSchoolDays) {
      hasTotalsDiscrepancy = true;
      hasEquationDiscrepancy = true;
      discrepancyDetails.push(
        `Discrepancy sa Attendance Equation sa Computed Totals: Sum of Days Present (${computedDaysPresent}) + Sum of Days Absent (${computedDaysAbsent}) = ${sumComputed}, ngunit ang Computed School Days ay ${computedSchoolDays}.`
      );
    }
  }

  // Completeness check
  const isComplete =
    months.length > 0 &&
    isSchoolDaysComplete &&
    isDaysPresentComplete &&
    isDaysAbsentComplete;

  // Risk Status Screening
  let riskStatus: AttendanceRiskStatus = "NORMAL";
  let requiresReview = false;
  let advisoryMessage = "";

  if (!isComplete) {
    riskStatus = "INCOMPLETE_ATTENDANCE_DATA";
    requiresReview = true;
    advisoryMessage =
      "Incomplete Attendance Data: Kulang o unreadable ang ilang cells sa attendance record ng SF9. Kailangan itong i-verify ng Teacher bago maging opisyal.";
  } else if (absencePercentage > reviewRequiredThreshold) {
    riskStatus = "ATTENDANCE_REVIEW_REQUIRED";
    requiresReview = true;
    advisoryMessage = `Attendance Review Required: Posibleng lumagpas sa attendance limit ang student (${absencePercentage}% absences). Hindi pa ito automatic failure. Kailangan ng verification at school-level decision ayon sa DepEd policy.`;
  } else if (absencePercentage >= earlyWarningThreshold) {
    riskStatus = "ATTENDANCE_WARNING";
    requiresReview = true;
    advisoryMessage = `Attendance Warning: Mataas ang recorded absences ng student (${absencePercentage}% absences). Kailangan i-verify ng Teacher ang attendance record at i-review ang applicable school policy.`;
  } else {
    riskStatus = "NORMAL";
    requiresReview = false;
    advisoryMessage = `Normal ang attendance record ng student (${attendancePercentage}% present, ${absencePercentage}% absent). Walang attendance warning.`;
  }

  if (hasTotalsDiscrepancy || hasEquationDiscrepancy) {
    requiresReview = true;
  }

  const verificationStatus: AttendanceVerificationStatus =
    input.verificationStatus || (requiresReview ? "PENDING" : "PENDING");

  return {
    monthlyBreakdown,
    computedSchoolDays,
    computedDaysPresent,
    computedDaysAbsent,
    isSchoolDaysComplete,
    isDaysPresentComplete,
    isDaysAbsentComplete,
    printedSchoolDays,
    printedDaysPresent,
    printedDaysAbsent,
    attendancePercentage,
    absencePercentage,
    hasTotalsDiscrepancy,
    hasEquationDiscrepancy,
    discrepancyDetails,
    riskStatus,
    verificationStatus,
    requiresReview,
    advisoryMessage,
    isComplete,
  };
}

/**
 * HELPER: EVALUATE ATTENDANCE RECORDS LIST
 *
 * Madaling paraan para kwentahin ang attendance records array mula sa OCR o Teacher review.
 */
export function evaluateAttendanceRecords(
  records: { label: string; values: string[]; total?: string | number }[],
  months?: string[]
) {
  const schoolDaysRec = records.find((a) =>
    a.label.toLowerCase().includes("school days") || a.label.toLowerCase().includes("bilang ng araw ng pasok")
  );
  const daysPresentRec = records.find((a) =>
    a.label.toLowerCase().includes("present") || a.label.toLowerCase().includes("pumasok")
  );
  const daysAbsentRec = records.find((a) =>
    a.label.toLowerCase().includes("absent") || a.label.toLowerCase().includes("lumiban")
  );

  const maxValuesLen = Math.max(
    schoolDaysRec?.values?.length || 0,
    daysPresentRec?.values?.length || 0,
    daysAbsentRec?.values?.length || 0
  );

  const fallbackMonths = months && months.length >= maxValuesLen
    ? months
    : Array.from({ length: maxValuesLen }, (_, i) => months?.[i] || `M${i + 1}`);

  const evaluated = evaluateAttendanceData({
    months: fallbackMonths,
    schoolDaysRow: schoolDaysRec?.values,
    daysPresentRow: daysPresentRec?.values,
    daysAbsentRow: daysAbsentRec?.values,
    printedSchoolDaysTotal: schoolDaysRec?.total,
    printedDaysPresentTotal: daysPresentRec?.total,
    printedDaysAbsentTotal: daysAbsentRec?.total,
  });

  return {
    evaluated,
    totals: {
      computed_school_days: evaluated.computedSchoolDays,
      computed_days_present: evaluated.computedDaysPresent,
      computed_days_absent: evaluated.computedDaysAbsent,
      is_school_days_complete: evaluated.isSchoolDaysComplete,
      is_days_present_complete: evaluated.isDaysPresentComplete,
      is_days_absent_complete: evaluated.isDaysAbsentComplete,
      printed_school_days: evaluated.printedSchoolDays,
      printed_days_present: evaluated.printedDaysPresent,
      printed_days_absent: evaluated.printedDaysAbsent,
    },
    attendancePercentage: evaluated.attendancePercentage,
    absencePercentage: evaluated.absencePercentage,
    riskStatus: evaluated.riskStatus,
    hasTotalsDiscrepancy: evaluated.hasTotalsDiscrepancy,
    hasEquationDiscrepancy: evaluated.hasEquationDiscrepancy,
    discrepancyDetails: evaluated.discrepancyDetails,
  };
}

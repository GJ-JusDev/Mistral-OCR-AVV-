export type GradingPeriodScheme = "quarterly_semestral" | "three_term" | "quarterly";

export type GradeRecord = {
  category?: string;
  subject_category?: string;
  subject_track?: string;
  subject_code?: string;
  grade_level?: string;
  semester?: string;
  source_section?: string;
  grading_period_scheme?: GradingPeriodScheme;
  subject: string;
  q1?: number | string;
  q2?: number | string;
  q3?: number | string;
  q4?: number | string;
  t1?: number | string;
  t2?: number | string;
  t3?: number | string;
  sem1_final_grade?: number | string;
  sem2_final_grade?: number | string;
  units?: number;
  failed_final_grade?: number | string;
  remedial_class_mark?: number | string;
  recomputed_final_grade?: number | string;
  remedial_sem1_recomputed?: number | string;
  remedial_sem2_recomputed?: number | string;
  final?: number | string;
  action_taken?: string;
  remark?: string;
  printed_final_grade?: number | string;
  ocr_final_grade?: number | string;
  precise_computed_grade?: number;
  displayed_grade?: number;
  displayed_final_grade?: number;
  computation_formula?: string;
  computed_final_grade?: number;
  raw_calculated_final?: number;
  official_computed_final?: number;
  is_auto_computed?: boolean;
  grade_source?: "ocr" | "auto_computed" | "manual_edit" | "verified";
  has_calculation_discrepancy?: boolean;
  calculation_notes?: string;
  status: "Passed" | "Failed" | "Missing";
  needsVerification?: boolean;
  curriculum_id?: string;
  source_form_version?: string;
  grading_policy_version?: string;
  source_side?: "front" | "back" | "both";
  source_page?: number | string;
  discrepancy_note?: string;
  recognition_type?: string;
  is_handwritten?: boolean;
  icr_confidence?: number;
  bounding_box?: number[];
};

export type AttendanceRecord = {
  label: string;
  values: string[];
  total?: string | number;
};

export type ObservedValueRating = "AO" | "SO" | "RO" | "NO";

export type CoreValueName = "Maka-Diyos" | "Makatao" | "Makakalikasan" | "Makabansa";

export interface ObservedValueQuarterRecord {
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  original_mark?: string;
  normalized_rating?: ObservedValueRating | null;
  confidence?: number;
  source_page?: number | string;
  location?: string | number[];
  bounding_box?: number[];
  needs_verification?: boolean;
  verification_status?: "unverified" | "verified" | "corrected" | "flagged";
  corrected_mark?: ObservedValueRating;
  corrected_by?: string;
  corrected_at?: string;
}

export interface BehaviorStatementRecord {
  statement_id: string;
  statement: string;
  core_value: CoreValueName;
  core_value_index: 1 | 2 | 3 | 4;
  q1?: ObservedValueQuarterRecord;
  q2?: ObservedValueQuarterRecord;
  q3?: ObservedValueQuarterRecord;
  q4?: ObservedValueQuarterRecord;
}

export interface CoreValueGroup {
  name: CoreValueName;
  index: 1 | 2 | 3 | 4;
  statements: BehaviorStatementRecord[];
}

export interface LearnerObservedValueObservation {
  id?: string;
  document_id?: string;
  lrn?: string;
  core_value: CoreValueName;
  behavior_statement: string;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  original_mark: string;
  normalized_rating: ObservedValueRating | null;
  ocr_confidence?: number;
  source_page?: number | string;
  location?: string | number[];
  bounding_box?: number[];
  needs_verification: boolean;
  verification_status: "unverified" | "verified" | "corrected" | "flagged";
  teacher_correction?: string;
  teacher_corrected_at?: string;
  teacher_corrected_by?: string;
}

export interface LearnersObservedValues {
  statements: BehaviorStatementRecord[];
  core_values: CoreValueGroup[];
  observations: LearnerObservedValueObservation[];
  marking_legend?: {
    AO: string;
    SO: string;
    RO: string;
    NO: string;
  };
  has_unreadable_marks?: boolean;
  flagged_for_verification?: boolean;
}

export interface GradingScaleItem {
  descriptor: string;
  grading_scale: string;
  remarks: string;
  confidence?: number;
  source_page?: number | string;
}

export interface LearnerProgressAndAchievement {
  scale_items: GradingScaleItem[];
  source_page?: number | string;
  confidence?: number;
}

export type AssignmentContextMismatchType =
  | "SCHOOL_YEAR_MISMATCH"
  | "GRADE_LEVEL_MISMATCH"
  | "SECTION_MISMATCH"
  | "STRAND_MISMATCH"
  | string;

export interface ContextMismatchItem {
  type?: AssignmentContextMismatchType;
  expected?: string;
  actual?: string;
  message?: string;
}

export type AssignmentContextMismatch = ContextMismatchItem | string;
export type AssignmentContextMismatchEntry = AssignmentContextMismatch;

/**
 * Safely formats an assignment context mismatch entry into a human-readable string.
 * - If the mismatch is a string, returns it directly if non-empty.
 * - If it is an object with a non-empty string message, returns message.
 * - Otherwise, safely constructs a readable fallback using type, expected, and actual.
 * - Never returns a raw object.
 * - Handles null, undefined, and malformed entries safely.
 */
export function formatAssignmentContextMismatch(mismatch: unknown): string | null {
  if (mismatch === null || mismatch === undefined) {
    return null;
  }

  if (typeof mismatch === "string") {
    const trimmed = mismatch.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof mismatch === "object") {
    const item = mismatch as Record<string, any>;
    if (typeof item.message === "string" && item.message.trim().length > 0) {
      return item.message.trim();
    }

    const typeStr = item.type ? String(item.type).replace(/_/g, " ").trim() : "Context mismatch";
    const expected =
      item.expected !== undefined && item.expected !== null && String(item.expected).trim().length > 0
        ? String(item.expected).trim()
        : null;
    const actual =
      item.actual !== undefined && item.actual !== null && String(item.actual).trim().length > 0
        ? String(item.actual).trim()
        : null;

    if (expected && actual) {
      return `${typeStr}: Expected "${expected}", but found "${actual}".`;
    }
    if (expected) {
      return `${typeStr}: Expected "${expected}".`;
    }
    if (actual) {
      return `${typeStr}: Found "${actual}".`;
    }
    if (item.type) {
      return typeStr;
    }
    return "Unspecified context mismatch";
  }

  const str = String(mismatch).trim();
  return str.length > 0 ? str : null;
}

export type ExtractedFields = {
  name?: string
  first_name?: string
  middle_name?: string
  last_name?: string
  suffix?: string
  lrn?: string
  grade_level?: string
  academic_level?: "Elementary" | "High School" | "Senior High School"
  selected_grade_level?: "Grade 11" | "Grade 12" | "Elementary" | "High School" | "Senior High School" | string
  school_year?: string
  school_name?: string
  school_id?: string
  birth_date?: string
  adviser?: string
  section?: string
  semester?: string
  track_strand?: string
  shs_track?: string
  sex?: string
  age?: string | number
  document_type?: string
  curriculum_id?: string
  source_form_version?: string
  grading_policy_version?: string
  grading_period_scheme?: GradingPeriodScheme
  grades?: GradeRecord[]
  general_average?: number
  precise_general_average?: number
  displayed_general_average?: number
  general_average_action_taken?: string
  shs_general_average_printed?: number
  sem1_raw_general_average?: number
  sem1_general_average?: number
  sem1_precise_general_average?: number
  sem1_displayed_general_average?: number
  sem1_subject_count?: number
  sem1_completeness?: "COMPLETE" | "INCOMPLETE" | "EMPTY"
  sem2_raw_general_average?: number
  sem2_general_average?: number
  sem2_precise_general_average?: number
  sem2_displayed_general_average?: number
  sem2_subject_count?: number
  sem2_completeness?: "COMPLETE" | "INCOMPLETE" | "EMPTY"
  attendance?: AttendanceRecord[]
  attendance_months?: string[]
  attendance_totals?: {
    computed_school_days?: number
    computed_days_present?: number
    computed_days_absent?: number
    printed_school_days?: number
    printed_days_present?: number
    printed_days_absent?: number
  }
  attendance_percentage?: number
  absence_percentage?: number
  attendance_risk_status?: "NORMAL" | "ATTENDANCE_WARNING" | "ATTENDANCE_REVIEW_REQUIRED" | "INCOMPLETE_ATTENDANCE_DATA"
  attendance_discrepancy_details?: string[]
  observed_values?: LearnersObservedValues
  learner_progress_achievement?: LearnerProgressAndAchievement
  grading_scale?: LearnerProgressAndAchievement | GradingScaleItem[]
  flags?: string[]
  assignment_context_mismatches?: AssignmentContextMismatch[]
  school_id_source?: "school_configuration" | "ocr" | "system_config" | "user_override"
  school_uuid?: string
  trusted_school_verified?: boolean
  ocr_extracted_school_id?: string
  [key: string]: any  // allow additional fields
}

export type OcrResult = {
  text: string
  fields: ExtractedFields
  confidence: number
  model: string
}


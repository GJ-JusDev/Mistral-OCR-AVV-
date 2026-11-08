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
  status: "Passed" | "Failed" | "Missing";
  needsVerification?: boolean;
  curriculum_id?: string;
  source_form_version?: string;
  grading_policy_version?: string;
};

export type AttendanceRecord = {
  label: string;
  values: string[];
};

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
  general_average_action_taken?: string
  shs_general_average_printed?: number
  attendance?: AttendanceRecord[]
  attendance_months?: string[]
  flags?: string[]
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


export type GradeRecord = {
  category?: string;
  subject: string;
  q1?: number;
  q2?: number;
  q3?: number;
  q4?: number;
  final?: number;
  status: "Passed" | "Failed" | "Missing";
  needsVerification?: boolean;
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
  lrn?: string
  grade_level?: string
  school_name?: string
  track_strand?: string
  sex?: string
  grades?: GradeRecord[]
  attendance?: AttendanceRecord[]
  attendance_months?: string[]
  [key: string]: any  // allow additional fields
}

export type OcrResult = {
  text: string
  fields: ExtractedFields
  confidence: number
  model: string
}


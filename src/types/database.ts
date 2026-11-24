import type { Database } from '@/lib/supabase/types'

export type Tables = Database['public']['Tables']
export type School = Tables['schools']['Row']
export type Student = Tables['students']['Row']
export type Document = Tables['documents']['Row']
export type ValidationResult = Tables['validation_results']['Row']
export type ReviewLog = Tables['review_logs']['Row']
export type SubjectGrade = Tables['subject_grades']['Row']
export type UserRoleRow = Tables['user_roles']['Row']
export type TeacherRegistryRow = Tables['school_teacher_registry']['Row']
export type ReviewDeletionRequest = Tables['review_deletion_requests']['Row']
export type TeacherAssignmentRow = Tables['teacher_assignments']['Row']
export type TeacherModulePolicyRow = Tables['teacher_module_policies']['Row']
export type StudentEnrollmentRow = Tables['student_enrollments']['Row']
export type StudentIdentityConflictRow = Tables['student_identity_conflicts']['Row']
export type TeacherAssignmentType = 'class_adviser' | 'subject_teacher'
export type TeacherAssignmentStatus = 'active' | 'inactive'

export type DocumentStatus = 'submitted' | 'extracted' | 'validated' | 'needs_review' | 'corrected' | 'approved' | 'rejected' | 'archived'
export type DeletionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'FAILED'
export type DocumentType = 'sf1' | 'sf2' | 'sf5' | 'sf9' | 'sf10' | 'birth_cert'
export type SupportedDocumentType = 'sf1' | 'sf2' | 'sf5' | 'sf9' | 'sf10' | 'birth_cert'

export type ShsSf5Variant = 'SF5A-SHS' | 'SF5B-SHS'

export interface Sf1RosterEntry {
  id: string
  document_id: string
  student_id: string | null
  school_id: string
  school_year: string
  grade_level: 'Grade 11' | 'Grade 12'
  section: string
  track: string
  strand: string
  semester: '1st Semester' | '2nd Semester'
  lrn: string
  last_name: string
  first_name: string
  middle_name?: string | null
  suffix?: string | null
  sex: 'M' | 'F'
  birth_date?: string | null
  age?: number | null
  mother_tongue?: string | null
  ip_community?: string | null
  religion?: string | null
  address_details?: Record<string, any>
  parents_details?: Record<string, any>
  guardian_details?: Record<string, any>
  remarks_indicator?: string | null
  row_index: number
  page_number: number
  bounding_box?: any
  ocr_confidence?: number | null
  review_status: 'NEEDS_REVIEW' | 'VERIFIED' | 'FLAGGED'
  created_at?: string
  updated_at?: string
}

export interface Sf2AttendanceEntry {
  id: string
  document_id: string
  student_id: string | null
  school_id: string
  school_year: string
  grade_level: 'Grade 11' | 'Grade 12'
  section: string
  track?: string | null
  strand?: string | null
  month: string
  lrn?: string | null
  learner_name: string
  total_school_days: number
  days_present: number
  days_absent: number
  days_tardy: number
  daily_grid: Array<{ day: number; status: 'PRESENT' | 'ABSENT' | 'TARDY' | 'UNKNOWN' | 'UNRECORDED'; raw_mark?: string }>
  remarks?: string | null
  row_index: number
  page_number: number
  bounding_box?: any
  ocr_confidence?: number | null
  review_status: 'NEEDS_REVIEW' | 'VERIFIED' | 'FLAGGED'
  created_at?: string
  updated_at?: string
}

export interface Sf5PromotionEntry {
  id: string
  document_id: string
  student_id: string | null
  school_id: string
  school_year: string
  grade_level: 'Grade 11' | 'Grade 12'
  section: string
  track: string
  strand: string
  semester: '1st Semester' | '2nd Semester' | 'Full Year'
  form_variant: ShsSf5Variant
  lrn: string
  learner_name: string
  general_average?: number | null
  action_taken: 'COMPLETE' | 'INCOMPLETE' | 'GRADUATING' | 'PENDING_DEFICIENCIES'
  proficiency_level?: 'DID_NOT_MEET_EXPECTATIONS' | 'FAIRLY_SATISFACTORY' | 'SATISFACTORY' | 'VERY_SATISFACTORY' | 'OUTSTANDING' | null
  incomplete_subjects?: Array<{ subject: string; final_grade?: number; remarks?: string }>
  row_index: number
  page_number: number
  bounding_box?: any
  ocr_confidence?: number | null
  review_status: 'NEEDS_REVIEW' | 'VERIFIED' | 'FLAGGED'
  created_at?: string
  updated_at?: string
}

export interface PsaIdentityRecord {
  id: string
  document_id: string
  student_id: string | null
  school_id: string
  registry_number?: string | null
  last_name: string
  first_name: string
  middle_name?: string | null
  sex: 'M' | 'F'
  birth_date: string
  birth_place?: Record<string, any>
  mother_maiden_name?: string | null
  father_name?: string | null
  parents_marriage_details?: Record<string, any>
  verification_status: 'PENDING' | 'VERIFIED' | 'FLAGGED_MISMATCH'
  conflict_notes?: string | null
  verified_by?: string | null
  verified_at?: string | null
  bounding_box?: any
  ocr_confidence?: number | null
  created_at?: string
  updated_at?: string
}

export type CrossDocumentValidationType =
  | 'PSA_SF1'
  | 'SF1_SF2'
  | 'SF1_SF5'
  | 'SF1_SF9'
  | 'SF9_SF10'
  | 'SF5_SF9'
  | 'SF5_SF10'
  | 'CONSOLIDATED_SHS'

export type CrossDocumentValidationStatus =
  | 'MATCH'
  | 'MISMATCH'
  | 'DISCREPANCIES_FOUND'
  | 'NEEDS_VERIFICATION'
  | 'NOT_APPLICABLE'
  | 'RESOLVED'

export interface CrossDocumentValidation {
  id: string
  student_id: string
  school_id: string
  school_year: string
  grade_level?: 'Grade 11' | 'Grade 12' | null
  semester?: '1st Semester' | '2nd Semester' | 'Full Year' | null
  validation_type: CrossDocumentValidationType
  source_doc1_id?: string | null
  source_doc2_id?: string | null
  comparison_results: Array<{
    field: string
    doc1_value?: any
    doc2_value?: any
    status: 'MATCH' | 'MISMATCH' | 'NEEDS_VERIFICATION' | 'MISSING_DATA' | 'NOT_APPLICABLE'
    notes?: string
  }>
  discrepancy_details: string[]
  status: CrossDocumentValidationStatus
  needs_human_review: boolean
  resolved_by?: string | null
  resolved_at?: string | null
  resolution_notes?: string | null
  created_at?: string
  updated_at?: string
}
export type StudentStatus = 'active' | 'inactive' | 'transferred'
export type ReviewAction = 'approve' | 'reject' | 'correct' | 'flag' | 'resubmit'
export type UserRole = 'admin' | 'teacher' | 'principal'
export type AccountStatus = 'Pending' | 'Approved' | 'Declined'
export type RegistryVerificationStatus = 'unverified' | 'verified' | 'inactive'
export type RegistryMatchStatus =
  | 'MATCHED'
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'REVIEW_REQUIRED'
  | 'DUPLICATE_CLAIM'
  | 'INACTIVE_REGISTRY_ENTRY'
  | 'PENDING'
export type ApprovalMethod = 'MANUAL_EARLY' | 'AUTOMATIC' | 'MANUAL_STANDARD'

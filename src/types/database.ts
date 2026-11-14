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

export type DocumentStatus = 'submitted' | 'extracted' | 'validated' | 'needs_review' | 'corrected' | 'approved' | 'rejected' | 'archived'
export type DeletionRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'FAILED'
export type DocumentType = 'sf9' | 'sf10' | 'school_id' | 'other'
export type SupportedDocumentType = 'sf9' | 'sf10'
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

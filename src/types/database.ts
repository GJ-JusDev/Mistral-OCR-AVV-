import type { Database } from '@/lib/supabase/types'

export type Tables = Database['public']['Tables']
export type School = Tables['schools']['Row']
export type Student = Tables['students']['Row']
export type Document = Tables['documents']['Row']
export type ValidationResult = Tables['validation_results']['Row']
export type ReviewLog = Tables['review_logs']['Row']
export type SubjectGrade = Tables['subject_grades']['Row']

export type DocumentStatus = 'submitted' | 'extracted' | 'validated' | 'needs_review' | 'corrected' | 'approved' | 'rejected'
export type DocumentType = 'sf9' | 'sf10' | 'school_id' | 'birth_cert' | 'other'
export type StudentStatus = 'active' | 'inactive' | 'transferred'
export type ReviewAction = 'approve' | 'reject' | 'correct' | 'flag' | 'resubmit'
export type UserRole = 'admin' | 'teacher' | 'principal'
export type AccountStatus = 'Pending' | 'Approved' | 'Declined'

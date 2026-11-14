export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      schools: {
        Row: {
          id: string
          name: string
          school_id: string | null
          division: string | null
          region: string | null
          is_active: boolean | null
          sshs_pilot_status: "unverified" | "pilot_verified" | "non_pilot_verified"
          sshs_pilot_reference: string | null
          school_calendar_type: "three_term" | "semester" | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          school_id?: string | null
          division?: string | null
          region?: string | null
          is_active?: boolean | null
          sshs_pilot_status?: "unverified" | "pilot_verified" | "non_pilot_verified"
          sshs_pilot_reference?: string | null
          school_calendar_type?: "three_term" | "semester" | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          school_id?: string | null
          division?: string | null
          region?: string | null
          is_active?: boolean | null
          sshs_pilot_status?: "unverified" | "pilot_verified" | "non_pilot_verified"
          sshs_pilot_reference?: string | null
          school_calendar_type?: "three_term" | "semester" | null
          created_at?: string | null
        }
        Relationships: any[]
      }
      students: {
        Row: {
          id: string
          lrn: string
          first_name: string
          middle_name: string | null
          last_name: string
          suffix: string | null
          birth_date: string | null
          sex: string | null
          grade_level: string | null
          school_id: string | null
          status: string | null
          overall_status: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          lrn: string
          first_name: string
          middle_name?: string | null
          last_name: string
          suffix?: string | null
          birth_date?: string | null
          sex?: string | null
          grade_level?: string | null
          school_id?: string | null
          status?: string | null
          overall_status?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          lrn?: string
          first_name?: string
          middle_name?: string | null
          last_name?: string
          suffix?: string | null
          birth_date?: string | null
          sex?: string | null
          grade_level?: string | null
          school_id?: string | null
          status?: string | null
          overall_status?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: any[]
      }
      documents: {
        Row: {
          id: string
          student_id: string | null
          school_id: string | null
          document_type: string
          image_url: string
          original_filename: string | null
          extracted_text: string | null
          extracted_fields: Json | null
          ocr_model: string | null
          ocr_confidence: number | null
          status: string
          uploaded_by: string | null
          school_year: string | null
          grade_level: string | null
          semester: string | null
          shs_track: string | null
          curriculum_id: string | null
          source_form_version: string | null
          grading_policy_version: string | null
          grading_period_scheme: "quarterly_semestral" | "three_term" | "quarterly" | null
          general_average_printed: number | null
          general_average_action_taken: string | null
          shs_general_average_printed: number | null
          storage_path: string | null
          reviewed_by: string | null
          last_operation_id: string | null
          archived_at: string | null
          archived_by: string | null
          deletion_request_id: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          student_id?: string | null
          school_id?: string | null
          document_type: string
          image_url: string
          original_filename?: string | null
          extracted_text?: string | null
          extracted_fields?: Json | null
          ocr_model?: string | null
          ocr_confidence?: number | null
          status?: string
          uploaded_by?: string | null
          school_year?: string | null
          grade_level?: string | null
          semester?: string | null
          shs_track?: string | null
          curriculum_id?: string | null
          source_form_version?: string | null
          grading_policy_version?: string | null
          grading_period_scheme?: "quarterly_semestral" | "three_term" | "quarterly" | null
          general_average_printed?: number | null
          general_average_action_taken?: string | null
          shs_general_average_printed?: number | null
          storage_path?: string | null
          reviewed_by?: string | null
          last_operation_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          deletion_request_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          student_id?: string | null
          school_id?: string | null
          document_type?: string
          image_url?: string
          original_filename?: string | null
          extracted_text?: string | null
          extracted_fields?: Json | null
          ocr_model?: string | null
          ocr_confidence?: number | null
          status?: string
          uploaded_by?: string | null
          school_year?: string | null
          grade_level?: string | null
          semester?: string | null
          shs_track?: string | null
          curriculum_id?: string | null
          source_form_version?: string | null
          grading_policy_version?: string | null
          grading_period_scheme?: "quarterly_semestral" | "three_term" | "quarterly" | null
          general_average_printed?: number | null
          general_average_action_taken?: string | null
          shs_general_average_printed?: number | null
          storage_path?: string | null
          reviewed_by?: string | null
          last_operation_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          deletion_request_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: any[]
      }
      validation_results: {
        Row: {
          id: string
          document_id: string
          rule_name: string
          field_name: string | null
          passed: boolean
          expected_value: string | null
          actual_value: string | null
          message: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          document_id: string
          rule_name: string
          field_name?: string | null
          passed: boolean
          expected_value?: string | null
          actual_value?: string | null
          message?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          document_id?: string
          rule_name?: string
          field_name?: string | null
          passed?: boolean
          expected_value?: string | null
          actual_value?: string | null
          message?: string | null
          created_at?: string | null
        }
        Relationships: any[]
      }
      review_logs: {
        Row: {
          id: string
          document_id: string
          action: string
          previous_status: string | null
          new_status: string | null
          corrections: Json | null
          comment: string | null
          reviewed_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          document_id: string
          action: string
          previous_status?: string | null
          new_status?: string | null
          corrections?: Json | null
          comment?: string | null
          reviewed_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          document_id?: string
          action?: string
          previous_status?: string | null
          new_status?: string | null
          corrections?: Json | null
          comment?: string | null
          reviewed_by?: string | null
          created_at?: string | null
        }
        Relationships: any[]
      }

      subject_grades: {
        Row: {
          id: string
          student_id: string | null
          document_id: string | null
          school_year: string | null
          grade_level: string | null
          semester: string | null
          source_section: string | null
          subject_track: string | null
          subject_category: string | null
          subject_code: string | null
          grading_period_scheme: "quarterly_semestral" | "three_term" | "quarterly" | null
          subject: string
          q1: number | null
          q2: number | null
          q3: number | null
          q4: number | null
          t1: number | null
          t2: number | null
          t3: number | null
          sem1_final_grade: number | null
          sem2_final_grade: number | null
          units: number | null
          failed_final_grade: number | null
          remedial_class_mark: number | null
          recomputed_final_grade: number | null
          remedial_sem1_recomputed: number | null
          remedial_sem2_recomputed: number | null
          final_grade: number | null
          action_taken: string | null
          remark: string | null
          status: string | null
          needs_verification: boolean | null
          curriculum_id: string | null
          source_form_version: string | null
          grading_policy_version: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          student_id?: string | null
          document_id?: string | null
          school_year?: string | null
          grade_level?: string | null
          semester?: string | null
          source_section?: string | null
          subject_track?: string | null
          subject_category?: string | null
          subject_code?: string | null
          grading_period_scheme?: "quarterly_semestral" | "three_term" | "quarterly" | null
          subject: string
          q1?: number | null
          q2?: number | null
          q3?: number | null
          q4?: number | null
          t1?: number | null
          t2?: number | null
          t3?: number | null
          sem1_final_grade?: number | null
          sem2_final_grade?: number | null
          units?: number | null
          failed_final_grade?: number | null
          remedial_class_mark?: number | null
          recomputed_final_grade?: number | null
          remedial_sem1_recomputed?: number | null
          remedial_sem2_recomputed?: number | null
          final_grade?: number | null
          action_taken?: string | null
          remark?: string | null
          status?: string | null
          needs_verification?: boolean | null
          curriculum_id?: string | null
          source_form_version?: string | null
          grading_policy_version?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          student_id?: string | null
          document_id?: string | null
          school_year?: string | null
          grade_level?: string | null
          semester?: string | null
          source_section?: string | null
          subject_track?: string | null
          subject_category?: string | null
          subject_code?: string | null
          grading_period_scheme?: "quarterly_semestral" | "three_term" | "quarterly" | null
          subject?: string | null
          q1?: number | null
          q2?: number | null
          q3?: number | null
          q4?: number | null
          t1?: number | null
          t2?: number | null
          t3?: number | null
          sem1_final_grade?: number | null
          sem2_final_grade?: number | null
          units?: number | null
          failed_final_grade?: number | null
          remedial_class_mark?: number | null
          recomputed_final_grade?: number | null
          remedial_sem1_recomputed?: number | null
          remedial_sem2_recomputed?: number | null
          final_grade?: number | null
          action_taken?: string | null
          remark?: string | null
          status?: string | null
          needs_verification?: boolean | null
          curriculum_id?: string | null
          source_form_version?: string | null
          grading_policy_version?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: any[]
      }

      user_roles: {
        Row: {
          id: string
          user_id: string
          role: string
          account_status: string
          school_id: string | null
          updated_by: string | null
          last_operation_id: string | null
          registration_timestamp: string | null
          review_eligibility_time: string | null
          registry_match_status: string | null
          matched_registry_id: string | null
          approval_method: string | null
          approval_reason: string | null
          decline_reason: string | null
          approved_by: string | null
          approved_at: string | null
          declined_by: string | null
          declined_at: string | null
          middle_name: string | null
          middle_initial: string | null
          has_no_middle_name: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          role: string
          account_status?: string
          school_id?: string | null
          updated_by?: string | null
          last_operation_id?: string | null
          registration_timestamp?: string | null
          review_eligibility_time?: string | null
          registry_match_status?: string | null
          matched_registry_id?: string | null
          approval_method?: string | null
          approval_reason?: string | null
          decline_reason?: string | null
          approved_by?: string | null
          approved_at?: string | null
          declined_by?: string | null
          declined_at?: string | null
          middle_name?: string | null
          middle_initial?: string | null
          has_no_middle_name?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          role?: string
          account_status?: string
          school_id?: string | null
          updated_by?: string | null
          last_operation_id?: string | null
          registration_timestamp?: string | null
          review_eligibility_time?: string | null
          registry_match_status?: string | null
          matched_registry_id?: string | null
          approval_method?: string | null
          approval_reason?: string | null
          decline_reason?: string | null
          approved_by?: string | null
          approved_at?: string | null
          declined_by?: string | null
          declined_at?: string | null
          middle_name?: string | null
          middle_initial?: string | null
          has_no_middle_name?: boolean | null
          created_at?: string | null
        }
        Relationships: any[]
      }
      school_teacher_registry: {
        Row: {
          id: string
          school_id: string
          first_name: string
          middle_initial: string | null
          last_name: string
          full_name_original: string | null
          verified_email: string | null
          verification_status: "unverified" | "verified" | "inactive"
          is_active: boolean
          linked_user_id: string | null
          verified_by: string | null
          verified_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          school_id: string
          first_name: string
          middle_initial?: string | null
          last_name: string
          full_name_original?: string | null
          verified_email?: string | null
          verification_status?: "unverified" | "verified" | "inactive"
          is_active?: boolean
          linked_user_id?: string | null
          verified_by?: string | null
          verified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          school_id?: string
          first_name?: string
          middle_initial?: string | null
          last_name?: string
          full_name_original?: string | null
          verified_email?: string | null
          verification_status?: "unverified" | "verified" | "inactive"
          is_active?: boolean
          linked_user_id?: string | null
          verified_by?: string | null
          verified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: any[]
      }
      review_deletion_requests: {
        Row: {
          id: string
          target_record_id: string
          requested_by: string
          requester_role: string
          requester_email: string | null
          school_id: string | null
          request_reason: string
          predefined_reason: string | null
          status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "FAILED"
          reviewed_by: string | null
          review_reason: string | null
          requested_at: string
          reviewed_at: string | null
          completed_at: string | null
          failure_details: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          target_record_id: string
          requested_by: string
          requester_role?: string
          requester_email?: string | null
          school_id?: string | null
          request_reason: string
          predefined_reason?: string | null
          status?: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "FAILED"
          reviewed_by?: string | null
          review_reason?: string | null
          requested_at?: string
          reviewed_at?: string | null
          completed_at?: string | null
          failure_details?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          target_record_id?: string
          requested_by?: string
          requester_role?: string
          requester_email?: string | null
          school_id?: string | null
          request_reason?: string
          predefined_reason?: string | null
          status?: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "FAILED"
          reviewed_by?: string | null
          review_reason?: string | null
          requested_at?: string
          reviewed_at?: string | null
          completed_at?: string | null
          failure_details?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: any[]
      }
      auth_logs: {
        Row: {
          id: string
          user_id: string
          action: string
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          action: string
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          action?: string
          created_at?: string | null
        }
        Relationships: any[]
      }
      academic_standing_history: {
        Row: {
          id: string
          student_id: string
          document_id: string | null
          school_year: string | null
          grade_level: string | null
          curriculum: string | null
          source_form_version: string | null
          grading_policy_version: string | null
          general_average_printed: number | null
          previous_status: string | null
          new_status: string
          decision_source: string
          confirmed_by: string | null
          confirmation_notes: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          student_id: string
          document_id?: string | null
          school_year?: string | null
          grade_level?: string | null
          curriculum?: string | null
          source_form_version?: string | null
          grading_policy_version?: string | null
          general_average_printed?: number | null
          previous_status?: string | null
          new_status: string
          decision_source: string
          confirmed_by?: string | null
          confirmation_notes?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          student_id?: string
          document_id?: string | null
          school_year?: string | null
          grade_level?: string | null
          curriculum?: string | null
          source_form_version?: string | null
          grading_policy_version?: string | null
          general_average_printed?: number | null
          previous_status?: string | null
          new_status?: string
          decision_source?: string
          confirmed_by?: string | null
          confirmation_notes?: string | null
          created_at?: string | null
        }
        Relationships: any[]
      }
      eligibility_approvals: {
        Row: {
          id: string
          student_id: string
          school_id: string | null
          grade_level: "Grade 11" | "Grade 12"
          school_year: string
          eligibility_type: "Grade 11 Progression" | "Grade 12 Graduation"
          status: "Eligible" | "Not Eligible" | "Needs Review"
          decision: "Approved" | "Not Approved" | "Pending"
          approved_by: string | null
          approved_at: string | null
          remarks: string | null
          last_operation_id: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          student_id: string
          school_id?: string | null
          grade_level: "Grade 11" | "Grade 12"
          school_year: string
          eligibility_type: "Grade 11 Progression" | "Grade 12 Graduation"
          status: "Eligible" | "Not Eligible" | "Needs Review"
          decision: "Approved" | "Not Approved" | "Pending"
          approved_by?: string | null
          approved_at?: string | null
          remarks?: string | null
          last_operation_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          student_id?: string
          school_id?: string | null
          grade_level?: "Grade 11" | "Grade 12"
          school_year?: string
          eligibility_type?: "Grade 11 Progression" | "Grade 12 Graduation"
          status?: "Eligible" | "Not Eligible" | "Needs Review"
          decision?: "Approved" | "Not Approved" | "Pending"
          approved_by?: string | null
          approved_at?: string | null
          remarks?: string | null
          last_operation_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: any[]
      }
      eligibility_audit_logs: {
        Row: {
          id: string
          approval_id: string | null
          student_id: string
          action: string
          previous_decision: string | null
          new_decision: string | null
          performed_by: string | null
          remarks: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          approval_id?: string | null
          student_id: string
          action: string
          previous_decision?: string | null
          new_decision?: string | null
          performed_by?: string | null
          remarks?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          approval_id?: string | null
          student_id?: string
          action?: string
          previous_decision?: string | null
          new_decision?: string | null
          performed_by?: string | null
          remarks?: string | null
          created_at?: string | null
        }
        Relationships: any[]
      }
      audit_logs: {
        Row: {
          id: string
          created_at: string
          transaction_id: number | null
          actor_user_id: string | null
          actor_email: string | null
          actor_role: string
          actor_school_id: string | null
          actor_school_name: string | null
          school_id: string | null
          category: string
          action: string
          target_type: string | null
          target_id: string | null
          target_label: string | null
          outcome: "SUCCESS" | "FAILURE" | "DENIED" | "WARNING"
          details: Json
          reason: string | null
          request_id: string | null
          ip_address: string | null
          user_agent: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          transaction_id?: number | null
          actor_user_id?: string | null
          actor_email?: string | null
          actor_role?: string
          actor_school_id?: string | null
          actor_school_name?: string | null
          school_id?: string | null
          category: string
          action: string
          target_type?: string | null
          target_id?: string | null
          target_label?: string | null
          outcome: "SUCCESS" | "FAILURE" | "DENIED" | "WARNING"
          details?: Json
          reason?: string | null
          request_id?: string | null
          ip_address?: string | null
          user_agent?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          transaction_id?: number | null
          actor_user_id?: string | null
          actor_email?: string | null
          actor_role?: string
          actor_school_id?: string | null
          actor_school_name?: string | null
          school_id?: string | null
          category?: string
          action?: string
          target_type?: string | null
          target_id?: string | null
          target_label?: string | null
          outcome?: "SUCCESS" | "FAILURE" | "DENIED" | "WARNING"
          details?: Json
          reason?: string | null
          request_id?: string | null
          ip_address?: string | null
          user_agent?: string | null
        }
        Relationships: any[]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      confirm_student_academic_standing: {
        Args: {
          p_student_id: string
          p_new_status: string
          p_school_year: string
          p_notes?: string | null
        }
        Returns: void
      }
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_principal: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_approved_teacher: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_approved_staff: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      can_approve_documents: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      get_auth_user_school_id: {
        Args: Record<PropertyKey, never>
        Returns: string | null
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

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
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          school_id?: string | null
          division?: string | null
          region?: string | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          school_id?: string | null
          division?: string | null
          region?: string | null
          is_active?: boolean | null
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
          subject: string
          q1: number | null
          q2: number | null
          q3: number | null
          q4: number | null
          final_grade: number | null
          status: string | null
          needs_verification: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          student_id?: string | null
          document_id?: string | null
          school_year?: string | null
          subject: string
          q1?: number | null
          q2?: number | null
          q3?: number | null
          q4?: number | null
          final_grade?: number | null
          status?: string | null
          needs_verification?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          student_id?: string | null
          document_id?: string | null
          school_year?: string | null
          subject?: string | null
          q1?: number | null
          q2?: number | null
          q3?: number | null
          q4?: number | null
          final_grade?: number | null
          status?: string | null
          needs_verification?: boolean | null
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
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          role: string
          account_status?: string
          school_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          role?: string
          account_status?: string
          school_id?: string | null
          created_at?: string | null
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
          previous_status?: string | null
          new_status?: string
          decision_source?: string
          confirmed_by?: string | null
          confirmation_notes?: string | null
          created_at?: string | null
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

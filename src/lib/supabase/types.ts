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
          created_at?: string | null
          updated_at?: string | null
        }
      }
      documents: {
        Row: {
          id: string
          student_id: string | null
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
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

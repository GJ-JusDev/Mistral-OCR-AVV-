-- ==============================================================================
-- MIGRATION 024: SENIOR HIGH SCHOOL CROSS-DOCUMENT VALIDATION ENGINE
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 500169
-- Academic Scope: Exclusively Senior High School (Grades 11 & 12)
-- ==============================================================================
-- Objectives:
--   1. Create public.cross_document_validations table to store pairwise cross-document
--      consistency outcomes across the 6 SHS document types:
--      - 'PSA_SF1': Civil Identity ↔ School Register Enrollment
--      - 'SF1_SF2': School Register Enrollment ↔ Daily Attendance Sheet
--      - 'SF1_SF5': School Register Enrollment ↔ Semester Promotion Status (SF5A/SF5B)
--      - 'SF1_SF9': School Register Enrollment ↔ Learner Report Card
--      - 'SF9_SF10': Learner Report Card ↔ Cumulative Permanent Academic Record
--      - 'SF5_SF9': SF5A Status & Deficiencies ↔ Report Card Semestral Grades
--      - 'SF5_SF10': SF5B Graduation Clearance ↔ Cumulative Permanent Record
--      - 'CONSOLIDATED_SHS': Overall 360° Senior High School Validation Certificate
--   2. Create public.field_extraction_traces table to record fine-grained
--      bounding-box coordinate provenance and OCR confidence per extracted field.
--   3. Add indexes and triggers for updated_at.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Create public.cross_document_validations Table
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cross_document_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    school_year TEXT NOT NULL,
    grade_level TEXT CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    semester TEXT CHECK (semester IN ('1st Semester', '2nd Semester', 'Full Year')),
    validation_type TEXT NOT NULL CHECK (validation_type IN (
        'PSA_SF1',
        'SF1_SF2',
        'SF1_SF5',
        'SF1_SF9',
        'SF9_SF10',
        'SF5_SF9',
        'SF5_SF10',
        'CONSOLIDATED_SHS'
    )),
    source_doc1_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
    source_doc2_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
    comparison_results JSONB NOT NULL DEFAULT '[]'::jsonb,
    discrepancy_details JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'NEEDS_VERIFICATION' CHECK (status IN (
        'MATCH',
        'MISMATCH',
        'DISCREPANCIES_FOUND',
        'NEEDS_VERIFICATION',
        'NOT_APPLICABLE',
        'RESOLVED'
    )),
    needs_human_review BOOLEAN NOT NULL DEFAULT false,
    resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cross_val_student_sy
    ON public.cross_document_validations (student_id, school_year);

CREATE INDEX IF NOT EXISTS idx_cross_val_school_status
    ON public.cross_document_validations (school_id, status);

CREATE INDEX IF NOT EXISTS idx_cross_val_type_status
    ON public.cross_document_validations (validation_type, status);

CREATE INDEX IF NOT EXISTS idx_cross_val_doc1
    ON public.cross_document_validations (source_doc1_id)
    WHERE source_doc1_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cross_val_doc2
    ON public.cross_document_validations (source_doc2_id)
    WHERE source_doc2_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. Create public.field_extraction_traces Table
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.field_extraction_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    source_table TEXT NOT NULL,
    record_id UUID NOT NULL,
    field_name TEXT NOT NULL,
    extracted_value TEXT,
    normalized_value TEXT,
    page_number INTEGER NOT NULL DEFAULT 1,
    bounding_box JSONB,
    ocr_provider TEXT NOT NULL CHECK (ocr_provider IN ('azure', 'mistral', 'manual')),
    ocr_confidence NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_traces_doc
    ON public.field_extraction_traces (document_id);

CREATE INDEX IF NOT EXISTS idx_field_traces_record
    ON public.field_extraction_traces (source_table, record_id);

-- ------------------------------------------------------------------------------
-- 3. Triggers for updated_at
-- ------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trigger_cross_document_validations_updated_at ON public.cross_document_validations;
CREATE TRIGGER trigger_cross_document_validations_updated_at
    BEFORE UPDATE ON public.cross_document_validations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;

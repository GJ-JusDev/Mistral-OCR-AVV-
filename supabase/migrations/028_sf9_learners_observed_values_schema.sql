-- ==============================================================================
-- MIGRATION 028 (PROPOSED — AWAITING USER APPROVAL PRIOR TO EXECUTION)
-- Description: Relational Schema for DepEd SF9-SHS Learners' Observed Values
--              and Learner Progress Achievement Legend.
--
-- In accordance with AVV System Safety Guidelines:
-- - This script is provided as a PROPOSED migration design only.
-- - DO NOT EXECUTE ON LIVE OR STAGING DATABASE WITHOUT USER APPROVAL.
-- - Active runtime currently persists all fields via documents.extracted_fields JSONB.
-- ==============================================================================

-- 1. Table: public.learner_observed_values
-- Persists individual quarterly behavior observations for each learner.
CREATE TABLE IF NOT EXISTS public.learner_observed_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE,
    lrn TEXT,
    school_year TEXT,
    grade_level TEXT,
    
    -- DepEd Core Value & Behavior Statement Metadata
    core_value TEXT NOT NULL CHECK (core_value IN ('Maka-Diyos', 'Makatao', 'Makakalikasan', 'Makabansa')),
    core_value_index SMALLINT NOT NULL CHECK (core_value_index BETWEEN 1 AND 4),
    behavior_statement TEXT NOT NULL,
    statement_id TEXT,
    
    -- Quarterly Observation Marks
    quarter TEXT NOT NULL CHECK (quarter IN ('Q1', 'Q2', 'Q3', 'Q4')),
    original_mark TEXT,
    normalized_rating TEXT CHECK (normalized_rating IS NULL OR normalized_rating IN ('AO', 'SO', 'RO', 'NO')),
    
    -- Provenance & Confidence
    ocr_confidence REAL,
    source_page SMALLINT DEFAULT 2,
    location TEXT,
    bounding_box REAL[],
    
    -- Teacher Verification Status & Audit Trail
    needs_verification BOOLEAN NOT NULL DEFAULT false,
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'corrected', 'flagged')),
    teacher_correction TEXT,
    verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Ensure exactly one observation per behavior statement per quarter per document
    CONSTRAINT uq_learner_observed_values_doc_statement_q UNIQUE (document_id, behavior_statement, quarter)
);

-- 2. Indexes for Fast Querying and Analytics
CREATE INDEX IF NOT EXISTS idx_lov_document_id ON public.learner_observed_values(document_id);
CREATE INDEX IF NOT EXISTS idx_lov_student_id ON public.learner_observed_values(student_id);
CREATE INDEX IF NOT EXISTS idx_lov_lrn ON public.learner_observed_values(lrn);
CREATE INDEX IF NOT EXISTS idx_lov_core_value ON public.learner_observed_values(core_value);
CREATE INDEX IF NOT EXISTS idx_lov_needs_verification ON public.learner_observed_values(needs_verification) WHERE needs_verification = true;

-- 3. Table: public.sf9_grading_scale_legends
-- Persists printed grading scale legends for SF9-SHS.
CREATE TABLE IF NOT EXISTS public.sf9_grading_scale_legends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    descriptor TEXT NOT NULL,
    grading_scale TEXT NOT NULL,
    remarks TEXT NOT NULL,
    source_page SMALLINT DEFAULT 2,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sf9_gsl_document_id ON public.sf9_grading_scale_legends(document_id);

-- 4. Row-Level Security (RLS) Policies
ALTER TABLE public.learner_observed_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sf9_grading_scale_legends ENABLE ROW LEVEL SECURITY;

-- Teachers can view observed values for documents in their assigned school/section
CREATE POLICY p_lov_select_teacher ON public.learner_observed_values
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = learner_observed_values.document_id
              AND (
                  d.uploaded_by = auth.uid()::text
                  OR public.is_admin()
                  OR EXISTS (
                      SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                        AND ur.school_id = d.school_id
                        AND ur.account_status = 'Approved'
                  )
              )
        )
    );

-- Teachers can update / correct unreadable marks on assigned documents
CREATE POLICY p_lov_update_teacher ON public.learner_observed_values
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = learner_observed_values.document_id
              AND (
                  d.uploaded_by = auth.uid()::text
                  OR public.is_admin()
                  OR EXISTS (
                      SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = auth.uid()
                        AND ur.school_id = d.school_id
                        AND ur.account_status = 'Approved'
                  )
              )
        )
    );

-- 5. Updated At Trigger
CREATE OR REPLACE FUNCTION public.update_lov_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lov_updated_at ON public.learner_observed_values;
CREATE TRIGGER trg_lov_updated_at
    BEFORE UPDATE ON public.learner_observed_values
    FOR EACH ROW
    EXECUTE FUNCTION public.update_lov_updated_at();

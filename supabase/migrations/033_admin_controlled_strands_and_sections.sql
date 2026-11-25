-- ==============================================================================
-- Migration 033: Admin-Controlled Strands and Sections + Registration Workflow Update
-- ==============================================================================
-- Purpose:
--   1. Create authoritative tables for school strands and sections under Admin control.
--   2. Configure initial Senior High School strands and section capacities:
--      - Humanities and Social Sciences (HUMSS): 2 sections (HUMSS 1, HUMSS 2)
--      - Computer System Servicing (CSS): 3 sections (CSS 1, CSS 2, CSS 3)
--      - Tourism: 2 sections (Tourism 1, Tourism 2)
--      Total: 7 initial sections.
--   3. Link requested advisory classes in user_roles and teacher_assignments to
--      authoritative school_strands and school_sections.
--   4. Relax legacy hardcoded strand check constraints so Admin can introduce and
--      manage strands dynamically.
--   5. Enforce Row Level Security (RLS) so only Admins can create/edit/toggle strands
--      and sections, while teachers and users can read active strands and sections.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- PART 1: School Strands Table
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_strands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_school_strands_school_name UNIQUE (school_id, name),
    CONSTRAINT uq_school_strands_school_code UNIQUE (school_id, code),
    CONSTRAINT chk_school_strands_name_nonempty CHECK (BTRIM(name) <> ''),
    CONSTRAINT chk_school_strands_code_nonempty CHECK (BTRIM(code) <> '')
);

CREATE INDEX IF NOT EXISTS idx_school_strands_school_active
    ON public.school_strands (school_id, is_active);

DROP TRIGGER IF EXISTS update_school_strands_updated_at ON public.school_strands;
CREATE TRIGGER update_school_strands_updated_at
    BEFORE UPDATE ON public.school_strands
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------------------------
-- PART 2: School Sections Table
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    strand_id UUID NOT NULL REFERENCES public.school_strands(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 40 CHECK (capacity >= 1),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_school_sections_strand_name UNIQUE (school_id, strand_id, name),
    CONSTRAINT chk_school_sections_name_nonempty CHECK (BTRIM(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_school_sections_strand_active
    ON public.school_sections (school_id, strand_id, is_active);

DROP TRIGGER IF EXISTS update_school_sections_updated_at ON public.school_sections;
CREATE TRIGGER update_school_sections_updated_at
    BEFORE UPDATE ON public.school_sections
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------------------------
-- PART 3: Link Advisory Columns in user_roles and teacher_assignments
-- ------------------------------------------------------------------------------

-- Drop legacy hardcoded strand check constraint if present to allow admin dynamic strands
ALTER TABLE public.user_roles
    DROP CONSTRAINT IF EXISTS chk_user_roles_requested_strand;

ALTER TABLE public.user_roles
    ADD COLUMN IF NOT EXISTS requested_strand_id UUID REFERENCES public.school_strands(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS requested_section_id UUID REFERENCES public.school_sections(id) ON DELETE SET NULL;

ALTER TABLE public.teacher_assignments
    ADD COLUMN IF NOT EXISTS strand_id UUID REFERENCES public.school_strands(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES public.school_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_roles_requested_strand_section
    ON public.user_roles (requested_strand_id, requested_section_id)
    WHERE requested_strand_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_strand_section
    ON public.teacher_assignments (strand_id, section_id)
    WHERE strand_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- PART 4: Row Level Security (RLS) Policies
-- ------------------------------------------------------------------------------

ALTER TABLE public.school_strands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_sections ENABLE ROW LEVEL SECURITY;

-- Strands policies
DROP POLICY IF EXISTS "Authorized read school_strands" ON public.school_strands;
DROP POLICY IF EXISTS "Admin insert school_strands" ON public.school_strands;
DROP POLICY IF EXISTS "Admin update school_strands" ON public.school_strands;
DROP POLICY IF EXISTS "Admin delete school_strands" ON public.school_strands;

CREATE POLICY "Authorized read school_strands" ON public.school_strands
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR is_active = TRUE
    );

CREATE POLICY "Admin insert school_strands" ON public.school_strands
    FOR INSERT WITH CHECK (
        public.is_admin()
        OR auth.role() = 'service_role'
    );

CREATE POLICY "Admin update school_strands" ON public.school_strands
    FOR UPDATE USING (
        public.is_admin()
        OR auth.role() = 'service_role'
    ) WITH CHECK (
        public.is_admin()
        OR auth.role() = 'service_role'
    );

CREATE POLICY "Admin delete school_strands" ON public.school_strands
    FOR DELETE USING (
        public.is_admin()
        OR auth.role() = 'service_role'
    );

-- Sections policies
DROP POLICY IF EXISTS "Authorized read school_sections" ON public.school_sections;
DROP POLICY IF EXISTS "Admin insert school_sections" ON public.school_sections;
DROP POLICY IF EXISTS "Admin update school_sections" ON public.school_sections;
DROP POLICY IF EXISTS "Admin delete school_sections" ON public.school_sections;

CREATE POLICY "Authorized read school_sections" ON public.school_sections
    FOR SELECT USING (
        public.is_admin()
        OR auth.role() = 'service_role'
        OR is_active = TRUE
    );

CREATE POLICY "Admin insert school_sections" ON public.school_sections
    FOR INSERT WITH CHECK (
        public.is_admin()
        OR auth.role() = 'service_role'
    );

CREATE POLICY "Admin update school_sections" ON public.school_sections
    FOR UPDATE USING (
        public.is_admin()
        OR auth.role() = 'service_role'
    ) WITH CHECK (
        public.is_admin()
        OR auth.role() = 'service_role'
    );

CREATE POLICY "Admin delete school_sections" ON public.school_sections
    FOR DELETE USING (
        public.is_admin()
        OR auth.role() = 'service_role'
    );

-- ------------------------------------------------------------------------------
-- PART 5: Initial School Configuration Seeding
-- ------------------------------------------------------------------------------
-- Initial configuration:
--   1. Humanities and Social Sciences (HUMSS) -> 2 sections (HUMSS 1, HUMSS 2)
--   2. Computer System Servicing (CSS) -> 3 sections (CSS 1, CSS 2, CSS 3)
--   3. Tourism -> 2 sections (Tourism 1, Tourism 2)
-- Total: 7 sections.

DO $$
DECLARE
    r_school RECORD;
    v_humss_id UUID;
    v_css_id UUID;
    v_tourism_id UUID;
BEGIN
    FOR r_school IN (SELECT id FROM public.schools) LOOP
        -- 1. HUMSS Strand
        INSERT INTO public.school_strands (school_id, name, code, description, is_active)
        VALUES (
            r_school.id,
            'Humanities and Social Sciences (HUMSS)',
            'HUMSS',
            'Senior High School Academic Track - Humanities and Social Sciences',
            TRUE
        )
        ON CONFLICT (school_id, code) DO UPDATE
        SET name = EXCLUDED.name,
            is_active = TRUE
        RETURNING id INTO v_humss_id;

        IF v_humss_id IS NULL THEN
            SELECT id INTO v_humss_id FROM public.school_strands WHERE school_id = r_school.id AND code = 'HUMSS';
        END IF;

        -- HUMSS Sections: HUMSS 1, HUMSS 2
        INSERT INTO public.school_sections (school_id, strand_id, name, capacity, is_active)
        VALUES
            (r_school.id, v_humss_id, 'HUMSS 1', 40, TRUE),
            (r_school.id, v_humss_id, 'HUMSS 2', 40, TRUE)
        ON CONFLICT (school_id, strand_id, name) DO NOTHING;

        -- 2. CSS Strand
        INSERT INTO public.school_strands (school_id, name, code, description, is_active)
        VALUES (
            r_school.id,
            'Computer System Servicing (CSS)',
            'CSS',
            'Senior High School TVL Track - Computer System Servicing',
            TRUE
        )
        ON CONFLICT (school_id, code) DO UPDATE
        SET name = EXCLUDED.name,
            is_active = TRUE
        RETURNING id INTO v_css_id;

        IF v_css_id IS NULL THEN
            SELECT id INTO v_css_id FROM public.school_strands WHERE school_id = r_school.id AND code = 'CSS';
        END IF;

        -- CSS Sections: CSS 1, CSS 2, CSS 3
        INSERT INTO public.school_sections (school_id, strand_id, name, capacity, is_active)
        VALUES
            (r_school.id, v_css_id, 'CSS 1', 40, TRUE),
            (r_school.id, v_css_id, 'CSS 2', 40, TRUE),
            (r_school.id, v_css_id, 'CSS 3', 40, TRUE)
        ON CONFLICT (school_id, strand_id, name) DO NOTHING;

        -- 3. Tourism Strand
        INSERT INTO public.school_strands (school_id, name, code, description, is_active)
        VALUES (
            r_school.id,
            'Tourism',
            'Tourism',
            'Senior High School TVL Track - Tourism Operations',
            TRUE
        )
        ON CONFLICT (school_id, code) DO UPDATE
        SET name = EXCLUDED.name,
            is_active = TRUE
        RETURNING id INTO v_tourism_id;

        IF v_tourism_id IS NULL THEN
            SELECT id INTO v_tourism_id FROM public.school_strands WHERE school_id = r_school.id AND code = 'Tourism';
        END IF;

        -- Tourism Sections: Tourism 1, Tourism 2
        INSERT INTO public.school_sections (school_id, strand_id, name, capacity, is_active)
        VALUES
            (r_school.id, v_tourism_id, 'Tourism 1', 40, TRUE),
            (r_school.id, v_tourism_id, 'Tourism 2', 40, TRUE)
        ON CONFLICT (school_id, strand_id, name) DO NOTHING;
    END LOOP;
END $$;

COMMIT;

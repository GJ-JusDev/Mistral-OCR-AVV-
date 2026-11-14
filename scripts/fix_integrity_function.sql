CREATE OR REPLACE FUNCTION public.enforce_teacher_assignment_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT := COALESCE(current_setting('role', true), '');
BEGIN
    -- Block non-admin JWT callers (even if somehow bypassing RLS)
    IF auth.uid() IS NOT NULL AND v_role <> 'service_role' AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can create or modify teacher assignments.';
    END IF;

    -- Verify teacher belongs to target school (when user_roles record exists)
    IF NOT EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = NEW.teacher_user_id
          AND ur.school_id = NEW.school_id
          AND ur.role::text = 'teacher'
    ) THEN
        RAISE EXCEPTION 'Invalid teacher assignment: target user must have role teacher in the specified school.';
    END IF;

    -- Normalize trimmed text columns cleanly
    NEW.school_year := REGEXP_REPLACE(BTRIM(NEW.school_year), '\s+', '', 'g');
    NEW.section := REGEXP_REPLACE(BTRIM(NEW.section), '\s+', ' ', 'g');
    IF NEW.strand_or_track IS NOT NULL THEN
        NEW.strand_or_track := NULLIF(REGEXP_REPLACE(BTRIM(NEW.strand_or_track), '\s+', ' ', 'g'), '');
    END IF;
    IF NEW.subject_taught IS NOT NULL THEN
        NEW.subject_taught := NULLIF(REGEXP_REPLACE(BTRIM(NEW.subject_taught), '\s+', ' ', 'g'), '');
    END IF;

    RETURN NEW;
END;
$$;

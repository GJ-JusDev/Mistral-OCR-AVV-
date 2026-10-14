-- Migration 007: Fix grades trigger to handle re-approvals and prevent duplicate grades
-- Description: Cleans up any existing subject_grades for the document before inserting new ones,
-- ensuring repeated approvals do not duplicate rows.

CREATE OR REPLACE FUNCTION process_approved_document()
RETURNS TRIGGER AS $$
DECLARE
    grade_record jsonb;
    has_failed boolean := false;
    has_needs_verification boolean := false;
    current_overall_status text;
BEGIN
    -- Only proceed if status is changing to 'approved'
    IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
        
        -- Make sure we have a student_id
        IF NEW.student_id IS NULL THEN
            RETURN NEW;
        END IF;

        -- Prevent duplicate grades on re-approval
        DELETE FROM subject_grades WHERE document_id = NEW.id;

        -- Check if grades exist
        IF NEW.extracted_fields ? 'grades' THEN
            -- Extract grades from JSON and insert into subject_grades
            FOR grade_record IN SELECT * FROM jsonb_array_elements(NEW.extracted_fields->'grades')
            LOOP
                INSERT INTO subject_grades (
                    student_id,
                    document_id,
                    subject,
                    q1, q2, q3, q4,
                    final_grade,
                    status,
                    needs_verification
                ) VALUES (
                    NEW.student_id,
                    NEW.id,
                    grade_record->>'subject',
                    (grade_record->>'q1')::numeric,
                    (grade_record->>'q2')::numeric,
                    (grade_record->>'q3')::numeric,
                    (grade_record->>'q4')::numeric,
                    (grade_record->>'final')::numeric,
                    grade_record->>'status',
                    COALESCE((grade_record->>'needsVerification')::boolean, false)
                );
                
                -- Check for overall status flags
                IF grade_record->>'status' = 'Failed' THEN
                    has_failed := true;
                END IF;
                IF COALESCE((grade_record->>'needsVerification')::boolean, false) = true THEN
                    has_needs_verification := true;
                END IF;
            END LOOP;

            -- Determine the overall status for the student
            IF has_failed THEN
                current_overall_status := 'Failed';
            ELSIF has_needs_verification THEN
                current_overall_status := 'Needs Verification';
            ELSE
                current_overall_status := 'Passed';
            END IF;

            -- Update the student's overall status
            UPDATE students
            SET overall_status = current_overall_status,
                updated_at = now()
            WHERE id = NEW.student_id;
        END IF;

    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger if needed
DROP TRIGGER IF EXISTS trigger_process_approved_document ON documents;
CREATE TRIGGER trigger_process_approved_document
    AFTER UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION process_approved_document();

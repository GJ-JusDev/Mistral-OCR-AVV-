-- 1. Modify students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS overall_status text DEFAULT 'Needs Verification' CHECK (overall_status IN ('Passed', 'Failed', 'Needs Verification'));

-- 2. Create subject_grades table
CREATE TABLE IF NOT EXISTS subject_grades (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid REFERENCES students(id) ON DELETE CASCADE,
    document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
    subject text NOT NULL,
    q1 numeric,
    q2 numeric,
    q3 numeric,
    q4 numeric,
    final_grade numeric,
    status text CHECK (status IN ('Passed', 'Failed', 'Missing')),
    needs_verification boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- trigger for subject_grades updated_at
CREATE TRIGGER update_subject_grades_updated_at
    BEFORE UPDATE ON subject_grades
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Indexes for querying
CREATE INDEX IF NOT EXISTS idx_subject_grades_student_id ON subject_grades(student_id);
CREATE INDEX IF NOT EXISTS idx_subject_grades_document_id ON subject_grades(document_id);

-- Enable RLS
ALTER TABLE subject_grades ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Enable read access for all users" ON subject_grades FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON subject_grades FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON subject_grades FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON subject_grades FOR DELETE USING (true);

-- 3. Function to process approved document
CREATE OR REPLACE FUNCTION process_approved_document()
RETURNS TRIGGER AS $$
DECLARE
    grade_record jsonb;
    has_failed boolean := false;
    has_needs_verification boolean := false;
    current_overall_status text;
BEGIN
    -- Only proceed if status is changing to 'approved'
    IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
        
        -- Make sure we have a student_id
        IF NEW.student_id IS NULL THEN
            RETURN NEW;
        END IF;

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

-- 4. Trigger on documents table
DROP TRIGGER IF EXISTS trigger_process_approved_document ON documents;
CREATE TRIGGER trigger_process_approved_document
    AFTER UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION process_approved_document();

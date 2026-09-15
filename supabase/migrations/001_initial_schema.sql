-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- schools table
CREATE TABLE IF NOT EXISTS schools (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    school_id text UNIQUE,
    division text,
    region text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- students table
CREATE TABLE IF NOT EXISTS students (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lrn text UNIQUE NOT NULL,
    first_name text NOT NULL,
    middle_name text,
    last_name text NOT NULL,
    suffix text,
    birth_date date,
    sex text CHECK (sex IN ('M', 'F')),
    grade_level text,
    school_id uuid REFERENCES schools(id) ON DELETE SET NULL,
    status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'transferred')),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- trigger for students updated_at
CREATE TRIGGER update_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- documents table
CREATE TABLE IF NOT EXISTS documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid REFERENCES students(id) ON DELETE SET NULL,
    document_type text NOT NULL CHECK (document_type IN ('sf9', 'sf10', 'school_id', 'birth_cert', 'other')),
    image_url text NOT NULL,
    original_filename text,
    extracted_text text,
    extracted_fields jsonb DEFAULT '{}',
    ocr_model text DEFAULT 'mistral-ocr-latest',
    ocr_confidence real,
    status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected')),
    uploaded_by text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- trigger for documents updated_at
CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- validation_results table
CREATE TABLE IF NOT EXISTS validation_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
    rule_name text NOT NULL,
    field_name text,
    passed boolean NOT NULL,
    expected_value text,
    actual_value text,
    message text,
    created_at timestamptz DEFAULT now()
);

-- review_logs table
CREATE TABLE IF NOT EXISTS review_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
    action text NOT NULL CHECK (action IN ('approve', 'reject', 'correct', 'flag', 'resubmit')),
    previous_status text,
    new_status text,
    corrections jsonb,
    comment text,
    reviewed_by text,
    created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_student_id ON documents(student_id);
CREATE INDEX IF NOT EXISTS idx_students_lrn ON students(lrn);
CREATE INDEX IF NOT EXISTS idx_validation_results_document_id ON validation_results(document_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_document_id ON review_logs(document_id);

-- Enable RLS
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_logs ENABLE ROW LEVEL SECURITY;

-- Permissive policies for now
CREATE POLICY "Enable read access for all users" ON schools FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON schools FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON schools FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON schools FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON students FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON students FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON students FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON students FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON documents FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON documents FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON documents FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON validation_results FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON validation_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON validation_results FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON validation_results FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON review_logs FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON review_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON review_logs FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON review_logs FOR DELETE USING (true);

-- Supabase Storage bucket creation for 'documents' bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Give public access to documents bucket" ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY "Give public upload access to documents bucket" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents');
CREATE POLICY "Give public update access to documents bucket" ON storage.objects FOR UPDATE USING (bucket_id = 'documents');
CREATE POLICY "Give public delete access to documents bucket" ON storage.objects FOR DELETE USING (bucket_id = 'documents');

-- Migration 012: Student Document Completeness, Original File Preservation, and Principal Eligibility Approval
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 300792
-- Scope: Senior High School (Grades 11 and 12)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- 1. Ensure storage_path column exists on documents table for complete original image storage
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_path text;
CREATE INDEX IF NOT EXISTS idx_documents_storage_path ON documents(storage_path);
CREATE INDEX IF NOT EXISTS idx_documents_student_type ON documents(student_id, document_type);

-- 2. Create eligibility_approvals table
CREATE TABLE IF NOT EXISTS eligibility_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
    grade_level TEXT NOT NULL CHECK (grade_level IN ('Grade 11', 'Grade 12')),
    school_year TEXT NOT NULL,
    eligibility_type TEXT NOT NULL CHECK (eligibility_type IN ('Grade 11 Progression', 'Grade 12 Graduation')),
    status TEXT NOT NULL CHECK (status IN ('Eligible', 'Not Eligible', 'Needs Review')),
    decision TEXT NOT NULL CHECK (decision IN ('Approved', 'Not Approved', 'Pending')),
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_student_eligibility_period UNIQUE (student_id, grade_level, school_year, eligibility_type)
);

CREATE INDEX IF NOT EXISTS idx_eligibility_approvals_student ON eligibility_approvals(student_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_approvals_decision ON eligibility_approvals(decision);
CREATE INDEX IF NOT EXISTS idx_eligibility_approvals_status ON eligibility_approvals(status);

-- 3. Create eligibility_audit_logs table for immutable auditability
CREATE TABLE IF NOT EXISTS eligibility_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id UUID REFERENCES eligibility_approvals(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    previous_decision TEXT,
    new_decision TEXT,
    performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eligibility_audit_student ON eligibility_audit_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_audit_approval ON eligibility_audit_logs(approval_id);

-- 4. Enable RLS
ALTER TABLE eligibility_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_audit_logs ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for eligibility_approvals
DROP POLICY IF EXISTS "Authenticated users view eligibility approvals" ON eligibility_approvals;
CREATE POLICY "Authenticated users view eligibility approvals"
ON eligibility_approvals FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Principals and Admins manage eligibility approvals" ON eligibility_approvals;
CREATE POLICY "Principals and Admins manage eligibility approvals"
ON eligibility_approvals FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.account_status = 'Approved'
      AND user_roles.role IN ('principal', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.account_status = 'Approved'
      AND user_roles.role IN ('principal', 'admin')
  )
);

-- 6. RLS Policies for eligibility_audit_logs
DROP POLICY IF EXISTS "Authenticated staff view eligibility audit logs" ON eligibility_audit_logs;
CREATE POLICY "Authenticated staff view eligibility audit logs"
ON eligibility_audit_logs FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Principals and Admins insert eligibility audit logs" ON eligibility_audit_logs;
CREATE POLICY "Principals and Admins insert eligibility audit logs"
ON eligibility_audit_logs FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.account_status = 'Approved'
      AND user_roles.role IN ('principal', 'admin')
  )
);

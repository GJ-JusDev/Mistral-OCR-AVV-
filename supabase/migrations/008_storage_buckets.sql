-- Migration 008: Supabase Storage Bucket and RLS Policies for Document Files
-- Description: Configures the 'documents' storage bucket with DepEd school form validation,
-- file size limits (10MB), supported MIME types, and secure access policies.

-- 1. Create or update the documents storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'documents',
    'documents',
    true,
    10485760, -- 10MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- 2. Storage RLS Policies
-- Allow public or authenticated read for document verification
DROP POLICY IF EXISTS "Public Read Documents Bucket" ON storage.objects;
CREATE POLICY "Public Read Documents Bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents');

-- Allow authenticated teachers and administrators to upload document images
DROP POLICY IF EXISTS "Authenticated Users Upload Documents" ON storage.objects;
CREATE POLICY "Authenticated Users Upload Documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'documents' AND auth.role() = 'authenticated');

-- Allow authorized users to update or delete uploaded documents
DROP POLICY IF EXISTS "Authenticated Users Manage Documents" ON storage.objects;
CREATE POLICY "Authenticated Users Manage Documents"
ON storage.objects FOR UPDATE
USING (bucket_id = 'documents' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated Users Delete Documents" ON storage.objects;
CREATE POLICY "Authenticated Users Delete Documents"
ON storage.objects FOR DELETE
USING (bucket_id = 'documents' AND auth.role() = 'authenticated');

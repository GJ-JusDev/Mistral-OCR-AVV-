-- Create a default admin user
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000', 
  gen_random_uuid(), 
  'authenticated', 
  'authenticated', 
  'admin@example.com', 
  crypt('Password123!', gen_salt('bf')), 
  now(), now(), now(), 
  '{"provider":"email","providers":["email"]}', 
  '{}', 
  now(), now(), '', '', '', ''
);

UPDATE public.user_roles 
SET role = 'admin' 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'admin@example.com');

-- Create a default teacher user
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000', 
  gen_random_uuid(), 
  'authenticated', 
  'authenticated', 
  'teacher@example.com', 
  crypt('Password123!', gen_salt('bf')), 
  now(), now(), now(), 
  '{"provider":"email","providers":["email"]}', 
  '{}', 
  now(), now(), '', '', '', ''
);
-- Create teacher_invites table
CREATE TABLE IF NOT EXISTS teacher_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    access_code text NOT NULL,
    created_at timestamptz DEFAULT now(),
    used boolean DEFAULT false
);

ALTER TABLE teacher_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage invites" ON teacher_invites
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
  
-- Allow anyone to read invites for validation during registration (or we can just query with service role)

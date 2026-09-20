-- Create default users (Admin and Teacher)
INSERT INTO auth.users (
  id, instance_id, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, 
  raw_user_meta_data, 
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'admin@example.com',
  crypt('Password123!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', 
  '{"first_name":"Admin","middle_name":"N/A","last_name":"N/A","name_extension":"","role":"Admin","account_status":"Approved"}', 
  now(), now(), '', '', '', ''
), (
  '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'teacher@example.com',
  crypt('Password123!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', 
  '{"first_name":"Teacher","middle_name":"A","last_name":"One","name_extension":"","role":"Teacher","prc":"1234567","account_status":"Approved"}', 
  now(), now(), '', '', '', ''
);

-- Ensure user_roles has the right mapping for backwards compatibility
UPDATE public.user_roles 
SET role = 'admin' 
WHERE user_id = '00000000-0000-0000-0000-000000000001';

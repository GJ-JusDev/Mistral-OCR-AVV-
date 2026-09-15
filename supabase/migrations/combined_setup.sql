-- 1. Create roles type
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'teacher');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  role user_role DEFAULT 'teacher' NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 3. Trigger to automatically create a user_roles entry when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'teacher');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to avoid errors, then recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 4. Enable RLS and Policies for user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own role" ON public.user_roles;
CREATE POLICY "Users can read own role" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 5. Create teacher_invites table
CREATE TABLE IF NOT EXISTS public.teacher_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    access_code text NOT NULL,
    created_at timestamptz DEFAULT now(),
    used boolean DEFAULT false
);

ALTER TABLE public.teacher_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage invites" ON public.teacher_invites;
CREATE POLICY "Admins can manage invites" ON public.teacher_invites
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- 6. Create a default admin user (only if they don't exist)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
) 
SELECT 
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
WHERE NOT EXISTS (
    SELECT 1 FROM auth.users WHERE email = 'admin@example.com'
);

-- 7. Make sure they are admin
UPDATE public.user_roles 
SET role = 'admin' 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'admin@example.com');

-- 8. Create a default teacher user (only if they don't exist)
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
)
SELECT 
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
WHERE NOT EXISTS (
    SELECT 1 FROM auth.users WHERE email = 'teacher@example.com'
);
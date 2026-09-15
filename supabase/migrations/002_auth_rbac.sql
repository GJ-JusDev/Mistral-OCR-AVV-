-- Create roles type
CREATE TYPE user_role AS ENUM ('admin', 'teacher');

-- Create user_roles table
CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  role user_role DEFAULT 'teacher' NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create auth_logs table
CREATE TABLE auth_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('login', 'logout')),
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_logs ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own role
CREATE POLICY "Users can read own role" ON user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can read all roles
CREATE POLICY "Admins can read all roles" ON user_roles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Admins can read auth logs
CREATE POLICY "Admins can read auth logs" ON auth_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Users can insert their own logs
CREATE POLICY "Users can insert own logs" ON auth_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Trigger to automatically create a user_roles entry when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Default everyone to 'teacher'. Admins can be manually updated in DB.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'teacher');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

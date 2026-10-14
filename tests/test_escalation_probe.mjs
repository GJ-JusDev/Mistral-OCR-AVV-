import { PGlite } from '@electric-sql/pglite';

async function testEscalation() {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, raw_user_meta_data jsonb);
    CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
    CREATE TABLE schools (id uuid PRIMARY KEY, school_id text UNIQUE, name text);
    CREATE TABLE user_roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid UNIQUE,
      role user_role DEFAULT 'teacher',
      account_status text DEFAULT 'Pending',
      school_id uuid
    );
    CREATE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT '11111111-1111-1111-1111-111111111111'::uuid $$ LANGUAGE sql;
    CREATE FUNCTION auth.role() RETURNS text AS $$ SELECT 'authenticated' $$ LANGUAGE sql;
  `);

  await db.exec(`
    -- Verified hardened logic from 009_step2_consolidated_schema_and_security.sql:
    CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS trigger AS $$
    BEGIN
      INSERT INTO public.user_roles (user_id, role, account_status, school_id)
      VALUES (new.id, 'teacher', 'Pending', NULL)
      ON CONFLICT (user_id) DO NOTHING;
      RETURN new;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

    CREATE OR REPLACE FUNCTION public.is_admin()
    RETURNS boolean AS $$
    BEGIN
      RETURN EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'admin' AND account_status = 'Approved'
      );
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `);

  // Probe 1: Attacker attempts to register with role = 'admin', account_status = 'Approved', school_id = 'a000...'
  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data)
    VALUES ('11111111-1111-1111-1111-111111111111', '{"role":"admin","account_status":"Approved","school_id":"a0000000-0000-0000-0000-000000000001"}');
  `);

  const { rows } = await db.query(`SELECT role, account_status, school_id FROM public.user_roles WHERE user_id = '11111111-1111-1111-1111-111111111111';`);
  console.log('Probe 1 (admin spoof) result:', rows[0]);

  const { rows: isAdminRows } = await db.query(`SELECT public.is_admin() AS is_admin;`);
  console.log('Is Attacker Admin?:', isAdminRows[0].is_admin);

  if (rows[0].role !== 'teacher' || rows[0].account_status !== 'Pending' || rows[0].school_id !== null || isAdminRows[0].is_admin !== false) {
    throw new Error('SECURITY VULNERABILITY DETECTED: Attacker was granted admin/approved status or school assignment!');
  }

  // Probe 2: Registrant attempts to claim role = 'principal' and school_id
  await db.exec(`
    INSERT INTO auth.users (id, raw_user_meta_data)
    VALUES ('22222222-2222-2222-2222-222222222222', '{"role":"principal","school_id":"a0000000-0000-0000-0000-000000000001"}');
  `);

  const { rows: pRows } = await db.query(`SELECT role, account_status, school_id FROM public.user_roles WHERE user_id = '22222222-2222-2222-2222-222222222222';`);
  console.log('Probe 2 (principal spoof) result:', pRows[0]);

  if (pRows[0].role !== 'teacher' || pRows[0].account_status !== 'Pending' || pRows[0].school_id !== null) {
    throw new Error('SECURITY VULNERABILITY DETECTED: Self-registration did not force teacher/Pending/no school!');
  }

  console.log('PASS: New registrations strictly receive teacher, Pending, and no school assignment.');
}

testEscalation().catch(console.error);

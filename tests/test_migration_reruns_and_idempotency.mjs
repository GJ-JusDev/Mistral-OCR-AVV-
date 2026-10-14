import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function setupSupabaseMocks(db) {
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

    CREATE SCHEMA IF NOT EXISTS auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb DEFAULT '{}',
      created_at timestamptz DEFAULT now()
    );
    GRANT ALL ON auth.users TO anon, authenticated, service_role;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    BEGIN
      RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    END;
    $$ LANGUAGE plpgsql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
    BEGIN
      RETURN COALESCE(current_setting('request.jwt.claim.role', true), 'anon');
    END;
    $$ LANGUAGE plpgsql STABLE;

    CREATE SCHEMA IF NOT EXISTS storage;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[],
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    GRANT ALL ON storage.buckets TO anon, authenticated, service_role;

    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text REFERENCES storage.buckets(id),
      name text NOT NULL,
      owner uuid,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      metadata jsonb DEFAULT '{}'
    );
    GRANT ALL ON storage.objects TO anon, authenticated, service_role;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    CREATE OR REPLACE FUNCTION storage.foldername(name text)
    RETURNS text[] AS $$
    BEGIN
      RETURN string_to_array(name, '/');
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
    GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
  `);
}

test('Migration 009 Rerun & Idempotency Audit', async (t) => {
  const db = new PGlite();
  await setupSupabaseMocks(db);

  // Apply baseline migrations
  let m001 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '001_initial_schema.sql'), 'utf8');
  m001 = m001.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- pgcrypto built-in');
  await db.exec(m001);
  const m002 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '002_auth_rbac.sql'), 'utf8');
  await db.exec(m002);

  const step1 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '009_step1_add_principal_enum.sql'), 'utf8');
  const step2 = fs.readFileSync(path.join(rootDir, 'supabase', 'migrations', '009_step2_consolidated_schema_and_security.sql'), 'utf8');

  await t.test('1. First Execution of Step 1 & Step 2', async () => {
    await db.exec(step1);
    await db.exec(step2);
    const sgCount = await db.query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'subject_grades'`);
    assert.equal(parseInt(sgCount.rows[0].count, 10), 1);
  });

  await t.test('2. Rerun of Step 1 (Idempotent Enum Addition)', async () => {
    // Should NOT throw "duplicate value" error because of IF NOT EXISTS
    await db.exec(step1);
    const enumVals = await db.query(`
      SELECT enumlabel FROM pg_enum 
      WHERE enumtypid = 'public.user_role'::regtype
    `);
    const labels = enumVals.rows.map(r => r.enumlabel);
    assert.ok(labels.includes('principal'));
  });

  await t.test('3. Rerun of Step 2 (Idempotent Schema & Security)', async () => {
    // Should NOT throw duplicate table, column, policy, or trigger errors
    await db.exec(step2);
    const sgCount = await db.query(`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'subject_grades'`);
    assert.equal(parseInt(sgCount.rows[0].count, 10), 1);
  });

  await t.test('4. Third Rerun with active data present', async () => {
    // Insert test user and school
    const uRes = await db.query(`INSERT INTO auth.users (email) VALUES ('rerun_test@example.com') RETURNING id`);
    const userId = uRes.rows[0].id;

    // Rerun Step 2 again to ensure active data is not dropped or corrupted
    await db.exec(step2);

    const userRole = await db.query(`SELECT * FROM public.user_roles WHERE user_id = $1`, [userId]);
    assert.equal(userRole.rows.length, 1);
    assert.equal(userRole.rows[0].role, 'teacher');
    assert.equal(userRole.rows[0].account_status, 'Pending');
  });
});

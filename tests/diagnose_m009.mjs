import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

async function checkM009Error() {
  const db = new PGlite();
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, created_at timestamptz DEFAULT now());
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ BEGIN RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; END; $$ LANGUAGE plpgsql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$ BEGIN RETURN COALESCE(current_setting('request.jwt.claim.role', true), 'anon'); END; $$ LANGUAGE plpgsql STABLE;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid);
    CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] AS $$ BEGIN RETURN string_to_array(name, '/'); END; $$ LANGUAGE plpgsql IMMUTABLE;
  `);

  let m001 = fs.readFileSync('supabase/migrations/001_initial_schema.sql', 'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- pgcrypto');
  await db.exec(m001);
  let m002 = fs.readFileSync('supabase/migrations/002_auth_rbac.sql', 'utf8');
  await db.exec(m002);

  const m009 = fs.readFileSync('supabase/migrations/009_consolidated_pending_migrations.sql', 'utf8');
  try {
    await db.exec(`BEGIN;\n` + m009 + `\nCOMMIT;`);
    console.log('M009 IN SINGLE TRANSACTION BLOCK: SUCCESS!');
  } catch (err) {
    console.error('M009 IN SINGLE TRANSACTION BLOCK FAILED:');
    console.error('Message:', err.message);
    console.error('Code:', err.code);
  }
}

checkM009Error();

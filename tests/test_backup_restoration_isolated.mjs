import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Setup mock Supabase schema (roles, auth.users, storage.buckets, storage.objects)
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
  `);
}

test('Gate 1 Verification: Test Backup Restoration in Isolated Staging', async (t) => {
  const db = new PGlite();
  await setupSupabaseMocks(db);

  const backupPath = path.resolve(rootDir, 'supabase', 'backups', 'production_pre_m009_backup_20261014.json');
  assert.ok(fs.existsSync(backupPath), 'Backup file must exist');
  const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  // 1. Apply baseline migrations 001 and 002
  let m001 = fs.readFileSync(path.resolve(rootDir, 'supabase', 'migrations', '001_initial_schema.sql'), 'utf8');
  m001 = m001.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '-- pgcrypto built-in');
  const m002 = fs.readFileSync(path.resolve(rootDir, 'supabase', 'migrations', '002_auth_rbac.sql'), 'utf8');
  await db.exec(m001);
  await db.exec(m002);

  await t.test('1. Foreign Key Constraint Barrier: user_roles requires auth.users rows', async () => {
    // Attempting to insert user_roles directly without restoring auth.users must fail FK check
    let fkFailed = false;
    try {
      const sampleRole = backupData.tables.user_roles.rows[0];
      await db.query(
        `INSERT INTO public.user_roles (id, user_id, role, created_at) VALUES ($1, $2, $3, $4)`,
        [sampleRole.id, sampleRole.user_id, sampleRole.role, sampleRole.created_at]
      );
    } catch (err) {
      fkFailed = true;
      assert.match(err.message, /foreign key|violates foreign key constraint/i);
    }
    assert.ok(fkFailed, 'Inserting user_roles without corresponding auth.users must be caught by FK constraint');
  });

  await t.test('2. Restoration of Auth Users Roster metadata', async () => {
    // To restore user_roles, auth.users must first be restored from usersRoster
    for (const u of backupData.usersRoster) {
      await db.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, raw_user_meta_data = EXCLUDED.raw_user_meta_data`,
        [u.id, u.email, JSON.stringify(u.user_metadata || {}), u.created_at]
      );
    }
    const authCount = await db.query(`SELECT COUNT(*) as count FROM auth.users`);
    assert.equal(parseInt(authCount.rows[0].count, 10), 4, 'All 4 auth users restored into auth.users');
  });

  await t.test('3. Restoration of Schools table', async () => {
    for (const s of backupData.tables.schools.rows) {
      await db.query(
        `INSERT INTO public.schools (id, school_id, name, is_active, created_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (school_id) DO UPDATE SET name = EXCLUDED.name`,
        [s.id, s.school_id, s.name, s.is_active, s.created_at]
      );
    }
    const schoolCount = await db.query(`SELECT COUNT(*) as count FROM public.schools`);
    assert.equal(parseInt(schoolCount.rows[0].count, 10), 1, 'TRIS school record restored');
  });

  await t.test('4. Restoration of User Roles table', async () => {
    for (const r of backupData.tables.user_roles.rows) {
      await db.query(
        `INSERT INTO public.user_roles (id, user_id, role, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO NOTHING`,
        [r.id, r.user_id, r.role, r.created_at]
      );
    }
    const roleCount = await db.query(`SELECT COUNT(*) as count FROM public.user_roles`);
    assert.equal(parseInt(roleCount.rows[0].count, 10), 4, 'All 4 user_roles restored');
  });

  await t.test('5. Restoration of Storage Buckets configuration', async () => {
    for (const b of backupData.storage.buckets) {
      await db.query(
        `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types`,
        [b.id, b.name, b.public, b.file_size_limit, b.allowed_mime_types, b.created_at, b.updated_at]
      );
    }
    const bucketRes = await db.query(`SELECT * FROM storage.buckets WHERE id = 'documents'`);
    assert.equal(bucketRes.rows.length, 1);
    assert.equal(bucketRes.rows[0].public, false);
    assert.equal(parseInt(bucketRes.rows[0].file_size_limit, 10), 10485760);
  });

  await t.test('6. Restoration of Auth Logs (32 rows)', async () => {
    for (const log of backupData.tables.auth_logs.rows) {
      await db.query(
        `INSERT INTO public.auth_logs (id, user_id, action, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [log.id, log.user_id, log.action, log.ip_address, log.created_at]
      );
    }
    const logCount = await db.query(`SELECT COUNT(*) as count FROM public.auth_logs`);
    assert.equal(parseInt(logCount.rows[0].count, 10), 32, 'All 32 auth_logs restored');
  });

  await t.test('7. Verification of Empty Tables in Snapshot', async () => {
    const emptyTables = ['students', 'documents', 'validation_results', 'review_logs'];
    for (const tbl of emptyTables) {
      const res = await db.query(`SELECT COUNT(*) as count FROM public.${tbl}`);
      assert.equal(parseInt(res.rows[0].count, 10), 0, `Table ${tbl} correctly has 0 rows matching backup`);
    }
  });

  await t.test('8. Integrity & Consistency Audit of Snapshot Data', async () => {
    // Check orphan user_roles (must be 0)
    const orphans = await db.query(`
      SELECT ur.* FROM public.user_roles ur 
      LEFT JOIN auth.users u ON ur.user_id = u.id 
      WHERE u.id IS NULL
    `);
    assert.equal(orphans.rows.length, 0, 'Zero orphan user_roles');

    // Check orphan auth_logs (must be 0)
    const orphanLogs = await db.query(`
      SELECT al.* FROM public.auth_logs al 
      LEFT JOIN auth.users u ON al.user_id = u.id 
      WHERE u.id IS NULL
    `);
    assert.equal(orphanLogs.rows.length, 0, 'Zero orphan auth_logs');
  });
});

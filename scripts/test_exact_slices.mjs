import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

async function testExactSlices() {
  const db = new PGlite();

  // Load production backup
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT '135baa53-7e1e-4c1f-b76a-f32a915b5f21'::uuid; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT 'authenticated'; $$ LANGUAGE sql STABLE;
  `);

  const backupSql = fs.readFileSync("backups/complete_production_backup_pre_014_015_2026-11-09T13-57-33-739Z.sql", "utf-8");
  await db.exec(backupSql);
  await db.exec(`ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;`);

  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf-8");
  const lines = sql014.split('\n');

  console.log("1. Executing Section 1 to 7 (lines 1 to 260)...");
  await db.exec(lines.slice(0, 260).join('\n'));
  console.log("   ✓ Section 1-7 OK");

  console.log("2. Executing Section 8.1 (lines 261 to 424)...");
  await db.exec(lines.slice(260, 424).join('\n'));
  console.log("   ✓ Section 8.1 OK");

  console.log("3. Executing Section 8.2 (lines 425 to 574)...");
  await db.exec(lines.slice(424, 574).join('\n'));
  console.log("   ✓ Section 8.2 OK");

  console.log("4. Executing Section 8.3 (lines 575 to 702)...");
  await db.exec(lines.slice(574, 702).join('\n'));
  console.log("   ✓ Section 8.3 OK");

  console.log("ALL SECTIONS EXECUTED SEPARATELY WITH ZERO ERRORS!");
}

testExactSlices().catch(console.error);

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Migration 033: Admin-Controlled Strands and Sections Suite", async (t) => {
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULL::UUID;
    $$ LANGUAGE sql;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT 'service_role';
    $$ LANGUAGE sql;

    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION public.is_admin()
    RETURNS BOOLEAN AS $$
      SELECT TRUE;
    $$ LANGUAGE sql;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY,
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      school_id UUID REFERENCES public.schools(id),
      role TEXT,
      account_status TEXT,
      requested_grade_level TEXT,
      requested_strand TEXT,
      requested_section TEXT,
      request_status TEXT,
      request_submitted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS public.teacher_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id),
      teacher_user_id UUID,
      school_year TEXT,
      grade_level TEXT,
      section TEXT,
      strand_or_track TEXT
    );

    INSERT INTO public.schools (id, school_id, name)
    VALUES ('a0000000-0000-0000-0000-000000000001', '500169', 'Taysan Resettlement Integrated School');
  `);

  const migration033Path = path.resolve(rootDir, "supabase", "migrations", "033_admin_controlled_strands_and_sections.sql");
  const migration033Sql = fs.readFileSync(migration033Path, "utf8");

  await t.test("1. Migration 033 executes cleanly on disposable database", async () => {
    await db.exec(migration033Sql);
  });

  await t.test("2. Initial Strands: Seeds exactly 3 strands (HUMSS, CSS, Tourism)", async () => {
    const res = await db.query(`SELECT name, code, is_active FROM public.school_strands ORDER BY code`);
    assert.strictEqual(res.rows.length, 3, "Must have exactly 3 initial strands");
    
    const codes = res.rows.map(r => r.code);
    assert.deepStrictEqual(codes.sort(), ["CSS", "HUMSS", "Tourism"].sort());
    
    for (const r of res.rows) {
      assert.strictEqual(r.is_active, true, `Strand ${r.code} must be active`);
    }
  });

  await t.test("3. Initial Sections: Seeds exactly 7 sections with automated names and capacity", async () => {
    const res = await db.query(`
      SELECT s.code as strand_code, sec.name as section_name, sec.capacity, sec.is_active
      FROM public.school_sections sec
      JOIN public.school_strands s ON sec.strand_id = s.id
      ORDER BY s.code, sec.name
    `);

    assert.strictEqual(res.rows.length, 7, "Must have exactly 7 initial sections");

    const sectionsByStrand = {};
    for (const row of res.rows) {
      if (!sectionsByStrand[row.strand_code]) sectionsByStrand[row.strand_code] = [];
      sectionsByStrand[row.strand_code].push(row.section_name);
      assert.strictEqual(row.capacity, 40, "Section capacity should default to 40");
      assert.strictEqual(row.is_active, true, "Section must be active");
    }

    assert.deepStrictEqual(sectionsByStrand["HUMSS"], ["HUMSS 1", "HUMSS 2"]);
    assert.deepStrictEqual(sectionsByStrand["CSS"], ["CSS 1", "CSS 2", "CSS 3"]);
    assert.deepStrictEqual(sectionsByStrand["Tourism"], ["Tourism 1", "Tourism 2"]);
  });

  await t.test("4. Constraints: Prevents duplicate section name within same strand", async () => {
    const humssRes = await db.query(`SELECT id FROM public.school_strands WHERE code = 'HUMSS'`);
    const humssId = humssRes.rows[0].id;

    await assert.rejects(
      async () => {
        await db.exec(`
          INSERT INTO public.school_sections (school_id, strand_id, name, capacity)
          VALUES ('a0000000-0000-0000-0000-000000000001', '${humssId}', 'HUMSS 1', 40);
        `);
      },
      /unique/i,
      "Should reject duplicate section name within same strand"
    );
  });
});

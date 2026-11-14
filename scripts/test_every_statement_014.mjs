import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

async function testEveryStatement() {
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

  // Partial state
  await db.exec(`ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;`);

  console.log("Testing sections of 014_admin_audit_logs.sql...");

  const sql014 = fs.readFileSync("supabase/migrations/014_admin_audit_logs.sql", "utf-8");

  // Test section 1: Table creation
  console.log("Section 1: Table & Column Alterations...");
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          transaction_id BIGINT DEFAULT txid_current(),
          actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
          actor_email TEXT,
          actor_role TEXT NOT NULL DEFAULT 'anonymous',
          actor_school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
          actor_school_name TEXT,
          school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
          category TEXT NOT NULL,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          target_label TEXT,
          outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED', 'WARNING')),
          details JSONB NOT NULL DEFAULT '{}'::jsonb,
          reason TEXT,
          request_id TEXT,
          ip_address TEXT,
          user_agent TEXT
      );
      ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS transaction_id BIGINT DEFAULT txid_current();
      ALTER TABLE public.user_roles 
          ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS last_operation_id TEXT;
      ALTER TABLE public.documents 
          ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS last_operation_id TEXT;
      DO $$
      BEGIN
          IF to_regclass('public.eligibility_approvals') IS NOT NULL THEN
              ALTER TABLE public.eligibility_approvals
                  ADD COLUMN IF NOT EXISTS last_operation_id TEXT;
          END IF;
      END $$;
    `);
    console.log("  ✓ Section 1 OK");
  } catch(e) {
    console.error("  ✗ Section 1 FAILED:", e.message);
  }

  // Test section 2: Indexes
  console.log("Section 2: Indexes...");
  try {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON public.audit_logs(category);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_outcome ON public.audit_logs(outcome);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_school ON public.audit_logs(actor_school_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_school ON public.audit_logs(school_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user ON public.audit_logs(actor_user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON public.audit_logs(request_id) WHERE request_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_audit_logs_txid ON public.audit_logs(transaction_id);
    `);
    console.log("  ✓ Section 2 OK");
  } catch(e) {
    console.error("  ✗ Section 2 FAILED:", e.message);
  }

  // Test section 3 & 4: RLS
  console.log("Section 3 & 4: RLS Policies...");
  try {
    await db.exec(`
      ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "Approved admins can view audit logs" ON public.audit_logs;
      CREATE POLICY "Approved admins can view audit logs"
      ON public.audit_logs FOR SELECT
      TO authenticated
      USING (
          EXISTS (
              SELECT 1 FROM public.user_roles ur
              WHERE ur.user_id = auth.uid()
                AND ur.role = 'admin'
                AND ur.account_status = 'Approved'
                AND (
                    ur.school_id IS NULL
                    OR (audit_logs.actor_school_id IS NULL AND audit_logs.school_id IS NULL)
                    OR ur.school_id = audit_logs.actor_school_id
                    OR ur.school_id = audit_logs.school_id
                )
          )
      );
      DROP POLICY IF EXISTS "Service role can view audit logs" ON public.audit_logs;
      CREATE POLICY "Service role can view audit logs" ON public.audit_logs FOR SELECT TO service_role USING (true);
      DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.audit_logs;
      CREATE POLICY "Service role can insert audit logs" ON public.audit_logs FOR INSERT TO service_role WITH CHECK (true);
    `);
    console.log("  ✓ Section 3 & 4 OK");
  } catch(e) {
    console.error("  ✗ Section 3 & 4 FAILED:", e.message);
  }

  // Test section 5: Immutability Trigger
  console.log("Section 5: Immutability Trigger...");
  try {
    await db.exec(`
      CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      BEGIN
          RAISE EXCEPTION 'audit_logs entries are immutable and cannot be updated or deleted.';
      END;
      $$;
      DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
      CREATE TRIGGER trg_audit_logs_immutable BEFORE UPDATE OR DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_modification();
    `);
    console.log("  ✓ Section 5 OK");
  } catch(e) {
    console.error("  ✗ Section 5 FAILED:", e.message);
  }

  // Test section 6: record_audit_event
  console.log("Section 6: record_audit_event function...");
  try {
    // Extract lines 144 to 234
    const fnLines = sql014.split('\n').slice(143, 234).join('\n');
    await db.exec(fnLines);
    console.log("  ✓ Section 6 OK");
  } catch(e) {
    console.error("  ✗ Section 6 FAILED:", e.message);
  }

  // Test section 7: Privileges
  console.log("Section 7: Privileges...");
  try {
    await db.exec(`
      REVOKE ALL ON public.audit_logs FROM PUBLIC, anon;
      GRANT SELECT ON public.audit_logs TO authenticated;
      GRANT ALL ON public.audit_logs TO service_role;
      REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon;
      REVOKE ALL ON FUNCTION public.record_audit_event FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION public.record_audit_event TO authenticated, service_role;
    `);
    console.log("  ✓ Section 7 OK");
  } catch(e) {
    console.error("  ✗ Section 7 FAILED:", e.message);
  }

  // Test section 8.1: user_roles trigger
  console.log("Section 8.1: user_roles transition trigger...");
  try {
    const fnLines = sql014.split('\n').slice(261, 437).join('\n');
    await db.exec(fnLines);
    console.log("  ✓ Section 8.1 OK");
  } catch(e) {
    console.error("  ✗ Section 8.1 FAILED:", e.message);
  }

  // Test section 8.2: documents trigger
  console.log("Section 8.2: documents transition trigger...");
  try {
    const fnLines = sql014.split('\n').slice(439, 573).join('\n');
    await db.exec(fnLines);
    console.log("  ✓ Section 8.2 OK");
  } catch(e) {
    console.error("  ✗ Section 8.2 FAILED:", e.message);
  }

  // Test section 8.3: eligibility trigger
  console.log("Section 8.3: eligibility transition trigger...");
  try {
    const fnLines = sql014.split('\n').slice(575, 702).join('\n');
    await db.exec(fnLines);
    console.log("  ✓ Section 8.3 OK");
  } catch(e) {
    console.error("  ✗ Section 8.3 FAILED:", e.message);
  }
}

testEveryStatement().catch(console.error);

import { PGlite } from "@electric-sql/pglite";

async function testSmallVerification() {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.schools (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.user_roles (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.documents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reviewed_by UUID);
  `);

  const smallVerify = `
    SELECT 
        'public.audit_logs' AS target,
        CASE WHEN to_regclass('public.audit_logs') IS NOT NULL THEN 'EXISTS (PASS)' ELSE 'MISSING (FAIL)' END AS status
    UNION ALL
    SELECT 
        'public.documents.last_operation_id',
        CASE WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'last_operation_id'
        ) THEN 'EXISTS (PASS)' ELSE 'MISSING (FAIL)' END
    UNION ALL
    SELECT 
        'public.user_roles.updated_by',
        CASE WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'updated_by'
        ) THEN 'EXISTS (PASS)' ELSE 'MISSING (FAIL)' END
    UNION ALL
    SELECT 
        'public.user_roles.last_operation_id',
        CASE WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'last_operation_id'
        ) THEN 'EXISTS (PASS)' ELSE 'MISSING (FAIL)' END;
  `;

  const resBefore = await db.query(smallVerify);
  console.log("Before 014:");
  console.table(resBefore.rows);

  // Now simulate adding the objects
  await db.exec(`
    CREATE TABLE public.audit_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    ALTER TABLE public.documents ADD COLUMN last_operation_id TEXT;
    ALTER TABLE public.user_roles ADD COLUMN updated_by UUID, ADD COLUMN last_operation_id TEXT;
  `);

  const resAfter = await db.query(smallVerify);
  console.log("After 014:");
  console.table(resAfter.rows);
}

testSmallVerification();

import { PGlite } from "@electric-sql/pglite";

async function testAlter() {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reviewed_by UUID REFERENCES auth.users(id) -- already exists!
    );
  `);

  console.log("Testing ALTER TABLE with reviewed_by already existing...");
  try {
    await db.exec(`
      ALTER TABLE public.documents 
        ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS last_operation_id TEXT;
    `);
    console.log("✓ SUCCESS: PostgreSQL handled IF NOT EXISTS cleanly on multi-column ADD!");
    const cols = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'documents';
    `);
    console.table(cols.rows);
  } catch(err) {
    console.error("✗ FAILED:", err);
  }
}

testAlter();

import { PGlite } from "@electric-sql/pglite";

async function testRevoke() {
  const db = new PGlite();
  await db.exec(`
    CREATE OR REPLACE FUNCTION public.foo(a text, b text) RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;
  `);

  console.log("Testing REVOKE without arguments on function foo(text, text)...");
  try {
    await db.exec(`
      REVOKE ALL ON FUNCTION public.foo FROM PUBLIC;
    `);
    console.log("REVOKE without arguments SUCCEEDED in PGlite!");
  } catch(err) {
    console.error("REVOKE without arguments FAILED in PGlite:", err.message);
  }
}

testRevoke();

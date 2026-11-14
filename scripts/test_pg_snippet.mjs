import { PGlite } from "@electric-sql/pglite";

async function test() {
  const db = new PGlite();
  try {
    await db.exec(`
      DO $$
      BEGIN
        CREATE OR REPLACE FUNCTION test_nested() RETURNS void AS $fn$
        BEGIN
          NULL;
        END;
        $fn$ LANGUAGE plpgsql;
      END $$;
    `);
    console.log("Nested CREATE FUNCTION inside DO succeeded!");
  } catch(err) {
    console.error("Nested CREATE FUNCTION inside DO FAILED:", err.message);
  }
}

test();

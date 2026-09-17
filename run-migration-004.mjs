import fs from 'fs';
import path from 'path';
import pkg from 'pg';
const { Client } = pkg;

async function runMigration() {
  const connectionString = "postgresql://postgres:jsIPkr5sTNTXnBHg@db.yhsmawyntabwghncqbqy.supabase.co:5432/postgres";
  
  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log("Connecting to Supabase...");
    await client.connect();
    console.log("Connected successfully.");

    const sqlPath = path.join(process.cwd(), 'supabase', 'migrations', '004_admin_rpc.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log("Executing SQL migration script...");
    await client.query(sql);
    console.log("Migration executed successfully. RPCs created!");

  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await client.end();
  }
}

runMigration();

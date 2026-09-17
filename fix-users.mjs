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

    const sql = `
      UPDATE auth.users 
      SET raw_user_meta_data = jsonb_build_object(
        'first_name', 'Admin',
        'middle_name', 'N/A',
        'last_name', 'N/A',
        'name_extension', '',
        'account_status', 'Approved'
      )
      WHERE email = 'admin@example.com';

      UPDATE auth.users 
      SET raw_user_meta_data = jsonb_build_object(
        'first_name', 'Teacher',
        'middle_name', 'T.',
        'last_name', 'Test',
        'name_extension', '',
        'lpt_info', '1234567',
        'account_status', 'Approved'
      )
      WHERE email = 'teacher@example.com';
    `;

    console.log("Executing SQL migration script...");
    await client.query(sql);
    console.log("Migration executed successfully. Users updated!");

  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await client.end();
  }
}

runMigration();

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const envPath = path.resolve(process.cwd(), '.env.local');
const envRaw = fs.readFileSync(envPath, 'utf8');
const envParsed = dotenv.parse(envRaw);

const supabaseUrl = (envParsed.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceKey = (envParsed.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function createBackup() {
  const timestamp = new Date().toISOString();
  console.log(`Starting production snapshot backup at ${timestamp}...`);

  const tables = [
    'schools',
    'students',
    'documents',
    'validation_results',
    'review_logs',
    'user_roles',
    'auth_logs',
    'subject_grades'
  ];

  const backupData = {
    metadata: {
      sourceUrl: supabaseUrl,
      timestamp,
      backupScope: 'Complete public schema tables + auth user metadata roster',
      tableList: tables
    },
    tables: {},
    storage: {},
    usersRoster: []
  };

  // 1. Export each table
  for (const table of tables) {
    try {
      const { data, error } = await adminClient.from(table).select('*');
      if (error) {
        backupData.tables[table] = { status: 'ERROR', error: error.message, count: 0, rows: [] };
      } else {
        backupData.tables[table] = { status: 'OK', count: data.length, rows: data };
      }
    } catch (err) {
      backupData.tables[table] = { status: 'EXCEPTION', error: err.message, count: 0, rows: [] };
    }
  }

  // 2. Export Storage Buckets configuration
  try {
    const { data: buckets, error: bErr } = await adminClient.storage.listBuckets();
    backupData.storage.buckets = bErr ? { error: bErr.message } : buckets;
  } catch (err) {
    backupData.storage.buckets = { error: err.message };
  }

  // 3. Export Auth User Roster (Safe metadata, zero password hashes)
  try {
    const { data: usersData, error: uErr } = await adminClient.auth.admin.listUsers();
    if (!uErr && usersData) {
      backupData.usersRoster = usersData.users.map(u => ({
        id: u.id,
        email: u.email,
        role: u.role,
        user_metadata: u.user_metadata,
        created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at
      }));
    }
  } catch (err) {
    backupData.usersRoster = [{ error: err.message }];
  }

  const backupDir = path.resolve(process.cwd(), 'supabase', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFilename = 'production_pre_m009_backup_20261014.json';
  const backupFilePath = path.join(backupDir, backupFilename);
  const backupJsonString = JSON.stringify(backupData, null, 2);

  fs.writeFileSync(backupFilePath, backupJsonString, 'utf8');

  const sha256 = crypto.createHash('sha256').update(backupJsonString).digest('hex');

  console.log('\n=== PRODUCTION DATABASE SNAPSHOT CREATED ===');
  console.log('Location:', backupFilePath);
  console.log('Timestamp:', timestamp);
  console.log('SHA256 Checksum:', sha256);
  console.log('File Size:', fs.statSync(backupFilePath).size, 'bytes');
  console.log('\n--- Table Record Counts ---');
  for (const [t, info] of Object.entries(backupData.tables)) {
    console.log(`  Table [${t}]: ${info.count} records (${info.status})`);
  }
  console.log(`  Auth Users: ${backupData.usersRoster.length} users recorded`);
}

createBackup().catch(console.error);

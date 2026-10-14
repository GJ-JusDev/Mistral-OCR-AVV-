import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envRaw = fs.readFileSync(envPath, 'utf8');
const envParsed = dotenv.parse(envRaw);

const supabaseUrl = (envParsed.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceKey = (envParsed.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function auditMigrationsAndState() {
  console.log('=== AUDITING LIVE MIGRATION HISTORY & SCHEMA STATE ===');

  // 1. Try querying supabase_migrations schema if exposed via PostgREST
  const { data: migs, error: migErr } = await adminClient
    .schema('supabase_migrations')
    .from('schema_migrations')
    .select('*');

  if (migErr) {
    console.log('supabase_migrations schema query result:', migErr.message);
  } else {
    console.log('supabase_migrations records:', migs);
  }

  // 2. Check table columns for user_roles and documents to confirm if Migration 009 has run
  const { data: userRoleSample, error: urErr } = await adminClient
    .from('user_roles')
    .select('*')
    .limit(1);

  console.log('\nuser_roles sample row columns:', userRoleSample ? Object.keys(userRoleSample[0] || {}) : 'NONE');

  const { data: docSample, error: docErr } = await adminClient
    .from('documents')
    .select('*')
    .limit(1);

  console.log('documents sample row columns:', docSample ? Object.keys(docSample[0] || {}) : 'NONE');

  // 3. Check if subject_grades exists in public schema
  const { data: sgSample, error: sgErr } = await adminClient
    .from('subject_grades')
    .select('*')
    .limit(1);

  if (sgErr) {
    console.log('subject_grades table query:', sgErr.message);
  } else {
    console.log('subject_grades table exists! Rows:', sgSample.length);
  }

  // 4. Check schools
  const { data: schools } = await adminClient.from('schools').select('*');
  console.log('\nLive Schools:', schools);

  // 5. Check user_roles
  const { data: roles } = await adminClient.from('user_roles').select('*');
  console.log('\nLive User Roles count:', roles?.length);
  console.log(roles);
}

auditMigrationsAndState().catch(console.error);

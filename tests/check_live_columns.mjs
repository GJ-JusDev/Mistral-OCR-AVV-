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

async function checkDocumentsTable() {
  // Query 1 document or check insert error to see schema
  const { data, error } = await adminClient.from('documents').select('school_id').limit(1);
  console.log('select school_id from documents:', error ? error.message : 'SUCCESS, column exists!');

  const { data: stData, error: stErr } = await adminClient.from('students').select('overall_status').limit(1);
  console.log('select overall_status from students:', stErr ? stErr.message : 'SUCCESS, column exists!');
}

checkDocumentsTable().catch(console.error);

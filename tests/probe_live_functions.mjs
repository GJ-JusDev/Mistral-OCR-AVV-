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

async function checkLiveFunctionsAndEnums() {
  console.log('--- Probing live DB functions and enum ---');

  // Probe is_admin RPC
  const { data: adminRes, error: adminErr } = await adminClient.rpc('is_admin');
  console.log('rpc is_admin:', adminErr ? adminErr.message : adminRes);

  // Probe is_principal RPC
  const { data: princRes, error: princErr } = await adminClient.rpc('is_principal');
  console.log('rpc is_principal:', princErr ? princErr.message : princRes);

  // Probe can_approve_documents RPC
  const { data: canApproveRes, error: canApproveErr } = await adminClient.rpc('can_approve_documents');
  console.log('rpc can_approve_documents:', canApproveErr ? canApproveErr.message : canApproveRes);

  // Probe get_auth_user_school_id RPC
  const { data: schoolRes, error: schoolErr } = await adminClient.rpc('get_auth_user_school_id');
  console.log('rpc get_auth_user_school_id:', schoolErr ? schoolErr.message : schoolRes);
}

checkLiveFunctionsAndEnums().catch(console.error);

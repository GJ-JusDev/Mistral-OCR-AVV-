import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envRaw = fs.readFileSync(envPath, 'utf8');
const envParsed = dotenv.parse(envRaw);

const supabaseUrl = (envParsed.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceKey = (envParsed.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const anonKey = (envParsed.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

async function inspectLive() {
  console.log('=== INSPECTING LIVE SUPABASE ENVIRONMENT ===');
  console.log('URL:', supabaseUrl);

  // 1. Check storage objects currently in documents bucket
  const { data: objects, error: objErr } = await adminClient.storage
    .from('documents')
    .list();
  console.log('\n--- Storage Objects in "documents" Bucket ---');
  if (objErr) {
    console.log('Error listing objects:', objErr.message);
  } else {
    console.log(`Found ${objects?.length || 0} objects in bucket root:`, objects);
  }

  // 2. Check if pg_policies is exposed or queryable via postgrest or rpc
  // Note: pg_catalog / information_schema are usually not exposed directly over PostgREST unless custom views/RPC exist.
  const { data: rpcPolicies, error: rpcErr } = await adminClient.rpc('get_policies');
  if (rpcErr) {
    console.log('\nRPC get_policies check:', rpcErr.message);
  } else {
    console.log('\nPolicies via RPC:', rpcPolicies);
  }

  // 3. Test RPCs created in the live database
  const rpcs = [
    'is_admin',
    'is_principal',
    'is_approved_teacher',
    'is_approved_staff',
    'get_auth_user_school_id',
    'can_approve_documents'
  ];

  console.log('\n--- Live RPC Availability & Default Return ---');
  for (const rpc of rpcs) {
    const { data, error } = await anonClient.rpc(rpc);
    console.log(`RPC [${rpc}]: result = ${data}, error = ${error ? error.message : 'none'}`);
  }

  // 4. Test actual live table operations with anonClient
  console.log('\n--- Live Anonymous RLS Enforcement ---');
  const tables = ['schools', 'students', 'documents', 'subject_grades', 'user_roles', 'review_logs', 'validation_results', 'auth_logs'];
  for (const tbl of tables) {
    // SELECT probe
    const { data: sData, error: sErr } = await anonClient.from(tbl).select('*').limit(1);
    // INSERT probe (should fail or return error)
    const { data: iData, error: iErr } = await anonClient.from(tbl).insert({}).select();
    
    console.log(`Table [${tbl}]: SELECT rows=${sData?.length || 0} (${sErr ? sErr.message : 'empty/blocked'}), INSERT error=${iErr ? iErr.message : 'allowed'}`);
  }

  // 5. Check if any storage policies can be probed via unauthenticated upload
  console.log('\n--- Live Storage Anonymous Upload Probe ---');
  const testBuffer = Buffer.from('test anonymous upload probe');
  const { data: upData, error: upErr } = await anonClient.storage
    .from('documents')
    .upload('probe_anon.txt', testBuffer);
  console.log('Anonymous Upload Result:', upErr ? `BLOCKED (${upErr.message})` : 'ALLOWED (SECURITY VULNERABILITY)');
}

inspectLive().catch(console.error);

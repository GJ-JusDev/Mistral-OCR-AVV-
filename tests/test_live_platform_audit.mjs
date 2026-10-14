import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Cleanly parse .env.local trimming any CRLF / carriage returns
const envPath = path.resolve(process.cwd(), '.env.local');
const envRaw = fs.readFileSync(envPath, 'utf8');
const envParsed = dotenv.parse(envRaw);

const supabaseUrl = (envParsed.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const anonKey = (envParsed.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const serviceKey = (envParsed.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

async function runAudit() {
  console.log('=== LIVE SUPABASE PLATFORM AUDIT ===');
  console.log('Target URL:', supabaseUrl);

  const results = {
    storage: {},
    databaseRls: {},
    userRoster: [],
    rpcs: {}
  };

  // 1. Storage Bucket Audit
  const { data: buckets, error: bErr } = await adminClient.storage.listBuckets();
  if (bErr) {
    results.storage.listError = bErr.message;
  } else {
    const docBucket = buckets.find(b => b.id === 'documents');
    results.storage.docBucket = docBucket ? {
      id: docBucket.id,
      name: docBucket.name,
      public: docBucket.public
    } : 'NOT_FOUND';
  }

  // Test public URL download behavior (must NOT be publicly accessible)
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/documents/non_existent_test_probe.pdf`;
  try {
    const res = await fetch(publicUrl);
    results.storage.publicProbeStatus = res.status; // Expected 400 or 404 with error message
    results.storage.publicProbeText = await res.text();
  } catch (err) {
    results.storage.publicProbeError = err.message;
  }

  // Test signed URL generation via service client
  try {
    const { data: signed, error: signErr } = await adminClient.storage
      .from('documents')
      .createSignedUrl('system_audit_probe.pdf', 60);
    results.storage.signedUrlCapability = signErr ? `ERROR: ${signErr.message}` : 'SUCCESS';
    results.storage.signedUrlExpiresIn = 60;
  } catch (err) {
    results.storage.signedUrlCapability = `EXCEPTION: ${err.message}`;
  }

  // 2. PostgREST Anonymous RLS Audit
  const tables = ['students', 'documents', 'schools', 'subject_grades', 'review_logs', 'user_roles', 'auth_logs', 'validation_results'];
  for (const table of tables) {
    const { data, error } = await anonClient.from(table).select('*').limit(3);
    results.databaseRls[table] = {
      accessibleRows: data ? data.length : 0,
      blocked: !data || data.length === 0,
      error: error ? error.message : null
    };
  }

  // 3. Live User Roster and School Affiliation Audit
  const { data: usersData, error: uErr } = await adminClient.auth.admin.listUsers();
  const { data: rolesData, error: rErr } = await adminClient.from('user_roles').select('*');

  if (usersData && rolesData) {
    const roleMap = new Map(rolesData.map(r => [r.user_id, r]));
    results.userRoster = usersData.users.map(u => {
      const r = roleMap.get(u.id);
      return {
        userId: u.id,
        email: u.email,
        authRole: u.role,
        dbRole: r?.role || 'NONE',
        accountStatus: r?.account_status || 'UNKNOWN',
        schoolId: r?.school_id || null,
        metadataStatus: u.user_metadata?.account_status || null,
        confirmedAt: u.email_confirmed_at
      };
    });
  }

  // 4. Schools in DB
  const { data: schoolsData } = await adminClient.from('schools').select('*');
  results.schools = schoolsData;

  console.log('\n--- 1. Storage Security ---');
  console.log('Documents Bucket:', results.storage.docBucket);
  console.log('Public Probe HTTP Status:', results.storage.publicProbeStatus);
  console.log('Signed URL Generation:', results.storage.signedUrlCapability);

  console.log('\n--- 2. Anonymous Access Control (PostgREST) ---');
  let allBlocked = true;
  for (const [tbl, stat] of Object.entries(results.databaseRls)) {
    console.log(`  Table [${tbl}]: rows accessible=${stat.accessibleRows}, error=${stat.error || 'none'}`);
    if (stat.accessibleRows > 0) allBlocked = false;
  }
  console.log('Anonymous PostgREST Access Completely Blocked:', allBlocked);

  console.log('\n--- 3. School Provisioning ---');
  console.log('Schools in DB:', results.schools);

  console.log('\n--- 4. Live User Accounts & Assignment Status ---');
  results.userRoster.forEach((u, i) => {
    console.log(`User ${i + 1}: ${u.email} | DB Role: ${u.dbRole} | Status: ${u.accountStatus} | School: ${u.schoolId || 'UNASSIGNED (NULL)'}`);
  });

  return results;
}

runAudit().catch(console.error);

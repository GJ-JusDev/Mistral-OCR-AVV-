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

async function verifyLiveMigration() {
  console.log('================================================================');
  console.log('AVV POST-MIGRATION 009 PRODUCTION VERIFICATION AUDIT');
  console.log('Target:', supabaseUrl);
  console.log('Timestamp:', new Date().toISOString());
  console.log('================================================================\n');

  const report = {};

  // 1. Verify academic_standing_history table exists and is accessible via adminClient
  console.log('--- 1. Checking public.academic_standing_history ---');
  const { data: ashData, error: ashErr } = await adminClient
    .from('academic_standing_history')
    .select('*')
    .limit(1);

  if (ashErr) {
    console.log('academic_standing_history check:', ashErr.message);
    report.academic_standing_history = { status: 'FAIL', error: ashErr.message };
  } else {
    console.log('academic_standing_history table EXISTS! Rows found:', ashData.length);
    report.academic_standing_history = { status: 'PASS', rowCount: ashData.length };
  }

  // 2. Verify confirm_student_academic_standing RPC exists
  console.log('\n--- 2. Checking confirm_student_academic_standing RPC ---');
  // Call with non-existent student UUID from adminClient - if function exists, it should execute and fail on student not found or access
  const { data: rpcData, error: rpcErr } = await adminClient.rpc('confirm_student_academic_standing', {
    p_student_id: '00000000-0000-0000-0000-000000000000',
    p_new_status: 'Passed',
    p_school_year: '2025-2026',
    p_notes: 'Post-migration probe'
  });

  if (rpcErr) {
    console.log('confirm_student_academic_standing probe result:', rpcErr.message);
    if (rpcErr.message.includes('Could not find the function')) {
      report.confirm_student_academic_standing = { status: 'FAIL', error: rpcErr.message };
    } else {
      // It reached the function logic! (e.g., "Student not found" or "Access denied")
      console.log('confirm_student_academic_standing function EXISTS and executed PL/pgSQL logic!');
      report.confirm_student_academic_standing = { status: 'PASS', behavior: rpcErr.message };
    }
  } else {
    report.confirm_student_academic_standing = { status: 'PASS', result: rpcData };
  }

  // 3. Verify user_roles structure, principal enum, and school_id column
  console.log('\n--- 3. Checking user_roles table structure and columns ---');
  const { data: urData, error: urErr } = await adminClient
    .from('user_roles')
    .select('id, user_id, role, account_status, school_id, created_at')
    .limit(5);

  if (urErr) {
    console.log('user_roles select error:', urErr.message);
    report.user_roles = { status: 'FAIL', error: urErr.message };
  } else {
    console.log('user_roles columns verified successfully! Sample rows:', urData.length);
    report.user_roles = { status: 'PASS', sampleColumns: Object.keys(urData[0] || {}) };
  }

  // 4. Verify documents table school_id and status columns
  console.log('\n--- 4. Checking documents table structure and columns ---');
  const { data: docData, error: docErr } = await adminClient
    .from('documents')
    .select('id, school_id, status, student_id, uploaded_by, extracted_fields')
    .limit(1);

  if (docErr) {
    console.log('documents select error:', docErr.message);
    report.documents = { status: 'FAIL', error: docErr.message };
  } else {
    console.log('documents table school_id and structure verified!');
    report.documents = { status: 'PASS' };
  }

  // 5. Verify students table overall_status column
  console.log('\n--- 5. Checking students table overall_status column ---');
  const { data: stuData, error: stuErr } = await adminClient
    .from('students')
    .select('id, school_id, overall_status')
    .limit(1);

  if (stuErr) {
    console.log('students select error:', stuErr.message);
    report.students = { status: 'FAIL', error: stuErr.message };
  } else {
    console.log('students table overall_status verified!');
    report.students = { status: 'PASS' };
  }

  // 6. Verify subject_grades table exists and columns
  console.log('\n--- 6. Checking subject_grades table ---');
  const { data: sgData, error: sgErr } = await adminClient
    .from('subject_grades')
    .select('id, student_id, document_id, school_year, subject, q1, q2, q3, q4, final_grade, status, needs_verification')
    .limit(1);

  if (sgErr) {
    console.log('subject_grades select error:', sgErr.message);
    report.subject_grades = { status: 'FAIL', error: sgErr.message };
  } else {
    console.log('subject_grades table columns verified!');
    report.subject_grades = { status: 'PASS' };
  }

  // 7. Verify helper functions: is_admin, is_principal, is_approved_teacher, is_approved_staff, get_auth_user_school_id, can_approve_documents
  console.log('\n--- 7. Helper functions verification ---');
  const helpers = [
    'is_admin',
    'is_principal',
    'is_approved_teacher',
    'is_approved_staff',
    'get_auth_user_school_id',
    'can_approve_documents'
  ];
  report.helperFunctions = {};
  for (const h of helpers) {
    const { data, error } = await adminClient.rpc(h);
    if (error) {
      report.helperFunctions[h] = { status: 'FAIL', error: error.message };
    } else {
      report.helperFunctions[h] = { status: 'PASS', defaultReturnValue: data };
    }
    console.log(`Helper [${h}]: return = ${data}, error = ${error ? error.message : 'none'}`);
  }

  // 8. Anonymous access lockdown check (Security Barrier)
  console.log('\n--- 8. Anonymous PostgREST access barrier ---');
  report.anonymousAccess = {};
  const testTables = ['schools', 'students', 'documents', 'subject_grades', 'academic_standing_history', 'user_roles'];
  for (const t of testTables) {
    const { data, error } = await anonClient.from(t).select('*').limit(1);
    const blocked = data === null || data.length === 0;
    report.anonymousAccess[t] = {
      readBlocked: blocked,
      rowsExposed: data?.length || 0,
      error: error?.message || 'Empty set returned (RLS enforced)'
    };
    console.log(`Table [${t}] anon SELECT: exposed rows = ${data?.length || 0}`);
  }

  // 9. Storage Bucket verification
  console.log('\n--- 9. Storage Buckets & Policies ---');
  const { data: buckets, error: bErr } = await adminClient.storage.listBuckets();
  if (bErr) {
    report.storage = { status: 'FAIL', error: bErr.message };
  } else {
    report.storage = {
      status: 'PASS',
      buckets: buckets.map(b => ({
        id: b.id,
        name: b.name,
        public: b.public,
        file_size_limit: b.file_size_limit,
        allowed_mime_types: b.allowed_mime_types
      }))
    };
    console.log('Buckets:', report.storage.buckets);
  }

  // 10. Live User Roster Check (Read-Only)
  console.log('\n--- 10. Live User Roster & School Assignments (Read-Only) ---');
  const { data: usersData, error: uErr } = await adminClient.auth.admin.listUsers();
  const { data: rolesData, error: rErr } = await adminClient.from('user_roles').select('*');
  const { data: schoolsData } = await adminClient.from('schools').select('*');

  const schoolMap = new Map((schoolsData || []).map(s => [s.id, s.name]));
  const roleMap = new Map((rolesData || []).map(r => [r.user_id, r]));

  const roster = (usersData?.users || []).map(u => {
    const roleInfo = roleMap.get(u.id);
    return {
      id: u.id,
      email: u.email ? u.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : 'none',
      dbRole: roleInfo?.role || 'NONE',
      dbStatus: roleInfo?.account_status || 'NONE',
      dbSchoolId: roleInfo?.school_id || null,
      dbSchoolName: roleInfo?.school_id ? (schoolMap.get(roleInfo.school_id) || 'UNKNOWN') : 'UNASSIGNED',
      createdAt: u.created_at
    };
  });

  report.liveRoster = roster;
  console.log('Sanitized Live User Roster:');
  console.table(roster);

  console.log('\n================================================================');
  console.log('VERIFICATION AUDIT COMPLETE');
  console.log('================================================================');

  fs.writeFileSync(
    path.resolve(process.cwd(), 'tests', 'post_migration_live_audit_report.json'),
    JSON.stringify(report, null, 2)
  );
}

verifyLiveMigration().catch(console.error);

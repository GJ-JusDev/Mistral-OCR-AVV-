import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Parse .env.local without logging values
const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = envConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;

console.log('[1/4] Initializing Supabase client...');
const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false }
});

const anonClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false }
});

async function runLiveVerification() {
  const report = {
    auth: 'PENDING',
    database: 'PENDING',
    storage: 'PENDING',
    migrations: 'PENDING',
    details: {}
  };

  // 1. Auth Test
  try {
    const { data: users, error: authError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 5 });
    if (authError) {
      report.auth = `FAIL: ${authError.message}`;
    } else {
      report.auth = 'PASS';
      report.details.userCount = users.users.length;
    }
  } catch (err) {
    report.auth = `FAIL: ${err.message}`;
  }

  // 2. PostgreSQL Test
  try {
    const { data: schools, error: schoolErr } = await adminClient.from('schools').select('id, name, school_id').limit(3);
    const { data: students, error: studErr } = await adminClient.from('students').select('id, lrn, first_name, last_name, overall_status').limit(3);
    const { data: documents, error: docErr } = await adminClient.from('documents').select('id, document_type, status, image_url').limit(3);

    if (schoolErr || studErr || docErr) {
      report.database = `FAIL: ${schoolErr?.message || studErr?.message || docErr?.message}`;
    } else {
      report.database = 'PASS';
      report.details.schoolsSample = schools;
      report.details.studentsCount = students?.length || 0;
      report.details.documentsCount = documents?.length || 0;
    }
  } catch (err) {
    report.database = `FAIL: ${err.message}`;
  }

  // 3. Storage Test
  try {
    const { data: buckets, error: bucketErr } = await adminClient.storage.listBuckets();
    if (bucketErr) {
      report.storage = `FAIL: ${bucketErr.message}`;
    } else {
      report.storage = 'PASS';
      report.details.buckets = buckets.map(b => ({ id: b.id, name: b.name, public: b.public }));
    }
  } catch (err) {
    report.storage = `FAIL: ${err.message}`;
  }

  // 4. Migration & Trigger Check
  try {
    // Check if subject_grades exists and columns
    const { data: gradesSample, error: gradesErr } = await adminClient.from('subject_grades').select('id, student_id, document_id, subject, status').limit(1);
    const { data: reviewLogsSample, error: logsErr } = await adminClient.from('review_logs').select('id, action, document_id').limit(1);

    report.details.hasSubjectGrades = !gradesErr;
    report.details.hasReviewLogs = !logsErr;

    // Check if documents storage bucket exists
    const hasDocBucket = report.details.buckets?.some(b => b.id === 'documents');
    report.details.hasDocumentsStorageBucket = hasDocBucket;

    report.migrations = (!gradesErr && !logsErr) ? 'PASS' : 'PARTIAL';
  } catch (err) {
    report.migrations = `FAIL: ${err.message}`;
  }

  console.log('--- LIVE SUPABASE VERIFICATION REPORT ---');
  console.log('Auth:', report.auth);
  console.log('Database:', report.database);
  console.log('Storage:', report.storage);
  console.log('Migrations 005/006 Check:', report.migrations);
  console.log('Details:', JSON.stringify(report.details, null, 2));
}

runLiveVerification().catch(err => {
  console.error('Fatal live verification error:', err);
});

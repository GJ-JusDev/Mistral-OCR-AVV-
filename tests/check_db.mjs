import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local if present
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envRaw = fs.readFileSync(envPath, 'utf8');
  const envParsed = dotenv.parse(envRaw);
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || envParsed.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envParsed.SUPABASE_SERVICE_ROLE_KEY;
}

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Please configure these in your environment or .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log('Testing connection to Supabase...');
  const { data: schools, error: schoolErr } = await supabase.from('schools').select('id, name').limit(1);
  if (schoolErr) {
    console.error('School query error:', schoolErr);
  } else {
    console.log('Successfully connected! Schools found:', schools);
  }

  // Check storage buckets
  const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
  if (bucketErr) {
    console.error('Storage buckets error:', bucketErr);
  } else {
    console.log('Existing storage buckets:', buckets?.map(b => ({ name: b.name, public: b.public })));
  }

  // Check documents table sample
  const { data: docs, error: docErr } = await supabase.from('documents').select('id, status, document_type, student_id').limit(3);
  if (docErr) {
    console.error('Documents query error:', docErr);
  } else {
    console.log('Sample documents:', docs);
  }

  // Check subject_grades table sample
  const { data: grades, error: gradeErr } = await supabase.from('subject_grades').select('id, student_id').limit(3);
  if (gradeErr) {
    console.error('Subject grades query error:', gradeErr);
  } else {
    console.log('Sample grades:', grades);
  }

  // Check review_logs table sample
  const { data: logs, error: logErr } = await supabase.from('review_logs').select('id, action, document_id').limit(3);
  if (logErr) {
    console.error('Review logs query error:', logErr);
  } else {
    console.log('Sample review logs:', logs);
  }
}

check().catch(console.error);

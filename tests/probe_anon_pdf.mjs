import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envRaw = fs.readFileSync(envPath, 'utf8');
const envParsed = dotenv.parse(envRaw);

const supabaseUrl = (envParsed.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const anonKey = (envParsed.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

async function testPdfUpload() {
  console.log('Testing Anonymous PDF Upload to live documents bucket...');
  const fakePdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n%%EOF');
  const { data, error } = await anonClient.storage
    .from('documents')
    .upload('probe_anon.pdf', fakePdf, { contentType: 'application/pdf' });

  if (error) {
    console.log('Anonymous PDF Upload Result: BLOCKED with error ->', error.message);
  } else {
    console.log('CRITICAL: Anonymous PDF Upload SUCCEEDED ->', data);
  }
}

testPdfUpload().catch(console.error);

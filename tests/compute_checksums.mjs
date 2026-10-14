import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const files = [
  'supabase/migrations/009_step1_add_principal_enum.sql',
  'supabase/migrations/009_step2_consolidated_schema_and_security.sql',
  'supabase/migrations/009_rollback_recovery.sql'
];

console.log('=== EXACT DEPLOYMENT FILE INTEGRITY AUDIT ===');
for (const file of files) {
  const filePath = path.resolve(process.cwd(), file);
  const content = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const lines = content.toString('utf8').split(/\r\n|\r|\n/).length;
  console.log(`\nFile: ${file}`);
  console.log(`  Path: ${filePath}`);
  console.log(`  Bytes: ${content.length}`);
  console.log(`  Lines: ${lines}`);
  console.log(`  SHA256: ${sha256}`);
}

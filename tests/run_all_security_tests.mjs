import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const testFiles = [
  'tests/test_academic_standing_safety.mjs',
  'tests/test_real_postgres_staging.mjs',
  'tests/test_rollback_recovery.mjs',
  'tests/test_multi_school_isolation.mjs',
  'tests/test_escalation_probe.mjs',
  'tests/test_migration_reruns_and_idempotency.mjs',
  'tests/test_backup_restoration_isolated.mjs'
];

console.log('================================================================');
console.log('AVV MASTER STAGING SECURITY & REGRESSION VERIFICATION SUITE');
console.log('Target: PostgreSQL 18.6 WASM Engine (PGlite) & Local Application');
console.log('================================================================\n');

let totalPassed = 0;
let totalFailed = 0;

for (const tf of testFiles) {
  const fullPath = path.resolve(rootDir, tf);
  console.log(`▶ RUNNING: ${tf}...`);
  try {
    const output = execSync(`node "${fullPath}"`, { cwd: rootDir, encoding: 'utf8' });
    console.log(`✔ PASSED: ${tf}`);
    totalPassed++;
  } catch (err) {
    console.error(`✖ FAILED: ${tf}`);
    console.error(err.stdout || err.message);
    totalFailed++;
  }
}

console.log('\n================================================================');
console.log(`SUMMARY: ${totalPassed} suites passed, ${totalFailed} failed.`);
console.log('================================================================');

if (totalFailed > 0) {
  process.exit(1);
}

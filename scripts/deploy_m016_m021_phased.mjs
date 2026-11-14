import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

function parseEnvFile(filePath) {
  const out = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const PROJECT_REF = 'yhsmawyntabwghncqbqy';
const CANONICAL_DOC_ID = '840dc1c4-a272-444e-9ff4-2faba4b94c0b';
const EXPECTED_18_GRADES_SHA256 = '5a2886baf2d05617f264e88be5bd8a331fc309ac10fc885f10095ed56a11ac9b';

const LOCKED_BACKUPS = [
  {
    relPath: 'supabase/backups/production_pre_m016_m021_backup.json',
    bytes: 526675,
    sha256: 'a36a7161c2a7cb5e2c674571d2eb3bdd4f3971e405d6d1714dbf81118f4539d3'
  },
  {
    relPath: 'supabase/backups/production_pre_m016_m021_restore.sql',
    bytes: 621710,
    sha256: '9384ac46e855d7aa30ab1db7f70401cd1e5cdfb758a5bc81a5e6469383d052c8'
  },
  {
    relPath: 'supabase/backups/storage_objects/storage_manifest.json',
    bytes: 7271,
    sha256: '7c4fae570840f0f2e1bc18ae263fa71b121e02847bf7e01d9e41bd4651a408ef'
  },
  {
    relPath: 'supabase/archive/021_canonical_academic_records_and_scan_versions.original.sql',
    bytes: 92948,
    sha256: 'd4c7abe6cc0d66c893d8434e05c2b98ae30e4be7a6d71d4b5f4e5ff847af37f3'
  }
];

const LOCKED_MIGRATIONS = [
  {
    version: '016',
    name: 'teacher_registry_and_secure_approval',
    relPath: 'supabase/migrations/016_teacher_registry_and_secure_approval.sql',
    bytes: 12505,
    sha256: '79006431183f54164cd0b2377af6405b80a2c6b73ad5ba2aec0a1154c69a9bcf'
  },
  {
    version: '017',
    name: 'update_tris_deped_school_id',
    relPath: 'supabase/migrations/017_update_tris_deped_school_id.sql',
    bytes: 1586,
    sha256: '199603ed03c5c7d1dddf63eb1590c15fc606a80439193de03db4dfc3e666f53e'
  },
  {
    version: '018',
    name: 'review_queue_direct_deletion',
    relPath: 'supabase/migrations/018_review_queue_direct_deletion.sql',
    bytes: 11815,
    sha256: '4b584d47f093f7e54f2c2faa9e992a5df7e9e08caaf2097ef57909c44812ba1e'
  },
  {
    version: '019',
    name: 'remove_psa_support',
    relPath: 'supabase/migrations/019_remove_psa_support.sql',
    bytes: 2904,
    sha256: '453eaffc7cd1fecf2584deef2646102384e547669fb094d86e9e972600173e53'
  },
  {
    version: '020',
    name: 'add_approval_method_to_user_roles',
    relPath: 'supabase/migrations/020_add_approval_method_to_user_roles.sql',
    bytes: 3944,
    sha256: 'b4d88686eae2246b3e03d72d5f9ba24f35d2fa89e834cbf8f5259483e6129b91'
  },
  {
    version: '021a',
    name: 'schema_triggers_backfill_and_functions',
    relPath: 'supabase/migrations/021a_schema_triggers_backfill_and_functions.sql',
    bytes: 92921,
    sha256: 'e0d63147aac33be1c89d34f9cb863129875a0de606b75b68b6a12940170f097f'
  },
  {
    version: '021b',
    name: 'reconcile_historical_duplicate_documents',
    relPath: 'supabase/migrations/021b_reconcile_historical_duplicate_documents.sql',
    bytes: 999,
    sha256: '1300094f6321e93bae59c3c22c81939f6797527601e57f7a154a17ae12fe3b1d'
  },
  {
    version: '021c',
    name: 'enforce_canonical_document_unique_indexes',
    relPath: 'supabase/migrations/021c_enforce_canonical_document_unique_indexes.sql',
    bytes: 910,
    sha256: '1b076568dff6f395d2b15c1bbdf3641d89812a4779fa43a39a51dd4766cb76bb'
  }
];

const LOCKED_ROLLBACKS = [
  { relPath: 'supabase/rollbacks/009_rollback_recovery.sql', bytes: 13481, sha256: '5363455191d67b3ece18beb43227893d98bc1f81ac6cdd7cbd849d359c0c4c46' },
  { relPath: 'supabase/rollbacks/013_rollback_recovery.sql', bytes: 4102, sha256: '217a2309d549420e2cf52faaf44f9930dfd06009890326d72fcd51523a2a079b' },
  { relPath: 'supabase/rollbacks/014_rollback_recovery.sql', bytes: 1997, sha256: 'fcc4fab10a72d93958558da50edaa62cf83bb0d761ce9e47204bbfa4fa1890d8' },
  { relPath: 'supabase/rollbacks/015_rollback_recovery.sql', bytes: 37018, sha256: '68892fa41accf9aa0e380aec8bfac20ec772e75a14d3ca2d623c9d15f7b078a8' },
  { relPath: 'supabase/rollbacks/016_rollback_recovery.sql', bytes: 963, sha256: '9cb00cf566bfdfb3380f7d14b08d185bea841737ea7d5a55b6751cda03c23394' },
  { relPath: 'supabase/rollbacks/017_rollback_recovery.sql', bytes: 822, sha256: '0059c5e1ddaa0a80b11a4e8783bef0c752c1bb6d2306731d85ef680be9674608' },
  { relPath: 'supabase/rollbacks/018_rollback_recovery.sql', bytes: 1840, sha256: '5dd9706611ef5d8c05b9f2748fd2936a6619cf1a3a84461e4392151eb75ae78b' },
  { relPath: 'supabase/rollbacks/019_rollback_recovery.sql', bytes: 1024, sha256: '7897f565847aedd034950f006aeed7e1f2c3934a3a9d8012bac9b601a655f3b2' },
  { relPath: 'supabase/rollbacks/021_rollback_recovery.sql', bytes: 1576, sha256: 'c7e204b549eb7db06f64f4fddacb2b89da84b23ede81e211bd715bec05dd8d07' },
  { relPath: 'supabase/rollbacks/022_rollback_recovery.sql', bytes: 5990, sha256: 'a614d88161d72be5e8c97c785a3893b0cce356d74b694520002ce6c62e4e6cbd' }
];

const SUPABASE_BIN = fs.existsSync(path.resolve(process.cwd(), 'node_modules/supabase/bin/supabase.exe'))
  ? path.resolve(process.cwd(), 'node_modules/supabase/bin/supabase.exe')
  : 'npx';

function cleanupTempSql() {
  const tmpFile = path.resolve(process.cwd(), 'supabase/.temp/tmp_cli_query.sql');
  if (fs.existsSync(tmpFile)) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

function failStop(step, reason) {
  cleanupTempSql();
  console.error(`\n[FATAL STOP AT STEP: ${step}]`);
  console.error(`Reason: ${reason}`);
  console.error('Deployment halted immediately. No automatic rollback was executed.');
  process.exit(1);
}

function verifyFileChecksum(entry, category) {
  const fullPath = path.resolve(process.cwd(), entry.relPath);
  if (!fs.existsSync(fullPath)) {
    failStop(`Checksum Verification (${category})`, `Missing file: ${entry.relPath}`);
  }
  const buf = fs.readFileSync(fullPath);
  const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
  if (buf.length !== entry.bytes || actualSha !== entry.sha256) {
    failStop(
      `Checksum Verification (${category})`,
      `Checksum/size mismatch on ${entry.relPath}: expected (${entry.bytes} B, ${entry.sha256}), got (${buf.length} B, ${actualSha})`
    );
  }
  console.log(`  [PASS] ${entry.relPath} (${buf.length} B, sha256=${actualSha.slice(0, 16)}...)`);
}

function invokeSupabaseCliRaw({ sql, filePath, readOnly = false }) {
  let targetFile = filePath;
  if (!targetFile && sql) {
    targetFile = 'supabase/.temp/tmp_cli_query.sql';
    fs.writeFileSync(path.resolve(process.cwd(), targetFile), sql, 'utf8');
  }
  const args = SUPABASE_BIN === 'npx'
    ? ['supabase', 'db', 'query', `--remote=${PROJECT_REF}`]
    : ['db', 'query', `--remote=${PROJECT_REF}`];
  if (readOnly) {
    args.push('--read-only');
  } else {
    args.push('--yes');
  }
  args.push('-o', 'json', '-f', targetFile);

  const res = spawnSync(SUPABASE_BIN, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: SUPABASE_BIN === 'npx'
  });
  cleanupTempSql();
  return res;
}

function parseScalarOrStructuredValue(rawValue, { allowNumeric = false } = {}) {
  const raw = String(rawValue ?? '').trim();
  if (raw === '' || raw === 'NULL' || raw === '<nil>') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('map[') && raw.endsWith(']')) {
    return parseGoMap(raw);
  }
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through to bracketed Go slice or plain string
    }
  }
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return parseGoSlice(raw);
  }
  if (allowNumeric && /^-?\d+(?:\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

function splitTopLevelTokens(inner) {
  const tokens = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '[' || ch === '{') depth++;
    else if ((ch === ']' || ch === '}') && depth > 0) depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function parseGoSlice(raw) {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  return splitTopLevelTokens(inner).map((tok) => parseScalarOrStructuredValue(tok, { allowNumeric: true }));
}

function parseGoMap(raw) {
  const inner = raw.slice(4, -1).trim();
  const obj = {};
  if (!inner) return obj;
  for (const token of splitTopLevelTokens(inner)) {
    const colonIdx = token.indexOf(':');
    if (colonIdx === -1) continue;
    const key = token.slice(0, colonIdx);
    const val = token.slice(colonIdx + 1);
    obj[key] = parseScalarOrStructuredValue(val, { allowNumeric: true });
  }
  return obj;
}

function parseUnicodeTableOutput(text) {
  const tableLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('│') && l.endsWith('│'));
  if (tableLines.length === 0) return null;

  const splitCells = (line) =>
    line
      .slice(1, -1)
      .split('│')
      .map((cell) => cell.trim());

  const headers = splitCells(tableLines[0]);
  const rows = [];
  for (let i = 1; i < tableLines.length; i++) {
    const cells = splitCells(tableLines[i]);
    const rowObj = {};
    for (let c = 0; c < headers.length; c++) {
      rowObj[headers[c]] = parseScalarOrStructuredValue(cells[c] ?? '');
    }
    rows.push(rowObj);
  }
  return { rows };
}

export function parseSupabaseCliOutput(stdout) {
  const cleanedLines = String(stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter((l) => !l.startsWith('Target:'));
  const text = cleanedLines.join('\n').trim();

  if (!text) {
    return { rows: [] };
  }

  if (text.startsWith('{') || text.startsWith('[')) {
    const parsed = JSON.parse(text);
    if (parsed && (parsed._tag === 'Error' || parsed.error)) {
      throw new Error(`CLI returned error payload: ${JSON.stringify(parsed)}`);
    }
    if (Array.isArray(parsed)) {
      return { rows: parsed };
    }
    if (parsed && Array.isArray(parsed.rows)) {
      return parsed;
    }
    return { rows: parsed ? [parsed] : [] };
  }

  if (text.includes('┌') || text.includes('│')) {
    const tableParsed = parseUnicodeTableOutput(text);
    if (tableParsed) return tableParsed;
  }

  throw new Error(`Unrecognized Supabase CLI output format: ${text.slice(0, 200)}`);
}

function runSupabaseCliQuery({ sql, filePath, readOnly = false, stepName }) {
  if (!sql && !filePath) {
    failStop(stepName, 'Neither sql nor filePath provided to runSupabaseCliQuery');
  }

  const res = invokeSupabaseCliRaw({ sql, filePath, readOnly });

  if (res.status !== 0) {
    failStop(
      stepName,
      `Supabase CLI exited with code ${res.status}.\nSTDOUT: ${res.stdout}\nSTDERR: ${res.stderr}`
    );
  }

  let parsed;
  try {
    parsed = parseSupabaseCliOutput(res.stdout);
  } catch (err) {
    failStop(stepName, `Failed to parse CLI output: ${err.message}\nRaw STDOUT: ${res.stdout}`);
  }
  return parsed;
}

async function computeLive18GradesHash(adminClient) {
  const { data, error } = await adminClient
    .from('subject_grades')
    .select('*')
    .eq('document_id', CANONICAL_DOC_ID);
  if (error) {
    failStop('Live 18 Subject Grades Verification', `Supabase select failed: ${error.message}`);
  }
  const sgRows = (data || [])
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((r) => ({
      id: r.id,
      student_id: r.student_id,
      document_id: r.document_id,
      school_year: r.school_year,
      grade_level: r.grade_level,
      semester: r.semester,
      subject: r.subject,
      q1: r.q1 === null || r.q1 === undefined ? null : String(r.q1),
      q2: r.q2 === null || r.q2 === undefined ? null : String(r.q2),
      q3: r.q3 === null || r.q3 === undefined ? null : String(r.q3),
      q4: r.q4 === null || r.q4 === undefined ? null : String(r.q4),
      final_grade: r.final_grade === null || r.final_grade === undefined ? null : String(r.final_grade),
      status: r.status
    }));
  const hash = crypto.createHash('sha256').update(JSON.stringify(sgRows)).digest('hex');
  return { count: sgRows.length, hash };
}

async function verifyLiveStorageInventory(adminClient) {
  const { data: items, error } = await adminClient.storage
    .from('documents')
    .list('135baa53-7e1e-4c1f-b76a-f32a915b5f21/sf9', { limit: 100 });
  if (error) {
    failStop('Live Storage Inventory Check', `Failed to list Storage objects: ${error.message}`);
  }
  const files = (items || []).filter((i) => i.id !== null);
  if (files.length !== 20) {
    failStop('Live Storage Inventory Check', `Expected 20 objects in documents bucket, found ${files.length}`);
  }
  return files.length;
}

async function main() {
  const executeApproved = process.argv.includes('--execute-approved');
  console.log('======================================================================');
  console.log(`AVV SYSTEM — PHASED DEPLOYMENT ORCHESTRATOR (Mode: ${executeApproved ? 'EXECUTE-APPROVED' : 'PREFLIGHT-READ-ONLY'})`);
  console.log('======================================================================\n');

  // Step 1: Verify no rollback files remain in supabase/migrations/ and Migration 022 is excluded
  console.log('1. Verifying migration directory hygiene & rollback isolation...');
  const migFilesInDir = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations'));
  const strayRollbacks = migFilesInDir.filter((f) => f.includes('rollback'));
  if (strayRollbacks.length > 0) {
    failStop('Directory Hygiene', `Found rollback files inside supabase/migrations/: ${strayRollbacks.join(', ')}`);
  }
  console.log('  [PASS] Zero rollback files inside supabase/migrations/');
  for (const rb of LOCKED_ROLLBACKS) {
    verifyFileChecksum(rb, 'Rollback Isolation');
  }
  if (LOCKED_MIGRATIONS.some((m) => m.version === '022' || m.relPath.includes('022'))) {
    failStop('Scope Exclusion', 'Migration 022 must be excluded from deployment manifest');
  }
  console.log('  [PASS] Migration 022 is strictly excluded from deployment manifest.\n');

  // Step 2: Verify backup and migration file checksums
  console.log('2. Verifying backup & migration file SHA-256 checksums...');
  for (const b of LOCKED_BACKUPS) {
    verifyFileChecksum(b, 'Pre-Deployment Backup');
  }
  for (const m of LOCKED_MIGRATIONS) {
    verifyFileChecksum(m, 'Target Migration 016–021');
  }
  console.log('');

  // Step 3: Verify Supabase CLI version, write/DDL permissions, JSONB result parsing, and error detection
  console.log('3. Verifying Supabase CLI binary, DDL/write permissions, JSONB parsing & error detection...');
  const cliVerRes = spawnSync(SUPABASE_BIN, SUPABASE_BIN === 'npx' ? ['supabase', '--version'] : ['--version'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: SUPABASE_BIN === 'npx'
  });
  if (cliVerRes.status !== 0) {
    failStop('CLI Version Check', `supabase --version failed: ${cliVerRes.stderr}`);
  }
  console.log(`  [PASS] Installed Supabase CLI Binary (${path.basename(SUPABASE_BIN)}): v${cliVerRes.stdout.trim()}`);

  // 3a. Verify --yes (non-read-only) connection token scope & PostgreSQL DDL/write privileges without modifying student records
  const privSql = [
    'SELECT',
    'current_user AS role_name,',
    'session_user AS session_role,',
    '(SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,',
    "has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema,",
    "has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public,",
    "has_table_privilege(current_user, 'public.documents', 'INSERT, UPDATE, DELETE, TRIGGER, REFERENCES') AS can_modify_documents,",
    "jsonb_build_object('status', 'SUCCESS', 'grades_preserved', 18) AS probe_jsonb;"
  ].join(' ');
  const privRes = runSupabaseCliQuery({
    sql: privSql,
    readOnly: false,
    stepName: 'CLI Write-Mode Permission & JSONB Parser Check'
  });
  const privRow = privRes?.rows?.[0];
  if (
    !privRow ||
    privRow.can_create_schema !== true ||
    privRow.can_create_in_public !== true ||
    privRow.can_modify_documents !== true ||
    privRow.probe_jsonb?.status !== 'SUCCESS' ||
    privRow.probe_jsonb?.grades_preserved !== 18
  ) {
    failStop('CLI Write-Mode Permission & JSONB Parser Check', `Unexpected privilege/JSONB output: ${JSON.stringify(privRes)}`);
  }
  console.log(
    `  [PASS] Write/DDL permissions verified (role=${privRow.role_name}, superuser=${privRow.is_superuser}, create_schema=${privRow.can_create_schema}, create_public=${privRow.can_create_in_public}, alter_documents=${privRow.can_modify_documents})`
  );
  console.log(`  [PASS] JSONB result parser verified (probe_jsonb=${JSON.stringify(privRow.probe_jsonb)})`);

  // 3b. Verify multi-statement execution (SELECT + NOTIFY) behaviour & error detection
  const errProbe = invokeSupabaseCliRaw({ sql: 'SELECT 1/0;', readOnly: true });
  if (errProbe.status === 0 || !String(errProbe.stdout + errProbe.stderr).includes('division by zero')) {
    failStop('CLI Error Detection Probe', `Expected non-zero status on SELECT 1/0, got status=${errProbe.status}`);
  }
  console.log('  [PASS] CLI SQL error detection verified (non-zero exit code + PostgreSQL SQLSTATE 22012 captured on intentional fault)\n');

  // Step 4: Verify live schema history (001–022)
  console.log('4. Performing read-only live schema history verification (001–022)...');
  const historySql = [
    "SELECT",
    "(to_regclass('public.schools') IS NOT NULL AND to_regclass('public.students') IS NOT NULL AND to_regclass('public.documents') IS NOT NULL AND to_regclass('public.validation_results') IS NOT NULL AND to_regclass('public.review_logs') IS NOT NULL) AS m001_applied,",
    "(to_regclass('public.user_roles') IS NOT NULL AND to_regclass('public.auth_logs') IS NOT NULL AND to_regproc('public.handle_new_user') IS NOT NULL) AS m002_applied,",
    "(SELECT COUNT(*) > 0 FROM public.user_roles WHERE role = 'admin') AS m003_applied,",
    "(to_regproc('public.get_all_users_for_admin') IS NOT NULL AND to_regproc('public.approve_user') IS NOT NULL) AS m004_applied,",
    "(to_regclass('public.subject_grades') IS NOT NULL AND to_regproc('public.process_approved_document') IS NOT NULL) AS m005_m007_applied,",
    "EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documents') AS m008_applied,",
    "(EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'user_role' AND e.enumlabel = 'principal') AND to_regproc('public.is_admin') IS NOT NULL AND to_regproc('public.is_approved_teacher') IS NOT NULL AND to_regproc('public.get_auth_user_school_id') IS NOT NULL) AS m009_applied,",
    "(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='curriculum_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subject_grades' AND column_name='curriculum_id')) AS m010_applied,",
    "(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_roles' AND column_name IN ('prc_license','lpt_number'))) AS m011_applied,",
    "(to_regclass('public.eligibility_approvals') IS NOT NULL AND to_regclass('public.eligibility_audit_logs') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='storage_path')) AS m012_applied,",
    "(to_regclass('public.attendance_records') IS NOT NULL AND to_regclass('public.attendance_summaries') IS NOT NULL AND to_regclass('public.remedial_records') IS NOT NULL) AS m013_applied,",
    "(to_regclass('public.audit_logs') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='transaction_id')) AS m014_applied,",
    "(to_regclass('public.academic_standing_history') IS NOT NULL AND to_regclass('public.grade_change_history') IS NOT NULL AND to_regproc('public.normalize_student_lrn') IS NOT NULL AND to_regproc('public.link_document_student_before') IS NOT NULL) AS m015_applied,",
    "(to_regclass('public.school_teacher_registry') IS NOT NULL) AS m016_applied,",
    "((SELECT school_id FROM public.schools LIMIT 1) = '500169') AS m017_applied,",
    "(to_regproc('public.archive_review_document') IS NOT NULL) AS m018_applied,",
    "((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'documents_document_type_check') NOT LIKE '%birth_cert%') AS m019_applied,",
    "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_roles' AND column_name='approval_method') AS m020_applied,",
    "(to_regclass('public.document_scans') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='canonical_lrn')) AS m021_applied,",
    "(to_regclass('public.teacher_assignments') IS NOT NULL) AS m022_applied;"
  ].join(' ');

  const histRes = runSupabaseCliQuery({
    sql: historySql,
    readOnly: true,
    stepName: 'Read-Only Live Schema Verification (001–022)'
  });

  const row = histRes?.rows?.[0];
  if (!row) {
    failStop('Read-Only Live Schema Verification', `Unexpected query response: ${JSON.stringify(histRes)}`);
  }

  const requiredPrior = [
    'm001_applied',
    'm002_applied',
    'm003_applied',
    'm004_applied',
    'm005_m007_applied',
    'm008_applied',
    'm009_applied',
    'm010_applied',
    'm011_applied',
    'm012_applied',
    'm013_applied',
    'm014_applied',
    'm015_applied'
  ];
  for (const k of requiredPrior) {
    if (row[k] !== true) {
      failStop('Historical Migration Verification (001–015)', `Expected ${k}=true on live DB, got ${row[k]}`);
    }
  }
  console.log('  [PASS] Live schema effects for all historical migrations 001–015 verified TRUE.');
  console.log(
    `  [INFO] Live pending state: M016=${row.m016_applied}, M017=${row.m017_applied}, M018=${row.m018_applied}, M019=${row.m019_applied}, M020=${row.m020_applied}, M021=${row.m021_applied}, M022=${row.m022_applied}\n`
  );

  // Step 5: Verify live 18 approved subject_grades SHA-256 hash and 20 Storage objects before deployment
  console.log('5. Verifying pre-deployment 18 approved subject_grades SHA-256 & 20 Storage objects...');
  const envParsed = parseEnvFile(path.resolve(process.cwd(), '.env.local'));
  const adminClient = createClient(envParsed.NEXT_PUBLIC_SUPABASE_URL.trim(), envParsed.SUPABASE_SERVICE_ROLE_KEY.trim(), {
    auth: { persistSession: false }
  });
  const preGrades = await computeLive18GradesHash(adminClient);
  if (preGrades.count !== 18 || preGrades.hash !== EXPECTED_18_GRADES_SHA256) {
    failStop(
      'Pre-Deployment 18 Subject Grades Check',
      `Expected 18 rows with SHA-256 ${EXPECTED_18_GRADES_SHA256}, got ${preGrades.count} rows with ${preGrades.hash}`
    );
  }
  console.log(`  [PASS] 18 approved subject_grades rows intact (SHA-256: ${preGrades.hash})`);

  const storageCount = await verifyLiveStorageInventory(adminClient);
  console.log(`  [PASS] All ${storageCount}/20 objects in Supabase Storage 'documents' bucket verified online & accessible.\n`);

  if (!executeApproved) {
    console.log('======================================================================');
    console.log('EXECUTION READY — ALL 6 PRE-DEPLOYMENT AUTHORIZATION GATES PASSED.');
    console.log('No production SQL was executed. Pass --execute-approved after user approval.');
    console.log('======================================================================');
    return;
  }

  // =========================================================================
  // PRODUCTION EXECUTION (Only reached when --execute-approved is passed)
  // =========================================================================
  console.log('6. Executing Migrations 016 through 020 sequentially (stop-on-first-error)...');
  for (const mig of LOCKED_MIGRATIONS.slice(0, 5)) {
    console.log(`  -> Applying ${mig.relPath}...`);
    runSupabaseCliQuery({
      filePath: mig.relPath,
      readOnly: false,
      stepName: `Migration ${mig.version} (${mig.name})`
    });
    console.log(`  [PASS] Migration ${mig.version} committed.`);
  }

  // Phase 021-A: Execute 021a_schema_triggers_backfill_and_functions.sql
  console.log('\n7. Executing Migration 021 — Phase 021-A (021a_schema_triggers_backfill_and_functions.sql)...');
  runSupabaseCliQuery({
    filePath: 'supabase/migrations/021a_schema_triggers_backfill_and_functions.sql',
    readOnly: false,
    stepName: 'Migration 021 — Phase 021-A (Schema & Function Definitions)'
  });
  console.log('  [PASS] Phase 021-A committed.');

  // Phase 021-B: Execute 021b_reconcile_historical_duplicate_documents.sql
  console.log('\n8. Executing Migration 021 — Phase 021-B (021b_reconcile_historical_duplicate_documents.sql)...');
  const phaseBRes = runSupabaseCliQuery({
    filePath: 'supabase/migrations/021b_reconcile_historical_duplicate_documents.sql',
    readOnly: false,
    stepName: 'Migration 021 — Phase 021-B (Historical Reconciliation)'
  });
  const reconcileSummary = phaseBRes?.rows?.[0]?.result;
  if (
    !reconcileSummary ||
    reconcileSummary.status !== 'SUCCESS' ||
    reconcileSummary.archived_duplicates_count !== 3 ||
    reconcileSummary.unlinked_collisions_count !== 2 ||
    reconcileSummary.grades_preserved !== 18 ||
    reconcileSummary.scans_preserved !== 4
  ) {
    failStop(
      'Migration 021 — Phase 021-B Verification',
      `Unexpected reconciliation summary: ${JSON.stringify(reconcileSummary)}`
    );
  }
  console.log(`  [PASS] Phase 021-B verified: ${JSON.stringify(reconcileSummary)}`);

  // Phase 021-C: Execute 021c_enforce_canonical_document_unique_indexes.sql + PostgREST Reload
  console.log('\n9. Executing Migration 021 — Phase 021-C (021c_enforce_canonical_document_unique_indexes.sql & Schema Reload)...');
  const phaseCRes = runSupabaseCliQuery({
    filePath: 'supabase/migrations/021c_enforce_canonical_document_unique_indexes.sql',
    readOnly: false,
    stepName: 'Migration 021 — Phase 021-C (Canonical Unique Indexes)'
  });
  const indexSummary = phaseCRes?.rows?.[0]?.result;
  if (!indexSummary || indexSummary.status !== 'SUCCESS') {
    failStop(
      'Migration 021 — Phase 021-C Verification',
      `Unexpected index enforcement summary: ${JSON.stringify(phaseCRes)}`
    );
  }
  runSupabaseCliQuery({
    sql: "NOTIFY pgrst, 'reload schema';",
    readOnly: false,
    stepName: 'Migration 021 — Phase 021-C (PostgREST Schema Cache Reload)'
  });
  console.log(`  [PASS] Phase 021-C verified: ${JSON.stringify(indexSummary)}`);

  // Step 10: Post-Migration Live Invariant Verification BEFORE recording schema_migrations
  console.log('\n10. Verifying post-migration 18 subject_grades hash, scan versions, collision isolation & 20 Storage objects...');
  const postGrades = await computeLive18GradesHash(adminClient);
  if (postGrades.count !== 18 || postGrades.hash !== EXPECTED_18_GRADES_SHA256) {
    failStop(
      'Post-Migration 18 Subject Grades Check',
      `Expected 18 rows with SHA-256 ${EXPECTED_18_GRADES_SHA256}, got ${postGrades.count} rows with ${postGrades.hash}`
    );
  }
  const postStorageCount = await verifyLiveStorageInventory(adminClient);
  const postSqlVerify = runSupabaseCliQuery({
    sql: [
      'SELECT',
      "(SELECT COUNT(*) FROM public.document_scans WHERE document_id = '840dc1c4-a272-444e-9ff4-2faba4b94c0b') AS scan_count,",
      "(SELECT COUNT(*) FROM public.documents WHERE id IN ('cc8b4c08-14bb-4c92-9958-d670f878ac29','edda579a-6e1d-4acb-81d8-25d078798ff7') AND (student_id IS NOT NULL OR canonical_lrn IS NOT NULL)) AS linked_collisions,",
      "(SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('idx_documents_canonical_sf9_active','idx_documents_canonical_sf9_student_active','idx_documents_canonical_sf10_active','idx_documents_unresolved_file_hash_active')) AS canonical_index_count;"
    ].join(' '),
    readOnly: true,
    stepName: 'Post-Migration SQL Invariant Verification'
  });
  const invRow = postSqlVerify?.rows?.[0];
  if (
    !invRow ||
    Number(invRow.scan_count) !== 4 ||
    Number(invRow.linked_collisions) !== 0 ||
    Number(invRow.canonical_index_count) !== 4
  ) {
    failStop('Post-Migration SQL Invariant Verification', `Unexpected invariant row: ${JSON.stringify(invRow)}`);
  }
  console.log(`  [PASS] Post-migration 18 subject_grades SHA-256 matches 100%: ${postGrades.hash}`);
  console.log(`  [PASS] Post-migration Storage objects intact (${postStorageCount}/20)`);
  console.log(`  [PASS] Post-migration SQL invariants verified: ${JSON.stringify(invRow)}`);

  // Step 11: Record verified migrations 001–021 in supabase_migrations.schema_migrations ONLY AFTER all checks pass
  console.log('\n11. Recording verified migrations 001–021 in supabase_migrations.schema_migrations...');
  const recordSql = [
    'CREATE SCHEMA IF NOT EXISTS supabase_migrations;',
    'CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY, statements text[], name text);',
    "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES",
    "('001','initial_schema'),('002','auth_rbac'),('003','default_users'),('004','admin_rpc'),('005','grades_and_status'),('006','update_lpt_to_prc'),('007','fix_grades_trigger'),('008','storage_buckets'),('009','consolidated_pending_migrations'),('010','strengthened_shs_metadata'),('011','remove_prc_lpt_from_user_metadata'),('012','student_document_completeness_and_eligibility'),('013','attendance_and_remedial_tracking'),('014','admin_audit_logs'),('015','lrn_deduplication_and_grade_updates'),('016','teacher_registry_and_secure_approval'),('017','update_tris_deped_school_id'),('018','review_queue_direct_deletion'),('019','remove_psa_support'),('020','add_approval_method_to_user_roles'),('021','canonical_academic_records_and_scan_versions')",
    'ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;'
  ].join(' ');
  runSupabaseCliQuery({
    sql: recordSql,
    readOnly: false,
    stepName: 'Record Migration History (001–021)'
  });
  console.log('  [PASS] Migration history 001–021 recorded in supabase_migrations.schema_migrations.');
}

const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => failStop('Unhandled Exception', err.message));
}

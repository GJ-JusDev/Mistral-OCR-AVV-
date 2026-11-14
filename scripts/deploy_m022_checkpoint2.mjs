import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { parseSupabaseCliOutput } from './deploy_m016_m021_phased.mjs';

const TARGET_PROJECT_REF = 'yhsmawyntabwghncqbqy';
const TARGET_PROJECT_NAME = 'AAV3.0';
const TRIS_SCHOOL_ID = 'a0000000-0000-0000-0000-000000000001';
const CANONICAL_JUSTIN_DOC_ID = '840dc1c4-a272-444e-9ff4-2faba4b94c0b';
const KENNETH_DOC_IDS = [
  'cc8b4c08-14bb-4c92-9958-d670f878ac29',
  'edda579a-6e1d-4acb-81d8-25d078798ff7',
];
const EXPECTED_18_GRADES_SHA256 =
  '5a2886baf2d05617f264e88be5bd8a331fc309ac10fc885f10095ed56a11ac9b';
const EXPECTED_STORAGE_COUNT = 20;

const EXPECTED_ARTIFACT_HASHES = {
  pre016Json: {
    relPath: 'supabase/backups/production_pre_m016_m021_backup.json',
    sha256: 'a36a7161c2a7cb5e2c674571d2eb3bdd4f3971e405d6d1714dbf81118f4539d3',
  },
  pre016Sql: {
    relPath: 'supabase/backups/production_pre_m016_m021_restore.sql',
    sha256: '9384ac46e855d7aa30ab1db7f70401cd1e5cdfb758a5bc81a5e6469383d052c8',
  },
  post021Json: {
    relPath: 'supabase/backups/production_post_m021_backup.json',
    sha256: 'ae743733b02c036d59095fbb6c465ff2486f6e3f2b4afd8f82fa8e9bc71ee353',
  },
  post021Sql: {
    relPath: 'supabase/backups/production_post_m021_restore.sql',
    sha256: 'ff0d1d413a6ed8c224a9761525bfdec877f465f441099efe0c42ea5a78f495b3',
  },
  migration022: {
    relPath: 'supabase/migrations/022_teacher_assignments_and_section_scanning.sql',
    sha256: 'a1763ac742f2a9dd6b2410d270a8c29e6805882cdaf9ada12feb87edf49f669c',
  },
  rollback022: {
    relPath: 'supabase/rollbacks/022_rollback_recovery.sql',
    sha256: 'a987966810425b31cb99adbb57b56cea12653fbd113558c9367e98bdef4d254f',
  },
};

const MIGRATION_022_NEW_TABLES = [
  'teacher_assignments',
  'teacher_module_policies',
  'student_enrollments',
  'student_identity_conflicts',
];

const MIGRATION_022_NEW_FUNCTIONS = [
  'normalize_section_key',
  'normalize_strand_key',
  'normalize_subject_key',
  'normalize_lrn_text',
  'enforce_teacher_assignment_integrity',
  'enforce_adviser_only_policy',
  'has_active_teacher_assignment',
  'can_teacher_scan_with_assignment',
  'can_teacher_access_section',
  'can_teacher_access_document',
  'can_teacher_access_student',
  'get_teacher_authorized_assignments',
  'lookup_or_quarantine_student_identity',
  'upsert_student_enrollment_history',
  'resolve_section_or_identity_conflict',
  'guard_teacher_document_updates',
];

const EXECUTE_APPROVED = process.argv.includes('--execute-approved');
const rootDir = process.cwd();
let tempSeq = 0;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function failStop(stepName, reason) {
  console.error(`\n[FATAL STOP] Step "${stepName}" FAILED:`);
  console.error(`  ${reason}`);
  console.error('  Execution halted immediately. No automatic rollback executed.');
  process.exit(1);
}

function runSupabaseCliQuery({ sql, readOnly = true, stepName }) {
  tempSeq += 1;
  const tmpFile = path.join(
    os.tmpdir(),
    `avv_m022_${process.pid}_${Date.now()}_${tempSeq}.sql`
  );
  fs.writeFileSync(tmpFile, sql, 'utf8');

  const args = [
    'supabase',
    'db',
    'query',
    `--remote=${TARGET_PROJECT_REF}`,
    ...(readOnly ? ['--read-only'] : ['--yes']),
    '-o',
    'json',
    '-f',
    tmpFile,
  ];

  try {
    const rawStdout = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
      shell: process.platform === 'win32',
    });
    const parsed = parseSupabaseCliOutput(rawStdout, { stepName });
    if (parsed.rows.length > 0 && parsed.rows[0] && parsed.rows[0].error) {
      failStop(stepName, `PostgreSQL Error Row: ${JSON.stringify(parsed.rows[0].error)}`);
    }
    return parsed;
  } catch (err) {
    const errText = [err.stderr, err.stdout, err.message].filter(Boolean).join('\n');
    failStop(stepName, errText || 'Unknown CLI failure');
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

async function computeLiveSubjectGradesHash(adminClient) {
  const { data, error } = await adminClient.from('subject_grades').select('*');
  if (error) {
    throw new Error(`Failed reading live subject_grades: ${error.message}`);
  }
  const normalized = (data || [])
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
      status: r.status,
    }));
  const hash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return { count: normalized.length, hash };
}

async function countStorageObjects(adminClient) {
  const { data: rootObjects, error } = await adminClient.storage
    .from('documents')
    .list('', { limit: 1000 });
  if (error) {
    throw new Error(`Storage list failed: ${error.message}`);
  }
  let total = 0;
  for (const item of rootObjects || []) {
    if (item.id === null) {
      const { data: subItems } = await adminClient.storage
        .from('documents')
        .list(item.name, { limit: 1000 });
      for (const sub of subItems || []) {
        if (sub.id === null) {
          const { data: leafItems } = await adminClient.storage
            .from('documents')
            .list(`${item.name}/${sub.name}`, { limit: 1000 });
          total += (leafItems || []).length;
        } else {
          total += 1;
        }
      }
    } else {
      total += 1;
    }
  }
  return total;
}

async function verifyProtectedBaselines(adminClient, label) {
  const grades = await computeLiveSubjectGradesHash(adminClient);
  if (grades.count !== 18 || grades.hash !== EXPECTED_18_GRADES_SHA256) {
    failStop(
      label,
      `18 approved grades baseline mismatch: count=${grades.count}, hash=${grades.hash}`
    );
  }
  const storageCount = await countStorageObjects(adminClient);
  if (storageCount !== EXPECTED_STORAGE_COUNT) {
    failStop(
      label,
      `Storage objects count mismatch: ${storageCount} !== ${EXPECTED_STORAGE_COUNT}`
    );
  }
  const invRes = runSupabaseCliQuery({
    sql: [
      `SELECT (SELECT COUNT(*) FROM public.document_scans WHERE document_id = '${CANONICAL_JUSTIN_DOC_ID}') AS scan_count,`,
      `(SELECT COUNT(*) FROM public.documents WHERE id IN ('${KENNETH_DOC_IDS.join("','")}') AND (student_id IS NOT NULL OR canonical_lrn IS NOT NULL)) AS kenneth_collisions,`,
      `(SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('idx_documents_canonical_sf9_active','idx_documents_canonical_sf9_student_active','idx_documents_canonical_sf10_active','idx_documents_unresolved_file_hash_active')) AS canonical_index_count;`,
    ].join(' '),
    readOnly: true,
    stepName: `${label} — SQL Invariants`,
  });
  const inv = invRes?.rows?.[0];
  if (
    !inv ||
    Number(inv.scan_count) !== 4 ||
    Number(inv.kenneth_collisions) !== 0 ||
    Number(inv.canonical_index_count) !== 4
  ) {
    failStop(label, `Invariant violation: ${JSON.stringify(inv)}`);
  }
  return { gradesHash: grades.hash, storageCount, inv };
}

async function main() {
  console.log('========================================================================');
  console.log('AVV SYSTEM — CHECKPOINT 2 MIGRATION 022 RUNNER');
  console.log(`Mode: ${EXECUTE_APPROVED ? 'LIVE EXECUTION (--execute-approved)' : 'READ-ONLY PREFLIGHT'}`);
  console.log(`Target: ${TARGET_PROJECT_NAME} (${TARGET_PROJECT_REF})`);
  console.log('========================================================================\n');

  // Gate 1: Environment & Project Ref verification
  console.log('1. Verifying target project & credentials...');
  const envPath = path.resolve(rootDir, '.env.local');
  if (!fs.existsSync(envPath)) failStop('Target Verification', 'Missing .env.local');
  const envParsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  const supabaseUrl = (envParsed.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (envParsed.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl.includes(TARGET_PROJECT_REF) || !serviceKey) {
    failStop('Target Verification', `Invalid URL or missing service key for ${TARGET_PROJECT_REF}`);
  }
  const linkedRefPath = path.resolve(rootDir, 'supabase', '.temp', 'project-ref');
  if (!fs.existsSync(linkedRefPath) || fs.readFileSync(linkedRefPath, 'utf8').trim() !== TARGET_PROJECT_REF) {
    failStop('Target Verification', 'supabase/.temp/project-ref does not match target project.');
  }
  const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  console.log(`  [PASS] Linked project & URL verified (${TARGET_PROJECT_REF}).`);

  // Gate 2: Artifact Checksums & Rollback Isolation
  console.log('\n2. Verifying backup integrity, rollback isolation, & 022 checksum...');
  const migrationsDir = path.resolve(rootDir, 'supabase', 'migrations');
  const strayRollbacks = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.toLowerCase().includes('rollback'));
  if (strayRollbacks.length > 0) {
    failStop('Rollback Isolation', `Rollback files found inside supabase/migrations: ${strayRollbacks.join(', ')}`);
  }
  for (const [key, spec] of Object.entries(EXPECTED_ARTIFACT_HASHES)) {
    const abs = path.resolve(rootDir, spec.relPath);
    if (!fs.existsSync(abs)) failStop('Artifact Integrity', `Missing file: ${spec.relPath}`);
    const actual = sha256File(abs);
    if (actual !== spec.sha256) {
      failStop('Artifact Integrity', `SHA-256 mismatch on ${key} (${spec.relPath}): ${actual} !== ${spec.sha256}`);
    }
    console.log(`  [PASS] ${spec.relPath}: ${actual.slice(0, 16)}...`);
  }

  // Gate 3: Concurrency & Live Schema Compatibility Check
  console.log('\n3. Checking live PostgreSQL sessions, migrations (001–021), and 022 readiness...');
  const livePre = runSupabaseCliQuery({
    sql: [
      `SELECT`,
      `(SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state IS DISTINCT FROM 'idle' AND application_name <> 'pg_cron scheduler') AS active_nonidle_sessions,`,
      `(SELECT COALESCE(json_agg(version ORDER BY version), '[]'::json) FROM supabase_migrations.schema_migrations) AS versions,`,
      `(SELECT COALESCE(json_agg(table_name ORDER BY table_name), '[]'::json) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('${MIGRATION_022_NEW_TABLES.join("','")}')) AS existing_022_tables,`,
      `(SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (`,
      `  (p.proname IN ('is_admin','is_principal','is_approved_staff','is_approved_teacher','get_auth_user_school_id','update_updated_at_column') AND p.pronargs = 0)`,
      `  OR (p.proname = 'normalize_shs_grade_level' AND p.pronargs = 1)`,
      `)) AS required_prereq_funcs,`,
      `(SELECT EXISTS (SELECT 1 FROM public.schools WHERE id = '${TRIS_SCHOOL_ID}')) AS has_tris_school;`,
    ].join(' '),
    readOnly: true,
    stepName: 'Pre-022 Live State Check',
  });

  const preRow = livePre?.rows?.[0];
  if (!preRow) failStop('Pre-022 Live State Check', 'No state row returned');
  if (Number(preRow.active_nonidle_sessions) > 0) {
    failStop(
      'Concurrency Check',
      `Detected ${preRow.active_nonidle_sessions} active non-idle database session(s); refusing concurrent migration.`
    );
  }
  const versions = Array.isArray(preRow.versions) ? preRow.versions : [];
  if (!versions.includes('021')) {
    failStop('Migration Prerequisite', `Expected 021 applied; found versions: ${JSON.stringify(versions)}`);
  }
  if (versions.includes('022')) {
    failStop('Idempotency Guard', 'Migration 022 is already recorded in supabase_migrations.schema_migrations.');
  }
  const existing022 = Array.isArray(preRow.existing_022_tables) ? preRow.existing_022_tables : [];
  if (existing022.length > 0) {
    failStop('Clean Target Check', `Migration 022 tables already exist: ${JSON.stringify(existing022)}`);
  }
  if (Number(preRow.required_prereq_funcs) !== 7) {
    failStop('Function Dependency Check', `Expected 7 prerequisite functions; found ${preRow.required_prereq_funcs}`);
  }
  if (preRow.has_tris_school !== true) {
    failStop('School Dependency Check', `Missing TRIS school row ${TRIS_SCHOOL_ID}`);
  }
  console.log(`  [PASS] 0 conflicting DB sessions; schema at 001..021; 0/4 M022 tables present; 7/7 prereq functions verified.`);

  // Gate 4: Protected Baseline Verification (18 grades + 20 Storage objects + 4 scans + Kenneth isolation)
  console.log('\n4. Verifying pre-022 protected production baselines...');
  const preBaseline = await verifyProtectedBaselines(adminClient, 'Pre-022 Baseline');
  console.log(`  [PASS] 18 subject_grades SHA-256: ${preBaseline.gradesHash}`);
  console.log(`  [PASS] Storage objects: ${preBaseline.storageCount}/${EXPECTED_STORAGE_COUNT}`);
  console.log(`  [PASS] Justin 4 scans, 0 Kenneth collisions, 4 canonical unique indexes.`);

  if (!EXECUTE_APPROVED) {
    console.log('\n========================================================================');
    console.log('READ-ONLY PREFLIGHT PASSED — NO PRODUCTION CHANGES EXECUTED');
    console.log('Exact Checkpoint 2 execution command (run ONLY after explicit approval):');
    console.log('  node scripts/deploy_m022_checkpoint2.mjs --execute-approved');
    console.log('========================================================================');
    return;
  }

  // Gate 5: Single-Execution Atomic Apply of Migration 022
  console.log('\n5. Executing Migration 022 inside single transaction...');
  const m022Path = path.resolve(rootDir, EXPECTED_ARTIFACT_HASHES.migration022.relPath);
  const m022RawSql = fs.readFileSync(m022Path, 'utf8');
  const atomicM022Sql = `BEGIN;\n${m022RawSql}\nCOMMIT;\n`;
  runSupabaseCliQuery({
    sql: atomicM022Sql,
    readOnly: false,
    stepName: 'Execute Migration 022',
  });
  console.log('  [PASS] Migration 022 SQL committed cleanly.');

  // Gate 6: Post-022 Schema, Security, & Data Invariant Verification
  console.log('\n6. Verifying post-022 schema, RLS policies, functions, trigger, & data baselines...');
  const post022Check = runSupabaseCliQuery({
    sql: [
      `SELECT`,
      `(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('${MIGRATION_022_NEW_TABLES.join("','")}')) AS m022_tables_count,`,
      `(SELECT COUNT(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('${MIGRATION_022_NEW_FUNCTIONS.join("','")}')) AS m022_funcs_count,`,
      `(SELECT COUNT(*) FROM pg_trigger WHERE tgrelid='public.documents'::regclass AND tgname='trg_guard_teacher_document_updates' AND NOT tgisinternal) AS guard_trigger_count,`,
      `(SELECT allow_subject_teacher_scanning FROM public.teacher_module_policies WHERE school_id = '${TRIS_SCHOOL_ID}') AS tris_subject_scan_allowed,`,
      `(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name IN ('teacher_assignment_id','section','strand_or_track','assignment_confirmed_at','assignment_confirmed_by')) AS doc_new_cols_count;`,
    ].join(' '),
    readOnly: true,
    stepName: 'Post-022 Object Verification',
  });
  const postRow = post022Check?.rows?.[0];
  if (
    !postRow ||
    Number(postRow.m022_tables_count) !== MIGRATION_022_NEW_TABLES.length ||
    Number(postRow.m022_funcs_count) !== MIGRATION_022_NEW_FUNCTIONS.length ||
    Number(postRow.guard_trigger_count) !== 1 ||
    postRow.tris_subject_scan_allowed !== false ||
    Number(postRow.doc_new_cols_count) !== 5
  ) {
    failStop('Post-022 Object Verification', `Unexpected post-022 schema state: ${JSON.stringify(postRow)}`);
  }

  const postBaseline = await verifyProtectedBaselines(adminClient, 'Post-022 Baseline');
  console.log(`  [PASS] 4/4 tables, ${postRow.m022_funcs_count}/${MIGRATION_022_NEW_FUNCTIONS.length} functions, guard trigger & Class Adviser-only lock verified.`);
  console.log(`  [PASS] Post-022 18 subject_grades SHA-256 unchanged: ${postBaseline.gradesHash}`);
  console.log(`  [PASS] Post-022 Storage objects intact: ${postBaseline.storageCount}/${EXPECTED_STORAGE_COUNT}`);

  // Gate 7: Record Migration 022 in schema_migrations ONLY AFTER all checks pass
  console.log('\n7. Recording Migration 022 in supabase_migrations.schema_migrations...');
  runSupabaseCliQuery({
    sql: [
      `INSERT INTO supabase_migrations.schema_migrations (version, name)`,
      `VALUES ('022', 'teacher_assignments_and_section_scanning')`,
      `ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;`,
    ].join(' '),
    readOnly: false,
    stepName: 'Record Migration 022 History',
  });
  console.log('  [PASS] Migration 022 recorded cleanly. Checkpoint 2 database migration COMPLETE.');
}

main().catch((err) => failStop('Unhandled Exception', err?.message || String(err)));

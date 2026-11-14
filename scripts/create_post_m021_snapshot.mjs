import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';

const PROJECT_REF = 'yhsmawyntabwghncqbqy';
const EXPECTED_18_GRADES_SHA256 =
  '5a2886baf2d05617f264e88be5bd8a331fc309ac10fc885f10095ed56a11ac9b';

const envPath = path.resolve(process.cwd(), '.env.local');
const envParsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
const supabaseUrl = (envParsed.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceKey = (envParsed.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

if (!supabaseUrl.includes(PROJECT_REF)) {
  console.error(`Target URL mismatch: expected ${PROJECT_REF}`);
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function queryAppliedMigrations() {
  const osTmp = process.env.TEMP || process.env.TMP || '/tmp';
  const tmpFile = path.join(osTmp, `snap_m021_${process.pid}_${Date.now()}.sql`);
  fs.writeFileSync(
    tmpFile,
    'SELECT version, COALESCE(name, \'\') AS name FROM supabase_migrations.schema_migrations ORDER BY version;\n',
    'utf8'
  );
  try {
    const res = spawnSync(
      'npx',
      ['supabase', 'db', 'query', `--remote=${PROJECT_REF}`, '--read-only', '-o', 'json', '-f', tmpFile],
      { encoding: 'utf8', shell: process.platform === 'win32' }
    );
    if (res.status !== 0) {
      throw new Error(res.stderr || res.stdout || `Exit ${res.status}`);
    }
    const text = res.stdout || '';
    const jsonStart = text.indexOf('{');
    if (jsonStart === -1) return [];
    const parsed = JSON.parse(text.slice(jsonStart));
    return parsed.rows || [];
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

async function main() {
  const backupDir = path.resolve(process.cwd(), 'supabase', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Verify existing pre-016 backups are preserved and untouched
  const preJson = path.join(backupDir, 'production_pre_m016_m021_backup.json');
  const preSql = path.join(backupDir, 'production_pre_m016_m021_restore.sql');
  if (!fs.existsSync(preJson) || !fs.existsSync(preSql)) {
    throw new Error('Pre-016 backup files are missing; refusing to proceed.');
  }
  const preJsonSha = sha256File(preJson);
  const preSqlSha = sha256File(preSql);

  const timestamp = new Date().toISOString();
  console.log(`Creating separate post-021 production snapshot at ${timestamp}...`);

  const tables = [
    'schools',
    'students',
    'documents',
    'subject_grades',
    'validation_results',
    'review_logs',
    'user_roles',
    'auth_logs',
    'audit_logs',
    'grade_change_history',
    'academic_standing_history',
    'eligibility_approvals',
    'eligibility_audit_logs',
    'attendance_records',
    'attendance_summaries',
    'remedial_records',
    'school_teacher_registry',
    'document_scans',
  ];

  const schemaMigrations = queryAppliedMigrations();

  const backupData = {
    metadata: {
      snapshotType: 'post_m021_pre_m022',
      projectRef: PROJECT_REF,
      sourceUrl: supabaseUrl,
      timestamp,
      preservedPre016Backup: {
        jsonFile: 'supabase/backups/production_pre_m016_m021_backup.json',
        jsonSha256: preJsonSha,
        sqlFile: 'supabase/backups/production_pre_m016_m021_restore.sql',
        sqlSha256: preSqlSha,
      },
      appliedSchemaMigrations: schemaMigrations,
      tableList: tables,
    },
    schemaDefinitions: {},
    tables: {},
    storage: {},
    usersRoster: [],
  };

  for (const table of tables) {
    const { data, error } = await adminClient.from(table).select('*');
    if (error) {
      backupData.tables[table] = {
        status: 'ERROR',
        error: error.message,
        code: error.code || null,
        count: 0,
        rows: [],
      };
      backupData.schemaDefinitions[table] = {
        status: 'ERROR',
        error: error.message,
      };
    } else {
      backupData.tables[table] = {
        status: 'OK',
        count: data.length,
        rows: data,
      };
      backupData.schemaDefinitions[table] = {
        status: 'OK',
        columns: data.length > 0 ? Object.keys(data[0]) : [],
      };
    }
  }

  // Compute deterministic SHA-256 of the 18 subject_grades rows
  const sgRows = (backupData.tables.subject_grades?.rows || [])
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

  const gradesSha = crypto.createHash('sha256').update(JSON.stringify(sgRows)).digest('hex');
  backupData.metadata.subjectGradesCount = sgRows.length;
  backupData.metadata.subjectGradesDeterministicSha256 = gradesSha;
  if (sgRows.length !== 18 || gradesSha !== EXPECTED_18_GRADES_SHA256) {
    throw new Error(
      `Subject grades baseline mismatch! count=${sgRows.length}, sha256=${gradesSha} (expected 18 and ${EXPECTED_18_GRADES_SHA256})`
    );
  }

  // Storage inventory (documents bucket)
  const { data: buckets, error: bErr } = await adminClient.storage.listBuckets();
  backupData.storage.buckets = bErr ? { error: bErr.message } : buckets;
  const { data: rootObjects, error: oErr } = await adminClient.storage
    .from('documents')
    .list('', { limit: 1000 });
  const storageObjects = [];
  if (!oErr && Array.isArray(rootObjects)) {
    for (const item of rootObjects) {
      if (item.id === null) {
        const { data: subItems } = await adminClient.storage
          .from('documents')
          .list(item.name, { limit: 1000 });
        for (const sub of subItems || []) {
          if (sub.id === null) {
            const { data: leafItems } = await adminClient.storage
              .from('documents')
              .list(`${item.name}/${sub.name}`, { limit: 1000 });
            for (const leaf of leafItems || []) {
              storageObjects.push({
                path: `${item.name}/${sub.name}/${leaf.name}`,
                id: leaf.id,
                metadata: leaf.metadata,
                created_at: leaf.created_at,
              });
            }
          } else {
            storageObjects.push({
              path: `${item.name}/${sub.name}`,
              id: sub.id,
              metadata: sub.metadata,
              created_at: sub.created_at,
            });
          }
        }
      } else {
        storageObjects.push({
          path: item.name,
          id: item.id,
          metadata: item.metadata,
          created_at: item.created_at,
        });
      }
    }
  }
  backupData.storage.documentsBucketSummary = {
    totalObjects: storageObjects.length,
  };
  backupData.storage.documentsBucketObjects = oErr ? { error: oErr.message } : storageObjects;

  // Users roster
  const { data: usersData, error: uErr } = await adminClient.auth.admin.listUsers();
  if (!uErr && usersData) {
    backupData.usersRoster = usersData.users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      user_metadata: u.user_metadata,
      created_at: u.created_at,
      email_confirmed_at: u.email_confirmed_at,
    }));
  }

  // Write JSON backup (separate post-021 filename)
  const postJsonPath = path.join(backupDir, 'production_post_m021_backup.json');
  const postJsonString = JSON.stringify(backupData, null, 2);
  fs.writeFileSync(postJsonPath, postJsonString, 'utf8');
  const postJsonSha = crypto.createHash('sha256').update(postJsonString).digest('hex');

  // Generate separate post-021 SQL restore snapshot
  const sqlLiteral = (val) => {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
    if (Array.isArray(val)) {
      // Handle PostgreSQL TEXT[] columns cleanly (e.g. document_scans.detected_quarters)
      if (val.every((x) => typeof x === 'string')) {
        const elems = val.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
        return `ARRAY[${elems}]::text[]`;
      }
      return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
    }
    if (typeof val === 'object') {
      return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
    }
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const restoreTableOrder = [
    'schools',
    'school_teacher_registry',
    'students',
    'user_roles',
    'documents',
    'document_scans',
    'subject_grades',
    'validation_results',
    'review_logs',
    'academic_standing_history',
    'auth_logs',
    'audit_logs',
  ];

  const sqlLines = [
    '-- ============================================================================',
    '-- EXECUTABLE SQL POST-021 SNAPSHOT RESTORE SCRIPT (PRE-CHECKPOINT 2)',
    `-- Generated at: ${timestamp}`,
    `-- Project Ref: ${PROJECT_REF}`,
    `-- Source JSON SHA-256: ${postJsonSha}`,
    `-- 18 Approved Subject Grades Deterministic SHA-256: ${gradesSha}`,
    '-- ============================================================================',
    'BEGIN;',
    '',
  ];

  for (const tbl of restoreTableOrder) {
    const tInfo = backupData.tables[tbl];
    if (!tInfo || tInfo.status !== 'OK' || !Array.isArray(tInfo.rows) || tInfo.rows.length === 0) {
      sqlLines.push(`-- Table public.${tbl}: 0 rows`);
      continue;
    }
    sqlLines.push(`-- Restore public.${tbl} (${tInfo.rows.length} rows)`);
    const cols = Object.keys(tInfo.rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const updateList = cols
      .filter((c) => c !== 'id')
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');
    for (const row of tInfo.rows) {
      const valList = cols.map((c) => sqlLiteral(row[c])).join(', ');
      sqlLines.push(
        `INSERT INTO public.${tbl} (${colList}) VALUES (${valList}) ON CONFLICT (id) DO UPDATE SET ${updateList};`
      );
    }
    sqlLines.push('');
  }

  sqlLines.push('COMMIT;');
  sqlLines.push('');

  const postSqlPath = path.join(backupDir, 'production_post_m021_restore.sql');
  const postSqlContent = sqlLines.join('\n');
  fs.writeFileSync(postSqlPath, postSqlContent, 'utf8');
  const postSqlSha = crypto.createHash('sha256').update(postSqlContent).digest('hex');

  // Re-verify pre-016 backups were not touched
  if (sha256File(preJson) !== preJsonSha || sha256File(preSql) !== preSqlSha) {
    throw new Error('CRITICAL: Pre-016 backup hash changed unexpectedly!');
  }

  console.log('\n=== POST-021 PRODUCTION SNAPSHOT CREATED ===');
  console.log('Pre-016 JSON (preserved):', preJson, 'SHA256:', preJsonSha);
  console.log('Pre-016 SQL  (preserved):', preSql, 'SHA256:', preSqlSha);
  console.log('Post-021 JSON:', postJsonPath, 'SHA256:', postJsonSha, 'Size:', fs.statSync(postJsonPath).size, 'bytes');
  console.log('Post-021 SQL :', postSqlPath, 'SHA256:', postSqlSha, 'Size:', fs.statSync(postSqlPath).size, 'bytes');
  console.log('Applied Migrations:', schemaMigrations.map((m) => m.version).join(','));
  console.log('18 Subject Grades SHA256:', gradesSha);
  console.log('Storage Objects Count:', storageObjects.length);
  for (const [t, info] of Object.entries(backupData.tables)) {
    console.log(`  Table [${t}]: ${info.count} records (${info.status})`);
  }
}

main().catch((err) => {
  console.error('POST-021 SNAPSHOT FAILED:', err.message || err);
  process.exit(1);
});

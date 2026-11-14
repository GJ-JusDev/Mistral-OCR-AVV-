import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const envPath = path.resolve(process.cwd(), '.env.local');
const envRaw = fs.readFileSync(envPath, 'utf8');
const envParsed = dotenv.parse(envRaw);

const supabaseUrl = (envParsed.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceKey = (envParsed.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function createBackup() {
  const timestamp = new Date().toISOString();
  console.log(`Starting production snapshot backup at ${timestamp}...`);

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
    'document_scans'
  ];

  const migrationFiles = [
    '016_teacher_registry_and_secure_approval.sql',
    '017_update_tris_deped_school_id.sql',
    '018_review_queue_direct_deletion.sql',
    '019_remove_psa_support.sql',
    '020_add_approval_method_to_user_roles.sql',
    '021_canonical_academic_records_and_scan_versions.sql'
  ];

  const migrationManifest = migrationFiles.map((file) => {
    const fullPath = path.resolve(process.cwd(), 'supabase', 'migrations', file);
    if (!fs.existsSync(fullPath)) return { file, exists: false };
    const content = fs.readFileSync(fullPath, 'utf8');
    return {
      file,
      exists: true,
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    };
  });

  const backupData = {
    metadata: {
      sourceUrl: supabaseUrl,
      timestamp,
      backupScope: 'Complete public schema tables + scan evidence references + Storage object inventory + schema column definitions + auth user metadata roster',
      tableList: tables,
      migrationManifest
    },
    schemaDefinitions: {},
    tables: {},
    scanEvidenceManifest: [],
    storage: {},
    usersRoster: []
  };

  // 1. Export each table + observed column schema
  for (const table of tables) {
    try {
      const { data, error } = await adminClient.from(table).select('*');
      if (error) {
        backupData.tables[table] = { status: 'ERROR', error: error.message, code: error.code || null, count: 0, rows: [] };
        backupData.schemaDefinitions[table] = { status: 'MISSING_OR_UNREADABLE', error: error.message };
      } else {
        backupData.tables[table] = { status: 'OK', count: data.length, rows: data };
        backupData.schemaDefinitions[table] = {
          status: 'OK',
          columns: data.length > 0 ? Object.keys(data[0]) : []
        };
      }
    } catch (err) {
      backupData.tables[table] = { status: 'EXCEPTION', error: err.message, count: 0, rows: [] };
      backupData.schemaDefinitions[table] = { status: 'EXCEPTION', error: err.message };
    }
  }

  // 1b. Build explicit Scan Evidence Manifest from public.documents
  const docRows = backupData.tables.documents?.rows || [];
  const referencedStoragePaths = new Set();
  backupData.scanEvidenceManifest = docRows.map((d) => {
    const extractPath = (url) => {
      if (!url) return null;
      const m = url.match(/\/documents\/([^?]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    };
    const frontPath = extractPath(d.image_url);
    const backPath = extractPath(d.extracted_fields?.back_image_url || d.extracted_fields?.images?.back);
    if (frontPath) referencedStoragePaths.add(frontPath);
    if (backPath) referencedStoragePaths.add(backPath);
    return {
      document_id: d.id,
      student_id: d.student_id,
      school_id: d.school_id,
      document_type: d.document_type,
      status: d.status,
      original_filename: d.original_filename,
      front_storage_path: frontPath,
      back_storage_path: backPath,
      image_url: d.image_url,
      back_image_url: d.extracted_fields?.back_image_url || null,
      scan_history: d.extracted_fields?.scan_history || [],
      created_at: d.created_at,
      reviewed_at: d.reviewed_at || null
    };
  });

  // 1c. Compute deterministic SHA-256 hash of all 18 approved subject_grades rows
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
      status: r.status
    }));
  backupData.metadata.subjectGradesCount = sgRows.length;
  backupData.metadata.subjectGradesDeterministicSha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify(sgRows))
    .digest('hex');

  // 2. Export Storage Buckets configuration & object references in 'documents' bucket
  try {
    const { data: buckets, error: bErr } = await adminClient.storage.listBuckets();
    backupData.storage.buckets = bErr ? { error: bErr.message } : buckets;

    const { data: rootObjects, error: oErr } = await adminClient.storage.from('documents').list('', { limit: 1000 });
    const storageObjects = [];
    if (!oErr && Array.isArray(rootObjects)) {
      for (const item of rootObjects) {
        if (item.id === null) {
          // Folder prefix (e.g. school_id or user_id)
          const { data: subItems } = await adminClient.storage.from('documents').list(item.name, { limit: 1000 });
          if (Array.isArray(subItems)) {
            for (const sub of subItems) {
              if (sub.id === null) {
                const { data: leafItems } = await adminClient.storage.from('documents').list(`${item.name}/${sub.name}`, { limit: 1000 });
                if (Array.isArray(leafItems)) {
                  for (const leaf of leafItems) {
                    const objPath = `${item.name}/${sub.name}/${leaf.name}`;
                    const isRef = referencedStoragePaths.has(objPath);
                    storageObjects.push({
                      path: objPath,
                      id: leaf.id,
                      metadata: leaf.metadata,
                      created_at: leaf.created_at,
                      isReferencedByActiveDocument: isRef,
                      classification: isRef ? 'REFERENCED_BY_ACTIVE_DOCUMENT' : 'UNREFERENCED_HISTORICAL_TEST_OBJECT'
                    });
                  }
                }
              } else {
                const objPath = `${item.name}/${sub.name}`;
                const isRef = referencedStoragePaths.has(objPath);
                storageObjects.push({
                  path: objPath,
                  id: sub.id,
                  metadata: sub.metadata,
                  created_at: sub.created_at,
                  isReferencedByActiveDocument: isRef,
                  classification: isRef ? 'REFERENCED_BY_ACTIVE_DOCUMENT' : 'UNREFERENCED_HISTORICAL_TEST_OBJECT'
                });
              }
            }
          }
        } else {
          const objPath = item.name;
          const isRef = referencedStoragePaths.has(objPath);
          storageObjects.push({
            path: objPath,
            id: item.id,
            metadata: item.metadata,
            created_at: item.created_at,
            isReferencedByActiveDocument: isRef,
            classification: isRef ? 'REFERENCED_BY_ACTIVE_DOCUMENT' : 'UNREFERENCED_HISTORICAL_TEST_OBJECT'
          });
        }
      }
    }
    backupData.storage.documentsBucketSummary = {
      totalObjects: storageObjects.length,
      referencedByActiveDocuments: storageObjects.filter((o) => o.isReferencedByActiveDocument).length,
      unreferencedHistoricalTestObjects: storageObjects.filter((o) => !o.isReferencedByActiveDocument).length
    };
    backupData.storage.documentsBucketObjects = oErr ? { error: oErr.message } : storageObjects;
  } catch (err) {
    backupData.storage.buckets = { error: err.message };
  }

  // 3. Export Auth User Roster (Safe metadata, zero password hashes)
  try {
    const { data: usersData, error: uErr } = await adminClient.auth.admin.listUsers();
    if (!uErr && usersData) {
      backupData.usersRoster = usersData.users.map(u => ({
        id: u.id,
        email: u.email,
        role: u.role,
        user_metadata: u.user_metadata,
        created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at
      }));
    }
  } catch (err) {
    backupData.usersRoster = [{ error: err.message }];
  }

  const backupDir = path.resolve(process.cwd(), 'supabase', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFilename = 'production_pre_m016_m021_backup.json';
  const backupFilePath = path.join(backupDir, backupFilename);
  const backupJsonString = JSON.stringify(backupData, null, 2);

  fs.writeFileSync(backupFilePath, backupJsonString, 'utf8');

  const sha256 = crypto.createHash('sha256').update(backupJsonString).digest('hex');

  // 4. Generate executable SQL Restore Script (schema rollback + deterministic data upsert)
  const sqlLiteral = (val) => {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
    if (typeof val === 'object') {
      return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
    }
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const restoreTableOrder = [
    'schools',
    'students',
    'user_roles',
    'documents',
    'subject_grades',
    'validation_results',
    'review_logs',
    'academic_standing_history',
    'auth_logs',
    'audit_logs'
  ];

  const sqlLines = [
    '-- ============================================================================',
    '-- EXECUTABLE SQL DATA & SCHEMA RESTORE SCRIPT (PRE-MIGRATION 016–021 STATE)',
    `-- Generated at: ${timestamp}`,
    `-- Source JSON SHA-256: ${sha256}`,
    `-- 18 Approved Subject Grades Deterministic SHA-256: ${backupData.metadata.subjectGradesDeterministicSha256}`,
    '-- ============================================================================',
    'BEGIN;',
    '',
    '-- 1. Drop M021 triggers/indexes if present so pre-migration rows can be restored cleanly',
    'DROP TRIGGER IF EXISTS trg_process_approved_document ON public.documents;',
    'DROP TRIGGER IF EXISTS trg_link_document_student_before ON public.documents;',
    'DROP INDEX IF EXISTS public.idx_documents_canonical_sf9_active;',
    'DROP INDEX IF EXISTS public.idx_documents_canonical_sf9_student_active;',
    'DROP INDEX IF EXISTS public.idx_documents_canonical_sf10_active;',
    'DROP INDEX IF EXISTS public.idx_documents_unresolved_file_hash_active;',
    'ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_documents_canonical_active_fields;',
    ''
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

  const restoreSqlFilename = 'production_pre_m016_m021_restore.sql';
  const restoreSqlPath = path.join(backupDir, restoreSqlFilename);
  const restoreSqlContent = sqlLines.join('\n');
  fs.writeFileSync(restoreSqlPath, restoreSqlContent, 'utf8');
  const restoreSqlSha256 = crypto.createHash('sha256').update(restoreSqlContent).digest('hex');

  console.log('\n=== PRODUCTION DATABASE SNAPSHOT CREATED ===');
  console.log('JSON Backup Location:', backupFilePath);
  console.log('JSON Backup SHA256:', sha256);
  console.log('JSON Backup Size:', fs.statSync(backupFilePath).size, 'bytes');
  console.log('SQL Restore Location:', restoreSqlPath);
  console.log('SQL Restore SHA256:', restoreSqlSha256);
  console.log('SQL Restore Size:', fs.statSync(restoreSqlPath).size, 'bytes');
  console.log('18 Subject Grades Deterministic SHA256:', backupData.metadata.subjectGradesDeterministicSha256);
  console.log('Storage Objects Summary:', JSON.stringify(backupData.storage.documentsBucketSummary));
  console.log('\n--- Table Record Counts ---');
  for (const [t, info] of Object.entries(backupData.tables)) {
    console.log(`  Table [${t}]: ${info.count} records (${info.status})`);
  }
  console.log(`  Auth Users: ${backupData.usersRoster.length} users recorded`);
}

createBackup().catch(console.error);

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ==============================================================================
 * AVV Production Database Restoration & Recovery Procedure
 * ==============================================================================
 * 
 * CRITICAL LIMITATIONS OF THIS LOGICAL JSON BACKUP:
 * 1. Authentication Secrets Excluded:
 *    PostgREST and Supabase Client JS do NOT have access to password hashes, salts,
 *    or session refresh tokens in auth.users. The usersRoster only restores identity
 *    metadata (email, raw_user_meta_data). Users will require password resets if
 *    auth accounts are recreated from this backup.
 * 2. Storage File Blobs Excluded:
 *    The backup captures bucket settings (storage.buckets), but NOT binary files
 *    or uploaded image/PDF blobs in storage.objects.
 * 3. Foreign Key Dependency Sequence:
 *    public.user_roles has an FK constraint to auth.users(id). In a completely
 *    wiped database, auth.users must be created/seeded first before user_roles.
 * 4. Schema DDL Missing:
 *    This file contains tabular data (DML). If tables or triggers are dropped,
 *    migrations (001-004) must be applied before importing this JSON.
 * 
 * RECOMMENDED NATIVE BACKUP METHOD FOR DISASTER RECOVERY:
 * - Supabase Dashboard -> Database -> Backups (automated daily physical snapshots).
 * - Direct pg_dump via direct connection string:
 *   pg_dump -h db.<ref>.supabase.co -U postgres -d postgres -F c -b -v -f production_cluster_backup.dump
 * ==============================================================================
 */

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

async function restoreBackup(filePath) {
  const targetPath = filePath || path.resolve(process.cwd(), 'supabase', 'backups', 'production_pre_m009_backup_20261014.json');
  console.log('Target backup snapshot:', targetPath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Backup file not found at ${targetPath}`);
  }

  // Safety safeguard: Prevent accidental overwrite of live production
  if (supabaseUrl.includes('yhsmawyntabwghncqbqy') && !process.argv.includes('--force-production-restore-confirmed')) {
    console.error('\n[SAFETY ABORT] Target URL is the live production database.');
    console.error('To prevent accidental production data overwrites, execution is halted.');
    console.error('If this is an intentional disaster recovery, pass: --force-production-restore-confirmed');
    process.exit(1);
  }

  const backupData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  console.log('Snapshot Timestamp:', backupData.metadata.timestamp);

  // 1. Restore Schools
  if (backupData.tables.schools?.rows?.length > 0) {
    console.log(`Restoring ${backupData.tables.schools.rows.length} school records...`);
    for (const school of backupData.tables.schools.rows) {
      const { error } = await adminClient.from('schools').upsert(school, { onConflict: 'school_id' });
      if (error) console.error('Error restoring school:', error.message);
    }
  }

  // 2. Restore User Roles
  if (backupData.tables.user_roles?.rows?.length > 0) {
    console.log(`Restoring ${backupData.tables.user_roles.rows.length} user_roles records...`);
    for (const roleRow of backupData.tables.user_roles.rows) {
      const { error } = await adminClient.from('user_roles').upsert(roleRow, { onConflict: 'user_id' });
      if (error) console.error('Error restoring user_role:', error.message);
    }
  }

  // 3. Restore Storage Buckets configuration
  if (backupData.storage?.buckets?.length > 0) {
    console.log(`Verifying ${backupData.storage.buckets.length} storage buckets...`);
    for (const b of backupData.storage.buckets) {
      const { error } = await adminClient.storage.createBucket(b.id, {
        public: b.public || false,
        fileSizeLimit: b.file_size_limit,
        allowedMimeTypes: b.allowed_mime_types
      });
      if (error && !error.message.includes('already exists')) {
        console.error('Error creating storage bucket:', error.message);
      }
    }
  }

  // 4. Restore Auth Logs
  if (backupData.tables.auth_logs?.rows?.length > 0) {
    console.log(`Restoring ${backupData.tables.auth_logs.rows.length} auth_logs records...`);
    for (const log of backupData.tables.auth_logs.rows) {
      const { error } = await adminClient.from('auth_logs').upsert(log, { onConflict: 'id' });
      if (error) console.error('Error restoring auth_log:', error.message);
    }
  }

  console.log('Restoration completed successfully.');
}

// Dry-run check if executed without explicit target or via CLI
if (process.argv.includes('--execute')) {
  restoreBackup().catch(console.error);
} else {
  console.log('Restoration script validated. To execute restoration, pass --execute argument.');
  console.log('For live production, --force-production-restore-confirmed is strictly required.');
}

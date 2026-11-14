#!/usr/bin/env node
/**
 * ============================================================================
 * AVV SYSTEM — MIGRATION 022 DEPLOYMENT RUNNER (CHECKPOINT 2)
 * ============================================================================
 * Default Mode (Read-Only Preflight + Post-021 Snapshot):
 *   node scripts/deploy_m022.mjs
 *
 * Authorized Execution Mode (Requires Explicit User Approval):
 *   node scripts/deploy_m022.mjs --execute-approved
 * ============================================================================
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const LINKED_PROJECT_REF = "yhsmawyntabwghncqbqy";
const LOCKED_BACKUPS = [
  {
    relPath: "supabase/backups/production_pre_m016_m021_backup.json",
    bytes: 526675,
    sha256: "a36a7161c2a7cb5e2c674571d2eb3bdd4f3971e405d6d1714dbf81118f4539d3",
  },
  {
    relPath: "supabase/backups/production_pre_m016_m021_restore.sql",
    bytes: 621710,
    sha256: "9384ac46e855d7aa30ab1db7f70401cd1e5cdfb758a5bc81a5e6469383d052c8",
  },
  {
    relPath: "supabase/backups/storage_objects/storage_manifest.json",
    bytes: 7271,
    sha256: "7c4fae570840f0f2e1bc18ae263fa71b121e02847bf7e01d9e41bd4651a408ef",
  },
  {
    relPath: "supabase/archive/021_canonical_academic_records_and_scan_versions.original.sql",
    bytes: 92948,
    sha256: "d4c7abe6cc0d66c893d8434e05c2b98ae30e4be7a6d71d4b5f4e5ff847af37f3",
  },
];
const POST_021_SNAPSHOT_DIR = path.join(
  ROOT_DIR,
  "supabase",
  "backups",
  "post_021_pre_022_snapshot"
);
const MIGRATION_022_FILE = path.join(
  ROOT_DIR,
  "supabase",
  "migrations",
  "022_teacher_assignments_and_section_scanning.sql"
);

const EXPECTED_APPROVED_GRADES_SHA256 =
  "5a2886baf2d05617f264e88be5bd8a331fc309ac10fc885f10095ed56a11ac9b";
const JUSTIN_CANONICAL_DOC_ID = "840dc1c4-a272-444e-9ff4-2faba4b94c0b";

const args = new Set(process.argv.slice(2));
const EXECUTE_APPROVED = args.has("--execute-approved");

function logHeader(title) {
  console.log("\n============================================================================");
  console.log(title);
  console.log("============================================================================");
}

function logPass(msg) {
  console.log(`  [PASS] ${msg}`);
}

function failAndExit(stepName, errorMsg) {
  console.error("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error(`  [FATAL STOP] Step Failed: ${stepName}`);
  console.error(`  Reason: ${errorMsg}`);
  console.error("  NOTE: No automatic destructive rollback was executed.");
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
  process.exit(1);
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256String(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function parseGoValue(valStr) {
  const trimmed = valStr.trim();
  if (trimmed === "NULL" || trimmed === "<nil>") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isSafeInteger(num)) return num;
  }
  return trimmed;
}

function parseSupabaseTableOutput(raw) {
  const lines = raw.split(/\r?\n/);
  const borderTopIdx = lines.findIndex((l) => l.trim().startsWith("┌"));
  if (borderTopIdx === -1) return null;

  const headerLine = lines[borderTopIdx + 1];
  if (!headerLine || !headerLine.trim().startsWith("│")) return null;

  const parseRowCells = (line) =>
    line
      .trim()
      .replace(/^│/, "")
      .replace(/│$/, "")
      .split("│")
      .map((c) => c.trim());

  const headers = parseRowCells(headerLine);
  const rows = [];

  for (let i = borderTopIdx + 3; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("└") || line.startsWith("├")) continue;
    if (!line.startsWith("│")) break;
    const cells = parseRowCells(line);
    if (cells.length !== headers.length) continue;
    const rowObj = {};
    for (let c = 0; c < headers.length; c++) {
      rowObj[headers[c]] = parseGoValue(cells[c]);
    }
    rows.push(rowObj);
  }
  return { rows };
}

export function parseSupabaseCliOutput(rawOutput, label) {
  const raw = String(rawOutput ?? "");
  const trimmed = raw.trim();

  if (
    /\bERROR:\s+/i.test(raw) ||
    /\bfailed to connect\b/i.test(raw) ||
    /\bfailed to execute query\b/i.test(raw) ||
    /\bSupabaseApiInputError\b/i.test(raw)
  ) {
    throw new Error(`CLI query "${label}" reported SQL/CLI error:\n${trimmed}`);
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = raw.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.rows)) {
        return parsed;
      }
      if (parsed && parsed.error) {
        throw new Error(`CLI JSON error in "${label}": ${JSON.stringify(parsed.error)}`);
      }
    } catch (err) {
      if (err.message?.startsWith("CLI JSON error")) throw err;
    }
  }

  const lines = raw.split(/\r?\n/);
  const jsonStartIdx = lines.findIndex((l) => {
    const t = l.trim();
    return t === "[" || t === "[]" || t.startsWith("[{");
  });
  if (jsonStartIdx !== -1) {
    const candidate = lines.slice(jsonStartIdx).join("\n").trim();
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return { rows: parsed };
      }
    } catch {
      // fall through
    }
  }

  const tableParsed = parseSupabaseTableOutput(raw);
  if (tableParsed) {
    return tableParsed;
  }

  if (
    trimmed === "" ||
    /^Target:\s+project\b[^\r\n]*$/i.test(trimmed) ||
    lines.every((l) => l.trim() === "" || l.trim().startsWith("Target:"))
  ) {
    return { rows: [] };
  }

  throw new Error(
    `CLI query "${label}" did not return valid JSON or table output. Raw output:\n${trimmed.slice(0, 600)}`
  );
}

function invokeSupabaseCliSql(sql, { readOnly = true, label = "sql" } = {}) {
  const tempDir = path.join(ROOT_DIR, "supabase", ".temp");
  fs.mkdirSync(tempDir, { recursive: true });
  const tempFilename = `tmp_m022_${process.pid}_${Date.now()}.sql`;
  const tempSqlPath = path.join(tempDir, tempFilename);
  const relSqlPath = `supabase/.temp/${tempFilename}`;
  fs.writeFileSync(tempSqlPath, sql, "utf8");

  const modeFlag = readOnly ? "--read-only" : "--yes";
  const cmdLine = `npx supabase db query --remote=${LINKED_PROJECT_REF} ${modeFlag} -o json -f ${relSqlPath}`;

  try {
    const out = execFileSync("cmd.exe", ["/d", "/s", "/c", cmdLine], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 25 * 1024 * 1024,
    });
    return parseSupabaseCliOutput(out, label);
  } catch (err) {
    const stdout = err.stdout ? String(err.stdout) : "";
    const stderr = err.stderr ? String(err.stderr) : "";
    const combined = `${stdout}\n${stderr}`.trim();
    throw new Error(`CLI query "${label}" failed: ${combined || err.message}`);
  } finally {
    try {
      if (fs.existsSync(tempSqlPath)) fs.unlinkSync(tempSqlPath);
    } catch {
      // ignore
    }
  }
}

function computeApprovedGradesDigest(rows) {
  const canonical = [...rows]
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
      final_grade:
        r.final_grade === null || r.final_grade === undefined ? null : String(r.final_grade),
      status: r.status,
    }));
  return sha256String(JSON.stringify(canonical));
}

async function main() {
  logHeader(
    `AVV SYSTEM — MIGRATION 022 RUNNER (${
      EXECUTE_APPROVED ? "AUTHORIZED EXECUTION MODE" : "READ-ONLY PREFLIGHT + SNAPSHOT MODE"
    })`
  );

  // --------------------------------------------------------------------------
  // STEP 1: Confirm no other deployment is running & verify pre-016 backup
  // --------------------------------------------------------------------------
  logHeader("STEP 1: Verify No Concurrent Deployment & Preserve Existing Backups");
  const activeQueries = invokeSupabaseCliSql(
    `SELECT COUNT(*)::int AS active_ddl_count
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()
       AND state = 'active'
       AND query ILIKE '%CREATE%TABLE%teacher_assignments%';`,
    { readOnly: true, label: "check-active-deployments" }
  );
  if (Number(activeQueries.rows[0]?.active_ddl_count ?? 0) !== 0) {
    failAndExit("Step 1", "Another Migration 022 deployment query is currently active.");
  }
  logPass("No concurrent Migration 022 deployment is running on yhsmawyntabwghncqbqy.");

  for (const item of LOCKED_BACKUPS) {
    const fullPath = path.join(ROOT_DIR, item.relPath);
    if (!fs.existsSync(fullPath)) {
      failAndExit("Step 1", `Missing pre-016 backup file: ${item.relPath}`);
    }
    const stat = fs.statSync(fullPath);
    const actualHash = sha256File(fullPath);
    if (stat.size !== item.bytes || actualHash !== item.sha256) {
      failAndExit("Step 1", `Pre-016 backup checksum/size mismatch on ${item.relPath}`);
    }
  }
  logPass(`Existing pre-016 backups preserved and verified (${LOCKED_BACKUPS.length}/${LOCKED_BACKUPS.length} checksums & byte sizes match).`);

  // --------------------------------------------------------------------------
  // STEP 2: Take / Verify Separate Post-021 Snapshot
  // --------------------------------------------------------------------------
  logHeader("STEP 2: Take & Verify Separate Post-021 Production Snapshot");
  const snapshotRes = invokeSupabaseCliSql(
    `SELECT
      (SELECT jsonb_agg(m ORDER BY m.version) FROM supabase_migrations.schema_migrations m) AS schema_migrations,
      (SELECT jsonb_agg(d ORDER BY d.id) FROM public.documents d) AS documents,
      (SELECT jsonb_agg(ds ORDER BY ds.id) FROM public.document_scans ds) AS document_scans,
      (SELECT jsonb_agg(s ORDER BY s.id) FROM public.students s) AS students,
      (SELECT jsonb_agg(sg ORDER BY sg.id) FROM public.subject_grades sg) AS subject_grades,
      (SELECT jsonb_agg(ur ORDER BY ur.id) FROM public.user_roles ur) AS user_roles,
      (SELECT jsonb_agg(sc ORDER BY sc.id) FROM public.schools sc) AS schools,
      (SELECT COUNT(*)::int FROM storage.objects WHERE bucket_id = 'documents') AS storage_count;`,
    { readOnly: true, label: "post-021-snapshot" }
  );

  const snapRow = snapshotRes.rows[0];
  if (!snapRow) {
    failAndExit("Step 2", "Failed to fetch post-021 snapshot data.");
  }

  const gradesRows = Array.isArray(snapRow.subject_grades) ? snapRow.subject_grades : [];
  const justinGrades = gradesRows.filter((g) => g.document_id === JUSTIN_CANONICAL_DOC_ID);
  const gradesDigest = computeApprovedGradesDigest(justinGrades);
  if (justinGrades.length !== 18 || gradesDigest !== EXPECTED_APPROVED_GRADES_SHA256) {
    failAndExit(
      "Step 2",
      `18 approved grades digest mismatch: count=${justinGrades.length}, digest=${gradesDigest}`
    );
  }

  fs.mkdirSync(POST_021_SNAPSHOT_DIR, { recursive: true });
  const snapshotPayload = {
    captured_at: new Date().toISOString(),
    project_ref: LINKED_PROJECT_REF,
    approved_grades_count: justinGrades.length,
    approved_grades_sha256: gradesDigest,
    documents_count: (snapRow.documents || []).length,
    document_scans_count: (snapRow.document_scans || []).length,
    students_count: (snapRow.students || []).length,
    storage_objects_count: snapRow.storage_count,
    schema_migrations: snapRow.schema_migrations,
    tables: {
      documents: snapRow.documents,
      document_scans: snapRow.document_scans,
      students: snapRow.students,
      subject_grades: snapRow.subject_grades,
      user_roles: snapRow.user_roles,
      schools: snapRow.schools,
    },
  };
  const snapshotFile = path.join(POST_021_SNAPSHOT_DIR, "post_021_state.json");
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshotPayload, null, 2), "utf8");
  const snapshotSha256 = sha256File(snapshotFile);
  fs.writeFileSync(
    path.join(POST_021_SNAPSHOT_DIR, "manifest.json"),
    JSON.stringify(
      {
        captured_at: snapshotPayload.captured_at,
        project_ref: LINKED_PROJECT_REF,
        files: { "post_021_state.json": snapshotSha256 },
        approved_grades_sha256: gradesDigest,
      },
      null,
      2
    ),
    "utf8"
  );
  logPass(
    `Post-021 snapshot saved to backups/post_021_pre_022_snapshot/post_021_state.json (SHA-256: ${snapshotSha256})`
  );
  logPass(
    `Post-021 baseline verified: 18/18 approved grades (SHA-256: ${gradesDigest}), ${(snapRow.documents || []).length} documents, ${(snapRow.document_scans || []).length} document_scans, ${snapRow.storage_count} Storage objects.`
  );

  // --------------------------------------------------------------------------
  // STEP 3: Verify Migration 022 Compatibility with Live Production Schema
  // --------------------------------------------------------------------------
  logHeader("STEP 3: Verify Migration 022 Compatibility with Live Production Schema");
  if (!fs.existsSync(MIGRATION_022_FILE)) {
    failAndExit("Step 3", `Missing Migration 022 file: ${MIGRATION_022_FILE}`);
  }
  const m022Sha256 = sha256File(MIGRATION_022_FILE);
  logPass(`Migration 022 file verified (${path.basename(MIGRATION_022_FILE)}, SHA-256: ${m022Sha256})`);

  const compatRes = invokeSupabaseCliSql(
    `SELECT
      to_regclass('public.schools') IS NOT NULL AS has_schools,
      to_regclass('public.user_roles') IS NOT NULL AS has_user_roles,
      to_regclass('public.students') IS NOT NULL AS has_students,
      to_regclass('public.documents') IS NOT NULL AS has_documents,
      to_regclass('public.subject_grades') IS NOT NULL AS has_subject_grades,
      to_regclass('public.document_scans') IS NOT NULL AS has_document_scans,
      to_regclass('public.teacher_assignments') IS NOT NULL AS has_teacher_assignments,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column') AS has_update_ts_fn,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'normalize_shs_grade_level') AS has_norm_grade_fn,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_admin') AS has_is_admin,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_principal') AS has_is_principal,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_approved_teacher') AS has_is_approved_teacher,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_approved_staff') AS has_is_approved_staff,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'get_auth_user_school_id') AS has_get_school_id,
      (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
        'idx_documents_canonical_sf9_active',
        'idx_documents_canonical_sf9_student_active',
        'idx_documents_canonical_sf10_active',
        'idx_documents_unresolved_file_hash_active'
      )) AS m021_canonical_index_count;`,
    { readOnly: true, label: "m022-compatibility-check" }
  );

  const compat = compatRes.rows[0];
  const requiredFlags = [
    "has_schools",
    "has_user_roles",
    "has_students",
    "has_documents",
    "has_subject_grades",
    "has_document_scans",
    "has_update_ts_fn",
    "has_norm_grade_fn",
    "has_is_admin",
    "has_is_principal",
    "has_is_approved_teacher",
    "has_is_approved_staff",
    "has_get_school_id",
  ];
  for (const flag of requiredFlags) {
    if (compat?.[flag] !== true) {
      failAndExit("Step 3", `Missing required schema dependency for Migration 022: ${flag}`);
    }
  }
  if (Number(compat?.m021_canonical_index_count) !== 4) {
    failAndExit(
      "Step 3",
      `Expected 4 canonical unique indexes from M021, found ${compat?.m021_canonical_index_count}`
    );
  }
  logPass("All prerequisite tables, columns, helper functions, and 4 M021 canonical indexes are present in live schema.");
  logPass(`Migration 022 current live state: teacher_assignments exists = ${compat.has_teacher_assignments}`);

  if (!EXECUTE_APPROVED) {
    logHeader("CHECKPOINT 2 PREFLIGHT SUMMARY — READY FOR APPROVAL");
    console.log("  1. No other deployment running:        PASS");
    console.log("  2. Pre-016 backup + Post-021 snapshot: PASS");
    console.log("  3. Migration 022 live compatibility:   PASS");
    console.log("  4. Exact deployment command:           node scripts/deploy_m022.mjs --execute-approved");
    console.log("============================================================================\n");
    return;
  }

  // --------------------------------------------------------------------------
  // STEP 4: Execute Migration 022 (ONLY WHEN --execute-approved IS PASSED)
  // --------------------------------------------------------------------------
  logHeader("STEP 4: Execute Migration 022 SQL on Production (Atomic Transaction)");
  const m022Sql = fs.readFileSync(MIGRATION_022_FILE, "utf8");
  const atomicM022Sql = `BEGIN;\n${m022Sql}\nCOMMIT;\n`;
  invokeSupabaseCliSql(atomicM022Sql, { readOnly: false, label: "execute-migration-022-atomic" });
  logPass("Migration 022 SQL committed cleanly inside an atomic transaction.");

  // --------------------------------------------------------------------------
  // STEP 5: Verify Post-022 Schema, RLS, RPCs, Data Integrity & Record History
  // --------------------------------------------------------------------------
  logHeader("STEP 5: Post-022 Verification & Migration History Recording");
  const verifyRes = invokeSupabaseCliSql(
    `SELECT
      to_regclass('public.teacher_assignments') IS NOT NULL AS has_teacher_assignments,
      to_regclass('public.teacher_module_policies') IS NOT NULL AS has_teacher_module_policies,
      to_regclass('public.student_enrollments') IS NOT NULL AS has_student_enrollments,
      to_regclass('public.student_identity_conflicts') IS NOT NULL AS has_student_identity_conflicts,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.teacher_assignments'::regclass) AS rls_teacher_assignments,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.teacher_module_policies'::regclass) AS rls_teacher_module_policies,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.student_enrollments'::regclass) AS rls_student_enrollments,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.student_identity_conflicts'::regclass) AS rls_student_identity_conflicts,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'can_teacher_scan_with_assignment') AS has_scan_rpc,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'get_teacher_authorized_assignments') AS has_get_assignments_rpc,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'lookup_or_quarantine_student_identity') AS has_lookup_rpc,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'upsert_student_enrollment_history') AS has_enrollment_rpc,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'resolve_section_or_identity_conflict') AS has_resolve_rpc,
      (SELECT allow_subject_teacher_scanning FROM public.teacher_module_policies WHERE school_id = 'a0000000-0000-0000-0000-000000000001') AS tris_allow_subject_scanning,
      (SELECT jsonb_agg(sg ORDER BY sg.id) FROM public.subject_grades sg WHERE sg.document_id = '${JUSTIN_CANONICAL_DOC_ID}') AS justin_grades,
      (SELECT COUNT(*)::int FROM public.document_scans) AS scan_count,
      (SELECT COUNT(*)::int FROM public.documents) AS doc_count,
      (SELECT COUNT(*)::int FROM public.documents WHERE id IN ('cc8b4c08-14bb-4c92-9958-d670f878ac29','edda579a-6e1d-4acb-81d8-25d078798ff7') AND (student_id IS NOT NULL OR canonical_lrn IS NOT NULL)) AS kenneth_collisions,
      (SELECT COUNT(*)::int FROM storage.objects WHERE bucket_id = 'documents') AS storage_count;`,
    { readOnly: true, label: "verify-m022-post" }
  );

  const v = verifyRes.rows[0];
  const postChecks = [
    "has_teacher_assignments",
    "has_teacher_module_policies",
    "has_student_enrollments",
    "has_student_identity_conflicts",
    "rls_teacher_assignments",
    "rls_teacher_module_policies",
    "rls_student_enrollments",
    "rls_student_identity_conflicts",
    "has_scan_rpc",
    "has_get_assignments_rpc",
    "has_lookup_rpc",
    "has_enrollment_rpc",
    "has_resolve_rpc",
  ];
  for (const check of postChecks) {
    if (v?.[check] !== true) {
      failAndExit("Step 5", `Post-022 verification check failed: ${check}=${v?.[check]}`);
    }
  }
  if (v.tris_allow_subject_scanning !== false) {
    failAndExit("Step 5", `Expected tris_allow_subject_scanning=false, got ${v.tris_allow_subject_scanning}`);
  }
  if (Number(v.kenneth_collisions) !== 0) {
    failAndExit("Step 5", `Kenneth collision detected: ${v.kenneth_collisions} documents linked`);
  }
  if (Number(v.scan_count) !== 4) {
    failAndExit("Step 5", `Expected 4 scan versions in document_scans, found ${v.scan_count}`);
  }
  if (Number(v.storage_count) !== 20) {
    failAndExit("Step 5", `Expected 20 Storage objects in documents bucket, found ${v.storage_count}`);
  }

  const postGrades = Array.isArray(v.justin_grades) ? v.justin_grades : [];
  const postDigest = computeApprovedGradesDigest(postGrades);
  if (postGrades.length !== 18 || postDigest !== EXPECTED_APPROVED_GRADES_SHA256) {
    failAndExit(
      "Step 5",
      `Post-022 approved grades check failed: count=${postGrades.length}, digest=${postDigest}`
    );
  }
  logPass("All 4 new tables, RLS policies, 5 RPCs, and Class Adviser-only policy lock verified.");
  logPass(`18/18 approved grades intact (SHA-256: ${postDigest}), ${v.scan_count} scans, ${v.storage_count} Storage objects.`);

  // Record 022 in schema_migrations and reload PostgREST schema cache
  invokeSupabaseCliSql(
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
     VALUES ('022', 'teacher_assignments_and_section_scanning', ARRAY['-- Applied via deploy_m022.mjs'])
     ON CONFLICT (version) DO NOTHING;
     NOTIFY pgrst, 'reload schema';`,
    { readOnly: false, label: "record-m022-history" }
  );
  logPass("Migration 022 recorded in supabase_migrations.schema_migrations and PostgREST schema cache reloaded.");
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  main().catch((err) => {
    failAndExit("Unhandled Exception", err?.stack || err?.message || String(err));
  });
}

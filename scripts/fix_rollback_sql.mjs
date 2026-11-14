import fs from "node:fs";
import path from "node:path";

const mig010Path = path.resolve(process.cwd(), "supabase", "migrations", "010_strengthened_shs_metadata.sql");
const mig010 = fs.readFileSync(mig010Path, "utf-8");
const lines = mig010.split("\n");
const startIdx = lines.findIndex(l => l.includes("CREATE OR REPLACE FUNCTION public.process_approved_document()"));
const endIdx = lines.findIndex((l, idx) => idx > startIdx && l.includes("GRANT EXECUTE ON FUNCTION public.process_approved_document()"));

const fnCode = lines.slice(startIdx, endIdx + 1).join("\n");

const header = `-- ==============================================================================
-- Migration 015 Rollback: Revert LRN Deduplication & Grade Update Changes
-- ==============================================================================
-- Purpose:
--   Safely reverts Migration 015 changes back to Migration 010/014 state without
--   data corruption or dropping pre-existing core tables.
-- ==============================================================================

BEGIN;

-- 1. Drop duplicate students reporting view
DROP VIEW IF EXISTS public.v_duplicate_students_report;

-- 2. Drop lookup_student_by_lrn function
DROP FUNCTION IF EXISTS public.lookup_student_by_lrn(text, uuid);

-- 3. Drop grade_change_history table
DROP TABLE IF EXISTS public.grade_change_history CASCADE;

-- 4. Drop composite unique index on subject_grades
DROP INDEX IF EXISTS public.idx_subject_grades_composite_active;

-- 5. Drop normalized unique index on students
DROP INDEX IF EXISTS public.idx_students_normalized_lrn;

-- 6. Drop LRN check constraint on students
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS chk_students_lrn_format;

-- 7. Restore Migration 010 process_approved_document() trigger function
`;

const finalSql = header + "\n" + fnCode + "\n\nCOMMIT;\n";
const rollbackPath = path.resolve(process.cwd(), "supabase", "migrations", "015_rollback_recovery.sql");
fs.writeFileSync(rollbackPath, finalSql, "utf-8");
console.log("015_rollback_recovery.sql fixed! Length:", finalSql.length);

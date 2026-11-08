-- ==============================================================================
-- NON-DESTRUCTIVE RECOVERY & FEATURE DEACTIVATION PLAN FOR MIGRATION 013
-- Institution: Taysan Resettlement Integrated School (TRIS) - DepEd School ID: 300792
-- ==============================================================================
--
-- PRINCIPLE OF DATA PRESERVATION:
-- Under no circumstances will a production recovery script automatically DROP populated
-- learner tables (attendance_records, attendance_summaries, remedial_records).
-- This script provides a safe, 3-tier disaster recovery procedure:
--
-- TIER 1: Non-destructive Feature Deactivation (Preserves all existing data).
-- TIER 2: Safe Table Archival / Data Snapshotting (Optional before structural resets).
-- TIER 3: Pre-Deployment Transaction Abort Guidance.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- TIER 1: NON-DESTRUCTIVE FEATURE DEACTIVATION
-- ------------------------------------------------------------------------------
-- If Migration 013 needs to be deactivated without deleting any existing records:
-- 1. Drops the RLS policies so client applications cannot write unverified rows.
-- 2. Restricts SELECT exclusively to service_role and administrator review.
-- 3. Keeps tables, existing learner rows, constraints, and audit trails 100% intact.

BEGIN;

-- 1. Drop active write policies
DROP POLICY IF EXISTS "Authorized insert attendance records" ON public.attendance_records;
DROP POLICY IF EXISTS "Authorized update attendance records" ON public.attendance_records;
DROP POLICY IF EXISTS "Authorized insert attendance summaries" ON public.attendance_summaries;
DROP POLICY IF EXISTS "Authorized update attendance summaries" ON public.attendance_summaries;
DROP POLICY IF EXISTS "Authorized insert remedial records" ON public.remedial_records;
DROP POLICY IF EXISTS "Authorized update remedial records" ON public.remedial_records;

-- 2. Restrict SELECT to Administrator and Service Role (Emergency Read-Only Mode)
DROP POLICY IF EXISTS "Authorized read attendance records" ON public.attendance_records;
CREATE POLICY "Authorized read attendance records" ON public.attendance_records
FOR SELECT TO authenticated USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authorized read attendance summaries" ON public.attendance_summaries;
CREATE POLICY "Authorized read attendance summaries" ON public.attendance_summaries
FOR SELECT TO authenticated USING (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authorized read remedial records" ON public.remedial_records;
CREATE POLICY "Authorized read remedial records" ON public.remedial_records
FOR SELECT TO authenticated USING (public.is_admin() OR auth.role() = 'service_role');

COMMIT;

-- ------------------------------------------------------------------------------
-- TIER 2: EMERGENCY DATA SNAPSHOT (RUN ONLY IF EXPLICIT STRUCTURAL RESET IS REQUIRED)
-- ------------------------------------------------------------------------------
-- If an authorized DBA must reset table schemas, run this snapshot first to create
-- persistent backup copies with timestamp suffixes before any table drop:
--
-- CREATE TABLE IF NOT EXISTS public.backup_attendance_records_20261108 AS TABLE public.attendance_records;
-- CREATE TABLE IF NOT EXISTS public.backup_attendance_summaries_20261108 AS TABLE public.attendance_summaries;
-- CREATE TABLE IF NOT EXISTS public.backup_remedial_records_20261108 AS TABLE public.remedial_records;
--
-- ------------------------------------------------------------------------------
-- TIER 3: PRE-DEPLOYMENT TRANSACTION ABORT GUIDANCE
-- ------------------------------------------------------------------------------
-- Migration 013 is wrapped in a PostgreSQL transaction block (BEGIN ... COMMIT).
-- If any DDL error occurs during execution, PostgreSQL automatically issues a
-- complete ROLLBACK, leaving the pre-existing schema and data completely untouched.

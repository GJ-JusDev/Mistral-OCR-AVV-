-- ==============================================================================
-- AVV — Automated Visual Validation System
-- Migration 009 (Step 1 of 2): Add 'principal' role to user_role enum
-- 
-- TARGET: Taysan Resettlement Integrated School (TRIS)
-- 
-- TRANSACTION BOUNDARY NOTE:
-- In PostgreSQL, ALTER TYPE ... ADD VALUE cannot be executed inside a transaction
-- block that immediately uses the newly added enum value in functions, checks,
-- or table constraints (PostgreSQL Error 55P04: unsafe use of new value).
-- 
-- EXECUTION INSTRUCTION:
-- 1. Execute this file in the Supabase SQL Editor.
-- 2. Confirm execution succeeded.
-- 3. Proceed to execute 009_step2_consolidated_schema_and_security.sql.
-- ==============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'principal';

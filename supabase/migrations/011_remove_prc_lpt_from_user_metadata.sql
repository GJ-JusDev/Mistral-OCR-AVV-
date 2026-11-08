-- Migration 011: Remove legacy PRC/LPT information from user metadata
-- Description: Cleans up obsolete 'prc' and 'lpt_info' keys from auth.users.raw_user_meta_data.
-- 
-- IMPORTANT:
-- In the AVV system, LPT/PRC was never stored in a separate table column, constraint, or foreign key.
-- It was stored solely as a JSONB field inside Supabase Auth (auth.users.raw_user_meta_data).
-- Omitting it from registration does not require altering public tables or RLS policies.
--
-- This migration is forward-only and non-destructive to user identity, passwords, and assigned roles.
-- Do not run in production without administrator authorization.

-- 1. Forward Migration (Cleanup obsolete metadata keys)
UPDATE auth.users
SET raw_user_meta_data = (raw_user_meta_data - 'prc' - 'lpt_info')
WHERE raw_user_meta_data ? 'prc' OR raw_user_meta_data ? 'lpt_info';

-- 2. Verification query
-- SELECT id, email, raw_user_meta_data FROM auth.users WHERE raw_user_meta_data ? 'prc' OR raw_user_meta_data ? 'lpt_info';
-- Expected result: 0 rows.

-- Migration: Update lpt_info to prc in user metadata
-- Description: Renames the lpt_info key to prc and formats the value to be exactly 7 digits.

UPDATE auth.users
SET raw_user_meta_data = 
  (raw_user_meta_data - 'lpt_info') || 
  jsonb_build_object(
    'prc', 
    -- 1. Extract only numbers from the old lpt_info
    -- 2. If it's empty or null after removing non-numbers, treat it as empty string
    -- 3. Pad with leading zeros up to 7 characters
    -- 4. Truncate to exactly 7 characters (if the original had more than 7 digits)
    LEFT(LPAD(COALESCE(REGEXP_REPLACE(raw_user_meta_data->>'lpt_info', '[^0-9]', '', 'g'), ''), 7, '0'), 7)
  )
WHERE raw_user_meta_data ? 'lpt_info';

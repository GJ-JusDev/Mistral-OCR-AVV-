-- ==============================================================================
-- Migration 020: Add Faculty Approval and Decline Tracking Columns to user_roles
-- ==============================================================================
-- Purpose:
-- Fixes "Could not find the 'approval_method' column of 'user_roles' in the schema cache"
-- error during administrative faculty authorization.
-- Provides forward-only, idempotent schema compatibility for the faculty approval workflow.
-- ==============================================================================

DO $$
BEGIN
    -- 1. approval_method
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'approval_method'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN approval_method TEXT;
        ALTER TABLE public.user_roles ADD CONSTRAINT chk_user_roles_approval_method 
            CHECK (approval_method IS NULL OR approval_method IN ('MANUAL_EARLY', 'AUTOMATIC', 'MANUAL_STANDARD', 'MANUAL'));
    END IF;

    -- 2. approval_reason
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'approval_reason'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN approval_reason TEXT;
    END IF;

    -- 3. approved_by
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;

    -- 4. approved_at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;

    -- 5. decline_reason
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'decline_reason'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN decline_reason TEXT;
    END IF;

    -- 6. declined_by
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'declined_by'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN declined_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;

    -- 7. declined_at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'declined_at'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN declined_at TIMESTAMPTZ;
    END IF;

    -- 8. registration_timestamp
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'registration_timestamp'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN registration_timestamp TIMESTAMPTZ DEFAULT now();
    END IF;

    -- 9. review_eligibility_time
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'review_eligibility_time'
    ) THEN
        ALTER TABLE public.user_roles ADD COLUMN review_eligibility_time TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours');
    END IF;
END $$;

-- Create performance index for pending eligibility queries if not already present
CREATE INDEX IF NOT EXISTS idx_user_roles_eligibility
ON public.user_roles (account_status, review_eligibility_time)
WHERE account_status = 'Pending';

-- Instruct PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';

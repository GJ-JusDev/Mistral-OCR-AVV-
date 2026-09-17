-- Create a function to get all users for admins
CREATE OR REPLACE FUNCTION get_all_users_for_admin()
RETURNS TABLE (
    id uuid,
    email text,
    raw_user_meta_data jsonb,
    created_at timestamptz,
    role public.user_role
) AS $$
BEGIN
    -- Check if the current user is an admin
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    RETURN QUERY
    SELECT 
        u.id, 
        u.email::text, 
        u.raw_user_meta_data, 
        u.created_at,
        r.role
    FROM auth.users u
    LEFT JOIN public.user_roles r ON u.id = r.user_id
    ORDER BY u.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to approve a user
CREATE OR REPLACE FUNCTION approve_user(target_user_id uuid)
RETURNS void AS $$
BEGIN
    -- Check if the current user is an admin
    IF NOT EXISTS (
        SELECT 1 FROM public.user_roles 
        WHERE user_id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Update the user metadata account_status to Approved
    UPDATE auth.users
    SET raw_user_meta_data = jsonb_set(
        COALESCE(raw_user_meta_data, '{}'::jsonb),
        '{account_status}',
        '"Approved"'
    )
    WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

import { Database } from './src/lib/supabase/types'; type UR = Database['public']['Tables']['user_roles']; export type X = UR['Row']['role'];

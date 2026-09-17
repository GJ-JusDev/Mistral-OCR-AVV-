"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function getUsers() {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  
  if (!user) return { error: "Unauthorized" };
  
  const { data: roleData } = await serverClient
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleData?.role !== "admin") {
    return { error: "Forbidden" };
  }

  const adminClient = getAdminClient();
  const { data: usersData, error } = await adminClient.auth.admin.listUsers();
  
  if (error) {
    // Fallback if admin API fails (e.g. no service key in dev) - return mock or empty
    console.error("Error fetching users. Make sure SUPABASE_SERVICE_ROLE_KEY is set.", error);
    return { users: [] };
  }

  return { users: usersData.users };
}

export async function approveUser(userId: string) {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  
  if (!user) return { error: "Unauthorized" };
  
  const { data: roleData } = await serverClient
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (roleData?.role !== "admin") {
    return { error: "Forbidden" };
  }

  const adminClient = getAdminClient();
  const { data: targetUser, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
  
  if (getUserError || !targetUser?.user) {
    return { error: "User not found" };
  }

  const currentMetadata = targetUser.user.user_metadata || {};
  
  const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...currentMetadata,
      account_status: "Approved"
    }
  });

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath("/admin/users");
  return { success: true };
}

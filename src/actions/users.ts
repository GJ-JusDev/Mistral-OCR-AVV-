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
  
  const role1 = user.user_metadata?.role?.toLowerCase();
  if (role1 !== "admin") {
    return { error: "Forbidden" };
  }

  const adminClient = getAdminClient();
  const { data: usersData, error } = await adminClient.auth.admin.listUsers();
  
  if (error) {
    // Fallback if admin API fails (e.g. no service key in dev) - return mock or empty
    console.error("Error fetching users. Make sure SUPABASE_SERVICE_ROLE_KEY is set.", error);
    return { users: [] };
  }

  const safeUsers = usersData.users.map(u => {
    if (u.user_metadata?.prc) {
      const { prc, ...restMeta } = u.user_metadata;
      return { ...u, user_metadata: { ...restMeta, has_prc: true } };
    }
    return u;
  });

  return { users: safeUsers };
}

export async function verifyAndRevealPrc(targetUserId: string, adminPassword: string) {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  
  if (!user) return { error: "Unauthorized" };
  
  const role = user.user_metadata?.role?.toLowerCase();
  if (role !== "admin") return { error: "Forbidden" };

  // Verify password by attempting to sign in using a non-persisted client
  const verifyClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, 
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  
  const { error: signInError } = await verifyClient.auth.signInWithPassword({
    email: user.email!,
    password: adminPassword,
  });

  if (signInError) {
    return { error: "Incorrect password" };
  }

  // Get the target user's actual PRC ID
  const adminClient = getAdminClient();
  const { data: targetUser, error: getUserError } = await adminClient.auth.admin.getUserById(targetUserId);

  if (getUserError || !targetUser?.user) {
    return { error: "User not found" };
  }

  return { prc: targetUser.user.user_metadata?.prc };
}
export async function approveUser(userId: string) {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  
  if (!user) return { error: "Unauthorized" };
  
  const role2 = user.user_metadata?.role?.toLowerCase();
  if (role2 !== "admin") {
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

export async function declineUser(userId: string) {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  
  if (!user) return { error: "Unauthorized" };
  
  const role = user.user_metadata?.role?.toLowerCase();
  if (role !== "admin") {
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
      account_status: "Declined"
    }
  });

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath("/admin/users");
  return { success: true };
}

export async function verifyAdminPassword(adminPassword: string) {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { error: "Unauthorized" };
  const role = user.user_metadata?.role?.toLowerCase();
  if (role !== "admin") return { error: "Forbidden" };

  const verifyClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, 
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  
  const { error: signInError } = await verifyClient.auth.signInWithPassword({
    email: user.email!,
    password: adminPassword,
  });

  if (signInError) {
    return { error: "Incorrect password" };
  }

  return { success: true };
}

export async function deleteUserAction(targetUserId: string, adminPassword: string) {
  const verifyRes = await verifyAdminPassword(adminPassword);
  if (verifyRes.error) return verifyRes;

  const adminClient = getAdminClient();
  const { error } = await adminClient.auth.admin.deleteUser(targetUserId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/users");
  return { success: true };
}

export async function updateUser(targetUserId: string, adminPassword: string, updates: {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  name_extension?: string;
  role?: string;
  prc?: string;
}) {
  const verifyRes = await verifyAdminPassword(adminPassword);
  if (verifyRes.error) return verifyRes;

  const adminClient = getAdminClient();
  const { data: targetUser, error: getUserError } = await adminClient.auth.admin.getUserById(targetUserId);
  
  if (getUserError || !targetUser?.user) {
    return { error: "User not found" };
  }

  const currentMetadata = targetUser.user.user_metadata || {};
  
  // Filter out undefined values
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, v]) => v !== undefined)
  );

  const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    user_metadata: {
      ...currentMetadata,
      ...cleanUpdates,
    }
  });

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath("/admin/users");
  return { success: true };
}

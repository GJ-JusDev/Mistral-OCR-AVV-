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

/**
 * Fetch all active schools for admin assignment and school selection
 */
export async function getSchools() {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: roleRow } = await serverClient
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin" || roleRow?.account_status !== "Approved") {
    return { error: "Forbidden" };
  }

  const adminClient = getAdminClient();
  const { data: schools, error } = await adminClient
    .from("schools")
    .select("id, school_id, name, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching schools:", error.message);
    return { error: error.message };
  }

  return { schools: schools || [] };
}

export async function getUsers() {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  
  if (!user) return { error: "Unauthorized" };
  
  const { data: roleRow } = await serverClient
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin" || roleRow?.account_status !== "Approved") {
    return { error: "Forbidden" };
  }

  const adminClient = getAdminClient();
  const { data: usersData, error } = await adminClient.auth.admin.listUsers();
  
  if (error) {
    console.error("Error fetching users. Make sure SUPABASE_SERVICE_ROLE_KEY is set.", error);
    return { users: [] };
  }

  // Fetch authoritative user_roles records from database
  const { data: rolesData } = await adminClient
    .from("user_roles")
    .select("user_id, role, account_status, school_id, schools:school_id (name, school_id)");

  const roleMap = new Map((rolesData || []).map(r => [r.user_id, r]));

  const safeUsers = usersData.users.map(u => {
    const roleInfo = roleMap.get(u.id);
    const { prc, ...restMeta } = u.user_metadata || {};
    return {
      ...u,
      db_role: roleInfo?.role || u.user_metadata?.role || "Teacher",
      db_account_status: roleInfo?.account_status || u.user_metadata?.account_status || "Pending",
      school_id: roleInfo?.school_id || u.user_metadata?.school_id || null,
      school_name: (roleInfo?.schools as any)?.name || null,
      user_metadata: {
        ...restMeta,
        role: roleInfo?.role || u.user_metadata?.role || "Teacher",
        account_status: roleInfo?.account_status || u.user_metadata?.account_status || "Pending",
        has_prc: !!prc
      }
    };
  });

  return { users: safeUsers };
}

export async function verifyAndRevealPrc(targetUserId: string, adminPassword: string) {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  
  if (!user) return { error: "Unauthorized" };
  
  const { data: roleRow } = await serverClient
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin" || roleRow?.account_status !== "Approved") return { error: "Forbidden" };

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

  const adminClient = getAdminClient();
  const { data: targetUser, error: getUserError } = await adminClient.auth.admin.getUserById(targetUserId);

  if (getUserError || !targetUser?.user) {
    return { error: "User not found" };
  }

  return { prc: targetUser.user.user_metadata?.prc };
}

/**
 * Approve a pending staff account with explicit school assignment and role
 */
export async function approveUser(userId: string, schoolId: string, role: string = "teacher") {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  
  if (!user) return { error: "Unauthorized" };
  
  const { data: roleRow } = await serverClient
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin" || roleRow?.account_status !== "Approved") {
    return { error: "Forbidden: Only an approved administrator can approve staff accounts." };
  }

  if (!schoolId) {
    return { error: "School assignment is required to approve staff." };
  }

  const adminClient = getAdminClient();

  // Validate that the assigned school exists
  const { data: school, error: schoolErr } = await adminClient
    .from("schools")
    .select("id, name")
    .eq("id", schoolId)
    .maybeSingle();

  if (schoolErr || !school) {
    return { error: "Invalid school selected. School does not exist in system." };
  }

  // Validate role (Only teacher or principal can be assigned via staff approval)
  const roleLower = role.toLowerCase();
  const validRole = ["teacher", "principal"].includes(roleLower) ? roleLower : "teacher";

  const { data: targetUser, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
  if (getUserError || !targetUser?.user) {
    return { error: "User not found" };
  }

  const currentMetadata = targetUser.user.user_metadata || {};
  
  const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...currentMetadata,
      account_status: "Approved",
      role: validRole.charAt(0).toUpperCase() + validRole.slice(1),
      school_id: schoolId
    }
  });

  if (updateError) {
    return { error: updateError.message };
  }

  // Update authoritative status, role, and school assignment in database table public.user_roles
  const { error: roleDbErr } = await adminClient
    .from("user_roles")
    .update({ 
      account_status: "Approved",
      role: validRole,
      school_id: schoolId
    })
    .eq("user_id", userId);

  if (roleDbErr) {
    return { error: roleDbErr.message };
  }

  revalidatePath("/admin/users");
  return { success: true };
}

export async function declineUser(userId: string) {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  
  if (!user) return { error: "Unauthorized" };
  
  const { data: roleRow } = await serverClient
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin" || roleRow?.account_status !== "Approved") {
    return { error: "Forbidden: Only an approved administrator can decline registrations." };
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

  // Update authoritative status in database table public.user_roles
  await adminClient
    .from("user_roles")
    .update({ account_status: "Declined" })
    .eq("user_id", userId);

  revalidatePath("/admin/users");
  return { success: true };
}

export async function verifyAdminPassword(adminPassword: string) {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: roleRow } = await serverClient
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin" || roleRow?.account_status !== "Approved") return { error: "Forbidden" };

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

/**
 * Update user profile, role, and school assignment with server-side validation
 */
export async function updateUser(targetUserId: string, adminPassword: string, updates: {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  name_extension?: string;
  role?: string;
  prc?: string;
  school_id?: string;
}) {
  const verifyRes = await verifyAdminPassword(adminPassword);
  if (verifyRes.error) return verifyRes;

  const adminClient = getAdminClient();
  const { data: targetUser, error: getUserError } = await adminClient.auth.admin.getUserById(targetUserId);
  
  if (getUserError || !targetUser?.user) {
    return { error: "User not found" };
  }

  // Validate school_id if provided
  if (updates.school_id) {
    const { data: school, error: sErr } = await adminClient
      .from("schools")
      .select("id")
      .eq("id", updates.school_id)
      .maybeSingle();
    if (sErr || !school) {
      return { error: "Selected school does not exist." };
    }
  }

  // Validate role if provided (Allows Teacher, Principal, Admin)
  let normalizedRole: string | undefined;
  if (updates.role) {
    const rLower = updates.role.toLowerCase();
    if (!["teacher", "principal", "admin"].includes(rLower)) {
      return { error: "Invalid role specified. Must be Teacher, Principal, or Admin." };
    }
    normalizedRole = rLower;
  }

  const currentMetadata = targetUser.user.user_metadata || {};
  
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, v]) => v !== undefined)
  );

  const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
    user_metadata: {
      ...currentMetadata,
      ...cleanUpdates,
      ...(normalizedRole ? { role: normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1) } : {})
    }
  });

  if (updateError) {
    return { error: updateError.message };
  }

  // Synchronize authoritative role and school assignment in public.user_roles
  const roleUpdates: { role?: any; school_id?: any } = {};
  if (normalizedRole) roleUpdates.role = normalizedRole;
  if (updates.school_id !== undefined) roleUpdates.school_id = updates.school_id;
  
  if (Object.keys(roleUpdates).length > 0) {
    const { error: dbRoleErr } = await adminClient
      .from("user_roles")
      .update(roleUpdates)
      .eq("user_id", targetUserId);

    if (dbRoleErr) return { error: dbRoleErr.message };
  }

  revalidatePath("/admin/users");
  return { success: true };
}

/**
 * Authoritative Academic Standing Confirmation Action (Principal or Admin)
 */
export async function confirmAcademicStandingAction(
  studentId: string, 
  newStatus: "Passed" | "Failed" | "Needs Verification", 
  schoolYear: string, 
  notes?: string
) {
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { error } = await serverClient.rpc("confirm_student_academic_standing", {
    p_student_id: studentId,
    p_new_status: newStatus,
    p_school_year: schoolYear,
    p_notes: notes || null
  });

  if (error) {
    console.error("Error confirming student standing:", error.message);
    return { error: error.message };
  }

  revalidatePath("/students");
  return { success: true };
}

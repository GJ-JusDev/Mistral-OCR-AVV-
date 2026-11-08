"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/auditLogger";

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
    const meta = u.user_metadata || {};
    return {
      ...u,
      db_role: roleInfo?.role || meta.role || "Teacher",
      db_account_status: roleInfo?.account_status || meta.account_status || "Pending",
      school_id: roleInfo?.school_id || meta.school_id || null,
      school_name: (roleInfo?.schools as any)?.name || null,
      user_metadata: {
        ...meta,
        role: roleInfo?.role || meta.role || "Teacher",
        account_status: roleInfo?.account_status || meta.account_status || "Pending"
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

  // Audit PRC license verification and reveal event
  await logAuditEvent({
    category: "USER_MANAGEMENT",
    action: "USER_PRC_ACCESSED",
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    targetType: "user",
    targetId: targetUserId,
    reason: "Administrator verified identity and viewed PRC license",
  });

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

  const operationId = crypto.randomUUID();

  // Update authoritative status, role, and school assignment in database table public.user_roles
  const { error: roleDbErr } = await adminClient
    .from("user_roles")
    .update({ 
      account_status: "Approved",
      role: validRole,
      school_id: schoolId,
      updated_by: user.id,
      last_operation_id: operationId,
    })
    .eq("user_id", userId);

  if (roleDbErr) {
    return { error: roleDbErr.message };
  }

  // Audit account approval
  await logAuditEvent({
    requestId: operationId,
    category: "USER_MANAGEMENT",
    action: "ACCOUNT_APPROVED",
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    actorSchoolId: schoolId,
    actorSchoolName: school.name,
    targetType: "user",
    targetId: userId,
    targetLabel: `${targetUser.user.user_metadata?.first_name || ""} ${targetUser.user.user_metadata?.last_name || ""}`.trim() || targetUser.user.email,
    reason: `Administrator approved registration for ${validRole} at ${school.name}`,
    details: {
      previous_status: currentMetadata.account_status || "Pending",
      new_status: "Approved",
      assigned_role: validRole,
      assigned_school_id: schoolId,
      assigned_school_name: school.name,
    },
  });

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

  const operationId = crypto.randomUUID();

  // Update authoritative status in database table public.user_roles
  await adminClient
    .from("user_roles")
    .update({ 
      account_status: "Declined",
      updated_by: user.id,
      last_operation_id: operationId,
    })
    .eq("user_id", userId);

  // Audit account decline
  await logAuditEvent({
    requestId: operationId,
    category: "USER_MANAGEMENT",
    action: "ACCOUNT_DECLINED",
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    targetType: "user",
    targetId: userId,
    targetLabel: `${targetUser.user.user_metadata?.first_name || ""} ${targetUser.user.user_metadata?.last_name || ""}`.trim() || targetUser.user.email,
    reason: "Administrator declined staff account registration",
    details: {
      previous_status: currentMetadata.account_status || "Pending",
      new_status: "Declined",
    },
  });

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

/**
 * PAGBUBURA NG DECLINED TEACHER ACCOUNT (ADMIN ACTION)
 *
 * Bakit ito kailangan para sa User Management:
 * Pinapayagan ang Administrator na linisin ang mga tinanggihang registration request ng mga guro.
 *
 * Mahigpit na Security Invariants:
 * 1. Administrator Lamang: Naka-verify ang caller bilang "admin" at "Approved".
 * 2. Self-Deletion Prevention: Bawal burahin ng Admin ang sarili niyang account.
 * 3. Scope Restriction: Tanging Teacher na may "Declined" status lamang ang pwedeng tanggalin.
 * 4. Protected Accounts: Mahigpit na ipinagbabawal ang pagbura sa Pending, Approved, Principal, o Admin.
 * 5. Server-Side Supabase Admin API: Hindi kailanman inilalabas sa browser ang service role key.
 */
export async function deleteDeclinedUser(targetUserId: string) {
  if (!targetUserId || typeof targetUserId !== "string") {
    return { error: "Invalid user ID provided." };
  }

  // 1. Require an authenticated administrator
  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  // 2. Check the caller's actual role and approval status in Supabase
  const { data: callerRoleRow, error: callerRoleErr } = await serverClient
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerRoleErr || callerRoleRow?.role !== "admin" || callerRoleRow?.account_status !== "Approved") {
    return { error: "Forbidden: Only an approved administrator can delete accounts." };
  }

  // 5. Prevent administrators from deleting their own accounts
  if (targetUserId === user.id) {
    return { error: "Forbidden: Administrators cannot delete their own accounts." };
  }

  const adminClient = getAdminClient();

  // 6 & 7. Recheck authoritative target user role & status immediately before deletion
  const { data: targetRoleRow, error: targetRoleErr } = await adminClient
    .from("user_roles")
    .select("user_id, role, account_status")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (targetRoleErr || !targetRoleRow) {
    return { error: "Target user not found or has no role assignment in the system." };
  }

  const { data: targetAuthUser, error: authUserErr } = await adminClient.auth.admin.getUserById(targetUserId);
  if (authUserErr || !targetAuthUser?.user) {
    return { error: "User not found in authentication system." };
  }

  const targetRole = (targetRoleRow.role || "").toLowerCase();
  const targetStatus = targetRoleRow.account_status;

  // 3 & 4. Allow deletion ONLY when Role = Teacher and Status = Declined
  if (targetRole !== "teacher") {
    return { error: `Forbidden: Only teacher accounts can be deleted. Cannot delete account with role '${targetRoleRow.role}'.` };
  }

  if (targetStatus !== "Declined") {
    return { error: `Forbidden: Only Declined accounts can be deleted. Cannot delete account with status '${targetStatus}'.` };
  }

  // Phase 4: Database relationship and audit safety checks
  // Check documents
  const { count: docCount, error: docErr } = await adminClient
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("uploaded_by", targetUserId);

  if (docErr) {
    console.error("Error checking document dependencies:", docErr.message);
    return { error: "Database error verifying user document dependencies." };
  }

  if (docCount && docCount > 0) {
    return { 
      error: "Cannot delete account: User has associated academic document records. Permanent deletion is blocked to preserve school records. Deactivate the account instead." 
    };
  }

  // Check review logs
  const { count: reviewCount, error: reviewErr } = await adminClient
    .from("review_logs")
    .select("id", { count: "exact", head: true })
    .eq("reviewed_by", targetUserId);

  if (reviewErr) {
    console.error("Error checking review log dependencies:", reviewErr.message);
    return { error: "Database error verifying user review log dependencies." };
  }

  if (reviewCount && reviewCount > 0) {
    return { 
      error: "Cannot delete account: User has associated document review audit records. Permanent deletion is blocked to preserve audit history. Deactivate the account instead." 
    };
  }

  // Check academic standing history
  const { count: standingCount, error: standingErr } = await adminClient
    .from("academic_standing_history")
    .select("id", { count: "exact", head: true })
    .eq("confirmed_by", targetUserId);

  if (standingErr) {
    console.error("Error checking academic standing dependencies:", standingErr.message);
    return { error: "Database error verifying academic standing dependencies." };
  }

  if (standingCount && standingCount > 0) {
    return { 
      error: "Cannot delete account: User has associated academic standing audit records. Permanent deletion is blocked to preserve student academic records. Deactivate the account instead." 
    };
  }

  const operationId = crypto.randomUUID();

  // Explicitly attribute deletion to the authenticated admin before removal
  await adminClient
    .from("user_roles")
    .update({
      updated_by: user.id,
      last_operation_id: operationId,
    })
    .eq("user_id", targetUserId);

  // 8. Use Supabase Admin API only on the server to safely remove user
  const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(targetUserId);
  if (deleteAuthErr) {
    console.error("Error deleting user from auth:", deleteAuthErr.message);
    return { error: `Authentication deletion failed: ${deleteAuthErr.message}` };
  }

  // Ensure public.user_roles row is cleaned up (in case cascade did not trigger)
  const { error: deleteRoleErr } = await adminClient
    .from("user_roles")
    .delete()
    .eq("user_id", targetUserId);

  if (deleteRoleErr) {
    console.warn("Notice: user_roles cleanup error or already removed by cascade:", deleteRoleErr.message);
  }

  // Audit permanent account deletion
  await logAuditEvent({
    requestId: operationId,
    category: "USER_MANAGEMENT",
    action: "ACCOUNT_DELETED",
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    targetType: "user",
    targetId: targetUserId,
    targetLabel: `Teacher ID: ${targetUserId}`,
    reason: "Administrator permanently deleted declined teacher account",
    details: {
      deleted_role: targetRoleRow.role,
      deleted_status: targetRoleRow.account_status,
    },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

export async function deleteUserAction(targetUserId: string, adminPassword?: string) {
  if (adminPassword) {
    const verifyRes = await verifyAdminPassword(adminPassword);
    if (verifyRes.error) return verifyRes;
  }

  return deleteDeclinedUser(targetUserId);
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

  const serverClient = await createServerClient();
  const { data: { user } } = await serverClient.auth.getUser();

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
  const roleUpdates: { role?: any; school_id?: any; updated_by?: string; last_operation_id?: string } = {
    updated_by: user?.id,
    last_operation_id: crypto.randomUUID(),
  };
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

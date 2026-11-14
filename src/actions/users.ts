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
    .select(`
      user_id,
      role,
      account_status,
      school_id,
      registration_timestamp,
      review_eligibility_time,
      registry_match_status,
      matched_registry_id,
      approval_method,
      approval_reason,
      decline_reason,
      middle_name,
      middle_initial,
      has_no_middle_name,
      schools:school_id (name, school_id)
    `);

  const roleMap = new Map((rolesData || []).map(r => [r.user_id, r]));

  // Fetch registry records to enrich matched names
  const { data: registryList } = await adminClient
    .from("school_teacher_registry")
    .select("id, full_name_original, first_name, last_name, verification_status");
  const registryMap = new Map((registryList || []).map(r => [r.id, r]));

  const safeUsers = usersData.users.map(u => {
    const roleInfo = roleMap.get(u.id);
    const meta = u.user_metadata || {};
    const reg = roleInfo?.matched_registry_id ? registryMap.get(roleInfo.matched_registry_id) : null;

    return {
      ...u,
      email_confirmed: Boolean(u.email_confirmed_at),
      db_role: roleInfo?.role || meta.role || "Teacher",
      db_account_status: roleInfo?.account_status || meta.account_status || "Pending",
      school_id: roleInfo?.school_id || meta.school_id || null,
      school_name: (roleInfo?.schools as any)?.name || null,
      registration_timestamp: roleInfo?.registration_timestamp || u.created_at,
      review_eligibility_time: roleInfo?.review_eligibility_time || null,
      registry_match_status: roleInfo?.registry_match_status || null,
      matched_registry_id: roleInfo?.matched_registry_id || null,
      matched_teacher_name: reg?.full_name_original || null,
      matched_registry_status: reg?.verification_status || null,
      approval_method: roleInfo?.approval_method || null,
      approval_reason: roleInfo?.approval_reason || null,
      decline_reason: roleInfo?.decline_reason || null,
      middle_name: roleInfo?.middle_name || meta.middle_name || null,
      middle_initial: roleInfo?.middle_initial || null,
      has_no_middle_name: roleInfo?.has_no_middle_name || false,
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
 * Approve a pending staff account with explicit school assignment, role,
 * and optional early approval verification (admin re-auth, confirmation phrase, reason).
 */
export async function approveUser(
  userId: string, 
  schoolId: string, 
  role: string = "teacher",
  options?: {
    adminPassword?: string;
    confirmationPhrase?: string;
    justificationReason?: string;
    isEarlyApproval?: boolean;
  }
) {
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

  // Validate role
  const roleLower = role.toLowerCase();
  const validRole = ["teacher", "principal"].includes(roleLower) ? roleLower : "teacher";

  const { data: targetUser, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
  if (getUserError || !targetUser?.user) {
    return { error: "User not found" };
  }

  // Check email confirmation status (Phase E requirement)
  if (!targetUser.user.email_confirmed_at) {
    return { 
      error: "Cannot approve account: Applicant's email address has not been confirmed via Supabase Auth email verification." 
    };
  }

  // Fetch target user's current user_roles record
  const { data: targetRole } = await adminClient
    .from("user_roles")
    .select("account_status, review_eligibility_time, registry_match_status, matched_registry_id")
    .eq("user_id", userId)
    .maybeSingle();

  const isEarly = options?.isEarlyApproval || (
    targetRole?.review_eligibility_time && new Date(targetRole.review_eligibility_time) > new Date()
  );

  // If Early Approval, enforce strict re-authentication, confirmation phrase, and justification
  if (isEarly) {
    if (!options?.adminPassword) {
      return { error: "Administrator password is required for early approval." };
    }

    const pwCheck = await verifyAdminPassword(options.adminPassword);
    if ("error" in pwCheck && pwCheck.error) {
      await logAuditEvent({
        category: "USER_MANAGEMENT",
        action: "ACCOUNT_EARLY_APPROVAL_DENIED",
        outcome: "DENIED",
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: "admin",
        targetType: "user",
        targetId: userId,
        reason: "Early approval denied: Invalid administrator password re-authentication",
      });
      return { error: "Incorrect administrator password." };
    }

    if (options.confirmationPhrase?.trim() !== "ADD THIS USER") {
      await logAuditEvent({
        category: "USER_MANAGEMENT",
        action: "ACCOUNT_EARLY_APPROVAL_DENIED",
        outcome: "DENIED",
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: "admin",
        targetType: "user",
        targetId: userId,
        reason: 'Early approval denied: Confirmation phrase does not match "ADD THIS USER"',
      });
      return { error: 'Confirmation phrase mismatch. You must type "ADD THIS USER" exactly.' };
    }

    if (!options.justificationReason || !options.justificationReason.trim()) {
      return { error: "Justification reason is required for early approval." };
    }
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
  const approvalMethod = isEarly ? "MANUAL_EARLY" : "MANUAL";
  const approvalReason = options?.justificationReason?.trim() || "Administrator approved staff account";
  const nowIso = new Date().toISOString();

  // Update authoritative status, role, and school assignment in database table public.user_roles
  const { error: roleDbErr } = await adminClient
    .from("user_roles")
    .update({ 
      account_status: "Approved",
      role: validRole,
      school_id: schoolId,
      approval_method: approvalMethod,
      approval_reason: approvalReason,
      approved_by: user.id,
      approved_at: nowIso,
      updated_by: user.id,
      last_operation_id: operationId,
    })
    .eq("user_id", userId);

  if (roleDbErr) {
    return { error: roleDbErr.message };
  }

  // Link registry record if there is a matched registry entry
  if (targetRole?.matched_registry_id) {
    await adminClient
      .from("school_teacher_registry")
      .update({
        linked_user_id: userId,
        updated_at: nowIso,
      })
      .eq("id", targetRole.matched_registry_id);
  }

  const actionName = isEarly ? "ACCOUNT_EARLY_APPROVED" : "ACCOUNT_APPROVED";

  // Audit account approval
  await logAuditEvent({
    requestId: operationId,
    category: "USER_MANAGEMENT",
    action: actionName as any,
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "admin",
    actorSchoolId: schoolId,
    actorSchoolName: school.name,
    targetType: "user",
    targetId: userId,
    targetLabel: `${targetUser.user.user_metadata?.first_name || ""} ${targetUser.user.user_metadata?.last_name || ""}`.trim() || targetUser.user.email,
    reason: isEarly
      ? `Administrator granted early approval for ${validRole} at ${school.name}: ${approvalReason}`
      : `Administrator approved registration for ${validRole} at ${school.name}`,
    details: {
      previous_status: currentMetadata.account_status || "Pending",
      new_status: "Approved",
      assigned_role: validRole,
      assigned_school_id: schoolId,
      assigned_school_name: school.name,
      approval_method: approvalMethod,
      approval_reason: approvalReason,
      is_early_approval: Boolean(isEarly),
      registry_match_status: targetRole?.registry_match_status || null,
      matched_registry_id: targetRole?.matched_registry_id || null,
      email_confirmed_at: targetUser.user.email_confirmed_at,
    },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

export async function declineUser(userId: string, declineReason: string) {
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

  if (!declineReason || !declineReason.trim()) {
    return { error: "A specific decline reason is required to reject a registration." };
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
  const nowIso = new Date().toISOString();

  // Unlink any matched registry entry
  await adminClient
    .from("school_teacher_registry")
    .update({ linked_user_id: null, updated_at: nowIso })
    .eq("linked_user_id", userId);

  // Update authoritative status in database table public.user_roles
  await adminClient
    .from("user_roles")
    .update({ 
      account_status: "Declined",
      decline_reason: declineReason.trim(),
      declined_by: user.id,
      declined_at: nowIso,
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
    reason: `Administrator declined staff account registration: ${declineReason.trim()}`,
    details: {
      previous_status: currentMetadata.account_status || "Pending",
      new_status: "Declined",
      decline_reason: declineReason.trim(),
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

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit/auditLogger";

export async function login(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Audit failed login attempt (do not reveal if email exists, do not log password)
    await logAuditEvent({
      category: "AUTHENTICATION",
      action: "AUTH_LOGIN_FAILED",
      outcome: "FAILURE",
      actorEmail: email,
      reason: "Invalid login credentials",
      details: { sanitizedError: "Authentication failed" },
    });
    return { error: error.message };
  }

  // Authoritative check from user_roles
  let resolvedRole = "teacher";
  let resolvedSchoolId: string | null = null;

  if (data.user) {
    let accountStatus: string | null = null;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      const adminClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const { data: roleRow } = await adminClient
        .from("user_roles")
        .select("role, account_status, school_id")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (roleRow?.account_status) {
        accountStatus = roleRow.account_status;
      }
      if (roleRow?.role) {
        resolvedRole = roleRow.role;
      }
      if (roleRow?.school_id) {
        resolvedSchoolId = roleRow.school_id;
      }
    }

    if (!accountStatus) {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role, account_status, school_id")
        .eq("user_id", data.user.id)
        .maybeSingle();

      accountStatus = roleRow?.account_status || data.user.user_metadata?.account_status || "Pending";
      if (roleRow?.role) resolvedRole = roleRow.role;
      if (roleRow?.school_id) resolvedSchoolId = roleRow.school_id;
    }

    const account_status = accountStatus || data.user.user_metadata?.account_status || "Pending";

    if (account_status === 'Pending') {
      await logAuditEvent({
        category: "AUTHENTICATION",
        action: "AUTH_PENDING_REJECTED",
        outcome: "DENIED",
        actorUserId: data.user.id,
        actorEmail: email,
        actorRole: resolvedRole,
        actorSchoolId: resolvedSchoolId,
        reason: "Access denied: Account is pending administrator approval",
      });
      await supabase.auth.signOut();
      return { error: "Your account is pending admin approval." };
    }

    if (account_status === 'Declined') {
      await logAuditEvent({
        category: "AUTHENTICATION",
        action: "AUTH_DECLINED_REJECTED",
        outcome: "DENIED",
        actorUserId: data.user.id,
        actorEmail: email,
        actorRole: resolvedRole,
        actorSchoolId: resolvedSchoolId,
        reason: "Access denied: Account registration has been declined",
      });
      await supabase.auth.signOut();
      return { error: "Your account registration has been declined. Please contact the school administrator." };
    }

    if (account_status !== 'Approved') {
      await logAuditEvent({
        category: "AUTHENTICATION",
        action: "AUTH_LOGIN_FAILED",
        outcome: "DENIED",
        actorUserId: data.user.id,
        actorEmail: email,
        actorRole: resolvedRole,
        reason: "Access denied: Account is not approved",
      });
      await supabase.auth.signOut();
      return { error: "Your account is not approved to access the validation portal." };
    }
  }

  // Log successful login event to both legacy auth_logs and comprehensive audit_logs
  if (data.user) {
    await supabase.from("auth_logs").insert({
      user_id: data.user.id,
      action: "login",
    });

    await logAuditEvent({
      category: "AUTHENTICATION",
      action: "AUTH_LOGIN_SUCCESS",
      outcome: "SUCCESS",
      actorUserId: data.user.id,
      actorEmail: email,
      actorRole: resolvedRole,
      actorSchoolId: resolvedSchoolId,
      reason: "User signed in successfully",
    });
  }

  revalidatePath("/");
  redirect("/");
}

export async function register(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;
  const firstName = (formData.get("firstName") as string)?.trim();
  const middleName = (formData.get("middleName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();
  const nameExtension = (formData.get("nameExtension") as string)?.trim() || "";
  
  if (!email) {
    return { error: "Email address is required." };
  }

  if (!firstName || !lastName) {
    return { error: "First Name and Last Name are required." };
  }

  const passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}$/;
  if (!passwordRegex.test(password)) {
    return { error: "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number." };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Use an isolated client with persistSession: false to avoid setting session cookies
  // or overwriting existing user/admin sessions in the caller's browser.
  const isolatedClient = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: signUpData, error } = await isolatedClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        middle_name: middleName,
        last_name: lastName,
        name_extension: nameExtension,
        role: "Teacher",
        account_status: "Pending" // Automatically mark new users as Pending
      }
    }
  });

  if (error) {
    return { error: error.message };
  }

  if (!signUpData.user) {
    return { error: "Registration could not be completed. Please try again." };
  }

  // Supabase email enumeration protection: existing accounts return user with empty identities
  if (signUpData.user.identities && signUpData.user.identities.length === 0) {
    return { error: "An account with this email address already exists. Please sign in or contact the administrator." };
  }

  // Verify and ensure authoritative user_roles entry with Pending status
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    const adminClient = createSupabaseClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: existingRole } = await adminClient
      .from("user_roles")
      .select("role, account_status")
      .eq("user_id", signUpData.user.id)
      .maybeSingle();

    if (!existingRole) {
      const { error: insertError } = await adminClient
        .from("user_roles")
        .insert({
          user_id: signUpData.user.id,
          role: "teacher",
          account_status: "Pending",
        });

      if (insertError) {
        console.error("Failed to initialize user_roles entry:", insertError);
        // Partial failure cleanup: delete orphaned auth user
        await adminClient.auth.admin.deleteUser(signUpData.user.id);
        return { error: "Registration failed to initialize faculty profile. Please try again." };
      }
    }
  }

  // Record audit log for new registration submission
  await logAuditEvent({
    category: "REGISTRATION",
    action: "REGISTRATION_SUBMITTED",
    outcome: "SUCCESS",
    actorEmail: email,
    actorRole: "teacher",
    targetType: "user",
    targetId: signUpData.user.id,
    targetLabel: `${firstName} ${lastName}`.trim() || email,
    reason: "New faculty registration submitted with Pending status",
    details: {
      role: "Teacher",
      account_status: "Pending",
    },
  });

  // Safety cleanup: Ensure the caller's server session cookie does not hold this new registration session
  const serverClient = await createClient();
  const { data: currentSession } = await serverClient.auth.getUser();
  if (currentSession?.user?.id === signUpData.user.id) {
    await serverClient.auth.signOut();
  }

  revalidatePath("/login");
  redirect("/login?registered=pending");
}

export async function logout() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  
  if (data.user) {
    await supabase.from("auth_logs").insert({
      user_id: data.user.id,
      action: "logout",
    });

    await logAuditEvent({
      category: "AUTHENTICATION",
      action: "AUTH_LOGOUT",
      outcome: "SUCCESS",
      actorUserId: data.user.id,
      actorEmail: data.user.email,
      reason: "User signed out",
    });
  }

  await supabase.auth.signOut();
  revalidatePath("/");
  redirect("/login");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import { deriveMiddleInitial, evaluateRegistryMatch } from "@/lib/registry/nameMatcher";

const TRIS_SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";

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

  // Authoritative check from user_roles (never fall back to client-controlled user_metadata)
  let resolvedRole: string | null = null;
  let resolvedSchoolId: string | null = null;

  if (data.user) {
    let accountStatus: string | null = null;
    let roleQueryFailed = false;
    const adminClient = createAdminClient();
    if (adminClient) {
      const { data: roleRow, error: roleError } = await adminClient
        .from("user_roles")
        .select("role, account_status, school_id")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (roleError) {
        roleQueryFailed = true;
        console.error("Failed to query user_roles via service role during login:", roleError);
      } else if (roleRow) {
        accountStatus = roleRow.account_status || null;
        resolvedRole = roleRow.role || null;
        resolvedSchoolId = roleRow.school_id || null;
      }
    }

    if (!accountStatus || !resolvedRole) {
      const { data: roleRow, error: roleError } = await supabase
        .from("user_roles")
        .select("role, account_status, school_id")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (roleError) {
        roleQueryFailed = true;
        console.error("Failed to query user_roles during login:", roleError);
      } else if (roleRow) {
        accountStatus = accountStatus || roleRow.account_status || null;
        resolvedRole = resolvedRole || roleRow.role || null;
        resolvedSchoolId = resolvedSchoolId || roleRow.school_id || null;
      }
    }

    if (!accountStatus || !resolvedRole) {
      await logAuditEvent({
        category: "AUTHENTICATION",
        action: "AUTH_LOGIN_FAILED",
        outcome: "DENIED",
        actorUserId: data.user.id,
        actorEmail: email,
        actorRole: resolvedRole || "unverified",
        actorSchoolId: resolvedSchoolId,
        reason: roleQueryFailed
          ? "Access denied: Unable to verify authoritative user role record"
          : "Access denied: Authoritative user role record is missing",
      });
      await supabase.auth.signOut();
      return { error: "Your account is not authorized to access the validation portal. Please contact the school administrator." };
    }

    const account_status = accountStatus;

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
  const emailRaw = (formData.get("email") as string)?.trim();
  const email = emailRaw ? emailRaw.toLowerCase() : "";
  const password = (formData.get("password") as string) || "";
  const firstName = (formData.get("firstName") as string)?.trim() || "";
  const middleNameRaw = (formData.get("middleName") as string)?.trim();
  const hasNoMiddleName = formData.get("hasNoMiddleName") === "true" || formData.get("hasNoMiddleName") === "on";
  const middleName = hasNoMiddleName ? "" : (middleNameRaw || "");
  const lastName = (formData.get("lastName") as string)?.trim() || "";
  const nameExtension = (formData.get("nameExtension") as string)?.trim() || "";

  if (!email) {
    return { error: "Email address is required." };
  }

  // DepEd TRIS Personal Gmail requirement
  if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(email)) {
    return { error: "Registration requires a valid personal Gmail address (@gmail.com)." };
  }

  if (!firstName || !lastName) {
    return { error: "First Name and Last Name are required." };
  }

  const derivedMi = deriveMiddleInitial(middleName, hasNoMiddleName);

  const passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}$/;
  if (!passwordRegex.test(password)) {
    return { error: "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number." };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[POST /api/auth/register] Faculty verification failed: Missing Supabase environment configuration.");
    return { error: "Server configuration error: Database connection settings are missing. Please contact the administrator." };
  }

  // Resolve admin client safely using createAdminClient helper
  let adminClient: ReturnType<typeof createAdminClient> = null;
  try {
    adminClient = createAdminClient();
  } catch (adminInitErr) {
    console.warn("[POST /api/auth/register] Faculty verification: createAdminClient() initialization warning:", adminInitErr);
    adminClient = null;
  }

  const serverClient = await createClient();
  const dbClient = adminClient || serverClient;

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
        middle_name: middleName || null,
        middle_initial: derivedMi,
        has_no_middle_name: hasNoMiddleName,
        last_name: lastName,
        name_extension: nameExtension || null,
        role: "Teacher",
        account_status: "Pending", // Automatically mark new users as Pending
        school_id: TRIS_SCHOOL_ID,
      }
    }
  });

  if (error) {
    console.error("[POST /api/auth/register] Faculty verification failed during auth signUp:", error);
    return { error: error.message };
  }

  if (!signUpData.user) {
    console.error("[POST /api/auth/register] Faculty verification failed: No user returned from auth signUp.");
    return { error: "Registration could not be completed. Please try again." };
  }

  // Supabase email enumeration protection: existing accounts return user with empty identities
  if (signUpData.user.identities && signUpData.user.identities.length === 0) {
    return { error: "An account with this email address already exists. Please sign in or contact the administrator." };
  }

  // Verify and ensure authoritative user_roles entry with Pending status, Registry Matching, and Advisory Request
  const registrationTimestamp = new Date().toISOString();
  const reviewEligibilityTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let matchStatus = "NOT_FOUND";
  let matchedRegistryId: string | null = null;
  let matchedTeacherName: string | null = null;
  let matchReason: string = "Registry evaluation initialized";

  const createdUserId = signUpData.user.id;
  // Track whether we confirmed that existingRole already belonged to a pre-existing user
  let isPreExistingAccount = false;
  let profileSaved = false;

  const rollbackAuthUser = async (failureMessage: string) => {
    if (isPreExistingAccount || !signUpData.user) {
      return { error: failureMessage };
    }
    try {
      if (adminClient?.auth?.admin) {
        const { error: deleteError } = await adminClient.auth.admin.deleteUser(signUpData.user.id);
        if (deleteError) {
          console.error("CRITICAL: Failed to roll back orphaned auth user after user_roles error:", {
            userId: createdUserId,
            deleteError,
          });
          return {
            error: `${failureMessage} Additionally, automatic account cleanup failed. Please contact the system administrator.`,
          };
        }
      } else {
        console.warn("[POST /api/auth/register] Faculty verification: Admin client unavailable for automatic auth cleanup of user:", createdUserId);
      }
    } catch (cleanupErr) {
      console.error("CRITICAL: Exception while rolling back orphaned auth user:", {
        userId: createdUserId,
        cleanupErr,
      });
      return {
        error: `${failureMessage} Additionally, automatic account cleanup failed. Please contact the system administrator.`,
      };
    }
    return { error: failureMessage };
  };

  try {
    // Fetch official registry for TRIS to evaluate deterministic match
    const { data: registryTeachers, error: registryFetchError } = await dbClient
      .from("school_teacher_registry")
      .select("*")
      .eq("school_id", TRIS_SCHOOL_ID);

    if (registryFetchError) {
      console.error("[POST /api/auth/register] Faculty verification failed to query faculty registry:", registryFetchError);
      matchStatus = "REVIEW_REQUIRED";
      matchedRegistryId = null;
      matchedTeacherName = null;
      matchReason = `Teacher registry lookup failed due to database query error: ${registryFetchError.message || String(registryFetchError)}. Manual administrator verification is required.`;
    } else {
      const matchResult = evaluateRegistryMatch(
        {
          firstName,
          lastName,
          middleName: hasNoMiddleName ? null : (middleName || null),
          hasNoMiddleName,
          email,
          userId: signUpData.user.id,
        },
        registryTeachers || []
      );

      matchStatus = matchResult.status;
      matchedRegistryId = matchResult.matchedRegistryEntry?.id || null;
      matchedTeacherName = matchResult.matchedRegistryEntry?.full_name_original || null;
      matchReason = matchResult.reasons.join("; ") || "Registry evaluation completed";

      if (matchStatus === "DUPLICATE_CLAIM") {
        console.error("[POST /api/auth/register] Faculty verification failed: Duplicate registry claim for user:", signUpData.user.id);
        return await rollbackAuthUser("This faculty profile has already been claimed by another registered account. If you believe this is an error, please contact the school administrator.");
      }

      if (matchStatus === "INACTIVE_REGISTRY_ENTRY") {
        console.error("[POST /api/auth/register] Faculty verification failed: Inactive registry entry for user:", signUpData.user.id);
        return await rollbackAuthUser("The faculty profile in the official registry is currently deactivated. Please contact the school administrator.");
      }
    }

    const { data: existingRole, error: existingRoleError } = await dbClient
      .from("user_roles")
      .select(
        "role, account_status, school_id, requested_grade_level, requested_strand, requested_section, request_status, request_submitted_at"
      )
      .eq("user_id", signUpData.user.id)
      .maybeSingle();

    if (existingRoleError) {
      console.error("[POST /api/auth/register] Faculty verification failed:", existingRoleError);
      if (adminClient) {
        return await rollbackAuthUser(`Registration database error while verifying faculty profile: ${existingRoleError.message || String(existingRoleError)}. Please try again or contact the school administrator.`);
      }
      // If adminClient is null and userClient has RLS restriction on user_roles,
      // the on_auth_user_created trigger has already initialized the row with Pending status.
      console.warn("[POST /api/auth/register] Faculty verification: user_roles query restricted by RLS on unauthenticated client; account provisioned via database trigger defaults.");
    }

    if (!existingRole) {
      const insertClient = adminClient || serverClient;
      const { error: insertError } = await (insertClient as any)
        .from("user_roles")
        .insert({
          user_id: signUpData.user.id,
          role: "teacher",
          account_status: "Pending",
          school_id: TRIS_SCHOOL_ID,
          registration_timestamp: registrationTimestamp,
          review_eligibility_time: reviewEligibilityTime,
          registry_match_status: matchStatus,
          matched_registry_id: matchedRegistryId,
          middle_name: middleName || null,
          middle_initial: derivedMi,
          has_no_middle_name: hasNoMiddleName,
          requested_grade_level: null,
          requested_strand: null,
          requested_section: null,
          request_status: null,
          request_submitted_at: null,
        });

      if (insertError) {
        console.error("[POST /api/auth/register] Faculty verification failed to initialize faculty profile:", insertError);
        if (adminClient) {
          return await rollbackAuthUser(`Registration database error while initializing faculty profile: ${insertError.message || String(insertError)}. Please try again or contact the school administrator.`);
        }
        console.warn("[POST /api/auth/register] user_roles insert deferred to database trigger defaults:", insertError.message);
      } else {
        profileSaved = true;
      }
    } else {
      // Note: The on_auth_user_created database trigger inserts a skeleton user_roles row
      // right when auth.signUp creates a new auth.users record (with requested_* = NULL and
      // request_status = NULL).
      const hasLockedAccountStatus =
        existingRole.account_status === "Approved" || existingRole.account_status === "Declined";

      if (hasLockedAccountStatus) {
        isPreExistingAccount = true;
        return {
          error: "An account with this email is already registered and processed. Please sign in or contact the administrator.",
        };
      }

      const updatePayload: Record<string, unknown> = {
        role: "teacher",
        account_status: "Pending",
        school_id: existingRole.school_id ?? TRIS_SCHOOL_ID,
        registration_timestamp: registrationTimestamp,
        review_eligibility_time: reviewEligibilityTime,
        registry_match_status: matchStatus,
        matched_registry_id: matchedRegistryId,
        middle_name: middleName || null,
        middle_initial: derivedMi,
        has_no_middle_name: hasNoMiddleName,
        requested_grade_level: null,
        requested_strand: null,
        requested_section: null,
        request_status: null,
        request_submitted_at: null,
      };

      const updateClient = adminClient || serverClient;
      const { error: updateError } = await (updateClient as any)
        .from("user_roles")
        .update(updatePayload)
        .eq("user_id", signUpData.user.id);

      if (updateError) {
        console.error("[POST /api/auth/register] Faculty verification failed to update faculty profile:", updateError);
        if (adminClient) {
          return await rollbackAuthUser(`Registration database error while updating faculty profile: ${updateError.message || String(updateError)}. Please try again or contact the school administrator.`);
        }
        console.warn("[POST /api/auth/register] user_roles update skipped under unauthenticated client; database trigger defaults retained.");
      } else {
        profileSaved = true;
      }
    }

    // Record audit log for new registration submission
    const registrationAuditEvent = await logAuditEvent({
      category: "REGISTRATION",
      action: "REGISTRATION_SUBMITTED",
      outcome: "SUCCESS",
      actorEmail: email,
      actorRole: "teacher",
      actorSchoolId: TRIS_SCHOOL_ID,
      targetType: "user",
      targetId: signUpData.user.id,
      targetLabel: `${firstName} ${lastName}`.trim() || email,
      reason: "New faculty registration submitted with Pending status (advisory class selection deferred to post-login)",
      details: {
        role: "Teacher",
        account_status: "Pending",
        school_id: TRIS_SCHOOL_ID,
        requested_grade_level: null,
        requested_strand: null,
        requested_section: null,
        request_status: null,
      },
    });

    if (registrationAuditEvent.persisted === false) {
      console.error("Audit persistence failure for REGISTRATION_SUBMITTED:", {
        userId: signUpData.user.id,
        email,
        dbError: registrationAuditEvent.dbError,
      });
    }

    // Record audit log for registry match evaluation
    const matchAuditEvent = await logAuditEvent({
      category: "REGISTRATION",
      action: "REGISTRATION_MATCH_EVALUATED",
      outcome: registryFetchError ? "FAILURE" : "SUCCESS",
      actorEmail: email,
      actorRole: "teacher",
      actorSchoolId: TRIS_SCHOOL_ID,
      targetType: "user",
      targetId: signUpData.user.id,
      targetLabel: `${firstName} ${lastName}`.trim() || email,
      reason: `Teacher registration evaluated against institutional registry: status ${matchStatus} (${matchReason})`,
      details: {
        match_status: matchStatus,
        matched_registry_id: matchedRegistryId,
        matched_teacher_name: matchedTeacherName,
        registry_query_error: registryFetchError ? registryFetchError.message : null,
        registration_timestamp: registrationTimestamp,
        review_eligibility_time: reviewEligibilityTime,
        middle_initial: derivedMi,
        has_no_middle_name: hasNoMiddleName,
      },
    });

    if (matchAuditEvent.persisted === false) {
      console.error("Audit persistence failure for REGISTRATION_MATCH_EVALUATED:", {
        userId: signUpData.user.id,
        email,
        dbError: matchAuditEvent.dbError,
      });
    }
  } catch (unexpectedErr) {
    console.error("[POST /api/auth/register] Faculty verification failed with unexpected exception:", unexpectedErr);
    if (!profileSaved && !isPreExistingAccount) {
      return await rollbackAuthUser(`Registration encountered an unexpected system error: ${unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr)}. Please try again or contact the administrator.`);
    }
  }

  // Safety cleanup: Ensure the caller's server session cookie does not hold this new registration session
  const serverClientCleanup = await createClient();
  const { data: currentSession } = await serverClientCleanup.auth.getUser();
  if (currentSession?.user?.id === signUpData.user.id) {
    await serverClientCleanup.auth.signOut();
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

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      const adminClient = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
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
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;
  const firstName = (formData.get("firstName") as string)?.trim();
  const middleName = (formData.get("middleName") as string)?.trim();
  const hasNoMiddleName = formData.get("hasNoMiddleName") === "true" || formData.get("hasNoMiddleName") === "on";
  const lastName = (formData.get("lastName") as string)?.trim();
  const nameExtension = (formData.get("nameExtension") as string)?.trim() || "";

  // Extract and validate requested advisory class fields BEFORE any auth or DB calls
  const gradeLevel = (formData.get("gradeLevel") as string)?.trim();
  const strand = (formData.get("strand") as string)?.trim();
  const rawSection = (formData.get("section") as string)?.trim();
  const section = rawSection ? rawSection.replace(/\s+/g, " ") : "";

  const validGrades = ["Grade 11", "Grade 12"];
  const validStrands = ["CSS", "HUMSS", "Tourism"];

  if (!gradeLevel || !validGrades.includes(gradeLevel)) {
    return { error: "Invalid or missing grade level. Must be 'Grade 11' or 'Grade 12'." };
  }

  if (!strand || !validStrands.includes(strand)) {
    return { error: "Invalid or missing strand. Must be one of CSS, HUMSS, or Tourism." };
  }

  if (!section || section.length < 2 || section.length > 50 || !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(section)) {
    return { error: "Invalid or missing section. Must be 2 to 50 characters and contain only letters, numbers, spaces, hyphens, or periods." };
  }

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

  if (!hasNoMiddleName && !middleName) {
    // If user didn't enter a middle name, they must acknowledge having no middle name or enter it
    // To allow flexibility while enforcing awareness:
    // (If user leaves it blank without checking, we treat it as no middle name with warning or allow if checked)
  }

  const derivedMi = deriveMiddleInitial(middleName, hasNoMiddleName);

  const passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}$/;
  if (!passwordRegex.test(password)) {
    return { error: "Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number." };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    return { error: "Server configuration error: unable to process faculty registration." };
  }

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
        name_extension: nameExtension,
        role: "Teacher",
        account_status: "Pending", // Automatically mark new users as Pending
        school_id: TRIS_SCHOOL_ID,
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

  // Verify and ensure authoritative user_roles entry with Pending status, Registry Matching, and Advisory Request
  const registrationTimestamp = new Date().toISOString();
  const reviewEligibilityTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let matchStatus = "NOT_FOUND";
  let matchedRegistryId: string | null = null;
  let matchedTeacherName: string | null = null;
  let matchReason: string = "Registry evaluation initialized";

  const adminClient = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const createdUserId = signUpData.user.id;
  // Track whether we confirmed that existingRole already belonged to a pre-existing user
  let isPreExistingAccount = false;
  let profileSaved = false;

  const rollbackAuthUser = async (failureMessage: string) => {
    if (isPreExistingAccount) {
      return { error: failureMessage };
    }
    try {
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
    const { data: registryTeachers, error: registryFetchError } = await adminClient
      .from("school_teacher_registry")
      .select("*")
      .eq("school_id", TRIS_SCHOOL_ID);

    if (registryFetchError) {
      console.error("Failed to query school_teacher_registry during registration:", registryFetchError);
      matchStatus = "REVIEW_REQUIRED";
      matchedRegistryId = null;
      matchedTeacherName = null;
      matchReason = "Teacher registry lookup failed due to a database query error; manual administrator verification is required.";
    } else {
      const matchResult = evaluateRegistryMatch(
        {
          firstName,
          lastName,
          middleName: hasNoMiddleName ? null : middleName,
          hasNoMiddleName,
          email,
        },
        registryTeachers || []
      );

      matchStatus = matchResult.status;
      matchedRegistryId = matchResult.matchedRegistryEntry?.id || null;
      matchedTeacherName = matchResult.matchedRegistryEntry?.full_name_original || null;
      matchReason = matchResult.reasons.join("; ") || "Registry evaluation completed";
    }

    const { data: existingRole, error: existingRoleError } = await adminClient
      .from("user_roles")
      .select(
        "role, account_status, school_id, requested_grade_level, requested_strand, requested_section, request_status, request_submitted_at"
      )
      .eq("user_id", signUpData.user.id)
      .maybeSingle();

    if (existingRoleError) {
      console.error("Failed to check existing user_roles entry:", existingRoleError);
      return await rollbackAuthUser("Registration failed while verifying faculty profile. Please try again.");
    }

    if (!existingRole) {
      const { error: insertError } = await adminClient
        .from("user_roles")
        .insert({
          user_id: signUpData.user.id,
          role: "teacher",
          account_status: "Pending",
          school_id: TRIS_SCHOOL_ID,
          registration_timestamp: registrationTimestamp,
          review_eligibility_time: reviewEligibilityTime,
          registry_match_status: matchStatus as any,
          matched_registry_id: matchedRegistryId,
          middle_name: middleName || null,
          middle_initial: derivedMi,
          has_no_middle_name: hasNoMiddleName,
          requested_grade_level: gradeLevel,
          requested_strand: strand,
          requested_section: section,
          request_status: "Pending",
          request_submitted_at: registrationTimestamp,
        });

      if (insertError) {
        console.error("Failed to initialize user_roles entry:", insertError);
        return await rollbackAuthUser("Registration failed to initialize faculty profile. Please try again.");
      }
      profileSaved = true;
    } else {
      // Note: The on_auth_user_created database trigger inserts a skeleton user_roles row
      // right when auth.signUp creates a new auth.users record (with requested_* = NULL and
      // request_status = NULL).
      // Protect against downgrading an Approved/Declined advisory request or silently mutating
      // an already-populated advisory request on any duplicate/repeat registration flow.
      const hasLockedAdvisoryStatus =
        existingRole.request_status === "Approved" || existingRole.request_status === "Declined";
      const hasExistingAdvisorySelection =
        Boolean(existingRole.requested_grade_level) ||
        Boolean(existingRole.requested_strand) ||
        Boolean(existingRole.requested_section);
      const hasLockedAccountStatus =
        existingRole.account_status === "Approved" || existingRole.account_status === "Declined";

      if (hasLockedAdvisoryStatus || hasExistingAdvisorySelection || hasLockedAccountStatus) {
        isPreExistingAccount = true;
        return {
          error: "An advisory request is already recorded for this account and cannot be overwritten during registration.",
        };
      }

      const updatePayload: Record<string, any> = {
        role: "teacher",
        account_status: "Pending",
        school_id: existingRole.school_id ?? TRIS_SCHOOL_ID,
        registration_timestamp: registrationTimestamp,
        review_eligibility_time: reviewEligibilityTime,
        registry_match_status: matchStatus as any,
        matched_registry_id: matchedRegistryId,
        middle_name: middleName || null,
        middle_initial: derivedMi,
        has_no_middle_name: hasNoMiddleName,
        requested_grade_level: gradeLevel,
        requested_strand: strand,
        requested_section: section,
        request_status: "Pending",
        request_submitted_at: registrationTimestamp,
      };

      const { error: updateError } = await adminClient
        .from("user_roles")
        .update(updatePayload)
        .eq("user_id", signUpData.user.id);

      if (updateError) {
        console.error("Failed to update user_roles entry with advisory request:", updateError);
        return await rollbackAuthUser("Registration failed to save advisory class request. Please try again.");
      }
      profileSaved = true;
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
      reason: "New faculty registration submitted with Pending status",
      details: {
        role: "Teacher",
        account_status: "Pending",
        school_id: TRIS_SCHOOL_ID,
        requested_grade_level: gradeLevel,
        requested_strand: strand,
        requested_section: section,
        request_status: "Pending",
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
    console.error("Unexpected runtime error during post-signup registration initialization:", unexpectedErr);
    if (!profileSaved && !isPreExistingAccount) {
      return await rollbackAuthUser("Registration encountered an unexpected network or database failure. Please try again.");
    }
  }

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

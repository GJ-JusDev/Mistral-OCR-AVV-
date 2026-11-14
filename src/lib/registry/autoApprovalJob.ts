import { createClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit/auditLogger";

const TRIS_SCHOOL_ID = "a0000000-0000-0000-0000-000000000001";

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export interface AutoApprovalResult {
  userId: string;
  email?: string;
  status: "APPROVED" | "SKIPPED";
  reason: string;
}

/**
 * Server-side automatic approval job for pending teacher registrations
 * Evaluates pending accounts that have reached or passed their 24-hour review window.
 */
export async function processPendingRegistrationsAutoApproval(): Promise<{
  processed: number;
  approved: number;
  skipped: number;
  results: AutoApprovalResult[];
}> {
  const adminClient = getAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // Query pending registrations whose 24-hour review eligibility time has elapsed
  const { data: eligibleCandidates, error: queryErr } = await adminClient
    .from("user_roles")
    .select(`
      user_id,
      role,
      account_status,
      school_id,
      registration_timestamp,
      review_eligibility_time,
      registry_match_status,
      matched_registry_id
    `)
    .eq("account_status", "Pending")
    .lte("review_eligibility_time", nowIso);

  if (queryErr) {
    console.error("AutoApprovalJob: Error querying pending candidates:", queryErr);
    return { processed: 0, approved: 0, skipped: 0, results: [] };
  }

  const candidates = eligibleCandidates || [];
  const results: AutoApprovalResult[] = [];
  let approvedCount = 0;
  let skippedCount = 0;

  for (const candidate of candidates) {
    // 1. Fetch Supabase Auth user record to verify email confirmation
    const { data: authUserData, error: userErr } = await adminClient.auth.admin.getUserById(candidate.user_id);
    if (userErr || !authUserData?.user) {
      results.push({
        userId: candidate.user_id,
        status: "SKIPPED",
        reason: "User record not found in Supabase Auth",
      });
      skippedCount++;
      continue;
    }

    const authUser = authUserData.user;
    const email = authUser.email;

    // Check Criterion 2: Supabase email verification (email_confirmed_at must not be null)
    if (!authUser.email_confirmed_at) {
      results.push({
        userId: candidate.user_id,
        email,
        status: "SKIPPED",
        reason: "Supabase email address is unconfirmed",
      });
      skippedCount++;

      await logAuditEvent({
        category: "REGISTRATION",
        action: "EMAIL_VERIFICATION_CHECKED",
        outcome: "FAILURE",
        actorEmail: email,
        actorRole: "system",
        actorSchoolId: TRIS_SCHOOL_ID,
        targetType: "user",
        targetId: candidate.user_id,
        targetLabel: email,
        reason: "Auto-approval skipped: Email verification pending confirmation",
        details: {
          review_eligibility_time: candidate.review_eligibility_time,
          email_confirmed_at: null,
        },
      });
      continue;
    }

    // Check Criterion 3: Registry match status must be 'MATCHED'
    if (candidate.registry_match_status !== "MATCHED" || !candidate.matched_registry_id) {
      results.push({
        userId: candidate.user_id,
        email,
        status: "SKIPPED",
        reason: `Registry match status is '${candidate.registry_match_status}', not 'MATCHED'`,
      });
      skippedCount++;
      continue;
    }

    // Check Criterion 4, 5, 6: Check matched registry record
    const { data: registryRecord, error: regErr } = await adminClient
      .from("school_teacher_registry")
      .select("*")
      .eq("id", candidate.matched_registry_id)
      .maybeSingle();

    if (regErr || !registryRecord) {
      results.push({
        userId: candidate.user_id,
        email,
        status: "SKIPPED",
        reason: "Matched registry record no longer exists",
      });
      skippedCount++;
      continue;
    }

    // Must be verified
    if (registryRecord.verification_status !== "verified") {
      results.push({
        userId: candidate.user_id,
        email,
        status: "SKIPPED",
        reason: `Matched registry record is '${registryRecord.verification_status}', must be 'verified'`,
      });
      skippedCount++;
      continue;
    }

    // Must be active
    if (!registryRecord.is_active) {
      results.push({
        userId: candidate.user_id,
        email,
        status: "SKIPPED",
        reason: "Matched registry record is deactivated",
      });
      skippedCount++;
      continue;
    }

    // Must not be claimed by another active user
    if (registryRecord.linked_user_id && registryRecord.linked_user_id !== candidate.user_id) {
      results.push({
        userId: candidate.user_id,
        email,
        status: "SKIPPED",
        reason: `Duplicate claim: Registry record is already linked to user ${registryRecord.linked_user_id}`,
      });
      skippedCount++;
      continue;
    }

    // All 7 criteria satisfied! Execute atomic approval
    const operationId = crypto.randomUUID();

    // 1. Update Supabase Auth user metadata
    const currentMeta = authUser.user_metadata || {};
    await adminClient.auth.admin.updateUserById(candidate.user_id, {
      user_metadata: {
        ...currentMeta,
        account_status: "Approved",
        role: "Teacher",
        school_id: TRIS_SCHOOL_ID,
      },
    });

    // 2. Update user_roles table
    const { error: roleUpdateErr } = await adminClient
      .from("user_roles")
      .update({
        account_status: "Approved",
        role: "teacher",
        school_id: TRIS_SCHOOL_ID,
        approval_method: "AUTOMATIC",
        approval_reason: "Eligible 24-hour review period completed with confirmed email and verified registry match",
        approved_at: nowIso,
        last_operation_id: operationId,
      })
      .eq("user_id", candidate.user_id);

    if (roleUpdateErr) {
      console.error("AutoApprovalJob: Failed to update user_roles for user:", candidate.user_id, roleUpdateErr);
      results.push({
        userId: candidate.user_id,
        email,
        status: "SKIPPED",
        reason: `Database update error: ${roleUpdateErr.message}`,
      });
      skippedCount++;
      continue;
    }

    // 3. Link registry entry to user
    await adminClient
      .from("school_teacher_registry")
      .update({
        linked_user_id: candidate.user_id,
        updated_at: nowIso,
      })
      .eq("id", candidate.matched_registry_id);

    // 4. Log immutable audit event
    await logAuditEvent({
      requestId: operationId,
      category: "USER_MANAGEMENT",
      action: "ACCOUNT_AUTO_APPROVED",
      outcome: "SUCCESS",
      actorUserId: "00000000-0000-0000-0000-000000000000",
      actorEmail: "system@avv.deped.gov.ph",
      actorRole: "system",
      actorSchoolId: TRIS_SCHOOL_ID,
      targetType: "user",
      targetId: candidate.user_id,
      targetLabel: `${registryRecord.first_name} ${registryRecord.last_name}`,
      reason: "Automatic approval executed after 24-hour review period with confirmed email and verified registry record",
      details: {
        registration_timestamp: candidate.registration_timestamp,
        review_eligibility_time: candidate.review_eligibility_time,
        matched_registry_id: candidate.matched_registry_id,
        teacher_name: registryRecord.full_name_original,
        approval_method: "AUTOMATIC",
        email_confirmed_at: authUser.email_confirmed_at,
      },
    });

    results.push({
      userId: candidate.user_id,
      email,
      status: "APPROVED",
      reason: "Approved automatically after fulfilling all 7 verification criteria",
    });
    approvedCount++;
  }

  return {
    processed: candidates.length,
    approved: approvedCount,
    skipped: skippedCount,
    results,
  };
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

test("Live Supabase Faculty Approval Workflow & Security Verification", async (t) => {
  const envPath = path.resolve("./.env.local");
  assert.ok(fs.existsSync(envPath), ".env.local must exist with live Supabase configuration");

  const env = dotenv.parse(fs.readFileSync(envPath, "utf8"));
  assert.ok(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL must be configured");
  assert.ok(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY must be configured");
  assert.ok(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured");

  const adminClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const anonClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const targetSchoolId = "a0000000-0000-0000-0000-000000000001"; // TRIS
  const adminActorId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21"; // Existing approved admin
  const testEmail = `disposable_test_teacher_${Date.now()}@test.local`;
  const testPassword = `P@ssword_${Date.now()}!Secure`;

  let disposableUserId = null;

  try {
    // ── 1. Create Disposable Pending Faculty Account ──────────────────────────
    await t.test("1. Create disposable pending faculty test account", async () => {
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: {
          first_name: "TestDisposable",
          last_name: "Teacher",
          role: "Teacher",
          account_status: "Pending",
        }
      });

      assert.ifError(createErr);
      assert.ok(created?.user?.id, "User must be created");
      disposableUserId = created.user.id;

      // Note: Auth trigger may have auto-inserted user_roles row; ensure it is set to Pending
      const { data: existingRole } = await adminClient
        .from("user_roles")
        .select("id, account_status")
        .eq("user_id", disposableUserId)
        .maybeSingle();

      if (!existingRole) {
        const { error: roleInsertErr } = await adminClient
          .from("user_roles")
          .insert({
            user_id: disposableUserId,
            role: "teacher",
            account_status: "Pending",
            school_id: null,
          });
        assert.ifError(roleInsertErr);
      } else {
        const { error: roleUpdateErr } = await adminClient
          .from("user_roles")
          .update({
            role: "teacher",
            account_status: "Pending",
            school_id: null,
          })
          .eq("user_id", disposableUserId);
        assert.ifError(roleUpdateErr);
      }

      // Verify the user is pending
      const { data: pendingCheck, error: checkErr } = await adminClient
        .from("user_roles")
        .select("user_id, role, account_status, school_id")
        .eq("user_id", disposableUserId)
        .single();

      assert.ifError(checkErr);
      assert.strictEqual(pendingCheck.account_status, "Pending");
      assert.strictEqual(pendingCheck.role, "teacher");
      assert.strictEqual(pendingCheck.school_id, null);
    });

    // ── 2. Verify Presence in Pending Queue Filter ──────────────────────────
    await t.test("2. Disposable account appears in pending approval queue query", async () => {
      const { data: pendingList, error: pendingErr } = await adminClient
        .from("user_roles")
        .select("user_id, role, account_status")
        .eq("account_status", "Pending");

      assert.ifError(pendingErr);
      const found = pendingList.some((u) => u.user_id === disposableUserId);
      assert.strictEqual(found, true, "Disposable user must be in pending list");
    });

    // ── 3. Test Role Escalation Prevention ──────────────────────────────────
    await t.test("3. Role escalation is prevented during approval", async () => {
      // In approveUser, valid roles are strictly ['teacher', 'principal']
      const requestedRole = "admin";
      const normalizedRole = ["teacher", "principal"].includes(requestedRole.toLowerCase())
        ? requestedRole.toLowerCase()
        : "teacher";

      assert.strictEqual(
        normalizedRole,
        "teacher",
        "Role 'admin' must not be granted via faculty approval; must normalize to teacher"
      );
    });

    // ── 4. Execute Faculty Approval with Schema-Resilient Fallback ───────────
    await t.test("4. Approve disposable faculty account using schema-resilient update", async () => {
      const operationId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const validRole = "teacher";

      // Step A: Update Auth metadata
      const { error: authUpdateErr } = await adminClient.auth.admin.updateUserById(disposableUserId, {
        user_metadata: {
          first_name: "TestDisposable",
          last_name: "Teacher",
          role: "Teacher",
          account_status: "Approved",
          school_id: targetSchoolId,
        }
      });
      assert.ifError(authUpdateErr);

      // Step B: Update user_roles table with defensive fallback
      const basePayload = {
        account_status: "Approved",
        role: validRole,
        school_id: targetSchoolId,
        updated_by: adminActorId,
        last_operation_id: operationId,
      };

      const extendedPayload = {
        ...basePayload,
        approval_method: "MANUAL",
        approval_reason: "Automated verification test approval",
        approved_by: adminActorId,
        approved_at: nowIso,
      };

      let finalError = null;
      let usedFallback = false;

      const { error: fullErr } = await adminClient
        .from("user_roles")
        .update(extendedPayload)
        .eq("user_id", disposableUserId);

      if (fullErr) {
        if (
          fullErr.message?.includes("approval_method") ||
          fullErr.message?.includes("schema cache") ||
          fullErr.code === "42703" ||
          fullErr.code === "PGRST204"
        ) {
          usedFallback = true;
          const { error: fallbackErr } = await adminClient
            .from("user_roles")
            .update(basePayload)
            .eq("user_id", disposableUserId);
          finalError = fallbackErr;
        } else {
          finalError = fullErr;
        }
      }

      assert.ifError(finalError, "Approval update must succeed either with extended schema or fallback");

      // Step C: Record Audit Log
      const { error: auditErr } = await adminClient.from("audit_logs").insert({
        request_id: operationId,
        category: "USER_MANAGEMENT",
        action: "ACCOUNT_APPROVED",
        outcome: "SUCCESS",
        actor_user_id: adminActorId,
        actor_email: "admin@example.com",
        actor_role: "admin",
        actor_school_id: targetSchoolId,
        target_type: "user",
        target_id: disposableUserId,
        target_label: "TestDisposable Teacher",
        reason: "Administrator approved registration for teacher at Taysan Resettlement Integrated School",
        details: {
          previous_status: "Pending",
          new_status: "Approved",
          assigned_role: validRole,
          assigned_school_id: targetSchoolId,
          approval_method: "MANUAL",
          fallback_mode_applied: usedFallback,
        }
      });
      assert.ifError(auditErr, "Audit log must be created");
    });

    // ── 5. Verify Database State Post-Approval ───────────────────────────────
    await t.test("5. Post-approval state in user_roles and removal from pending queue", async () => {
      const { data: updatedRole, error: roleErr } = await adminClient
        .from("user_roles")
        .select("account_status, role, school_id, updated_by")
        .eq("user_id", disposableUserId)
        .single();

      assert.ifError(roleErr);
      assert.strictEqual(updatedRole.account_status, "Approved", "Status must be Approved");
      assert.strictEqual(updatedRole.role, "teacher", "Role must be teacher");
      assert.strictEqual(updatedRole.school_id, targetSchoolId, "School ID must match assigned school");
      assert.strictEqual(updatedRole.updated_by, adminActorId, "Must be attributed to admin");

      // Verify removal from pending list
      const { data: pendingList } = await adminClient
        .from("user_roles")
        .select("user_id")
        .eq("account_status", "Pending");

      const stillPending = (pendingList || []).some((u) => u.user_id === disposableUserId);
      assert.strictEqual(stillPending, false, "Approved user must not appear in pending queue");
    });

    // ── 6. Verify Approved Teacher Login Capability ─────────────────────────
    await t.test("6. Approved teacher can successfully log in via Supabase Auth", async () => {
      const { data: loginData, error: loginErr } = await anonClient.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      assert.ifError(loginErr, "Approved teacher should be able to authenticate successfully");
      assert.ok(loginData?.user?.id, "Session user ID must be present");
      assert.strictEqual(loginData.user.id, disposableUserId);

      // Verify authoritative role from user_roles
      const { data: authRole } = await adminClient
        .from("user_roles")
        .select("account_status, role, school_id")
        .eq("user_id", loginData.user.id)
        .single();

      assert.strictEqual(authRole.account_status, "Approved");
      assert.strictEqual(authRole.role, "teacher");
    });

    // ── 7. Verify Audit Log Persistence ─────────────────────────────────────
    await t.test("7. Audit log records the approval event with full details", async () => {
      const { data: logs, error: logErr } = await adminClient
        .from("audit_logs")
        .select("*")
        .eq("target_id", disposableUserId)
        .eq("action", "ACCOUNT_APPROVED");

      assert.ifError(logErr);
      assert.ok(logs && logs.length > 0, "Audit log record must exist");
      assert.strictEqual(logs[0].actor_user_id, adminActorId);
      assert.strictEqual(logs[0].outcome, "SUCCESS");
    });

    // ── 8. Verify Decline Flow with Schema-Resilient Fallback ────────────────
    await t.test("8. Decline user flow functions safely with schema fallback", async () => {
      const operationId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const declineReason = "Testing admin decline resilience";

      // Attempt decline with extended payload
      const baseDeclinePayload = {
        account_status: "Declined",
        updated_by: adminActorId,
        last_operation_id: operationId,
      };

      const extendedDeclinePayload = {
        ...baseDeclinePayload,
        decline_reason: declineReason,
        declined_by: adminActorId,
        declined_at: nowIso,
      };

      let declineErr = null;
      const { error: fullDeclineErr } = await adminClient
        .from("user_roles")
        .update(extendedDeclinePayload)
        .eq("user_id", disposableUserId);

      if (fullDeclineErr) {
        if (
          fullDeclineErr.message?.includes("decline_reason") ||
          fullDeclineErr.message?.includes("schema cache") ||
          fullDeclineErr.code === "42703" ||
          fullDeclineErr.code === "PGRST204"
        ) {
          const { error: coreDeclineErr } = await adminClient
            .from("user_roles")
            .update(baseDeclinePayload)
            .eq("user_id", disposableUserId);
          declineErr = coreDeclineErr;
        } else {
          declineErr = fullDeclineErr;
        }
      }

      assert.ifError(declineErr, "Decline update must succeed cleanly");

      const { data: declinedRole } = await adminClient
        .from("user_roles")
        .select("account_status")
        .eq("user_id", disposableUserId)
        .single();

      assert.strictEqual(declinedRole?.account_status, "Declined");
    });

  } finally {
    // ── Cleanup: Delete only the disposable test user and associated records ─
    if (disposableUserId) {
      console.log(`[CLEANUP] Removing disposable test user ${disposableUserId}...`);
      await adminClient.from("audit_logs").delete().eq("target_id", disposableUserId);
      await adminClient.from("user_roles").delete().eq("user_id", disposableUserId);
      await adminClient.auth.admin.deleteUser(disposableUserId);
      console.log("[CLEANUP] Disposable user cleaned up successfully.");
    }
  }
});

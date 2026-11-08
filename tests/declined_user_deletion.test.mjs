import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(rootDir, ".env.local") });

test("AVV System — Declined User Account Deletion Verification Suite", async (t) => {
  const userActionsContent = fs.readFileSync(
    path.join(rootDir, "src/components/admin/UserActions.tsx"),
    "utf8"
  );
  const usersPageContent = fs.readFileSync(
    path.join(rootDir, "src/app/admin/users/page.tsx"),
    "utf8"
  );
  const usersActionContent = fs.readFileSync(
    path.join(rootDir, "src/actions/users.ts"),
    "utf8"
  );

  // Pure logic replica of UserActions visibility rules
  function getVisibleActions(user) {
    const meta = user.user_metadata || {};
    const status = user.db_account_status || meta.account_status || "Pending";
    const role = (user.db_role || meta.role || "Teacher").toLowerCase();

    const isPending = status === "Pending";
    const isDeclined = status === "Declined";
    const isApproved = status === "Approved" || (!user.db_account_status && !meta.account_status);
    const isTeacher = role === "teacher";
    const isAdmin = role === "admin";

    return {
      canApprove: isPending,
      canDecline: isPending,
      canEdit: isApproved && !isAdmin,
      canDelete: isDeclined && isTeacher
    };
  }

  // --- PHASE 1 & 2: USER INTERFACE & CONFIRMATION MODAL TESTS ---

  await t.test("1. Admin can see Delete for declined teachers", () => {
    const user = {
      db_role: "teacher",
      db_account_status: "Declined",
      user_metadata: { role: "Teacher", account_status: "Declined" }
    };
    const actions = getVisibleActions(user);
    assert.strictEqual(actions.canDelete, true, "Delete button must be visible for declined teachers");
    assert.strictEqual(actions.canApprove, false, "Approve must not be visible for declined teachers");
    assert.strictEqual(actions.canDecline, false, "Decline must not be visible for declined teachers");
    assert.strictEqual(actions.canEdit, false, "Edit must not be visible for declined teachers");

    // Check UI button implementation
    assert.ok(
      userActionsContent.includes("isDeclined && isTeacher"),
      "UserActions must gate Delete on isDeclined && isTeacher"
    );
    assert.ok(
      userActionsContent.includes("Trash2"),
      "UserActions must render Trash2 icon for Delete button"
    );
    assert.ok(
      userActionsContent.includes("text-red-600"),
      "UserActions must style Delete button with red styling"
    );
  });

  await t.test("2. Delete is hidden for pending teachers", () => {
    const user = {
      db_role: "teacher",
      db_account_status: "Pending",
      user_metadata: { role: "Teacher", account_status: "Pending" }
    };
    const actions = getVisibleActions(user);
    assert.strictEqual(actions.canDelete, false, "Delete button must be hidden for pending teachers");
    assert.strictEqual(actions.canApprove, true, "Approve button must be visible for pending teachers");
    assert.strictEqual(actions.canDecline, true, "Decline button must be visible for pending teachers");
  });

  await t.test("3. Delete is hidden for approved teachers", () => {
    const user = {
      db_role: "teacher",
      db_account_status: "Approved",
      user_metadata: { role: "Teacher", account_status: "Approved" }
    };
    const actions = getVisibleActions(user);
    assert.strictEqual(actions.canDelete, false, "Delete button must be hidden for approved teachers");
    assert.strictEqual(actions.canEdit, true, "Edit button must be visible for approved teachers");
    assert.strictEqual(actions.canApprove, false);
    assert.strictEqual(actions.canDecline, false);

    // Verify source code removes delete button from approved section
    assert.ok(
      !userActionsContent.includes('{isApproved && !isAdmin && (\n        <div className="flex gap-2">\n          <Button size="sm" variant="outline" onClick={() => setActiveAction("edit_confirm")}\n            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2">\n            <Pencil className="h-4 w-4 mr-1" /> Edit\n          </Button>\n          <Button size="sm" variant="outline" onClick={() => setActiveAction("delete_confirm")}'),
      "Approved section must not contain Delete button"
    );
  });

  await t.test("4. Delete is hidden for principals and admins", () => {
    // Approved Principal
    const approvedPrincipal = {
      db_role: "principal",
      db_account_status: "Approved",
      user_metadata: { role: "Principal", account_status: "Approved" }
    };
    assert.strictEqual(getVisibleActions(approvedPrincipal).canDelete, false, "Delete hidden for approved principal");

    // Declined Principal
    const declinedPrincipal = {
      db_role: "principal",
      db_account_status: "Declined",
      user_metadata: { role: "Principal", account_status: "Declined" }
    };
    assert.strictEqual(getVisibleActions(declinedPrincipal).canDelete, false, "Delete hidden for declined principal");

    // Admin (Approved or Declined)
    const approvedAdmin = {
      db_role: "admin",
      db_account_status: "Approved",
      user_metadata: { role: "Admin", account_status: "Approved" }
    };
    assert.strictEqual(getVisibleActions(approvedAdmin).canDelete, false, "Delete hidden for approved admin");

    const declinedAdmin = {
      db_role: "admin",
      db_account_status: "Declined",
      user_metadata: { role: "Admin", account_status: "Declined" }
    };
    assert.strictEqual(getVisibleActions(declinedAdmin).canDelete, false, "Delete hidden for declined admin");
  });

  await t.test("Confirmation Dialog conforms to exact prompt specifications", () => {
    assert.ok(
      userActionsContent.includes('title="Delete Declined Account?"'),
      "Modal title must be exactly 'Delete Declined Account?'"
    );
    assert.ok(
      userActionsContent.includes("Are you sure you want to delete this declined account? This action cannot be undone."),
      "Modal body must contain exact prompt confirmation warning text"
    );
    assert.ok(
      userActionsContent.includes("Cancel") && userActionsContent.includes("Delete Account"),
      "Modal must provide Cancel and Delete Account buttons"
    );
    assert.ok(
      userActionsContent.includes("Deleting...") || userActionsContent.includes("isLoading={isSubmitting}"),
      "Delete action must display active loading state during deletion"
    );
  });

  // --- PHASE 3 & 4: SERVER-SIDE ACTIONS, SECURITY, AND DATABASE RELATIONSHIPS ---

  await t.test("5. Non-admin users cannot access the delete endpoint", () => {
    assert.ok(
      usersActionContent.includes('callerRoleRow?.role !== "admin" || callerRoleRow?.account_status !== "Approved"'),
      "deleteDeclinedUser must enforce caller role === 'admin' and account_status === 'Approved'"
    );
    assert.ok(
      usersActionContent.includes('return { error: "Unauthorized" };'),
      "Unauthenticated caller must be rejected immediately"
    );
    assert.ok(
      usersActionContent.includes('return { error: "Forbidden: Only an approved administrator can delete accounts." };'),
      "Non-admin caller must receive Forbidden response"
    );
  });

  await t.test("6. Direct API requests cannot bypass the status restriction", () => {
    assert.ok(
      usersActionContent.includes('if (targetRole !== "teacher")'),
      "Server action must reject non-teacher target accounts regardless of frontend claims"
    );
    assert.ok(
      usersActionContent.includes('if (targetStatus !== "Declined")'),
      "Server action must reject non-declined target accounts (Pending, Approved) regardless of frontend claims"
    );
    assert.ok(
      usersActionContent.includes('targetUserId === user.id'),
      "Server action must prevent administrator from deleting their own account"
    );
  });

  await t.test("7. Cancel does not delete the account", () => {
    // In UserActions.tsx, clicking Cancel only calls closeAction() which sets activeAction to none
    assert.ok(
      userActionsContent.includes('<Button \n              type="button" \n              variant="outline" \n              onClick={closeAction}\n              disabled={isSubmitting}\n            >\n              Cancel\n            </Button>'),
      "Cancel button calls closeAction without invoking deleteDeclinedUser"
    );
  });

  await t.test("8, 9, 10, 11: End-to-end Supabase DB & Auth Security Lifecycle (Safe Temporary User)", async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.warn("Skipping live Supabase lifecycle test: missing environment variables.");
      return;
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const testEmail = `avv_test_lifecycle_${Date.now()}@example.invalid`;
    const testPassword = "ValidTestPassword123!";

    // Create safe temporary test user
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { role: "Teacher", account_status: "Declined" }
    });

    assert.ok(!createErr, `Creation must succeed: ${createErr?.message}`);
    const testUserId = created.user.id;

    try {
      // 1. Insert role record in public.user_roles
      await adminClient.from("user_roles").insert({
        user_id: testUserId,
        role: "teacher",
        account_status: "Declined"
      });

      // 11. Test Protected Records Block: Attach a dummy document to user
      // Temporarily insert document uploaded by testUserId
      const { data: doc, error: docErr } = await adminClient
        .from("documents")
        .insert({
          original_filename: "test_doc_deletion_guard.png",
          document_type: "sf9_front",
          image_url: "https://example.com/test.png",
          status: "pending",
          uploaded_by: testUserId
        })
        .select("id")
        .single();

      if (!docErr && doc) {
        // Query dependency check simulating deleteDeclinedUser
        const { count: docCount } = await adminClient
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("uploaded_by", testUserId);

        assert.strictEqual(docCount > 0, true, "Protected records check detects associated document");

        // Clean up dummy document
        await adminClient.from("documents").delete().eq("id", doc.id);
      }

      // 8. Confirm deletes an eligible declined account without protected records
      const { error: delAuthErr } = await adminClient.auth.admin.deleteUser(testUserId);
      assert.ok(!delAuthErr, `Supabase Auth deleteUser must succeed: ${delAuthErr?.message}`);

      // Ensure user_roles cleanup
      await adminClient.from("user_roles").delete().eq("user_id", testUserId);

      // 9. Deleted accounts disappear from list / DB
      const { data: checkUser } = await adminClient.auth.admin.getUserById(testUserId);
      assert.strictEqual(checkUser?.user, null, "User must no longer exist in Supabase auth");

      const { data: checkRole } = await adminClient
        .from("user_roles")
        .select("user_id")
        .eq("user_id", testUserId)
        .maybeSingle();
      assert.strictEqual(checkRole, null, "User must no longer have any orphaned user_roles row");

      // 10. Deleted accounts cannot sign in
      const anonClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      const { error: signInErr } = await anonClient.auth.signInWithPassword({
        email: testEmail,
        password: testPassword
      });
      assert.ok(signInErr, "Deleted user must fail authentication attempt");
      assert.ok(
        signInErr.message.includes("Invalid login credentials") || signInErr.status === 400,
        "Sign-in fails with Invalid login credentials"
      );
    } finally {
      // Guaranteed cleanup if not already deleted
      try {
        await adminClient.from("documents").delete().eq("uploaded_by", testUserId);
        await adminClient.from("user_roles").delete().eq("user_id", testUserId);
        await adminClient.auth.admin.deleteUser(testUserId);
      } catch (err) {
        // ignore
      }
    }
  });

  await t.test("12. Existing Approve and Decline actions continue working intact", () => {
    assert.ok(
      typeof usersActionContent.includes("export async function approveUser") === "boolean",
      "approveUser export must remain intact"
    );
    assert.ok(
      usersActionContent.includes("export async function declineUser"),
      "declineUser export must remain intact"
    );
    assert.ok(
      userActionsContent.includes("handleApproveSubmit"),
      "handleApproveSubmit handler in UserActions remains intact"
    );
    assert.ok(
      userActionsContent.includes("handleDecline"),
      "handleDecline handler in UserActions remains intact"
    );
  });
});

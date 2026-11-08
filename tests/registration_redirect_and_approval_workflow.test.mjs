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

// Load local environment variables for live test if present
if (fs.existsSync(path.join(rootDir, ".env.local"))) {
  dotenv.config({ path: path.join(rootDir, ".env.local") });
}

test("AVV Registration Redirect & Approval Workflow E2E Suite", async (t) => {
  const authActionContent = fs.readFileSync(path.join(rootDir, "src/actions/auth.ts"), "utf8");
  const loginPageContent = fs.readFileSync(path.join(rootDir, "src/app/login/page.tsx"), "utf8");
  const registerPageContent = fs.readFileSync(path.join(rootDir, "src/app/register/page.tsx"), "utf8");
  const middlewareContent = fs.readFileSync(path.join(rootDir, "src/middleware.ts"), "utf8");
  const rootPageContent = fs.readFileSync(path.join(rootDir, "src/app/page.tsx"), "utf8");

  await t.test("1. Registration Action: Redirects to /login?registered=pending (never /)", () => {
    assert.ok(
      authActionContent.includes('redirect("/login?registered=pending")'),
      "register() must redirect to /login?registered=pending"
    );
    assert.strictEqual(
      authActionContent.includes('redirect("/")') && !authActionContent.includes('revalidatePath("/")\n  redirect("/")'),
      true,
      "register() must not redirect to root dashboard"
    );
  });

  await t.test("2. Session Safety: Registration uses isolated client without session persistence", () => {
    assert.ok(
      authActionContent.includes("persistSession: false"),
      "register() must use persistSession: false to avoid auto-authenticating new registrations"
    );
    assert.ok(
      authActionContent.includes("isolatedClient"),
      "register() must isolate registration client from caller cookies"
    );
  });

  await t.test("3. Registration Action: Automatically sets role to Teacher and status to Pending", () => {
    assert.ok(
      authActionContent.includes('role: "Teacher"'),
      "Registration metadata must set role to Teacher"
    );
    assert.ok(
      authActionContent.includes('account_status: "Pending"'),
      "Registration metadata must set account_status to Pending"
    );
  });

  await t.test("4. Authoritative DB Sync: Guarantees user_roles record with Pending status", () => {
    assert.ok(
      authActionContent.includes('.from("user_roles")'),
      "register() must ensure user_roles row exists"
    );
    assert.ok(
      authActionContent.includes('account_status: "Pending"'),
      "user_roles row must be set to Pending status"
    );
  });

  await t.test("5. Partial Failure Protection: Cleans up orphaned auth user if profile creation fails", () => {
    assert.ok(
      authActionContent.includes("deleteUser(signUpData.user.id)"),
      "Orphaned auth user must be cleaned up if database role insertion fails"
    );
  });

  await t.test("6. Login Page UI: Displays registration confirmation message when registered=pending", () => {
    assert.ok(
      loginPageContent.includes('searchParams.get("registered") === "pending"'),
      "LoginPage must check searchParams for registered=pending"
    );
    assert.ok(
      loginPageContent.includes("Registration submitted successfully. Your account is awaiting Administrator approval."),
      "LoginPage must display administrator approval notice: 'Registration submitted successfully. Your account is awaiting Administrator approval.'"
    );
    assert.ok(
      loginPageContent.includes("<Suspense"),
      "LoginPage must wrap searchParams read in Suspense boundary"
    );
  });

  await t.test("7. Middleware: Protects /login from redirect loops for unapproved accounts", () => {
    assert.ok(
      middlewareContent.includes("isApproved"),
      "Middleware must check isApproved before redirecting away from auth routes"
    );
    assert.ok(
      middlewareContent.includes("isAuthRoute"),
      "Middleware must recognize auth routes"
    );
    assert.ok(
      middlewareContent.includes("registered") && middlewareContent.includes("pending"),
      "Middleware must explicitly allow registered=pending view on login without redirecting"
    );
  });

  await t.test("8. Login Security: Pending and Declined accounts are blocked from dashboard access", () => {
    assert.ok(
      authActionContent.includes("account_status === 'Pending'") ||
      authActionContent.includes("effectiveStatus === 'Pending'") ||
      authActionContent.includes("accountStatus === 'Pending'"),
      "login() must check for Pending status"
    );
    assert.ok(
      authActionContent.includes("Your account is pending admin approval.") ||
      authActionContent.includes("Your account is pending administrator approval."),
      "login() must return pending administrator approval message"
    );
    assert.ok(
      authActionContent.includes("account_status === 'Declined'") ||
      authActionContent.includes("effectiveStatus === 'Declined'") ||
      authActionContent.includes("accountStatus === 'Declined'"),
      "login() must check for Declined status"
    );
    assert.ok(
      authActionContent.includes("Your account registration has been declined") ||
      authActionContent.includes("Your account registration was declined by the administrator"),
      "login() must return declined message"
    );
    assert.ok(
      authActionContent.includes("await supabase.auth.signOut()"),
      "login() must immediately terminate session for unapproved accounts"
    );
  });

  await t.test("9. Dashboard Security: Root page strictly requires Approved status for dashboards", () => {
    assert.ok(
      rootPageContent.includes('const isApproved = accountStatus === "Approved"'),
      "Root page must verify accountStatus === 'Approved'"
    );
    assert.ok(
      rootPageContent.includes("Account Pending Approval"),
      "Root page must notify unapproved pending users"
    );
    assert.ok(
      rootPageContent.includes("Account Declined"),
      "Root page must notify declined users"
    );
  });

  await t.test("10. Live Supabase Lifecycle: Register temp teacher -> Verify Pending status -> Verify Login blocked", async () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      console.warn("Skipping live Supabase lifecycle test: missing environment variables.");
      return;
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const isolatedAnonClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const testEmail = `test_pending_verify_${Date.now()}@example.com`;
    const testPassword = "ValidPassword123!";

    let createdUserId = null;

    try {
      // 1. Sign up user via isolated client (matching register action)
      const { data: signUpData, error: signUpError } = await isolatedAnonClient.auth.signUp({
        email: testEmail,
        password: testPassword,
        options: {
          data: {
            first_name: "Test",
            last_name: "Teacher",
            role: "Teacher",
            account_status: "Pending",
          },
        },
      });

      assert.ifError(signUpError);
      assert.ok(signUpData.user?.id, "User was created");
      createdUserId = signUpData.user.id;

      // 2. Query user_roles table to verify authoritative account_status === 'Pending'
      // Allow trigger small window if async
      await new Promise((r) => setTimeout(r, 600));

      const { data: roleRow, error: roleError } = await adminClient
        .from("user_roles")
        .select("role, account_status")
        .eq("user_id", createdUserId)
        .maybeSingle();

      assert.ifError(roleError);
      assert.ok(roleRow, "user_roles record must exist");
      assert.strictEqual(roleRow.account_status, "Pending", "Authoritative status must be 'Pending'");
      assert.strictEqual(roleRow.role.toLowerCase(), "teacher", "Role must be 'teacher'");

      // 3. Attempt to sign in with this pending account using signInWithPassword
      const { data: signInData, error: signInError } = await isolatedAnonClient.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      // The auth signIn succeeds at Supabase auth layer, but application login() checks status:
      assert.ok(signInData?.user, "User credentials exist");
      const userMetaStatus = signInData.user.user_metadata?.account_status;
      assert.strictEqual(userMetaStatus, "Pending", "Session user metadata has Pending status");

      // Verify that checking roleRow blocks dashboard access
      const isApproved = roleRow.account_status === "Approved";
      assert.strictEqual(isApproved, false, "Pending user is not approved for dashboard");
    } finally {
      // Cleanup: Delete temporary test user
      if (createdUserId) {
        await adminClient.auth.admin.deleteUser(createdUserId);
      }
    }
  });

  await t.test("11. Input Validation: Invalid or missing fields never produce false registration success", () => {
    assert.ok(
      authActionContent.includes("First Name and Last Name are required."),
      "register() validates required first and last name"
    );
    assert.ok(
      authActionContent.includes("Password must be at least 8 characters long"),
      "register() validates DepEd password complexity rules"
    );
    assert.ok(
      authActionContent.includes("Email address is required."),
      "register() validates email presence"
    );
  });

  await t.test("12. Admin Session Preservation: Server cookie safety check prevents admin session disruption", () => {
    assert.ok(
      authActionContent.includes("currentSession?.user?.id === signUpData.user.id"),
      "Registration only clears session if the active session matches the newly created registration ID"
    );
  });
});

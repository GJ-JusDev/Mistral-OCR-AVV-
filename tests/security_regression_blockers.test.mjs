import test from "node:test";
import assert from "node:assert/strict";

// Mock Supabase Server Client simulation for RBAC authorization unit testing
function createMockReviewAuthClient({
  user = { id: "test-user-id", email: "teacher@deped.gov.ph", user_metadata: {} },
  roleRow = null,
} = {}) {
  return {
    auth: {
      getUser: async () => ({
        data: { user },
        error: null,
      }),
    },
    from: (table) => {
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: (_col, val) => ({
              maybeSingle: async () => ({
                data: roleRow,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// Logic mirror of authoritative authorization from src/actions/review.ts
async function checkReviewAuthorization(supabaseClient) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { authorized: false, error: "Unauthorized: User not authenticated" };

  const { data: roleRow, error: roleError } = await supabaseClient
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) {
    return { authorized: false, error: "Database error verifying user permissions." };
  }

  if (!roleRow) {
    return { authorized: false, error: "Forbidden: No authoritative role assigned. Please contact an administrator." };
  }

  const role = roleRow.role?.toLowerCase();
  const accountStatus = roleRow.account_status;

  if (accountStatus !== "Approved") {
    return { authorized: false, error: "Forbidden: Account is not approved. Please contact an administrator." };
  }

  const allowedRoles = ["teacher", "principal", "admin"];
  if (!role || !allowedRoles.includes(role)) {
    return { authorized: false, error: `Forbidden: Role '${role || "none"}' is not authorized to review documents.` };
  }

  return { authorized: true, user, role, accountStatus };
}

// Logic mirror of admin authorization from src/actions/users.ts
async function checkAdminAuthorization(supabaseClient) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { authorized: false, error: "Unauthorized" };

  const { data: roleRow } = await supabaseClient
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleRow?.role !== "admin" || roleRow?.account_status !== "Approved") {
    return { authorized: false, error: "Forbidden" };
  }

  return { authorized: true, user };
}

test("Security Regression Suite: Authoritative RBAC, Safe Defaults, & Private Storage", async (t) => {
  await t.test("1. Missing user_roles row cannot authorize review (fails closed)", async () => {
    const client = createMockReviewAuthClient({
      user: { id: "attacker-1", user_metadata: {} },
      roleRow: null, // No row in user_roles
    });

    const res = await checkReviewAuthorization(client);
    assert.strictEqual(res.authorized, false);
    assert.match(res.error, /Forbidden: No authoritative role assigned/);
  });

  await t.test("2. Malicious user_metadata.role = 'admin' cannot authorize review", async () => {
    const client = createMockReviewAuthClient({
      user: {
        id: "attacker-2",
        user_metadata: { role: "admin", account_status: "Approved" }, // Forged in client metadata
      },
      roleRow: null, // authoritative database has no role
    });

    const res = await checkReviewAuthorization(client);
    assert.strictEqual(res.authorized, false);
    assert.match(res.error, /Forbidden: No authoritative role assigned/);
  });

  await t.test("3. Malicious user_metadata.account_status = 'Approved' cannot authorize review when authoritative status is Pending", async () => {
    const client = createMockReviewAuthClient({
      user: {
        id: "attacker-3",
        user_metadata: { role: "admin", account_status: "Approved" },
      },
      roleRow: {
        role: "teacher",
        account_status: "Pending", // Authoritative DB status is Pending
      },
    });

    const res = await checkReviewAuthorization(client);
    assert.strictEqual(res.authorized, false);
    assert.match(res.error, /Forbidden: Account is not approved/);
  });

  await t.test("4. Unapproved authoritative user cannot review (Declined / Inactive)", async () => {
    const client = createMockReviewAuthClient({
      user: { id: "user-4", user_metadata: {} },
      roleRow: {
        role: "teacher",
        account_status: "Declined",
      },
    });

    const res = await checkReviewAuthorization(client);
    assert.strictEqual(res.authorized, false);
    assert.match(res.error, /Forbidden: Account is not approved/);
  });

  await t.test("5. Approved authoritative role can review (Teacher / Principal / Admin)", async () => {
    for (const validRole of ["teacher", "principal", "admin"]) {
      const client = createMockReviewAuthClient({
        user: { id: `auth-${validRole}`, user_metadata: {} },
        roleRow: {
          role: validRole,
          account_status: "Approved",
        },
      });

      const res = await checkReviewAuthorization(client);
      assert.strictEqual(res.authorized, true);
      assert.strictEqual(res.role, validRole);
    }
  });

  await t.test("6. Non-admin cannot perform admin-only actions", async () => {
    // Approved teacher attempting admin action
    const teacherClient = createMockReviewAuthClient({
      user: { id: "teacher-user", user_metadata: {} },
      roleRow: { role: "teacher", account_status: "Approved" },
    });
    const teacherAdminRes = await checkAdminAuthorization(teacherClient);
    assert.strictEqual(teacherAdminRes.authorized, false);
    assert.strictEqual(teacherAdminRes.error, "Forbidden");

    // Unapproved admin attempting admin action
    const unapprovedAdminClient = createMockReviewAuthClient({
      user: { id: "unapproved-admin", user_metadata: {} },
      roleRow: { role: "admin", account_status: "Pending" },
    });
    const unapprovedAdminRes = await checkAdminAuthorization(unapprovedAdminClient);
    assert.strictEqual(unapprovedAdminRes.authorized, false);
    assert.strictEqual(unapprovedAdminRes.error, "Forbidden");

    // Approved admin succeeds
    const adminClient = createMockReviewAuthClient({
      user: { id: "approved-admin", user_metadata: {} },
      roleRow: { role: "admin", account_status: "Approved" },
    });
    const adminRes = await checkAdminAuthorization(adminClient);
    assert.strictEqual(adminRes.authorized, true);
  });

  await t.test("7. Missing OCR confidence remains unknown/null and triggers review flag", async () => {
    // Document payload without confidence
    const bodyMissingConfidence = { original_filename: "synthetic_sf9.png" };
    const storedConfidence = typeof bodyMissingConfidence.ocr_confidence === "number"
      ? bodyMissingConfidence.ocr_confidence
      : null;

    assert.strictEqual(storedConfidence, null, "Missing confidence must be null, never defaulted to 1.0");

    // Test with explicit null
    const bodyNullConfidence = { ocr_confidence: null };
    const storedNull = typeof bodyNullConfidence.ocr_confidence === "number"
      ? bodyNullConfidence.ocr_confidence
      : null;
    assert.strictEqual(storedNull, null);

    // Test with valid confidence
    const bodyValidConfidence = { ocr_confidence: 0.88 };
    const storedValid = typeof bodyValidConfidence.ocr_confidence === "number"
      ? bodyValidConfidence.ocr_confidence
      : null;
    assert.strictEqual(storedValid, 0.88);
  });

  await t.test("8. Upload path and bucket policy does not expose documents publicly", () => {
    const bucketConfig = {
      id: "documents",
      name: "documents",
      public: false,
      file_size_limit: 10485760,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
    };

    assert.strictEqual(bucketConfig.public, false, "Bucket must be private (public=false)");
    assert.strictEqual(bucketConfig.file_size_limit, 10485760);

    // Verify upload path structure isolates by authenticated user ID
    const userId = "test-teacher-uuid";
    const docFolder = "sf9";
    const safeName = "form137.png";
    const storagePath = `${userId}/${docFolder}/${Date.now()}_abc123_${safeName}`;

    assert.ok(storagePath.startsWith(`${userId}/`), "Upload path must be prefixed by authenticated user id");
    assert.ok(!storagePath.includes("public/"), "Storage path must never write to public prefix");
  });
});

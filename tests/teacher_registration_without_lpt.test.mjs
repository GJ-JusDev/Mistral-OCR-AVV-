import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("AVV Teacher Registration Without LPT Verification Suite", async (t) => {
  const registerPageContent = fs.readFileSync(
    path.join(rootDir, "src/app/register/page.tsx"),
    "utf8"
  );
  const authActionContent = fs.readFileSync(
    path.join(rootDir, "src/actions/auth.ts"),
    "utf8"
  );
  const adminUsersPageContent = fs.readFileSync(
    path.join(rootDir, "src/app/admin/users/page.tsx"),
    "utf8"
  );
  const usersActionContent = fs.readFileSync(
    path.join(rootDir, "src/actions/users.ts"),
    "utf8"
  );

  await t.test("1. UI: Registration page completely removes LPT Information and PRC inputs", () => {
    assert.strictEqual(
      registerPageContent.includes("LPT Information"),
      false,
      "Must not contain 'LPT Information' label"
    );
    assert.strictEqual(
      registerPageContent.includes('name="prc"'),
      false,
      "Must not contain input with name='prc'"
    );
    assert.strictEqual(
      registerPageContent.includes("Required for Teacher verification"),
      false,
      "Must not contain 'Required for Teacher verification' helper text"
    );
    assert.strictEqual(
      registerPageContent.includes("Limit exceeded. Only 7 numbers are allowed."),
      false,
      "Must not contain LPT digit limit error message"
    );
    assert.strictEqual(
      registerPageContent.includes("lptValue"),
      false,
      "Must not contain lptValue state"
    );
  });

  await t.test("2. UI: Registration page retains all required fields and terms", () => {
    assert.ok(registerPageContent.includes('name="firstName"'), "Retains First Name field");
    assert.ok(registerPageContent.includes('name="middleName"'), "Retains Middle Name field");
    assert.ok(registerPageContent.includes('name="lastName"'), "Retains Last Name field");
    assert.ok(registerPageContent.includes('name="nameExtension"'), "Retains Name Extension field");
    assert.ok(registerPageContent.includes('name="email"'), "Retains Email field");
    assert.ok(registerPageContent.includes('name="password"'), "Retains Password field");
    assert.ok(registerPageContent.includes('name="terms"'), "Retains Terms and Conditions checkbox");
    assert.ok(registerPageContent.includes("Create account"), "Retains Create account button");
    assert.ok(registerPageContent.includes("Teacher Registration"), "Retains Teacher Registration title");
  });

  await t.test("3. Logic: Auth registration action does not validate or require LPT/PRC", () => {
    assert.strictEqual(
      authActionContent.includes('formData.get("prc")'),
      false,
      "Must not extract 'prc' from FormData"
    );
    assert.strictEqual(
      authActionContent.includes("PRC must be exactly 7 digits long"),
      false,
      "Must not contain 7-digit PRC validation error"
    );
    assert.strictEqual(
      authActionContent.includes("prc: prc"),
      false,
      "Must not store 'prc' in user metadata on signUp"
    );
  });

  await t.test("4. Security: New registrations are automatically marked as Pending admin approval", () => {
    assert.ok(
      authActionContent.includes('account_status: "Pending"'),
      "Must automatically set account_status to 'Pending' on registration"
    );
    assert.ok(
      authActionContent.includes('role: "Teacher"'),
      "Must set role to 'Teacher' on registration"
    );
  });

  await t.test("5. Security: Unapproved / Pending accounts are blocked at login", () => {
    assert.ok(
      authActionContent.includes("account_status === 'Pending'"),
      "Login must check for Pending account_status"
    );
    assert.ok(
      authActionContent.includes("Your account is pending admin approval."),
      "Login must inform user their account is pending admin approval"
    );
    assert.ok(
      authActionContent.includes("await supabase.auth.signOut()"),
      "Pending users must be immediately signed out"
    );
  });

  await t.test("6. Admin Review: Users management screen removes PRC Info column", () => {
    assert.strictEqual(
      adminUsersPageContent.includes("<TableHead>PRC Info</TableHead>"),
      false,
      "Admin user table must not contain PRC Info header"
    );
    assert.strictEqual(
      adminUsersPageContent.includes("PrcVisibilityCell"),
      false,
      "Admin user table must not render PrcVisibilityCell"
    );
    // Table should have 6 columns now: Email, Full Name, Role, School, Status, Actions
    assert.ok(
      adminUsersPageContent.includes("colSpan={6}"),
      "Loading/empty states must span 6 columns"
    );
  });

  await t.test("7. Validation rules for Name and Password are fully preserved", () => {
    assert.ok(
      authActionContent.includes('!firstName || !lastName'),
      "First Name and Last Name must still be mandatory"
    );
    assert.ok(
      authActionContent.includes("passwordRegex"),
      "Password complexity regex must remain enforced"
    );
  });

  await t.test("8. Forward migration script exists and is safe and non-destructive", () => {
    const migrationPath = path.join(
      rootDir,
      "supabase/migrations/011_remove_prc_lpt_from_user_metadata.sql"
    );
    assert.ok(fs.existsSync(migrationPath), "Migration 011 must exist");
    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    assert.ok(
      migrationSql.includes("raw_user_meta_data - 'prc' - 'lpt_info'"),
      "Migration removes prc and lpt_info keys cleanly"
    );
  });
});

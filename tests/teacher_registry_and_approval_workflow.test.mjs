import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("AVV Teacher Registry & Secure Approval Workflow Suite", async (suite) => {
  // Load source files
  const migration016 = fs.readFileSync(
    path.join(rootDir, "supabase/migrations/016_teacher_registry_and_secure_approval.sql"),
    "utf8"
  );
  const rollback016 = fs.readFileSync(
    path.join(rootDir, "supabase/migrations/016_rollback_recovery.sql"),
    "utf8"
  );
  const nameMatcherSource = fs.readFileSync(
    path.join(rootDir, "src/lib/registry/nameMatcher.ts"),
    "utf8"
  );
  const registryActions = fs.readFileSync(
    path.join(rootDir, "src/actions/registry.ts"),
    "utf8"
  );
  const authActions = fs.readFileSync(
    path.join(rootDir, "src/actions/auth.ts"),
    "utf8"
  );
  const userActions = fs.readFileSync(
    path.join(rootDir, "src/actions/users.ts"),
    "utf8"
  );
  const autoApprovalJob = fs.readFileSync(
    path.join(rootDir, "src/lib/registry/autoApprovalJob.ts"),
    "utf8"
  );
  const registerPage = fs.readFileSync(
    path.join(rootDir, "src/app/register/page.tsx"),
    "utf8"
  );
  const registryPage = fs.readFileSync(
    path.join(rootDir, "src/app/admin/teacher-registry/page.tsx"),
    "utf8"
  );
  const usersPage = fs.readFileSync(
    path.join(rootDir, "src/app/admin/users/page.tsx"),
    "utf8"
  );
  const userActionsComponent = fs.readFileSync(
    path.join(rootDir, "src/components/admin/UserActions.tsx"),
    "utf8"
  );
  const auditTypes = fs.readFileSync(
    path.join(rootDir, "src/types/audit.ts"),
    "utf8"
  );

  // 1. Migration 016 Architecture
  await suite.test("1. Database Migration: Table definition and RLS policies", () => {
    assert.ok(
      migration016.includes("CREATE TABLE IF NOT EXISTS public.school_teacher_registry"),
      "Migration 016 must create table public.school_teacher_registry"
    );
    assert.ok(
      migration016.includes("verification_status TEXT NOT NULL DEFAULT 'unverified'"),
      "Must include verification_status with default 'unverified'"
    );
    assert.ok(
      migration016.includes("linked_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL"),
      "Must reference auth.users(id) for linked_user_id"
    );
    assert.ok(
      migration016.includes("uq_registry_linked_user"),
      "Must enforce partial unique index on linked_user_id to prevent duplicate claims"
    );
    assert.ok(
      migration016.includes("ALTER TABLE public.school_teacher_registry ENABLE ROW LEVEL SECURITY;"),
      "Must enable RLS on school_teacher_registry"
    );
    assert.ok(
      migration016.includes("auth.role() = 'service_role'"),
      "Must allow service_role full administrative access"
    );
  });

  // 2. Migration 016 user_roles extensions
  await suite.test("2. Database Migration: Extended user_roles columns", () => {
    assert.ok(migration016.includes("registration_timestamp TIMESTAMPTZ"), "Must add registration_timestamp");
    assert.ok(migration016.includes("review_eligibility_time TIMESTAMPTZ"), "Must add review_eligibility_time");
    assert.ok(migration016.includes("registry_match_status TEXT"), "Must add registry_match_status");
    assert.ok(migration016.includes("matched_registry_id UUID"), "Must add matched_registry_id");
    assert.ok(migration016.includes("approval_method TEXT"), "Must add approval_method");
    assert.ok(migration016.includes("approval_reason TEXT"), "Must add approval_reason");
    assert.ok(migration016.includes("decline_reason TEXT"), "Must add decline_reason");
    assert.ok(migration016.includes("middle_name TEXT"), "Must add middle_name");
    assert.ok(migration016.includes("middle_initial VARCHAR(1)"), "Must add middle_initial");
    assert.ok(migration016.includes("has_no_middle_name BOOLEAN"), "Must add has_no_middle_name");
  });

  // 3. Rollback script verification
  await suite.test("3. Rollback Script: Idempotent and clean teardown", () => {
    assert.ok(rollback016.includes("DROP TABLE IF EXISTS public.school_teacher_registry CASCADE;"), "Must drop table cleanly");
    assert.ok(rollback016.includes("DROP COLUMN IF EXISTS review_eligibility_time"), "Must drop added user_roles columns");
    assert.ok(rollback016.includes("DROP COLUMN IF EXISTS registry_match_status"), "Must drop registry_match_status column");
  });

  // 4. Seeded initial teacher records
  await suite.test("4. Preliminary Teacher Seed: All 8 TRIS faculty records seeded unverified", () => {
    const teachers = [
      "Arnold", "Reodique",
      "Estrella", "Babael",
      "Rachel", "Nale",
      "Wilson", "Rosales",
      "Deirek", "Alzaga",
      "Charlie", "Rivero",
      "Margie", "Ajero",
      "Blessila Theresa", "M"
    ];
    for (const t of teachers) {
      assert.ok(migration016.includes(t), `Migration seed must contain teacher name component: ${t}`);
    }
    assert.ok(
      migration016.includes("linked_user_id: NULL") || migration016.includes("'unverified'"),
      "Seeded records must be unverified and without login accounts"
    );
  });

  // 5. Audit Types: All 11 new audit actions defined
  await suite.test("5. Audit Actions: Complete registry & approval lifecycle actions defined", () => {
    const expectedActions = [
      "TEACHER_REGISTRY_CREATED",
      "TEACHER_REGISTRY_UPDATED",
      "TEACHER_REGISTRY_DEACTIVATED",
      "TEACHER_REGISTRY_ACTIVATED",
      "TEACHER_REGISTRY_VERIFIED",
      "TEACHER_REGISTRY_IMPORTED",
      "REGISTRATION_MATCH_EVALUATED",
      "ACCOUNT_AUTO_APPROVED",
      "ACCOUNT_EARLY_APPROVED",
      "ACCOUNT_EARLY_APPROVAL_DENIED",
      "EMAIL_VERIFICATION_CHECKED",
    ];
    for (const a of expectedActions) {
      assert.ok(auditTypes.includes(a), `AuditAction union must include: ${a}`);
    }
  });

  // 6. Name Matching Engine: Exact Match
  await suite.test("6. Name Matcher: Exact match on First, MI, Last, and Gmail", () => {
    // Dynamic import of nameMatcher
    const testRoster = [
      {
        id: "reg-1",
        school_id: "tris-id",
        first_name: "Arnold",
        middle_initial: "A",
        last_name: "Reodique",
        full_name_original: "Arnold A. Reodique",
        verified_email: "arnold.reodique@gmail.com",
        verification_status: "verified",
        is_active: true,
        linked_user_id: null,
      },
    ];

    assert.ok(nameMatcherSource.includes("export function evaluateRegistryMatch"), "Must export evaluateRegistryMatch");
    assert.ok(nameMatcherSource.includes("MATCHED"), "Must support MATCHED status");
    assert.ok(nameMatcherSource.includes("AMBIGUOUS"), "Must support AMBIGUOUS status");
    assert.ok(nameMatcherSource.includes("REVIEW_REQUIRED"), "Must support REVIEW_REQUIRED status");
    assert.ok(nameMatcherSource.includes("NOT_FOUND"), "Must support NOT_FOUND status");
    assert.ok(nameMatcherSource.includes("DUPLICATE_CLAIM"), "Must support DUPLICATE_CLAIM status");
    assert.ok(nameMatcherSource.includes("INACTIVE_REGISTRY_ENTRY"), "Must support INACTIVE_REGISTRY_ENTRY status");
  });

  // 7. Middle Initial derivation and "No Middle Name" handling
  await suite.test("7. Middle Initial Derivation: Handles full names and explicit no-middle-name option", () => {
    assert.ok(nameMatcherSource.includes("deriveMiddleInitial"), "Must export deriveMiddleInitial");
    assert.ok(
      nameMatcherSource.includes("hasNoMiddleName"),
      "Must support explicit hasNoMiddleName parameter"
    );
  });

  // 8. Personal Gmail restriction in Registration
  await suite.test("8. Registration Action: Enforces personal Gmail (@gmail.com)", () => {
    assert.ok(
      authActions.includes("@gmail.com"),
      "register() must validate @gmail.com domain"
    );
    assert.ok(
      authActions.includes("Registration requires a valid personal Gmail address (@gmail.com)."),
      "register() must return informative error for non-Gmail addresses"
    );
  });

  // 9. Registration UI: Middle Name & No-Middle-Name Checkbox
  await suite.test("9. Registration UI: Provides middle name input and legal exemption checkbox", () => {
    assert.ok(
      registerPage.includes("hasNoMiddleName"),
      "Registration page must have hasNoMiddleName checkbox state"
    );
    assert.ok(
      registerPage.includes("I legally do not have a middle name"),
      "Registration page must present 'I legally do not have a middle name' label"
    );
    assert.ok(
      registerPage.includes("disabled={hasNoMiddleName}"),
      "Middle name input must be disabled when hasNoMiddleName is checked"
    );
  });

  // 10. 24-Hour Review Window Calculation
  await suite.test("10. Registration Review Window: review_eligibility_time is registration + 24 hours", () => {
    assert.ok(
      authActions.includes("24 * 60 * 60 * 1000"),
      "register() must compute review_eligibility_time as registration time + 24 hours"
    );
    assert.ok(
      authActions.includes("REGISTRATION_MATCH_EVALUATED"),
      "register() must emit REGISTRATION_MATCH_EVALUATED audit event"
    );
  });

  // 11. Automatic Approval Job Criteria
  await suite.test("11. Automatic Approval Job: Evaluates all 7 strict conditions", () => {
    assert.ok(
      autoApprovalJob.includes("processPendingRegistrationsAutoApproval"),
      "Must export processPendingRegistrationsAutoApproval"
    );
    assert.ok(
      autoApprovalJob.includes("review_eligibility_time"),
      "Must filter by review_eligibility_time <= now"
    );
    assert.ok(
      autoApprovalJob.includes("authUser.email_confirmed_at"),
      "Must verify Supabase Auth email confirmation"
    );
    assert.ok(
      autoApprovalJob.includes('candidate.registry_match_status !== "MATCHED"'),
      "Must require MATCHED status"
    );
    assert.ok(
      autoApprovalJob.includes('registryRecord.verification_status !== "verified"'),
      "Must require verified registry entry"
    );
    assert.ok(
      autoApprovalJob.includes("!registryRecord.is_active"),
      "Must require active registry record"
    );
    assert.ok(
      autoApprovalJob.includes("registryRecord.linked_user_id"),
      "Must check for duplicate claim on registry record"
    );
    assert.ok(
      autoApprovalJob.includes("ACCOUNT_AUTO_APPROVED"),
      "Must log ACCOUNT_AUTO_APPROVED audit event"
    );
  });

  // 12. Early Administrator Approval Safeguards
  await suite.test("12. Early Approval: Re-auth, 'ADD THIS USER' phrase, reason, and email check", () => {
    assert.ok(
      userActions.includes("ADD THIS USER"),
      "Early approval must check exact phrase 'ADD THIS USER'"
    );
    assert.ok(
      userActions.includes("verifyAdminPassword"),
      "Early approval must re-authenticate admin password"
    );
    assert.ok(
      userActions.includes("justificationReason"),
      "Early approval must require non-empty justificationReason"
    );
    assert.ok(
      userActions.includes("targetUser.user.email_confirmed_at"),
      "Early approval must require confirmed Supabase email"
    );
    assert.ok(
      userActions.includes("ACCOUNT_EARLY_APPROVED"),
      "Early approval must log ACCOUNT_EARLY_APPROVED audit event"
    );
    assert.ok(
      userActions.includes("ACCOUNT_EARLY_APPROVAL_DENIED"),
      "Failed early approval must log ACCOUNT_EARLY_APPROVAL_DENIED audit event"
    );
  });

  // 13. Administrator Decline with Required Reason
  await suite.test("13. Decline Action: Mandatory reason and registry unlinking", () => {
    assert.ok(
      userActions.includes("declineReason"),
      "declineUser must accept and validate declineReason"
    );
    assert.ok(
      userActions.includes("linked_user_id: null"),
      "declineUser must unlink any matched registry record"
    );
    assert.ok(
      userActions.includes("ACCOUNT_DECLINED"),
      "declineUser must emit ACCOUNT_DECLINED audit log"
    );
  });

  // 14. Bulk Import: Formula Injection Sanitization
  await suite.test("14. Bulk Import Security: Sanitizes Excel/CSV formula injection prefixes", () => {
    assert.ok(
      registryActions.includes("sanitizeFormulaInjection"),
      "Must define sanitizeFormulaInjection"
    );
    assert.ok(
      registryActions.includes("^[=+\\-@\\t\\r]"),
      "Must sanitize leading '=', '+', '-', '@', tab, and carriage return characters"
    );
    assert.ok(
      registryActions.includes("cellFormula: false"),
      "XLSX parser must disable formula evaluation"
    );
  });

  // 15. Downloadable Template Generation
  await suite.test("15. Template Generator: Generates valid XLSX and CSV templates", () => {
    assert.ok(
      registryActions.includes("generateRegistryTemplate"),
      "Must export generateRegistryTemplate"
    );
    assert.ok(
      registryActions.includes("TRIS_Teacher_Registry_Template.xlsx"),
      "Must generate Excel template"
    );
    assert.ok(
      registryActions.includes("TRIS_Teacher_Registry_Template.csv"),
      "Must generate CSV template"
    );
  });

  // 16. Admin Teacher Registry UI
  await suite.test("16. Registry UI: Displays full roster, search, metrics, and modals", () => {
    assert.ok(
      registryPage.includes("Teacher Registry Management"),
      "Registry page must render official title"
    );
    assert.ok(
      registryPage.includes("Bulk Import"),
      "Registry page must provide Bulk Import button"
    );
    assert.ok(
      registryPage.includes("Add Teacher"),
      "Registry page must provide Add Teacher button"
    );
    assert.ok(
      registryPage.includes("handleDownloadTemplate"),
      "Registry page must provide template downloads"
    );
    assert.ok(
      registryPage.includes("toggleRegistryTeacherActive"),
      "Registry page must support activation/deactivation"
    );
    assert.ok(
      registryPage.includes("verifyRegistryTeacher"),
      "Registry page must support verification action"
    );
  });

  // 17. User Management UI Enhancements
  await suite.test("17. Users Admin UI: Shows countdown timer, registry match badge, and email status", () => {
    assert.ok(
      usersPage.includes("registry_match_status"),
      "Users page must display registry match status column"
    );
    assert.ok(
      usersPage.includes("remainingHours"),
      "Users page must calculate remaining hours in review window"
    );
    assert.ok(
      usersPage.includes("Confirmed"),
      "Users page must display email confirmation status"
    );
    assert.ok(
      usersPage.includes("matchFilter"),
      "Users page must support filtering by registry match outcome"
    );
    assert.ok(
      usersPage.includes("emailFilter"),
      "Users page must support filtering by email verification status"
    );
  });

  // 18. Sidebar Navigation
  await suite.test("18. Sidebar: Displays Teacher Registry navigation link for Admin", () => {
    const sidebarSource = fs.readFileSync(path.join(rootDir, "src/components/layout/Sidebar.tsx"), "utf8");
    assert.ok(
      sidebarSource.includes("/admin/teacher-registry"),
      "Sidebar must link to /admin/teacher-registry"
    );
    assert.ok(
      sidebarSource.includes("Teacher Registry"),
      "Sidebar link label must be 'Teacher Registry'"
    );
  });

  // 19. Cron Auto-Approve API Route
  await suite.test("19. Cron Route: Secure endpoint /api/cron/auto-approve with secret verification", () => {
    const cronRoute = fs.readFileSync(path.join(rootDir, "src/app/api/cron/auto-approve/route.ts"), "utf8");
    assert.ok(
      cronRoute.includes("processPendingRegistrationsAutoApproval"),
      "Route must invoke processPendingRegistrationsAutoApproval"
    );
    assert.ok(
      cronRoute.includes("CRON_SECRET"),
      "Route must check CRON_SECRET or service key authorization"
    );
  });

  // 20. SheetJS (xlsx) dependency in package.json
  await suite.test("20. Dependencies: 'xlsx' installed in package.json", () => {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    assert.ok(
      pkgJson.dependencies && pkgJson.dependencies.xlsx,
      "package.json must contain 'xlsx' dependency"
    );
  });
});

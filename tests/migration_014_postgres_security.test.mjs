import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Migration 014 — Isolated Real PostgreSQL Security & RLS Verification Suite", async (t) => {
  const db = new PGlite();

  // 1. Check PostgreSQL Engine Version
  const verRes = await db.query("SELECT version();");
  const pgVersion = verRes.rows[0].version;
  assert.ok(pgVersion.toLowerCase().includes("postgres"), "Must run against actual PostgreSQL engine");

  // 2. Setup Supabase Core Infrastructure (auth schema, roles, and helper functions)
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
      ALTER ROLE service_role BYPASSRLS;
    END
    $$;

    -- Standard Supabase Auth Context Functions
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$ LANGUAGE sql STABLE;

    -- auth.users table for FK resolution
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Base Enums and Helper Tables
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
      END IF;
    END
    $$;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'Pending',
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      CONSTRAINT user_roles_user_id_unique UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID,
      document_type TEXT NOT NULL DEFAULT 'sf9',
      image_url TEXT NOT NULL DEFAULT 'https://example.com/test.jpg',
      extracted_fields JSONB DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'submitted',
      uploaded_by UUID,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.eligibility_approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      grade_level TEXT NOT NULL,
      school_year TEXT NOT NULL,
      eligibility_type TEXT NOT NULL,
      status TEXT NOT NULL,
      decision TEXT NOT NULL,
      approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ,
      remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    -- Standard Supabase grants on public schema
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
    GRANT SELECT ON auth.users TO authenticated;
  `);

  // 3. Seed Realistic Multi-School and Role Context
  const school1Id = "a0000000-0000-0000-0000-000000000001"; // TRIS (500169)
  const school2Id = "b0000000-0000-0000-0000-000000000002"; // Other School (100200)

  const admin1Id = "11111111-1111-1111-1111-111111111111"; // School 1 Admin
  const admin2Id = "22222222-2222-2222-2222-222222222222"; // School 2 Admin
  const principal1Id = "33333333-3333-3333-3333-333333333333"; // School 1 Principal
  const teacher1Id = "44444444-4444-4444-4444-444444444444"; // School 1 Teacher
  const pending1Id = "55555555-5555-5555-5555-555555555555"; // Pending User

  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES
      ('${school1Id}', '500169', 'Taysan Resettlement Integrated School'),
      ('${school2Id}', '100200', 'San Jose National High School');

    INSERT INTO auth.users (id, email) VALUES
      ('${admin1Id}', 'admin.tris@deped.gov.ph'),
      ('${admin2Id}', 'admin.sanjose@deped.gov.ph'),
      ('${principal1Id}', 'principal.tris@deped.gov.ph'),
      ('${teacher1Id}', 'teacher.tris@deped.gov.ph'),
      ('${pending1Id}', 'pending.applicant@gmail.com');

    INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES
      ('${admin1Id}', 'admin', 'Approved', '${school1Id}'),
      ('${admin2Id}', 'admin', 'Approved', '${school2Id}'),
      ('${principal1Id}', 'principal', 'Approved', '${school1Id}'),
      ('${teacher1Id}', 'teacher', 'Approved', '${school1Id}'),
      ('${pending1Id}', 'teacher', 'Pending', '${school1Id}');
  `);

  // 4. Execute Migration 014 SQL in its entirety
  const migration014Path = path.join(rootDir, "supabase", "migrations", "014_admin_audit_logs.sql");
  const migration014Sql = fs.readFileSync(migration014Path, "utf-8");
  await db.exec(migration014Sql);

  // Helper function to execute queries under simulated Supabase JWT context
  async function asUser(userId, role, callback) {
    await db.exec(`
      SET ROLE ${role};
      SET request.jwt.claim.sub = '${userId || ""}';
      SET request.jwt.claim.role = '${role}';
    `);
    try {
      return await callback();
    } finally {
      await db.exec(`
        RESET ROLE;
        RESET request.jwt.claim.sub;
        RESET request.jwt.claim.role;
      `);
    }
  }

  // 5. Seed Test Audit Records via service_role
  await asUser(null, "service_role", async () => {
    await db.query(`
      INSERT INTO public.audit_logs (
        actor_user_id, actor_email, actor_role, actor_school_id, school_id, category, action, outcome, reason
      ) VALUES
        ('${admin1Id}', 'admin.tris@deped.gov.ph', 'admin', '${school1Id}', '${school1Id}', 'AUTHENTICATION', 'AUTH_LOGIN_SUCCESS', 'SUCCESS', 'School 1 Login'),
        ('${teacher1Id}', 'teacher.tris@deped.gov.ph', 'teacher', '${school1Id}', '${school1Id}', 'DOCUMENT', 'DOCUMENT_UPLOADED', 'SUCCESS', 'School 1 Upload'),
        ('${admin2Id}', 'admin.sanjose@deped.gov.ph', 'admin', '${school2Id}', '${school2Id}', 'AUTHENTICATION', 'AUTH_LOGIN_SUCCESS', 'SUCCESS', 'School 2 Login');
    `);
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 1: Ordinary Teachers CANNOT view audit records
  // ---------------------------------------------------------------------------
  await t.test("Scenario 1 — RLS Denial: Ordinary Teacher receives 0 audit log records", async () => {
    const res = await asUser(teacher1Id, "authenticated", async () => {
      return await db.query("SELECT * FROM public.audit_logs;");
    });
    assert.equal(res.rows.length, 0, "Teachers must be denied access to all audit logs by RLS");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 2: Ordinary Principals CANNOT view audit records
  // ---------------------------------------------------------------------------
  await t.test("Scenario 2 — RLS Denial: Principal receives 0 audit log records", async () => {
    const res = await asUser(principal1Id, "authenticated", async () => {
      return await db.query("SELECT * FROM public.audit_logs;");
    });
    assert.equal(res.rows.length, 0, "Principals must be denied access to admin audit logs by RLS");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 3: Anonymous / unauthenticated probe denied
  // ---------------------------------------------------------------------------
  await t.test("Scenario 3 — Privilege Boundary: Anonymous users have ZERO select privilege", async () => {
    await assert.rejects(
      async () => {
        await asUser(null, "anon", async () => {
          return await db.query("SELECT * FROM public.audit_logs;");
        });
      },
      /permission denied/i,
      "Anonymous users must be blocked from selecting audit logs by table privilege revocation"
    );
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 4: School 1 Admin CAN ONLY view School 1 records
  // ---------------------------------------------------------------------------
  await t.test("Scenario 4 — School Isolation: School 1 Admin sees only School 1 events", async () => {
    const res = await asUser(admin1Id, "authenticated", async () => {
      return await db.query("SELECT * FROM public.audit_logs;");
    });

    assert.equal(res.rows.length, 2, "School 1 Admin should only see 2 School 1 events");
    for (const row of res.rows) {
      assert.equal(row.actor_school_id, school1Id, "All returned events must belong to School 1");
    }
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 5: School 2 Admin CAN ONLY view School 2 records
  // ---------------------------------------------------------------------------
  await t.test("Scenario 5 — Cross-School Isolation: School 2 Admin cannot see School 1 records", async () => {
    const res = await asUser(admin2Id, "authenticated", async () => {
      return await db.query("SELECT * FROM public.audit_logs;");
    });

    assert.equal(res.rows.length, 1, "School 2 Admin should only see 1 School 2 event");
    assert.equal(res.rows[0].actor_school_id, school2Id, "Returned event must belong to School 2");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 6: Database-Level Immutability (UPDATE blocked)
  // ---------------------------------------------------------------------------
  await t.test("Scenario 6 — Immutability: UPDATE is strictly denied by trigger and RLS", async () => {
    // Attempt as Admin: Denied by table privileges (UPDATE revoked)
    await assert.rejects(
      async () => {
        await asUser(admin1Id, "authenticated", async () => {
          await db.query(`UPDATE public.audit_logs SET reason = 'Tampered log' WHERE actor_school_id = '${school1Id}';`);
        });
      },
      /permission denied/i,
      "UPDATE statement from authenticated user must be denied by table privileges"
    );

    // Attempt as service_role: Denied by the immutable database trigger
    await assert.rejects(
      async () => {
        await asUser(null, "service_role", async () => {
          await db.query(`UPDATE public.audit_logs SET reason = 'Tampered by service_role';`);
        });
      },
      /immutable and cannot be updated or deleted/i,
      "Even service_role must be blocked by the immutability trigger"
    );
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 7: Database-Level Immutability (DELETE blocked)
  // ---------------------------------------------------------------------------
  await t.test("Scenario 7 — Immutability: DELETE is strictly denied by trigger and RLS", async () => {
    // Attempt as Admin: Denied by table privileges (DELETE revoked)
    await assert.rejects(
      async () => {
        await asUser(admin1Id, "authenticated", async () => {
          await db.query(`DELETE FROM public.audit_logs WHERE actor_school_id = '${school1Id}';`);
        });
      },
      /permission denied/i,
      "DELETE statement from authenticated user must be denied by table privileges"
    );

    // Attempt as service_role: Denied by the immutable database trigger
    await assert.rejects(
      async () => {
        await asUser(null, "service_role", async () => {
          await db.query(`DELETE FROM public.audit_logs;`);
        });
      },
      /immutable and cannot be updated or deleted/i,
      "Even service_role must be blocked by the immutability trigger"
    );
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 8: Direct client INSERT by authenticated user is blocked
  // ---------------------------------------------------------------------------
  await t.test("Scenario 8 — Privilege boundary: Direct client INSERT is revoked", async () => {
    await assert.rejects(
      async () => {
        await asUser(teacher1Id, "authenticated", async () => {
          await db.query(`
            INSERT INTO public.audit_logs (actor_role, category, action, outcome)
            VALUES ('admin', 'SECURITY', 'UNAUTHORIZED_ACCESS_DENIED', 'SUCCESS');
          `);
        });
      },
      /permission denied/i,
      "Direct INSERT on audit_logs must be revoked from authenticated users"
    );
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 9: Authoritative Attribution via record_audit_event()
  // ---------------------------------------------------------------------------
  await t.test("Scenario 9 — Anti-Spoofing: record_audit_event() authoritatively sets actor role and school", async () => {
    // Teacher calls record_audit_event
    const eventId = await asUser(teacher1Id, "authenticated", async () => {
      const res = await db.query(`
        SELECT public.record_audit_event(
          'DOCUMENT',
          'DOCUMENT_UPLOADED',
          'SUCCESS',
          'document',
          'doc-101',
          'SF9_Grade11.pdf',
          '${school1Id}',
          '{"type": "sf9"}'::jsonb,
          'Teacher uploaded document'
        ) AS event_id;
      `);
      return res.rows[0].event_id;
    });

    assert.ok(eventId, "Event ID must be generated");

    // Inspect the generated row using service_role
    const checkRes = await asUser(null, "service_role", async () => {
      return await db.query(`SELECT * FROM public.audit_logs WHERE id = '${eventId}';`);
    });

    const eventRow = checkRes.rows[0];
    assert.equal(eventRow.actor_user_id, teacher1Id, "actor_user_id must match authenticated caller");
    assert.equal(eventRow.actor_role, "teacher", "actor_role must be authoritatively resolved as teacher");
    assert.equal(eventRow.actor_school_id, school1Id, "actor_school_id must match teacher's school");
    assert.equal(eventRow.actor_email, "teacher.tris@deped.gov.ph", "actor_email must be resolved from auth.users");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 10: Pending user attribution
  // ---------------------------------------------------------------------------
  await t.test("Scenario 10 — Pending user attribution: Recorded accurately without privilege escalation", async () => {
    const eventId = await asUser(pending1Id, "authenticated", async () => {
      const res = await db.query(`
        SELECT public.record_audit_event(
          'REGISTRATION',
          'REGISTRATION_SUBMITTED',
          'SUCCESS',
          'user',
          '${pending1Id}',
          'Pending Applicant',
          '${school1Id}',
          '{}'::jsonb,
          'Registration form submitted'
        ) AS event_id;
      `);
      return res.rows[0].event_id;
    });

    const checkRes = await asUser(null, "service_role", async () => {
      return await db.query(`SELECT * FROM public.audit_logs WHERE id = '${eventId}';`);
    });

    const eventRow = checkRes.rows[0];
    assert.equal(eventRow.actor_user_id, pending1Id);
    assert.equal(eventRow.actor_email, "pending.applicant@gmail.com");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 11: Service-Role Mutation Attribution & Operation Tracking
  // ---------------------------------------------------------------------------
  await t.test("Scenario 11 — Service-Role Actor Attribution: Resolves actual authenticated user, not null/service_role", async () => {
    const srvTestUserId = "66666666-6666-6666-6666-666666666666";
    const opId1 = "op-srv-approval-001";

    await asUser(null, "service_role", async () => {
      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${srvTestUserId}', 'srv.applicant@example.com');
        INSERT INTO public.user_roles (user_id, role, account_status, school_id)
        VALUES ('${srvTestUserId}', 'teacher', 'Pending', '${school1Id}');
      `);
    });

    // Execute update as service_role (simulating Supabase adminClient in server action)
    await asUser(null, "service_role", async () => {
      await db.query(`
        UPDATE public.user_roles
        SET account_status = 'Approved',
            updated_by = '${admin1Id}',
            last_operation_id = '${opId1}'
        WHERE user_id = '${srvTestUserId}';
      `);
    });

    const checkSrv = await asUser(null, "service_role", async () => {
      return await db.query(`
        SELECT * FROM public.audit_logs
        WHERE request_id = '${opId1}';
      `);
    });

    assert.equal(checkSrv.rows.length, 1, "Exactly one audit log must be recorded for service-role execution");
    const logRow = checkSrv.rows[0];
    assert.equal(logRow.actor_user_id, admin1Id, "actor_user_id must resolve to the authenticated admin, NOT null");
    assert.equal(logRow.actor_role, "admin", "actor_role must resolve to 'admin', NOT 'service_role'");
    assert.equal(logRow.actor_email, "admin.tris@deped.gov.ph", "actor_email must resolve to admin's email");
    assert.equal(logRow.actor_school_id, school1Id, "actor_school_id must resolve to admin's school");
    assert.equal(logRow.request_id, opId1, "request_id must preserve the unique operation ID");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 12: Service-Role Account Deletion Attribution
  // ---------------------------------------------------------------------------
  await t.test("Scenario 12 — Account Deletion Attribution: Deletion by service_role preserves actor", async () => {
    const delTargetId = "77777777-7777-7777-7777-777777777777";
    const opDel = "op-srv-delete-001";

    await asUser(null, "service_role", async () => {
      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${delTargetId}', 'delete.candidate@example.com');
        INSERT INTO public.user_roles (user_id, role, account_status, school_id, updated_by, last_operation_id)
        VALUES ('${delTargetId}', 'teacher', 'Declined', '${school1Id}', '${admin1Id}', '${opDel}');
      `);

      // Deletion executed via service_role
      await db.query(`DELETE FROM public.user_roles WHERE user_id = '${delTargetId}';`);
    });

    const checkDel = await asUser(null, "service_role", async () => {
      return await db.query(`
        SELECT * FROM public.audit_logs
        WHERE target_id = '${delTargetId}' AND action = 'ACCOUNT_DELETED';
      `);
    });

    assert.equal(checkDel.rows.length, 1, "ACCOUNT_DELETED audit log must be recorded on deletion");
    assert.equal(checkDel.rows[0].actor_user_id, admin1Id, "Deleted row trigger must attribute action to admin1Id");
    assert.equal(checkDel.rows[0].actor_role, "admin");
    assert.equal(checkDel.rows[0].details.deleted_status, "Declined");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 13: Rapid Consecutive Legitimate Actions (Zero Silent Discards)
  // ---------------------------------------------------------------------------
  await t.test("Scenario 13 — Zero Silent Discards: Rapid consecutive legitimate actions are BOTH preserved", async () => {
    const rapidUserId = "88888888-8888-8888-8888-888888888888";
    const opRapid1 = "op-rapid-001";
    const opRapid2 = "op-rapid-002";

    await asUser(null, "service_role", async () => {
      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${rapidUserId}', 'rapid.test@example.com');
        INSERT INTO public.user_roles (user_id, role, account_status, school_id)
        VALUES ('${rapidUserId}', 'teacher', 'Pending', '${school1Id}');
      `);
    });

    // Action 1: Admin approves the user
    await asUser(admin1Id, "authenticated", async () => {
      await db.query(`
        UPDATE public.user_roles
        SET account_status = 'Approved', last_operation_id = '${opRapid1}'
        WHERE user_id = '${rapidUserId}';
      `);
    });

    // Action 2: Immediately after (rapid consecutive action), Admin updates role to 'principal'
    await asUser(admin1Id, "authenticated", async () => {
      await db.query(`
        UPDATE public.user_roles
        SET role = 'principal', last_operation_id = '${opRapid2}'
        WHERE user_id = '${rapidUserId}';
      `);
    });

    // Verify BOTH actions were durably recorded without either being silently discarded
    const logsRes = await asUser(null, "service_role", async () => {
      return await db.query(`
        SELECT action, request_id FROM public.audit_logs
        WHERE target_id = '${rapidUserId}'
        ORDER BY created_at ASC;
      `);
    });

    assert.equal(logsRes.rows.length, 2, "Both rapid consecutive legitimate actions must be recorded");
    assert.equal(logsRes.rows[0].action, "ACCOUNT_APPROVED");
    assert.equal(logsRes.rows[0].request_id, opRapid1);
    assert.equal(logsRes.rows[1].action, "USER_ROLE_CHANGED");
    assert.equal(logsRes.rows[1].request_id, opRapid2);
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 14: Operation-ID Deduplication & Idempotent Retries
  // ---------------------------------------------------------------------------
  await t.test("Scenario 14 — Idempotent Retries: Exact duplicate operation_id suppresses redundant insert", async () => {
    const retryUserId = "99999999-9999-9999-9999-999999999999";
    const retryOpId = "op-retry-idempotent-001";

    await asUser(null, "service_role", async () => {
      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${retryUserId}', 'retry.test@example.com');
        INSERT INTO public.user_roles (user_id, role, account_status, school_id)
        VALUES ('${retryUserId}', 'teacher', 'Pending', '${school1Id}');
      `);
    });

    // First attempt
    await asUser(admin1Id, "authenticated", async () => {
      await db.query(`
        UPDATE public.user_roles
        SET account_status = 'Approved', last_operation_id = '${retryOpId}'
        WHERE user_id = '${retryUserId}';
      `);
    });

    // Re-attempt with identical operation_id (retry)
    await asUser(admin1Id, "authenticated", async () => {
      await db.query(`
        UPDATE public.user_roles
        SET account_status = 'Approved', last_operation_id = '${retryOpId}'
        WHERE user_id = '${retryUserId}';
      `);
    });

    const retryAudit = await asUser(null, "service_role", async () => {
      return await db.query(`
        SELECT * FROM public.audit_logs
        WHERE request_id = '${retryOpId}';
      `);
    });

    assert.equal(retryAudit.rows.length, 1, "Idempotent retry with same operation_id must not produce duplicate audit logs");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 15: Transactional Audit on public.documents Decisions
  // ---------------------------------------------------------------------------
  await t.test("Scenario 15 — Transactional Audit: Document review decisions & grade corrections", async () => {
    const docId = "d0000000-0000-0000-0000-000000000001";
    const opDocGrade = "op-doc-grade-001";
    const opDocApprove = "op-doc-approve-001";

    await asUser(null, "service_role", async () => {
      await db.query(`
        INSERT INTO public.documents (id, document_type, school_id, status, extracted_fields)
        VALUES ('${docId}', 'sf9', '${school1Id}', 'needs_review', '{"grades": [{"subject": "Math", "final": 74}]}'::jsonb);
      `);
    });

    // 15.1 Grade Correction Trigger
    await asUser(admin1Id, "authenticated", async () => {
      await db.query(`
        UPDATE public.documents
        SET extracted_fields = '{"grades": [{"subject": "Math", "final": 80}]}'::jsonb,
            reviewed_by = '${admin1Id}',
            last_operation_id = '${opDocGrade}'
        WHERE id = '${docId}';
      `);
    });

    const checkGrade = await asUser(null, "service_role", async () => {
      return await db.query(`
        SELECT * FROM public.audit_logs
        WHERE request_id = '${opDocGrade}';
      `);
    });
    assert.equal(checkGrade.rows.length, 1, "GRADE_CORRECTED audit log must be automatically generated");
    assert.equal(checkGrade.rows[0].category, "ACADEMIC");
    assert.equal(checkGrade.rows[0].actor_user_id, admin1Id);

    // 15.2 Review Approval Trigger
    await asUser(admin1Id, "authenticated", async () => {
      await db.query(`
        UPDATE public.documents
        SET status = 'approved',
            reviewed_by = '${admin1Id}',
            last_operation_id = '${opDocApprove}'
        WHERE id = '${docId}';
      `);
    });

    const checkReview = await asUser(null, "service_role", async () => {
      return await db.query(`
        SELECT * FROM public.audit_logs
        WHERE request_id = '${opDocApprove}';
      `);
    });
    assert.equal(checkReview.rows.length, 1, "REVIEW_APPROVED audit log must be automatically generated");
    assert.equal(checkReview.rows[0].category, "REVIEW");
    assert.equal(checkReview.rows[0].details.previous_status, "needs_review");
    assert.equal(checkReview.rows[0].details.new_status, "approved");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 16: Eligibility Trigger Attachment & Column Verification
  // ---------------------------------------------------------------------------
  await t.test("Scenario 16 — Eligibility Trigger Verification: Actively attached to table and columns", async () => {
    // 16.1 Confirm trigger is attached in PostgreSQL system catalog
    const trgCheck = await db.query(`
      SELECT tgname, relname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE tgname = 'trg_audit_eligibility_decision';
    `);
    assert.equal(trgCheck.rows.length, 1, "trg_audit_eligibility_decision MUST be actively attached in pg_trigger");
    assert.equal(trgCheck.rows[0].relname, "eligibility_approvals", "Trigger must be attached to eligibility_approvals");

    // 16.2 Test execution of trigger on insertion
    const student1Id = "e0000000-0000-0000-0000-000000000001";
    const opEligId = "op-elig-001";

    await asUser(principal1Id, "authenticated", async () => {
      await db.query(`
        INSERT INTO public.eligibility_approvals (
          student_id, school_id, grade_level, school_year, eligibility_type, status, decision, approved_by, remarks, last_operation_id
        ) VALUES (
          '${student1Id}', '${school1Id}', 'Grade 12', '2023-2024', 'Grade 12 Graduation', 'Eligible', 'Approved', '${principal1Id}', 'Verified graduation requirements satisfied', '${opEligId}'
        );
      `);
    });

    const checkEligibility = await asUser(null, "service_role", async () => {
      return await db.query(`
        SELECT * FROM public.audit_logs
        WHERE request_id = '${opEligId}';
      `);
    });

    assert.equal(checkEligibility.rows.length, 1, "ELIGIBILITY_DECISION audit log must be recorded");
    assert.equal(checkEligibility.rows[0].category, "ACADEMIC");
    assert.equal(checkEligibility.rows[0].actor_user_id, principal1Id, "Authoritative actor must be Principal 1");
    assert.equal(checkEligibility.rows[0].details.decision, "Approved");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 17: ACID Atomicity & Rollback Integrity
  // ---------------------------------------------------------------------------
  await t.test("Scenario 17 — ACID Atomicity: Rolled back transaction leaves NO un-audited changes", async () => {
    const rollbackUserId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    await asUser(null, "service_role", async () => {
      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES ('${rollbackUserId}', 'rollback.test@example.com');
        INSERT INTO public.user_roles (user_id, role, account_status, school_id)
        VALUES ('${rollbackUserId}', 'teacher', 'Pending', '${school1Id}');
      `);
    });

    // Run transaction that is explicitly rolled back
    await db.exec(`
      BEGIN;
      UPDATE public.user_roles SET account_status = 'Approved' WHERE user_id = '${rollbackUserId}';
      ROLLBACK;
    `);

    // Verify user role is still Pending
    const userRoleRes = await db.query(`SELECT account_status FROM public.user_roles WHERE user_id = '${rollbackUserId}';`);
    assert.equal(userRoleRes.rows[0].account_status, "Pending", "Data change must be rolled back");

    // Verify NO audit log was committed for this user
    const auditRes = await db.query(`SELECT * FROM public.audit_logs WHERE target_id = '${rollbackUserId}';`);
    assert.equal(auditRes.rows.length, 0, "No orphaned audit log should exist for a rolled back mutation");
  });

  // ---------------------------------------------------------------------------
  // Verification Scenario 18: Cross-School Isolation & Migration 013 Independence
  // ---------------------------------------------------------------------------
  await t.test("Scenario 18 — Isolation & Independence: Cross-school denial and 013 independence", async () => {
    // Cross-school RLS check
    const res = await asUser(admin2Id, "authenticated", async () => {
      return await db.query(`SELECT * FROM public.audit_logs WHERE school_id = '${school1Id}';`);
    });
    assert.equal(res.rows.length, 0, "School 2 Admin must be denied viewing School 1 audit logs");

    // Confirm that Migration 013 tables (attendance_records, remedial_records) DO NOT EXIST in this test environment
    const m013Check = await db.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename IN ('attendance_records', 'attendance_summaries', 'remedial_records');
    `);
    assert.equal(m013Check.rows.length, 0, "Migration 013 tables must NOT exist, proving Migration 014 has ZERO dependencies on Migration 013");
  });
});

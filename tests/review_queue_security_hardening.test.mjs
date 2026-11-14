/**
 * AVV System — Review Queue Direct Deletion Security Hardening Test Suite
 *
 * Exhaustive security and penetration verification for:
 * 1. Forged User IDs (Client-supplied actor identity rejection & strict auth.uid derivation)
 * 2. Unauthorized RPC Execution (anon & PUBLIC role revocation)
 * 3. Missing School Assignments & NULL school_id Ownership Policy:
 *    - Teachers without assigned school are blocked.
 *    - Documents with NULL school_id cannot be deleted by non-owner teachers.
 *    - Documents with NULL school_id CAN be deleted by verified owner teachers (uploaded_by).
 *    - Division administrators can delete across schools and unassigned documents.
 * 4. Cross-School Access Isolation (Blocked across distinct institutions)
 * 5. Unapproved Accounts (Pending, Declined, and unverified users blocked)
 * 6. Role Authorization & Monitoring Separation (Principals blocked; only approved Teachers/Admins allowed)
 * 7. Ineligible Document State Protection (Approved, validated, submitted records protected from deletion)
 * 8. Repeated Deletion Prevention (Idempotency and double-deletion rejection)
 * 9. Elimination of Older RPC Overloads (No bypass overloads remain executable)
 * 10. Atomic Transaction Semantics (Document archival and audit logging commit/rollback together)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("AVV Review Queue Security Hardening & Penetration Test Suite", async (t) => {
  const db = new PGlite();

  // ---------------------------------------------------------------------------
  // Infrastructure Setup
  // ---------------------------------------------------------------------------
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

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$ LANGUAGE sql STABLE;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY,
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

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

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      grade_level TEXT,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      document_type TEXT NOT NULL DEFAULT 'sf9',
      image_url TEXT NOT NULL DEFAULT 'https://example.com/test.jpg',
      original_filename TEXT,
      extracted_fields JSONB DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (status IN ('submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected')),
      uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      transaction_id BIGINT DEFAULT txid_current(),
      actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      actor_email TEXT,
      actor_role TEXT NOT NULL DEFAULT 'anonymous',
      actor_school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      actor_school_name TEXT,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      target_label TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED', 'WARNING')),
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      reason TEXT,
      request_id TEXT,
      ip_address TEXT,
      user_agent TEXT
    );

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
    GRANT SELECT ON auth.users TO authenticated;
  `);

  // Apply Hardened Migration 018
  const migration018Sql = fs.readFileSync(
    path.join(rootDir, "supabase", "migrations", "018_review_queue_direct_deletion.sql"),
    "utf8"
  );
  await db.exec(migration018Sql);

  // Setup test institutions
  const schoolTrisId = "a0000000-0000-0000-0000-000000000001";
  const schoolOtherId = "b0000000-0000-0000-0000-000000000002";

  // Setup test users
  const adminSchoolUser = "11111111-1111-1111-1111-111111111111"; // Admin for TRIS
  const superAdminUser = "12121212-1212-1212-1212-121212121212";  // Division/System Admin (school_id is null)
  const teacherTris = "22222222-2222-2222-2222-222222222222";     // Approved Teacher TRIS
  const teacherOther = "33333333-3333-3333-3333-333333333333";    // Approved Teacher Other School
  const teacherNoSchool = "44444444-4444-4444-4444-444444444444"; // Approved Teacher with NO school assigned
  const pendingTeacher = "55555555-5555-5555-5555-555555555555";  // Pending Teacher
  const declinedTeacher = "66666666-6666-6666-6666-666666666666"; // Declined Teacher
  const principalUser = "77777777-7777-7777-7777-777777777777";   // Approved Principal (monitoring only)
  const unknownUser = "88888888-8888-8888-8888-888888888888";     // Auth user with NO user_roles row

  await db.exec(`
    INSERT INTO public.schools (id, school_id, name) VALUES
      ('${schoolTrisId}', '500169', 'Taysan Resettlement Integrated School'),
      ('${schoolOtherId}', '300999', 'Other Secondary High School')
    ON CONFLICT (school_id) DO NOTHING;

    INSERT INTO auth.users (id, email) VALUES
      ('${adminSchoolUser}', 'admin.tris@tris.edu.ph'),
      ('${superAdminUser}', 'division.admin@deped.gov.ph'),
      ('${teacherTris}', 'teacher.tris@tris.edu.ph'),
      ('${teacherOther}', 'teacher.other@other.edu.ph'),
      ('${teacherNoSchool}', 'teacher.unassigned@deped.gov.ph'),
      ('${pendingTeacher}', 'teacher.pending@tris.edu.ph'),
      ('${declinedTeacher}', 'teacher.declined@tris.edu.ph'),
      ('${principalUser}', 'principal@tris.edu.ph'),
      ('${unknownUser}', 'unknown@example.com')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role, account_status, school_id) VALUES
      ('${adminSchoolUser}', 'admin', 'Approved', '${schoolTrisId}'),
      ('${superAdminUser}', 'admin', 'Approved', NULL),
      ('${teacherTris}', 'teacher', 'Approved', '${schoolTrisId}'),
      ('${teacherOther}', 'teacher', 'Approved', '${schoolOtherId}'),
      ('${teacherNoSchool}', 'teacher', 'Approved', NULL),
      ('${pendingTeacher}', 'teacher', 'Pending', '${schoolTrisId}'),
      ('${declinedTeacher}', 'teacher', 'Declined', '${schoolTrisId}'),
      ('${principalUser}', 'principal', 'Approved', '${schoolTrisId}')
    ON CONFLICT (user_id) DO UPDATE SET
      role = EXCLUDED.role,
      account_status = EXCLUDED.account_status,
      school_id = EXCLUDED.school_id;
  `);

  // Helper function to execute queries under simulated Supabase JWT & RLS context
  async function asUser(userId, role, callback) {
    const actualRole = role || (userId ? "authenticated" : "anon");
    await db.exec(`
      SET ROLE ${actualRole};
      SET request.jwt.claim.sub = '${userId || ""}';
      SET request.jwt.claim.role = '${actualRole}';
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

  // ---------------------------------------------------------------------------
  // SECURITY TEST 1: Forged User IDs & Strict Identity Derivation
  // ---------------------------------------------------------------------------
  await t.test("Security Test 1: Forged identity rejection & strict auth.uid() derivation", async () => {
    const docId = "d1000000-0000-0000-0000-000000000001";
    await db.exec(`
      INSERT INTO public.documents (id, document_type, status, school_id, original_filename)
      VALUES ('${docId}', 'sf9', 'needs_review', '${schoolTrisId}', 'Test_Spoof.pdf')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 1a. Attempting to supply a 3rd parameter (p_actor_id) must fail because function signature is strictly (UUID, TEXT)
    await asUser(teacherTris, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text, $3::uuid)`,
            [docId, "I am deleting this", adminSchoolUser]
          );
        },
        /function public\.archive_review_document\(uuid, text, uuid\) does not exist/,
        "3-argument RPC signature with spoofable actor ID must not exist"
      );
    });

    // 1b. Calling without an authenticated session (auth.uid() is NULL) must fail
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '';`);
    try {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docId, "I am deleting this"]
          );
        },
        /Unauthorized: User not authenticated/,
        "RPC must reject calls when auth.uid() is empty or null"
      );
    } finally {
      await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
    }
  });

  // ---------------------------------------------------------------------------
  // SECURITY TEST 2: Unauthorized RPC Execution (anon & PUBLIC revocation)
  // ---------------------------------------------------------------------------
  await t.test("Security Test 2: anon role execution is blocked by REVOKE", async () => {
    const docId = "d1000000-0000-0000-0000-000000000002";
    await db.exec(`
      INSERT INTO public.documents (id, document_type, status, school_id, original_filename)
      VALUES ('${docId}', 'sf9', 'needs_review', '${schoolTrisId}', 'Anon_Test.pdf')
      ON CONFLICT (id) DO NOTHING;
    `);

    await asUser(null, "anon", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docId, "I am deleting this"]
          );
        },
        /permission denied for function archive_review_document/,
        "anon role must not have EXECUTE privilege on archive_review_document"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // SECURITY TEST 3: Missing School Assignments & Documents with NULL school_id
  // ---------------------------------------------------------------------------
  await t.test("Security Test 3: Unverified teacher school assignment & NULL school_id policy", async () => {
    const docAssigned = "d1000000-0000-0000-0000-000000000003";
    const docNullSchoolNonOwner = "d1000000-0000-0000-0000-000000000031";
    const docNullSchoolOwner = "d1000000-0000-0000-0000-000000000032";

    await db.exec(`
      INSERT INTO public.documents (id, document_type, status, school_id, uploaded_by, original_filename)
      VALUES 
        ('${docAssigned}', 'sf9', 'needs_review', '${schoolTrisId}', '${teacherTris}', 'Assigned_Doc.pdf'),
        ('${docNullSchoolNonOwner}', 'sf9', 'needs_review', NULL, '${superAdminUser}', 'Null_School_NonOwner.pdf'),
        ('${docNullSchoolOwner}', 'sf9', 'needs_review', NULL, '${teacherTris}', 'Null_School_Owner.pdf')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 3a. Teacher with NULL school_id is rejected on assigned document
    await asUser(teacherNoSchool, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docAssigned, "I am deleting this"]
          );
        },
        /Forbidden: Caller school cannot be verified/,
        "Teachers without verified school assignment cannot delete records"
      );
    });

    // 3b. Teacher cannot delete document with NULL school_id if NOT the documented owner
    await asUser(teacherTris, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docNullSchoolNonOwner, "I am deleting this"]
          );
        },
        /Forbidden: Teachers cannot delete documents with unassigned school unless explicitly authorized as the document owner/,
        "Teacher cannot delete unassigned school document uploaded by someone else"
      );
    });

    // 3c. Teacher CAN delete document with NULL school_id if they ARE the verified owner (uploaded_by)
    await asUser(teacherTris, "authenticated", async () => {
      const res = await db.query(
        `SELECT public.archive_review_document($1::uuid, $2::text) AS res`,
        [docNullSchoolOwner, "I am deleting this"]
      );
      assert.equal(res.rows[0].res.success, true);
      assert.equal(res.rows[0].res.new_status, "archived");
    });

    // 3d. Division Administrator (school_id is NULL) IS permitted
    await asUser(superAdminUser, "authenticated", async () => {
      const res = await db.query(
        `SELECT public.archive_review_document($1::uuid, $2::text) AS res`,
        [docNullSchoolNonOwner, "I am deleting this"]
      );
      assert.equal(res.rows[0].res.success, true);
      assert.equal(res.rows[0].res.new_status, "archived");
    });
  });

  // ---------------------------------------------------------------------------
  // SECURITY TEST 4: Cross-School Access Isolation
  // ---------------------------------------------------------------------------
  await t.test("Security Test 4: Cross-school deletion is strictly blocked", async () => {
    const docTris = "d1000000-0000-0000-0000-000000000004";
    const docOther = "d1000000-0000-0000-0000-000000000005";

    await db.exec(`
      INSERT INTO public.documents (id, document_type, status, school_id, original_filename)
      VALUES 
        ('${docTris}', 'sf9', 'needs_review', '${schoolTrisId}', 'TRIS_Doc.pdf'),
        ('${docOther}', 'sf9', 'needs_review', '${schoolOtherId}', 'Other_Doc.pdf')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Teacher from School Other tries to delete TRIS document
    await asUser(teacherOther, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docTris, "I am deleting this"]
          );
        },
        /Forbidden: Cannot delete document belonging to another school/,
        "Teacher cannot delete document from another school"
      );
    });

    // School-assigned admin from TRIS tries to delete School Other's document
    await asUser(adminSchoolUser, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docOther, "I am deleting this"]
          );
        },
        /Forbidden: Cannot delete document belonging to another school/,
        "School-assigned admin cannot delete document from another school"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // SECURITY TEST 5: Unapproved and Unregistered Accounts
  // ---------------------------------------------------------------------------
  await t.test("Security Test 5: Unapproved (Pending/Declined) accounts are blocked", async () => {
    const docId = "d1000000-0000-0000-0000-000000000006";
    await db.exec(`
      INSERT INTO public.documents (id, document_type, status, school_id, original_filename)
      VALUES ('${docId}', 'sf9', 'needs_review', '${schoolTrisId}', 'Pending_Test.pdf')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Pending teacher
    await asUser(pendingTeacher, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docId, "I am deleting this"]
          );
        },
        /Forbidden: Account is not approved \(Status: Pending\)/,
        "Pending account must be blocked"
      );
    });

    // Declined teacher
    await asUser(declinedTeacher, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docId, "I am deleting this"]
          );
        },
        /Forbidden: Account is not approved \(Status: Declined\)/,
        "Declined account must be blocked"
      );
    });

    // User with no user_roles profile
    await asUser(unknownUser, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docId, "I am deleting this"]
          );
        },
        /Forbidden: User profile not found/,
        "User without profile must be blocked"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // SECURITY TEST 6: Role Separation (Principal blocked)
  // ---------------------------------------------------------------------------
  await t.test("Security Test 6: Principals are restricted to monitoring only", async () => {
    const docId = "d1000000-0000-0000-0000-000000000007";
    await db.exec(`
      INSERT INTO public.documents (id, document_type, status, school_id, original_filename)
      VALUES ('${docId}', 'sf9', 'needs_review', '${schoolTrisId}', 'Principal_Block.pdf')
      ON CONFLICT (id) DO NOTHING;
    `);

    await asUser(principalUser, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docId, "I am deleting this"]
          );
        },
        /Forbidden: Role principal is not authorized to delete review records/,
        "Principal role must not have delete authorization"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // SECURITY TEST 7: Ineligible Document States Protection
  // ---------------------------------------------------------------------------
  await t.test("Security Test 7: Non-'needs_review' documents cannot be deleted", async () => {
    const protectedStates = ["approved", "validated", "submitted", "extracted", "rejected"];

    for (let i = 0; i < protectedStates.length; i++) {
      const state = protectedStates[i];
      const docId = `d1000000-0000-0000-0000-00000000001${i}`;
      await db.exec(`
        INSERT INTO public.documents (id, document_type, status, school_id, original_filename)
        VALUES ('${docId}', 'sf9', '${state}', '${schoolTrisId}', 'Protected_${state}.pdf')
        ON CONFLICT (id) DO NOTHING;
      `);

      await asUser(teacherTris, "authenticated", async () => {
        await assert.rejects(
          async () => {
            await db.query(
              `SELECT public.archive_review_document($1::uuid, $2::text)`,
              [docId, "I am deleting this"]
            );
          },
          /Document is not eligible for review deletion/,
          `Document in status '${state}' must not be deletable through review queue`
        );
      });
    }
  });

  // ---------------------------------------------------------------------------
  // SECURITY TEST 8: Repeated Deletion Prevention
  // ---------------------------------------------------------------------------
  await t.test("Security Test 8: Repeated deletion on archived documents is rejected", async () => {
    const docId = "d1000000-0000-0000-0000-000000000020";
    await db.exec(`
      INSERT INTO public.documents (id, document_type, status, school_id, original_filename)
      VALUES ('${docId}', 'sf9', 'needs_review', '${schoolTrisId}', 'Double_Delete.pdf')
      ON CONFLICT (id) DO NOTHING;
    `);

    // First deletion succeeds
    await asUser(teacherTris, "authenticated", async () => {
      const res = await db.query(
        `SELECT public.archive_review_document($1::uuid, $2::text) AS res`,
        [docId, "I am deleting this"]
      );
      assert.equal(res.rows[0].res.success, true);
    });

    // Second deletion attempt fails immediately
    await asUser(teacherTris, "authenticated", async () => {
      await assert.rejects(
        async () => {
          await db.query(
            `SELECT public.archive_review_document($1::uuid, $2::text)`,
            [docId, "I am deleting this"]
          );
        },
        /Document is already archived/,
        "Double-archival must be rejected"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // SECURITY TEST 9: Verification That No Older Overload Exists
  // ---------------------------------------------------------------------------
  await t.test("Security Test 9: No older executable RPC overloads exist", async () => {
    const procs = await db.query(`
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'archive_review_document';
    `);

    assert.equal(procs.rows.length, 1, "Exactly one overload of archive_review_document must exist");
    assert.equal(procs.rows[0].args, "p_document_id uuid, p_confirmation_phrase text");
  });

  // ---------------------------------------------------------------------------
  // SECURITY TEST 10: Atomic Transaction Semantics & Audit Logging
  // ---------------------------------------------------------------------------
  await t.test("Security Test 10: Atomic archival and audit log insertion succeed together", async () => {
    const docId = "d1000000-0000-0000-0000-000000000030";
    await db.exec(`
      INSERT INTO public.documents (id, document_type, status, school_id, original_filename)
      VALUES ('${docId}', 'sf9', 'needs_review', '${schoolTrisId}', 'Atomic_Test.pdf')
      ON CONFLICT (id) DO NOTHING;
    `);

    let result;
    await asUser(teacherTris, "authenticated", async () => {
      const res = await db.query(
        `SELECT public.archive_review_document($1::uuid, $2::text) AS res`,
        [docId, "I am deleting this"]
      );
      result = res.rows[0].res;
    });

    assert.equal(result.success, true);
    assert.equal(result.archived_by, teacherTris);

    // Verify document was updated
    const docRow = await db.query(`SELECT status, archived_at, archived_by FROM public.documents WHERE id = $1`, [docId]);
    assert.equal(docRow.rows[0].status, "archived");
    assert.equal(docRow.rows[0].archived_by, teacherTris);
    assert.ok(docRow.rows[0].archived_at);

    // Verify audit log entry was created in the same atomic transaction
    const auditRows = await db.query(
      `SELECT action, actor_user_id, actor_role, outcome, target_id, details 
       FROM public.audit_logs 
       WHERE target_id = $1`,
      [docId]
    );

    assert.equal(auditRows.rows.length, 1, "Audit log row must exist");
    assert.equal(auditRows.rows[0].action, "REVIEW_QUEUE_DOCUMENT_DELETED");
    assert.equal(auditRows.rows[0].actor_user_id, teacherTris);
    assert.equal(auditRows.rows[0].actor_role, "teacher");
    assert.equal(auditRows.rows[0].outcome, "SUCCESS");
    assert.equal(auditRows.rows[0].details.confirmation_phrase, "I am deleting this");
  });
});

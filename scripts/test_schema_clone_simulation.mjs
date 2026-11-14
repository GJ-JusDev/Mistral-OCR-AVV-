import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

async function runSimulation() {
  console.log("================================================================================");
  console.log("   PRODUCTION-SCHEMA CLONE SIMULATION & READINESS TEST");
  console.log("================================================================================");

  const db = new PGlite();

  // Step 1: Base auth and extension setup (Supabase emulation)
  console.log("\n[1] Initializing Supabase Environment Emulation...");
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$ LANGUAGE sql STABLE;

    -- Roles and base tables (Matching Production Supabase exactly)
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      school_id TEXT UNIQUE NOT NULL,
      division TEXT,
      region TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),
      sshs_pilot_status TEXT DEFAULT 'unverified',
      sshs_pilot_reference TEXT,
      school_calendar_type TEXT
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
      role user_role NOT NULL DEFAULT 'teacher',
      account_status TEXT NOT NULL DEFAULT 'Pending' CHECK (account_status IN ('Pending', 'Approved', 'Declined')),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ DEFAULT now()
      -- NOTE: updated_by and last_operation_id are MISSING on prod Supabase (from 014)
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      suffix TEXT,
      grade_level TEXT,
      sex TEXT,
      status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification',
      track TEXT,
      strand TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL DEFAULT 'SF9',
      image_url TEXT DEFAULT '',
      original_filename TEXT,
      extracted_text TEXT,
      extracted_fields JSONB DEFAULT '{}'::jsonb,
      ocr_model TEXT,
      ocr_confidence NUMERIC,
      status TEXT NOT NULL DEFAULT 'needs_review',
      uploaded_by TEXT,
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      shs_track TEXT,
      curriculum_id TEXT,
      source_form_version TEXT,
      grading_policy_version TEXT,
      grading_period_scheme TEXT,
      general_average_printed NUMERIC,
      general_average_action_taken TEXT,
      shs_general_average_printed NUMERIC,
      storage_path TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
      -- NOTE: reviewed_by and last_operation_id are MISSING on prod Supabase (from 014)
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      source_section TEXT,
      subject_track TEXT,
      subject_category TEXT,
      subject_code TEXT,
      grading_period_scheme TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
      t1 NUMERIC, t2 NUMERIC, t3 NUMERIC,
      sem1_final_grade NUMERIC, sem2_final_grade NUMERIC,
      units NUMERIC, failed_final_grade NUMERIC,
      remedial_class_mark NUMERIC, recomputed_final_grade NUMERIC,
      remedial_sem1_recomputed NUMERIC, remedial_sem2_recomputed NUMERIC,
      final_grade NUMERIC, action_taken TEXT, remark TEXT,
      status TEXT DEFAULT 'Missing',
      needs_verification BOOLEAN DEFAULT false,
      curriculum_id TEXT, source_form_version TEXT, grading_policy_version TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.eligibility_approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Helper functions present on prod Supabase
    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur 
        WHERE ur.user_id = auth.uid() AND ur.role = 'admin' AND ur.account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur 
        WHERE ur.user_id = auth.uid() AND ur.role = 'principal' AND ur.account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur 
        WHERE ur.user_id = auth.uid() AND ur.role = 'teacher' AND ur.account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS BOOLEAN AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur 
        WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'principal', 'teacher') AND ur.account_status = 'Approved'
      );
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid();
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
  `);
  console.log("    ✓ Base schema emulating live Supabase loaded.");

  // Apply Migration 013 (confirmed live on production Supabase)
  console.log("[2] Applying Migration 013 (Attendance & Remedial Tracking)...");
  const mig013Path = path.resolve(process.cwd(), "supabase", "migrations", "013_attendance_and_remedial_tracking.sql");
  const mig013Sql = fs.readFileSync(mig013Path, "utf-8");
  await db.exec(mig013Sql);
  console.log("    ✓ Migration 013 applied cleanly.");

  // Seed representative production data
  console.log("[3] Seeding representative production data (Schools, Roles, Students, Documents, Grades)...");
  const adminId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21";
  const teacherId = "9412725c-7faa-4efa-a654-be78cc40a14f";
  const schoolId = "a0000000-0000-0000-0000-000000000001";

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES 
      ('${adminId}', 'admin@tris.deped.gov.ph'),
      ('${teacherId}', 'teacher@tris.deped.gov.ph')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.schools (id, name, school_id, is_active) VALUES 
      ('${schoolId}', 'Taysan Resettlement Integrated School', '500169', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (id, user_id, role, account_status, school_id) VALUES 
      (gen_random_uuid(), '${adminId}', 'admin', 'Approved', NULL),
      (gen_random_uuid(), '${teacherId}', 'teacher', 'Approved', '${schoolId}')
    ON CONFLICT DO NOTHING;

    -- Representative Student A: Juan Miguel Dela Cruz
    INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, track, strand) VALUES 
      ('10000000-0000-0000-0000-000000000001', '${schoolId}', '123456789012', 'Juan Miguel', 'Dela Cruz', 'Grade 11', 'Academic', 'STEM');

    -- Representative Student B: Maria Santos
    INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level, track, strand) VALUES 
      ('10000000-0000-0000-0000-000000000002', '${schoolId}', '987654321098', 'Maria', 'Santos', 'Grade 11', 'Academic', 'ABM');

    -- Existing grades for Student A (Sem 1)
    INSERT INTO public.subject_grades (
      id, student_id, school_year, grade_level, semester, subject, q1, q2, final_grade, status
    ) VALUES 
      ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2024-2025', 'Grade 11', '1st Semester', 'Oral Communication in Context', 78, 80, 79, 'Passed'),
      ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '2024-2025', 'Grade 11', '1st Semester', 'General Mathematics', 85, 88, 87, 'Passed');
  `);
  console.log("    ✓ Representative data seeded successfully.");

  // Test Test Case 1: Apply Migration 015 DIRECTLY on baseline (without Migration 014)
  console.log("\n[4] Test Scenario A: Applying Migration 015 directly onto baseline (without Migration 014)...");
  const mig015Path = path.resolve(process.cwd(), "supabase", "migrations", "015_lrn_deduplication_and_grade_updates.sql");
  const mig015Sql = fs.readFileSync(mig015Path, "utf-8");

  try {
    await db.exec(mig015Sql);
    console.log("    ✓ DDL execution of Migration 015: SUCCEEDED");
  } catch (err) {
    console.error("    ❌ DDL execution of Migration 015 FAILED:", err.message);
  }

  // Create trigger on documents for process_approved_document if not already created
  await db.exec(`
    DROP TRIGGER IF EXISTS trg_process_approved_document ON public.documents;
    CREATE TRIGGER trg_process_approved_document
      AFTER INSERT OR UPDATE OR DELETE ON public.documents
      FOR EACH ROW EXECUTE FUNCTION public.process_approved_document();
  `);

  // Now test trigger execution on document approval
  console.log("    Testing document approval trigger with Migration 015 on table missing 'reviewed_by'...");
  let triggerExecutionSucceeded = false;
  try {
    const docId = "30000000-0000-0000-0000-000000000001";
    await db.exec(`
      INSERT INTO public.documents (
        id, student_id, school_id, school_year, grade_level, semester, status, extracted_fields
      ) VALUES (
        '${docId}',
        '10000000-0000-0000-0000-000000000001',
        '${schoolId}',
        '2024-2025',
        'Grade 11',
        '1st Semester',
        'needs_review',
        '{"grades": [{"subject": "Oral Communication in Context", "q1": 83, "q2": 80, "final": 82, "status": "Passed"}]}'::jsonb
      );
    `);

    // Simulate approving the document
    await db.exec(`
      UPDATE public.documents 
      SET status = 'approved'
      WHERE id = '${docId}';
    `);
    triggerExecutionSucceeded = true;
  } catch (err) {
    console.log("    ❌ Trigger execution FAILED as predicted:", err.message);
  }

  if (triggerExecutionSucceeded) {
    console.log("    Trigger execution unexpectedly succeeded without 'reviewed_by' column!");
  }

  // Test Test Case 2: Full clean sequence: Apply Migration 014 first, then Migration 015
  console.log("\n[5] Test Scenario B: Testing Complete Migration Sequence (013 -> 014 -> 015)...");
  const db2 = new PGlite();
  // Setup db2 baseline identical to db1
  await db2.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$ LANGUAGE sql STABLE;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'principal');
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      school_id TEXT UNIQUE NOT NULL,
      division TEXT, region TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(),
      sshs_pilot_status TEXT DEFAULT 'unverified', sshs_pilot_reference TEXT, school_calendar_type TEXT
    );

    CREATE TABLE IF NOT EXISTS public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
      role user_role NOT NULL DEFAULT 'teacher',
      account_status TEXT NOT NULL DEFAULT 'Pending' CHECK (account_status IN ('Pending', 'Approved', 'Declined')),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, middle_name TEXT, last_name TEXT NOT NULL,
      suffix TEXT, grade_level TEXT, sex TEXT, status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification', track TEXT, strand TEXT,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL DEFAULT 'SF9', image_url TEXT DEFAULT '', original_filename TEXT,
      extracted_text TEXT, extracted_fields JSONB DEFAULT '{}'::jsonb, ocr_model TEXT, ocr_confidence NUMERIC,
      status TEXT NOT NULL DEFAULT 'needs_review', uploaded_by TEXT,
      school_year TEXT, grade_level TEXT, semester TEXT, shs_track TEXT, curriculum_id TEXT,
      source_form_version TEXT, grading_policy_version TEXT, grading_period_scheme TEXT,
      general_average_printed NUMERIC, general_average_action_taken TEXT, shs_general_average_printed NUMERIC,
      storage_path TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      school_year TEXT, grade_level TEXT, semester TEXT, source_section TEXT,
      subject_track TEXT, subject_category TEXT, subject_code TEXT, grading_period_scheme TEXT,
      subject TEXT NOT NULL, q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
      t1 NUMERIC, t2 NUMERIC, t3 NUMERIC, sem1_final_grade NUMERIC, sem2_final_grade NUMERIC,
      units NUMERIC, failed_final_grade NUMERIC, remedial_class_mark NUMERIC, recomputed_final_grade NUMERIC,
      remedial_sem1_recomputed NUMERIC, remedial_sem2_recomputed NUMERIC, final_grade NUMERIC,
      action_taken TEXT, remark TEXT, status TEXT DEFAULT 'Missing', needs_verification BOOLEAN DEFAULT false,
      curriculum_id TEXT, source_form_version TEXT, grading_policy_version TEXT,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.eligibility_approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
      school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin' AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_principal() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'principal' AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_approved_teacher() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'teacher' AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.is_approved_staff() RETURNS BOOLEAN AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'principal', 'teacher') AND ur.account_status = 'Approved');
    $$ LANGUAGE sql STABLE SECURITY DEFINER;

    CREATE OR REPLACE FUNCTION public.get_auth_user_school_id() RETURNS UUID AS $$
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid();
    $$ LANGUAGE sql STABLE SECURITY DEFINER;
  `);

  await db2.exec(mig013Sql);

  // Seed base representative data in db2
  await db2.exec(`
    INSERT INTO auth.users (id, email) VALUES 
      ('${adminId}', 'admin@tris.deped.gov.ph'),
      ('${teacherId}', 'teacher@tris.deped.gov.ph')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.schools (id, name, school_id, is_active) VALUES 
      ('${schoolId}', 'Taysan Resettlement Integrated School', '500169', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (id, user_id, role, account_status, school_id) VALUES 
      (gen_random_uuid(), '${adminId}', 'admin', 'Approved', NULL),
      (gen_random_uuid(), '${teacherId}', 'teacher', 'Approved', '${schoolId}')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.students (id, school_id, lrn, first_name, last_name, grade_level) VALUES 
      ('10000000-0000-0000-0000-000000000001', '${schoolId}', '123456789012', 'Juan Miguel', 'Dela Cruz', 'Grade 11');

    INSERT INTO public.subject_grades (
      id, student_id, school_year, grade_level, semester, subject, q1, q2, final_grade, status
    ) VALUES 
      ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2024-2025', 'Grade 11', '1st Semester', 'Oral Communication in Context', 78, 80, 79, 'Passed');
  `);

  // Apply Migration 014
  console.log("    Applying Migration 014 (Admin Audit Logs)...");
  const mig014Path = path.resolve(process.cwd(), "supabase", "migrations", "014_admin_audit_logs.sql");
  const mig014Sql = fs.readFileSync(mig014Path, "utf-8");
  await db2.exec(mig014Sql);
  console.log("    ✓ Migration 014 applied cleanly.");

  // Apply Migration 015
  console.log("    Applying Migration 015 (LRN Deduplication & Controlled Grade Updates)...");
  await db2.exec(mig015Sql);
  console.log("    ✓ Migration 015 applied cleanly.");

  // Attach trigger
  await db2.exec(`
    DROP TRIGGER IF EXISTS trg_process_approved_document ON public.documents;
    CREATE TRIGGER trg_process_approved_document
      AFTER INSERT OR UPDATE OR DELETE ON public.documents
      FOR EACH ROW EXECUTE FUNCTION public.process_approved_document();
  `);

  // Test Document Approval & Grade In-Place Update with Actor Attribution
  console.log("\n[6] Testing Document Approval & Grade Update with Migration 014 + 015...");
  const doc2Id = "30000000-0000-0000-0000-000000000002";
  await db2.exec(`
    INSERT INTO public.documents (
      id, student_id, school_id, school_year, grade_level, semester, status, extracted_fields, reviewed_by
    ) VALUES (
      '${doc2Id}',
      '10000000-0000-0000-0000-000000000001',
      '${schoolId}',
      '2024-2025',
      'Grade 11',
      '1st Semester',
      'needs_review',
      '{"grades": [{"subject": "Oral Communication in Context", "q1": 83, "q2": 80, "final": 82, "status": "Passed"}]}'::jsonb,
      '${adminId}'
    );
  `);

  // Set JWT actor to Admin
  await db2.exec(`SET request.jwt.claim.sub = '${adminId}'; SET request.jwt.claim.role = 'authenticated';`);

  // Approve Document
  await db2.exec(`
    UPDATE public.documents 
    SET status = 'approved'
    WHERE id = '${doc2Id}';
  `);

  // Verify subject_grades count & values
  const gradesResult = await db2.query(`
    SELECT id, student_id, subject, q1, q2, final_grade, status 
    FROM public.subject_grades 
    WHERE student_id = '10000000-0000-0000-0000-000000000001';
  `);
  console.log(`    Total subject_grades rows after approval: ${gradesResult.rows.length}`);
  console.log("    Updated Grade Row:", gradesResult.rows[0]);

  if (gradesResult.rows.length === 1 && gradesResult.rows[0].q1 === 83 && gradesResult.rows[0].final_grade === 82) {
    console.log("    ✓ Grade updated in-place without duplication! Final recalculated: 82");
  } else {
    console.error("    ❌ Unexpected grade state:", gradesResult.rows);
  }

  // Verify grade_change_history
  const histResult = await db2.query(`
    SELECT student_id, subject, quarter, previous_value, new_value, changed_by, reason 
    FROM public.grade_change_history 
    ORDER BY created_at ASC;
  `);
  console.log(`    Grade change history entries: ${histResult.rows.length}`);
  for (const h of histResult.rows) {
    console.log(`      - Field: ${h.quarter}, Old: ${h.previous_value} -> New: ${h.new_value}, Changed by: ${h.changed_by}, Reason: ${h.reason}`);
  }

  // Verify actor attribution
  const q1Entry = histResult.rows.find(h => h.quarter === 'q1');
  if (q1Entry && q1Entry.changed_by === adminId) {
    console.log("    ✓ Actor attribution verified: changed_by matched Admin UUID perfectly!");
  } else {
    console.error("    ❌ Actor attribution mismatch:", q1Entry);
  }

  // Verify Migration 014 audit logs
  const auditResult = await db2.query(`
    SELECT category, action, target_type, outcome, actor_user_id 
    FROM public.audit_logs;
  `);
  console.log(`    Admin audit log entries recorded by Migration 014 triggers: ${auditResult.rows.length}`);
  for (const a of auditResult.rows) {
    console.log(`      - Action: ${a.action}, Category: ${a.category}, Outcome: ${a.outcome}, Actor: ${a.actor_user_id}`);
  }

  // Test Test Case 3: Rollback Plan Verification
  console.log("\n[7] Testing Migration 015 Rollback & Recovery Execution...");
  const rollback015Path = path.resolve(process.cwd(), "supabase", "migrations", "015_rollback_recovery.sql");
  let rollbackSql = fs.readFileSync(rollback015Path, "utf-8");

  // Extract 010 process_approved_document function
  const mig010Sql = fs.readFileSync(path.resolve(process.cwd(), "supabase", "migrations", "010_strengthened_shs_metadata.sql"), "utf-8");
  const fnMatch = mig010Sql.match(/CREATE OR REPLACE FUNCTION public\.process_approved_document\(\)[\s\S]+?REVOKE EXECUTE ON FUNCTION public\.process_approved_document\(\) FROM PUBLIC, anon;[\s\S]+?GRANT EXECUTE ON FUNCTION public\.process_approved_document\(\) TO authenticated, service_role;/);
  
  if (fnMatch) {
    const completeRollbackSql = rollbackSql + "\n\n" + fnMatch[0];
    console.log("    Executing comprehensive rollback script...");
    await db2.exec(completeRollbackSql);
    console.log("    ✓ Rollback executed successfully.");

    // Verify grade_change_history is gone
    let gchCheck = true;
    try {
      await db2.query("SELECT * FROM public.grade_change_history;");
    } catch {
      gchCheck = false;
    }
    console.log(`    grade_change_history dropped? ${!gchCheck ? "YES (Confirmed)" : "NO"}`);

    // Verify unique composite index is gone
    let idxCheck = true;
    try {
      const idxRes = await db2.query("SELECT indexname FROM pg_indexes WHERE indexname = 'idx_subject_grades_composite_active';");
      idxCheck = idxRes.rows.length > 0;
    } catch {
      idxCheck = false;
    }
    console.log(`    idx_subject_grades_composite_active dropped? ${!idxCheck ? "YES (Confirmed)" : "NO"}`);
  }

  console.log("\n================================================================================");
  console.log("   SIMULATION COMPLETE");
  console.log("================================================================================");
}

runSimulation().catch(err => {
  console.error("Fatal error during simulation:", err);
});

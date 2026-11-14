import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

import { mergeAcademicGrades } from "../src/lib/validation/gradeMerger.ts";
import {
  evaluateStudentIdentity,
  matchStudentIdentityMatrix,
} from "../src/lib/validation/studentMatcher.ts";

test("AVV Incremental Academic Record Updates & Duplicate Prevention Suite (Isolated PostgreSQL / PGlite)", async (t) => {
  const db = new PGlite();
  const TEST_LRN = "999901001001";
  const schoolId = "a0000000-0000-0000-0000-000000000001";
  const teacherAId = "11111111-1111-4111-8111-111111111111";
  const teacherBId = "22222222-2222-4222-8222-222222222222";
  const adminId = "33333333-3333-4333-8333-333333333333";

  let canonicalDocId = null;
  let verifiedStudentId = null;

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    END $$;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE TABLE public.schools (
      id UUID PRIMARY KEY,
      school_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE auth.users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE
    );

    CREATE TABLE public.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES auth.users(id),
      role TEXT NOT NULL,
      school_id UUID REFERENCES public.schools(id),
      account_status TEXT DEFAULT 'Approved'
    );

    CREATE TABLE public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id),
      lrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      last_name TEXT NOT NULL,
      suffix TEXT,
      grade_level TEXT,
      sex TEXT,
      status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id),
      document_type TEXT NOT NULL,
      image_url TEXT NOT NULL,
      original_filename TEXT,
      school_year TEXT,
      grade_level TEXT,
      semester TEXT,
      curriculum_id TEXT,
      source_form_version TEXT,
      grading_policy_version TEXT,
      grading_period_scheme TEXT,
      general_average_printed NUMERIC,
      extracted_fields JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'needs_review',
      uploaded_by TEXT,
      reviewed_by UUID,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE public.subject_grades (
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
      final_grade NUMERIC,
      action_taken TEXT, remark TEXT,
      status TEXT,
      needs_verification BOOLEAN DEFAULT false,
      curriculum_id TEXT, source_form_version TEXT, grading_policy_version TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE public.grade_change_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_grade_id UUID REFERENCES public.subject_grades(id) ON DELETE CASCADE,
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      school_year TEXT,
      semester TEXT,
      grade_level TEXT,
      subject TEXT,
      quarter TEXT,
      previous_value NUMERIC,
      new_value NUMERIC,
      reason TEXT,
      changed_by UUID,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE public.academic_standing_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      school_year TEXT,
      grade_level TEXT,
      curriculum TEXT,
      source_form_version TEXT,
      grading_policy_version TEXT,
      general_average_printed NUMERIC,
      previous_status TEXT,
      new_status TEXT,
      decision_source TEXT,
      confirmation_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE public.audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id TEXT,
      category TEXT,
      action TEXT,
      outcome TEXT,
      actor_user_id UUID,
      actor_email TEXT,
      actor_role TEXT DEFAULT 'anonymous',
      school_id UUID,
      target_type TEXT,
      target_id TEXT,
      target_label TEXT,
      reason TEXT,
      details JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    INSERT INTO public.schools (id, school_id, name)
    VALUES ('${schoolId}', '500169', 'Taysan Resettlement Integrated School');

    INSERT INTO auth.users (id, email) VALUES
      ('${teacherAId}', 'teacher_a@tris.edu.ph'),
      ('${teacherBId}', 'teacher_b@tris.edu.ph'),
      ('${adminId}', 'admin@tris.edu.ph');

    INSERT INTO public.user_roles (user_id, role, school_id, account_status) VALUES
      ('${teacherAId}', 'teacher', '${schoolId}', 'Approved'),
      ('${teacherBId}', 'teacher', '${schoolId}', 'Approved'),
      ('${adminId}', 'admin', '${schoolId}', 'Approved');
  `);

  // Apply Migration 021 onto the isolated PostgreSQL instance
  const mig021Sql = fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/021_canonical_academic_records_and_scan_versions.sql"),
    "utf8"
  );
  await db.exec(mig021Sql);

  // ── TEST 1: First upload of SF9 Q1 by Teacher A ───────────────────────────
  await t.test("1. First upload of SF9 Q1 creates 1 canonical student & 1 canonical record in needs_review", async () => {
    const stuRes = await db.query(
      `INSERT INTO public.students (school_id, lrn, first_name, last_name, grade_level, status)
       VALUES ($1, $2, 'JUAN MIGUEL', 'DELA CRUZ', 'Grade 11', 'active')
       RETURNING id`,
      [schoolId, TEST_LRN]
    );
    verifiedStudentId = stuRes.rows[0].id;

    const q1Grades = [
      {
        subject: "Oral Communication",
        semester: "1st Semester",
        q1: 88,
        q2: null,
      },
    ];

    const initialScan = {
      version: 1,
      uploaded_at: new Date().toISOString(),
      uploaded_by: teacherAId,
      original_filename: "SF9_Q1_JuanDelaCruz.pdf",
      image_url: "https://storage.local/test/sf9_q1_scan.png",
      detected_quarters: ["Oral Communication Q1"],
    };

    const extractedFields = {
      lrn: TEST_LRN,
      first_name: "JUAN MIGUEL",
      last_name: "DELA CRUZ",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      semester: "1st Semester",
      grades: q1Grades,
      scan_history: [initialScan],
      scan_evidence_history: [initialScan],
      last_scan_version: 1,
    };

    const docRes = await db.query(
      `INSERT INTO public.documents (
        student_id, school_id, document_type, school_year, grade_level, semester,
        image_url, original_filename, extracted_fields, status, uploaded_by
      ) VALUES ($1, $2, 'sf9', '2024-2025', 'Grade 11', '1st Semester', $3, $4, $5::jsonb, 'needs_review', $6)
      RETURNING *`,
      [verifiedStudentId, schoolId, initialScan.image_url, initialScan.original_filename, JSON.stringify(extractedFields), teacherAId]
    );

    const doc1 = docRes.rows[0];
    assert.ok(doc1?.id, "Document ID must be present");
    canonicalDocId = doc1.id;

    assert.strictEqual(doc1.status, "needs_review");
    assert.strictEqual(doc1.school_year, "2024-2025");
    assert.strictEqual(doc1.grade_level, "Grade 11");
    assert.strictEqual(doc1.student_id, verifiedStudentId);

    const allDocs = await db.query(
      `SELECT id FROM public.documents WHERE student_id = $1 AND status <> 'archived'`,
      [verifiedStudentId]
    );
    assert.strictEqual(allDocs.rows.length, 1, "Must have exactly 1 active document record");
  });

  // ── TEST 2: Admin reviews and approves SF9 Q1 ──────────────────────────────
  await t.test("2. Admin review approves SF9 Q1 and process_approved_document trigger creates verified subject_grades", async () => {
    await db.query(
      `UPDATE public.documents
       SET status = 'approved', reviewed_by = $1, updated_at = now()
       WHERE id = $2`,
      [adminId, canonicalDocId]
    );

    const sgRes = await db.query(
      `SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication'`,
      [verifiedStudentId]
    );
    assert.strictEqual(sgRes.rows.length, 1, "Subject grade record created by trigger must exist");
    assert.strictEqual(Number(sgRes.rows[0].q1), 88);
    assert.strictEqual(sgRes.rows[0].q2, null);
  });

  // ── TEST 3: Incremental Upload of SF9 Q2 by Teacher B on later date ────────
  await t.test("3. Upload of SF9 Q2 by Teacher B updates SAME canonical record AND preserves existing verified subject_grades while awaiting review", async () => {
    const existingRes = await db.query(`SELECT * FROM public.documents WHERE id = $1`, [canonicalDocId]);
    const existingDoc = existingRes.rows[0];

    const incomingQ2Grades = [
      {
        subject: "Oral Communication",
        semester: "1st Semester",
        q1: 88,
        q2: 92,
      },
    ];

    const mergeResult = mergeAcademicGrades({
      existingGrades: existingDoc.extracted_fields?.grades || [],
      incomingGrades: incomingQ2Grades,
      baseFields: existingDoc.extracted_fields || {},
      isExistingApproved: existingDoc.status === "approved",
      defaultSemester: "1st Semester",
    });

    assert.strictEqual(mergeResult.hasNewGrades, true, "Must detect new quarterly grade (Q2)");
    assert.strictEqual(mergeResult.conflicts.length, 0, "No conflict expected for matching Q1");
    assert.strictEqual(mergeResult.addedQuarters.length, 1, "Must add exactly 1 new quarter");
    assert.strictEqual(mergeResult.addedQuarters[0].quarter, "q2");
    assert.strictEqual(mergeResult.addedQuarters[0].value, 92);

    const mergedOralComm = mergeResult.mergedGrades.find((g) => g.subject === "Oral Communication");
    assert.ok(mergedOralComm);
    assert.strictEqual(mergedOralComm.q1, 88, "Q1 grade 88 must be preserved");
    assert.strictEqual(mergedOralComm.q2, 92, "Q2 grade 92 must be added");
    assert.strictEqual(mergedOralComm.sem1_final_grade, 90, "Official semester final grade must be (88+92)/2 = 90");
    assert.strictEqual(mergedOralComm.status, "Passed");

    const existingHistory = existingDoc.extracted_fields?.scan_history || [];
    const newVersion = existingHistory.length + 1;
    const q2Scan = {
      version: newVersion,
      uploaded_at: new Date().toISOString(),
      uploaded_by: teacherBId,
      original_filename: "SF9_Q2_JuanDelaCruz.pdf",
      image_url: "https://storage.local/test/sf9_q2_scan.png",
      detected_quarters: ["Oral Communication Q2"],
    };
    const updatedScanHistory = [...existingHistory, q2Scan];

    const updatedExtractedFields = {
      ...existingDoc.extracted_fields,
      ...mergeResult.mergedFields,
      scan_history: updatedScanHistory,
      scan_evidence_history: updatedScanHistory,
      last_scan_version: newVersion,
      incremental_update_summary: {
        last_updated_by: teacherBId,
        added_quarters: mergeResult.addedQuarters,
      },
      previous_approval: {
        approved_at: existingDoc.updated_at,
        reviewed_by: existingDoc.reviewed_by,
      },
    };

    const updRes = await db.query(
      `UPDATE public.documents
       SET extracted_fields = $1::jsonb, image_url = $2, status = 'needs_review', updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [JSON.stringify(updatedExtractedFields), q2Scan.image_url, canonicalDocId]
    );
    const updatedDoc = updRes.rows[0];
    assert.strictEqual(updatedDoc.id, canonicalDocId, "Must reuse the EXACT SAME document ID");
    assert.strictEqual(updatedDoc.status, "needs_review");

    // Verify existing verified subject_grades row was NOT deleted when transitioning approved -> needs_review for incremental update!
    const sgDuringReview = await db.query(
      `SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication'`,
      [verifiedStudentId]
    );
    assert.strictEqual(
      sgDuringReview.rows.length,
      1,
      "CRITICAL: Verified Q1 subject_grades row must remain preserved while incremental Q2 update awaits review!"
    );
    assert.strictEqual(Number(sgDuringReview.rows[0].q1), 88);

    // Verify no duplicate documents exist
    const docsAfterQ2 = await db.query(
      `SELECT id FROM public.documents WHERE student_id = $1 AND status <> 'archived'`,
      [verifiedStudentId]
    );
    assert.strictEqual(docsAfterQ2.rows.length, 1, "Must have EXACTLY 1 document in database after Q2 upload");

    const savedScans = updatedDoc.extracted_fields?.scan_history || [];
    assert.strictEqual(savedScans.length, 2, "Must preserve both original scan (V1) and Q2 scan (V2)");
  });

  // ── TEST 4: Admin reviews and approves SF9 Q2 ──────────────────────────────
  await t.test("4. Admin review approves SF9 Q2 & trigger merges Q2 into subject_grades and grade_change_history", async () => {
    await db.query(
      `UPDATE public.documents
       SET status = 'approved', reviewed_by = $1, updated_at = now()
       WHERE id = $2`,
      [adminId, canonicalDocId]
    );

    const sgRes = await db.query(
      `SELECT * FROM public.subject_grades WHERE student_id = $1 AND subject = 'Oral Communication'`,
      [verifiedStudentId]
    );
    assert.strictEqual(sgRes.rows.length, 1);
    const updatedSg = sgRes.rows[0];
    assert.strictEqual(Number(updatedSg.q1), 88, "Q1 grade must remain 88");
    assert.strictEqual(Number(updatedSg.q2), 92, "Q2 grade must be updated to 92");
    assert.strictEqual(Number(updatedSg.final_grade), 90, "Final grade must be computed to 90");
    assert.strictEqual(updatedSg.status, "Passed");

    const gchRes = await db.query(
      `SELECT * FROM public.grade_change_history WHERE student_id = $1 AND subject = 'Oral Communication' AND quarter = 'q2'`,
      [verifiedStudentId]
    );
    assert.strictEqual(gchRes.rows.length, 1, "Trigger must automatically log Q2 addition in grade_change_history");
    assert.strictEqual(Number(gchRes.rows[0].new_value), 92);
  });

  // ── TEST 5: Conflicting Grade Detection ────────────────────────────────────
  await t.test("5. Conflicting grade in subsequent scan is flagged for human review without overwriting verified grade", async () => {
    const docRes = await db.query(`SELECT * FROM public.documents WHERE id = $1`, [canonicalDocId]);
    const approvedDoc = docRes.rows[0];

    const conflictingScan = [
      {
        subject: "Oral Communication",
        semester: "1st Semester",
        q1: 75, // Conflict! Verified is 88
        q2: 92,
      },
    ];

    const mergeResult = mergeAcademicGrades({
      existingGrades: approvedDoc.extracted_fields?.grades || [],
      incomingGrades: conflictingScan,
      baseFields: approvedDoc.extracted_fields || {},
      isExistingApproved: true,
      defaultSemester: "1st Semester",
    });

    assert.strictEqual(mergeResult.conflicts.length, 1, "Must detect 1 conflict for altered Q1");
    assert.strictEqual(mergeResult.conflicts[0].existingValue, 88);
    assert.strictEqual(mergeResult.conflicts[0].incomingValue, 75);

    const oralComm = mergeResult.mergedGrades.find((g) => g.subject === "Oral Communication");
    assert.strictEqual(oralComm.q1, 88, "Verified grade 88 must NOT be overwritten by conflicting scan");
  });

  // ── TEST 6: Student Identity Collision Protection ─────────────────────────
  await t.test("6. Same LRN with conflicting student name is blocked from auto-merging at both application and DB trigger levels", async () => {
    const conflictingExtracted = evaluateStudentIdentity({
      lrn: TEST_LRN,
      first_name: "MARIA",
      last_name: "SANTOS",
    });

    const existingStudent = {
      id: verifiedStudentId,
      lrn: TEST_LRN,
      first_name: "JUAN MIGUEL",
      last_name: "DELA CRUZ",
    };

    const matchResult = matchStudentIdentityMatrix({
      extracted: conflictingExtracted,
      existingStudentByLrn: existingStudent,
    });

    assert.strictEqual(matchResult.matchType, "SAME_LRN_CONFLICT_NAME");
    assert.strictEqual(matchResult.canAutoLink, false);
    assert.strictEqual(matchResult.canAutoMergeGrades, false);
    assert.strictEqual(matchResult.requiresManualReview, true);

    // Also verify database trigger blocks auto-linking and blocks approval without lrn_conflict_verified = true
    const collInsert = await db.query(
      `INSERT INTO public.documents (school_id, document_type, school_year, grade_level, image_url, status, extracted_fields)
       VALUES ($1, 'sf9', '2024-2025', 'Grade 11', 'https://storage.local/collision.png', 'needs_review', $2::jsonb)
       RETURNING id, student_id, extracted_fields`,
      [schoolId, JSON.stringify({ lrn: TEST_LRN, first_name: "MARIA", last_name: "SANTOS", school_year: "2024-2025", grade_level: "Grade 11" })]
    );
    assert.strictEqual(collInsert.rows[0].student_id, null, "DB trigger must keep student_id NULL on name collision");
    assert.strictEqual(collInsert.rows[0].extracted_fields.identity_conflict, true);

    await assert.rejects(
      async () => {
        await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [collInsert.rows[0].id]);
      },
      /Identity Collision Blocked/i,
      "DB trigger must block approving an unresolved identity collision document"
    );
  });
});

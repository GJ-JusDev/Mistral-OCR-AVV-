import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import crypto from "crypto";

import { normalizeLrn, isValidLrn } from "../src/lib/validation/patterns.ts";
import { 
  evaluateStudentIdentity, 
  matchStudentIdentityMatrix 
} from "../src/lib/validation/studentMatcher.ts";
import { 
  mergeAcademicGrades 
} from "../src/lib/validation/gradeMerger.ts";

test("AVV System — Canonical Academic Records & Incremental Grade Update Suite", async (t) => {
  const db = new PGlite();

  // Setup database schema matching live Supabase + Migration 021
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

    CREATE TABLE IF NOT EXISTS public.schools (
      id UUID PRIMARY KEY, school_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      division TEXT, region TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);

    CREATE TABLE IF NOT EXISTS public.students (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      lrn TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, middle_name TEXT, last_name TEXT NOT NULL,
      suffix TEXT, grade_level TEXT, sex TEXT, status TEXT DEFAULT 'active',
      overall_status TEXT DEFAULT 'Needs Verification',
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      school_id UUID REFERENCES public.schools(id) ON DELETE RESTRICT,
      document_type TEXT NOT NULL, image_url TEXT NOT NULL,
      original_filename TEXT,
      school_year TEXT, grade_level TEXT, semester TEXT,
      extracted_fields JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'needs_review', uploaded_by TEXT, reviewed_by UUID,
      file_hash TEXT,
      last_operation_id UUID,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.document_scans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
      student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
      scan_version INTEGER NOT NULL DEFAULT 1,
      file_path TEXT,
      file_hash TEXT,
      image_url TEXT NOT NULL,
      back_image_url TEXT,
      original_filename TEXT,
      detected_quarters TEXT[],
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.subject_grades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
      document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
      school_year TEXT, grade_level TEXT, semester TEXT,
      subject TEXT NOT NULL,
      q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
      final_grade NUMERIC, status TEXT,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id UUID,
      category TEXT,
      action TEXT,
      outcome TEXT,
      actor_user_id TEXT,
      actor_email TEXT,
      target_type TEXT,
      target_id UUID,
      reason TEXT,
      details JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Seed school
  const schoolId = "a0000000-0000-0000-0000-000000000001";
  await db.query(`
    INSERT INTO public.schools (id, school_id, name)
    VALUES ($1, '500169', 'Taysan Resettlement Integrated School')
    ON CONFLICT (id) DO NOTHING;
  `, [schoolId]);

  const teacherUserId = "135baa53-7e1e-4c1f-b76a-f32a915b5f21";

  // Helper simulating the canonical persistence workflow implemented in POST /api/documents
  async function simulateDocumentUpload(params) {
    const {
      uploadedBy = teacherUserId,
      documentType = "sf9",
      schoolYear = "2026-2027",
      gradeLevel = "Grade 11",
      extractedFields,
      imageUrl = "https://storage.local/sf9_scan.jpg",
      originalFilename = "sf9_scan.jpg",
      fileHash,
    } = params;

    const identityEval = evaluateStudentIdentity(extractedFields);

    // 1. Check existing student by LRN
    let studentId = null;
    let existingStudent = null;
    if (identityEval.isValidLrn && identityEval.normalizedLrn) {
      const res = await db.query(
        `SELECT id, lrn, first_name, middle_name, last_name, suffix, school_id FROM public.students WHERE lrn = $1 LIMIT 1`,
        [identityEval.normalizedLrn]
      );
      if (res.rows.length > 0) {
        existingStudent = res.rows[0];
      }
    }

    // Check if another student has the same name
    let studentByNameDiffLrn = null;
    if (!existingStudent && identityEval.isValidName && identityEval.lastName && identityEval.firstName) {
      const res = await db.query(
        `SELECT id, lrn, first_name, last_name FROM public.students WHERE LOWER(last_name) = LOWER($1) AND LOWER(first_name) = LOWER($2) LIMIT 1`,
        [identityEval.lastName.trim(), identityEval.firstName.trim()]
      );
      if (res.rows.length > 0 && res.rows[0].lrn !== identityEval.normalizedLrn) {
        studentByNameDiffLrn = res.rows[0];
      }
    }

    const matchResult = matchStudentIdentityMatrix({
      extracted: identityEval,
      existingStudentByLrn: existingStudent,
      existingStudentByNameDiffLrn: studentByNameDiffLrn,
    });

    if (matchResult.canAutoLink && matchResult.studentId) {
      studentId = matchResult.studentId;
    }

    // Auto-create student if valid new student
    if (matchResult.canAutoCreate && identityEval.normalizedLrn && !studentId) {
      const stuRes = await db.query(`
        INSERT INTO public.students (school_id, lrn, first_name, last_name, middle_name, suffix, grade_level, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
        ON CONFLICT (lrn) DO UPDATE SET updated_at = now()
        RETURNING id;
      `, [schoolId, identityEval.normalizedLrn, identityEval.firstName, identityEval.lastName, identityEval.middleName, identityEval.suffix, gradeLevel]);
      studentId = stuRes.rows[0].id;
    }

    // 2. Lookup existing canonical document
    let existingDoc = null;
    if (matchResult.matchType !== "SAME_LRN_CONFLICT_NAME" && matchResult.matchType !== "DIFF_LRN_SAME_NAME") {
      if (studentId) {
        if (documentType === "sf9") {
          const docRes = await db.query(`
            SELECT * FROM public.documents
            WHERE school_id = $1 AND document_type = 'sf9' AND student_id = $2 AND school_year = $3 AND status <> 'archived'
            ORDER BY created_at ASC LIMIT 1;
          `, [schoolId, studentId, schoolYear]);
          if (docRes.rows.length > 0) existingDoc = docRes.rows[0];
        } else if (documentType === "sf10") {
          const docRes = await db.query(`
            SELECT * FROM public.documents
            WHERE school_id = $1 AND document_type = 'sf10' AND student_id = $2 AND status <> 'archived'
            ORDER BY created_at ASC LIMIT 1;
          `, [schoolId, studentId]);
          if (docRes.rows.length > 0) existingDoc = docRes.rows[0];
        }
      }
    }

    const computedHash = fileHash || crypto.createHash("sha256").update(imageUrl).digest("hex");

    // 3. Incremental update or exact duplicate
    if (existingDoc) {
      const scanHistory = existingDoc.extracted_fields?.scan_history || [];
      const isHashMatch = existingDoc.file_hash === computedHash || scanHistory.some(s => s.file_hash === computedHash);

      const mergeResult = mergeAcademicGrades({
        existingGrades: existingDoc.extracted_fields?.grades || [],
        incomingGrades: extractedFields.grades || [],
        baseFields: existingDoc.extracted_fields || {},
        isExistingApproved: existingDoc.status === "approved",
        defaultSemester: extractedFields.semester || "1st Semester",
      });

      if (isHashMatch || (mergeResult.isIdentical && !mergeResult.hasNewGrades && mergeResult.conflicts.length === 0)) {
        await db.query(`
          INSERT INTO public.audit_logs (request_id, category, action, outcome, actor_user_id, target_type, target_id, reason, details)
          VALUES ($1, 'DOCUMENT', 'DOCUMENT_UPLOADED', 'SUCCESS', $2, 'document', $3, 'Duplicate document upload detected; reused existing canonical academic record', $4)
        `, [crypto.randomUUID(), uploadedBy, existingDoc.id, JSON.stringify({ result: "EXISTING_DOCUMENT" })]);

        return {
          code: "EXISTING_DOCUMENT",
          message: "This document has already been uploaded. No new academic record was created.",
          documentId: existingDoc.id,
          studentId: existingDoc.student_id,
          isExisting: true,
          grades: existingDoc.extracted_fields?.grades,
        };
      }

      // Incremental quarter/semester update
      const newVersion = (scanHistory.length || 1) + 1;
      const scanEntry = {
        version: newVersion,
        uploaded_at: new Date().toISOString(),
        file_hash: computedHash,
        image_url: imageUrl,
        original_filename: originalFilename,
      };

      const mergedFields = {
        ...existingDoc.extracted_fields,
        ...mergeResult.mergedFields,
        scan_history: [...scanHistory, scanEntry],
        last_scan_version: newVersion,
      };

      if (mergeResult.conflicts.length > 0) {
        mergedFields.grade_conflicts = [
          ...(existingDoc.extracted_fields?.grade_conflicts || []),
          ...mergeResult.conflicts,
        ];
      }

      await db.query(`
        UPDATE public.documents
        SET extracted_fields = $1, image_url = $2, status = 'needs_review', updated_at = now()
        WHERE id = $3;
      `, [JSON.stringify(mergedFields), imageUrl, existingDoc.id]);

      await db.query(`
        INSERT INTO public.document_scans (document_id, student_id, scan_version, file_hash, image_url, original_filename, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7);
      `, [existingDoc.id, studentId, newVersion, computedHash, imageUrl, originalFilename, uploadedBy]);

      await db.query(`
        INSERT INTO public.audit_logs (request_id, category, action, outcome, actor_user_id, target_type, target_id, reason, details)
        VALUES ($1, 'DOCUMENT', 'DOCUMENT_INCREMENTAL_UPDATE', 'SUCCESS', $2, 'document', $3, 'User updated existing canonical academic record with incremental quarter grades', $4)
      `, [crypto.randomUUID(), uploadedBy, existingDoc.id, JSON.stringify({ added_quarters: mergeResult.addedQuarters })]);

      return {
        code: "ACADEMIC_RECORD_UPDATED",
        message: mergeResult.conflicts.length > 0
          ? "Conflicting grades detected. Manual verification required."
          : "Existing academic record updated with new quarter grades. Pending verification.",
        documentId: existingDoc.id,
        studentId: existingDoc.student_id,
        isIncrementalUpdate: true,
        grades: mergedFields.grades,
        conflicts: mergeResult.conflicts,
      };
    }

    // 4. Create new canonical document
    const initialScan = {
      version: 1,
      uploaded_at: new Date().toISOString(),
      file_hash: computedHash,
      image_url: imageUrl,
      original_filename: originalFilename,
    };
    extractedFields.scan_history = [initialScan];
    extractedFields.last_scan_version = 1;

    const docRes = await db.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, image_url, original_filename, school_year, grade_level, semester, extracted_fields, status, uploaded_by, file_hash)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'needs_review', $10, $11)
      RETURNING id, student_id;
    `, [studentId, schoolId, documentType, imageUrl, originalFilename, schoolYear, gradeLevel, extractedFields.semester || "1st Semester", JSON.stringify(extractedFields), uploadedBy, computedHash]);

    const newDocId = docRes.rows[0].id;

    await db.query(`
      INSERT INTO public.document_scans (document_id, student_id, scan_version, file_hash, image_url, original_filename, uploaded_by)
      VALUES ($1, $2, 1, $3, $4, $5, $6);
    `, [newDocId, studentId, computedHash, imageUrl, originalFilename, uploadedBy]);

    await db.query(`
      INSERT INTO public.audit_logs (request_id, category, action, outcome, actor_user_id, target_type, target_id, reason, details)
      VALUES ($1, 'DOCUMENT', 'DOCUMENT_UPLOADED', 'SUCCESS', $2, 'document', $3, 'User created new canonical academic record staged for review', $4)
    `, [crypto.randomUUID(), uploadedBy, newDocId, JSON.stringify({ document_type: documentType })]);

    return {
      code: "ACADEMIC_RECORD_CREATED",
      message: "Academic record created. Pending verification.",
      documentId: newDocId,
      studentId: docRes.rows[0].student_id,
      isNew: true,
      grades: extractedFields.grades,
    };
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 1 & 2: First Upload (Q1) -> Second Upload (Q2) for same student
  // ---------------------------------------------------------------------------
  let canonicalDocId = null;
  let canonicalStudentId = null;

  await t.test("Scenario 1: First SF9 upload creates exactly ONE student, ONE academic record, and ONE review item", async () => {
    const res = await simulateDocumentUpload({
      documentType: "sf9",
      schoolYear: "2026-2027",
      gradeLevel: "Grade 11",
      imageUrl: "https://storage.local/gomez_q1_scan.jpg",
      originalFilename: "gomez_q1_scan.jpg",
      fileHash: "hash-q1-only",
      extractedFields: {
        lrn: "123456789012",
        name: "GOMEZ, JUSTIN LOQUILLANO",
        first_name: "JUSTIN",
        last_name: "GOMEZ",
        middle_name: "LOQUILLANO",
        school_year: "2026-2027",
        grade_level: "Grade 11",
        semester: "1st Semester",
        grades: [
          { subject: "Oral Communication", semester: "1st Semester", q1: 88, q2: undefined },
          { subject: "General Mathematics", semester: "1st Semester", q1: 76, q2: undefined },
        ],
      },
    });

    assert.strictEqual(res.code, "ACADEMIC_RECORD_CREATED");
    assert.ok(res.documentId);
    assert.ok(res.studentId);
    canonicalDocId = res.documentId;
    canonicalStudentId = res.studentId;

    // Check database row counts: strictly 1 student, 1 document, 1 scan
    const stuCount = await db.query(`SELECT COUNT(*) FROM public.students WHERE lrn = '123456789012'`);
    assert.strictEqual(parseInt(stuCount.rows[0].count, 10), 1);

    const docCount = await db.query(`SELECT COUNT(*) FROM public.documents WHERE student_id = $1`, [canonicalStudentId]);
    assert.strictEqual(parseInt(docCount.rows[0].count, 10), 1);

    const reviewCount = await db.query(`SELECT COUNT(*) FROM public.documents WHERE status = 'needs_review'`);
    assert.strictEqual(parseInt(reviewCount.rows[0].count, 10), 1);
  });

  await t.test("Scenario 2: Second upload of Q2 for SAME student REUSES the canonical document and student ID", async () => {
    const res = await simulateDocumentUpload({
      documentType: "sf9",
      schoolYear: "2026-2027",
      gradeLevel: "Grade 11",
      imageUrl: "https://storage.local/gomez_q2_scan.jpg",
      originalFilename: "gomez_q2_scan.jpg",
      fileHash: "hash-q1-and-q2",
      extractedFields: {
        lrn: "123456789012",
        name: "GOMEZ, JUSTIN LOQUILLANO",
        first_name: "JUSTIN",
        last_name: "GOMEZ",
        middle_name: "LOQUILLANO",
        school_year: "2026-2027",
        grade_level: "Grade 11",
        semester: "1st Semester",
        grades: [
          { subject: "Oral Communication", semester: "1st Semester", q1: 88, q2: 88 },
          { subject: "General Mathematics", semester: "1st Semester", q1: 76, q2: 94 },
        ],
      },
    });

    assert.strictEqual(res.code, "ACADEMIC_RECORD_UPDATED");
    assert.strictEqual(res.documentId, canonicalDocId, "PRIMARY REQUIREMENT: Must reuse exact same canonical document ID!");
    assert.strictEqual(res.studentId, canonicalStudentId, "Must reuse exact same canonical student ID!");

    // Check database row counts: STILL strictly 1 student, 1 document!
    const docCount = await db.query(`SELECT COUNT(*) FROM public.documents WHERE student_id = $1`, [canonicalStudentId]);
    assert.strictEqual(parseInt(docCount.rows[0].count, 10), 1, "Must NOT create a second document in Document Registry!");

    const reviewCount = await db.query(`SELECT COUNT(*) FROM public.documents WHERE status = 'needs_review'`);
    assert.strictEqual(parseInt(reviewCount.rows[0].count, 10), 1, "Must NOT create a second entry in Review Queue!");

    // Verify final grade computation
    const updatedDoc = await db.query(`SELECT extracted_fields FROM public.documents WHERE id = $1`, [canonicalDocId]);
    const grades = updatedDoc.rows[0].extracted_fields.grades;
    const oralComm = grades.find(g => g.subject === "Oral Communication");
    const genMath = grades.find(g => g.subject === "General Mathematics");

    assert.strictEqual(oralComm.q1, 88);
    assert.strictEqual(oralComm.q2, 88);
    assert.strictEqual(oralComm.sem1_final_grade, 88, "Oral Comm final must be (88+88)/2 = 88");

    assert.strictEqual(genMath.q1, 76);
    assert.strictEqual(genMath.q2, 94);
    assert.strictEqual(genMath.sem1_final_grade, 85, "Gen Math final must be (76+94)/2 = 85");

    // Verify scan version history preserved
    const scansRes = await db.query(`SELECT scan_version, file_hash FROM public.document_scans WHERE document_id = $1 ORDER BY scan_version ASC`, [canonicalDocId]);
    assert.strictEqual(scansRes.rows.length, 2, "Both scan versions must be preserved as evidence!");
    assert.strictEqual(scansRes.rows[0].scan_version, 1);
    assert.strictEqual(scansRes.rows[1].scan_version, 2);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Third upload with 2nd Semester grades for same school year
  // ---------------------------------------------------------------------------
  await t.test("Scenario 3: Third upload adds 2nd Semester grades to the same academic record", async () => {
    const res = await simulateDocumentUpload({
      documentType: "sf9",
      schoolYear: "2026-2027",
      gradeLevel: "Grade 11",
      imageUrl: "https://storage.local/gomez_sem2_scan.jpg",
      originalFilename: "gomez_sem2_scan.jpg",
      fileHash: "hash-sem2",
      extractedFields: {
        lrn: "123456789012",
        name: "GOMEZ, JUSTIN LOQUILLANO",
        first_name: "JUSTIN",
        last_name: "GOMEZ",
        middle_name: "LOQUILLANO",
        school_year: "2026-2027",
        grade_level: "Grade 11",
        semester: "2nd Semester",
        grades: [
          { subject: "Reading and Writing", semester: "2nd Semester", q3: 84, q4: 86 },
        ],
      },
    });

    assert.strictEqual(res.code, "ACADEMIC_RECORD_UPDATED");
    assert.strictEqual(res.documentId, canonicalDocId, "Must reuse same canonical document for same school year!");

    const updatedDoc = await db.query(`SELECT extracted_fields FROM public.documents WHERE id = $1`, [canonicalDocId]);
    const grades = updatedDoc.rows[0].extracted_fields.grades;
    assert.strictEqual(grades.length, 3, "Must have 2 Sem 1 subjects + 1 Sem 2 subject");
    const rw = grades.find(g => g.subject === "Reading and Writing");
    assert.strictEqual(rw.q3, 84);
    assert.strictEqual(rw.q4, 86);
    assert.strictEqual(rw.sem2_final_grade, 85);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 4 & 5: Exact duplicate upload (same hash and identical grades)
  // ---------------------------------------------------------------------------
  await t.test("Scenario 4 & 5: Exact duplicate upload returns EXISTING_DOCUMENT and creates zero new records", async () => {
    const res = await simulateDocumentUpload({
      documentType: "sf9",
      schoolYear: "2026-2027",
      gradeLevel: "Grade 11",
      imageUrl: "https://storage.local/gomez_sem2_scan.jpg",
      originalFilename: "different_filename_same_scan.jpg", // Scenario 5: different filename
      fileHash: "hash-sem2", // same file hash!
      extractedFields: {
        lrn: "123456789012",
        name: "GOMEZ, JUSTIN LOQUILLANO",
        first_name: "JUSTIN",
        last_name: "GOMEZ",
        middle_name: "LOQUILLANO",
        school_year: "2026-2027",
        grade_level: "Grade 11",
        semester: "2nd Semester",
        grades: [
          { subject: "Reading and Writing", semester: "2nd Semester", q3: 84, q4: 86 },
        ],
      },
    });

    assert.strictEqual(res.code, "EXISTING_DOCUMENT");
    assert.strictEqual(res.documentId, canonicalDocId);
    assert.strictEqual(res.isExisting, true);

    // Total documents in database must still be strictly 1!
    const docCount = await db.query(`SELECT COUNT(*) FROM public.documents WHERE student_id = $1`, [canonicalStudentId]);
    assert.strictEqual(parseInt(docCount.rows[0].count, 10), 1);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 6, 7, 8, 9, 10, 11: Identity Matching Matrix Edge Cases
  // ---------------------------------------------------------------------------
  await t.test("Scenario 6 & 7: Same LRN with different casing / formatting matches cleanly", async () => {
    const res = await simulateDocumentUpload({
      documentType: "sf9",
      schoolYear: "2026-2027",
      gradeLevel: "Grade 11",
      imageUrl: "https://storage.local/casing_test.jpg",
      fileHash: "hash-casing-test",
      extractedFields: {
        lrn: " 1234-5678-9012 ",
        name: "justin loquillano gomez",
        first_name: "justin",
        last_name: "gomez",
        grades: [],
      },
    });

    assert.strictEqual(res.documentId, canonicalDocId, "Must match despite casing/spacing difference");
  });

  await t.test("Scenario 8: Same LRN with minor OCR name typo flags for manual review without duplicate student", async () => {
    const res = await simulateDocumentUpload({
      documentType: "sf9",
      schoolYear: "2026-2027",
      gradeLevel: "Grade 11",
      imageUrl: "https://storage.local/typo_test.jpg",
      fileHash: "hash-typo-test",
      extractedFields: {
        lrn: "123456789012",
        name: "GOMEZ, JUSTYN", // typo
        first_name: "JUSTYN",
        last_name: "GOMEZ",
        grades: [],
      },
    });

    // Reused canonical document and flagged for review
    assert.strictEqual(res.documentId, canonicalDocId);
    const stuCount = await db.query(`SELECT COUNT(*) FROM public.students WHERE lrn = '123456789012'`);
    assert.strictEqual(parseInt(stuCount.rows[0].count, 10), 1, "Must NOT create second student");
  });

  await t.test("Scenario 9: Same LRN with completely different name BLOCKS auto-linking", async () => {
    const res = await simulateDocumentUpload({
      documentType: "sf9",
      schoolYear: "2026-2027",
      gradeLevel: "Grade 11",
      imageUrl: "https://storage.local/latonero_collision.jpg",
      fileHash: "hash-collision-test",
      extractedFields: {
        lrn: "123456789012",
        name: "LATONERO, KENNETH ABAD",
        first_name: "KENNETH",
        last_name: "LATONERO",
        grades: [],
      },
    });

    assert.strictEqual(res.code, "ACADEMIC_RECORD_CREATED");
    assert.notStrictEqual(res.documentId, canonicalDocId, "Must NOT link Kenneth to Justin Gomez record!");
    assert.strictEqual(res.studentId, null, "student_id must be null to prevent corruption");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 12 & 13: Same student with different school year / grade level
  // ---------------------------------------------------------------------------
  await t.test("Scenario 12 & 13: Same student with NEW School Year creates legitimate separate academic record", async () => {
    const res = await simulateDocumentUpload({
      documentType: "sf9",
      schoolYear: "2027-2028", // Next school year!
      gradeLevel: "Grade 12",  // Next grade level!
      imageUrl: "https://storage.local/gomez_grade12_scan.jpg",
      fileHash: "hash-g12-sy2027",
      extractedFields: {
        lrn: "123456789012",
        name: "GOMEZ, JUSTIN LOQUILLANO",
        first_name: "JUSTIN",
        last_name: "GOMEZ",
        middle_name: "LOQUILLANO",
        school_year: "2027-2028",
        grade_level: "Grade 12",
        semester: "1st Semester",
        grades: [
          { subject: "Media and Information Literacy", semester: "1st Semester", q1: 90 },
        ],
      },
    });

    assert.strictEqual(res.code, "ACADEMIC_RECORD_CREATED");
    assert.strictEqual(res.studentId, canonicalStudentId, "Must reuse SAME canonical student!");
    assert.notStrictEqual(res.documentId, canonicalDocId, "Must create legitimate separate document for new academic year!");

    // Student has exactly 2 documents (Grade 11 and Grade 12)
    const docCount = await db.query(`SELECT COUNT(*) FROM public.documents WHERE student_id = $1`, [canonicalStudentId]);
    assert.strictEqual(parseInt(docCount.rows[0].count, 10), 2);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 14: SF9 versus SF10 for the same student
  // ---------------------------------------------------------------------------
  await t.test("Scenario 14: SF10 Permanent Record creates legitimate separate record from SF9", async () => {
    const res = await simulateDocumentUpload({
      documentType: "sf10", // Permanent record!
      schoolYear: "2026-2027",
      gradeLevel: "Grade 11",
      imageUrl: "https://storage.local/gomez_sf10.jpg",
      fileHash: "hash-sf10",
      extractedFields: {
        lrn: "123456789012",
        name: "GOMEZ, JUSTIN LOQUILLANO",
        first_name: "JUSTIN",
        last_name: "GOMEZ",
        grades: [],
      },
    });

    assert.strictEqual(res.code, "ACADEMIC_RECORD_CREATED");
    assert.strictEqual(res.studentId, canonicalStudentId, "Must reuse same student");
    assert.notStrictEqual(res.documentId, canonicalDocId, "SF10 is distinct from SF9");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 15: Concurrent uploads from different sessions
  // ---------------------------------------------------------------------------
  await t.test("Scenario 15: Concurrent upload simulation reuses canonical academic record without duplicates", async () => {
    // Fire two uploads concurrently
    const [uploadA, uploadB] = await Promise.all([
      simulateDocumentUpload({
        documentType: "sf9",
        schoolYear: "2026-2027",
        gradeLevel: "Grade 11",
        imageUrl: "https://storage.local/concurrent_a.jpg",
        fileHash: "hash-concurrent-a",
        extractedFields: {
          lrn: "123456789012",
          name: "GOMEZ, JUSTIN LOQUILLANO",
          grades: [{ subject: "Oral Communication", q1: 88, q2: 88 }],
        },
      }),
      simulateDocumentUpload({
        documentType: "sf9",
        schoolYear: "2026-2027",
        gradeLevel: "Grade 11",
        imageUrl: "https://storage.local/concurrent_b.jpg",
        fileHash: "hash-concurrent-b",
        extractedFields: {
          lrn: "123456789012",
          name: "GOMEZ, JUSTIN LOQUILLANO",
          grades: [{ subject: "General Mathematics", q1: 76, q2: 94 }],
        },
      }),
    ]);

    assert.strictEqual(uploadA.documentId, canonicalDocId);
    assert.strictEqual(uploadB.documentId, canonicalDocId);

    // Document count for S.Y. 2026-2027 Grade 11 SF9 must strictly remain 1
    const countRes = await db.query(
      `SELECT COUNT(*) FROM public.documents WHERE student_id = $1 AND document_type = 'sf9' AND school_year = '2026-2027'`,
      [canonicalStudentId]
    );
    assert.strictEqual(parseInt(countRes.rows[0].count, 10), 1, "Must not create duplicate documents under concurrency");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 16: Existing verified grade conflicts
  // ---------------------------------------------------------------------------
  await t.test("Scenario 16: Conflicting grades on approved record are NOT overwritten & flagged for review", async () => {
    // Approve the canonical document
    await db.query(`UPDATE public.documents SET status = 'approved' WHERE id = $1`, [canonicalDocId]);

    const res = await simulateDocumentUpload({
      documentType: "sf9",
      schoolYear: "2026-2027",
      gradeLevel: "Grade 11",
      imageUrl: "https://storage.local/conflict_scan.jpg",
      fileHash: "hash-conflict-test",
      extractedFields: {
        lrn: "123456789012",
        name: "GOMEZ, JUSTIN LOQUILLANO",
        grades: [
          { subject: "Oral Communication", semester: "1st Semester", q1: 60 }, // conflicting! verified was 88
        ],
      },
    });

    assert.strictEqual(res.documentId, canonicalDocId);
    assert.strictEqual(res.message, "Conflicting grades detected. Manual verification required.");
    assert.strictEqual(res.conflicts.length, 1);

    const doc = await db.query(`SELECT extracted_fields, status FROM public.documents WHERE id = $1`, [canonicalDocId]);
    assert.strictEqual(doc.rows[0].status, "needs_review", "Status must move to needs_review for teacher examination");
    const oralComm = doc.rows[0].extracted_fields.grades.find(g => g.subject === "Oral Communication");
    assert.strictEqual(oralComm.q1, 88, "Verified grade 88 must NOT be overwritten!");
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 21, 22, 23, 24: Queue, Registry, Scan History, Audit Trail
  // ---------------------------------------------------------------------------
  await t.test("Scenario 21 & 22: Review Queue and Document Registry represent exactly ONE canonical record for 2026-2027", async () => {
    const docs2026 = await db.query(
      `SELECT id, status FROM public.documents WHERE student_id = $1 AND document_type = 'sf9' AND school_year = '2026-2027'`,
      [canonicalStudentId]
    );
    assert.strictEqual(docs2026.rows.length, 1, "Document Registry has exactly ONE record for S.Y. 2026-2027 SF9");

    const activeQueue = await db.query(
      `SELECT id FROM public.documents WHERE student_id = $1 AND document_type = 'sf9' AND school_year = '2026-2027' AND status = 'needs_review'`,
      [canonicalStudentId]
    );
    assert.strictEqual(activeQueue.rows.length, 1, "Review Queue has exactly ONE active item for this academic record");
  });

  await t.test("Scenario 23 & 24: Scan evidence and audit history are complete and preserved", async () => {
    const scans = await db.query(`SELECT COUNT(*) FROM public.document_scans WHERE document_id = $1`, [canonicalDocId]);
    assert.ok(parseInt(scans.rows[0].count, 10) >= 3, "All uploaded scans are preserved in document_scans");

    const auditLogs = await db.query(`SELECT action, count(*) FROM public.audit_logs WHERE target_id = $1 GROUP BY action`, [canonicalDocId]);
    assert.ok(auditLogs.rows.length >= 1, "Audit logs recorded all actions for the canonical document");
  });

  await t.test("Scenario 25: Migration 021 SQL Enforcement — Preflight Block, Historical Reconciliation of 6 Live Records, and Database-Level Unique Index Enforcement", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const origMigSql = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/archive/021_canonical_academic_records_and_scan_versions.original.sql"),
      "utf8"
    );
    const phaseASql = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/021a_schema_triggers_backfill_and_functions.sql"),
      "utf8"
    );
    const phaseBSql = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/021b_reconcile_historical_duplicate_documents.sql"),
      "utf8"
    );
    const phaseCSql = fs.readFileSync(
      path.resolve(process.cwd(), "supabase/migrations/021c_enforce_canonical_document_unique_indexes.sql"),
      "utf8"
    );

    const migDb = new PGlite();
    await migDb.exec(`
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
        id UUID PRIMARY KEY, school_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT UNIQUE);
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
        first_name TEXT NOT NULL, middle_name TEXT, last_name TEXT NOT NULL, suffix TEXT,
        grade_level TEXT, sex TEXT, status TEXT DEFAULT 'active',
        overall_status TEXT DEFAULT 'Needs Verification',
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
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
        extracted_fields JSONB DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'needs_review',
        uploaded_by UUID,
        reviewed_by UUID,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT documents_status_check CHECK (status IN ('submitted','extracted','validated','needs_review','approved','rejected','corrected'))
      );
      CREATE TABLE public.subject_grades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
        document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
        school_year TEXT, grade_level TEXT, semester TEXT,
        subject TEXT NOT NULL,
        q1 NUMERIC, q2 NUMERIC, q3 NUMERIC, q4 NUMERIC,
        final_grade NUMERIC, status TEXT,
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE public.audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id TEXT, category TEXT, action TEXT, outcome TEXT,
        actor_user_id UUID, actor_email TEXT, actor_role TEXT DEFAULT 'anonymous', school_id UUID, actor_school_id UUID,
        target_type TEXT, target_id TEXT, target_label TEXT,
        reason TEXT, details JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE public.grade_change_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subject_grade_id UUID REFERENCES public.subject_grades(id) ON DELETE CASCADE,
        student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
        document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
        school_year TEXT, semester TEXT, grade_level TEXT, subject TEXT, quarter TEXT,
        previous_value NUMERIC, new_value NUMERIC, reason TEXT, changed_by UUID,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE public.academic_standing_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
        document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
        school_year TEXT, grade_level TEXT, curriculum TEXT, source_form_version TEXT,
        grading_policy_version TEXT, general_average_printed NUMERIC,
        previous_status TEXT, new_status TEXT, decision_source TEXT, confirmation_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Seed exact 6 historical production records + 1 student + 18 subject_grades rows
    await migDb.exec(`
      INSERT INTO public.schools (id, school_id, name)
      VALUES ('a0000000-0000-0000-0000-000000000001', '300792', 'Taysan Resettlement Integrated School');

      INSERT INTO auth.users (id, email)
      VALUES ('135baa53-7e1e-4c1f-b76a-f32a915b5f21', 'teacher@tris.edu.ph');

      INSERT INTO public.students (id, school_id, lrn, first_name, middle_name, last_name, grade_level, status, overall_status)
      VALUES ('6722d559-440f-4cdc-bd14-e12fad11d836', 'a0000000-0000-0000-0000-000000000001', '111304581972', 'JUSTIN', 'LOQUILLANO', 'GOMEZ', '11', 'active', 'Conditional');

      -- 1. Pre-approval unlinked Justin Gomez duplicate (4a04de06...)
      INSERT INTO public.documents (id, student_id, school_id, document_type, status, uploaded_by, image_url, original_filename, created_at, updated_at, extracted_fields)
      VALUES (
        '4a04de06-2e3b-4397-8bb3-4a6b96beb40e', NULL, 'a0000000-0000-0000-0000-000000000001', 'sf9', 'needs_review',
        '135baa53-7e1e-4c1f-b76a-f32a915b5f21', 'https://storage/sf9_front_1794314060175.jpg', 'sf9_front_1794314060175.jpg',
        '2026-11-10T12:34:34Z', '2026-11-10T12:34:34Z',
        '{"lrn":"111304581972","name":"GOMEZ, JUSTIN LOQUILLANO","last_name":"GOMEZ","first_name":"JUSTIN","school_year":"2019-2020","grade_level":"11"}'::jsonb
      );

      -- 2. Canonical approved Justin Gomez record (840dc1c4...)
      INSERT INTO public.documents (id, student_id, school_id, document_type, status, uploaded_by, reviewed_by, reviewed_at, image_url, original_filename, created_at, updated_at, extracted_fields)
      VALUES (
        '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '6722d559-440f-4cdc-bd14-e12fad11d836', 'a0000000-0000-0000-0000-000000000001', 'sf9', 'approved',
        '135baa53-7e1e-4c1f-b76a-f32a915b5f21', '135baa53-7e1e-4c1f-b76a-f32a915b5f21', '2026-11-10T12:37:01Z',
        'https://storage/sf9_front_1794314173198.jpg', 'sf9_front_1794314173198.jpg',
        '2026-11-10T12:36:28Z', '2026-11-10T12:37:01Z',
        '{"lrn":"111304581972","name":"GOMEZ, JUSTIN LOQUILLANO","last_name":"GOMEZ","first_name":"JUSTIN","school_year":"2019-2020","grade_level":"11"}'::jsonb
      );

      -- 3. Kenneth Latonero needs_review identity collision (cc8b4c08...)
      INSERT INTO public.documents (id, student_id, school_id, document_type, status, uploaded_by, image_url, original_filename, created_at, updated_at, extracted_fields)
      VALUES (
        'cc8b4c08-14bb-4c92-9958-d670f878ac29', '6722d559-440f-4cdc-bd14-e12fad11d836', 'a0000000-0000-0000-0000-000000000001', 'sf9', 'needs_review',
        '135baa53-7e1e-4c1f-b76a-f32a915b5f21', 'https://storage/sf9_front_1794641220755.jpg', 'sf9_front_1794641220755.jpg',
        '2026-11-14T07:27:09Z', '2026-11-14T07:27:09Z',
        '{"lrn":"111304581972","name":"Latonero, Kenneth Abad","last_name":"Latonero","first_name":"Kenneth","school_year":"2019-2020","grade_level":"11"}'::jsonb
      );

      -- 4. Kenneth Latonero rejected identity collision (edda579a...)
      INSERT INTO public.documents (id, student_id, school_id, document_type, status, uploaded_by, reviewed_by, reviewed_at, image_url, original_filename, created_at, updated_at, extracted_fields)
      VALUES (
        'edda579a-6e1d-4acb-81d8-25d078798ff7', '6722d559-440f-4cdc-bd14-e12fad11d836', 'a0000000-0000-0000-0000-000000000001', 'sf9', 'rejected',
        '135baa53-7e1e-4c1f-b76a-f32a915b5f21', '135baa53-7e1e-4c1f-b76a-f32a915b5f21', '2026-11-14T08:06:04Z',
        'https://storage/sf9_front_1794641474152.jpg', 'sf9_front_1794641474152.jpg',
        '2026-11-14T07:31:21Z', '2026-11-14T08:06:04Z',
        '{"lrn":"111304581972","name":"Latonero, Kenneth Abad","last_name":"Latonero","first_name":"Kenneth","school_year":"2019-2020","grade_level":"11"}'::jsonb
      );

      -- 5. Later Justin Gomez duplicate (983802cc...)
      INSERT INTO public.documents (id, student_id, school_id, document_type, status, uploaded_by, image_url, original_filename, created_at, updated_at, extracted_fields)
      VALUES (
        '983802cc-cdb3-4f56-9c27-1aeb9c215233', '6722d559-440f-4cdc-bd14-e12fad11d836', 'a0000000-0000-0000-0000-000000000001', 'sf9', 'needs_review',
        '135baa53-7e1e-4c1f-b76a-f32a915b5f21', 'https://storage/sf9_front_1794667959673.jpg', 'sf9_front_1794667959673.jpg',
        '2026-11-14T14:52:45Z', '2026-11-14T14:52:45Z',
        '{"lrn":"111304581972","name":"GOMEZ, JUSTIN LOQUILLANO","last_name":"GOMEZ","first_name":"JUSTIN","school_year":"2019-2020","grade_level":"11"}'::jsonb
      );

      -- 6. Later Justin Gomez duplicate (f3a40d3b...)
      INSERT INTO public.documents (id, student_id, school_id, document_type, status, uploaded_by, image_url, original_filename, created_at, updated_at, extracted_fields)
      VALUES (
        'f3a40d3b-09ca-4521-9a4e-9e12d32dcf6d', '6722d559-440f-4cdc-bd14-e12fad11d836', 'a0000000-0000-0000-0000-000000000001', 'sf9', 'needs_review',
        '135baa53-7e1e-4c1f-b76a-f32a915b5f21', 'https://storage/sf9_front_1794668016328.jpg', 'sf9_front_1794668016328.jpg',
        '2026-11-14T14:53:42Z', '2026-11-14T14:53:42Z',
        '{"lrn":"111304581972","name":"GOMEZ, JUSTIN LOQUILLANO","last_name":"GOMEZ","first_name":"JUSTIN","school_year":"2019-2020","grade_level":"11"}'::jsonb
      );

      -- Insert exact 18 production subject_grades rows linked to canonical 840dc1c4-a272-444e-9ff4-2faba4b94c0b
      INSERT INTO public.subject_grades (id, student_id, document_id, school_year, grade_level, semester, subject, q1, q2, q3, q4, final_grade, status) VALUES
        ('45e076e4-29e4-460a-be36-61e314c11044', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '1st Semester', 'Oral Communication', 88, 88, NULL, NULL, 88, 'Passed'),
        ('9d1a3114-e333-4494-a158-d0e0841a2585', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '1st Semester', 'Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino', 98, 98, NULL, NULL, 98, 'Passed'),
        ('bd83dec9-3e0e-4c98-b1b0-56d31c79c1d7', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '1st Semester', 'Introduction to the Philosophy of the Human Person /Pambungad sa Pilosopiya ng Tao', 78, 78, NULL, NULL, 78, 'Passed'),
        ('7f5a20b6-a37e-4c00-b4eb-e857578698f3', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '1st Semester', 'Physical Education and Health 1', 75, 74, NULL, NULL, 74.5, 'Failed'),
        ('ae963b24-0f56-45c0-a9e4-fc762d8e336f', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '1st Semester', 'General Mathematics', 76, 94, NULL, NULL, 85, 'Passed'),
        ('65188746-d680-48cd-9df5-60b231233ca2', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '1st Semester', 'Earth Science', 89, 83, NULL, NULL, 91, 'Passed'),
        ('d57c89f6-c71e-49dd-8e54-7cbfa4041432', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '1st Semester', 'Empowerment Technologies', 91, 92, NULL, NULL, 91.5, 'Passed'),
        ('f05befa6-4eab-4aad-8606-baf12f540e1b', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '1st Semester', 'Pre-Calculus', 96, 79, NULL, NULL, 87.5, 'Passed'),
        ('8a830422-9e9e-4534-846f-1b3aa2881ef7', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '1st Semester', 'General Chemistry 1', 90, 80, NULL, NULL, 85, 'Passed'),
        ('a6cf52ab-4e4a-4140-971b-b645069359cf', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '2nd Semester', 'Reading and Writing', NULL, NULL, 70, 98, 84, 'Passed'),
        ('11167aa9-e702-43d0-b17f-b17fea2e62f5', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '2nd Semester', 'Pagbasa at Pagsusuri ng Iba''t-Ibang Teksto Tungo sa Pananaliksik', NULL, NULL, 80, 80, 80, 'Passed'),
        ('b2972599-a1a8-4f76-a682-e48069a3657f', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '2nd Semester', 'Personal Development/ Pansariling Kaunlaran', NULL, NULL, 90, 90, 90, 'Passed'),
        ('0a96940f-3858-4837-8114-3690267db93b', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '2nd Semester', 'Physical Education and Health 2', NULL, NULL, 95, 75, 85, 'Passed'),
        ('303b6c74-14bf-4bc0-804f-3f4c4c531773', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '2nd Semester', 'Statistics and Probability', NULL, NULL, 86, 87, 86.5, 'Passed'),
        ('e9404e26-50c6-4124-9ee0-add286691eb6', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '2nd Semester', 'Disaster Readiness and Risk Reduction', NULL, NULL, 97, 93, 97, 'Passed'),
        ('ad71fada-6471-4539-bc48-c41906462490', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '2nd Semester', 'Practical Research 1', NULL, NULL, 84, 87, 85.5, 'Passed'),
        ('2ef3d1c7-c9e5-4d8c-827f-e97bf1b19272', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '2nd Semester', 'Basic Calculus', NULL, NULL, 88, 98, 93, 'Passed'),
        ('271398a7-fa68-40e8-a851-01bf9c94e8e0', '6722d559-440f-4cdc-bd14-e12fad11d836', '840dc1c4-a272-444e-9ff4-2faba4b94c0b', '2019-2020', '11', '2nd Semester', 'General Chemistry 2', NULL, NULL, 78, 81, 79.5, 'Passed');
    `);

    // Compute deterministic pre-migration snapshot and SHA-256 hash of all 18 approved subject_grades rows
    const preGradesRes = await migDb.query(`
      SELECT id, student_id, document_id, school_year, grade_level, semester, subject,
             q1::text, q2::text, q3::text, q4::text, final_grade::text, status
      FROM public.subject_grades
      WHERE document_id = '840dc1c4-a272-444e-9ff4-2faba4b94c0b'
      ORDER BY id ASC
    `);
    const preGradesHash = crypto.createHash("sha256").update(JSON.stringify(preGradesRes.rows)).digest("hex");

    // 1. Verify that running original monolithic Migration 021 before manual reconciliation blocks loudly on un-reconciled duplicates
    await assert.rejects(
      async () => {
        await migDb.exec(origMigSql);
      },
      /Migration 021 Pre-flight Blocked/i,
      "Original Migration 021 must block index creation until Phase 021-B manual reconciliation is executed"
    );
    await migDb.exec("ROLLBACK;");

    // 2. Execute refactored Migration 021 phases sequentially: Phase 021-A -> Phase 021-B -> Phase 021-C
    await migDb.exec(phaseASql);
    await migDb.exec(phaseBSql);
    await migDb.exec(phaseCSql);

    // 3. Verify reconciliation results: all 18 subject_grades on 840dc1c4 are 100% bit-for-bit identical (by row and SHA-256 hash), 4 scans in document_scans, 3 archived duplicates
    const postGradesRes = await migDb.query(`
      SELECT id, student_id, document_id, school_year, grade_level, semester, subject,
             q1::text, q2::text, q3::text, q4::text, final_grade::text, status
      FROM public.subject_grades
      WHERE document_id = '840dc1c4-a272-444e-9ff4-2faba4b94c0b'
      ORDER BY id ASC
    `);
    const postGradesHash = crypto.createHash("sha256").update(JSON.stringify(postGradesRes.rows)).digest("hex");
    assert.strictEqual(postGradesRes.rows.length, 18, "All 18 verified subject_grades must remain intact");
    assert.deepStrictEqual(postGradesRes.rows, preGradesRes.rows, "Every single column of all 18 approved subject_grades rows must remain unchanged");
    assert.strictEqual(postGradesHash, preGradesHash, "Pre-migration and post-migration 18-row subject_grades SHA-256 digest must match identically");

    const scanCount = await migDb.query(`SELECT COUNT(*) FROM public.document_scans WHERE document_id = '840dc1c4-a272-444e-9ff4-2faba4b94c0b'`);
    assert.strictEqual(parseInt(scanCount.rows[0].count, 10), 4, "All 4 Justin Gomez scans must be preserved in document_scans");

    const archivedDocs = await migDb.query(`
      SELECT id, status, archived_at, archived_by
      FROM public.documents
      WHERE id IN ('4a04de06-2e3b-4397-8bb3-4a6b96beb40e', '983802cc-cdb3-4f56-9c27-1aeb9c215233', 'f3a40d3b-09ca-4521-9a4e-9e12d32dcf6d')
    `);
    assert.strictEqual(archivedDocs.rows.length, 3);
    for (const d of archivedDocs.rows) {
      assert.strictEqual(d.status, "archived");
      assert.ok(d.archived_at);
    }

    // 4. Verify Kenneth Latonero records have student_id = NULL, canonical_lrn = NULL, identity_conflict = true, and preserved status ('needs_review' and 'rejected')
    const latoneroDocs = await migDb.query(`
      SELECT id, status, student_id, canonical_lrn, extracted_fields->>'identity_conflict' AS conflict, extracted_fields->>'manual_lrn_verification_required' AS manual_verif
      FROM public.documents
      WHERE id IN ('cc8b4c08-14bb-4c92-9958-d670f878ac29', 'edda579a-6e1d-4acb-81d8-25d078798ff7')
    `);
    for (const row of latoneroDocs.rows) {
      assert.strictEqual(row.student_id, null, `Kenneth Latonero doc ${row.id} must have student_id = null`);
      assert.strictEqual(row.canonical_lrn, null, `Kenneth Latonero doc ${row.id} must have canonical_lrn = null`);
      assert.strictEqual(row.conflict, "true", `Kenneth Latonero doc ${row.id} must be flagged with identity_conflict = true`);
      assert.strictEqual(row.manual_verif, "true", `Kenneth Latonero doc ${row.id} must require manual LRN verification`);
    }

    // Verify Kenneth Latonero collision doc CANNOT be approved without manual LRN verification (lrn_conflict_verified = true)
    await assert.rejects(
      async () => {
        await migDb.query(`UPDATE public.documents SET status = 'approved' WHERE id = 'cc8b4c08-14bb-4c92-9958-d670f878ac29'`);
      },
      /Identity Collision Blocked/i,
      "Kenneth Latonero collision document must be blocked from approval until manual LRN verification is completed!"
    );

    // 4b. Verify that direct SQL UPDATE or INSERT attempting to forge lrn_conflict_verified = true is rejected with 42501
    await assert.rejects(
      async () => {
        await migDb.query(`
          UPDATE public.documents
          SET extracted_fields = jsonb_set(extracted_fields, '{lrn_conflict_verified}', 'true'::jsonb)
          WHERE id = 'cc8b4c08-14bb-4c92-9958-d670f878ac29'
        `);
      },
      (err) => err.code === "42501" && /Security Violation: lrn_conflict_verified can only be set through the authorized, audited public\.resolve_document_identity_conflict\(\) RPC/i.test(err.message),
      "Direct SQL UPDATE forging lrn_conflict_verified = true must be blocked with 42501!"
    );

    await assert.rejects(
      async () => {
        await migDb.query(`
          INSERT INTO public.documents (school_id, document_type, status, image_url, extracted_fields)
          VALUES (
            'a0000000-0000-0000-0000-000000000001',
            'sf9',
            'needs_review',
            'https://storage/forged_insert.jpg',
            '{"lrn":"999888777666","name":"LATONERO, KENNETH","lrn_conflict_verified":true}'::jsonb
          )
        `);
      },
      (err) => err.code === "42501" && /Security Violation: lrn_conflict_verified cannot be set on initial document insert/i.test(err.message),
      "Direct SQL INSERT forging lrn_conflict_verified = true must be blocked with 42501!"
    );

    // Verify that resolve_document_identity_conflict() requires an authenticated, approved Teacher/Admin in the same school
    await assert.rejects(
      async () => {
        await migDb.query(`
          SELECT public.resolve_document_identity_conflict(
            'cc8b4c08-14bb-4c92-9958-d670f878ac29',
            '111304999888',
            'Kenneth',
            'Latonero',
            'Abad',
            'Verified physical SF9 card LRN against school registrar masterlist'
          );
        `);
      },
      (err) => err.code === "42501",
      "Unauthenticated call to resolve_document_identity_conflict must be rejected with 42501!"
    );

    // 5. Verify all 4 partial unique indexes exist in pg_indexes and match the documented academic identity
    const idxRes = await migDb.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'documents'
        AND indexname IN (
          'idx_documents_canonical_sf9_active',
          'idx_documents_canonical_sf9_student_active',
          'idx_documents_canonical_sf10_active',
          'idx_documents_unresolved_file_hash_active'
        )
      ORDER BY indexname
    `);
    assert.strictEqual(idxRes.rows.length, 4, "All 4 partial unique indexes must be created and active in pg_indexes");
    const sf9LrnIdx = idxRes.rows.find(r => r.indexname === "idx_documents_canonical_sf9_active");
    assert.match(sf9LrnIdx.indexdef, /\(school_id, canonical_lrn, document_type, school_year, grade_level\)/i);
    const sf9StuIdx = idxRes.rows.find(r => r.indexname === "idx_documents_canonical_sf9_student_active");
    assert.match(sf9StuIdx.indexdef, /\(school_id, student_id, document_type, school_year, grade_level\)/i);

    // 5. Verify database-level rejection (23505) on raw SQL insert for same student + SY + Grade 11
    await assert.rejects(
      async () => {
        await migDb.query(`
          INSERT INTO public.documents (student_id, school_id, document_type, status, image_url, extracted_fields)
          VALUES (
            NULL,
            'a0000000-0000-0000-0000-000000000001',
            'sf9',
            'needs_review',
            'https://storage/new_dup_attempt.jpg',
            '{"lrn":"111304581972","name":"GOMEZ, JUSTIN LOQUILLANO","last_name":"GOMEZ","school_year":"2019-2020","grade_level":"11"}'::jsonb
          )
        `);
      },
      (err) => err.code === "23505",
      "PostgreSQL must auto-link student_id via trigger and reject duplicate SF9 with 23505 on idx_documents_canonical_sf9_active!"
    );

    // 6. Verify same student + same SY with Grade 12 is allowed (proving grade_level is part of SF9 identity)
    const g12Res = await migDb.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, status, image_url, extracted_fields)
      VALUES (
        '6722d559-440f-4cdc-bd14-e12fad11d836',
        'a0000000-0000-0000-0000-000000000001',
        'sf9',
        'needs_review',
        'https://storage/gomez_g12.jpg',
        '{"lrn":"111304581972","name":"GOMEZ, JUSTIN LOQUILLANO","last_name":"GOMEZ","school_year":"2019-2020","grade_level":"Grade 12"}'::jsonb
      )
      RETURNING id, grade_level
    `);
    assert.strictEqual(g12Res.rows[0].grade_level, "Grade 12");

    // 7. Verify unresolved staging documents (student_id IS NULL) reject duplicate file_hash with 23505
    await migDb.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, status, image_url, extracted_fields)
      VALUES (
        NULL,
        'a0000000-0000-0000-0000-000000000001',
        'sf9',
        'needs_review',
        'https://storage/unresolved_scan_1.jpg',
        '{"name":"UNKNOWN LEARNER"}'::jsonb
      )
    `);
    await assert.rejects(
      async () => {
        await migDb.query(`
          INSERT INTO public.documents (student_id, school_id, document_type, status, image_url, extracted_fields)
          VALUES (
            NULL,
            'a0000000-0000-0000-0000-000000000001',
            'sf9',
            'needs_review',
            'https://storage/unresolved_scan_1.jpg',
            '{"name":"UNKNOWN LEARNER"}'::jsonb
          )
        `);
      },
      (err) => err.code === "23505",
      "PostgreSQL must reject duplicate unresolved staging documents with the same file_hash!"
    );

    // 8. Real Database Concurrency Test: Parallel INSERT race condition on idx_documents_canonical_sf9_active
    const concurrentOutcomes = await Promise.allSettled([
      migDb.query(`
        INSERT INTO public.documents (student_id, school_id, document_type, school_year, grade_level, status, image_url, extracted_fields)
        VALUES (
          '6722d559-440f-4cdc-bd14-e12fad11d836',
          'a0000000-0000-0000-0000-000000000001',
          'sf9', '2025-2026', 'Grade 12', 'needs_review',
          'https://storage/race_a.jpg',
          '{"lrn":"111304581972","name":"GOMEZ, JUSTIN LOQUILLANO","last_name":"GOMEZ","school_year":"2025-2026","grade_level":"Grade 12"}'::jsonb
        )
      `),
      migDb.query(`
        INSERT INTO public.documents (student_id, school_id, document_type, school_year, grade_level, status, image_url, extracted_fields)
        VALUES (
          '6722d559-440f-4cdc-bd14-e12fad11d836',
          'a0000000-0000-0000-0000-000000000001',
          'sf9', '2025-2026', 'Grade 12', 'needs_review',
          'https://storage/race_b.jpg',
          '{"lrn":"111304581972","name":"GOMEZ, JUSTIN LOQUILLANO","last_name":"GOMEZ","school_year":"2025-2026","grade_level":"Grade 12"}'::jsonb
        )
      `),
    ]);
    const fulfilled = concurrentOutcomes.filter(o => o.status === "fulfilled");
    const rejected = concurrentOutcomes.filter(o => o.status === "rejected" && o.reason?.code === "23505");
    assert.strictEqual(fulfilled.length, 1, "Exactly 1 parallel database insert must succeed");
    assert.strictEqual(rejected.length, 1, "The racing parallel database insert must be rejected by PostgreSQL with 23505");

    // 9. Status Transition Verification: A rejected record does NOT block submitting a corrected upload for the same student & period
    await migDb.query(`
      UPDATE public.documents
      SET status = 'rejected'
      WHERE student_id = '6722d559-440f-4cdc-bd14-e12fad11d836'
        AND school_year = '2025-2026'
        AND grade_level = 'Grade 12'
    `);
    const replacementAfterReject = await migDb.query(`
      INSERT INTO public.documents (student_id, school_id, document_type, school_year, grade_level, status, image_url, extracted_fields)
      VALUES (
        '6722d559-440f-4cdc-bd14-e12fad11d836',
        'a0000000-0000-0000-0000-000000000001',
        'sf9', '2025-2026', 'Grade 12', 'needs_review',
        'https://storage/corrected_after_reject.jpg',
        '{"lrn":"111304581972","name":"GOMEZ, JUSTIN LOQUILLANO","last_name":"GOMEZ","school_year":"2025-2026","grade_level":"Grade 12"}'::jsonb
      )
      RETURNING id, status
    `);
    assert.strictEqual(replacementAfterReject.rows[0].status, "needs_review");
  });
});

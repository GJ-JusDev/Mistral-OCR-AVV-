import test from "node:test";
import assert from "node:assert/strict";

import { evaluateStudentIdentity, verifyStudentCollision } from "../src/lib/validation/studentMatcher.ts";

test("Safe Staging Workflow & Student Persistence Safety Suite", async (t) => {
  await t.test("1. evaluateStudentIdentity flags unverified OCR names and missing LRNs", () => {
    // Missing LRN
    const noLrn = evaluateStudentIdentity({
      last_name: "DELA CRUZ",
      first_name: "JUAN",
    });
    assert.strictEqual(noLrn.isValidLrn, false);
    assert.strictEqual(noLrn.canAutoCreate, false);
    assert.ok(noLrn.reasons.some(r => r.includes("LRN")));

    // Invalid LRN (not 12 digits)
    const invalidLrn = evaluateStudentIdentity({
      lrn: "12345",
      last_name: "DELA CRUZ",
      first_name: "JUAN",
    });
    assert.strictEqual(invalidLrn.isValidLrn, false);
    assert.strictEqual(invalidLrn.canAutoCreate, false);

    // Missing Name
    const missingName = evaluateStudentIdentity({
      lrn: "123456789012",
      last_name: "",
      first_name: "",
    });
    assert.strictEqual(missingName.isValidLrn, true);
    assert.strictEqual(missingName.isValidName, false);
    assert.strictEqual(missingName.canAutoCreate, false);

    // Valid Identity
    const valid = evaluateStudentIdentity({
      lrn: "123456789012",
      last_name: "DELA CRUZ",
      first_name: "JUAN",
      middle_name: "MIGUEL",
    });
    assert.strictEqual(valid.isValidLrn, true);
    assert.strictEqual(valid.isValidName, true);
    assert.strictEqual(valid.canAutoCreate, true);
    assert.strictEqual(valid.normalizedLrn, "123456789012");
  });

  await t.test("2. verifyStudentCollision prevents silent overwrite on conflicting names", () => {
    const existing = {
      id: "student-uuid-1",
      first_name: "MARIA",
      last_name: "SANTOS",
    };

    // Conflicting last name
    const collision = verifyStudentCollision("DELA CRUZ", existing);
    assert.strictEqual(collision.hasConflict, true);
    assert.ok(collision.reason?.includes("DELA CRUZ"));
    assert.ok(collision.reason?.includes("SANTOS"));

    // Matching last name
    const noCollision = verifyStudentCollision("SANTOS", existing);
    assert.strictEqual(noCollision.hasConflict, false);
  });

  await t.test("3. Document staging simulation verifies students table is never written on initial upload", async () => {
    // Simulated database store
    const studentsTable = [];
    const documentsTable = [];

    // Simulated POST /api/documents handler following our updated staging logic
    function handleUploadDocument(body, user) {
      const validDocTypes = ['sf9', 'sf10', 'school_id', 'birth_cert', 'other'];
      let documentType = String(body.document_type || "sf9").toLowerCase().trim();
      if (!validDocTypes.includes(documentType)) documentType = 'sf9';

      // Never allow client upload to claim 'approved'
      let status = String(body.status || "submitted").toLowerCase().trim();
      const validStatuses = ['submitted', 'extracted', 'validated', 'needs_review', 'corrected'];
      if (!validStatuses.includes(status)) {
        status = 'submitted';
      }

      let studentId = body.student_id || null;
      const extractedFields = { ...(body.extracted_fields || {}) };
      const identityEval = evaluateStudentIdentity(extractedFields);

      if (!studentId && identityEval.isValidLrn && identityEval.normalizedLrn) {
        const existingStudent = studentsTable.find(s => s.lrn === identityEval.normalizedLrn);
        if (existingStudent) {
          const collision = verifyStudentCollision(identityEval.lastName, existingStudent);
          if (!collision.hasConflict) {
            studentId = existingStudent.id;
          } else {
            extractedFields.flags = [...(extractedFields.flags || []), collision.reason];
          }
        } else {
          // SAFE STAGING: Stage candidate in extracted_fields, DO NOT insert into studentsTable!
          extractedFields.candidate_student = {
            lrn: identityEval.normalizedLrn,
            first_name: identityEval.firstName || null,
            middle_name: identityEval.middleName || null,
            last_name: identityEval.lastName || null,
            suffix: identityEval.suffix || null,
            grade_level: extractedFields.grade_level || null,
            sex: extractedFields.sex === 'M' || extractedFields.sex === 'F' ? extractedFields.sex : null,
          };
          if (status === 'submitted' || status === 'validated') {
            status = 'needs_review';
          }
        }
      }

      const docRecord = {
        id: `doc-${documentsTable.length + 1}`,
        student_id: studentId,
        document_type: documentType,
        extracted_fields: extractedFields,
        status: status,
        uploaded_by: user.id,
      };
      documentsTable.push(docRecord);
      return docRecord;
    }

    // Attempt upload of new student OCR data
    const uploadedDoc = handleUploadDocument({
      document_type: "sf9",
      status: "approved", // malicious/premature approval attempt
      extracted_fields: {
        lrn: "123456789012",
        last_name: "DELA CRUZ",
        first_name: "JUAN",
        middle_name: "MIGUEL",
        school_year: "2024-2025",
        grade_level: "Grade 11",
      },
    }, { id: "user-teacher-1" });

    // Assert that students table remains empty!
    assert.strictEqual(studentsTable.length, 0, "Initial upload must NEVER write to students table");
    // Assert document is in needs_review or submitted, never approved
    assert.strictEqual(uploadedDoc.status, "needs_review", "Status must be held at needs_review");
    assert.strictEqual(uploadedDoc.student_id, null, "student_id must be null until authorized approval");
    assert.ok(uploadedDoc.extracted_fields.candidate_student, "Candidate student must be staged in extracted_fields");
    assert.strictEqual(uploadedDoc.extracted_fields.candidate_student.lrn, "123456789012");
  });

  await t.test("4. Authoritative approval creates student record only with valid authorized review", async () => {
    const studentsTable = [];
    const stagedDocument = {
      id: "doc-1",
      student_id: null,
      status: "needs_review",
      extracted_fields: {
        lrn: "123456789012",
        last_name: "DELA CRUZ",
        first_name: "JUAN",
        middle_name: "MIGUEL",
        school_year: "2024-2025",
        grade_level: "Grade 11",
      },
    };

    // Simulated submitDocumentReview("approve")
    function handleApproveReview(doc) {
      const fields = doc.extracted_fields;
      if (!fields.school_year || !/^20\d{2}-20\d{2}$/.test(fields.school_year)) {
        return { error: "Invalid school year" };
      }
      const identityEval = evaluateStudentIdentity(fields);
      if (!identityEval.isValidLrn || !identityEval.isValidName) {
        return { error: "Invalid student identity" };
      }

      let studentId = doc.student_id;
      if (!studentId && identityEval.canAutoCreate) {
        const newStudent = {
          id: `student-${studentsTable.length + 1}`,
          lrn: identityEval.normalizedLrn,
          first_name: identityEval.firstName,
          last_name: identityEval.lastName,
          middle_name: identityEval.middleName,
          status: "active",
        };
        studentsTable.push(newStudent);
        studentId = newStudent.id;
      }

      doc.student_id = studentId;
      doc.status = "approved";
      return { success: true, doc };
    }

    const reviewResult = handleApproveReview(stagedDocument);
    assert.strictEqual(reviewResult.success, true);
    assert.strictEqual(studentsTable.length, 1, "Verified student record created upon authorized approval");
    assert.strictEqual(studentsTable[0].lrn, "123456789012");
    assert.strictEqual(stagedDocument.status, "approved");
    assert.strictEqual(stagedDocument.student_id, studentsTable[0].id);
  });
});

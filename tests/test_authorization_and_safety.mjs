import test from 'node:test';
import assert from 'node:assert/strict';

// ==============================================================================
// AVV — Complete Authorization, Schema Safety & Grade Synchronization Tests
// ==============================================================================

// --- Simulation of Policy Evaluation & Schema Constraints ---

function evaluateRlsPolicy({ table, action, role, accountStatus, userSchoolId, targetSchoolId, recordOwnerId, currentUserId, currentDocStatus, targetDocStatus }) {
  const isAnonymous = !currentUserId;
  const isApproved = accountStatus === 'Approved' || role === 'admin';
  const isAdmin = role === 'admin';
  const isPrincipal = role === 'principal' && isApproved;
  const isTeacher = role === 'teacher' && isApproved;

  if (isAnonymous) {
    return { allowed: false, reason: 'Anonymous access denied' };
  }

  if (!isApproved) {
    return { allowed: false, reason: `Account status ${accountStatus} is not approved` };
  }

  // 1. user_roles
  if (table === 'user_roles') {
    if (action === 'SELECT') {
      if (isAdmin || currentUserId === recordOwnerId) return { allowed: true };
      return { allowed: false, reason: 'Non-admin cannot view other roles' };
    }
    if (['INSERT', 'UPDATE', 'DELETE'].includes(action)) {
      if (isAdmin) return { allowed: true };
      return { allowed: false, reason: 'Only Admin can manage user roles' };
    }
  }

  // 2. schools
  if (table === 'schools') {
    if (action === 'SELECT') {
      if (isApproved) return { allowed: true };
      return { allowed: false, reason: 'Unapproved users cannot read schools' };
    }
    if (['INSERT', 'UPDATE', 'DELETE'].includes(action)) {
      if (isAdmin) return { allowed: true };
      return { allowed: false, reason: 'Only Admin can modify schools' };
    }
  }

  // 3. documents
  if (table === 'documents') {
    if (action === 'SELECT') {
      if (isAdmin) return { allowed: true };
      if (isPrincipal) {
        // Safe school-scoped Principal access requires matching school_id
        if (userSchoolId && targetSchoolId && userSchoolId !== targetSchoolId) {
          return { allowed: false, reason: 'Principal restricted to own school' };
        }
        return { allowed: true };
      }
      if (isTeacher) {
        if (recordOwnerId === currentUserId) return { allowed: true };
        return { allowed: false, reason: 'Teacher can only view own uploaded documents' };
      }
    }
    if (action === 'INSERT') {
      if (isAdmin || isPrincipal || (isTeacher && recordOwnerId === currentUserId)) return { allowed: true };
      return { allowed: false, reason: 'Uploader ID mismatch or unauthorized' };
    }
    if (action === 'UPDATE') {
      if (isAdmin) return { allowed: true };
      if (isPrincipal) {
        if (userSchoolId && targetSchoolId && userSchoolId !== targetSchoolId) {
          return { allowed: false, reason: 'Principal restricted to own school' };
        }
        return { allowed: true };
      }
      if (isTeacher) {
        if (recordOwnerId !== currentUserId) {
          return { allowed: false, reason: 'Cannot update other teachers documents' };
        }
        if (['approved', 'rejected'].includes(currentDocStatus)) {
          return { allowed: false, reason: 'Cannot modify already finalized document' };
        }
        if (['approved', 'rejected'].includes(targetDocStatus)) {
          return { allowed: false, reason: 'Teacher cannot approve or reject document' };
        }
        return { allowed: true };
      }
    }
    if (action === 'DELETE') {
      if (isAdmin) return { allowed: true };
      return { allowed: false, reason: 'Only Admin can delete documents' };
    }
  }

  // 4. subject_grades
  if (table === 'subject_grades') {
    if (action === 'SELECT') {
      if (isAdmin) return { allowed: true };
      if (isPrincipal) {
        if (userSchoolId && targetSchoolId && userSchoolId !== targetSchoolId) {
          return { allowed: false, reason: 'Principal restricted to own school grades' };
        }
        return { allowed: true };
      }
      if (isTeacher) {
        if (recordOwnerId === currentUserId) return { allowed: true };
        return { allowed: false, reason: 'Teacher cannot view grades from other uploads' };
      }
    }
    if (['INSERT', 'UPDATE', 'DELETE'].includes(action)) {
      if (isAdmin) return { allowed: true };
      return { allowed: false, reason: 'Direct grade modification restricted to Admin / Trigger' };
    }
  }

  return { allowed: false, reason: 'Unhandled policy' };
}

// --- Simulation of process_approved_document() Trigger ---

class MockGradeDatabase {
  constructor() {
    this.students = new Map();
    this.documents = new Map();
    this.subject_grades = new Map();
  }

  insertStudent(id, lrn, schoolId) {
    this.students.set(id, { id, lrn, schoolId, overall_status: 'Needs Verification' });
  }

  insertDocument(id, studentId, uploaderId, schoolId, fields, status = 'submitted') {
    this.documents.set(id, { id, student_id: studentId, uploaded_by: uploaderId, school_id: schoolId, extracted_fields: fields, status });
  }

  triggerProcessDocument(op, oldDoc, newDoc) {
    const targetDocId = op === 'DELETE' ? oldDoc.id : newDoc.id;
    const targetStudentId = op === 'DELETE' ? oldDoc.student_id : newDoc.student_id;

    if (!targetStudentId) return;

    if (op === 'UPDATE' && newDoc.status === 'approved' && (oldDoc.status !== 'approved' || JSON.stringify(newDoc.extracted_fields) !== JSON.stringify(oldDoc.extracted_fields))) {
      // 1. Purge existing grades for this document ONLY
      for (const [gradeId, grade] of this.subject_grades.entries()) {
        if (grade.document_id === newDoc.id) {
          this.subject_grades.delete(gradeId);
        }
      }

      // 2. Insert normalized grades
      const gradesArray = newDoc.extracted_fields?.grades || [];
      const docSchoolYear = newDoc.extracted_fields?.school_year || null;

      for (let i = 0; i < gradesArray.length; i++) {
        const g = gradesArray[i];
        const gradeId = `grade-${newDoc.id}-${i}`;
        this.subject_grades.set(gradeId, {
          id: gradeId,
          student_id: newDoc.student_id,
          document_id: newDoc.id,
          school_year: g.school_year || docSchoolYear,
          subject: g.subject || 'General Subject',
          q1: g.q1 ?? null,
          q2: g.q2 ?? null,
          q3: g.q3 ?? null,
          q4: g.q4 ?? null,
          final_grade: g.final ?? null,
          status: g.final !== undefined ? (g.final < 75 ? 'Failed' : 'Passed') : 'Missing',
          needs_verification: g.needsVerification ?? (g.final === undefined)
        });
      }

      // 3. Calculate status advisory based on DepEd DO 8 s. 2015 rules
      const docGrades = Array.from(this.subject_grades.values()).filter(g => g.document_id === newDoc.id);
      const failedCount = docGrades.filter(g => g.status === 'Failed').length;
      const unverifiedCount = docGrades.filter(g => g.needs_verification || g.status === 'Missing').length;

      let overall = 'Needs Verification';
      if (unverifiedCount > 0) {
        overall = 'Needs Verification';
      } else if (failedCount >= 3) {
        overall = 'Failed'; // Retained advisory
      } else if (failedCount >= 1 && failedCount <= 2) {
        overall = 'Needs Verification'; // Conditional / Remedial advisory
      } else if (docGrades.length > 0) {
        overall = 'Passed'; // Promoted advisory
      }

      const student = this.students.get(newDoc.student_id);
      if (student) {
        student.overall_status = overall;
      }
    } else if ((op === 'UPDATE' && newDoc.status !== 'approved' && oldDoc.status === 'approved') || (op === 'DELETE' && oldDoc.status === 'approved')) {
      // Clean up grades for this document ONLY
      for (const [gradeId, grade] of this.subject_grades.entries()) {
        if (grade.document_id === targetDocId) {
          this.subject_grades.delete(gradeId);
        }
      }

      // Recalculate status from remaining approved documents
      const remainingApproved = Array.from(this.documents.values()).filter(d => d.student_id === targetStudentId && d.status === 'approved' && d.id !== targetDocId);
      
      let overall = 'Needs Verification';
      if (remainingApproved.length > 0) {
        const latestDoc = remainingApproved[0];
        const latestGrades = Array.from(this.subject_grades.values()).filter(g => g.document_id === latestDoc.id);
        const failedCount = latestGrades.filter(g => g.status === 'Failed').length;
        const unverifiedCount = latestGrades.filter(g => g.needs_verification || g.status === 'Missing').length;

        if (unverifiedCount > 0) overall = 'Needs Verification';
        else if (failedCount >= 3) overall = 'Failed';
        else if (failedCount >= 1 && failedCount <= 2) overall = 'Needs Verification';
        else if (latestGrades.length > 0) overall = 'Passed';
      }

      const student = this.students.get(targetStudentId);
      if (student) {
        student.overall_status = overall;
      }
    }
  }
}

// --- Test Suite Execution ---

test('AVV Database-Level Authorization & Grade Synchronization Tests', async (t) => {

  await t.test('1. Role Permissions: Anonymous and Pending/Declined access is strictly denied', () => {
    // Case 1.1: Anonymous user
    const anonRes = evaluateRlsPolicy({
      table: 'documents', action: 'SELECT',
      currentUserId: null, role: null, accountStatus: null
    });
    assert.equal(anonRes.allowed, false);

    // Case 1.2: Pending Teacher
    const pendingRes = evaluateRlsPolicy({
      table: 'documents', action: 'SELECT',
      currentUserId: 'user-pending', role: 'teacher', accountStatus: 'Pending'
    });
    assert.equal(pendingRes.allowed, false);

    // Case 1.3: Declined Teacher
    const declinedRes = evaluateRlsPolicy({
      table: 'documents', action: 'SELECT',
      currentUserId: 'user-declined', role: 'teacher', accountStatus: 'Declined'
    });
    assert.equal(declinedRes.allowed, false);
  });

  await t.test('2. Teacher Scope: Can view own uploads, blocked from other teachers uploads', () => {
    // Teacher A viewing own document
    const ownDocRes = evaluateRlsPolicy({
      table: 'documents', action: 'SELECT',
      currentUserId: 'teacher-a', role: 'teacher', accountStatus: 'Approved',
      recordOwnerId: 'teacher-a'
    });
    assert.equal(ownDocRes.allowed, true);

    // Teacher A attempting to view Teacher B's document
    const otherDocRes = evaluateRlsPolicy({
      table: 'documents', action: 'SELECT',
      currentUserId: 'teacher-a', role: 'teacher', accountStatus: 'Approved',
      recordOwnerId: 'teacher-b'
    });
    assert.equal(otherDocRes.allowed, false);
    assert.match(otherDocRes.reason, /Teacher can only view own uploaded documents/);
  });

  await t.test('3. Document Finalization: Teacher CANNOT approve/reject, Principal and Admin CAN', () => {
    // Teacher attempting to approve document
    const teacherApproveRes = evaluateRlsPolicy({
      table: 'documents', action: 'UPDATE',
      currentUserId: 'teacher-a', role: 'teacher', accountStatus: 'Approved',
      recordOwnerId: 'teacher-a',
      currentDocStatus: 'validated', targetDocStatus: 'approved'
    });
    assert.equal(teacherApproveRes.allowed, false);
    assert.match(teacherApproveRes.reason, /Teacher cannot approve or reject/);

    // Principal approving document
    const principalApproveRes = evaluateRlsPolicy({
      table: 'documents', action: 'UPDATE',
      currentUserId: 'principal-1', role: 'principal', accountStatus: 'Approved',
      recordOwnerId: 'teacher-a',
      currentDocStatus: 'validated', targetDocStatus: 'approved'
    });
    assert.equal(principalApproveRes.allowed, true);

    // Admin approving document
    const adminApproveRes = evaluateRlsPolicy({
      table: 'documents', action: 'UPDATE',
      currentUserId: 'admin-1', role: 'admin', accountStatus: 'Approved',
      recordOwnerId: 'teacher-a',
      currentDocStatus: 'validated', targetDocStatus: 'approved'
    });
    assert.equal(adminApproveRes.allowed, true);
  });

  await t.test('4. Safe Principal Access: Restricted to Principal assigned school', () => {
    // Principal 1 from School TRIS viewing TRIS document
    const sameSchoolRes = evaluateRlsPolicy({
      table: 'documents', action: 'SELECT',
      currentUserId: 'principal-tris', role: 'principal', accountStatus: 'Approved',
      userSchoolId: 'school-tris', targetSchoolId: 'school-tris',
      recordOwnerId: 'teacher-a'
    });
    assert.equal(sameSchoolRes.allowed, true);

    // Principal 1 from School TRIS attempting to view School B document
    const diffSchoolRes = evaluateRlsPolicy({
      table: 'documents', action: 'SELECT',
      currentUserId: 'principal-tris', role: 'principal', accountStatus: 'Approved',
      userSchoolId: 'school-tris', targetSchoolId: 'school-other',
      recordOwnerId: 'teacher-other'
    });
    assert.equal(diffSchoolRes.allowed, false);
    assert.match(diffSchoolRes.reason, /Principal restricted to own school/);
  });

  await t.test('5. Grade Integrity: Direct grade modification blocked for Teachers and Principals', () => {
    // Teacher inserting grade directly
    const teacherGradeRes = evaluateRlsPolicy({
      table: 'subject_grades', action: 'INSERT',
      currentUserId: 'teacher-a', role: 'teacher', accountStatus: 'Approved'
    });
    assert.equal(teacherGradeRes.allowed, false);

    // Principal inserting grade directly
    const principalGradeRes = evaluateRlsPolicy({
      table: 'subject_grades', action: 'INSERT',
      currentUserId: 'principal-1', role: 'principal', accountStatus: 'Approved'
    });
    assert.equal(principalGradeRes.allowed, false);

    // Admin modifying grades
    const adminGradeRes = evaluateRlsPolicy({
      table: 'subject_grades', action: 'INSERT',
      currentUserId: 'admin-1', role: 'admin', accountStatus: 'Approved'
    });
    assert.equal(adminGradeRes.allowed, true);
  });

  await t.test('6. Grade Synchronization: Preserves unrelated document grades across approval and deletion', () => {
    const db = new MockGradeDatabase();
    db.insertStudent('student-1', '123456789012', 'school-tris');

    // Document 1 (Grade 11 First Semester)
    const doc1Fields = {
      school_year: '2023-2024',
      grades: [
        { subject: 'Oral Communication', q1: 85, q2: 87, final: 86 },
        { subject: 'General Mathematics', q1: 80, q2: 82, final: 81 }
      ]
    };
    db.insertDocument('doc-1', 'student-1', 'teacher-a', 'school-tris', doc1Fields, 'submitted');

    // Approve Document 1
    db.triggerProcessDocument('UPDATE', { ...db.documents.get('doc-1') }, { ...db.documents.get('doc-1'), status: 'approved' });
    db.documents.get('doc-1').status = 'approved';

    assert.equal(db.subject_grades.size, 2, 'Doc 1 grades inserted');
    assert.equal(db.students.get('student-1').overall_status, 'Passed', '0 fails = Passed advisory');

    // Document 2 (Grade 11 Second Semester)
    const doc2Fields = {
      school_year: '2023-2024',
      grades: [
        { subject: 'Reading and Writing', q1: 88, q2: 90, final: 89 },
        { subject: 'Statistics and Probability', q1: 84, q2: 86, final: 85 }
      ]
    };
    db.insertDocument('doc-2', 'student-1', 'teacher-b', 'school-tris', doc2Fields, 'submitted');

    // Approve Document 2
    db.triggerProcessDocument('UPDATE', { ...db.documents.get('doc-2') }, { ...db.documents.get('doc-2'), status: 'approved' });
    db.documents.get('doc-2').status = 'approved';

    assert.equal(db.subject_grades.size, 4, 'Doc 1 and Doc 2 grades both present');

    // Re-approving Document 1 must NOT duplicate grades or touch Document 2
    db.triggerProcessDocument('UPDATE', { ...db.documents.get('doc-1') }, { ...db.documents.get('doc-1'), status: 'approved' });
    assert.equal(db.subject_grades.size, 4, 'Re-approval did not duplicate grades');

    // Rejecting Document 2 removes Doc 2 grades, but Doc 1 grades remain untouched!
    db.triggerProcessDocument('UPDATE', { ...db.documents.get('doc-2') }, { ...db.documents.get('doc-2'), status: 'rejected' });
    db.documents.get('doc-2').status = 'rejected';

    assert.equal(db.subject_grades.size, 2, 'Only Doc 2 grades purged');
    const remainingDocIds = Array.from(db.subject_grades.values()).map(g => g.document_id);
    assert.ok(remainingDocIds.every(id => id === 'doc-1'), 'Doc 1 grades completely preserved');
    assert.equal(db.students.get('student-1').overall_status, 'Passed', 'Status recalculated from remaining approved Doc 1');

    // Deleting Document 1 purges its grades and resets student status
    db.triggerProcessDocument('DELETE', { ...db.documents.get('doc-1') }, null);
    assert.equal(db.subject_grades.size, 0, 'Grades purged upon document deletion');
    assert.equal(db.students.get('student-1').overall_status, 'Needs Verification', 'Reset when no approved docs remain');
  });

  await t.test('7. Academic Status Review Advisory: Flags 1-2 failures for remedial instruction review', () => {
    const db = new MockGradeDatabase();
    db.insertStudent('student-remedial', '999888777666', 'school-tris');

    // Document with 1 failed subject (DepEd DO 8 s. 2015: Conditional / Remedial)
    const remedialDocFields = {
      school_year: '2023-2024',
      grades: [
        { subject: 'Earth and Life Science', final: 72 }, // Failed
        { subject: 'Personal Development', final: 85 }   // Passed
      ]
    };
    db.insertDocument('doc-remedial', 'student-remedial', 'teacher-a', 'school-tris', remedialDocFields, 'submitted');
    db.triggerProcessDocument('UPDATE', { ...db.documents.get('doc-remedial') }, { ...db.documents.get('doc-remedial'), status: 'approved' });

    assert.equal(
      db.students.get('student-remedial').overall_status,
      'Needs Verification',
      '1 failure must be flagged as Needs Verification for remedial review, not outright Failed'
    );
  });
});

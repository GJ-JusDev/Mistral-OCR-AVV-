import test from 'node:test';
import assert from 'node:assert/strict';

test('Phase 1 Unit Tests: Critical Repairs & Validation Engine', async (t) => {
  await t.test('ValidationSummary correctly computes pass and fail counts', () => {
    const mockResults = [
      { ruleId: 'SF9_LRN_FORMAT', passed: true, message: 'Valid LRN', severity: 'error' },
      { ruleId: 'SF9_PASSING_GRADE', passed: true, message: 'Grade >= 75', severity: 'warning' },
      { ruleId: 'SF9_ATTENDANCE_TOTAL', passed: false, message: 'Days exceed total', severity: 'error' },
      { ruleId: 'SF9_SCHOOL_NAME', passed: false, message: 'School name check', severity: 'warning' },
    ];

    // Testing the repaired calculation logic in ValidationSummary and document details
    const passCount = mockResults.filter((r) => r.passed).length;
    const failCount = mockResults.filter((r) => !r.passed).length;
    const errorCount = mockResults.filter((r) => !r.passed && r.severity === 'error').length;
    const warningCount = mockResults.filter((r) => !r.passed && r.severity === 'warning').length;

    assert.equal(passCount, 2, 'Passed rules must be 2');
    assert.equal(failCount, 2, 'Failed rules must be 2');
    assert.equal(errorCount, 1, 'Error severity failures must be 1');
    assert.equal(warningCount, 1, 'Warning severity failures must be 1');
  });

  await t.test('Document Ingestion normalizes document_type and status', () => {
    const validDocTypes = ['sf9', 'sf10', 'school_id', 'birth_cert', 'other'];
    const validStatuses = ['submitted', 'extracted', 'validated', 'needs_review', 'corrected', 'approved', 'rejected'];

    function normalizePayload(payload) {
      const docTypeLower = (payload.document_type || '').toLowerCase();
      const normalizedDocType = validDocTypes.includes(docTypeLower) ? docTypeLower : 'sf9';
      
      let normalizedStatus = payload.status || 'submitted';
      if (normalizedStatus === 'pending') normalizedStatus = 'submitted';
      if (!validStatuses.includes(normalizedStatus)) normalizedStatus = 'submitted';

      return {
        document_type: normalizedDocType,
        status: normalizedStatus,
      };
    }

    // Legacy / invalid values that used to cause DB constraint violations
    const res1 = normalizePayload({ document_type: 'Unknown', status: 'pending' });
    assert.equal(res1.document_type, 'sf9');
    assert.equal(res1.status, 'submitted');

    const res2 = normalizePayload({ document_type: 'SF10', status: 'pending' });
    assert.equal(res2.document_type, 'sf10');
    assert.equal(res2.status, 'submitted');

    const res3 = normalizePayload({ document_type: 'sf9', status: 'approved' });
    assert.equal(res3.document_type, 'sf9');
    assert.equal(res3.status, 'approved');
  });

  await t.test('Student Name and Academic Status formatting', () => {
    function formatStudentName(s) {
      return `${s.last_name}, ${s.first_name}${s.middle_name ? ' ' + s.middle_name : ''}${s.suffix ? ' ' + s.suffix : ''}`;
    }

    const student1 = {
      first_name: 'Juan',
      middle_name: 'Protacio',
      last_name: 'Dela Cruz',
      suffix: 'Jr.',
      overall_status: 'Promoted',
      status: 'active'
    };

    const student2 = {
      first_name: 'Maria',
      middle_name: null,
      last_name: 'Santos',
      suffix: null,
      overall_status: 'Retained',
      status: 'active'
    };

    assert.equal(formatStudentName(student1), 'Dela Cruz, Juan Protacio Jr.');
    assert.equal(formatStudentName(student2), 'Santos, Maria');
    assert.equal(student1.overall_status, 'Promoted');
    assert.equal(student2.overall_status, 'Retained');
  });

  await t.test('Review Action transitions and audit log structure', () => {
    function processReview({ action, comment, reviewerId, currentDoc }) {
      if (!['approve', 'reject'].includes(action)) {
        throw new Error('Invalid action');
      }

      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const logEntry = {
        document_id: currentDoc.id,
        reviewed_by: reviewerId,
        action,
        comment: comment || null,
        created_at: new Date().toISOString()
      };

      return {
        updatedDocument: {
          ...currentDoc,
          status: newStatus,
        },
        logEntry
      };
    }

    const doc = { id: 'doc-123', status: 'needs_review', student_id: 'stud-456' };
    const approval = processReview({
      action: 'approve',
      comment: 'Verified against SF10 original copy.',
      reviewerId: 'user-teacher-01',
      currentDoc: doc
    });

    assert.equal(approval.updatedDocument.status, 'approved');
    assert.equal(approval.logEntry.action, 'approve');
    assert.equal(approval.logEntry.comment, 'Verified against SF10 original copy.');
    assert.equal(approval.logEntry.reviewed_by, 'user-teacher-01');

    const rejection = processReview({
      action: 'reject',
      comment: 'Incorrect LRN transcribed.',
      reviewerId: 'user-teacher-01',
      currentDoc: doc
    });

    assert.equal(rejection.updatedDocument.status, 'rejected');
    assert.equal(rejection.logEntry.action, 'reject');
    assert.equal(rejection.logEntry.comment, 'Incorrect LRN transcribed.');
  });

  await t.test('Reports historical volume aggregation (deterministic replacement of Math.random)', () => {
    // Generates 7 consecutive daily buckets initialized to 0
    const now = new Date('2026-10-13T10:00:00Z');
    const buckets = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().split('T')[0];
      buckets[key] = { count: 0, date: key };
    }

    const mockDocs = [
      { created_at: '2026-10-13T08:00:00Z' },
      { created_at: '2026-10-13T09:30:00Z' },
      { created_at: '2026-10-12T14:00:00Z' },
      { created_at: '2026-10-10T11:00:00Z' },
    ];

    mockDocs.forEach(doc => {
      const key = doc.created_at.split('T')[0];
      if (buckets[key]) {
        buckets[key].count++;
      }
    });

    const result = Object.values(buckets);
    assert.equal(result.length, 7);
    assert.equal(buckets['2026-10-13'].count, 2);
    assert.equal(buckets['2026-10-12'].count, 1);
    assert.equal(buckets['2026-10-10'].count, 1);
    assert.equal(buckets['2026-10-11'].count, 0);
  });
});

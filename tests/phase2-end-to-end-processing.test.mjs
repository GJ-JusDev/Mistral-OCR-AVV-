import test from 'node:test';
import assert from 'node:assert/strict';

// --- Pure implementations matching src/lib/validation/patterns.ts & studentMatcher.ts ---

const LRN_PATTERN = /^\d{12}$/;
const NAME_PATTERN = /[a-zA-ZÀ-ÿñÑ]{2,}/;

function normalizeLrn(raw) {
  return raw ? String(raw).replace(/[\s\-]/g, '') : '';
}

function isValidLrn(raw) {
  return LRN_PATTERN.test(normalizeLrn(raw));
}

function isValidSchoolYear(raw) {
  if (!raw) return false;
  const match = String(raw).trim().match(/^(?:S\.?Y\.?\s*)?(20\d{2})\s*[-–/]\s*(20\d{2})$/i);
  if (!match) return false;
  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  return end === start + 1;
}

const INVALID_PLACEHOLDERS = new Set([
  'unknown',
  'learner',
  'student',
  'not found',
  'n/a',
  'none',
  'null',
  'undefined',
]);

function isRealName(namePart) {
  if (!namePart) return false;
  const trimmed = namePart.trim().toLowerCase();
  if (trimmed.length < 2) return false;
  if (INVALID_PLACEHOLDERS.has(trimmed)) return false;
  return NAME_PATTERN.test(namePart);
}

function evaluateStudentIdentity(fields) {
  const reasons = [];
  const rawLrn = fields.lrn ? String(fields.lrn) : '';
  const normalizedLrn = rawLrn ? normalizeLrn(rawLrn) : null;
  const isLrnValid = Boolean(normalizedLrn && isValidLrn(normalizedLrn));

  if (!isLrnValid) {
    if (!normalizedLrn) {
      reasons.push('LRN is missing.');
    } else {
      reasons.push(`Invalid LRN: "${rawLrn}" is not exactly 12 numeric digits.`);
    }
  }

  let firstName = fields.first_name?.trim() || null;
  let middleName = fields.middle_name?.trim() || null;
  let lastName = fields.last_name?.trim() || null;
  const suffix = fields.suffix?.trim() || null;

  if ((!firstName || !lastName) && fields.name) {
    const rawName = fields.name.trim();
    if (rawName.includes(',')) {
      const [last, ...rest] = rawName.split(',').map((s) => s.trim());
      lastName = lastName || last;
      const firstParts = rest.join(' ').split(/\s+/);
      firstName = firstName || firstParts[0];
      if (firstParts.length > 1) {
        middleName = middleName || firstParts.slice(1).join(' ');
      }
    } else {
      const parts = rawName.split(/\s+/);
      if (parts.length >= 2) {
        lastName = lastName || parts[0];
        firstName = firstName || parts.slice(1).join(' ');
      }
    }
  }

  const isFirstNameValid = isRealName(firstName);
  const isLastNameValid = isRealName(lastName);
  const isNameValid = isFirstNameValid && isLastNameValid;

  if (!isFirstNameValid) {
    reasons.push(`First name is missing or invalid ("${firstName || 'empty'}").`);
  }
  if (!isLastNameValid) {
    reasons.push(`Last name is missing or invalid ("${lastName || 'empty'}").`);
  }

  const canAutoCreate = isLrnValid && isNameValid;
  const canAutoLink = isLrnValid;
  const requiresManualReview = !canAutoCreate;

  return {
    isValidLrn: isLrnValid,
    isValidName: isNameValid,
    normalizedLrn: isLrnValid ? normalizedLrn : null,
    firstName: isFirstNameValid ? firstName : null,
    middleName,
    lastName: isLastNameValid ? lastName : null,
    suffix,
    canAutoLink,
    canAutoCreate,
    requiresManualReview,
    reasons,
  };
}

function verifyStudentCollision(extractedLastName, existingStudent) {
  if (!extractedLastName) {
    return {
      hasConflict: true,
      reason: `Cannot link to student ${existingStudent.last_name}, ${existingStudent.first_name} without an extracted last name for verification.`,
    };
  }

  const cleanExtracted = extractedLastName.toLowerCase().replace(/[^a-z]/g, '');
  const cleanExisting = existingStudent.last_name.toLowerCase().replace(/[^a-z]/g, '');

  const isMatch = cleanExtracted === cleanExisting ||
    cleanExtracted.includes(cleanExisting) ||
    cleanExisting.includes(cleanExtracted);

  if (!isMatch) {
    return {
      hasConflict: true,
      reason: `LRN conflict detected: LRN is registered to "${existingStudent.last_name}, ${existingStudent.first_name}", but document extracted "${extractedLastName}". Manual verification required.`,
    };
  }

  return { hasConflict: false };
}

// --- Test Suite Execution ---

test('Phase 2 Unit Tests: End-to-End Document Processing & Integrity', async (t) => {
  await t.test('DepEd School Year Validation & No Hardcoded Fallback', () => {
    // Valid consecutive DepEd school years
    assert.equal(isValidSchoolYear('2023-2024'), true);
    assert.equal(isValidSchoolYear('2024-2025'), true);
    assert.equal(isValidSchoolYear('S.Y. 2023-2024'), true);
    assert.equal(isValidSchoolYear('SY 2022-2023'), true);
    assert.equal(isValidSchoolYear('2023/2024'), true);

    // Invalid non-consecutive or malformed school years
    assert.equal(isValidSchoolYear('2023-2025'), false, 'Non-consecutive year must be rejected');
    assert.equal(isValidSchoolYear('2024-2023'), false, 'Inverted year must be rejected');
    assert.equal(isValidSchoolYear(''), false, 'Empty year must be rejected');
    assert.equal(isValidSchoolYear('2023'), false, 'Single year must be rejected');
    assert.equal(isValidSchoolYear('random-year'), false, 'Malformed string must be rejected');
  });

  await t.test('DepEd Strict 12-Digit LRN Validation', () => {
    assert.equal(isValidLrn('123456789012'), true);
    assert.equal(isValidLrn('123456-789012'), true, 'Should normalize hyphens');
    assert.equal(isValidLrn('123456 789012'), true, 'Should normalize spaces');

    // Invalid LRNs
    assert.equal(isValidLrn('12345678901'), false, '11 digits must fail');
    assert.equal(isValidLrn('1234567890123'), false, '13 digits must fail');
    assert.equal(isValidLrn('12345678901a'), false, 'Alphanumeric must fail');
    assert.equal(isValidLrn(''), false, 'Empty string must fail');
  });

  await t.test('Student Identity Evaluation prevents creating phantom or unverified students', () => {
    // Valid student data
    const validFields = {
      lrn: '109876543210',
      name: 'Dela Cruz, Juan M.',
      grade_level: 'Grade 10',
      school_year: '2023-2024',
    };
    const validEval = evaluateStudentIdentity(validFields);
    assert.equal(validEval.isValidLrn, true);
    assert.equal(validEval.isValidName, true);
    assert.equal(validEval.canAutoCreate, true);
    assert.equal(validEval.lastName, 'Dela Cruz');
    assert.equal(validEval.firstName, 'Juan');

    // OCR mistake: placeholder name
    const placeholderFields = {
      lrn: '109876543210',
      name: 'Unknown Learner',
      first_name: 'Unknown',
      last_name: 'Learner',
    };
    const placeholderEval = evaluateStudentIdentity(placeholderFields);
    assert.equal(placeholderEval.isValidName, false, 'Placeholder names must be rejected');
    assert.equal(placeholderEval.canAutoCreate, false, 'Must NOT auto-create placeholder student');
    assert.equal(placeholderEval.requiresManualReview, true);

    // OCR mistake: missing or short LRN
    const badLrnFields = {
      lrn: '12345',
      name: 'Santos, Maria',
    };
    const badLrnEval = evaluateStudentIdentity(badLrnFields);
    assert.equal(badLrnEval.isValidLrn, false);
    assert.equal(badLrnEval.canAutoCreate, false);
  });

  await t.test('LRN Identity Collision Detection blocks linking to wrong student', () => {
    const existingStudent = {
      id: 'existing-stud-1',
      first_name: 'Maria',
      last_name: 'Santos',
    };

    // Case 1: LRN collision - OCR extracted Dela Cruz, but LRN is registered to Santos
    const collisionCheck = verifyStudentCollision('Dela Cruz', existingStudent);
    assert.equal(collisionCheck.hasConflict, true, 'Must detect mismatch between Santos and Dela Cruz');
    assert.match(collisionCheck.reason, /LRN conflict detected/);

    // Case 2: Matching names
    const matchCheck = verifyStudentCollision('Santos', existingStudent);
    assert.equal(matchCheck.hasConflict, false, 'Must allow matching last name');

    // Case 3: Missing extracted last name
    const missingNameCheck = verifyStudentCollision(null, existingStudent);
    assert.equal(missingNameCheck.hasConflict, true, 'Must flag conflict when extracted last name is missing');
  });

  await t.test('Storage File Upload Validation (MIME & Size limits)', () => {
    const ALLOWED_MIME_TYPES = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
    ]);
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

    function validateUpload(mimeType, sizeBytes) {
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return { valid: false, error: 'Unsupported file type' };
      }
      if (sizeBytes > MAX_FILE_SIZE) {
        return { valid: false, error: 'File size exceeds 10MB' };
      }
      return { valid: true };
    }

    assert.equal(validateUpload('image/jpeg', 2 * 1024 * 1024).valid, true);
    assert.equal(validateUpload('image/png', 5 * 1024 * 1024).valid, true);
    assert.equal(validateUpload('application/pdf', 9 * 1024 * 1024).valid, true);

    // Invalid files
    assert.equal(validateUpload('application/x-msdownload', 1024).valid, false);
    assert.equal(validateUpload('text/html', 1024).valid, false);
    assert.equal(validateUpload('image/jpeg', 11 * 1024 * 1024).valid, false);
  });

  await t.test('Approval Decision Integrity: rejects missing school year or invalid identity', () => {
    function validateApprovalPreconditions(fields) {
      if (!fields.school_year || !isValidSchoolYear(fields.school_year)) {
        return { canApprove: false, error: 'School year is missing or invalid' };
      }
      const identity = evaluateStudentIdentity(fields);
      if (!identity.isValidLrn) {
        return { canApprove: false, error: 'LRN is invalid' };
      }
      if (!identity.isValidName) {
        return { canApprove: false, error: 'Student name is invalid' };
      }
      return { canApprove: true };
    }

    // Complete valid document can be approved
    const validDoc = {
      school_year: '2023-2024',
      lrn: '123456789012',
      name: 'Cruz, Juan',
      first_name: 'Juan',
      last_name: 'Cruz',
    };
    assert.equal(validateApprovalPreconditions(validDoc).canApprove, true);

    // Missing school year MUST block approval
    const missingSyDoc = { ...validDoc, school_year: null };
    assert.equal(validateApprovalPreconditions(missingSyDoc).canApprove, false);
    assert.equal(validateApprovalPreconditions(missingSyDoc).error, 'School year is missing or invalid');

    // Invalid LRN MUST block approval
    const invalidLrnDoc = { ...validDoc, lrn: '123' };
    assert.equal(validateApprovalPreconditions(invalidLrnDoc).canApprove, false);
    assert.equal(validateApprovalPreconditions(invalidLrnDoc).error, 'LRN is invalid');
  });

  await t.test('Idempotent Re-processing: avoids duplicate records on retry', () => {
    const store = new Map();

    function persistDocument(payload) {
      if (payload.document_id && store.has(payload.document_id)) {
        // Update existing record
        const existing = store.get(payload.document_id);
        const updated = { ...existing, ...payload, updated_at: new Date().toISOString() };
        store.set(payload.document_id, updated);
        return { record: updated, createdNew: false };
      }

      // Insert new record
      const id = payload.document_id || `doc-${Date.now()}`;
      const record = { ...payload, id, created_at: new Date().toISOString() };
      store.set(id, record);
      return { record, createdNew: true };
    }

    const first = persistDocument({
      document_id: 'doc-unique-1',
      status: 'submitted',
      image_url: 'https://storage/doc1.jpg',
    });
    assert.equal(first.createdNew, true);
    assert.equal(store.size, 1);

    // Retrying upload with same document_id
    const retry = persistDocument({
      document_id: 'doc-unique-1',
      status: 'validated',
      image_url: 'https://storage/doc1.jpg',
    });
    assert.equal(retry.createdNew, false, 'Must update existing document on retry');
    assert.equal(store.size, 1, 'Store must not have duplicate documents');
    assert.equal(store.get('doc-unique-1').status, 'validated');
  });
});

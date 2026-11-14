import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateStudentIdentity,
  matchStudentIdentityMatrix,
  normalizeNameString,
  levenshteinDistance,
  verifyStudentCollision,
} from "../src/lib/validation/studentMatcher.ts";

import {
  mergeAcademicGrades,
  recomputeSubjectFinalAndStatus,
} from "../src/lib/validation/gradeMerger.ts";

test("AVV Student Identity & Full Name + LRN Matching Matrix Suite", async (t) => {
  await t.test("Case A: SAME LRN + SAME NORMALIZED FULL NAME -> Auto-link & auto-merge", () => {
    const extracted = evaluateStudentIdentity({
      lrn: "123456789012",
      name: "GOMEZ, JUSTIN LOQUILLANO",
      first_name: "JUSTIN",
      last_name: "GOMEZ",
      middle_name: "LOQUILLANO",
    });

    const existingStudent = {
      id: "student-uuid-1",
      lrn: "123456789012",
      first_name: "JUSTIN",
      last_name: "GOMEZ",
      middle_name: "LOQUILLANO",
    };

    const result = matchStudentIdentityMatrix({
      extracted,
      existingStudentByLrn: existingStudent,
    });

    assert.strictEqual(result.matchType, "SAME_LRN_SAME_NAME");
    assert.strictEqual(result.canAutoLink, true);
    assert.strictEqual(result.canAutoMergeGrades, true);
    assert.strictEqual(result.studentId, "student-uuid-1");
  });

  await t.test("Case A2: Same LRN + different capitalization / spacing -> Matches cleanly", () => {
    const extracted = evaluateStudentIdentity({
      lrn: "1234-5678-9012", // with hyphens
      name: "justin   loquillano   gomez", // lowercase, extra spaces
      first_name: "justin",
      last_name: "gomez",
    });

    const existingStudent = {
      id: "student-uuid-1",
      lrn: "123456789012",
      first_name: "JUSTIN",
      last_name: "GOMEZ",
      middle_name: "LOQUILLANO",
    };

    const result = matchStudentIdentityMatrix({
      extracted,
      existingStudentByLrn: existingStudent,
    });

    assert.strictEqual(result.matchType, "SAME_LRN_SAME_NAME");
    assert.strictEqual(result.canAutoLink, true);
    assert.strictEqual(result.canAutoMergeGrades, true);
  });

  await t.test("Case B: SAME LRN + MINOR NAME DIFFERENCE -> Reuses student ID but flags for review", () => {
    const extracted = evaluateStudentIdentity({
      lrn: "123456789012",
      name: "GOMEZ, JUSTYN", // typo in first name (dist = 1)
      first_name: "JUSTYN",
      last_name: "GOMEZ",
    });

    const existingStudent = {
      id: "student-uuid-1",
      lrn: "123456789012",
      first_name: "JUSTIN",
      last_name: "GOMEZ",
    };

    const result = matchStudentIdentityMatrix({
      extracted,
      existingStudentByLrn: existingStudent,
    });

    assert.strictEqual(result.matchType, "SAME_LRN_MINOR_DIFF");
    assert.strictEqual(result.canAutoLink, true, "Must reuse existing student ID to avoid duplicate student");
    assert.strictEqual(result.canAutoMergeGrades, false, "Must NOT auto-apply disputed grades without review");
    assert.strictEqual(result.requiresManualReview, true);
    assert.strictEqual(result.studentId, "student-uuid-1");
    assert.strictEqual(result.flag, "name_discrepancy");
  });

  await t.test("Case C: SAME LRN + COMPLETELY DIFFERENT NAME -> BLOCKS auto-linking & flags collision", () => {
    const extracted = evaluateStudentIdentity({
      lrn: "111304581972",
      name: "LATONERO, KENNETH ABAD",
      first_name: "KENNETH",
      last_name: "LATONERO",
    });

    const existingStudent = {
      id: "student-justin-gomez",
      lrn: "111304581972",
      first_name: "JUSTIN",
      last_name: "GOMEZ",
    };

    const result = matchStudentIdentityMatrix({
      extracted,
      existingStudentByLrn: existingStudent,
    });

    assert.strictEqual(result.matchType, "SAME_LRN_CONFLICT_NAME");
    assert.strictEqual(result.canAutoLink, false, "Must NOT link Kenneth to Justin Gomez record!");
    assert.strictEqual(result.canAutoMergeGrades, false);
    assert.strictEqual(result.studentId, undefined);
    assert.strictEqual(result.flag, "identity_conflict");

    // Also verify verifyStudentCollision
    const colCheck = verifyStudentCollision("LATONERO", existingStudent);
    assert.strictEqual(colCheck.hasConflict, true);
  });

  await t.test("Case D: DIFFERENT LRN + SAME FULL NAME -> Flags discrepancy, does not merge", () => {
    const extracted = evaluateStudentIdentity({
      lrn: "999988887777",
      name: "GOMEZ, JUSTIN LOQUILLANO",
      first_name: "JUSTIN",
      last_name: "GOMEZ",
    });

    const existingStudentByName = {
      id: "student-justin-gomez",
      lrn: "111304581972",
      first_name: "JUSTIN",
      last_name: "GOMEZ",
    };

    const result = matchStudentIdentityMatrix({
      extracted,
      existingStudentByLrn: null,
      existingStudentByNameDiffLrn: existingStudentByName,
    });

    assert.strictEqual(result.matchType, "DIFF_LRN_SAME_NAME");
    assert.strictEqual(result.canAutoLink, false);
    assert.strictEqual(result.requiresManualReview, true);
  });

  await t.test("Case E: NEW VALID LRN + NEW FULL NAME -> Ready for canonical student registration", () => {
    const extracted = evaluateStudentIdentity({
      lrn: "555544443333",
      name: "SANTOS, MARIA CLARA",
      first_name: "MARIA",
      last_name: "SANTOS",
    });

    const result = matchStudentIdentityMatrix({
      extracted,
      existingStudentByLrn: null,
      existingStudentByNameDiffLrn: null,
    });

    assert.strictEqual(result.matchType, "NEW_LRN_NEW_NAME");
    assert.strictEqual(result.canAutoLink, true);
    assert.strictEqual(result.canAutoMergeGrades, true);
  });

  await t.test("Case F: MISSING, INVALID, OR LOW-CONFIDENCE LRN -> Requires manual resolution", () => {
    const extracted = evaluateStudentIdentity({
      lrn: "123", // invalid
      name: "GOMEZ, JUSTIN",
      first_name: "JUSTIN",
      last_name: "GOMEZ",
    });

    const result = matchStudentIdentityMatrix({
      extracted,
      existingStudentByLrn: null,
    });

    assert.strictEqual(result.matchType, "INVALID_OR_MISSING_LRN");
    assert.strictEqual(result.canAutoLink, false);
    assert.strictEqual(result.requiresManualReview, true);
  });
});

test("AVV Deterministic Incremental Grade Merge Suite", async (t) => {
  await t.test("Rule 1: Existing Q1 = 89, incoming Q2 = 92 -> Preserves Q1 = 89, adds Q2 = 92 & calculates final 91", () => {
    const existing = [
      {
        subject: "Oral Communication",
        semester: "1st Semester",
        q1: 89,
        q2: undefined,
        final: undefined,
        status: "Needs Verification",
      },
    ];

    const incoming = [
      {
        subject: "Oral Communication",
        semester: "1st Semester",
        q1: undefined, // blank in incoming scan
        q2: 92,
      },
    ];

    const result = mergeAcademicGrades({
      existingGrades: existing,
      incomingGrades: incoming,
    });

    assert.strictEqual(result.hasNewGrades, true);
    assert.strictEqual(result.mergedGrades.length, 1);
    const sub = result.mergedGrades[0];
    assert.strictEqual(sub.q1, 89, "Q1 must be preserved");
    assert.strictEqual(sub.q2, 92, "Q2 must be added");
    assert.strictEqual(sub.sem1_final_grade, 91, "Final must be (89+92)/2 = 90.5 -> 91");
    assert.strictEqual(sub.status, "Passed");
  });

  await t.test("Rule 2: Existing Q1 = 89, incoming Q1 = 89 -> No change & no duplicate rows", () => {
    const existing = [
      {
        subject: "General Mathematics",
        semester: "1st Semester",
        q1: 89,
        q2: undefined,
      },
    ];

    const incoming = [
      {
        subject: "General Mathematics",
        semester: "1st Semester",
        q1: 89,
      },
    ];

    const result = mergeAcademicGrades({
      existingGrades: existing,
      incomingGrades: incoming,
    });

    assert.strictEqual(result.hasNewGrades, false);
    assert.strictEqual(result.isIdentical, true);
    assert.strictEqual(result.mergedGrades.length, 1);
  });

  await t.test("Rule 3: Existing verified Q1 = 89, incoming Q1 = 85 -> Preserves verified 89 & records conflict", () => {
    const existing = [
      {
        subject: "Pre-Calculus",
        semester: "1st Semester",
        q1: 89,
        q2: 90,
        final: 90,
        status: "Passed",
      },
    ];

    const incoming = [
      {
        subject: "Pre-Calculus",
        semester: "1st Semester",
        q1: 85, // conflicting!
        q2: 90,
      },
    ];

    const result = mergeAcademicGrades({
      existingGrades: existing,
      incomingGrades: incoming,
      isExistingApproved: true, // already verified by teacher/admin
    });

    assert.strictEqual(result.mergedGrades[0].q1, 89, "Verified grade must NOT be overwritten!");
    assert.strictEqual(result.conflicts.length, 1);
    assert.strictEqual(result.conflicts[0].existingValue, 89);
    assert.strictEqual(result.conflicts[0].incomingValue, 85);
  });

  await t.test("Rule 4: Existing Q1 = 89, incoming Q2 is blank -> Preserves Q1, does not store blank as zero", () => {
    const existing = [
      {
        subject: "Earth Science",
        semester: "1st Semester",
        q1: 89,
      },
    ];

    const incoming = [
      {
        subject: "Earth Science",
        semester: "1st Semester",
        q1: 89,
        q2: undefined,
      },
    ];

    const result = mergeAcademicGrades({
      existingGrades: existing,
      incomingGrades: incoming,
    });

    assert.strictEqual(result.mergedGrades[0].q1, 89);
    assert.strictEqual(result.mergedGrades[0].q2, undefined);
    assert.notStrictEqual(result.mergedGrades[0].q2, 0);
  });

  await t.test("Rule 5: Incoming new semester -> Adds semester-specific subjects and grades without modifying existing semester", () => {
    const existing = [
      {
        subject: "Oral Communication",
        semester: "1st Semester",
        q1: 88,
        q2: 88,
        final: 88,
        status: "Passed",
      },
    ];

    const incoming = [
      {
        subject: "Reading and Writing",
        semester: "2nd Semester",
        q3: 84,
        q4: 86,
      },
    ];

    const result = mergeAcademicGrades({
      existingGrades: existing,
      incomingGrades: incoming,
    });

    assert.strictEqual(result.hasNewGrades, true);
    assert.strictEqual(result.mergedGrades.length, 2, "Must contain both Sem 1 and Sem 2 subjects");
    assert.strictEqual(result.mergedGrades[0].subject, "Oral Communication");
    assert.strictEqual(result.mergedGrades[1].subject, "Reading and Writing");
    assert.strictEqual(result.mergedGrades[1].sem2_final_grade, 85, "(84+86)/2 = 85");
  });
});

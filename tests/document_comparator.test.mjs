import test from "node:test";
import assert from "node:assert/strict";
import {
  compareDocuments,
  compareIdentityFields,
  compareAcademicGrades,
} from "../src/lib/validation/documentComparator.ts";

test("Test A — Exact identity match: SF9 and SF10 represent the same learner -> MATCH", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    name: "GOMEZ, JUSTIN LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
    grades: [
      { subject: "Oral Communication in Context", final: 88, status: "Passed" },
      { subject: "General Mathematics", final: 85, status: "Passed" },
    ],
  };

  const sf10 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    name: "GOMEZ, JUSTIN LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
    grades: [
      { subject: "Oral Communication in Context", final: 88, status: "Passed" },
      { subject: "General Mathematics", final: 85, status: "Passed" },
    ],
  };

  const comparison = compareDocuments(sf9, sf10);
  assert.equal(comparison.isSameLearner, true);
  assert.equal(comparison.hasDiscrepancies, false);
  assert.equal(comparison.overallStatus, "MATCH");

  const lrnResult = comparison.identityResults.find((r) => r.field === "lrn");
  assert.equal(lrnResult?.status, "MATCH");

  const lastResult = comparison.identityResults.find((r) => r.field === "last_name");
  assert.equal(lastResult?.status, "MATCH");
});

test("Test B — LRN mismatch: Conflicting LRNs between SF9 and SF10 -> MISMATCH", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
  };

  const sf10 = {
    lrn: "123456789012", // Different LRN
    first_name: "JUSTIN",
    last_name: "GOMEZ",
  };

  const comparison = compareDocuments(sf9, sf10);
  assert.equal(comparison.isSameLearner, false);
  assert.equal(comparison.hasDiscrepancies, true);

  const lrnResult = comparison.identityResults.find((r) => r.field === "lrn");
  assert.equal(lrnResult?.status, "MISMATCH");
});

test("Test C — Name mismatch: Conflicting names between SF9 and SF10 -> MISMATCH", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
  };

  const sf10 = {
    lrn: "111687140043",
    first_name: "MARIA",
    last_name: "SANTOS",
  };

  const comparison = compareDocuments(sf9, sf10);
  assert.equal(comparison.hasDiscrepancies, true);

  const lastResult = comparison.identityResults.find((r) => r.field === "last_name");
  assert.equal(lastResult?.status, "MISMATCH");

  const firstResult = comparison.identityResults.find((r) => r.field === "first_name");
  assert.equal(firstResult?.status, "MISMATCH");
});

test("Test D — Missing OCR identity field: Middle name unreadable on SF9 -> NEEDS VERIFICATION (not MISMATCH)", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "", // OCR could not extract middle name
  };

  const sf10 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
  };

  const comparison = compareDocuments(sf9, sf10);
  // Must NOT treat unextracted middle name as a confirmed mismatch!
  const midResult = comparison.identityResults.find((r) => r.field === "middle_name");
  assert.equal(midResult?.status, "NEEDS_VERIFICATION");
  assert.notEqual(midResult?.status, "MISMATCH");
  assert.equal(comparison.isSameLearner, true);
});

test("Test E — Academic match: Equivalent verified academic values match", () => {
  const sf9Grades = [
    { subject: "Oral Communication", final: 90, status: "Passed" },
    { subject: "General Mathematics", final: 87, status: "Passed" },
  ];

  const sf10Grades = [
    { subject: "Oral Communication in Context", final: 90, status: "Passed" },
    { subject: "General Mathematics", final: 87, status: "Passed" },
  ];

  const results = compareAcademicGrades(sf9Grades, sf10Grades);
  assert.equal(results.length, 2);
  assert.equal(results.every((r) => r.status === "MATCH"), true);
});

test("Test F — Academic discrepancy: At least one grade differs -> MISMATCH with exact field identified", () => {
  const sf9Grades = [
    { subject: "Oral Communication", final: 92, status: "Passed" },
    { subject: "General Mathematics", final: 85, status: "Passed" },
  ];

  const sf10Grades = [
    { subject: "Oral Communication", final: 88, status: "Passed" }, // Discrepancy!
    { subject: "General Mathematics", final: 85, status: "Passed" },
  ];

  const results = compareAcademicGrades(sf9Grades, sf10Grades);
  const oralResult = results.find((r) => r.subject === "Oral Communication");
  assert.equal(oralResult?.status, "MISMATCH");
  assert.equal(oralResult?.doc1Grade, 92);
  assert.equal(oralResult?.doc2Grade, 88);
  assert.match(oralResult?.details || "", /discrepancy/i);

  const mathResult = results.find((r) => r.subject === "General Mathematics");
  assert.equal(mathResult?.status, "MATCH");
});

test("Test G — Missing academic value: SF9 has grade, SF10 is blank -> NEEDS VERIFICATION (no invented value)", () => {
  const sf9Grades = [
    { subject: "Physical Education and Health 1", final: 91, status: "Passed" },
  ];

  const sf10Grades = [
    { subject: "Physical Education and Health 1", final: undefined, status: "Missing" },
  ];

  const results = compareAcademicGrades(sf9Grades, sf10Grades);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "NEEDS_VERIFICATION");
  assert.notEqual(results[0].status, "MISMATCH");
  assert.equal(results[0].doc1Grade, 91);
  assert.equal(results[0].doc2Grade, "-");
});

test("Test H — Different students: System blocks academic comparison when learners differ", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    grades: [{ subject: "Oral Communication", final: 90, status: "Passed" }],
  };

  const sf10 = {
    lrn: "999999999999",
    first_name: "ANA",
    last_name: "REYES",
    grades: [{ subject: "Oral Communication", final: 90, status: "Passed" }],
  };

  const comparison = compareDocuments(sf9, sf10);
  assert.equal(comparison.isSameLearner, false);
  assert.equal(comparison.overallStatus, "DISCREPANCIES_FOUND");
  // Academic grades must NOT be merged or compared as if belonging to the same learner
  assert.equal(comparison.academicResults.length, 0);
  assert.match(comparison.summaryMessage, /different learners|mismatch/i);
});

test("Test I — Observed Values and Grading Scale are rejected from academic comparison", () => {
  const sf9Grades = [
    { subject: "Report on Learner's Observed Values", final: "NO", status: "Passed" },
    { subject: "Core Values: Maka-Diyos", final: "AO", status: "Passed" },
    { subject: "Grading Scale: 90-100 Outstanding", final: "", status: "Passed" },
    { subject: "Oral Communication", final: 89, status: "Passed" },
  ];

  const sf10Grades = [
    { subject: "Oral Communication", final: 89, status: "Passed" },
  ];

  const results = compareAcademicGrades(sf9Grades, sf10Grades);
  assert.equal(results.length, 1);
  assert.equal(results[0].subject, "Oral Communication");
  assert.equal(results[0].status, "MATCH");
});

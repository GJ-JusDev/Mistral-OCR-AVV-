import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveStudentDirectoryItem,
  filterStudentDirectoryItems,
  getContextualGradeLevels,
  extractDistinctSections,
  extractDistinctSchoolYears,
  maskLrn,
  parseGradeNumber,
  deriveSchoolLevel,
  deriveReviewStatus,
  deriveValidationStatus,
} from "../src/lib/students/studentDirectory.ts";

test("AVV Student Directory Search, Filters & Status Distinction Suite", async (t) => {
  // Comprehensive mock student records representing various school levels, grades, sections, and statuses
  const mockStudents = [
    {
      id: "stud-001",
      lrn: "111687140043",
      first_name: "Justin",
      middle_name: "Loquillano",
      last_name: "Gomez",
      suffix: null,
      grade_level: "11",
      overall_status: "Failed", // Academic standing Failed
      status: "active",
      schools: { name: "DepEd Tambayan National High School" },
      documents: [
        {
          id: "doc-001",
          status: "approved", // Document Approved by Registrar!
          grade_level: "11",
          school_year: "2019-2020",
          source_form_version: "sf9_shs",
          shs_track: "STEM",
          extracted_fields: { section: "Rizal", school_year: "2019-2020" },
          created_at: "2026-10-22T23:00:00Z",
        },
      ],
    },
    {
      id: "stud-002",
      lrn: "109876543210",
      first_name: "Maria",
      middle_name: "Santos",
      last_name: "Dela Cruz",
      suffix: null,
      grade_level: "Grade 11",
      overall_status: "Passed", // Academic standing Passed
      status: "active",
      schools: { name: "DepEd Tambayan National High School" },
      documents: [
        {
          id: "doc-002",
          status: "approved",
          grade_level: "11",
          school_year: "2019-2020",
          source_form_version: "sf9_shs",
          shs_track: "ABM",
          extracted_fields: { section: "Mabini", school_year: "2019-2020" },
          created_at: "2026-10-22T23:05:00Z",
        },
      ],
    },
    {
      id: "stud-003",
      lrn: "123456789012",
      first_name: "Juan",
      middle_name: "Protacio",
      last_name: "Rizal",
      suffix: "Jr.",
      grade_level: "Grade 12",
      overall_status: "Passed",
      status: "active",
      schools: { name: "DepEd Tambayan National High School" },
      documents: [
        {
          id: "doc-003",
          status: "approved",
          grade_level: "12",
          school_year: "2020-2021",
          source_form_version: "sf9_shs",
          shs_track: "HUMSS",
          extracted_fields: { section: "Bonifacio", school_year: "2020-2021" },
          created_at: "2026-10-22T23:10:00Z",
        },
      ],
    },
    {
      id: "stud-004",
      lrn: "201234567890",
      first_name: "Andres",
      middle_name: "de Castro",
      last_name: "Bonifacio",
      suffix: null,
      grade_level: "Grade 8",
      overall_status: "Needs Verification",
      status: "active",
      schools: { name: "Manila Junior High School" },
      documents: [
        {
          id: "doc-004",
          status: "needs_review", // Pending Review
          grade_level: "8",
          school_year: "2021-2022",
          source_form_version: "sf9_jhs",
          extracted_fields: { section: "Aguinaldo", school_year: "2021-2022" },
          created_at: "2026-10-22T23:15:00Z",
        },
      ],
    },
    {
      id: "stud-005",
      lrn: "301234567890",
      first_name: "Gabriela",
      middle_name: "Cariño",
      last_name: "Silang",
      suffix: null,
      grade_level: "Grade 4",
      overall_status: "Passed",
      status: "active",
      schools: { name: "Ilocos Central Elementary School" },
      documents: [
        {
          id: "doc-005",
          status: "approved",
          grade_level: "4",
          school_year: "2021-2022",
          source_form_version: "sf9_elem",
          extracted_fields: { section: "Sampaguita", school_year: "2021-2022" },
          created_at: "2026-10-22T23:20:00Z",
        },
      ],
    },
    {
      id: "stud-006",
      lrn: "401234567890",
      first_name: "Emilio",
      middle_name: "Famy",
      last_name: "Aguinaldo",
      suffix: null,
      grade_level: "Grade 10",
      overall_status: "Failed",
      status: "active",
      schools: { name: "Cavite National High School" },
      documents: [
        {
          id: "doc-006",
          status: "rejected", // Rejected
          grade_level: "10",
          school_year: "2020-2021",
          source_form_version: "sf9_jhs",
          extracted_fields: { section: "Magdalo", school_year: "2020-2021" },
          created_at: "2026-10-22T23:25:00Z",
        },
      ],
    },
  ];

  const directoryItems = mockStudents.map(deriveStudentDirectoryItem);

  // -------------------------------------------------------------------------
  // Test A: Search by first name
  // -------------------------------------------------------------------------
  await t.test("Test A — Search by first name (case-insensitive)", () => {
    const results = filterStudentDirectoryItems(directoryItems, { query: "justin" });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].first_name, "Justin");
    assert.strictEqual(results[0].last_name, "Gomez");

    const mariaResults = filterStudentDirectoryItems(directoryItems, { query: "MARIA" });
    assert.strictEqual(mariaResults.length, 1);
    assert.strictEqual(mariaResults[0].first_name, "Maria");
  });

  // -------------------------------------------------------------------------
  // Test B: Search by last name
  // -------------------------------------------------------------------------
  await t.test("Test B — Search by last name (case-insensitive)", () => {
    const results = filterStudentDirectoryItems(directoryItems, { query: "gomez" });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].last_name, "Gomez");

    const silangResults = filterStudentDirectoryItems(directoryItems, { query: "silang" });
    assert.strictEqual(silangResults.length, 1);
    assert.strictEqual(silangResults[0].last_name, "Silang");
  });

  // -------------------------------------------------------------------------
  // Test C: Search by LRN
  // -------------------------------------------------------------------------
  await t.test("Test C — Search by full or partial LRN", () => {
    // Full LRN search
    const results = filterStudentDirectoryItems(directoryItems, { query: "111687140043" });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].lrn, "111687140043");

    // Partial LRN search
    const partialResults = filterStudentDirectoryItems(directoryItems, { query: "0043" });
    assert.strictEqual(partialResults.length, 1);
    assert.strictEqual(partialResults[0].lrn, "111687140043");
  });

  // -------------------------------------------------------------------------
  // Test D: Elementary filter
  // -------------------------------------------------------------------------
  await t.test("Test D — Elementary school level filter returns only elementary records", () => {
    const results = filterStudentDirectoryItems(directoryItems, { school_level: "Elementary" });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].first_name, "Gabriela");
    assert.strictEqual(results[0].school_level, "Elementary");
    assert.strictEqual(results[0].grade_level, "Grade 4");
  });

  // -------------------------------------------------------------------------
  // Test E: Junior High School filter
  // -------------------------------------------------------------------------
  await t.test("Test E — Junior High School level filter returns Grades 7–10", () => {
    const results = filterStudentDirectoryItems(directoryItems, { school_level: "Junior High School" });
    assert.strictEqual(results.length, 2);
    const names = results.map((r) => r.last_name).sort();
    assert.deepStrictEqual(names, ["Aguinaldo", "Bonifacio"]);
    for (const r of results) {
      assert.strictEqual(r.school_level, "Junior High School");
    }
  });

  // -------------------------------------------------------------------------
  // Test F: Senior High School filter
  // -------------------------------------------------------------------------
  await t.test("Test F — Senior High School level filter returns Grades 11–12", () => {
    const results = filterStudentDirectoryItems(directoryItems, { school_level: "Senior High School" });
    assert.strictEqual(results.length, 3);
    const names = results.map((r) => r.last_name).sort();
    assert.deepStrictEqual(names, ["Dela Cruz", "Gomez", "Rizal"]);
    for (const r of results) {
      assert.strictEqual(r.school_level, "Senior High School");
    }
  });

  // -------------------------------------------------------------------------
  // Test G: Grade-level filter
  // -------------------------------------------------------------------------
  await t.test("Test G — Grade-level filter matches specified grade number or string", () => {
    const g11Results = filterStudentDirectoryItems(directoryItems, { grade_level: "Grade 11" });
    assert.strictEqual(g11Results.length, 2);
    for (const r of g11Results) {
      assert.strictEqual(r.normalized_grade, 11);
    }

    const g12Results = filterStudentDirectoryItems(directoryItems, { grade_level: "Grade 12" });
    assert.strictEqual(g12Results.length, 1);
    assert.strictEqual(g12Results[0].last_name, "Rizal");

    const g8Results = filterStudentDirectoryItems(directoryItems, { grade_level: "Grade 8" });
    assert.strictEqual(g8Results.length, 1);
    assert.strictEqual(g8Results[0].last_name, "Bonifacio");
  });

  // -------------------------------------------------------------------------
  // Test H: Section filter
  // -------------------------------------------------------------------------
  await t.test("Test H — Section filter narrows to students in that section", () => {
    const rizalSec = filterStudentDirectoryItems(directoryItems, { section: "Rizal" });
    assert.strictEqual(rizalSec.length, 1);
    assert.strictEqual(rizalSec[0].last_name, "Gomez");
    assert.strictEqual(rizalSec[0].section, "Rizal");

    const mabiniSec = filterStudentDirectoryItems(directoryItems, { section: "Mabini" });
    assert.strictEqual(mabiniSec.length, 1);
    assert.strictEqual(mabiniSec[0].last_name, "Dela Cruz");
    assert.strictEqual(mabiniSec[0].section, "Mabini");
  });

  // -------------------------------------------------------------------------
  // Test I: Review status filter
  // -------------------------------------------------------------------------
  await t.test("Test I — Review status filter isolates Approved, Pending Review, and Rejected", () => {
    const approved = filterStudentDirectoryItems(directoryItems, { review_status: "Approved" });
    assert.strictEqual(approved.length, 4);
    for (const r of approved) {
      assert.strictEqual(r.review_status, "Approved");
    }

    const pending = filterStudentDirectoryItems(directoryItems, { review_status: "Pending Review" });
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].last_name, "Bonifacio");
    assert.strictEqual(pending[0].review_status, "Pending Review");

    const rejected = filterStudentDirectoryItems(directoryItems, { review_status: "Rejected" });
    assert.strictEqual(rejected.length, 1);
    assert.strictEqual(rejected[0].last_name, "Aguinaldo");
    assert.strictEqual(rejected[0].review_status, "Rejected");
  });

  // -------------------------------------------------------------------------
  // Test J: Validation status filter
  // -------------------------------------------------------------------------
  await t.test("Test J — Validation status filter isolates Passed, Failed, and Needs Verification", () => {
    const passed = filterStudentDirectoryItems(directoryItems, { validation_status: "Passed" });
    assert.strictEqual(passed.length, 3);
    for (const r of passed) {
      assert.strictEqual(r.validation_status, "Passed");
    }

    const failed = filterStudentDirectoryItems(directoryItems, { validation_status: "Failed" });
    assert.strictEqual(failed.length, 2);
    const failedNames = failed.map((f) => f.last_name).sort();
    assert.deepStrictEqual(failedNames, ["Aguinaldo", "Gomez"]);

    const needsVerification = filterStudentDirectoryItems(directoryItems, { validation_status: "Needs Verification" });
    assert.strictEqual(needsVerification.length, 1);
    assert.strictEqual(needsVerification[0].last_name, "Bonifacio");
  });

  // -------------------------------------------------------------------------
  // Test K: Combined filters
  // Example: SHS + Grade 11 + Section Rizal + Failed
  // -------------------------------------------------------------------------
  await t.test("Test K — Combined filters (AND combination)", () => {
    const combined = filterStudentDirectoryItems(directoryItems, {
      school_level: "Senior High School",
      grade_level: "Grade 11",
      section: "Rizal",
      validation_status: "Failed",
    });

    assert.strictEqual(combined.length, 1);
    assert.strictEqual(combined[0].last_name, "Gomez");
    assert.strictEqual(combined[0].first_name, "Justin");
    assert.strictEqual(combined[0].grade_level, "Grade 11");
    assert.strictEqual(combined[0].section, "Rizal");
    assert.strictEqual(combined[0].validation_status, "Failed");
    assert.strictEqual(combined[0].review_status, "Approved");
  });

  // -------------------------------------------------------------------------
  // Test L: Clear filters
  // -------------------------------------------------------------------------
  await t.test("Test L — Clear filters restores full directory list", () => {
    const emptyFilters = {
      query: "",
      school_level: "All",
      grade_level: "All",
      section: "All",
      review_status: "All",
      validation_status: "All",
      school_year: "All",
    };
    const results = filterStudentDirectoryItems(directoryItems, emptyFilters);
    assert.strictEqual(results.length, directoryItems.length);
  });

  // -------------------------------------------------------------------------
  // Test M: Empty filtered result
  // -------------------------------------------------------------------------
  await t.test("Test M — Unmatched filter combination yields clean empty array", () => {
    const results = filterStudentDirectoryItems(directoryItems, {
      school_level: "Elementary",
      grade_level: "Grade 11", // Impossible combination
    });
    assert.strictEqual(results.length, 0);

    const noNameResults = filterStudentDirectoryItems(directoryItems, {
      query: "NonexistentName12345",
    });
    assert.strictEqual(noNameResults.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test N: Review Approved + Validation Failed independence
  // -------------------------------------------------------------------------
  await t.test("Test N — Review Approved + Validation Failed independence (Approved does NOT imply Passed)", () => {
    const justin = directoryItems.find((s) => s.last_name === "Gomez");
    assert.ok(justin, "Gomez record must exist");

    // Human document verification status:
    assert.strictEqual(justin.review_status, "Approved", "Human document verification must be Approved");

    // DepEd academic validation status:
    assert.strictEqual(justin.validation_status, "Failed", "Academic validation standing must be Failed");

    // They must NOT mutate each other
    assert.notStrictEqual(justin.review_status, justin.validation_status);
  });

  // -------------------------------------------------------------------------
  // Test O: LRN Privacy Masking
  // -------------------------------------------------------------------------
  await t.test("Test O — LRN Privacy masking protects first 8 digits", () => {
    const masked = maskLrn("111687140043");
    assert.strictEqual(masked, "********0043");

    const justin = directoryItems.find((s) => s.lrn === "111687140043");
    assert.strictEqual(justin.masked_lrn, "********0043");
    assert.strictEqual(justin.lrn, "111687140043");
  });

  // -------------------------------------------------------------------------
  // Test P: Contextual Grade Level narrowing
  // -------------------------------------------------------------------------
  await t.test("Test P — Contextual Grade Level options narrow according to School Level", () => {
    const elemGrades = getContextualGradeLevels("Elementary");
    assert.deepStrictEqual(elemGrades, ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"]);

    const jhsGrades = getContextualGradeLevels("Junior High School");
    assert.deepStrictEqual(jhsGrades, ["Grade 7", "Grade 8", "Grade 9", "Grade 10"]);

    const shsGrades = getContextualGradeLevels("Senior High School");
    assert.deepStrictEqual(shsGrades, ["Grade 11", "Grade 12"]);

    const allGrades = getContextualGradeLevels("All");
    assert.strictEqual(allGrades.length, 12);
  });

  // -------------------------------------------------------------------------
  // Test Q: Dynamic Section Extraction
  // -------------------------------------------------------------------------
  await t.test("Test Q — Dynamic section choices extracted from actual records without hardcoding", () => {
    const allSections = extractDistinctSections(directoryItems);
    assert.deepStrictEqual(allSections, ["Aguinaldo", "Bonifacio", "Mabini", "Magdalo", "Rizal", "Sampaguita"]);

    // Contextually narrowed to SHS
    const shsSections = extractDistinctSections(directoryItems, "Senior High School");
    assert.deepStrictEqual(shsSections, ["Bonifacio", "Mabini", "Rizal"]);

    // Contextually narrowed to Elementary
    const elemSections = extractDistinctSections(directoryItems, "Elementary");
    assert.deepStrictEqual(elemSections, ["Sampaguita"]);
  });

  // -------------------------------------------------------------------------
  // Test R: Dynamic School Year Extraction
  // -------------------------------------------------------------------------
  await t.test("Test R — Dynamic school years extracted and sorted descending", () => {
    const schoolYears = extractDistinctSchoolYears(directoryItems);
    assert.deepStrictEqual(schoolYears, ["2021-2022", "2020-2021", "2019-2020"]);
  });
});

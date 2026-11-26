import test from "node:test";
import assert from "node:assert/strict";

import { parseShsSf1 } from "../src/lib/ocr/shsSf1Parser.ts";
import { evaluateBatchCrossDocumentValidation } from "../src/lib/validation/batchCrossDocumentValidator.ts";
import {
  resolveDocumentStudentNameDisplay,
  isBlacklistedStudentName,
  BLACKLISTED_STUDENT_NAMES,
} from "../src/lib/validation/nameComparison.ts";
import {
  compareSf1AndSf9,
  comparePsaAndSf1,
} from "../src/lib/validation/crossDocumentEngine.ts";

test("SF1 Column-Row Extraction, 'No Student Found' Guard & Cross-Doc Comparison Suite", async (t) => {
  // ===========================================================================
  // 1. Multi-Row SF1 Extraction: ONLY (LRN, Full Name, Sex, Birth Date)
  // ===========================================================================
  await t.test("1. Multi-row SF1 table extraction extracts strictly (LRN, Full Name, Sex, Birth Date)", () => {
    // Simulated Azure AI Document Intelligence layout table
    const mockAzureTable = {
      tables: [
        {
          rowCount: 4,
          columnCount: 6,
          cells: [
            // Row 0: Table Header Row
            { rowIndex: 0, columnIndex: 0, content: "LRN" },
            { rowIndex: 0, columnIndex: 1, content: "NAME (Last Name, First Name, Middle Name)" },
            { rowIndex: 0, columnIndex: 2, content: "Sex (M/F)" },
            { rowIndex: 0, columnIndex: 3, content: "BIRTH DATE (mm/dd/yyyy)" },
            { rowIndex: 0, columnIndex: 4, content: "AGE" },
            { rowIndex: 0, columnIndex: 5, content: "REMARKS" },
            // Row 1: Student 1
            { rowIndex: 1, columnIndex: 0, content: "109320150001" },
            { rowIndex: 1, columnIndex: 1, content: "DELA CRUZ, JUAN SANTOS" },
            { rowIndex: 1, columnIndex: 2, content: "M" },
            { rowIndex: 1, columnIndex: 3, content: "10/15/2006" },
            { rowIndex: 1, columnIndex: 4, content: "17" },
            { rowIndex: 1, columnIndex: 5, content: "Transferred in" },
            // Row 2: Student 2
            { rowIndex: 2, columnIndex: 0, content: "109320150002" },
            { rowIndex: 2, columnIndex: 1, content: "SANTOS, MARIA CLARA" },
            { rowIndex: 2, columnIndex: 2, content: "F" },
            { rowIndex: 2, columnIndex: 3, content: "05/20/2007" },
            { rowIndex: 2, columnIndex: 4, content: "16" },
            { rowIndex: 2, columnIndex: 5, content: "" },
            // Row 3: Empty grid line (both LRN and NAME cells are blank)
            { rowIndex: 3, columnIndex: 0, content: "" },
            { rowIndex: 3, columnIndex: 1, content: "   " },
            { rowIndex: 3, columnIndex: 2, content: "" },
            { rowIndex: 3, columnIndex: 3, content: "" },
            { rowIndex: 3, columnIndex: 4, content: "" },
            { rowIndex: 3, columnIndex: 5, content: "" },
          ],
        },
      ],
    };

    const rawText = `
School ID: 500169  School Name: TRIS  Grade Level: Grade 11  Section: St. Therese
Track: Academic Track  Strand: STEM  Semester: 1st Semester  School Year: 2024-2025
`;

    const result = parseShsSf1(rawText, mockAzureTable);

    assert.equal(result.no_student_found, false, "Should find students");
    assert.equal(result.learners.length, 2, "Should extract exactly 2 populated student rows, ignoring blank grid line");

    // Student 1 verification
    const s1 = result.learners[0];
    assert.equal(s1.lrn, "109320150001");
    assert.equal(s1.last_name, "Dela Cruz");
    assert.equal(s1.first_name, "Juan");
    assert.equal(s1.middle_name, "Santos");
    assert.equal(s1.full_name, "Dela Cruz, Juan Santos");
    assert.equal(s1.sex, "M");
    assert.equal(s1.birth_date, "2006-10-15");

    // Student 2 verification
    const s2 = result.learners[1];
    assert.equal(s2.lrn, "109320150002");
    assert.equal(s2.last_name, "Santos");
    assert.equal(s2.first_name, "Maria");
    assert.equal(s2.middle_name, "Clara");
    assert.equal(s2.full_name, "Santos, Maria Clara");
    assert.equal(s2.sex, "F");
    assert.equal(s2.birth_date, "2007-05-20");
  });

  await t.test("1b. Multi-row SF1 markdown text fallback extracts strictly (LRN, Full Name, Sex, Birth Date)", () => {
    const rawMarkdownText = `
School ID: 500169  School Name: TRIS  Grade Level: Grade 12  Section: STEM-A
Track: Academic Track  Strand: STEM  Semester: 2nd Semester  School Year: 2024-2025

| LRN | NAME (Last Name, First Name, Middle Name) | Sex (M/F) | BIRTH DATE (mm/dd/yyyy) |
| --- | --- | --- | --- |
| 109320150003 | GOMEZ, JUSTIN LOQUILLANO | M | 08/24/2006 |
| 109320150004 | REYES, ANNA BEATRIZ | F | 01/12/2007 |
| | | | |
`;

    const result = parseShsSf1(rawMarkdownText);

    assert.equal(result.no_student_found, false);
    assert.equal(result.learners.length, 2, "Should ignore empty grid row");

    assert.equal(result.learners[0].lrn, "109320150003");
    assert.equal(result.learners[0].last_name, "Gomez");
    assert.equal(result.learners[0].first_name, "Justin");
    assert.equal(result.learners[0].middle_name, "Loquillano");
    assert.equal(result.learners[0].sex, "M");
    assert.equal(result.learners[0].birth_date, "2006-08-24");

    assert.equal(result.learners[1].lrn, "109320150004");
    assert.equal(result.learners[1].last_name, "Reyes");
    assert.equal(result.learners[1].first_name, "Anna");
    assert.equal(result.learners[1].middle_name, "Beatriz");
    assert.equal(result.learners[1].sex, "F");
    assert.equal(result.learners[1].birth_date, "2007-01-12");
  });

  // ===========================================================================
  // 1c. Single-Student (1+ Learner) Extraction Across PDF & Image Uploads
  // ===========================================================================
  await t.test("1c. Single-student (1 row only) SF1 via Azure table -> extracts 1 learner with no_student_found: false", () => {
    const singleStudentAzureTable = {
      tables: [
        {
          rowCount: 2,
          columnCount: 4,
          cells: [
            // Header
            { rowIndex: 0, columnIndex: 0, content: "LRN" },
            { rowIndex: 0, columnIndex: 1, content: "NAME (Last Name, First Name, Middle Name)" },
            { rowIndex: 0, columnIndex: 2, content: "Sex (M/F)" },
            { rowIndex: 0, columnIndex: 3, content: "BIRTH DATE" },
            // Only 1 Student Row
            { rowIndex: 1, columnIndex: 0, content: "111500619123" },
            { rowIndex: 1, columnIndex: 1, content: "Gomez, Justin Loquillano" },
            { rowIndex: 1, columnIndex: 2, content: "M" },
            { rowIndex: 1, columnIndex: 3, content: "6/23/04" },
          ],
        },
      ],
    };

    const rawText = "School ID: 500169 Grade Level: Grade 11 Section: Rizal";
    const res = parseShsSf1(rawText, singleStudentAzureTable);

    assert.equal(res.no_student_found, false, "Must be false when 1 student row is found");
    assert.equal(res.error, undefined, "error must be undefined when learners exist");
    assert.equal(res.learners.length, 1, "Must extract exactly 1 learner");
    const l = res.learners[0];
    assert.equal(l.lrn, "111500619123");
    assert.equal(l.last_name, "Gomez");
    assert.equal(l.first_name, "Justin");
    assert.equal(l.middle_name, "Loquillano");
    assert.equal(l.full_name, "Gomez, Justin Loquillano");
    assert.equal(l.sex, "M");
    assert.ok(l.birth_date === "2004-06-23" || l.birth_date === "6/23/04");
  });

  await t.test("1d. Single-student (1 row only) SF1 via markdown pipe row -> extracts 1 learner with no_student_found: false", () => {
    const markdownPipeText = `
School ID: 500169 Grade Level: Grade 11 Section: Rizal School Year: 2024-2025
| 111500619123 | Gomez, Justin Loquillano | M | 6/23/04 |
`;
    const res = parseShsSf1(markdownPipeText);

    assert.equal(res.no_student_found, false);
    assert.equal(res.error, undefined);
    assert.equal(res.learners.length, 1);
    const l = res.learners[0];
    assert.equal(l.lrn, "111500619123");
    assert.equal(l.last_name, "Gomez");
    assert.equal(l.first_name, "Justin");
    assert.equal(l.middle_name, "Loquillano");
    assert.equal(l.full_name, "Gomez, Justin Loquillano");
    assert.equal(l.sex, "M");
    assert.ok(l.birth_date === "2004-06-23" || l.birth_date === "6/23/04");
  });

  await t.test("1e. Single-student (1 row only) SF1 via plain PDF text line -> extracts 1 learner with no_student_found: false", () => {
    const plainText = `
Department of Education
School ID: 500169 School Name: TRIS Grade 11 - Diamond SY 2024-2025
111500619123 Gomez, Justin Loquillano M 6/23/04
`;
    const res = parseShsSf1(plainText);

    assert.equal(res.no_student_found, false);
    assert.equal(res.error, undefined);
    assert.equal(res.learners.length, 1);
    const l = res.learners[0];
    assert.equal(l.lrn, "111500619123");
    assert.equal(l.last_name, "Gomez");
    assert.equal(l.first_name, "Justin");
    assert.equal(l.middle_name, "Loquillano");
    assert.equal(l.full_name, "Gomez, Justin Loquillano");
    assert.equal(l.sex, "M");
    assert.ok(l.birth_date === "2004-06-23" || l.birth_date === "6/23/04");
  });

  await t.test("1f. 3-page SF1 PDF where Page 1 has 1 student and Pages 2-3 are blank -> preserves 1 student with no_student_found: false", () => {
    // Simulating 3-page School-Forms-1 named.pdf with Azure Layout tables across pages
    const multiPageAzureLayout = {
      pages: [
        {
          pageNumber: 1,
          tables: [
            {
              _pageNumber: 1,
              cells: [
                { rowIndex: 0, columnIndex: 0, content: "LRN" },
                { rowIndex: 0, columnIndex: 1, content: "NAME" },
                { rowIndex: 0, columnIndex: 2, content: "Sex" },
                { rowIndex: 0, columnIndex: 3, content: "BIRTH DATE" },
                { rowIndex: 1, columnIndex: 0, content: "111500619123" },
                { rowIndex: 1, columnIndex: 1, content: "Gomez, Justin Loquillano" },
                { rowIndex: 1, columnIndex: 2, content: "M" },
                { rowIndex: 1, columnIndex: 3, content: "6/23/04" },
              ],
            },
          ],
        },
        {
          pageNumber: 2,
          tables: [
            {
              _pageNumber: 2,
              cells: [
                { rowIndex: 0, columnIndex: 0, content: "LRN" },
                { rowIndex: 0, columnIndex: 1, content: "NAME" },
                { rowIndex: 0, columnIndex: 2, content: "Sex" },
                { rowIndex: 0, columnIndex: 3, content: "BIRTH DATE" },
                // Blank grid rows on Page 2
                { rowIndex: 1, columnIndex: 0, content: "" },
                { rowIndex: 1, columnIndex: 1, content: "" },
                { rowIndex: 1, columnIndex: 2, content: "" },
                { rowIndex: 1, columnIndex: 3, content: "" },
              ],
            },
          ],
        },
        {
          pageNumber: 3,
          tables: [
            {
              _pageNumber: 3,
              cells: [
                { rowIndex: 0, columnIndex: 0, content: "LRN" },
                { rowIndex: 0, columnIndex: 1, content: "NAME" },
                { rowIndex: 0, columnIndex: 2, content: "Sex" },
                { rowIndex: 0, columnIndex: 3, content: "BIRTH DATE" },
                // Blank grid rows on Page 3
                { rowIndex: 1, columnIndex: 0, content: "" },
                { rowIndex: 1, columnIndex: 1, content: "" },
                { rowIndex: 1, columnIndex: 2, content: "" },
                { rowIndex: 1, columnIndex: 3, content: "" },
              ],
            },
          ],
        },
      ],
    };

    const multiPageText = `
Page 1 of 3
School ID: 500169 Grade Level: Grade 11 Section: Diamond
111500619123 Gomez, Justin Loquillano M 6/23/04

Page 2 of 3
School ID: 500169 Grade Level: Grade 11 Section: Diamond

Page 3 of 3
School ID: 500169 Grade Level: Grade 11 Section: Diamond
`;

    const res = parseShsSf1(multiPageText, multiPageAzureLayout);

    assert.equal(res.no_student_found, false, "Must preserve the single student from Page 1");
    assert.equal(res.error, undefined);
    assert.equal(res.learners.length, 1, "Must not be overwritten by blank Pages 2 and 3");
    assert.equal(res.learners[0].lrn, "111500619123");
    assert.equal(res.learners[0].full_name, "Gomez, Justin Loquillano");
    assert.equal(res.learners[0].sex, "M");
    assert.ok(res.learners[0].birth_date === "2004-06-23" || res.learners[0].birth_date === "6/23/04");
  });

  // ===========================================================================
  // 2. Empty Roster Detection ("No student found") Guard
  // ===========================================================================
  await t.test("2. Empty SF1 roster triggers no_student_found in extraction, batch validation, and /documents", () => {
    // 2a. Parser extraction guard with empty table rows
    const emptyAzureTable = {
      tables: [
        {
          rowCount: 3,
          columnCount: 4,
          cells: [
            { rowIndex: 0, columnIndex: 0, content: "LRN" },
            { rowIndex: 0, columnIndex: 1, content: "NAME (Last Name, First Name, Middle Name)" },
            { rowIndex: 0, columnIndex: 2, content: "Sex (M/F)" },
            { rowIndex: 0, columnIndex: 3, content: "BIRTH DATE" },
            // Blank rows
            { rowIndex: 1, columnIndex: 0, content: "" },
            { rowIndex: 1, columnIndex: 1, content: "" },
            { rowIndex: 1, columnIndex: 2, content: "" },
            { rowIndex: 1, columnIndex: 3, content: "" },
            { rowIndex: 2, columnIndex: 0, content: "   " },
            { rowIndex: 2, columnIndex: 1, content: "   " },
            { rowIndex: 2, columnIndex: 2, content: "" },
            { rowIndex: 2, columnIndex: 3, content: "" },
          ],
        },
      ],
    };

    const emptyParseResult = parseShsSf1("School ID: 500169 Grade Level: Grade 11 Section: St. Therese", emptyAzureTable);
    assert.equal(emptyParseResult.no_student_found, true, "no_student_found flag must be true");
    assert.equal(emptyParseResult.error, "No student found", "error message must be 'No student found'");
    assert.equal(emptyParseResult.learners.length, 0);

    // 2b. Batch Cross-Document Validator guard
    const emptySf1Segment = {
      id: "seg-sf1-empty",
      documentType: "sf1",
      pageNumbers: [1],
      sourceFileName: "SF1_Blank_Roster.pdf",
      formTitle: "SF1-SHS",
      confidence: 0.95,
      needsClassification: false,
      reasons: [],
      pages: [],
      startPage: 1,
      endPage: 1,
      pageCount: 1,
    };

    const batchRes = evaluateBatchCrossDocumentValidation({
      segments: [emptySf1Segment],
      extractedSegmentData: {
        "seg-sf1-empty": {
          school_id: "500169",
          school_year: "2024-2025",
          grade_level: "Grade 11",
          section: "St. Therese",
          learners: [],
          no_student_found: true,
          error: "No student found",
        },
      },
    });

    const hasNoStudentDiscrepancy = (batchRes.categorizedResults?.incompleteData || []).some(
      (d) => d.field === "School Register (SF1-SHS) Roster" || d.reason.includes("No student found")
    );
    assert.equal(hasNoStudentDiscrepancy, true, "Batch validator must explicitly report 'No student found'");

    // 2c. /documents table name display guard
    const docWithEmptyRoster = {
      document_type: "sf1",
      extracted_fields: {
        learners: [],
        no_student_found: true,
      },
    };
    const displayName = resolveDocumentStudentNameDisplay(docWithEmptyRoster);
    assert.equal(displayName, "No student found", "Documents table must display 'No student found'");
  });

  // ===========================================================================
  // 3. Pairwise Cross-Document Comparison: SF1 vs SF9 and SF1 vs PSA
  // ===========================================================================
  await t.test("3a. SF1 vs SF9 compares LRN, Student Name, and Sex (Match and Mismatch)", () => {
    const sf1Learner = {
      lrn: "109320150001",
      last_name: "DELA CRUZ",
      first_name: "JUAN",
      middle_name: "SANTOS",
      sex: "M",
      birth_date: "10/15/2006",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "St. Therese",
      strand: "STEM",
    };

    // 1. Perfect Match SF9
    const sf9Matching = {
      document_id: "doc-sf9",
      lrn: "109320150001",
      last_name: "DELA CRUZ",
      first_name: "JUAN",
      sex: "M",
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "St. Therese",
      strand: "STEM",
    };

    const matchRes = compareSf1AndSf9(sf1Learner, sf9Matching);
    assert.equal(matchRes.discrepancies.length, 0, "Matching SF1 and SF9 should have 0 discrepancies");
    assert.equal(matchRes.status, "MATCH");

    // 2. Sex Mismatch
    const sf9SexMismatch = {
      ...sf9Matching,
      sex: "F",
    };
    const sexMismatchRes = compareSf1AndSf9(sf1Learner, sf9SexMismatch);
    const sexDisc = sexMismatchRes.discrepancies.find((d) => d.field === "sex");
    assert.ok(sexDisc, "Should detect sex mismatch between SF1 and SF9");
    assert.equal(sexDisc.severity, "CRITICAL");

    // 3. Name Mismatch
    const sf9NameMismatch = {
      ...sf9Matching,
      last_name: "SANTOS",
    };
    const nameMismatchRes = compareSf1AndSf9(sf1Learner, sf9NameMismatch);
    const nameDisc = nameMismatchRes.discrepancies.find((d) => d.field === "last_name");
    assert.ok(nameDisc, "Should detect name mismatch between SF1 and SF9");
    assert.equal(nameDisc.severity, "CRITICAL");

    // 4. LRN Mismatch
    const sf9LrnMismatch = {
      ...sf9Matching,
      lrn: "109320150099",
    };
    const lrnMismatchRes = compareSf1AndSf9(sf1Learner, sf9LrnMismatch);
    const lrnDisc = lrnMismatchRes.discrepancies.find((d) => d.field === "lrn");
    assert.ok(lrnDisc, "Should detect LRN mismatch between SF1 and SF9");
    assert.equal(lrnDisc.severity, "CRITICAL");
  });

  await t.test("3b. PSA vs SF1 compares Student Name, Sex, and Birth Date (No LRN on PSA)", () => {
    const sf1Learner = {
      lrn: "109320150001",
      last_name: "DELA CRUZ",
      first_name: "JUAN",
      middle_name: "SANTOS",
      sex: "Male",
      birth_date: "2006-10-15",
    };

    // 1. Perfect Match PSA (Note: PSA has civil registry fields, NO LRN)
    const psaMatching = {
      last_name: "DELA CRUZ",
      first_name: "JUAN",
      middle_name: "SANTOS",
      sex: "Male",
      date_of_birth: "2006-10-15",
      certificate_number: "2006-12345",
    };

    const matchRes = comparePsaAndSf1(psaMatching, sf1Learner);
    assert.equal(matchRes.discrepancies.length, 0, "Matching PSA and SF1 should have 0 discrepancies");
    assert.equal(matchRes.status, "MATCH");

    // 2. Birth Date Mismatch
    const psaBirthDateMismatch = {
      ...psaMatching,
      date_of_birth: "2006-11-20",
    };
    const dobMismatchRes = comparePsaAndSf1(psaBirthDateMismatch, sf1Learner);
    const dobDisc = dobMismatchRes.discrepancies.find((d) => d.field === "date_of_birth" || d.field === "birth_date");
    assert.ok(dobDisc, "Should detect birth date mismatch between PSA and SF1");
    assert.equal(dobDisc.severity, "CRITICAL");

    // 3. Sex Mismatch
    const psaSexMismatch = {
      ...psaMatching,
      sex: "Female",
    };
    const sexMismatchRes = comparePsaAndSf1(psaSexMismatch, sf1Learner);
    const sexDisc = sexMismatchRes.discrepancies.find((d) => d.field === "sex");
    assert.ok(sexDisc, "Should detect sex mismatch between PSA and SF1");
    assert.equal(sexDisc.severity, "CRITICAL");
  });

  // ===========================================================================
  // 4. /documents Table Name Formatting & Rejection of "LEARNER'S" Tokens
  // ===========================================================================
  await t.test("4a. /documents table displays actual student names for 1 and multiple learners", () => {
    // Single learner SF1
    const singleLearnerDoc = {
      document_type: "sf1",
      extracted_fields: {
        learners: [
          {
            lrn: "109320150001",
            last_name: "Gomez",
            first_name: "Justin",
            middle_name: "Loquillano",
            sex: "M",
            birth_date: "08/24/2006",
          },
        ],
      },
    };
    const singleName = resolveDocumentStudentNameDisplay(singleLearnerDoc);
    assert.equal(singleName, "Gomez, Justin Loquillano", "Should render single learner's formatted name");

    // Multiple learners SF1
    const multiLearnerDoc = {
      document_type: "sf1",
      extracted_fields: {
        learners: [
          {
            lrn: "109320150001",
            last_name: "Gomez",
            first_name: "Justin",
            middle_name: "Loquillano",
          },
          {
            lrn: "109320150002",
            last_name: "Santos",
            first_name: "Maria",
          },
          {
            lrn: "109320150003",
            last_name: "Reyes",
            first_name: "Juan",
          },
        ],
      },
    };
    const multiName = resolveDocumentStudentNameDisplay(multiLearnerDoc);
    assert.equal(multiName, "Gomez, Justin Loquillano (+2 more)", "Should render '<First Student> (+<N-1> more)'");
  });

  await t.test("4b. Rejection of 'LEARNER'S', 'LEARNERS', and 'LEARNER' tokens in student name display", () => {
    // Verify blacklist contains the required tokens
    assert.ok(BLACKLISTED_STUDENT_NAMES.includes("learner's"), "Must include learner's in blacklist");
    assert.ok(BLACKLISTED_STUDENT_NAMES.includes("learners"), "Must include learners in blacklist");
    assert.ok(BLACKLISTED_STUDENT_NAMES.includes("learner"), "Must include learner in blacklist");

    assert.equal(isBlacklistedStudentName("LEARNER'S"), true);
    assert.equal(isBlacklistedStudentName("Learners"), true);
    assert.equal(isBlacklistedStudentName("LEARNER"), true);
    assert.equal(isBlacklistedStudentName("LEARNER'S INFORMATION"), true);

    // SF1 doc where OCR mistakenly set last_name to "LEARNER'S"
    const docWithBlacklistedName = {
      document_type: "sf1",
      extracted_fields: {
        learners: [
          {
            lrn: "109320150001",
            last_name: "LEARNER'S",
            first_name: "",
            middle_name: "",
          },
        ],
      },
    };

    const rendered = resolveDocumentStudentNameDisplay(docWithBlacklistedName);
    assert.notEqual(
      rendered,
      "Incomplete Name (LEARNER'S — Needs Review)",
      "Must NEVER render 'LEARNER'S' as an incomplete student name"
    );
    assert.equal(rendered, "Unnamed Student", "Blacklisted token should fall back safely to Unnamed Student");

    // SF10 or generic doc with "LEARNER'S" as single token
    const genericDoc = {
      document_type: "sf10",
      extracted_fields: {
        student_name: "LEARNER'S",
      },
    };
    const renderedGeneric = resolveDocumentStudentNameDisplay(genericDoc);
    assert.notEqual(renderedGeneric, "Incomplete Name (LEARNER'S — Needs Review)");
    assert.equal(renderedGeneric, "-");
  });
});

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { isBlacklistedStudentName, resolveDocumentStudentNameDisplay } from "../src/lib/validation/nameComparison.ts";
import { extractSf10LearnerIdentity, parseOcrText } from "../src/lib/ocr/parser.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";

describe("SF10/SF9 Student Name Sanitization and /documents Table Display Suite", () => {
  test("1. isBlacklistedStudentName rejects all DepEd form headers and placeholder strings", () => {
    const headersToReject = [
      "INFORMATION",
      "information",
      "LEARNER'S INFORMATION",
      "Learner's Information",
      "LEARNERS INFORMATION",
      "learners information",
      "SCHOLASTIC RECORD",
      "Scholastic Record",
      "REPUBLIC OF THE PHILIPPINES",
      "Republic of the Philippines",
      "DEPARTMENT OF EDUCATION",
      "Department of Education",
      "SENIOR HIGH SCHOOL",
      "Senior High School",
      "SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD",
      "UNKNOWN",
      "unknown",
      "DEPED",
      "UNASSIGNED",
      "NOT FOUND",
      "SF10-SHS",
      "SF9-SHS",
    ];

    for (const header of headersToReject) {
      assert.strictEqual(
        isBlacklistedStudentName(header),
        true,
        `Expected header "${header}" to be rejected by isBlacklistedStudentName`
      );
    }

    // Valid student names must NOT be rejected
    const validNames = [
      "GOMEZ",
      "JUSTIN",
      "LOQUILLANO",
      "Gomez, Justin Loquillano",
      "DELA CRUZ, JUAN MIGUEL",
      "Santos, Maria Clara",
    ];

    for (const name of validNames) {
      assert.strictEqual(
        isBlacklistedStudentName(name),
        false,
        `Expected valid name "${name}" to be accepted by isBlacklistedStudentName`
      );
    }
  });

  test("2. extractSf10LearnerIdentity extracts actual student name below LEARNER'S INFORMATION heading", () => {
    // 2a. Inline key-value format
    const sampleText1 = `
      REPUBLIC OF THE PHILIPPINES
      DEPARTMENT OF EDUCATION
      SENIOR HIGH SCHOOL STUDENT PERMANENT RECORD (SF10-SHS)

      LEARNER'S INFORMATION
      LAST NAME: GOMEZ       FIRST NAME: JUSTIN       MIDDLE NAME: LOQUILLANO
      LRN: 109328120034      Birth Date: 2005-08-14   Sex: Male
    `;

    const identity1 = extractSf10LearnerIdentity(sampleText1);
    assert.ok(identity1, "Should successfully extract identity from SF10 sample 1");
    assert.strictEqual(identity1.last_name, "GOMEZ");
    assert.strictEqual(identity1.first_name, "JUSTIN");
    assert.strictEqual(identity1.middle_name, "LOQUILLANO");
    assert.strictEqual(identity1.fullName, "GOMEZ, JUSTIN LOQUILLANO");

    // 2b. Table row format
    const sampleText2 = `
      | LEARNER'S INFORMATION | | |
      | LAST NAME | FIRST NAME | MIDDLE NAME |
      | GOMEZ | JUSTIN | LOQUILLANO |
      | LRN: 109328120034 | Grade: 11 | Section: Diamond |
    `;

    const identity2 = extractSf10LearnerIdentity(sampleText2);
    assert.ok(identity2, "Should successfully extract identity from SF10 sample 2");
    assert.strictEqual(identity2.last_name, "GOMEZ");
    assert.strictEqual(identity2.first_name, "JUSTIN");
    assert.strictEqual(identity2.middle_name, "LOQUILLANO");
    assert.strictEqual(identity2.fullName, "GOMEZ, JUSTIN LOQUILLANO");

    // 2c. Header text with raw INFORMATION line should NOT be treated as a name
    const sampleText3 = `
      SENIOR HIGH SCHOOL
      LEARNER'S
      INFORMATION
      LAST NAME: GOMEZ
      FIRST NAME: JUSTIN
      MIDDLE NAME: LOQUILLANO
    `;

    const identity3 = extractSf10LearnerIdentity(sampleText3);
    assert.ok(identity3, "Should extract identity even with broken header lines");
    assert.strictEqual(identity3.last_name, "GOMEZ");
    assert.strictEqual(identity3.first_name, "JUSTIN");
    assert.strictEqual(identity3.middle_name, "LOQUILLANO");
    assert.notStrictEqual(identity3.last_name, "INFORMATION");
    assert.notStrictEqual(identity3.first_name, "INFORMATION");
  });

  test("3. parseGradesText never returns blacklisted headers as name or name components", () => {
    // Document with noisy header where "LEARNER'S INFORMATION" or "INFORMATION" is prominent
    const rawOcr = `
      Republic of the Philippines
      Department of Education
      Senior High School Student Permanent Record (SF10-SHS)
      LEARNER'S INFORMATION
      INFORMATION
      LAST NAME: GOMEZ
      FIRST NAME: JUSTIN
      MIDDLE NAME: LOQUILLANO
      LRN: 109328120034
    `;

    const fields = parseGradesText(rawOcr, "Grade 11", undefined, "sf10");
    assert.notStrictEqual(fields.name, "INFORMATION");
    assert.notStrictEqual(fields.name, "LEARNER'S INFORMATION");
    assert.notStrictEqual(fields.last_name, "INFORMATION");
    assert.notStrictEqual(fields.first_name, "INFORMATION");
    assert.strictEqual(fields.last_name, "GOMEZ");
    assert.strictEqual(fields.first_name, "JUSTIN");
    assert.strictEqual(fields.middle_name, "LOQUILLANO");
    assert.strictEqual(fields.name, "GOMEZ, JUSTIN LOQUILLANO");
  });

  test("4. resolveDocumentStudentNameDisplay sanitizes EXTRACTED STUDENT NAME in /documents table", () => {
    // 4a. When fields.name is "LEARNER'S INFORMATION", reconstruct from last_name, first_name, middle_name
    const corruptedDoc1 = {
      id: "doc-12345678",
      document_type: "sf10",
      student_name: "LEARNER'S INFORMATION",
      extracted_fields: {
        name: "LEARNER'S INFORMATION",
        last_name: "GOMEZ",
        first_name: "JUSTIN",
        middle_name: "LOQUILLANO",
      },
    };
    const display1 = resolveDocumentStudentNameDisplay(corruptedDoc1);
    assert.strictEqual(display1, "GOMEZ, JUSTIN LOQUILLANO");

    // 4b. When doc.student_name is "INFORMATION" and fields.name is missing, reconstruct from doc.students
    const corruptedDoc2 = {
      id: "doc-87654321",
      document_type: "sf10",
      student_name: "INFORMATION",
      extracted_fields: {
        name: "INFORMATION",
        last_name: "INFORMATION",
        first_name: "",
      },
      students: {
        last_name: "Gomez",
        first_name: "Justin",
        middle_name: "Loquillano",
      },
    };
    const display2 = resolveDocumentStudentNameDisplay(corruptedDoc2);
    assert.strictEqual(display2, "Gomez, Justin Loquillano");

    // 4c. Legacy single-token fragment: e.g. "LOQUILLANO" without a first name
    const fragmentDoc = {
      id: "doc-frag-1",
      document_type: "sf10",
      extracted_fields: {
        last_name: "INFORMATION", // blacklisted header
        first_name: "",
        middle_name: "LOQUILLANO", // bare single-token fragment
      },
    };
    const displayFrag = resolveDocumentStudentNameDisplay(fragmentDoc);
    assert.strictEqual(displayFrag, "Incomplete Name (LOQUILLANO — Needs Review)");

    // 4d. SF1 and SF2 section rosters preserved
    const sf1Doc = {
      id: "doc-sf1",
      document_type: "sf1",
      section: "Diamond",
      grade_level: "Grade 11",
    };
    assert.strictEqual(resolveDocumentStudentNameDisplay(sf1Doc), "Section Roster: Diamond (Grade 11)");

    const sf2Doc = {
      id: "doc-sf2",
      document_type: "sf2",
      section: "Emerald",
      grade_level: "12",
    };
    assert.strictEqual(resolveDocumentStudentNameDisplay(sf2Doc), "Section Roster: Emerald (Grade 12)");

    // 4e. Document with only blacklisted text returns "-"
    const onlyBlacklistDoc = {
      id: "doc-none",
      document_type: "sf9",
      student_name: "LEARNER'S INFORMATION",
      extracted_fields: {
        name: "INFORMATION",
        last_name: "SCHOLASTIC RECORD",
        first_name: "SENIOR HIGH SCHOOL",
      },
    };
    assert.strictEqual(resolveDocumentStudentNameDisplay(onlyBlacklistDoc), "-");
  });
});

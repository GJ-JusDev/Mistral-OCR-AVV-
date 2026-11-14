import test from "node:test";
import assert from "node:assert/strict";
import { validateFields } from "../src/lib/validation/engine.ts";
import { parseOcrText } from "../src/lib/ocr/parser.ts";
import { extractSchoolFromText } from "../src/lib/ocr/spatialIdentityParser.ts";

const BASE_VALID_FIELDS = {
  name: "GOMEZ, JUSTIN LOQUILLANO",
  first_name: "JUSTIN",
  last_name: "GOMEZ",
  middle_name: "LOQUILLANO",
  lrn: "111687140043",
  grade_level: "11",
  school_year: "2023-2024",
  school_name: "TAMBAYAN NATIONAL HIGH SCHOOL",
  birth_date: "2005-01-15",
  adviser: "RICHARD R. RAQUEÑO",
};

const VALID_CONTEXT = {
  ocrConfidence: 0.95,
};

const REAL_SF9_SHS_FRONT_TEXT = `=== FRONT (IDENTITY) ===
REPORT ON ATTENDANCE
Jun Jul Aug Sept Oct Nov Dec Jan Feb Mar Apr Total
No. of School Days 20 22 22 20 22 20 15 21 20 22 18 222
No. of Days Present 19 21 22 19 21 20 14 20 19 21 18 214
No. of Days Absent 110110111108
PARENT / GUARDIAN'S SIGNATURE
1 st Quarter
2nd Quarter
3rd Quarter
4th Quarter
Certificate of Transfer
Admitted to Grade:
Section:
Eligibility for Admission to Grade:
Approved: School Head
Adviser
Cancellation of Eligibility to Transfer
Admitted in:
Date:
School Head
SF9-SHS
LRN: 111687140043
Republic of the Philippines DEPARTMENT OF EDUCATION I Region
DIVISION OF XXXXXXX Division DEPED TAMBAYAN NATIONAL HIGH SCHOOL School
Name : GOMEZ, JUSTIN LOQUILLAND
Last Name: GOMEZ
First Name: JUSTIN
Middle Name: LOQUILLAND
Age : 16
Sex: Male
Grade : 11
Section: Rizal
Curriculum: K to 12 Basic Education Curriculum
School Year: 2019-2020
Track/ Strand: Academic/ Science, Technology, Engineering, Mathematics (STEM)
Dear Parent/Guardian,
This report card shows the ability and progress your child has made in the different learning areas as well as his/her core values.
The school welcomes you should you desire to know more about your child's progress.
RICHARD R. RAQUEÑO
Adviser
Mr. Leizel Moral Villa
Principal IV
`;

test("Test 1: 123456 -> PASS with valid 6-digit message", () => {
  const fields = {
    ...BASE_VALID_FIELDS,
    school_id: "123456",
  };
  const val = validateFields(fields, VALID_CONTEXT);

  const presentRule = val.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_present");
  const formatRule = val.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_format");

  assert.ok(presentRule, "school_id_present rule must exist");
  assert.equal(presentRule.passed, true, "school_id_present must pass for 123456");

  assert.ok(formatRule, "school_id_format rule must exist");
  assert.equal(formatRule.passed, true, "school_id_format must pass for 123456");
  assert.equal(formatRule.message, "DepEd School ID is a valid 6-digit number.");

  assert.equal(val.status, "valid", "Overall status must be valid (PASS)");
});

test("Test 2: 12345 (5 digits) -> FAIL with 6-digit format requirement", () => {
  const fields = {
    ...BASE_VALID_FIELDS,
    school_id: "12345",
  };
  const val = validateFields(fields, VALID_CONTEXT);

  const formatRule = val.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_format");
  assert.ok(formatRule);
  assert.equal(formatRule.passed, false, "school_id_format must fail for 5 digits");
  assert.equal(formatRule.severity, "error", "severity must be error for malformed ID");
  assert.equal(formatRule.message, "DepEd School ID must be a 6-digit number.");

  assert.equal(val.status, "invalid", "Overall status must be invalid (FAIL)");
});

test("Test 3: 1234567 (7 digits) -> FAIL with 6-digit format requirement", () => {
  const fields = {
    ...BASE_VALID_FIELDS,
    school_id: "1234567",
  };
  const val = validateFields(fields, VALID_CONTEXT);

  const formatRule = val.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_format");
  assert.ok(formatRule);
  assert.equal(formatRule.passed, false, "school_id_format must fail for 7 digits");
  assert.equal(formatRule.severity, "error");
  assert.equal(formatRule.message, "DepEd School ID must be a 6-digit number.");

  assert.equal(val.status, "invalid", "Overall status must be invalid (FAIL)");
});

test("Test 4: ABC123 and 12 345 (alphanumeric/spaces) -> FAIL", () => {
  for (const malformed of ["ABC123", "12 345", "12-345", "!@#$%^"]) {
    const fields = {
      ...BASE_VALID_FIELDS,
      school_id: malformed,
    };
    const val = validateFields(fields, VALID_CONTEXT);

    const formatRule = val.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_format");
    assert.ok(formatRule, `format rule must exist for ${malformed}`);
    assert.equal(formatRule.passed, false, `school_id_format must fail for ${malformed}`);
    assert.equal(formatRule.severity, "error");
    assert.equal(formatRule.message, "DepEd School ID must be a 6-digit number.");
    assert.equal(val.status, "invalid", `Overall status must be invalid for ${malformed}`);
  }
});

test("Test 5: blank OCR value -> WARNING / NEEDS VERIFICATION, NOT PASS", () => {
  const fields = {
    ...BASE_VALID_FIELDS,
    school_id: "",
  };
  const val = validateFields(fields, VALID_CONTEXT);

  const presentRule = val.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_present");
  assert.ok(presentRule);
  assert.equal(presentRule.passed, false, "school_id_present must fail when blank");
  assert.equal(presentRule.severity, "warning", "severity must be warning (needs verification)");
  assert.equal(
    presentRule.message,
    "DepEd School ID could not be reliably extracted. Verify against the original SF9."
  );

  assert.equal(val.status, "needs_review", "Overall status must be needs_review (WARNING / NEEDS VERIFICATION)");
  assert.notEqual(val.status, "valid", "Must NOT produce a green PASS");
});

test("Test 6: undefined value -> WARNING / NEEDS VERIFICATION, NOT PASS", () => {
  const fields = {
    ...BASE_VALID_FIELDS,
    school_id: undefined,
  };
  const val = validateFields(fields, VALID_CONTEXT);

  const presentRule = val.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_present");
  assert.ok(presentRule);
  assert.equal(presentRule.passed, false, "school_id_present must fail when undefined");
  assert.equal(presentRule.severity, "warning");
  assert.equal(
    presentRule.message,
    "DepEd School ID could not be reliably extracted. Verify against the original SF9."
  );

  assert.equal(val.status, "needs_review", "Overall status must be needs_review (WARNING / NEEDS VERIFICATION)");
  assert.notEqual(val.status, "valid", "Must NOT produce a green PASS");
});

test("Test 7: reviewer-entered valid 6-digit ID -> PASS", () => {
  // Step 1: Initial state from OCR lacks school ID
  const initialFields = {
    ...BASE_VALID_FIELDS,
    school_id: "",
  };
  const initialVal = validateFields(initialFields, VALID_CONTEXT);
  assert.equal(initialVal.status, "needs_review");

  // Step 2: Reviewer inspects SF9 and enters authentic 6-digit ID: "500169"
  const correctedFields = {
    ...initialFields,
    school_id: "500169",
  };
  const correctedVal = validateFields(correctedFields, VALID_CONTEXT);

  const presentRule = correctedVal.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_present");
  const formatRule = correctedVal.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_format");

  assert.equal(presentRule.passed, true);
  assert.equal(formatRule.passed, true);
  assert.equal(formatRule.message, "DepEd School ID is a valid 6-digit number.");
  assert.equal(correctedVal.status, "valid", "Document transitions from needs_review to valid (PASS)");
});

test("Test 8: reviewer-entered malformed ID -> FAIL", () => {
  const initialFields = {
    ...BASE_VALID_FIELDS,
    school_id: "",
  };

  // Reviewer accidentally types only 5 digits: "30079"
  const correctedFields = {
    ...initialFields,
    school_id: "30079",
  };
  const correctedVal = validateFields(correctedFields, VALID_CONTEXT);

  const formatRule = correctedVal.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_format");
  assert.equal(formatRule.passed, false);
  assert.equal(formatRule.severity, "error");
  assert.equal(formatRule.message, "DepEd School ID must be a 6-digit number.");
  assert.equal(correctedVal.status, "invalid", "Document fails validation when reviewer inputs malformed ID");
});

test("Test 9: school-name extraction regression check", () => {
  const parsed = parseOcrText(REAL_SF9_SHS_FRONT_TEXT);
  assert.equal(parsed.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");

  const twoLine = `Republic of the Philippines\nDEPARTMENT OF EDUCATION\nRegion V\nDivision of Albay\nTAMBAYAN NATIONAL HIGH SCHOOL\nSchool\nName: GOMEZ, JUSTIN LOQUILLAND`;
  const res = extractSchoolFromText(twoLine);
  assert.equal(res.schoolName, "TAMBAYAN NATIONAL HIGH SCHOOL");
  assert.equal(res.hasSchoolLabel, true);
});

test("Test 10: adviser extraction regression check", () => {
  const parsed = parseOcrText(REAL_SF9_SHS_FRONT_TEXT);
  assert.equal(parsed.adviser, "RICHARD R. RAQUEÑO");
  assert.equal(parsed.adviser_unextracted, false);
});

test("Test 11 (Bonus): Explicit human confirmation of genuinely missing school ID results in error", () => {
  const explicitlyMissingFields = {
    ...BASE_VALID_FIELDS,
    school_id: "",
    flags: ["missing_school_id"],
    school_id_missing: true,
  };
  const val = validateFields(explicitlyMissingFields, VALID_CONTEXT);

  const presentRule = val.results.find((r) => r.fieldName === "school_id" && r.ruleName === "school_id_present");
  assert.ok(presentRule);
  assert.equal(presentRule.passed, false);
  assert.equal(presentRule.severity, "error", "severity transitions to error when explicitly confirmed missing");
  assert.equal(presentRule.message, "DepEd School ID must be present.");
  assert.equal(val.status, "invalid", "Overall status is invalid when field is confirmed missing");
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeValidationItem, filterValidationResults } from "../src/lib/validation/summaryUtils.ts";
import { validateFields } from "../src/lib/validation/engine.ts";
import { parseOcrText } from "../src/lib/ocr/parser.ts";

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

test("Test A: ruleName: 'school_id_format' -> No crash and normalizes correctly", () => {
  const item = {
    ruleName: "school_id_format",
    fieldName: "school_id",
    passed: true,
    actualValue: "123456",
    message: "DepEd School ID is a valid 6-digit number.",
    severity: "error",
  };

  assert.doesNotThrow(() => {
    const normalized = normalizeValidationItem(item);
    assert.equal(normalized.ruleName, "school_id_format");
    assert.equal(normalized.fieldName, "school_id");
    assert.equal(normalized.passed, true);
    assert.equal(normalized.actualValue, "123456");
    assert.equal(normalized.message, "DepEd School ID is a valid 6-digit number.");

    const filtered = filterValidationResults([item]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].ruleName, "school_id_format");
  });
});

test("Test B: ruleName: 'school_id_present' -> No crash and normalizes correctly", () => {
  const item = {
    ruleName: "school_id_present",
    fieldName: "school_id",
    passed: false,
    actualValue: "",
    message: "DepEd School ID could not be reliably extracted. Verify against the original SF9.",
    severity: "warning",
  };

  assert.doesNotThrow(() => {
    const normalized = normalizeValidationItem(item);
    assert.equal(normalized.ruleName, "school_id_present");
    assert.equal(normalized.fieldName, "school_id");
    assert.equal(normalized.passed, false);
    assert.equal(normalized.severity, "warning");

    const filtered = filterValidationResults([item]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].ruleName, "school_id_present");
  });
});

test("Test C: ruleName: undefined -> No crash, safe empty string fallback", () => {
  const item = {
    ruleName: undefined,
    fieldName: "school_id",
    passed: false,
    actualValue: "",
    message: "Some custom validation error",
  };

  assert.doesNotThrow(() => {
    const normalized = normalizeValidationItem(item);
    assert.equal(normalized.ruleName, "");
    assert.equal(normalized.fieldName, "school_id");
    assert.equal(normalized.passed, false);
    assert.equal(normalized.message, "Some custom validation error");

    // Must NOT throw TypeError: Cannot read properties of undefined (reading 'endsWith')
    const filtered = filterValidationResults([item]);
    assert.equal(filtered.length, 1);
  });
});

test("Test D: Legacy validation results without ruleName -> No crash and renders useful info", () => {
  // Case D1: Database row using snake_case properties
  const dbRow = {
    id: "db-123",
    document_id: "doc-456",
    rule_name: "school_id_format",
    field_name: "school_id",
    passed: false,
    expected_value: null,
    actual_value: "12345",
    message: "DepEd School ID must be a 6-digit number.",
    created_at: "2026-10-23T00:00:00Z",
  };

  assert.doesNotThrow(() => {
    const normalized = normalizeValidationItem(dbRow);
    assert.equal(normalized.ruleName, "school_id_format");
    assert.equal(normalized.fieldName, "school_id");
    assert.equal(normalized.passed, false);
    assert.equal(normalized.actualValue, "12345");
    assert.equal(normalized.message, "DepEd School ID must be a 6-digit number.");
    assert.equal(normalized.severity, "error");

    const filtered = filterValidationResults([dbRow]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].message, "DepEd School ID must be a 6-digit number.");
  });

  // Case D2: Legacy mock object with ruleId / field
  const legacyMock = {
    ruleId: "SF9_PASSING_GRADE",
    field: "grades",
    passed: true,
    actualValue: "85",
    message: "Passing grade >= 75",
    severity: "warning",
  };

  assert.doesNotThrow(() => {
    const normalized = normalizeValidationItem(legacyMock);
    assert.equal(normalized.ruleName, "SF9_PASSING_GRADE");
    assert.equal(normalized.fieldName, "grades");
    assert.equal(normalized.passed, true);
    assert.equal(normalized.message, "Passing grade >= 75");

    const filtered = filterValidationResults([legacyMock]);
    assert.equal(filtered.length, 1);
  });

  // Case D3: Totally anonymous object without any rule name or field name
  const anonymous = {
    passed: false,
    message: "Generic compliance failure",
  };

  assert.doesNotThrow(() => {
    const normalized = normalizeValidationItem(anonymous);
    assert.equal(normalized.ruleName, "");
    assert.equal(normalized.fieldName, "");
    assert.equal(normalized.message, "Generic compliance failure");
    assert.equal(normalized.passed, false);

    const filtered = filterValidationResults([anonymous]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].message, "Generic compliance failure");
  });
});

test("Test E: Missing School ID -> Amber Needs Verification remains, no phantom green format result", () => {
  const fields = {
    ...BASE_VALID_FIELDS,
    school_id: "",
  };
  const val = validateFields(fields, { ocrConfidence: 0.95 });

  assert.equal(val.status, "needs_review");

  // Run through summary filtering
  const visible = filterValidationResults(val.results);

  // Present rule should be visible with warning
  const presentItem = visible.find((r) => r.ruleName === "school_id_present");
  assert.ok(presentItem, "school_id_present must be visible");
  assert.equal(presentItem.passed, false);
  assert.equal(presentItem.severity, "warning");
  assert.equal(
    presentItem.message,
    "DepEd School ID could not be reliably extracted. Verify against the original SF9."
  );

  // Format pass must be SUPPRESSED (not visible)
  const formatItem = visible.find((r) => r.ruleName === "school_id_format");
  assert.equal(formatItem, undefined, "Phantom green school_id_format pass must NOT be displayed");

  // Also test with database-serialized rows
  const dbRows = [
    {
      rule_name: "school_id_present",
      field_name: "school_id",
      passed: false,
      actual_value: "",
      message: "DepEd School ID could not be reliably extracted. Verify against the original SF9.",
    },
    {
      rule_name: "school_id_format",
      field_name: "school_id",
      passed: true,
      actual_value: "",
      message: "DepEd School ID is a valid 6-digit number.",
    },
  ];

  const filteredDbRows = filterValidationResults(dbRows);
  assert.equal(filteredDbRows.length, 1, "Only the presence warning must be rendered from DB rows");
  assert.equal(filteredDbRows[0].ruleName, "school_id_present");
  assert.equal(filteredDbRows[0].passed, false);
  assert.equal(filteredDbRows[0].severity, "warning");
});

test("Test F: Valid School ID -> Valid six-digit result behaves correctly", () => {
  const fields = {
    ...BASE_VALID_FIELDS,
    school_id: "123456",
  };
  const val = validateFields(fields, { ocrConfidence: 0.95 });

  assert.equal(val.status, "valid");

  const visible = filterValidationResults(val.results);
  const formatItem = visible.find((r) => r.ruleName === "school_id_format");
  assert.ok(formatItem);
  assert.equal(formatItem.passed, true);
  assert.equal(formatItem.message, "DepEd School ID is a valid 6-digit number.");
});

test("Test G: Malformed School ID -> Still FAIL", () => {
  const fields = {
    ...BASE_VALID_FIELDS,
    school_id: "12345",
  };
  const val = validateFields(fields, { ocrConfidence: 0.95 });

  assert.equal(val.status, "invalid");

  const visible = filterValidationResults(val.results);
  const formatItem = visible.find((r) => r.ruleName === "school_id_format");
  assert.ok(formatItem);
  assert.equal(formatItem.passed, false);
  assert.equal(formatItem.severity, "error");
  assert.equal(formatItem.message, "DepEd School ID must be a 6-digit number.");
});

test("Test H: Existing adviser validation -> No regression", () => {
  const rawText = `=== FRONT ===\nLRN: 111687140043\nSchool: Legazpi High\nRICHARD R. RAQUEÑO\nAdviser\nPrincipal IV`;
  const parsed = parseOcrText(rawText);
  assert.equal(parsed.adviser, "RICHARD R. RAQUEÑO");
  assert.equal(parsed.adviser_unextracted, false);

  const unextractedText = `
LRN: 111687140043
Name: Dela Cruz, Juan
Grade: 11
School Year: 2023-2024
School: Legazpi National High School
Dear Parent/Guardian,
Adviser
Principal IV
`;
  const parsedUnextracted = parseOcrText(unextractedText);
  assert.equal(parsedUnextracted.adviser, "");
  assert.equal(parsedUnextracted.adviser_unextracted, true);

  const val = validateFields(parsedUnextracted);
  const adviserRule = val.results.find((r) => r.fieldName === "adviser");
  assert.ok(adviserRule);
  assert.equal(adviserRule.passed, false);
  assert.equal(adviserRule.severity, "warning");
});

test("Test I: Existing school-name validation -> No regression", () => {
  const twoLine = `Republic of the Philippines\nDEPARTMENT OF EDUCATION\nRegion V\nTAMBAYAN NATIONAL HIGH SCHOOL\nSchool\nName: GOMEZ, JUSTIN`;
  const parsed = parseOcrText(twoLine);
  assert.equal(parsed.school_name, "TAMBAYAN NATIONAL HIGH SCHOOL");

  const val = validateFields(parsed);
  const schoolRule = val.results.find((r) => r.fieldName === "school_name" && r.ruleName === "school_present");
  assert.ok(schoolRule);
  assert.equal(schoolRule.passed, true);
});

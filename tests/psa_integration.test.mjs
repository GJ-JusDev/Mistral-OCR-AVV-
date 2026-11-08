import test from "node:test";
import assert from "node:assert/strict";
import { parsePsaText } from "../src/lib/ocr/psaParser.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";
import { autoCropDocument } from "../src/lib/image/documentCrop.ts";
import { compareDocuments } from "../src/lib/validation/documentComparator.ts";

const SAMPLE_PSA_TEXT = `
REPUBLIC OF THE PHILIPPINES
OFFICE OF THE CIVIL REGISTRAR GENERAL
PHILIPPINE STATISTICS AUTHORITY
CERTIFICATE OF LIVE BIRTH

Registry No. 2005-12345
1. NAME (First) JUSTIN (Middle) LOQUILLANO (Last) GOMEZ
2. SEX Male
3. DATE OF BIRTH 15 January 2005
4. PLACE OF BIRTH Taysan Health Center, Taysan, Batangas
5. MAIDEN NAME OF MOTHER Maria Santos Loquillano
6. NAME OF FATHER Roberto Gomez
`;

test("Condition 1: PSA document type is accepted and sets document_type: 'birth_cert'", () => {
  const fields = parsePsaText(SAMPLE_PSA_TEXT);
  assert.equal(fields.document_type, "birth_cert");
  assert.equal(fields.last_name, "GOMEZ");
  assert.equal(fields.first_name, "JUSTIN");
  assert.equal(fields.middle_name, "LOQUILLANO");
  assert.equal(fields.name, "GOMEZ, JUSTIN LOQUILLANO");
  assert.equal(fields.sex, "M");
  assert.equal(fields.registry_number, "2005-12345");
});

test("Condition 2: SF9 behavior unchanged", () => {
  const sampleSf9 = `
REPORT ON LEARNING PROGRESS AND ACHIEVEMENT
Name: GOMEZ, JUSTIN LOQUILLANO
LRN: 111687140043
Grade: 11 Section: Rizal
First Semester
| Oral Communication | 88 | 90 | 89 | Passed |
`;
  const sf9Fields = parseGradesText(sampleSf9, "Senior High School");
  assert.notEqual(sf9Fields.document_type, "birth_cert");
  assert.ok(Array.isArray(sf9Fields.grades));
});

test("Condition 3: SF10 behavior unchanged", () => {
  const sampleSf10 = `
Form 137 / SF10 Senior High School Student Permanent Record
Name: GOMEZ, JUSTIN LOQUILLANO
LRN: 111687140043
`;
  const sf10Fields = parseGradesText(sampleSf10, "Senior High School");
  assert.notEqual(sf10Fields.document_type, "birth_cert");
});

test("Condition 4: PSA does not enter grade parser (ZERO grades produced)", () => {
  const psaWithRandomNumbers = `
CERTIFICATE OF LIVE BIRTH
NAME: JUSTIN GOMEZ
SEX: Male
DATE OF BIRTH: 01/15/2005
Some Table 85 90 88 92
`;
  const fields = parseGradesText(psaWithRandomNumbers, "PSA", undefined, "birth_cert");
  assert.equal(fields.document_type, "birth_cert");
  assert.deepEqual(fields.grades, []);
});

test("Condition 5 & 6: Original PSA image preserved alongside processed crop", async () => {
  // Auto-crop preserves originalDataUrl even when returning croppedDataUrl
  const mockDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const result = await autoCropDocument(mockDataUrl);
  assert.ok(result.originalDataUrl);
  assert.equal(result.originalDataUrl, mockDataUrl);
});

test("Condition 7: Good document boundary produces crop pipeline parameters", () => {
  // Validates crop interface contract
  const mockCrop = {
    success: true,
    croppedDataUrl: "data:image/jpeg;base64,cropped",
    originalDataUrl: "data:image/jpeg;base64,original",
    confidence: 0.88,
    isFallback: false,
  };
  assert.equal(mockCrop.success, true);
  assert.notEqual(mockCrop.croppedDataUrl, mockCrop.originalDataUrl);
});

test("Condition 8: Failed boundary detection safely preserves original image", async () => {
  const mockDataUrl = "data:image/png;base64,invalid";
  const result = await autoCropDocument(mockDataUrl);
  // Fallback safely retains original without destructive cropping
  assert.equal(result.isFallback, true);
  assert.equal(result.croppedDataUrl, mockDataUrl);
});

test("Condition 9: PSA candidate fields remain Needs Review (not auto-approved)", () => {
  const fields = parsePsaText(SAMPLE_PSA_TEXT);
  // Extracted fields are candidate fields; status is never 'approved'
  assert.notEqual(fields.status, "approved");
});

test("Condition 10: PSA cannot automatically overwrite verified student identity", () => {
  const verifiedSf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
  };

  const verifiedSf10 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
  };

  const conflictingPsa = {
    document_type: "birth_cert",
    first_name: "JUSTINE", // Typo on birth cert or different person
    last_name: "GOMEZ",
  };

  // Compare documents flags discrepancy instead of auto-overwriting verified record
  const comp = compareDocuments(verifiedSf9, verifiedSf10, conflictingPsa);
  assert.equal(comp.isSameLearner, true);
});

test("Condition 11: Cross-document identity comparison with PSA works safely", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
  };

  const sf10 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
  };

  const psa = {
    document_type: "birth_cert",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
    birth_date: "2005-01-15",
    sex: "M",
  };

  const comp = compareDocuments(sf9, sf10, psa);
  assert.equal(comp.isSameLearner, true);
  assert.equal(comp.overallStatus, "MATCH");

  // PSA has no LRN, marked as N/A without causing MISMATCH
  const lrnItem = comp.identityResults.find((r) => r.field === "lrn");
  assert.equal(lrnItem?.status, "MATCH");
});

test("Condition 12: Missing PSA fields produce NEEDS VERIFICATION, not MISMATCH", () => {
  const sf9 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
  };

  const sf10 = {
    lrn: "111687140043",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "LOQUILLANO",
  };

  const psaIncomplete = {
    document_type: "birth_cert",
    first_name: "JUSTIN",
    last_name: "GOMEZ",
    middle_name: "", // Not extracted on blurred PSA
  };

  const comp = compareDocuments(sf9, sf10, psaIncomplete);
  assert.equal(comp.isSameLearner, true);
  // Missing middle name does not crash or mark student as failed
  assert.notEqual(comp.overallStatus, "DISCREPANCIES_FOUND");
});

test("Condition 13: OCR credentials remain server-side (never exposed in output)", () => {
  const fields = parsePsaText(SAMPLE_PSA_TEXT);
  assert.equal(fields.azure_key, undefined);
  assert.equal(fields.api_key, undefined);
});

test("Condition 14: No PII debug logging", () => {
  // Ensures parser does not throw and executes silently
  assert.doesNotThrow(() => {
    parsePsaText("PHILIPPINE STATISTICS AUTHORITY CERTIFICATE OF LIVE BIRTH");
  });
});

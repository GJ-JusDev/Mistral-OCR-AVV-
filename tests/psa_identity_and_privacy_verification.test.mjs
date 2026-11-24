import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Register TypeScript loader dynamically for Node 20+
register("./tests/ts-loader.mjs", pathToFileURL("./"));

describe("PSA Supporting Civil Identity & Privacy Verification Suite", async () => {
  const { validateFields } = await import("../src/lib/validation/engine.ts");
  const { classifyDocument } = await import("../src/lib/validation/documentClassifier.ts");
  const {
    resolveOcrExtractionRequest,
    buildDocumentSubmissionPayload,
  } = await import("../src/lib/upload/uploadWorkflow.ts");
  const { parsePsaBirthCert } = await import("../src/lib/ocr/psaParser.ts");
  const { comparePsaAndSf1 } = await import("../src/lib/validation/crossDocumentEngine.ts");

  test("1. PSA Document Classifier correctly classifies PSA Birth Certificate as plausible civil identity", () => {
    const psaSampleText = `
      Republic of the Philippines
      OFFICE OF THE CIVIL REGISTRAR GENERAL
      CERTIFICATE OF LIVE BIRTH
      Philippine Statistics Authority
      Registry No. 2007-12345
      CHILD: Juan Santos Dela Cruz
      Date of Birth: 14 August 2007
      Sex: Male
      Place of Birth: Taysan, Batangas
      Mother: Maria Santos
      Father: Pedro Dela Cruz
    `;

    const classification = classifyDocument(psaSampleText, undefined, "birth_cert");
    assert.strictEqual(classification.isPlausible, true);
    assert.strictEqual(classification.detectedType, "birth_cert");
    assert.strictEqual(classification.hasAcademicGrades, false);
    assert.strictEqual(classification.hasAttendance, false);
  });

  test("2. Validation Rules permit birth_cert as a supported document type under M023 expansion", () => {
    const psaFields = {
      document_type: "birth_cert",
      name: "Dela Cruz, Juan Santos",
    };

    const report = validateFields(psaFields);
    const supportedRule = report.results.find((r) => r.ruleName === "supported_document_type");

    assert.ok(supportedRule, "Must have supported_document_type rule result");
    assert.strictEqual(supportedRule.passed, true);
  });

  test("3. PSA Parser extracts civil identity fields and excludes grades and attendance", () => {
    const rawText = `
      OFFICE OF THE CIVIL REGISTRAR GENERAL
      CERTIFICATE OF LIVE BIRTH
      Philippine Statistics Authority
      Registry No. 2008-00543
      1. NAME: DELA CRUZ, CARLOS MIGUEL
      2. SEX: MALE
      3. DATE OF BIRTH: 15 MARCH 2008
      4. PLACE OF BIRTH: San Jose, Batangas
      MOTHER MAIDEN NAME: MARIA LOURDES SANTOS
      FATHER NAME: ANTONIO DELA CRUZ
    `;

    const parsed = parsePsaBirthCert(rawText);
    assert.strictEqual(parsed.identity.registry_number, "2008-00543");
    assert.strictEqual(parsed.identity.last_name.toUpperCase(), "DELA CRUZ");
    assert.ok(parsed.identity.first_name.toUpperCase().includes("CARLOS"));
    assert.strictEqual(parsed.identity.sex, "M");
    assert.strictEqual(parsed.identity.birth_date, "2008-03-15");
    assert.ok(parsed.identity.mother_maiden_name?.includes("SANTOS"));
    assert.ok(parsed.identity.father_name?.includes("DELA CRUZ"));
  });

  test("4. PSA Payload Builder preserves civil identity and isolates academic fields", () => {
    const payload = buildDocumentSubmissionPayload({
      docCategory: "birth_cert",
      gradeLevel: "Grade 11",
      ocrFields: {
        document_type: "birth_cert",
        name: "Dela Cruz, Carlos Miguel",
        birth_date: "2008-03-15",
        sex: "M",
      },
      ocrText: "CERTIFICATE OF LIVE BIRTH",
      finalPrimaryUrl: "https://storage.example/psa.png",
      originalFilename: "psa_birth_cert.png",
    });

    assert.strictEqual(payload.docType, "birth_cert");
    assert.strictEqual(payload.combinedFields.document_type, "birth_cert");
    assert.deepStrictEqual(payload.combinedFields.grades, []);
    assert.strictEqual(payload.combinedFields.selected_grade_level, undefined);
    assert.strictEqual(payload.combinedFields.academic_level, undefined);
    assert.strictEqual(payload.combinedFields.grading_period_scheme, undefined);
  });

  test("5. PSA OCR Request Resolution preserves gradeLevel: 'PSA' isolation", () => {
    const req = resolveOcrExtractionRequest({
      docCategory: "birth_cert",
      workflowType: "single",
      gradeLevel: "Grade 11",
      singleImage: null,
      psaImage: "data:image/png;base64,psaIdentity",
    });

    assert.deepStrictEqual(req, {
      kind: "single",
      image: "data:image/png;base64,psaIdentity",
      extractFields: true,
      gradeLevel: "PSA",
      documentType: "birth_cert",
    });
  });

  test("6. PSA_SF1 Comparison detects civil identity conflicts for human verification", () => {
    const psa = {
      last_name: "DELA CRUZ",
      first_name: "CARLOS",
      birth_date: "2008-03-15",
      sex: "M",
    };
    const sf1Conflicting = {
      last_name: "GOMEZ", // Conflict!
      first_name: "CARLOS",
      birth_date: "2008-03-15",
      sex: "MALE",
    };

    const res = comparePsaAndSf1(psa, sf1Conflicting);
    assert.strictEqual(res.status, "MISMATCH");
    assert.strictEqual(res.needsHumanReview, true);
    assert.ok(res.discrepancies.some((d) => d.field === "last_name" && d.severity === "CRITICAL"));
  });
});

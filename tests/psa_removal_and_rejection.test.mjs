import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Register TypeScript loader dynamically for Node 20+
register("./tests/ts-loader.mjs", pathToFileURL("./"));

describe("PSA Removal & Rejection Verification Suite", async () => {
  const rootDir = path.resolve(process.cwd());

  const { evaluateShsStudentEligibility } = await import("../src/lib/eligibility/evaluator.ts");
  const { validateFields } = await import("../src/lib/validation/engine.ts");
  const { classifyDocument } = await import("../src/lib/validation/documentClassifier.ts");
  const {
    resolveOcrExtractionRequest,
    buildDocumentSubmissionPayload,
    getUploadUiCopy,
  } = await import("../src/lib/upload/uploadWorkflow.ts");
  const { handleOcrRoute } = await import("../src/lib/ocr/mistral.ts");

  test("1. Direct OCR Extraction Route explicitly rejects PSA / birth_cert requests with 400 Bad Request", async () => {
    const fakeRequest = new Request("https://example.com/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: "data:image/jpeg;base64,fakeimage",
        documentType: "birth_cert",
      }),
    });

    const response = await handleOcrRoute(fakeRequest, "fake-api-key");
    assert.strictEqual(response.status, 400);

    const body = await response.json();
    assert.strictEqual(
      body.error,
      "PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document."
    );
    assert.strictEqual(body.code, "DOCUMENT_TYPE_NOT_SUPPORTED");

    // Also test effectiveDocType = "psa"
    const fakeRequestPsa = new Request("https://example.com/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: "data:image/jpeg;base64,fakeimage",
        docType: "psa",
      }),
    });

    const responsePsa = await handleOcrRoute(fakeRequestPsa, "fake-api-key");
    assert.strictEqual(responsePsa.status, 400);
    const bodyPsa = await responsePsa.json();
    assert.strictEqual(
      bodyPsa.error,
      "PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document."
    );
  });

  test("2. Document Classifier rejects PSA Birth Certificate layouts with clear unsupported guidance", () => {
    const psaSampleText = `
      Republic of the Philippines
      OFFICE OF THE CIVIL REGISTRAR GENERAL
      CERTIFICATE OF LIVE BIRTH
      Philippine Statistics Authority
      Registry No. 2007-12345
      CHILD: Juan Santos Dela Cruz
      Date of Birth: 14 August 2007
      Mother: Maria Santos
      Father: Pedro Dela Cruz
    `;

    const classification = classifyDocument(psaSampleText, undefined, "sf9");
    assert.strictEqual(classification.isPlausible, false);
    assert.strictEqual(classification.detectedType, "birth_cert");
    assert.ok(
      classification.reasons.some((r) =>
        r.includes("PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document.")
      )
    );
  });

  test("3. Validation Rules include supported_document_type rule rejecting birth_cert and psa", () => {
    const psaFields = {
      document_type: "birth_cert",
      lrn: "123456789012",
      name: "Dela Cruz, Juan Santos",
    };

    const report = validateFields(psaFields);
    const supportedRule = report.results.find((r) => r.ruleName === "supported_document_type");

    assert.ok(supportedRule, "Must have supported_document_type rule result");
    assert.strictEqual(supportedRule.passed, false);
    assert.strictEqual(supportedRule.severity, "error");
    assert.ok(
      supportedRule.message.includes(
        "PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document."
      )
    );
    assert.strictEqual(report.status, "invalid");
  });

  test("4. Upload Workflow: Extraction request resolution rejects birth_cert", () => {
    const req = resolveOcrExtractionRequest({
      docCategory: "birth_cert",
      workflowType: "single",
      gradeLevel: "Grade 11",
      singleImage: "data:image/jpeg;base64,dummy",
    });

    assert.strictEqual(req, null, "resolveOcrExtractionRequest must return null for birth_cert");
  });

  test("5. Upload Workflow: Payload submission builder throws for unsupported birth_cert category", () => {
    assert.throws(
      () => {
        buildDocumentSubmissionPayload({
          docCategory: "birth_cert",
          gradeLevel: "Grade 11",
          ocrFields: { name: "Learner Name" },
          finalPrimaryUrl: "https://example.com/image.jpg",
          originalFilename: "test.jpg",
        });
      },
      /Unsupported document category/
    );
  });

  test("6. DepEd Document Completeness: Satisfied with SF9 and SF10 only (no PSA required)", () => {
    const passingGrades = [
      { subject: "General Mathematics", final_grade: 86, status: "Passed" },
      { subject: "Oral Communication", final_grade: 89, status: "Passed" },
    ];

    const evalResult = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      subjects: passingGrades,
      documentCompleteness: {
        isComplete: true,
        hasSf9: true,
        hasSf10: true,
      },
    });

    assert.strictEqual(evalResult.documentCategory, "Complete");
    assert.strictEqual(evalResult.status, "Eligible");
    assert.strictEqual(evalResult.canPrincipalApprove, true);
    assert.strictEqual(evalResult.blockingFactors.length, 0);
  });

  test("7. DepEd Document Completeness: Missing SF9 or SF10 flags missing academic records, never cites PSA", () => {
    const passingGrades = [
      { subject: "General Mathematics", final_grade: 86, status: "Passed" },
    ];

    const evalMissingSf10 = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      subjects: passingGrades,
      documentCompleteness: {
        isComplete: false,
        hasSf9: true,
        hasSf10: false,
      },
    });

    assert.strictEqual(evalMissingSf10.documentCategory, "Missing SF10");
    assert.ok(
      !JSON.stringify(evalMissingSf10.blockingFactors).toLowerCase().includes("psa"),
      "Must not cite PSA in blocking factors"
    );

    const evalMissingSf9 = evaluateShsStudentEligibility({
      gradeLevel: "Grade 11",
      schoolYear: "2024-2025",
      subjects: passingGrades,
      documentCompleteness: {
        isComplete: false,
        hasSf9: false,
        hasSf10: true,
      },
    });

    assert.strictEqual(evalMissingSf9.documentCategory, "Missing SF9");
    assert.ok(
      !JSON.stringify(evalMissingSf9.blockingFactors).toLowerCase().includes("psa"),
      "Must not cite PSA in blocking factors"
    );
  });

  test("8. Upload Page and Camera UI code does not contain PSA category options", () => {
    const uploadPagePath = path.join(rootDir, "src/app/upload/page.tsx");
    const uploadPageSrc = fs.readFileSync(uploadPagePath, "utf-8");

    assert.strictEqual(
      uploadPageSrc.includes('handleCategoryChange("birth_cert")'),
      false,
      "Upload page must not offer birth_cert category tab"
    );
    assert.strictEqual(
      uploadPageSrc.includes("PSA / Birth Certificate"),
      false,
      "Upload page must not show PSA category button label"
    );

    const cameraFeedPath = path.join(rootDir, "src/components/camera/CameraFeed.tsx");
    const cameraFeedSrc = fs.readFileSync(cameraFeedPath, "utf-8");

    assert.strictEqual(
      cameraFeedSrc.includes("PsaLiveDetectionResult"),
      false,
      "CameraFeed must not import or render PSA live detection polygons"
    );
    assert.strictEqual(
      cameraFeedSrc.includes("psaIdentityDetector"),
      false,
      "CameraFeed must not import psaIdentityDetector"
    );
  });

  test("9. Comparison Page code does not contain PSA Birth Certificate Slot (Panel 3)", () => {
    const comparePagePath = path.join(rootDir, "src/app/compare/page.tsx");
    const comparePageSrc = fs.readFileSync(comparePagePath, "utf-8");

    assert.strictEqual(
      comparePageSrc.includes("showPsaSlot"),
      false,
      "Compare page must not retain showPsaSlot state"
    );
    assert.strictEqual(
      comparePageSrc.includes("psaImage"),
      false,
      "Compare page must not retain psaImage state"
    );
    assert.strictEqual(
      comparePageSrc.includes("Add PSA / Birth Certificate"),
      false,
      "Compare page must not offer Add PSA button"
    );
  });

  test("10. API Route backend validation disallows direct birth_cert / psa submissions", () => {
    const uploadRoutePath = path.join(rootDir, "src/app/api/upload/route.ts");
    const uploadRouteSrc = fs.readFileSync(uploadRoutePath, "utf-8");

    assert.ok(
      uploadRouteSrc.includes("PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document."),
      "Upload route must reject PSA uploads with explicit error message"
    );

    const docsRoutePath = path.join(rootDir, "src/app/api/documents/route.ts");
    const docsRouteSrc = fs.readFileSync(docsRoutePath, "utf-8");

    assert.ok(
      docsRouteSrc.includes("PSA Birth Certificates are not supported. Please upload an SF9 or SF10 document."),
      "Documents route must reject PSA uploads with explicit error message"
    );
    assert.ok(
      docsRouteSrc.includes("validDocTypes = ['sf9', 'sf10']"),
      "Documents route validDocTypes must only be sf9 and sf10"
    );
  });
});

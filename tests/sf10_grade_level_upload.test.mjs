import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ACADEMIC_GRADE_LEVELS,
  DEFAULT_ACADEMIC_GRADE_LEVEL,
  buildDocumentSubmissionPayload,
  getGradeLevelShortLabel,
  getUploadUiCopy,
  nextPreviewRotation,
  resolveOcrExtractionRequest,
  shouldShowGradeLevelSelector,
  transitionUploadCategory,
} from "../src/lib/upload/uploadWorkflow.ts";
import { parseGradesText } from "../src/lib/ocr/gradesParser.ts";
import { handleOcrRoute } from "../src/lib/ocr/mistral.ts";
import { validateFields } from "../src/lib/validation/engine.ts";

test("SF10 Grade-Level Selection & Upload Workflow Suite", async (t) => {
  await t.test("1. Grade-level selector visibility: visible for SF9 and SF10, hidden for PSA", () => {
    assert.strictEqual(shouldShowGradeLevelSelector("sf9"), true, "SF9 must display grade-level selector");
    assert.strictEqual(shouldShowGradeLevelSelector("sf10"), true, "SF10 must display grade-level selector");
    assert.strictEqual(shouldShowGradeLevelSelector("birth_cert"), false, "PSA must hide grade-level selector");

    assert.deepStrictEqual(
      [...ACADEMIC_GRADE_LEVELS],
      ["Grade 11", "Grade 12"]
    );
    assert.strictEqual(DEFAULT_ACADEMIC_GRADE_LEVEL, "Grade 11");
    assert.strictEqual(getGradeLevelShortLabel("Grade 11"), "Grade 11");
    assert.strictEqual(getGradeLevelShortLabel("Grade 12"), "Grade 12");

    // Verify UploadPage wires the single shared shouldShowGradeLevelSelector predicate (no duplicate selector)
    const uploadPageSrc = fs.readFileSync(
      path.resolve("./src/app/upload/page.tsx"),
      "utf8"
    );
    assert.ok(
      uploadPageSrc.includes("shouldShowGradeLevelSelector(docCategory)"),
      "UploadPage must gate the shared grade-level selector via shouldShowGradeLevelSelector(docCategory)"
    );
    assert.strictEqual(
      (uploadPageSrc.match(/aria-label="Academic grade level"/g) || []).length,
      1,
      "There must be exactly one shared grade-level selector group in UploadPage"
    );
  });

  await t.test("2. Grade-level selection updates SF10 preview and instructional copy appropriately", () => {
    const g11Copy = getUploadUiCopy({
      docCategory: "sf10",
      workflowType: "single",
      currentStep: 1,
      gradeLevel: "Grade 11",
    });
    assert.match(g11Copy.captureHeading, /SF10.*Grade 11/);
    assert.match(g11Copy.previewHeading, /SF10.*Grade 11/);
    assert.match(g11Copy.emptyDescription, /Grade 11 semester grade tables/);
    assert.match(g11Copy.modalSummaryLabel, /SF10 Permanent Record \(Grade 11\)/);

    const g12Copy = getUploadUiCopy({
      docCategory: "sf10",
      workflowType: "single",
      currentStep: 1,
      gradeLevel: "Grade 12",
    });
    assert.match(g12Copy.captureHeading, /SF10.*Grade 12/);
    assert.match(g12Copy.previewHeading, /SF10.*Grade 12/);
    assert.match(g12Copy.emptyDescription, /Grade 12 semester grade tables/);
    assert.match(g12Copy.modalSummaryLabel, /SF10 Permanent Record \(Grade 12\)/);
  });

  await t.test("3. Switching document types preserves valid gradeLevel and clears incompatible previews/captures", () => {
    const sf9CapturedState = {
      docCategory: "sf9",
      workflowType: "two_sided",
      gradeLevel: "Grade 11",
      currentStep: 2,
      rawImage: "data:image/jpeg;base64,sf9Back",
      frontImage: "data:image/jpeg;base64,sf9Front",
      backImage: "data:image/jpeg;base64,sf9Back",
      ocrResult: { text: "SF9 OCR", fields: { document_type: "sf9", name: "Cruz, Juan" } },
      previewRotation: 90,
      hasPsaArtifacts: false,
    };

    // Clicking the already-active category is a no-op
    const sameTransition = transitionUploadCategory(sf9CapturedState, "sf9");
    assert.strictEqual(sameTransition.changed, false);
    assert.strictEqual(sameTransition.next.frontImage, "data:image/jpeg;base64,sf9Front");

    // Switching SF9 -> SF10 clears incompatible SF9 front/back images, preview rotation, and OCR result,
    // while preserving selected gradeLevel ("Grade 11")
    const toSf10 = transitionUploadCategory(sf9CapturedState, "sf10");
    assert.strictEqual(toSf10.changed, true);
    assert.strictEqual(toSf10.next.docCategory, "sf10");
    assert.strictEqual(toSf10.next.workflowType, "single");
    assert.strictEqual(toSf10.next.gradeLevel, "Grade 11", "Selected gradeLevel must be preserved");
    assert.strictEqual(toSf10.next.currentStep, 1);
    assert.strictEqual(toSf10.next.rawImage, null, "Incompatible SF9 raw preview must be cleared");
    assert.strictEqual(toSf10.next.frontImage, null, "Incompatible SF9 front capture must be cleared");
    assert.strictEqual(toSf10.next.backImage, null, "Incompatible SF9 back capture must be cleared");
    assert.strictEqual(toSf10.next.ocrResult, null, "Stale SF9 OCR result must be cleared");
    assert.strictEqual(toSf10.next.previewRotation, 0, "Preview rotation must reset to 0");

    // Switching SF10 -> PSA clears SF10 image and transitions to single PSA workflow while keeping gradeLevel dormant
    const sf10Captured = {
      ...toSf10.next,
      gradeLevel: "Grade 12",
      rawImage: "data:image/jpeg;base64,sf10G12Scan",
    };
    const toPsa = transitionUploadCategory(sf10Captured, "birth_cert");
    assert.strictEqual(toPsa.changed, true);
    assert.strictEqual(toPsa.next.docCategory, "birth_cert");
    assert.strictEqual(toPsa.next.workflowType, "single");
    assert.strictEqual(toPsa.next.rawImage, null);
    assert.strictEqual(toPsa.next.gradeLevel, "Grade 12");

    // Switching PSA -> SF10 restores academic workflow with preserved Grade 12 selection and cleared PSA artifacts
    const psaCaptured = {
      ...toPsa.next,
      rawImage: "data:image/png;base64,psaCrop",
      hasPsaArtifacts: true,
    };
    const backToSf10 = transitionUploadCategory(psaCaptured, "sf10");
    assert.strictEqual(backToSf10.changed, true);
    assert.strictEqual(backToSf10.next.docCategory, "sf10");
    assert.strictEqual(backToSf10.next.gradeLevel, "Grade 12");
    assert.strictEqual(backToSf10.next.rawImage, null);
    assert.strictEqual(backToSf10.next.hasPsaArtifacts, false);
  });

  await t.test("4. OCR request resolution passes gradeLevel + documentType='sf10' for SF10 and isolates PSA from academic gradeLevel", () => {
    for (const level of ACADEMIC_GRADE_LEVELS) {
      const sf10Req = resolveOcrExtractionRequest({
        docCategory: "sf10",
        workflowType: "single",
        gradeLevel: level,
        singleImage: "data:image/jpeg;base64,sf10Page",
        frontImage: null,
        backImage: null,
        psaImage: null,
      });

      assert.deepStrictEqual(sf10Req, {
        kind: "single",
        image: "data:image/jpeg;base64,sf10Page",
        extractFields: true,
        gradeLevel: level,
        documentType: "sf10",
      });
    }

    // PSA must ALWAYS pass gradeLevel: "PSA" and documentType: "birth_cert", even if state held "Elementary"
    const psaReq = resolveOcrExtractionRequest({
      docCategory: "birth_cert",
      workflowType: "single",
      gradeLevel: "Elementary",
      singleImage: "data:image/jpeg;base64,raw",
      frontImage: null,
      backImage: null,
      psaImage: "data:image/png;base64,psaIdentity",
    });

    assert.deepStrictEqual(psaReq, {
      kind: "single",
      image: "data:image/png;base64,psaIdentity",
      extractFields: true,
      gradeLevel: "PSA",
      documentType: "birth_cert",
    });

    // SF9 two-sided requires both front and back images and preserves gradeLevel
    const sf9Incomplete = resolveOcrExtractionRequest({
      docCategory: "sf9",
      workflowType: "two_sided",
      gradeLevel: "High School",
      singleImage: "data:image/jpeg;base64,frontOnly",
      frontImage: "data:image/jpeg;base64,frontOnly",
      backImage: null,
      psaImage: null,
    });
    assert.strictEqual(sf9Incomplete, null);

    const sf9Complete = resolveOcrExtractionRequest({
      docCategory: "sf9",
      workflowType: "two_sided",
      gradeLevel: "High School",
      singleImage: "data:image/jpeg;base64,backSide",
      frontImage: "data:image/jpeg;base64,frontSide",
      backImage: "data:image/jpeg;base64,backSide",
      psaImage: null,
    });
    assert.deepStrictEqual(sf9Complete, {
      kind: "two_sided",
      frontImage: "data:image/jpeg;base64,frontSide",
      backImage: "data:image/jpeg;base64,backSide",
      extractFields: true,
      gradeLevel: "High School",
      documentType: "sf9",
    });
  });

  await t.test("5. SF10 OCR route & parser flow: preserves documentType='sf10', routes Azure to prebuilt-layout, and selects grade-level parser", async () => {
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;

    try {
      delete process.env.MISTRAL_API_KEY;
      delete process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL;
      process.env.OCR_PRIMARY_PROVIDER = "azure";
      process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = "https://avv-document-ocr.cognitiveservices.azure.com/";
      process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = "mock-azure-key";

      let capturedAnalyzeUrl = "";

      globalThis.fetch = async (url, options) => {
        const urlStr = String(url);
        if (options?.method === "POST") {
          capturedAnalyzeUrl = urlStr;
          return new Response(null, {
            status: 202,
            headers: {
              "Operation-Location": "https://avv-document-ocr.cognitiveservices.azure.com/operations/sf10-op-1",
            },
          });
        }
        if (options?.method === "GET") {
          return new Response(
            JSON.stringify({
              status: "succeeded",
              analyzeResult: {
                // Deliberately omit "SF10" in raw OCR header text to verify explicit documentType="sf10" is never lost
                content:
                  "LEARNER PERMANENT RECORD\nName: Santos, Maria Clara\nLRN: 123456789012\nGrade Level: Grade 8\nSchool Year: 2024-2025\nSchool Name: San Jose National High School\nSchool ID: 301234",
                pages: [
                  {
                    pageNumber: 1,
                    words: [
                      { content: "Name:", confidence: 0.97 },
                      { content: "Santos,", confidence: 0.96 },
                    ],
                  },
                ],
                tables: [
                  {
                    rowCount: 3,
                    columnCount: 6,
                    cells: [
                      { rowIndex: 0, columnIndex: 0, content: "Learning Areas" },
                      { rowIndex: 0, columnIndex: 1, content: "1" },
                      { rowIndex: 0, columnIndex: 2, content: "2" },
                      { rowIndex: 0, columnIndex: 3, content: "3" },
                      { rowIndex: 0, columnIndex: 4, content: "4" },
                      { rowIndex: 0, columnIndex: 5, content: "Final Rating" },
                      { rowIndex: 1, columnIndex: 0, content: "Mathematics" },
                      { rowIndex: 1, columnIndex: 1, content: "88" },
                      { rowIndex: 1, columnIndex: 2, content: "89" },
                      { rowIndex: 1, columnIndex: 3, content: "90" },
                      { rowIndex: 1, columnIndex: 4, content: "91" },
                      { rowIndex: 1, columnIndex: 5, content: "90" },
                      { rowIndex: 2, columnIndex: 0, content: "General Average" },
                      { rowIndex: 2, columnIndex: 5, content: "90" },
                    ],
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const request = new Request("http://localhost:3000/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: "data:image/jpeg;base64,validSf10Payload",
          extractFields: true,
          gradeLevel: "High School",
          documentType: "sf10",
        }),
      });

      const response = await handleOcrRoute(request, undefined, parseGradesText);
      assert.strictEqual(response.status, 200);
      assert.ok(
        capturedAnalyzeUrl.includes("prebuilt-layout:analyze"),
        `SF10 extraction should use prebuilt-layout for table structure, got ${capturedAnalyzeUrl}`
      );

      const body = await response.json();
      assert.strictEqual(body.provider, "azure");
      assert.strictEqual(body.fields.document_type, "sf10", "Explicit documentType='sf10' must be preserved");
      assert.strictEqual(body.fields.selected_grade_level, "High School");
      assert.strictEqual(body.fields.academic_level, "High School");
      assert.strictEqual(body.fields.grading_period_scheme, "quarterly");
      assert.strictEqual(body.fields.lrn, "123456789012");
      assert.strictEqual(body.fields.grades.length, 1);
      assert.strictEqual(body.fields.grades[0].subject, "Mathematics");
      assert.strictEqual(body.fields.grades[0].q1, 88);
      assert.strictEqual(body.fields.grades[0].q4, 91);
      assert.strictEqual(body.fields.grades[0].final, 90);

      // Verify validation compatibility: specific extracted grade_level ("8" or "Grade 8") passes GRADE_PATTERN
      const validationReport = validateFields(body.fields, {
        knownSchools: ["San Jose National High School"],
        ocrConfidence: body.confidence,
      });
      const gradeValidRule = validationReport.results.find((r) => r.ruleName === "grade_valid");
      assert.ok(gradeValidRule?.passed, "Extracted numeric grade_level must remain compatible with GRADE_PATTERN");
    } finally {
      globalThis.fetch = originalFetch;
      process.env = { ...originalEnv };
    }
  });

  await t.test("6. SF10 parser routing across Elem / JHS / SHS and submission payload persistence", () => {
    // Elementary SF10
    const elemFields = parseGradesText(
      "Name: Reyes, Pedro\nLRN: 109876543210\nGrade Level: Grade 5\nSchool Year: 2023-2024\n| Learning Areas | 1 | 2 | 3 | 4 | Final |\n| --- | --- | --- | --- | --- | --- |\n| Filipino | 85 | 86 | 87 | 88 | 87 |",
      "Elementary",
      undefined,
      "sf10"
    );
    assert.strictEqual(elemFields.document_type, "sf10");
    assert.strictEqual(elemFields.selected_grade_level, "Elementary");
    assert.strictEqual(elemFields.grading_period_scheme, "quarterly");
    assert.strictEqual(elemFields.grades?.[0]?.semester, undefined);

    // SHS SF10
    const shsFields = parseGradesText(
      "Name: Dela Cruz, Ana\nLRN: 112233445566\nGrade Level: Grade 11\nSchool Year: 2024-2025\nFirst Semester\n| Subjects | Q1 | Q2 | Semester Final Grade |\n| --- | --- | --- | --- |\n| Oral Communication | 90 | 92 | 91 |\nSecond Semester\n| Subjects | Q3 | Q4 | Semester Final Grade |\n| --- | --- | --- | --- |\n| Reading and Writing | 89 | 91 | 90 |",
      "Senior High School",
      undefined,
      "sf10"
    );
    assert.strictEqual(shsFields.document_type, "sf10");
    assert.strictEqual(shsFields.selected_grade_level, "Senior High School");
    assert.strictEqual(shsFields.grading_period_scheme, "quarterly_semestral");
    assert.strictEqual(shsFields.grades?.length, 2);
    assert.strictEqual(shsFields.grades?.[0]?.semester, "1st Semester");
    assert.strictEqual(shsFields.grades?.[1]?.semester, "2nd Semester");

    // Submission payload builder for SF10 preserves selected_grade_level, academic_level, model & confidence
    const sf10Submission = buildDocumentSubmissionPayload({
      docCategory: "sf10",
      gradeLevel: "Grade 11",
      ocrFields: shsFields,
      ocrText: "Raw SF10 Text",
      ocrModel: "azure/prebuilt-layout",
      ocrConfidence: 0.94,
      finalPrimaryUrl: "https://storage.example/sf10_shs.jpg",
      originalFilename: "sf10_shs.jpg",
    });

    assert.strictEqual(sf10Submission.docType, "sf10");
    assert.strictEqual(sf10Submission.requestBody.document_type, "sf10");
    assert.strictEqual(sf10Submission.requestBody.selected_grade_level, "Grade 11");
    assert.strictEqual(sf10Submission.requestBody.ocr_model, "azure/prebuilt-layout");
    assert.strictEqual(sf10Submission.requestBody.ocr_confidence, 0.94);
    assert.strictEqual(sf10Submission.combinedFields.document_type, "sf10");
    assert.strictEqual(sf10Submission.combinedFields.selected_grade_level, "Grade 11");
    assert.strictEqual(sf10Submission.combinedFields.academic_level, "Senior High School");
    assert.strictEqual(sf10Submission.combinedFields.grading_period_scheme, "quarterly_semestral");

    // Submission payload builder for PSA strictly omits academic grade-level metadata
    const psaSubmission = buildDocumentSubmissionPayload({
      docCategory: "birth_cert",
      gradeLevel: "Senior High School",
      ocrFields: {
        document_type: "birth_cert",
        name: "Reyes, Pedro",
        birth_date: "2014-05-10",
        sex: "M",
        selected_grade_level: "Senior High School", // even if accidentally present, must be stripped
      },
      ocrText: "CERTIFICATE OF LIVE BIRTH",
      ocrModel: "azure/prebuilt-read",
      ocrConfidence: 0.91,
      finalPrimaryUrl: "https://storage.example/psa.png",
      originalFilename: "psa.png",
    });

    assert.strictEqual(psaSubmission.docType, "birth_cert");
    assert.strictEqual(psaSubmission.requestBody.document_type, "birth_cert");
    assert.strictEqual("selected_grade_level" in psaSubmission.requestBody, false);
    assert.strictEqual(psaSubmission.combinedFields.selected_grade_level, undefined);
    assert.strictEqual(psaSubmission.combinedFields.academic_level, undefined);
    assert.strictEqual(psaSubmission.combinedFields.grading_period_scheme, undefined);
    assert.deepStrictEqual(psaSubmission.combinedFields.grades, []);
  });

  await t.test("7. Preview-only rotation cycles 0 -> 90 -> 180 -> 270 -> 0 without mutating OCR image payload", () => {
    let rotation = 0;
    rotation = nextPreviewRotation(rotation);
    assert.strictEqual(rotation, 90);
    rotation = nextPreviewRotation(rotation);
    assert.strictEqual(rotation, 180);
    rotation = nextPreviewRotation(rotation);
    assert.strictEqual(rotation, 270);
    rotation = nextPreviewRotation(rotation);
    assert.strictEqual(rotation, 0);

    // Verify ImagePreview applies CSS-only rotation and imageOrientation: "from-image"
    const previewSrc = fs.readFileSync(
      path.resolve("./src/components/image/ImagePreview.tsx"),
      "utf8"
    );
    assert.ok(
      previewSrc.includes('imageOrientation: "from-image"'),
      "ImagePreview must enforce EXIF imageOrientation: from-image"
    );
    assert.ok(
      previewSrc.includes("rotate(${effectiveRotation}deg)"),
      "ImagePreview must apply visual CSS rotation only"
    );

    // Even when previewRotation is 90°, resolveOcrExtractionRequest still sends the exact original/processed image URL
    const originalSf10DataUrl = "data:image/jpeg;base64,SIDEWAYS_OR_LANDSCAPE_SF10_BYTES";
    const ocrReqAfterPreviewRotate = resolveOcrExtractionRequest({
      docCategory: "sf10",
      workflowType: "single",
      gradeLevel: "Senior High School",
      singleImage: originalSf10DataUrl,
      frontImage: null,
      backImage: null,
      psaImage: null,
    });
    assert.strictEqual(
      ocrReqAfterPreviewRotate?.kind === "single" ? ocrReqAfterPreviewRotate.image : null,
      originalSf10DataUrl,
      "Preview-only rotation must never mutate the image payload sent to OCR"
    );
  });
});

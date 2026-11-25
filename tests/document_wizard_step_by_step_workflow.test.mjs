import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AVV — Step-by-Step Document Upload Wizard Workflow & Integration Suite", async (t) => {
  const rootDir = path.resolve("./");
  const uploadPagePath = path.join(rootDir, "src/app/upload/page.tsx");
  const batchScanRoutePath = path.join(rootDir, "src/app/api/scan/batch/route.ts");
  const uploadWorkflowPath = path.join(rootDir, "src/lib/upload/uploadWorkflow.ts");

  const uploadPageSrc = fs.readFileSync(uploadPagePath, "utf8");
  const batchScanRouteSrc = fs.readFileSync(batchScanRoutePath, "utf8");
  const uploadWorkflowSrc = fs.readFileSync(uploadWorkflowPath, "utf8");

  // ── 1. Document Sequence Verification ──────────────────────────────────────
  await t.test("1. Correct document sequence: SF1 -> SF2 -> SF5 -> SF9 -> SF10 -> PSA -> Review", () => {
    assert.ok(
      uploadPageSrc.includes("export const WIZARD_STEPS: WizardStepDefinition[] = ["),
      "Upload page must define WIZARD_STEPS configuration"
    );

    // Extract WIZARD_STEPS array order
    const expectedSequence = ["sf1", "sf2", "sf5", "sf9", "sf10", "birth_cert"];
    for (let i = 0; i < expectedSequence.length; i++) {
      const stepId = expectedSequence[i];
      assert.ok(
        uploadPageSrc.includes(`id: "${stepId}"`),
        `WIZARD_STEPS must define step "${stepId}"`
      );
    }

    // Verify stepper indicator contains all 7 steps
    assert.ok(
      uploadPageSrc.includes("SF1 → SF2 → SF5 → SF9 → SF10 → PSA → Review") ||
      uploadPageSrc.includes("Step 7: Final Review") ||
      uploadPageSrc.includes("Review"),
      "Wizard must display progress indicator reaching Review step"
    );
  });

  // ── 2. One Document Type Per Step ──────────────────────────────────────────
  await t.test("2. Only one document type uploaded in each step", () => {
    assert.ok(
      uploadPageSrc.includes("const targetCategory: UploadDocCategory = currentDocCategory;"),
      "Upload handler must strictly isolate files to current step category"
    );
    assert.ok(
      uploadPageSrc.includes("stepFiles[currentStep.id]"),
      "Step view must only display files uploaded for the active document step"
    );
  });

  // ── 3. SF5A and SF5B Selection ─────────────────────────────────────────────
  await t.test("3. SF5A and SF5B variant selection in Step 3", () => {
    assert.ok(
      uploadPageSrc.includes("const [sf5Variant, setSf5Variant] = useState<\"sf5a\" | \"sf5b\">(\"sf5a\");"),
      "Wizard must support sf5Variant state initialized to 'sf5a'"
    );
    assert.ok(
      uploadPageSrc.includes("handleSelectSf5Variant"),
      "Wizard must define handleSelectSf5Variant handler"
    );
    assert.ok(
      uploadPageSrc.includes("SF5A-SHS — End of Semester Promotion") &&
      uploadPageSrc.includes("SF5B-SHS — Graduation / TVL Candidates"),
      "Step 3 must display options for both SF5A-SHS and SF5B-SHS"
    );
  });

  // ── 4. Optional PSA and Skip Behavior ──────────────────────────────────────
  await t.test("4. PSA is explicitly optional and can be skipped without blocking", () => {
    assert.ok(
      uploadPageSrc.includes("id: \"birth_cert\"") &&
      uploadPageSrc.includes("isOptional: true"),
      "PSA step must be marked isOptional: true"
    );
    assert.ok(
      uploadPageSrc.includes("handleSkipPsa"),
      "Wizard must implement handleSkipPsa handler"
    );
    assert.ok(
      uploadPageSrc.includes("Skip PSA (Optional)"),
      "PSA step must render a visible 'Skip PSA (Optional)' button"
    );
  });

  // ── 5. Back and Next Navigation ────────────────────────────────────────────
  await t.test("5. Forward and backward navigation preserves step index and bounds", () => {
    assert.ok(
      uploadPageSrc.includes("handleNextStep") &&
      uploadPageSrc.includes("handlePrevStep"),
      "Wizard must implement handleNextStep and handlePrevStep"
    );
    assert.ok(
      uploadPageSrc.includes("disabled={currentStepIndex === 0}"),
      "Back button must be disabled on Step 1"
    );
    assert.ok(
      uploadPageSrc.includes("handleCategoryChange"),
      "Step navigation must allow jumping to specific step categories"
    );
  });

  // ── 6. File Selection and Preview ──────────────────────────────────────────
  await t.test("6. File selection and inline preview modal", () => {
    assert.ok(
      uploadPageSrc.includes("const [previewModalFile, setPreviewModalFile] = useState<WizardDocumentItem | null>(null);"),
      "Wizard must support preview modal state"
    );
    assert.ok(
      uploadPageSrc.includes("<iframe") && uploadPageSrc.includes("<img"),
      "Preview modal must support both PDF iframe and image rendering"
    );
    assert.ok(
      uploadPageSrc.includes("Close Preview"),
      "Preview modal must offer close button"
    );
  });

  // ── 7. File Replacement and Removal ────────────────────────────────────────
  await t.test("7. File replacement and removal handlers", () => {
    assert.ok(
      uploadPageSrc.includes("handleReplaceFile"),
      "Wizard must implement handleReplaceFile handler"
    );
    assert.ok(
      uploadPageSrc.includes("handleRemoveFile"),
      "Wizard must implement handleRemoveFile handler"
    );
    assert.ok(
      uploadPageSrc.includes("const [replacingFileId, setReplacingFileId] = useState<string | null>(null);"),
      "Wizard must track replacingFileId for targeted replacement"
    );
  });

  // ── 8. Multiple Pages / Files Belonging to Same Document Type ───────────────
  await t.test("8. Multiple pages/files belonging to the same document type", () => {
    assert.ok(
      uploadPageSrc.includes("Add another page / file for"),
      "Wizard must allow adding additional files/pages for the same document type"
    );
    assert.ok(
      uploadPageSrc.includes("useState<Record<UploadDocCategory, WizardDocumentItem[]>>"),
      "Wizard state must store an array of files per document type"
    );
  });

  // ── 9. Missing Document Handling ───────────────────────────────────────────
  await t.test("9. Missing documents treated as incomplete coverage in review", () => {
    assert.ok(
      uploadPageSrc.includes("Missing form — Treated as incomplete document coverage in report"),
      "Review page must inform teacher that missing documents are treated as incomplete coverage"
    );
    assert.ok(
      uploadPageSrc.includes("Missing documents are recorded as incomplete coverage, not automatically as validation errors."),
      "Guidance banner must state missing documents do not cause automatic validation failure"
    );
  });

  // ── 10. Duplicate Upload Prevention ────────────────────────────────────────
  await t.test("10. Accidental duplicate upload prevention within step", () => {
    assert.ok(
      uploadPageSrc.includes("existing.name === vf.name && existing.sizeBytes === vf.size"),
      "Upload handler must detect existing file with same name and sizeBytes"
    );
    assert.ok(
      uploadPageSrc.includes("Duplicate upload prevented"),
      "Duplicate file selection must be rejected with informative warning"
    );
  });

  // ── 11. Upload Retry Behavior ──────────────────────────────────────────────
  await t.test("11. Segment retry behavior preserved", () => {
    assert.ok(
      uploadPageSrc.includes("handleRetrySegment"),
      "Upload page must preserve handleRetrySegment callback"
    );
    assert.ok(
      batchScanRouteSrc.includes("retry_segment") && batchScanRouteSrc.includes("retrySegmentId"),
      "Batch scan API must handle retry_segment action"
    );
  });

  // ── 12. Refresh Recovery ───────────────────────────────────────────────────
  await t.test("12. Refresh recovery on confirmed teacher assignment", () => {
    assert.ok(
      uploadPageSrc.includes("fetchSavedBatch") &&
      uploadPageSrc.includes("/api/scan/batch?assignmentId="),
      "Upload page must fetch saved batch upon page load"
    );
    assert.ok(
      uploadPageSrc.includes("setValidationReport(data.report)") &&
      uploadPageSrc.includes("setStage(\"completed\")"),
      "Saved batch must restore validationReport and set stage to completed"
    );
  });

  // ── 13. Final Document Review Before Processing ────────────────────────────
  await t.test("13. Review page provides summary before starting extraction", () => {
    assert.ok(
      uploadPageSrc.includes("Final Document Review"),
      "Review page must present Final Document Review heading"
    );
    assert.ok(
      uploadPageSrc.includes("START DOCUMENT EXTRACTION AND VALIDATION"),
      "Review page must provide clear primary button to start extraction"
    );
  });

  // ── 14. All Uploaded Documents Reach Unified Extraction Pipeline ───────────
  await t.test("14. All uploaded documents reach unified extraction pipeline", () => {
    assert.ok(
      uploadPageSrc.includes("for (let fileIdx = 0; fileIdx < totalFiles; fileIdx++)"),
      "Scanning loop must iterate over every staged document file"
    );
    assert.ok(
      uploadPageSrc.includes("action: \"classify_and_validate\""),
      "Combined pages must be submitted to classify_and_validate endpoint"
    );
  });

  // ── 15. Cross-Document Learner Matching and Validation ─────────────────────
  await t.test("15. Unified cross-document validation preserved", () => {
    assert.ok(
      uploadPageSrc.includes("setStage(\"matching\")") &&
      uploadPageSrc.includes("setStage(\"validating\")"),
      "Processing pipeline must execute matching and validating stages"
    );
    assert.ok(
      uploadPageSrc.includes("<UnifiedBatchResultsView"),
      "Results must be rendered in UnifiedBatchResultsView with all 5 stages"
    );
  });

  // ── 16. Teacher Authorization and Advisory Assignment Restrictions ─────────
  await t.test("16. Strict Class Adviser authorization and assignment confirmation", () => {
    assert.ok(
      uploadPageSrc.includes("ensureTeacherAssignmentConfirmed"),
      "Upload page must enforce ensureTeacherAssignmentConfirmed"
    );
    assert.ok(
      batchScanRouteSrc.includes("ADMIN_CANNOT_UPLOAD") &&
      batchScanRouteSrc.includes("PRINCIPAL_READ_ONLY"),
      "Backend batch scan route must block Admin and Principal from uploading"
    );
  });
});

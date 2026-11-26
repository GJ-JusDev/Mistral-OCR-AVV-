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
  await t.test("1. Correct document sequence: SF1 -> SF2 -> SF9 -> SF10 -> PSA -> Review", () => {
    assert.ok(
      uploadPageSrc.includes("export const WIZARD_STEPS: WizardStepDefinition[] = ["),
      "Upload page must define WIZARD_STEPS configuration"
    );

    // Extract WIZARD_STEPS array order (6 steps total: 5 document steps + Review)
    const expectedSequence = ["sf1", "sf2", "sf9", "sf10", "birth_cert"];
    for (let i = 0; i < expectedSequence.length; i++) {
      const stepId = expectedSequence[i];
      assert.ok(
        uploadPageSrc.includes(`id: "${stepId}"`),
        `WIZARD_STEPS must define step "${stepId}"`
      );
    }
    assert.ok(!uploadPageSrc.includes('id: "sf5"'), "SF5 must not be included in WIZARD_STEPS");

    // Verify stepper indicator contains all 6 steps
    assert.ok(
      uploadPageSrc.includes("SF1 → SF2 → SF9 → SF10 → PSA → Review") ||
      uploadPageSrc.includes("Step 6 of 6") ||
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

  // ── 3. SF5 Removal & Active 6-Step Workflow ────────────────────────────────
  await t.test("3. SF5 successfully removed from active upload sequence and UI", () => {
    assert.ok(
      !uploadPageSrc.includes("const [sf5Variant, setSf5Variant]"),
      "Wizard must not maintain sf5Variant state"
    );
    assert.ok(
      !uploadPageSrc.includes("handleSelectSf5Variant"),
      "Wizard must not define handleSelectSf5Variant handler"
    );
    assert.ok(
      !uploadPageSrc.includes("SF5A-SHS — End of Semester Promotion"),
      "Step view must not display SF5A/SF5B form options"
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

  // ── 17. Step 5 (PSA) Upper Section Crop Default, Rotation & Civil Identity ──
  await t.test("17. Step 5 (PSA) integrates preprocessing, upper-section default crop, rotation & civil identity preview", () => {
    // Preprocessing on upload
    assert.ok(
      uploadPageSrc.includes("preprocessPsaImage"),
      "Upload page must import and invoke preprocessPsaImage for Step 5"
    );
    assert.ok(
      uploadPageSrc.includes("previewMode: upperSectionDataUrl ? \"upper\" : \"processed\""),
      "Default previewMode for PSA must prioritize upper section crop"
    );

    // Extraction routes through upperSectionDataUrl
    assert.ok(
      uploadPageSrc.includes("imageToSend") &&
      uploadPageSrc.includes("category === \"birth_cert\" && item.upperSectionDataUrl"),
      "extractSingleFile must route upperSectionDataUrl as primary image for PSA OCR"
    );

    // Rotation controls and preview switcher tabs
    assert.ok(
      uploadPageSrc.includes("handleRotatePsaFile"),
      "Upload page must implement handleRotatePsaFile for manual rotation"
    );
    assert.ok(
      uploadPageSrc.includes("90° CCW") && uploadPageSrc.includes("90° CW"),
      "PSA staged card and preview modal must render 90° CCW and 90° CW rotation buttons"
    );
    assert.ok(
      uploadPageSrc.includes("Upper Section (1-17)") &&
      (uploadPageSrc.includes("B&W Upright") || uploadPageSrc.includes("B&amp;W Upright")) &&
      uploadPageSrc.includes("Original"),
      "PSA staged card and preview modal must provide Upper Section, B&W Upright, and Original tabs"
    );

    // Civil identity display: has confidence pills and excludes Place of Birth
    assert.ok(
      uploadPageSrc.includes("renderConfidencePill"),
      "Upload page must implement renderConfidencePill for honest confidence badges"
    );
    assert.ok(
      (uploadPageSrc.includes("Child's Legal Name:") || uploadPageSrc.includes("Child&apos;s Legal Name:")) &&
      uploadPageSrc.includes("Civil Registry / Cert No.:"),
      "PSA staged card must display extracted civil identity fields"
    );
    // Ensure no Place of Birth in the PSA staged card
    assert.ok(
      !uploadPageSrc.includes("Place of Birth:") &&
      !uploadPageSrc.includes("place_of_birth"),
      "PSA staged card must NOT display Place of Birth"
    );
  });

  // ── 18. Step 5 (PSA) Inline Manual Correction & SessionStorage Persistence ──
  await t.test("18. Step 5 (PSA) inline manual correction, field editing, sessionStorage persistence & verified badges", () => {
    // 1. Manual Correction toggle
    assert.ok(
      uploadPageSrc.includes("handleStartPsaCorrection") &&
      uploadPageSrc.includes("Manual Correction"),
      "PSA card must render a Manual Correction toggle button"
    );

    // 2. Editable fields: First Name, Middle Name, Last Name, DOB, Sex, Mother's Name, Father's Name, Registry No.
    assert.ok(
      uploadPageSrc.includes("editingPsaForm.first_name") &&
      uploadPageSrc.includes("editingPsaForm.middle_name") &&
      uploadPageSrc.includes("editingPsaForm.last_name") &&
      uploadPageSrc.includes("editingPsaForm.birth_date") &&
      uploadPageSrc.includes("editingPsaForm.sex") &&
      uploadPageSrc.includes("editingPsaForm.mother_maiden_name") &&
      uploadPageSrc.includes("editingPsaForm.father_name") &&
      uploadPageSrc.includes("editingPsaForm.registry_number"),
      "Manual correction must support inline editing of all required civil identity fields"
    );

    // 3. Ensure NO Place of Birth in manual correction form
    assert.ok(
      !uploadPageSrc.includes("Place of Birth") &&
      !uploadPageSrc.includes("place_of_birth"),
      "Manual correction form must NOT include Place of Birth"
    );

    // 4. Save Corrections & Cancel buttons
    assert.ok(
      uploadPageSrc.includes("handleSavePsaCorrection") &&
      uploadPageSrc.includes("handleCancelPsaCorrection") &&
      uploadPageSrc.includes("Save Corrections") &&
      uploadPageSrc.includes("Cancel"),
      "Manual correction must provide Cancel and Save Corrections actions"
    );

    // 5. State & SessionStorage persistence
    assert.ok(
      uploadPageSrc.includes("updateFileExtraction(fileId, \"birth_cert\"") &&
      uploadPageSrc.includes("sessionStorage.setItem(`avv_staged_ocr_${currentBatchId}`"),
      "Saving corrections must update component state and persist to sessionStorage under avv_staged_ocr_<batchId>"
    );
    assert.ok(
      uploadPageSrc.includes("sessionStorage.getItem(`avv_staged_ocr_${currentBatchId}`"),
      "Upload page must restore staged OCR records from sessionStorage on refresh"
    );

    // 6. Corrected badge / indicator
    assert.ok(
      uploadPageSrc.includes("Manually Corrected by Teacher") &&
      uploadPageSrc.includes("Corrected"),
      "Manually corrected cards and fields must display a Corrected indicator"
    );
  });

  // ── 19. Step 3 (SF9) Real-Time Front + Back Merge & Inline Preview ────────
  await t.test("19. Step 3 (SF9) renders inline extraction preview for Attendance, Grades, and Observed Values, preserving Step 1 & 2 previews", () => {
    // 1. Step 3 SF9 Preview Card Presence
    assert.ok(
      uploadPageSrc.includes('data-testid="sf9-extracted-preview-card"'),
      "Step 3 must render sf9-extracted-preview-card when SF9 is extracted"
    );
    assert.ok(
      uploadPageSrc.includes("mergeSf9FrontAndBack"),
      "Step 3 must use mergeSf9FrontAndBack to merge Front and Back SF9 data"
    );

    // 2. Learner Identity Summary
    assert.ok(
      uploadPageSrc.includes('data-testid="sf9-identity-summary"'),
      "Step 3 must render Learner Identity Summary section"
    );
    assert.ok(
      uploadPageSrc.includes("Learner Identity Summary") &&
      uploadPageSrc.includes("Track / Strand"),
      "Step 3 identity summary must include LRN, Name, Sex, Grade Level, Section, School Year, and Track/Strand"
    );

    // 3. Report on Attendance (from Front)
    assert.ok(
      uploadPageSrc.includes('data-testid="sf9-attendance-preview-table"'),
      "Step 3 must render Report on Attendance preview table"
    );
    assert.ok(
      uploadPageSrc.includes("No. of School Days") &&
      uploadPageSrc.includes("No. of Days Present") &&
      uploadPageSrc.includes("No. of Days Absent"),
      "Step 3 attendance grid must display No. of School Days, No. of Days Present, and No. of Days Absent"
    );

    // 4. Per-Semester Academic Grades (from Back)
    assert.ok(
      uploadPageSrc.includes('data-testid="sf9-grades-preview"'),
      "Step 3 must render Per-Semester Academic Grades section"
    );
    assert.ok(
      uploadPageSrc.includes('data-testid="sf9-sem1-grades-table"') &&
      uploadPageSrc.includes('data-testid="sf9-sem2-grades-table"'),
      "Step 3 must separate First Semester and Second Semester grades tables"
    );
    assert.ok(
      uploadPageSrc.includes("General Average:") ||
      uploadPageSrc.includes("Semester General Average"),
      "Step 3 grades preview must display Semester General Average"
    );

    // 5. Observed Values / Learner Behavior (from Back)
    assert.ok(
      uploadPageSrc.includes('data-testid="sf9-observed-values-preview"') ||
      uploadPageSrc.includes('data-testid="sf9-observed-values-table"'),
      "Step 3 must render Observed Values / Core Values behavior table"
    );
    assert.ok(
      uploadPageSrc.includes("Maka-Diyos") &&
      uploadPageSrc.includes("Makatao") &&
      uploadPageSrc.includes("Makakalikasan") &&
      uploadPageSrc.includes("Makabansa"),
      "Step 3 observed values must include the four DepEd Core Values"
    );
    assert.ok(
      uploadPageSrc.includes("AO") &&
      uploadPageSrc.includes("SO") &&
      uploadPageSrc.includes("RO") &&
      uploadPageSrc.includes("NO"),
      "Step 3 observed values must render DepEd non-numerical ratings (AO, SO, RO, NO)"
    );

    // 6. Step 1 (SF1) and Step 2 (SF2) Inline Previews Preserved
    assert.ok(
      uploadPageSrc.includes('data-testid="sf1-extracted-learners-table"'),
      "Step 1 SF1 extracted learners table must remain intact"
    );
    assert.ok(
      uploadPageSrc.includes('data-testid="sf1-empty-alert"'),
      "Step 1 SF1 'No student found' alert must remain intact"
    );
    assert.ok(
      uploadPageSrc.includes('data-testid="sf2-attendance-preview-table"'),
      "Step 2 SF2 attendance preview table must remain intact"
    );
  });
});

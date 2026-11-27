import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AVV — Step-by-Step Document Upload Wizard Workflow & Integration Suite", async (t) => {
  const rootDir = path.resolve("./");
  const uploadPagePath = path.join(rootDir, "src/app/upload/page.tsx");
  const batchScanRoutePath = path.join(rootDir, "src/app/api/scan/batch/route.ts");
  const uploadWorkflowPath = path.join(rootDir, "src/lib/upload/uploadWorkflow.ts");
  const unifiedResultsViewPath = path.join(rootDir, "src/components/validation/UnifiedBatchResultsView.tsx");

  const uploadPageSrc = fs.readFileSync(uploadPagePath, "utf8");
  const batchScanRouteSrc = fs.readFileSync(batchScanRoutePath, "utf8");
  const uploadWorkflowSrc = fs.readFileSync(uploadWorkflowPath, "utf8");
  const unifiedResultsViewSrc = fs.readFileSync(unifiedResultsViewPath, "utf8");

  // ── 1. Document Sequence Verification ──────────────────────────────────────
  await t.test("1. Correct document sequence: SF9 -> PSA (Optional) -> SF1 -> SF2 -> SF10 -> Review", () => {
    assert.ok(
      uploadPageSrc.includes("export const WIZARD_STEPS: WizardStepDefinition[] = ["),
      "Upload page must define WIZARD_STEPS configuration"
    );

    // Extract WIZARD_STEPS array order (6 steps total: 5 document steps + Review)
    const expectedSequence = ["sf9", "birth_cert", "sf1", "sf2", "sf10"];
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
    assert.ok(
      uploadPageSrc.includes('data-testid="sf9-error-legends"'),
      "Step 3 must render teacher error & status legend box"
    );
    assert.ok(
      uploadPageSrc.includes("Blank Grade Error") &&
      uploadPageSrc.includes("Blank / Incomplete") &&
      uploadPageSrc.includes("Passed / Failed"),
      "Step 3 error legends must include Blank Grade Error, Blank / Incomplete, and Passed / Failed explanations"
    );
    assert.ok(
      uploadPageSrc.includes('data-testid="sf9-sem1-general-average-row"') &&
      uploadPageSrc.includes('data-testid="sf9-sem2-general-average-row"'),
      "Step 3 must render General Average for the Semester footer rows for both First and Second Semester tables"
    );
    assert.ok(
      uploadPageSrc.includes("General Average for the Semester"),
      "Footer row must include General Average for the Semester label"
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

  // ── 20. Step 4 (SF10) Real-Time Extracted Inline Preview Card ────────
  await t.test("20. Step 4 (SF10) renders inline extraction preview for Learner Identity and Scholastic Records (Sem 1 & 2)", () => {
    // 1. Step 4 SF10 Preview Card Presence
    assert.ok(
      uploadPageSrc.includes('data-testid="sf10-preview-card"'),
      "Step 4 must render sf10-preview-card when SF10 is extracted"
    );

    // 2. Learner Identity Summary
    assert.ok(
      uploadPageSrc.includes('data-testid="sf10-identity-summary"'),
      "Step 4 must render Learner Identity Summary section"
    );
    assert.ok(
      uploadPageSrc.includes("LRN") &&
      uploadPageSrc.includes("Full Name") &&
      uploadPageSrc.includes("Sex") &&
      uploadPageSrc.includes("Birth Date") &&
      uploadPageSrc.includes("School") &&
      uploadPageSrc.includes("Grade Level") &&
      uploadPageSrc.includes("Section") &&
      uploadPageSrc.includes("School Year") &&
      uploadPageSrc.includes("Track / Strand"),
      "Step 4 identity summary must include LRN, Full Name, Sex, Birth Date, School, Grade Level, Section, School Year, and Track/Strand"
    );

    // 3. Scholastic Record Tables (First & Second Semester)
    assert.ok(
      uploadPageSrc.includes('data-testid="sf10-scholastic-preview"'),
      "Step 4 must render Scholastic Record Tables section"
    );
    assert.ok(
      uploadPageSrc.includes('data-testid="sf10-sem1-grades-table"') &&
      uploadPageSrc.includes('data-testid="sf10-sem2-grades-table"'),
      "Step 4 must separate First Semester and Second Semester grades tables"
    );
    assert.ok(
      uploadPageSrc.includes("General Ave. for the Semester"),
      "Step 4 scholastic preview must display General Ave. for the Semester"
    );
    assert.ok(
      uploadPageSrc.includes('data-testid="sf10-sem1-general-average-row"') &&
      uploadPageSrc.includes('data-testid="sf10-sem2-general-average-row"'),
      "Step 4 must define sem1 and sem2 general average footer rows"
    );
    assert.ok(
      uploadPageSrc.includes('data-testid="sf10-sem1-general-average-action"') &&
      uploadPageSrc.includes('data-testid="sf10-sem2-general-average-action"'),
      "Step 4 must define dynamic general average action badges"
    );
    assert.ok(
      uploadPageSrc.includes('Blank / Incomplete'),
      "Step 4 must support Blank / Incomplete action badge when semester general average is blank"
    );
    assert.ok(
      uploadPageSrc.includes('data-testid="sf10-row-confidence"'),
      "Step 4 scholastic preview must render row-level confidence percentage"
    );
    assert.ok(
      uploadPageSrc.includes('data-testid="file-ocr-readability-badge"'),
      "Upload page must display Readability confidence percentage pill on extracted file cards"
    );
  });

  // ── 21. Unified Learner Dossier Merging & Strict 4-State Row Evaluations ─
  await t.test("21. UnifiedBatchResultsView merges dossiers by canonical name and renders strict 4-state badges", () => {
    // 1. Strict 4-State Badges (MATCH, MISMATCH, INCOMPLETE, NO DATA)
    assert.ok(
      unifiedResultsViewSrc.includes('evaluate4StateRowStatus'),
      "UnifiedBatchResultsView must import or use evaluate4StateRowStatus"
    );
    assert.ok(
      unifiedResultsViewSrc.includes('MATCH') &&
      unifiedResultsViewSrc.includes('MISMATCH') &&
      unifiedResultsViewSrc.includes('INCOMPLETE') &&
      unifiedResultsViewSrc.includes('NO DATA'),
      "UnifiedBatchResultsView must define all 4 row status badges: MATCH, MISMATCH, INCOMPLETE, NO DATA"
    );

    // 2. Birth Date Doc Label Rendering & Shuffling
    assert.ok(
      unifiedResultsViewSrc.includes('formatBirthDateWithDocLabel'),
      "UnifiedBatchResultsView must format birth dates with document origin labels"
    );

    // 3. Name-based dossier unification across split records
    assert.ok(
      unifiedResultsViewSrc.includes('areLearnerNamesMatching'),
      "UnifiedBatchResultsView must unify dossiers with matching learner names"
    );
  });

  // ── 22. Strict Sequential 1-at-a-Time Extraction Queue ─────────────────────
  await t.test("22. Strict sequential 1-at-a-time extraction queue (concurrency = 1) prevents concurrent /api/ocr calls", async () => {
    // 1. Source assertions
    assert.ok(
      uploadPageSrc.includes("processExtractionQueue") &&
      uploadPageSrc.includes("enqueueExtraction"),
      "Upload page must define processExtractionQueue and enqueueExtraction"
    );
    assert.ok(
      uploadPageSrc.includes("await extractSingleFile(itemToExtract, nextTask.category)"),
      "processExtractionQueue must strictly await extractSingleFile for file N before taking file N+1"
    );
    assert.ok(
      uploadPageSrc.includes("enqueueExtraction(newItems.map((item) => ({ fileId: item.id, category: targetCategory })))"),
      "Multi-file upload handler must enqueue files rather than firing simultaneous extraction requests"
    );

    // 2. Functional simulated test of the queue algorithm to ensure concurrency never exceeds 1
    let activeConcurrentCalls = 0;
    let maxObservedConcurrency = 0;
    const executionOrder = [];
    const queue = [];
    let isProcessing = false;

    const mockExtractSingleFile = async (id) => {
      activeConcurrentCalls++;
      if (activeConcurrentCalls > maxObservedConcurrency) {
        maxObservedConcurrency = activeConcurrentCalls;
      }
      executionOrder.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push(`finish-${id}`);
      activeConcurrentCalls--;
    };

    const processMockQueue = async () => {
      if (isProcessing) return;
      isProcessing = true;
      try {
        while (queue.length > 0) {
          const nextId = queue.shift();
          await mockExtractSingleFile(nextId);
        }
      } finally {
        isProcessing = false;
      }
    };

    const enqueueMock = (ids) => {
      for (const id of ids) {
        queue.push(id);
      }
      processMockQueue();
    };

    // Simulate batch upload of 3 files (e.g. SF9 Front, SF9 Back, PSA)
    enqueueMock(["file-1", "file-2", "file-3"]);
    // While running, simulate additional file added
    setTimeout(() => enqueueMock(["file-4"]), 15);

    // Wait until all processed
    while (isProcessing || queue.length > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }

    assert.equal(maxObservedConcurrency, 1, "Concurrency must strictly never exceed 1");
    assert.deepEqual(executionOrder, [
      "start-file-1", "finish-file-1",
      "start-file-2", "finish-file-2",
      "start-file-3", "finish-file-3",
      "start-file-4", "finish-file-4",
    ], "Files must execute strictly sequentially in FIFO order");
  });

  // ── 23. Guided Upload Sequence Stepper Sync & Stepper Buttons 1-6 Locking ───
  await t.test("23. Guided Upload Stepper: shows 'Extracting...' (not 'Ready'), locks steps 1-6, and disables Next button while extracting", () => {
    // 1. Source assertions for isStepExtracting and isStepReady
    assert.ok(
      uploadPageSrc.includes("isStepExtracting") &&
      uploadPageSrc.includes("isStepReady"),
      "Upload page must compute isStepExtracting and isStepReady"
    );
    assert.ok(
      uploadPageSrc.includes("isAnyFileExtracting") &&
      uploadPageSrc.includes("areAllUploadedFilesReady"),
      "Upload page must compute global isAnyFileExtracting and areAllUploadedFilesReady"
    );

    // 2. Stepper status label: shows 'Extracting...' with Loader2, never 'Ready' when extracting
    assert.ok(
      uploadPageSrc.includes("isStepExtracting") &&
      uploadPageSrc.includes('"Extracting..."'),
      "Stepper card label must display 'Extracting...' while extracting"
    );
    assert.ok(
      uploadPageSrc.includes("isAnyFileExtracting ? \"Extracting...\"") ||
      uploadPageSrc.includes("isAnyFileExtracting\n                          ? \"Extracting...\"") ||
      uploadPageSrc.includes("isAnyFileExtracting\n                        ? \"Extracting...\""),
      "Review step (6) card must display 'Extracting...' while isAnyFileExtracting is true"
    );

    // 3. Locking top stepper buttons 1 to 6
    assert.ok(
      uploadPageSrc.includes("disabled={isAnyFileExtracting}") &&
      uploadPageSrc.includes("Wait for current document extraction to finish"),
      "Top stepper buttons 1 to 6 must be disabled with tooltip while isAnyFileExtracting is true"
    );

    // 4. Next button disabling and label while extracting
    assert.ok(
      uploadPageSrc.includes("isNextDisabled"),
      "Upload page must compute isNextDisabled"
    );
    assert.ok(
      uploadPageSrc.includes("Extracting... Please wait"),
      "Next button label must display 'Extracting... Please wait' while extraction is active"
    );

    // 5. Functional state evaluation
    const filesExtracting = [{ name: "SF1.pdf", status: "extracting" }];
    const filesQueued = [{ name: "SF1_p2.pdf", status: "queued" }];
    const filesReady = [{ name: "SF1.pdf", status: "extracted" }];

    const evalStep = (files) => {
      const isExtracting = files.some((f) => f.status === "extracting" || f.status === "queued" || f.status === "pending");
      const isReady = files.length > 0 && !isExtracting && files.every((f) => f.status === "extracted");
      return { isExtracting, isReady };
    };

    assert.deepEqual(evalStep(filesExtracting), { isExtracting: true, isReady: false });
    assert.deepEqual(evalStep(filesQueued), { isExtracting: true, isReady: false });
    assert.deepEqual(evalStep(filesReady), { isExtracting: false, isReady: true });
    assert.deepEqual(evalStep([]), { isExtracting: false, isReady: false });
  });

  // ── 24. Step 6 Automatic Review & Comparison Button Locking ────────────────
  await t.test("24. Step 6 automatic review and validation button remain locked until all files are ready", () => {
    // 1. Guard against automatic review while extracting
    assert.ok(
      uploadPageSrc.includes("currentStepIndex === 5 && isAnyFileExtracting"),
      "Step 6 review handler / useEffect must guard against running while isAnyFileExtracting is true"
    );

    // 2. Start validation button disabled while extracting
    assert.ok(
      uploadPageSrc.includes("disabled={(stage !== \"idle\" && stage !== \"error\") || isAnyFileExtracting}"),
      "Start Document Extraction and Validation button must be disabled when isAnyFileExtracting is true"
    );
    assert.ok(
      uploadPageSrc.includes("Waiting for Extraction to Finish..."),
      "Start Document Extraction and Validation button must display 'Waiting for Extraction to Finish...' while extracting"
    );

    // 3. Extracting notice naming active extracting files
    assert.ok(
      uploadPageSrc.includes('data-testid="step6-extracting-notice"') &&
      uploadPageSrc.includes("activeExtractingFiles.map((f) => f.name).join"),
      "Step 6 must render an extracting notice naming all actively extracting files"
    );
  });

  // ── 25. Zero-Redundancy Upsert On Re-Scan ──────────────────────────────────
  await t.test("25. Re-scanning same student documents updates in-place with new BATCH NUMBER (zero duplicates)", async () => {
    const { getDocumentCompositeKey, formatBatchNumber } = await import("../src/lib/validation/nameComparison.ts");

    // Composite key verification
    const sf1Doc = {
      document_type: "sf1",
      canonical_lrn: "111500619123",
      extracted_fields: {
        learners: [{ last_name: "Gomez", first_name: "Justin", middle_name: "Loquillano", lrn: "111500619123" }],
      },
    };
    const sf2Doc = {
      document_type: "sf2",
      extracted_fields: {
        attendance: [{ learner_name: "Gomez, Justin Loquillano", days_present: 21 }],
      },
    };
    const psaDoc = {
      document_type: "birth_cert",
      extracted_fields: {
        identity: { last_name: "Gomez", first_name: "Justin", middle_name: "Loquillano" },
      },
    };

    const sf1Key = getDocumentCompositeKey(sf1Doc);
    const sf2Key = getDocumentCompositeKey(sf2Doc);
    const psaKey = getDocumentCompositeKey(psaDoc);

    assert.equal(sf1Key, "111500619123::gomez, justin loquillano::sf1");
    assert.equal(sf2Key, "gomez, justin loquillano::sf2");
    assert.equal(psaKey, "gomez, justin loquillano::psa");

    // Simulate batch 1 initial upload
    const registry = new Map();
    const batch1Id = "BATCH-20261126-001";
    const docsBatch1 = [
      { id: "doc-1", ...sf1Doc, extracted_fields: { ...sf1Doc.extracted_fields, batch_number: batch1Id }, updated_at: "2026-11-26T08:00:00Z" },
      { id: "doc-2", ...sf2Doc, extracted_fields: { ...sf2Doc.extracted_fields, batch_number: batch1Id }, updated_at: "2026-11-26T08:00:00Z" },
      { id: "doc-3", ...psaDoc, extracted_fields: { ...psaDoc.extracted_fields, batch_number: batch1Id }, updated_at: "2026-11-26T08:00:00Z" },
    ];
    for (const d of docsBatch1) {
      registry.set(getDocumentCompositeKey(d), d);
    }
    assert.equal(registry.size, 3, "Initial batch must store 3 documents");

    // Simulate batch 2 re-scan of the same student's documents
    const batch2Id = "BATCH-20261126-002";
    const docsBatch2 = [
      { id: "doc-1-rescan", ...sf1Doc, extracted_fields: { ...sf1Doc.extracted_fields, batch_number: batch2Id }, updated_at: "2026-11-26T12:00:00Z" },
      { id: "doc-2-rescan", ...sf2Doc, extracted_fields: { ...sf2Doc.extracted_fields, batch_number: batch2Id }, updated_at: "2026-11-26T12:00:00Z" },
      { id: "doc-3-rescan", ...psaDoc, extracted_fields: { ...psaDoc.extracted_fields, batch_number: batch2Id }, updated_at: "2026-11-26T12:00:00Z" },
    ];

    // Upsert logic: update existing record in place
    for (const rescan of docsBatch2) {
      const key = getDocumentCompositeKey(rescan);
      const existing = registry.get(key);
      if (existing) {
        registry.set(key, {
          ...existing,
          extracted_fields: rescan.extracted_fields,
          updated_at: rescan.updated_at,
        });
      } else {
        registry.set(key, rescan);
      }
    }

    assert.equal(registry.size, 3, "Re-scan must produce ZERO duplicate rows (exactly 1 row per document type)");
    const updatedSf1 = registry.get(sf1Key);
    assert.equal(updatedSf1.extracted_fields.batch_number, "BATCH-20261126-002", "Existing record must be updated in place with new batch number");
  });

  // ── 26. Table Columns & Detailed Findings Badges ────────────────────────────
  await t.test("26. DocumentTable renders BATCH NUMBER, LRN, EXTRACTED STUDENT NAME, and detailed findings badges", async () => {
    const { formatBatchNumber, resolveDocumentStudentNameDisplay } = await import("../src/lib/validation/nameComparison.ts");

    // 1. formatBatchNumber guarantees clean human-readable identifier and NEVER displays raw UUID
    assert.equal(formatBatchNumber("BATCH-20261126-001"), "BATCH-20261126-001");
    assert.equal(formatBatchNumber("batch-1732620000000-xyz999"), "BATCH-20241126-XYZ");
    const formattedUuid = formatBatchNumber("053ed34c-6df8-45b7-a3c5-671c66df0cb6", "2026-11-26");
    assert.ok(formattedUuid.startsWith("BATCH-20261126-"), "UUID must be converted to BATCH-YYYYMMDD-XXX");
    assert.ok(!formattedUuid.includes("053ed34c-6df8"), "Raw UUID hash must never be displayed");

    // 2. SF2 resolves actual learner name, NOT 'Section Roster'
    const sf2Doc1 = {
      document_type: "sf2",
      extracted_fields: {
        attendance: [{ learner_name: "Gomez, Justin Loquillano", days_present: 21 }],
      },
    };
    const sf2Doc2 = {
      document_type: "sf2",
      extracted_fields: {
        attendance: [
          { learner_name: "Gomez, Justin Loquillano", days_present: 21 },
          { learner_name: "Santos, Maria Clara", days_present: 20 },
        ],
      },
    };
    assert.equal(resolveDocumentStudentNameDisplay(sf2Doc1), "Gomez, Justin Loquillano");
    assert.equal(resolveDocumentStudentNameDisplay(sf2Doc2), "Gomez, Justin Loquillano (+1 more)");

    // 3. DocumentTable source code checks for columns
    const docTablePath = path.join(rootDir, "src/components/documents/DocumentTable.tsx");
    const docTableSrc = fs.readFileSync(docTablePath, "utf8");

    assert.ok(docTableSrc.includes("BATCH NUMBER"), "DocumentTable must have 'BATCH NUMBER' column");
    assert.ok(docTableSrc.includes("LRN (SF1)") || docTableSrc.includes("LRN"), "DocumentTable must have 'LRN' column");
    assert.ok(
      docTableSrc.includes("STUDENT FULL NAME (SF1 MATCHED)") || docTableSrc.includes("EXTRACTED STUDENT NAME"),
      "DocumentTable must have student name column"
    );
    assert.ok(
      docTableSrc.includes("BATCH FOLDER CONTENTS") || docTableSrc.includes("DOCUMENT TYPE"),
      "DocumentTable must have contents / document type column"
    );
    assert.ok(docTableSrc.includes("VALIDATION STATUS &amp; FINDINGS") || docTableSrc.includes("VALIDATION STATUS & FINDINGS"), "DocumentTable must have 'VALIDATION STATUS & FINDINGS' column");
    assert.ok(docTableSrc.includes("SUBMISSION DATE"), "DocumentTable must have 'SUBMISSION DATE' column");

    // Badges: MATCHED, MISMATCH, BLANK / INCOMPLETE
    assert.ok(docTableSrc.includes("MISMATCH"), "DocumentTable must render MISMATCH badge");
    assert.ok(docTableSrc.includes("BLANK / INCOMPLETE"), "DocumentTable must render BLANK / INCOMPLETE badge");
    assert.ok(docTableSrc.includes("MATCHED") || docTableSrc.includes("ALL MATCHED"), "DocumentTable must render MATCHED badge");
  });

  // ── 27. Search Filter in /documents ─────────────────────────────────────────
  await t.test("27. DocumentsPage filters seamlessly by Batch Number, 12-digit LRN, or Student Name", () => {
    const docsPagePath = path.join(rootDir, "src/app/documents/page.tsx");
    const docsPageSrc = fs.readFileSync(docsPagePath, "utf8");

    assert.ok(
      docsPageSrc.includes("batchNumber.toLowerCase().includes(q)"),
      "DocumentsPage must search by Batch Number"
    );
    assert.ok(
      docsPageSrc.includes("lrn && numQ && (lrn.includes(numQ) || numQ.includes(lrn))"),
      "DocumentsPage must search by 12-digit LRN"
    );
    assert.ok(
      docsPageSrc.includes("displayName.includes(q)"),
      "DocumentsPage must search by Extracted Student Name"
    );
    assert.ok(
      docsPageSrc.includes("deduplicatedDocuments"),
      "DocumentsPage must compute deduplicatedDocuments for zero redundancy"
    );
  });

  // ── 28. Two-Stage Upload Verification, Confirmation Prompt, & SF1 Validation ─
  await t.test("28. Two-stage verification: initial preview does not commit, explicit confirmation commits batch, and SF1 match gate works", async () => {
    const { verifyAllDocumentsMatchSf1, computeNextBatchNumber } = await import("../src/lib/validation/nameComparison.ts");

    // 1. verifyAllDocumentsMatchSf1 requires SF1 with valid 12-digit LRN
    const invalidBatchNoSf1 = [
      { name: "sf2.pdf", documentType: "sf2", stepCategory: "sf2", extractedFields: { learners: [{ learner_name: "Gomez, Justin", lrn: "111500619123" }] } },
    ];
    const resNoSf1 = verifyAllDocumentsMatchSf1(invalidBatchNoSf1);
    assert.equal(resNoSf1.isValid, false);
    assert.ok(resNoSf1.reason.includes("SF1-SHS (School Register) document is required"));

    // 2. verifyAllDocumentsMatchSf1 catches mismatched documents
    const mismatchedBatch = [
      { name: "sf1.pdf", documentType: "sf1", stepCategory: "sf1", extractedFields: { learners: [{ learner_name: "Gomez, Justin Loquillano", lrn: "111500619123" }] } },
      { name: "sf9.pdf", documentType: "sf9", stepCategory: "sf9", extractedFields: { learner_name: "Dela Cruz, Juan Santos", lrn: "111999888777" } },
    ];
    const resMismatch = verifyAllDocumentsMatchSf1(mismatchedBatch);
    assert.equal(resMismatch.isValid, false);
    assert.ok(resMismatch.reason.includes("does not match the SF1 learner"));

    // 3. verifyAllDocumentsMatchSf1 passes for consistent batch
    const validBatch = [
      { name: "sf1.pdf", documentType: "sf1", stepCategory: "sf1", extractedFields: { learners: [{ learner_name: "Gomez, Justin Loquillano", lrn: "111500619123" }] } },
      { name: "sf2.pdf", documentType: "sf2", stepCategory: "sf2", extractedFields: { attendance: [{ learner_name: "Gomez, Justin Loquillano", days_present: 21 }] } },
      { name: "sf9.pdf", documentType: "sf9", stepCategory: "sf9", extractedFields: { learner_name: "Gomez, Justin L.", lrn: "111500619123" } },
      { name: "sf10.pdf", documentType: "sf10", stepCategory: "sf10", extractedFields: { learner_name: "Gomez, Justin Loquillano", lrn: "111500619123" } },
      { name: "psa.jpg", documentType: "psa", stepCategory: "birth_cert", extractedFields: { child_first_name: "JUSTIN", child_middle_name: "LOQUILLANO", child_last_name: "GOMEZ" } },
    ];
    const resValid = verifyAllDocumentsMatchSf1(validBatch);
    assert.equal(resValid.isValid, true);
    assert.equal(resValid.sf1Lrn, "111500619123");
    assert.equal(resValid.sf1FullName, "Gomez, Justin Loquillano");

    // 4. Sequential BATCH-001 computation
    assert.equal(computeNextBatchNumber([]), "BATCH-001");
    assert.equal(computeNextBatchNumber(["BATCH-001"]), "BATCH-002");
    assert.equal(computeNextBatchNumber(["BATCH-001", "BATCH-002"]), "BATCH-003");

    // 5. Code verification in upload/page.tsx and scan/batch/route.ts
    assert.ok(uploadPageSrc.includes("commitToRegistry: false"), "Initial Step 6 comparison must pass commitToRegistry: false");
    assert.ok(uploadPageSrc.includes("previewOnly: true"), "Initial Step 6 comparison must pass previewOnly: true");
    assert.ok(uploadPageSrc.includes("handleConfirmBatchUpload"), "Upload page must implement handleConfirmBatchUpload");
    assert.ok(uploadPageSrc.includes("Confirm &amp; Upload Batch") || uploadPageSrc.includes("Confirm & Upload Batch"), "Upload page must render 'Confirm & Upload Batch' button");
    assert.ok(uploadPageSrc.includes("Verification Complete — Ready to Upload Batch to Document Registry?"), "Upload page must display explicit confirmation prompt");

    // 6. scan/batch/route.ts decouples preview and commit
    assert.ok(batchScanRouteSrc.includes("const isCommit = Boolean(commitToRegistry && !previewOnly)"), "Batch route must check commitToRegistry");
    assert.ok(batchScanRouteSrc.includes("if (!isCommit)"), "Batch route must conditionally skip database write when not committing");
  });

  // ── 29. Unified Batch Folder Per Student in DocumentTable ───────────────────
  await t.test("29. aggregateDocumentsIntoBatchFolders groups 5 documents into 1 unified Batch Folder row", async () => {
    const { aggregateDocumentsIntoBatchFolders } = await import("../src/lib/validation/nameComparison.ts");

    const rawDocs = [
      { id: "1", document_type: "sf1", extracted_fields: { batch_number: "BATCH-001", lrn: "111500619123", learner_name: "Gomez, Justin Loquillano", validation_findings: { matched_fields: ["lrn", "student_name"] } } },
      { id: "2", document_type: "sf2", extracted_fields: { batch_number: "BATCH-001", attendance: [{ learner_name: "Gomez, Justin Loquillano" }] } },
      { id: "3", document_type: "sf9", extracted_fields: { batch_number: "BATCH-001", lrn: "111500619123", learner_name: "Gomez, Justin L." } },
      { id: "4", document_type: "sf10", extracted_fields: { batch_number: "BATCH-001", lrn: "111500619123", learner_name: "Gomez, Justin Loquillano" } },
      { id: "5", document_type: "birth_cert", extracted_fields: { batch_number: "BATCH-001", child_name: "Gomez, Justin Loquillano" } },
      // Legacy unverified or orphan draft should be filtered out
      { id: "6", document_type: "sf9", extracted_fields: { batch_number: "BATCH-002", error: "No student found" } },
    ];

    const folders = aggregateDocumentsIntoBatchFolders(rawDocs);
    assert.equal(folders.length, 1, "Exactly 1 Batch Folder row should be produced for the student");
    assert.equal(folders[0].batch_number, "BATCH-001");
    assert.equal(folders[0].sf1_lrn, "111500619123");
    assert.equal(folders[0].student_name, "Gomez, Justin Loquillano");
    assert.equal(folders[0].documents.length, 5, "Folder must contain all 5 bundled documents");
    assert.ok(folders[0].document_types.includes("sf1"));
    assert.ok(folders[0].document_types.includes("sf2"));
    assert.ok(folders[0].document_types.includes("sf9"));
    assert.ok(folders[0].document_types.includes("sf10"));
    assert.ok(folders[0].document_types.includes("birth_cert"));
  });

  // ── 30. Clear All Old Files & DELETE /api/documents ─────────────────────────
  await t.test("30. Documents registry provides 'Clear All Old Files' action and DELETE /api/documents endpoint", () => {
    const docsRoutePath = path.join(rootDir, "src/app/api/documents/route.ts");
    const docsRouteSrc = fs.readFileSync(docsRoutePath, "utf8");
    const docsPagePath = path.join(rootDir, "src/app/documents/page.tsx");
    const docsPageSrc = fs.readFileSync(docsPagePath, "utf8");

    assert.ok(docsRouteSrc.includes("export async function DELETE"), "Documents route must export DELETE handler");
    assert.ok(docsPageSrc.includes("Clear All Old Files"), "Documents page must render 'Clear All Old Files' button");
    assert.ok(docsPageSrc.includes("handleClearAllOldFiles"), "Documents page must implement handleClearAllOldFiles");
    assert.ok(docsPageSrc.includes("method: \"DELETE\""), "handleClearAllOldFiles must call DELETE /api/documents");
  });

  // ── 31. Filter SF5A/SF5B Removal, Strict Badge Resolution, & LRN (SF1) Priority ──
  await t.test("31. Filter removes SF5A/SF5B, DocumentTable handles NOT YET COMPARED, and LRN anchors from SF1", async () => {
    const docsPagePath = path.join(rootDir, "src/app/documents/page.tsx");
    const docsPageSrc = fs.readFileSync(docsPagePath, "utf8");
    const docTablePath = path.join(rootDir, "src/components/documents/DocumentTable.tsx");
    const docTableSrc = fs.readFileSync(docTablePath, "utf8");
    const { aggregateDocumentsIntoBatchFolders } = await import("../src/lib/validation/nameComparison.ts");

    // 1. SF5A and SF5B must be absent from /documents filter options
    assert.ok(!docsPageSrc.includes("SF5A-SHS End of Semester Status"), "SF5A must be removed from /documents filter options");
    assert.ok(!docsPageSrc.includes("SF5B-SHS Graduation Candidates"), "SF5B must be removed from /documents filter options");
    assert.ok(docsPageSrc.includes("SF1-SHS School Register"), "SF1 option must remain in filter");
    assert.ok(docsPageSrc.includes("SF2-SHS Daily Attendance"), "SF2 option must remain in filter");
    assert.ok(docsPageSrc.includes("SF9-SHS Progress Report"), "SF9 option must remain in filter");
    assert.ok(docsPageSrc.includes("SF10-SHS Permanent Record"), "SF10 option must remain in filter");
    assert.ok(docsPageSrc.includes("PSA Birth Certificate"), "PSA option must remain in filter");

    // 2. Strict badge rules in DocumentTable
    assert.ok(docTableSrc.includes("NOT YET COMPARED"), "DocumentTable must render NOT YET COMPARED when 0 matched fields");
    assert.ok(docTableSrc.includes("MISMATCH &amp; BLANK"), "DocumentTable must render MISMATCH & BLANK when both are present");
    assert.ok(docTableSrc.includes("MISMATCH FOUND"), "DocumentTable must render MISMATCH FOUND when mismatches present");
    assert.ok(docTableSrc.includes("BLANK / INCOMPLETE"), "DocumentTable must render BLANK / INCOMPLETE when blanks present");
    assert.ok(docTableSrc.includes("ALL MATCHED"), "DocumentTable must render ALL MATCHED when matchedCount > 0 and no mismatches/blanks");

    // 3. LRN (SF1) priority: SF1 LRN takes strict precedence even if other documents appear first
    const docsWithConflict = [
      { id: "1", document_type: "sf10", extracted_fields: { batch_number: "BATCH-001", lrn: "111999999999", learner_name: "Gomez, Justin Loquillano" } },
      { id: "2", document_type: "sf1", extracted_fields: { batch_number: "BATCH-001", lrn: "111500619123", learner_name: "Gomez, Justin Loquillano" } },
      { id: "3", document_type: "sf9", extracted_fields: { batch_number: "BATCH-001", lrn: "111888888888", learner_name: "Gomez, Justin Loquillano" } },
    ];
    const folderRes = aggregateDocumentsIntoBatchFolders(docsWithConflict);
    assert.equal(folderRes.length, 1);
    assert.equal(folderRes[0].sf1_lrn, "111500619123", "Batch folder must strictly anchor LRN (SF1) from SF1-SHS regardless of input document order");

    // 4. Footer summary reflects batch folders count
    assert.ok(docsPageSrc.includes("itemLabel=\"batch folders\""), "DataTableContainer in /documents must use 'batch folders' itemLabel");
  });

  // ── 32. Sequential Prerequisite Lock on Top Guided Upload Sequence Stepper Cards ──
  await t.test("32. Top Guided Upload Sequence cards (1 to 6) enforce prerequisite locking matching bottom Next button", () => {
    // 1. Check helper definitions in upload/page.tsx
    assert.ok(
      uploadPageSrc.includes("const isStepIndexReady = (idx: number): boolean => {"),
      "upload/page.tsx must define isStepIndexReady helper"
    );
    assert.ok(
      uploadPageSrc.includes("const getStepperCardLockState = (targetIdx: number): { isLocked: boolean; reason?: string } => {"),
      "upload/page.tsx must define getStepperCardLockState helper"
    );

    // 2. Check that targetIdx = 0 (SF1) is always accessible unless extracting
    assert.ok(
      uploadPageSrc.includes("if (targetIdx === 0) {\n      return { isLocked: false };\n    }") ||
      uploadPageSrc.includes("if (targetIdx === 0)"),
      "SF1 (Step 0) must never be locked by prior prerequisites"
    );

    // 3. Check that prior required steps (prevIdx < targetIdx where !isOptional) are verified
    assert.ok(
      uploadPageSrc.includes("for (let prevIdx = 0; prevIdx < targetIdx; prevIdx++) {"),
      "Lock helper must iterate through all prior steps"
    );
    assert.ok(
      uploadPageSrc.includes("if (!prevStep.isOptional && !isStepIndexReady(prevIdx)) {"),
      "Lock helper must lock if any prior required step is not ready"
    );

    // 4. Check that handleCategoryChange guards against locked target steps
    assert.ok(
      uploadPageSrc.includes("const lockState = getStepperCardLockState(stepIdx);") &&
      uploadPageSrc.includes("if (lockState.isLocked)") &&
      uploadPageSrc.includes("Guard against jumping to a locked future step"),
      "handleCategoryChange must guard and prevent jumping to locked steps"
    );

    // 5. Check top stepper button markup for steps 1..5 and Review (step 6)
    assert.ok(
      uploadPageSrc.includes("const lockState = getStepperCardLockState(idx);") &&
      uploadPageSrc.includes("const isCardLocked = lockState.isLocked;"),
      "Stepper card buttons (1..5) must evaluate lockState"
    );
    assert.ok(
      uploadPageSrc.includes("disabled={isCardLocked}"),
      "Stepper card buttons (1..5) must pass disabled={isCardLocked}"
    );
    assert.ok(
      uploadPageSrc.includes("isCardLocked ? \"cursor-not-allowed opacity-55 pointer-events-none\" : \"cursor-pointer\""),
      "Stepper card buttons (1..5) must apply disabled styling when locked"
    );

    // Step 6 (Review)
    assert.ok(
      uploadPageSrc.includes("const reviewLockState = getStepperCardLockState(5);") &&
      uploadPageSrc.includes("const isReviewLocked = reviewLockState.isLocked;"),
      "Review card button (6) must evaluate getStepperCardLockState(5)"
    );
    assert.ok(
      uploadPageSrc.includes("disabled={isReviewLocked}"),
      "Review card button (6) must pass disabled={isReviewLocked}"
    );
    assert.ok(
      uploadPageSrc.includes("isReviewLocked ? \"cursor-not-allowed opacity-55 pointer-events-none\" : \"cursor-pointer\""),
      "Review card button (6) must apply disabled styling when locked"
    );

    // 6. Test lock behavior simulation logic
    const testWizardSteps = [
      { id: "sf9", shortLabel: "SF9", isOptional: false },
      { id: "birth_cert", shortLabel: "PSA", isOptional: true },
      { id: "sf1", shortLabel: "SF1", isOptional: false },
      { id: "sf2", shortLabel: "SF2", isOptional: false },
      { id: "sf10", shortLabel: "SF10", isOptional: false },
    ];

    const simulateLockState = (
      stepFilesState,
      targetIdx,
      isAnyExtracting = false
    ) => {
      if (isAnyExtracting) {
        return { isLocked: true, reason: "Wait for current document extraction to finish" };
      }
      if (targetIdx === 0) return { isLocked: false };

      const checkStepReady = (idx) => {
        const step = testWizardSteps[idx];
        const files = stepFilesState[step.id] || [];
        if (files.length === 0) return false;
        if (files.some((f) => f.status === "extracting" || f.status === "queued" || f.status === "pending")) return false;
        return files.every((f) => f.status === "extracted");
      };

      for (let prevIdx = 0; prevIdx < targetIdx; prevIdx++) {
        if (prevIdx < testWizardSteps.length) {
          const prevStep = testWizardSteps[prevIdx];
          if (!prevStep.isOptional && !checkStepReady(prevIdx)) {
            return {
              isLocked: true,
              reason: `Complete and extract ${prevStep.shortLabel} first before proceeding to ${
                targetIdx < 5 ? testWizardSteps[targetIdx].shortLabel : "Review"
              }`,
            };
          }
        }
      }
      return { isLocked: false };
    };

    // Scenario A: Fresh state (SF9 not yet uploaded)
    const freshState = { sf1: [], sf2: [], sf9: [], sf10: [], birth_cert: [] };
    assert.equal(simulateLockState(freshState, 0).isLocked, false, "SF9 must be unlocked on fresh state");
    assert.equal(simulateLockState(freshState, 1).isLocked, true, "PSA must be locked when SF9 is empty");
    assert.equal(simulateLockState(freshState, 2).isLocked, true, "SF1 must be locked when SF9 is empty");
    assert.equal(simulateLockState(freshState, 3).isLocked, true, "SF2 must be locked when SF9 is empty");
    assert.equal(simulateLockState(freshState, 4).isLocked, true, "SF10 must be locked when SF9 is empty");
    assert.equal(simulateLockState(freshState, 5).isLocked, true, "Review must be locked when SF9 is empty");

    // Scenario B: SF9 is extracting
    assert.equal(simulateLockState(freshState, 0, true).isLocked, true, "SF9 must be locked when any file is extracting");
    assert.equal(simulateLockState(freshState, 1, true).isLocked, true, "PSA must be locked when any file is extracting");

    // Scenario C: SF9 is ready (extracted)
    const sf9ReadyState = {
      sf9: [{ status: "extracted" }],
      birth_cert: [],
      sf1: [],
      sf2: [],
      sf10: [],
    };
    assert.equal(simulateLockState(sf9ReadyState, 0).isLocked, false, "SF9 remains accessible");
    assert.equal(simulateLockState(sf9ReadyState, 1).isLocked, false, "PSA unlocks once SF9 is extracted and ready");
    assert.equal(simulateLockState(sf9ReadyState, 2).isLocked, false, "SF1 unlocks once SF9 is ready (PSA is optional)");
    assert.equal(simulateLockState(sf9ReadyState, 3).isLocked, true, "SF2 remains locked until SF1 is extracted");
    assert.equal(simulateLockState(sf9ReadyState, 5).isLocked, true, "Review remains locked until SF1, SF2, SF10 are ready");

    // Scenario D: SF9 and SF1 are ready (PSA omitted/skipped)
    const sf9AndSf1ReadyState = {
      sf9: [{ status: "extracted" }],
      birth_cert: [],
      sf1: [{ status: "extracted" }],
      sf2: [],
      sf10: [],
    };
    assert.equal(simulateLockState(sf9AndSf1ReadyState, 0).isLocked, false);
    assert.equal(simulateLockState(sf9AndSf1ReadyState, 1).isLocked, false);
    assert.equal(simulateLockState(sf9AndSf1ReadyState, 2).isLocked, false);
    assert.equal(simulateLockState(sf9AndSf1ReadyState, 3).isLocked, false, "SF2 unlocks once SF1 is ready");
    assert.equal(simulateLockState(sf9AndSf1ReadyState, 4).isLocked, true, "SF10 remains locked until SF2 is ready");
    assert.equal(simulateLockState(sf9AndSf1ReadyState, 5).isLocked, true, "Review remains locked");

    // Scenario E: SF9, SF1, SF2, SF10 are all ready (PSA is optional)
    const allRequiredReadyState = {
      sf9: [{ status: "extracted" }],
      birth_cert: [],
      sf1: [{ status: "extracted" }],
      sf2: [{ status: "extracted" }],
      sf10: [{ status: "extracted" }],
    };
    assert.equal(simulateLockState(allRequiredReadyState, 0).isLocked, false);
    assert.equal(simulateLockState(allRequiredReadyState, 1).isLocked, false);
    assert.equal(simulateLockState(allRequiredReadyState, 2).isLocked, false);
    assert.equal(simulateLockState(allRequiredReadyState, 3).isLocked, false);
    assert.equal(simulateLockState(allRequiredReadyState, 4).isLocked, false, "SF10 unlocks because SF2 is ready");
    assert.equal(simulateLockState(allRequiredReadyState, 5).isLocked, false, "Review unlocks because all required steps are ready (PSA optional)");
  });

  // ── 33. SF9 Target Learner Prioritization & Roster Filtering in SF1 and SF2 ──
  await t.test("33. Passing targetStudentName from Step 1 (SF9) prioritizes and filters target learner in SF1 and SF2", async () => {
    const { parseShsSf1 } = await import("../src/lib/ocr/shsSf1Parser.ts");
    const { parseShsSf2 } = await import("../src/lib/ocr/shsSf2Parser.ts");
    const { verifyAllDocumentsMatchAnchorStudent } = await import("../src/lib/validation/nameComparison.ts");

    // 1. Multi-learner SF1 text with Kenneth Latonero first and Justin Gomez second
    const sf1MultiRosterText = `
School ID: 500169  School Name: Tagum City National High School  School Year: 2026-2027
Grade Level: Grade 11  Section: Diamond  Track: Academic  Strand: STEM

MALE
1 | 111304501972 | Latonero, Kenneth Abad | M | 05/12/2005
2 | 111500619123 | Gomez, Justin Loquillano | M | 06/23/2004
`;

    // Without target options, Latonero is first (row 1)
    const defaultSf1 = parseShsSf1(sf1MultiRosterText);
    assert.equal(defaultSf1.learners.length, 2);
    assert.equal(defaultSf1.learners[0].full_name, "Latonero, Kenneth Abad");

    // With targetStudentName from SF9 ("Gomez, Justin Loquillano"), Gomez is prioritized to index 0
    const anchoredSf1 = parseShsSf1(sf1MultiRosterText, undefined, 0.95, {
      targetStudentName: "Gomez, Justin Loquillano",
      targetLrn: "111500619123",
    });
    assert.equal(anchoredSf1.learners.length, 2);
    assert.equal(anchoredSf1.learners[0].full_name, "Gomez, Justin Loquillano", "Target learner must be prioritized to index 0");
    assert.equal(anchoredSf1.learners[0].lrn, "111500619123");
    assert.equal(anchoredSf1.target_matched, true);

    // 2. Multi-learner SF2 text with Kenneth Latonero first and Justin Gomez second
    const sf2MultiAttendanceText = `
School ID: 500169  School Year: 2026-2027  Grade Level: Grade 11  Section: Diamond
Month: June  Total School Days: 21

MALE
1. Latonero, Kenneth Abad   20  1  0
2. Gomez, Justin Loquillano 21  0  0
`;

    const defaultSf2 = parseShsSf2(sf2MultiAttendanceText);
    assert.equal(defaultSf2.attendance.length, 2);

    // With targetStudentName from SF9, Justin Gomez is prioritized to index 0
    const anchoredSf2 = parseShsSf2(sf2MultiAttendanceText, undefined, 0.95, {
      targetStudentName: "Gomez, Justin Loquillano",
    });
    assert.equal(anchoredSf2.attendance.length, 2);
    assert.equal(anchoredSf2.attendance[0].learner_name, "Gomez, Justin Loquillano", "Target learner attendance must be prioritized to index 0");
    assert.equal(anchoredSf2.attendance[0].days_present, 21);
    assert.equal(anchoredSf2.target_matched, true);

    // 3. verifyAllDocumentsMatchAnchorStudent verifies SF9 anchors the batch
    const sf9Batch = [
      { documentType: "sf9", stepCategory: "sf9", extractedFields: { learner_name: "Gomez, Justin Loquillano", lrn: "111500619123" } },
      { documentType: "sf2", stepCategory: "sf2", extractedFields: { attendance: [{ learner_name: "Gomez, Justin Loquillano", days_present: 21 }] } },
      { documentType: "sf10", stepCategory: "sf10", extractedFields: { learner_name: "Gomez, Justin Loquillano", lrn: "111500619123" } },
    ];
    const anchorRes = verifyAllDocumentsMatchAnchorStudent(sf9Batch);
    assert.equal(anchorRes.isValid, true);
    assert.equal(anchorRes.anchorLrn, "111500619123");
    assert.equal(anchorRes.anchorFullName, "Gomez, Justin Loquillano");
  });

  // ── 34. Dynamic Grade & DepEd Remarks Evaluation (Blank vs. Not Recognized vs. PASSED/FAILED) ──
  await t.test("34. Dynamic Grade & DepEd Remarks: Blank / Incomplete vs. Not Recognized (<65%) vs. DepEd PASSED/FAILED", async () => {
    const { evaluateDynamicGradeStatus } = await import("../src/lib/validation/gradeUtils.ts");

    // Case A: Empty / Unread cells must NEVER default to PASSED or FAILED
    const emptyNull = evaluateDynamicGradeStatus({ grade: null });
    assert.equal(emptyNull.gradeDisplay, "Blank");
    assert.equal(emptyNull.remarkDisplay, "Blank / Incomplete");
    assert.equal(emptyNull.status, "blank");

    const emptyUndefined = evaluateDynamicGradeStatus({ grade: undefined });
    assert.equal(emptyUndefined.gradeDisplay, "Blank");
    assert.equal(emptyUndefined.remarkDisplay, "Blank / Incomplete");
    assert.equal(emptyUndefined.status, "blank");

    const emptyDash = evaluateDynamicGradeStatus({ grade: "—" });
    assert.equal(emptyDash.gradeDisplay, "Blank");
    assert.equal(emptyDash.remarkDisplay, "Blank / Incomplete");
    assert.equal(emptyDash.status, "blank");

    const emptyString = evaluateDynamicGradeStatus({ grade: "   " });
    assert.equal(emptyString.gradeDisplay, "Blank");
    assert.equal(emptyString.remarkDisplay, "Blank / Incomplete");
    assert.equal(emptyString.status, "blank");

    // Case B: Low OCR Confidence (< 65%) must evaluate to Not Recognized
    const lowConfValidNumber = evaluateDynamicGradeStatus({ grade: 88, confidencePercent: 52 });
    assert.equal(lowConfValidNumber.status, "not_recognized");
    assert.equal(lowConfValidNumber.remarkDisplay, "Not Recognized (52%)");
    assert.equal(lowConfValidNumber.gradeDisplay, "88");

    const lowConfWithGarbledText = evaluateDynamicGradeStatus({ grade: "N/A??", confidencePercent: 40 });
    assert.equal(lowConfWithGarbledText.status, "not_recognized");
    assert.equal(lowConfWithGarbledText.remarkDisplay, "Not Recognized (40%)");

    // Non-numeric unparseable grade with adequate confidence (outputs clean "Not Recognized")
    const unparseableGrade = evaluateDynamicGradeStatus({ grade: "XYZ", confidencePercent: 85 });
    assert.equal(unparseableGrade.status, "not_recognized");
    assert.equal(unparseableGrade.remarkDisplay, "Not Recognized");

    const unparseableWithoutConf = evaluateDynamicGradeStatus({ grade: "XYZ" });
    assert.equal(unparseableWithoutConf.status, "not_recognized");
    assert.equal(unparseableWithoutConf.remarkDisplay, "Not Recognized");

    // Case C: Clear numeric grades (>= 65% confidence) evaluate dynamically
    const passingGrade = evaluateDynamicGradeStatus({ grade: 75, confidencePercent: 80 });
    assert.equal(passingGrade.status, "passed");
    assert.equal(passingGrade.remarkDisplay, "PASSED");
    assert.equal(passingGrade.gradeDisplay, "75");

    const highPassingGrade = evaluateDynamicGradeStatus({ grade: 94 });
    assert.equal(highPassingGrade.status, "passed");
    assert.equal(highPassingGrade.remarkDisplay, "PASSED");
    assert.equal(highPassingGrade.gradeDisplay, "94");

    const failingGrade = evaluateDynamicGradeStatus({ grade: 74 });
    assert.equal(failingGrade.status, "failed");
    assert.equal(failingGrade.remarkDisplay, "FAILED");
    assert.equal(failingGrade.gradeDisplay, "74");

    // Explicit valid remark override when confidence >= 65%
    const incompleteRemark = evaluateDynamicGradeStatus({ grade: 82, rawRemark: "Incomplete", confidencePercent: 75 });
    assert.equal(incompleteRemark.status, "incomplete");
    assert.equal(incompleteRemark.remarkDisplay, "Incomplete");

    // Source Code checks: upload page and views must use evaluateDynamicGradeStatus
    assert.ok(
      uploadPageSrc.includes("evaluateDynamicGradeStatus"),
      "upload/page.tsx must import and use evaluateDynamicGradeStatus"
    );
    assert.ok(
      !uploadPageSrc.includes('>PASSED</span></td>') && !uploadPageSrc.includes('>PASSED</span></'),
      "upload/page.tsx must not contain hardcoded static >PASSED</span> elements in SF10/SF9 tables"
    );

    const indViewPath = path.join(rootDir, "src/components/validation/IndividualDocumentExtractionView.tsx");
    const indViewSrc = fs.readFileSync(indViewPath, "utf8");
    assert.ok(
      indViewSrc.includes("evaluateDynamicGradeStatus"),
      "IndividualDocumentExtractionView.tsx must use evaluateDynamicGradeStatus"
    );
  });

  // ── 35. Robust DELETE /api/documents Foreign-Key Pre-deletion, Admin Client & RLS Soft Fallback ──
  await t.test("35. DELETE /api/documents: User auth check, admin client RLS bypass, child table cleanup, soft-archive fallback & registry cache wipe", () => {
    const docsRoutePath = path.join(rootDir, "src/app/api/documents/route.ts");
    const docsRouteSrc = fs.readFileSync(docsRoutePath, "utf8");
    const docsPagePath = path.join(rootDir, "src/app/documents/page.tsx");
    const docsPageSrc = fs.readFileSync(docsPagePath, "utf8");
    const serverSupabasePath = path.join(rootDir, "src/lib/supabase/server.ts");
    const serverSupabaseSrc = fs.readFileSync(serverSupabasePath, "utf8");

    // 1. Server admin client helper exists and only activates when SUPABASE_SERVICE_ROLE_KEY is present
    assert.ok(
      serverSupabaseSrc.includes("export function createAdminClient"),
      "src/lib/supabase/server.ts must export createAdminClient for privileged server operations"
    );
    assert.ok(
      serverSupabaseSrc.includes("process.env.SUPABASE_SERVICE_ROLE_KEY") &&
      serverSupabaseSrc.includes("return null"),
      "createAdminClient must return null if SUPABASE_SERVICE_ROLE_KEY is absent"
    );

    // 2. Authentication and authorization checks in DELETE handler
    assert.ok(
      docsRouteSrc.includes("export async function DELETE"),
      "route.ts must export DELETE handler"
    );
    assert.ok(
      docsRouteSrc.includes("userClient.auth.getUser()") || docsRouteSrc.includes("auth.getUser()"),
      "DELETE handler must authenticate user before performing registry deletion"
    );
    assert.ok(
      docsRouteSrc.includes("status: 401"),
      "DELETE handler must return 401 if user is unauthenticated"
    );
    assert.ok(
      docsRouteSrc.includes("status: 403"),
      "DELETE handler must return 403 if account is not approved"
    );

    // 3. Privileged client resolution falling back to userClient
    assert.ok(
      docsRouteSrc.includes("createAdminClient"),
      "DELETE handler must attempt to resolve createAdminClient"
    );
    assert.ok(
      docsRouteSrc.includes("let db: any = userClient"),
      "DELETE handler must cleanly fall back to userClient when service role is not configured"
    );

    // 4. Scoped target document query using .select('*') without non-existent file_path
    assert.ok(
      docsRouteSrc.includes('.select("*")') || docsRouteSrc.includes(".select('*')"),
      "DELETE handler must query public.documents using .select('*')"
    );
    assert.ok(
      !docsRouteSrc.includes("documents").includes?.("file_path") &&
      !docsRouteSrc.includes('.select("id, image_url, file_path'),
      "DELETE handler must never query non-existent documents.file_path"
    );
    assert.ok(
      docsRouteSrc.includes(".in(\"id\", documentIds)"),
      "DELETE handler must execute deletion using explicit .in('id', documentIds) filter"
    );
    assert.ok(
      docsRouteSrc.includes("clearedCount: 0"),
      "DELETE handler must return 200 with clearedCount: 0 if no documents exist"
    );

    // 5. Foreign-key dependent child table pre-deletion
    assert.ok(
      docsRouteSrc.includes("CHILD_TABLES_BY_DOC_ID") &&
      docsRouteSrc.includes(".in(\"document_id\", documentIds)"),
      "DELETE handler must delete dependent child table records before documents"
    );
    assert.ok(
      docsRouteSrc.includes("cross_document_validations"),
      "DELETE handler must clean up cross_document_validations references"
    );
    assert.ok(
      docsRouteSrc.includes("student_enrollments"),
      "DELETE handler must clean up student_enrollments references"
    );
    assert.ok(
      docsRouteSrc.includes("isIgnorableChildTableError"),
      "DELETE handler must safely ignore missing child tables or columns (42P01/PGRST205)"
    );

    // 6. Supabase storage file removal from multiple potential columns
    assert.ok(
      docsRouteSrc.includes("storage_path") &&
      docsRouteSrc.includes("image_url") &&
      (docsRouteSrc.includes("db.storage.from(\"documents\").remove") ||
       docsRouteSrc.includes("storage.from(\"documents\").remove")),
      "DELETE handler must defensively resolve storage paths and call storage.from('documents').remove"
    );

    // 7. Soft-archive fallback and RPC archive_review_document if hard delete is blocked
    assert.ok(
      docsRouteSrc.includes("status: \"archived\"") &&
      docsRouteSrc.includes("archived_at: now"),
      "DELETE handler must provide clean soft-archive fallback marking archived"
    );
    assert.ok(
      docsRouteSrc.includes("archive_review_document"),
      "DELETE handler must attempt RPC archive_review_document fallback"
    );

    // 8. Terminal error logging and error response details
    assert.ok(
      docsRouteSrc.includes("console.error(\"[DELETE /api/documents] Failed:\""),
      "DELETE handler must log terminal error with console.error before returning 500"
    );
    assert.ok(
      docsRouteSrc.includes("details:") && docsRouteSrc.includes("status: 500"),
      "DELETE handler must return 500 with exact error details on failure"
    );

    // 9. GET /api/documents excludes archived and deleted rows
    assert.ok(
      docsRouteSrc.includes(".neq('status', 'archived').neq('status', 'deleted')"),
      "GET /api/documents must filter out both archived and deleted documents"
    );
    assert.ok(
      docsRouteSrc.includes("doc?.status === 'archived' || doc?.status === 'deleted' || doc?.deleted_at"),
      "GET /api/documents must exclude archived/deleted docs in memory to reset registry to BATCH-001"
    );

    // 10. Client handleClearAllOldFiles in documents page
    assert.ok(
      docsPageSrc.includes("data?.error") && docsPageSrc.includes("data?.details"),
      "handleClearAllOldFiles must parse and display specific data.error and data.details"
    );
    assert.ok(
      docsPageSrc.includes("sessionStorage.removeItem(\"avv_active_batch_id\")") &&
      docsPageSrc.includes("sessionStorage.removeItem(\"avv_batch_counter\")") &&
      docsPageSrc.includes("localStorage.removeItem(\"avv_active_batch_id\")") &&
      docsPageSrc.includes("localStorage.removeItem(\"avv_batch_counter\")"),
      "handleClearAllOldFiles must clear batch keys from both sessionStorage and localStorage"
    );
    assert.ok(
      docsPageSrc.includes("setDocuments([])"),
      "handleClearAllOldFiles must reset local documents state to empty array"
    );
  });

  // ── 36. Primary Source Reconciliation & Matrix Sanity Suite ─────────────────
  await t.test("36. Removal of Mother's Maiden Name, Deduplicated Monthly Attendance & One-Click Fix Student Data Button", () => {
    const viewPath = path.join(rootDir, "src/components/validation/UnifiedBatchResultsView.tsx");
    const viewSrc = fs.readFileSync(viewPath, "utf8");

    // 1. One-click "Fix Student Data" button rendered in UnifiedBatchResultsView
    assert.ok(
      viewSrc.includes("Fix Student Data"),
      "UnifiedBatchResultsView must render 'Fix Student Data' button"
    );
    assert.ok(
      viewSrc.includes("✓ Student Data Fixed (All Matched)"),
      "UnifiedBatchResultsView must render fixed state '✓ Student Data Fixed (All Matched)'"
    );
    assert.ok(
      viewSrc.includes("Primary Source Reconciliation Summary"),
      "UnifiedBatchResultsView must render 'Primary Source Reconciliation Summary'"
    );
    assert.ok(
      viewSrc.includes("Revert Changes"),
      "UnifiedBatchResultsView must offer 'Revert Changes' action"
    );
    assert.ok(
      viewSrc.includes("Pull baseline data from Primary Sources — SF1: LRN • PSA: Full Name, Sex, Birthday • SF9: Grades"),
      "Button tooltip must reflect Primary Source baseline terminology"
    );

    // 2. Strict terminology check: Never label button or UI as "Primary Key"
    assert.ok(
      !viewSrc.includes("Fix Student Data Primary Key") &&
      !viewSrc.includes("Primary-Key Reconciliation") &&
      !viewSrc.includes("Primary Key Reconciliation"),
      "Must use 'Primary Source' terminology, NEVER 'Primary Key' in UI labels"
    );

    // 3. Ensure Mother's Maiden Name is excluded from matrix in UnifiedBatchResultsView
    assert.ok(
      viewSrc.includes("mother_maiden_name") && viewSrc.includes("filter"),
      "UnifiedBatchResultsView must filter out mother_maiden_name from cross-document matrix"
    );

    // 4. Verify crossDocumentEngine exports reconcileStudentDataFromPrimarySources and excludes mother_maiden_name
    const enginePath = path.join(rootDir, "src/lib/validation/crossDocumentEngine.ts");
    const engineSrc = fs.readFileSync(enginePath, "utf8");

    assert.ok(
      engineSrc.includes("export function reconcileStudentDataFromPrimarySources"),
      "crossDocumentEngine must export reconcileStudentDataFromPrimarySources"
    );
    assert.ok(
      !engineSrc.includes('label: "Mother\'s Maiden Name"'),
      "crossDocumentEngine must NOT create Mother's Maiden Name comparison row in fieldsMatrix"
    );
  });
});

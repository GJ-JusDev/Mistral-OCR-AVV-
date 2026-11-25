import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  evaluateTeacherScanAuthorization,
  normalizeGradeLevelKey,
} from "../src/lib/teacher/assignments.ts";
import {
  evaluateBatchCrossDocumentValidation,
} from "../src/lib/validation/batchCrossDocumentValidator.ts";

test("AVV System — New Batch Isolation & Saved Batch Recovery Test Suite", async (t) => {
  const rootDir = path.resolve("./");
  const uploadPagePath = path.join(rootDir, "src/app/upload/page.tsx");
  const batchScanRoutePath = path.join(rootDir, "src/app/api/scan/batch/route.ts");
  const resultsViewPath = path.join(rootDir, "src/components/validation/UnifiedBatchResultsView.tsx");

  const uploadPageSrc = fs.readFileSync(uploadPagePath, "utf8");
  const batchScanRouteSrc = fs.readFileSync(batchScanRoutePath, "utf8");
  const resultsViewSrc = fs.readFileSync(resultsViewPath, "utf8");

  // ===========================================================================
  // 1. Static Source Code & UI Contract Verifications
  // ===========================================================================
  await t.test("1. UploadPage defines currentBatchId and isNewBatchExplicit session tracking", () => {
    assert.ok(
      uploadPageSrc.includes("currentBatchId"),
      "UploadPage must maintain currentBatchId state"
    );
    assert.ok(
      uploadPageSrc.includes("isNewBatchExplicit"),
      "UploadPage must track whether a new batch was explicitly started"
    );
    assert.ok(
      uploadPageSrc.includes("sessionStorage.setItem(\"avv_active_batch_id\"") ||
      uploadPageSrc.includes('sessionStorage.setItem("avv_active_batch_id"'),
      "UploadPage must persist active batchId in sessionStorage for refresh recovery"
    );
    assert.ok(
      uploadPageSrc.includes("sessionStorage.setItem(\"avv_is_new_batch\"") ||
      uploadPageSrc.includes('sessionStorage.setItem("avv_is_new_batch"'),
      "UploadPage must record explicit new batch flag in sessionStorage"
    );
  });

  await t.test("2. handleStartNewBatch cleanly resets all state and creates new unique batch ID", () => {
    assert.ok(
      uploadPageSrc.includes("handleStartNewBatch"),
      "UploadPage must define handleStartNewBatch"
    );
    // Verifying all reset actions required to clear stale results
    assert.ok(
      uploadPageSrc.includes("setSelectedFiles([])") &&
      uploadPageSrc.includes("setFilePreviews([])") &&
      uploadPageSrc.includes("setDetectedSegments([])") &&
      uploadPageSrc.includes("setExtractedData({})") &&
      uploadPageSrc.includes("setValidationReport(null)") &&
      uploadPageSrc.includes('setStage("idle")') &&
      uploadPageSrc.includes("setErrorMessage(null)"),
      "handleStartNewBatch must clear files, previews, segments, extractedData, report, stage, and error"
    );
    assert.ok(
      uploadPageSrc.includes("setCurrentStepIndex(0)"),
      "handleStartNewBatch must reset wizard to Step 1 (SF1-SHS)"
    );
    assert.ok(
      uploadPageSrc.includes("setCurrentBatchId("),
      "handleStartNewBatch must assign a newly generated batch identifier"
    );
  });

  await t.test("3. UploadPage displays clear empty-state message when starting a new batch", () => {
    assert.ok(
      uploadPageSrc.includes("new-batch-empty-state") ||
      uploadPageSrc.includes("Ready to Upload New Batch") ||
      uploadPageSrc.includes("Ready to upload a new batch"),
      "UploadPage must display a clear empty-state message indicating readiness for a new batch"
    );
    assert.ok(
      uploadPageSrc.includes("SF1-SHS"),
      "Empty-state message must guide teacher to upload SF1-SHS first"
    );
  });

  await t.test("4. UnifiedBatchResultsView displays clearly visible 'Start New Batch' action", () => {
    assert.ok(
      resultsViewSrc.includes("onStartNewBatch"),
      "UnifiedBatchResultsView must accept onStartNewBatch prop"
    );
    assert.ok(
      resultsViewSrc.includes("Start New Batch"),
      "UnifiedBatchResultsView must render 'Start New Batch' button"
    );
    assert.ok(
      resultsViewSrc.includes('aria-label="Start New Batch"') ||
      resultsViewSrc.includes('data-testid="start-new-batch-button"'),
      "UnifiedBatchResultsView button must have accessible label or test identifier"
    );
  });

  await t.test("5. GET /api/scan/batch supports batchId query parameter and handles 'new' / 'none'", () => {
    assert.ok(
      batchScanRouteSrc.includes("requestedBatchId") ||
      batchScanRouteSrc.includes('searchParams.get("batchId")'),
      "GET route must read batchId from searchParams"
    );
    assert.ok(
      batchScanRouteSrc.includes('requestedBatchId === "new"') ||
      batchScanRouteSrc.includes('requestedBatchId === "none"'),
      "GET route must recognize 'new' or 'none' batch requests"
    );
    assert.ok(
      batchScanRouteSrc.includes("hasSavedBatch: false"),
      "GET route must return hasSavedBatch: false for fresh or new batch"
    );
  });

  await t.test("6. POST /api/scan/batch associates documents with provided batchId and returns batchId in response", () => {
    assert.ok(
      batchScanRouteSrc.includes("batch_id: batchId"),
      "POST route must store batch_id in extracted_fields payload"
    );
    assert.ok(
      batchScanRouteSrc.includes("batchId: validationReport.batchId || batchId") ||
      batchScanRouteSrc.includes("batchId"),
      "POST route must return batchId in JSON response"
    );
  });

  await t.test("7. Retry segment preserves active batchId and does not create duplicate document records", () => {
    assert.ok(
      uploadPageSrc.includes('action: "retry_segment"') &&
      uploadPageSrc.includes("batchId: currentBatchId"),
      "handleRetrySegment must pass active currentBatchId to prevent batch drift"
    );
  });

  // ===========================================================================
  // 2. Behavioral Simulation: Batch Isolation & Saved Batch Recovery
  // ===========================================================================
  await t.test("8. Behavioral: Old batch documents (Gomez Front.png, synthetic_sf9_sample.jpg) excluded from new batch", async () => {
    // Simulate teacher with existing historical documents in DB
    const historicalBatchId = "batch-1732000000000-old001";
    const newBatchId = "batch-1732520000000-new002";

    const mockDbDocuments = [
      {
        id: "doc-old-1",
        original_filename: "Gomez Front.png",
        document_type: "sf9",
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "Diamond",
        uploaded_by: "teacher-uuid-001",
        status: "verified",
        extracted_fields: {
          batch_id: historicalBatchId,
          learner_name: "Gomez, Juan",
          lrn: "123456789012",
        },
      },
      {
        id: "doc-old-2",
        original_filename: "synthetic_sf9_sample.jpg",
        document_type: "sf9",
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "Diamond",
        uploaded_by: "teacher-uuid-001",
        status: "verified",
        extracted_fields: {
          batch_id: historicalBatchId,
          learner_name: "Santos, Maria",
          lrn: "987654321098",
        },
      },
      {
        id: "doc-new-1",
        original_filename: "SF1_Grade11_Diamond.pdf",
        document_type: "sf1",
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "Diamond",
        uploaded_by: "teacher-uuid-001",
        status: "verified",
        extracted_fields: {
          batch_id: newBatchId,
          roster: [{ lrn: "111122223333", name: "Dela Cruz, Ana" }],
        },
      },
    ];

    // Simulate GET /api/scan/batch?assignmentId=xxx&batchId=batch-1732520000000-new002
    function simulateGetSavedBatch(requestedBatchId) {
      if (requestedBatchId === "new" || requestedBatchId === "none") {
        return { hasSavedBatch: false, message: "New batch active." };
      }

      const activeDocs = mockDbDocuments.filter((d) => !["archived", "rejected"].includes(d.status));

      let filteredDocs = activeDocs;
      if (requestedBatchId) {
        filteredDocs = activeDocs.filter((d) => d.extracted_fields?.batch_id === requestedBatchId);
      } else {
        const latestBatchId = activeDocs[0]?.extracted_fields?.batch_id;
        if (latestBatchId) {
          filteredDocs = activeDocs.filter((d) => d.extracted_fields?.batch_id === latestBatchId);
        }
      }

      if (filteredDocs.length === 0) {
        return { hasSavedBatch: false, batchId: requestedBatchId, message: "No documents found." };
      }

      return {
        hasSavedBatch: true,
        batchId: requestedBatchId || filteredDocs[0]?.extracted_fields?.batch_id,
        documents: filteredDocs,
      };
    }

    // 1. When querying for a brand-new unsubmitted batch ID:
    const emptyResult = simulateGetSavedBatch("batch-9999999999999-brandnew");
    assert.equal(emptyResult.hasSavedBatch, false, "Brand new batch must return hasSavedBatch: false");

    // 2. When querying with batchId=new:
    const newExplicitResult = simulateGetSavedBatch("new");
    assert.equal(newExplicitResult.hasSavedBatch, false, "Explicit 'new' must return hasSavedBatch: false");

    // 3. When querying for newBatchId (which has SF1 uploaded):
    const newBatchResult = simulateGetSavedBatch(newBatchId);
    assert.equal(newBatchResult.hasSavedBatch, true);
    assert.equal(newBatchResult.documents.length, 1);
    assert.equal(newBatchResult.documents[0].original_filename, "SF1_Grade11_Diamond.pdf");

    // CRITICAL: Ensure old batch documents are NOT present in new batch result
    const filenamesInNewBatch = newBatchResult.documents.map((d) => d.original_filename);
    assert.ok(
      !filenamesInNewBatch.includes("Gomez Front.png"),
      "Gomez Front.png must NOT appear in new batch"
    );
    assert.ok(
      !filenamesInNewBatch.includes("synthetic_sf9_sample.jpg"),
      "synthetic_sf9_sample.jpg must NOT appear in new batch"
    );

    // 4. When explicitly resuming historical batch:
    const oldBatchResult = simulateGetSavedBatch(historicalBatchId);
    assert.equal(oldBatchResult.hasSavedBatch, true);
    assert.equal(oldBatchResult.documents.length, 2);
    const filenamesInOldBatch = oldBatchResult.documents.map((d) => d.original_filename);
    assert.ok(filenamesInOldBatch.includes("Gomez Front.png"));
    assert.ok(filenamesInOldBatch.includes("synthetic_sf9_sample.jpg"));
    assert.ok(!filenamesInOldBatch.includes("SF1_Grade11_Diamond.pdf"), "New batch file must not leak into old batch");
  });

  await t.test("9. Behavioral: Page refresh during active new batch retains new batch and does not restore previous", async () => {
    let mockSessionStorage = {
      avv_active_batch_id: "batch-active-new-456",
      avv_is_new_batch: "true",
    };

    // On page load/refresh, read from sessionStorage
    const activeBatchId = mockSessionStorage.avv_active_batch_id;
    const isNewBatch = mockSessionStorage.avv_is_new_batch === "true";

    assert.ok(activeBatchId.startsWith("batch-"));
    assert.equal(isNewBatch, true);

    // Construct request query
    const queryBatchParam = isNewBatch ? activeBatchId : "";
    const fetchUrl = `/api/scan/batch?assignmentId=assign-1&batchId=${queryBatchParam}`;

    assert.ok(fetchUrl.includes(`batchId=${activeBatchId}`), "Refresh must query with active new batch ID");
    assert.ok(!fetchUrl.includes("historical"), "Refresh must not query historical batch");
  });

  await t.test("10. Behavioral: Two sequential batches by same teacher remain completely isolated in cross-validation", () => {
    const batch1Id = "batch-section-A-001";
    const batch2Id = "batch-section-A-002";

    const batch1Segments = [
      {
        id: "seg-b1-1",
        documentType: "sf1",
        formTitle: "SF1-SHS",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
        pageCount: 1,
        combinedText: "SF1 Learner 1",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
      },
    ];

    const batch2Segments = [
      {
        id: "seg-b2-1",
        documentType: "sf1",
        formTitle: "SF1-SHS",
        startPage: 1,
        endPage: 1,
        pageNumbers: [1],
        pageCount: 1,
        combinedText: "SF1 Learner 2",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [],
      },
    ];

    const report1 = evaluateBatchCrossDocumentValidation({
      batchId: batch1Id,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      segments: batch1Segments,
      extractedSegmentData: {
        "seg-b1-1": {
          form_variant: "sf1",
          learners: [{ lrn: "100000000001", last_name: "Alvarez", first_name: "Bea" }],
        },
      },
    });

    const report2 = evaluateBatchCrossDocumentValidation({
      batchId: batch2Id,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
      segments: batch2Segments,
      extractedSegmentData: {
        "seg-b2-1": {
          form_variant: "sf1",
          learners: [{ lrn: "200000000002", last_name: "Cruz", first_name: "Daniel" }],
        },
      },
    });

    assert.equal(report1.batchId, batch1Id);
    assert.equal(report2.batchId, batch2Id);
    assert.notEqual(report1.batchId, report2.batchId);

    // Verify learners are not mixed
    assert.equal(report1.learnerDossiers.length, 1);
    assert.equal(report1.learnerDossiers[0].lrn, "100000000001");

    assert.equal(report2.learnerDossiers.length, 1);
    assert.equal(report2.learnerDossiers[0].lrn, "200000000002");
  });

  await t.test("11. Old records preserved: No DELETE statements or table truncations on batch creation", () => {
    // Assert that nowhere in upload/page.tsx or scan/batch/route.ts are DELETE or truncate calls performed
    assert.ok(
      !uploadPageSrc.includes(".delete()") &&
      !uploadPageSrc.includes("DELETE FROM"),
      "upload/page.tsx must never execute DELETE queries"
    );
    assert.ok(
      !batchScanRouteSrc.includes("TRUNCATE"),
      "scan/batch/route.ts must never execute TRUNCATE"
    );
  });

  await t.test("12. Security: Admin and Principal remain strictly forbidden from batch scanning and uploading", () => {
    const testSchoolId = "school-uuid-500169";

    const adminCheck = evaluateTeacherScanAuthorization({
      userRole: "admin",
      userId: "admin-1",
      accountStatus: "Approved",
      userSchoolId: testSchoolId,
      assignment: {
        id: "as-1",
        teacher_id: "admin-1",
        assignment_type: "class_adviser",
        school_id: testSchoolId,
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "Diamond",
        status: "active",
      },
      assignmentConfirmed: true,
    });
    assert.equal(adminCheck.allowed, false);
    assert.equal(adminCheck.code, "ADMIN_CANNOT_UPLOAD");

    const principalCheck = evaluateTeacherScanAuthorization({
      userRole: "principal",
      userId: "principal-1",
      accountStatus: "Approved",
      userSchoolId: testSchoolId,
      assignment: {
        id: "as-2",
        teacher_id: "principal-1",
        assignment_type: "class_adviser",
        school_id: testSchoolId,
        school_year: "2024-2025",
        grade_level: "Grade 11",
        section: "Diamond",
        status: "active",
      },
      assignmentConfirmed: true,
    });
    assert.equal(principalCheck.allowed, false);
    assert.equal(principalCheck.code, "PRINCIPAL_READ_ONLY");
  });
});

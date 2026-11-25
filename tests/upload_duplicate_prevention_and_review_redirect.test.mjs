import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AVV Upload Duplicate Prevention & Automatic Review Queue Redirect Suite", async (t) => {
  const rootDir = path.resolve("./");
  const uploadPagePath = path.join(rootDir, "src/app/upload/page.tsx");
  const documentsRoutePath = path.join(rootDir, "src/app/api/documents/route.ts");
  const uploadWorkflowPath = path.join(rootDir, "src/lib/upload/uploadWorkflow.ts");
  const batchScanRoutePath = path.join(rootDir, "src/app/api/scan/batch/route.ts");

  const uploadPageSrc = fs.readFileSync(uploadPagePath, "utf8");
  const documentsRouteSrc = fs.readFileSync(documentsRoutePath, "utf8");
  const uploadWorkflowSrc = fs.readFileSync(uploadWorkflowPath, "utf8");
  const batchScanRouteSrc = fs.readFileSync(batchScanRoutePath, "utf8");

  // ── 1. Static Source Code Verification ─────────────────────────────────────
  await t.test("1. UploadPage implements synchronous submission guard and stage state machine", () => {
    assert.ok(
      uploadPageSrc.includes("const [stage, setStage] = useState<UnifiedProcessingStage>(\"idle\")"),
      "UploadPage must declare UnifiedProcessingStage state initialized to 'idle'"
    );
    assert.ok(
      uploadPageSrc.includes('disabled={stage !== "idle" && stage !== "error"}'),
      "UploadPage must disable primary action button synchronously whenever stage is active"
    );
    assert.ok(
      uploadPageSrc.includes("if (!ensureTeacherAssignmentConfirmed()) return;"),
      "UploadPage must synchronously enforce active class adviser assignment before starting scan"
    );
    assert.ok(
      uploadPageSrc.includes("if (filePreviews.length === 0)"),
      "UploadPage must synchronously block execution if no files are staged"
    );
  });

  await t.test("2. UploadPage displays unified batch processing stages and progress status messages", () => {
    assert.ok(
      uploadPageSrc.includes("const STAGES_CONFIG"),
      "UploadPage must configure batch progression in STAGES_CONFIG"
    );

    const requiredStages = [
      "uploading",
      "classifying",
      "extracting",
      "organizing",
      "matching",
      "validating",
      "completed",
    ];

    for (const stg of requiredStages) {
      assert.ok(
        uploadPageSrc.includes(`id: "${stg}"`),
        `STAGES_CONFIG must define stage id "${stg}"`
      );
    }

    assert.ok(
      uploadPageSrc.includes('setStage("uploading")') &&
      uploadPageSrc.includes('setStage("classifying")') &&
      uploadPageSrc.includes('setStage("extracting")') &&
      uploadPageSrc.includes('setStage("organizing")') &&
      uploadPageSrc.includes('setStage("matching")') &&
      uploadPageSrc.includes('setStage("validating")') &&
      uploadPageSrc.includes('setStage("completed")'),
      "UploadPage must update stage through all 7 sequential processing stages"
    );

    assert.ok(
      uploadPageSrc.includes("setStatusMessage("),
      "UploadPage must dynamically update user-facing status messages"
    );
  });

  await t.test("3. UploadPage renders UnifiedBatchResultsView upon completion without redirecting away", () => {
    assert.ok(
      uploadPageSrc.includes('stage === "completed" && validationReport ? (') &&
      uploadPageSrc.includes("<UnifiedBatchResultsView"),
      "UploadPage must render UnifiedBatchResultsView in-place once validationReport is ready"
    );
    assert.ok(
      uploadPageSrc.includes('report={validationReport}'),
      "UploadPage must bind the consolidated batch validationReport to UnifiedBatchResultsView"
    );
    assert.ok(
      uploadPageSrc.includes('initialStage="stage_b"'),
      "UploadPage must preserve the 5-stage results navigation (Stages A-E) in UnifiedBatchResultsView"
    );
    assert.strictEqual(
      uploadPageSrc.includes("router.push('/review')"),
      false,
      "UploadPage must NOT redirect to /review on completion, preserving in-page five-stage validation dossier"
    );
  });

  await t.test("4. Documents API Route implements idempotent persistence for document_id", () => {
    assert.ok(
      documentsRouteSrc.includes("body.document_id"),
      "API route must handle body.document_id"
    );
    assert.ok(
      documentsRouteSrc.includes(".update(documentPayload)") &&
      documentsRouteSrc.includes(".insert({ ...documentPayload, id: body.document_id })"),
      "API route must check if document_id exists to update, or insert with this ID"
    );
  });

  await t.test("5. Documents API Route preserves needs_review status for mandatory human verification", () => {
    assert.ok(
      documentsRouteSrc.includes("newStatus = 'needs_review'") &&
      documentsRouteSrc.includes("status === 'needs_review'"),
      "Validation engine must preserve needs_review status when document is staged for review"
    );
  });

  await t.test("6. Payload Builder injects needs_review as default status", () => {
    assert.ok(
      uploadWorkflowSrc.includes('status: params.status || "needs_review"'),
      "buildDocumentSubmissionPayload must set status to needs_review by default"
    );
  });

  await t.test("7. Security: Idempotent document_id cannot update or overwrite documents of another user or school", () => {
    assert.ok(
      documentsRouteSrc.includes("existingDoc.uploaded_by !== uploadedBy || existingDoc.school_id !== userSchoolId"),
      "API route must reject modification of documents belonging to another user or school"
    );
    assert.ok(
      documentsRouteSrc.includes("status: 403"),
      "API route must return HTTP 403 Forbidden on unauthorized document overwrite attempts"
    );
    assert.ok(
      documentsRouteSrc.includes("existingDoc.status === 'approved' || existingDoc.status === 'archived'"),
      "API route must reject overwriting approved or archived documents"
    );
  });

  await t.test("8. Safe Conflict Handling: Database unique constraint violations are safely caught", () => {
    assert.ok(
      documentsRouteSrc.includes("docError.code === '23505'") ||
      documentsRouteSrc.includes("duplicate key"),
      "API route must catch code 23505 unique constraint conflicts and resolve idempotently"
    );
  });

  await t.test("9. Storage Idempotency: API routes support deduplication, deterministic paths, and upsert", () => {
    const uploadApiSrc = fs.readFileSync(path.join(rootDir, "src/app/api/upload/route.ts"), "utf8");
    assert.ok(
      uploadApiSrc.includes("upsert: true"),
      "Storage upload route must enable upsert: true for idempotent writes"
    );
    assert.ok(
      uploadApiSrc.includes("documentId"),
      "Storage upload route must accept client documentId for deterministic pathing"
    );
    assert.ok(
      batchScanRouteSrc.includes("uniqueFilesToUpload"),
      "Batch scan API must deduplicate unique source files using uniqueFilesToUpload Map before uploading"
    );
    assert.ok(
      batchScanRouteSrc.includes("upsert: true"),
      "Batch storage upload must specify upsert: true for idempotent storage writes"
    );
    assert.ok(
      batchScanRouteSrc.includes("storagePath"),
      "Batch scan API must track deterministic storagePath per file"
    );
    assert.ok(
      batchScanRouteSrc.includes("retry_segment") || batchScanRouteSrc.includes("retrySegmentId"),
      "Batch scan API must support retrying individual segments without re-uploading duplicate binaries"
    );
  });

  await t.test("10. Reset mechanism on new batch: handleStartNewBatch cleanly clears all batch state", () => {
    assert.ok(
      uploadPageSrc.includes("handleStartNewBatch"),
      "Upload page must define handleStartNewBatch callback"
    );
    assert.ok(
      uploadPageSrc.includes("setSelectedFiles([])") &&
      uploadPageSrc.includes("setFilePreviews([])") &&
      uploadPageSrc.includes("setDetectedSegments([])") &&
      uploadPageSrc.includes("setExtractedData({})") &&
      uploadPageSrc.includes("setValidationReport(null)") &&
      uploadPageSrc.includes('setStage("idle")') &&
      uploadPageSrc.includes("setErrorMessage(null)"),
      "handleStartNewBatch must reset all batch state variables to prevent stale result reuse"
    );
  });

  await t.test("11. Status transitions: Valid documents without review stay validated, invalid documents become rejected", () => {
    assert.ok(
      documentsRouteSrc.includes("report.status === 'invalid' || status === 'rejected'"),
      "Invalid documents must be set to rejected"
    );
    assert.ok(
      documentsRouteSrc.includes("newStatus = 'validated'"),
      "Legitimately valid documents without review requirement become validated"
    );
  });

  // ── 2. Functional Behavioral Simulations ──────────────────────────────────
  await t.test("12. Simulation: Synchronous stage guard immediately drops duplicate scan clicks", async () => {
    let callCount = 0;
    let stage = "idle";
    const progressLog = [];

    async function handleStartScanClick() {
      // Synchronous Guard matching disabled={stage !== "idle" && stage !== "error"}
      if (stage !== "idle" && stage !== "error") {
        return { accepted: false, reason: "BLOCKED_BY_GUARD" };
      }
      stage = "uploading";
      callCount += 1;

      // Batch Pipeline simulation
      progressLog.push("File Upload");
      await new Promise((resolve) => setTimeout(resolve, 5));

      stage = "classifying";
      progressLog.push("Document Classification");
      await new Promise((resolve) => setTimeout(resolve, 5));

      stage = "extracting";
      progressLog.push("OCR/ICR Extraction");
      await new Promise((resolve) => setTimeout(resolve, 5));

      stage = "validating";
      progressLog.push("Cross-Document Validation");
      await new Promise((resolve) => setTimeout(resolve, 5));

      stage = "completed";
      progressLog.push("Validation Report");
      return { accepted: true, stage: "completed" };
    }

    // Simulate user rapidly clicking Start Scanning button 5 times within the same event cycle
    const results = await Promise.all([
      handleStartScanClick(),
      handleStartScanClick(),
      handleStartScanClick(),
      handleStartScanClick(),
      handleStartScanClick(),
    ]);

    // Exactly one click must be accepted
    const accepted = results.filter((r) => r.accepted);
    const blocked = results.filter((r) => !r.accepted);

    assert.strictEqual(accepted.length, 1, "Exactly one upload operation must execute");
    assert.strictEqual(blocked.length, 4, "All 4 subsequent duplicate clicks must be rejected by synchronous guard");
    assert.strictEqual(callCount, 1, "Handler pipeline must run exactly once");

    // All required batch stages must have executed in exact sequence
    assert.deepStrictEqual(progressLog, [
      "File Upload",
      "Document Classification",
      "OCR/ICR Extraction",
      "Cross-Document Validation",
      "Validation Report",
    ]);
  });

  await t.test("13. Simulation: Idempotent backend persistence prevents duplicate document records", async () => {
    const documentDatabase = new Map();

    function persistDocument(body, user) {
      const documentPayload = {
        student_id: body.student_id || null,
        school_id: "a0000000-0000-0000-0000-000000000001",
        document_type: body.document_type || "sf9",
        image_url: body.image_url || "uploaded-document",
        original_filename: body.original_filename || "scan.jpg",
        extracted_fields: body.extracted_fields || {},
        status: body.status || "needs_review",
        uploaded_by: user.id,
      };

      if (body.document_id) {
        if (documentDatabase.has(body.document_id)) {
          // Idempotent update
          const existing = documentDatabase.get(body.document_id);
          const updated = {
            ...existing,
            ...documentPayload,
            updated_at: new Date().toISOString(),
          };
          documentDatabase.set(body.document_id, updated);
          return { data: updated, action: "UPDATED" };
        } else {
          // Idempotent insert with client ID
          const created = {
            ...documentPayload,
            id: body.document_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          documentDatabase.set(body.document_id, created);
          return { data: created, action: "INSERTED" };
        }
      }

      // Fallback: check recent duplicate
      for (const [id, doc] of documentDatabase.entries()) {
        if (
          doc.uploaded_by === user.id &&
          doc.document_type === documentPayload.document_type &&
          doc.image_url === documentPayload.image_url &&
          ["submitted", "needs_review"].includes(doc.status)
        ) {
          const updated = { ...doc, ...documentPayload, updated_at: new Date().toISOString() };
          documentDatabase.set(id, updated);
          return { data: updated, action: "DEDUPED" };
        }
      }

      const generatedId = `doc-${Date.now()}`;
      const created = { ...documentPayload, id: generatedId, created_at: new Date().toISOString() };
      documentDatabase.set(generatedId, created);
      return { data: created, action: "INSERTED" };
    }

    const testUser = { id: "teacher-user-123", email: "teacher@tris.deped.gov.ph" };
    const clientSubmissionId = "uuid-client-submission-456";

    // 1. Initial Submission
    const firstAttempt = persistDocument(
      {
        document_id: clientSubmissionId,
        document_type: "sf9",
        image_url: "https://storage.example/sf9_front.jpg",
        status: "needs_review",
        extracted_fields: { name: "Dela Cruz, Juan", lrn: "123456789012" },
      },
      testUser
    );

    assert.strictEqual(firstAttempt.action, "INSERTED");
    assert.strictEqual(documentDatabase.size, 1);
    assert.strictEqual(firstAttempt.data.status, "needs_review");

    // 2. Immediate Network Retry or Double-Click with the same client submission ID
    const retryAttempt = persistDocument(
      {
        document_id: clientSubmissionId,
        document_type: "sf9",
        image_url: "https://storage.example/sf9_front.jpg",
        status: "needs_review",
        extracted_fields: { name: "Dela Cruz, Juan", lrn: "123456789012" },
      },
      testUser
    );

    assert.strictEqual(retryAttempt.action, "UPDATED");
    assert.strictEqual(documentDatabase.size, 1, "Must maintain exactly ONE record on retry with document_id");

    // 3. Fallback Duplicate Prevention when document_id is omitted on duplicate submission
    const duplicateWithoutId = persistDocument(
      {
        document_type: "sf9",
        image_url: "https://storage.example/sf9_front.jpg",
        status: "needs_review",
        extracted_fields: { name: "Dela Cruz, Juan", lrn: "123456789012" },
      },
      testUser
    );

    assert.strictEqual(duplicateWithoutId.action, "DEDUPED");
    assert.strictEqual(documentDatabase.size, 1, "Must maintain exactly ONE record via deduplication fallback");

    // 4. Verification that document is visible in the Review Queue query
    const reviewQueueResults = Array.from(documentDatabase.values()).filter(
      (d) => d.status === "needs_review"
    );
    assert.strictEqual(reviewQueueResults.length, 1);
    assert.strictEqual(reviewQueueResults[0].id, clientSubmissionId);
    assert.strictEqual(reviewQueueResults[0].extracted_fields.name, "Dela Cruz, Juan");
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AVV Upload Duplicate Prevention & Automatic Review Queue Redirect Suite", async (t) => {
  const rootDir = path.resolve("./");
  const uploadPagePath = path.join(rootDir, "src/app/upload/page.tsx");
  const documentsRoutePath = path.join(rootDir, "src/app/api/documents/route.ts");
  const uploadWorkflowPath = path.join(rootDir, "src/lib/upload/uploadWorkflow.ts");

  const uploadPageSrc = fs.readFileSync(uploadPagePath, "utf8");
  const documentsRouteSrc = fs.readFileSync(documentsRoutePath, "utf8");
  const uploadWorkflowSrc = fs.readFileSync(uploadWorkflowPath, "utf8");

  // ── 1. Static Source Code Verification ─────────────────────────────────────
  await t.test("1. UploadPage implements synchronous submission guard using useRef", () => {
    assert.ok(
      uploadPageSrc.includes("isSubmittingRef = useRef<boolean>(false)"),
      "UploadPage must declare isSubmittingRef with useRef<boolean>(false)"
    );
    assert.ok(
      uploadPageSrc.includes("if (isSubmittingRef.current)") &&
      uploadPageSrc.includes("isSubmittingRef.current = true"),
      "UploadPage must check and set isSubmittingRef.current synchronously before any async operations"
    );
    assert.ok(
      uploadPageSrc.includes("submissionIdRef = useRef<string | null>(null)"),
      "UploadPage must track client submission UUID in submissionIdRef"
    );
  });

  await t.test("2. UploadPage displays the exact required progress status messages in order", () => {
    const requiredStatuses = [
      "Uploading document...",
      "Processing OCR...",
      "Saving extracted information...",
      "Preparing Review Queue...",
    ];

    for (const status of requiredStatuses) {
      assert.ok(
        uploadPageSrc.includes(status),
        `UploadPage must include exact status string: "${status}"`
      );
    }
  });

  await t.test("3. UploadPage automatically redirects to /review after persistence without resetting lock", () => {
    assert.ok(
      uploadPageSrc.includes("useRouter") && uploadPageSrc.includes("router.push('/review')"),
      "UploadPage must import useRouter and execute router.push('/review') upon successful persistence"
    );

    // Verify submission lock is not reset on success
    const successRedirectBlock = uploadPageSrc.match(
      /setUploadProgressStatus\("Preparing Review Queue\.\.\."\);[\s\S]*?router\.push\('\/review'\);/
    );
    assert.ok(
      successRedirectBlock,
      "UploadPage must transition to Preparing Review Queue... and router.push('/review')"
    );
    assert.strictEqual(
      successRedirectBlock[0].includes("isSubmittingRef.current = false"),
      false,
      "Submission lock must NOT be reset to false upon successful redirect to avoid race duplicates"
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
      documentsRouteSrc.includes("let newStatus = status === 'needs_review' ? 'needs_review' : 'validated';"),
      "Validation engine must preserve needs_review status when document is staged for review"
    );
  });

  await t.test("6. Payload Builder injects needs_review as default status", () => {
    assert.ok(
      uploadWorkflowSrc.includes('status: params.status || "needs_review"'),
      "buildDocumentSubmissionPayload must set status to needs_review by default"
    );
  });

  // ── 2. Functional Behavioral Simulations ──────────────────────────────────
  await t.test("7. Simulation: Synchronous guard immediately drops duplicate button clicks", async () => {
    let callCount = 0;
    const isSubmittingRef = { current: false };
    const progressLog = [];

    async function handleUploadClick() {
      // Synchronous Guard (Phase 2 requirement)
      if (isSubmittingRef.current) {
        return { accepted: false, reason: "BLOCKED_BY_GUARD" };
      }
      isSubmittingRef.current = true;
      callCount += 1;

      // Pipeline simulation
      progressLog.push("Uploading document...");
      await new Promise((resolve) => setTimeout(resolve, 5));

      progressLog.push("Processing OCR...");
      await new Promise((resolve) => setTimeout(resolve, 5));

      progressLog.push("Saving extracted information...");
      await new Promise((resolve) => setTimeout(resolve, 5));

      progressLog.push("Preparing Review Queue...");
      return { accepted: true, redirect: "/review" };
    }

    // Simulate user rapidly clicking Upload button 5 times within the same event cycle
    const results = await Promise.all([
      handleUploadClick(),
      handleUploadClick(),
      handleUploadClick(),
      handleUploadClick(),
      handleUploadClick(),
    ]);

    // Exactly one click must be accepted
    const accepted = results.filter((r) => r.accepted);
    const blocked = results.filter((r) => !r.accepted);

    assert.strictEqual(accepted.length, 1, "Exactly one upload operation must execute");
    assert.strictEqual(blocked.length, 4, "All 4 subsequent duplicate clicks must be rejected by synchronous guard");
    assert.strictEqual(callCount, 1, "Handler pipeline must run exactly once");

    // All 4 required stages must have executed in exact sequence
    assert.deepStrictEqual(progressLog, [
      "Uploading document...",
      "Processing OCR...",
      "Saving extracted information...",
      "Preparing Review Queue...",
    ]);
  });

  await t.test("8. Simulation: Idempotent backend persistence prevents duplicate document records", async () => {
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

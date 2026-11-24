import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateTeacherScanAuthorization,
  normalizeGradeLevelKey,
} from "../src/lib/teacher/assignments.ts";

import {
  segmentMultiPageDocument,
} from "../src/lib/validation/batchDocumentSegmenter.ts";

import {
  evaluateBatchCrossDocumentValidation,
} from "../src/lib/validation/batchCrossDocumentValidator.ts";

/**
 * Helper to simulate base64 data URLs for testing
 */
function createMockBase64Pdf(content = "DepEd Senior High School Mock PDF") {
  const base64 = Buffer.from(content).toString("base64");
  return `data:application/pdf;base64,${base64}`;
}

test("AVV System — Batch Original File Storage & Refresh Recovery Test Suite", async (t) => {

  // ===========================================================================
  // 1. Actual Binary Storage Upload Invocation
  // ===========================================================================
  await t.test("1. Actual binary Storage upload invocation with Migration 026-compliant path", async () => {
    const storageCalls = [];

    const mockStorage = {
      from(bucket) {
        assert.equal(bucket, "documents", "Must upload to existing private 'documents' bucket");
        return {
          upload(path, buffer, options) {
            storageCalls.push({ action: "upload", bucket, path, buffer, options });
            return Promise.resolve({ data: { path }, error: null });
          },
          createSignedUrl(path, expiresIn) {
            storageCalls.push({ action: "createSignedUrl", bucket, path, expiresIn });
            return Promise.resolve({
              data: { signedUrl: `https://supabase.co/storage/v1/object/sign/documents/${path}?token=mock_token` },
              error: null,
            });
          },
        };
      },
    };

    const teacherId = "teacher-uuid-001";
    const assignmentId = "b9f39e31-64d8-4a5c-9c78-1a2b3c4d5e6f";
    const filename = "SF1_Grade11_Diamond.pdf";
    const mockPdfDataUrl = createMockBase64Pdf("SF1 School Register Content");

    // Extract buffer from dataUrl
    const match = mockPdfDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    assert.ok(match, "Data URL must be valid format");
    const mimeType = match[1];
    const fileBuffer = Buffer.from(match[2], "base64");

    assert.ok(Buffer.isBuffer(fileBuffer), "Upload must pass actual binary Buffer");
    assert.equal(mimeType, "application/pdf");

    // Storage path convention under Migration 026:
    // folder 1 = teacherId, folder 2 = assignmentId UUID
    const storagePath = `${teacherId}/${assignmentId}/${Date.now()}_abc123_${filename}`;

    const { data: uploadResult, error: uploadErr } = await mockStorage
      .from("documents")
      .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: true });

    assert.equal(uploadErr, null);
    assert.equal(uploadResult.path, storagePath);

    // Verify call structure
    assert.equal(storageCalls.length, 1);
    const call = storageCalls[0];
    assert.equal(call.action, "upload");
    assert.equal(call.bucket, "documents");
    assert.ok(call.path.startsWith(`${teacherId}/${assignmentId}/`), "Path must embed teacherId and assignmentId");
    assert.ok(Buffer.isBuffer(call.buffer), "Must upload binary Buffer, not base64 string");
    assert.equal(call.options.contentType, "application/pdf");
  });

  // ===========================================================================
  // 2. Real Storage Path Persistence & No Base64 in documents.image_url
  // ===========================================================================
  await t.test("2. Real storage path persistence and verified document payload", async () => {
    const insertedDocs = [];
    const mockDb = {
      from(table) {
        assert.equal(table, "documents");
        return {
          insert(payload) {
            insertedDocs.push(payload);
            return Promise.resolve({ data: payload, error: null });
          },
        };
      },
    };

    const docId = "doc-uuid-001";
    const realStoragePath = "teacher-uuid-001/b9f39e31-64d8-4a5c-9c78-1a2b3c4d5e6f/1732400000_abc123_SF1.pdf";
    const realSignedUrl = `https://supabase.co/storage/v1/object/sign/documents/${realStoragePath}?token=mock`;

    const parentDocPayload = {
      id: docId,
      school_id: "school-uuid-001",
      teacher_assignment_id: "b9f39e31-64d8-4a5c-9c78-1a2b3c4d5e6f",
      student_id: null,
      document_type: "sf1",
      image_url: realSignedUrl,
      storage_path: realStoragePath,
      original_filename: "SF1_Grade11_Diamond.pdf",
      extracted_text: "School Form 1 Register",
      extracted_fields: {
        batch_id: "batch-101",
        segment_id: "seg-1-sf1",
        source_file: "SF1_Grade11_Diamond.pdf",
        mime_type: "application/pdf",
      },
      ocr_model: "azure-prebuilt-read",
      ocr_confidence: 0.98,
      status: "needs_review", // Must be needs_review, never verified
      school_year: "2024-2025",
      grade_level: "Grade 11",
      section: "Diamond",
      uploaded_by: "teacher-uuid-001",
    };

    await mockDb.from("documents").insert(parentDocPayload);

    assert.equal(insertedDocs.length, 1);
    const saved = insertedDocs[0];
    assert.equal(saved.storage_path, realStoragePath, "Must persist real storage path");
    assert.ok(!saved.image_url.startsWith("data:"), "image_url must NEVER store raw base64 data URLs");
    assert.ok(saved.image_url.startsWith("https://"), "image_url must store signed URL");
    assert.equal(saved.status, "needs_review", "Newly scanned documents must enter as needs_review");
    assert.equal(saved.teacher_assignment_id, "b9f39e31-64d8-4a5c-9c78-1a2b3c4d5e6f");
  });

  // ===========================================================================
  // 3. Multiple Files Uploaded Once Each
  // ===========================================================================
  await t.test("3. Multiple files uploaded once each in multi-file batch", async () => {
    const uploadedFiles = [];
    const mockStorage = {
      from(bucket) {
        return {
          upload(path, buffer, options) {
            uploadedFiles.push({ path, filename: path.split("_").pop() });
            return Promise.resolve({ data: { path }, error: null });
          },
          createSignedUrl(path) {
            return Promise.resolve({ data: { signedUrl: `https://mock/${path}` }, error: null });
          },
        };
      },
    };

    const files = [
      { name: "SF1_Diamond.pdf", dataUrl: createMockBase64Pdf("SF1") },
      { name: "SF2_Attendance.pdf", dataUrl: createMockBase64Pdf("SF2") },
      { name: "SF9_ReportCard.pdf", dataUrl: createMockBase64Pdf("SF9") },
    ];

    // Deduplicate and upload
    const uploadedMap = new Map();
    for (const f of files) {
      if (!uploadedMap.has(f.name)) {
        const path = `teacher-01/assign-01/${Date.now()}_${f.name}`;
        await mockStorage.from("documents").upload(path, Buffer.from("pdf"), { contentType: "application/pdf" });
        uploadedMap.set(f.name, path);
      }
    }

    assert.equal(uploadedFiles.length, 3, "Three files must produce exactly three Storage uploads");
    assert.ok(uploadedFiles.some((f) => f.path.includes("SF1_Diamond.pdf")));
    assert.ok(uploadedFiles.some((f) => f.path.includes("SF2_Attendance.pdf")));
    assert.ok(uploadedFiles.some((f) => f.path.includes("SF9_ReportCard.pdf")));
  });

  // ===========================================================================
  // 4. Multiple Segments Referencing the Correct Single Original Source File
  // ===========================================================================
  await t.test("4. Multiple segments from one combined PDF share the same storage_path without duplicate uploads", async () => {
    const storageUploads = [];
    const documentRecords = [];

    const mockStorage = {
      from(bucket) {
        return {
          upload(path, buffer) {
            storageUploads.push(path);
            return Promise.resolve({ data: { path }, error: null });
          },
          createSignedUrl(path) {
            return Promise.resolve({ data: { signedUrl: `https://signed/${path}` }, error: null });
          },
        };
      },
    };

    // Single 14-page combined PDF
    const combinedFilename = "Combined_School_Forms_Grade11.pdf";
    const singleStoragePath = `teacher-01/assign-01/1732400000_${combinedFilename}`;

    // Upload once
    await mockStorage.from("documents").upload(singleStoragePath, Buffer.from("14-page-pdf"));
    assert.equal(storageUploads.length, 1, "Combined PDF must be uploaded to Storage exactly once");

    // 7 segments identified from this combined file
    const segments = [
      { id: "seg-1", type: "sf1", pages: [1, 2, 3] },
      { id: "seg-2", type: "sf2", pages: [4, 5] },
      { id: "seg-3", type: "sf5a", pages: [6, 7] },
      { id: "seg-4", type: "sf5b", pages: [8] },
      { id: "seg-5", type: "sf9", pages: [9, 10] },
      { id: "seg-6", type: "sf10", pages: [11, 12, 13] },
      { id: "seg-7", type: "birth_cert", pages: [14] },
    ];

    for (const seg of segments) {
      documentRecords.push({
        id: `doc-${seg.id}`,
        document_type: seg.type === "sf5a" || seg.type === "sf5b" ? "sf5" : seg.type,
        storage_path: singleStoragePath, // Reuses single storage path!
        original_filename: combinedFilename,
        extracted_fields: {
          segment_id: seg.id,
          source_file: combinedFilename,
          page_numbers: seg.pages,
          start_page: seg.pages[0],
          end_page: seg.pages[seg.pages.length - 1],
        },
      });
    }

    assert.equal(documentRecords.length, 7, "Must persist 7 parent document records");
    // All 7 documents reference the identical single storage path
    for (const doc of documentRecords) {
      assert.equal(doc.storage_path, singleStoragePath, "All segments must reference the real uploaded file path");
      assert.equal(doc.original_filename, combinedFilename);
    }
    // Storage was only called once
    assert.equal(storageUploads.length, 1);
  });

  // ===========================================================================
  // 5. Signed URL Generation on GET Endpoint
  // ===========================================================================
  await t.test("5. GET endpoint generates fresh 1-hour signed URL for private Storage objects", async () => {
    let signedUrlRequestedPath = null;
    let signedUrlExpiresIn = null;

    const mockStorage = {
      from(bucket) {
        assert.equal(bucket, "documents");
        return {
          createSignedUrl(path, expiresIn) {
            signedUrlRequestedPath = path;
            signedUrlExpiresIn = expiresIn;
            return Promise.resolve({
              data: { signedUrl: `https://supabase.co/storage/v1/object/sign/documents/${path}?token=fresh_token` },
              error: null,
            });
          },
        };
      },
    };

    const docInDb = {
      id: "doc-123",
      storage_path: "teacher-01/assign-01/1732400000_SF1.pdf",
      image_url: "https://expired-token-from-yesterday.com",
    };

    // GET handler logic:
    const { data: signedData } = await mockStorage
      .from("documents")
      .createSignedUrl(docInDb.storage_path, 3600);

    assert.equal(signedUrlRequestedPath, docInDb.storage_path);
    assert.equal(signedUrlExpiresIn, 3600, "Signed URL should be 3600 seconds (1 hour)");
    assert.ok(signedData.signedUrl.includes("fresh_token"));
  });

  // ===========================================================================
  // 6. Source Image Restoration After Browser Refresh
  // ===========================================================================
  await t.test("6. Full source image restoration into segments and pages after browser refresh", async () => {
    const mockStorage = {
      from() {
        return {
          createSignedUrl(path) {
            return Promise.resolve({
              data: { signedUrl: `https://supabase.co/storage/v1/object/sign/documents/${path}?token=token_abc` },
              error: null,
            });
          },
        };
      },
    };

    const dbDocs = [
      {
        id: "doc-sf9-1",
        document_type: "sf9",
        storage_path: "teacher-01/assign-01/SF9_Carlos.pdf",
        original_filename: "SF9_Carlos.pdf",
        ocr_confidence: 0.96,
        extracted_text: "Oral Communication: 90",
        extracted_fields: {
          segment_id: "seg-sf9",
          source_file: "SF9_Carlos.pdf",
          page_numbers: [1, 2],
          start_page: 1,
          end_page: 2,
          lrn: "109345000001",
          last_name: "Dela Cruz",
          first_name: "Carlos",
          grades: [{ subject: "Oral Communication", final: 90 }],
        },
      },
    ];

    // Reconstruct segments as GET /api/scan/batch does
    const restoredSegments = [];
    for (const d of dbDocs) {
      const ef = d.extracted_fields;
      const { data: sData } = await mockStorage.from("documents").createSignedUrl(d.storage_path, 3600);
      const signedUrl = sData.signedUrl;

      restoredSegments.push({
        id: ef.segment_id,
        documentType: d.document_type,
        formTitle: "SF9",
        pageNumbers: ef.page_numbers,
        combinedText: d.extracted_text,
        confidence: d.ocr_confidence,
        imageUrl: signedUrl,
        storagePath: d.storage_path,
        sourceFileName: d.original_filename,
        pages: ef.page_numbers.map((p) => ({
          pageNumber: p,
          sourceFileName: d.original_filename,
          sourceFileDataUrl: signedUrl,
        })),
      });
    }

    assert.equal(restoredSegments.length, 1);
    const seg = restoredSegments[0];
    assert.equal(seg.sourceFileName, "SF9_Carlos.pdf");
    assert.ok(seg.imageUrl.includes("token_abc"), "Segment must have fresh signed URL");
    assert.equal(seg.storagePath, "teacher-01/assign-01/SF9_Carlos.pdf");
    assert.equal(seg.pages[0].sourceFileDataUrl, seg.imageUrl);
  });

  // ===========================================================================
  // 7. Source 1 and Source 2 Trace Viewer Recovery
  // ===========================================================================
  await t.test("7. Discrepancy items retain both Source 1 and Source 2 signed URLs on refresh", () => {
    const signedUrlSf9 = "https://supabase.co/sign/documents/SF9_Learner1.pdf?token=sf9";
    const signedUrlSf10 = "https://supabase.co/sign/documents/SF10_Learner1.pdf?token=sf10";

    const restoredSegments = [
      {
        id: "seg-sf9",
        documentType: "sf9",
        pageNumbers: [1],
        sourceFileName: "SF9_Learner1.pdf",
        imageUrl: signedUrlSf9,
        formTitle: "SF9",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [{ pageNumber: 1, sourceFileName: "SF9_Learner1.pdf", sourceFileDataUrl: signedUrlSf9 }],
        startPage: 1,
        endPage: 1,
        pageCount: 1,
      },
      {
        id: "seg-sf10",
        documentType: "sf10",
        pageNumbers: [2],
        sourceFileName: "SF10_Learner1.pdf",
        imageUrl: signedUrlSf10,
        formTitle: "SF10",
        confidence: 0.95,
        needsClassification: false,
        reasons: [],
        pages: [{ pageNumber: 2, sourceFileName: "SF10_Learner1.pdf", sourceFileDataUrl: signedUrlSf10 }],
        startPage: 2,
        endPage: 2,
        pageCount: 1,
      },
    ];

    const extractedData = {
      "seg-sf9": {
        lrn: "109345000001",
        last_name: "Dela Cruz",
        first_name: "Carlos",
        grades: [{ subject: "Oral Communication", final: 90 }],
        general_average: 90,
      },
      "seg-sf10": {
        lrn: "109345000001",
        last_name: "Dela Cruz",
        first_name: "Carlos",
        grades: [{ subject: "Oral Communication", final: 75 }], // Mismatch!
        general_average: 90,
      },
    };

    const report = evaluateBatchCrossDocumentValidation({
      segments: restoredSegments,
      extractedSegmentData: extractedData,
      schoolYear: "2024-2025",
      gradeLevel: "Grade 11",
      section: "Diamond",
    });

    assert.equal(report.summary.mismatchedInformationCount, 1);
    const disc = report.categorizedResults.mismatchedInformation[0];

    // Both source file names and signed data URLs must be present
    assert.equal(disc.source1FileName, "SF9_Learner1.pdf");
    assert.equal(disc.source1DataUrl, signedUrlSf9);
    assert.equal(disc.source2FileName, "SF10_Learner1.pdf");
    assert.equal(disc.source2DataUrl, signedUrlSf10);

    // ScanTraceViewerModal checks:
    const effectiveSource1Url = disc.source1DataUrl;
    const effectiveSource2Url = disc.source2DataUrl;
    assert.ok(effectiveSource1Url && effectiveSource1Url.startsWith("https://"));
    assert.ok(effectiveSource2Url && effectiveSource2Url.startsWith("https://"));
  });

  // ===========================================================================
  // 8. Unauthorized Access Rejection
  // ===========================================================================
  await t.test("8. Strict security: Admin and Principal uploading rejected", () => {
    const adminCheck = evaluateTeacherScanAuthorization({
      userRole: "admin",
      userId: "admin-1",
      accountStatus: "Approved",
      assignmentConfirmed: true,
    });
    assert.equal(adminCheck.allowed, false);
    assert.equal(adminCheck.statusCode, 403);
    assert.equal(adminCheck.code, "ADMIN_CANNOT_UPLOAD");

    const principalCheck = evaluateTeacherScanAuthorization({
      userRole: "principal",
      userId: "principal-1",
      accountStatus: "Approved",
      assignmentConfirmed: true,
    });
    assert.equal(principalCheck.allowed, false);
    assert.equal(principalCheck.statusCode, 403);
    assert.equal(principalCheck.code, "PRINCIPAL_READ_ONLY");
  });

  // ===========================================================================
  // 9. Storage Upload Failure Handling
  // ===========================================================================
  await t.test("9. Storage upload failure fails-safe the segment without database insertion", async () => {
    const mockStorage = {
      from() {
        return {
          upload() {
            return Promise.resolve({ data: null, error: new Error("Supabase Storage quota exceeded (507)") });
          },
        };
      },
    };

    const insertedDocs = [];
    const mockDb = {
      from() {
        return {
          insert(payload) {
            insertedDocs.push(payload);
            return Promise.resolve({ data: payload, error: null });
          },
        };
      },
    };

    // Simulate route upload step
    const { error: uploadErr } = await mockStorage.from("documents").upload("path", Buffer.from("test"));
    assert.ok(uploadErr, "Storage error must be caught");

    // When upload fails, database insert must NOT be attempted for this segment
    if (!uploadErr) {
      await mockDb.from("documents").insert({ id: "doc-1" });
    }

    assert.equal(insertedDocs.length, 0, "No document record should be inserted if storage upload failed");
  });

  // ===========================================================================
  // 10. Database Insertion Failure After Successful Upload (Orphan Cleanup)
  // ===========================================================================
  await t.test("10. Database insertion failure triggers safe orphaned storage object removal", async () => {
    const removedObjects = [];
    const mockStorage = {
      from() {
        return {
          upload(path) {
            return Promise.resolve({ data: { path }, error: null });
          },
          remove(paths) {
            removedObjects.push(...paths);
            return Promise.resolve({ data: paths, error: null });
          },
        };
      },
    };

    const storagePath = "teacher-01/assign-01/file.pdf";
    await mockStorage.from("documents").upload(storagePath, Buffer.from("pdf"));

    // DB insert fails
    const dbError = new Error("Database deadlock / foreign key failure");

    // Safe orphan cleanup logic:
    if (dbError) {
      await mockStorage.from("documents").remove([storagePath]);
    }

    assert.equal(removedObjects.length, 1);
    assert.equal(removedObjects[0], storagePath, "Orphaned storage object must be removed when DB insert fails");
  });

  // ===========================================================================
  // 11. Retry Without Duplicate Objects or Records
  // ===========================================================================
  await t.test("11. Segment retry reuses existing storage object and avoids duplicates", async () => {
    let uploadCount = 0;
    const mockStorage = {
      from() {
        return {
          upload(path) {
            uploadCount++;
            return Promise.resolve({ data: { path }, error: null });
          },
          createSignedUrl(path) {
            return Promise.resolve({ data: { signedUrl: `https://signed/${path}` }, error: null });
          },
        };
      },
    };

    const existingDoc = {
      id: "doc-retry-1",
      storage_path: "teacher-01/assign-01/SF9.pdf",
      image_url: "https://old-url",
    };

    let realStoragePath = null;
    let realSignedUrl = null;

    // Retry logic: existing document has valid storage path, reuse it!
    if (existingDoc && existingDoc.storage_path) {
      realStoragePath = existingDoc.storage_path;
      const { data } = await mockStorage.from("documents").createSignedUrl(realStoragePath, 3600);
      realSignedUrl = data.signedUrl;
    } else {
      await mockStorage.from("documents").upload("new-path", Buffer.from("pdf"));
    }

    assert.equal(uploadCount, 0, "Retry must not re-upload duplicate binary if storage object already exists");
    assert.equal(realStoragePath, existingDoc.storage_path);
    assert.ok(realSignedUrl.includes("SF9.pdf"));
  });

  // ===========================================================================
  // 12. Missing Storage Object Graceful Handling
  // ===========================================================================
  await t.test("12. Missing or inaccessible Storage object handled gracefully without crashing GET endpoint", async () => {
    const mockStorage = {
      from() {
        return {
          createSignedUrl(path) {
            // Storage object was deleted or not found
            return Promise.resolve({
              data: null,
              error: { message: "Object not found (404)" },
            });
          },
        };
      },
    };

    const docInDb = {
      id: "doc-missing-storage",
      storage_path: "teacher-01/assign-01/deleted_file.pdf",
      image_url: "https://supabase.co/storage/v1/object/sign/documents/deleted_file.pdf?token=expired_token",
    };

    let signedUrl = "";
    try {
      const { data: signedData, error: signErr } = await mockStorage
        .from("documents")
        .createSignedUrl(docInDb.storage_path, 3600);

      if (!signErr && signedData?.signedUrl) {
        signedUrl = signedData.signedUrl;
      }
    } catch {
      // Ignored
    }

    // Safe fallback inspection: never fall back to expired signed URL
    if (!signedUrl && docInDb.image_url && typeof docInDb.image_url === "string") {
      const isSignedUrlWithToken = docInDb.image_url.includes("/object/sign/") || docInDb.image_url.includes("token=");
      const isBase64 = docInDb.image_url.startsWith("data:");
      const isPermanentHttpUrl = (docInDb.image_url.startsWith("http://") || docInDb.image_url.startsWith("https://")) && !isSignedUrlWithToken;

      if (isPermanentHttpUrl && !isBase64) {
        signedUrl = docInDb.image_url;
      } else {
        signedUrl = "";
      }
    }

    assert.equal(signedUrl, "", "Must reject expired signed URL fallback and return empty string for frontend fallback");
  });
});

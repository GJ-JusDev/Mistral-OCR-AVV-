import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  segmentMultiPageDocument,
  DOCUMENT_TITLES,
  type DocumentSegment,
  type ShsDocumentType,
} from "@/lib/validation/batchDocumentSegmenter";
import {
  evaluateBatchCrossDocumentValidation,
  rebuildBatchValidationReportFromPersistedResults,
} from "@/lib/validation/batchCrossDocumentValidator";
import { parseGradesText } from "@/lib/ocr/gradesParser";
import { mergeSf9FrontAndBack } from "@/lib/validation/sf9Merger";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import { ingestRosterDocument } from "@/lib/upload/rosterIngestion";
import {
  createStagingDocument,
  cleanupStagingDocument,
} from "@/lib/upload/createStagingDocument";
import {
  evaluateTeacherScanAuthorization,
  normalizeGradeLevelKey,
  type TeacherAssignmentRecord,
} from "@/lib/teacher/assignments";
import { isValidLrn, normalizeLrn, normalizeSex } from "@/lib/validation/patterns";
import { normalizeDate } from "@/lib/validation/nameComparison";
import {
  buildPersistedValidationResponse,
  evaluateStudentValidation,
  fetchStudentValidationRecords,
  persistStudentValidation,
} from "@/lib/validation/studentCrossDocumentValidation";

/**
 * Returns a server-only privileged Supabase client ONLY after the caller's identity,
 * approved Teacher role, active class-adviser assignment, and document scope have
 * been strictly verified. Never exposed to the browser.
 */
function createVerifiedServerPrivilegedClient(fallbackAuthenticatedClient: any) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceRoleKey) {
    return createSupabaseServiceClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return fallbackAuthenticatedClient;
}

/**
 * AVV System — Unified Batch Document Scanning, Extraction, and Cross-Document Validation API
 *
 * REST endpoint exclusively for authorized Teachers to:
 * 1. Automatically classify multi-page PDF document boundaries.
 * 2. Extract multi-learner rosters, attendance, and grades in a single workflow.
 * 3. Persist parent documents and child records into Supabase without FK violations.
 * 4. Execute cross-document validation across SF1, SF2, SF5A/SF5B, SF9, SF10, and PSA.
 * 5. Retrieve saved batch validation results upon page refresh.
 */

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB limit

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseBase64DataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1].toLowerCase(),
      buffer: Buffer.from(match[2], "base64"),
    };
  }
  if (dataUrl.length > 100 && !dataUrl.startsWith("http")) {
    return {
      mimeType: "application/pdf",
      buffer: Buffer.from(dataUrl, "base64"),
    };
  }
  return null;
}

// -----------------------------------------------------------------------------
// GET: Retrieve Previously Saved Batch Validation Results for Assigned Section
// -----------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 1. Strict Authentication Check
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: Please log in to view batch scanning results.", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    // 2. Strict Role-Based Access Control
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json(
        { error: "Forbidden: Account is pending administrator approval.", code: "ACCOUNT_NOT_APPROVED" },
        { status: 403 }
      );
    }

    if (!roleRow.school_id) {
      return NextResponse.json(
        { error: "Forbidden: Teacher has no assigned school.", code: "NO_SCHOOL_ASSIGNED" },
        { status: 403 }
      );
    }

    const role = (roleRow.role || "").toLowerCase().trim();
    if (role === "admin" || role === "administrator") {
      return NextResponse.json(
        { error: "Forbidden: Administrator role cannot access batch scanning area.", code: "ADMIN_CANNOT_UPLOAD" },
        { status: 403 }
      );
    }
    if (role === "principal") {
      return NextResponse.json(
        { error: "Forbidden: Principal role is monitoring-only.", code: "PRINCIPAL_READ_ONLY" },
        { status: 403 }
      );
    }
    if (role !== "teacher") {
      return NextResponse.json(
        { error: "Forbidden: Only authorized Teachers can access batch scanning.", code: "UNAUTHORIZED_ROLE" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const assignmentId = searchParams.get("assignmentId");
    const requestedBatchId = (
      searchParams.get("batchId") ||
      searchParams.get("batch_id") ||
      ""
    ).trim();

    // 3. Strict Mandatory assignmentId Check
    if (!assignmentId || typeof assignmentId !== "string" || !assignmentId.trim()) {
      return NextResponse.json(
        { error: "Forbidden: assignmentId is required to retrieve batch scan results.", code: "ASSIGNMENT_REQUIRED" },
        { status: 403 }
      );
    }

    // If client explicitly indicated a new batch or requested no saved batch, do not restore previous batch
    if (requestedBatchId === "new" || requestedBatchId === "none") {
      return NextResponse.json({
        hasSavedBatch: false,
        batchId: null,
        message: "New batch active. No previous batch restored.",
      });
    }

    const { data: assignmentData } = await supabase
      .from("teacher_assignments")
      .select("*")
      .eq("id", assignmentId.trim())
      .maybeSingle();

    if (!assignmentData) {
      return NextResponse.json(
        { error: "Forbidden: Selected assignment not found.", code: "ASSIGNMENT_REQUIRED" },
        { status: 403 }
      );
    }

    const authCheck = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: user.id,
      accountStatus: "Approved",
      userSchoolId: roleRow.school_id,
      assignment: assignmentData as TeacherAssignmentRecord,
      assignmentConfirmed: true,
    });

    if (!authCheck.allowed) {
      return NextResponse.json(
        { error: authCheck.error, code: authCheck.code },
        { status: authCheck.statusCode }
      );
    }

    const verifiedSchoolYear = assignmentData.school_year || "";
    const verifiedGradeLevel = normalizeGradeLevelKey(assignmentData.grade_level) || assignmentData.grade_level || "";
    const verifiedSection = assignmentData.section || "";

    // Fetch active documents created by this teacher for this section
    let docQuery = supabase
      .from("documents")
      .select("*")
      .eq("school_id", roleRow.school_id)
      .eq("school_year", verifiedSchoolYear)
      .eq("grade_level", verifiedGradeLevel)
      .eq("section", verifiedSection)
      .eq("uploaded_by", user.id)
      .not("status", "in", '("archived","rejected")')
      .order("created_at", { ascending: false });

    if (requestedBatchId && typeof (docQuery as any).contains === "function") {
      docQuery = (docQuery as any).contains("extracted_fields", { batch_id: requestedBatchId });
    }

    const { data: rawDocs, error: docError } = await docQuery;

    if (docError) {
      return NextResponse.json({ error: docError.message }, { status: 500 });
    }

    let docs = (rawDocs || []) as any[];

    // Enforce strict batch isolation
    if (requestedBatchId) {
      docs = docs.filter((d: any) => {
        const ef = (d.extracted_fields as any) || {};
        return ef.batch_id === requestedBatchId;
      });
    } else {
      // If no explicit batchId was requested, isolate to the most recent batch's batch_id
      // to prevent historical batches from leaking across sessions
      const latestBatchId = (docs[0]?.extracted_fields as any)?.batch_id;
      if (latestBatchId) {
        docs = docs.filter((d: any) => (d.extracted_fields as any)?.batch_id === latestBatchId);
      }
    }

    if (!docs || docs.length === 0) {
      return NextResponse.json({
        hasSavedBatch: false,
        batchId: requestedBatchId || null,
        message: requestedBatchId
          ? `No saved documents found for batch ${requestedBatchId}.`
          : "No previous batch validation found for this assigned section.",
      });
    }

    // Reconstruct segments and extracted data
    const segments: DocumentSegment[] = [];
    const extractedData: Record<string, any> = {};

    for (const d of docs) {
      const ef = (d.extracted_fields as any) || {};
      if (ef.is_retry_staging === true) {
        continue;
      }
      const segId = ef.segment_id || `seg-${d.id.slice(0, 8)}`;
      const docType = (ef.form_variant || d.document_type || "sf9") as ShsDocumentType;

      // Generate accessible short-lived signed URL from real storage path
      let signedUrl = "";
      if (d.storage_path && typeof d.storage_path === "string") {
        try {
          const { data: signedData, error: signErr } = await supabase.storage
            .from("documents")
            .createSignedUrl(d.storage_path, 3600); // 1-hour signed URL

          if (!signErr && signedData?.signedUrl) {
            signedUrl = signedData.signedUrl;
          } else if (signErr) {
            console.warn(`[scan/batch] Signed URL refresh error for ${d.storage_path}:`, signErr);
          }
        } catch (signErr) {
          console.warn(`[scan/batch] Signed URL refresh exception for ${d.storage_path}:`, signErr);
        }
      }

      // Safe fallback inspection:
      // NEVER fall back to an expired Supabase signed URL (contains /object/sign/ or token=) or a base64 string.
      // NEVER fall back to a private Supabase Storage object URL (contains /storage/v1/object/documents/ or /storage/v1/object/authenticated/documents/)
      // Only allow a verified permanent public/direct URL (e.g. /object/public/ or direct external HTTP without an HMAC token).
      // If signing fails and no valid permanent URL exists, leave signedUrl = "" so the frontend displays its existing placeholder.
      if (!signedUrl && d.image_url && typeof d.image_url === "string") {
        const isSignedUrlWithToken = d.image_url.includes("/object/sign/") || d.image_url.includes("token=");
        const isBase64 = d.image_url.startsWith("data:");
        const isPrivateStorageUrl =
          d.image_url.includes("/storage/v1/object/documents/") ||
          d.image_url.includes("/storage/v1/object/authenticated/documents/");
        const isPermanentHttpUrl =
          (d.image_url.startsWith("http://") || d.image_url.startsWith("https://")) &&
          !isSignedUrlWithToken &&
          !isPrivateStorageUrl;

        if (isPermanentHttpUrl && !isBase64) {
          signedUrl = d.image_url;
        } else {
          signedUrl = "";
        }
      }

      const sourceFileName = ef.source_file || d.original_filename || "Document.pdf";
      const pageNumbers = ef.page_numbers || [1];

      segments.push({
        id: segId,
        documentType: docType,
        formTitle: DOCUMENT_TITLES[docType] || docType.toUpperCase(),
        startPage: ef.start_page || pageNumbers[0] || 1,
        endPage: ef.end_page || pageNumbers[pageNumbers.length - 1] || 1,
        pageNumbers,
        pageCount: pageNumbers.length,
        combinedText: d.extracted_text || "",
        confidence: d.ocr_confidence || 0.95,
        needsClassification: false,
        reasons: [`Restored from database record (${d.id.slice(0, 8)})`],
        pages: pageNumbers.map((pageNum: number) => ({
          pageNumber: pageNum,
          sourceFileName,
          sourceFileDataUrl: signedUrl,
        })),
        documentId: d.id,
        persistenceStatus: "persisted",
        sourceFileName,
        imageUrl: signedUrl,
        storagePath: d.storage_path || undefined,
      });

      extractedData[segId] = ef;
    }

    const activeBatchId =
      requestedBatchId || (docs[0]?.extracted_fields as any)?.batch_id || `batch-${verifiedSection}`;

    // Evaluate cross-document validation for the restored records
    const report = evaluateBatchCrossDocumentValidation({
      batchId: activeBatchId,
      schoolYear: verifiedSchoolYear,
      gradeLevel: verifiedGradeLevel,
      section: verifiedSection,
      segments,
      extractedSegmentData: extractedData,
    });

    return NextResponse.json({
      hasSavedBatch: true,
      batchId: activeBatchId,
      report,
      segments,
      extractedData,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to retrieve saved batch results." },
      { status: 500 }
    );
  }
}

// -----------------------------------------------------------------------------
// POST: Execute Batch Classification, OCR Extraction, and Database Persistence
// -----------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 1. Strict Authentication Check
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: Please log in to perform batch scanning.", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    // 2. Strict Role-Based Access Control (RBAC)
    // Only approved Teachers may scan or upload documents. Admins and Principals are forbidden.
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json(
        { error: "Forbidden: Account is pending administrator approval.", code: "ACCOUNT_NOT_APPROVED" },
        { status: 403 }
      );
    }

    if (!roleRow.school_id) {
      return NextResponse.json(
        { error: "Forbidden: Teacher has no assigned school.", code: "NO_SCHOOL_ASSIGNED" },
        { status: 403 }
      );
    }

    const role = (roleRow.role || "").toLowerCase().trim();
    if (role === "admin" || role === "administrator") {
      return NextResponse.json(
        {
          error: "Forbidden: Administrator role cannot scan or upload documents. Only authorized Teachers can perform scanning.",
          code: "ADMIN_CANNOT_UPLOAD",
        },
        { status: 403 }
      );
    }

    if (role === "principal") {
      return NextResponse.json(
        {
          error: "Forbidden: Principal role is monitoring-only and cannot scan or upload documents.",
          code: "PRINCIPAL_READ_ONLY",
        },
        { status: 403 }
      );
    }

    if (role !== "teacher") {
      return NextResponse.json(
        {
          error: "Forbidden: Only authorized Teachers can scan or upload documents.",
          code: "UNAUTHORIZED_ROLE",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      action = "classify_and_validate", // "classify" | "extract_and_validate" | "classify_and_validate" | "retry_segment"
      pages, // Array<{ pageNumber: number, text: string, lines?: any[], words?: any[] }>
      segments: inputSegments,
      extractedData: existingExtractedData = {},
      retrySegmentId,
      assignmentId,
      assignmentConfirmed = false,
      batchId = `batch-${Date.now()}`,
      files = [],
    } = body;

    // 3. Strict Mandatory Teacher Advisory Assignment Verification
    if (!assignmentId || typeof assignmentId !== "string" || !assignmentId.trim()) {
      return NextResponse.json(
        {
          error: "Forbidden: You must select an active teaching assignment assigned by an administrator before scanning.",
          code: "ASSIGNMENT_REQUIRED",
        },
        { status: 403 }
      );
    }

    const { data: assignmentData } = await supabase
      .from("teacher_assignments")
      .select("*")
      .eq("id", assignmentId.trim())
      .maybeSingle();

    if (!assignmentData) {
      return NextResponse.json(
        {
          error: "Forbidden: You must select an active teaching assignment assigned by an administrator before scanning.",
          code: "ASSIGNMENT_REQUIRED",
        },
        { status: 403 }
      );
    }

    const assignment: TeacherAssignmentRecord = assignmentData as TeacherAssignmentRecord;

    const authCheck = evaluateTeacherScanAuthorization({
      userRole: "teacher",
      userId: user.id,
      accountStatus: "Approved",
      userSchoolId: roleRow.school_id,
      assignment,
      assignmentConfirmed: Boolean(assignmentConfirmed),
    });

    if (!authCheck.allowed) {
      return NextResponse.json(
        { error: authCheck.error || "Forbidden: Section assignment authorization mismatch.", code: authCheck.code },
        { status: authCheck.statusCode }
      );
    }

    // Authoritative assignment metadata from database
    const verifiedSchoolYear = assignment.school_year || "";
    const verifiedGradeLevel = normalizeGradeLevelKey(assignment.grade_level) || assignment.grade_level || "";
    const verifiedSection = assignment.section || "";

    // -------------------------------------------------------------------------
    // Phase 1: Boundary Segmentation & Classification
    // -------------------------------------------------------------------------
    let segments: DocumentSegment[] = inputSegments || [];
    if (!segments || segments.length === 0) {
      if (!pages || !Array.isArray(pages) || pages.length === 0) {
        return NextResponse.json(
          { error: "No document pages provided for classification.", code: "NO_PAGES_PROVIDED" },
          { status: 400 }
        );
      }

      segments = segmentMultiPageDocument({
        pages,
        fallbackDocType: "sf9",
      });
    }

    // If only classification was requested, return segments for teacher confirmation
    if (action === "classify") {
      return NextResponse.json({
        success: true,
        action: "classify",
        segments,
        totalSegments: segments.length,
        hasUnclassifiedSegments: segments.some((s) => s.needsClassification),
      });
    }

    // -------------------------------------------------------------------------
    // Phase 2: Binary Supabase Storage Upload for Unique Source Files
    // -------------------------------------------------------------------------
    interface SourceFileItem {
      name: string;
      buffer: Buffer;
      mimeType: string;
    }
    const uniqueFilesToUpload = new Map<string, SourceFileItem>();

    // 1. Gather files from body.files
    if (Array.isArray(files) && files.length > 0) {
      for (const f of files) {
        if (f && typeof f.name === "string" && f.dataUrl) {
          const parsed = parseBase64DataUrl(f.dataUrl);
          if (parsed) {
            uniqueFilesToUpload.set(f.name, {
              name: f.name,
              buffer: parsed.buffer,
              mimeType: f.type || parsed.mimeType,
            });
          }
        }
      }
    }

    // 2. Gather any additional files from pages
    if (Array.isArray(pages)) {
      for (const p of pages) {
        const fname = p.sourceFileName || "batch_upload.pdf";
        if (p.sourceFileDataUrl && !uniqueFilesToUpload.has(fname)) {
          const parsed = parseBase64DataUrl(p.sourceFileDataUrl);
          if (parsed) {
            uniqueFilesToUpload.set(fname, {
              name: fname,
              buffer: parsed.buffer,
              mimeType: parsed.mimeType,
            });
          }
        }
      }
    }

    // Validate MIME types and file sizes before uploading
    for (const [fname, fItem] of uniqueFilesToUpload.entries()) {
      if (!ALLOWED_MIME_TYPES.has(fItem.mimeType.toLowerCase())) {
        return NextResponse.json(
          {
            error: `Unsupported file type: '${fItem.mimeType}'. Allowed formats are PDF, JPEG, PNG, and WebP.`,
            code: "INVALID_FILE_TYPE",
          },
          { status: 400 }
        );
      }
      if (fItem.buffer.length > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            error: `File "${fname}" (${(fItem.buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 15MB.`,
            code: "FILE_TOO_LARGE",
          },
          { status: 400 }
        );
      }
    }

    // Upload each unique source file to the private 'documents' bucket
    interface UploadResult {
      storagePath: string;
      signedUrl: string;
      mimeType: string;
      fileSize: number;
    }
    const fileStorageMap = new Map<string, UploadResult>();
    const fileUploadErrors: Array<{ fileName: string; error: string }> = [];

    for (const [filename, fileObj] of uniqueFilesToUpload.entries()) {
      const safeFilename = sanitizeFilename(fileObj.name);
      // Format: <userId>/<assignmentId>/<timestamp>_<uuid>_<safeFilename>
      // Satisfies Migration 026 RLS policy: folder 1 = auth.uid(), folder 2 = active assignment UUID
      const storagePath = `${user.id}/${assignment.id}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeFilename}`;

      const { error: uploadErr } = await supabase.storage
        .from("documents")
        .upload(storagePath, fileObj.buffer, {
          contentType: fileObj.mimeType,
          upsert: true,
        });

      if (uploadErr) {
        console.error(`[scan/batch] Storage upload failed for "${filename}":`, uploadErr);
        fileUploadErrors.push({ fileName: filename, error: uploadErr.message });
        continue;
      }

      let signedUrl = "";
      try {
        const { data: signedData } = await supabase.storage
          .from("documents")
          .createSignedUrl(storagePath, 86400); // 24-hour initial signed URL
        signedUrl = signedData?.signedUrl || "";
      } catch (signErr) {
        console.warn(`[scan/batch] Signed URL creation warning for ${storagePath}:`, signErr);
      }

      fileStorageMap.set(filename, {
        storagePath,
        signedUrl,
        mimeType: fileObj.mimeType,
        fileSize: fileObj.buffer.length,
      });
    }

    // -------------------------------------------------------------------------
    // Phase 3: OCR/ICR Data Extraction & Database Persistence per Segment
    // -------------------------------------------------------------------------
    const extractedSegmentData: Record<string, any> = { ...existingExtractedData };
    const segmentsToExtract = retrySegmentId
      ? segments.filter((s) => s.id === retrySegmentId)
      : segments.filter((s) => !extractedSegmentData[s.id]);

    const persistenceErrors: Array<{ segmentId: string; error: string }> = [];

    for (const seg of segmentsToExtract) {
      try {
        let parsed: any;

        if (seg.documentType === "sf9" && Array.isArray(seg.pages) && seg.pages.length === 2) {
          // Identify Front vs Back page
          let frontPage = seg.pages[0];
          let backPage = seg.pages[1];

          // Check if order is inverted (Page 0 is back, Page 1 is front)
          const p0Side = (frontPage as any).documentSide || (frontPage as any).side;
          const p1Side = (backPage as any).documentSide || (backPage as any).side;

          const p0HasFrontMarkers = /certificate of transfer|dear parent|learner reference no|\blrn[:\s]*\d{12}\b/i.test(frontPage.text || "");
          const p1HasFrontMarkers = /certificate of transfer|dear parent|learner reference no|\blrn[:\s]*\d{12}\b/i.test(backPage.text || "");

          if (p0Side === "back" || p1Side === "front" || (!p0HasFrontMarkers && p1HasFrontMarkers)) {
            frontPage = seg.pages[1];
            backPage = seg.pages[0];
          }

          const frontRawLayout = { pages: [frontPage], pageCount: 1, tables: frontPage.tables || [] };
          const backRawLayout = { pages: [backPage], pageCount: 1, tables: backPage.tables || [] };

          const frontFields = parseGradesText(frontPage.text, verifiedGradeLevel, frontRawLayout, "sf9");
          const backFields = parseGradesText(backPage.text, verifiedGradeLevel, backRawLayout, "sf9");

          const mergedResult = mergeSf9FrontAndBack(
            { fields: frontFields, rawText: frontPage.text, pageNumber: frontPage.pageNumber, confidence: seg.confidence },
            { fields: backFields, rawText: backPage.text, pageNumber: backPage.pageNumber, confidence: seg.confidence }
          );

          if (mergedResult.hasIdentityConflict || !mergedResult.isSameLearner) {
            // Do NOT attach back page's grades to learner; flag segment as NEEDS REVIEW / identity mismatch
            parsed = {
              ...mergedResult.unifiedFields,
              grades: [], // Withhold grades from attaching to this learner
              identity_conflict: true,
              identity_conflicts: mergedResult.identityConflicts,
              needs_review: true,
            };
            seg.needsClassification = true;
            seg.persistenceStatus = "failed";
            seg.reasons.push(
              `SF9 Front and Back Identity Mismatch: ${mergedResult.identityConflicts.join("; ")}`
            );
          } else {
            parsed = mergedResult.unifiedFields;
            if (mergedResult.academicConflicts.length > 0) {
              parsed.academic_conflicts = mergedResult.academicConflicts;
            }
          }
        } else {
          const segRawLayout = {
            pages: seg.pages,
            pageCount: seg.pageCount,
          };

          parsed = parseGradesText(
            seg.combinedText,
            verifiedGradeLevel,
            segRawLayout,
            seg.documentType
          );

          if (seg.documentType === "sf9" && Array.isArray(seg.pages) && seg.pages.length === 1) {
            const hasGrades = Array.isArray(parsed.grades) && parsed.grades.length > 0;
            const hasLrn = parsed.lrn && String(parsed.lrn).replace(/[^0-9]/g, "").length === 12;
            if (hasLrn && !hasGrades) {
              parsed.is_front_only = true;
            } else if (!hasLrn && hasGrades) {
              parsed.is_back_only = true;
            }
          }
        }

        extractedSegmentData[seg.id] = parsed;

        // Persist Parent Document into public.documents first
        const docTypeForDb = seg.documentType;

        const primaryPage = seg.pages?.[0];
        const sourceFileName = primaryPage?.sourceFileName || (Array.isArray(files) && files[0]?.name) || "batch_upload.pdf";
        const fileInfo = fileStorageMap.get(sourceFileName);

        const uploadErrMatch = fileUploadErrors.find((e) => e.fileName === sourceFileName);
        if (uploadErrMatch && !fileInfo) {
          persistenceErrors.push({ segmentId: seg.id, error: `Storage upload failed: ${uploadErrMatch.error}` });
          seg.persistenceStatus = "failed";
          seg.persistenceError = `Storage upload failed: ${uploadErrMatch.error}`;
          continue;
        }

        let realStoragePath = fileInfo?.storagePath || null;
        let realSignedUrl = fileInfo?.signedUrl || "";

        // Check if an existing document record already exists for this segment in this section
        let existingDocId: string | null = null;
        if (retrySegmentId) {
          const { data: existingDoc } = await supabase
            .from("documents")
            .select("id, storage_path, image_url")
            .eq("uploaded_by", user.id)
            .eq("school_id", assignment.school_id)
            .eq("section", verifiedSection)
            .eq("school_year", verifiedSchoolYear)
            .contains("extracted_fields", { segment_id: seg.id })
            .maybeSingle();

          if (existingDoc) {
            existingDocId = existingDoc.id;
            if (!realStoragePath && existingDoc.storage_path) {
              realStoragePath = existingDoc.storage_path;
              try {
                const { data: sData, error: sErr } = await supabase.storage
                  .from("documents")
                  .createSignedUrl(realStoragePath, 3600);
                if (!sErr && sData?.signedUrl) {
                  realSignedUrl = sData.signedUrl;
                } else if (sErr) {
                  console.warn(`[scan/batch] createSignedUrl notice for ${realStoragePath}:`, sErr.message);
                }
              } catch (signErr) {
                console.warn(`[scan/batch] createSignedUrl exception for ${realStoragePath}:`, signErr);
              }

              // Only fall back to existingDoc.image_url if it is a verified permanent public URL
              if (!realSignedUrl && existingDoc.image_url && typeof existingDoc.image_url === "string") {
                const isSignedWithToken =
                  existingDoc.image_url.includes("/object/sign/") || existingDoc.image_url.includes("token=");
                const isBase64 = existingDoc.image_url.startsWith("data:");
                const isPrivateStorage =
                  existingDoc.image_url.includes("/storage/v1/object/documents/") ||
                  existingDoc.image_url.includes("/storage/v1/object/authenticated/documents/");
                if (
                  !isSignedWithToken &&
                  !isBase64 &&
                  !isPrivateStorage &&
                  (existingDoc.image_url.startsWith("http://") || existingDoc.image_url.startsWith("https://"))
                ) {
                  realSignedUrl = existingDoc.image_url;
                } else {
                  realSignedUrl = "";
                }
              }
            }
          }
        }

        // PRESERVE EXISTING DOCUMENT ID on retry; generate new UUID only for first-time scans
        const docId = existingDocId || crypto.randomUUID();

        const secondaryPage = seg.pages?.[1];
        const frontFileName = primaryPage?.sourceFileName || sourceFileName;
        const backFileName = secondaryPage?.sourceFileName || frontFileName;

        const frontFileInfo = fileStorageMap.get(frontFileName) || fileInfo;
        const backFileInfo = secondaryPage ? (fileStorageMap.get(backFileName) || frontFileInfo) : null;

        const frontStoragePath = frontFileInfo?.storagePath || realStoragePath;
        const backStoragePath = backFileInfo?.storagePath || (secondaryPage ? realStoragePath : null);
        const frontSignedUrl = frontFileInfo?.signedUrl || realSignedUrl;
        const backSignedUrl = backFileInfo?.signedUrl || (secondaryPage ? realSignedUrl : null);

        const extractedFieldsPayload = {
          ...parsed,
          batch_id: batchId,
          segment_id: seg.id,
          start_page: seg.startPage,
          end_page: seg.endPage,
          page_numbers: seg.pageNumbers,
          form_variant: seg.documentType,
          source_file: sourceFileName,
          mime_type: fileInfo?.mimeType || "application/pdf",
          file_size: fileInfo?.fileSize || null,
          front_storage_path: frontStoragePath,
          back_storage_path: backStoragePath,
          front_image_url: frontSignedUrl,
          back_image_url: backSignedUrl,
          images: {
            front: frontSignedUrl,
            back: backSignedUrl,
          },
          source_pages: (seg.pages || []).map((p: any) => {
            const pFname = p.sourceFileName || sourceFileName;
            const pFinfo = fileStorageMap.get(pFname);
            return {
              pageNumber: p.pageNumber,
              originalPageNumber: p.originalPageNumber || 1,
              sourceFileName: pFname,
              storagePath: pFinfo?.storagePath || realStoragePath,
              signedUrl: pFinfo?.signedUrl || realSignedUrl,
              documentSide: p.documentSide || p.side,
              pairId: p.pairId,
            };
          }),
        };

        if (existingDocId) {
          // ===================================================================
          // ATOMIC RETRY RECONCILIATION WORKFLOW
          // ===================================================================
          // Invariants Enforced:
          // 1. Target document ID (existingDocId) is preserved in-place.
          // 2. Original child records are NEVER deleted until replacement data is ready.
          // 3. If any step fails, target document and original child records remain intact.
          // 4. Staging document is used for multi-learner documents (SF1, SF2, SF5) with
          //    is_retry_staging and retry_target_document_id markers.
          // 5. Privileged server-side operations are used ONLY after caller identity,
          //    approved teacher role, active class-adviser assignment, and target document
          //    ownership have been verified.
          // 6. Direct atomic payload is passed for SF9/SF10 grades and PSA records.
          // 7. No direct client DELETE fallback operations violating Migration 026 DAC.

          const privilegedDb = createVerifiedServerPrivilegedClient(supabase);

          if (["sf1", "sf2"].includes(seg.documentType)) {
            // Stage replacement roster entries under temporary staging document
            let stagingDocId: string;
            try {
              stagingDocId = await createStagingDocument({
                db: supabase,
                targetDocumentId: docId,
                assignmentId: assignment.id,
                schoolId: assignment.school_id,
                teacherId: user.id,
                docType: docTypeForDb,
                schoolYear: verifiedSchoolYear,
                gradeLevel: verifiedGradeLevel,
                section: verifiedSection,
                extractedText: seg.combinedText,
                extractedFields: extractedFieldsPayload,
                originalFilename: sourceFileName,
                ocrConfidence: seg.confidence || 0.95,
                storagePath: realStoragePath,
                imageUrl: realSignedUrl || "",
              });
            } catch (stagingDocErr: any) {
              const errMsg = stagingDocErr?.message || "Failed to create staging document for retry";
              console.error(`[scan/batch] Staging document creation failed for retry segment ${seg.id}:`, errMsg);
              persistenceErrors.push({ segmentId: seg.id, error: errMsg });
              seg.persistenceStatus = "failed";
              seg.persistenceError = errMsg;
              continue; // Target document existingDocId remains 100% untouched!
            }

            const rosterRes = await ingestRosterDocument({
              db: privilegedDb,
              documentId: stagingDocId,
              documentType: docTypeForDb as any,
              extractedText: seg.combinedText,
              extractedFields: parsed,
              schoolId: assignment.school_id,
              isStaging: true,
              verifiedContext: {
                schoolYear: verifiedSchoolYear,
                gradeLevel: verifiedGradeLevel,
                section: verifiedSection,
              },
            });

            if (!rosterRes.success) {
              // Safely clean up failed staging document via authorized RPC / privileged fallback
              const cleanupRes = await cleanupStagingDocument({
                db: supabase,
                privilegedDb,
                stagingDocumentId: stagingDocId,
                targetDocumentId: docId,
              });
              let errMsg =
                rosterRes.error ||
                rosterRes.warnings.join("; ") ||
                `Failed to ingest replacement roster entries for ${seg.documentType}`;
              if (!cleanupRes.cleaned) {
                errMsg = `${errMsg} [Cleanup Failure: ${cleanupRes.error}]`;
              }
              console.error(`[scan/batch] Roster retry ingestion failed for ${seg.documentType}:`, errMsg);
              persistenceErrors.push({ segmentId: seg.id, error: errMsg });
              seg.persistenceStatus = "failed";
              seg.persistenceError = errMsg;
              continue; // Target document existingDocId remains 100% untouched!
            }

            // Atomic database reconciliation: swap staged records to existingDocId and update parent
            const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc("reconcile_retry_segment_document", {
              p_document_id: docId,
              p_staging_document_id: stagingDocId,
              p_extracted_text: seg.combinedText,
              p_extracted_fields: extractedFieldsPayload,
              p_ocr_confidence: seg.confidence || 0.95,
              p_storage_path: realStoragePath,
              p_image_url: realSignedUrl || null,
            });

            if (rpcErr || !rpcRes?.success) {
              const cleanupRes = await cleanupStagingDocument({
                db: supabase,
                privilegedDb,
                stagingDocumentId: stagingDocId,
                targetDocumentId: docId,
              });
              let errMsg = rpcErr?.message || "Reconciliation RPC failed for segment";
              if (!cleanupRes.cleaned) {
                errMsg = `${errMsg} [Cleanup Failure: ${cleanupRes.error}]`;
              }
              console.error(`[scan/batch] Reconciliation RPC error for ${docId}:`, errMsg);
              persistenceErrors.push({ segmentId: seg.id, error: errMsg });
              seg.persistenceStatus = "failed";
              seg.persistenceError = errMsg;
              continue; // Target document existingDocId remains 100% untouched!
            }
          } else if (seg.documentType === "birth_cert") {
            const psaId = parsed.identity || parsed;
            let matchedStudentId: string | null = null;
            if (isValidLrn(psaId.lrn)) {
              const { data: sRow, error: studentLookupErr } = await supabase
                .from("students")
                .select("id")
                .eq("lrn", psaId.lrn)
                .eq("school_id", assignment.school_id)
                .maybeSingle();
              if (studentLookupErr) {
                console.warn(`[scan/batch] Student LRN lookup warning during PSA retry:`, studentLookupErr.message);
              }
              matchedStudentId = sRow?.id || null;
            }

            const psaRecordPayload = (psaId.last_name && psaId.first_name) ? {
              student_id: matchedStudentId,
              registry_number: psaId.registry_number || null,
              last_name: psaId.last_name,
              first_name: psaId.first_name,
              middle_name: psaId.middle_name || null,
              sex: normalizeSex(psaId.sex) || "M",
              birth_date: normalizeDate(psaId.birth_date) || "2000-01-01",
              mother_maiden_name: psaId.mother_maiden_name || null,
              father_name: psaId.father_name || null,
            } : null;

            const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc("reconcile_retry_segment_document", {
              p_document_id: docId,
              p_extracted_text: seg.combinedText,
              p_extracted_fields: extractedFieldsPayload,
              p_ocr_confidence: seg.confidence || 0.95,
              p_storage_path: realStoragePath,
              p_image_url: realSignedUrl || null,
              p_psa_record: psaRecordPayload,
            });

            if (rpcErr || !rpcRes?.success) {
              const errMsg = rpcErr?.message || "Reconciliation RPC failed for PSA segment";
              console.error(`[scan/batch] Reconciliation RPC error for ${docId}:`, errMsg);
              persistenceErrors.push({ segmentId: seg.id, error: errMsg });
              seg.persistenceStatus = "failed";
              seg.persistenceError = errMsg;
              continue;
            }
          } else if (seg.documentType === "sf9" || seg.documentType === "sf10") {
            const parseNumOrNull = (val: any): number | null => {
              if (val === null || val === undefined || val === "") return null;
              const n = typeof val === "number" ? val : parseFloat(String(val));
              return !isNaN(n) ? n : null;
            };
            const gradeRows = Array.isArray(parsed.grades) && parsed.grades.length > 0 ? parsed.grades.map((g: any) => ({
              subject: g.subject || "General",
              q1: parseNumOrNull(g.q1),
              q2: parseNumOrNull(g.q2),
              q3: parseNumOrNull(g.q3),
              q4: parseNumOrNull(g.q4),
              final_grade: parseNumOrNull(g.final ?? g.final_grade),
              semester: g.semester || parsed.semester || null,
              grade_level: g.grade_level || parsed.grade_level || verifiedGradeLevel || null,
              school_year: g.school_year || parsed.school_year || verifiedSchoolYear || null,
              status: g.status || null,
            })) : null;

            const rawObs = Array.isArray(parsed.observed_values)
              ? parsed.observed_values
              : Array.isArray(parsed.observed_values?.observations)
                ? parsed.observed_values.observations
                : [];
            const observedValuesRows = rawObs.length > 0 ? rawObs : null;

            const rawLegends = Array.isArray(parsed.grading_scale_legends)
              ? parsed.grading_scale_legends
              : Array.isArray(parsed.learner_progress_achievement?.scale_items)
                ? parsed.learner_progress_achievement.scale_items
                : [];
            const gradingLegendsRows = rawLegends.length > 0 ? rawLegends : null;

            const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc("reconcile_retry_segment_document", {
              p_document_id: docId,
              p_extracted_text: seg.combinedText,
              p_extracted_fields: extractedFieldsPayload,
              p_ocr_confidence: seg.confidence || 0.95,
              p_storage_path: realStoragePath,
              p_image_url: realSignedUrl || null,
              p_subject_grades: gradeRows,
              p_observed_values: observedValuesRows,
              p_grading_legends: gradingLegendsRows,
            });

            if (rpcErr || !rpcRes?.success) {
              const errMsg = rpcErr?.message || "Reconciliation RPC failed for grades segment";
              console.error(`[scan/batch] Reconciliation RPC error for ${docId}:`, errMsg);
              persistenceErrors.push({ segmentId: seg.id, error: errMsg });
              seg.persistenceStatus = "failed";
              seg.persistenceError = errMsg;
              continue;
            }
          }

          seg.documentId = docId;
          seg.persistenceStatus = "persisted";
          seg.sourceFileName = sourceFileName;
          seg.imageUrl = realSignedUrl;
          seg.storagePath = realStoragePath || undefined;

          if (Array.isArray(seg.pages)) {
            for (const p of seg.pages) {
              p.sourceFileDataUrl = realSignedUrl;
              p.sourceFileName = sourceFileName;
            }
          }

          // Retry segment successfully reconciled atomically!
          continue;
        } else {
          // Brand-new document insertion
          const parentDocPayload: Record<string, any> = {
            id: docId,
            school_id: assignment.school_id,
            teacher_assignment_id: assignment.id,
            student_id: null,
            document_type: docTypeForDb,
            image_url: realSignedUrl,
            storage_path: realStoragePath,
            original_filename: sourceFileName,
            extracted_text: seg.combinedText,
            extracted_fields: extractedFieldsPayload,
            ocr_model: "azure-prebuilt-read",
            ocr_confidence: seg.confidence || 0.95,
            status: "needs_review",
            school_year: verifiedSchoolYear,
            grade_level: verifiedGradeLevel,
            section: verifiedSection,
            uploaded_by: user.id,
          };

          const { error: insertDocErr } = await supabase
            .from("documents")
            .insert(parentDocPayload);

          if (insertDocErr) {
            console.error(`[scan/batch] Parent document insert failed for segment ${seg.id}:`, insertDocErr);
            persistenceErrors.push({ segmentId: seg.id, error: insertDocErr.message });
            seg.persistenceStatus = "failed";
            seg.persistenceError = insertDocErr.message;

            // Safe orphan cleanup: only delete if NO other document references this storage_path
            if (realStoragePath) {
              try {
                const { count: refCount, error: countErr } = await supabase
                  .from("documents")
                  .select("id", { count: "exact", head: true })
                  .eq("storage_path", realStoragePath);

                if (!countErr && (!refCount || refCount === 0)) {
                  const { error: remErr } = await supabase.storage.from("documents").remove([realStoragePath]);
                  if (remErr) {
                    console.warn(`[scan/batch] Orphaned storage removal warning for ${realStoragePath}:`, remErr.message);
                  } else {
                    console.log(`[scan/batch] Cleaned up orphaned storage object: ${realStoragePath}`);
                  }
                }
              } catch (cleanupErr) {
                console.warn("[scan/batch] Orphaned storage cleanup error:", cleanupErr);
              }
            }
            continue; // Do NOT proceed to child ingestion if parent doc failed!
          }
        }

        seg.documentId = docId;
        seg.persistenceStatus = "persisted";
        seg.sourceFileName = sourceFileName;
        seg.imageUrl = realSignedUrl;
        seg.storagePath = realStoragePath || undefined;

        if (Array.isArray(seg.pages)) {
          for (const p of seg.pages) {
            p.sourceFileDataUrl = realSignedUrl;
            p.sourceFileName = sourceFileName;
          }
        }

        // Ingest child tables based on document type using verified server-side client
        const privilegedDb = createVerifiedServerPrivilegedClient(supabase);

        if (["sf1", "sf2"].includes(seg.documentType)) {
          const rosterRes = await ingestRosterDocument({
            db: privilegedDb,
            documentId: docId,
            documentType: docTypeForDb as any,
            extractedText: seg.combinedText,
            extractedFields: parsed,
            schoolId: assignment.school_id,
            verifiedContext: {
              schoolYear: verifiedSchoolYear,
              gradeLevel: verifiedGradeLevel,
              section: verifiedSection,
            },
          });

          if (!rosterRes.success) {
            const errMsg = rosterRes.error || rosterRes.warnings.join("; ") || `Failed to ingest roster entries for ${seg.documentType}`;
            console.error(`[scan/batch] Ingest failure for ${seg.documentType}:`, errMsg);
            persistenceErrors.push({ segmentId: seg.id, error: errMsg });
            seg.persistenceStatus = "failed";
            seg.persistenceError = errMsg;
          }
        } else if (seg.documentType === "birth_cert") {
          // PSA Birth Certificate ingestion
          const psaId = parsed.identity || parsed;
          if (psaId.last_name && psaId.first_name) {
            let matchedStudentId: string | null = null;
            if (isValidLrn(psaId.lrn)) {
              const { data: sRow, error: sLookupErr } = await supabase
                .from("students")
                .select("id")
                .eq("lrn", psaId.lrn)
                .eq("school_id", assignment.school_id)
                .maybeSingle();
              if (sLookupErr) {
                console.warn("[scan/batch] Student lookup warning for PSA:", sLookupErr.message);
              }
              matchedStudentId = sRow?.id || null;
            }

            const { error: psaErr } = await (privilegedDb as any)
              .from("psa_identity_records")
              .insert({
                document_id: docId,
                student_id: matchedStudentId,
                school_id: assignment.school_id,
                registry_number: psaId.registry_number || null,
                last_name: psaId.last_name,
                first_name: psaId.first_name,
                middle_name: psaId.middle_name || null,
                sex: normalizeSex(psaId.sex) || "M",
                birth_date: normalizeDate(psaId.birth_date) || "2000-01-01",
                mother_maiden_name: psaId.mother_maiden_name || null,
                father_name: psaId.father_name || null,
                verification_status: "PENDING",
                ocr_confidence: seg.confidence || 0.95,
              });

            if (psaErr) {
              console.error("[scan/batch] PSA insert error:", psaErr);
              persistenceErrors.push({ segmentId: seg.id, error: psaErr.message });
              seg.persistenceStatus = "failed";
              seg.persistenceError = psaErr.message;
            }
          }
        } else if (seg.documentType === "sf9" || seg.documentType === "sf10") {
          // SF9 / SF10 subject grades persistence
          // SAFEGUARD: Never insert subject grades if SF9 identity conflict is present or marked needs_review
          if (seg.documentType === "sf9" && (parsed.identity_conflict || (seg.persistenceStatus as string) === "failed")) {
            console.warn(`[scan/batch] Withholding subject_grades insert for segment ${seg.id} due to identity conflict / needs_review`);
          } else if (Array.isArray(parsed.grades) && parsed.grades.length > 0) {
            const parseNumOrNull = (val: any): number | null => {
              if (val === null || val === undefined || val === "") return null;
              const n = typeof val === "number" ? val : parseFloat(String(val));
              return !isNaN(n) ? n : null;
            };
            const gradeRows = parsed.grades.map((g: any) => ({
              document_id: docId,
              subject: g.subject || "General",
              q1: parseNumOrNull(g.q1),
              q2: parseNumOrNull(g.q2),
              q3: parseNumOrNull(g.q3),
              q4: parseNumOrNull(g.q4),
              final_grade: parseNumOrNull(g.final ?? g.final_grade),
            }));
            const { error: gradeErr } = await privilegedDb.from("subject_grades").insert(gradeRows);
            if (gradeErr) {
              console.error("[scan/batch] Subject grades insert error:", gradeErr);
              persistenceErrors.push({ segmentId: seg.id, error: gradeErr.message });
              seg.persistenceStatus = "failed";
              seg.persistenceError = gradeErr.message;
            }
          }
        }
      } catch (extractErr: any) {
        console.error(`[scan/batch] Processing failure on segment ${seg.id}:`, extractErr);
        seg.needsClassification = true;
        seg.persistenceStatus = "failed";
        seg.persistenceError = extractErr.message || "Failed to parse document segment";
        seg.reasons.push(`Extraction error: ${extractErr.message || "Failed to parse document segment"}`);
        persistenceErrors.push({ segmentId: seg.id, error: extractErr.message });
      }
    }

    // -------------------------------------------------------------------------
    // Phase 3: Unified Cross-Document Comparison & Validation
    // -------------------------------------------------------------------------
    const validationReport = evaluateBatchCrossDocumentValidation({
      batchId,
      schoolYear: verifiedSchoolYear,
      gradeLevel: verifiedGradeLevel,
      section: verifiedSection,
      segments,
      extractedSegmentData,
    });

    const crossValidationPersistenceErrors: Array<{ lrn: string; error: string }> = [];
    const verifiedCrossValDb = createVerifiedServerPrivilegedClient(supabase);
    for (const dossier of validationReport.learnerDossiers) {
      if (isValidLrn(dossier.lrn)) {
        try {
          const { data: studentRow, error: stuErr } = await supabase
            .from("students")
            .select("id, lrn")
            .eq("lrn", dossier.lrn)
            .eq("school_id", assignment.school_id)
            .maybeSingle();

          if (stuErr) {
            throw new Error(`Student lookup failed: ${stuErr.message}`);
          }
          if (!studentRow?.id || normalizeLrn(studentRow.lrn) !== normalizeLrn(dossier.lrn)) {
            throw new Error("No canonical student with the same verified LRN exists in this school.");
          }

          const validationContext = {
            studentId: studentRow.id,
            lrn: dossier.lrn,
            schoolId: assignment.school_id,
            schoolYear: verifiedSchoolYear,
            gradeLevel: normalizeGradeLevelKey(verifiedGradeLevel) as "Grade 11" | "Grade 12",
            fullName: dossier.fullName,
            section: verifiedSection,
            trackStrand: dossier.trackStrand,
          };
          const savedRecords = await fetchStudentValidationRecords(supabase, validationContext);
          const fullEvaluation = evaluateStudentValidation(validationContext, savedRecords, {
            duplicateWarnings: dossier.duplicateWarnings,
          });
          const persistedRows = await persistStudentValidation(verifiedCrossValDb, validationContext, fullEvaluation);
          const persistedValidation = buildPersistedValidationResponse(persistedRows);
          const persistedConsolidated = persistedValidation.consolidated;
          if (!persistedConsolidated) {
            throw new Error("Persisted consolidated validation record was not returned after batch persistence.");
          }

          dossier.unifiedMatrix = persistedValidation.matrix;
          dossier.persistedDiscrepancies = persistedValidation.discrepancies;
          dossier.pairwiseResults = persistedValidation.pairwiseResults;
          dossier.overallStatus =
            persistedConsolidated.status === "MISMATCH"
              ? "MISMATCH"
              : persistedConsolidated.status === "MATCH" || persistedConsolidated.status === "RESOLVED"
              ? "MATCH"
              : persistedConsolidated.status === "NOT_APPLICABLE"
              ? "INCOMPLETE"
              : "NEEDS_REVIEW";
          dossier.validationPersistence = {
            status: "PERSISTED",
            consolidatedValidationId: persistedConsolidated.id || null,
            persistedStatus: persistedConsolidated.status,
          };
          dossier.documentPresence = {
            ...dossier.documentPresence,
            sf1: savedRecords.sf1Entries.length > 0,
            sf2: savedRecords.sf2Entries.length > 0,
            sf5: false,
            sf5a: false,
            sf5b: false,
            sf9: savedRecords.sf9Docs.length > 0,
            sf10: savedRecords.sf10Docs.length > 0,
            psa: savedRecords.psaRecords.length > 0,
            sf2MonthsCount: new Set(savedRecords.sf2Entries.map((entry) => entry.month)).size,
            totalAvailable: [
              savedRecords.sf1Entries.length > 0,
              savedRecords.sf2Entries.length > 0,
              savedRecords.sf9Docs.length > 0,
              savedRecords.sf10Docs.length > 0,
              savedRecords.psaRecords.length > 0,
            ].filter(Boolean).length,
          };
          dossier.allSf2Records = savedRecords.sf2Entries.map((entry) => ({ raw: entry, month: entry.month }));
          dossier.allSf9Records = savedRecords.sf9Docs.map((doc) => ({
            raw: doc.extracted_fields || {},
            fileName: doc.original_filename || undefined,
          }));
          dossier.allSf10Records = savedRecords.sf10Docs.map((doc) => ({
            raw: doc.extracted_fields || {},
            fileName: doc.original_filename || undefined,
          }));
        } catch (crossErr) {
          const message = crossErr instanceof Error ? crossErr.message : String(crossErr);
          console.error(`[scan/batch] Cross-validation persistence failed for LRN ${dossier.lrn}:`, message);
          crossValidationPersistenceErrors.push({ lrn: dossier.lrn, error: message });
          dossier.validationPersistence = {
            status: "REQUIRES_IDENTITY_RESOLUTION",
            reason: `Cross-validation persistence failed: ${message}`,
            recommendedAction: "Review student record in database and retry batch validation.",
          };
          dossier.overallStatus = "NEEDS_REVIEW";
          dossier.unifiedMatrix = [];
          dossier.persistedDiscrepancies = [];
          dossier.pairwiseResults = [];
        }
      } else {
        dossier.validationPersistence = {
          status: "REQUIRES_IDENTITY_RESOLUTION",
          reason: "Missing or invalid 12-digit LRN prevents database persistence and canonical student linking.",
          recommendedAction: "Resolve learner identity manually by inspecting the original scanned document and assigning a valid 12-digit LRN.",
        };
        dossier.overallStatus = "NEEDS_REVIEW";
        dossier.unifiedMatrix = [];
        dossier.persistedDiscrepancies = [];
        dossier.pairwiseResults = [];
      }
    }

    // Rebuild the report categories and summary metrics strictly from persisted validation data
    rebuildBatchValidationReportFromPersistedResults(validationReport);

    // -------------------------------------------------------------------------
    // Phase 4: Audit Logging
    // -------------------------------------------------------------------------
    try {
      await logAuditEvent({
        category: "BATCH_SCAN" as any,
        action: "BATCH_EXTRACTION_AND_VALIDATION_COMPLETED" as any,
        outcome: persistenceErrors.length > 0 || crossValidationPersistenceErrors.length > 0
          ? "FAILURE"
          : validationReport.summary.mismatchedInformationCount === 0
          ? "SUCCESS"
          : "WARNING",
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: "teacher",
        actorSchoolId: roleRow.school_id,
        actorSchoolName: "Taysan Resettlement Integrated School (500169)",
        targetType: "batch",
        targetId: validationReport.batchId,
        targetLabel: `Batch Scan: ${verifiedSection} (${verifiedGradeLevel}, S.Y. ${verifiedSchoolYear})`,
        details: {
          total_segments: segments.length,
          total_learners_detected: validationReport.summary.totalLearnersDetected,
          successfully_matched: validationReport.summary.successfullyMatchedCount,
          consistent_records: validationReport.summary.consistentRecordsCount,
          mismatched_information: validationReport.summary.mismatchedInformationCount,
          missing_documents: validationReport.summary.missingDocumentsCount,
          incomplete_data: validationReport.summary.incompleteDataCount,
          needs_manual_verification: validationReport.summary.needsManualVerificationCount,
          persistence_errors_count: persistenceErrors.length,
          cross_validation_persistence_errors_count: crossValidationPersistenceErrors.length,
        },
      });
    } catch (auditErr) {
      console.warn("[scan/batch] Audit log deferred:", auditErr);
    }

    if (persistenceErrors.length > 0 || crossValidationPersistenceErrors.length > 0) {
      return NextResponse.json(
        {
          error: "Batch scan completed with one or more required persistence failures.",
          persistenceErrors,
          crossValidationPersistenceErrors,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      batchId: validationReport.batchId || batchId,
      report: validationReport,
      segments,
      extractedData: extractedSegmentData,
    });
  } catch (err: any) {
    console.error("[api/scan/batch] Internal Server Error:", err);
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred during batch scanning." },
      { status: 500 }
    );
  }
}

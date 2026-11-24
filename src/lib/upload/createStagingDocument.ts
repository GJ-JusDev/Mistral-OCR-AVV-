/**
 * Server-Side Helper for Retry Staging Document Creation & Observable Cleanup
 *
 * Enforces Migration 026 and Migration 029 security invariants:
 * - Never imports browser client or exposes service-role credentials to the client.
 * - Stamps extracted_fields with is_retry_staging = true and retry_target_document_id
 *   so the SECURITY DEFINER reconciliation and cleanup RPCs can verify staging authenticity.
 * - Preserves verified teacher assignment fields (school_year, grade_level, section) as the
 *   authoritative source of truth.
 * - Checks every database operation for returned errors and ensures cleanup failures are
 *   logged and observable without hiding the original processing error.
 */

export interface StagingDocumentParams {
  db: any; // Supabase server client or PGlite instance
  targetDocumentId: string;
  assignmentId: string;
  schoolId: string;
  teacherId: string;
  docType: string;
  schoolYear: string;
  gradeLevel: string;
  section: string;
  extractedText: string;
  extractedFields: Record<string, any>;
  originalFilename?: string | null;
  ocrConfidence?: number;
  storagePath?: string | null;
  imageUrl?: string | null;
}

export interface CleanupStagingDocumentParams {
  db: any; // Authenticated server client or PGlite instance
  privilegedDb?: any; // Optional server-only service-role client fallback
  stagingDocumentId: string;
  targetDocumentId: string;
}

export interface CleanupStagingDocumentResult {
  cleaned: boolean;
  error?: string;
}

/**
 * Creates a temporary staging document row tied to a specific target document retry
 * and returns its UUID.
 */
export async function createStagingDocument(params: StagingDocumentParams): Promise<string> {
  if (!params.targetDocumentId || !params.schoolId || !params.teacherId || !params.assignmentId) {
    throw new Error("Missing required ownership or assignment parameters for staging document creation.");
  }

  const id = crypto.randomUUID();
  const stagedExtractedFields = {
    ...(params.extractedFields || {}),
    is_retry_staging: true,
    retry_target_document_id: params.targetDocumentId,
  };

  const payload = {
    id,
    school_id: params.schoolId,
    teacher_assignment_id: params.assignmentId,
    student_id: null,
    document_type: params.docType,
    image_url: params.imageUrl ?? "",
    storage_path: params.storagePath ?? null,
    original_filename:
      params.originalFilename ??
      params.extractedFields?.source_file ??
      "staging_document.pdf",
    extracted_text: params.extractedText,
    extracted_fields: stagedExtractedFields,
    ocr_model: "azure-prebuilt-read",
    ocr_confidence: params.ocrConfidence ?? params.extractedFields?.ocr_confidence ?? 0.95,
    status: "extracted" as const,
    school_year: params.schoolYear,
    grade_level: params.gradeLevel,
    section: params.section,
    uploaded_by: params.teacherId,
  };

  const isPostgrest = typeof params.db?.from === "function" && typeof params.db?.query !== "function";

  if (isPostgrest) {
    const { error } = await params.db.from("documents").insert(payload as any);
    if (error) {
      throw new Error(`Failed to create staging document: ${error.message}`);
    }
  } else if (typeof params.db?.query === "function") {
    await params.db.query(
      `
      INSERT INTO public.documents (
        id, school_id, teacher_assignment_id, student_id, document_type,
        image_url, storage_path, original_filename, extracted_text, extracted_fields,
        ocr_model, ocr_confidence, status, school_year, grade_level, section, uploaded_by
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, NULL, $4,
        $5, $6, $7, $8, $9::jsonb,
        $10, $11::numeric, 'extracted', $12, $13, $14, $15
      );
      `,
      [
        payload.id,
        payload.school_id,
        payload.teacher_assignment_id,
        payload.document_type,
        payload.image_url,
        payload.storage_path,
        payload.original_filename,
        payload.extracted_text,
        JSON.stringify(payload.extracted_fields),
        payload.ocr_model,
        payload.ocr_confidence,
        payload.school_year,
        payload.grade_level,
        payload.section,
        payload.uploaded_by,
      ]
    );
  } else {
    throw new Error("Invalid database client provided to createStagingDocument.");
  }

  return id;
}

/**
 * Safely cleans up a failed retry staging document via the authorized SECURITY DEFINER RPC
 * (or server-side privileged client fallback). Never hides or silently swallows cleanup errors.
 */
export async function cleanupStagingDocument(
  params: CleanupStagingDocumentParams
): Promise<CleanupStagingDocumentResult> {
  const { db, privilegedDb, stagingDocumentId, targetDocumentId } = params;
  const errors: string[] = [];

  const isPostgrest = typeof db?.from === "function" && typeof db?.query !== "function";

  // 1. Primary path: Authorized SECURITY DEFINER RPC cleanup_failed_retry_staging_document
  if (isPostgrest && typeof db?.rpc === "function") {
    try {
      const { data: rpcRes, error: rpcErr } = await db.rpc("cleanup_failed_retry_staging_document", {
        p_staging_document_id: stagingDocumentId,
        p_target_document_id: targetDocumentId,
      });

      if (!rpcErr && rpcRes?.success) {
        return { cleaned: true };
      }
      if (rpcErr) {
        errors.push(`RPC cleanup_failed_retry_staging_document error: ${rpcErr.message}`);
      } else if (!rpcRes?.success) {
        errors.push("RPC cleanup_failed_retry_staging_document returned unsuccessful response.");
      }
    } catch (err: any) {
      errors.push(`RPC cleanup_failed_retry_staging_document exception: ${err?.message || String(err)}`);
    }
  } else if (typeof db?.query === "function") {
    try {
      const res = await db.query(
        `SELECT public.cleanup_failed_retry_staging_document($1::uuid, $2::uuid) AS result;`,
        [stagingDocumentId, targetDocumentId]
      );
      if (res?.rows?.[0]?.result?.success) {
        return { cleaned: true };
      }
      errors.push("SQL cleanup_failed_retry_staging_document returned unsuccessful result.");
    } catch (err: any) {
      errors.push(`SQL cleanup_failed_retry_staging_document error: ${err?.message || String(err)}`);
    }
  }

  // 2. Secondary fallback: Server-only privileged client (if distinct from authenticated client)
  if (privilegedDb && typeof privilegedDb?.from === "function") {
    try {
      const { error: delErr } = await privilegedDb
        .from("documents")
        .delete()
        .eq("id", stagingDocumentId);

      if (!delErr) {
        return { cleaned: true };
      }
      errors.push(`Privileged staging delete error: ${delErr.message}`);
    } catch (err: any) {
      errors.push(`Privileged staging delete exception: ${err?.message || String(err)}`);
    }
  }

  const combinedError = errors.join(" | ") || `Failed to clean up staging document ${stagingDocumentId}`;
  console.error(`[staging-cleanup] Observable cleanup failure for staging doc ${stagingDocumentId}:`, combinedError);
  return {
    cleaned: false,
    error: combinedError,
  };
}

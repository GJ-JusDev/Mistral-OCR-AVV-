"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  CONFIRMATION_PHRASE,
  DeleteReviewDocumentParams,
  DeleteReviewDocumentResult,
} from "@/types/reviewDeletion";

/**
 * AVV System — Direct Review Queue Deletion Server Action
 *
 * Security Invariants Enforced:
 * 1. User-Authenticated Client: Strictly uses createClient() with caller's authenticated session cookies.
 *    No service-role client is used.
 * 2. Exact Confirmation Phrase: Rejects anything other than "I am deleting this".
 * 3. Role & Account Verification: Rejects unapproved, declined, principal (monitoring-only), or unauthorized users.
 * 4. School Verification & Ownership:
 *    - Rejects callers without an assigned school (unless division administrator).
 *    - Rejects teachers attempting to delete documents with NULL school_id unless verified owner (uploaded_by).
 *    - Rejects cross-school deletion attempts.
 * 5. Document Eligibility: Strictly requires status === 'needs_review'.
 * 6. Single Atomic Transaction: Invokes archive_review_document RPC where document status update
 *    and public.audit_logs insertion commit or roll back together.
 * 7. NO Direct Table-Update Fallback: If RPC is unavailable or fails, document remains completely unchanged.
 */
export async function deleteReviewDocument(
  params: DeleteReviewDocumentParams
): Promise<DeleteReviewDocumentResult> {
  const { documentId, confirmationPhrase } = params || {};

  if (!documentId) {
    return { error: "Target document ID is required." };
  }

  // Exact confirmation phrase verification
  if (confirmationPhrase !== CONFIRMATION_PHRASE) {
    return {
      error: `Invalid confirmation phrase. You must type exactly: ${CONFIRMATION_PHRASE}`,
    };
  }

  // Strictly user-authenticated Supabase client derived from session cookies
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized: Please log in to delete records." };
  }

  // Authoritative role and status lookup from database
  const { data: roleRow, error: roleError } = await supabase
    .from("user_roles")
    .select("role, account_status, school_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError || !roleRow || !roleRow.role) {
    return {
      error: "Forbidden: No authoritative role assigned. Please contact an administrator.",
    };
  }

  if (roleRow.account_status !== "Approved") {
    return {
      error: "Forbidden: Account is not approved. Administrator authorization is required.",
    };
  }

  const role = roleRow.role.toLowerCase();
  if (role === "principal") {
    return {
      error: "Forbidden: Principal role is monitoring-only and cannot delete review records.",
    };
  }

  if (role !== "teacher" && role !== "admin") {
    return {
      error: "Forbidden: Only authorized teachers and administrators can delete review records.",
    };
  }

  // Caller school verification: Teachers and non-admins must have an assigned school
  if (!roleRow.school_id && role !== "admin") {
    return {
      error: "Forbidden: Caller school cannot be verified. Teachers must have an assigned school to delete review queue records.",
    };
  }

  // Retrieve target document to verify existence, status, and ownership/school isolation
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, status, student_id, school_id, uploaded_by, document_type, original_filename, extracted_fields")
    .eq("id", documentId)
    .maybeSingle();

  if (docError || !doc) {
    return { error: "Target document not found." };
  }

  // Check if already archived
  if (doc.status === "archived") {
    return { error: "This document is already archived and removed from the active queue." };
  }

  // Strict eligibility check: only records in 'needs_review' can be deleted
  if (doc.status !== "needs_review") {
    return {
      error: `Document is not eligible for review deletion (Current status: ${doc.status}). Only records in needs_review state can be deleted.`,
    };
  }

  // School isolation & ownership check
  if (!doc.school_id) {
    // Document with NULL school_id: teachers can only delete if verified owner
    if (role !== "admin") {
      if (!doc.uploaded_by || doc.uploaded_by !== user.id) {
        return {
          error: "Forbidden: Teachers cannot delete documents with unassigned school unless explicitly authorized as the document owner.",
        };
      }
    }
  } else {
    // Document with assigned school: caller school must match unless division admin
    if (role !== "admin" && roleRow.school_id && roleRow.school_id !== doc.school_id) {
      return {
        error: "Forbidden: Cannot delete documents belonging to another school.",
      };
    }
  }

  const nowIso = new Date().toISOString();

  // ---------------------------------------------------------------------------
  // Call atomic database RPC (archival update + audit log in single transaction)
  // ---------------------------------------------------------------------------
  try {
    const { data: rpcData, error: rpcError } = await (supabase as any).rpc("archive_review_document", {
      p_document_id: documentId,
      p_confirmation_phrase: confirmationPhrase,
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      const isMissingRpc =
        msg.includes("Could not find the function") ||
        msg.includes("function public.archive_review_document") ||
        rpcError.code === "42883";

      if (isMissingRpc) {
        return {
          error:
            "Database function archive_review_document is unavailable. Migration 018 (018_review_queue_direct_deletion.sql) must be executed in the Supabase Dashboard SQL Editor before documents can be archived.",
        };
      }

      return { error: msg };
    }

    if (!rpcData?.success) {
      return { error: "Failed to archive document. The database transaction did not complete." };
    }

    // Revalidate paths on confirmed success
    revalidatePath("/review");
    revalidatePath("/documents");
    revalidatePath("/");

    return {
      success: true,
      documentId: doc.id,
      archivedAt: rpcData.archived_at || nowIso,
    };
  } catch (err: any) {
    return {
      error: err?.message || "An unexpected error occurred while archiving the review document.",
    };
  }
}

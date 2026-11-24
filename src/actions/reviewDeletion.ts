"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import {
  normalizeGradeLevelKey,
  normalizeSchoolYearKey,
  normalizeSectionKey,
} from "@/lib/teacher/assignments";
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

  if (role === "admin" || role === "administrator") {
    return {
      error: "Forbidden: Administrator role cannot delete student documents. Document deletion is restricted to authorized teachers.",
    };
  }

  if (role !== "teacher") {
    return {
      error: "Forbidden: Only authorized teachers can delete review records.",
    };
  }

  // Caller school verification: Teachers must have an assigned school
  if (!roleRow.school_id) {
    return {
      error: "Forbidden: Caller school cannot be verified. Teachers must have an assigned school to delete review queue records.",
    };
  }

  // Retrieve target document to verify existence, status, and ownership/school isolation
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, status, student_id, school_id, uploaded_by, document_type, original_filename, extracted_fields, school_year, grade_level, section, teacher_assignment_id")
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
  if (doc.school_id && roleRow.school_id !== doc.school_id) {
    return {
      error: "Forbidden: Cannot delete documents belonging to another school.",
    };
  }

  // Assigned-section permission check: Teachers may delete documents only according to authorized permissions & assigned-section restrictions
  const { data: assignmentsData } = await supabase
    .from("teacher_assignments")
    .select("*")
    .eq("teacher_user_id", user.id)
    .eq("assignment_status", "active");

  const activeAssignments: any[] = assignmentsData || [];
  const isUploader = Boolean(doc.uploaded_by && doc.uploaded_by === user.id);

  const docSy = normalizeSchoolYearKey(doc.school_year || (doc.extracted_fields as any)?.school_year);
  const docGl = normalizeGradeLevelKey(doc.grade_level || (doc.extracted_fields as any)?.grade_level);
  const docSec = normalizeSectionKey(doc.section || (doc.extracted_fields as any)?.section);

  const isAssignedAdviser = activeAssignments.some((a) => {
    if (a.assignment_type !== "class_adviser") return false;
    if (doc.school_id && a.school_id !== doc.school_id) return false;
    if (doc.teacher_assignment_id && a.id === doc.teacher_assignment_id) return true;
    const aSec = normalizeSectionKey(a.section);
    const aSy = normalizeSchoolYearKey(a.school_year);
    const aGl = normalizeGradeLevelKey(a.grade_level);
    return Boolean(docSec && aSec === docSec && (!docSy || aSy === docSy) && (!docGl || aGl === docGl));
  });

  if (!isUploader && !isAssignedAdviser) {
    return {
      error: "Forbidden: Teachers may only delete documents belonging to their officially assigned advisory section.",
    };
  }

  const nowIso = new Date().toISOString();

  // Resolve Teacher's name
  let teacherName =
    user.user_metadata?.full_name ||
    [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" ").trim();
  if (!teacherName && activeAssignments.length > 0) {
    teacherName = activeAssignments[0].teacher_name || null;
  }
  if (!teacherName) {
    teacherName = user.email || `Teacher (${user.id.slice(0, 8)})`;
  }

  // Resolve canonical document type (SF1, SF2, SF5A, SF5B, SF9, SF10, PSA, etc.)
  let formattedDocType = String(doc.document_type || "DOCUMENT").toUpperCase();
  const ef = (doc.extracted_fields || {}) as Record<string, any>;
  if (formattedDocType === "SF5" && ef.form_variant) {
    formattedDocType = String(ef.form_variant).toUpperCase();
  } else if (formattedDocType === "BIRTH_CERT") {
    formattedDocType = "PSA";
  }

  const schoolYear = doc.school_year || ef.school_year || null;
  const section = doc.section || ef.section || null;
  const gradeLevel = doc.grade_level || ef.grade_level || null;

  // 1. Perform authorized archival via RPC (single atomic transaction with trigger authorization & audit log)
  const { data: rpcData, error: rpcError } = await (supabase as any).rpc("archive_review_document", {
    p_document_id: documentId,
    p_confirmation_phrase: confirmationPhrase,
  });

  if (rpcError || !rpcData?.success) {
    return { error: rpcError?.message || "Failed to archive document." };
  }

  // 2. Automatically record in User Logs (public.audit_logs & in-memory)
  await logAuditEvent({
    category: "DOCUMENT",
    action: "DOCUMENT_ARCHIVED",
    outcome: "SUCCESS",
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: "teacher",
    actorSchoolId: doc.school_id || roleRow.school_id,
    actorSchoolName: "Taysan Resettlement Integrated School (500169)",
    targetType: "document",
    targetId: doc.id,
    targetLabel: `${formattedDocType} - ${doc.original_filename || doc.id}`,
    reason: `Teacher ${teacherName} archived document from review queue (soft deletion)`,
    details: {
      teacher_name: teacherName,
      teacher_user_id: user.id,
      action: "DOCUMENT_ARCHIVED",
      deletion_type: "soft_deletion (archived)",
      document_type: formattedDocType,
      document_id: doc.id,
      original_filename: doc.original_filename,
      archived_at: nowIso,
      deleted_at: nowIso,
      school_year: schoolYear,
      section: section,
      grade_level: gradeLevel,
    },
  });

  // Revalidate paths on confirmed success
  revalidatePath("/review");
  revalidatePath("/documents");
  revalidatePath("/");

  return {
    success: true,
    documentId: doc.id,
    archivedAt: nowIso,
  };
}

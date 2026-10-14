"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { evaluateStudentIdentity, verifyStudentCollision } from "@/lib/validation/studentMatcher";
import { isValidSchoolYear } from "@/lib/validation/patterns";
import { validateFields } from "@/lib/validation/engine";
import type { ExtractedFields } from "@/types/documents";

export type ReviewResult = {
  success?: boolean;
  newStatus?: string;
  error?: string;
};

/**
 * Submit an approval or rejection review decision for a document.
 * Enforces strict DepEd identity validation and requires valid school year upon approval.
 */
export async function submitDocumentReview(
  documentId: string,
  action: "approve" | "reject",
  comment?: string
): Promise<ReviewResult> {
  try {
    if (!documentId) {
      return { error: "Document ID is required." };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { error: "Unauthorized: Please log in to review documents." };
    }

    // Authoritative role, status, and school assignment check directly from user_roles
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const role = (roleRow?.role || user.user_metadata?.role || "").toLowerCase();
    const isApproved = roleRow?.account_status === "Approved" || role === "admin" || user.user_metadata?.account_status === "Approved";

    if (!isApproved) {
      return { error: "Forbidden: Account is not approved. Administrator authorization is required." };
    }

    // Official approval and rejection is restricted to Admins and Principals (School Heads)
    const canFinalize = role === "admin" || role === "principal";
    if (!canFinalize) {
      return {
        error: "Forbidden: Only authorized Administrators or Principals can approve or reject official academic documents.",
      };
    }

    // 1. Fetch current document
    const { data: doc, error: fetchError } = await supabase
      .from("documents")
      .select("id, status, student_id, extracted_fields, school_id, uploaded_by")
      .eq("id", documentId)
      .single();

    if (fetchError || !doc) {
      return { error: fetchError?.message || "Document not found." };
    }

    // Principal school isolation: Principal can only review documents in their assigned school
    if (role === "principal") {
      if (!roleRow?.school_id) {
        return { error: "Forbidden: Principal account is not assigned to an authorized school." };
      }
      if (doc.school_id && doc.school_id !== roleRow.school_id) {
        return { error: "Forbidden: Principals can only review and finalize documents belonging to their assigned school." };
      }
    }

    let studentId = doc.student_id;
    const extractedFields = (doc.extracted_fields as ExtractedFields) || {};

    // 2. Strict validation when approving
    if (action === "approve") {
      // School Year validation: NEVER silently assign 2023-2024
      const schoolYear = extractedFields.school_year?.trim();
      if (!schoolYear || !isValidSchoolYear(schoolYear)) {
        return {
          error: "Cannot approve document: School year is missing or invalid. Please correct the school year (e.g. 2023-2024) before approval.",
        };
      }

      // Learner Identity validation: NEVER auto-create "Unknown Learner"
      const identityEval = evaluateStudentIdentity(extractedFields);
      if (!identityEval.isValidLrn) {
        return {
          error: `Cannot approve document: ${identityEval.reasons.join(" ")} Please correct the LRN before approval.`,
        };
      }

      if (!identityEval.isValidName) {
        return {
          error: `Cannot approve document: ${identityEval.reasons.join(" ")} Please correct the student name before approval.`,
        };
      }

      // Verify or link student
      if (!studentId && identityEval.normalizedLrn) {
        const { data: existingStudent } = await supabase
          .from("students")
          .select("id, first_name, last_name")
          .eq("lrn", identityEval.normalizedLrn)
          .maybeSingle();

        if (existingStudent?.id) {
          const collision = verifyStudentCollision(identityEval.lastName, existingStudent);
          if (collision.hasConflict) {
            return { error: `Cannot approve document due to identity conflict: ${collision.reason}` };
          }
          studentId = existingStudent.id;
        } else if (identityEval.canAutoCreate) {
          const gradeLevel = extractedFields.grade_level || null;
          const sex = extractedFields.sex === "M" || extractedFields.sex === "F" ? extractedFields.sex : null;

          const { data: newStudent, error: createError } = await supabase
            .from("students")
            .insert({
              lrn: identityEval.normalizedLrn,
              first_name: identityEval.firstName!,
              middle_name: identityEval.middleName,
              last_name: identityEval.lastName!,
              suffix: identityEval.suffix,
              grade_level: gradeLevel,
              sex: sex,
              status: "active",
            })
            .select("id")
            .single();

          if (createError || !newStudent) {
            return { error: `Failed to create verified student record: ${createError?.message}` };
          }
          studentId = newStudent.id;
        }
      }

      if (studentId && studentId !== doc.student_id) {
        await supabase
          .from("documents")
          .update({ student_id: studentId })
          .eq("id", documentId);
      }
    }

    const newStatus = action === "approve" ? "approved" : "rejected";

    // 3. Update document status
    const { error: updateError } = await supabase
      .from("documents")
      .update({ status: newStatus })
      .eq("id", documentId);

    if (updateError) {
      return { error: updateError.message };
    }

    // 4. Log the review decision in review_logs
    await supabase.from("review_logs").insert({
      document_id: documentId,
      action: action,
      previous_status: doc.status,
      new_status: newStatus,
      comment: comment || (action === "approve" ? "Approved by reviewer" : "Rejected"),
      reviewed_by: user.id,
    });

    revalidatePath(`/documents/${documentId}`);
    revalidatePath("/documents");
    revalidatePath("/review");
    revalidatePath("/students");
    revalidatePath("/");

    return { success: true, newStatus };
  } catch (err: any) {
    return { error: err.message || "An unexpected error occurred during review." };
  }
}

/**
 * Save manual corrections made by a reviewer to the extracted document fields.
 * Re-evaluates validation rules and logs corrections in review_logs.
 */
export async function saveDocumentCorrections(
  documentId: string,
  updatedFields: Partial<ExtractedFields>,
  comment?: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    if (!documentId) {
      return { error: "Document ID is required." };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { error: "Unauthorized: Please log in to correct document fields." };
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const role = (roleRow?.role || user.user_metadata?.role || "").toLowerCase();
    const isApproved = roleRow?.account_status === "Approved" || role === "admin" || user.user_metadata?.account_status === "Approved";

    if (!isApproved) {
      return { error: "Forbidden: Account is not approved. Administrator authorization is required." };
    }

    const { data: doc, error: fetchError } = await supabase
      .from("documents")
      .select("id, status, extracted_fields, student_id, school_id, uploaded_by")
      .eq("id", documentId)
      .single();

    if (fetchError || !doc) {
      return { error: fetchError?.message || "Document not found." };
    }

    // Role-based authorization guard:
    // Teachers can only edit corrections on their own non-finalized uploads
    if (role === "teacher") {
      if (doc.uploaded_by && doc.uploaded_by !== user.id) {
        return { error: "Forbidden: Teachers can only edit corrections on their own uploaded documents." };
      }
      if (doc.status === "approved" || doc.status === "rejected") {
        return { error: "Forbidden: Cannot edit corrections on already finalized documents." };
      }
    } else if (role === "principal") {
      if (doc.school_id && roleRow?.school_id && doc.school_id !== roleRow.school_id) {
        return { error: "Forbidden: Principals can only edit documents belonging to their assigned school." };
      }
      if (doc.status === "approved" || doc.status === "rejected") {
        return { error: "Forbidden: Cannot edit corrections on already finalized documents." };
      }
    }

    const currentFields = (doc.extracted_fields as ExtractedFields) || {};
    const mergedFields: ExtractedFields = {
      ...currentFields,
      ...updatedFields,
    };

    // Re-evaluate validation report
    const validationReport = validateFields(mergedFields);
    const newStatus = doc.status === "approved" || doc.status === "rejected"
      ? doc.status
      : validationReport.status === "valid" ? "validated" : "needs_review";

    // Update document record
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        extracted_fields: mergedFields,
        status: newStatus,
      })
      .eq("id", documentId);

    if (updateError) {
      return { error: updateError.message };
    }

    // Record correction audit entry
    await supabase.from("review_logs").insert({
      document_id: documentId,
      action: "correct",
      previous_status: doc.status,
      new_status: newStatus,
      corrections: updatedFields as any,
      comment: comment || "Field corrections saved by reviewer.",
      reviewed_by: user.id,
    });

    revalidatePath(`/documents/${documentId}`);
    revalidatePath("/documents");
    revalidatePath("/review");
    revalidatePath("/");

    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to save corrections." };
  }
}

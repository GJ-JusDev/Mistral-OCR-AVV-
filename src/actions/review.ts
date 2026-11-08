"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { evaluateStudentIdentity, verifyStudentCollision } from "@/lib/validation/studentMatcher";
import { isValidSchoolYear } from "@/lib/validation/patterns";
import { validateFields } from "@/lib/validation/engine";
import { normalizeGradeRecords } from "@/lib/validation/gradeUtils";
import type { ExtractedFields } from "@/types/documents";

export type ReviewResult = {
  success?: boolean;
  newStatus?: string;
  error?: string;
};

/**
 * SUBMIT DOCUMENT REVIEW DECISION (APPROVE O REJECT)
 *
 * Bakit ito ang puso ng Teacher/Admin Review Queue:
 * Dito nire-review ng tao ang OCR extracted data bago ito pumasok bilang official database record.
 *
 * Mga Mahahalagang DepEd Proteksyon:
 * 1. Role Authorization:
 *    - Tanging authorized Administrator ang may final approval/rejection authority.
 *    - Ang Principal ay monitoring-only at hindi nag-e-encode para may checks-and-balances.
 * 2. Strict School Year Validation:
 *    - Bawal mag-default o mag-assume ng School Year (hal. bawal basta gawing 2023-2024).
 *    - Kailangang i-verify ng guro ang nakasulat sa pisikal na dokumento.
 * 3. Identity Verification & Anti-Collision:
 *    - Bawal mag-auto-create ng "Unknown Learner".
 *    - Kinakailangan ang 12-digit LRN at student name.
 *    - Sinusuri ang collision detection upang hindi magkamaling mai-link ang record sa ibang mag-aaral.
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

    // 1. Authoritative role, status, at school assignment check mula sa user_roles
    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError || !roleRow || !roleRow.role) {
      return { error: "Forbidden: No authoritative role assigned. Please contact an administrator." };
    }

    const role = roleRow.role.toLowerCase();
    const supportedRoles = ["admin", "principal", "teacher"];
    if (!supportedRoles.includes(role)) {
      return { error: "Forbidden: Unsupported role." };
    }

    if (roleRow.account_status !== "Approved") {
      return { error: "Forbidden: Account is not approved. Administrator authorization is required." };
    }

    // Principal accounts are restricted to monitoring-only
    if (role === "principal") {
      return {
        error: "Forbidden: Principal role is monitoring-only and cannot approve or reject review decisions.",
      };
    }

    // Official approval and rejection is restricted to Admins
    const canFinalize = role === "admin";
    if (!canFinalize) {
      return {
        error: "Forbidden: Only authorized Administrators can approve or reject official academic documents.",
      };
    }

    // 2. Kunin ang kasalukuyang dokumento at extracted fields
    const { data: doc, error: fetchError } = await supabase
      .from("documents")
      .select("id, status, student_id, extracted_fields, school_id, uploaded_by")
      .eq("id", documentId)
      .single();

    if (fetchError || !doc) {
      return { error: fetchError?.message || "Document not found." };
    }

    let studentId = doc.student_id;
    const extractedFields = (doc.extracted_fields as ExtractedFields) || {};

    // 3. Mahigpit na pagsusuri kapag "approve" ang pinili
    if (action === "approve") {
      // 3.1 School Year Validation: Bawal mag-imbento ng S.Y. kung blangko sa OCR
      const schoolYear = extractedFields.school_year?.trim();
      if (!schoolYear || !isValidSchoolYear(schoolYear)) {
        return {
          error: "Cannot approve document: School year is missing or invalid. Please correct the school year (e.g. 2023-2024) before approval.",
        };
      }

      // 3.2 Learner Identity Validation: Bawal ang "Unknown Learner", mandatory ang 12-digit LRN
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

      // 3.3 Verify at i-link ang student record
      if (!studentId && identityEval.normalizedLrn) {
        const { data: existingStudent } = await supabase
          .from("students")
          .select("id, first_name, last_name")
          .eq("lrn", identityEval.normalizedLrn)
          .maybeSingle();

        if (existingStudent?.id) {
          // Collision Check: Kapag may kaparehong LRN sa database,
          // sinusuri kung tugma ang apelyido para hindi magka-interchange ang dalawang mag-aaral
          const collision = verifyStudentCollision(identityEval.lastName, existingStudent);
          if (collision.hasConflict) {
            return { error: `Cannot approve document due to identity conflict: ${collision.reason}` };
          }
          studentId = existingStudent.id;
        } else if (identityEval.canAutoCreate) {
          // Kung bagong estudyante at kumpleto ang verified identity, i-create sa students table
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
              school_id: doc.school_id ?? null,
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

    // 3. Update document status & ensure normalized grades for approval trigger
    const updatePayload: any = { status: newStatus };
    if (action === "approve" && Array.isArray(extractedFields.grades)) {
      extractedFields.grades = normalizeGradeRecords(extractedFields.grades);
      updatePayload.extracted_fields = extractedFields;
    }

    const { error: updateError } = await supabase
      .from("documents")
      .update(updatePayload)
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
 * MANUAL FIELD CORRECTIONS (HUMAN-IN-THE-LOOP)
 *
 * Bakit ito kailangan sa AVV:
 * Hindi 100% perpekto ang OCR, lalo na kapag malabo ang scan o lukot ang papel.
 * Sa function na ito, binibigyan ng kakayahan ang guro na itama ang LRN, pangalan, o mga marka.
 * Pagkatapos itama, awtomatikong muling tatakbo ang validation rules at
 * itatala sa `review_logs` ang bawat ginawang pagbabago para sa audit trail.
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

    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError || !roleRow || !roleRow.role) {
      return { error: "Forbidden: No authoritative role assigned. Please contact an administrator." };
    }

    const role = roleRow.role.toLowerCase();
    const supportedRoles = ["admin", "principal", "teacher"];
    if (!supportedRoles.includes(role)) {
      return { error: "Forbidden: Unsupported role." };
    }

    if (roleRow.account_status !== "Approved") {
      return { error: "Forbidden: Account is not approved. Administrator authorization is required." };
    }

    const { data: doc, error: fetchError } = await supabase
      .from("documents")
      .select("id, status, extracted_fields, student_id, school_id, uploaded_by, ocr_confidence")
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

    // Normalize grades using semester-aware rules to avoid stale status
    if (Array.isArray(mergedFields.grades)) {
      mergedFields.grades = normalizeGradeRecords(mergedFields.grades);
    }

    // Re-evaluate validation report using document's recorded OCR confidence
    const docConfidence = typeof (doc as any)?.ocr_confidence === "number" ? (doc as any).ocr_confidence : undefined;
    const validationReport = validateFields(mergedFields, { ocrConfidence: docConfidence });
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

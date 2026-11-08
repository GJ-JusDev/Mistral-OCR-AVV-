"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { evaluateStudentIdentity, verifyStudentCollision } from "@/lib/validation/studentMatcher";
import { isValidSchoolYear } from "@/lib/validation/patterns";
import { validateFields } from "@/lib/validation/engine";
import { normalizeGradeRecords } from "@/lib/validation/gradeUtils";
import { evaluateAttendanceRecords } from "@/lib/attendance/attendanceEvaluator";
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
    if (action === "approve") {
      let needsExtractedUpdate = false;
      if (Array.isArray(extractedFields.grades)) {
        extractedFields.grades = normalizeGradeRecords(extractedFields.grades);
        needsExtractedUpdate = true;
      }
      if (Array.isArray(extractedFields.attendance) && extractedFields.attendance.length > 0) {
        const attEval = evaluateAttendanceRecords(extractedFields.attendance, extractedFields.attendance_months);
        extractedFields.attendance_totals = attEval.totals;
        extractedFields.attendance_percentage = attEval.attendancePercentage;
        extractedFields.absence_percentage = attEval.absencePercentage;
        extractedFields.attendance_risk_status = attEval.riskStatus;
        extractedFields.attendance_discrepancy_details = attEval.discrepancyDetails;
        needsExtractedUpdate = true;
      }
      if (needsExtractedUpdate) {
        updatePayload.extracted_fields = extractedFields;
      }
    }

    const { error: updateError } = await supabase
      .from("documents")
      .update(updatePayload)
      .eq("id", documentId);

    if (updateError) {
      return { error: updateError.message };
    }

    // 3.1 Synchronize attendance and remedial records if migration 013 tables exist
    if (action === "approve" && studentId) {
      try {
        if (Array.isArray(extractedFields.attendance) && extractedFields.attendance.length > 0) {
          const sy = extractedFields.school_year || (doc as any).school_year || "Unknown";
          const gl = extractedFields.grade_level || "Grade 11";
          const schoolId = doc.school_id || null;
          const attEval = evaluateAttendanceRecords(extractedFields.attendance, extractedFields.attendance_months);

          // Synchronize attendance summary
          await (supabase as any).from("attendance_summaries").upsert({
            student_id: studentId,
            document_id: documentId,
            school_id: schoolId,
            grade_level: gl,
            school_year: sy,
            semester: (extractedFields as any).semester || null,
            total_school_days: attEval.totals.computed_school_days ?? null,
            total_days_present: attEval.totals.computed_days_present ?? null,
            total_days_absent: attEval.totals.computed_days_absent ?? null,
            attendance_percentage: attEval.attendancePercentage ?? null,
            absence_percentage: attEval.absencePercentage ?? null,
            risk_status: attEval.riskStatus,
            verification_status: "ATTENDANCE_VERIFIED",
            verified_by: user.id,
            verified_at: new Date().toISOString(),
            discrepancy_details: attEval.discrepancyDetails,
          });

          // Synchronize metric rows
          for (const rec of extractedFields.attendance) {
            const metricMap: Record<string, string> = {
              "school days": "No. of School Days",
              "bilang ng araw ng pasok": "No. of School Days",
              "present": "No. of Days Present",
              "pumasok": "No. of Days Present",
              "absent": "No. of Days Absent",
              "lumiban": "No. of Days Absent",
            };
            let mappedMetric: string | null = null;
            const lowerLabel = (rec.label || "").toLowerCase();
            for (const [kw, standardLabel] of Object.entries(metricMap)) {
              if (lowerLabel.includes(kw)) {
                mappedMetric = standardLabel;
                break;
              }
            }
            if (mappedMetric) {
              const months = extractedFields.attendance_months || [];
              const monthlyValues: Record<string, number | null> = {};
              rec.values.forEach((v: string, idx: number) => {
                const m = months[idx] || `M${idx + 1}`;
                const parsed = parseFloat(v);
                monthlyValues[m] = isNaN(parsed) ? null : parsed;
              });

              await (supabase as any).from("attendance_records").upsert({
                student_id: studentId,
                document_id: documentId,
                school_id: schoolId,
                grade_level: gl,
                school_year: sy,
                semester: (extractedFields as any).semester || null,
                metric_label: mappedMetric,
                monthly_values: monthlyValues,
                computed_total: rec.total ? parseFloat(String(rec.total)) : null,
                printed_total: rec.total ? parseFloat(String(rec.total)) : null,
              });
            }
          }
        }

        // Synchronize remedial records for subjects with failed grades or remedial marks
        if (Array.isArray(extractedFields.grades)) {
          for (const g of extractedFields.grades) {
            const origFinal = typeof g.final === "number" ? g.final : parseFloat(String(g.final || ""));
            const rMark = g.remedial_class_mark ? parseFloat(String(g.remedial_class_mark)) : null;
            const recomputed = g.recomputed_final_grade ? parseFloat(String(g.recomputed_final_grade)) : null;

            if (!isNaN(origFinal) && (origFinal < 75 || rMark !== null)) {
              await (supabase as any).from("remedial_records").upsert({
                student_id: studentId,
                document_id: documentId,
                school_id: doc.school_id || null,
                subject: g.subject || "General Subject",
                semester: g.semester || null,
                school_year: extractedFields.school_year || "Unknown",
                original_final_grade: origFinal,
                remedial_class_mark: rMark,
                recomputed_final_grade: recomputed,
                status: recomputed && recomputed >= 75 ? "REMEDIAL_PASSED" : rMark ? "REMEDIAL_COMPLETED_PENDING_VERIFICATION" : "REMEDIAL_REQUIRED",
                is_deficiency_resolved: Boolean(recomputed && recomputed >= 75 && !g.needsVerification),
                is_verified: !g.needsVerification,
                verified_by: user.id,
                verified_at: new Date().toISOString(),
              });
            }
          }
        }
      } catch (syncErr) {
        // Migration 013 tables might not yet be applied; log notice without disrupting document approval
        console.warn("Notice: Migration 013 attendance/remedial relational sync deferred:", syncErr);
      }
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

    // Evaluate attendance whenever attendance records are provided or modified
    if (Array.isArray(mergedFields.attendance) && mergedFields.attendance.length > 0) {
      const attEval = evaluateAttendanceRecords(mergedFields.attendance, mergedFields.attendance_months);
      mergedFields.attendance_totals = attEval.totals;
      mergedFields.attendance_percentage = attEval.attendancePercentage;
      mergedFields.absence_percentage = attEval.absencePercentage;
      mergedFields.attendance_risk_status = attEval.riskStatus;
      mergedFields.attendance_discrepancy_details = attEval.discrepancyDetails;
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

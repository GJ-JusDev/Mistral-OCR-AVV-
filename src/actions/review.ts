"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { evaluateStudentIdentity, verifyStudentCollision } from "@/lib/validation/studentMatcher";
import { isValidSchoolYear, normalizeLrn, isValidLrn } from "@/lib/validation/patterns";
import { validateFields } from "@/lib/validation/engine";
import { normalizeGradeRecords, updateExtractedFieldsAverages } from "@/lib/validation/gradeUtils";
import { compareScannedGradesWithExisting } from "@/lib/validation/gradeComparator";
import { evaluateAttendanceRecords } from "@/lib/attendance/attendanceEvaluator";
import type { ExtractedFields } from "@/types/documents";
import { logAuditEvent } from "@/lib/audit/auditLogger";

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
      .select("id, status, student_id, extracted_fields, school_id, uploaded_by, document_type")
      .eq("id", documentId)
      .single();

    if (fetchError || !doc) {
      return { error: fetchError?.message || "Document not found." };
    }

    let studentId = doc.student_id;
    const extractedFields = (doc.extracted_fields as ExtractedFields) || {};
    const isRosterDoc = ["sf1", "sf2", "sf5"].includes(doc.document_type);
    const isPsaDoc = doc.document_type === "birth_cert";
    const isSingleLearnerAcademic = ["sf9", "sf10"].includes(doc.document_type || "sf9");
    const schoolYear = extractedFields.school_year?.trim();

    // 3. Mahigpit na pagsusuri kapag "approve" ang pinili
    if (action === "approve") {
      if (isRosterDoc) {
        // Anti-bypass safeguard: Do not approve roster documents containing FLAGGED learner entries
        const table = doc.document_type === "sf1" ? "sf1_roster_entries" : doc.document_type === "sf2" ? "sf2_attendance_entries" : "sf5_promotion_entries";
        const { data: flaggedEntries } = await (supabase as any)
          .from(table)
          .select("id")
          .eq("document_id", documentId)
          .eq("review_status", "FLAGGED")
          .limit(1);

        if (flaggedEntries && flaggedEntries.length > 0) {
          return {
            error: "Cannot approve roster document: Document contains unresolved FLAGGED learner entries. All flagged records must be reviewed and resolved before approval.",
          };
        }
      }

      if (isSingleLearnerAcademic) {
        // 3.1 School Year Validation: Bawal mag-imbento ng S.Y. kung blangko sa OCR
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

        // 3.3 Verify at i-link ang student record gamit ang normalized 12-digit LRN
        if (identityEval.normalizedLrn) {
          // Query database by normalized LRN to ensure single verified student per LRN
          const { data: existingStudent } = await supabase
            .from("students")
            .select("id, first_name, last_name, lrn")
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

            if (createError) {
              // Concurrent approval race condition protection:
              // If another worker just inserted this student, fetch and reuse their student ID
              if (
                createError.code === "23505" ||
                createError.message?.toLowerCase().includes("unique") ||
                createError.message?.toLowerCase().includes("duplicate")
              ) {
                const { data: retryStudent } = await supabase
                  .from("students")
                  .select("id, first_name, last_name")
                  .eq("lrn", identityEval.normalizedLrn)
                  .maybeSingle();
                if (retryStudent?.id) {
                  studentId = retryStudent.id;
                } else {
                  return { error: `Failed to create verified student record: ${createError?.message}` };
                }
              } else {
                return { error: `Failed to create verified student record: ${createError?.message}` };
              }
            } else if (newStudent?.id) {
              studentId = newStudent.id;
            }
          }
        }

        if (studentId && studentId !== doc.student_id) {
          await supabase
            .from("documents")
            .update({ student_id: studentId })
            .eq("id", documentId);
        }
      } else if (isRosterDoc) {
        // Roster documents (SF1, SF2, SF5) MUST have student_id = NULL on documents table
        studentId = null;
      }

      // 3.4 Grade Comparison & Controlled Update Tracking (Phase 4)
      if (studentId && Array.isArray(extractedFields.grades) && extractedFields.grades.length > 0) {
        try {
          const { data: existingSubjectGrades } = await supabase
            .from("subject_grades")
            .select("*")
            .eq("student_id", studentId);

          if (existingSubjectGrades && existingSubjectGrades.length > 0) {
            const comparison = compareScannedGradesWithExisting({
              existingGrades: existingSubjectGrades,
              scannedGrades: extractedFields.grades,
              schoolYear: schoolYear,
              semester: extractedFields.semester || "1st Semester",
              studentId,
            });

            // For each proposed update, insert audit log in grade_change_history & update active row
            for (const item of comparison.subjects) {
              if (item.status === "PROPOSED_UPDATE" && item.existingId) {
                for (const diff of item.quarterDiffs) {
                  if (diff.hasChange && diff.isOverwritable && diff.scannedValue !== null) {
                    await (supabase as any).from("grade_change_history").insert({
                      student_id: studentId,
                      subject_grade_id: item.existingId,
                      document_id: documentId,
                      school_year: item.schoolYear,
                      semester: item.semester,
                      grade_level: extractedFields.grade_level || "Grade 11",
                      subject: item.subject,
                      quarter: diff.quarter,
                      previous_value: diff.existingValue,
                      new_value: diff.scannedValue,
                      reason: comment || "Approved grade update via document review",
                      changed_by: user.id,
                    });
                  }
                }

                // Update the active subject_grades record directly
                const updatePayloadGrade: any = {
                  q1: item.scannedGrades.q1 ?? item.existingGrades?.q1 ?? null,
                  q2: item.scannedGrades.q2 ?? item.existingGrades?.q2 ?? null,
                  q3: item.scannedGrades.q3 ?? item.existingGrades?.q3 ?? null,
                  q4: item.scannedGrades.q4 ?? item.existingGrades?.q4 ?? null,
                  final_grade: item.proposedFinalGrade ?? item.existingGrades?.final ?? null,
                  status: item.proposedStatus ?? "Needs Verification",
                  needs_verification: item.proposedStatus === "Needs Verification",
                  document_id: documentId,
                  updated_at: new Date().toISOString(),
                };
                await supabase
                  .from("subject_grades")
                  .update(updatePayloadGrade)
                  .eq("id", item.existingId);
              }
            }

            extractedFields.grade_comparison = comparison;
          }
        } catch (gchErr) {
          console.warn("Notice: Grade change history recording deferred:", gchErr);
        }
      }
    }

    const newStatus = action === "approve" ? "approved" : "rejected";
    const operationId = crypto.randomUUID();

    // 3. Update document status & ensure normalized grades for approval trigger
    const updatePayload: any = { 
      status: newStatus,
      reviewed_by: user.id,
      last_operation_id: operationId,
    };
    if (action === "approve") {
      let needsExtractedUpdate = false;
      if (Array.isArray(extractedFields.grades)) {
        extractedFields.grades = normalizeGradeRecords(extractedFields.grades);
        Object.assign(extractedFields, updateExtractedFieldsAverages(extractedFields));
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

    // 3.0 Synchronize SHS Roster and PSA Child Entries upon document approval/rejection
    if (isRosterDoc) {
      if (action === "approve") {
        if (doc.document_type === "sf1") {
          await (supabase as any).from("sf1_roster_entries").update({ review_status: "VERIFIED" }).eq("document_id", documentId).neq("review_status", "FLAGGED");
        } else if (doc.document_type === "sf2") {
          await (supabase as any).from("sf2_attendance_entries").update({ review_status: "VERIFIED" }).eq("document_id", documentId).neq("review_status", "FLAGGED");
        } else if (doc.document_type === "sf5") {
          await (supabase as any).from("sf5_promotion_entries").update({ review_status: "VERIFIED" }).eq("document_id", documentId).neq("review_status", "FLAGGED");
        }
      } else {
        if (doc.document_type === "sf1") {
          await (supabase as any).from("sf1_roster_entries").update({ review_status: "FLAGGED" }).eq("document_id", documentId);
        } else if (doc.document_type === "sf2") {
          await (supabase as any).from("sf2_attendance_entries").update({ review_status: "FLAGGED" }).eq("document_id", documentId);
        } else if (doc.document_type === "sf5") {
          await (supabase as any).from("sf5_promotion_entries").update({ review_status: "FLAGGED" }).eq("document_id", documentId);
        }
      }
    } else if (isPsaDoc) {
      const childStatus = action === "approve" ? "VERIFIED" : "FLAGGED";
      await (supabase as any).from("psa_identity_records").update({
        verification_status: childStatus,
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      }).eq("document_id", documentId);
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

    // 5. Record structured administrative audit log
    await logAuditEvent({
      requestId: operationId,
      category: "REVIEW",
      action: action === "approve" ? "REVIEW_APPROVED" : "REVIEW_REJECTED",
      outcome: "SUCCESS",
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: roleRow?.role || "teacher",
      targetType: "document",
      targetId: documentId,
      targetLabel: `${(doc.document_type || "Document").toUpperCase()} #${documentId.slice(0, 8)}`,
      reason: comment || (action === "approve" ? "Approved by reviewer" : "Rejected by reviewer"),
      details: {
        previous_status: doc.status,
        new_status: newStatus,
        document_type: doc.document_type,
        student_id: studentId || doc.student_id,
      },
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
      .select("id, status, extracted_fields, student_id, school_id, uploaded_by, ocr_confidence, document_type, teacher_assignment_id, school_year, grade_level, section")
      .eq("id", documentId)
      .single();

    if (fetchError || !doc) {
      return { error: fetchError?.message || "Document not found." };
    }

    // Role-based authorization guard:
    // Advisers can review/edit assigned class docs; Subject Teachers are restricted to authorized subjects
    if (role === "teacher") {
      const { authorizeTeacherDocumentEdit } = await import("@/lib/teacher/serverAuth");
      const editAuth = await authorizeTeacherDocumentEdit({
        supabase,
        userId: user.id,
        doc: doc as any,
        nextExtractedFields: updatedFields,
      });
      if (!editAuth.allowed) {
        return { error: editAuth.error || "Forbidden: You are not authorized to edit this document." };
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
      Object.assign(mergedFields, updateExtractedFieldsAverages(mergedFields));
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

    // FIX 4: Server-side validation and stamping of Observed Values correction metadata
    if (mergedFields.observed_values && typeof mergedFields.observed_values === "object") {
      const ov = mergedFields.observed_values;
      const currentOv = currentFields.observed_values;
      const serverTimestamp = new Date().toISOString();

      const prevObsMap = new Map<string, any>();
      if (currentOv && Array.isArray(currentOv.observations)) {
        for (const p of currentOv.observations) {
          const key = `${p.behavior_statement}::${p.quarter}`;
          prevObsMap.set(key, p);
        }
      }

      if (Array.isArray(ov.observations)) {
        for (const o of ov.observations) {
          const key = `${o.behavior_statement}::${o.quarter}`;
          const prevObs = prevObsMap.get(key);

          // Preserve original OCR mark and provenance from database if it existed
          if (prevObs && prevObs.original_mark !== undefined && prevObs.original_mark !== null) {
            o.original_mark = prevObs.original_mark;
            if (prevObs.ocr_confidence !== undefined) o.ocr_confidence = prevObs.ocr_confidence;
            if (prevObs.bounding_box !== undefined) o.bounding_box = prevObs.bounding_box;
            if (prevObs.location !== undefined) o.location = prevObs.location;
            if (prevObs.source_page !== undefined) o.source_page = prevObs.source_page;
          }

          const ratingChanged = prevObs
            ? o.normalized_rating !== prevObs.normalized_rating || o.teacher_correction !== prevObs.teacher_correction
            : Boolean(o.teacher_correction || o.verification_status === "corrected");

          if (ratingChanged) {
            // Observation was genuinely modified in this operation: stamp with server user ID and timestamp
            o.teacher_corrected_by = user.id;
            o.teacher_corrected_at = serverTimestamp;
            if (o.normalized_rating) {
              o.verification_status = "corrected";
              o.needs_verification = false;
            }
          } else if (prevObs && prevObs.teacher_corrected_by) {
            // Untouched in this save, but was previously corrected: retain prior authoritative server metadata
            o.teacher_corrected_by = prevObs.teacher_corrected_by;
            o.teacher_corrected_at = prevObs.teacher_corrected_at;
          } else {
            // Untouched and uncorrected: remove any forged client-supplied correction metadata
            delete o.teacher_corrected_by;
            delete o.teacher_corrected_at;
          }
        }
      }

      // Synchronize statement-level quarterly records with the authoritative observations
      if (Array.isArray(ov.statements)) {
        for (const stmt of ov.statements) {
          const qKeys = ["q1", "q2", "q3", "q4"] as const;
          for (const qk of qKeys) {
            const qRec = stmt[qk];
            if (!qRec) continue;
            const qUpper = qk.toUpperCase() as "Q1" | "Q2" | "Q3" | "Q4";
            const obs = (ov.observations || []).find(
              (o: any) => o.behavior_statement === stmt.statement && o.quarter === qUpper
            );
            if (obs) {
              qRec.original_mark = obs.original_mark;
              qRec.normalized_rating = obs.normalized_rating;
              qRec.needs_verification = obs.needs_verification;
              qRec.verification_status = obs.verification_status;
              if (obs.teacher_corrected_by) {
                qRec.corrected_by = obs.teacher_corrected_by;
                qRec.corrected_at = obs.teacher_corrected_at;
                qRec.corrected_mark = obs.normalized_rating || undefined;
              } else {
                delete qRec.corrected_by;
                delete qRec.corrected_at;
              }
            }
          }
        }
      }

      // Refresh Observed Values verification flags upon correction
      const anyUnreadable = (ov.observations || []).some((o: any) => o.needs_verification);
      ov.has_unreadable_marks = anyUnreadable;
      ov.flagged_for_verification = anyUnreadable;
    }

    // Re-evaluate validation report using document's recorded OCR confidence
    const docConfidence = typeof (doc as any)?.ocr_confidence === "number" ? (doc as any).ocr_confidence : undefined;
    const validationReport = validateFields(mergedFields, { ocrConfidence: docConfidence });
    const newStatus = doc.status === "approved" || doc.status === "rejected"
      ? doc.status
      : validationReport.status === "valid" ? "validated" : "needs_review";

    // Evaluate learner identity metadata on corrections without directly altering protected student_id
    const isRosterDoc = ["sf1", "sf2", "sf5"].includes(doc.document_type);
    if (!isRosterDoc) {
      const identityEval = evaluateStudentIdentity(mergedFields);
      if (identityEval.isValidLrn && identityEval.normalizedLrn) {
        const { data: matchedStudent } = await supabase
          .from("students")
          .select("id, first_name, last_name, school_id")
          .eq("lrn", identityEval.normalizedLrn)
          .maybeSingle();

        if (matchedStudent?.id) {
          const collision = verifyStudentCollision(identityEval.lastName, matchedStudent);
          if (!collision.hasConflict) {
            mergedFields.matched_candidate_student_id = matchedStudent.id;
            mergedFields.matched_candidate_student_name = `${matchedStudent.last_name}, ${matchedStudent.first_name}`;
            if (doc.student_id !== matchedStudent.id) {
              mergedFields.identity_link_pending = true;
              mergedFields.identity_review_needed = true;
              mergedFields.identity_conflict_details = {
                reason: `Matched registered student ${matchedStudent.last_name}, ${matchedStudent.first_name} (LRN: ${identityEval.normalizedLrn}). Formal student linking requires authorized identity resolution workflow.`,
                matched_student_id: matchedStudent.id,
              };
            }
          } else {
            mergedFields.identity_conflict = true;
            mergedFields.identity_conflict_details = {
              reason: `LRN ${identityEval.normalizedLrn} is registered to ${matchedStudent.last_name}, ${matchedStudent.first_name}, which conflicts with corrected name '${identityEval.lastName}'. Manual LRN verification required.`,
              matched_student_id: matchedStudent.id,
            };
          }
        } else if (!doc.student_id) {
          mergedFields.unregistered_learner = true;
        }
      }
    }

    const operationId = crypto.randomUUID();

    // Update document record without modifying protected student_id column directly
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        extracted_fields: mergedFields,
        status: newStatus,
        reviewed_by: user.id,
        last_operation_id: operationId,
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

    // Administrative audit logging for grade correction
    await logAuditEvent({
      requestId: operationId,
      category: "ACADEMIC",
      action: "GRADE_CORRECTED",
      outcome: "SUCCESS",
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: roleRow?.role || "teacher",
      targetType: "document",
      targetId: documentId,
      targetLabel: `${(doc.document_type || "Document").toUpperCase()} #${documentId.slice(0, 8)}`,
      reason: comment || "Manual grade correction saved by reviewer",
      details: {
        previous_status: doc.status,
        new_status: newStatus,
        corrections: updatedFields,
      },
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

/**
 * Individually update the review status of a roster entry (SF1, SF2, SF5)
 */
export async function updateRosterEntryReviewStatus(
  documentType: "sf1" | "sf2" | "sf5",
  entryId: string,
  reviewStatus: "VERIFIED" | "FLAGGED" | "PENDING",
  flagReason?: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthorized: Please log in." };

    const table = documentType === "sf1" ? "sf1_roster_entries" : documentType === "sf2" ? "sf2_attendance_entries" : "sf5_promotion_entries";
    const updatePayload: any = { review_status: reviewStatus, updated_at: new Date().toISOString() };
    if (flagReason) {
      updatePayload.flag_reasons = [flagReason];
    }
    const { error } = await (supabase as any).from(table).update(updatePayload).eq("id", entryId);
    if (error) return { error: error.message };
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to update roster entry status." };
  }
}

/**
 * Individually verify or flag a PSA Certificate of Live Birth civil identity record
 */
export async function verifyPsaIdentityRecord(
  psaRecordId: string,
  status: "VERIFIED" | "FLAGGED",
  notes?: string
): Promise<{ success?: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthorized: Please log in." };

    const { error } = await (supabase as any).from("psa_identity_records").update({
      verification_status: status,
      verification_notes: notes || null,
      verified_by: user.id,
      verified_at: new Date().toISOString(),
    }).eq("id", psaRecordId);

    if (error) return { error: error.message };
    return { success: true };
  } catch (err: any) {
    return { error: err.message || "Failed to verify PSA record." };
  }
}

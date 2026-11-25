import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizeLrn, isValidLrn } from '@/lib/validation/patterns';
import { compareScannedGradesWithExisting } from '@/lib/validation/gradeComparator';
import { verifyStudentCollision } from '@/lib/validation/studentMatcher';
import { logAuditEvent } from '@/lib/audit/auditLogger';
import {
  normalizeGradeLevelKey,
  normalizeSchoolYearKey,
  normalizeSectionKey,
} from '@/lib/teacher/assignments';
import {
  normalizeGradeRecords,
  recalculateSubjectGradeStatus,
  updateExtractedFieldsAverages,
} from '@/lib/validation/gradeUtils';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in to view documents." }, { status: 401 });
    }

    const { id } = await props.params;

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const currentUserRole = String(roleRow?.role || user?.user_metadata?.role || "teacher").toLowerCase().trim();
    if (currentUserRole === "admin" || currentUserRole === "administrator") {
      return NextResponse.json(
        {
          error: "Forbidden: Administrator role cannot access document records. Documents module has been removed from Admin experience.",
          code: "ADMIN_DOCUMENTS_REMOVED",
        },
        { status: 403 }
      );
    }
    const canApprove = currentUserRole === "admin";

    const { data, error } = await supabase
      .from('documents')
      .select('*, validation_results(*), review_logs(*)')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Document not found" }, { status: 404 });
    }

    const refreshSignedUrl = async (urlOrPath: string | undefined | null): Promise<string | undefined> => {
      if (!urlOrPath || typeof urlOrPath !== "string" || urlOrPath.startsWith("data:") || urlOrPath.startsWith("uploaded-")) {
        return urlOrPath || undefined;
      }
      try {
        let storagePath = "";
        if (urlOrPath.includes("/documents/")) {
          storagePath = urlOrPath.split("/documents/")[1].split("?")[0];
        } else if (!urlOrPath.startsWith("http")) {
          storagePath = urlOrPath;
        }
        if (storagePath) {
          const { data: signed } = await supabase.storage
            .from("documents")
            .createSignedUrl(storagePath, 3600); // 1 hour
          if (signed?.signedUrl) {
            return signed.signedUrl;
          }
        }
      } catch {
        // Retain original URL if signing cannot be completed
      }
      return urlOrPath;
    };

    if (data?.image_url) {
      data.image_url = (await refreshSignedUrl(data.image_url)) || data.image_url;
    }

    if (data?.extracted_fields && typeof data.extracted_fields === "object") {
      const ef = data.extracted_fields as Record<string, any>;
      for (const key of ["back_image_url", "original_image_url", "full_corrected_image_url", "identity_crop_image_url"]) {
        if (typeof ef[key] === "string" && ef[key]) {
          ef[key] = await refreshSignedUrl(ef[key]);
        }
      }
      const scanLists = [ef.scan_history, ef.scan_evidence_history];
      for (const list of scanLists) {
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && typeof item === "object") {
              if (item.image_url) item.image_url = await refreshSignedUrl(item.image_url);
              if (item.back_image_url) item.back_image_url = await refreshSignedUrl(item.back_image_url);
            }
          }
        }
      }
      if (Array.isArray(ef.grades) && ef.grades.length > 0) {
        ef.grades = normalizeGradeRecords(ef.grades, ef.semester || data.semester);
        Object.assign(ef, updateExtractedFieldsAverages(ef));
      }
    }

    // Resolve student identity and active academic grades for controlled deduplication and review
    let matchedStudent: any = null;
    let existingGrades: any[] = [];
    let gradeChangeHistory: any[] = [];
    let gradeComparison: any = null;

    let targetStudentId = data?.student_id;
    const efData = (data?.extracted_fields || {}) as any;
    const rawLrn = efData.lrn || efData.learner_reference_number;
    const cleanLrn = normalizeLrn(rawLrn ? String(rawLrn) : "");
    const hasUnresolvedConflict =
      (efData.identity_conflict === true || efData.manual_lrn_verification_required === true) &&
      efData.lrn_conflict_verified !== true;

    const extractedLastName =
      efData.last_name ||
      efData.student?.last_name ||
      (typeof efData.name === "string" && efData.name.includes(",")
        ? efData.name.split(",")[0].trim()
        : null);

    if (!targetStudentId && isValidLrn(cleanLrn) && !hasUnresolvedConflict) {
      const { data: stRow } = await supabase
        .from('students')
        .select('*')
        .eq('lrn', cleanLrn)
        .maybeSingle();
      if (stRow?.id) {
        const collisionCheck = extractedLastName
          ? verifyStudentCollision(extractedLastName, stRow)
          : { hasConflict: false };
        if (!collisionCheck.hasConflict) {
          targetStudentId = stRow.id;
          matchedStudent = stRow;
        }
      }
    } else if (targetStudentId) {
      const { data: stRow } = await supabase
        .from('students')
        .select('*')
        .eq('id', targetStudentId)
        .maybeSingle();
      if (stRow) {
        const collisionCheck =
          !efData.lrn_conflict_verified && extractedLastName
            ? verifyStudentCollision(extractedLastName, stRow)
            : { hasConflict: false };
        if (!collisionCheck.hasConflict && !hasUnresolvedConflict) {
          matchedStudent = stRow;
        } else {
          targetStudentId = null;
        }
      }
    }

    if (targetStudentId) {
      const { data: sgRows } = await supabase
        .from('subject_grades')
        .select('*')
        .eq('student_id', targetStudentId);
      existingGrades = (sgRows || []).map((g: any) => {
        const rec = {
          subject: g.subject,
          semester: g.semester,
          q1: g.q1,
          q2: g.q2,
          q3: g.q3,
          q4: g.q4,
          final: g.final_grade,
          sem1_final_grade: g.semester?.includes("1st") ? g.final_grade : undefined,
          sem2_final_grade: g.semester?.includes("2nd") ? g.final_grade : undefined,
          status: g.status,
        };
        const norm = recalculateSubjectGradeStatus(rec as any, g.semester);
        return {
          ...g,
          final_grade: norm.final ?? g.final_grade,
          status: norm.status ?? g.status,
          raw_calculated_final: norm.raw_calculated_final,
          computed_final_grade: norm.computed_final_grade,
        };
      });

      try {
        const { data: gchRows } = await (supabase as any)
          .from('grade_change_history')
          .select('*')
          .eq('student_id', targetStudentId)
          .order('created_at', { ascending: false });
        gradeChangeHistory = gchRows || [];
      } catch {
        // Migration 015 table might not yet be applied
      }

      if (Array.isArray(efData.grades)) {
        gradeComparison = compareScannedGradesWithExisting({
          existingGrades,
          scannedGrades: efData.grades,
          schoolYear: data?.school_year || efData.school_year,
          semester: data?.semester || efData.semester,
          studentId: targetStudentId,
        });
      }
    }

    let rosterEntries: any[] = [];
    let psaRecord: any = null;

    try {
      if (data?.document_type === 'sf1') {
        const { data: sf1Rows } = await (supabase as any)
          .from('sf1_roster_entries')
          .select('*')
          .eq('document_id', id)
          .order('last_name', { ascending: true });
        rosterEntries = sf1Rows || [];
        if (rosterEntries.length === 0) {
          const ef = data?.extracted_fields as any;
          if (Array.isArray(ef?.attendance_records) && ef.attendance_records.length > 0) {
            rosterEntries = ef.attendance_records;
          } else if (Array.isArray(ef?.learners)) {
            rosterEntries = ef.learners;
          }
        }
      } else if (data?.document_type === 'sf2') {
        const { data: sf2Rows } = await (supabase as any)
          .from('sf2_attendance_entries')
          .select('*')
          .eq('document_id', id)
          .order('learner_name', { ascending: true });
        rosterEntries = sf2Rows || [];
        if (rosterEntries.length === 0) {
          const ef = data?.extracted_fields as any;
          if (Array.isArray(ef?.attendance_records) && ef.attendance_records.length > 0) {
            rosterEntries = ef.attendance_records;
          } else if (Array.isArray(ef?.learners)) {
            rosterEntries = ef.learners;
          }
        }
      } else if (data?.document_type === 'sf5') {
        const { data: sf5Rows } = await (supabase as any)
          .from('sf5_promotion_entries')
          .select('*')
          .eq('document_id', id)
          .order('learner_name', { ascending: true });
        rosterEntries = sf5Rows || [];
        if (rosterEntries.length === 0) {
          const ef = data?.extracted_fields as any;
          if (Array.isArray(ef?.attendance_records) && ef.attendance_records.length > 0) {
            rosterEntries = ef.attendance_records;
          } else if (Array.isArray(ef?.learners)) {
            rosterEntries = ef.learners;
          }
        }
      } else if (data?.document_type === 'birth_cert') {
        const { data: psaRows } = await (supabase as any)
          .from('psa_identity_records')
          .select('*')
          .eq('document_id', id)
          .maybeSingle();
        psaRecord = psaRows || null;
        if (!psaRecord && (data?.extracted_fields as any)?.identity) {
          psaRecord = {
            document_id: id,
            ...(data.extracted_fields as any).identity,
          };
        }
      }
    } catch (childErr) {
      console.warn("Notice: child entries query deferred:", childErr);
    }

    const responsePayload = {
      ...data,
      current_user_role: currentUserRole,
      can_approve: canApprove,
      matched_student: matchedStudent,
      existing_grades: existingGrades,
      grade_change_history: gradeChangeHistory,
      grade_comparison: gradeComparison,
      roster_entries: rosterEntries,
      psa_record: psaRecord,
    };

    return NextResponse.json({
      document: responsePayload,
      ...responsePayload,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const body: import('@/lib/supabase/types').Database['public']['Tables']['documents']['Update'] = await request.json();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in to update documents." }, { status: 401 });
    }

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role, account_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleData || roleData.account_status !== "Approved") {
      return NextResponse.json(
        { error: "Forbidden: Account is pending administrator approval." },
        { status: 403 }
      );
    }

    if (body.status === "approved" || body.status === "rejected") {
      if (roleData.role !== "admin" && roleData.role !== "principal") {
        return NextResponse.json(
          { error: "Forbidden: Only an approved Principal or Admin can approve or reject documents." },
          { status: 403 }
        );
      }
    }

    // Prevent unauthorized modification of school foreign key
    if ('school_id' in body) {
      delete (body as any).school_id;
    }

    // Admin and Principal cannot upload or overwrite scanned document images
    if (roleData.role === "admin" || roleData.role === "principal") {
      if ('image_url' in body || 'file_hash' in body) {
        return NextResponse.json(
          {
            error: "Forbidden: Admin and Principal roles cannot upload or overwrite scanned document images.",
            code: "ADMIN_CANNOT_UPLOAD",
          },
          { status: 403 }
        );
      }
    }

    const { id } = await props.params;

    const { data: existingDoc } = await supabase
      .from('documents')
      .select('id, school_id, student_id, document_type, school_year, grade_level, section, teacher_assignment_id, uploaded_by, status, extracted_fields')
      .eq('id', id)
      .maybeSingle();

    if (existingDoc && String(roleData.role || "").toLowerCase() === "teacher") {
      const { authorizeTeacherDocumentEdit } = await import("@/lib/teacher/serverAuth");
      const editAuth = await authorizeTeacherDocumentEdit({
        supabase,
        userId: user.id,
        doc: existingDoc as any,
        nextExtractedFields: (body.extracted_fields as any) || null,
        nextBody: body as any,
      });
      if (!editAuth.allowed) {
        return NextResponse.json(
          { error: editAuth.error || "Forbidden: You are not authorized to edit this document." },
          { status: 403 }
        );
      }
    }

    if (existingDoc) {
      const prevEf = (existingDoc.extracted_fields || {}) as Record<string, any>;
      const nextEf = (body.extracted_fields
        ? { ...prevEf, ...(body.extracted_fields as Record<string, any>) }
        : prevEf) as Record<string, any>;

      const nextStatus = (body.status ?? existingDoc.status ?? "").toLowerCase();
      const nextDocType = (body.document_type ?? existingDoc.document_type ?? "").toLowerCase();
      const nextSy = String(
        (body as any).school_year ?? nextEf.school_year ?? existingDoc.school_year ?? ""
      ).trim();
      const nextGl = String(
        (body as any).grade_level ?? nextEf.grade_level ?? nextEf.selected_grade_level ?? existingDoc.grade_level ?? ""
      ).trim();
      const nextStudentId =
        body.student_id !== undefined ? body.student_id : existingDoc.student_id;

      // 1. Enforce manual LRN verification for identity collision documents (e.g., Kenneth Latonero collision)
      const hasConflictFlag =
        nextEf.identity_conflict === true ||
        nextEf.manual_lrn_verification_required === true;
      const isConflictVerified = nextEf.lrn_conflict_verified === true;

      if (hasConflictFlag && !isConflictVerified && (nextStatus === "approved" || body.student_id)) {
        return NextResponse.json(
          {
            error:
              "Conflict: Manual LRN verification (lrn_conflict_verified = true) is required before approving or linking a document with an LRN identity collision.",
            code: "MANUAL_LRN_VERIFICATION_REQUIRED",
          },
          { status: 409 }
        );
      }

      // Verify against live student registry if approving or linking a student_id
      const candidateLrn = normalizeLrn(
        String(nextEf.lrn || nextEf.student?.lrn || nextEf.learner_reference_number || "")
      );
      const extractedLastName =
        nextEf.last_name ||
        nextEf.student?.last_name ||
        (typeof nextEf.name === "string" && nextEf.name.includes(",")
          ? nextEf.name.split(",")[0].trim()
          : null);

      if ((nextStatus === "approved" || nextStudentId) && isValidLrn(candidateLrn) && extractedLastName) {
        const { data: lrnStudent } = await supabase
          .from("students")
          .select("id, first_name, last_name, lrn")
          .eq("lrn", candidateLrn)
          .maybeSingle();

        if (lrnStudent) {
          const coll = verifyStudentCollision(extractedLastName, lrnStudent);
          if (coll.hasConflict && !isConflictVerified) {
            return NextResponse.json(
              {
                error: `Conflict: LRN ${candidateLrn} is registered to ${lrnStudent.last_name}, ${lrnStudent.first_name}, which conflicts with extracted name '${extractedLastName}'. Manual LRN verification is required before approval or student assignment.`,
                code: "IDENTITY_COLLISION_BLOCKED",
              },
              { status: 409 }
            );
          }
        }
      }

      // 2. Enforce non-null canonical identity fields before activating or approving a record
      if (nextStatus === "approved" || (nextStudentId && !["archived", "rejected"].includes(nextStatus))) {
        if (!existingDoc.school_id || !["sf9", "sf10"].includes(nextDocType)) {
          return NextResponse.json(
            {
              error:
                "Validation Error: Canonical school_id and document_type ('sf9' or 'sf10') must be valid before activating or approving an academic record.",
            },
            { status: 400 }
          );
        }
        if (nextDocType === "sf9" && (!nextSy || !nextGl)) {
          return NextResponse.json(
            {
              error:
                "Validation Error: Canonical school_year and grade_level must be non-null before activating or approving an SF9 academic record.",
            },
            { status: 400 }
          );
        }
        if (nextStatus === "approved" && !nextStudentId && !isValidLrn(candidateLrn)) {
          return NextResponse.json(
            {
              error:
                "Validation Error: A verified student_id and valid 12-digit LRN are required before approving an academic record.",
            },
            { status: 400 }
          );
        }
      }

      if (nextSy && !(body as any).school_year) {
        (body as any).school_year = nextSy;
      }
      if (nextGl && !(body as any).grade_level) {
        (body as any).grade_level = nextGl;
      }
    }

    const { data, error } = await supabase
      .from('documents')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Please log in to delete documents." }, { status: 401 });
    }

    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError || !roleRow || !roleRow.role) {
      return NextResponse.json(
        { error: "Forbidden: No authoritative role assigned. Please contact an administrator." },
        { status: 403 }
      );
    }

    if (roleRow.account_status !== "Approved") {
      return NextResponse.json(
        { error: "Forbidden: Account is not approved. Administrator authorization is required." },
        { status: 403 }
      );
    }

    const role = roleRow.role.toLowerCase();
    if (role === "admin" || role === "administrator") {
      return NextResponse.json(
        {
          error: "Forbidden: Administrator role cannot delete student documents. Document deletion is restricted to authorized teachers.",
          code: "ADMIN_CANNOT_DELETE",
        },
        { status: 403 }
      );
    }

    if (role === "principal") {
      return NextResponse.json(
        {
          error: "Forbidden: Principal role is monitoring-only and cannot delete documents.",
          code: "PRINCIPAL_READ_ONLY",
        },
        { status: 403 }
      );
    }

    if (role !== "teacher") {
      return NextResponse.json(
        {
          error: "Forbidden: Only authorized teachers can delete documents.",
          code: "UNAUTHORIZED_ROLE",
        },
        { status: 403 }
      );
    }

    if (!roleRow.school_id) {
      return NextResponse.json(
        {
          error: "Forbidden: Caller school cannot be verified. Teachers must have an assigned school to delete documents.",
          code: "UNVERIFIED_CALLER_SCHOOL",
        },
        { status: 403 }
      );
    }

    const { id } = await props.params;

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, status, student_id, school_id, uploaded_by, document_type, original_filename, extracted_fields, school_year, grade_level, section, teacher_assignment_id")
      .eq("id", id)
      .maybeSingle();

    if (docError || !doc) {
      return NextResponse.json({ error: "Target document not found." }, { status: 404 });
    }

    if (doc.status === "archived") {
      return NextResponse.json({ error: "This document is already archived." }, { status: 400 });
    }

    if (doc.school_id && roleRow.school_id !== doc.school_id) {
      return NextResponse.json(
        { error: "Forbidden: Cannot delete documents belonging to another school." },
        { status: 403 }
      );
    }

    // Teacher assignment and section check
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
      return NextResponse.json(
        {
          error: "Forbidden: Teachers may only delete documents belonging to their officially assigned advisory section.",
          code: "ASSIGNMENT_PARAMETER_MISMATCH",
        },
        { status: 403 }
      );
    }

    const nowIso = new Date().toISOString();

    let confirmationPhrase = "I am deleting this";
    try {
      const body = await request.json();
      if (body?.confirmationPhrase) confirmationPhrase = body.confirmationPhrase;
      if (body?.confirmation_phrase) confirmationPhrase = body.confirmation_phrase;
    } catch {
      // Body is optional in HTTP DELETE
    }

    const { data: rpcData, error: rpcError } = await (supabase as any).rpc("archive_review_document", {
      p_document_id: id,
      p_confirmation_phrase: confirmationPhrase,
    });

    if (rpcError || !rpcData?.success) {
      return NextResponse.json(
        { error: rpcError?.message || "Failed to archive document." },
        { status: 400 }
      );
    }

    // Resolve teacher name
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

    // Automatically record in User Logs (public.audit_logs & in-memory buffer)
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
      reason: `Teacher ${teacherName} archived document (soft deletion)`,
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

    return NextResponse.json({
      success: true,
      document_id: doc.id,
      archived_at: nowIso,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

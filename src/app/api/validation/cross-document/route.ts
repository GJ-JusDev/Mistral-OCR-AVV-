import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  compareSectionSf1AndSf2,
} from "@/lib/validation/crossDocumentEngine";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import {
  evaluateStudentValidation,
  fetchLegacySf1Sf2Entries,
  fetchPersistedStudentValidation,
  fetchStudentValidationRecords,
  getPersistenceFailureResponse,
  persistStudentValidation,
} from "@/lib/validation/studentCrossDocumentValidation";
import {
  normalizeGradeLevelKey,
  normalizeSectionKey,
  normalizeSchoolYearKey,
} from "@/lib/teacher/assignments";

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

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");
    const schoolYear = searchParams.get("schoolYear");
    const gradeLevel = searchParams.get("gradeLevel");

    if (!studentId) {
      return NextResponse.json({ error: "studentId query parameter is required" }, { status: 400 });
    }

    try {
      const response = await fetchPersistedStudentValidation(
        supabase,
        studentId,
        schoolYear,
        gradeLevel ? normalizeGradeLevelKey(gradeLevel) : null
      );
      return NextResponse.json(response);
    } catch (error: any) {
      return NextResponse.json({ error: error.message || "Failed to fetch validations" }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch validations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError) {
      console.error("[api/validation/cross-document] Role lookup failed:", roleError.message);
      return NextResponse.json({ error: "Failed to verify account authorization." }, { status: 500 });
    }

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json({ error: "Forbidden: Account not approved." }, { status: 403 });
    }

    const body = await request.json();

    // ── SECTION-LEVEL SF1 ↔ SF2 BATCH CROSS-VALIDATION ───────────────────────
    if (body.type === "SF1_SF2" || (body.sf1DocumentId && body.sf2DocumentId)) {
      const { sf1DocumentId, sf2DocumentId } = body;

      const { sf1Entries, sf2Entries } = await fetchLegacySf1Sf2Entries(
        supabase,
        sf1DocumentId,
        sf2DocumentId
      );

      const validation = compareSectionSf1AndSf2(sf1Entries, sf2Entries);

      await logAuditEvent({
        category: "COMPARISON",
        action: validation.status === "MATCH" ? "COMPARISON_COMPLETED" : "COMPARISON_DISCREPANCY_FLAGGED",
        outcome: validation.status === "MATCH" ? "SUCCESS" : "WARNING",
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: roleRow.role,
        actorSchoolId: roleRow.school_id,
        targetType: "document",
        targetId: sf1DocumentId,
        details: {
          validation_type: "SF1_SF2",
          status: validation.status,
          total_sf1: validation.totalSf1Learners,
          total_sf2: validation.totalSf2Learners,
          matched: validation.matchedCount,
          missing_in_sf2: validation.missingInSf2Count,
          missing_in_sf1: validation.missingInSf1Count,
          discrepancy_count: validation.discrepancyCount,
        },
      });

      return NextResponse.json({
        success: true,
        validation,
      });
    }

    const { studentId, schoolYear: requestedSchoolYear } = body;

    if (!studentId) {
      return NextResponse.json({ error: "studentId (or sf1DocumentId and sf2DocumentId) is required" }, { status: 400 });
    }

    // 1. Fetch student
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id, lrn, first_name, middle_name, last_name, suffix, grade_level, school_id")
      .eq("id", studentId)
      .single();

    if (studentError || !student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const schoolId = student.school_id || roleRow.school_id;
    if (!schoolId || (roleRow.school_id && roleRow.school_id !== schoolId && roleRow.role !== "admin")) {
      return NextResponse.json({ error: "Forbidden: Student is outside your authorized school." }, { status: 403 });
    }

    const enrollmentResult = await (supabase as any)
      .from("student_enrollments")
      .select("school_year, grade_level, section, strand_or_track, is_current, enrollment_status")
      .eq("student_id", studentId)
      .eq("school_id", schoolId)
      .order("is_current", { ascending: false })
      .order("updated_at", { ascending: false });
    if (enrollmentResult.error) {
      throw new Error(`Failed to retrieve learner enrollment context: ${enrollmentResult.error.message}`);
    }
    const enrollmentRows = enrollmentResult.data || [];
    const requestedYearKey = normalizeSchoolYearKey(requestedSchoolYear);
    const requestedGradeLevel = normalizeGradeLevelKey(body.gradeLevel);
    const requestedSectionKey = normalizeSectionKey(body.section);
    const enrollment = enrollmentRows.find((row: any) =>
      requestedYearKey
        ? normalizeSchoolYearKey(row.school_year) === requestedYearKey &&
          (!requestedGradeLevel || normalizeGradeLevelKey(row.grade_level) === requestedGradeLevel) &&
          (!requestedSectionKey || normalizeSectionKey(row.section) === requestedSectionKey)
        : row.is_current === true && row.enrollment_status === "active"
    );
    const schoolYear = enrollment?.school_year || requestedSchoolYear;
    if (!schoolYear) {
      return NextResponse.json(
        { error: "A school year is required when the learner has no active enrollment context." },
        { status: 400 }
      );
    }
    const gradeLevel = normalizeGradeLevelKey(enrollment?.grade_level || requestedGradeLevel || student.grade_level);
    if (gradeLevel !== "Grade 11" && gradeLevel !== "Grade 12") {
      return NextResponse.json({ error: "A valid Grade 11 or Grade 12 context is required." }, { status: 400 });
    }
    const section = enrollment?.section || body.section || null;

    if (String(roleRow.role || "").toLowerCase() === "teacher") {
      const { data: assignments, error: assignmentError } = await (supabase as any)
        .from("teacher_assignments")
        .select("school_year, grade_level, section, assignment_type, assignment_status")
        .eq("teacher_user_id", user.id)
        .eq("school_id", schoolId)
        .eq("assignment_status", "active");
      if (assignmentError) {
        throw new Error(`Failed to verify teacher assignment: ${assignmentError.message}`);
      }
      const hasAdvisoryAssignment = (assignments || []).some((assignment: any) =>
        assignment.assignment_type === "class_adviser" &&
        normalizeSchoolYearKey(assignment.school_year) === normalizeSchoolYearKey(schoolYear) &&
        normalizeGradeLevelKey(assignment.grade_level) === gradeLevel &&
        normalizeSectionKey(assignment.section) === normalizeSectionKey(section)
      );
      if (!hasAdvisoryAssignment) {
        return NextResponse.json(
          { error: "Forbidden: An active class adviser assignment for this learner context is required." },
          { status: 403 }
        );
      }
    }

    const context = {
      studentId,
      lrn: student.lrn || "",
      schoolId,
      schoolYear: String(schoolYear),
      gradeLevel,
      fullName: [student.first_name, student.middle_name, student.last_name, student.suffix].filter(Boolean).join(" "),
      section,
      trackStrand: enrollment?.strand_or_track || null,
    } as const;
    const records = await fetchStudentValidationRecords(supabase, context);
    const evaluation = evaluateStudentValidation(context, records);

    // Migration 026 revokes authenticated direct writes; use only the verified service-role client.
    const privilegedDb = createVerifiedServerPrivilegedClient(supabase);
    let persistedValidations;
    try {
      persistedValidations = await persistStudentValidation(privilegedDb, context, evaluation);
    } catch (persistenceError: any) {
      const message = persistenceError?.message || "Cross-document validation persistence failed.";
      console.error("[api/validation/cross-document] Persistence failed:", message);
      try {
        await logAuditEvent({
          category: "COMPARISON",
          action: "COMPARISON_DISCREPANCY_FLAGGED",
          outcome: "FAILURE",
          actorUserId: user.id,
          actorEmail: user.email,
          actorRole: roleRow.role,
          actorSchoolId: schoolId,
          targetType: "student",
          targetId: studentId,
          details: {
            schoolYear: context.schoolYear,
            lrn: context.lrn,
            persistence_failed: true,
            error: message,
          },
        });
      } catch (auditError) {
        console.error("[api/validation/cross-document] Persistence failure audit could not be recorded:", auditError);
      }
      const failureResponse = getPersistenceFailureResponse(persistenceError);
      return NextResponse.json(failureResponse.body, { status: failureResponse.status });
    }

    await logAuditEvent({
      category: "COMPARISON",
      action: evaluation.unifiedResult.overallStatus === "MATCH" ? "COMPARISON_COMPLETED" : "COMPARISON_DISCREPANCY_FLAGGED",
      outcome: evaluation.unifiedResult.overallStatus === "MATCH" ? "SUCCESS" : "WARNING",
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: roleRow.role,
      actorSchoolId: schoolId,
      targetType: "student",
      targetId: studentId,
      details: {
        status: evaluation.unifiedResult.overallStatus,
        criticalDiscrepancies: evaluation.unifiedResult.discrepancies.filter((d) => d.severity === "CRITICAL").length,
        totalFieldsCompared: evaluation.unifiedResult.fieldsMatrix.length,
        pairwiseCount: evaluation.pairwiseResults.length,
        sourceDocumentIds: evaluation.sourceDocumentIds,
      },
    });

    const consolidatedRecord = persistedValidations.find((row: any) => row.validation_type === "CONSOLIDATED_SHS") || null;
    const persistedMatrix = Array.isArray(consolidatedRecord?.comparison_results)
      ? consolidatedRecord.comparison_results
      : evaluation.unifiedResult.fieldsMatrix;
    const persistedDiscrepancies = Array.isArray(consolidatedRecord?.discrepancy_details)
      ? consolidatedRecord.discrepancy_details
      : evaluation.unifiedResult.discrepancies;

    return NextResponse.json({
      consolidated: evaluation.consolidated,
      consolidatedRecord,
      matrix: persistedMatrix,
      discrepancies: persistedDiscrepancies,
      pairwiseResults: evaluation.pairwiseResults,
      unifiedResult: evaluation.unifiedResult,
      validations: persistedValidations,
    });
  } catch (err: any) {
    console.error("[api/validation/cross-document] Error:", err);
    return NextResponse.json({ error: err.message || "Cross-document validation execution failed" }, { status: 500 });
  }
}

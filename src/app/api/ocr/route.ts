import { NextResponse } from "next/server";
import { handleOcrRoute } from "@/lib/ocr/mistral";
import { preprocessOcrRequest } from "@/lib/ocr/serverImageCompressor";
import { parseGradesText } from "@/lib/ocr/gradesParser";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import { createClient } from "@/lib/supabase/server";
import type { TeacherAssignmentRecord } from "@/lib/teacher/assignments";
import { evaluateOcrRouteAuthorization } from "@/lib/teacher/serverAuth";
import type { ExtractedFields } from "@/types/documents";

export type OcrResponse = {
  text?: string;
  fields?: ExtractedFields;
  confidence?: number;
  model?: string;
  provider?: string;
  error?: string;
  code?: string;
  retryAfter?: number;
};

export async function POST(request: Request) {
  const startTime = Date.now();
  const apiKey = process.env.MISTRAL_API_KEY;

  let documentType = "sf9";
  let gradeLevel = "Senior High School";
  let requestedAssignmentId: string | null = null;
  let assignmentConfirmed = false;
  let selectedSchoolYear: string | null = null;
  let selectedGradeLevel: string | null = null;
  let selectedSection: string | null = null;
  let selectedStrand: string | null = null;

  try {
    const cloned = request.clone();
    const body = await cloned.json();
    documentType = body.documentType || "sf9";
    gradeLevel = body.gradeLevel || "Senior High School";
    requestedAssignmentId = body.teacherAssignmentId || body.teacher_assignment_id || body.assignmentId || null;
    assignmentConfirmed =
      body.assignmentConfirmed === true ||
      body.assignmentConfirmed === "true" ||
      body.assignment_confirmed === true ||
      body.assignment_confirmed === "true";
    selectedSchoolYear = body.selectedSchoolYear || body.selected_school_year || null;
    selectedGradeLevel = body.selectedGradeLevel || body.selected_grade_level || null;
    selectedSection = body.selectedSection || body.selected_section || null;
    selectedStrand = body.selectedStrand || body.selected_strand || null;
  } catch {
    // Cloned read fallback
  }

  // Server-side RBAC + strict Class Adviser assignment gate before running billable OCR extraction
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: Please log in before scanning documents.", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let assignmentRow: TeacherAssignmentRecord | null = null;
    if (roleRow?.role?.toLowerCase() === "teacher" && requestedAssignmentId) {
      const { data: aData } = await supabase
        .from("teacher_assignments")
        .select("*")
        .eq("id", requestedAssignmentId)
        .maybeSingle();
      assignmentRow = (aData as TeacherAssignmentRecord | null) ?? null;
    }

    const authResult = evaluateOcrRouteAuthorization({
      userId: user.id,
      userRole: roleRow?.role || "",
      accountStatus: roleRow?.account_status || "",
      userSchoolId: roleRow?.school_id || null,
      assignment: assignmentRow,
      assignmentConfirmed,
      selectedSchoolYear,
      selectedGradeLevel,
      selectedSection,
      selectedStrand,
    });

    if (!authResult.allowed) {
      return NextResponse.json(
        { error: authResult.error || "Forbidden: Scanning not permitted.", code: authResult.code },
        { status: authResult.statusCode }
      );
    }
  } catch (authError) {
    console.error("OCR authorization error:", authError);
    return NextResponse.json(
      { error: "Forbidden: Unable to verify scanning authorization.", code: "AUTH_CHECK_FAILED" },
      { status: 403 }
    );
  }

  const processedRequest = await preprocessOcrRequest(request);
  const res = await handleOcrRoute(processedRequest, apiKey, parseGradesText);
  const durationMs = Date.now() - startTime;

  try {
    const resClone = res.clone();
    const data = await resClone.json();

    if (res.ok) {
      await logAuditEvent({
        category: "OCR",
        action: "OCR_PROCESSING_COMPLETED",
        outcome: "SUCCESS",
        targetType: "ocr_job",
        targetLabel: `${documentType.toUpperCase()} OCR Job (${data.provider || "azure"})`,
        reason: `OCR extraction succeeded in ${durationMs}ms`,
        details: {
          provider: data.provider || "azure",
          model: data.model || "azure-layout",
          durationMs,
          documentType,
          confidence: data.confidence,
          hasGrades: Boolean(data.fields?.grades?.length),
          subjectCount: data.fields?.grades?.length || 0,
        },
      });
    } else {
      await logAuditEvent({
        category: "OCR",
        action: "OCR_PROCESSING_FAILED",
        outcome: "FAILURE",
        targetType: "ocr_job",
        targetLabel: `${documentType.toUpperCase()} OCR Job`,
        reason: data.error || `OCR error with status ${res.status}`,
        details: {
          code: data.code,
          status: res.status,
          durationMs,
          documentType,
        },
      });
    }
  } catch {
    // Non-blocking for client response
  }

  return res;
}

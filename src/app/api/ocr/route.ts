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
  let targetStudentName: string | undefined = undefined;
  let targetLrn: string | undefined = undefined;

  try {
    const cloned = request.clone();
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const fd = await cloned.formData();
      documentType = (fd.get("documentType") as string) || (fd.get("docType") as string) || "sf9";
      gradeLevel = (fd.get("gradeLevel") as string) || "Senior High School";
      requestedAssignmentId = (fd.get("teacherAssignmentId") as string) || (fd.get("teacher_assignment_id") as string) || (fd.get("assignmentId") as string) || null;
      const acVal = fd.get("assignmentConfirmed") ?? fd.get("assignment_confirmed");
      assignmentConfirmed = String(acVal).toLowerCase() === "true";
      selectedSchoolYear = (fd.get("selectedSchoolYear") as string) || (fd.get("selected_school_year") as string) || null;
      selectedGradeLevel = (fd.get("selectedGradeLevel") as string) || (fd.get("selected_grade_level") as string) || null;
      selectedSection = (fd.get("selectedSection") as string) || (fd.get("selected_section") as string) || null;
      selectedStrand = (fd.get("selectedStrand") as string) || (fd.get("selected_strand") as string) || null;
      targetStudentName = (fd.get("targetStudentName") as string) || (fd.get("target_student_name") as string) || undefined;
      targetLrn = (fd.get("targetLrn") as string) || (fd.get("target_lrn") as string) || undefined;
    } else {
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
      targetStudentName = body.targetStudentName || body.target_student_name || undefined;
      targetLrn = body.targetLrn || body.target_lrn || undefined;
    }
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

  // Check if processedRequest has multi-page chunks in body.pages
  let bodyJson: any = null;
  try {
    const cloned = processedRequest.clone();
    bodyJson = await cloned.json();
  } catch {
    //
  }

  let res: Response;

  if (bodyJson && Array.isArray(bodyJson.pages) && bodyJson.pages.length > 1) {
    const pageResults = [];
    for (let pIdx = 0; pIdx < bodyJson.pages.length; pIdx++) {
      const pageImage = bodyJson.pages[pIdx];
      const pageReq = new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...bodyJson,
          image: pageImage,
          pages: undefined,
          pageNumber: pIdx + 1,
        }),
      });
      const pageRes = await handleOcrRoute(pageReq, apiKey, parseGradesText);
      if (pageRes.ok) {
        const pData = await pageRes.json();
        pageResults.push(pData);
      }
    }

    if (pageResults.length > 0) {
      // 1. Aggregate learners across ALL pages (flatMap + deduplicate by LRN/name)
      const allLearners = pageResults.flatMap((r) => r.fields?.learners || r.fields?.students || []);
      const seen = new Set<string>();
      const aggregatedLearners: any[] = [];
      for (const l of allLearners) {
        const key = l.lrn || l.full_name || `${l.last_name}, ${l.first_name}`;
        if (key && !seen.has(key)) {
          seen.add(key);
          aggregatedLearners.push(l);
        }
      }

      // 2. Merge header metadata across all pages
      const firstFields = pageResults[0].fields || {};
      const mergedFields: any = {
        ...firstFields,
        learners: aggregatedLearners,
        students: aggregatedLearners,
        total_enrolled_count: aggregatedLearners.length,
        total_male_count: aggregatedLearners.filter((l: any) => l.sex === "M").length,
        total_female_count: aggregatedLearners.filter((l: any) => l.sex === "F").length,
        // Set no_student_found: aggregatedLearners.length === 0 AFTER aggregating all pages
        // so blank continuation pages (Pages 2-3) NEVER overwrite Page 1's student with true
        no_student_found: aggregatedLearners.length === 0,
        error: aggregatedLearners.length === 0 ? "No student found" : undefined,
      };

      for (const p of pageResults) {
        const f = p.fields || {};
        if (f.school_id && (!mergedFields.school_id || mergedFields.school_id === "500169" || f.school_id === "500619")) {
          mergedFields.school_id = f.school_id;
        }
        if (f.school_name && !mergedFields.school_name) {
          mergedFields.school_name = f.school_name;
        }
        if (f.school_year && !mergedFields.school_year) {
          mergedFields.school_year = f.school_year;
        }
        if (f.grade_level && !mergedFields.grade_level) {
          mergedFields.grade_level = f.grade_level;
        }
        if (f.section && !mergedFields.section) {
          mergedFields.section = f.section;
        }
        if (f.track_strand && !mergedFields.track_strand) {
          mergedFields.track_strand = f.track_strand;
        }
      }

      res = NextResponse.json({
        text: pageResults.map((p) => p.text).join("\n\n"),
        model: pageResults[0].model,
        provider: pageResults[0].provider,
        confidence: pageResults[0].confidence,
        fields: mergedFields,
      });
    } else {
      res = await handleOcrRoute(processedRequest, apiKey, parseGradesText);
    }
  } else {
    res = await handleOcrRoute(processedRequest, apiKey, parseGradesText);
  }
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

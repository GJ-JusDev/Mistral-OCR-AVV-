import {
  evaluateTeacherScanAuthorization,
  normalizeGradeLevelKey,
  normalizeSchoolYearKey,
  normalizeSectionKey,
  normalizeStrandKey,
  validateSubjectTeacherGradeEdits,
  type TeacherAssignmentRecord,
} from "./assignments";
import type { ExtractedFields, GradeRecord } from "@/types/documents";

export interface DocumentEditAuthResult {
  allowed: boolean;
  error?: string;
  isClassAdviser: boolean;
  authorizedSubjects: string[];
}

function assignmentMatchesDocContext(
  a: TeacherAssignmentRecord,
  doc: {
    teacher_assignment_id?: string | null;
    school_id?: string | null;
    school_year?: string | null;
    grade_level?: string | null;
    section?: string | null;
    extracted_fields?: any;
  }
): boolean {
  if (doc.school_id && a.school_id !== doc.school_id) return false;
  if (doc.teacher_assignment_id && a.id === doc.teacher_assignment_id) return true;

  const ef = (doc.extracted_fields || {}) as Record<string, any>;
  const docSy = normalizeSchoolYearKey(doc.school_year || ef.school_year);
  const docGl = normalizeGradeLevelKey(doc.grade_level || ef.grade_level || ef.selected_grade_level);
  const docSec = normalizeSectionKey(doc.section || ef.section);

  const aSy = normalizeSchoolYearKey(a.school_year);
  const aGl = normalizeGradeLevelKey(a.grade_level);
  const aSec = normalizeSectionKey(a.section);

  return Boolean(docSec && aSec === docSec && (!docSy || aSy === docSy) && (!docGl || aGl === docGl));
}

function detectNonGradeIdentityChange(
  prevFields: ExtractedFields | null | undefined,
  nextFields: ExtractedFields | null | undefined
): boolean {
  if (!nextFields) return false;
  const p = (prevFields || {}) as Record<string, any>;
  const n = nextFields as Record<string, any>;
  const identityKeys = ["lrn", "name", "first_name", "middle_name", "last_name", "suffix", "school_year", "grade_level", "section"];
  return identityKeys.some((k) => {
    if (!(k in n) || n[k] === undefined) return false;
    return String(p[k] ?? "").trim() !== String(n[k] ?? "").trim();
  });
}

/**
 * Shared authorization check enforcing Phase 6 edit rules for Class Advisers and Subject Teachers
 * across Server Actions and REST API routes.
 */
export async function authorizeTeacherDocumentEdit(params: {
  supabase: any;
  userId: string;
  doc: {
    id: string;
    school_id?: string | null;
    uploaded_by?: string | null;
    status?: string | null;
    teacher_assignment_id?: string | null;
    school_year?: string | null;
    grade_level?: string | null;
    section?: string | null;
    extracted_fields?: any;
  };
  nextExtractedFields?: ExtractedFields | null;
  nextBody?: Record<string, any> | null;
}): Promise<DocumentEditAuthResult> {
  const { supabase, userId, doc, nextExtractedFields, nextBody } = params;

  if (doc.status === "approved" || doc.status === "rejected") {
    return {
      allowed: false,
      error: "Forbidden: Approved or rejected documents cannot be edited by teachers.",
      isClassAdviser: false,
      authorizedSubjects: [],
    };
  }

  const { data: assignmentsData } = await supabase
    .from("teacher_assignments")
    .select("*")
    .eq("teacher_user_id", userId)
    .eq("assignment_status", "active");

  const activeAssignments: TeacherAssignmentRecord[] = assignmentsData || [];
  const matching = activeAssignments.filter((a) => assignmentMatchesDocContext(a, doc));

  const isClassAdviser = matching.some((a) => a.assignment_type === "class_adviser");
  const authorizedSubjects = matching
    .filter((a) => a.assignment_type === "subject_teacher" && Boolean(a.subject_taught))
    .map((a) => String(a.subject_taught));

  if (!isClassAdviser && authorizedSubjects.length === 0) {
    return {
      allowed: false,
      error: "Forbidden: You do not have an active class adviser or subject teacher assignment covering this document.",
      isClassAdviser: false,
      authorizedSubjects: [],
    };
  }

  if (isClassAdviser) {
    return {
      allowed: true,
      isClassAdviser: true,
      authorizedSubjects,
    };
  }

  // Subject Teacher path: restrict edits solely to their authorized subjects' grades
  if (nextBody) {
    const blockedBodyFields = [
      "image_url",
      "teacher_assignment_id",
      "student_id",
      "canonical_lrn",
      "document_type",
      "school_year",
      "grade_level",
      "section",
      "strand_or_track",
    ];
    for (const field of blockedBodyFields) {
      if (field in nextBody && nextBody[field] !== undefined && nextBody[field] !== (doc as any)[field]) {
        return {
          allowed: false,
          error: `Forbidden: Subject teachers cannot alter '${field}' or reprocess scanned document files.`,
          isClassAdviser: false,
          authorizedSubjects,
        };
      }
    }
  }

  const prevFields = (doc.extracted_fields || {}) as ExtractedFields & Record<string, any>;
  const nextRawFields = (nextExtractedFields || {}) as Record<string, any>;
  if (
    ("incremental_update_summary" in nextRawFields &&
      JSON.stringify(nextRawFields.incremental_update_summary ?? null) !==
        JSON.stringify(prevFields.incremental_update_summary ?? null)) ||
    ("scan_history" in nextRawFields &&
      JSON.stringify(nextRawFields.scan_history ?? null) !==
        JSON.stringify(prevFields.scan_history ?? null)) ||
    ("ocr_provider" in nextRawFields &&
      nextRawFields.ocr_provider !== prevFields.ocr_provider)
  ) {
    return {
      allowed: false,
      error: "Forbidden: Subject teachers cannot perform OCR reprocessing or incremental scan updates.",
      isClassAdviser: false,
      authorizedSubjects,
    };
  }

  const previousGrades = Array.isArray(prevFields.grades) ? (prevFields.grades as GradeRecord[]) : [];
  const nextGrades =
    nextExtractedFields && Array.isArray(nextExtractedFields.grades)
      ? (nextExtractedFields.grades as GradeRecord[])
      : previousGrades;

  const nonGradeIdentityChanged = detectNonGradeIdentityChange(prevFields, nextExtractedFields);
  const gradeCheck = validateSubjectTeacherGradeEdits({
    isClassAdviser: false,
    authorizedSubjectNames: authorizedSubjects,
    previousGrades,
    nextGrades,
    nonGradeIdentityChanged,
  });

  if (!gradeCheck.allowed) {
    return {
      allowed: false,
      error: gradeCheck.error,
      isClassAdviser: false,
      authorizedSubjects,
    };
  }

  return {
    allowed: true,
    isClassAdviser: false,
    authorizedSubjects,
  };
}

/**
 * Shared server-side authorization gate for `/api/ocr` (strict Class Adviser-only scanning).
 */
export function evaluateOcrRouteAuthorization(params: {
  userId: string;
  userRole: string;
  accountStatus: string;
  userSchoolId?: string | null;
  assignment: TeacherAssignmentRecord | null;
  assignmentConfirmed: boolean;
  selectedSchoolYear?: string | null;
  selectedGradeLevel?: string | null;
  selectedSection?: string | null;
  selectedStrand?: string | null;
}): {
  allowed: boolean;
  statusCode: number;
  code?: string;
  error?: string;
} {
  const role = String(params.userRole || "").toLowerCase().trim();
  const status = String(params.accountStatus || "").trim();

  if (!params.userId || status !== "Approved") {
    return {
      allowed: false,
      statusCode: 403,
      code: "ACCOUNT_NOT_APPROVED",
      error: "Forbidden: Account is pending administrator approval.",
    };
  }

  if (role === "principal") {
    return {
      allowed: false,
      statusCode: 403,
      code: "PRINCIPAL_READ_ONLY",
      error: "Forbidden: Principal role is monitoring-only and cannot initiate OCR scans.",
    };
  }

  if (role === "admin" || role === "administrator") {
    return {
      allowed: false,
      statusCode: 403,
      code: "ADMIN_CANNOT_UPLOAD",
      error: "Forbidden: Administrator role is restricted to management and approval. Only authorized Teachers may scan or upload documents.",
    };
  }

  if (role !== "teacher") {
    return {
      allowed: false,
      statusCode: 403,
      code: "UNAUTHORIZED_ROLE",
      error: "Forbidden: Unauthorized role for document scanning.",
    };
  }

  const authCheck = evaluateTeacherScanAuthorization({
    userRole: params.userRole,
    userId: params.userId,
    accountStatus: params.accountStatus,
    userSchoolId: params.userSchoolId,
    assignment: params.assignment,
    policy: { allow_subject_teacher_scanning: false },
    assignmentConfirmed: params.assignmentConfirmed,
  });

  if (!authCheck.allowed) {
    return {
      allowed: false,
      statusCode: authCheck.statusCode,
      code: authCheck.code,
      error: authCheck.error,
    };
  }

  const assignment = params.assignment!;
  if (
    params.selectedSchoolYear &&
    normalizeSchoolYearKey(params.selectedSchoolYear) !== normalizeSchoolYearKey(assignment.school_year)
  ) {
    return {
      allowed: false,
      statusCode: 403,
      code: "ASSIGNMENT_PARAMETER_MISMATCH",
      error: "Forbidden: Selected school year does not match your active Class Adviser assignment.",
    };
  }
  if (
    params.selectedGradeLevel &&
    normalizeGradeLevelKey(params.selectedGradeLevel) !== normalizeGradeLevelKey(assignment.grade_level)
  ) {
    return {
      allowed: false,
      statusCode: 403,
      code: "ASSIGNMENT_PARAMETER_MISMATCH",
      error: "Forbidden: Selected grade level does not match your active Class Adviser assignment.",
    };
  }
  if (
    params.selectedSection &&
    normalizeSectionKey(params.selectedSection) !== normalizeSectionKey(assignment.section)
  ) {
    return {
      allowed: false,
      statusCode: 403,
      code: "ASSIGNMENT_PARAMETER_MISMATCH",
      error: "Forbidden: Selected section does not match your active Class Adviser assignment.",
    };
  }
  if (
    params.selectedStrand &&
    assignment.strand_or_track &&
    normalizeStrandKey(params.selectedStrand) !== normalizeStrandKey(assignment.strand_or_track)
  ) {
    return {
      allowed: false,
      statusCode: 403,
      code: "ASSIGNMENT_PARAMETER_MISMATCH",
      error: "Forbidden: Selected strand/track does not match your active Class Adviser assignment.",
    };
  }

  return { allowed: true, statusCode: 200 };
}

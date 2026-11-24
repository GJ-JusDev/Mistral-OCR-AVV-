import { normalizeSubjectName } from "@/lib/validation/gradeComparator";
import type { GradeRecord } from "@/types/documents";

export type AssignmentType = "class_adviser" | "subject_teacher";
export type AssignmentStatus = "active" | "inactive";

export interface TeacherAssignmentRecord {
  id: string;
  teacher_user_id: string;
  school_id: string;
  school_year: string;
  grade_level: string;
  section: string;
  strand_or_track: string | null;
  subject_taught: string | null;
  semester: string | null;
  assignment_type: AssignmentType;
  assignment_status: AssignmentStatus;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
  teacher_name?: string | null;
  teacher_email?: string | null;
}

export interface TeacherModulePolicy {
  school_id: string;
  allow_subject_teacher_scanning: boolean;
  updated_by?: string | null;
  updated_at?: string | null;
}

export interface TeacherAuthorizationInput {
  userRole: string | null | undefined;
  userId: string | null | undefined;
  accountStatus: string | null | undefined;
  userSchoolId: string | null | undefined;
  assignment?: TeacherAssignmentRecord | null;
  policy?: Pick<TeacherModulePolicy, "allow_subject_teacher_scanning"> | null;
  assignmentConfirmed?: boolean;
}

export interface TeacherAuthorizationResult {
  allowed: boolean;
  statusCode: number;
  error?: string;
  code?: string;
  effectiveRole: "admin" | "class_adviser" | "subject_teacher" | "principal" | "unauthorized";
}

export function normalizeSchoolYearKey(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "");
}

export function normalizeGradeLevelKey(raw: string | null | undefined): string {
  const cleaned = String(raw || "").trim().toLowerCase();
  if (!cleaned) return "";
  if (cleaned === "11" || cleaned === "g11" || cleaned.includes("grade 11") || cleaned.includes("gr. 11")) {
    return "Grade 11";
  }
  if (cleaned === "12" || cleaned === "g12" || cleaned.includes("grade 12") || cleaned.includes("gr. 12")) {
    return "Grade 12";
  }
  return String(raw || "").trim();
}

export function normalizeSectionKey(raw: string | null | undefined): string {
  return String(raw || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Normalizes DepEd SHS strand/track names (e.g. "Academic Track - STEM" -> "STEM").
 */
export function normalizeStrandKey(raw: string | null | undefined): string {
  const trimmed = String(raw || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();

  const knownStrands = ["STEM", "ABM", "HUMSS", "GAS", "TVL-ICT", "TVL-HE", "TVL-IA", "TVL-AFA", "TVL", "SPORTS", "ARTS AND DESIGN"];
  for (const code of knownStrands) {
    const escaped = code.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(upper)) {
      return code;
    }
  }

  return upper.replace(/^(ACADEMIC|TECHNICAL[- ]VOCATIONAL[- ]LIVELIHOOD)\s*(TRACK)?\s*[-–:]\s*/i, "").trim();
}

export function formatAssignmentRoleLabel(type: AssignmentType | string | null | undefined): string {
  return type === "class_adviser" ? "Class Adviser" : "Subject Teacher";
}

/**
 * Formats the exact Phase 3 confirmation prompt required before initiating a scan.
 */
export function buildAssignmentConfirmationMessage(input: {
  grade_level: string;
  section: string;
  strand_or_track?: string | null;
  school_year: string;
}): string {
  const grade = normalizeGradeLevelKey(input.grade_level) || input.grade_level;
  const section = String(input.section || "").trim();
  const strand = input.strand_or_track && input.strand_or_track.trim().length > 0
    ? input.strand_or_track.trim()
    : "N/A";
  const sy = normalizeSchoolYearKey(input.school_year) || input.school_year;

  return `You are about to scan academic records for ${grade} — ${section} — ${strand}, School Year ${sy}. Please confirm that the document belongs to this assigned class.`;
}

/**
 * Evaluates server-side permission to initiate an SF9/SF10 scan or document upload.
 * Preserves existing admin rights and principal monitoring-only blocks while strictly requiring
 * teachers to hold an active, owned `class_adviser` assignment. Subject Teachers are permanently
 * barred from scanning or OCR extraction regardless of any policy flag.
 */
export function evaluateTeacherScanAuthorization(input: TeacherAuthorizationInput): TeacherAuthorizationResult {
  const role = String(input.userRole || "").toLowerCase().trim();
  const status = String(input.accountStatus || "").trim();

  if (!input.userId || status !== "Approved") {
    return {
      allowed: false,
      statusCode: 403,
      code: "ACCOUNT_NOT_APPROVED",
      error: "Forbidden: Account is pending administrator approval.",
      effectiveRole: "unauthorized",
    };
  }

  if (role === "principal") {
    return {
      allowed: false,
      statusCode: 403,
      code: "PRINCIPAL_READ_ONLY",
      error: "Forbidden: Principal role is monitoring-only and cannot upload or scan documents.",
      effectiveRole: "principal",
    };
  }

  if (role === "admin" || role === "administrator") {
    return {
      allowed: false,
      statusCode: 403,
      code: "ADMIN_CANNOT_UPLOAD",
      error: "Forbidden: Administrator role is restricted to management and approval. Only authorized Teachers may scan or upload documents.",
      effectiveRole: "admin",
    };
  }

  if (role !== "teacher") {
    return {
      allowed: false,
      statusCode: 403,
      code: "UNAUTHORIZED_ROLE",
      error: "Forbidden: Only authorized school staff may upload documents.",
      effectiveRole: "unauthorized",
    };
  }

  const assignment = input.assignment;
  if (!assignment) {
    return {
      allowed: false,
      statusCode: 403,
      code: "ASSIGNMENT_REQUIRED",
      error: "Forbidden: You must select an active teaching assignment assigned by an administrator before scanning.",
      effectiveRole: "unauthorized",
    };
  }

  if (assignment.teacher_user_id !== input.userId) {
    return {
      allowed: false,
      statusCode: 403,
      code: "ASSIGNMENT_NOT_OWNED",
      error: "Forbidden: Selected assignment does not belong to your account.",
      effectiveRole: "unauthorized",
    };
  }

  if (assignment.assignment_status !== "active") {
    return {
      allowed: false,
      statusCode: 403,
      code: "ASSIGNMENT_INACTIVE",
      error: "Forbidden: Selected assignment is inactive. Contact an administrator to activate your class assignment.",
      effectiveRole: "unauthorized",
    };
  }

  if (input.userSchoolId && assignment.school_id !== input.userSchoolId) {
    return {
      allowed: false,
      statusCode: 403,
      code: "ASSIGNMENT_SCHOOL_MISMATCH",
      error: "Forbidden: Assignment school does not match your authorized school.",
      effectiveRole: "unauthorized",
    };
  }

  if (assignment.assignment_type !== "class_adviser") {
    return {
      allowed: false,
      statusCode: 403,
      code: "CLASS_ADVISER_REQUIRED",
      error: "Forbidden: Only an officially assigned and active Class Adviser may scan SF9/SF10 documents or perform OCR extraction. Subject Teachers are not permitted to scan.",
      effectiveRole: assignment.assignment_type === "subject_teacher" ? "subject_teacher" : "unauthorized",
    };
  }

  const normGrade = normalizeGradeLevelKey(assignment.grade_level);
  if (normGrade !== "Grade 11" && normGrade !== "Grade 12") {
    return {
      allowed: false,
      statusCode: 403,
      code: "SHS_LEVEL_REQUIRED",
      error: "Forbidden: Scanning and document upload are restricted to Senior High School (Grade 11 or Grade 12) advisory assignments.",
      effectiveRole: "unauthorized",
    };
  }

  if (input.assignmentConfirmed === false) {
    return {
      allowed: false,
      statusCode: 400,
      code: "ASSIGNMENT_CONFIRMATION_REQUIRED",
      error: "Pre-scan assignment confirmation is required before uploading or submitting documents.",
      effectiveRole: assignment.assignment_type,
    };
  }

  return {
    allowed: true,
    statusCode: 200,
    effectiveRole: assignment.assignment_type,
  };
}

/**
 * Summarizes a teacher's authorized dashboard capabilities strictly from active assignments.
 */
export function categorizeTeacherAssignments(
  assignments: TeacherAssignmentRecord[],
  _policy?: Pick<TeacherModulePolicy, "allow_subject_teacher_scanning"> | null
) {
  const active = (assignments || []).filter((a) => a.assignment_status === "active");
  const advisoryClasses = active.filter((a) => a.assignment_type === "class_adviser");
  const subjectAssignments = active.filter((a) => a.assignment_type === "subject_teacher");

  const sectionMap = new Map<
    string,
    {
      key: string;
      school_year: string;
      grade_level: string;
      section: string;
      strand_or_track: string | null;
      roles: AssignmentType[];
      subjects: string[];
      primaryAssignmentId: string;
      canScan: boolean;
    }
  >();

  // Strict Class Adviser-only scanning policy: Subject Teachers can never initiate scans
  const allowSubjectScan = false;

  for (const a of active) {
    const sy = normalizeSchoolYearKey(a.school_year);
    const gl = normalizeGradeLevelKey(a.grade_level);
    const secKey = normalizeSectionKey(a.section);
    const strandKey = normalizeStrandKey(a.strand_or_track);
    const key = `${sy}|${gl}|${secKey}|${strandKey}`;
    const canScan = a.assignment_type === "class_adviser";

    const existing = sectionMap.get(key);
    if (!existing) {
      sectionMap.set(key, {
        key,
        school_year: a.school_year,
        grade_level: gl,
        section: a.section,
        strand_or_track: a.strand_or_track,
        roles: [a.assignment_type],
        subjects: a.subject_taught ? [a.subject_taught] : [],
        primaryAssignmentId: a.id,
        canScan,
      });
    } else {
      if (!existing.roles.includes(a.assignment_type)) existing.roles.push(a.assignment_type);
      if (a.subject_taught && !existing.subjects.includes(a.subject_taught)) {
        existing.subjects.push(a.subject_taught);
      }
      if (a.assignment_type === "class_adviser") {
        existing.primaryAssignmentId = a.id;
      }
      existing.canScan = existing.canScan || canScan;
    }
  }

  return {
    activeCount: active.length,
    advisoryClasses,
    subjectAssignments,
    assignedSections: Array.from(sectionMap.values()),
    canScanAny: advisoryClasses.length > 0,
    allowSubjectTeacherScanning: allowSubjectScan,
  };
}

export interface GradeEditValidationResult {
  allowed: boolean;
  unauthorizedSubjects: string[];
  error?: string;
}

function normalizeQuarterNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function gradeRowSignature(g: GradeRecord): string {
  return JSON.stringify({
    subject: normalizeSubjectName(g.subject),
    semester: String(g.semester || "").trim().toLowerCase(),
    q1: normalizeQuarterNumber(g.q1),
    q2: normalizeQuarterNumber(g.q2),
    q3: normalizeQuarterNumber(g.q3),
    q4: normalizeQuarterNumber(g.q4),
    final: normalizeQuarterNumber(g.final),
    status: String(g.status || "").trim().toLowerCase(),
    action_taken: String(g.action_taken || "").trim().toLowerCase(),
  });
}

/**
 * Limits Subject Teacher grade edits exclusively to subjects assigned to them.
 */
export function validateSubjectTeacherGradeEdits(params: {
  isClassAdviser: boolean;
  authorizedSubjectNames: string[];
  previousGrades: GradeRecord[];
  nextGrades: GradeRecord[];
  nonGradeIdentityChanged?: boolean;
}): GradeEditValidationResult {
  if (params.isClassAdviser) {
    return { allowed: true, unauthorizedSubjects: [] };
  }

  if (params.nonGradeIdentityChanged) {
    return {
      allowed: false,
      unauthorizedSubjects: [],
      error: "Forbidden: Subject teachers may only edit grades for their assigned subjects and cannot alter student identity metadata.",
    };
  }

  const allowedSet = new Set(
    (params.authorizedSubjectNames || [])
      .map((s) => normalizeSubjectName(s))
      .filter((s) => s.length > 0)
  );

  const prevMap = new Map<string, GradeRecord>();
  for (const g of params.previousGrades || []) {
    const key = `${normalizeSubjectName(g.subject)}|${String(g.semester || "").trim().toLowerCase()}`;
    prevMap.set(key, g);
  }

  const nextMap = new Map<string, GradeRecord>();
  for (const g of params.nextGrades || []) {
    const key = `${normalizeSubjectName(g.subject)}|${String(g.semester || "").trim().toLowerCase()}`;
    nextMap.set(key, g);
  }

  const unauthorized: string[] = [];

  for (const [key, nextRow] of nextMap.entries()) {
    const prevRow = prevMap.get(key);
    const changed = !prevRow || gradeRowSignature(prevRow) !== gradeRowSignature(nextRow);
    if (changed) {
      const normSubj = normalizeSubjectName(nextRow.subject);
      if (!allowedSet.has(normSubj)) {
        unauthorized.push(nextRow.subject || "Unknown Subject");
      }
    }
  }

  for (const [key, prevRow] of prevMap.entries()) {
    if (!nextMap.has(key)) {
      const normSubj = normalizeSubjectName(prevRow.subject);
      if (!allowedSet.has(normSubj)) {
        unauthorized.push(prevRow.subject || "Unknown Subject");
      }
    }
  }

  if (unauthorized.length > 0) {
    return {
      allowed: false,
      unauthorizedSubjects: Array.from(new Set(unauthorized)),
      error: `Forbidden: Subject teacher is not authorized to modify grades for: ${Array.from(new Set(unauthorized)).join(", ")}.`,
    };
  }

  return { allowed: true, unauthorizedSubjects: [] };
}

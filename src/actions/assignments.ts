"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import {
  categorizeTeacherAssignments,
  normalizeGradeLevelKey,
  normalizeSchoolYearKey,
  type AssignmentStatus,
  type AssignmentType,
  type TeacherAssignmentRecord,
  type TeacherModulePolicy,
} from "@/lib/teacher/assignments";

async function getAuthenticatedUserContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized", supabase: null, user: null, roleRow: null };
  }

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("user_id, role, account_status, school_id, matched_registry_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!roleRow || roleRow.account_status !== "Approved") {
    return { error: "Forbidden: Approved account required.", supabase: null, user, roleRow: null };
  }

  return { error: null, supabase, user, roleRow };
}

async function verifyAdminContext() {
  const ctx = await getAuthenticatedUserContext();
  if (ctx.error || !ctx.supabase || !ctx.roleRow) {
    return { error: ctx.error || "Unauthorized", supabase: null, user: null, roleRow: null };
  }
  if (ctx.roleRow.role !== "admin") {
    return { error: "Forbidden: Administrator privileges required.", supabase: null, user: ctx.user, roleRow: ctx.roleRow };
  }
  return ctx;
}

export async function getAdminTeacherAssignmentsData() {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const schoolId = ctx.roleRow.school_id;
    const sb = ctx.supabase as any;

    const [teachersRes, registryRes, assignmentsRes, policyRes, conflictsRes] = await Promise.all([
      sb
        .from("user_roles")
        .select("user_id, role, account_status, school_id, matched_registry_id")
        .eq("role", "teacher")
        .eq("school_id", schoolId),
      sb
        .from("school_teacher_registry")
        .select("id, linked_user_id, first_name, middle_initial, last_name, full_name_original, verified_email")
        .eq("school_id", schoolId),
      sb
        .from("teacher_assignments")
        .select("*")
        .eq("school_id", schoolId)
        .order("school_year", { ascending: false })
        .order("grade_level", { ascending: true })
        .order("section", { ascending: true }),
      sb
        .from("teacher_module_policies")
        .select("*")
        .eq("school_id", schoolId)
        .maybeSingle(),
      sb
        .from("student_identity_conflicts")
        .select("*")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const regRows = registryRes.data || [];
    const regByUserId = new Map<string, any>();
    const regById = new Map<string, any>();
    for (const r of regRows) {
      if (r.linked_user_id) regByUserId.set(r.linked_user_id, r);
      regById.set(r.id, r);
    }

    const teachers = (teachersRes.data || []).map((t: any) => {
      const reg = regByUserId.get(t.user_id) || (t.matched_registry_id ? regById.get(t.matched_registry_id) : null);
      const displayName =
        reg?.full_name_original ||
        (reg ? `${reg.first_name || ""} ${reg.last_name || ""}`.trim() : "") ||
        `Teacher ${String(t.user_id).slice(0, 8)}`;
      return {
        ...t,
        full_name: displayName,
        email: reg?.verified_email || null,
      };
    });

    const teacherMap = new Map<string, { full_name?: string; email?: string | null; account_status?: string }>();
    for (const t of teachers) {
      teacherMap.set(t.user_id, {
        full_name: t.full_name,
        email: t.email,
        account_status: t.account_status,
      });
    }

    const assignments: TeacherAssignmentRecord[] = (assignmentsRes.data || []).map((a: any) => {
      const tInfo = teacherMap.get(a.teacher_user_id);
      return {
        ...a,
        teacher_name: tInfo?.full_name || null,
        teacher_email: tInfo?.email || null,
      };
    });

    const policy: TeacherModulePolicy = {
      school_id: policyRes.data?.school_id || schoolId,
      allow_subject_teacher_scanning: false,
      updated_by: policyRes.data?.updated_by,
      updated_at: policyRes.data?.updated_at,
    };

    return {
      teachers,
      assignments,
      policy,
      conflicts: conflictsRes.data || [],
      schoolId,
    };
  } catch (err: any) {
    return { error: err?.message || "Failed to load teacher assignments." };
  }
}

export async function createTeacherAssignmentAction(input: {
  teacher_user_id: string;
  school_year: string;
  grade_level: string;
  section: string;
  strand_or_track?: string | null;
  subject_taught?: string | null;
  semester?: string | null;
  assignment_type: AssignmentType;
  assignment_status?: AssignmentStatus;
}) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const schoolId = ctx.roleRow.school_id;
    if (!schoolId) {
      return { error: "Administrator school scope is missing." };
    }

    const schoolYear = normalizeSchoolYearKey(input.school_year);
    const gradeLevel = normalizeGradeLevelKey(input.grade_level);
    const section = String(input.section || "").trim();
    const strand = input.strand_or_track ? String(input.strand_or_track).trim() : null;
    const subjectTaught =
      input.assignment_type === "subject_teacher"
        ? String(input.subject_taught || "").trim()
        : input.subject_taught
        ? String(input.subject_taught).trim()
        : null;
    const semester = input.semester && String(input.semester).trim() ? String(input.semester).trim() : null;
    const assignmentStatus: AssignmentStatus = input.assignment_status === "inactive" ? "inactive" : "active";

    if (!/^\d{4}-\d{4}$/.test(schoolYear)) {
      return { error: "School year must be in YYYY-YYYY format (e.g., 2025-2026)." };
    }
    if (gradeLevel !== "Grade 11" && gradeLevel !== "Grade 12") {
      return { error: "Grade level must be Grade 11 or Grade 12." };
    }
    if (!section) {
      return { error: "Section is required." };
    }
    if (input.assignment_type === "subject_teacher" && !subjectTaught) {
      return { error: "Subject taught is required for Subject Teacher assignments." };
    }

    const sb = ctx.supabase as any;
    const { data, error } = await sb
      .from("teacher_assignments")
      .insert({
        teacher_user_id: input.teacher_user_id,
        school_id: schoolId,
        school_year: schoolYear,
        grade_level: gradeLevel,
        section,
        strand_or_track: strand,
        subject_taught: subjectTaught,
        semester,
        assignment_type: input.assignment_type,
        assignment_status: assignmentStatus,
        created_by: ctx.user.id,
        updated_by: ctx.user.id,
      })
      .select()
      .single();

    if (error) {
      return { error: error.message };
    }

    await logAuditEvent({
      category: "USER_MANAGEMENT",
      action: "TEACHER_ASSIGNMENT_CREATED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: schoolId,
      targetType: "teacher_assignment",
      targetId: data.id,
      targetLabel: `${gradeLevel} - ${section} (${input.assignment_type})`,
      details: {
        teacher_user_id: input.teacher_user_id,
        school_year: schoolYear,
        grade_level: gradeLevel,
        section,
        strand_or_track: strand,
        subject_taught: subjectTaught,
        semester,
        assignment_type: input.assignment_type,
        assignment_status: assignmentStatus,
      },
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/");
    return { data };
  } catch (err: any) {
    return { error: err?.message || "Failed to create teacher assignment." };
  }
}

export async function updateTeacherAssignmentStatusAction(
  assignmentId: string,
  nextStatus: AssignmentStatus
) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const sb = ctx.supabase as any;
    const { data, error } = await sb
      .from("teacher_assignments")
      .update({
        assignment_status: nextStatus,
        updated_by: ctx.user.id,
      })
      .eq("id", assignmentId)
      .eq("school_id", ctx.roleRow.school_id)
      .select()
      .single();

    if (error) {
      return { error: error.message };
    }

    await logAuditEvent({
      category: "USER_MANAGEMENT",
      action: "TEACHER_ASSIGNMENT_STATUS_CHANGED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: ctx.roleRow.school_id,
      targetType: "teacher_assignment",
      targetId: assignmentId,
      targetLabel: `${data.grade_level} - ${data.section}`,
      details: { assignment_status: nextStatus },
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/");
    return { data };
  } catch (err: any) {
    return { error: err?.message || "Failed to update assignment status." };
  }
}

export async function updateTeacherModulePolicyAction(allowSubjectTeacherScanning: boolean) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    if (Boolean(allowSubjectTeacherScanning)) {
      await logAuditEvent({
        category: "SECURITY",
        action: "UNAUTHORIZED_ACCESS_DENIED",
        outcome: "DENIED",
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: ctx.roleRow.role,
        actorSchoolId: ctx.roleRow.school_id,
        targetType: "teacher_module_policies",
        targetId: ctx.roleRow.school_id,
        details: { attempted_allow_subject_teacher_scanning: true },
      });
      return {
        error:
          "Forbidden: Subject Teacher scanning is permanently disabled by system policy. Only active Class Advisers may scan SF9/SF10 documents.",
      };
    }

    const schoolId = ctx.roleRow.school_id;
    const sb = ctx.supabase as any;
    const { data, error } = await sb
      .from("teacher_module_policies")
      .upsert(
        {
          school_id: schoolId,
          allow_subject_teacher_scanning: false,
          updated_by: ctx.user.id,
        },
        { onConflict: "school_id" }
      )
      .select()
      .single();

    if (error) {
      return { error: error.message };
    }

    await logAuditEvent({
      category: "SECURITY",
      action: "TEACHER_MODULE_POLICY_UPDATED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: schoolId,
      targetType: "teacher_module_policies",
      targetId: schoolId,
      details: { allow_subject_teacher_scanning: false },
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/");
    revalidatePath("/upload");
    return { data };
  } catch (err: any) {
    return { error: err?.message || "Failed to update scanning permission policy." };
  }
}

export async function resolveIdentityConflictAction(input: {
  conflictId: string;
  resolutionStatus: "resolved" | "dismissed";
  resolutionNotes: string;
  linkStudentId?: string | null;
}) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const sb = ctx.supabase as any;
    const { error } = await sb.rpc("resolve_section_or_identity_conflict", {
      p_conflict_id: input.conflictId,
      p_resolution_status: input.resolutionStatus,
      p_resolution_notes: input.resolutionNotes,
      p_link_student_id: input.linkStudentId || null,
    });

    if (error) {
      return { error: error.message };
    }

    await logAuditEvent({
      category: "REVIEW",
      action: "IDENTITY_CONFLICT_RESOLVED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: ctx.roleRow.school_id,
      targetType: "student_identity_conflict",
      targetId: input.conflictId,
      reason: input.resolutionNotes,
      details: {
        resolution_status: input.resolutionStatus,
        link_student_id: input.linkStudentId || null,
      },
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/review");
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || "Failed to resolve conflict." };
  }
}

export async function getMyTeacherDashboardData() {
  const ctx = await getAuthenticatedUserContext();
  if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
    return {
      error: ctx.error || "Unauthorized",
      assignments: [] as TeacherAssignmentRecord[],
      policy: { school_id: "", allow_subject_teacher_scanning: false },
      roster: [] as any[],
      pendingDocuments: [] as any[],
      documents: [] as any[],
      summary: categorizeTeacherAssignments([], null),
    };
  }

  const sb = ctx.supabase as any;
  const schoolId = ctx.roleRow.school_id;

  const [assignmentsRes, policyRes, enrollmentsRes, docsRes] = await Promise.all([
    sb
      .from("teacher_assignments")
      .select("*")
      .eq("teacher_user_id", ctx.user.id)
      .eq("assignment_status", "active")
      .order("school_year", { ascending: false })
      .order("grade_level", { ascending: true })
      .order("section", { ascending: true }),
    schoolId
      ? sb
          .from("teacher_module_policies")
          .select("*")
          .eq("school_id", schoolId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sb
      .from("student_enrollments")
      .select("id, student_id, school_year, grade_level, section, strand_or_track, enrollment_status, is_current, students(id, lrn, first_name, middle_name, last_name, overall_status)")
      .eq("is_current", true)
      .order("updated_at", { ascending: false })
      .limit(200),
    sb
      .from("documents")
      .select("id, student_id, document_type, original_filename, status, school_year, grade_level, section, strand_or_track, teacher_assignment_id, ocr_model, created_at, extracted_fields, students(lrn, first_name, last_name)")
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const assignments: TeacherAssignmentRecord[] = assignmentsRes.data || [];
  const policy: TeacherModulePolicy = {
    school_id: policyRes.data?.school_id || schoolId || "",
    allow_subject_teacher_scanning: false,
    updated_by: policyRes.data?.updated_by,
    updated_at: policyRes.data?.updated_at,
  };

  const summary = categorizeTeacherAssignments(assignments, policy);
  const docs = docsRes.data || [];
  const pendingDocuments = docs.filter((d: any) =>
    ["submitted", "extracted", "validated", "needs_review", "corrected"].includes(d.status)
  );

  return {
    assignments,
    policy,
    roster: enrollmentsRes.data || [],
    pendingDocuments,
    documents: docs,
    summary,
  };
}

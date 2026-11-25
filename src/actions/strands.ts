"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import type { SchoolStrandRow, SchoolSectionRow } from "@/types/database";

const DEFAULT_SCHOOL_YEAR = "2025-2026";

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

/**
 * Admin: Get all strands and sections, plus advisory requests and assignment capacity.
 */
export async function getAdminStrandsAndSectionsData() {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const schoolId = ctx.roleRow.school_id;
    const sb = ctx.supabase as any;

    const [strandsRes, sectionsRes, usersRes, registryRes, assignmentsRes] = await Promise.all([
      sb
        .from("school_strands")
        .select("*")
        .eq("school_id", schoolId)
        .order("name", { ascending: true }),
      sb
        .from("school_sections")
        .select("*")
        .eq("school_id", schoolId)
        .order("name", { ascending: true }),
      sb
        .from("user_roles")
        .select("user_id, role, account_status, school_id, requested_grade_level, requested_strand, requested_section, requested_strand_id, requested_section_id, request_status, request_submitted_at, matched_registry_id")
        .eq("school_id", schoolId)
        .eq("role", "teacher"),
      sb
        .from("school_teacher_registry")
        .select("id, linked_user_id, first_name, middle_initial, last_name, full_name_original, verified_email")
        .eq("school_id", schoolId),
      sb
        .from("teacher_assignments")
        .select("id, teacher_user_id, school_year, grade_level, section, strand_or_track, strand_id, section_id, assignment_type, assignment_status")
        .eq("school_id", schoolId)
        .eq("assignment_status", "active"),
    ]);

    const regRows = registryRes.data || [];
    const regByUserId = new Map<string, any>();
    const regById = new Map<string, any>();
    for (const r of regRows) {
      if (r.linked_user_id) regByUserId.set(r.linked_user_id, r);
      regById.set(r.id, r);
    }

    const teacherRequests = (usersRes.data || [])
      .filter((u: any) => Boolean(u.request_status || u.requested_section))
      .map((u: any) => {
        const reg = regByUserId.get(u.user_id) || (u.matched_registry_id ? regById.get(u.matched_registry_id) : null);
        const displayName =
          reg?.full_name_original ||
          (reg ? `${reg.first_name || ""} ${reg.last_name || ""}`.trim() : "") ||
          `Teacher ${String(u.user_id).slice(0, 8)}`;

        return {
          user_id: u.user_id,
          full_name: displayName,
          email: reg?.verified_email || null,
          account_status: u.account_status,
          requested_grade_level: u.requested_grade_level,
          requested_strand: u.requested_strand,
          requested_section: u.requested_section,
          requested_strand_id: u.requested_strand_id,
          requested_section_id: u.requested_section_id,
          request_status: u.request_status,
          request_submitted_at: u.request_submitted_at,
        };
      });

    return {
      strands: (strandsRes.data || []) as SchoolStrandRow[],
      sections: (sectionsRes.data || []) as SchoolSectionRow[],
      teacherRequests,
      activeAssignments: assignmentsRes.data || [],
      schoolId,
    };
  } catch (err: any) {
    return { error: err?.message || "Failed to load strands and sections." };
  }
}

/**
 * Admin: Add a new strand.
 */
export async function createStrandAction(input: {
  name: string;
  code: string;
  description?: string | null;
}) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const schoolId = ctx.roleRow.school_id;
    const name = String(input.name || "").trim();
    const code = String(input.code || "").trim().toUpperCase();
    const description = input.description ? String(input.description).trim() : null;

    if (!name) return { error: "Strand name is required." };
    if (!code) return { error: "Strand code is required." };

    const sb = ctx.supabase as any;
    const { data, error } = await sb
      .from("school_strands")
      .insert({
        school_id: schoolId,
        name,
        code,
        description,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return { error: "A strand with this name or code already exists in your school." };
      }
      return { error: error.message };
    }

    await logAuditEvent({
      category: "SYSTEM",
      action: "STRAND_CREATED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: schoolId,
      targetType: "school_strand",
      targetId: data.id,
      targetLabel: `${name} (${code})`,
      details: { name, code, description },
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/");
    return { data };
  } catch (err: any) {
    return { error: err?.message || "Failed to create strand." };
  }
}

/**
 * Admin: Edit a strand (name, code, description, active status).
 */
export async function updateStrandAction(input: {
  id: string;
  name?: string;
  code?: string;
  description?: string | null;
  is_active?: boolean;
}) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const schoolId = ctx.roleRow.school_id;
    const sb = ctx.supabase as any;

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) {
      const trimmed = String(input.name).trim();
      if (!trimmed) return { error: "Strand name cannot be empty." };
      updatePayload.name = trimmed;
    }
    if (input.code !== undefined) {
      const trimmedCode = String(input.code).trim().toUpperCase();
      if (!trimmedCode) return { error: "Strand code cannot be empty." };
      updatePayload.code = trimmedCode;
    }
    if (input.description !== undefined) {
      updatePayload.description = input.description ? String(input.description).trim() : null;
    }
    if (input.is_active !== undefined) {
      updatePayload.is_active = Boolean(input.is_active);
    }

    const { data, error } = await sb
      .from("school_strands")
      .update(updatePayload)
      .eq("id", input.id)
      .eq("school_id", schoolId)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return { error: "A strand with this name or code already exists in your school." };
      }
      return { error: error.message };
    }

    await logAuditEvent({
      category: "SYSTEM",
      action: "STRAND_UPDATED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: schoolId,
      targetType: "school_strand",
      targetId: input.id,
      targetLabel: `${data.name} (${data.code})`,
      details: updatePayload,
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/");
    return { data };
  } catch (err: any) {
    return { error: err?.message || "Failed to update strand." };
  }
}

/**
 * Admin: Add a section under a strand.
 */
export async function createSectionAction(input: {
  strand_id: string;
  name: string;
  capacity?: number;
}) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const schoolId = ctx.roleRow.school_id;
    const strandId = String(input.strand_id || "").trim();
    const name = String(input.name || "").trim();
    const capacity = Number(input.capacity) > 0 ? Number(input.capacity) : 40;

    if (!strandId) return { error: "Strand selection is required." };
    if (!name) return { error: "Section name is required." };

    const sb = ctx.supabase as any;

    // Verify strand exists in admin's school
    const { data: strand, error: strandErr } = await sb
      .from("school_strands")
      .select("id, name, code, is_active")
      .eq("id", strandId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (strandErr || !strand) {
      return { error: "Target strand not found in your school." };
    }

    const { data, error } = await sb
      .from("school_sections")
      .insert({
        school_id: schoolId,
        strand_id: strandId,
        name,
        capacity,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return { error: `A section named '${name}' already exists under strand ${strand.name}.` };
      }
      return { error: error.message };
    }

    await logAuditEvent({
      category: "SYSTEM",
      action: "SECTION_CREATED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: schoolId,
      targetType: "school_section",
      targetId: data.id,
      targetLabel: `${strand.code} - ${name}`,
      details: { strand_id: strandId, name, capacity },
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/");
    return { data };
  } catch (err: any) {
    return { error: err?.message || "Failed to create section." };
  }
}

/**
 * Admin: Edit a section (name, capacity, active status).
 */
export async function updateSectionAction(input: {
  id: string;
  name?: string;
  capacity?: number;
  is_active?: boolean;
}) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const schoolId = ctx.roleRow.school_id;
    const sb = ctx.supabase as any;

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) {
      const trimmed = String(input.name).trim();
      if (!trimmed) return { error: "Section name cannot be empty." };
      updatePayload.name = trimmed;
    }
    if (input.capacity !== undefined) {
      const cap = Number(input.capacity);
      if (cap < 1) return { error: "Section capacity must be at least 1." };
      updatePayload.capacity = cap;
    }
    if (input.is_active !== undefined) {
      updatePayload.is_active = Boolean(input.is_active);
    }

    const { data, error } = await sb
      .from("school_sections")
      .update(updatePayload)
      .eq("id", input.id)
      .eq("school_id", schoolId)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return { error: "A section with this name already exists in this strand." };
      }
      return { error: error.message };
    }

    await logAuditEvent({
      category: "SYSTEM",
      action: "SECTION_UPDATED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: schoolId,
      targetType: "school_section",
      targetId: input.id,
      targetLabel: data.name,
      details: updatePayload,
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/");
    return { data };
  } catch (err: any) {
    return { error: err?.message || "Failed to update section." };
  }
}

/**
 * Admin: Approve a teacher's advisory class request and assign them officially.
 */
export async function approveTeacherAdvisoryRequestAction(input: {
  teacher_user_id: string;
  school_year?: string;
}) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const schoolId = ctx.roleRow.school_id;
    const schoolYear = input.school_year ? input.school_year.trim() : DEFAULT_SCHOOL_YEAR;
    const sb = ctx.supabase as any;

    // 1. Fetch teacher user_roles record
    const { data: teacherRole, error: roleErr } = await sb
      .from("user_roles")
      .select("*")
      .eq("user_id", input.teacher_user_id)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (roleErr || !teacherRole) {
      return { error: "Teacher account not found in your school." };
    }

    if (!teacherRole.requested_section || !teacherRole.requested_strand || !teacherRole.requested_grade_level) {
      return { error: "This teacher has not submitted a complete advisory class request." };
    }

    const gradeLevel = teacherRole.requested_grade_level;
    const sectionName = teacherRole.requested_section;
    const strandName = teacherRole.requested_strand;

    // 2. Validate strand & section exist and are active
    let strandId = teacherRole.requested_strand_id;
    let sectionId = teacherRole.requested_section_id;

    if (!strandId || !sectionId) {
      const { data: matchedStrand } = await sb
        .from("school_strands")
        .select("id, is_active")
        .eq("school_id", schoolId)
        .or(`name.eq."${strandName}",code.eq."${strandName}"`)
        .maybeSingle();

      if (matchedStrand) {
        strandId = matchedStrand.id;
        const { data: matchedSection } = await sb
          .from("school_sections")
          .select("id, is_active, capacity")
          .eq("school_id", schoolId)
          .eq("strand_id", strandId)
          .eq("name", sectionName)
          .maybeSingle();
        if (matchedSection) sectionId = matchedSection.id;
      }
    }

    if (strandId) {
      const { data: strRow } = await sb
        .from("school_strands")
        .select("is_active")
        .eq("id", strandId)
        .maybeSingle();
      if (!strRow || !strRow.is_active) {
        return { error: "Requested strand is currently inactive or deleted." };
      }
    }

    if (sectionId) {
      const { data: secRow } = await sb
        .from("school_sections")
        .select("is_active, capacity")
        .eq("id", sectionId)
        .maybeSingle();
      if (!secRow || !secRow.is_active) {
        return { error: "Requested section is currently inactive or deleted." };
      }
    }

    // 3. Conflict Prevention: Check if section already has an active Class Adviser in this school year
    const { data: existingAdvisers } = await sb
      .from("teacher_assignments")
      .select("id, teacher_user_id, assignment_status")
      .eq("school_id", schoolId)
      .eq("school_year", schoolYear)
      .eq("section", sectionName)
      .eq("assignment_type", "class_adviser")
      .eq("assignment_status", "active");

    if (existingAdvisers && existingAdvisers.length > 0) {
      const conflict = existingAdvisers.find((a: any) => a.teacher_user_id !== input.teacher_user_id);
      if (conflict) {
        return {
          error: `Conflict detected: Section '${sectionName}' already has an active Class Adviser for School Year ${schoolYear}. Please deactivate or reassign the existing adviser first.`,
        };
      }
    }

    // 4. Create or activate teacher assignment
    const { data: existingAssignment } = await sb
      .from("teacher_assignments")
      .select("id, assignment_status")
      .eq("teacher_user_id", input.teacher_user_id)
      .eq("school_id", schoolId)
      .eq("school_year", schoolYear)
      .eq("grade_level", gradeLevel)
      .eq("section", sectionName)
      .eq("assignment_type", "class_adviser")
      .maybeSingle();

    let assignmentId: string;
    if (existingAssignment) {
      const { data: updated, error: updErr } = await sb
        .from("teacher_assignments")
        .update({
          assignment_status: "active",
          strand_or_track: strandName,
          strand_id: strandId || null,
          section_id: sectionId || null,
          updated_by: ctx.user.id,
        })
        .eq("id", existingAssignment.id)
        .select()
        .single();
      if (updErr) return { error: updErr.message };
      assignmentId = updated.id;
    } else {
      const { data: created, error: insErr } = await sb
        .from("teacher_assignments")
        .insert({
          teacher_user_id: input.teacher_user_id,
          school_id: schoolId,
          school_year: schoolYear,
          grade_level: gradeLevel,
          section: sectionName,
          strand_or_track: strandName,
          strand_id: strandId || null,
          section_id: sectionId || null,
          assignment_type: "class_adviser",
          assignment_status: "active",
          created_by: ctx.user.id,
          updated_by: ctx.user.id,
        })
        .select()
        .single();
      if (insErr) return { error: insErr.message };
      assignmentId = created.id;
    }

    // 5. Update user_roles to mark request Approved
    const { error: userRoleUpdErr } = await sb
      .from("user_roles")
      .update({
        request_status: "Approved",
        requested_strand_id: strandId || null,
        requested_section_id: sectionId || null,
      })
      .eq("user_id", input.teacher_user_id);

    if (userRoleUpdErr) {
      console.error("Warning: Failed to update user_roles request_status to Approved:", userRoleUpdErr);
    }

    // 6. Audit Log
    await logAuditEvent({
      category: "USER_MANAGEMENT",
      action: "TEACHER_ADVISORY_REQUEST_APPROVED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: schoolId,
      targetType: "teacher_assignment",
      targetId: assignmentId,
      targetLabel: `${gradeLevel} - ${sectionName} (${strandName})`,
      details: {
        teacher_user_id: input.teacher_user_id,
        school_year: schoolYear,
        grade_level: gradeLevel,
        section: sectionName,
        strand: strandName,
      },
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/");
    return { success: true, assignmentId };
  } catch (err: any) {
    return { error: err?.message || "Failed to approve advisory request." };
  }
}

/**
 * Admin: Reject a teacher's advisory request.
 */
export async function rejectTeacherAdvisoryRequestAction(input: {
  teacher_user_id: string;
  reason?: string;
}) {
  try {
    const ctx = await verifyAdminContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    const schoolId = ctx.roleRow.school_id;
    const sb = ctx.supabase as any;

    const { error: updErr } = await sb
      .from("user_roles")
      .update({
        request_status: "Declined",
      })
      .eq("user_id", input.teacher_user_id)
      .eq("school_id", schoolId);

    if (updErr) return { error: updErr.message };

    await logAuditEvent({
      category: "USER_MANAGEMENT",
      action: "TEACHER_ADVISORY_REQUEST_REJECTED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: ctx.roleRow.role,
      actorSchoolId: schoolId,
      targetType: "user",
      targetId: input.teacher_user_id,
      reason: input.reason || "Advisory request declined by administrator.",
      details: { teacher_user_id: input.teacher_user_id, reason: input.reason },
    });

    revalidatePath("/admin/teacher-assignments");
    revalidatePath("/");
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || "Failed to reject advisory request." };
  }
}

/**
 * Teacher/Authenticated: Fetch active strands and their active sections.
 */
export async function getAvailableStrandsAndSections() {
  try {
    const ctx = await getAuthenticatedUserContext();
    if (ctx.error || !ctx.supabase || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized", strands: [], sections: [] };
    }

    const schoolId = ctx.roleRow.school_id;
    const sb = ctx.supabase as any;

    const [strandsRes, sectionsRes, assignmentsRes] = await Promise.all([
      sb
        .from("school_strands")
        .select("id, school_id, name, code, description, is_active")
        .eq("school_id", schoolId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      sb
        .from("school_sections")
        .select("id, school_id, strand_id, name, capacity, is_active")
        .eq("school_id", schoolId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      sb
        .from("teacher_assignments")
        .select("section, assignment_type, assignment_status")
        .eq("school_id", schoolId)
        .eq("assignment_type", "class_adviser")
        .eq("assignment_status", "active"),
    ]);

    const activeAdviserSections = new Set(
      (assignmentsRes.data || []).map((a: any) => String(a.section).trim().toLowerCase())
    );

    const sections = (sectionsRes.data || []).map((sec: any) => {
      const hasAdviser = activeAdviserSections.has(String(sec.name).trim().toLowerCase());
      return {
        ...sec,
        hasActiveAdviser: hasAdviser,
        isAvailable: !hasAdviser,
      };
    });

    return {
      strands: (strandsRes.data || []) as SchoolStrandRow[],
      sections,
      schoolId,
    };
  } catch (err: any) {
    return { error: err?.message || "Failed to fetch available strands and sections.", strands: [], sections: [] };
  }
}

/**
 * Teacher: Submit advisory class request after logging in.
 */
export async function submitTeacherAdvisoryRequestAction(input: {
  grade_level: string;
  strand_id: string;
  section_id: string;
}) {
  try {
    const ctx = await getAuthenticatedUserContext();
    if (ctx.error || !ctx.supabase || !ctx.user || !ctx.roleRow) {
      return { error: ctx.error || "Unauthorized" };
    }

    if (ctx.roleRow.role !== "teacher") {
      return { error: "Forbidden: Only teachers can submit advisory class requests." };
    }

    const schoolId = ctx.roleRow.school_id;
    const gradeLevel = String(input.grade_level || "").trim();
    const strandId = String(input.strand_id || "").trim();
    const sectionId = String(input.section_id || "").trim();

    if (gradeLevel !== "Grade 11" && gradeLevel !== "Grade 12") {
      return { error: "Grade level must be either Grade 11 or Grade 12." };
    }
    if (!strandId) return { error: "Strand selection is required." };
    if (!sectionId) return { error: "Section selection is required." };

    const sb = ctx.supabase as any;

    // Check if teacher ALREADY has an active approved Class Adviser assignment
    const { data: existingApproved } = await sb
      .from("teacher_assignments")
      .select("id, grade_level, section, strand_or_track")
      .eq("teacher_user_id", ctx.user.id)
      .eq("school_id", schoolId)
      .eq("assignment_type", "class_adviser")
      .eq("assignment_status", "active")
      .maybeSingle();

    if (existingApproved) {
      return {
        error: `You already have an active approved advisory assignment (${existingApproved.grade_level} - ${existingApproved.section}). Please contact your school administrator to request a change.`,
      };
    }

    // Verify strand exists, belongs to school, and is active
    const { data: strand, error: strandErr } = await sb
      .from("school_strands")
      .select("id, name, code, is_active")
      .eq("id", strandId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (strandErr || !strand || !strand.is_active) {
      return { error: "Selected strand does not exist or is currently inactive." };
    }

    // Verify section exists, belongs to strand, and is active
    const { data: section, error: secErr } = await sb
      .from("school_sections")
      .select("id, name, capacity, is_active")
      .eq("id", sectionId)
      .eq("strand_id", strandId)
      .eq("school_id", schoolId)
      .maybeSingle();

    if (secErr || !section || !section.is_active) {
      return { error: "Selected section does not exist or is currently inactive." };
    }

    // Check if section already has an assigned Class Adviser (prevent selecting full/taken sections)
    const { data: activeAdvisers } = await sb
      .from("teacher_assignments")
      .select("id")
      .eq("school_id", schoolId)
      .eq("section", section.name)
      .eq("assignment_type", "class_adviser")
      .eq("assignment_status", "active");

    if (activeAdvisers && activeAdvisers.length > 0) {
      return {
        error: `Section '${section.name}' is already assigned to an active Class Adviser. Please select another section.`,
      };
    }

    const timestamp = new Date().toISOString();

    const { error: updErr } = await sb
      .from("user_roles")
      .update({
        requested_grade_level: gradeLevel,
        requested_strand: strand.name,
        requested_section: section.name,
        requested_strand_id: strand.id,
        requested_section_id: section.id,
        request_status: "Pending",
        request_submitted_at: timestamp,
      })
      .eq("user_id", ctx.user.id);

    if (updErr) {
      return { error: updErr.message };
    }

    await logAuditEvent({
      category: "USER_MANAGEMENT",
      action: "TEACHER_ADVISORY_REQUEST_SUBMITTED",
      outcome: "SUCCESS",
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: "teacher",
      actorSchoolId: schoolId,
      targetType: "user_roles",
      targetId: ctx.user.id,
      targetLabel: `${gradeLevel} - ${section.name} (${strand.code})`,
      details: {
        requested_grade_level: gradeLevel,
        requested_strand: strand.name,
        requested_section: section.name,
        requested_strand_id: strand.id,
        requested_section_id: section.id,
      },
    });

    revalidatePath("/");
    revalidatePath("/admin/teacher-assignments");
    return { success: true };
  } catch (err: any) {
    return { error: err?.message || "Failed to submit advisory request." };
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import {
  createTeacherAssignmentAction,
  getAdminTeacherAssignmentsData,
  updateTeacherAssignmentStatusAction,
  updateTeacherModulePolicyAction,
} from "@/actions/assignments";
import {
  normalizeGradeLevelKey,
  normalizeSchoolYearKey,
} from "@/lib/teacher/assignments";

async function requireApprovedAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role, account_status, school_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!roleRow || roleRow.account_status !== "Approved" || roleRow.role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Forbidden: Only approved administrators may manage teacher assignments." },
        { status: 403 }
      ),
    };
  }

  return { supabase, user, roleRow };
}

export async function GET() {
  const auth = await requireApprovedAdmin();
  if ("error" in auth && auth.error) return auth.error;

  const data = await getAdminTeacherAssignmentsData();
  if ("error" in data && data.error) {
    return NextResponse.json({ error: data.error }, { status: 400 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const auth = await requireApprovedAdmin();
  if ("error" in auth && auth.error) return auth.error;

  try {
    const body = await request.json();
    const res = await createTeacherAssignmentAction({
      teacher_user_id: body.teacher_user_id,
      school_year: body.school_year,
      grade_level: body.grade_level,
      section: body.section,
      strand_or_track: body.strand_or_track ?? null,
      subject_taught: body.subject_taught ?? null,
      semester: body.semester ?? null,
      assignment_type: body.assignment_type,
      assignment_status: body.assignment_status,
    });

    if (res.error) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }
    return NextResponse.json({ assignment: res.data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Invalid payload." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireApprovedAdmin();
  if ("error" in auth && auth.error) return auth.error;

  try {
    const body = await request.json();

    if (typeof body.allow_subject_teacher_scanning === "boolean") {
      if (body.allow_subject_teacher_scanning === true) {
        return NextResponse.json(
          {
            error:
              "Forbidden: Subject Teacher scanning is permanently disabled. Only active Class Advisers may scan SF9/SF10 documents.",
            code: "SUBJECT_TEACHER_SCAN_PERMANENTLY_DISABLED",
          },
          { status: 403 }
        );
      }
      const policyRes = await updateTeacherModulePolicyAction(false);
      if (policyRes.error) {
        return NextResponse.json({ error: policyRes.error }, { status: 400 });
      }
      return NextResponse.json({ policy: policyRes.data });
    }

    if (!body.id) {
      return NextResponse.json({ error: "Assignment ID is required." }, { status: 400 });
    }

    if (body.assignment_status && Object.keys(body).length <= 2) {
      const statusRes = await updateTeacherAssignmentStatusAction(body.id, body.assignment_status);
      if (statusRes.error) {
        return NextResponse.json({ error: statusRes.error }, { status: 400 });
      }
      return NextResponse.json({ assignment: statusRes.data });
    }

    const sb = auth.supabase as any;
    const updates: Record<string, any> = {
      updated_by: auth.user.id,
    };
    if (body.school_year !== undefined) updates.school_year = normalizeSchoolYearKey(body.school_year);
    if (body.grade_level !== undefined) updates.grade_level = normalizeGradeLevelKey(body.grade_level);
    if (body.section !== undefined) updates.section = String(body.section).trim();
    if (body.strand_or_track !== undefined) updates.strand_or_track = body.strand_or_track ? String(body.strand_or_track).trim() : null;
    if (body.subject_taught !== undefined) updates.subject_taught = body.subject_taught ? String(body.subject_taught).trim() : null;
    if (body.semester !== undefined) updates.semester = body.semester ? String(body.semester).trim() : null;
    if (body.assignment_type !== undefined) updates.assignment_type = body.assignment_type;
    if (body.assignment_status !== undefined) updates.assignment_status = body.assignment_status;

    const { data, error } = await sb
      .from("teacher_assignments")
      .update(updates)
      .eq("id", body.id)
      .eq("school_id", auth.roleRow.school_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logAuditEvent({
      category: "USER_MANAGEMENT",
      action: "TEACHER_ASSIGNMENT_UPDATED",
      outcome: "SUCCESS",
      actorUserId: auth.user.id,
      actorEmail: auth.user.email,
      actorRole: auth.roleRow.role,
      actorSchoolId: auth.roleRow.school_id,
      targetType: "teacher_assignment",
      targetId: body.id,
      details: updates,
    });

    return NextResponse.json({ assignment: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Invalid payload." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApprovedAdmin();
  if ("error" in auth && auth.error) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Assignment ID is required." }, { status: 400 });
  }

  const res = await updateTeacherAssignmentStatusAction(id, "inactive");
  if (res.error) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json({ assignment: res.data, deactivated: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  categorizeTeacherAssignments,
  type TeacherAssignmentRecord,
  type TeacherModulePolicy,
} from "@/lib/teacher/assignments";

/**
 * GET /api/teacher/assignments
 * Returns ONLY the authenticated teacher's active authorized assignments and school scanning policy.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role, account_status, school_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json(
        { error: "Forbidden: Account is pending administrator approval." },
        { status: 403 }
      );
    }

    const sb = supabase as any;
    let query = sb
      .from("teacher_assignments")
      .select("*")
      .eq("assignment_status", "active")
      .order("school_year", { ascending: false })
      .order("grade_level", { ascending: true })
      .order("section", { ascending: true });

    if (roleRow.role === "teacher") {
      query = query.eq("teacher_user_id", user.id);
    } else if (roleRow.school_id) {
      query = query.eq("school_id", roleRow.school_id);
    }

    const [{ data: assignments, error }, { data: policyData }] = await Promise.all([
      query,
      roleRow.school_id
        ? sb
            .from("teacher_module_policies")
            .select("*")
            .eq("school_id", roleRow.school_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const activeList: TeacherAssignmentRecord[] = assignments || [];
    const policy: TeacherModulePolicy = {
      school_id: policyData?.school_id || roleRow.school_id || "",
      allow_subject_teacher_scanning: false,
      updated_by: policyData?.updated_by,
      updated_at: policyData?.updated_at,
    };

    const summary = categorizeTeacherAssignments(activeList, policy);

    return NextResponse.json({
      role: roleRow.role,
      assignments: activeList,
      advisoryAssignments: summary.advisoryClasses,
      subjectAssignments: summary.subjectAssignments,
      policy,
      summary,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch teacher assignments." },
      { status: 500 }
    );
  }
}

function selfAssignmentForbidden() {
  return NextResponse.json(
    {
      error:
        "Forbidden: Teachers cannot create, modify, or activate official assignments. Contact your school administrator.",
      code: "SELF_ASSIGNMENT_FORBIDDEN",
    },
    { status: 403 }
  );
}

export async function POST() {
  return selfAssignmentForbidden();
}

export async function PATCH() {
  return selfAssignmentForbidden();
}

export async function PUT() {
  return selfAssignmentForbidden();
}

export async function DELETE() {
  return selfAssignmentForbidden();
}

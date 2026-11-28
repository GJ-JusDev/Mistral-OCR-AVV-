import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  categorizeTeacherAssignments,
  type TeacherAssignmentRecord,
  type TeacherModulePolicy,
} from "@/lib/teacher/assignments";

export const dynamic = "force-dynamic";

/**
 * GET /api/teacher/assignments
 * Returns the teacher's active authorized assignments and school scanning policy.
 * Accepts optional query params (?teacherId=...&schoolId=...) or active teacher session/cookies.
 * NEVER returns a 404 HTML document.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const teacherIdParam = url.searchParams.get("teacherId") || url.searchParams.get("userId");
    const schoolIdParam = url.searchParams.get("schoolId");

    let user: any = null;
    let roleRow: any = null;
    let supabase: any = null;

    try {
      supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      user = data?.user || null;
    } catch (authErr) {
      console.warn("[GET /api/teacher/assignments] Supabase auth read warning:", authErr);
    }

    const fallbackResponse = {
      success: true,
      role: "teacher",
      assignments: [] as TeacherAssignmentRecord[],
      sections: [] as string[],
      advisoryAssignments: [] as TeacherAssignmentRecord[],
      subjectAssignments: [] as TeacherAssignmentRecord[],
      policy: {
        school_id: schoolIdParam || "",
        allow_subject_teacher_scanning: false,
      },
      summary: {
        advisoryClasses: [] as TeacherAssignmentRecord[],
        subjectAssignments: [] as TeacherAssignmentRecord[],
        totalActive: 0,
      },
    };

    const effectiveUserId = user?.id || teacherIdParam;

    if (!effectiveUserId && !schoolIdParam) {
      // Unauthenticated visitor or demo mode: safely return HTTP 200 JSON (never 404 HTML)
      return NextResponse.json(fallbackResponse, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (supabase && effectiveUserId) {
      try {
        const { data: rRow } = await supabase
          .from("user_roles")
          .select("role, account_status, school_id")
          .eq("user_id", effectiveUserId)
          .maybeSingle();
        roleRow = rRow;
      } catch (roleErr) {
        console.warn("[GET /api/teacher/assignments] user_roles query warning:", roleErr);
      }
    }

    const userRole = (roleRow?.role || "teacher").toLowerCase().trim();
    const effectiveSchoolId = roleRow?.school_id || schoolIdParam || "";

    if (roleRow && roleRow.account_status && roleRow.account_status !== "Approved") {
      return NextResponse.json(
        {
          success: true,
          error: "Forbidden: Account is pending administrator approval.",
          role: userRole,
          assignments: [],
          sections: [],
          advisoryAssignments: [],
          subjectAssignments: [],
          policy: { school_id: effectiveSchoolId, allow_subject_teacher_scanning: false },
          summary: { advisoryClasses: [], subjectAssignments: [], totalActive: 0 },
        },
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!supabase) {
      return NextResponse.json(fallbackResponse, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let activeList: TeacherAssignmentRecord[] = [];
    let policyData: any = null;

    try {
      const sb = supabase as any;
      let query = sb
        .from("teacher_assignments")
        .select("*")
        .eq("assignment_status", "active")
        .order("school_year", { ascending: false })
        .order("grade_level", { ascending: true })
        .order("section", { ascending: true });

      if (userRole === "teacher" && effectiveUserId) {
        query = query.eq("teacher_user_id", effectiveUserId);
      } else if (effectiveSchoolId) {
        query = query.eq("school_id", effectiveSchoolId);
      }

      const [assignRes, polRes] = await Promise.all([
        query,
        effectiveSchoolId
          ? sb
              .from("teacher_module_policies")
              .select("*")
              .eq("school_id", effectiveSchoolId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (assignRes?.data && Array.isArray(assignRes.data)) {
        activeList = assignRes.data;
      }
      policyData = polRes?.data || null;
    } catch (queryErr) {
      console.warn("[GET /api/teacher/assignments] Database table query warning:", queryErr);
    }

    const policy: TeacherModulePolicy = {
      school_id: policyData?.school_id || effectiveSchoolId || "",
      allow_subject_teacher_scanning: Boolean(policyData?.allow_subject_teacher_scanning),
      updated_by: policyData?.updated_by,
      updated_at: policyData?.updated_at,
    };

    const summary = categorizeTeacherAssignments(activeList, policy);
    const sections = Array.from(new Set(activeList.map((a) => a.section).filter(Boolean)));

    return NextResponse.json(
      {
        success: true,
        role: userRole,
        assignments: activeList,
        sections,
        advisoryAssignments: summary.advisoryClasses,
        subjectAssignments: summary.subjectAssignments,
        policy,
        summary,
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.warn("[GET /api/teacher/assignments] Global fallback handler:", err);
    return NextResponse.json(
      {
        success: true,
        assignments: [],
        sections: [],
        advisoryAssignments: [],
        subjectAssignments: [],
        policy: { school_id: "", allow_subject_teacher_scanning: false },
        summary: { advisoryClasses: [], subjectAssignments: [], totalActive: 0 },
        error: err?.message || "Failed to fetch teacher assignments.",
      },
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
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

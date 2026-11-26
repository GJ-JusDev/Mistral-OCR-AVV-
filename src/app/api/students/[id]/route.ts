import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchStudentDetail,
  getStudentDetailErrorResponse,
} from "@/lib/students/studentDetailService";

export async function GET(
  request: NextRequest,
  props: any
) {
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
      .select("role, account_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow || roleRow.account_status !== "Approved") {
      return NextResponse.json({ error: "Forbidden: Account is pending administrator approval." }, { status: 403 });
    }

    const userRole = (roleRow.role || "").toLowerCase().trim();
    if (userRole === "admin" || userRole === "administrator") {
      return NextResponse.json(
        {
          error: "Forbidden: Administrator role cannot access students directory. Students module has been removed from Admin experience.",
          code: "ADMIN_STUDENTS_REMOVED",
        },
        { status: 403 }
      );
    }

    const { id } = await props.params;
    const detail = await fetchStudentDetail(supabase, id);
    if (!detail) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error("[api/students/:id] Failed to load student detail:", error);
    const response = getStudentDetailErrorResponse();
    return NextResponse.json(response.body, { status: response.status });
  }
}

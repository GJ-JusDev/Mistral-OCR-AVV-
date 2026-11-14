import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveIdentityConflictAction } from "@/actions/assignments";

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

    if (
      !roleRow ||
      roleRow.account_status !== "Approved" ||
      (roleRow.role !== "admin" && roleRow.role !== "principal")
    ) {
      return NextResponse.json(
        { error: "Forbidden: Only approved administrators or principals may view school conflicts." },
        { status: 403 }
      );
    }

    const sb = supabase as any;
    const { data, error } = await sb
      .from("student_identity_conflicts")
      .select("*")
      .eq("school_id", roleRow.school_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ conflicts: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
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

    if (!roleRow || roleRow.account_status !== "Approved" || roleRow.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: Only administrators can resolve section and identity conflicts." },
        { status: 403 }
      );
    }

    const body = await request.json();
    if (!body.conflictId || !body.resolutionStatus) {
      return NextResponse.json(
        { error: "conflictId and resolutionStatus are required." },
        { status: 400 }
      );
    }

    const res = await resolveIdentityConflictAction({
      conflictId: body.conflictId,
      resolutionStatus: body.resolutionStatus,
      resolutionNotes: body.resolutionNotes || "",
      linkStudentId: body.linkStudentId || null,
    });

    if (res.error) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}

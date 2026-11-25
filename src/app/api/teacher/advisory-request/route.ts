import { NextResponse } from "next/server";
import { submitTeacherAdvisoryRequestAction } from "@/actions/strands";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: roleRow, error } = await supabase
      .from("user_roles")
      .select("requested_grade_level, requested_strand, requested_section, requested_strand_id, requested_section_id, request_status, request_submitted_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ request: roleRow });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to fetch request." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await submitTeacherAdvisoryRequestAction(body);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to submit request." }, { status: 500 });
  }
}

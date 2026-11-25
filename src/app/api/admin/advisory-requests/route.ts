import { NextResponse } from "next/server";
import {
  approveTeacherAdvisoryRequestAction,
  rejectTeacherAdvisoryRequestAction,
} from "@/actions/strands";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action || "approve";

    if (action === "approve") {
      const result = await approveTeacherAdvisoryRequestAction({
        teacher_user_id: body.teacher_user_id,
        school_year: body.school_year,
      });
      if ("error" in result && result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json(result);
    } else if (action === "reject" || action === "decline") {
      const result = await rejectTeacherAdvisoryRequestAction({
        teacher_user_id: body.teacher_user_id,
        reason: body.reason,
      });
      if ("error" in result && result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json(result);
    } else {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to process advisory request." }, { status: 500 });
  }
}

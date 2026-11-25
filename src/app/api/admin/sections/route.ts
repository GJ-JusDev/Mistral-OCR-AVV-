import { NextResponse } from "next/server";
import {
  createSectionAction,
  updateSectionAction,
} from "@/actions/strands";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await createSectionAction(body);
    if ("error" in result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to create section." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const result = await updateSectionAction(body);
    if ("error" in result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to update section." }, { status: 500 });
  }
}

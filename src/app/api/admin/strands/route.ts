import { NextResponse } from "next/server";
import {
  getAdminStrandsAndSectionsData,
  createStrandAction,
  updateStrandAction,
} from "@/actions/strands";

export async function GET() {
  const result = await getAdminStrandsAndSectionsData();
  if ("error" in result && result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await createStrandAction(body);
    if ("error" in result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to create strand." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const result = await updateStrandAction(body);
    if ("error" in result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to update strand." }, { status: 500 });
  }
}

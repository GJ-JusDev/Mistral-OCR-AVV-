import { NextResponse } from "next/server";
import { getAvailableStrandsAndSections } from "@/actions/strands";

export async function GET() {
  const result = await getAvailableStrandsAndSections();
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

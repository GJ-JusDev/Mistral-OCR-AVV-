import { NextRequest, NextResponse } from "next/server";
import { processPendingRegistrationsAutoApproval } from "@/lib/registry/autoApprovalJob";

export const dynamic = "force-dynamic";

/**
 * Endpoint for scheduled cron execution of automatic teacher approvals.
 * Requires bearer authorization with CRON_SECRET or service role key.
 */
export async function GET(req: NextRequest) {
  return handleAutoApproval(req);
}

export async function POST(req: NextRequest) {
  return handleAutoApproval(req);
}

async function handleAutoApproval(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!cronSecret) {
    return NextResponse.json(
      { error: "Server misconfiguration: Cron authorization secret is not configured." },
      { status: 500 }
    );
  }

  const bearer = authHeader?.replace(/^Bearer\s+/i, "");

  if (!bearer || bearer !== cronSecret) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing bearer authorization secret." },
      { status: 401 }
    );
  }

  try {
    const summary = await processPendingRegistrationsAutoApproval();
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary,
    });
  } catch (error: any) {
    console.error("Cron auto-approve failure:", error);
    return NextResponse.json(
      { error: "Internal server error during auto-approval execution.", details: error.message },
      { status: 500 }
    );
  }
}

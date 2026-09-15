import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  try {
    // Basic stats: total documents, documents needing review, rejected documents
    const [
      { count: totalDocuments },
      { count: needsReview },
      { count: rejected },
      { count: approved }
    ] = await Promise.all([
      supabase.from("documents").select("*", { count: "exact", head: true }),
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("status", "needs_review"),
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("status", "rejected"),
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("status", "approved")
    ]);

    // In a real app we would do a time-series grouping here, but for now we mock the chart data
    const processingChartData = [
      { date: "Mon", processed: Math.floor(Math.random() * 20) },
      { date: "Tue", processed: Math.floor(Math.random() * 30) },
      { date: "Wed", processed: Math.floor(Math.random() * 25) },
      { date: "Thu", processed: Math.floor(Math.random() * 40) },
      { date: "Fri", processed: Math.floor(Math.random() * 45) },
      { date: "Sat", processed: Math.floor(Math.random() * 10) },
      { date: "Sun", processed: Math.floor(Math.random() * 5) },
    ];

    return NextResponse.json({
      stats: {
        total: totalDocuments ?? 0,
        needsReview: needsReview ?? 0,
        rejected: rejected ?? 0,
        approved: approved ?? 0
      },
      chartData: processingChartData
    });
  } catch (error) {
    console.error("Failed to fetch report data:", error);
    return NextResponse.json({ error: "Failed to fetch report data" }, { status: 500 });
  }
}

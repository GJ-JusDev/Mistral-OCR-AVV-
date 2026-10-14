import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { format, subDays, startOfDay, endOfDay } from "date-fns";

export async function GET() {
  const supabase = await createClient();

  try {
    const [
      { count: totalDocuments },
      { count: needsReview },
      { count: rejected },
      { count: approved },
      { count: validated }
    ] = await Promise.all([
      supabase.from("documents").select("*", { count: "exact", head: true }),
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("status", "needs_review"),
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("status", "rejected"),
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("documents").select("*", { count: "exact", head: true }).eq("status", "validated"),
    ]);

    // Query real historical activity for the last 7 days
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = subDays(new Date(), 6 - i);
      return { date: d, label: format(d, 'EEE') };
    });

    const startDate = startOfDay(last7Days[0].date).toISOString();
    const endDate = endOfDay(last7Days[6].date).toISOString();

    const { data: recentActivity } = await supabase
      .from("documents")
      .select("created_at")
      .gte("created_at", startDate)
      .lte("created_at", endDate);

    const processingChartData = last7Days.map(day => {
      const start = startOfDay(day.date).getTime();
      const end = endOfDay(day.date).getTime();
      const count = (recentActivity || []).filter(doc => {
        const time = new Date(doc.created_at || "").getTime();
        return time >= start && time <= end;
      }).length;
      return { date: day.label, processed: count };
    });

    return NextResponse.json({
      stats: {
        total: totalDocuments ?? 0,
        needsReview: needsReview ?? 0,
        rejected: rejected ?? 0,
        approved: approved ?? 0,
        validated: validated ?? 0
      },
      chartData: processingChartData
    });
  } catch (error) {
    console.error("Failed to fetch report data:", error);
    return NextResponse.json({ error: "Failed to fetch report data" }, { status: 500 });
  }
}

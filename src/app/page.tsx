import { createClient } from "@/lib/supabase/server";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { StatsGrid } from "@/components/dashboard/StatsGrid";
import { ValidationActivityChart } from "@/components/dashboard/ValidationActivityChart";
import { ValidationResultsChart } from "@/components/dashboard/ValidationResultsChart";
import { FileText, AlertTriangle, CheckCircle, XCircle, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import Link from "next/link";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import type { ExtractedFields } from "@/types/validation";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return null; // Let middleware handle redirect
  }

  const teacherName = [user?.user_metadata?.first_name, user?.user_metadata?.last_name]
    .filter(Boolean)
    .join(" ") || "Teacher";

  const VALIDATION_STATUSES = ["validated", "needs_review", "corrected", "approved", "rejected"];

  // Fetch stats for the logged-in teacher
  const [
    { count: totalValidations },
    { count: matched },
    { count: needsReview },
    { count: mismatched }
  ] = await Promise.all([
    supabase.from("documents").select("*", { count: "exact", head: true })
      .eq("uploaded_by", user.id)
      .in("status", VALIDATION_STATUSES),
    supabase.from("documents").select("*", { count: "exact", head: true })
      .eq("uploaded_by", user.id)
      .in("status", ["validated", "approved"]),
    supabase.from("documents").select("*", { count: "exact", head: true })
      .eq("uploaded_by", user.id)
      .in("status", ["needs_review", "corrected"]),
    supabase.from("documents").select("*", { count: "exact", head: true })
      .eq("uploaded_by", user.id)
      .eq("status", "rejected")
  ]);

  // Generate last 7 days for the activity chart
  const last7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = subDays(new Date(), 6 - i);
    return { date: d, label: format(d, 'EEE') };
  });

  const startDate = startOfDay(last7Days[0].date).toISOString();
  const endDate = endOfDay(last7Days[6].date).toISOString();

  // Fetch activity for last 7 days
  const { data: recentActivity } = await supabase
    .from("documents")
    .select("created_at")
    .eq("uploaded_by", user.id)
    .in("status", VALIDATION_STATUSES)
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  const activityData = last7Days.map(day => {
    const start = startOfDay(day.date).getTime();
    const end = endOfDay(day.date).getTime();
    const count = (recentActivity || []).filter(doc => {
      const time = new Date(doc.created_at || "").getTime();
      return time >= start && time <= end;
    }).length;
    return { date: day.label, count };
  });

  // Recent Validations (Top 5)
  const { data: recentValidations } = await supabase
    .from("documents")
    .select("id, status, created_at, document_type, extracted_fields")
    .eq("uploaded_by", user.id)
    .in("status", VALIDATION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(5);

  // Needs Attention (Top 3)
  const { data: attentionDocsRaw } = await supabase
    .from("documents")
    .select(`
      id, 
      status, 
      created_at, 
      document_type, 
      extracted_fields
    `)
    .eq("uploaded_by", user.id)
    .in("status", ["needs_review", "corrected"])
    .order("created_at", { ascending: false })
    .limit(3);

  const attentionDocs = attentionDocsRaw || [];
  
  if (attentionDocs.length > 0) {
    const docIds = attentionDocs.map(d => d.id);
    const { data: results } = await supabase
      .from("validation_results")
      .select("document_id, rule_name, message, passed")
      .in("document_id", docIds);
      
    attentionDocs.forEach((doc: any) => {
      doc.validation_results = (results || []).filter(r => r.document_id === doc.id);
    });
  }

  const stats = [
    { title: "Total Validations", value: totalValidations ?? 0, icon: <FileText className="h-5 w-5 text-indigo-500" /> },
    { title: "Matched", value: matched ?? 0, icon: <CheckCircle className="h-5 w-5 text-emerald-500" /> },
    { title: "Needs Review", value: needsReview ?? 0, icon: <AlertTriangle className="h-5 w-5 text-amber-500" /> },
    { title: "Mismatches", value: mismatched ?? 0, icon: <XCircle className="h-5 w-5 text-red-500" /> },
  ];

  return (
    <PageContainer>
      <Header 
        title="Dashboard" 
        description={`Welcome back, ${teacherName}!`} 
      />
      
      <div className="mt-6 flex flex-col gap-6">
        <StatsGrid stats={stats} />
        
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ValidationActivityChart data={activityData} />
          </div>
          <div className="lg:col-span-1">
            <ValidationResultsChart 
              matched={matched ?? 0} 
              needsReview={needsReview ?? 0} 
              mismatched={mismatched ?? 0} 
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card padding="md" className="flex flex-col h-full">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Recent Validations</h3>
                <Link 
                  href="/documents" 
                  className="text-sm text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium"
                >
                  View All
                </Link>
              </div>
              
              <div className="flex-1 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Documents</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!recentValidations || recentValidations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-slate-500 py-8">
                          No recent validations found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      recentValidations.map((doc) => {
                        const fields = doc.extracted_fields as ExtractedFields;
                        const studentName = fields?.name || "Unknown Student";
                        const docType = (doc.document_type || "Unknown").toUpperCase();
                        
                        return (
                          <TableRow key={doc.id}>
                            <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                              {studentName}
                            </TableCell>
                            <TableCell className="text-slate-500 dark:text-slate-400">
                              {docType}
                            </TableCell>
                            <TableCell>
                              <DocumentStatusBadge status={doc.status as any} />
                            </TableCell>
                            <TableCell className="text-sm text-slate-500 dark:text-slate-400">
                              {doc.created_at ? format(new Date(doc.created_at), "MMM d, yyyy") : "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Link 
                                href={`/documents/${doc.id}`}
                                className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                              >
                                View
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <Card padding="md" className="flex flex-col h-full bg-orange-50/50 dark:bg-orange-950/20 border-orange-100 dark:border-orange-900/30">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Needs Your Attention</h3>
              </div>
              
              <div className="flex-1 flex flex-col">
                {!attentionDocs || attentionDocs.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                    <CheckCircle className="h-10 w-10 text-emerald-400 mb-3 opacity-50" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">You're all caught up!</p>
                    <p className="text-xs text-slate-500 mt-1">No validations require review.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                      <strong className="text-slate-900 dark:text-slate-200">{needsReview}</strong> validation{needsReview === 1 ? '' : 's'} require review.
                    </p>
                    
                    <ul className="space-y-3">
                      {attentionDocs.map(doc => {
                        const fields = doc.extracted_fields as ExtractedFields;
                        const studentName = fields?.name || "Unknown Student";
                        
                        // Find discrepancy
                        let discrepancy = "Requires manual review";
                        const docWithResults = doc as any;
                        const results = docWithResults.validation_results as any[];
                        if (results && results.length > 0) {
                          const failed = results.find(r => !r.passed);
                          if (failed) {
                            discrepancy = failed.message || failed.rule_name;
                          }
                        }

                        return (
                          <li key={doc.id} className="flex flex-col bg-white dark:bg-zinc-900 p-3 rounded-md shadow-sm border border-orange-100 dark:border-orange-900/30">
                            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {studentName}
                            </span>
                            <span className="text-xs text-red-600 dark:text-red-400 truncate mt-0.5">
                              {discrepancy}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    
                    <Link 
                      href="/review" 
                      className="mt-4 flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium text-orange-700 bg-orange-100 hover:bg-orange-200 rounded-md transition-colors dark:bg-orange-900/40 dark:text-orange-300 dark:hover:bg-orange-900/60"
                    >
                      View Review Queue
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

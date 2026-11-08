import { createClient } from "@/lib/supabase/server";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { StatCard } from "@/components/ui/StatCard";
import { StatsGrid } from "@/components/dashboard/StatsGrid";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ValidationActivityChart } from "@/components/dashboard/ValidationActivityChart";
import { ValidationResultsChart } from "@/components/dashboard/ValidationResultsChart";
import { FileText, AlertTriangle, CheckCircle, XCircle, ArrowRight, ShieldAlert, Sparkles, Upload } from "lucide-react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import Link from "next/link";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import type { ExtractedFields } from "@/types/validation";
import PrincipalDashboard from "@/components/principal/PrincipalDashboard";
import { getPrincipalDashboardData } from "@/actions/principal";
import LandingPage from "@/components/landing/LandingPage";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { Button } from "@/components/ui/Button";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  const resolvedParams = searchParams ? await searchParams : {};
  const forceLanding = resolvedParams?.view === "landing";

  if (!user || forceLanding) {
    return <LandingPage user={user} />;
  }

  // Check authoritative user role from user_roles
  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = roleRow?.role?.toLowerCase() || user?.user_metadata?.role?.toLowerCase();
  const accountStatus = roleRow?.account_status || user?.user_metadata?.account_status || "Pending";
  const isApproved = accountStatus === "Approved";

  if (!isApproved) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0B1F33] text-white p-6">
        <div className="max-w-md w-full bg-[#102A43] border border-white/10 rounded-2xl p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#F4C542]/15 text-[#F4C542] mb-5 border border-[#F4C542]/30">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">
            {accountStatus === "Declined" ? "Account Declined" : "Account Pending Approval"}
          </h2>
          <p className="text-sm text-[#CBD5E1] leading-relaxed mb-6">
            {accountStatus === "Declined"
              ? "Your account registration was declined by the administrator. Please contact your school administrator for assistance."
              : "Your account registration is currently pending administrator verification. You will be able to access the validation dashboard once approved."}
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/?view=landing"
              className="w-full inline-flex items-center justify-center px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-sm font-medium text-white transition-colors"
            >
              Return to Landing Page
            </Link>
            <div className="flex justify-center pt-2">
              <LogoutButton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Route Principal directly to dedicated executive monitoring dashboard
  if (role === "principal") {
    const dashboardData = await getPrincipalDashboardData();
    if ("error" in dashboardData) {
      return (
        <PageContainer>
          <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <h2 className="text-lg font-bold">Principal Dashboard Error</h2>
            <p className="mt-1 text-sm">{dashboardData.error}</p>
          </div>
        </PageContainer>
      );
    }
    const principalName = [user?.user_metadata?.first_name, user?.user_metadata?.last_name]
      .filter(Boolean)
      .join(" ") || "Principal";

    return <PrincipalDashboard data={dashboardData} userName={principalName} />;
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

  return (
    <PageContainer>
      <Header 
        title="Teacher Validation Dashboard" 
        description={`Welcome back, ${teacherName}. Manage SF9, SF10, and PSA document verifications with automated DepEd grade recalculations.`}
        roleBadge={{ role: role || "teacher", label: "Faculty Validator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "300792" }}
        actions={
          <Link href="/upload">
            <Button
              size="sm"
              leftIcon={<Upload className="h-4 w-4" />}
              className="bg-[#174EA6] hover:bg-[#0B1F33] text-white shadow-sm"
            >
              Upload Form
            </Button>
          </Link>
        }
      />
      
      <div className="mt-6 flex flex-col gap-6">
        {/* KPI Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Submitted"
            value={totalValidations ?? 0}
            icon={<FileText className="h-5 w-5 text-[#174EA6]" />}
            variant="royal"
          />
          <StatCard
            title="Verified & Validated"
            value={matched ?? 0}
            subtitle="Grades passed recalculation"
            icon={<CheckCircle className="h-5 w-5 text-emerald-600" />}
            variant="success"
          />
          <StatCard
            title="Review Required"
            value={needsReview ?? 0}
            subtitle={needsReview ? "Requires teacher verification" : "Queue clear"}
            icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
            variant={needsReview ? "warning" : "default"}
          />
          <StatCard
            title="Discrepancies / Rejections"
            value={mismatched ?? 0}
            subtitle="Flagged by validation engine"
            icon={<XCircle className="h-5 w-5 text-red-600" />}
            variant="danger"
          />
        </div>
        
        {/* Activity & Validation Breakdown Charts */}
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

        {/* Lower Grid: Recent Validations & Needs Attention */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Recent Validations (2 cols) */}
          <div className="lg:col-span-2">
            <DashboardCard
              title="Recent Submissions"
              description="Latest processed student forms and OCR results"
              headerAction={
                <Link 
                  href="/documents" 
                  className="text-xs font-semibold text-[#174EA6] hover:text-[#0B1F33] hover:underline"
                >
                  View All Documents &rarr;
                </Link>
              }
              padding="none"
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Document Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date Processed</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!recentValidations || recentValidations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-xs text-slate-500 py-8">
                          No recent validations found in your queue.
                        </TableCell>
                      </TableRow>
                    ) : (
                      recentValidations.map((doc) => {
                        const fields = doc.extracted_fields as ExtractedFields;
                        const studentName = fields?.name || "Unknown Student";
                        const docType = (doc.document_type || "Unknown").toUpperCase();
                        
                        return (
                          <TableRow key={doc.id}>
                            <TableCell className="font-semibold text-slate-900 text-xs sm:text-sm">
                              {studentName}
                            </TableCell>
                            <TableCell className="text-xs text-slate-600 uppercase font-mono">
                              {docType}
                            </TableCell>
                            <TableCell>
                              <DocumentStatusBadge status={doc.status as any} />
                            </TableCell>
                            <TableCell className="text-xs text-slate-500">
                              {doc.created_at ? format(new Date(doc.created_at), "MMM d, yyyy") : "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Link 
                                href={`/documents/${doc.id}`}
                                className="inline-flex items-center justify-center px-2.5 py-1 text-xs font-semibold text-[#174EA6] bg-[#174EA6]/10 hover:bg-[#174EA6]/20 rounded-md transition-colors"
                              >
                                View Details
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </DashboardCard>
          </div>

          {/* Needs Your Attention Panel (1 col) */}
          <div className="lg:col-span-1">
            <DashboardCard
              title="Needs Your Attention"
              description="Flagged discrepancies awaiting verification"
              icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
              className="border-amber-200/80 bg-gradient-to-b from-amber-50/40 to-white"
            >
              <div className="flex-1 flex flex-col">
                {!attentionDocs || attentionDocs.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                    <CheckCircle className="h-10 w-10 text-emerald-500 mb-2 opacity-80" />
                    <p className="text-sm font-semibold text-slate-800">You're all caught up!</p>
                    <p className="text-xs text-slate-500 mt-0.5">No flagged discrepancies require review.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-slate-600">
                      <strong className="text-slate-900 font-bold">{needsReview}</strong> record{needsReview === 1 ? "" : "s"} require manual teacher verification before principal approval.
                    </p>
                    
                    <div className="space-y-2">
                      {attentionDocs.map(doc => {
                        const fields = doc.extracted_fields as ExtractedFields;
                        const studentName = fields?.name || "Unknown Student";
                        
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
                          <div key={doc.id} className="p-3 bg-white rounded-lg border border-amber-200/80 shadow-xs">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold text-slate-900 truncate">
                                {studentName}
                              </span>
                              <span className="text-[10px] uppercase font-semibold text-amber-700 bg-amber-100/60 px-1.5 py-0.2 rounded">
                                {(doc.document_type || "Doc").toUpperCase()}
                              </span>
                            </div>
                            <span className="text-[11px] text-red-600 line-clamp-2 mt-1 font-medium">
                              {discrepancy}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    
                    <Link 
                      href="/review" 
                      className="mt-2 flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-bold text-[#174EA6] bg-[#174EA6]/10 hover:bg-[#174EA6]/20 rounded-lg transition-colors"
                    >
                      <span>Open Review Queue</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            </DashboardCard>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

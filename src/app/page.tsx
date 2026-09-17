import { createClient } from "@/lib/supabase/server";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { StatsGrid } from "@/components/dashboard/StatsGrid";
import { ProcessingChart } from "@/components/dashboard/ProcessingChart";
import { FileText, AlertTriangle, CheckCircle, XCircle, UserCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import { format } from "date-fns";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Get current user
  const { data: { user } } = await supabase.auth.getUser();

  const role = user?.user_metadata?.role?.toLowerCase() || "teacher";
  const isAdmin = role === "admin";

  // Fetch stats (we apply basic RLS automatically via Supabase client, 
  // but let's assume admins see everything, teachers see theirs - if RLS is set up. 
  // For now we just query).
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

  // Fetch Auth Logs for Admins
  let authLogs: any[] = [];
  if (isAdmin) {
    const { data: logs } = await supabase
      .from("auth_logs")
      .select("*, auth:user_id(email)") // Joins the user email if allowed
      .order("created_at", { ascending: false })
      .limit(10);
    authLogs = logs || [];
  }

  // Mock processing data
  const processingChartData = [
    { date: "Mon", processed: 12 },
    { date: "Tue", processed: 18 },
    { date: "Wed", processed: 25 },
    { date: "Thu", processed: 15 },
    { date: "Fri", processed: 22 },
    { date: "Sat", processed: 5 },
    { date: "Sun", processed: 2 },
  ];

  const stats = [
    { title: "Total Documents", value: totalDocuments ?? 0, icon: <FileText className="h-5 w-5 text-slate-500" /> },
    { title: "Needs Review", value: needsReview ?? 0, icon: <AlertTriangle className="h-5 w-5 text-amber-500" /> },
    { title: "Approved", value: approved ?? 0, icon: <CheckCircle className="h-5 w-5 text-emerald-500" /> },
    { title: "Rejected", value: rejected ?? 0, icon: <XCircle className="h-5 w-5 text-red-500" /> },
  ];

  return (
    <PageContainer>
      <Header 
        title="Dashboard" 
        description={`Welcome back, ${isAdmin ? user?.user_metadata?.first_name || 'Admin' : user?.user_metadata?.first_name || 'Teacher'}!`} 
      />
      
      <div className="mt-6 flex flex-col gap-6">
        <StatsGrid stats={stats} />
        
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className={isAdmin ? "lg:col-span-2" : "lg:col-span-2"}>
            <ProcessingChart data={processingChartData} title="Processing Volume (Last 7 Days)" />
          </div>
          
          {isAdmin && (
            <div className="lg:col-span-1 flex flex-col gap-6">
              <Card padding="md" className="flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <UserCircle className="h-5 w-5 text-slate-500" />
                  <h3 className="text-sm font-medium text-slate-900">Admin Profile</h3>
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Name</p>
                    <p className="text-sm text-slate-900 font-medium">
                      {[user?.user_metadata?.first_name, user?.user_metadata?.middle_name, user?.user_metadata?.last_name, user?.user_metadata?.name_extension].filter(Boolean).join(" ") || "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Email</p>
                    <p className="text-sm text-slate-900">{user?.email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Role</p>
                    <p className="text-sm text-slate-900 font-medium capitalize">
                      {user?.user_metadata?.role || "Admin"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Account Status</p>
                    <p className="text-sm text-slate-900 font-medium">
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                        {user?.user_metadata?.account_status || "Approved"}
                      </span>
                    </p>
                  </div>
                </div>
              </Card>

              <Card padding="md" className="flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <UserCircle className="h-5 w-5 text-slate-500" />
                  <h3 className="text-sm font-medium text-slate-900">User Activity</h3>
                </div>
                <div className="flex-1 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User / Action</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {authLogs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-sm text-slate-500 py-4">No recent activity.</TableCell>
                        </TableRow>
                      ) : (
                        authLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell>
                              <div className="font-medium text-slate-900 truncate w-32" title={log.user_id}>
                                {log.action === "login" ? "🟢 Login" : "🔴 Logout"}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                              {format(new Date(log.created_at), "MMM d, h:mm a")}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          )}

          {!isAdmin && (
            <div className="lg:col-span-1 flex flex-col">
              <Card padding="md" className="h-full flex flex-col">
                <div className="flex items-center gap-2 mb-4">
                  <UserCircle className="h-5 w-5 text-slate-500" />
                  <h3 className="text-sm font-medium text-slate-900">Teacher Profile</h3>
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Name</p>
                    <p className="text-sm text-slate-900 font-medium">
                      {[user?.user_metadata?.first_name, user?.user_metadata?.middle_name, user?.user_metadata?.last_name, user?.user_metadata?.name_extension].filter(Boolean).join(" ") || "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Email</p>
                    <p className="text-sm text-slate-900">{user?.email}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">LPT License Number</p>
                    <p className="text-sm text-slate-900 font-medium">{user?.user_metadata?.lpt_info || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Account Status</p>
                    <p className="text-sm text-slate-900 font-medium">
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                        {user?.user_metadata?.account_status || "Active"}
                      </span>
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          )}

        </div>
      </div>
    </PageContainer>
  );
}

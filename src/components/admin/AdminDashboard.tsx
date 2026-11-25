"use client";

import React from "react";
import Link from "next/link";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { StatCard } from "@/components/ui/StatCard";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { 
  Users, 
  UserCheck, 
  GraduationCap, 
  CheckSquare, 
  ShieldCheck, 
  BarChart3, 
  Settings, 
  AlertTriangle, 
  CheckCircle, 
  ArrowRight,
  Shield
} from "lucide-react";
import { format } from "date-fns";

export interface AdminDashboardData {
  userName?: string;
  totalUsers: number;
  pendingUsers: number;
  registeredTeachers: number;
  activeAssignments: number;
  recentAuditLogs: Array<{
    id: string;
    action: string;
    category: string;
    outcome: string;
    created_at: string;
    actor_email?: string | null;
    actor_role?: string | null;
  }>;
  pendingUsersList: Array<{
    id: string;
    user_id: string;
    role: string;
    account_status: string;
    created_at?: string;
  }>;
}

export default function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const {
    userName = "Administrator",
    totalUsers,
    pendingUsers,
    registeredTeachers,
    activeAssignments,
    recentAuditLogs,
    pendingUsersList,
  } = data;

  return (
    <PageContainer>
      {/* Institutional Administrator Header */}
      <Header
        title="Institutional Administrator Dashboard"
        description={`Welcome back, ${userName}. Oversee faculty accounts, DepEd teacher registry, class advisory assignments, institutional reports, and system audit logs.`}
        roleBadge={{ role: "admin", label: "System Administrator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "500169" }}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/users">
              <Button
                size="sm"
                variant="outline"
                leftIcon={<UserCheck className="h-4 w-4" />}
                className="border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                User Approvals
              </Button>
            </Link>
            <Link href="/admin/teacher-assignments">
              <Button
                size="sm"
                leftIcon={<CheckSquare className="h-4 w-4" />}
                className="bg-[#174EA6] hover:bg-[#0B1F33] text-white shadow-sm"
              >
                Assign Faculty
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Accounts"
            value={totalUsers}
            subtitle="Registered institutional accounts"
            icon={<Users className="h-5 w-5 text-[#174EA6]" />}
            variant="royal"
          />
          <StatCard
            title="Pending Verification"
            value={pendingUsers}
            subtitle={pendingUsers > 0 ? "Requires administrator review" : "All accounts verified"}
            icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
            variant={pendingUsers > 0 ? "warning" : "default"}
          />
          <StatCard
            title="Teacher Registry"
            value={registeredTeachers}
            subtitle="Verified faculty members"
            icon={<GraduationCap className="h-5 w-5 text-emerald-600" />}
            variant="success"
          />
          <StatCard
            title="Active Assignments"
            value={activeAssignments}
            subtitle="Official advisory & subjects"
            icon={<CheckSquare className="h-5 w-5 text-blue-600" />}
            variant="default"
          />
        </div>

        {/* Admin Navigation Quick-Launch Hub */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-3">
            Administrative Modules
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Link 
              href="/admin/users" 
              className="group block p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs hover:border-[#174EA6]/40 hover:shadow-md transition-all duration-150"
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-blue-50 text-[#174EA6] group-hover:bg-[#174EA6] group-hover:text-white transition-colors">
                  <UserCheck className="h-5 w-5" />
                </div>
                {pendingUsers > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                    {pendingUsers} Pending
                  </span>
                )}
              </div>
              <h3 className="font-bold text-slate-900 mt-3 text-sm group-hover:text-[#174EA6] transition-colors">
                User Management
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Manage user registrations, approve or decline faculty accounts, and set administrative roles.
              </p>
            </Link>

            <Link 
              href="/admin/teacher-registry" 
              className="group block p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs hover:border-[#174EA6]/40 hover:shadow-md transition-all duration-150"
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  <GraduationCap className="h-5 w-5" />
                </div>
              </div>
              <h3 className="font-bold text-slate-900 mt-3 text-sm group-hover:text-[#174EA6] transition-colors">
                Teacher Registry
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Maintain the authoritative list of licensed teachers, PRC credentials, and employment status.
              </p>
            </Link>

            <Link 
              href="/admin/teacher-assignments" 
              className="group block p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs hover:border-[#174EA6]/40 hover:shadow-md transition-all duration-150"
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                  <CheckSquare className="h-5 w-5" />
                </div>
              </div>
              <h3 className="font-bold text-slate-900 mt-3 text-sm group-hover:text-[#174EA6] transition-colors">
                Teacher Assignments
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Configure official Senior High School class advisory sections and subject teacher allocations.
              </p>
            </Link>

            <Link 
              href="/reports" 
              className="group block p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs hover:border-[#174EA6]/40 hover:shadow-md transition-all duration-150"
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                  <BarChart3 className="h-5 w-5" />
                </div>
              </div>
              <h3 className="font-bold text-slate-900 mt-3 text-sm group-hover:text-[#174EA6] transition-colors">
                Institutional Reports
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Review institution-wide verification statistics, progression metrics, and completion summaries.
              </p>
            </Link>

            <Link 
              href="/admin/audit-logs" 
              className="group block p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs hover:border-[#174EA6]/40 hover:shadow-md transition-all duration-150"
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-slate-100 text-slate-700 group-hover:bg-slate-800 group-hover:text-white transition-colors">
                  <ShieldCheck className="h-5 w-5" />
                </div>
              </div>
              <h3 className="font-bold text-slate-900 mt-3 text-sm group-hover:text-[#174EA6] transition-colors">
                User Logs
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Inspect immutable system audit trails, access records, authentication events, and security logs.
              </p>
            </Link>

            <Link 
              href="/settings" 
              className="group block p-4 bg-white rounded-xl border border-slate-200/80 shadow-xs hover:border-[#174EA6]/40 hover:shadow-md transition-all duration-150"
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-teal-50 text-teal-600 group-hover:bg-teal-600 group-hover:text-white transition-colors">
                  <Settings className="h-5 w-5" />
                </div>
              </div>
              <h3 className="font-bold text-slate-900 mt-3 text-sm group-hover:text-[#174EA6] transition-colors">
                Settings
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Configure account security credentials and administrative system settings.
              </p>
            </Link>
          </div>
        </div>

        {/* Lower Grid: Recent System Activity & Pending Approvals */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Recent System Activity (2 cols) */}
          <div className="lg:col-span-2">
            <DashboardCard
              title="Recent Audit Logs"
              description="Authoritative activity trails and security events across the institution"
              headerAction={
                <Link 
                  href="/admin/audit-logs" 
                  className="text-xs font-semibold text-[#174EA6] hover:text-[#0B1F33] hover:underline"
                >
                  View All Logs &rarr;
                </Link>
              }
              padding="none"
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event / Action</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead className="text-right">Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!recentAuditLogs || recentAuditLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-xs text-slate-500 py-8">
                          No recent system activity recorded.
                        </TableCell>
                      </TableRow>
                    ) : (
                      recentAuditLogs.map((log) => {
                        const isSuccess = (log.outcome || "").toUpperCase() === "SUCCESS";
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="font-semibold text-slate-900 text-xs sm:text-sm font-mono">
                              {log.action}
                            </TableCell>
                            <TableCell className="text-xs text-slate-600">
                              {log.actor_email || "System"}
                              {log.actor_role && (
                                <span className="ml-1 text-[10px] text-slate-400 capitalize">
                                  ({log.actor_role})
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-slate-500 uppercase">
                              {log.category}
                            </TableCell>
                            <TableCell>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isSuccess 
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                                  : "bg-red-50 text-red-700 border border-red-200"
                              }`}>
                                {log.outcome || "INFO"}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-xs text-slate-500">
                              {log.created_at ? format(new Date(log.created_at), "MMM d, HH:mm") : "-"}
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

          {/* Pending Verifications Panel (1 col) */}
          <div className="lg:col-span-1">
            <DashboardCard
              title="Verification Queue"
              description="New user registrations awaiting administrator action"
              icon={<Shield className="h-4 w-4 text-amber-600" />}
              className="border-amber-200/80 bg-gradient-to-b from-amber-50/40 to-white"
            >
              <div className="flex-1 flex flex-col">
                {!pendingUsersList || pendingUsersList.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                    <CheckCircle className="h-10 w-10 text-emerald-500 mb-2 opacity-80" />
                    <p className="text-sm font-semibold text-slate-800">Queue is Clear</p>
                    <p className="text-xs text-slate-500 mt-0.5">All faculty registrations are verified.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-slate-600">
                      <strong className="text-slate-900 font-bold">{pendingUsersList.length}</strong> registration{pendingUsersList.length === 1 ? "" : "s"} require administrator review.
                    </p>
                    <div className="space-y-2">
                      {pendingUsersList.map((item) => (
                        <div key={item.id} className="p-3 bg-white rounded-lg border border-amber-200/80 shadow-xs">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-900 truncate">
                              User #{item.user_id?.slice(0, 8)}
                            </span>
                            <span className="text-[10px] uppercase font-semibold text-amber-700 bg-amber-100/60 px-1.5 py-0.2 rounded">
                              {item.role || "Faculty"}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500 block mt-1">
                            Status: Pending Administrator Approval
                          </span>
                        </div>
                      ))}
                    </div>
                    <Link
                      href="/admin/users"
                      className="mt-2 flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-bold text-[#174EA6] bg-[#174EA6]/10 hover:bg-[#174EA6]/20 rounded-lg transition-colors"
                    >
                      <span>Review in User Management</span>
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

"use client";

import { useEffect, useState, useMemo } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import { getUsers, getSchools } from "@/actions/users";
import { 
  CheckCircle2, 
  Clock, 
  XCircle, 
  Users, 
  UserCheck, 
  UserX, 
  ShieldAlert, 
  School,
  Search,
  Filter,
  RefreshCw
} from "lucide-react";
import { UserActions } from "@/components/admin/UserActions";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTableContainer } from "@/components/ui/DataTableContainer";
import { LoadingState } from "@/components/ui/LoadingState";
import { Button } from "@/components/ui/Button";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "declined">("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  async function fetchUsers() {
    setLoading(true);
    const [userRes, schoolRes] = await Promise.all([
      getUsers(),
      getSchools()
    ]);

    if (userRes.error) {
      setError(userRes.error);
    } else {
      setUsers(userRes.users || []);
    }

    if (schoolRes.schools) {
      setSchools(schoolRes.schools);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  // Filtered and computed user lists
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const meta = u.user_metadata || {};
      const fullName = [meta.first_name, meta.middle_name, meta.last_name, meta.name_extension]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const email = (u.email || "").toLowerCase();
      const status = (u.db_account_status || meta.account_status || "Pending").toLowerCase();
      const role = (u.db_role || meta.role || "Teacher").toLowerCase();

      // Search match
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || fullName.includes(q) || email.includes(q);

      // Status filter
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "pending" && status === "pending") ||
        (statusFilter === "approved" && status === "approved") ||
        (statusFilter === "declined" && status === "declined");

      // Role filter
      const matchesRole = roleFilter === "all" || role === roleFilter.toLowerCase();

      return matchesSearch && matchesStatus && matchesRole;
    });
  }, [users, searchQuery, statusFilter, roleFilter]);

  // Statistics
  const pendingCount = users.filter((u) => {
    const s = u.db_account_status || u.user_metadata?.account_status || "Pending";
    return s === "Pending";
  }).length;

  const approvedCount = users.filter((u) => {
    const s = u.db_account_status || u.user_metadata?.account_status;
    return s === "Approved";
  }).length;

  const declinedCount = users.filter((u) => {
    const s = u.db_account_status || u.user_metadata?.account_status;
    return s === "Declined";
  }).length;

  return (
    <PageContainer>
      <Header
        title="User & Account Management"
        description="Review and authorize faculty registrations, assign school scope, and manage administrative role permissions."
        roleBadge={{ role: "admin", label: "System Administrator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "300792" }}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsers}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Refresh List
          </Button>
        }
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* KPI Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Registered Accounts"
            value={users.length}
            icon={<Users className="h-5 w-5 text-slate-700" />}
            variant="default"
          />
          <StatCard
            title="Pending Verification"
            value={pendingCount}
            subtitle={pendingCount > 0 ? "Requires admin action" : "All caught up"}
            icon={<Clock className="h-5 w-5 text-amber-700" />}
            variant={pendingCount > 0 ? "warning" : "default"}
          />
          <StatCard
            title="Approved Faculty"
            value={approvedCount}
            subtitle="Active portal access"
            icon={<UserCheck className="h-5 w-5 text-emerald-700" />}
            variant="success"
          />
          <StatCard
            title="Declined Requests"
            value={declinedCount}
            icon={<UserX className="h-5 w-5 text-red-700" />}
            variant="danger"
          />
        </div>

        {/* Pending Action Banner if any pending users */}
        {pendingCount > 0 && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-200/60 text-amber-900 shrink-0">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-amber-950">
                  {pendingCount} Teacher Registration{pendingCount > 1 ? "s" : ""} Awaiting Review
                </h2>
                <p className="text-xs text-amber-800">
                  New faculty cannot log in until approved and assigned to an institutional school scope.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatusFilter("pending")}
              className="border-amber-300 text-amber-900 hover:bg-amber-100/70"
            >
              Filter Pending Only
            </Button>
          </div>
        )}

        {/* Success & Error Banners */}
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-red-50 p-4 text-xs sm:text-sm text-red-700 border border-red-200 flex items-center justify-between"
          >
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-500 font-bold ml-2">Dismiss</button>
          </div>
        )}
        {success && (
          <div
            role="alert"
            className="rounded-xl bg-emerald-50 p-4 text-xs sm:text-sm text-emerald-700 border border-emerald-200 flex items-center justify-between"
          >
            <span>{success}</span>
            <button onClick={() => setSuccess("")} className="text-emerald-500 font-bold ml-2">Dismiss</button>
          </div>
        )}

        {/* Data Table Container with Filters (colSpan={6} grid alignment) */}
        <DataTableContainer
          title="Registered Personnel"
          description="View and verify teachers, principals, and administrative staff."
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by name or email..."
          itemCount={filteredUsers.length}
          totalCount={users.length}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                aria-label="Filter users by account status"
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending ({pendingCount})</option>
                <option value="approved">Approved ({approvedCount})</option>
                <option value="declined">Declined ({declinedCount})</option>
              </select>

              {/* Role Filter */}
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                aria-label="Filter users by role"
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:bg-white"
              >
                <option value="all">All Roles</option>
                <option value="teacher">Teachers</option>
                <option value="principal">Principals</option>
                <option value="admin">Administrators</option>
              </select>
            </div>
          }
        >
          {loading ? (
            <div className="py-12">
              <LoadingState message="Fetching system users..." subMessage="Loading authorization records" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12 px-4 text-slate-500 text-sm">
              <Users className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-700">No matching user records found</p>
              <p className="text-xs text-slate-400 mt-1">Try adjusting your search or filter criteria.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User / Faculty Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Institutional Scope</TableHead>
                  <TableHead>Account Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => {
                  const meta = user.user_metadata || {};
                  const fullName = [meta.first_name, meta.middle_name, meta.last_name, meta.name_extension]
                    .filter(Boolean)
                    .join(" ");
                  const isPending = user.db_account_status === "Pending" || meta.account_status === "Pending";
                  const isDeclined = user.db_account_status === "Declined" || meta.account_status === "Declined";
                  const role = user.db_role || meta.role || "Teacher";
                  const schoolDisplay = user.school_name || (user.school_id ? "Assigned School" : "Unassigned");

                  return (
                    <TableRow key={user.id} className={isPending ? "bg-amber-50/40" : ""}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900 text-xs sm:text-sm">
                            {fullName || "Unnamed User"}
                          </span>
                          <span className="text-xs text-slate-500 font-mono">
                            {user.email}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold capitalize bg-slate-100 text-slate-800 border border-slate-200">
                          {role}
                        </span>
                      </TableCell>

                      <TableCell>
                        <span className="text-xs text-slate-600 flex items-center gap-1">
                          <School className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[180px]">{schoolDisplay}</span>
                        </span>
                      </TableCell>

                      <TableCell>
                        <StatusBadge
                          status={user.db_account_status || meta.account_status || "Pending"}
                        />
                      </TableCell>

                      <TableCell className="text-right">
                        <UserActions
                          user={user}
                          schools={schools}
                          fetchUsers={fetchUsers}
                          onSuccess={(msg) => setSuccess(msg)}
                          onError={(err) => setError(err)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DataTableContainer>
      </div>
    </PageContainer>
  );
}

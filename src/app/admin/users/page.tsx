"use client";

import { useEffect, useState } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import { getUsers, getSchools } from "@/actions/users";
import { CheckCircle, Clock, XCircle } from "lucide-react";
import { UserActions } from "@/components/admin/UserActions";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

  return (
    <PageContainer>
      <Header title="Users Management" description="Manage registered users and approvals." />
      <div className="mt-6 flex flex-col gap-6">
        <Card padding="md" className="overflow-hidden">
          {error && (
            <div className="mb-4 rounded-sm bg-red-50 p-4 text-sm text-red-700 border border-red-200">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-sm bg-emerald-50 p-4 text-sm text-emerald-700 border border-emerald-200">
              {success}
            </div>
          )}
          
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                      Loading users...
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map(user => {
                    const meta = user.user_metadata || {};
                    const fullName = [meta.first_name, meta.middle_name, meta.last_name, meta.name_extension].filter(Boolean).join(" ");
                    const isPending = user.db_account_status === "Pending" || meta.account_status === "Pending";
                    const isDeclined = user.db_account_status === "Declined" || meta.account_status === "Declined";
                    const role = user.db_role || meta.role || "Teacher";
                    const schoolDisplay = user.school_name || (user.school_id ? "Assigned School" : "Unassigned");
                    
                    return (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.email}</TableCell>
                        <TableCell>{fullName || "N/A"}</TableCell>
                        <TableCell className="capitalize">{role}</TableCell>
                        <TableCell className="text-sm text-slate-600">{schoolDisplay}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${isPending ? 'bg-amber-100 text-amber-800' : isDeclined ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {isPending ? <Clock className="h-3.5 w-3.5" /> : isDeclined ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
                            {user.db_account_status || meta.account_status || "Approved"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <UserActions 
                            user={user} 
                            schools={schools} 
                            fetchUsers={fetchUsers}
                            onSuccess={(msg) => {
                              setSuccess(msg);
                              setError("");
                              setTimeout(() => setSuccess(""), 5000);
                            }}
                            onError={(err) => {
                              setError(err);
                              setSuccess("");
                            }}
                          />
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
    </PageContainer>
  );
}

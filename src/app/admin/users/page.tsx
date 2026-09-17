"use client";

import { useEffect, useState, useTransition } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import { getUsers, approveUser } from "@/actions/users";
import { CheckCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function fetchUsers() {
    setLoading(true);
    const res = await getUsers();
    if (res.error) {
      setError(res.error);
    } else {
      setUsers(res.users || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleApprove = (userId: string) => {
    startTransition(async () => {
      const res = await approveUser(userId);
      if (res.error) {
        alert(res.error);
      } else {
        await fetchUsers();
      }
    });
  };

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
          
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Full Name</TableHead>
                  <TableHead>LPT Info</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                      Loading users...
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map(user => {
                    const meta = user.user_metadata || {};
                    const fullName = [meta.first_name, meta.middle_name, meta.last_name, meta.name_extension].filter(Boolean).join(" ");
                    const isPending = meta.account_status === "Pending";
                    
                    return (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.email}</TableCell>
                        <TableCell>{fullName || "N/A"}</TableCell>
                        <TableCell>{meta.lpt_info || "N/A"}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${isPending ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {isPending ? <Clock className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
                            {meta.account_status || "Active"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {isPending && (
                            <Button 
                              size="sm" 
                              onClick={() => handleApprove(user.id)}
                              disabled={isPending}
                            >
                              Approve
                            </Button>
                          )}
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

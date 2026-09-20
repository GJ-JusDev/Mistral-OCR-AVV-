"use client";

import { useEffect, useState } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import { getUsers, verifyAndRevealPrc } from "@/actions/users";
import { CheckCircle, Clock, XCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { UserActions } from "@/components/admin/UserActions";

function PrcVisibilityCell({ userId, hasPrc }: { userId: string, hasPrc: boolean }) {
  const [isVisible, setIsVisible] = useState(false);
  const [prcValue, setPrcValue] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!hasPrc) return <span className="text-slate-500">N/A</span>;

  const toggleVisibility = () => {
    if (isVisible) {
      setIsVisible(false);
      setPrcValue(null);
    } else {
      setIsModalOpen(true);
      setPassword("");
      setError("");
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    const res = await verifyAndRevealPrc(userId, password);
    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else if (res.prc) {
      setPrcValue(res.prc);
      setIsVisible(true);
      setIsModalOpen(false);
    } else {
      setError("No PRC ID found for this user.");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono tracking-widest text-slate-700">
        {isVisible ? prcValue : "*******"}
      </span>
      <button 
        onClick={toggleVisibility}
        className="text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
        title={isVisible ? "Hide PRC ID" : "Show PRC ID"}
      >
        {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Admin Verification">
        <form onSubmit={handleVerify} className="space-y-4">
          <p className="text-sm text-slate-600">
            Please enter your admin password to view this user's PRC ID.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Enter admin password"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Verifying..." : "Verify & Reveal"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
                  <TableHead>Role</TableHead>
                  <TableHead>PRC Info</TableHead>
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
                    const isPending = meta.account_status === "Pending";
                    const isDeclined = meta.account_status === "Declined";
                    const role = meta.role || "Teacher";
                    
                    return (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.email}</TableCell>
                        <TableCell>{fullName || "N/A"}</TableCell>
                        <TableCell className="capitalize">{role}</TableCell>
                        <TableCell>
                          {role.toLowerCase() === "teacher" ? (
                            <PrcVisibilityCell userId={user.id} hasPrc={meta.has_prc === true} />
                          ) : (
                            "N/A"
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${isPending ? 'bg-amber-100 text-amber-800' : isDeclined ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {isPending ? <Clock className="h-3.5 w-3.5" /> : isDeclined ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
                            {meta.account_status || "Approved"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <UserActions user={user} fetchUsers={fetchUsers} />
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

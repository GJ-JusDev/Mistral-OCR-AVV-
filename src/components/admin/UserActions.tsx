"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { approveUser, declineUser, deleteDeclinedUser, updateUser, verifyAdminPassword } from "@/actions/users";
import { useToast } from "@/components/ui/Toast";
import { 
  Pencil, 
  Trash2, 
  CheckCircle2, 
  ShieldCheck, 
  UserCheck, 
  AlertCircle, 
  Clock, 
  AlertTriangle,
  Lock,
  Mail,
  XCircle
} from "lucide-react";

export function UserActions({ 
  user, 
  schools = [], 
  fetchUsers,
  onSuccess,
  onError
}: { 
  user: any; 
  schools?: any[]; 
  fetchUsers: () => void;
  onSuccess?: (msg: string) => void;
  onError?: (err: string) => void;
}) {
  const { toast } = useToast();
  const [isTransitioning, startTransition] = useTransition();
  const meta = user.user_metadata || {};
  const status = user.db_account_status || meta.account_status || "Pending";
  const role = (user.db_role || meta.role || "Teacher").toLowerCase();

  const isPending = status === "Pending";
  const isDeclined = status === "Declined";
  const isApproved = status === "Approved" || (!user.db_account_status && !meta.account_status);
  const isTeacher = role === "teacher";
  const isAdmin = role === "admin";

  // 24-hour review window evaluation
  const eligibilityTime = user.review_eligibility_time ? new Date(user.review_eligibility_time).getTime() : 0;
  const isEarly = eligibilityTime > Date.now();
  const remainingHours = isEarly ? Math.ceil((eligibilityTime - Date.now()) / (1000 * 60 * 60)) : 0;

  const [activeAction, setActiveAction] = useState<
    "none" | "approve_form" | "decline_form" | "edit_confirm" | "edit_password" | "edit_form" | "delete_declined_confirm"
  >("none");

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Early Approval form state
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [justificationReason, setJustificationReason] = useState("");

  // Decline form state
  const [declineReason, setDeclineReason] = useState("");

  // Default fallback school: TRIS
  const defaultSchoolId = schools.length > 0 
    ? schools[0].id 
    : "a0000000-0000-0000-0000-000000000001";
  
  // Approval state
  const [approveRole, setApproveRole] = useState("teacher");
  const [approveSchoolId, setApproveSchoolId] = useState(user.school_id || defaultSchoolId);

  // Edit form state
  const [formData, setFormData] = useState({
    first_name: meta.first_name || "",
    last_name: meta.last_name || "",
    role: user.db_role ? (user.db_role.charAt(0).toUpperCase() + user.db_role.slice(1)) : (meta.role || "Teacher"),
    school_id: user.school_id || defaultSchoolId,
  });

  const onOpenApproveModal = () => {
    setError("");
    setAdminPassword("");
    setConfirmationPhrase("");
    setJustificationReason("");
    setApproveRole("teacher");
    setApproveSchoolId(user.school_id || defaultSchoolId);
    setActiveAction("approve_form");
  };

  const onOpenDeclineModal = () => {
    setError("");
    setDeclineReason("");
    setActiveAction("decline_form");
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    const res = await approveUser(user.id, approveSchoolId, approveRole, {
      adminPassword,
      confirmationPhrase,
      justificationReason,
      isEarlyApproval: isEarly,
    });
    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else {
      toast({
        title: isEarly ? "Early Approval Granted" : "Faculty Account Approved",
        description: `Successfully authorized access for ${user.email}.`,
        variant: "success",
      });
      closeAction();
      fetchUsers();
    }
  };

  const handleDeclineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!declineReason.trim()) {
      setError("Please provide a reason for declining this registration.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    const res = await declineUser(user.id, declineReason);
    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else {
      toast({
        title: "Registration Declined",
        description: `Registration for ${user.email} has been declined.`,
        variant: "success",
      });
      closeAction();
      fetchUsers();
    }
  };

  const closeAction = () => {
    setActiveAction("none");
    setPassword("");
    setAdminPassword("");
    setConfirmationPhrase("");
    setJustificationReason("");
    setDeclineReason("");
    setError("");
    setIsSubmitting(false);
  };

  const verifyPassword = async () => {
    setIsSubmitting(true);
    setError("");
    const res = await verifyAdminPassword(password);
    setIsSubmitting(false);
    return res;
  };

  const onEditConfirm = () => setActiveAction("edit_password");

  const handleDeleteDeclinedSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    setError("");

    const res = await deleteDeclinedUser(user.id);
    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
      if (onError) onError(res.error);
      toast({
        title: "Deletion Failed",
        description: res.error,
        variant: "error",
      });
    } else {
      const successMsg = "Declined teacher account has been successfully deleted.";
      if (onSuccess) onSuccess(successMsg);
      toast({
        title: "Account Deleted",
        description: successMsg,
        variant: "success",
      });
      closeAction();
      fetchUsers();
    }
  };

  const onEditPasswordSubmitKeepPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await verifyPassword();
    if ("error" in res && res.error) {
      setError(res.error as string);
    } else {
      setActiveAction("edit_form");
    }
  };

  const onEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    const res = await updateUser(user.id, password, formData);
    setIsSubmitting(false);
    
    if ("error" in res && res.error) {
      setError(res.error as string);
    } else {
      closeAction();
      fetchUsers();
    }
  };

  return (
    <>
      {/* 1. Pending accounts: Show Approve and Decline */}
      {isPending && (
        <div className="flex items-center justify-end gap-1.5">
          <Button 
            size="sm" 
            onClick={onOpenApproveModal} 
            disabled={isTransitioning} 
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> 
            {isEarly ? "Early Approve" : "Approve"}
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={onOpenDeclineModal} 
            disabled={isTransitioning} 
            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
          >
            Decline
          </Button>
        </div>
      )}

      {/* 2. Declined teacher accounts: Show a red Delete button with a trash icon */}
      {isDeclined && isTeacher && (
        <div className="flex items-center justify-end gap-1.5">
          <Button 
            size="sm" 
            variant="outline" 
            onClick={() => {
              setError("");
              setActiveAction("delete_declined_confirm");
            }} 
            disabled={isTransitioning || isSubmitting}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1 text-red-600" /> Delete
          </Button>
        </div>
      )}

      {/* 3. Approved accounts: Show Edit only. */}
      {isApproved && !isAdmin && (
        <div className="flex items-center justify-end gap-1.5">
          <Button 
            size="sm" 
            variant="outline" 
            onClick={() => setActiveAction("edit_confirm")} 
            className="text-[#174EA6] hover:text-[#0B1F33] hover:bg-[#174EA6]/5 border-slate-300"
          >
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        </div>
      )}

      {/* Approve Modal */}
      <Modal 
        isOpen={activeAction === "approve_form"} 
        onClose={closeAction} 
        title={isEarly ? "Instant Administrator Early Approval" : "Authorize Faculty Access"}
        size="lg"
      >
        <form onSubmit={handleApproveSubmit} className="space-y-4">
          {/* Metrics & Status Snapshot Card */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <span className="text-slate-500 font-medium">Applicant Email:</span>
              <span className="font-mono font-semibold text-slate-800">{user.email}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Email Verification:</span>
              {user.email_confirmed ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Confirmed
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-800 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> Unconfirmed (Action Blocked)
                </span>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Registry Match Status:</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                user.registry_match_status === "MATCHED" 
                  ? "bg-emerald-100 text-emerald-800" 
                  : user.registry_match_status === "NOT_FOUND"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-200 text-slate-800"
              }`}>
                {user.registry_match_status || "PENDING EVALUATION"}
              </span>
            </div>

            {user.matched_teacher_name && (
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Matched Roster Entry:</span>
                <span className="font-semibold text-slate-800">{user.matched_teacher_name}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-500 font-medium">Review Window:</span>
              {isEarly ? (
                <span className="font-semibold text-amber-700 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> Early Approval ({remainingHours}h remaining in 24h window)
                </span>
              ) : (
                <span className="font-semibold text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 24h Window Completed
                </span>
              )}
            </div>
          </div>

          {/* Email unconfirmed warning */}
          {!user.email_confirmed && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
              <div>
                <strong>Email Verification Required:</strong> This applicant has not yet confirmed their email address via Supabase Auth email verification. Approvals are strictly blocked until the user confirms their email address.
              </div>
            </div>
          )}

          {/* Role and School Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Role</label>
              <select 
                value={approveRole} 
                onChange={e => setApproveRole(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
              >
                <option value="teacher">Teacher (Upload SF9/SF10 & OCR)</option>
                <option value="principal">Principal (Executive review & approval)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned School</label>
              <select 
                value={approveSchoolId} 
                onChange={e => setApproveSchoolId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
              >
                {schools.length > 0 ? (
                  schools.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.school_id})
                    </option>
                  ))
                ) : (
                  <option value="a0000000-0000-0000-0000-000000000001">
                    Taysan Resettlement Integrated School (500169)
                  </option>
                )}
              </select>
            </div>
          </div>

          {/* Early Approval Additional Verification Requirements */}
          {isEarly && (
            <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-300/80 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                <ShieldCheck className="h-4 w-4 text-amber-700" />
                <span>Early Approval Security Verification</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Justification Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={2}
                  value={justificationReason}
                  onChange={e => setJustificationReason(e.target.value)}
                  placeholder="e.g. Identity verified in-person with DepEd PRC ID during faculty meeting"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Type Confirmation Phrase: <code className="bg-amber-200/80 px-1 py-0.5 rounded font-mono font-bold text-amber-950">ADD THIS USER</code> <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={confirmationPhrase}
                  onChange={e => setConfirmationPhrase(e.target.value)}
                  placeholder="ADD THIS USER"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono text-slate-900 focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Administrator Password Re-authentication <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={adminPassword}
                  onChange={e => setAdminPassword(e.target.value)}
                  placeholder="Enter your administrator password"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</p>}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={closeAction}>Cancel</Button>
            <Button 
              type="submit" 
              size="sm" 
              disabled={isSubmitting || !user.email_confirmed || (isEarly && (confirmationPhrase.trim() !== "ADD THIS USER" || !justificationReason.trim() || !adminPassword))} 
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSubmitting ? "Authorizing..." : isEarly ? "Grant Early Approval" : "Confirm Approval"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Decline Modal */}
      <Modal isOpen={activeAction === "decline_form"} onClose={closeAction} title="Decline Faculty Registration">
        <form onSubmit={handleDeclineSubmit} className="space-y-4">
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
            You are about to decline the registration for <strong>{user.email}</strong>. The applicant will not be allowed to access the system and will be unlinked from the registry.
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Decline Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="e.g. Identity cannot be validated against official DepEd school roster; duplicate account"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-red-500 focus:ring-1 focus:ring-red-500"
            />
          </div>

          {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</p>}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={closeAction}>Cancel</Button>
            <Button 
              type="submit" 
              size="sm" 
              disabled={isSubmitting || !declineReason.trim()} 
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isSubmitting ? "Declining..." : "Confirm Decline"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Declined Account Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={activeAction === "delete_declined_confirm"}
        onClose={closeAction}
        onConfirm={handleDeleteDeclinedSubmit}
        title="Delete Declined Account?"
        description="Are you sure you want to delete this declined account? This action cannot be undone."
        confirmLabel="Delete Account"
        cancelLabel="Cancel"
        variant="danger"
        isSubmitting={isSubmitting}
        isLoading={isSubmitting}
      />

      {/* Edit Confirmation Modal */}
      <Modal isOpen={activeAction === "edit_confirm"} onClose={closeAction} title="Confirm Profile Modification">
        <p className="mb-4 text-xs sm:text-sm text-slate-600">
          You are about to edit the registered profile, role, or school assignment for <strong>{user.email}</strong>. Admin password verification is required.
        </p>
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="outline" size="sm" onClick={closeAction}>Cancel</Button>
          <Button size="sm" onClick={onEditConfirm}>Proceed to Verify</Button>
        </div>
      </Modal>

      {/* Edit Password Verification Modal */}
      <Modal isOpen={activeAction === "edit_password"} onClose={closeAction} title="Administrator Authentication">
        <form onSubmit={onEditPasswordSubmitKeepPassword} className="space-y-4">
          <p className="text-xs sm:text-sm text-slate-600">Please re-enter your administrator password to unlock user editing.</p>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Admin Password</label>
            <input 
              type="password" 
              required 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:outline-none focus:ring-1 focus:ring-[#174EA6]" 
              placeholder="Enter admin password" 
            />
          </div>
          {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</p>}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button 
              type="button" 
              variant="outline" 
              onClick={closeAction}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>{isSubmitting ? "Verifying..." : "Verify & Unlock"}</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Form Modal with Principal Role and School Selection */}
      <Modal isOpen={activeAction === "edit_form"} onClose={closeAction} title="Modify User Account">
        <form onSubmit={onEditSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">First Name</label>
              <input 
                type="text" 
                required 
                value={formData.first_name} 
                onChange={e => setFormData({ ...formData, first_name: e.target.value })} 
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:outline-none" 
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Last Name</label>
              <input 
                type="text" 
                required 
                value={formData.last_name} 
                onChange={e => setFormData({ ...formData, last_name: e.target.value })} 
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:outline-none" 
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">System Role</label>
            <select 
              value={formData.role} 
              onChange={e => setFormData({ ...formData, role: e.target.value })} 
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:outline-none"
            >
              <option value="Teacher">Teacher</option>
              <option value="Principal">Principal</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Institutional School Assignment</label>
            <select 
              value={formData.school_id} 
              onChange={e => setFormData({ ...formData, school_id: e.target.value })} 
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:outline-none"
            >
              {schools.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.school_id})</option>
              ))}
            </select>
          </div>
          {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</p>}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={closeAction} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Changes"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

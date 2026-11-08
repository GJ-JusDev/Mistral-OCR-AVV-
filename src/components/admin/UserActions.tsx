import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { approveUser, declineUser, deleteDeclinedUser, updateUser, verifyAdminPassword } from "@/actions/users";
import { useToast } from "@/components/ui/Toast";
import { Pencil, Trash2, CheckCircle2, ShieldCheck, UserCheck } from "lucide-react";

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

  const [activeAction, setActiveAction] = useState<
    "none" | "approve_form" | "edit_confirm" | "edit_password" | "edit_form" | "delete_declined_confirm"
  >("none");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    setApproveRole("teacher");
    setApproveSchoolId(user.school_id || defaultSchoolId);
    setActiveAction("approve_form");
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    const res = await approveUser(user.id, approveSchoolId, approveRole);
    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else {
      closeAction();
      fetchUsers();
    }
  };

  const handleDecline = () => {
    if (!confirm("Are you sure you want to decline this registration?")) return;
    startTransition(async () => {
      const res = await declineUser(user.id);
      if (res.error) alert(res.error);
      else fetchUsers();
    });
  };

  const closeAction = () => {
    setActiveAction("none");
    setPassword("");
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
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleDecline} 
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

      {/* 3. Approved accounts: Show Edit only. Do NOT show Delete. Admin accounts: Never show Delete */}
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

      {/* Approve Modal with School Selection and Role */}
      <Modal isOpen={activeAction === "approve_form"} onClose={closeAction} title="Authorize Faculty Access">
        <form onSubmit={handleApproveSubmit} className="space-y-4">
          <div className="p-3 rounded-lg bg-[#174EA6]/5 border border-[#174EA6]/15 text-xs text-[#0B1F33]">
            Assign institutional school scope and system role for: <strong>{user.email}</strong>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Role</label>
            <select 
              value={approveRole} 
              onChange={e => setApproveRole(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6] focus:outline-none"
            >
              <option value="teacher">Teacher (Upload SF9/SF10 & OCR review)</option>
              <option value="principal">Principal (School-head review & document approval)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned School</label>
            <select 
              value={approveSchoolId} 
              onChange={e => setApproveSchoolId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6] focus:outline-none"
            >
              {schools.length > 0 ? (
                schools.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.school_id})
                  </option>
                ))
              ) : (
                <option value="a0000000-0000-0000-0000-000000000001">
                  Taysan Resettlement Integrated School (300792)
                </option>
              )}
            </select>
          </div>

          {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</p>}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={closeAction}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isSubmitting} className="bg-[#174EA6] hover:bg-[#0B1F33] text-white">
              {isSubmitting ? "Authorizing..." : "Confirm Approval"}
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned School</label>
            <select 
              value={formData.school_id} 
              onChange={e => setFormData({ ...formData, school_id: e.target.value })} 
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[#174EA6] focus:outline-none"
            >
              {schools.length > 0 ? (
                schools.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.school_id})
                  </option>
                ))
              ) : (
                <option value="a0000000-0000-0000-0000-000000000001">
                  Taysan Resettlement Integrated School (300792)
                </option>
              )}
            </select>
          </div>
          {error && <p className="text-xs font-medium text-red-600 bg-red-50 p-2 rounded border border-red-200">{error}</p>}
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={closeAction}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Changes"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

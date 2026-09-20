import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { approveUser, declineUser, deleteUserAction, updateUser, verifyAdminPassword } from "@/actions/users";
import { Pencil, Trash2 } from "lucide-react";

export function UserActions({ user, fetchUsers }: { user: any, fetchUsers: () => void }) {
  const [isTransitioning, startTransition] = useTransition();
  const meta = user.user_metadata || {};
  const isPending = meta.account_status === "Pending";
  const isApproved = meta.account_status === "Approved" || !meta.account_status;
  const isAdmin = meta.role?.toLowerCase() === "admin";

  const [activeAction, setActiveAction] = useState<"none" | "edit_confirm" | "edit_password" | "edit_form" | "delete_confirm" | "delete_password">("none");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    first_name: meta.first_name || "",
    last_name: meta.last_name || "",
    role: meta.role || "Teacher",
  });

  const handleApprove = () => {
    startTransition(async () => {
      const res = await approveUser(user.id);
      if (res.error) alert(res.error);
      else fetchUsers();
    });
  };

  const handleDecline = () => {
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
  };

  const verifyPassword = async () => {
    setIsSubmitting(true);
    setError("");
    const res = await verifyAdminPassword(password);
    setIsSubmitting(false);
    return res;
  };

  const onEditConfirm = () => setActiveAction("edit_password");
  const onDeleteConfirm = () => setActiveAction("delete_password");

  const onEditPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await verifyPassword();
    if ("error" in res && res.error) {
      setError(res.error as string);
    } else {
      setActiveAction("edit_form");
      setPassword("");
    }
  };

  const onDeletePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    const res = await deleteUserAction(user.id, password);
    setIsSubmitting(false);
    if ("error" in res && res.error) {
      setError(res.error as string);
    } else {
      closeAction();
      fetchUsers();
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

  // Keep password in state
  const onEditPasswordSubmitKeepPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await verifyPassword();
    if ("error" in res && res.error) {
      setError(res.error as string);
    } else {
      setActiveAction("edit_form");
      // Don't clear password yet so we can use it in onEditSubmit
    }
  };

  if (isPending) {
    return (
      <div className="flex gap-2">
        <Button size="sm" onClick={handleApprove} disabled={isTransitioning}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={handleDecline} disabled={isTransitioning} className="text-red-600 hover:text-red-700 hover:bg-red-50">
          Decline
        </Button>
      </div>
    );
  }

  if (isApproved && !isAdmin) {
    return (
      <>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setActiveAction("edit_confirm")} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2">
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => setActiveAction("delete_confirm")} className="text-red-600 hover:text-red-700 hover:bg-red-50 px-2">
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>

        {/* Edit Modals */}
        <Modal isOpen={activeAction === "edit_confirm"} onClose={closeAction} title="Confirm Edit">
          <p className="mb-6 text-sm text-slate-600">Do you want to edit this user?</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeAction}>Cancel</Button>
            <Button onClick={onEditConfirm}>Confirm</Button>
          </div>
        </Modal>

        <Modal isOpen={activeAction === "edit_password"} onClose={closeAction} title="Admin Verification">
          <form onSubmit={onEditPasswordSubmitKeepPassword} className="space-y-4">
            <p className="text-sm text-slate-600">Please enter your admin password to proceed to the edit form.</p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Enter admin password" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeAction}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Verifying..." : "Verify & Proceed"}</Button>
            </div>
          </form>
        </Modal>

        <Modal isOpen={activeAction === "edit_form"} onClose={closeAction} title="Edit User">
          <form onSubmit={onEditSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
              <input type="text" required value={formData.first_name} onChange={e => setFormData({ ...formData, first_name: e.target.value })} className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
              <input type="text" required value={formData.last_name} onChange={e => setFormData({ ...formData, last_name: e.target.value })} className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none">
                <option value="Teacher">Teacher</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeAction}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Changes"}</Button>
            </div>
          </form>
        </Modal>

        {/* Delete Modals */}
        <Modal isOpen={activeAction === "delete_confirm"} onClose={closeAction} title="Confirm Deletion">
          <p className="mb-6 text-sm text-slate-600">Do you want to delete this user?</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeAction}>Cancel</Button>
            <Button variant="danger" onClick={onDeleteConfirm}>Confirm</Button>
          </div>
        </Modal>

        <Modal isOpen={activeAction === "delete_password"} onClose={closeAction} title="Admin Verification">
          <form onSubmit={onDeletePasswordSubmit} className="space-y-4">
            <p className="text-sm text-slate-600">Please enter your admin password to confirm deletion.</p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Enter admin password" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeAction}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={isSubmitting}>{isSubmitting ? "Deleting..." : "Delete User"}</Button>
            </div>
          </form>
        </Modal>
      </>
    );
  }

  return <span className="text-slate-500 text-sm">No actions</span>;
}

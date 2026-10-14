import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { approveUser, declineUser, deleteUserAction, updateUser, verifyAdminPassword } from "@/actions/users";
import { Pencil, Trash2, CheckCircle2 } from "lucide-react";

export function UserActions({ 
  user, 
  schools = [], 
  fetchUsers 
}: { 
  user: any; 
  schools?: any[]; 
  fetchUsers: () => void; 
}) {
  const [isTransitioning, startTransition] = useTransition();
  const meta = user.user_metadata || {};
  const isPending = user.db_account_status === "Pending" || meta.account_status === "Pending";
  const isApproved = user.db_account_status === "Approved" || meta.account_status === "Approved" || (!user.db_account_status && !meta.account_status);
  const isAdmin = (user.db_role || meta.role)?.toLowerCase() === "admin";

  const [activeAction, setActiveAction] = useState<
    "none" | "approve_form" | "edit_confirm" | "edit_password" | "edit_form" | "delete_confirm" | "delete_password"
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
  const onDeleteConfirm = () => setActiveAction("delete_password");

  const onEditPasswordSubmitKeepPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await verifyPassword();
    if ("error" in res && res.error) {
      setError(res.error as string);
    } else {
      setActiveAction("edit_form");
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

  return (
    <>
      {isPending && (
        <div className="flex gap-2">
          <Button size="sm" onClick={onOpenApproveModal} disabled={isTransitioning} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={handleDecline} disabled={isTransitioning} className="text-red-600 hover:text-red-700 hover:bg-red-50">
            Decline
          </Button>
        </div>
      )}

      {isApproved && !isAdmin && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setActiveAction("edit_confirm")} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2">
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
          <Button size="sm" variant="outline" onClick={() => setActiveAction("delete_confirm")} className="text-red-600 hover:text-red-700 hover:bg-red-50 px-2">
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
        </div>
      )}

      {/* Approve Modal with School Selection and Role */}
      <Modal isOpen={activeAction === "approve_form"} onClose={closeAction} title="Approve Staff Registration">
        <form onSubmit={handleApproveSubmit} className="space-y-4">
          <p className="text-sm text-slate-600">
            Assign school and role before approving access for <strong>{user.email}</strong>.
          </p>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Assigned Role</label>
            <select 
              value={approveRole} 
              onChange={e => setApproveRole(e.target.value)}
              className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="teacher">Teacher (Upload SF9/SF10 & OCR review)</option>
              <option value="principal">Principal (School-head review & document approval)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Assigned School</label>
            <select 
              value={approveSchoolId} 
              onChange={e => setApproveSchoolId(e.target.value)}
              className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
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

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={closeAction}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Approving..." : "Confirm Approval"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Confirmation Modal */}
      <Modal isOpen={activeAction === "edit_confirm"} onClose={closeAction} title="Confirm Edit">
        <p className="mb-6 text-sm text-slate-600">Do you want to edit this user's profile, role, or school assignment?</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeAction}>Cancel</Button>
          <Button onClick={onEditConfirm}>Confirm</Button>
        </div>
      </Modal>

      {/* Edit Password Verification Modal */}
      <Modal isOpen={activeAction === "edit_password"} onClose={closeAction} title="Admin Verification">
        <form onSubmit={onEditPasswordSubmitKeepPassword} className="space-y-4">
          <p className="text-sm text-slate-600">Please enter your admin password to proceed to the edit form.</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input 
              type="password" 
              required 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" 
              placeholder="Enter admin password" 
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={closeAction}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Verifying..." : "Verify & Proceed"}</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Form Modal with Principal Role and School Selection */}
      <Modal isOpen={activeAction === "edit_form"} onClose={closeAction} title="Edit User">
        <form onSubmit={onEditSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">First Name</label>
            <input 
              type="text" 
              required 
              value={formData.first_name} 
              onChange={e => setFormData({ ...formData, first_name: e.target.value })} 
              className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Last Name</label>
            <input 
              type="text" 
              required 
              value={formData.last_name} 
              onChange={e => setFormData({ ...formData, last_name: e.target.value })} 
              className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select 
              value={formData.role} 
              onChange={e => setFormData({ ...formData, role: e.target.value })} 
              className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="Teacher">Teacher</option>
              <option value="Principal">Principal</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Assigned School</label>
            <select 
              value={formData.school_id} 
              onChange={e => setFormData({ ...formData, school_id: e.target.value })} 
              className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
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
            <input 
              type="password" 
              required 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full rounded-sm border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" 
              placeholder="Enter admin password" 
            />
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

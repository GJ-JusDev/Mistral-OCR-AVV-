"use client";

import { useEffect, useState, useMemo } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import { StatCard } from "@/components/ui/StatCard";
import { DataTableContainer } from "@/components/ui/DataTableContainer";
import { LoadingState } from "@/components/ui/LoadingState";
import { useToast } from "@/components/ui/Toast";
import { 
  getRegistryTeachers, 
  addRegistryTeacher, 
  updateRegistryTeacher, 
  toggleRegistryTeacherActive, 
  verifyRegistryTeacher,
  importTeacherRegistry,
  generateRegistryTemplate,
  ImportPreviewResult
} from "@/actions/registry";
import { 
  GraduationCap, 
  Plus, 
  Upload, 
  Download, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Pencil, 
  Power, 
  PowerOff, 
  FileSpreadsheet, 
  RefreshCw,
  Mail,
  ShieldCheck,
  UserCheck,
  AlertTriangle
} from "lucide-react";

export default function TeacherRegistryPage() {
  const { toast } = useToast();
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "verified" | "unverified" | "inactive">("all");

  // Modal states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<any>(null);

  // Form states
  const [formData, setFormData] = useState({
    firstName: "",
    middleInitial: "",
    lastName: "",
    verifiedEmail: "",
  });
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Import states
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null);
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  async function fetchRegistry() {
    setLoading(true);
    const res = await getRegistryTeachers();
    if (res.error) {
      toast({
        title: "Error Loading Registry",
        description: res.error,
        variant: "error",
      });
    } else {
      setTeachers(res.teachers || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchRegistry();
  }, []);

  const filteredTeachers = useMemo(() => {
    return teachers.filter((t) => {
      const full = `${t.first_name} ${t.middle_initial || ""} ${t.last_name}`.toLowerCase();
      const email = (t.verified_email || "").toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || full.includes(q) || email.includes(q);

      let matchesStatus = true;
      if (statusFilter === "verified") {
        matchesStatus = t.is_active && t.verification_status === "verified";
      } else if (statusFilter === "unverified") {
        matchesStatus = t.is_active && t.verification_status === "unverified";
      } else if (statusFilter === "inactive") {
        matchesStatus = !t.is_active;
      }

      return matchesSearch && matchesStatus;
    });
  }, [teachers, searchQuery, statusFilter]);

  const verifiedCount = teachers.filter((t) => t.is_active && t.verification_status === "verified").length;
  const unverifiedCount = teachers.filter((t) => t.is_active && t.verification_status === "unverified").length;
  const inactiveCount = teachers.filter((t) => !t.is_active).length;

  const handleOpenAdd = () => {
    setFormData({ firstName: "", middleInitial: "", lastName: "", verifiedEmail: "" });
    setFormError("");
    setIsAddOpen(true);
  };

  const handleOpenEdit = (t: any) => {
    setSelectedTeacher(t);
    setFormData({
      firstName: t.first_name,
      middleInitial: t.middle_initial || "",
      lastName: t.last_name,
      verifiedEmail: t.verified_email || "",
    });
    setFormError("");
    setIsEditOpen(true);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError("");

    const res = await addRegistryTeacher({
      firstName: formData.firstName,
      middleInitial: formData.middleInitial,
      lastName: formData.lastName,
      verifiedEmail: formData.verifiedEmail,
    });

    setIsSubmitting(false);
    if (res.error) {
      setFormError(res.error);
    } else {
      toast({
        title: "Teacher Added",
        description: `${formData.firstName} ${formData.lastName} has been added to the registry.`,
        variant: "success",
      });
      setIsAddOpen(false);
      fetchRegistry();
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacher) return;
    setIsSubmitting(true);
    setFormError("");

    const res = await updateRegistryTeacher(selectedTeacher.id, {
      firstName: formData.firstName,
      middleInitial: formData.middleInitial,
      lastName: formData.lastName,
      verifiedEmail: formData.verifiedEmail,
    });

    setIsSubmitting(false);
    if (res.error) {
      setFormError(res.error);
    } else {
      toast({
        title: "Teacher Record Updated",
        description: "The teacher registry entry was updated successfully.",
        variant: "success",
      });
      setIsEditOpen(false);
      fetchRegistry();
    }
  };

  const handleToggleActive = async (teacher: any) => {
    const newState = !teacher.is_active;
    const confirmMsg = newState
      ? `Reactivate registry entry for ${teacher.full_name_original}?`
      : `Deactivate registry entry for ${teacher.full_name_original}? Deactivated entries cannot match new self-registrations.`;

    if (!confirm(confirmMsg)) return;

    const res = await toggleRegistryTeacherActive(teacher.id, newState);
    if (res.error) {
      toast({
        title: "Operation Failed",
        description: res.error,
        variant: "error",
      });
    } else {
      toast({
        title: newState ? "Record Reactivated" : "Record Deactivated",
        description: `${teacher.full_name_original} is now ${newState ? "active" : "deactivated"}.`,
        variant: "success",
      });
      fetchRegistry();
    }
  };

  const handleVerify = async (teacher: any) => {
    if (!confirm(`Mark registry entry for ${teacher.full_name_original} as officially verified?`)) return;

    const res = await verifyRegistryTeacher(teacher.id);
    if (res.error) {
      toast({
        title: "Verification Failed",
        description: res.error,
        variant: "error",
      });
    } else {
      toast({
        title: "Teacher Verified",
        description: `${teacher.full_name_original} has been marked as verified.`,
        variant: "success",
      });
      fetchRegistry();
    }
  };

  const handleDownloadTemplate = async (format: "xlsx" | "csv") => {
    const res = await generateRegistryTemplate(format);
    if (!res.base64) return;

    const byteCharacters = atob(res.base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: res.contentType });

    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.download = res.filename;
    link.click();
    window.URL.revokeObjectURL(link.href);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setImportError("File size exceeds 5MB limit.");
      return;
    }

    setImportFile(file);
    setImportError("");
    setIsImporting(true);

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = (evt.target?.result as string)?.split(",")?.[1];
        if (!base64) {
          setImportError("Failed to read file.");
          setIsImporting(false);
          return;
        }

        const res = await importTeacherRegistry(base64, file.name, true);
        setIsImporting(false);
        if (res.error) {
          setImportError(res.error);
        } else if (res.preview) {
          setImportPreview(res.preview);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setImportError(err.message || "Failed to process file.");
      setIsImporting(false);
    }
  };

  const handleCommitImport = async () => {
    if (!importFile || !importPreview) return;
    setIsImporting(true);
    setImportError("");

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = (evt.target?.result as string)?.split(",")?.[1];
        if (!base64) {
          setImportError("Failed to read file.");
          setIsImporting(false);
          return;
        }

        const res = await importTeacherRegistry(base64, importFile.name, false);
        setIsImporting(false);
        if (res.error) {
          setImportError(res.error);
        } else {
          toast({
            title: "Import Successful",
            description: `Successfully imported ${res.importedCount} teachers to the official registry.`,
            variant: "success",
          });
          setIsImportOpen(false);
          setImportFile(null);
          setImportPreview(null);
          fetchRegistry();
        }
      };
      reader.readAsDataURL(importFile);
    } catch (err: any) {
      setImportError(err.message || "Failed to commit import.");
      setIsImporting(false);
    }
  };

  return (
    <PageContainer>
      <Header
        title="Teacher Registry Management"
        description="Institutional faculty roster for Taysan Resettlement Integrated School (School ID: 500169). Authorized records allow deterministic matching and secure self-registration."
        roleBadge={{ role: "admin", label: "System Administrator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "500169" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchRegistry}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Refresh
            </Button>
            <div className="relative inline-block text-left group">
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Download className="h-3.5 w-3.5" />}
              >
                Template
              </Button>
              <div className="absolute right-0 z-20 mt-1 hidden w-44 rounded-lg bg-white p-1 shadow-lg ring-1 ring-black/5 group-hover:block">
                <button
                  onClick={() => handleDownloadTemplate("xlsx")}
                  className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Excel Format (.xlsx)</span>
                </button>
                <button
                  onClick={() => handleDownloadTemplate("csv")}
                  className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600" />
                  <span>CSV Format (.csv)</span>
                </button>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setImportFile(null);
                setImportPreview(null);
                setImportError("");
                setIsImportOpen(true);
              }}
              leftIcon={<Upload className="h-3.5 w-3.5" />}
            >
              Bulk Import
            </Button>
            <Button
              size="sm"
              onClick={handleOpenAdd}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              className="bg-[#174EA6] hover:bg-[#123E85] text-white"
            >
              Add Teacher
            </Button>
          </div>
        }
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Registry Records"
            value={teachers.length}
            icon={<GraduationCap className="h-5 w-5 text-slate-700" />}
            variant="default"
          />
          <StatCard
            title="Verified Faculty"
            value={verifiedCount}
            subtitle="Eligible for auto-approval"
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-700" />}
            variant="success"
          />
          <StatCard
            title="Unverified Entries"
            value={unverifiedCount}
            subtitle="Requires admin verification"
            icon={<Clock className="h-5 w-5 text-amber-700" />}
            variant={unverifiedCount > 0 ? "warning" : "default"}
          />
          <StatCard
            title="Deactivated Records"
            value={inactiveCount}
            subtitle="Excluded from matching"
            icon={<PowerOff className="h-5 w-5 text-slate-500" />}
            variant="default"
          />
        </div>

        {/* Informational Guidance Notice */}
        <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200/80 flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-[#174EA6] shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-blue-950 leading-relaxed">
            <strong>DepEd Faculty Verification Architecture:</strong> When a prospective teacher registers with their personal Gmail, the system performs a deterministic server-side match against this registry by First Name, Middle Initial, and Last Name. Registrations matching a <span className="font-semibold text-emerald-800">Verified</span> registry record are automatically approved after a 24-hour review period, or can be instantly approved early by an Administrator.
          </div>
        </div>

        {/* Data Table */}
        <DataTableContainer
          title="Official Faculty Roster"
          description="View, verify, edit, and deactivate authorized teacher records."
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search teacher by name or Gmail..."
          itemCount={filteredTeachers.length}
          totalCount={teachers.length}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                aria-label="Filter by registry status"
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:bg-white"
              >
                <option value="all">All Registry Entries ({teachers.length})</option>
                <option value="verified">Verified Only ({verifiedCount})</option>
                <option value="unverified">Unverified Only ({unverifiedCount})</option>
                <option value="inactive">Deactivated ({inactiveCount})</option>
              </select>
            </div>
          }
        >
          {loading ? (
            <div className="py-12">
              <LoadingState message="Fetching official registry..." subMessage="Loading DepEd faculty records" />
            </div>
          ) : filteredTeachers.length === 0 ? (
            <div className="text-center py-12 px-4 text-slate-500 text-sm">
              <GraduationCap className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-700">No registry records found</p>
              <p className="text-xs text-slate-400 mt-1">Try adjusting your search query or status filter.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher Name</TableHead>
                  <TableHead>Middle Initial</TableHead>
                  <TableHead>Designated Gmail</TableHead>
                  <TableHead>Verification Status</TableHead>
                  <TableHead>Account Link</TableHead>
                  <TableHead>Roster Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTeachers.map((teacher) => {
                  const isVerified = teacher.verification_status === "verified";
                  const isActive = teacher.is_active;

                  return (
                    <TableRow key={teacher.id} className={!isActive ? "bg-slate-50/60 opacity-75" : ""}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900 text-xs sm:text-sm">
                            {teacher.full_name_original || `${teacher.first_name} ${teacher.last_name}`}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {teacher.last_name.toUpperCase()}, {teacher.first_name}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        {teacher.middle_initial ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                            {teacher.middle_initial}.
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">None</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {teacher.verified_email ? (
                          <span className="text-xs font-mono text-slate-700 flex items-center gap-1">
                            <Mail className="h-3 w-3 text-slate-400 shrink-0" />
                            {teacher.verified_email}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Any @gmail.com</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {isVerified ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" />
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="h-3 w-3" />
                            Unverified
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        {teacher.linked_user_id ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-[#174EA6] border border-blue-200">
                            <UserCheck className="h-3 w-3" />
                            Linked ({teacher.linkedUserStatus || "Active"})
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Unclaimed</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {isActive ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                            Deactivated
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!isVerified && isActive && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleVerify(teacher)}
                              className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200"
                              title="Mark verified"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Verify
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenEdit(teacher)}
                            className="text-[#174EA6] hover:bg-blue-50 border-slate-200"
                            title="Edit details"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleToggleActive(teacher)}
                            className={isActive ? "text-slate-600 hover:text-red-700 hover:bg-red-50 border-slate-200" : "text-emerald-700 hover:bg-emerald-50 border-emerald-200"}
                            title={isActive ? "Deactivate entry" : "Reactivate entry"}
                          >
                            {isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DataTableContainer>
      </div>

      {/* MODAL 1: Add Teacher */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Add Teacher to Registry">
        <form onSubmit={handleAddSubmit} className="space-y-4">
          <div className="p-3 rounded-lg bg-blue-50 text-xs text-blue-900 border border-blue-200">
            Enter the teacher&apos;s legal name as recorded in DepEd records. The record will be created with status <strong>unverified</strong>.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                placeholder="e.g. Arnold"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Middle Initial <span className="text-slate-400 text-xs font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                maxLength={2}
                value={formData.middleInitial}
                onChange={(e) => setFormData({ ...formData, middleInitial: e.target.value })}
                placeholder="e.g. A"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              placeholder="e.g. Reodique"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Designated Personal Gmail <span className="text-slate-400 text-xs font-normal">(Optional)</span>
            </label>
            <input
              type="email"
              value={formData.verifiedEmail}
              onChange={(e) => setFormData({ ...formData, verifiedEmail: e.target.value })}
              placeholder="e.g. arnold.reodique@gmail.com"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              If provided, registration matching will strictly require this exact Gmail address.
            </p>
          </div>

          {formError && (
            <div className="p-2.5 rounded bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={isSubmitting}
              className="bg-[#174EA6] hover:bg-[#123E85] text-white"
            >
              {isSubmitting ? "Adding..." : "Add to Registry"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 2: Edit Teacher */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit Teacher Registry Record">
        <form onSubmit={handleEditSubmit} className="space-y-4">
          {selectedTeacher?.linked_user_id && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <strong>Warning:</strong> This registry record is already linked to an existing user account. Material identity changes will reset verification status to <strong>unverified</strong>.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Middle Initial <span className="text-slate-400 text-xs font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                maxLength={2}
                value={formData.middleInitial}
                onChange={(e) => setFormData({ ...formData, middleInitial: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Designated Personal Gmail <span className="text-slate-400 text-xs font-normal">(Optional)</span>
            </label>
            <input
              type="email"
              value={formData.verifiedEmail}
              onChange={(e) => setFormData({ ...formData, verifiedEmail: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:border-[#174EA6] focus:ring-1 focus:ring-[#174EA6]"
            />
          </div>

          {formError && (
            <div className="p-2.5 rounded bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={isSubmitting}
              className="bg-[#174EA6] hover:bg-[#123E85] text-white"
            >
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 3: Bulk Import */}
      <Modal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} title="Bulk Import Faculty Registry" size="lg">
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-blue-50 text-xs text-blue-900 border border-blue-200 space-y-1">
            <p className="font-semibold">Bulk Import Instructions:</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-800">
              <li>Upload an Excel (.xlsx) or CSV (.csv) roster under 5MB.</li>
              <li>Expected columns: <code>First Name</code>, <code>Middle Initial</code>, <code>Last Name</code>, <code>Gmail</code>.</li>
              <li>Security protection: Formulas and macros are automatically disabled and sanitized.</li>
              <li>Duplicate detection will identify matches within the file and against existing registry entries.</li>
            </ul>
          </div>

          {!importPreview && (
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-[#174EA6] transition-colors">
              <Upload className="h-10 w-10 text-slate-400 mx-auto mb-2" />
              <label htmlFor="registry-file-input" className="cursor-pointer">
                <span className="text-sm font-semibold text-[#174EA6] hover:underline">Click to upload file</span>
                <span className="text-xs text-slate-500 block mt-1">Excel (.xlsx) or CSV (.csv) up to 5MB</span>
              </label>
              <input
                id="registry-file-input"
                type="file"
                accept=".xlsx,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          )}

          {isImporting && (
            <div className="py-6">
              <LoadingState message="Processing roster file..." subMessage="Evaluating duplicates and formula safety" />
            </div>
          )}

          {importError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{importError}</span>
            </div>
          )}

          {importPreview && !isImporting && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                <div>
                  <span className="font-bold text-slate-800">{importPreview.filename}</span>
                  <span className="text-slate-500 ml-2">({importPreview.totalRows} data rows)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                    {importPreview.validCount} Valid
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                    {importPreview.duplicateCount} Duplicates
                  </span>
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 font-semibold">
                    {importPreview.errorCount} Errors
                  </span>
                </div>
              </div>

              {/* Preview Rows Table */}
              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0">
                    <tr>
                      <th className="p-2">Row</th>
                      <th className="p-2">Full Name</th>
                      <th className="p-2">Gmail</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importPreview.rows.map((r) => (
                      <tr key={r.rowNumber} className={r.status === "VALID" ? "bg-white" : "bg-slate-50"}>
                        <td className="p-2 font-mono text-slate-500">{r.rowNumber}</td>
                        <td className="p-2 font-medium text-slate-900">
                          {r.firstName} {r.middleInitial ? `${r.middleInitial}. ` : ""}{r.lastName}
                        </td>
                        <td className="p-2 font-mono text-slate-600">{r.verifiedEmail || "—"}</td>
                        <td className="p-2">
                          {r.status === "VALID" && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                              VALID
                            </span>
                          )}
                          {r.status === "DUPLICATE_FILE" && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                              FILE DUP
                            </span>
                          )}
                          {r.status === "DUPLICATE_DB" && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                              DB DUP
                            </span>
                          )}
                          {r.status === "ERROR" && (
                            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-bold text-[10px]">
                              ERROR
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-slate-500">{r.reason || "Ready to import"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-3 border-t border-slate-100">
            {importPreview ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setImportPreview(null);
                  setImportFile(null);
                }}
              >
                Choose Another File
              </Button>
            ) : <div />}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsImportOpen(false)}>
                Cancel
              </Button>
              {importPreview && (
                <Button
                  size="sm"
                  onClick={handleCommitImport}
                  disabled={importPreview.validCount === 0 || isImporting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Commit Import ({importPreview.validCount} records)
                </Button>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}

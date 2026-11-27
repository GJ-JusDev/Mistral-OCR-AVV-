"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import DocumentTable, { resolveDisplayStudentName } from "@/components/documents/DocumentTable";
import {
  isBlacklistedStudentName,
  formatBatchNumber,
  getDocumentCompositeKey,
  aggregateDocumentsIntoBatchFolders,
} from "@/lib/validation/nameComparison";
import { LoadingState } from "@/components/ui/LoadingState";
import { DataTableContainer } from "@/components/ui/DataTableContainer";
import { Button } from "@/components/ui/Button";
import { Upload, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { type Document } from "@/types/database";
import { Modal } from "@/components/ui/Modal";

export default function DocumentsPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[] | any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  async function handleClearAllOldFiles() {
    setIsClearing(true);
    try {
      const res = await fetch("/api/documents", {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMsg = data?.error || (data?.details?.message) || "Failed to clear documents from registry.";
        const detailsMsg = data?.details
          ? typeof data.details === "string"
            ? data.details
            : JSON.stringify(data.details)
          : "";
        throw new Error(detailsMsg ? `${errorMsg} — Details: ${detailsMsg}` : errorMsg);
      }

      // Reset local session storage and local storage batch state so next upload starts at BATCH-001
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("avv_active_batch_id");
        sessionStorage.removeItem("avv_is_new_batch");
        sessionStorage.removeItem("avv_batch_counter");
        localStorage.removeItem("avv_active_batch_id");
        localStorage.removeItem("avv_is_new_batch");
        localStorage.removeItem("avv_batch_counter");

        // Clear all staged OCR and avv_* keys from sessionStorage
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (
            key &&
            (key.startsWith("avv_staged_ocr_") ||
              key.startsWith("avv_ocr_") ||
              key.startsWith("avv_"))
          ) {
            sessionStorage.removeItem(key);
          }
        }

        // Clear all staged OCR and avv_* keys from localStorage
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith("avv_staged_ocr_") ||
              key.startsWith("avv_ocr_") ||
              key.startsWith("avv_"))
          ) {
            localStorage.removeItem(key);
          }
        }
      }

      // Reset local state to empty array
      setDocuments([]);
      setIsClearModalOpen(false);
      await fetchDocuments();
    } catch (err: any) {
      alert(`Clear failed: ${err.message || String(err)}`);
    } finally {
      setIsClearing(false);
    }
  }

  async function fetchDocuments() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) throw new Error("Failed to fetch documents");
      const data = await res.json();
      const docs = Array.isArray(data) ? data : (data.documents || []);
      setDocuments(docs);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchDocuments();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Zero redundancy: deduplicate records in place keeping only the most recent
  // record per unique composite key (LRN + Normalized Student Name + Document Type)
  // and eliminate blank/unextracted "-" ghost rows.
  const deduplicatedDocuments = useMemo(() => {
    const map = new Map<string, any>();
    for (const doc of documents) {
      if (doc.status === "archived") continue;
      const studentName = resolveDisplayStudentName(doc);
      if (!studentName || studentName === "-") continue;

      const compKey = getDocumentCompositeKey(doc);
      const existing = map.get(compKey);
      if (!existing) {
        map.set(compKey, doc);
      } else {
        const existingTime = new Date(existing.updated_at || existing.created_at || 0).getTime();
        const docTime = new Date(doc.updated_at || doc.created_at || 0).getTime();
        if (docTime >= existingTime) {
          map.set(compKey, doc);
        }
      }
    }
    return Array.from(map.values());
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    return deduplicatedDocuments.filter((doc) => {
      if (doc.status === "archived") return false;
      const q = searchQuery.toLowerCase().trim();
      const docType = String(doc.document_type || "").toLowerCase().trim();
      const ef = (doc.extracted_fields || {}) as Record<string, any>;
      const formVariant = String(ef.form_variant || doc.form_variant || "").toUpperCase();

      let matchesType = false;
      if (typeFilter === "all") {
        matchesType = true;
      } else if (typeFilter === "sf1") {
        matchesType = docType === "sf1";
      } else if (typeFilter === "sf2") {
        matchesType = docType === "sf2";
      } else if (typeFilter === "sf9") {
        matchesType = docType === "sf9";
      } else if (typeFilter === "sf10") {
        matchesType = docType === "sf10";
      } else if (typeFilter === "birth_cert") {
        matchesType = docType === "birth_cert" || docType === "psa";
      }

      if (!matchesType) return false;
      if (!q) return true;

      // 1. Search by Batch Number (e.g. BATCH-20261126-001 or BATCH-001)
      const rawBatch = ef.batch_number || ef.batch_id || doc.batch_id || doc.batch_number;
      const batchNumber = formatBatchNumber(rawBatch, doc.created_at || doc.submission_date || doc.updated_at);
      if (batchNumber.toLowerCase().includes(q)) {
        return true;
      }

      // 2. Search by 12-digit DepEd LRN
      const lrn = String(
        doc.canonical_lrn ||
        ef.lrn ||
        ef.learner_reference_number ||
        ef.inherited_lrn ||
        doc.students?.lrn ||
        ""
      ).replace(/[^0-9]/g, "");
      const numQ = q.replace(/[^0-9]/g, "");
      if (lrn && numQ && (lrn.includes(numQ) || numQ.includes(lrn))) {
        return true;
      }

      // 3. Search by Extracted Student Name
      const displayName = resolveDisplayStudentName(doc).toLowerCase();
      if (displayName.includes(q)) {
        return true;
      }

      // 4. Search by Validation Status & Findings (MATCH, MISMATCH, BLANK)
      const findings = (ef.validation_findings || doc.validation_findings) as any;
      if (findings) {
        if (findings.status && String(findings.status).toLowerCase().includes(q)) {
          return true;
        }
        if (findings.summary && String(findings.summary).toLowerCase().includes(q)) {
          return true;
        }
        if (Array.isArray(findings.mismatched_fields) && findings.mismatched_fields.some((m: string) => m.toLowerCase().includes(q))) {
          return true;
        }
        if (Array.isArray(findings.blank_fields) && findings.blank_fields.some((b: string) => b.toLowerCase().includes(q))) {
          return true;
        }
        if (Array.isArray(findings.matched_fields) && findings.matched_fields.some((m: string) => m.toLowerCase().includes(q))) {
          return true;
        }
      }

      // Check document top-level attributes
      if (
        (doc.id && String(doc.id).toLowerCase().includes(q)) ||
        (doc.original_filename && String(doc.original_filename).toLowerCase().includes(q)) ||
        (doc.section && String(doc.section).toLowerCase().includes(q)) ||
        (doc.grade_level && String(doc.grade_level).toLowerCase().includes(q)) ||
        (doc.school_year && String(doc.school_year).toLowerCase().includes(q)) ||
        (doc.document_type && String(doc.document_type).toLowerCase().includes(q)) ||
        (formVariant && formVariant.toLowerCase().includes(q))
      ) {
        return true;
      }

      // Check extracted fields (learner name, LRN, section, grade) with blacklist filtering
      const rawName = ef.name && !isBlacklistedStudentName(ef.name) ? String(ef.name).toLowerCase() : "";
      const rawFirst = ef.first_name && !isBlacklistedStudentName(ef.first_name) ? String(ef.first_name).toLowerCase() : "";
      const rawLast = ef.last_name && !isBlacklistedStudentName(ef.last_name) ? String(ef.last_name).toLowerCase() : "";
      const rawChild = ef.child_name && !isBlacklistedStudentName(ef.child_name) ? String(ef.child_name).toLowerCase() : "";

      if (
        (rawName && rawName.includes(q)) ||
        (rawFirst && rawFirst.includes(q)) ||
        (rawLast && rawLast.includes(q)) ||
        (rawChild && rawChild.includes(q)) ||
        (ef.lrn && String(ef.lrn).toLowerCase().includes(q)) ||
        (ef.learner_reference_number && String(ef.learner_reference_number).toLowerCase().includes(q)) ||
        (ef.section && String(ef.section).toLowerCase().includes(q)) ||
        (ef.grade_level && String(ef.grade_level).toLowerCase().includes(q)) ||
        (ef.school_year && String(ef.school_year).toLowerCase().includes(q))
      ) {
        return true;
      }

      // Check PSA identity fields (child name, registry number, parents)
      if (ef.identity && typeof ef.identity === "object") {
        const idObj = ef.identity;
        if (
          (idObj.first_name && String(idObj.first_name).toLowerCase().includes(q)) ||
          (idObj.last_name && String(idObj.last_name).toLowerCase().includes(q)) ||
          (idObj.middle_name && String(idObj.middle_name).toLowerCase().includes(q)) ||
          (idObj.registry_number && String(idObj.registry_number).toLowerCase().includes(q)) ||
          (idObj.mother_maiden_name && String(idObj.mother_maiden_name).toLowerCase().includes(q)) ||
          (idObj.father_name && String(idObj.father_name).toLowerCase().includes(q))
        ) {
          return true;
        }
      }

      // Check linked student object if populated
      if (doc.students && typeof doc.students === "object") {
        const st = doc.students;
        if (
          (st.lrn && String(st.lrn).toLowerCase().includes(q)) ||
          (st.first_name && String(st.first_name).toLowerCase().includes(q)) ||
          (st.last_name && String(st.last_name).toLowerCase().includes(q))
        ) {
          return true;
        }
      }

      // Check roster learners / attendance entries (SF1, SF2, SF5A, SF5B)
      const rosterLists = [ef.learners, ef.attendance, doc.roster_entries];
      for (const list of rosterLists) {
        if (Array.isArray(list)) {
          const found = list.some((item) => {
            if (!item || typeof item !== "object") return false;
            const lName = (item.learner_name || `${item.last_name || ""} ${item.first_name || ""}`).toLowerCase();
            const lLrn = String(item.lrn || "").toLowerCase();
            return lName.includes(q) || lLrn.includes(q);
          });
          if (found) return true;
        }
      }

      return false;
    });
  }, [deduplicatedDocuments, searchQuery, typeFilter]);

  const batchFoldersCount = useMemo(() => {
    return aggregateDocumentsIntoBatchFolders(filteredDocuments).length;
  }, [filteredDocuments]);

  const totalBatchFoldersCount = useMemo(() => {
    return aggregateDocumentsIntoBatchFolders(documents).length;
  }, [documents]);

  const handleRowClick = (doc: any) => {
    router.push(`/documents/${doc.id}`);
  };

  return (
    <PageContainer>
      <Header 
        title="Document Registry" 
        description="Comprehensive repository of scanned and verified SHS academic records, section rosters, and civil identity documents."
        roleBadge={{ role: "teacher", label: "Faculty Validator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "500169" }}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsClearModalOpen(true)}
              leftIcon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              Clear All Old Files
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchDocuments}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Refresh
            </Button>
            <Link href="/upload">
              <Button
                size="sm"
                leftIcon={<Upload className="h-3.5 w-3.5" />}
                className="bg-[#174EA6] hover:bg-[#0B1F33] text-white"
              >
                Upload Form
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mt-6 flex flex-col gap-6">
        {error && (
          <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-700">
            Error loading documents: {error}
          </div>
        )}

        <DataTableContainer
          title="Document Records"
          description="Click any row to open the complete extraction card and validation report."
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Batch Number, 12-digit LRN, Student Name, or Document Type..."
          itemCount={batchFoldersCount}
          totalCount={totalBatchFoldersCount}
          itemLabel="batch folders"
          filters={
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter documents by form type"
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:bg-white"
            >
              <option value="all">All Document Types</option>
              <option value="sf1">SF1-SHS School Register</option>
              <option value="sf2">SF2-SHS Daily Attendance</option>
              <option value="sf9">SF9-SHS Progress Report</option>
              <option value="sf10">SF10-SHS Permanent Record</option>
              <option value="birth_cert">PSA Birth Certificate</option>
            </select>
          }
        >
          {loading ? (
            <div className="py-12">
              <LoadingState message="Fetching school documents..." subMessage="Loading extracted records" />
            </div>
          ) : (
            <DocumentTable documents={filteredDocuments} onRowClick={handleRowClick} />
          )}
        </DataTableContainer>

        {/* Clear All Old Files Confirmation Modal */}
        <Modal
          isOpen={isClearModalOpen}
          onClose={() => !isClearing && setIsClearModalOpen(false)}
          title="Clear All Old Files & Reset Registry"
          size="md"
          footer={
            <div className="flex justify-end gap-2 w-full">
              <Button
                variant="outline"
                size="sm"
                disabled={isClearing}
                onClick={() => setIsClearModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={isClearing}
                onClick={handleClearAllOldFiles}
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
              >
                {isClearing ? "Clearing Files..." : "Yes, Clear All Old Files"}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-xs sm:text-sm text-slate-600">
            <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg border border-red-200 text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
              <p className="font-semibold">
                Are you sure you want to clear all stored document records and batches?
              </p>
            </div>
            <p>
              This action will permanently purge all previously uploaded documents, section rosters, and cross-validation reports from the registry.
            </p>
            <p className="text-slate-500 text-xs">
              • Next upload batch will automatically restart sequentially from <strong>BATCH-001</strong>.<br />
              • All temporary browser session caches and draft files will be cleared.
            </p>
          </div>
        </Modal>
      </div>
    </PageContainer>
  );
}

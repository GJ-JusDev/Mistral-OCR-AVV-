"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import DocumentTable from "@/components/documents/DocumentTable";
import { LoadingState } from "@/components/ui/LoadingState";
import { DataTableContainer } from "@/components/ui/DataTableContainer";
import { Button } from "@/components/ui/Button";
import { Upload, RefreshCw } from "lucide-react";
import Link from "next/link";
import { type Document } from "@/types/database";

export default function DocumentsPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[] | any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

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

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
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
      } else if (typeFilter === "sf5a") {
        matchesType = docType === "sf5a" || (docType === "sf5" && (formVariant.includes("SF5A") || !formVariant.includes("SF5B")));
      } else if (typeFilter === "sf5b") {
        matchesType = docType === "sf5b" || (docType === "sf5" && formVariant.includes("SF5B"));
      } else if (typeFilter === "sf9") {
        matchesType = docType === "sf9";
      } else if (typeFilter === "sf10") {
        matchesType = docType === "sf10";
      } else if (typeFilter === "birth_cert") {
        matchesType = docType === "birth_cert" || docType === "psa";
      }

      if (!matchesType) return false;
      if (!q) return true;

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

      // Check extracted fields (learner name, LRN, section, grade)
      if (
        (ef.name && String(ef.name).toLowerCase().includes(q)) ||
        (ef.first_name && String(ef.first_name).toLowerCase().includes(q)) ||
        (ef.last_name && String(ef.last_name).toLowerCase().includes(q)) ||
        (ef.lrn && String(ef.lrn).toLowerCase().includes(q)) ||
        (ef.learner_reference_number && String(ef.learner_reference_number).toLowerCase().includes(q)) ||
        (ef.section && String(ef.section).toLowerCase().includes(q)) ||
        (ef.grade_level && String(ef.grade_level).toLowerCase().includes(q)) ||
        (ef.school_year && String(ef.school_year).toLowerCase().includes(q)) ||
        (ef.child_name && String(ef.child_name).toLowerCase().includes(q))
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
  }, [documents, searchQuery, typeFilter]);

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
          searchPlaceholder="Search by student name, LRN, section, grade, document ID, or type..."
          itemCount={filteredDocuments.length}
          totalCount={documents.length}
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
              <option value="sf5a">SF5A-SHS End of Semester Status</option>
              <option value="sf5b">SF5B-SHS Graduation Candidates</option>
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
      </div>
    </PageContainer>
  );
}

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
    fetchDocuments();
  }, []);

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const q = searchQuery.toLowerCase().trim();
      const name = ((doc.extracted_fields as any)?.name || "").toLowerCase();
      const type = (doc.document_type || "").toLowerCase();
      const matchesSearch = !q || name.includes(q) || doc.id.toLowerCase().includes(q);
      const matchesType = typeFilter === "all" || type === typeFilter;
      return matchesSearch && matchesType;
    });
  }, [documents, searchQuery, typeFilter]);

  const handleRowClick = (doc: any) => {
    router.push(`/documents/${doc.id}`);
  };

  return (
    <PageContainer>
      <Header 
        title="Document Registry" 
        description="Comprehensive repository of scanned and extracted SF9, SF10, and PSA records."
        roleBadge={{ role: "teacher", label: "Faculty Validator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "300792" }}
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
          searchPlaceholder="Search by student name or document ID..."
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
              <option value="sf9">SF9 Progress Report</option>
              <option value="sf10">SF10 Permanent Record</option>
              <option value="psa">PSA Birth Certificate</option>
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

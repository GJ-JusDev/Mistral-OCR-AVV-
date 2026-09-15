"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import DocumentTable from "@/components/documents/DocumentTable";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
// Assuming Document is defined, else fallback to any
import { type Document } from "@/types/database";

export default function DocumentsPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[] | any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDocuments() {
      try {
        const res = await fetch("/api/documents");
        if (!res.ok) throw new Error("Failed to fetch documents");
        const data = await res.json();
        setDocuments(data.documents || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchDocuments();
  }, []);

  const handleRowClick = (doc: any) => {
    router.push(`/documents/${doc.id}`);
  };

  return (
    <PageContainer>
      <Header title="Documents" />
      <div className="mt-6">
        {loading ? (
          <div className="flex justify-center p-8">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-red-600 p-4 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-md">
            Error: {error}
          </div>
        ) : (
          <DocumentTable documents={documents} onRowClick={handleRowClick} />
        )}
      </div>
    </PageContainer>
  );
}

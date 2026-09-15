"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import DocumentTable from "@/components/documents/DocumentTable";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { type Document } from "@/types/database";

export default function ReviewQueuePage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[] | any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReviewQueue() {
      try {
        const res = await fetch("/api/documents?status=needs_review");
        if (!res.ok) throw new Error("Failed to fetch review queue");
        const data = await res.json();
        setDocuments(data.documents || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchReviewQueue();
  }, []);

  const handleRowClick = (doc: any) => {
    router.push(`/documents/${doc.id}`);
  };

  return (
    <PageContainer>
      <Header title="Review Queue" />
      <div className="mt-6">
        <p className="mb-4 text-zinc-600 dark:text-zinc-400">
          The following documents require manual review before they can be finalized.
        </p>
        
        {loading ? (
          <div className="flex justify-center p-8">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-red-600 p-4 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-md">
            Error: {error}
          </div>
        ) : documents.length === 0 ? (
          <div className="p-8 text-center bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <h3 className="text-lg font-medium text-zinc-800 dark:text-zinc-200">All caught up!</h3>
            <p className="text-zinc-500 dark:text-zinc-400 mt-2">There are no documents currently awaiting review.</p>
          </div>
        ) : (
          <DocumentTable documents={documents} onRowClick={handleRowClick} />
        )}
      </div>
    </PageContainer>
  );
}

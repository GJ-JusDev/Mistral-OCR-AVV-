"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import DocumentTable from "@/components/documents/DocumentTable";
import { LoadingState } from "@/components/ui/LoadingState";
import { DataTableContainer } from "@/components/ui/DataTableContainer";
import { Button } from "@/components/ui/Button";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { type Document } from "@/types/database";

export default function ReviewQueuePage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[] | any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchReviewQueue() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/documents?status=needs_review");
      if (!res.ok) throw new Error("Failed to fetch review queue");
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
    fetchReviewQueue();
  }, []);

  const handleRowClick = (doc: any) => {
    router.push(`/documents/${doc.id}`);
  };

  return (
    <PageContainer>
      <Header 
        title="Review & Verification Queue" 
        description="Documents flagged with grade discrepancies, missing quarters, or name mismatches requiring teacher examination before final approval."
        roleBadge={{ role: "teacher", label: "Faculty Validator" }}
        schoolInfo={{ schoolName: "Taysan Resettlement Integrated School", depedSchoolId: "300792" }}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchReviewQueue}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Refresh Queue
          </Button>
        }
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* Notice banner */}
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200/80 flex items-start gap-3 shadow-xs">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-amber-900 leading-relaxed">
            <strong className="font-semibold block mb-0.5">Faculty Verification Duty:</strong>
            DepEd policy (DO 8, s. 2015 & DO 55, s. 2016) mandates that teachers must inspect the original scanned document image to confirm printed grades versus computed quarter averages. Flagged items do NOT automatically pass or fail.
          </div>
        </div>

        {error && (
          <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-700">
            Error loading queue: {error}
          </div>
        )}

        <DataTableContainer
          title="Flagged Submissions"
          description="Click any document to inspect OCR extraction fields against the original scan."
          itemCount={documents.length}
        >
          {loading ? (
            <div className="py-12">
              <LoadingState message="Checking verification queue..." subMessage="Filtering documents flagged for review" />
            </div>
          ) : documents.length === 0 ? (
            <div className="p-10 text-center bg-white rounded-xl border border-dashed border-slate-300">
              <div className="h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 border border-emerald-200">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-[#0B1F33]">Review Queue is Clear!</h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                There are no documents currently awaiting manual teacher verification.
              </p>
            </div>
          ) : (
            <DocumentTable documents={documents} onRowClick={handleRowClick} />
          )}
        </DataTableContainer>
      </div>
    </PageContainer>
  );
}

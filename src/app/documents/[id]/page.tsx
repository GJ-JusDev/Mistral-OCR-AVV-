"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import OcrResultCard from "@/components/ocr/OcrResultCard";
import ValidationSummary from "@/components/validation/ValidationSummary";
import ReviewPanel from "@/components/review/ReviewPanel";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export default function DocumentDetailPage() {
  const params = useParams();
  const documentId = params.id as string;
  
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId) return;
    
    async function fetchDocumentDetail() {
      try {
        const res = await fetch(`/api/documents/${documentId}`);
        if (!res.ok) throw new Error("Failed to fetch document details");
        const data = await res.json();
        setDocument(data.document);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchDocumentDetail();
  }, [documentId]);

  if (loading) {
    return (
      <PageContainer>
        <Header title="Document Details" />
        <div className="flex justify-center p-12">
          <LoadingSpinner size="lg" />
        </div>
      </PageContainer>
    );
  }

  if (error || !document) {
    return (
      <PageContainer>
        <Header title="Document Details" />
        <div className="mt-6 text-red-600 p-4 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-md">
          {error || "Document not found."}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <Header title="Document Details" />
      
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Image Preview */}
        <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700 flex flex-col items-center">
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 mb-4 w-full text-left">Original Image</h2>
          {document.image_url ? (
            <img 
              src={document.image_url} 
              alt={`Document ${document.id}`} 
              className="max-w-full h-auto rounded-md shadow-sm border border-zinc-300 dark:border-zinc-600"
            />
          ) : (
            <div className="text-zinc-500 italic py-12">No image available</div>
          )}
        </div>

        {/* Right Column: OCR Results, Validation, Review Panel */}
        <div className="flex flex-col gap-6">
          <OcrResultCard 
            fields={document.extracted_fields} 
            rawText={document.extracted_text}
          />
          <ValidationSummary 
            report={{ results: document.validation_results || [], status: "needs_review", passCount: 0, failCount: 0, totalRules: 0 }} 
          />
          <ReviewPanel 
            document={document} 
            onApprove={() => {}}
            onReject={() => {}}
          />
        </div>
      </div>
      
      {/* Review History */}
      {document.review_history && document.review_history.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100 mb-4">Review History</h2>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden shadow-sm">
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {document.review_history.map((history: any, index: number) => (
                <li key={index} className="p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                  <div>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{history.action}</span>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{history.notes}</p>
                  </div>
                  <div className="text-sm text-zinc-400 whitespace-nowrap">
                    {new Date(history.timestamp).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </PageContainer>
  );
}

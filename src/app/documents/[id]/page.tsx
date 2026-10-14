"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import OcrResultCard from "@/components/ocr/OcrResultCard";
import ValidationSummary from "@/components/validation/ValidationSummary";
import ReviewPanel from "@/components/review/ReviewPanel";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

import { submitDocumentReview, saveDocumentCorrections } from "@/actions/review";

export default function DocumentDetailPage() {
  const params = useParams();
  const documentId = params.id as string;
  
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<any>({});
  const [hasModifications, setHasModifications] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSavingCorrections, setIsSavingCorrections] = useState(false);

  useEffect(() => {
    if (!documentId) return;
    
    async function fetchDocumentDetail() {
      try {
        const res = await fetch(`/api/documents/${documentId}`);
        if (!res.ok) throw new Error("Failed to fetch document details");
        const data = await res.json();
        const doc = data.document || data;
        setDocument(doc);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchDocumentDetail();
  }, [documentId]);

  const handleApprove = async () => {
    setIsSubmitting(true);
    setActionError(null);
    const res = await submitDocumentReview(documentId, "approve");
    setIsSubmitting(false);
    if (res.error) {
      setActionError(res.error);
    } else {
      setDocument((prev: any) => ({
        ...prev,
        status: "approved",
        review_logs: [
          {
            action: "approve",
            comment: "Document approved by reviewer",
            created_at: new Date().toISOString(),
          },
          ...(prev?.review_logs || []),
        ],
      }));
    }
  };

  const handleReject = async (reason: string) => {
    setIsSubmitting(true);
    setActionError(null);
    const res = await submitDocumentReview(documentId, "reject", reason);
    setIsSubmitting(false);
    if (res.error) {
      setActionError(res.error);
    } else {
      setDocument((prev: any) => ({
        ...prev,
        status: "rejected",
        review_logs: [
          {
            action: "reject",
            comment: reason,
            created_at: new Date().toISOString(),
          },
          ...(prev?.review_logs || []),
        ],
      }));
    }
  };

  const handleFieldChange = (field: any, value: string) => {
    setEditedFields((prev: any) => ({
      ...prev,
      [field]: value,
    }));
    setDocument((prev: any) => ({
      ...prev,
      extracted_fields: {
        ...(prev?.extracted_fields || {}),
        [field]: value,
      },
    }));
    setHasModifications(true);
    setSaveSuccess(false);
  };

  const handleSaveCorrections = async () => {
    if (!hasModifications) return;
    setIsSavingCorrections(true);
    setActionError(null);
    const res = await saveDocumentCorrections(documentId, editedFields);
    setIsSavingCorrections(false);
    if (res.error) {
      setActionError(res.error);
    } else {
      setHasModifications(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

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

  const validationResults = document.validation_results || [];
  const passCount = validationResults.filter((r: any) => r.passed).length;
  const failCount = validationResults.filter((r: any) => !r.passed).length;

  return (
    <PageContainer>
      <Header 
        title="Document Details" 
        description={`Record ID: ${document.id} • Type: ${(document.document_type || "sf9").toUpperCase()}`}
      />

      {actionError && (
        <div className="mt-4 text-red-600 p-4 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-md border border-red-200">
          Action error: {actionError}
        </div>
      )}

      {saveSuccess && (
        <div className="mt-4 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300 p-3 rounded-md border border-emerald-200 text-sm font-medium">
          Corrections saved successfully and document re-validated.
        </div>
      )}

      {/* Flags / Warnings */}
      {document.extracted_fields?.flags && document.extracted_fields.flags.length > 0 && (
        <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg text-amber-800 dark:text-amber-200 text-sm">
          <strong className="block font-semibold mb-1">Data Integrity Warnings:</strong>
          <ul className="list-disc list-inside space-y-0.5">
            {document.extracted_fields.flags.map((flag: string, i: number) => (
              <li key={i}>{flag.replace(/_/g, " ")}</li>
            ))}
          </ul>
        </div>
      )}
      
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Image Preview */}
        <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700 flex flex-col items-center">
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-100 mb-4 w-full text-left">Original Image</h2>
          {document.image_url && document.image_url !== "uploaded-document" && !document.image_url.startsWith("uploaded-") ? (
            <img 
              src={document.image_url} 
              alt={`Document ${document.id}`} 
              className="max-w-full h-auto rounded-md shadow-sm border border-zinc-300 dark:border-zinc-600"
            />
          ) : (
            <div className="text-zinc-500 italic py-16 text-center">
              Scanned capture attached to this record.
            </div>
          )}
        </div>

        {/* Right Column: OCR Results, Validation, Review Panel */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <OcrResultCard 
              fields={document.extracted_fields} 
              rawText={document.extracted_text}
              onFieldChange={handleFieldChange}
            />
            {hasModifications && (
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleSaveCorrections}
                  disabled={isSavingCorrections}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium transition shadow-sm disabled:opacity-50"
                >
                  {isSavingCorrections ? "Saving Changes..." : "Save Corrections"}
                </button>
              </div>
            )}
          </div>
          <ValidationSummary 
            report={{ 
              results: validationResults, 
              status: document.status === "validated" ? "valid" : document.status === "rejected" ? "invalid" : "needs_review", 
              passCount, 
              failCount, 
              totalRules: validationResults.length 
            }} 
          />
          <ReviewPanel 
            document={document} 
            onApprove={handleApprove}
            onReject={handleReject}
            isSubmitting={isSubmitting}
          />
        </div>
      </div>
      
      {/* Review History */}
      {((document.review_logs && document.review_logs.length > 0) || (document.review_history && document.review_history.length > 0)) && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100 mb-4">Review History & Audit Trail</h2>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden shadow-sm">
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {(document.review_logs || document.review_history).map((history: any, index: number) => (
                <li key={index} className="p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                  <div>
                    <span className={`inline-block font-semibold px-2 py-0.5 text-xs rounded uppercase mr-2 ${
                      history.action === 'approve' ? 'bg-emerald-100 text-emerald-800' :
                      history.action === 'reject' ? 'bg-red-100 text-red-800' : 'bg-zinc-100 text-zinc-800'
                    }`}>
                      {history.action}
                    </span>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{history.comment || history.notes || "No notes provided."}</p>
                  </div>
                  <div className="text-xs text-zinc-400 whitespace-nowrap">
                    {history.created_at ? new Date(history.created_at).toLocaleString() : history.timestamp ? new Date(history.timestamp).toLocaleString() : "-"}
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

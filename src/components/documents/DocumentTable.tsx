"use client";

import React, { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import { Document, DocumentStatus } from "@/types/database";
import { ExtractedFields } from "@/types/validation";
import { format } from "date-fns";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import DeleteReviewDocumentModal from "@/components/review/DeleteReviewDocumentModal";

interface DocumentTableProps {
  documents: (Document | any)[];
  isLoading?: boolean;
  onRowClick?: (doc: Document) => void;
  showDeleteAction?: boolean;
  showDeleteRequest?: boolean;
  onQueueRefresh?: () => void;
}

export default function DocumentTable({
  documents,
  isLoading,
  onRowClick,
  showDeleteAction = false,
  showDeleteRequest = false,
  onQueueRefresh,
}: DocumentTableProps) {
  const [selectedDocForDeletion, setSelectedDocForDeletion] = useState<any | null>(null);
  const canDelete = showDeleteAction || showDeleteRequest;

  if (isLoading) {
    return (
      <div className="text-slate-500 text-center p-8 text-xs sm:text-sm">
        Loading document records...
      </div>
    );
  }

  if (!documents || !documents.length) {
    return (
      <div className="text-center p-8 border border-dashed border-slate-300 rounded-xl bg-slate-50/50">
        <FileText className="h-8 w-8 text-slate-400 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-700">No documents found</p>
        <p className="text-xs text-slate-400 mt-1">Upload an SF9 or SF10 form to begin verification.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-slate-200/80 overflow-hidden bg-white shadow-xs">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="w-[120px]">Record ID</TableHead>
              <TableHead>Document Type</TableHead>
              <TableHead>Extracted Student Name</TableHead>
              <TableHead>Validation Status</TableHead>
              <TableHead className="text-right">Submission Date</TableHead>
              {canDelete && (
                <TableHead className="text-right w-[120px]">Action</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => {
              const fields = doc.extracted_fields as ExtractedFields;
              const studentName = fields?.name || "-";
              const docType = (doc.document_type || "Unknown").replace(/_/g, " ").toUpperCase();

              return (
                <TableRow 
                  key={doc.id} 
                  className={onRowClick ? "cursor-pointer hover:bg-slate-50/80 transition-colors" : ""}
                  onClick={() => onRowClick?.(doc)}
                >
                  <TableCell className="font-mono text-xs text-slate-500">
                    {doc.id.substring(0, 8)}...
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                      {docType}
                    </span>
                  </TableCell>
                  <TableCell className="font-semibold text-slate-900 text-xs sm:text-sm">
                    {studentName}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <DocumentStatusBadge status={doc.status as DocumentStatus} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-slate-500 text-xs">
                    {doc.created_at ? format(new Date(doc.created_at), "MMM d, yyyy") : "-"}
                  </TableCell>
                  {canDelete && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDocForDeletion(doc);
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 text-xs py-1 px-2.5 h-auto transition-colors"
                        leftIcon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {selectedDocForDeletion && (
        <DeleteReviewDocumentModal
          isOpen={Boolean(selectedDocForDeletion)}
          onClose={() => setSelectedDocForDeletion(null)}
          documentId={selectedDocForDeletion.id}
          documentName={
            selectedDocForDeletion.original_filename ||
            (selectedDocForDeletion.document_type || "Document").toUpperCase()
          }
          studentName={(selectedDocForDeletion.extracted_fields as any)?.name}
          documentType={selectedDocForDeletion.document_type}
          onSuccess={() => {
            onQueueRefresh?.();
            setSelectedDocForDeletion(null);
          }}
        />
      )}
    </>
  );
}

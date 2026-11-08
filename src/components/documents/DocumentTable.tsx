"use client";

import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import { Document, DocumentStatus } from "@/types/database";
import { ExtractedFields } from "@/types/validation";
import { format } from "date-fns";
import { FileText, ArrowRight } from "lucide-react";

interface DocumentTableProps {
  documents: Document[];
  isLoading?: boolean;
  onRowClick?: (doc: Document) => void;
}

export default function DocumentTable({ documents, isLoading, onRowClick }: DocumentTableProps) {
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
        <p className="text-xs text-slate-400 mt-1">Upload an SF9, SF10, or PSA form to begin verification.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200/80 overflow-hidden bg-white shadow-xs">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead className="w-[120px]">Record ID</TableHead>
            <TableHead>Document Type</TableHead>
            <TableHead>Extracted Student Name</TableHead>
            <TableHead>Validation Status</TableHead>
            <TableHead className="text-right">Submission Date</TableHead>
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
                  <DocumentStatusBadge status={doc.status as DocumentStatus} />
                </TableCell>
                <TableCell className="text-right text-slate-500 text-xs">
                  {doc.created_at ? format(new Date(doc.created_at), "MMM d, yyyy") : "-"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

"use client";

import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import { Document } from "@/types/database";

interface DocumentTableProps {
  documents: Document[];
  isLoading?: boolean;
  onRowClick?: (doc: Document) => void;
}

export default function DocumentTable({ documents, isLoading, onRowClick }: DocumentTableProps) {
  if (isLoading) {
    return <div className="text-zinc-500 text-center p-8">Loading documents...</div>;
  }

  if (!documents || !documents.length) {
    return <div className="text-zinc-500 text-center p-8 border border-zinc-200 dark:border-zinc-800 rounded-md">No documents found.</div>;
  }

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-950">
      <Table>
        <TableHeader className="bg-zinc-50 dark:bg-zinc-900/50">
          <TableRow>
            <TableHead className="w-[120px]">ID</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Extracted Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow 
              key={doc.id} 
              className={onRowClick ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50" : ""}
              onClick={() => onRowClick?.(doc)}
            >
              <TableCell className="font-medium text-zinc-900 dark:text-zinc-100">
                {doc.id.substring(0, 8)}...
              </TableCell>
              <TableCell className="text-zinc-600 dark:text-zinc-400 capitalize">
                {(doc.document_type || doc.type || "Unknown").replace(/_/g, " ")}
              </TableCell>
              <TableCell className="text-zinc-900 dark:text-zinc-100">
                {doc.extracted_data?.name || "-"}
              </TableCell>
              <TableCell>
                <DocumentStatusBadge status={doc.status} />
              </TableCell>
              <TableCell className="text-right text-zinc-500 dark:text-zinc-400 text-sm">
                {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

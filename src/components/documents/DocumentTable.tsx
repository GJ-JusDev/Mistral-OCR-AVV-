"use client";

import React, { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import { Document, DocumentStatus } from "@/types/database";
import { format } from "date-fns";
import { FileText, Trash2, Eye, CheckCircle2, AlertTriangle, XCircle, Info, Folder, FolderCheck, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import DeleteReviewDocumentModal from "@/components/review/DeleteReviewDocumentModal";
import {
  resolveDocumentStudentNameDisplay,
  formatBatchNumber,
  aggregateDocumentsIntoBatchFolders,
  type BatchFolderItem,
} from "@/lib/validation/nameComparison";

export const resolveDisplayStudentName = resolveDocumentStudentNameDisplay;

interface DocumentTableProps {
  documents: (Document | any)[];
  isLoading?: boolean;
  onRowClick?: (doc: Document) => void;
  showDeleteAction?: boolean;
  showDeleteRequest?: boolean;
  onQueueRefresh?: () => void;
  mode?: "batches" | "individual";
  onInspectBatch?: (folder: BatchFolderItem) => void;
  onDeleteBatch?: (folder: BatchFolderItem) => void;
}

export default function DocumentTable({
  documents,
  isLoading,
  onRowClick,
  showDeleteAction = false,
  showDeleteRequest = false,
  onQueueRefresh,
  mode = "batches",
  onInspectBatch,
  onDeleteBatch,
}: DocumentTableProps) {
  const [selectedDocForDeletion, setSelectedDocForDeletion] = useState<any | null>(null);
  const [selectedFolderForDetails, setSelectedFolderForDetails] = useState<BatchFolderItem | null>(null);
  const canDelete = showDeleteAction || showDeleteRequest;

  // Aggregate 5 forms into 1 Unified Batch Folder row per student
  const batchFolders: BatchFolderItem[] = useMemo(() => {
    return aggregateDocumentsIntoBatchFolders(documents || []);
  }, [documents]);

  if (isLoading) {
    return (
      <div className="text-slate-500 text-center p-8 text-xs sm:text-sm">
        Loading document records...
      </div>
    );
  }

  if (mode === "individual") {
    if (!documents.length) {
      return (
        <div className="text-center p-8 border border-dashed border-slate-300 rounded-xl bg-slate-50/50">
          <FileText className="h-8 w-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-700">No individual documents found</p>
          <p className="text-xs text-slate-400 mt-1">Upload student records in the Upload Wizard to view them here.</p>
        </div>
      );
    }

    return (
      <>
        <div className="rounded-xl border border-slate-200/80 overflow-hidden bg-white shadow-xs">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="w-[180px]">DOCUMENT TYPE</TableHead>
                <TableHead className="w-[150px]">LRN</TableHead>
                <TableHead>STUDENT FULL NAME</TableHead>
                <TableHead className="w-[170px]">BATCH NUMBER</TableHead>
                <TableHead className="w-[130px]">STATUS</TableHead>
                <TableHead className="text-right w-[130px]">SUBMISSION DATE</TableHead>
                {canDelete && <TableHead className="text-right w-[100px]">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc: any) => {
                const ef = (doc.extracted_fields || {}) as Record<string, any>;
                const rawType = String(doc.document_type || "").toLowerCase().trim();
                const isPsa = rawType === "birth_cert" || rawType === "psa";
                const typeLabel = isPsa ? "PSA Birth Certificate" : (doc.document_type || "").toUpperCase();
                const lrn = doc.canonical_lrn || ef.lrn || ef.learner_reference_number || doc.students?.lrn || "—";
                const studentName = resolveDisplayStudentName(doc);
                const rawBatch = ef.batch_number || ef.batch_id || doc.batch_id || doc.batch_number;
                const formattedBatch = formatBatchNumber(rawBatch, doc.created_at || doc.submission_date);
                const formattedDate = doc.submission_date || doc.created_at
                  ? format(new Date(doc.submission_date || doc.created_at), "MMM d, yyyy")
                  : "—";

                return (
                  <TableRow
                    key={doc.id}
                    className="cursor-pointer hover:bg-blue-50/40 transition-colors"
                    onClick={() => onRowClick?.(doc)}
                  >
                    <TableCell className="font-bold text-xs text-slate-800">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#174EA6] shrink-0" />
                        <span>{typeLabel}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-slate-800">
                      {lrn}
                    </TableCell>
                    <TableCell className="font-bold text-slate-900 text-xs sm:text-sm">
                      {studentName}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {formattedBatch}
                    </TableCell>
                    <TableCell>
                      <DocumentStatusBadge status={(doc.status as DocumentStatus) || "completed"} />
                    </TableCell>
                    <TableCell className="text-right text-slate-500 text-xs font-medium">
                      {formattedDate}
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
            studentName={resolveDocumentStudentNameDisplay(selectedDocForDeletion)}
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

  if (!batchFolders.length) {
    return (
      <div className="text-center p-8 border border-dashed border-slate-300 rounded-xl bg-slate-50/50">
        <Folder className="h-8 w-8 text-slate-400 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-700">No verified batch folders found</p>
        <p className="text-xs text-slate-400 mt-1">Upload and confirm a student document batch in the Upload Wizard to view their unified dossier here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-slate-200/80 overflow-hidden bg-white shadow-xs">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="w-[170px]">BATCH NUMBER</TableHead>
              <TableHead className="w-[160px]">LRN (SF1)</TableHead>
              <TableHead>STUDENT FULL NAME (SF1 MATCHED)</TableHead>
              <TableHead className="min-w-[210px]">BATCH FOLDER CONTENTS</TableHead>
              <TableHead className="min-w-[240px]">VALIDATION STATUS &amp; FINDINGS</TableHead>
              <TableHead className="text-right w-[130px]">SUBMISSION DATE</TableHead>
              {(canDelete || Boolean(onInspectBatch)) && (
                <TableHead className="text-right w-[150px]">Action</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {batchFolders.map((folder) => {
              const formattedBatch = formatBatchNumber(folder.batch_number, folder.submission_date);

              // Strict status badge resolution
              const matchedCount = folder.findings_summary.matched_count || 0;
              const mismatchCount = folder.findings_summary.mismatched_count || 0;
              const blankCount = folder.findings_summary.blank_count || 0;

              let statusBadge: React.ReactNode;
              let summaryText = "";
              let summaryColor = "text-slate-500 font-medium";

              if (mismatchCount > 0 && blankCount > 0) {
                statusBadge = (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-800 border border-red-300">
                    <XCircle className="w-3 h-3 text-red-600 inline" />
                    MISMATCH &amp; BLANK
                  </span>
                );
                summaryText = `${matchedCount} Matched • ${mismatchCount} Mismatched • ${blankCount} Blank/Incomplete`;
                summaryColor = "text-red-700 font-medium";
              } else if (mismatchCount > 0) {
                statusBadge = (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 border border-red-300">
                    <XCircle className="w-3 h-3 text-red-600 inline" />
                    MISMATCH FOUND
                  </span>
                );
                summaryText = `${matchedCount} Matched • ${mismatchCount} Mismatched`;
                summaryColor = "text-red-600 font-medium";
              } else if (blankCount > 0) {
                statusBadge = (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
                    <AlertTriangle className="w-3 h-3 text-amber-600 inline" />
                    BLANK / INCOMPLETE
                  </span>
                );
                summaryText = `${matchedCount} Matched • ${blankCount} Blank/Incomplete`;
                summaryColor = "text-amber-700 font-medium";
              } else if (matchedCount > 0) {
                statusBadge = (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 inline" />
                    ALL MATCHED
                  </span>
                );
                summaryText = `${matchedCount} Matched Fields`;
                summaryColor = "text-emerald-700 font-medium";
              } else {
                statusBadge = (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-300">
                    <Info className="w-3 h-3 text-slate-500 inline" />
                    NOT YET COMPARED
                  </span>
                );
                summaryText = "No cross-document comparison recorded";
                summaryColor = "text-slate-500 font-normal";
              }

              const formattedDate = folder.submission_date
                ? format(new Date(folder.submission_date), "MMM d, yyyy")
                : "-";

              return (
                <TableRow
                  key={folder.batch_number}
                  data-testid={`batch-folder-row-${folder.batch_number}`}
                  className="cursor-pointer hover:bg-blue-50/40 transition-colors group"
                  onClick={() => {
                    setSelectedFolderForDetails(folder);
                  }}
                >
                  {/* 1. BATCH NUMBER with folder icon */}
                  <TableCell className="font-mono text-xs font-bold text-slate-800">
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-[#174EA6] shrink-0 group-hover:scale-110 transition-transform" />
                      <span>{formattedBatch}</span>
                    </div>
                  </TableCell>

                  {/* 2. LRN (SF1) */}
                  <TableCell className="font-mono text-xs font-semibold text-slate-800">
                    {folder.sf1_lrn}
                  </TableCell>

                  {/* 3. STUDENT FULL NAME (SF1 MATCHED) */}
                  <TableCell className="font-bold text-slate-900 text-xs sm:text-sm">
                    {folder.student_name}
                  </TableCell>

                  {/* 4. BATCH FOLDER CONTENTS (Pills for forms: SF1 • SF2 • SF9 • SF10 • PSA) */}
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold text-slate-700">
                        {folder.document_types.length} Form{folder.document_types.length === 1 ? "" : "s"}:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {folder.document_types.map((docType) => {
                          const isPsa = docType === "birth_cert" || docType === "psa";
                          const label = isPsa ? "PSA" : docType.toUpperCase();
                          return (
                            <span
                              key={docType}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-800 border border-blue-200"
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </TableCell>

                  {/* 5. VALIDATION STATUS & FINDINGS */}
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {statusBadge}
                      </div>
                      <span className={`text-[11px] block truncate max-w-[280px] ${summaryColor}`}>
                        {summaryText}
                      </span>
                    </div>
                  </TableCell>

                  {/* 6. SUBMISSION DATE */}
                  <TableCell className="text-right text-slate-500 text-xs font-medium">
                    {formattedDate}
                  </TableCell>

                  {/* Action */}
                  {(canDelete || Boolean(onInspectBatch)) && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {onInspectBatch && (
                          <Button
                            size="sm"
                            onClick={() => onInspectBatch(folder)}
                            className="bg-[#174EA6] hover:bg-[#0B1F33] text-white text-xs py-1 px-2.5 h-auto transition-colors"
                            leftIcon={<Eye className="h-3.5 w-3.5" />}
                          >
                            Inspect
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onDeleteBatch) {
                                onDeleteBatch(folder);
                              } else if (folder.documents[0]) {
                                setSelectedDocForDeletion(folder.documents[0]);
                              }
                            }}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 text-xs py-1 px-2.5 h-auto transition-colors"
                            leftIcon={<Trash2 className="h-3.5 w-3.5 text-red-500" />}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Batch Folder Viewer Drill-Down Modal */}
      {selectedFolderForDetails && (
        <Modal
          isOpen={Boolean(selectedFolderForDetails)}
          onClose={() => setSelectedFolderForDetails(null)}
          title={`Batch Folder: ${formatBatchNumber(selectedFolderForDetails.batch_number)}`}
          size="lg"
          footer={
            <div className="flex justify-end gap-2 w-full">
              <Button variant="outline" size="sm" onClick={() => setSelectedFolderForDetails(null)}>
                Close Folder
              </Button>
            </div>
          }
        >
          {(() => {
            const folder = selectedFolderForDetails;
            const formattedBatch = formatBatchNumber(folder.batch_number, folder.submission_date);

            return (
              <div className="space-y-5 text-xs sm:text-sm">
                {/* Folder Header */}
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Folder className="w-5 h-5 text-[#174EA6]" />
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {formattedBatch}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#174EA6] text-white">
                        {folder.documents.length} Bundled Form{folder.documents.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500 font-medium">
                      Submitted: {folder.submission_date ? format(new Date(folder.submission_date), "MMMM d, yyyy") : "—"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-blue-200/60">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                        Canonical LRN (SF1 Anchored)
                      </span>
                      <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
                        {folder.sf1_lrn}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                        Canonical Student Full Name
                      </span>
                      <span className="font-bold text-slate-900 text-sm mt-0.5 block">
                        {folder.student_name}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Cross-Document Findings Summary */}
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Info className="w-4 h-4 text-blue-600" />
                    Cross-Document Validation Status &amp; Findings
                  </h4>

                  {folder.findings_summary.mismatched_fields.length > 0 && (
                    <div className="p-3 bg-red-50 rounded-xl border border-red-200 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-700 border border-red-300">
                          MISMATCH ({folder.findings_summary.mismatched_fields.length})
                        </span>
                      </div>
                      <ul className="list-disc list-inside text-red-700 text-xs space-y-0.5 mt-1">
                        {folder.findings_summary.mismatched_fields.map((m, idx) => (
                          <li key={idx}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {folder.findings_summary.blank_fields.length > 0 && (
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300">
                          BLANK / INCOMPLETE ({folder.findings_summary.blank_fields.length})
                        </span>
                      </div>
                      <ul className="list-disc list-inside text-amber-800 text-xs space-y-0.5 mt-1">
                        {folder.findings_summary.blank_fields.map((b, idx) => (
                          <li key={idx}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {folder.findings_summary.matched_fields.length > 0 && (
                    <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700 border border-emerald-300">
                          ALL MATCHED ({folder.findings_summary.matched_fields.length} Fields)
                        </span>
                      </div>
                      <p className="text-emerald-700 text-xs">
                        Verified matching fields across folder forms: {folder.findings_summary.matched_fields.join(", ")}
                      </p>
                    </div>
                  )}
                </div>

                {/* Form Cards in Folder */}
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-900">
                    Documents Bundled in this Batch Folder ({folder.documents.length})
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {folder.documents.map((doc, idx) => {
                      const rawType = String(doc.document_type || "").toLowerCase().trim();
                      const isPsa = rawType === "birth_cert" || rawType === "psa";
                      const typeLabel = isPsa ? "PSA BIRTH CERTIFICATE" : (doc.document_type || "").toUpperCase();
                      const fields = (doc.extracted_fields || {}) as Record<string, any>;

                      return (
                        <div
                          key={doc.id || idx}
                          className="p-3 rounded-xl border border-slate-200 bg-white hover:border-blue-300 transition-colors space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-slate-900">
                              {typeLabel}
                            </span>
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                              {doc.status || "VERIFIED"}
                            </span>
                          </div>

                          <div className="text-xs text-slate-600 space-y-0.5">
                            <p className="truncate">
                              <span className="text-slate-400 font-medium">Source: </span>
                              {doc.original_filename || "Document File"}
                            </p>
                            {fields.school_name && (
                              <p className="truncate">
                                <span className="text-slate-400 font-medium">School: </span>
                                {fields.school_name}
                              </p>
                            )}
                            {fields.general_average && (
                              <p>
                                <span className="text-slate-400 font-medium">Gen Average: </span>
                                <span className="font-mono font-bold text-blue-700">{fields.general_average}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {selectedDocForDeletion && (
        <DeleteReviewDocumentModal
          isOpen={Boolean(selectedDocForDeletion)}
          onClose={() => setSelectedDocForDeletion(null)}
          documentId={selectedDocForDeletion.id}
          documentName={
            selectedDocForDeletion.original_filename ||
            (selectedDocForDeletion.document_type || "Document").toUpperCase()
          }
          studentName={resolveDocumentStudentNameDisplay(selectedDocForDeletion)}
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

"use client";

import React, { useState, useTransition } from "react";
import PageContainer from "@/components/layout/PageContainer";
import { Card } from "@/components/ui/Card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/Table";
import DocumentStatusBadge from "@/components/documents/DocumentStatusBadge";
import { 
  FileText, 
  Search, 
  Filter, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  ExternalLink,
  ShieldAlert,
  Layers,
  Calendar,
  School
} from "lucide-react";
import { getPrincipalDocumentSummary } from "@/actions/principal";
import Link from "next/link";
import { format } from "date-fns";

interface DocumentItem {
  id: string;
  rawType: string;
  documentType: string;
  status: string;
  studentName: string;
  lrn: string;
  gradeLevel: string;
  section: string;
  schoolYear: string;
  ocrConfidence: number | null;
  missingFlags: string[];
  validationRuleCount: number;
  failedRuleCount: number;
  createdAt: string;
  originalFilename: string;
}

interface Props {
  initialDocuments: DocumentItem[];
  totalCount: number;
  sf9Count: number;
  sf10Count: number;
  psaCount: number;
  flaggedCount: number;
  availableSections: string[];
  availableSchoolYears: string[];
}

export default function PrincipalDocumentsView({
  initialDocuments,
  totalCount,
  sf9Count,
  sf10Count,
  psaCount,
  flaggedCount,
  availableSections,
  availableSchoolYears,
}: Props) {
  const [documents, setDocuments] = useState<DocumentItem[]>(initialDocuments);
  const [isPending, startTransition] = useTransition();

  // Filter States
  const [query, setQuery] = useState("");
  const [docType, setDocType] = useState("All");
  const [grade, setGrade] = useState("All");
  const [section, setSection] = useState("All");
  const [status, setStatus] = useState("All");

  const applyFilters = (
    nextQuery = query,
    nextDocType = docType,
    nextGrade = grade,
    nextSection = section,
    nextStatus = status
  ) => {
    startTransition(async () => {
      const res = await getPrincipalDocumentSummary({
        query: nextQuery,
        docType: nextDocType,
        grade: nextGrade,
        section: nextSection,
        status: nextStatus,
      });

      if (!("error" in res)) {
        setDocuments(res.documents);
      }
    });
  };

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#7c3aed]/10 text-[#7c3aed]">
              <FileText className="h-3.5 w-3.5" />
              Document Monitoring Queue
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700">
              TRIS Senior High School
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Scanned Document Archives & Monitoring
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Audit processing pipelines, OCR extraction accuracy, validation flags, and missing records.
          </p>
        </div>
      </div>

      {/* Summary KPI Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6">
        <button
          onClick={() => {
            setDocType("All");
            applyFilters(query, "All", grade, section, status);
          }}
          className={`p-3 rounded-lg border text-left transition-all ${
            docType === "All"
              ? "bg-[#7c3aed]/10 border-[#7c3aed] ring-1 ring-[#7c3aed]"
              : "bg-white border-zinc-200 hover:bg-zinc-50"
          }`}
        >
          <span className="text-[0.65rem] font-bold text-zinc-500 uppercase">All Documents</span>
          <p className="text-xl font-bold text-zinc-900 mt-0.5">{totalCount}</p>
        </button>

        <button
          onClick={() => {
            setDocType("sf9");
            applyFilters(query, "sf9", grade, section, status);
          }}
          className={`p-3 rounded-lg border text-left transition-all ${
            docType === "sf9"
              ? "bg-purple-100 border-purple-500 ring-1 ring-purple-500"
              : "bg-white border-zinc-200 hover:bg-zinc-50"
          }`}
        >
          <span className="text-[0.65rem] font-bold text-purple-700 uppercase">Old SHS SF9</span>
          <p className="text-xl font-bold text-purple-900 mt-0.5">{sf9Count}</p>
        </button>

        <button
          onClick={() => {
            setDocType("sf10");
            applyFilters(query, "sf10", grade, section, status);
          }}
          className={`p-3 rounded-lg border text-left transition-all ${
            docType === "sf10"
              ? "bg-blue-100 border-blue-500 ring-1 ring-blue-500"
              : "bg-white border-zinc-200 hover:bg-zinc-50"
          }`}
        >
          <span className="text-[0.65rem] font-bold text-blue-700 uppercase">Old SHS SF10</span>
          <p className="text-xl font-bold text-blue-900 mt-0.5">{sf10Count}</p>
        </button>

        <button
          onClick={() => {
            setDocType("birth_cert");
            applyFilters(query, "birth_cert", grade, section, status);
          }}
          className={`p-3 rounded-lg border text-left transition-all ${
            docType === "birth_cert"
              ? "bg-emerald-100 border-emerald-500 ring-1 ring-emerald-500"
              : "bg-white border-zinc-200 hover:bg-zinc-50"
          }`}
        >
          <span className="text-[0.65rem] font-bold text-emerald-700 uppercase">PSA Birth Cert</span>
          <p className="text-xl font-bold text-emerald-900 mt-0.5">{psaCount}</p>
        </button>

        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/60 text-left">
          <span className="text-[0.65rem] font-bold text-amber-700 uppercase flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-600" />
            Incomplete/Flags
          </span>
          <p className="text-xl font-bold text-amber-900 mt-0.5">{flaggedCount}</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card padding="md" className="bg-white mt-5 shadow-xs border border-zinc-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search */}
          <div className="lg:col-span-1">
            <label className="block text-xs font-medium text-zinc-600 mb-1">Search Scans</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Learner, LRN, file..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  applyFilters(e.target.value, docType, grade, section, status);
                }}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-zinc-300 focus:outline-none focus:ring-1 focus:ring-[#7c3aed] focus:border-[#7c3aed]"
              />
            </div>
          </div>

          {/* Doc Type */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Document Type</label>
            <select
              value={docType}
              onChange={(e) => {
                setDocType(e.target.value);
                applyFilters(query, e.target.value, grade, section, status);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#7c3aed] focus:border-[#7c3aed]"
            >
              <option value="All">All Supported Types</option>
              <option value="sf9">Old SHS SF9 (Report Card)</option>
              <option value="sf10">Old SHS SF10 (Permanent Record)</option>
              <option value="birth_cert">PSA Birth Certificate</option>
            </select>
          </div>

          {/* Grade Level */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Grade Level</label>
            <select
              value={grade}
              onChange={(e) => {
                setGrade(e.target.value);
                applyFilters(query, docType, e.target.value, section, status);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#7c3aed] focus:border-[#7c3aed]"
            >
              <option value="All">All Grades (11 & 12)</option>
              <option value="Grade 11">Grade 11</option>
              <option value="Grade 12">Grade 12</option>
            </select>
          </div>

          {/* Section */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Section</label>
            <select
              value={section}
              onChange={(e) => {
                setSection(e.target.value);
                applyFilters(query, docType, grade, e.target.value, status);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#7c3aed] focus:border-[#7c3aed]"
            >
              <option value="All">All Sections</option>
              {availableSections.map((sec) => (
                <option key={sec} value={sec}>{sec}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Processing Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                applyFilters(query, docType, grade, section, e.target.value);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#7c3aed] focus:border-[#7c3aed]"
            >
              <option value="All">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="needs_review">Needs Review</option>
              <option value="extracted">Extracted</option>
              <option value="validated">Validated</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100 text-xs text-zinc-500">
          <span>Showing {documents.length} scanned documents</span>
          {isPending && <span className="text-[#7c3aed] font-medium">Filtering records...</span>}
        </div>
      </Card>

      {/* Scanned Document List */}
      <Card padding="none" className="bg-white mt-6 overflow-hidden shadow-xs border border-zinc-200">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document Type</TableHead>
                <TableHead>Learner Name</TableHead>
                <TableHead>LRN</TableHead>
                <TableHead>Grade & Section</TableHead>
                <TableHead>School Year</TableHead>
                <TableHead>Validation Status</TableHead>
                <TableHead>Incomplete / Flags</TableHead>
                <TableHead>Upload Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.length > 0 ? (
                documents.map((doc) => {
                  let formattedDate = "-";
                  try {
                    if (doc.createdAt) {
                      formattedDate = format(new Date(doc.createdAt), "MMM d, yyyy");
                    }
                  } catch {
                    formattedDate = doc.createdAt;
                  }

                  return (
                    <TableRow key={doc.id} className="hover:bg-zinc-50/80">
                      <TableCell className="font-medium">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                          doc.rawType === "sf9"
                            ? "bg-purple-100 text-purple-800"
                            : doc.rawType === "sf10"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {doc.documentType}
                        </span>
                      </TableCell>
                      <TableCell className="font-semibold text-zinc-900">
                        {doc.studentName}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-zinc-600">
                        {doc.lrn}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-700">
                        {doc.gradeLevel} &bull; {doc.section}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-600">
                        {doc.schoolYear}
                      </TableCell>
                      <TableCell>
                        <DocumentStatusBadge status={doc.status as any} />
                      </TableCell>
                      <TableCell>
                        {doc.missingFlags.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {doc.missingFlags.map((flag, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.625rem] font-medium bg-amber-50 text-amber-800 border border-amber-200"
                              >
                                <AlertTriangle className="h-2.5 w-2.5 text-amber-600" />
                                {flag}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[0.65rem] text-emerald-700 font-medium">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            Complete
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500">
                        {formattedDate}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-[#7c3aed] bg-[#7c3aed]/10 hover:bg-[#7c3aed]/20 transition-colors"
                        >
                          <span>View Scans</span>
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-sm text-zinc-500">
                    No scanned documents match the specified filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </PageContainer>
  );
}

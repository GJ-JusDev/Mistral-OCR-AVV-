"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTableContainer } from "@/components/ui/DataTableContainer";
import { fetchAdminAuditLogs, exportAdminAuditLogsCsv } from "@/actions/audit";
import { formatToManilaTime } from "@/lib/audit/auditLogger";
import type {
  AuditEvent,
  AuditCategory,
  AuditAction,
  AuditOutcome,
  AuditLogFilters,
} from "@/types/audit";
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  Filter,
  Download,
  RefreshCw,
  Clock,
  User,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  History,
  Eye,
  X,
  FileSpreadsheet,
  ArrowRight,
  Layers,
  ChevronLeft,
  ChevronRight,
  School,
  Lock,
} from "lucide-react";

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditEvent[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [isDegraded, setIsDegraded] = useState<boolean>(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<AuditCategory | "ALL">("ALL");
  const [outcomeFilter, setOutcomeFilter] = useState<AuditOutcome | "ALL">("ALL");
  const [datePreset, setDatePreset] = useState<"ALL" | "TODAY" | "7DAYS" | "30DAYS">("ALL");

  // Selected event for detail modal
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  // Summary Metrics
  const [metrics, setMetrics] = useState({
    totalEvents: 0,
    successCount: 0,
    failureCount: 0,
    deniedCount: 0,
    securityEventsCount: 0,
  });

  const computedDateRange = useMemo(() => {
    if (datePreset === "ALL") return { startDate: undefined, endDate: undefined };

    const now = new Date();
    const end = now.toISOString();

    if (datePreset === "TODAY") {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      return { startDate: todayStart, endDate: end };
    }
    if (datePreset === "7DAYS") {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return { startDate: sevenDaysAgo, endDate: end };
    }
    if (datePreset === "30DAYS") {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      return { startDate: thirtyDaysAgo, endDate: end };
    }

    return { startDate: undefined, endDate: undefined };
  }, [datePreset]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    const filters: AuditLogFilters = {
      searchQuery: searchQuery || undefined,
      category: categoryFilter !== "ALL" ? categoryFilter : undefined,
      outcome: outcomeFilter !== "ALL" ? outcomeFilter : undefined,
      startDate: computedDateRange.startDate,
      endDate: computedDateRange.endDate,
    };

    const res = await fetchAdminAuditLogs(filters, { page, pageSize });

    if (!res.success || !res.data) {
      setError(res.error || "Failed to load audit records.");
      setLogs([]);
      setTotalCount(0);
    } else {
      setLogs(res.data.logs);
      setTotalCount(res.data.totalCount);
      setMetrics(res.data.summaryMetrics);
      setIsDegraded(Boolean(res.data.isDegraded));
    }

    setLoading(false);
  }, [searchQuery, categoryFilter, outcomeFilter, computedDateRange, page, pageSize]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleExportCsv = async () => {
    setExporting(true);
    setExportNotice(null);

    const filters: AuditLogFilters = {
      searchQuery: searchQuery || undefined,
      category: categoryFilter !== "ALL" ? categoryFilter : undefined,
      outcome: outcomeFilter !== "ALL" ? outcomeFilter : undefined,
      startDate: computedDateRange.startDate,
      endDate: computedDateRange.endDate,
    };

    const res = await exportAdminAuditLogsCsv(filters);

    if (res.success && res.csv) {
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", res.filename || "audit_logs.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportNotice(`Exported audit logs successfully as ${res.filename}. This export event was logged.`);
      setTimeout(() => setExportNotice(null), 5000);
      loadLogs();
    } else {
      alert(`Export failed: ${res.error || "Unknown error"}`);
    }

    setExporting(false);
  };

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const renderOutcomeBadge = (outcome: AuditOutcome) => {
    switch (outcome) {
      case "SUCCESS":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> SUCCESS
          </span>
        );
      case "FAILURE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <XCircle className="w-3 h-3 text-rose-600" /> FAILURE
          </span>
        );
      case "DENIED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <ShieldAlert className="w-3 h-3 text-amber-600" /> DENIED
          </span>
        );
      case "WARNING":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-yellow-50 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800">
            <AlertTriangle className="w-3 h-3 text-yellow-600" /> WARNING
          </span>
        );
    }
  };

  const renderCategoryBadge = (category: AuditCategory) => {
    const colorMap: Record<AuditCategory, string> = {
      AUTHENTICATION: "bg-blue-50 text-blue-700 border-blue-200",
      REGISTRATION: "bg-purple-50 text-purple-700 border-purple-200",
      USER_MANAGEMENT: "bg-indigo-50 text-indigo-700 border-indigo-200",
      DOCUMENT: "bg-slate-100 text-slate-700 border-slate-200",
      OCR: "bg-cyan-50 text-cyan-700 border-cyan-200",
      COMPARISON: "bg-teal-50 text-teal-700 border-teal-200",
      ACADEMIC: "bg-emerald-50 text-emerald-700 border-emerald-200",
      ATTENDANCE: "bg-sky-50 text-sky-700 border-sky-200",
      REMEDIAL: "bg-orange-50 text-orange-700 border-orange-200",
      ELIGIBILITY: "bg-amber-50 text-amber-700 border-amber-200",
      REVIEW: "bg-violet-50 text-violet-700 border-violet-200",
      REPORT: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
      SECURITY: "bg-rose-50 text-rose-700 border-rose-200",
      SYSTEM: "bg-zinc-100 text-zinc-700 border-zinc-200",
    };

    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${colorMap[category] || "bg-zinc-100 text-zinc-700 border-zinc-200"}`}>
        {category}
      </span>
    );
  };

  return (
    <PageContainer>
      <Header
        title="Audit Logs & Activity Monitoring"
        description="Immutable administrative activity history for institutional accountability, compliance, and security."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Admin", href: "/admin/users" },
          { label: "Audit Logs" },
        ]}
      />

      {/* Institutional DepEd Invariant Banner */}
      <div className="mt-4 flex items-center justify-between flex-wrap gap-2 px-4 py-2 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg text-xs text-slate-700 dark:text-zinc-300">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#174EA6]" />
          <span className="font-semibold text-[#0B1F33] dark:text-white">Taysan Resettlement Integrated School (TRIS)</span>
          <span className="text-zinc-400">•</span>
          <span>School ID: <strong>500169</strong></span>
        </div>
        <div className="flex items-center gap-2 text-zinc-500">
          <Lock className="w-3.5 h-3.5 text-emerald-600" />
          <span>Append-Only Immutability • Philippine Data Privacy Act Compliant</span>
        </div>
      </div>

      {exportNotice && (
        <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {isDegraded && (
        <div className="mt-4 p-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
            <span className="font-semibold">Degraded Audit Storage Mode:</span> The database table <code>audit_logs</code> is operating in transient memory fallback mode. Events recorded in this state are volatile and will not survive server restarts or multi-instance execution until Migration 014 is executed on Supabase.
          </div>
        </div>
      )}

      {/* Summary Metrics Grid */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Activities Logged"
          value={metrics.totalEvents}
          subtitle="All recorded events"
          variant="royal"
          icon={<History className="w-5 h-5 text-[#174EA6]" />}
        />
        <StatCard
          title="Successful Operations"
          value={metrics.successCount}
          subtitle="Validated & completed"
          variant="success"
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard
          title="Warnings & Discrepancies"
          value={metrics.failureCount}
          subtitle="Discrepancies & errors"
          variant="warning"
          icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
        />
        <StatCard
          title="Security & Access Denials"
          value={metrics.deniedCount + metrics.securityEventsCount}
          subtitle="Unauthorized & rejected logins"
          variant="danger"
          icon={<ShieldAlert className="w-5 h-5 text-rose-600" />}
        />
      </div>

      {/* Filter and Control Toolbar */}
      <Card padding="md" className="mt-6 border-slate-200 dark:border-zinc-800">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search actor email, action, reason, target label..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-[#174EA6]"
              />
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2 self-end md:self-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={loadLogs}
                disabled={loading}
                className="text-xs flex items-center gap-1.5"
                title="Refresh Activity Log"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={exporting || logs.length === 0}
                className="text-xs flex items-center gap-1.5 border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                title="Export filtered records to CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                {exporting ? "Exporting..." : "Export CSV"}
              </Button>
            </div>
          </div>

          {/* Dropdown Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
            {/* Category Filter */}
            <div>
              <label className="block text-zinc-500 font-medium mb-1">Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value as any);
                  setPage(1);
                }}
                className="w-full p-2 border rounded-lg bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700"
              >
                <option value="ALL">All Categories</option>
                <option value="AUTHENTICATION">Authentication</option>
                <option value="REGISTRATION">Registration</option>
                <option value="USER_MANAGEMENT">User Management</option>
                <option value="DOCUMENT">Document Processing</option>
                <option value="OCR">OCR Operations</option>
                <option value="COMPARISON">SF9/SF10 Comparison</option>
                <option value="ACADEMIC">Academic Records</option>
                <option value="REVIEW">Validation Review</option>
                <option value="REPORT">Reports & Export</option>
                <option value="SECURITY">Security & Access</option>
              </select>
            </div>

            {/* Outcome Filter */}
            <div>
              <label className="block text-zinc-500 font-medium mb-1">Outcome</label>
              <select
                value={outcomeFilter}
                onChange={(e) => {
                  setOutcomeFilter(e.target.value as any);
                  setPage(1);
                }}
                className="w-full p-2 border rounded-lg bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700"
              >
                <option value="ALL">All Outcomes</option>
                <option value="SUCCESS">Success Only</option>
                <option value="FAILURE">Failures Only</option>
                <option value="DENIED">Denied / Rejected Only</option>
                <option value="WARNING">Warnings Only</option>
              </select>
            </div>

            {/* Date Range Preset */}
            <div>
              <label className="block text-zinc-500 font-medium mb-1">Time Period</label>
              <select
                value={datePreset}
                onChange={(e) => {
                  setDatePreset(e.target.value as any);
                  setPage(1);
                }}
                className="w-full p-2 border rounded-lg bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700"
              >
                <option value="ALL">All Recorded History</option>
                <option value="TODAY">Today (Asia/Manila)</option>
                <option value="7DAYS">Last 7 Days</option>
                <option value="30DAYS">Last 30 Days</option>
              </select>
            </div>
          </div>
        </div>
      </Card>

      {/* Main Table Container */}
      <div className="mt-6">
        <DataTableContainer
          title={`Administrative Activity Records (${totalCount})`}
          description="Real-time chronological events from all verified sub-modules"
          actions={
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>Show</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="p-1 border rounded bg-white dark:bg-zinc-900 border-zinc-300"
              >
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>entries</span>
            </div>
          }
        >
          {loading ? (
            <LoadingState message="Retrieving institutional audit history..." />
          ) : error ? (
            <div className="p-8 text-center text-rose-600 bg-rose-50/50">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-500" />
              <p className="font-semibold text-sm">{error}</p>
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              title="No audit records match the selected criteria"
              description="Try adjusting your search terms, category filters, or time range."
              icon={<History className="w-8 h-8 text-zinc-400" />}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter("ALL");
                    setOutcomeFilter("ALL");
                    setDatePreset("ALL");
                  }}
                >
                  Clear Filters
                </Button>
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-slate-50/60 dark:bg-zinc-800/60 text-xs text-zinc-500 uppercase">
                      <th className="py-3 px-4 font-semibold">Timestamp (Manila)</th>
                      <th className="py-3 px-4 font-semibold">Actor</th>
                      <th className="py-3 px-4 font-semibold">Event / Action</th>
                      <th className="py-3 px-4 font-semibold">Target Entity</th>
                      <th className="py-3 px-4 font-semibold text-center">Outcome</th>
                      <th className="py-3 px-4 font-semibold text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs sm:text-sm">
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className={`hover:bg-slate-50/50 dark:hover:bg-zinc-800/40 transition-colors ${
                          log.outcome === "DENIED" || log.outcome === "FAILURE"
                            ? "bg-rose-50/20"
                            : ""
                        }`}
                      >
                        {/* Timestamp */}
                        <td className="py-3 px-4 whitespace-nowrap text-zinc-600 dark:text-zinc-400 text-xs font-mono">
                          <span className="block font-medium text-slate-900 dark:text-white">
                            {formatToManilaTime(log.created_at)}
                          </span>
                          <span className="text-[10px] text-zinc-400">PHT (UTC+8)</span>
                        </td>

                        {/* Actor */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-900 dark:text-white truncate max-w-[180px]">
                              {log.actor_email || (log.actor_user_id ? `User: ${log.actor_user_id.slice(0, 8)}` : "System / Anon")}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] uppercase font-bold text-slate-500">
                                {log.actor_role}
                              </span>
                              {log.actor_school_name && (
                                <span className="text-[10px] text-zinc-400 truncate max-w-[130px]">
                                  • TRIS
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Event / Action */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col items-start gap-1">
                            {renderCategoryBadge(log.category)}
                            <span className="font-mono text-xs text-slate-800 dark:text-zinc-200">
                              {log.action}
                            </span>
                          </div>
                        </td>

                        {/* Target Entity */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col max-w-[200px]">
                            <span className="text-xs font-medium text-slate-900 dark:text-white truncate">
                              {log.target_label || log.target_id || "-"}
                            </span>
                            {log.target_type && (
                              <span className="text-[10px] text-zinc-400 uppercase">
                                Type: {log.target_type}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Outcome */}
                        <td className="py-3 px-4 text-center">
                          {renderOutcomeBadge(log.outcome)}
                        </td>

                        {/* Details Action */}
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => setSelectedEvent(log)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#174EA6]" />
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer */}
              <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span>
                  Showing {Math.min((page - 1) * pageSize + 1, totalCount)} to{" "}
                  {Math.min(page * pageSize, totalCount)} of {totalCount} events
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="h-8 px-2.5"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </Button>
                  <span className="font-medium px-2">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="h-8 px-2.5"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </DataTableContainer>
      </div>

      {/* =================================================================== */}
      {/* Event Details Inspection Modal                                      */}
      {/* =================================================================== */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <Card padding="lg" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-5 relative border-slate-300 dark:border-zinc-700">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {renderCategoryBadge(selectedEvent.category)}
                  {renderOutcomeBadge(selectedEvent.outcome)}
                </div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white font-mono">
                  {selectedEvent.action}
                </h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1 text-zinc-400 hover:text-zinc-700 rounded-lg"
                title="Close Modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Event Metadata Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-zinc-900 p-4 rounded-lg border">
              <div>
                <span className="text-zinc-400 uppercase font-bold text-[10px] block">Event ID</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200 select-all">{selectedEvent.id}</span>
              </div>
              <div>
                <span className="text-zinc-400 uppercase font-bold text-[10px] block">Timestamp (Asia/Manila)</span>
                <span className="text-zinc-800 dark:text-zinc-200 font-medium">
                  {formatToManilaTime(selectedEvent.created_at)}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 uppercase font-bold text-[10px] block">Actor</span>
                <span className="text-zinc-800 dark:text-zinc-200 font-medium">
                  {selectedEvent.actor_email || selectedEvent.actor_user_id || "System"} ({selectedEvent.actor_role})
                </span>
              </div>
              <div>
                <span className="text-zinc-400 uppercase font-bold text-[10px] block">School Scope</span>
                <span className="text-zinc-800 dark:text-zinc-200">
                  {selectedEvent.actor_school_name || "TRIS (500169)"}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 uppercase font-bold text-[10px] block">Target Entity</span>
                <span className="text-zinc-800 dark:text-zinc-200 font-medium">
                  {selectedEvent.target_label || selectedEvent.target_id || "None"}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 uppercase font-bold text-[10px] block">Reason / Justification</span>
                <span className="text-zinc-800 dark:text-zinc-200">
                  {selectedEvent.reason || "Standard system operation"}
                </span>
              </div>
            </div>

            {/* Before / After Diff Viewer if present in details */}
            {selectedEvent.details && (selectedEvent.details.previous_status || selectedEvent.details.new_status) && (
              <div className="p-3 rounded-lg border bg-amber-50/40 border-amber-200 text-xs">
                <span className="font-bold text-amber-900 block mb-2">State Transition</span>
                <div className="flex items-center gap-3 font-mono">
                  <span className="px-2 py-1 bg-white border rounded text-rose-700">
                    Before: {selectedEvent.details.previous_status || "N/A"}
                  </span>
                  <ArrowRight className="w-4 h-4 text-amber-600" />
                  <span className="px-2 py-1 bg-white border rounded text-emerald-700 font-bold">
                    After: {selectedEvent.details.new_status || "N/A"}
                  </span>
                </div>
              </div>
            )}

            {/* Sanitized JSON Details Viewer */}
            <div>
              <span className="text-xs font-bold text-slate-700 dark:text-zinc-300 block mb-1">
                Sanitized Event Payload & Metadata
              </span>
              <pre className="p-3 rounded-lg bg-zinc-950 text-emerald-400 text-xs font-mono overflow-x-auto max-h-48 border border-zinc-800">
                {JSON.stringify(selectedEvent.details || {}, null, 2)}
              </pre>
            </div>

            {/* Footer */}
            <div className="flex justify-end pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setSelectedEvent(null)}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}

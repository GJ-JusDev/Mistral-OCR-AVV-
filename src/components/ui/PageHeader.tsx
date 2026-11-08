"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight, ShieldCheck, GraduationCap, School } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  roleBadge?: {
    role: string;
    label?: string;
  };
  schoolInfo?: {
    schoolName?: string;
    depedSchoolId?: string;
  };
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  roleBadge,
  schoolInfo,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={`w-full bg-white border-b border-slate-200/80 px-4 py-4 sm:px-6 lg:px-8 ${className}`}>
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex items-center space-x-1.5 text-xs text-slate-500">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <li key={idx} className="flex items-center">
                  {crumb.href && !isLast ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-[#174EA6] font-medium transition-colors"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={isLast ? "text-slate-800 font-semibold" : ""}>
                      {crumb.label}
                    </span>
                  )}
                  {!isLast && (
                    <ChevronRight className="mx-1 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {/* Main Header Row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0B1F33]">
              {title}
            </h1>

            {roleBadge && (
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                roleBadge.role.toLowerCase() === "principal"
                  ? "bg-[#174EA6]/10 text-[#174EA6] border border-[#174EA6]/20"
                  : roleBadge.role.toLowerCase() === "admin"
                  ? "bg-slate-800/10 text-slate-800 border border-slate-800/20"
                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
              }`}>
                <GraduationCap className="h-3.5 w-3.5" />
                {roleBadge.label || (roleBadge.role.charAt(0).toUpperCase() + roleBadge.role.slice(1))}
              </span>
            )}

            {schoolInfo?.depedSchoolId && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
                <School className="h-3 w-3" />
                School ID: {schoolInfo.depedSchoolId}
              </span>
            )}
          </div>

          {description && (
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-3xl">
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0 sm:self-center">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;

"use client";

import React, { ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
    label: string;
  };
  variant?: "default" | "royal" | "gold" | "success" | "warning" | "danger";
  className?: string;
  onClick?: () => void;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  variant = "default",
  className = "",
  onClick,
}: StatCardProps) {
  const iconVariants = {
    default: "bg-slate-100 text-slate-700",
    royal: "bg-[#174EA6]/10 text-[#174EA6]",
    gold: "bg-[#F4C542]/20 text-amber-700",
    success: "bg-emerald-50 text-emerald-700 border border-emerald-100",
    warning: "bg-amber-50 text-amber-700 border border-amber-100",
    danger: "bg-red-50 text-red-700 border border-red-100",
  };

  const borderAccents = {
    default: "hover:border-slate-300",
    royal: "hover:border-[#174EA6]/50",
    gold: "hover:border-[#F4C542]",
    success: "hover:border-emerald-300",
    warning: "hover:border-amber-300",
    danger: "hover:border-red-300",
  };

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm transition-all duration-200 ${
        borderAccents[variant]
      } ${onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : ""} ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs sm:text-sm font-medium text-slate-600 truncate">
          {title}
        </span>
        {icon && (
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${iconVariants[variant]}`}
          >
            {icon}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <div className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0B1F33]">
          {value}
        </div>
        {trend && (
          <div
            className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
              trend.isPositive ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {trend.isPositive ? (
              <ArrowUpIcon className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownIcon className="h-3.5 w-3.5" />
            )}
            <span>{trend.value}%</span>
            <span className="text-slate-400 font-normal ml-0.5 text-[10px] hidden sm:inline">
              {trend.label}
            </span>
          </div>
        )}
      </div>

      {subtitle && (
        <p className="mt-1 text-xs text-slate-500 truncate">{subtitle}</p>
      )}
    </div>
  );
}

export default StatCard;

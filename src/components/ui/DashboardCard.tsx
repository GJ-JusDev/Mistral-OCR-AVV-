"use client";

import React from "react";

export interface DashboardCardProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  accentBorder?: boolean;
}

export const DashboardCard: React.FC<DashboardCardProps> = ({
  title,
  description,
  icon,
  headerAction,
  footer,
  children,
  className = "",
  padding = "md",
  accentBorder = false,
}) => {
  const paddings = {
    none: "p-0",
    sm: "p-3 sm:p-4",
    md: "p-5 sm:p-6",
    lg: "p-6 sm:p-8",
  };

  return (
    <div
      className={`bg-white rounded-xl border ${
        accentBorder ? "border-l-4 border-l-[#174EA6] border-slate-200" : "border-slate-200/80"
      } shadow-sm hover:shadow transition-shadow ${className}`}
    >
      {(title || description || headerAction || icon) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#174EA6]/10 text-[#174EA6] shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h3 className="text-sm sm:text-base font-semibold text-[#0B1F33] truncate">
                  {title}
                </h3>
              )}
              {description && (
                <p className="text-xs text-slate-500 mt-0.5 truncate">{description}</p>
              )}
            </div>
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      )}
      <div className={paddings[padding]}>{children}</div>
      {footer && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-3 sm:px-6 rounded-b-xl">
          {footer}
        </div>
      )}
    </div>
  );
};

export default DashboardCard;

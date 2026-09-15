"use client";

import { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

export type StatsCardProps = {
  title: string;
  value: string | number;
  icon?: ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
    label: string;
  };
  className?: string;
};

export function StatsCard({ title, value, icon, trend, className }: StatsCardProps) {
  return (
    <Card padding="md" className={`flex flex-col gap-2 ${className ?? ""}`}>
      <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
        <h3 className="text-sm font-medium">{title}</h3>
        {icon}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">{value}</div>
        {trend && (
          <div className="flex items-center gap-1 text-xs">
            {trend.isPositive ? (
              <span className="flex items-center text-emerald-600 dark:text-emerald-400">
                <ArrowUpIcon className="h-3 w-3 mr-0.5" />
                {trend.value}%
              </span>
            ) : (
              <span className="flex items-center text-red-600 dark:text-red-400">
                <ArrowDownIcon className="h-3 w-3 mr-0.5" />
                {trend.value}%
              </span>
            )}
            <span className="text-zinc-500">{trend.label}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

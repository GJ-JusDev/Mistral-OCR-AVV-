"use client";

import { StatsCard, type StatsCardProps } from "./StatsCard";

export function StatsGrid({ stats }: { stats: StatsCardProps[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, i) => (
        <StatsCard key={i} {...stat} />
      ))}
    </div>
  );
}

"use client";

import PageContainer from "@/components/layout/PageContainer";
import Header from "@/components/layout/Header";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
  return (
    <PageContainer>
      <Header title="Reports" description="Detailed analytics and exports." />
      <div className="mt-6">
        <EmptyState 
          icon={<BarChart3 className="h-10 w-10 text-zinc-400" />}
          title="Reports Dashboard Under Construction"
          description="Detailed PDF/CSV exports and school-level analytics will be available here."
        />
      </div>
    </PageContainer>
  );
}

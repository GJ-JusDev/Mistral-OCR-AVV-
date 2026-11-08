import React from "react";
import { getPrincipalAcademicOverview } from "@/actions/principal";
import PrincipalAcademicView from "@/components/principal/PrincipalAcademicView";
import PageContainer from "@/components/layout/PageContainer";

export default async function PrincipalAcademicPage() {
  const result = await getPrincipalAcademicOverview();

  if ("error" in result) {
    return (
      <PageContainer>
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <h2 className="text-lg font-bold">Access Denied or Database Error</h2>
          <p className="mt-1 text-sm">{result.error}</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PrincipalAcademicView
      initialMetrics={result.metrics}
      initialSectionSummaries={result.sectionSummaries}
      initialStudents={result.students}
      totalCount={result.totalCount}
    />
  );
}

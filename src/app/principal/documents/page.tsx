import React from "react";
import { getPrincipalDocumentSummary } from "@/actions/principal";
import PrincipalDocumentsView from "@/components/principal/PrincipalDocumentsView";
import PageContainer from "@/components/layout/PageContainer";

export default async function PrincipalDocumentsPage() {
  const result = await getPrincipalDocumentSummary();

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
    <PrincipalDocumentsView
      initialDocuments={result.documents}
      totalCount={result.totalCount}
      sf9Count={result.sf9Count}
      sf10Count={result.sf10Count}
      psaCount={result.psaCount}
      flaggedCount={result.flaggedCount}
      availableSections={result.availableSections}
      availableSchoolYears={result.availableSchoolYears}
    />
  );
}

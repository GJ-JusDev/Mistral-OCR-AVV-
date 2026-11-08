import React from "react";
import { getPrincipalStudentRecords } from "@/actions/principal";
import PrincipalStudentsView from "@/components/principal/PrincipalStudentsView";
import PageContainer from "@/components/layout/PageContainer";

export default async function PrincipalStudentsPage() {
  const result = await getPrincipalStudentRecords();

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
    <PrincipalStudentsView
      initialStudents={result.students}
      initialSections={result.availableSections}
      initialSchoolYears={result.availableSchoolYears}
      totalCount={result.totalCount}
    />
  );
}

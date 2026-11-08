import React from "react";
import { 
  getPrincipalDashboardData, 
  getPrincipalStudentRecords, 
  getPrincipalDocumentSummary, 
  getPrincipalAcademicOverview 
} from "@/actions/principal";
import ReportsView from "@/components/reports/ReportsView";
import PageContainer from "@/components/layout/PageContainer";

export default async function ReportsPage() {
  const [dashRes, studentsRes, docsRes, academicRes] = await Promise.all([
    getPrincipalDashboardData(),
    getPrincipalStudentRecords(),
    getPrincipalDocumentSummary(),
    getPrincipalAcademicOverview(),
  ]);

  if ("error" in dashRes) {
    return (
      <PageContainer>
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <h2 className="text-lg font-bold">Access Denied or Database Error</h2>
          <p className="mt-1 text-sm">{dashRes.error}</p>
        </div>
      </PageContainer>
    );
  }

  const studentsList = ("students" in studentsRes && Array.isArray(studentsRes.students)) ? studentsRes.students : [];
  const docsList = ("documents" in docsRes && Array.isArray(docsRes.documents)) ? docsRes.documents : [];
  const academicList = ("students" in academicRes && Array.isArray(academicRes.students)) ? academicRes.students : [];

  return (
    <ReportsView
      school={dashRes.school}
      summary={{
        totalStudents: dashRes.summaryCards.totalStudents,
        totalDocuments: dashRes.summaryCards.totalDocuments,
        grade11Count: dashRes.summaryCards.grade11Count,
        grade12Count: dashRes.summaryCards.grade12Count,
        approvedCount: dashRes.summaryCards.approvedDocumentCount,
        pendingCount: dashRes.summaryCards.awaitingReviewCount,
        rejectedCount: dashRes.summaryCards.rejectedDocumentCount,
      }}
      students={studentsList}
      documents={docsList}
      academic={academicList}
    />
  );
}

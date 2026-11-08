"use server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { parseGradeNumber } from "@/lib/students/studentDirectory";
import { compareUnifiedStudentDocuments, RawNameFields } from "@/lib/validation/nameComparison";
import { evaluateShsStudentEligibility, EvaluatedSubject, ShsEligibilityType } from "@/lib/eligibility/evaluator";
import type { RemedialStatus } from "@/lib/remedial/remedialEvaluator";
import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit/auditLogger";

// Default single institution scope (TRIS)
const TRIS_UUID = "a0000000-0000-0000-0000-000000000001";
const TRIS_SCHOOL_ID = "300792";

/**
 * PRINCIPAL AT ADMIN ROLE SECURITY CONTEXT
 *
 * Bakit ito kailangan:
 * Lahat ng data para sa School Head (mga grado, signed image URLs, student records)
 * ay protektado. Sinisiguro nitong lehitimong Principal o Administrator lang na
 * may "Approved" status ang makakakita sa dashboard ng TRIS (DepEd School ID 300792).
 */
async function getAuthorizedPrincipalContext() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized: Please log in to view principal records." };
  }

  const { data: roleRow, error: roleError } = await supabase
    .from("user_roles")
    .select("role, account_status, school_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError || !roleRow) {
    return { error: "Forbidden: No role assignment found." };
  }

  const role = (roleRow.role || "").toLowerCase();
  if (role !== "principal" && role !== "admin") {
    return { error: "Forbidden: Access is restricted to authorized school heads and administrators." };
  }

  if (roleRow.account_status !== "Approved") {
    return { error: "Forbidden: Principal account is pending administrator approval." };
  }

  const schoolId = roleRow.school_id || TRIS_UUID;

  return { supabase, user, roleRow, schoolId };
}

/**
 * Standardize grade representation to Senior High School Grade 11 or Grade 12
 */
function normalizeShsGrade(gradeRaw?: string | null): string {
  if (!gradeRaw) return "Unknown";
  const num = parseGradeNumber(gradeRaw);
  if (num === 11) return "Grade 11";
  if (num === 12) return "Grade 12";
  const str = String(gradeRaw).trim();
  if (/11/i.test(str)) return "Grade 11";
  if (/12/i.test(str)) return "Grade 12";
  return str || "Unknown";
}

/**
 * PRIVATE STORAGE SIGNED URL GENERATOR (1-HOUR TTL)
 *
 * Bakit kailangan ng Signed URL:
 * Ang kumpletong original scans ng SF9, SF10, at PSA ay nakatago sa isang private
 * Supabase Storage bucket ('documents'). Hindi ito pwedeng gawing public sa internet
 * dahil sa Data Privacy Act (naglalalaman ng PII ng estudyante).
 * Gumagawa tayo ng pansamantalang 1-hour signed URL para ma-inspect ito ng Principal.
 */
async function getSignedDocumentImageUrl(supabase: any, storagePathOrUrl?: string | null): Promise<string | null> {
  if (!storagePathOrUrl) return null;
  if (storagePathOrUrl.startsWith("data:")) return storagePathOrUrl;
  
  let path = storagePathOrUrl;
  if (path.includes("/documents/")) {
    path = path.split("/documents/")[1].split("?")[0];
  }
  
  try {
    const { data } = await supabase.storage.from("documents").createSignedUrl(path, 3600);
    return data?.signedUrl || storagePathOrUrl;
  } catch {
    return storagePathOrUrl;
  }
}

/**
 * Phase 2 & 10 — Principal Dashboard Statistics
 */
export async function getPrincipalDashboardData() {
  const authContext = await getAuthorizedPrincipalContext();
  if ("error" in authContext) return { error: authContext.error };

  const { supabase, schoolId } = authContext;

  try {
    // 1. Fetch school info
    const { data: schoolInfo } = await supabase
      .from("schools")
      .select("id, name, school_id")
      .eq("id", schoolId)
      .maybeSingle();

    // 2. Fetch all students in school
    const { data: students, error: studentErr } = await supabase
      .from("students")
      .select(`
        id,
        lrn,
        first_name,
        last_name,
        grade_level,
        overall_status,
        created_at
      `)
      .order("last_name", { ascending: true });

    if (studentErr) {
      console.error("[getPrincipalDashboardData] Student query error:", studentErr.message);
      return { error: studentErr.message };
    }

    // 3. Fetch all documents in school
    const { data: docs, error: docErr } = await supabase
      .from("documents")
      .select(`
        id,
        student_id,
        document_type,
        status,
        grade_level,
        school_year,
        created_at,
        extracted_fields,
        storage_path,
        image_url
      `)
      .order("created_at", { ascending: false });

    if (docErr) {
      console.error("[getPrincipalDashboardData] Document query error:", docErr.message);
      return { error: docErr.message };
    }

    // 4. Fetch subject grades
    const { data: allSubjectGrades } = await supabase
      .from("subject_grades")
      .select("student_id, subject, final_grade, status, semester");

    // 5. Try fetching eligibility approvals (or defensive fallback)
    let eligibilityMap = new Map<string, any>();
    try {
      const { data: approvals } = await supabase
        .from("eligibility_approvals")
        .select("*");
      (approvals || []).forEach(app => {
        eligibilityMap.set(app.student_id, app);
      });
    } catch {
      // Fallback
    }

    const allStudents = (students || []) as any[];
    const allDocs = (docs || []) as any[];
    const allGrades = (allSubjectGrades || []) as any[];

    // --- SUMMARY CARDS COUNTS ---
    const totalStudents = allStudents.length;
    const totalDocuments = allDocs.length;

    let grade11Count = 0;
    let grade12Count = 0;

    allStudents.forEach((st: any) => {
      const g = normalizeShsGrade(st.grade_level);
      if (g === "Grade 11") grade11Count++;
      else if (g === "Grade 12") grade12Count++;
    });

    // If verified students table is empty, inspect candidate students from scanned documents
    if (totalStudents === 0 && allDocs.length > 0) {
      const candidateStudentSet = new Set<string>();
      allDocs.forEach((d: any) => {
        const fields = (d.extracted_fields as any) || {};
        const lrn = fields.lrn || fields.candidate_student?.lrn || d.id;
        if (!candidateStudentSet.has(lrn)) {
          candidateStudentSet.add(lrn);
          const g = normalizeShsGrade(d.grade_level || fields.grade_level || fields.selected_grade_level);
          if (g === "Grade 11") grade11Count++;
          else if (g === "Grade 12") grade12Count++;
        }
      });
    }

    // Document review & validation counts
    const awaitingReviewCount = allDocs.filter(d => 
      ["needs_review", "submitted", "extracted", "corrected"].includes(d.status)
    ).length;
    const approvedDocumentCount = allDocs.filter(d => d.status === "approved").length;
    const rejectedDocumentCount = allDocs.filter(d => d.status === "rejected").length;

    // --- STUDENT DISTRIBUTION ---
    const sectionDistributionMap = new Map<string, number>();
    const schoolYearDistributionMap = new Map<string, number>();
    const gradeLevelDistributionMap = new Map<string, number>([
      ["Grade 11", grade11Count],
      ["Grade 12", grade12Count],
    ]);

    // Inspect sections & school years from documents and students
    allDocs.forEach((d: any) => {
      const fields = (d.extracted_fields as any) || {};
      const section = fields.section || fields.sec || "Unassigned";
      const sy = d.school_year || fields.school_year || "Unknown";

      if (section && section !== "Unassigned") {
        sectionDistributionMap.set(section, (sectionDistributionMap.get(section) || 0) + 1);
      }
      if (sy && sy !== "Unknown") {
        schoolYearDistributionMap.set(sy, (schoolYearDistributionMap.get(sy) || 0) + 1);
      }
    });

    // --- DOCUMENT STATISTICS ---
    let sf9Count = 0;
    let sf10Count = 0;
    let psaCount = 0;
    let pendingDocCount = 0;
    let approvedDocCount = 0;
    let rejectedDocCount = 0;

    const studentDocumentSet = new Set<string>();
    let duplicateScanCount = 0;

    allDocs.forEach((d: any) => {
      const type = String(d.document_type || "").toLowerCase();
      if (type === "sf9") sf9Count++;
      else if (type === "sf10") sf10Count++;
      else if (type === "birth_cert" || type === "psa") psaCount++;

      const status = String(d.status || "").toLowerCase();
      if (["needs_review", "submitted", "extracted", "corrected"].includes(status)) {
        pendingDocCount++;
      } else if (status === "approved") {
        approvedDocCount++;
      } else if (status === "rejected") {
        rejectedDocCount++;
      }

      // Track duplicate documents for the same student
      const fields = (d.extracted_fields as any) || {};
      const studentKey = d.student_id || fields.lrn || fields.candidate_student?.lrn;
      if (studentKey) {
        const uniqueKey = `${studentKey}_${type}`;
        if (studentDocumentSet.has(uniqueKey)) {
          duplicateScanCount++;
        } else {
          studentDocumentSet.add(uniqueKey);
        }
      }
    });

    // --- ADVANCED COMPLETENESS & ELIGIBILITY METRICS ---
    let completeDocumentSetsCount = 0;
    let missingDocumentsCount = 0;
    let eligibleProgressionCount = 0;
    let eligibleGraduationCount = 0;
    let notEligibleCount = 0;
    let awaitingPrincipalActionCount = 0;

    allStudents.forEach((st: any) => {
      const studentDocs = allDocs.filter(d => d.student_id === st.id);
      const hasSf9 = studentDocs.some(d => d.document_type === "sf9" && d.status === "approved");
      const hasSf10 = studentDocs.some(d => d.document_type === "sf10" && d.status === "approved");
      const hasPsa = studentDocs.some(d => ["birth_cert", "psa"].includes(d.document_type) && d.status === "approved");

      if (hasSf9 && hasSf10 && hasPsa) {
        completeDocumentSetsCount++;
      } else {
        missingDocumentsCount++;
      }

      // Evaluate eligibility
      const studentGrades = allGrades.filter(g => g.student_id === st.id);
      const sf9Doc = studentDocs.find((d: any) => d.document_type === "sf9");
      const sf9Fields = (sf9Doc?.extracted_fields as any) || {};
      const attendanceSummary = sf9Fields.attendance_risk_status
        ? {
            riskStatus: sf9Fields.attendance_risk_status,
            absencePercentage: sf9Fields.absence_percentage,
            attendancePercentage: sf9Fields.attendance_percentage,
          }
        : null;

      const evalResult = evaluateShsStudentEligibility({
        gradeLevel: st.grade_level,
        subjects: studentGrades,
        attendanceSummary,
        documentCompleteness: {
          isComplete: hasSf9 && hasSf10 && hasPsa,
          hasSf9,
          hasSf10,
          hasPsa,
        },
        existingApproval: eligibilityMap.get(st.id) || null,
      });

      if (evalResult.status === "Eligible") {
        if (evalResult.gradeLevel === "Grade 11") eligibleProgressionCount++;
        else eligibleGraduationCount++;

        if (evalResult.approvalDecision === "Pending") {
          awaitingPrincipalActionCount++;
        }
      } else if (evalResult.status === "Not Eligible") {
        notEligibleCount++;
      }
    });

    // Recent 10 scanned documents for the feed
    const recentDocuments = allDocs.slice(0, 10).map((d: any) => {
      const fields = (d.extracted_fields as any) || {};
      const candidateName = fields.name || 
        [fields.last_name || fields.candidate_student?.last_name, fields.first_name || fields.candidate_student?.first_name]
          .filter(Boolean)
          .join(", ") || "Unknown Student";

      return {
        id: d.id,
        documentType: d.document_type,
        status: d.status,
        gradeLevel: normalizeShsGrade(d.grade_level || fields.grade_level),
        schoolYear: d.school_year || fields.school_year || "N/A",
        createdAt: d.created_at,
        studentName: candidateName,
        lrn: fields.lrn || fields.candidate_student?.lrn || "N/A",
      };
    });

    return {
      school: {
        id: schoolInfo?.id || TRIS_UUID,
        name: schoolInfo?.name || "Taysan Resettlement Integrated School",
        depedSchoolId: schoolInfo?.school_id || TRIS_SCHOOL_ID,
      },
      summaryCards: {
        totalStudents: totalStudents || (grade11Count + grade12Count),
        totalDocuments,
        grade11Count,
        grade12Count,
        awaitingReviewCount,
        approvedDocumentCount,
        rejectedDocumentCount,
        completeDocumentSetsCount,
        missingDocumentsCount,
        eligibleProgressionCount,
        eligibleGraduationCount,
        notEligibleCount,
        awaitingPrincipalActionCount,
      },
      studentDistribution: {
        gradeLevels: Array.from(gradeLevelDistributionMap.entries()).map(([grade, count]) => ({ grade, count })),
        sections: Array.from(sectionDistributionMap.entries())
          .map(([section, count]) => ({ section, count }))
          .sort((a, b) => b.count - a.count),
        schoolYears: Array.from(schoolYearDistributionMap.entries())
          .map(([schoolYear, count]) => ({ schoolYear, count }))
          .sort((a, b) => b.count - a.count),
      },
      documentStats: {
        sf9Count,
        sf10Count,
        psaCount,
        pendingDocCount,
        approvedDocCount,
        rejectedDocCount,
        duplicateScanCount,
        uniqueDocumentCoverage: studentDocumentSet.size,
      },
      recentDocuments,
    };
  } catch (err: any) {
    console.error("[getPrincipalDashboardData] Unexpected error:", err.message);
    return { error: err.message || "Failed to load principal dashboard data." };
  }
}

/**
 * Phase 3, 4, 5, 6, 7 — Principal Unified Student Records
 */
export async function getPrincipalStudentRecords(filters?: {
  query?: string;
  grade?: string;
  section?: string;
  schoolYear?: string;
  status?: string;
  completeness?: string;
  eligibility?: string;
}) {
  const authContext = await getAuthorizedPrincipalContext();
  if ("error" in authContext) return { error: authContext.error };

  const { supabase, schoolId } = authContext;

  try {
    // 1. Fetch verified students
    const { data: rawStudents, error: studentErr } = await supabase
      .from("students")
      .select(`
        id,
        lrn,
        first_name,
        middle_name,
        last_name,
        suffix,
        birth_date,
        sex,
        grade_level,
        status,
        overall_status,
        created_at
      `)
      .order("last_name", { ascending: true });

    if (studentErr) {
      console.error("[getPrincipalStudentRecords] Student query error:", studentErr.message);
      return { error: studentErr.message };
    }

    // 2. Fetch all documents
    const { data: allDocsRaw } = await supabase
      .from("documents")
      .select(`
        id,
        student_id,
        document_type,
        status,
        grade_level,
        school_year,
        extracted_fields,
        storage_path,
        image_url,
        created_at
      `)
      .order("created_at", { ascending: false });

    // 3. Fetch subject grades
    const { data: allGradesRaw } = await supabase
      .from("subject_grades")
      .select("*")
      .order("subject", { ascending: true });

    // 4. Fetch eligibility approvals
    let eligibilityMap = new Map<string, any>();
    try {
      const { data: approvals } = await supabase
        .from("eligibility_approvals")
        .select("*");
      (approvals || []).forEach(app => {
        eligibilityMap.set(app.student_id, app);
      });
    } catch {
      // Fallback
    }

    const allDocs = (allDocsRaw || []) as any[];
    const rawStudentsList = (rawStudents || []) as any[];
    const allGrades = (allGradesRaw || []) as any[];

    // Transform verified students into Unified Student Records
    const studentRecords: any[] = [];
    const distinctSections = new Set<string>();
    const distinctSchoolYears = new Set<string>();

    rawStudentsList.forEach((st: any) => {
      const docs = allDocs.filter(d => d.student_id === st.id);
      const latestDoc = docs[0];
      const fields = (latestDoc?.extracted_fields as any) || {};

      const grade = normalizeShsGrade(st.grade_level || latestDoc?.grade_level || fields.grade_level);
      const section = fields.section || fields.sec || "-";
      const schoolYear = latestDoc?.school_year || fields.school_year || "-";

      if (section && section !== "-") distinctSections.add(section);
      if (schoolYear && schoolYear !== "-") distinctSchoolYears.add(schoolYear);

      // Document availability check
      const sf9Doc = docs.find((d: any) => String(d.document_type).toLowerCase() === "sf9");
      const sf10Doc = docs.find((d: any) => String(d.document_type).toLowerCase() === "sf10");
      const psaDoc = docs.find((d: any) => {
        const t = String(d.document_type).toLowerCase();
        return t === "birth_cert" || t === "psa";
      });

      const hasSf9 = sf9Doc ? sf9Doc.status === "approved" : false;
      const hasSf10 = sf10Doc ? sf10Doc.status === "approved" : false;
      const hasPsa = psaDoc ? psaDoc.status === "approved" : false;

      // Extract raw names for Cross-Document Comparison
      const sf9Fields = (sf9Doc?.extracted_fields as any) || {};
      const sf10Fields = (sf10Doc?.extracted_fields as any) || {};
      const psaFields = (psaDoc?.extracted_fields as any) || {};

      const identityComparison = compareUnifiedStudentDocuments({
        sf9: sf9Doc ? {
          firstName: sf9Fields.first_name,
          middleName: sf9Fields.middle_name,
          lastName: sf9Fields.last_name,
          suffix: sf9Fields.suffix,
          fullName: sf9Fields.name,
          lrn: sf9Fields.lrn,
        } : null,
        sf10: sf10Doc ? {
          firstName: sf10Fields.first_name,
          middleName: sf10Fields.middle_name,
          lastName: sf10Fields.last_name,
          suffix: sf10Fields.suffix,
          fullName: sf10Fields.name,
          lrn: sf10Fields.lrn,
        } : null,
        psa: psaDoc ? {
          firstName: psaFields.first_name,
          middleName: psaFields.middle_name,
          lastName: psaFields.last_name,
          suffix: psaFields.suffix,
          fullName: psaFields.name,
          birthDate: psaFields.birth_date,
        } : null,
      });

      // Phase 6: Document Completeness Indicators
      let completenessStatus: "COMPLETE" | "INCOMPLETE" | "IDENTITY_REVIEW_REQUIRED" = "INCOMPLETE";
      let completenessLabel = "Incomplete Document Set";

      if (identityComparison.overallStatus === "IDENTITY_REVIEW_REQUIRED") {
        completenessStatus = "IDENTITY_REVIEW_REQUIRED";
        completenessLabel = "Identity Review Required";
      } else if (hasSf9 && hasSf10 && hasPsa) {
        completenessStatus = "COMPLETE";
        completenessLabel = "Complete (SF9, SF10, PSA)";
      } else {
        completenessStatus = "INCOMPLETE";
        if (!hasPsa && hasSf9 && hasSf10) {
          completenessLabel = "Missing PSA Birth Certificate";
        } else if (!hasSf9 && !hasSf10 && !hasPsa) {
          completenessLabel = "Missing All Official Documents";
        } else {
          completenessLabel = "Incomplete Document Set";
        }
      }

      // Phase 7: Academic Eligibility Evaluation
      const studentGrades = allGrades.filter(g => g.student_id === st.id);
      const existingApproval = eligibilityMap.get(st.id) || null;
      const sf9DocItem = docs.find((d: any) => d.document_type === "sf9");
      const sf9FieldsItem = (sf9DocItem?.extracted_fields as any) || {};
      const attendanceSummary = sf9FieldsItem.attendance_risk_status
        ? {
            riskStatus: sf9FieldsItem.attendance_risk_status,
            absencePercentage: sf9FieldsItem.absence_percentage,
            attendancePercentage: sf9FieldsItem.attendance_percentage,
          }
        : null;

      const eligibility = evaluateShsStudentEligibility({
        gradeLevel: grade,
        schoolYear,
        subjects: studentGrades,
        attendanceSummary,
        documentCompleteness: {
          isComplete: completenessStatus === "COMPLETE",
          hasSf9,
          hasSf10,
          hasPsa,
          identityStatus: identityComparison.overallStatus,
        },
        existingApproval,
      });

      // Overall document verification status
      let reviewStatus = "No Document";
      if (docs.length > 0) {
        if (docs.some((d: any) => String(d.status).toLowerCase() === "approved")) {
          reviewStatus = "Approved";
        } else if (docs.every((d: any) => String(d.status).toLowerCase() === "rejected")) {
          reviewStatus = "Rejected";
        } else {
          reviewStatus = "Pending Review";
        }
      }

      studentRecords.push({
        id: st.id,
        lrn: st.lrn,
        firstName: st.first_name,
        middleName: st.middle_name,
        lastName: st.last_name,
        suffix: st.suffix,
        fullName: [st.last_name, [st.first_name, st.middle_name, st.suffix].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        birthDate: st.birth_date,
        sex: st.sex,
        gradeLevel: grade,
        section,
        schoolYear,
        reviewStatus,
        academicStanding: st.overall_status || "Needs Verification",
        generalAverage: fields.general_average || fields.shs_general_average_printed || null,
        availableDocuments: {
          sf9: sf9Doc ? { id: sf9Doc.id, status: sf9Doc.status, storagePath: sf9Doc.storage_path || sf9Doc.image_url } : null,
          sf10: sf10Doc ? { id: sf10Doc.id, status: sf10Doc.status, storagePath: sf10Doc.storage_path || sf10Doc.image_url } : null,
          psa: psaDoc ? { id: psaDoc.id, status: psaDoc.status, storagePath: psaDoc.storage_path || psaDoc.image_url } : null,
        },
        completeness: {
          status: completenessStatus,
          label: completenessLabel,
          hasSf9,
          hasSf10,
          hasPsa,
        },
        eligibility,
        academicStatus: eligibility.academicCategory,
        attendanceStatus: eligibility.attendanceCategory,
        documentStatus: eligibility.documentCategory,
        attendanceSummary,
        taglishAdvisory: eligibility.taglishAdvisory,
        identityComparison,
        documentsCount: docs.length,
        latestDocumentId: latestDoc?.id || null,
        isVerifiedStudent: true,
      });
    });

    // If verified students list has zero records, display candidate learners from scanned documents
    if (studentRecords.length === 0 && allDocs.length > 0) {
      const candidateMap = new Map<string, any>();
      allDocs.forEach((d: any) => {
        const fields = (d.extracted_fields as any) || {};
        const lrn = fields.lrn || fields.candidate_student?.lrn || d.id;
        const firstName = fields.first_name || fields.candidate_student?.first_name || "";
        const lastName = fields.last_name || fields.candidate_student?.last_name || "";
        const middleName = fields.middle_name || fields.candidate_student?.middle_name || null;
        const fullName = fields.name || [lastName, firstName].filter(Boolean).join(", ") || "Candidate Learner";
        const grade = normalizeShsGrade(d.grade_level || fields.grade_level || fields.selected_grade_level);
        const section = fields.section || fields.sec || "-";
        const schoolYear = d.school_year || fields.school_year || "-";

        if (section && section !== "-") distinctSections.add(section);
        if (schoolYear && schoolYear !== "-") distinctSchoolYears.add(schoolYear);

        if (!candidateMap.has(lrn)) {
          const docTypeLower = String(d.document_type).toLowerCase();
          const hasSf9 = docTypeLower === "sf9";
          const hasSf10 = docTypeLower === "sf10";
          const hasPsa = ["birth_cert", "psa"].includes(docTypeLower);

          candidateMap.set(lrn, {
            id: d.id,
            lrn: lrn.startsWith("********") ? lrn : (fields.lrn || "Pending LRN"),
            firstName,
            middleName,
            lastName,
            suffix: null,
            fullName,
            birthDate: fields.birth_date || null,
            sex: fields.sex || null,
            gradeLevel: grade,
            section,
            schoolYear,
            reviewStatus: d.status === "approved" ? "Approved" : d.status === "rejected" ? "Rejected" : "Pending Review",
            academicStanding: "Needs Verification",
            generalAverage: fields.general_average || fields.shs_general_average_printed || null,
            availableDocuments: {
              sf9: hasSf9 ? { id: d.id, status: d.status, storagePath: d.storage_path || d.image_url } : null,
              sf10: hasSf10 ? { id: d.id, status: d.status, storagePath: d.storage_path || d.image_url } : null,
              psa: hasPsa ? { id: d.id, status: d.status, storagePath: d.storage_path || d.image_url } : null,
            },
            completeness: {
              status: "INCOMPLETE",
              label: hasPsa ? "Missing SF9/SF10" : "Missing PSA Birth Certificate",
              hasSf9,
              hasSf10,
              hasPsa,
            },
            eligibility: {
              gradeLevel: grade,
              eligibilityType: grade === "Grade 12" ? "Grade 12 Graduation" : "Grade 11 Progression",
              status: "Needs Review",
              approvalDecision: "Pending",
              reasons: ["Candidate learner awaiting verification"],
              blockingFactors: ["Documents awaiting official review"],
              canPrincipalApprove: false,
            },
            identityComparison: {
              overallStatus: "MATCH",
              isSameLearner: true,
              canLink: true,
              discrepancies: [],
              summaryMessage: "Candidate document awaiting verification.",
            },
            documentsCount: 1,
            latestDocumentId: d.id,
            isVerifiedStudent: false,
          });
        }
      });
      studentRecords.push(...Array.from(candidateMap.values()));
    }

    // Apply filters
    let filtered = studentRecords;
    if (filters?.query) {
      const q = filters.query.trim().toLowerCase();
      filtered = filtered.filter(st => 
        st.fullName.toLowerCase().includes(q) ||
        st.lrn.includes(q) ||
        st.firstName.toLowerCase().includes(q) ||
        st.lastName.toLowerCase().includes(q)
      );
    }

    if (filters?.grade && filters.grade !== "All") {
      filtered = filtered.filter(st => st.gradeLevel === filters.grade);
    }

    if (filters?.section && filters.section !== "All") {
      filtered = filtered.filter(st => st.section === filters.section);
    }

    if (filters?.schoolYear && filters.schoolYear !== "All") {
      filtered = filtered.filter(st => st.schoolYear === filters.schoolYear);
    }

    if (filters?.status && filters.status !== "All") {
      filtered = filtered.filter(st => st.reviewStatus === filters.status);
    }

    if (filters?.completeness && filters.completeness !== "All") {
      if (filters.completeness === "Complete") {
        filtered = filtered.filter(st => st.completeness.status === "COMPLETE");
      } else if (filters.completeness === "Incomplete") {
        filtered = filtered.filter(st => st.completeness.status === "INCOMPLETE");
      } else if (filters.completeness === "Missing PSA") {
        filtered = filtered.filter(st => !st.completeness.hasPsa);
      } else if (filters.completeness === "Missing SF9") {
        filtered = filtered.filter(st => !st.completeness.hasSf9);
      } else if (filters.completeness === "Missing SF10") {
        filtered = filtered.filter(st => !st.completeness.hasSf10);
      } else if (filters.completeness === "Identity Review Required") {
        filtered = filtered.filter(st => st.completeness.status === "IDENTITY_REVIEW_REQUIRED");
      }
    }

    if (filters?.eligibility && filters.eligibility !== "All") {
      if (filters.eligibility === "Approved") {
        filtered = filtered.filter(st => st.eligibility.approvalDecision === "Approved");
      } else {
        filtered = filtered.filter(st => st.eligibility.status === filters.eligibility);
      }
    }

    return {
      students: filtered,
      totalCount: studentRecords.length,
      filteredCount: filtered.length,
      availableSections: Array.from(distinctSections).sort(),
      availableSchoolYears: Array.from(distinctSchoolYears).sort(),
    };
  } catch (err: any) {
    console.error("[getPrincipalStudentRecords] Error:", err.message);
    return { error: err.message || "Failed to load student records." };
  }
}

/**
 * Detailed Unified Student Record for Principal Details Modal & Digital Academic Record
 */
export async function getPrincipalStudentDetails(identifier: string) {
  const authContext = await getAuthorizedPrincipalContext();
  if ("error" in authContext) return { error: authContext.error };

  const { supabase } = authContext;

  try {
    // 1. Try to fetch from students table
    const { data: student } = await supabase
      .from("students")
      .select("*")
      .or(`id.eq.${identifier},lrn.eq.${identifier}`)
      .maybeSingle();

    if (student) {
      // Fetch associated documents
      const { data: docs } = await supabase
        .from("documents")
        .select("id, document_type, status, grade_level, school_year, created_at, extracted_fields, storage_path, image_url")
        .eq("student_id", student.id)
        .order("created_at", { ascending: false });

      // Fetch subject grades
      const { data: subjectGrades } = await supabase
        .from("subject_grades")
        .select("*")
        .eq("student_id", student.id)
        .order("subject", { ascending: true });

      // Fetch existing eligibility approval
      let existingApproval = null;
      try {
        const { data: approvalRow } = await supabase
          .from("eligibility_approvals")
          .select("*")
          .eq("student_id", student.id)
          .maybeSingle();
        existingApproval = approvalRow;
      } catch {
        // Fallback
      }

      // Generate signed URLs for complete original images
      const docList = (docs || []) as any[];
      const documentsWithSignedUrls = await Promise.all(
        docList.map(async (d) => {
          const rawPath = d.storage_path || d.image_url;
          const signedUrl = await getSignedDocumentImageUrl(supabase, rawPath);
          return {
            id: d.id,
            documentType: String(d.document_type || "").toUpperCase(),
            rawType: String(d.document_type || "").toLowerCase(),
            status: d.status,
            gradeLevel: normalizeShsGrade(d.grade_level),
            schoolYear: d.school_year || (d.extracted_fields as any)?.school_year || "-",
            createdAt: d.created_at,
            originalImageUrl: signedUrl,
            storagePath: rawPath,
            extractedFields: d.extracted_fields,
          };
        })
      );

      // Identity documents for cross-comparison
      const sf9Doc = documentsWithSignedUrls.find(d => d.rawType === "sf9");
      const sf10Doc = documentsWithSignedUrls.find(d => d.rawType === "sf10");
      const psaDoc = documentsWithSignedUrls.find(d => ["birth_cert", "psa"].includes(d.rawType));

      const hasSf9 = sf9Doc ? sf9Doc.status === "approved" : false;
      const hasSf10 = sf10Doc ? sf10Doc.status === "approved" : false;
      const hasPsa = psaDoc ? psaDoc.status === "approved" : false;

      const identityComparison = compareUnifiedStudentDocuments({
        sf9: sf9Doc ? {
          firstName: sf9Doc.extractedFields?.first_name,
          middleName: sf9Doc.extractedFields?.middle_name,
          lastName: sf9Doc.extractedFields?.last_name,
          suffix: sf9Doc.extractedFields?.suffix,
          fullName: sf9Doc.extractedFields?.name,
          lrn: sf9Doc.extractedFields?.lrn,
        } : null,
        sf10: sf10Doc ? {
          firstName: sf10Doc.extractedFields?.first_name,
          middleName: sf10Doc.extractedFields?.middle_name,
          lastName: sf10Doc.extractedFields?.last_name,
          suffix: sf10Doc.extractedFields?.suffix,
          fullName: sf10Doc.extractedFields?.name,
          lrn: sf10Doc.extractedFields?.lrn,
        } : null,
        psa: psaDoc ? {
          firstName: psaDoc.extractedFields?.first_name,
          middleName: psaDoc.extractedFields?.middle_name,
          lastName: psaDoc.extractedFields?.last_name,
          suffix: psaDoc.extractedFields?.suffix,
          fullName: psaDoc.extractedFields?.name,
          birthDate: psaDoc.extractedFields?.birth_date,
        } : null,
      });

      // Completeness status
      let completenessStatus: "COMPLETE" | "INCOMPLETE" | "IDENTITY_REVIEW_REQUIRED" = "INCOMPLETE";
      let completenessLabel = "Incomplete Document Set";
      if (identityComparison.overallStatus === "IDENTITY_REVIEW_REQUIRED") {
        completenessStatus = "IDENTITY_REVIEW_REQUIRED";
        completenessLabel = "Identity Review Required";
      } else if (hasSf9 && hasSf10 && hasPsa) {
        completenessStatus = "COMPLETE";
        completenessLabel = "Complete (SF9, SF10, PSA)";
      } else if (!hasPsa && hasSf9 && hasSf10) {
        completenessLabel = "Missing PSA Birth Certificate";
      }

      // Grade formatting
      const rawGradesList = ((subjectGrades || []) as any[]).map(g => ({
        id: g.id,
        subject: g.subject,
        semester: g.semester,
        schoolYear: g.school_year,
        q1: g.q1,
        q2: g.q2,
        q3: g.q3,
        q4: g.q4,
        final_grade: g.final_grade,
        finalGrade: g.final_grade,
        status: g.status || (g.final_grade >= 75 ? "Passed" : g.final_grade ? "Failed" : "Missing"),
        needsVerification: g.needs_verification,
        remedialClassMark: g.remedial_class_mark,
        recomputedFinalGrade: g.recomputed_final_grade,
        remedialStatus: (g.recomputed_final_grade >= 75 ? "REMEDIAL_PASSED" : g.failed_final_grade ? "REMEDIAL_REQUIRED" : null) as RemedialStatus | null,
        isRemedialVerified: Boolean(g.recomputed_final_grade && !g.needs_verification),
      }));

      // Attendance summary from SF9
      const sf9Fields = (sf9Doc?.extractedFields as any) || {};
      const attendanceSummary = sf9Fields.attendance_risk_status
        ? {
            riskStatus: sf9Fields.attendance_risk_status,
            absencePercentage: sf9Fields.absence_percentage,
            attendancePercentage: sf9Fields.attendance_percentage,
          }
        : null;

      // Evaluate eligibility
      const gradeLevel = normalizeShsGrade(student.grade_level);
      const schoolYear = sf9Doc?.schoolYear || sf10Doc?.schoolYear || "-";
      const eligibility = evaluateShsStudentEligibility({
        gradeLevel,
        schoolYear,
        subjects: rawGradesList,
        attendanceSummary,
        documentCompleteness: {
          isComplete: completenessStatus === "COMPLETE",
          hasSf9,
          hasSf10,
          hasPsa,
          identityStatus: identityComparison.overallStatus,
        },
        existingApproval,
      });

      return {
        student: {
          id: student.id,
          lrn: student.lrn,
          fullName: [student.last_name, [student.first_name, student.middle_name, student.suffix].filter(Boolean).join(" ")].filter(Boolean).join(", "),
          firstName: student.first_name,
          lastName: student.last_name,
          middleName: student.middle_name,
          suffix: student.suffix,
          gradeLevel,
          section: sf9Doc?.extractedFields?.section || sf10Doc?.extractedFields?.section || "Unassigned",
          schoolYear,
          birthDate: student.birth_date,
          sex: student.sex,
          overallStatus: student.overall_status,
          generalAverage: sf9Doc?.extractedFields?.general_average || sf9Doc?.extractedFields?.shs_general_average_printed || null,
          status: student.status,
          isVerifiedStudent: true,
        },
        documents: documentsWithSignedUrls,
        grades: rawGradesList,
        completeness: {
          status: completenessStatus,
          label: completenessLabel,
          hasSf9,
          hasSf10,
          hasPsa,
        },
        identityComparison,
        eligibility,
        academicStatus: eligibility.academicCategory,
        attendanceStatus: eligibility.attendanceCategory,
        documentStatus: eligibility.documentCategory,
        attendanceSummary,
        taglishAdvisory: eligibility.taglishAdvisory,
        approvalRecord: existingApproval,
      };
    }

    // 2. If identifier is a document ID (for staged/candidate learner)
    const { data: doc } = await supabase
      .from("documents")
      .select("id, document_type, status, grade_level, school_year, created_at, extracted_fields, storage_path, image_url")
      .eq("id", identifier)
      .maybeSingle();

    if (doc) {
      const fields = (doc.extracted_fields as any) || {};
      const signedUrl = await getSignedDocumentImageUrl(supabase, doc.storage_path || doc.image_url);

      const rawGrades = Array.isArray(fields.grades) ? fields.grades : [];
      const grades = rawGrades.map((g: any, index: number) => ({
        id: `grade-${index}`,
        subject: g.subject || g.category || "Subject",
        semester: g.semester || null,
        schoolYear: doc.school_year || fields.school_year || "-",
        q1: g.q1,
        q2: g.q2,
        q3: g.q3,
        q4: g.q4,
        final_grade: g.final || g.semesterFinal || g.final_grade,
        finalGrade: g.final || g.semesterFinal || g.final_grade,
        status: g.status || (g.final >= 75 ? "Passed" : g.final ? "Failed" : "Missing"),
      }));

      const lrn = fields.lrn || fields.candidate_student?.lrn || "Pending LRN";
      const firstName = fields.first_name || fields.candidate_student?.first_name || "";
      const lastName = fields.last_name || fields.candidate_student?.last_name || "";
      const fullName = fields.name || [lastName, firstName].filter(Boolean).join(", ") || "Candidate Learner";
      const gradeLevel = normalizeShsGrade(doc.grade_level || fields.grade_level);
      const isPsa = ["birth_cert", "psa"].includes(String(doc.document_type).toLowerCase());

      return {
        student: {
          id: doc.id,
          lrn,
          fullName,
          firstName,
          lastName,
          middleName: fields.middle_name || null,
          suffix: null,
          gradeLevel,
          section: fields.section || fields.sec || "-",
          schoolYear: doc.school_year || fields.school_year || "-",
          birthDate: fields.birth_date || null,
          sex: fields.sex || null,
          overallStatus: doc.status === "approved" ? "Passed" : "Needs Verification",
          generalAverage: fields.general_average || fields.shs_general_average_printed || null,
          status: doc.status,
          isVerifiedStudent: false,
        },
        documents: [{
          id: doc.id,
          documentType: String(doc.document_type || "").toUpperCase(),
          rawType: String(doc.document_type || "").toLowerCase(),
          status: doc.status,
          gradeLevel,
          schoolYear: doc.school_year || fields.school_year || "-",
          createdAt: doc.created_at,
          originalImageUrl: signedUrl,
          storagePath: doc.storage_path || doc.image_url,
          extractedFields: fields,
        }],
        grades,
        completeness: {
          status: "INCOMPLETE",
          label: isPsa ? "Missing SF9/SF10 Records" : "Missing PSA Birth Certificate",
          hasSf9: String(doc.document_type).toLowerCase() === "sf9",
          hasSf10: String(doc.document_type).toLowerCase() === "sf10",
          hasPsa: isPsa,
        },
        identityComparison: {
          overallStatus: "MATCH",
          isSameLearner: true,
          canLink: false,
          discrepancies: [],
          summaryMessage: "Candidate document awaiting verification before formal linking.",
        },
        eligibility: {
          gradeLevel,
          eligibilityType: gradeLevel === "Grade 12" ? "Grade 12 Graduation" : "Grade 11 Progression",
          status: "Needs Review",
          approvalDecision: "Pending",
          reasons: ["Candidate record pending teacher approval"],
          blockingFactors: ["Documents awaiting verification"],
          canPrincipalApprove: false,
        },
        approvalRecord: null,
      };
    }

    return { error: "Student record not found." };
  } catch (err: any) {
    console.error("[getPrincipalStudentDetails] Error:", err.message);
    return { error: err.message || "Failed to load student details." };
  }
}

/**
 * PRINCIPAL ELIGIBILITY APPROVAL SERVER ACTION
 *
 * Bakit ito kailangan sa Capstone Defense:
 * Dito isinasagawa ang opisyal na pag-apruba ng School Head para sa:
 * 1. Grade 11 Progression (pag-akyat sa Grade 12)
 * 2. Grade 12 Graduation (pagtatapos sa Senior High School)
 *
 * Mga Mahahalagang Patakaran:
 * - Mahigpit na Server-Side Gate:
 *   Hindi pinapayagan ang Principal na mag-apruba kapag kulang ang dokumento (hal. walang PSA)
 *   o kapag may bagsak na grado. Ang `canPrincipalApprove` ay dapat `true`.
 * - Immutable Audit Trail:
 *   Bawat desisyon (Approved o Not Approved) kasama ang timestamp, remarks, at user ID ng Principal
 *   ay isinusulat sa `eligibility_approvals` at `eligibility_audit_logs` para sa transparency.
 */
export async function approveStudentEligibility(input: {
  studentId: string;
  gradeLevel: string;
  schoolYear: string;
  eligibilityType: "Grade 11 Progression" | "Grade 12 Graduation";
  decision: "Approved" | "Not Approved";
  remarks?: string;
}) {
  const authContext = await getAuthorizedPrincipalContext();
  if ("error" in authContext) return { error: authContext.error };

  const { supabase, user, schoolId } = authContext;

  try {
    const { studentId, gradeLevel, schoolYear, eligibilityType, decision, remarks } = input;
    if (!studentId || !gradeLevel || !schoolYear || !eligibilityType || !decision) {
      return { error: "Missing required eligibility approval parameters." };
    }

    // Verify student exists and check eligibility criteria
    // Principal CANNOT approve unverified or incomplete records
    const studentDetails = await getPrincipalStudentDetails(studentId);
    if ("error" in studentDetails || !studentDetails.student) {
      return { error: "Student record not found." };
    }

    const evaluation = studentDetails.eligibility;
    if (decision === "Approved" && !evaluation.canPrincipalApprove) {
      return {
        error: `Cannot approve eligibility: ${evaluation.blockingFactors.join(" ") || "Student has unverified or incomplete requirements."}`,
      };
    }

    // Upsert into eligibility_approvals
    let approvalId: string | null = null;
    const operationId = crypto.randomUUID();
    const normalizedGrade: "Grade 11" | "Grade 12" = /12/i.test(gradeLevel) ? "Grade 12" : "Grade 11";
    const approvalPayload = {
      student_id: studentId,
      school_id: schoolId,
      grade_level: normalizedGrade,
      school_year: schoolYear,
      eligibility_type: eligibilityType,
      status: evaluation.status as "Eligible" | "Not Eligible" | "Needs Review",
      decision,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      remarks: remarks?.trim() || null,
      updated_at: new Date().toISOString(),
      last_operation_id: operationId,
    };

    const { data: upsertData, error: upsertError } = await supabase
      .from("eligibility_approvals")
      .upsert(approvalPayload, { onConflict: "student_id,grade_level,school_year,eligibility_type" })
      .select("id")
      .maybeSingle();

    if (upsertError) {
      // Defensive fallback if eligibility_approvals table has not been created in live Supabase yet
      console.warn("[approveStudentEligibility] eligibility_approvals table notice:", upsertError.message);
      
      // Fallback: Record in academic_standing_history
      const newStatus = decision === "Approved" ? "Passed" : "Needs Verification";
      await supabase.from("academic_standing_history").insert({
        student_id: studentId,
        school_year: schoolYear,
        grade_level: gradeLevel,
        previous_status: studentDetails.student.overallStatus || "Needs Verification",
        new_status: newStatus,
        decision_source: `Principal Eligibility Approval: ${eligibilityType} (${decision})`,
        confirmed_by: user.id,
        confirmation_notes: remarks ? `Decision: ${decision}. ${remarks}` : `Decision: ${decision}`,
      });

      // Update student overall_status if approved
      if (decision === "Approved") {
        await supabase
          .from("students")
          .update({ overall_status: "Passed", updated_at: new Date().toISOString() })
          .eq("id", studentId);
      }
    } else {
      approvalId = upsertData?.id || null;

      // Log in eligibility_audit_logs
      await supabase.from("eligibility_audit_logs").insert({
        approval_id: approvalId,
        student_id: studentId,
        action: `PRINCIPAL_${decision.toUpperCase()}`,
        previous_decision: evaluation.approvalDecision,
        new_decision: decision,
        performed_by: user.id,
        remarks: remarks?.trim() || null,
      });

      // Also sync student overall_status if approved
      if (decision === "Approved") {
        await supabase
          .from("students")
          .update({ overall_status: "Passed", updated_at: new Date().toISOString() })
          .eq("id", studentId);
      }
    }

    // Centralized administrative audit logging for graduation/progression eligibility decision
    await logAuditEvent({
      requestId: operationId,
      category: "ELIGIBILITY",
      action: "ELIGIBILITY_DECISION",
      outcome: decision === "Approved" ? "SUCCESS" : "WARNING",
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: "principal",
      actorSchoolId: schoolId,
      targetType: "student",
      targetId: studentId,
      targetLabel: `${studentDetails.student.firstName || ""} ${studentDetails.student.lastName || ""}`.trim() || studentId,
      reason: remarks || `Principal ${decision} eligibility for ${eligibilityType}`,
      details: {
        eligibility_type: eligibilityType,
        decision,
        grade_level: gradeLevel,
        school_year: schoolYear,
        approval_id: approvalId,
      },
    });

    revalidatePath("/principal/students");
    revalidatePath("/principal/academic");
    revalidatePath("/");
    revalidatePath("/reports");

    return {
      success: true,
      decision,
      eligibilityType,
      studentId,
      approvedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.error("[approveStudentEligibility] Error:", err.message);
    return { error: err.message || "Failed to process principal eligibility approval." };
  }
}

/**
 * Phase 4 — Principal Document Monitoring
 */
export async function getPrincipalDocumentSummary(filters?: {
  query?: string;
  docType?: string;
  grade?: string;
  section?: string;
  status?: string;
}) {
  const authContext = await getAuthorizedPrincipalContext();
  if ("error" in authContext) return { error: authContext.error };

  const { supabase } = authContext;

  try {
    const { data: docs, error: docErr } = await supabase
      .from("documents")
      .select(`
        id,
        student_id,
        document_type,
        status,
        grade_level,
        school_year,
        created_at,
        ocr_confidence,
        extracted_fields,
        storage_path,
        image_url
      `)
      .order("created_at", { ascending: false });

    if (docErr) {
      console.error("[getPrincipalDocumentSummary] Document query error:", docErr.message);
      return { error: docErr.message };
    }

    const { data: validationResults } = await supabase
      .from("validation_results")
      .select("document_id, rule_name, passed, message");

    const vResultsMap = new Map<string, any[]>();
    (validationResults || []).forEach(vr => {
      const list = vResultsMap.get(vr.document_id) || [];
      list.push(vr);
      vResultsMap.set(vr.document_id, list);
    });

    const distinctSections = new Set<string>();
    const distinctSchoolYears = new Set<string>();

    const transformedDocs = ((docs || []) as any[]).map((d: any) => {
      const fields = (d.extracted_fields as any) || {};
      const studentName = fields.name || 
        [fields.last_name || fields.candidate_student?.last_name, fields.first_name || fields.candidate_student?.first_name]
          .filter(Boolean)
          .join(", ") || "Unassigned Learner";

      const lrn = fields.lrn || fields.candidate_student?.lrn || "N/A";
      const grade = normalizeShsGrade(d.grade_level || fields.grade_level || fields.selected_grade_level);
      const section = fields.section || fields.sec || "-";
      const schoolYear = d.school_year || fields.school_year || "-";

      if (section && section !== "-") distinctSections.add(section);
      if (schoolYear && schoolYear !== "-") distinctSchoolYears.add(schoolYear);

      const docValidation = vResultsMap.get(d.id) || [];
      const failedRules = docValidation.filter(v => v.passed === false);

      // Identify missing or incomplete records
      const missingFlags: string[] = [];
      if (!d.school_year && !fields.school_year) {
        missingFlags.push("Missing School Year");
      }
      if (!d.student_id && !fields.candidate_student?.lrn && !fields.lrn) {
        missingFlags.push("Unlinked Learner");
      }
      if (d.status === "needs_review") {
        missingFlags.push("Pending Human Review");
      }
      if (failedRules.length > 0) {
        missingFlags.push(`${failedRules.length} Validation Discrepanc${failedRules.length > 1 ? "ies" : "y"}`);
      }

      return {
        id: d.id,
        rawType: String(d.document_type || "").toLowerCase(),
        documentType: String(d.document_type || "").toUpperCase(),
        status: d.status,
        studentName,
        lrn,
        gradeLevel: grade,
        section,
        schoolYear,
        ocrConfidence: d.ocr_confidence || fields.ocr_confidence || null,
        missingFlags,
        validationRuleCount: docValidation.length,
        failedRuleCount: failedRules.length,
        createdAt: d.created_at,
        originalFilename: fields.original_filename || (d.storage_path ? d.storage_path.split("/").pop() : "document"),
      };
    });

    // Counts for filters
    const totalCount = transformedDocs.length;
    const sf9Count = transformedDocs.filter(d => d.rawType === "sf9").length;
    const sf10Count = transformedDocs.filter(d => d.rawType === "sf10").length;
    const psaCount = transformedDocs.filter(d => ["birth_cert", "psa"].includes(d.rawType)).length;
    const flaggedCount = transformedDocs.filter(d => d.missingFlags.length > 0).length;

    // Apply filters
    let filtered = transformedDocs;
    if (filters?.query) {
      const q = filters.query.trim().toLowerCase();
      filtered = filtered.filter(d => 
        d.studentName.toLowerCase().includes(q) ||
        d.lrn.includes(q) ||
        d.originalFilename.toLowerCase().includes(q)
      );
    }

    const docTypeFilter = filters?.docType;
    if (docTypeFilter && docTypeFilter !== "All") {
      filtered = filtered.filter(d => d.rawType === docTypeFilter.toLowerCase());
    }

    if (filters?.grade && filters.grade !== "All") {
      filtered = filtered.filter(d => d.gradeLevel === filters.grade);
    }

    if (filters?.section && filters.section !== "All") {
      filtered = filtered.filter(d => d.section === filters.section);
    }

    if (filters?.status && filters.status !== "All") {
      filtered = filtered.filter(d => d.status === filters.status);
    }

    return {
      documents: filtered,
      totalCount,
      filteredCount: filtered.length,
      sf9Count,
      sf10Count,
      psaCount,
      flaggedCount,
      availableSections: Array.from(distinctSections).sort(),
      availableSchoolYears: Array.from(distinctSchoolYears).sort(),
    };
  } catch (err: any) {
    console.error("[getPrincipalDocumentSummary] Error:", err.message);
    return { error: err.message || "Failed to load document summary." };
  }
}

/**
 * Phase 5 — Principal Academic Overview
 */
export async function getPrincipalAcademicOverview(filters?: {
  grade?: string;
  section?: string;
  schoolYear?: string;
}) {
  const authContext = await getAuthorizedPrincipalContext();
  if ("error" in authContext) return { error: authContext.error };

  const { supabase } = authContext;

  try {
    // 1. Fetch students
    const { data: students, error: stErr } = await supabase
      .from("students")
      .select(`
        id,
        lrn,
        first_name,
        last_name,
        middle_name,
        grade_level,
        overall_status
      `)
      .order("last_name", { ascending: true });

    if (stErr) {
      console.error("[getPrincipalAcademicOverview] Student query error:", stErr.message);
      return { error: stErr.message };
    }

    // 2. Fetch subject_grades
    const { data: allSubjectGrades } = await supabase
      .from("subject_grades")
      .select("*")
      .order("subject", { ascending: true });

    // 3. Fetch approved/validated documents with extracted grades
    const { data: docs } = await supabase
      .from("documents")
      .select(`
        id,
        student_id,
        grade_level,
        school_year,
        status,
        extracted_fields
      `)
      .in("status", ["approved", "needs_review", "validated"]);

    const studentAcademicList: any[] = [];
    const sectionSummaryMap = new Map<string, {
      grade: string;
      section: string;
      total: number;
      passed: number;
      failed: number;
      needsVerification: number;
    }>();

    const allStudents = (students || []) as any[];
    const allDocs = (docs || []) as any[];
    const allGrades = (allSubjectGrades || []) as any[];

    allStudents.forEach((st: any) => {
      const studentDocs = allDocs.filter(d => d.student_id === st.id);
      const latestDoc = studentDocs[0];
      const fields = (latestDoc?.extracted_fields as any) || {};

      const grade = normalizeShsGrade(st.grade_level || latestDoc?.grade_level || fields.grade_level);
      const section = fields.section || fields.sec || "Unassigned";
      const schoolYear = latestDoc?.school_year || fields.school_year || "-";
      const overallStatus = st.overall_status || "Needs Verification";

      // Verified grades from subject_grades table OR approved document extracted_fields
      let grades: any[] = allGrades.filter(g => g.student_id === st.id);
      let generalAverage = fields.general_average || fields.shs_general_average_printed || null;

      if (grades.length === 0 && Array.isArray(fields.grades) && fields.grades.length > 0) {
        grades = fields.grades.map((g: any) => ({
          subject: g.subject || g.category || "Subject",
          q1: g.q1,
          q2: g.q2,
          q3: g.q3,
          q4: g.q4,
          final_grade: g.final || g.semesterFinal || g.final_grade,
          status: g.status || (g.final >= 75 ? "Passed" : g.final ? "Failed" : "Missing"),
        }));
      }

      // Check for incomplete academic records
      const hasMissingGrades = grades.some((g: any) => g.status === "Missing" || g.final_grade === undefined || g.final_grade === null);
      const isIncomplete = overallStatus === "Needs Verification" || grades.length === 0 || hasMissingGrades;

      // Update Section Aggregate
      const sectionKey = `${grade} - ${section}`;
      const secSummary = sectionSummaryMap.get(sectionKey) || {
        grade,
        section,
        total: 0,
        passed: 0,
        failed: 0,
        needsVerification: 0,
      };

      secSummary.total++;
      if (overallStatus === "Passed") {
        secSummary.passed++;
      } else if (overallStatus === "Failed") {
        secSummary.failed++;
      } else {
        secSummary.needsVerification++;
      }
      sectionSummaryMap.set(sectionKey, secSummary);

      studentAcademicList.push({
        id: st.id,
        lrn: st.lrn,
        fullName: [st.last_name, [st.first_name, st.middle_name].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        gradeLevel: grade,
        section,
        schoolYear,
        academicStanding: overallStatus,
        generalAverage,
        gradesCount: grades.length,
        grades,
        isIncomplete,
      });
    });

    // If no verified students, inspect approved/staged documents
    if (studentAcademicList.length === 0 && allDocs.length > 0) {
      allDocs.forEach((doc: any) => {
        const fields = (doc.extracted_fields as any) || {};
        const lrn = fields.lrn || fields.candidate_student?.lrn || "Pending LRN";
        const studentName = fields.name || 
          [fields.last_name || fields.candidate_student?.last_name, fields.first_name || fields.candidate_student?.first_name]
            .filter(Boolean)
            .join(", ") || "Candidate Learner";

        const grade = normalizeShsGrade(doc.grade_level || fields.grade_level || fields.selected_grade_level);
        const section = fields.section || fields.sec || "Unassigned";
        const schoolYear = doc.school_year || fields.school_year || "-";
        const overallStatus = doc.status === "approved" ? "Passed" : "Needs Verification";

        const rawGrades = Array.isArray(fields.grades) ? fields.grades : [];
        const grades = rawGrades.map((g: any) => ({
          subject: g.subject || g.category || "Subject",
          q1: g.q1,
          q2: g.q2,
          q3: g.q3,
          q4: g.q4,
          final_grade: g.final || g.semesterFinal || g.final_grade,
          status: g.status || (g.final >= 75 ? "Passed" : g.final ? "Failed" : "Missing"),
        }));

        const sectionKey = `${grade} - ${section}`;
        const secSummary = sectionSummaryMap.get(sectionKey) || {
          grade,
          section,
          total: 0,
          passed: 0,
          failed: 0,
          needsVerification: 0,
        };

        secSummary.total++;
        if (overallStatus === "Passed") secSummary.passed++;
        else secSummary.needsVerification++;
        sectionSummaryMap.set(sectionKey, secSummary);

        studentAcademicList.push({
          id: doc.id,
          lrn,
          fullName: studentName,
          gradeLevel: grade,
          section,
          schoolYear,
          academicStanding: overallStatus,
          generalAverage: fields.general_average || fields.shs_general_average_printed || null,
          gradesCount: grades.length,
          grades,
          isIncomplete: overallStatus === "Needs Verification" || grades.length === 0,
        });
      });
    }

    // Calculate totals
    const totalEvaluated = studentAcademicList.length;
    const totalPassed = studentAcademicList.filter(s => s.academicStanding === "Passed").length;
    const totalFailed = studentAcademicList.filter(s => s.academicStanding === "Failed").length;
    const totalNeedsVerification = studentAcademicList.filter(s => s.academicStanding === "Needs Verification").length;
    const passingRate = totalEvaluated > 0 ? Math.round((totalPassed / totalEvaluated) * 100) : 0;

    const sectionSummaries = Array.from(sectionSummaryMap.values()).map(sec => ({
      ...sec,
      passingRate: sec.total > 0 ? Math.round((sec.passed / sec.total) * 100) : 0,
    })).sort((a, b) => b.total - a.total);

    // Filter students
    let filteredStudents = studentAcademicList;
    if (filters?.grade && filters.grade !== "All") {
      filteredStudents = filteredStudents.filter(s => s.gradeLevel === filters.grade);
    }
    if (filters?.section && filters.section !== "All") {
      filteredStudents = filteredStudents.filter(s => s.section === filters.section);
    }
    if (filters?.schoolYear && filters.schoolYear !== "All") {
      filteredStudents = filteredStudents.filter(s => s.schoolYear === filters.schoolYear);
    }

    return {
      metrics: {
        totalEvaluated,
        totalPassed,
        totalFailed,
        totalNeedsVerification,
        passingRate,
      },
      sectionSummaries,
      students: filteredStudents,
      totalCount: studentAcademicList.length,
      filteredCount: filteredStudents.length,
    };
  } catch (err: any) {
    console.error("[getPrincipalAcademicOverview] Error:", err.message);
    return { error: err.message || "Failed to load academic overview." };
  }
}

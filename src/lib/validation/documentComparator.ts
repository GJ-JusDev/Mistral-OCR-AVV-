import { normalizeLrn, isValidLrn, normalizeSex } from "./patterns";
import { getAuthoritativeSemesterFinalGrade } from "./gradeUtils";
import type { ExtractedFields, GradeRecord } from "@/types/documents";

export type ComparisonStatus =
  | "MATCH"
  | "MISMATCH"
  | "MISSING_DATA"
  | "NEEDS_VERIFICATION"
  | "NOT_APPLICABLE";

export interface FieldComparisonResult {
  field: string;
  label: string;
  doc1Value?: any;
  doc2Value?: any;
  doc3Value?: any;
  status: ComparisonStatus;
  details?: string;
}

export interface AcademicGradeComparisonItem {
  subject: string;
  semester?: string;
  doc1Grade?: number | string;
  doc2Grade?: number | string;
  doc1Quarter?: { q1?: any; q2?: any; q3?: any; q4?: any };
  doc2Quarter?: { q1?: any; q2?: any; q3?: any; q4?: any };
  status: ComparisonStatus;
  details?: string;
}

export interface DocumentComparisonSummary {
  isSameLearner: boolean;
  overallStatus: "MATCH" | "DISCREPANCIES_FOUND" | "NEEDS_ATTENTION";
  identityResults: FieldComparisonResult[];
  academicResults: AcademicGradeComparisonItem[];
  hasDiscrepancies: boolean;
  hasUnverifiedFields: boolean;
  summaryMessage: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXCLUDED_OBSERVED_VALUES = [
  "core values",
  "behavior statements",
  "maka-diyos",
  "makatao",
  "makakalikasan",
  "makabansa",
  "observed values",
  "grading scale",
  "descriptors",
];

function isNonAcademicSubject(subject: string): boolean {
  const lower = subject.toLowerCase();
  return EXCLUDED_OBSERVED_VALUES.some((kw) => lower.includes(kw));
}

export function cleanSubjectName(raw: string): string {
  let cleaned = raw
    .replace(/^(?:core\s+subjects?|applied\s+and\s+specialized\s+subjects?|applied\s+subjects?|specialized\s+subjects?)[\s:\-–|]*/i, "")
    .replace(/[|*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  // Normalize common DepEd subject titles
  if (cleaned.startsWith("komunikasyon at pananaliksik")) {
    return "komunikasyon at pananaliksik sa wika at kulturang pilipino";
  }
  if (cleaned.startsWith("oral communication")) {
    return "oral communication in context";
  }
  if (cleaned.startsWith("pagbasa at pagsusuri")) {
    return "pagbasa at pagsusuri ng iba't ibang teksto tungo sa pananaliksik";
  }
  if (cleaned.startsWith("introduction to the philosophy") || cleaned.startsWith("pambungad sa pilosopiya")) {
    return "introduction to the philosophy of the human person";
  }
  if (cleaned.startsWith("pe and health") || cleaned.startsWith("physical education")) {
    return cleaned.replace(/physical education/, "pe");
  }

  return cleaned;
}

export function cleanNamePart(name?: string | null): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-zñ\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(raw?: string | null): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const mm = slashMatch[1].padStart(2, "0");
    const dd = slashMatch[2].padStart(2, "0");
    const yyyy = slashMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return trimmed.toLowerCase();
}

function isValuePresent(val: any): boolean {
  if (val === undefined || val === null) return false;
  const s = String(val).trim();
  if (!s || s === "-" || s === "—" || s.toLowerCase() === "not found" || s.toLowerCase() === "n/a") {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 1. Identity Comparison
// ---------------------------------------------------------------------------

export function compareIdentityFields(
  doc1: ExtractedFields,
  doc2: ExtractedFields,
  doc3?: ExtractedFields
): { results: FieldComparisonResult[]; isSameLearner: boolean; reason?: string } {
  const results: FieldComparisonResult[] = [];
  let isSameLearner = true;
  let reason: string | undefined = undefined;

  // 1. LRN Comparison
  const lrn1 = doc1.lrn ? normalizeLrn(String(doc1.lrn)) : "";
  const lrn2 = doc2.lrn ? normalizeLrn(String(doc2.lrn)) : "";
  const lrn3 = doc3?.lrn ? normalizeLrn(String(doc3.lrn)) : undefined;

  let lrnStatus: ComparisonStatus = "NEEDS_VERIFICATION";
  let lrnDetails = "";

  if (lrn1 && lrn2) {
    if (isValidLrn(lrn1) && isValidLrn(lrn2)) {
      if (lrn1 === lrn2) {
        lrnStatus = "MATCH";
      } else {
        lrnStatus = "MISMATCH";
        isSameLearner = false;
        reason = `LRN mismatch: Document 1 has ${lrn1}, but Document 2 has ${lrn2}.`;
        lrnDetails = "LRNs do not match. These documents may belong to different learners.";
      }
    } else {
      lrnStatus = lrn1 === lrn2 ? "MATCH" : "NEEDS_VERIFICATION";
      lrnDetails = "One or more LRNs require format verification.";
    }
  } else if (!lrn1 && !lrn2) {
    lrnStatus = "MISSING_DATA";
    lrnDetails = "LRN could not be extracted from either document.";
  } else {
    lrnStatus = "NEEDS_VERIFICATION";
    lrnDetails = `LRN missing on ${!lrn1 ? "Document 1" : "Document 2"}. Verify physical card.`;
  }

  results.push({
    field: "lrn",
    label: "Learner Reference Number (LRN)",
    doc1Value: lrn1 || "(Not extracted)",
    doc2Value: lrn2 || "(Not extracted)",
    doc3Value: doc3 ? (lrn3 || "N/A (Birth Cert)") : undefined,
    status: lrnStatus,
    details: lrnDetails,
  });

  // 2. Name Parts (Last, First, Middle, Full)
  const last1 = cleanNamePart(doc1.last_name || doc1.name?.split(",")[0]);
  const last2 = cleanNamePart(doc2.last_name || doc2.name?.split(",")[0]);
  const last3 = doc3 ? cleanNamePart(doc3.last_name || doc3.name?.split(",")[0]) : undefined;

  const first1 = cleanNamePart(doc1.first_name);
  const first2 = cleanNamePart(doc2.first_name);
  const first3 = doc3 ? cleanNamePart(doc3.first_name) : undefined;

  const mid1 = cleanNamePart(doc1.middle_name);
  const mid2 = cleanNamePart(doc2.middle_name);
  const mid3 = doc3 ? cleanNamePart(doc3.middle_name) : undefined;

  // Last Name
  let lastStatus: ComparisonStatus = "NEEDS_VERIFICATION";
  if (last1 && last2) {
    if (last1 === last2) {
      if (!doc3) {
        lastStatus = "MATCH";
      } else if (!last3) {
        lastStatus = "NEEDS_VERIFICATION";
      } else if (last3 === last1) {
        lastStatus = "MATCH";
      } else {
        lastStatus = "MISMATCH";
      }
    } else {
      lastStatus = "MISMATCH";
      if (lrnStatus === "MISMATCH" || !lrn1 || !lrn2) {
        isSameLearner = false;
        reason = reason || `Last name mismatch: "${last1}" vs "${last2}".`;
      }
    }
  } else if (!last1 && !last2 && (!doc3 || !last3)) {
    lastStatus = "MISSING_DATA";
  } else {
    lastStatus = "NEEDS_VERIFICATION";
  }
  results.push({
    field: "last_name",
    label: "Last Name",
    doc1Value: doc1.last_name || (last1 ? last1.toUpperCase() : "(Missing)"),
    doc2Value: doc2.last_name || (last2 ? last2.toUpperCase() : "(Missing)"),
    doc3Value: doc3 ? (doc3.last_name || (last3 ? last3.toUpperCase() : "(Missing)")) : undefined,
    status: lastStatus,
  });

  // First Name
  let firstStatus: ComparisonStatus = "NEEDS_VERIFICATION";
  if (first1 && first2) {
    if (first1 === first2) {
      if (!doc3) {
        firstStatus = "MATCH";
      } else if (!first3) {
        firstStatus = "NEEDS_VERIFICATION";
      } else if (first3 === first1) {
        firstStatus = "MATCH";
      } else {
        firstStatus = "MISMATCH";
      }
    } else {
      firstStatus = "MISMATCH";
    }
  } else if (!first1 && !first2 && (!doc3 || !first3)) {
    firstStatus = "MISSING_DATA";
  } else {
    firstStatus = "NEEDS_VERIFICATION";
  }
  results.push({
    field: "first_name",
    label: "First Name",
    doc1Value: doc1.first_name || (first1 ? first1.toUpperCase() : "(Missing)"),
    doc2Value: doc2.first_name || (first2 ? first2.toUpperCase() : "(Missing)"),
    doc3Value: doc3 ? (doc3.first_name || (first3 ? first3.toUpperCase() : "(Missing)")) : undefined,
    status: firstStatus,
  });

  // Middle Name
  let midStatus: ComparisonStatus = "NEEDS_VERIFICATION";
  if (mid1 && mid2) {
    if (mid1 === mid2) {
      if (!doc3) {
        midStatus = "MATCH";
      } else if (!mid3) {
        midStatus = "NEEDS_VERIFICATION";
      } else if (mid3 === mid1) {
        midStatus = "MATCH";
      } else {
        midStatus = "MISMATCH";
      }
    } else {
      midStatus = "MISMATCH";
    }
  } else if (!mid1 && !mid2 && (!doc3 || !mid3)) {
    midStatus = "MATCH"; // Legitimately blank or absent across compared documents
  } else {
    midStatus = "NEEDS_VERIFICATION"; // One is populated, other unextracted
  }
  results.push({
    field: "middle_name",
    label: "Middle Name",
    doc1Value: doc1.middle_name || (mid1 ? mid1.toUpperCase() : "(None/Unextracted)"),
    doc2Value: doc2.middle_name || (mid2 ? mid2.toUpperCase() : "(None/Unextracted)"),
    doc3Value: doc3 ? (doc3.middle_name || (mid3 ? mid3.toUpperCase() : "(None/Unextracted)")) : undefined,
    status: midStatus,
    details: midStatus === "NEEDS_VERIFICATION" ? "Middle name is missing or unextracted on one document." : undefined,
  });

  // 3. Date of Birth
  const dob1 = normalizeDate(doc1.birth_date);
  const dob2 = normalizeDate(doc2.birth_date);
  const dob3 = doc3 ? normalizeDate(doc3.birth_date) : undefined;

  if (dob1 || dob2 || dob3) {
    let dobStatus: ComparisonStatus = "NEEDS_VERIFICATION";
    if (dob1 && dob2) {
      if (dob1 !== dob2) {
        dobStatus = "MISMATCH";
      } else if (!doc3) {
        dobStatus = "MATCH";
      } else if (!dob3) {
        dobStatus = "NEEDS_VERIFICATION";
      } else {
        dobStatus = dob3 === dob1 ? "MATCH" : "MISMATCH";
      }
    } else if (!dob1 && !dob2 && (!doc3 || !dob3)) {
      dobStatus = "MISSING_DATA";
    } else {
      dobStatus = "NEEDS_VERIFICATION";
    }
    results.push({
      field: "birth_date",
      label: "Date of Birth",
      doc1Value: doc1.birth_date || "(Missing)",
      doc2Value: doc2.birth_date || "(Missing)",
      doc3Value: doc3?.birth_date || (doc3 ? "(Missing)" : undefined),
      status: dobStatus,
    });
  }

  // 4. Sex
  const sex1 = normalizeSex(doc1.sex || "");
  const sex2 = normalizeSex(doc2.sex || "");
  const sex3 = doc3 ? normalizeSex(doc3.sex || "") : undefined;

  if (sex1 || sex2 || sex3) {
    let sexStatus: ComparisonStatus = "NEEDS_VERIFICATION";
    if (sex1 && sex2) {
      if (sex1 !== sex2) {
        sexStatus = "MISMATCH";
      } else if (!doc3) {
        sexStatus = "MATCH";
      } else if (!sex3) {
        sexStatus = "NEEDS_VERIFICATION";
      } else {
        sexStatus = sex3 === sex1 ? "MATCH" : "MISMATCH";
      }
    } else if (!sex1 && !sex2 && (!doc3 || !sex3)) {
      sexStatus = "MISSING_DATA";
    } else {
      sexStatus = "NEEDS_VERIFICATION";
    }
    results.push({
      field: "sex",
      label: "Sex",
      doc1Value: sex1 || "(Missing)",
      doc2Value: sex2 || "(Missing)",
      doc3Value: doc3 ? (sex3 || "(Missing)") : undefined,
      status: sexStatus,
    });
  }

  return { results, isSameLearner, reason };
}

// ---------------------------------------------------------------------------
// 2. Academic Grade Comparison
// ---------------------------------------------------------------------------

export function compareAcademicGrades(
  doc1Grades: GradeRecord[] = [],
  doc2Grades: GradeRecord[] = []
): AcademicGradeComparisonItem[] {
  const results: AcademicGradeComparisonItem[] = [];

  // Filter out Observed Values / non-academic tables
  const valid1 = doc1Grades.filter((g) => !isNonAcademicSubject(g.subject));
  const valid2 = doc2Grades.filter((g) => !isNonAcademicSubject(g.subject));

  const bothHaveSemesters =
    valid1.some((g) => Boolean(g.semester)) && valid2.some((g) => Boolean(g.semester));

  const makeSubjectKey = (g: GradeRecord): string => {
    const base = cleanSubjectName(g.subject);
    if (!base) return "";
    if (bothHaveSemesters && g.semester) {
      return `${g.semester.toLowerCase().trim()}::${base}`;
    }
    return base;
  };

  // Build subject map
  const subjectMap = new Map<string, { g1?: GradeRecord; g2?: GradeRecord; originalName: string; semester?: string }>();

  for (const g of valid1) {
    const key = makeSubjectKey(g);
    if (!key) continue;
    subjectMap.set(key, { g1: g, originalName: g.subject, semester: g.semester });
  }

  for (const g of valid2) {
    const key = makeSubjectKey(g);
    if (!key) continue;
    const existing = subjectMap.get(key);
    if (existing) {
      existing.g2 = g;
      if (!existing.semester && g.semester) existing.semester = g.semester;
    } else {
      subjectMap.set(key, { g2: g, originalName: g.subject, semester: g.semester });
    }
  }

  for (const [, item] of subjectMap.entries()) {
    const g1 = item.g1;
    const g2 = item.g2;

    const val1 = getAuthoritativeSemesterFinalGrade(g1);
    const val2 = getAuthoritativeSemesterFinalGrade(g2);

    const hasVal1 = isValuePresent(val1);
    const hasVal2 = isValuePresent(val2);

    let status: ComparisonStatus = "NEEDS_VERIFICATION";
    let details: string | undefined = undefined;

    if (hasVal1 && hasVal2) {
      const num1 = typeof val1 === "number" ? val1 : parseFloat(String(val1));
      const num2 = typeof val2 === "number" ? val2 : parseFloat(String(val2));

      if (!isNaN(num1) && !isNaN(num2)) {
        if (num1 === num2) {
          status = "MATCH";
        } else {
          status = "MISMATCH";
          details = `Grade discrepancy: SF9 has ${num1}, but SF10 has ${num2}.`;
        }
      } else {
        // Text mark comparison (e.g. INC, DRP)
        if (String(val1).trim().toUpperCase() === String(val2).trim().toUpperCase()) {
          status = "MATCH";
        } else {
          status = "MISMATCH";
          details = `Mark discrepancy: "${val1}" vs "${val2}".`;
        }
      }
    } else if (!hasVal1 && !hasVal2) {
      status = "MISSING_DATA";
      details = "Grade is missing from both documents.";
    } else {
      // One document has the grade, the other does not
      status = "NEEDS_VERIFICATION";
      details = `Grade missing on ${!hasVal1 ? "SF9" : "SF10"}. Verify source record.`;
    }

    results.push({
      subject: item.originalName,
      semester: item.semester,
      doc1Grade: hasVal1 ? val1 : "-",
      doc2Grade: hasVal2 ? val2 : "-",
      doc1Quarter: g1 ? { q1: g1.q1, q2: g1.q2, q3: g1.q3, q4: g1.q4 } : undefined,
      doc2Quarter: g2 ? { q1: g2.q1, q2: g2.q2, q3: g2.q3, q4: g2.q4 } : undefined,
      status,
      details,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 3. Overall SF9 ↔ SF10 Comparison Controller
// ---------------------------------------------------------------------------

export function compareDocuments(
  doc1: ExtractedFields,
  doc2: ExtractedFields,
  doc3?: ExtractedFields
): DocumentComparisonSummary {
  const { results: identityResults, isSameLearner, reason } = compareIdentityFields(doc1, doc2, doc3);

  let academicResults: AcademicGradeComparisonItem[] = [];
  if (isSameLearner) {
    academicResults = compareAcademicGrades(doc1.grades || [], doc2.grades || []);
  }

  const hasIdentityDiscrepancy = identityResults.some((r) => r.status === "MISMATCH");
  const hasAcademicDiscrepancy = academicResults.some((r) => r.status === "MISMATCH");
  const hasDiscrepancies = hasIdentityDiscrepancy || hasAcademicDiscrepancy;

  const hasUnverifiedIdentity = identityResults.some(
    (r) => r.status === "NEEDS_VERIFICATION" || r.status === "MISSING_DATA"
  );
  const hasUnverifiedAcademic = academicResults.some(
    (r) => r.status === "NEEDS_VERIFICATION" || r.status === "MISSING_DATA"
  );
  const hasUnverifiedFields = hasUnverifiedIdentity || hasUnverifiedAcademic;

  let overallStatus: "MATCH" | "DISCREPANCIES_FOUND" | "NEEDS_ATTENTION" = "MATCH";
  let summaryMessage = "All identity and academic records match.";

  if (!isSameLearner) {
    overallStatus = "DISCREPANCIES_FOUND";
    summaryMessage = reason || "Documents belong to different learners.";
  } else if (hasDiscrepancies) {
    overallStatus = "DISCREPANCIES_FOUND";
    summaryMessage = "Discrepancies found between documents. Review flagged fields.";
  } else if (hasUnverifiedFields) {
    overallStatus = "NEEDS_ATTENTION";
    summaryMessage = "Some fields are missing or require human verification against physical cards.";
  }

  return {
    isSameLearner,
    overallStatus,
    identityResults,
    academicResults,
    hasDiscrepancies,
    hasUnverifiedFields,
    summaryMessage,
  };
}

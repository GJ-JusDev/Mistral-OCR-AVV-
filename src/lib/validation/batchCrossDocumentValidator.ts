/**
 * AVV System — Unified Batch Cross-Document Validator
 *
 * Coordinates cross-document validation across all extracted SHS documents:
 * - SF1-SHS ↔ SF2-SHS (Enrollment vs Daily Attendance)
 * - SF1-SHS ↔ SF5A/SF5B (Enrollment vs Promotion Status)
 * - SF1-SHS ↔ SF9-SHS (Enrollment vs Report Card)
 * - SF1-SHS ↔ SF10-SHS (Enrollment vs Permanent Transcript)
 * - SF9-SHS ↔ SF10-SHS (Report Card Grades vs Permanent Record)
 * - SF5A-SHS ↔ SF9-SHS (Promotion Status vs Failing Grades)
 * - SF5B-SHS ↔ SF10-SHS (Graduation Clearance vs Back-Subjects)
 * - PSA ↔ SF1/SF9/SF10 (Civil Identity Supporting Evidence)
 *
 * Organizes findings into the 6 canonical categories:
 * 1. Successfully Matched
 * 2. Consistent Records
 * 3. Mismatched Information
 * 4. Missing Documents
 * 5. Incomplete Data
 * 6. Needs Manual Verification
 */

import {
  comparePsaAndSf1,
  compareSf1AndSf2,
  compareSf1AndSf5,
  compareSf1AndSf9,
  compareSf9AndSf10,
  compareSf5AndSf9,
  compareSf5AndSf10,
  evaluateUnifiedStudentValidation,
  normalizeAttendanceMonthKey,
  type PairwiseValidationResult,
  type DiscrepancyItem,
  type UnifiedFieldComparisonRow,
  type DuplicateScanWarning,
  type UnifiedStudentValidationOutcome,
} from "./crossDocumentEngine";
import { normalizeLrn, isValidLrn, normalizeSex } from "./patterns";
import { normalizeNamePart, normalizeDate } from "./nameComparison";
import type { DocumentSegment } from "./batchDocumentSegmenter";

export interface BatchDiscrepancyItem {
  id: string;
  learnerName: string;
  lrn: string;
  field: string;
  source1Doc: string;
  source1Page?: number;
  source1FileName?: string;
  source1DataUrl?: string;
  source1Value: any;
  source2Doc: string;
  source2Page?: number;
  source2FileName?: string;
  source2DataUrl?: string;
  source2Value: any;
  severity: "CRITICAL" | "WARNING" | "INFO" | "ERROR";
  category: "MISMATCH" | "MISSING_DOC" | "INCOMPLETE_DATA" | "NEEDS_VERIFICATION";
  reason: string;
  recommendedAction: string;
}

export interface LearnerValidationDossier {
  lrn: string;
  fullName: string;
  lastName: string;
  firstName: string;
  middleName?: string;
  sex?: string;
  birthDate?: string;
  gradeLevel?: string;
  section?: string;
  trackStrand?: string;
  overallStatus: "MATCH" | "MISMATCH" | "NEEDS_REVIEW" | "INCOMPLETE";
  documentPresence: {
    sf1: boolean;
    sf2: boolean;
    sf5: boolean;
    sf5a: boolean;
    sf5b: boolean;
    sf9: boolean;
    sf10: boolean;
    psa: boolean;
    sf2MonthsCount: number;
    totalAvailable: number;
  };
  matchedSources: {
    sf1?: { pageNumber?: number; fileName?: string; dataUrl?: string; raw: any };
    sf2?: { pageNumber?: number; fileName?: string; dataUrl?: string; raw: any };
    sf5?: { pageNumber?: number; fileName?: string; dataUrl?: string; raw: any };
    sf5a?: { pageNumber?: number; fileName?: string; dataUrl?: string; raw: any };
    sf5b?: { pageNumber?: number; fileName?: string; dataUrl?: string; raw: any };
    sf9?: { pageNumber?: number; fileName?: string; dataUrl?: string; raw: any };
    sf10?: { pageNumber?: number; fileName?: string; dataUrl?: string; raw: any };
    psa?: { pageNumber?: number; fileName?: string; dataUrl?: string; raw: any };
  };
  allSf2Records?: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; month?: string; raw: any }>;
  allSf9Records?: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; raw: any }>;
  allSf10Records?: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; raw: any }>;
  pairwiseResults: PairwiseValidationResult[];
  discrepancies: BatchDiscrepancyItem[];
  unifiedMatrix: UnifiedFieldComparisonRow[];
  duplicateWarnings: DuplicateScanWarning[];
  validationPersistence?: {
    status: "PERSISTED" | "REQUIRES_IDENTITY_RESOLUTION" | "ERROR" | "SKIPPED";
    consolidatedValidationId?: string;
    persistedStatus?: string;
    reason?: string;
    recommendedAction?: string;
  };
  persistedDiscrepancies?: Array<{
    field: string;
    sourceValue?: any;
    targetValue?: any;
    severity?: string;
    category?: string;
    description?: string;
  }>;
}

export interface BatchValidationReport {
  batchId: string;
  schoolYear: string;
  gradeLevel: string;
  section: string;
  summary: {
    totalLearnersDetected: number;
    successfullyMatchedCount: number; // Matched across forms with 100% field consistency
    consistentRecordsCount: number;    // No critical discrepancies
    mismatchedInformationCount: number; // Mismatches found
    missingDocumentsCount: number;     // Missing expected forms
    incompleteDataCount: number;       // Missing LRN, grades, or marks
    needsManualVerificationCount: number; // Needing teacher judgment
    persistedValidationCount?: number; // Learners whose validation was persisted
    identityResolutionRequiredCount?: number; // Learners with no valid LRN (not persisted)
  };
  categorizedResults: {
    successfullyMatched: LearnerValidationDossier[];
    consistentRecords: LearnerValidationDossier[];
    mismatchedInformation: BatchDiscrepancyItem[];
    missingDocuments: BatchDiscrepancyItem[];
    incompleteData: BatchDiscrepancyItem[];
    needsManualVerification: BatchDiscrepancyItem[];
    requiresIdentityResolution?: LearnerValidationDossier[];
  };
  learnerDossiers: LearnerValidationDossier[];
  segments: DocumentSegment[];
  validationSource?: "COMPUTED_PREVIEW" | "PERSISTED";
}

/**
 * Executes unified batch cross-document validation across all extracted document segments.
 */
export function evaluateBatchCrossDocumentValidation(params: {
  batchId?: string;
  schoolYear?: string;
  gradeLevel?: string;
  section?: string;
  segments: DocumentSegment[];
  extractedSegmentData: Record<string, any>;
}): BatchValidationReport {
  const {
    batchId = `batch-${Date.now()}`,
    schoolYear = "2024-2025",
    gradeLevel = "Grade 11",
    section = "Unassigned Section",
    segments,
    extractedSegmentData,
  } = params;

  // 1. Group extracted records by learner LRN
  const learnersMap = new Map<string, {
    lrn: string;
    lastName: string;
    firstName: string;
    middleName?: string;
    sex?: string;
    birthDate?: string;
    gradeLevel?: string;
    section?: string;
    trackStrand?: string;
    sf1Record?: { pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any };
    sf2Records: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; month?: string; raw: any }>;
    sf5aRecord?: { pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any };
    sf5bRecord?: { pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any };
    sf5Record?: { pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any };
    sf9Record?: { pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any };
    sf10Record?: { pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any };
    psaRecord?: { pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any };

    allSf1Records: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any }>;
    allSf2Records: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; month?: string; raw: any }>;
    allSf5aRecords: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any }>;
    allSf5bRecords: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any }>;
    allSf9Records: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any }>;
    allSf10Records: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any }>;
    allPsaRecords: Array<{ pageNumber?: number; fileName?: string; dataUrl?: string; documentId?: string; raw: any }>;

    duplicateWarnings: DuplicateScanWarning[];
  }>();

  // Helper to ensure a learner entry exists in learnersMap
  const getOrCreateLearner = (
    rawLrn: string | undefined | null,
    candidateName?: { lastName?: string; firstName?: string; middleName?: string; fullName?: string },
    docType?: string
  ) => {
    let cleanLrn = normalizeLrn(rawLrn);
    if (!isValidLrn(cleanLrn)) {
      cleanLrn = "";
    }

    // FIX 2: Primary matching key is strictly a valid 12-digit LRN.
    // Never merge learners using first and last names alone.
    // When LRN is absent or invalid, create a separate isolated learner record with a unique temporary key.
    if (!cleanLrn) {
      const tempId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      cleanLrn = `UNREGISTERED-${tempId}`;
    }

    if (!learnersMap.has(cleanLrn)) {
      learnersMap.set(cleanLrn, {
        lrn: cleanLrn.startsWith("UNREGISTERED-") ? "" : cleanLrn,
        lastName: candidateName?.lastName || "",
        firstName: candidateName?.firstName || "",
        middleName: candidateName?.middleName,
        gradeLevel,
        section,
        sf2Records: [],
        allSf1Records: [],
        allSf2Records: [],
        allSf5aRecords: [],
        allSf5bRecords: [],
        allSf9Records: [],
        allSf10Records: [],
        allPsaRecords: [],
        duplicateWarnings: [],
      });
    }

    const learner = learnersMap.get(cleanLrn)!;
    if (!learner.lastName && candidateName?.lastName) learner.lastName = candidateName.lastName;
    if (!learner.firstName && candidateName?.firstName) learner.firstName = candidateName.firstName;
    if (!learner.middleName && candidateName?.middleName) learner.middleName = candidateName.middleName;
    return learner;
  };

  // 2. Ingest extracted records from each segment
  for (const seg of segments) {
    const data = extractedSegmentData[seg.id] || {};
    const pageNum = seg.pageNumbers[0] ?? 1;
    const segFileName = seg.sourceFileName || seg.pages?.[0]?.sourceFileName;
    const segDataUrl = seg.imageUrl || seg.pages?.[0]?.sourceFileDataUrl;

    // SF1 School Register
    if (seg.documentType === "sf1" && Array.isArray(data.learners)) {
      for (const item of data.learners) {
        const l = getOrCreateLearner(
          item.lrn,
          { lastName: item.last_name, firstName: item.first_name, middleName: item.middle_name },
          "sf1"
        );
        l.lastName = item.last_name || l.lastName;
        l.firstName = item.first_name || l.firstName;
        l.middleName = item.middle_name || l.middleName;
        l.sex = item.sex || l.sex;
        l.birthDate = item.birth_date || l.birthDate;
        l.section = data.section || item.section || l.section;
        l.gradeLevel = data.grade_level || item.grade_level || l.gradeLevel;
        l.trackStrand = data.track_strand || item.track_strand || l.trackStrand;

        const newRec = {
          pageNumber: item.page_number || pageNum,
          fileName: item.source_file_name || segFileName,
          dataUrl: item.source_file_data_url || segDataUrl,
          documentId: seg.id,
          raw: item,
        };

        if (l.sf1Record) {
          const isIdentical =
            l.sf1Record.raw?.last_name === item.last_name &&
            l.sf1Record.raw?.first_name === item.first_name &&
            l.sf1Record.raw?.birth_date === item.birth_date;
          l.duplicateWarnings.push({
            documentType: "SF1-SHS",
            details: isIdentical
              ? `Duplicate scan of SF1 School Register detected (${segFileName}). Original scan preserved.`
              : `Conflicting duplicate scan of SF1 School Register with different learner details (${segFileName} vs ${l.sf1Record.fileName}).`,
            existingSource: l.sf1Record.fileName || "SF1 Scan 1",
            newSource: segFileName || "SF1 Scan 2",
            isIdentical,
            severity: isIdentical ? "INFO" : "CRITICAL",
          });
        } else {
          l.sf1Record = newRec;
        }
        l.allSf1Records.push(newRec);
      }
    }

    // SF2 Daily Attendance Report (Preserves multiple months, flags duplicate scans for same month)
    if (seg.documentType === "sf2" && (Array.isArray(data.attendance_records) || Array.isArray(data.learners))) {
      const records = data.attendance_records || data.learners;
      const segMonth = data.month || data.attendance_summary?.month || "MONTH";
      for (const item of records) {
        const l = getOrCreateLearner(
          item.lrn,
          { lastName: item.last_name || item.learner_name, firstName: item.first_name },
          "sf2"
        );
        const itemMonth = item.month || segMonth;
        const normMonth = normalizeAttendanceMonthKey(itemMonth);
        const newRec = {
          pageNumber: item.page_number || pageNum,
          fileName: item.source_file_name || segFileName,
          dataUrl: item.source_file_data_url || segDataUrl,
          documentId: seg.id,
          month: itemMonth,
          raw: {
            ...item,
            month: itemMonth,
            school_year: item.school_year || data.school_year,
            grade_level: item.grade_level || data.grade_level,
            section: item.section || data.section,
          },
        };

        const existingForMonth = l.sf2Records.find(
          (r) => normalizeAttendanceMonthKey(r.month || r.raw?.month) === normMonth
        );
        if (existingForMonth) {
          const exPresent = existingForMonth.raw?.total_present ?? existingForMonth.raw?.days_present ?? existingForMonth.raw?.total_days_present ?? "";
          const newPresent = item.total_present ?? item.days_present ?? item.total_days_present ?? "";
          const exAbsent = existingForMonth.raw?.total_absent ?? existingForMonth.raw?.days_absent ?? existingForMonth.raw?.total_days_absent ?? "";
          const newAbsent = item.total_absent ?? item.days_absent ?? item.total_days_absent ?? "";
          const isIdentical =
            String(exPresent) === String(newPresent) &&
            String(exAbsent) === String(newAbsent);
          l.duplicateWarnings.push({
            documentType: "SF2-SHS",
            details: isIdentical
              ? `Duplicate scan of SF2 daily attendance for month "${itemMonth}" detected (${segFileName}). Original monthly record preserved.`
              : `Conflicting duplicate scan of SF2 daily attendance for month "${itemMonth}" detected with differing attendance figures (${segFileName} vs ${existingForMonth.fileName}).`,
            existingSource: existingForMonth.fileName || `SF2 (${itemMonth}) Scan 1`,
            newSource: segFileName || `SF2 (${itemMonth}) Scan 2`,
            isIdentical,
            severity: isIdentical ? "WARNING" : "CRITICAL",
          });
        } else {
          l.sf2Records.push(newRec);
        }
        l.allSf2Records.push(newRec);
      }
    }

    // SF5A End of Semester Promotion (Separate from SF5B to eliminate collision)
    if (seg.documentType === "sf5a" && (Array.isArray(data.learners) || Array.isArray(data.promotion_records))) {
      const records = data.learners || data.promotion_records;
      for (const item of records) {
        const l = getOrCreateLearner(
          item.lrn,
          { lastName: item.last_name || item.learner_name, firstName: item.first_name },
          "sf5a"
        );
        const newRec = {
          pageNumber: item.page_number || pageNum,
          fileName: item.source_file_name || segFileName,
          dataUrl: item.source_file_data_url || segDataUrl,
          documentId: seg.id,
          raw: {
            ...item,
            school_year: item.school_year || data.school_year,
            grade_level: item.grade_level || data.grade_level,
            section: item.section || data.section,
            semester: item.semester || data.semester,
          },
        };
        if (l.sf5aRecord) {
          const isIdentical =
            String(l.sf5aRecord.raw?.action_taken || "").toUpperCase() === String(item.action_taken || "").toUpperCase();
          l.duplicateWarnings.push({
            documentType: "SF5A-SHS",
            details: isIdentical
              ? `Duplicate scan of SF5A promotion report detected (${segFileName}). Original record preserved.`
              : `Conflicting duplicate scan of SF5A promotion report detected with differing promotion status (${segFileName} vs ${l.sf5aRecord.fileName}).`,
            existingSource: l.sf5aRecord.fileName || "SF5A Scan 1",
            newSource: segFileName || "SF5A Scan 2",
            isIdentical,
            severity: isIdentical ? "WARNING" : "CRITICAL",
          });
        } else {
          l.sf5aRecord = newRec;
          if (!l.sf5Record) l.sf5Record = newRec;
        }
        l.allSf5aRecords.push(newRec);
      }
    }

    // SF5B Graduation List (Grade 12, Separate from SF5A to eliminate collision)
    if (seg.documentType === "sf5b" && (Array.isArray(data.learners) || Array.isArray(data.promotion_records))) {
      const records = data.learners || data.promotion_records;
      for (const item of records) {
        const l = getOrCreateLearner(
          item.lrn,
          { lastName: item.last_name || item.learner_name, firstName: item.first_name },
          "sf5b"
        );
        const newRec = {
          pageNumber: item.page_number || pageNum,
          fileName: item.source_file_name || segFileName,
          dataUrl: item.source_file_data_url || segDataUrl,
          documentId: seg.id,
          raw: {
            ...item,
            school_year: item.school_year || data.school_year,
            grade_level: item.grade_level || data.grade_level || "Grade 12",
            section: item.section || data.section,
            graduation_status: item.graduation_status || item.action_taken || "GRADUATED",
          },
        };
        if (l.sf5bRecord) {
          const isIdentical =
            String(l.sf5bRecord.raw?.graduation_status || "").toUpperCase() === String(newRec.raw.graduation_status || "").toUpperCase();
          l.duplicateWarnings.push({
            documentType: "SF5B-SHS",
            details: isIdentical
              ? `Duplicate scan of SF5B graduation report detected (${segFileName}). Original record preserved.`
              : `Conflicting duplicate scan of SF5B graduation report detected with differing graduation status (${segFileName} vs ${l.sf5bRecord.fileName}).`,
            existingSource: l.sf5bRecord.fileName || "SF5B Scan 1",
            newSource: segFileName || "SF5B Scan 2",
            isIdentical,
            severity: isIdentical ? "WARNING" : "CRITICAL",
          });
        } else {
          l.sf5bRecord = newRec;
          if (!l.sf5Record) l.sf5Record = newRec;
        }
        l.allSf5bRecords.push(newRec);
      }
    }

    // SF9 Progress Report Card
    if (seg.documentType === "sf9") {
      const l = getOrCreateLearner(
        data.lrn,
        { lastName: data.last_name, firstName: data.first_name, middleName: data.middle_name },
        "sf9"
      );
      const newRec = {
        pageNumber: pageNum,
        fileName: data.source_file_name || segFileName,
        dataUrl: data.source_file_data_url || segDataUrl,
        documentId: seg.id,
        raw: data,
      };
      if (l.sf9Record) {
        const isIdentical =
          String(l.sf9Record.raw?.general_average ?? "") === String(data.general_average ?? "") &&
          JSON.stringify(l.sf9Record.raw?.grades || []) === JSON.stringify(data.grades || []);
        l.duplicateWarnings.push({
          documentType: "SF9-SHS",
          details: isIdentical
            ? `Duplicate scan of SF9 Progress Report Card detected (${segFileName}). Original record preserved.`
            : `Conflicting duplicate scan of SF9 Progress Report Card detected with differing grades/averages (${segFileName} vs ${l.sf9Record.fileName}).`,
          existingSource: l.sf9Record.fileName || "SF9 Scan 1",
          newSource: segFileName || "SF9 Scan 2",
          isIdentical,
          severity: isIdentical ? "WARNING" : "CRITICAL",
        });
      } else {
        l.sf9Record = newRec;
      }
      l.allSf9Records.push(newRec);
    }

    // SF10 Permanent Record
    if (seg.documentType === "sf10") {
      const l = getOrCreateLearner(
        data.lrn,
        { lastName: data.last_name, firstName: data.first_name, middleName: data.middle_name },
        "sf10"
      );
      const newRec = {
        pageNumber: pageNum,
        fileName: data.source_file_name || segFileName,
        dataUrl: data.source_file_data_url || segDataUrl,
        documentId: seg.id,
        raw: data,
      };
      if (l.sf10Record) {
        const isIdentical =
          JSON.stringify(l.sf10Record.raw?.grades || l.sf10Record.raw?.academic_records || []) ===
          JSON.stringify(data.grades || data.academic_records || []);
        l.duplicateWarnings.push({
          documentType: "SF10-SHS",
          details: isIdentical
            ? `Duplicate scan of SF10 Permanent Transcript detected (${segFileName}). Original transcript preserved.`
            : `Conflicting duplicate scan of SF10 Permanent Transcript detected with differing academic history (${segFileName} vs ${l.sf10Record.fileName}).`,
          existingSource: l.sf10Record.fileName || "SF10 Scan 1",
          newSource: segFileName || "SF10 Scan 2",
          isIdentical,
          severity: isIdentical ? "WARNING" : "CRITICAL",
        });
      } else {
        l.sf10Record = newRec;
      }
      l.allSf10Records.push(newRec);
    }

    // PSA Birth Certificate
    if (seg.documentType === "birth_cert") {
      const psaId = data.identity || data;
      const l = getOrCreateLearner(
        data.lrn || psaId.lrn,
        { lastName: psaId.last_name, firstName: psaId.first_name, middleName: psaId.middle_name },
        "birth_cert"
      );
      const newRec = {
        pageNumber: pageNum,
        fileName: data.source_file_name || segFileName,
        dataUrl: data.source_file_data_url || segDataUrl,
        documentId: seg.id,
        raw: psaId,
      };
      if (l.psaRecord) {
        const isIdentical =
          l.psaRecord.raw?.certificate_number === psaId.certificate_number ||
          (l.psaRecord.raw?.last_name === psaId.last_name && l.psaRecord.raw?.birth_date === psaId.birth_date);
        l.duplicateWarnings.push({
          documentType: "PSA",
          details: isIdentical
            ? `Duplicate scan of PSA Birth Certificate detected (${segFileName}). Original certificate preserved.`
            : `Conflicting duplicate scan of PSA Birth Certificate detected with differing identity details (${segFileName} vs ${l.psaRecord.fileName}).`,
          existingSource: l.psaRecord.fileName || "PSA Scan 1",
          newSource: segFileName || "PSA Scan 2",
          isIdentical,
          severity: isIdentical ? "INFO" : "CRITICAL",
        });
      } else {
        l.psaRecord = newRec;
      }
      l.allPsaRecords.push(newRec);
    }
  }

  // 3. Build learner dossiers and run pairwise comparisons
  const dossiers: LearnerValidationDossier[] = [];
  const allDiscrepancies: BatchDiscrepancyItem[] = [];

  for (const [lrnKey, learner] of learnersMap.entries()) {
    const fullName = [learner.lastName, learner.firstName].filter(Boolean).join(", ") +
      (learner.middleName ? ` ${learner.middleName}` : "");
    const displayedLrn = learner.lrn || lrnKey;

    const docPresence = {
      sf1: Boolean(learner.sf1Record),
      sf2: learner.sf2Records.length > 0,
      sf5: Boolean(learner.sf5aRecord || learner.sf5bRecord || learner.sf5Record),
      sf5a: Boolean(learner.sf5aRecord),
      sf5b: Boolean(learner.sf5bRecord),
      sf9: Boolean(learner.sf9Record),
      sf10: Boolean(learner.sf10Record),
      psa: Boolean(learner.psaRecord),
      sf2MonthsCount: learner.sf2Records.length,
      totalAvailable: [
        Boolean(learner.sf1Record),
        learner.sf2Records.length > 0,
        Boolean(learner.sf5aRecord),
        Boolean(learner.sf5bRecord),
        Boolean(learner.sf9Record),
        Boolean(learner.sf10Record),
        Boolean(learner.psaRecord),
      ].filter(Boolean).length,
    };

    const pairwiseResults: PairwiseValidationResult[] = [];
    const learnerDiscrepancies: BatchDiscrepancyItem[] = [];

    // Check for Incomplete Data (Missing 12-digit LRN)
    if (!learner.lrn || !isValidLrn(learner.lrn)) {
      const disc: BatchDiscrepancyItem = {
        id: `disc-${learnerDiscrepancies.length + 1}-incomplete-lrn`,
        learnerName: fullName || "Unknown Learner",
        lrn: displayedLrn,
        field: "Learner Reference Number (LRN)",
        source1Doc: learner.sf1Record ? "SF1-SHS" : "Uploaded Scan",
        source1Page: learner.sf1Record?.pageNumber,
        source1FileName: learner.sf1Record?.fileName,
        source1DataUrl: learner.sf1Record?.dataUrl,
        source1Value: displayedLrn.startsWith("UNREGISTERED") ? "MISSING / UNREADABLE" : displayedLrn,
        source2Doc: "DepEd DO 8 / DO 55 Standard",
        source2Value: "12-Digit Official LRN",
        severity: "CRITICAL",
        category: "INCOMPLETE_DATA",
        reason: "Valid 12-digit Learner Reference Number (LRN) is mandatory for DepEd official record processing.",
        recommendedAction: "Review original document image and input the verified 12-digit LRN.",
      };
      learnerDiscrepancies.push(disc);
      allDiscrepancies.push(disc);
    }

    // Check for Missing Documents (SF1 enrolled learner missing SF9 or SF2)
    if (docPresence.sf1) {
      if (!docPresence.sf2) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-missing-sf2`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: "Daily Attendance Record (SF2-SHS)",
          source1Doc: "SF1-SHS School Register",
          source1Page: learner.sf1Record?.pageNumber,
          source1FileName: learner.sf1Record?.fileName,
          source1DataUrl: learner.sf1Record?.dataUrl,
          source1Value: "ENROLLED",
          source2Doc: "SF2-SHS Daily Attendance",
          source2Value: "NOT FOUND IN BATCH",
          severity: "WARNING",
          category: "MISSING_DOC",
          reason: `Learner is officially registered on SF1 (Page ${learner.sf1Record?.pageNumber ?? 1}) but has no corresponding attendance records on SF2.`,
          recommendedAction: "Upload or verify the section's SF2 monthly daily attendance sheet.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }

      if (!docPresence.sf9 && !docPresence.sf10) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-missing-sf9`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: "Progress Report Card (SF9-SHS)",
          source1Doc: "SF1-SHS School Register",
          source1Page: learner.sf1Record?.pageNumber,
          source1FileName: learner.sf1Record?.fileName,
          source1DataUrl: learner.sf1Record?.dataUrl,
          source1Value: "ENROLLED",
          source2Doc: "SF9-SHS Progress Report",
          source2Value: "NOT FOUND IN BATCH",
          severity: "INFO",
          category: "MISSING_DOC",
          reason: "No SF9 Report Card or SF10 Permanent Record was included in this batch for this registered learner.",
          recommendedAction: "Upload the learner's SF9 progress report card to complete semestral grade validation.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 1: PSA ↔ SF1 (Civil Identity vs School Register)
    if (learner.psaRecord && learner.sf1Record) {
      const pRes = comparePsaAndSf1(learner.psaRecord.raw, learner.sf1Record.raw);
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const isCritical = d.severity === "CRITICAL";
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-psa-sf1-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "PSA Birth Certificate",
          source1Page: learner.psaRecord.pageNumber,
          source1FileName: learner.psaRecord.fileName,
          source1DataUrl: learner.psaRecord.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "SF1-SHS School Register",
          source2Page: learner.sf1Record.pageNumber,
          source2FileName: learner.sf1Record.fileName,
          source2DataUrl: learner.sf1Record.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: isCritical ? "MISMATCH" : "NEEDS_VERIFICATION",
          reason: d.description,
          recommendedAction: "Refer to school registrar for birth certificate civil identity verification (RA 10173).",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 2: SF1 ↔ SF2 (School Register vs Attendance)
    if (learner.sf1Record && learner.sf2Records.length > 0) {
      const pRes = compareSf1AndSf2(
        learner.sf1Record.raw,
        learner.sf2Records.map((r) => r.raw)
      );
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf1-sf2-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "SF1-SHS School Register",
          source1Page: learner.sf1Record.pageNumber,
          source1FileName: learner.sf1Record.fileName,
          source1DataUrl: learner.sf1Record.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "SF2-SHS Daily Attendance",
          source2Page: learner.sf2Records[0]?.pageNumber,
          source2FileName: learner.sf2Records[0]?.fileName,
          source2DataUrl: learner.sf2Records[0]?.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: d.severity === "CRITICAL" ? "MISMATCH" : "NEEDS_VERIFICATION",
          reason: d.description,
          recommendedAction: "Verify monthly attendance record and advise class adviser on attendance reconciliation.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 3: SF1 ↔ SF5A/SF5B (Enrollment vs Promotion)
    const activeSf5ForEnrollment = learner.sf5aRecord || learner.sf5bRecord || learner.sf5Record;
    if (learner.sf1Record && activeSf5ForEnrollment) {
      const pRes = compareSf1AndSf5(learner.sf1Record.raw, activeSf5ForEnrollment.raw);
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf1-sf5-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "SF1-SHS School Register",
          source1Page: learner.sf1Record.pageNumber,
          source1FileName: learner.sf1Record.fileName,
          source1DataUrl: learner.sf1Record.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "SF5-SHS Promotion Report",
          source2Page: activeSf5ForEnrollment.pageNumber,
          source2FileName: activeSf5ForEnrollment.fileName,
          source2DataUrl: activeSf5ForEnrollment.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: "MISMATCH",
          reason: d.description,
          recommendedAction: "Ensure all enrolled learners are accounted for in the end-of-semester promotion status.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 4: SF1 ↔ SF9 (School Register vs Report Card)
    if (learner.sf1Record && learner.sf9Record) {
      const sf9Data = learner.sf9Record.raw;
      const pRes = compareSf1AndSf9(learner.sf1Record.raw, {
        document_id: "doc-sf9",
        lrn: sf9Data.lrn,
        last_name: sf9Data.last_name,
        first_name: sf9Data.first_name,
        school_year: sf9Data.school_year,
        grade_level: sf9Data.grade_level,
        section: sf9Data.section,
        strand: sf9Data.strand || sf9Data.track_strand,
      });
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf1-sf9-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "SF1-SHS School Register",
          source1Page: learner.sf1Record.pageNumber,
          source1FileName: learner.sf1Record.fileName,
          source1DataUrl: learner.sf1Record.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "SF9-SHS Progress Report Card",
          source2Page: learner.sf9Record.pageNumber,
          source2FileName: learner.sf9Record.fileName,
          source2DataUrl: learner.sf9Record.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: d.severity === "CRITICAL" ? "MISMATCH" : "NEEDS_VERIFICATION",
          reason: d.description,
          recommendedAction: "Verify learner details on report card against official school register.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 5: SF9 ↔ SF10 (Report Card Grades vs Permanent Record)
    if (learner.sf9Record && learner.sf10Record) {
      const sf9Data = learner.sf9Record.raw;
      const sf10Data = learner.sf10Record.raw;

      const pRes = compareSf9AndSf10(
        {
          document_id: "doc-sf9",
          school_year: sf9Data.school_year || schoolYear,
          grade_level: sf9Data.grade_level || "Grade 11",
          semester: sf9Data.semester || "1st Semester",
          grades: (sf9Data.grades || []).map((g: any) => ({
            subject: g.subject,
            quarter1: g.q1,
            quarter2: g.q2,
            finalGrade: g.final,
          })),
          general_average: sf9Data.general_average,
        },
        {
          document_id: "doc-sf10",
          school_year: sf10Data.school_year || schoolYear,
          grade_level: sf10Data.grade_level || "Grade 11",
          semester: sf10Data.semester || "1st Semester",
          grades: (sf10Data.grades || []).map((g: any) => ({
            subject: g.subject,
            finalGrade: g.final,
          })),
          general_average: sf10Data.general_average,
        }
      );
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf9-sf10-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "SF9-SHS Report Card",
          source1Page: learner.sf9Record.pageNumber,
          source1FileName: learner.sf9Record.fileName,
          source1DataUrl: learner.sf9Record.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "SF10-SHS Permanent Transcript",
          source2Page: learner.sf10Record.pageNumber,
          source2FileName: learner.sf10Record.fileName,
          source2DataUrl: learner.sf10Record.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: "MISMATCH",
          reason: d.description,
          recommendedAction: "Cross-check physical Form 138 with teacher class record and update Form 137 accordingly.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 6: SF5A ↔ SF9 (Promotion Status vs Failing Grades)
    const activeSf5a = learner.sf5aRecord || learner.sf5Record;
    if (activeSf5a && learner.sf9Record) {
      const sf9Data = learner.sf9Record.raw;
      const pRes = compareSf5AndSf9(
        activeSf5a.raw,
        (sf9Data.grades || []).map((g: any) => ({
          subject: g.subject,
          finalGrade: g.final,
        })),
        "doc-sf9"
      );
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf5-sf9-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "SF5A-SHS Promotion Status",
          source1Page: activeSf5a.pageNumber,
          source1FileName: activeSf5a.fileName,
          source1DataUrl: activeSf5a.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "SF9-SHS Report Card",
          source2Page: learner.sf9Record.pageNumber,
          source2FileName: learner.sf9Record.fileName,
          source2DataUrl: learner.sf9Record.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: "MISMATCH",
          reason: d.description,
          recommendedAction: "Resolve promotion discrepancy with class adviser: failing grades require remedial classes or conditional status.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 7: SF5B ↔ SF10 (Graduation Clearance vs Back-Subjects)
    const activeSf5b = learner.sf5bRecord || learner.sf5Record;
    if (activeSf5b && learner.sf10Record && (learner.gradeLevel === "Grade 12" || gradeLevel === "Grade 12")) {
      const sf10Data = learner.sf10Record.raw;
      const pRes = compareSf5AndSf10(activeSf5b.raw, {
        document_id: "doc-sf10",
        completed_semesters: sf10Data.completed_semesters || [],
        has_unresolved_back_subjects: Boolean(sf10Data.has_unresolved_back_subjects),
        unresolved_subjects: sf10Data.unresolved_subjects || [],
      });
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf5-sf10-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "SF5B-SHS Graduation Candidate",
          source1Page: activeSf5b.pageNumber,
          source1FileName: activeSf5b.fileName,
          source1DataUrl: activeSf5b.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "SF10-SHS Permanent Transcript",
          source2Page: learner.sf10Record.pageNumber,
          source2FileName: learner.sf10Record.fileName,
          source2DataUrl: learner.sf10Record.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: "MISMATCH",
          reason: d.description,
          recommendedAction: "Graduation clearance requires all SHS curriculum deficiencies to be resolved on SF10.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

// Comparator 8: SF9 Observed Values Unreadable / Ambiguous Mark Inspection
    if (learner.sf9Record?.raw?.observed_values?.has_unreadable_marks) {
      const ov = learner.sf9Record.raw.observed_values;
      const unreadableObs = (ov.observations || []).filter((o: any) => o.needs_verification);
      for (const unreadable of unreadableObs) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf9-ov-${unreadable.quarter}-${(unreadable.behavior_statement || "").slice(0, 15).replace(/\s+/g, "_")}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: `Observed Value (${unreadable.core_value} - ${unreadable.quarter})`,
          source1Doc: "SF9-SHS Report Card",
          source1Page: unreadable.source_page || learner.sf9Record.pageNumber,
          source1FileName: learner.sf9Record.fileName,
          source1DataUrl: learner.sf9Record.dataUrl,
          source1Value: unreadable.original_mark ? `Unclear mark: "${unreadable.original_mark}"` : "Unreadable / Ambiguous mark",
          source2Doc: "DepEd Non-numerical Rating (AO, SO, RO, NO)",
          source2Page: undefined,
          source2FileName: undefined,
          source2DataUrl: undefined,
          source2Value: "AO / SO / RO / NO",
          severity: "WARNING",
          category: "NEEDS_VERIFICATION",
          reason: `Unreadable or ambiguous mark "${unreadable.original_mark}" detected for ${unreadable.core_value} (${unreadable.quarter}). DepEd SF9 requires official ratings AO, SO, RO, or NO.`,
          recommendedAction: "Teacher must inspect the original scanned report card and verify or correct the rating.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 8b: SF9 Attendance Discrepancies and Equation Mismatches
    if (learner.sf9Record?.raw?.attendance_discrepancy_details && Array.isArray(learner.sf9Record.raw.attendance_discrepancy_details)) {
      for (let i = 0; i < learner.sf9Record.raw.attendance_discrepancy_details.length; i++) {
        const detail = learner.sf9Record.raw.attendance_discrepancy_details[i];
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf9-att-${i + 1}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: "SF9 Attendance Consistency",
          source1Doc: "SF9-SHS Report Card",
          source1Page: learner.sf9Record.pageNumber,
          source1FileName: learner.sf9Record.fileName,
          source1DataUrl: learner.sf9Record.dataUrl,
          source1Value: detail,
          source2Doc: "Attendance Record Equation (Present + Absent = School Days / Total Sum)",
          source2Page: undefined,
          source2FileName: undefined,
          source2DataUrl: undefined,
          source2Value: "Consistent attendance records",
          severity: "WARNING",
          category: "NEEDS_VERIFICATION",
          reason: detail,
          recommendedAction: "Teacher must inspect the monthly attendance table on SF9 and verify days present, days absent, and school days.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 8c: SF9 High Absence Warning (DepEd Safeguard)
    if (learner.sf9Record?.raw?.attendance_risk_status === "ATTENDANCE_REVIEW_REQUIRED" || learner.sf9Record?.raw?.attendance_risk_status === "ATTENDANCE_WARNING") {
      const risk = learner.sf9Record.raw.attendance_risk_status;
      const absencePct = learner.sf9Record.raw.absence_percentage;
      const disc: BatchDiscrepancyItem = {
        id: `disc-${learnerDiscrepancies.length + 1}-sf9-att-risk`,
        learnerName: fullName,
        lrn: displayedLrn,
        field: "SF9 Attendance Risk Screening",
        source1Doc: "SF9-SHS Report Card",
        source1Page: learner.sf9Record.pageNumber,
        source1FileName: learner.sf9Record.fileName,
        source1DataUrl: learner.sf9Record.dataUrl,
        source1Value: `${risk} (${absencePct ?? "—"}% absences)`,
        source2Doc: "DepEd Order No. 8, s. 2015 Screening Threshold",
        source2Page: undefined,
        source2FileName: undefined,
        source2DataUrl: undefined,
        source2Value: "< 15% absences (Normal)",
        severity: "WARNING",
        category: "NEEDS_VERIFICATION",
        reason: risk === "ATTENDANCE_REVIEW_REQUIRED"
          ? `High absence rate (${absencePct}% absences) flagged on SF9. DepEd safeguard: Warning only. Academic grades and promotion are NOT automatically penalized. School head verification required.`
          : `Elevated absence rate (${absencePct}% absences) flagged on SF9. Early warning for class adviser intervention.`,
        recommendedAction: "Advise class adviser to verify attendance records with school guidance or attendance coordinator.",
      };
      learnerDiscrepancies.push(disc);
      allDiscrepancies.push(disc);
    }

    // UNIFIED VALIDATION: Execute ONE complete student-centered cross-document evaluation
    const unifiedResult = evaluateUnifiedStudentValidation({
      lrn: displayedLrn,
      fullName,
      schoolYear,
      gradeLevel: learner.gradeLevel || gradeLevel,
      section: learner.section || section,
      trackStrand: learner.trackStrand,
      psa: learner.psaRecord,
      sf1: learner.sf1Record,
      sf2Records: learner.sf2Records,
      sf5a: learner.sf5aRecord,
      sf5b: learner.sf5bRecord,
      sf9: learner.sf9Record,
      sf10: learner.sf10Record,
      duplicateWarnings: learner.duplicateWarnings,
    });

    // Merge unified discrepancies into batch discrepancy lists if not already recorded
    for (const ud of unifiedResult.discrepancies) {
      // Skip duplicate scan warnings here; they are registered with rich file-level metadata below
      if (ud.field.startsWith("duplicate_")) continue;

      const alreadyExists = learnerDiscrepancies.some(
        (ld) =>
          ld.field.toLowerCase() === ud.field.toLowerCase() ||
          ld.reason.toLowerCase() === ud.description.toLowerCase()
      );
      if (!alreadyExists) {
        const isCritical = ud.severity === "CRITICAL";
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-unified-${ud.field.replace(/[^a-zA-Z0-9]/g, "_")}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: ud.field,
          source1Doc: "Cross-Document Matrix",
          source1Value: ud.sourceValue,
          source2Doc: "Referenced DepEd Document",
          source2Value: ud.targetValue,
          severity: ud.severity === "CRITICAL" ? "CRITICAL" : (ud.severity === "WARNING" ? "WARNING" : "INFO"),
          category: isCritical ? "MISMATCH" : ((ud as any).category === "NEEDS_VERIFICATION" ? "NEEDS_VERIFICATION" : "MISMATCH"),
          reason: ud.description,
          recommendedAction: "Review unified cross-document matrix and inspect original scanned forms.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Record duplicate scan alerts into batch discrepancy items
    for (const dup of learner.duplicateWarnings) {
      const isCritical = dup.severity === "CRITICAL";
      const disc: BatchDiscrepancyItem = {
        id: `disc-${learnerDiscrepancies.length + 1}-dup-${dup.documentType.replace(/[^a-zA-Z0-9]/g, "_")}`,
        learnerName: fullName,
        lrn: displayedLrn,
        field: `Duplicate Scan (${dup.documentType})`,
        source1Doc: dup.existingSource,
        source1Value: dup.isIdentical ? "ORIGINAL_SCAN" : "ORIGINAL_VALUES",
        source2Doc: dup.newSource,
        source2Value: dup.isIdentical ? "DUPLICATE_SCAN" : "CONFLICTING_VALUES",
        severity: isCritical ? "CRITICAL" : (dup.severity === "INFO" ? "INFO" : "WARNING"),
        category: isCritical ? "MISMATCH" : "NEEDS_VERIFICATION",
        reason: dup.details,
        recommendedAction: dup.isIdentical
          ? "Safe duplicate scan detected. Original document preserved."
          : "Conflicting duplicate scan detected. Teacher must inspect both scanned pages and confirm the valid document.",
      };
      learnerDiscrepancies.push(disc);
      allDiscrepancies.push(disc);
    }

    // Determine overall learner status
    const hasCritical = learnerDiscrepancies.some((d) => d.severity === "CRITICAL") || unifiedResult.overallStatus === "MISMATCH";
    const hasWarning = learnerDiscrepancies.some((d) => d.severity === "WARNING" || d.category === "NEEDS_VERIFICATION");
    const hasMissingDocs = learnerDiscrepancies.some((d) => d.category === "MISSING_DOC");

    let overallStatus: LearnerValidationDossier["overallStatus"] = "MATCH";
    if (hasCritical) {
      overallStatus = "MISMATCH";
    } else if (docPresence.totalAvailable < 2 || unifiedResult.overallStatus === "NOT_APPLICABLE") {
      overallStatus = "INCOMPLETE";
    } else if (hasWarning || hasMissingDocs || unifiedResult.overallStatus === "NEEDS_VERIFICATION") {
      overallStatus = "NEEDS_REVIEW";
    }

    dossiers.push({
      lrn: displayedLrn,
      fullName: fullName || "Unnamed Learner",
      lastName: learner.lastName,
      firstName: learner.firstName,
      middleName: learner.middleName,
      sex: learner.sex,
      birthDate: learner.birthDate,
      gradeLevel: learner.gradeLevel,
      section: learner.section,
      trackStrand: learner.trackStrand,
      overallStatus,
      documentPresence: docPresence,
      matchedSources: {
        sf1: learner.sf1Record,
        sf2: learner.sf2Records[0],
        sf5: learner.sf5aRecord || learner.sf5bRecord || learner.sf5Record,
        sf5a: learner.sf5aRecord,
        sf5b: learner.sf5bRecord,
        sf9: learner.sf9Record,
        sf10: learner.sf10Record,
        psa: learner.psaRecord,
      },
      allSf2Records: learner.allSf2Records,
      allSf9Records: learner.allSf9Records,
      allSf10Records: learner.allSf10Records,
      pairwiseResults,
      discrepancies: learnerDiscrepancies,
      unifiedMatrix: unifiedResult.fieldsMatrix,
      duplicateWarnings: learner.duplicateWarnings,
    });
  }

  // 4. Categorize findings into the 6 canonical categories
  const successfullyMatched = dossiers.filter((d) => d.overallStatus === "MATCH" && d.documentPresence.totalAvailable >= 2);
  const consistentRecords = dossiers.filter((d) => d.discrepancies.filter((x) => x.severity === "CRITICAL").length === 0);
  const mismatchedInformation = allDiscrepancies.filter((d) => d.category === "MISMATCH");
  const missingDocuments = allDiscrepancies.filter((d) => d.category === "MISSING_DOC");
  const incompleteData = allDiscrepancies.filter((d) => d.category === "INCOMPLETE_DATA");
  const needsManualVerification = allDiscrepancies.filter((d) => d.category === "NEEDS_VERIFICATION");

  return {
    batchId,
    schoolYear,
    gradeLevel,
    section,
    summary: {
      totalLearnersDetected: dossiers.length,
      successfullyMatchedCount: successfullyMatched.length,
      consistentRecordsCount: consistentRecords.length,
      mismatchedInformationCount: mismatchedInformation.length,
      missingDocumentsCount: missingDocuments.length,
      incompleteDataCount: incompleteData.length,
      needsManualVerificationCount: needsManualVerification.length,
    },
    categorizedResults: {
      successfullyMatched,
      consistentRecords,
      mismatchedInformation,
      missingDocuments,
      incompleteData,
      needsManualVerification,
    },
    learnerDossiers: dossiers,
    segments,
    validationSource: "COMPUTED_PREVIEW",
  };
}

/**
 * Rebuilds batch discrepancy categories and summary metrics strictly from persisted validation results.
 * This guarantees a single source of truth across the validation engine, database rows, and batch UI.
 *
 * Learners with invalid LRNs (which cannot be persisted to canonical student tables) are explicitly
 * categorized as REQUIRES_IDENTITY_RESOLUTION and stripped of computed-only cross-document matrices,
 * while their extracted document data is preserved.
 */
export function rebuildBatchValidationReportFromPersistedResults(
  report: BatchValidationReport
): BatchValidationReport {
  const allDiscrepancies: BatchDiscrepancyItem[] = [];

  for (const dossier of report.learnerDossiers) {
    if (dossier.validationPersistence?.status === "PERSISTED") {
      // Rebuild dossier.discrepancies from persisted validation data
      const persistedItems = Array.isArray(dossier.persistedDiscrepancies)
        ? dossier.persistedDiscrepancies
        : [];
      const priorDiscrepancies = dossier.discrepancies || [];

      const reconstructed: BatchDiscrepancyItem[] = [];

      for (let i = 0; i < persistedItems.length; i++) {
        const item = persistedItems[i];
        const match = priorDiscrepancies.find(
          (d) => d.field.toLowerCase() === item.field.toLowerCase() || d.reason === item.description
        );

        let category: BatchDiscrepancyItem["category"] = "MISMATCH";
        if (item.category === "NEEDS_VERIFICATION") {
          category = "NEEDS_VERIFICATION";
        } else if (item.severity === "CRITICAL" || item.severity === "ERROR") {
          category = "MISMATCH";
        } else if (item.severity === "WARNING" || item.severity === "INFO") {
          category = "NEEDS_VERIFICATION";
        }

        const disc: BatchDiscrepancyItem = {
          id: match?.id || `disc-persisted-${dossier.lrn}-${i + 1}-${item.field.replace(/[^a-zA-Z0-9]/g, "_")}`,
          learnerName: dossier.fullName,
          lrn: dossier.lrn,
          field: item.field,
          source1Doc: match?.source1Doc || "Unified Cross-Document Matrix",
          source1Page: match?.source1Page,
          source1FileName: match?.source1FileName,
          source1DataUrl: match?.source1DataUrl,
          source1Value: item.sourceValue ?? match?.source1Value,
          source2Doc: match?.source2Doc || "Database Record",
          source2Page: match?.source2Page,
          source2FileName: match?.source2FileName,
          source2DataUrl: match?.source2DataUrl,
          source2Value: item.targetValue ?? match?.source2Value,
          severity: (item.severity as any) || match?.severity || "WARNING",
          category,
          reason: item.description || match?.reason || "Field discrepancy verified from database record.",
          recommendedAction: match?.recommendedAction || "Inspect physical documents and reconcile discrepancies.",
        };
        reconstructed.push(disc);
        allDiscrepancies.push(disc);
      }
      dossier.discrepancies = reconstructed;
    } else if (dossier.validationPersistence?.status === "REQUIRES_IDENTITY_RESOLUTION") {
      dossier.unifiedMatrix = [];
      dossier.discrepancies = [
        {
          id: `disc-identity-resolution-${dossier.lrn}`,
          learnerName: dossier.fullName,
          lrn: dossier.lrn,
          field: "Learner Reference Number (LRN)",
          source1Doc: "Extracted Record",
          source1Value: dossier.lrn,
          source2Doc: "DepEd 12-Digit LRN Standard",
          source2Value: "12-digit numeric LRN",
          severity: "CRITICAL",
          category: "INCOMPLETE_DATA",
          reason: dossier.validationPersistence.reason || "Missing or invalid 12-digit LRN prevents database persistence and canonical student linking.",
          recommendedAction: dossier.validationPersistence.recommendedAction || "Resolve learner identity manually by inspecting original scanned document and assigning a valid 12-digit LRN.",
        },
      ];
      allDiscrepancies.push(...dossier.discrepancies);
    }
  }

  // Re-categorize report
  const successfullyMatched = report.learnerDossiers.filter(
    (d) => d.overallStatus === "MATCH" && d.documentPresence.totalAvailable >= 2 && d.validationPersistence?.status === "PERSISTED"
  );
  const consistentRecords = report.learnerDossiers.filter(
    (d) => d.discrepancies.filter((x) => x.severity === "CRITICAL").length === 0 && d.validationPersistence?.status === "PERSISTED"
  );
  const mismatchedInformation = allDiscrepancies.filter((d) => d.category === "MISMATCH");
  const missingDocuments = allDiscrepancies.filter((d) => d.category === "MISSING_DOC");
  const incompleteData = allDiscrepancies.filter((d) => d.category === "INCOMPLETE_DATA");
  const needsManualVerification = allDiscrepancies.filter((d) => d.category === "NEEDS_VERIFICATION");
  const requiresIdentityResolution = report.learnerDossiers.filter(
    (d) => d.validationPersistence?.status === "REQUIRES_IDENTITY_RESOLUTION"
  );

  report.validationSource = "PERSISTED";
  report.summary = {
    ...report.summary,
    totalLearnersDetected: report.learnerDossiers.length,
    successfullyMatchedCount: successfullyMatched.length,
    consistentRecordsCount: consistentRecords.length,
    mismatchedInformationCount: mismatchedInformation.length,
    missingDocumentsCount: missingDocuments.length,
    incompleteDataCount: incompleteData.length,
    needsManualVerificationCount: needsManualVerification.length,
    persistedValidationCount: report.learnerDossiers.filter((d) => d.validationPersistence?.status === "PERSISTED").length,
    identityResolutionRequiredCount: requiresIdentityResolution.length,
  };

  report.categorizedResults = {
    successfullyMatched,
    consistentRecords,
    mismatchedInformation,
    missingDocuments,
    incompleteData,
    needsManualVerification,
    requiresIdentityResolution,
  };

  return report;
}

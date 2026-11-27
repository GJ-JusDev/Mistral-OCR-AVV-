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
  compareSf10AndSf1,
  compareSf10AndSf9,
  compareSf10AndPsa,
  compareSf5AndSf9,
  compareSf5AndSf10,
  evaluateUnifiedStudentValidation,
  normalizeAttendanceMonthKey,
  parseNameParts,
  type PairwiseValidationResult,
  type DiscrepancyItem,
  type UnifiedFieldComparisonRow,
  type DuplicateScanWarning,
  type UnifiedStudentValidationOutcome,
} from "./crossDocumentEngine";
import { normalizeLrn, isValidLrn, normalizeSex } from "./patterns";
import { normalizeNamePart, normalizeDate } from "./nameComparison";
import { normalizeStrictSex, validateConsecutiveSchoolYear } from "./gradeUtils";
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

    // 1. Direct match by valid 12-digit LRN
    if (cleanLrn && learnersMap.has(cleanLrn)) {
      const learner = learnersMap.get(cleanLrn)!;
      if (!learner.lastName && candidateName?.lastName) learner.lastName = candidateName.lastName;
      if (!learner.firstName && candidateName?.firstName) learner.firstName = candidateName.firstName;
      if (!learner.middleName && candidateName?.middleName) learner.middleName = candidateName.middleName;
      return learner;
    }

    if (candidateName) {
      if (!candidateName.firstName && candidateName.lastName) {
        const p = parseNameParts(candidateName.lastName);
        if (p.lastName && p.firstName) {
          candidateName.lastName = p.lastName;
          candidateName.firstName = p.firstName;
          if (!candidateName.middleName) candidateName.middleName = p.middleName;
        }
      }
    }

    // 2. Fallback match by exact Last Name and First Name across document segments (e.g. SF2/PSA without LRN or conflicting LRN)
    const cLast = normalizeNamePart(candidateName?.lastName);
    const cFirst = normalizeNamePart(candidateName?.firstName);
    if (cLast && cFirst) {
      for (const cand of learnersMap.values()) {
        const candLast = normalizeNamePart(cand.lastName);
        const candFirst = normalizeNamePart(cand.firstName);
        if (
          (candLast === cLast && candFirst === cFirst) ||
          (candLast === cLast && (candFirst.includes(cFirst) || cFirst.includes(candFirst)))
        ) {
          if (cleanLrn && !cand.lrn) {
            cand.lrn = cleanLrn;
          }
          if (!cand.middleName && candidateName?.middleName) {
            cand.middleName = candidateName.middleName;
          }
          return cand;
        }
      }
    }

    // 3. Create a new learner record
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

  const allDiscrepancies: BatchDiscrepancyItem[] = [];

  // 2. Ingest extracted records from each segment
  for (const seg of segments) {
    const data = extractedSegmentData[seg.id] || {};
    const pageNum = seg.pageNumbers?.[0] ?? (seg as any).pageRange?.[0] ?? 1;
    const segFileName = seg.sourceFileName || seg.pages?.[0]?.sourceFileName;
    const segDataUrl = seg.imageUrl || seg.pages?.[0]?.sourceFileDataUrl;

    // SF1 School Register
    if (seg.documentType === "sf1") {
      const learners = Array.isArray(data.learners) ? data.learners : [];
      if (learners.length === 0) {
        const noStudentDisc: BatchDiscrepancyItem = {
          id: `disc-${allDiscrepancies.length + 1}-sf1-no-student-found`,
          learnerName: "No student found",
          lrn: "N/A",
          field: "School Register (SF1-SHS) Roster",
          source1Doc: "SF1-SHS School Register",
          source1Page: pageNum,
          source1FileName: segFileName,
          source1DataUrl: segDataUrl,
          source1Value: "No student found",
          source2Doc: "DepEd SF1 Master Roster",
          source2Value: "Populated Learner Row(s)",
          severity: "CRITICAL",
          category: "INCOMPLETE_DATA",
          reason: "No student found: Uploaded SF1 has empty LRN and Name rows or no valid student records were detected.",
          recommendedAction: "Upload or scan an official SF1 School Register containing populated learner LRN, Name, Sex, and Birth Date rows.",
        };
        allDiscrepancies.push(noStudentDisc);
      } else {
        for (const item of learners) {
          const l = getOrCreateLearner(
            item.lrn,
            { lastName: item.last_name || item.lastName, firstName: item.first_name || item.firstName, middleName: item.middle_name || item.middleName },
            "sf1"
          );
          l.lastName = item.last_name || item.lastName || l.lastName;
          l.firstName = item.first_name || item.firstName || l.firstName;
          l.middleName = item.middle_name || item.middleName || l.middleName;
          l.sex = normalizeStrictSex(item.sex) || l.sex;
          l.birthDate = item.birth_date || item.birthDate || l.birthDate;
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
    }

    // SF2 Daily Attendance Report (Preserves multiple months, flags duplicate scans for same month)
    if (
      seg.documentType === "sf2" &&
      (Array.isArray(data.attendance_records) || Array.isArray(data.attendance) || Array.isArray(data.learners))
    ) {
      const records = data.attendance_records || data.attendance || data.learners;
      const segMonth = data.month || data.header?.month || data.attendance_summary?.month || "June";
      for (const item of records) {
        const rawName = item.learner_name || item.student_name || item.name || "";
        const parsed = parseNameParts(rawName);
        const l = getOrCreateLearner(
          item.lrn,
          {
            lastName: item.last_name || item.lastName || parsed.lastName,
            firstName: item.first_name || item.firstName || parsed.firstName,
            middleName: item.middle_name || item.middleName || parsed.middleName,
            fullName: rawName,
          },
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

    // SF5 / SF5A / SF5B Promotion & Graduation Candidate Report
    if (
      (seg.documentType === "sf5" || seg.documentType === "sf5a" || seg.documentType === "sf5b") &&
      Array.isArray(data.learners)
    ) {
      const isSf5b = seg.documentType === "sf5b" || String(data.form_variant || "").toUpperCase().includes("SF5B");
      for (const item of data.learners) {
        const l = getOrCreateLearner(
          item.lrn,
          { lastName: item.last_name, firstName: item.first_name, middleName: item.middle_name },
          seg.documentType
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
            graduation_status:
              item.action_taken === "GRADUATING" || item.graduation_status
                ? item.graduation_status || item.action_taken
                : undefined,
          },
        };
        if (isSf5b) {
          l.sf5bRecord = newRec;
          l.allSf5bRecords.push(newRec);
        } else {
          l.sf5aRecord = newRec;
          l.allSf5aRecords.push(newRec);
        }
        l.sf5Record = newRec;
      }
    }

    // SF9 Progress Report Card
    if (seg.documentType === "sf9") {
      const sf9Learner = data.learner || data;
      const l = getOrCreateLearner(
        sf9Learner.lrn || data.lrn,
        { lastName: sf9Learner.lastName || sf9Learner.last_name || data.last_name, firstName: sf9Learner.firstName || sf9Learner.first_name || data.first_name, middleName: sf9Learner.middleName || sf9Learner.middle_name || data.middle_name },
        "sf9"
      );
      const newRec = {
        pageNumber: pageNum,
        fileName: data.source_file_name || segFileName,
        dataUrl: data.source_file_data_url || segDataUrl,
        documentId: seg.id,
        raw: sf9Learner,
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
      const sf10Learner = data.learner || data;
      const l = getOrCreateLearner(
        sf10Learner.lrn || data.lrn,
        { lastName: sf10Learner.lastName || sf10Learner.last_name || data.last_name, firstName: sf10Learner.firstName || sf10Learner.first_name || data.first_name, middleName: sf10Learner.middleName || sf10Learner.middle_name || data.middle_name },
        "sf10"
      );
      const newRec = {
        pageNumber: pageNum,
        fileName: data.source_file_name || segFileName,
        dataUrl: data.source_file_data_url || segDataUrl,
        documentId: seg.id,
        raw: sf10Learner,
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
    if (seg.documentType === "birth_cert" || (seg.documentType as string) === "psa") {
      const psaId = data.identity || data.candidate || data;
      let l: any = undefined;
      const cleanLrn = normalizeLrn(data.lrn || psaId.lrn);
      if (isValidLrn(cleanLrn) && learnersMap.has(cleanLrn)) {
        l = learnersMap.get(cleanLrn);
      } else {
        // Match civil identity name against existing SF1/academic learners in batch
        const psaLast = normalizeNamePart(psaId.last_name || psaId.lastName);
        const psaFirst = normalizeNamePart(psaId.first_name || psaId.firstName);
        if (psaLast && psaFirst) {
          for (const cand of learnersMap.values()) {
            if (
              normalizeNamePart(cand.lastName) === psaLast &&
              normalizeNamePart(cand.firstName) === psaFirst
            ) {
              l = cand;
              break;
            }
          }
        }
      }

      if (!l) {
        l = getOrCreateLearner(
          data.lrn || psaId.lrn,
          { lastName: psaId.last_name || psaId.lastName, firstName: psaId.first_name || psaId.firstName, middleName: psaId.middle_name || psaId.middleName },
          "birth_cert"
        );
      }
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

  for (const [lrnKey, learner] of learnersMap.entries()) {
    const fullName = [learner.lastName, learner.firstName].filter(Boolean).join(", ") +
      (learner.middleName ? ` ${learner.middleName}` : "");
    const displayedLrn = learner.lrn || lrnKey;

    const isSf9FrontOnly = Boolean(
      learner.sf9Record &&
      (!Array.isArray(learner.sf9Record.raw?.grades) || learner.sf9Record.raw.grades.length === 0) &&
      (learner.sf9Record.raw?.general_average === undefined || learner.sf9Record.raw?.general_average === null)
    );
    const hasCompleteSf9 = Boolean(learner.sf9Record && !isSf9FrontOnly && !learner.sf9Record.raw?.identity_conflict);

    const docPresence = {
      sf1: Boolean(learner.sf1Record),
      sf2: learner.sf2Records.length > 0,
      sf5: Boolean(learner.sf5Record || learner.sf5aRecord || learner.sf5bRecord),
      sf5a: Boolean(learner.sf5aRecord),
      sf5b: Boolean(learner.sf5bRecord),
      sf9: hasCompleteSf9,
      sf10: Boolean(learner.sf10Record),
      psa: Boolean(learner.psaRecord),
      sf2MonthsCount: learner.sf2Records.length,
      totalAvailable: [
        Boolean(learner.sf1Record),
        learner.sf2Records.length > 0,
        Boolean(learner.sf5aRecord || (!learner.sf5bRecord && learner.sf5Record)),
        Boolean(learner.sf5bRecord),
        hasCompleteSf9,
        Boolean(learner.sf10Record),
        Boolean(learner.psaRecord),
      ].filter(Boolean).length,
    };

    const pairwiseResults: PairwiseValidationResult[] = [];
    const learnerDiscrepancies: BatchDiscrepancyItem[] = [];

    // Check for Incomplete SF9 Pairs: Front-only (has identity/LRN but no back page / grades)
    if (isSf9FrontOnly) {
      const disc: BatchDiscrepancyItem = {
        id: `disc-${learnerDiscrepancies.length + 1}-missing-sf9-back`,
        learnerName: fullName || "Learner with SF9 Front Only",
        lrn: displayedLrn,
        field: "Progress Report Card (SF9-SHS)",
        source1Doc: "SF9-SHS Front / Identity",
        source1Page: learner.sf9Record?.pageNumber,
        source1FileName: learner.sf9Record?.fileName,
        source1DataUrl: learner.sf9Record?.dataUrl,
        source1Value: "FRONT ONLY (NO GRADES)",
        source2Doc: "SF9-SHS Back / Grades Side",
        source2Value: "NOT FOUND IN BATCH",
        severity: "WARNING",
        category: "MISSING_DOC",
        reason: "Missing SF9 Back Page / Grades: Learner has an SF9 front identity page but no back page or subject grades were found in this batch.",
        recommendedAction: "Upload or scan the back side (Grades and Attendance) of the learner's SF9 report card.",
      };
      learnerDiscrepancies.push(disc);
      allDiscrepancies.push(disc);
    }

    // Check for Incomplete SF9 Pairs: Back-only (has grades/attendance but no 12-digit LRN / UNREGISTERED)
    if (!isValidLrn(learner.lrn) && learner.sf9Record) {
      const disc: BatchDiscrepancyItem = {
        id: `disc-${learnerDiscrepancies.length + 1}-unmatched-sf9-back`,
        learnerName: fullName || "Unmatched Student (SF9 Back Page Only)",
        lrn: displayedLrn,
        field: "Progress Report Card (SF9-SHS)",
        source1Doc: "SF9-SHS Back Side",
        source1Page: learner.sf9Record?.pageNumber,
        source1FileName: learner.sf9Record?.fileName,
        source1DataUrl: learner.sf9Record?.dataUrl,
        source1Value: "BACK ONLY (GRADES WITHOUT LRN)",
        source2Doc: "SF9-SHS Front / Identity Side",
        source2Value: "NOT FOUND IN BATCH",
        severity: "CRITICAL",
        category: "NEEDS_VERIFICATION",
        reason: "Unmatched SF9 Back Page — Missing Front Page / LRN: Back page contains subject grades and attendance but no 12-digit LRN or front identity header was found to associate it with a student.",
        recommendedAction: "Upload or pair the corresponding SF9 front side containing the learner's LRN and official name.",
      };
      learnerDiscrepancies.push(disc);
      allDiscrepancies.push(disc);
    }

    // Check for Mismatched SF9 Front/Back Identity Conflict
    if (learner.sf9Record?.raw?.identity_conflict) {
      const disc: BatchDiscrepancyItem = {
        id: `disc-${learnerDiscrepancies.length + 1}-sf9-identity-conflict`,
        learnerName: fullName || "Learner with SF9 Identity Conflict",
        lrn: displayedLrn,
        field: "SF9 Identity Pairing",
        source1Doc: "SF9-SHS Front Side",
        source1Page: learner.sf9Record?.pageNumber,
        source1FileName: learner.sf9Record?.fileName,
        source1DataUrl: learner.sf9Record?.dataUrl,
        source1Value: "IDENTITY CONFLICT DETECTED",
        source2Doc: "SF9-SHS Back Side",
        source2Value: "MISMATCHED LEARNER",
        severity: "CRITICAL",
        category: "MISMATCH",
        reason: `Mismatched SF9 Front/Back: ${((learner.sf9Record.raw.identity_conflicts || []) as string[]).join("; ") || "Conflicting learner identity detected between sides."}`,
        recommendedAction: "Verify physical card images. Ensure Learner A's front page is not attached to Learner B's back page.",
      };
      learnerDiscrepancies.push(disc);
      allDiscrepancies.push(disc);
    }

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
        if (d.field === "mother_maiden_name" || d.field === "mother_name" || (typeof d.field === "string" && d.field.toLowerCase().includes("mother"))) continue;
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

    // Comparator 4: SF1 ↔ SF9 (School Register vs Report Card)
    if (learner.sf1Record && learner.sf9Record) {
      const sf9Data = learner.sf9Record.raw;
      const pRes = compareSf1AndSf9(learner.sf1Record.raw, {
        document_id: "doc-sf9",
        lrn: sf9Data.lrn,
        last_name: sf9Data.last_name,
        first_name: sf9Data.first_name,
        sex: normalizeStrictSex(sf9Data.sex) || normalizeStrictSex(sf9Data.gender) || undefined,
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

    // Comparator 5: SF10 ↔ SF9 (identity, scholastic context, per-semester grades & general averages)
    if (learner.sf9Record && learner.sf10Record) {
      const sf9Data = learner.sf9Record.raw || {};
      const sf10Data = learner.sf10Record.raw || {};

      const pRes = compareSf10AndSf9(
        { ...sf10Data, document_id: learner.sf10Record.documentId || "doc-sf10", school_year: sf10Data.school_year || schoolYear },
        { ...sf9Data, document_id: learner.sf9Record.documentId || "doc-sf9", school_year: sf9Data.school_year || schoolYear, sex: normalizeStrictSex(sf9Data.sex) || normalizeStrictSex(sf9Data.gender) || undefined, track_strand: sf9Data.track_strand || sf9Data.strand }
      );
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf10-sf9-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "SF10-SHS Permanent Transcript",
          source1Page: learner.sf10Record.pageNumber,
          source1FileName: learner.sf10Record.fileName,
          source1DataUrl: learner.sf10Record.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "SF9-SHS Report Card",
          source2Page: learner.sf9Record.pageNumber,
          source2FileName: learner.sf9Record.fileName,
          source2DataUrl: learner.sf9Record.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: d.severity === "CRITICAL" ? "MISMATCH" : "NEEDS_VERIFICATION",
          reason: d.description,
          recommendedAction: "Cross-check physical Form 138 with teacher class record and update Form 137 accordingly.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 9: SF10 ↔ SF1 (LRN, Full Name, Sex, normalized Birth Date)
    if (learner.sf10Record && learner.sf1Record) {
      const pRes = compareSf10AndSf1(
        { ...(learner.sf10Record.raw || {}), document_id: learner.sf10Record.documentId || "doc-sf10" },
        { ...(learner.sf1Record.raw || {}), document_id: (learner.sf1Record as any).documentId || "doc-sf1" }
      );
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf10-sf1-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "SF10-SHS Permanent Transcript",
          source1Page: learner.sf10Record.pageNumber,
          source1FileName: learner.sf10Record.fileName,
          source1DataUrl: learner.sf10Record.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "SF1-SHS School Register",
          source2Page: learner.sf1Record.pageNumber,
          source2FileName: learner.sf1Record.fileName,
          source2DataUrl: learner.sf1Record.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: d.severity === "CRITICAL" ? "MISMATCH" : "NEEDS_VERIFICATION",
          reason: d.description,
          recommendedAction: "Reconcile SF10 learner's information with the official SF1 school register entry.",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
    }

    // Comparator 10: SF10 ↔ PSA (civil identity ONLY: Full Name, Sex, Birth Date — PSA has no LRN)
    if (learner.sf10Record && learner.psaRecord) {
      const psaRaw = { ...(learner.psaRecord.raw || {}) };
      delete (psaRaw as any).lrn;
      const pRes = compareSf10AndPsa(
        { ...(learner.sf10Record.raw || {}), document_id: learner.sf10Record.documentId || "doc-sf10" },
        { ...psaRaw, document_id: (learner.psaRecord as any).documentId || "doc-psa" }
      );
      pairwiseResults.push(pRes);
      for (const d of pRes.discrepancies) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sf10-psa-${d.field}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: d.field,
          source1Doc: "SF10-SHS Permanent Transcript",
          source1Page: learner.sf10Record.pageNumber,
          source1FileName: learner.sf10Record.fileName,
          source1DataUrl: learner.sf10Record.dataUrl,
          source1Value: d.sourceValue,
          source2Doc: "PSA Birth Certificate",
          source2Page: learner.psaRecord.pageNumber,
          source2FileName: learner.psaRecord.fileName,
          source2DataUrl: learner.psaRecord.dataUrl,
          source2Value: d.targetValue,
          severity: d.severity,
          category: d.severity === "CRITICAL" ? "MISMATCH" : "NEEDS_VERIFICATION",
          reason: d.description,
          recommendedAction: "Refer to school registrar for birth certificate civil identity verification (RA 10173).",
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

    // Comparator 8d: DepEd School Year Consecutive Format Validation (YYYY-(YYYY+1))
    const syCandidates: { doc: string; sy: string | undefined; page?: number; fileName?: string; dataUrl?: string }[] = [];
    if (learner.sf9Record?.raw?.school_year) {
      syCandidates.push({ doc: "SF9-SHS Report Card", sy: learner.sf9Record.raw.school_year, page: learner.sf9Record.pageNumber, fileName: learner.sf9Record.fileName, dataUrl: learner.sf9Record.dataUrl });
    }
    if (learner.sf1Record?.raw?.school_year) {
      syCandidates.push({ doc: "SF1-SHS School Register", sy: learner.sf1Record.raw.school_year, page: learner.sf1Record.pageNumber, fileName: learner.sf1Record.fileName, dataUrl: learner.sf1Record.dataUrl });
    }
    if (learner.sf10Record?.raw?.school_year) {
      syCandidates.push({ doc: "SF10-SHS Permanent Transcript", sy: learner.sf10Record.raw.school_year, page: learner.sf10Record.pageNumber, fileName: learner.sf10Record.fileName, dataUrl: learner.sf10Record.dataUrl });
    }
    for (const sf2 of learner.sf2Records) {
      if (sf2.raw?.school_year) {
        syCandidates.push({ doc: "SF2-SHS Daily Attendance", sy: sf2.raw.school_year, page: sf2.pageNumber, fileName: sf2.fileName, dataUrl: sf2.dataUrl });
      }
    }
    for (const cand of syCandidates) {
      const syVal = validateConsecutiveSchoolYear(cand.sy);
      if (!syVal.isValid) {
        const disc: BatchDiscrepancyItem = {
          id: `disc-${learnerDiscrepancies.length + 1}-sy-nonconsecutive-${cand.doc.slice(0, 4)}`,
          learnerName: fullName,
          lrn: displayedLrn,
          field: "School Year Format / Sequence",
          source1Doc: cand.doc,
          source1Page: cand.page,
          source1FileName: cand.fileName,
          source1DataUrl: cand.dataUrl,
          source1Value: cand.sy,
          source2Doc: "DepEd School Year Consecutive Format (YYYY-(YYYY+1))",
          source2Page: undefined,
          source2FileName: undefined,
          source2DataUrl: undefined,
          source2Value: "Consecutive School Year (e.g. 2025-2026)",
          severity: "CRITICAL",
          category: "MISMATCH",
          reason: syVal.reason || `Non-consecutive School Year "${cand.sy}" detected on ${cand.doc}. DepEd requires consecutive years YYYY-(YYYY+1).`,
          recommendedAction: "Correct school year to DepEd consecutive year format YYYY-(YYYY+1) (e.g. 2025-2026).",
        };
        learnerDiscrepancies.push(disc);
        allDiscrepancies.push(disc);
      }
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
      if (ud.field === "mother_maiden_name" || ud.field === "mother_name" || (typeof ud.field === "string" && ud.field.toLowerCase().includes("mother"))) continue;
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
        sf5: learner.sf5Record,
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
      unifiedMatrix: (() => {
        const seenMonths = new Set<string>();
        return (unifiedResult.fieldsMatrix || [])
          .filter((row) => row.field !== "mother_maiden_name" && row.label !== "Mother's Maiden Name")
          .filter((row) => {
            if (row.category === "ATTENDANCE" || row.field.startsWith("attendance_")) {
              const mKey = normalizeAttendanceMonthKey(row.field.replace(/^attendance_/, "") || row.label || "");
              if (mKey && mKey !== "total" && mKey !== "annual_summary") {
                if (seenMonths.has(mKey)) return false;
                seenMonths.add(mKey);
              }
            }
            return true;
          });
      })(),
      duplicateWarnings: learner.duplicateWarnings,
    });
  }

  // Fallback dossier when no valid learners were extracted (e.g. empty SF1 sheet)
  if (dossiers.length === 0 && allDiscrepancies.some((d) => d.reason.includes("No student found"))) {
    dossiers.push({
      lrn: "N/A",
      fullName: "No student found",
      lastName: "No student found",
      firstName: "",
      gradeLevel,
      section,
      overallStatus: "INCOMPLETE",
      documentPresence: {
        sf1: true,
        sf2: false,
        sf5: false,
        sf5a: false,
        sf5b: false,
        sf9: false,
        sf10: false,
        psa: false,
        sf2MonthsCount: 0,
        totalAvailable: 1,
      },
      matchedSources: {},
      allSf2Records: [],
      allSf9Records: [],
      allSf10Records: [],
      pairwiseResults: [],
      discrepancies: allDiscrepancies,
      unifiedMatrix: [],
      duplicateWarnings: [],
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
      // Preserve existing computed unifiedMatrix if present so teachers can review the cross-document matrix
      if (!dossier.unifiedMatrix) {
        dossier.unifiedMatrix = [];
      }
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

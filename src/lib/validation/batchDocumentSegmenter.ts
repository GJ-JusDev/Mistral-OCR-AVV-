/**
 * AVV System — Multi-Page Document Classifier & Boundary Segmenter
 *
 * Automatically inspects the pages of a combined PDF or batch upload,
 * identifies document boundaries, classifies pages into DepEd SHS form categories,
 * and organizes them into document segments for extraction.
 *
 * Supported Forms:
 * - SF1-SHS — School Register
 * - SF2-SHS — Daily Attendance Report
 * - SF5A-SHS — End of Semester Promotion Status
 * - SF5B-SHS — Graduation Candidates / School Leaver Records
 * - SF9-SHS — Learner Progress Report Card (Form 138)
 * - SF10-SHS — Senior High School Permanent Academic Record (Form 137)
 * - PSA — Certificate of Live Birth
 */

export type ShsDocumentType =
  | "sf1"
  | "sf2"
  | "sf5a"
  | "sf5b"
  | "sf9"
  | "sf10"
  | "birth_cert"
  | "needs_classification";

export interface PageClassificationResult {
  pageNumber: number;
  detectedType: ShsDocumentType;
  confidence: number; // 0.0 - 1.0
  reasons: string[];
  matchedKeywords: string[];
  isContinuation: boolean;
  needsTeacherReview: boolean;
  title: string;
}

export interface DocumentSegment {
  id: string;
  documentType: ShsDocumentType;
  formTitle: string;
  startPage: number;
  endPage: number;
  pageNumbers: number[];
  pageCount: number;
  combinedText: string;
  confidence: number;
  needsClassification: boolean;
  reasons: string[];
  pages: any[];
  documentId?: string;
  persistenceStatus?: "persisted" | "failed" | "pending";
  persistenceError?: string;
  sourceFileName?: string;
  imageUrl?: string;
  storagePath?: string;
}

// ---------------------------------------------------------------------------
// Document Form Keywords & Pattern Signatures
// ---------------------------------------------------------------------------

const SF1_KEYWORDS = [
  "sf1",
  "sf-1",
  "school form 1",
  "school register",
  "master list",
  "registered learners",
  "mother tongue",
  "ip community",
  "guardian",
  "remarks indicator",
  "track and strand",
  "learner reference number",
  "daily attendance summary",
];

const SF2_KEYWORDS = [
  "sf2",
  "sf-2",
  "school form 2",
  "daily attendance report",
  "daily attendance",
  "for the month of",
  "total school days",
  "average daily attendance",
  "percentage of attendance",
  "consecutive days of absence",
  "dates of absence",
  "shading",
];

const SF5A_KEYWORDS = [
  "sf5a",
  "sf-5a",
  "school form 5a",
  "end of semester",
  "end of semester status",
  "report on promotion",
  "level of proficiency",
  "candidates for complete",
  "did not meet expectations",
  "fairly satisfactory",
  "action taken",
  "incomplete subjects",
  "back subjects",
];

const SF5B_KEYWORDS = [
  "sf5b",
  "sf-5b",
  "school form 5b",
  "graduation candidates",
  "candidates for graduation",
  "school leaver",
  "transferred out",
  "completed shs requirements",
  "track/strand",
  "diploma candidate",
];

const SF9_KEYWORDS = [
  "sf9",
  "sf-9",
  "form 138",
  "progress report card",
  "report on learning progress",
  "report on attendance",
  "observed values",
  "quarter 1",
  "quarter 2",
  "quarter 3",
  "quarter 4",
  "semestral final grade",
  "certificate of transfer",
  "dear parent",
  "maka-diyos",
  "makatao",
];

const SF10_KEYWORDS = [
  "sf10",
  "sf-10",
  "form 137",
  "permanent record",
  "student permanent record",
  "learner's permanent academic record",
  "senior high school student permanent record",
  "scholastic record",
  "eligibility for shs enrollment",
  "remedial classes",
  "recomputed final grade",
  "general average",
  "credits earned",
];

const PSA_KEYWORDS = [
  "certificate of live birth",
  "philippine statistics authority",
  "national statistics office",
  "office of the civil registrar",
  "registry no",
  "child",
  "mother",
  "father",
  "date of birth",
  "place of birth",
  "civil registry",
];

export const DOCUMENT_TITLES: Record<ShsDocumentType, string> = {
  sf1: "SF1-SHS — School Register",
  sf2: "SF2-SHS — Daily Attendance Report",
  sf5a: "SF5A-SHS — End of Semester Promotion",
  sf5b: "SF5B-SHS — Graduation Candidates",
  sf9: "SF9-SHS — Progress Report Card",
  sf10: "SF10-SHS — Senior High School Permanent Record",
  birth_cert: "PSA — Certificate of Live Birth",
  needs_classification: "Needs Classification (Teacher Review Required)",
};

/**
 * Classifies an individual page based on text content and layout heuristics.
 */
export function classifyPageContent(
  pageText: string,
  pageMeta?: { pageNumber?: number; lines?: any[]; words?: any[]; tables?: any[] }
): PageClassificationResult {
  const pageNum = pageMeta?.pageNumber ?? 1;
  const lower = (pageText || "").toLowerCase().trim();
  const reasons: string[] = [];
  const matchedKeywords: string[] = [];

  // 1. Guard against blank or unreadable page
  if (!lower || lower.length < 25) {
    return {
      pageNumber: pageNum,
      detectedType: "needs_classification",
      confidence: 0,
      reasons: ["Page text is empty or virtually unreadable. Check image quality."],
      matchedKeywords: [],
      isContinuation: false,
      needsTeacherReview: true,
      title: DOCUMENT_TITLES.needs_classification,
    };
  }

  // 2. Compute keyword match scores with word boundary safety to prevent substring collisions
  // (e.g. preventing 'sf10' from matching 'sf1', or 'sf5b' from matching 'sf5')
  const scoreKeywords = (keywords: string[]) => {
    const matched = keywords.filter((kw) => {
      if (kw === "sf1" || kw === "sf-1") {
        return (
          !lower.includes("sf10") &&
          !lower.includes("sf-10") &&
          (/\bsf-?1\b/i.test(lower) || lower.includes("school form 1 ") || lower.includes("school form 1\n"))
        );
      }
      if (kw === "sf5a" || kw === "sf-5a") {
        return /\bsf-?5a\b/i.test(lower) || lower.includes("school form 5a");
      }
      if (kw === "sf5b" || kw === "sf-5b") {
        return /\bsf-?5b\b/i.test(lower) || lower.includes("school form 5b");
      }
      if (kw === "sf9" || kw === "sf-9") {
        return /\bsf-?9\b/i.test(lower) || lower.includes("school form 9");
      }
      if (kw === "sf10" || kw === "sf-10") {
        return /\bsf-?10\b/i.test(lower) || lower.includes("school form 10");
      }
      return lower.includes(kw);
    });
    return { count: matched.length, matched };
  };

  const sf1Score = scoreKeywords(SF1_KEYWORDS);
  const sf2Score = scoreKeywords(SF2_KEYWORDS);
  const sf5aScore = scoreKeywords(SF5A_KEYWORDS);
  const sf5bScore = scoreKeywords(SF5B_KEYWORDS);
  const sf9Score = scoreKeywords(SF9_KEYWORDS);
  const sf10Score = scoreKeywords(SF10_KEYWORDS);
  const psaScore = scoreKeywords(PSA_KEYWORDS);

  // 3. PSA Detection
  if (psaScore.count >= 2 && !lower.includes("progress report card") && !lower.includes("permanent record")) {
    matchedKeywords.push(...psaScore.matched);
    reasons.push(`Matched PSA Civil Registry markers (${psaScore.matched.slice(0, 3).join(", ")})`);
    return {
      pageNumber: pageNum,
      detectedType: "birth_cert",
      confidence: Math.min(0.85 + psaScore.count * 0.05, 0.99),
      reasons,
      matchedKeywords,
      isContinuation: false,
      needsTeacherReview: false,
      title: DOCUMENT_TITLES.birth_cert,
    };
  }

  // 4. SF2 Daily Attendance Detection (Grid or headers)
  const hasAttendanceGrid =
    lower.includes("daily attendance") ||
    (lower.includes("attendance") && (lower.includes("absent") || lower.includes("present") || lower.includes("tardy")));
  if (sf2Score.count >= 2 || (hasAttendanceGrid && sf2Score.count >= 1 && !lower.includes("sf9") && !lower.includes("sf10"))) {
    matchedKeywords.push(...sf2Score.matched);
    reasons.push(`Matched SF2 Daily Attendance markers (${sf2Score.matched.slice(0, 3).join(", ")})`);
    return {
      pageNumber: pageNum,
      detectedType: "sf2",
      confidence: Math.min(0.85 + sf2Score.count * 0.04, 0.98),
      reasons,
      matchedKeywords,
      isContinuation: lower.includes("continuation") || (!lower.includes("school form 2") && hasAttendanceGrid),
      needsTeacherReview: false,
      title: DOCUMENT_TITLES.sf2,
    };
  }

  // 5. SF5B vs SF5A Promotion Detection
  if (sf5bScore.count >= 2 || lower.includes("sf5b") || lower.includes("sf-5b") || lower.includes("graduation candidates")) {
    matchedKeywords.push(...sf5bScore.matched);
    reasons.push(`Matched SF5B Graduation Candidate markers (${sf5bScore.matched.slice(0, 3).join(", ")})`);
    return {
      pageNumber: pageNum,
      detectedType: "sf5b",
      confidence: Math.min(0.85 + sf5bScore.count * 0.04, 0.98),
      reasons,
      matchedKeywords,
      isContinuation: false,
      needsTeacherReview: false,
      title: DOCUMENT_TITLES.sf5b,
    };
  }

  if (sf5aScore.count >= 2 || lower.includes("sf5a") || lower.includes("sf-5a") || (lower.includes("report on promotion") && !lower.includes("sf5b"))) {
    matchedKeywords.push(...sf5aScore.matched);
    reasons.push(`Matched SF5A Promotion Status markers (${sf5aScore.matched.slice(0, 3).join(", ")})`);
    return {
      pageNumber: pageNum,
      detectedType: "sf5a",
      confidence: Math.min(0.85 + sf5aScore.count * 0.04, 0.98),
      reasons,
      matchedKeywords,
      isContinuation: false,
      needsTeacherReview: false,
      title: DOCUMENT_TITLES.sf5a,
    };
  }

  // 6. SF10 Permanent Record (Checked before SF1 to prevent substring collisions)
  if (sf10Score.count > sf9Score.count || lower.includes("sf10") || lower.includes("sf-10") || lower.includes("permanent record") || lower.includes("form 137")) {
    matchedKeywords.push(...sf10Score.matched);
    reasons.push(`Matched SF10 Permanent Record transcript markers (${sf10Score.matched.slice(0, 3).join(", ")})`);
    return {
      pageNumber: pageNum,
      detectedType: "sf10",
      confidence: Math.min(0.80 + sf10Score.count * 0.04, 0.96),
      reasons,
      matchedKeywords,
      isContinuation: lower.includes("page 2") || lower.includes("page 3") || (lower.includes("grade 11") && lower.includes("grade 12")),
      needsTeacherReview: false,
      title: DOCUMENT_TITLES.sf10,
    };
  }

  // 7. SF1 School Register Detection
  if (sf1Score.count >= 2 || (lower.includes("school register") && !lower.includes("progress report") && !lower.includes("permanent record"))) {
    matchedKeywords.push(...sf1Score.matched);
    reasons.push(`Matched SF1 School Register markers (${sf1Score.matched.slice(0, 3).join(", ")})`);
    return {
      pageNumber: pageNum,
      detectedType: "sf1",
      confidence: Math.min(0.85 + sf1Score.count * 0.04, 0.98),
      reasons,
      matchedKeywords,
      isContinuation: lower.includes("page 2") || lower.includes("page 3") || lower.includes("continuation"),
      needsTeacherReview: false,
      title: DOCUMENT_TITLES.sf1,
    };
  }

  if (sf9Score.count >= 2 || lower.includes("sf9") || lower.includes("sf-9") || lower.includes("progress report card") || lower.includes("form 138")) {
    matchedKeywords.push(...sf9Score.matched);
    reasons.push(`Matched SF9 Progress Report Card markers (${sf9Score.matched.slice(0, 3).join(", ")})`);
    return {
      pageNumber: pageNum,
      detectedType: "sf9",
      confidence: Math.min(0.80 + sf9Score.count * 0.04, 0.96),
      reasons,
      matchedKeywords,
      isContinuation: false,
      needsTeacherReview: false,
      title: DOCUMENT_TITLES.sf9,
    };
  }

  // 8. Heuristic fallbacks: check for LRN and tabular structure
  const hasLrn = /\b\d{12}\b/.test(lower) || lower.includes("lrn");
  const hasSubjectGrades = lower.includes("final grade") || lower.includes("general average") || lower.includes("quarter");

  if (hasSubjectGrades && hasLrn) {
    reasons.push("Page contains LRN and academic grades, inferring SF9 Progress Report Card.");
    return {
      pageNumber: pageNum,
      detectedType: "sf9",
      confidence: 0.72,
      reasons,
      matchedKeywords: ["lrn", "grades"],
      isContinuation: false,
      needsTeacherReview: false,
      title: DOCUMENT_TITLES.sf9,
    };
  }

  // If low confidence or ambiguous signals, mark as NEEDS_CLASSIFICATION
  reasons.push("Page contains partial or ambiguous markings. Human verification recommended.");
  return {
    pageNumber: pageNum,
    detectedType: "needs_classification",
    confidence: 0.45,
    reasons,
    matchedKeywords: [],
    isContinuation: false,
    needsTeacherReview: true,
    title: DOCUMENT_TITLES.needs_classification,
  };
}

/**
 * Organizes a multi-page document or batch of pages into classified document segments
 * by detecting document boundaries across pages.
 */
export function segmentMultiPageDocument(params: {
  pages: Array<{ pageNumber: number; text: string; lines?: any[]; words?: any[]; tables?: any[] }>;
  fallbackDocType?: ShsDocumentType;
}): DocumentSegment[] {
  const { pages, fallbackDocType } = params;
  if (!pages || pages.length === 0) return [];

  // Step 1: Classify every page individually
  const pageClassifications = pages.map((p) => {
    return {
      page: p,
      classification: classifyPageContent(p.text, p),
    };
  });

  // Step 2: Establish document boundaries
  const segments: DocumentSegment[] = [];
  let currentSegment: DocumentSegment | null = null;

  for (let i = 0; i < pageClassifications.length; i++) {
    const { page, classification } = pageClassifications[i];
    let detectedType = classification.detectedType;

    // Continuation heuristic: if a page is marked continuation or needs classification,
    // but the previous page was a multi-page roster form (e.g. SF1, SF2, SF10),
    // and this page has table data without a new explicit form header, group with current segment.
    if (
      currentSegment &&
      (classification.isContinuation || detectedType === "needs_classification") &&
      ["sf1", "sf2", "sf10"].includes(currentSegment.documentType)
    ) {
      detectedType = currentSegment.documentType;
    }

    // Check if this page starts a new document segment
    const isNewSegment =
      !currentSegment ||
      currentSegment.documentType !== detectedType ||
      // Single-learner forms (SF9, PSA) start a new segment if a new student header/LRN appears
      (currentSegment.documentType === "birth_cert" && detectedType === "birth_cert" && currentSegment.pageCount >= 1) ||
      (currentSegment.documentType === "sf9" && detectedType === "sf9" && currentSegment.pageCount >= 2);

    if (isNewSegment) {
      if (currentSegment) {
        segments.push(currentSegment);
      }

      const effectiveType: ShsDocumentType = detectedType === "needs_classification" && fallbackDocType ? fallbackDocType : detectedType;
      const segId: string = `seg-${segments.length + 1}-${effectiveType}`;

      currentSegment = {
        id: segId,
        documentType: effectiveType,
        formTitle: DOCUMENT_TITLES[effectiveType] || DOCUMENT_TITLES.needs_classification,
        startPage: page.pageNumber,
        endPage: page.pageNumber,
        pageNumbers: [page.pageNumber],
        pageCount: 1,
        combinedText: page.text,
        confidence: classification.confidence,
        needsClassification: effectiveType === "needs_classification",
        reasons: [...classification.reasons],
        pages: [page],
        sourceFileName: (page as any).sourceFileName,
        imageUrl: (page as any).sourceFileDataUrl || (page as any).imageUrl,
      };
    } else if (currentSegment) {
      // Append page to current segment
      currentSegment.endPage = page.pageNumber;
      currentSegment.pageNumbers.push(page.pageNumber);
      currentSegment.pageCount += 1;
      currentSegment.combinedText += "\n\n" + page.text;
      currentSegment.confidence = Math.round(((currentSegment.confidence + classification.confidence) / 2) * 100) / 100;
      currentSegment.pages.push(page);
      if (classification.needsTeacherReview) {
        currentSegment.needsClassification = true;
      }
      currentSegment.reasons.push(...classification.reasons);
    }
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * Allows the teacher to reclassify or confirm a document segment's form type.
 */
export function reclassifyDocumentSegment(
  segments: DocumentSegment[],
  segmentId: string,
  newType: ShsDocumentType
): DocumentSegment[] {
  return segments.map((seg) => {
    if (seg.id !== segmentId) return seg;
    return {
      ...seg,
      documentType: newType,
      formTitle: DOCUMENT_TITLES[newType] || DOCUMENT_TITLES.needs_classification,
      needsClassification: newType === "needs_classification",
      confidence: 1.0, // Confirmed by teacher
      reasons: [...seg.reasons, `Classified manually by teacher as ${DOCUMENT_TITLES[newType]}.`],
    };
  });
}

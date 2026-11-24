/**
 * AVV System — SF9-SHS Learners' Observed Values and Achievement Parser
 *
 * Implements complete extraction of the right-hand section of DepEd SF9-SHS:
 * 1. Report on Learners' Observed Values (Core Values & Behavior Statements)
 *    - Maka-Diyos, Makatao, Makakalikasan, Makabansa
 *    - All individual Behavior Statements
 *    - Quarterly marks: Q1, Q2, Q3, Q4
 *    - Non-numerical ratings: AO (Always Observed), SO (Sometimes Observed),
 *      RO (Rarely Observed), NO (Not Observed)
 *    - Strict rules: No conversion to numbers, blank != NO, unreadable marks flagged
 * 2. Learner Progress and Achievement (Grading Scale legend)
 *    - Descriptors, Grading Scale, Remarks
 *    - Outstanding (90-100, Passed)
 *    - Very Satisfactory (85-89, Passed)
 *    - Satisfactory (80-84, Passed)
 *    - Fairly Satisfactory (75-79, Passed)
 *    - Did Not Meet Expectation (Below 75, Failed)
 */

import type {
  ObservedValueRating,
  CoreValueName,
  ObservedValueQuarterRecord,
  BehaviorStatementRecord,
  CoreValueGroup,
  LearnerObservedValueObservation,
  LearnersObservedValues,
  GradingScaleItem,
  LearnerProgressAndAchievement,
} from "@/types/documents";

// ---------------------------------------------------------------------------
// Canonical Reference Definitions
// ---------------------------------------------------------------------------

export interface CanonicalStatementDefinition {
  id: string;
  coreValue: CoreValueName;
  coreValueIndex: 1 | 2 | 3 | 4;
  statement: string;
  keywords: string[];
}

export const CANONICAL_BEHAVIOR_STATEMENTS: CanonicalStatementDefinition[] = [
  {
    id: "maka_diyos_1",
    coreValue: "Maka-Diyos",
    coreValueIndex: 1,
    statement: "Expresses one's spiritual beliefs while respecting the spiritual beliefs of others",
    keywords: ["spiritual beliefs", "respecting the spiritual", "expresses one"],
  },
  {
    id: "maka_diyos_2",
    coreValue: "Maka-Diyos",
    coreValueIndex: 1,
    statement: "Shows adherence to ethical principles by upholding truth in all undertakings",
    keywords: ["ethical principles", "upholding truth", "truth in all undertakings"],
  },
  {
    id: "makatao_1",
    coreValue: "Makatao",
    coreValueIndex: 2,
    statement: "Is sensitive to individual, social and cultural differences; resists stereotyping people",
    keywords: ["sensitive to individual", "cultural differences", "stereotyping people", "social and cultural"],
  },
  {
    id: "makatao_2",
    coreValue: "Makatao",
    coreValueIndex: 2,
    statement: "Demonstrates contributions toward solidarity",
    keywords: ["contributions toward solidarity", "solidarity"],
  },
  {
    id: "makakalikasan_1",
    coreValue: "Makakalikasan",
    coreValueIndex: 3,
    statement: "Cares for the environment and utilizes resources wisely, judiciously and economically",
    keywords: ["cares for the environment", "utilizes resources wisely", "judiciously and economically"],
  },
  {
    id: "makabansa_1",
    coreValue: "Makabansa",
    coreValueIndex: 4,
    statement: "Demonstrates pride in being a Filipino; exercises the rights and responsibilities of a Filipino citizen",
    keywords: ["pride in being a filipino", "rights and responsibilities", "filipino citizen"],
  },
  {
    id: "makabansa_2",
    coreValue: "Makabansa",
    coreValueIndex: 4,
    statement: "Demonstrates appropriate behavior in carrying out activities in the school, community and country",
    keywords: ["appropriate behavior", "activities in the school", "school, community and country", "community and country"],
  },
];

export const CANONICAL_MARKING_LEGEND = {
  AO: "Always Observed",
  SO: "Sometimes Observed",
  RO: "Rarely Observed",
  NO: "Not Observed",
} as const;

export const CANONICAL_GRADING_SCALE: GradingScaleItem[] = [
  { descriptor: "Outstanding", grading_scale: "90-100", remarks: "Passed" },
  { descriptor: "Very Satisfactory", grading_scale: "85-89", remarks: "Passed" },
  { descriptor: "Satisfactory", grading_scale: "80-84", remarks: "Passed" },
  { descriptor: "Fairly Satisfactory", grading_scale: "75-79", remarks: "Passed" },
  { descriptor: "Did Not Meet Expectation", grading_scale: "Below 75", remarks: "Failed" },
];

// ---------------------------------------------------------------------------
// Rating Normalizer
// ---------------------------------------------------------------------------

export interface NormalizedRatingResult {
  originalMark: string;
  normalized: ObservedValueRating | null;
  isBlank: boolean;
  isUnreadable: boolean;
}

export function normalizeObservedRating(rawMark: string | undefined | null): NormalizedRatingResult {
  if (rawMark === undefined || rawMark === null) {
    return { originalMark: "", normalized: null, isBlank: true, isUnreadable: false };
  }

  const trimmed = String(rawMark).trim();

  // 1. Strict blank cell detection: do NOT assume blank cells mean NO
  if (
    trimmed === "" ||
    /^[-—_–\s]+$/.test(trimmed) ||
    trimmed.toLowerCase() === ":unselected:" ||
    trimmed.toLowerCase() === "n/a" ||
    trimmed.toLowerCase() === "none"
  ) {
    return { originalMark: trimmed, normalized: null, isBlank: true, isUnreadable: false };
  }

  // 2. Exact / OCR-corrected non-numerical ratings (AO, SO, RO, NO)
  // Handle common OCR confusion: letter O vs digit 0, dots like A.O., trailing spaces
  const cleanUpper = trimmed.toUpperCase().replace(/\./g, "").trim();

  if (cleanUpper === "AO" || cleanUpper === "A0") {
    return { originalMark: trimmed, normalized: "AO", isBlank: false, isUnreadable: false };
  }
  if (cleanUpper === "SO" || cleanUpper === "S0") {
    return { originalMark: trimmed, normalized: "SO", isBlank: false, isUnreadable: false };
  }
  if (cleanUpper === "RO" || cleanUpper === "R0") {
    return { originalMark: trimmed, normalized: "RO", isBlank: false, isUnreadable: false };
  }
  if (cleanUpper === "NO" || cleanUpper === "N0") {
    return { originalMark: trimmed, normalized: "NO", isBlank: false, isUnreadable: false };
  }

  // Also match full legend wording if written out
  const lower = trimmed.toLowerCase();
  if (lower.includes("always observed")) {
    return { originalMark: trimmed, normalized: "AO", isBlank: false, isUnreadable: false };
  }
  if (lower.includes("sometimes observed")) {
    return { originalMark: trimmed, normalized: "SO", isBlank: false, isUnreadable: false };
  }
  if (lower.includes("rarely observed")) {
    return { originalMark: trimmed, normalized: "RO", isBlank: false, isUnreadable: false };
  }
  if (lower.includes("not observed")) {
    return { originalMark: trimmed, normalized: "NO", isBlank: false, isUnreadable: false };
  }

  // 3. Unreadable / ambiguous mark: must be flagged for teacher verification
  return { originalMark: trimmed, normalized: null, isBlank: false, isUnreadable: true };
}

// ---------------------------------------------------------------------------
// Matching Statement Helper
// ---------------------------------------------------------------------------

export function matchBehaviorStatement(text: string): CanonicalStatementDefinition | null {
  const lower = text.toLowerCase().replace(/[\r\n\t]+/g, " ").trim();
  if (!lower) return null;

  for (const stmt of CANONICAL_BEHAVIOR_STATEMENTS) {
    const matchedKeyword = stmt.keywords.some((kw) => lower.includes(kw));
    if (matchedKeyword) return stmt;
  }

  return null;
}

export function matchCoreValue(text: string): { name: CoreValueName; index: 1 | 2 | 3 | 4 } | null {
  const lower = text.toLowerCase().replace(/[\r\n\t]+/g, " ").trim();
  if (lower.includes("maka-diyos") || lower.includes("makadiyos")) return { name: "Maka-Diyos", index: 1 };
  if (lower.includes("makatao")) return { name: "Makatao", index: 2 };
  if (lower.includes("makakalikasan")) return { name: "Makakalikasan", index: 3 };
  if (lower.includes("makabansa")) return { name: "Makabansa", index: 4 };
  return null;
}

// ---------------------------------------------------------------------------
// Helper to construct structured LearnersObservedValues from statements
// ---------------------------------------------------------------------------

export function buildLearnersObservedValuesStructure(
  parsedStatementsMap: Map<string, { statement: CanonicalStatementDefinition; quarters: { [q in "q1" | "q2" | "q3" | "q4"]?: ObservedValueQuarterRecord } }>,
  options: { documentId?: string; lrn?: string; sourcePage?: number | string; tableConfidence?: number } = {}
): LearnersObservedValues {
  const statements: BehaviorStatementRecord[] = [];
  const observations: LearnerObservedValueObservation[] = [];
  let hasUnreadable = false;

  for (const def of CANONICAL_BEHAVIOR_STATEMENTS) {
    const existing = parsedStatementsMap.get(def.id);
    const q1 = existing?.quarters.q1;
    const q2 = existing?.quarters.q2;
    const q3 = existing?.quarters.q3;
    const q4 = existing?.quarters.q4;

    const stmtRec: BehaviorStatementRecord = {
      statement_id: def.id,
      statement: def.statement,
      core_value: def.coreValue,
      core_value_index: def.coreValueIndex,
      q1,
      q2,
      q3,
      q4,
    };
    statements.push(stmtRec);

    // Populate individual observations
    const quarterEntries: Array<{ qKey: "Q1" | "Q2" | "Q3" | "Q4"; rec?: ObservedValueQuarterRecord }> = [
      { qKey: "Q1", rec: q1 },
      { qKey: "Q2", rec: q2 },
      { qKey: "Q3", rec: q3 },
      { qKey: "Q4", rec: q4 },
    ];

    for (const { qKey, rec } of quarterEntries) {
      if (rec?.needs_verification) {
        hasUnreadable = true;
      }

      observations.push({
        document_id: options.documentId,
        lrn: options.lrn,
        core_value: def.coreValue,
        behavior_statement: def.statement,
        quarter: qKey,
        original_mark: rec?.original_mark ?? "",
        normalized_rating: rec?.normalized_rating ?? null,
        ocr_confidence: rec?.confidence ?? options.tableConfidence,
        source_page: rec?.source_page ?? options.sourcePage,
        location: rec?.location,
        bounding_box: rec?.bounding_box,
        needs_verification: rec?.needs_verification ?? false,
        verification_status: rec?.verification_status ?? "unverified",
      });
    }
  }

  // Group by Core Value
  const coreValuesGroups: CoreValueGroup[] = [
    { name: "Maka-Diyos", index: 1, statements: [] },
    { name: "Makatao", index: 2, statements: [] },
    { name: "Makakalikasan", index: 3, statements: [] },
    { name: "Makabansa", index: 4, statements: [] },
  ];

  for (const stmt of statements) {
    const group = coreValuesGroups.find((g) => g.index === stmt.core_value_index);
    if (group) group.statements.push(stmt);
  }

  return {
    statements,
    core_values: coreValuesGroups,
    observations,
    marking_legend: { ...CANONICAL_MARKING_LEGEND },
    has_unreadable_marks: hasUnreadable,
    flagged_for_verification: hasUnreadable,
  };
}

// ---------------------------------------------------------------------------
// Azure Layout Table Parser for Observed Values
// ---------------------------------------------------------------------------

export function isObservedValuesAzureTable(table: any): boolean {
  if (!table || !Array.isArray(table.cells)) return false;
  const allText = table.cells.map((c: any) => (c.content || "").toLowerCase()).join(" ");
  return (
    (allText.includes("observed values") || allText.includes("core values") || allText.includes("behavior statements")) &&
    (allText.includes("maka-diyos") || allText.includes("makatao") || allText.includes("makabansa") || allText.includes("makakalikasan"))
  );
}

export function parseAzureObservedValuesTable(
  table: any,
  options: { documentId?: string; lrn?: string; sourcePage?: number | string } = {}
): LearnersObservedValues | null {
  if (!table || !Array.isArray(table.cells) || table.cells.length === 0) return null;

  const rowCount = table.rowCount || 0;
  const colCount = table.columnCount || 0;

  // Build matrix of cells
  const matrix: any[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => null)
  );

  for (const cell of table.cells) {
    const r = cell.rowIndex ?? 0;
    const c = cell.columnIndex ?? 0;
    if (r < rowCount && c < colCount) {
      matrix[r][c] = cell;
    }
  }

  // Detect quarter column indices (1, 2, 3, 4)
  // Usually the last 4 columns or columns where header has 1, 2, 3, 4
  let qColIndices: { q1: number; q2: number; q3: number; q4: number } | null = null;

  for (let r = 0; r < Math.min(3, rowCount); r++) {
    const row = matrix[r];
    const ones = row.findIndex((c) => c && c.content.trim() === "1");
    const twos = row.findIndex((c) => c && c.content.trim() === "2");
    const threes = row.findIndex((c) => c && c.content.trim() === "3");
    const fours = row.findIndex((c) => c && c.content.trim() === "4");

    if (ones >= 0 && twos >= 0 && threes >= 0 && fours >= 0) {
      qColIndices = { q1: ones, q2: twos, q3: threes, q4: fours };
      break;
    }
  }

  // Fallback: If not explicitly found, check column count.
  // Standard DepEd table has: Col 0: Core Values, Col 1: Behavior Statements, Col 2: Q1, Col 3: Q2, Col 4: Q3, Col 5: Q4
  if (!qColIndices && colCount >= 6) {
    qColIndices = {
      q1: colCount - 4,
      q2: colCount - 3,
      q3: colCount - 2,
      q4: colCount - 1,
    };
  } else if (!qColIndices && colCount >= 4) {
    qColIndices = {
      q1: colCount - 4,
      q2: colCount - 3,
      q3: colCount - 2,
      q4: colCount - 1,
    };
  }

  const statementsMap = new Map<
    string,
    {
      statement: CanonicalStatementDefinition;
      quarters: { [q in "q1" | "q2" | "q3" | "q4"]?: ObservedValueQuarterRecord };
    }
  >();

  let currentCoreValue: CoreValueName | null = null;
  let currentCvIndex: 1 | 2 | 3 | 4 = 1;

  for (let r = 0; r < rowCount; r++) {
    const row = matrix[r];
    if (!row) continue;

    // Check cells for Core Value header or Behavior Statement
    const col0Text = row[0]?.content || "";
    const col1Text = row[1]?.content || "";
    const fullRowText = row.map((c) => c?.content || "").join(" ");

    // Skip table main headers
    const lowerRow = fullRowText.toLowerCase();
    if (
      lowerRow.includes("report on learner") ||
      (lowerRow.includes("core values") && lowerRow.includes("behavior statements") && lowerRow.includes("quarter")) ||
      (row[0]?.content.trim() === "1" && row[1]?.content.trim() === "2")
    ) {
      continue;
    }

    const cvMatch = matchCoreValue(col0Text) || matchCoreValue(fullRowText);
    if (cvMatch) {
      currentCoreValue = cvMatch.name;
      currentCvIndex = cvMatch.index;
    }

    // Attempt to match behavior statement in col 1, col 0, or combined
    const candidateText = `${col0Text} ${col1Text}`.trim();
    let stmtDef = matchBehaviorStatement(candidateText) || matchBehaviorStatement(fullRowText);

    if (!stmtDef) {
      // Check if candidate matches any of the canonical statements by sequential index under current Core Value
      continue;
    }

    // Extract quarterly ratings
    const quarters: { [q in "q1" | "q2" | "q3" | "q4"]?: ObservedValueQuarterRecord } = {};

    const qKeys: Array<"q1" | "q2" | "q3" | "q4"> = ["q1", "q2", "q3", "q4"];
    for (const qKey of qKeys) {
      const colIdx = qColIndices ? qColIndices[qKey] : -1;
      const cell = colIdx >= 0 && colIdx < row.length ? row[colIdx] : null;
      const rawContent = cell?.content || "";
      const norm = normalizeObservedRating(rawContent);

      const qRecord: ObservedValueQuarterRecord = {
        quarter: qKey.toUpperCase() as "Q1" | "Q2" | "Q3" | "Q4",
        original_mark: norm.originalMark,
        normalized_rating: norm.normalized,
        confidence: cell?.confidence ?? 0.95,
        source_page: cell?.pageIndex ?? options.sourcePage ?? 2,
        location: `row_${r}_col_${colIdx}`,
        bounding_box: cell?.boundingBox,
        needs_verification: norm.isUnreadable,
        verification_status: norm.isUnreadable ? "flagged" : "unverified",
      };

      quarters[qKey] = qRecord;
    }

    statementsMap.set(stmtDef.id, {
      statement: stmtDef,
      quarters,
    });
  }

  return buildLearnersObservedValuesStructure(statementsMap, options);
}

// ---------------------------------------------------------------------------
// Azure Layout Table Parser for Learner Progress & Achievement (Grading Scale)
// ---------------------------------------------------------------------------

export function isGradingScaleAzureTable(table: any): boolean {
  if (!table || !Array.isArray(table.cells)) return false;
  const allText = table.cells.map((c: any) => (c.content || "").toLowerCase()).join(" ");
  return (
    (allText.includes("descriptors") || allText.includes("grading scale") || allText.includes("learner progress")) &&
    (allText.includes("outstanding") || allText.includes("very satisfactory") || allText.includes("did not meet"))
  );
}

export function parseAzureGradingScaleTable(
  table: any,
  options: { sourcePage?: number | string } = {}
): LearnerProgressAndAchievement | null {
  if (!table || !Array.isArray(table.cells) || table.cells.length === 0) return null;

  const rowCount = table.rowCount || 0;
  const colCount = table.columnCount || 0;
  const scaleItems: GradingScaleItem[] = [];

  const matrix: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => "")
  );

  for (const cell of table.cells) {
    const r = cell.rowIndex ?? 0;
    const c = cell.columnIndex ?? 0;
    if (r < rowCount && c < colCount) {
      matrix[r][c] = (cell.content || "").trim();
    }
  }

  for (let r = 0; r < rowCount; r++) {
    const row = matrix[r];
    const rowText = row.join(" ").toLowerCase();

    // Skip header row
    if (rowText.includes("descriptors") && rowText.includes("grading scale")) {
      continue;
    }

    let descriptor = "";
    let gradingScale = "";
    let remarks = "";

    if (rowText.includes("outstanding")) {
      descriptor = "Outstanding";
      gradingScale = row.find((c) => c.includes("90-100") || c.includes("90 - 100")) || "90-100";
      remarks = row.find((c) => /passed/i.test(c)) || "Passed";
    } else if (rowText.includes("very satisfactory")) {
      descriptor = "Very Satisfactory";
      gradingScale = row.find((c) => c.includes("85-89") || c.includes("85 - 89")) || "85-89";
      remarks = row.find((c) => /passed/i.test(c)) || "Passed";
    } else if (rowText.includes("fairly satisfactory")) {
      descriptor = "Fairly Satisfactory";
      gradingScale = row.find((c) => c.includes("75-79") || c.includes("75 - 79")) || "75-79";
      remarks = row.find((c) => /passed/i.test(c)) || "Passed";
    } else if (rowText.includes("satisfactory")) {
      descriptor = "Satisfactory";
      gradingScale = row.find((c) => c.includes("80-84") || c.includes("80 - 84")) || "80-84";
      remarks = row.find((c) => /passed/i.test(c)) || "Passed";
    } else if (rowText.includes("did not meet")) {
      descriptor = "Did Not Meet Expectation";
      gradingScale = row.find((c) => /below\s*75/i.test(c)) || "Below 75";
      remarks = row.find((c) => /failed/i.test(c)) || "Failed";
    }

    if (descriptor) {
      scaleItems.push({
        descriptor,
        grading_scale: gradingScale,
        remarks,
        source_page: options.sourcePage ?? 2,
      });
    }
  }

  if (scaleItems.length === 0) {
    // If table was identified as grading scale table but cell extraction missed, provide canonical official items
    return {
      scale_items: [...CANONICAL_GRADING_SCALE],
      source_page: options.sourcePage ?? 2,
    };
  }

  return {
    scale_items: scaleItems,
    source_page: options.sourcePage ?? 2,
  };
}

// ---------------------------------------------------------------------------
// Text / Markdown Pipe-Table Parser for Observed Values and Achievement
// ---------------------------------------------------------------------------

export function parseTextObservedValuesAndAchievement(
  text: string,
  options: { documentId?: string; lrn?: string; sourcePage?: number | string } = {}
): {
  observedValues: LearnersObservedValues | null;
  learnerProgressAchievement: LearnerProgressAndAchievement | null;
} {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const statementsMap = new Map<
    string,
    {
      statement: CanonicalStatementDefinition;
      quarters: { [q in "q1" | "q2" | "q3" | "q4"]?: ObservedValueQuarterRecord };
    }
  >();

  let hasObservedValuesContext = false;
  let hasGradingScaleContext = false;
  const scaleItems: GradingScaleItem[] = [];

  // 1. Process Markdown Pipe Tables or Text Lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    if (lowerLine.includes("observed values") || lowerLine.includes("core values")) {
      hasObservedValuesContext = true;
    }
    if (lowerLine.includes("learner progress and achievement") || lowerLine.includes("grading scale")) {
      hasGradingScaleContext = true;
    }

    // Check for Grading Scale items
    if (hasGradingScaleContext || lowerLine.includes("outstanding") || lowerLine.includes("did not meet")) {
      let descriptor = "";
      let gradingScale = "";
      let remarks = "";

      if (lowerLine.includes("outstanding") && !scaleItems.some((s) => s.descriptor === "Outstanding")) {
        descriptor = "Outstanding";
        gradingScale = "90-100";
        remarks = "Passed";
      } else if (lowerLine.includes("very satisfactory") && !scaleItems.some((s) => s.descriptor === "Very Satisfactory")) {
        descriptor = "Very Satisfactory";
        gradingScale = "85-89";
        remarks = "Passed";
      } else if (lowerLine.includes("fairly satisfactory") && !scaleItems.some((s) => s.descriptor === "Fairly Satisfactory")) {
        descriptor = "Fairly Satisfactory";
        gradingScale = "75-79";
        remarks = "Passed";
      } else if (lowerLine.includes("satisfactory") && !scaleItems.some((s) => s.descriptor === "Satisfactory")) {
        descriptor = "Satisfactory";
        gradingScale = "80-84";
        remarks = "Passed";
      } else if (lowerLine.includes("did not meet") && !scaleItems.some((s) => s.descriptor === "Did Not Meet Expectation")) {
        descriptor = "Did Not Meet Expectation";
        gradingScale = "Below 75";
        remarks = "Failed";
      }

      if (descriptor) {
        scaleItems.push({
          descriptor,
          grading_scale: gradingScale,
          remarks,
          source_page: options.sourcePage ?? 2,
        });
        continue;
      }
    }

    // Check for Behavior Statement in pipe-table row: | Core Value | Statement | Q1 | Q2 | Q3 | Q4 |
    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c, idx, arr) => !(idx === 0 && c === "") && !(idx === arr.length - 1 && c === ""));

      if (cells.length < 2) continue;

      const cellsText = cells.join(" ").toLowerCase();
      // Skip header / divider lines
      if (
        cells[0].includes("---") ||
        cellsText.includes("quarter") && (cellsText.includes("1") || cellsText.includes("core values"))
      ) {
        continue;
      }

      const stmtDef = matchBehaviorStatement(cellsText);
      if (stmtDef) {
        hasObservedValuesContext = true;
        // The quarters are typically the last 4 cells, or after the statement
        const stmtCellIdx = cells.findIndex((c) => matchBehaviorStatement(c) !== null);
        const marksCells = stmtCellIdx >= 0 ? cells.slice(stmtCellIdx + 1) : cells.slice(-4);

        const quarters: { [q in "q1" | "q2" | "q3" | "q4"]?: ObservedValueQuarterRecord } = {};
        const qKeys: Array<"q1" | "q2" | "q3" | "q4"> = ["q1", "q2", "q3", "q4"];

        for (let qIdx = 0; qIdx < 4; qIdx++) {
          const qKey = qKeys[qIdx];
          const rawMark = qIdx < marksCells.length ? marksCells[qIdx] : "";
          const norm = normalizeObservedRating(rawMark);

          quarters[qKey] = {
            quarter: qKey.toUpperCase() as "Q1" | "Q2" | "Q3" | "Q4",
            original_mark: norm.originalMark,
            normalized_rating: norm.normalized,
            confidence: 0.95,
            source_page: options.sourcePage ?? 2,
            location: `pipe_row_${i}_q${qIdx + 1}`,
            needs_verification: norm.isUnreadable,
            verification_status: norm.isUnreadable ? "flagged" : "unverified",
          };
        }

        statementsMap.set(stmtDef.id, {
          statement: stmtDef,
          quarters,
        });
      }
    } else {
      // Non-pipe plain text lines (e.g. from PDF text extraction or raw OCR)
      const stmtDef = matchBehaviorStatement(line);
      if (stmtDef) {
        hasObservedValuesContext = true;
        // Look ahead for marks on the next 1-3 lines (e.g. "SO", "AO SO RO NO", etc.)
        const quarters: { [q in "q1" | "q2" | "q3" | "q4"]?: ObservedValueQuarterRecord } = {};
        const qKeys: Array<"q1" | "q2" | "q3" | "q4"> = ["q1", "q2", "q3", "q4"];

        // Check if marks are directly inside current line or following line
        let marksFound: string[] = [];

        // Check following line
        if (i + 1 < lines.length) {
          const nextTokens = lines[i + 1].trim().split(/\s+/);
          const validRatings = nextTokens.filter((t) => {
            const u = t.toUpperCase().replace(/\./g, "");
            return ["AO", "SO", "RO", "NO", "A0", "S0", "R0", "N0", "?", "X"].includes(u);
          });
          if (validRatings.length > 0) {
            marksFound = validRatings;
          }
        }

        for (let qIdx = 0; qIdx < 4; qIdx++) {
          const qKey = qKeys[qIdx];
          const rawMark = qIdx < marksFound.length ? marksFound[qIdx] : "";
          const norm = normalizeObservedRating(rawMark);

          quarters[qKey] = {
            quarter: qKey.toUpperCase() as "Q1" | "Q2" | "Q3" | "Q4",
            original_mark: norm.originalMark,
            normalized_rating: norm.normalized,
            confidence: 0.92,
            source_page: options.sourcePage ?? 2,
            location: `text_line_${i}_q${qIdx + 1}`,
            needs_verification: norm.isUnreadable,
            verification_status: norm.isUnreadable ? "flagged" : "unverified",
          };
        }

        statementsMap.set(stmtDef.id, {
          statement: stmtDef,
          quarters,
        });
      }
    }
  }

  const observedValues = hasObservedValuesContext || statementsMap.size > 0
    ? buildLearnersObservedValuesStructure(statementsMap, options)
    : null;

  const learnerProgressAchievement = scaleItems.length > 0
    ? {
        scale_items: scaleItems,
        source_page: options.sourcePage ?? 2,
      }
    : null;

  return {
    observedValues,
    learnerProgressAchievement,
  };
}

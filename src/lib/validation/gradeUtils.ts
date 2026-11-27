import type { GradeRecord, ExtractedFields } from "@/types/documents";

/**
 * Normalizes semester strings into standard "1st Semester", "2nd Semester", or undefined.
 */
export function normalizeSemesterContext(
  sem: string | undefined | null
): "1st Semester" | "2nd Semester" | undefined {
  if (!sem || typeof sem !== "string") return undefined;
  const lower = sem.toLowerCase().trim();
  if (
    lower.includes("2nd") ||
    lower.includes("second") ||
    lower.includes("sem 2") ||
    lower.includes("semester 2") ||
    lower === "2"
  ) {
    return "2nd Semester";
  }
  if (
    lower.includes("1st") ||
    lower.includes("first") ||
    lower.includes("sem 1") ||
    lower.includes("semester 1") ||
    lower === "1"
  ) {
    return "1st Semester";
  }
  return undefined;
}

/**
 * Checks whether a candidate grade or cell is genuinely blank or missing.
 */
export function isBlankOrMissingFinal(val: any): boolean {
  if (val === undefined || val === null) return true;
  const str = String(val).trim().toLowerCase();
  return (
    str === "" ||
    str === "-" ||
    str === "—" ||
    str === "–" ||
    str === "_" ||
    str === "missing" ||
    str === "null" ||
    str === "undefined" ||
    str === "blank" ||
    str === "n/a" ||
    str === "none" ||
    str === "nan" ||
    str === ":unselected:" ||
    str === ":selected:"
  );
}

/**
 * Strict DepEd sex/gender normalizer.
 * Enforces strict domain constraint: only "Male" | "Female" | null (or "—" in UI display).
 * Supports prefix & PSA Item-2 code snapping (e.g. Ma/M/1 -> Male, Fe/F/2 -> Female).
 */
export function normalizeStrictSex(raw: unknown): "Male" | "Female" | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const upper = s.toUpperCase().trim();
  if (
    upper === "" ||
    upper === "—" ||
    upper === "-" ||
    upper === "UNKNOWN" ||
    upper === "NOT DETECTED" ||
    upper === "NOT_DETECTED" ||
    upper === "NULL" ||
    upper === "UNDEFINED" ||
    upper === "N/A" ||
    upper === "NONE"
  ) {
    return null;
  }

  // Guard: If raw string contains both "1 Male" and "2 Female" side-by-side without marks (e.g. unselected printed Form 102 labels)
  const hasBothUnmarked =
    /(?:1\s*[-.]?\s*male|lalaki)/i.test(upper) &&
    /(?:2\s*[-.]?\s*female|babae)/i.test(upper) &&
    !/[xX✓✔vV\/\*+×#]|:selected:/.test(upper);
  if (hasBothUnmarked) {
    return null;
  }

  // Selected checkbox/mark placement relative to 1 Male vs 2 Female
  // Mark before 1 Male:
  const maleMarkMatch = /(?:^|[\s_(\[])(?:[xX✓✔vV\/\*+×#]|:selected:)\s*(?:1\s*[-.]?\s*)?male\b/i.test(upper);
  // Mark before 2 Female or between 1 Male and 2 Female:
  const femaleMarkMatch =
    /(?:^|[\s_(\[])(?:[xX✓✔vV\/\*+×#]|:selected:)\s*(?:2\s*[-.]?\s*)?female\b/i.test(upper) ||
    /(?:1\s*[-.]?\s*male\b.*?)(?:[xX✓✔vV\/\*+×#]|:selected:)\s*(?:2\s*[-.]?\s*)?female\b/i.test(upper);

  if (maleMarkMatch && !femaleMarkMatch) return "Male";
  if (femaleMarkMatch && !maleMarkMatch) return "Female";

  // Clean string for token examination: strip punctuation, brackets, pipes, underscores, colons
  const cleaned = upper.replace(/[|.:\-_()[\]{}'"/\\,;*~^#]+/g, " ").trim();
  if (!cleaned) return null;

  // Exact single tokens / numbers
  if (
    cleaned === "M" ||
    cleaned === "MALE" ||
    cleaned === "1 MALE" ||
    cleaned === "1MALE" ||
    cleaned === "1" ||
    cleaned === "LALAKI" ||
    cleaned === "BOY" ||
    cleaned === "MAN"
  ) {
    return "Male";
  }
  if (
    cleaned === "F" ||
    cleaned === "FEMALE" ||
    cleaned === "2 FEMALE" ||
    cleaned === "2FEMALE" ||
    cleaned === "2" ||
    cleaned === "BABAE" ||
    cleaned === "GIRL" ||
    cleaned === "WOMAN"
  ) {
    return "Female";
  }

  // Tokens breakdown
  const tokens = cleaned.split(/\s+/).filter(Boolean);

  // If first token is 1 or 2 followed by sex
  if (tokens.length >= 2) {
    if (tokens[0] === "1" && (/^M/i.test(tokens[1]) || tokens[1].startsWith("MA"))) return "Male";
    if (tokens[0] === "2" && (/^F/i.test(tokens[1]) || tokens[1].startsWith("FE"))) return "Female";
  }

  // Short tokens or prefix code matching (e.g. "Ma", "Mal", "Mle", "Fe", "Fem", "Fmale")
  // Guard against non-sex English words: "MANILA", "MARCH", "MAY", "MATURE", "MAIN", "MARK", "MARKS", "MATH", "MATHEMATICS", "MAJOR"
  const ignoredMaleWords = new Set(["MANILA", "MARCH", "MAY", "MATURE", "MAIN", "MARK", "MARKS", "MATH", "MATHEMATICS", "MAJOR"]);
  const ignoredFemaleWords = new Set(["FEBRUARY", "FEE", "FEET", "FED", "FEED", "FEEL", "FEATURE", "FEAT"]);

  if (tokens.length === 1) {
    const t = tokens[0];
    if (t === "M" || t === "1") return "Male";
    if (t === "F" || t === "2") return "Female";
    if (t.startsWith("MA") && !ignoredMaleWords.has(t)) {
      return "Male";
    }
    if (t.startsWith("FE") && !ignoredFemaleWords.has(t)) {
      return "Female";
    }
    if (t.startsWith("MAL") || t.startsWith("MLE")) return "Male";
    if (t.startsWith("FEM") || t.startsWith("FMALE")) return "Female";
  }

  // Word boundary regex
  if (/\b(?:FEMALE|BABAE)\b/i.test(cleaned)) return "Female";
  if (/\b(?:MALE|LALAKI)\b/i.test(cleaned)) return "Male";

  // Label prefix e.g. "SEX: M" or "SEX M" or "2 SEX 1"
  const sexLabelMatch = cleaned.match(/(?:SEX|KASARIAN)\s+([A-Z0-9]+)/i);
  if (sexLabelMatch) {
    const val = sexLabelMatch[1];
    if (val === "M" || val === "1" || (val.startsWith("MA") && !ignoredMaleWords.has(val))) return "Male";
    if (val === "F" || val === "2" || (val.startsWith("FE") && !ignoredFemaleWords.has(val))) return "Female";
  }

  if (/\bF\b/i.test(cleaned) && !/\bM\b/i.test(cleaned) && !/\b1\b/i.test(cleaned)) return "Female";
  if (/\bM\b/i.test(cleaned) && !/\bF\b/i.test(cleaned) && !/\b2\b/i.test(cleaned)) return "Male";

  return null;
}

export interface ConsecutiveSchoolYearValidationResult {
  isValid: boolean;
  normalized: string | null;
  schoolYear?: string | null;
  errorMessage?: string;
  reason?: string;
  message?: string;
  startYear?: number;
  endYear?: number;
}

/**
 * Validates strictly consecutive school years (YYYY-(YYYY+1), e.g. "2025-2026").
 * Rejects non-consecutive years e.g. "2025-2027", "2025-2028", "2025-2025", "2026-2025".
 */
export function validateConsecutiveSchoolYear(
  rawSy: string | null | undefined
): ConsecutiveSchoolYearValidationResult {
  if (!rawSy || typeof rawSy !== "string" || !rawSy.trim()) {
    const msg = "School Year is missing or empty";
    return {
      isValid: false,
      normalized: null,
      errorMessage: msg,
      reason: msg,
      message: msg,
    };
  }

  const clean = rawSy.trim();
  const match = clean.match(/\b(20\d{2}|19\d{2})\s*[-–—/]\s*(20\d{2}|19\d{2})\b/);
  if (!match) {
    const msg = `Invalid School Year format: "${clean}". Expected YYYY-YYYY (e.g., 2025-2026).`;
    return {
      isValid: false,
      normalized: clean,
      errorMessage: msg,
      reason: msg,
      message: msg,
    };
  }

  const startYear = parseInt(match[1], 10);
  const endYear = parseInt(match[2], 10);
  const normalized = `${startYear}-${endYear}`;

  if (endYear !== startYear + 1) {
    const msg = `Invalid School Year: non-consecutive years (must be consecutive years YYYY-(YYYY+1), e.g. 2025-2026, but found ${normalized})`;
    return {
      isValid: false,
      normalized,
      errorMessage: msg,
      reason: msg,
      message: msg,
      startYear,
      endYear,
    };
  }

  return {
    isValid: true,
    normalized,
    errorMessage: undefined,
    reason: undefined,
    message: undefined,
    startYear,
    endYear,
  };
}

export interface DynamicGradeStatusParams {
  grade?: number | string | null;
  rawRemark?: string | null;
  confidencePercent?: number | null;
  q1?: number | null;
  q2?: number | null;
  siblingQuarter?: number | null;
  allowDecimal?: boolean;
  isGeneralAverage?: boolean;
}

export interface DynamicGradeStatusResult {
  gradeDisplay: string;
  remarkDisplay: string;
  status: "blank" | "not_recognized" | "passed" | "failed" | "incomplete" | "dropped" | "transferred" | "other";
  officialRemark: "PASSED" | "FAILED" | "INCOMPLETE" | "DROPPED" | "TRANSFERRED" | "BLANK / INCOMPLETE" | "NOT RECOGNIZED";
  numericGrade?: number;
  confidencePercent?: number;
  isLowConfidence: boolean;
  isValidNumeric: boolean;
  wasRecovered?: boolean;
  recoveryReason?: string;
}

export interface SanitizeAndRecoverGradeParams {
  rawGrade: number | string | null | undefined;
  q1?: number | null;
  q2?: number | null;
  siblingQuarter?: number | null;
  confidencePercent?: number | null;
  allowDecimal?: boolean;
  isGeneralAverage?: boolean;
}

export interface SanitizeAndRecoverGradeResult {
  grade: number | null;
  wasRecovered: boolean;
  recoveryReason?: string;
  isInvalidFormat: boolean;
}

/**
 * Strict Digits-Only Grade Sanitizer & DepEd 60–100 Handwritten 8/7 Recovery
 *
 * Rules:
 * - Rule A — Digits Only & Max 3 Digits:
 *   Strikes whitespace; blanks return grade: null.
 *   Rejects any non-numeric characters or strings with >3 digits (/^\d{1,3}$/ after stripping decimal).
 * - Rule B — DepEd K–12 Valid Range (60–100) & Homoglyph Recovery:
 *   Case 1: Truncated single-digit (0–9, e.g. "8" when handwritten "88" dropped first "8").
 *           Recovers to expected average if Q1 & Q2 available, or checks siblingQuarter.
 *   Case 2: Leading-1 misread from handwritten 8 or 7 (10–19, e.g. "16" -> "86", "19" -> "79").
 *           Recovers to candidate matching Q1/Q2 average or sibling quarter within <= 6 points.
 *   Case 3: Out-of-range (< 60 or > 100) that cannot be safely recovered returns grade: null.
 */
export function sanitizeAndRecoverDepEdGrade(
  params: SanitizeAndRecoverGradeParams
): SanitizeAndRecoverGradeResult {
  const { rawGrade, q1, q2, siblingQuarter } = params;

  if (rawGrade === undefined || rawGrade === null) {
    return { grade: null, wasRecovered: false, isInvalidFormat: false };
  }

  const rawStr = String(rawGrade).trim();
  if (
    rawStr === "" ||
    rawStr === "-" ||
    rawStr === "—" ||
    rawStr === "–" ||
    rawStr === "_" ||
    rawStr.toLowerCase() === "blank" ||
    rawStr.toLowerCase() === "null" ||
    rawStr.toLowerCase() === "undefined" ||
    rawStr.toLowerCase() === "missing" ||
    rawStr.toLowerCase() === "n/a"
  ) {
    return { grade: null, wasRecovered: false, isInvalidFormat: false };
  }

  // Strip trailing .0 / .00 or standard decimals if present (e.g. "85.0" -> "85")
  const cleanIntStr = rawStr.replace(/\.0+$/, "");

  // Rule A: Digits only and max 3 digits
  // Non-numeric characters (letters, symbols, dashes) or >3 digits are strictly invalid
  if (!/^\d{1,3}$/.test(cleanIntStr)) {
    // If it has decimal like "86.5" or "86.8", allow if integer part has <= 3 digits
    if (/^\d{1,3}\.\d+$/.test(rawStr)) {
      const floatVal = parseFloat(rawStr);
      if (floatVal >= 60.0 && floatVal <= 100.0) {
        if (params.allowDecimal || params.isGeneralAverage) {
          return { grade: floatVal, wasRecovered: false, isInvalidFormat: false };
        }
        const rounded = Math.round(floatVal);
        return { grade: rounded, wasRecovered: false, isInvalidFormat: false };
      }
    }
    return {
      grade: null,
      wasRecovered: false,
      isInvalidFormat: true,
      recoveryReason: `Non-numeric characters or exceeds 3 digits: "${rawStr}"`,
    };
  }

  const numVal = parseInt(cleanIntStr, 10);

  // If already a valid DepEd whole grade (60 to 100 inclusive)
  if (numVal >= 60 && numVal <= 100) {
    return { grade: numVal, wasRecovered: false, isInvalidFormat: false };
  }

  // Helper to validate whether a quarter mark is in DepEd 60..100 range
  const isValidDepEd = (v?: number | null): v is number =>
    typeof v === "number" && !isNaN(v) && v >= 60 && v <= 100;

  const validQ1Q2 = isValidDepEd(q1) && isValidDepEd(q2);
  const expectedAvg = validQ1Q2 ? Math.round(((q1 as number) + (q2 as number)) / 2) : null;

  // Rule B - Case 1: Truncated single-digit (0–9, e.g. "8" when handwritten "88" dropped first "8")
  if (numVal >= 0 && numVal <= 9) {
    if (expectedAvg !== null) {
      if (expectedAvg % 10 === numVal || expectedAvg === 80 + numVal || expectedAvg === 70 + numVal) {
        return {
          grade: expectedAvg,
          wasRecovered: true,
          isInvalidFormat: false,
          recoveryReason: `Recovered single-digit "${numVal}" to ${expectedAvg} based on Q1 (${q1}) and Q2 (${q2}) average`,
        };
      }
    }

    // Check with sibling quarter if single digit is 6, 7, 8, 9
    if (numVal >= 6 && isValidDepEd(siblingQuarter)) {
      const cand8 = 80 + numVal;
      const cand7 = 70 + numVal;
      const diff8 = Math.abs(cand8 - siblingQuarter);
      const diff7 = Math.abs(cand7 - siblingQuarter);

      if (diff8 <= 6 && (diff7 > 6 || diff8 <= diff7)) {
        return {
          grade: cand8,
          wasRecovered: true,
          isInvalidFormat: false,
          recoveryReason: `Recovered single-digit "${numVal}" to ${cand8} based on sibling quarter (${siblingQuarter})`,
        };
      }
      if (diff7 <= 6 && (diff8 > 6 || diff7 < diff8)) {
        return {
          grade: cand7,
          wasRecovered: true,
          isInvalidFormat: false,
          recoveryReason: `Recovered single-digit "${numVal}" to ${cand7} based on sibling quarter (${siblingQuarter})`,
        };
      }
    }

    // Ambiguous single digit without sufficient context: return grade: null rather than marking 8 as FAILED!
    return {
      grade: null,
      wasRecovered: false,
      isInvalidFormat: false,
      recoveryReason: `Ambiguous single-digit "${numVal}" without sufficient context`,
    };
  }

  // Rule B - Case 2: Leading-1 misread from handwritten 8 or 7 (10–19, e.g. "16" for "86" or "19" for "79")
  if (numVal >= 10 && numVal <= 19) {
    const d = numVal % 10;
    const cand8 = 80 + d;
    const cand7 = 70 + d;

    // Check against expected average from Q1 and Q2
    if (expectedAvg !== null) {
      if (cand8 === expectedAvg) {
        return {
          grade: cand8,
          wasRecovered: true,
          isInvalidFormat: false,
          recoveryReason: `Recovered leading-1 misread "${numVal}" to ${cand8} based on Q1 (${q1}) and Q2 (${q2}) average`,
        };
      }
      if (cand7 === expectedAvg) {
        return {
          grade: cand7,
          wasRecovered: true,
          isInvalidFormat: false,
          recoveryReason: `Recovered leading-1 misread "${numVal}" to ${cand7} based on Q1 (${q1}) and Q2 (${q2}) average`,
        };
      }
      if (Math.abs(cand8 - expectedAvg) <= 2 && Math.abs(cand8 - expectedAvg) < Math.abs(cand7 - expectedAvg)) {
        return {
          grade: cand8,
          wasRecovered: true,
          isInvalidFormat: false,
          recoveryReason: `Recovered leading-1 misread "${numVal}" to ${cand8} based on Q1 (${q1}) and Q2 (${q2}) average (${expectedAvg})`,
        };
      }
      if (Math.abs(cand7 - expectedAvg) <= 2 && Math.abs(cand7 - expectedAvg) < Math.abs(cand8 - expectedAvg)) {
        return {
          grade: cand7,
          wasRecovered: true,
          isInvalidFormat: false,
          recoveryReason: `Recovered leading-1 misread "${numVal}" to ${cand7} based on Q1 (${q1}) and Q2 (${q2}) average (${expectedAvg})`,
        };
      }
    }

    // Check against sibling quarter
    if (isValidDepEd(siblingQuarter)) {
      const diff8 = Math.abs(cand8 - siblingQuarter);
      const diff7 = Math.abs(cand7 - siblingQuarter);

      if (diff7 <= 6 && (diff8 > 6 || diff7 <= diff8)) {
        return {
          grade: cand7,
          wasRecovered: true,
          isInvalidFormat: false,
          recoveryReason: `Recovered leading-1 misread "${numVal}" to ${cand7} based on sibling quarter (${siblingQuarter})`,
        };
      }
      if (diff8 <= 6 && (diff7 > 6 || diff8 < diff7)) {
        return {
          grade: cand8,
          wasRecovered: true,
          isInvalidFormat: false,
          recoveryReason: `Recovered leading-1 misread "${numVal}" to ${cand8} based on sibling quarter (${siblingQuarter})`,
        };
      }
    }

    // Ambiguous leading-1 without context: return grade: null rather than FAILED!
    return {
      grade: null,
      wasRecovered: false,
      isInvalidFormat: true,
      recoveryReason: `Ambiguous leading-1 misread "${numVal}" without sufficient context`,
    };
  }

  // Rule B - Case 3: Out-of-range (< 60 or > 100) that cannot be safely recovered
  return {
    grade: null,
    wasRecovered: false,
    isInvalidFormat: true,
    recoveryReason: `Out-of-range DepEd grade: ${numVal}`,
  };
}

/**
 * CENTRAL DYNAMIC GRADE STATUS & REMARK EVALUATOR
 *
 * Implements authoritative DepEd grading rules and OCR confidence handling:
 * - Case A — Empty / Unread: Returns 'Blank' / 'Blank / Incomplete' (status: 'blank').
 *   NEVER defaults an empty or unread cell to 'PASSED' or 'FAILED'.
 * - Case B — Low OCR Confidence (< 65%) or garbled text: Returns 'Not Recognized (XX%)' (status: 'not_recognized').
 *   Does NOT classify low-confidence text as 'PASSED' or 'FAILED'.
 * - Case C — Read With Sufficient Confidence (>= 65% or undefined) & Valid Numeric Grade:
 *   Computes official DepEd remark dynamically: PASSED (>= 75) or FAILED (< 75),
 *   unless an explicit valid physical remark (Passed/Failed/Incomplete/Dropped/Transferred)
 *   was clearly extracted at >= 65% confidence.
 */
export function evaluateDynamicGradeStatus(params: DynamicGradeStatusParams): DynamicGradeStatusResult {
  let confPct: number | undefined = undefined;
  if (params.confidencePercent !== undefined && params.confidencePercent !== null) {
    const rawC = typeof params.confidencePercent === "number"
      ? params.confidencePercent
      : parseFloat(String(params.confidencePercent));
    if (!isNaN(rawC)) {
      if (rawC > 0 && rawC <= 1) {
        confPct = Math.min(100, Math.max(0, Math.round(rawC * 100)));
      } else {
        confPct = Math.min(100, Math.max(0, Math.round(rawC)));
      }
    }
  }

  const gradeRaw = params.grade;
  const isBlank = isBlankOrMissingFinal(gradeRaw);
  const cleanRemark = params.rawRemark ? String(params.rawRemark).trim() : "";

  // CASE A: Empty / Unread grade cell
  if (isBlank) {
    // If an explicit non-passing/failing physical status is clearly present (e.g. INCOMPLETE / DROPPED)
    if (/^(?:inc|incomplete)$/i.test(cleanRemark)) {
      return {
        gradeDisplay: "Blank",
        remarkDisplay: "Incomplete",
        status: "incomplete",
        officialRemark: "INCOMPLETE",
        confidencePercent: confPct,
        isLowConfidence: false,
        isValidNumeric: false,
      };
    }
    if (/^(?:drp|dropped)$/i.test(cleanRemark)) {
      return {
        gradeDisplay: "Blank",
        remarkDisplay: "Dropped",
        status: "dropped",
        officialRemark: "DROPPED",
        confidencePercent: confPct,
        isLowConfidence: false,
        isValidNumeric: false,
      };
    }
    if (/^(?:transferred|transferred\s*out)$/i.test(cleanRemark)) {
      return {
        gradeDisplay: "Blank",
        remarkDisplay: "Transferred",
        status: "transferred",
        officialRemark: "TRANSFERRED",
        confidencePercent: confPct,
        isLowConfidence: false,
        isValidNumeric: false,
      };
    }

    // Default unread/empty: NEVER default to PASSED or FAILED
    return {
      gradeDisplay: "Blank",
      remarkDisplay: "Blank / Incomplete",
      status: "blank",
      officialRemark: "BLANK / INCOMPLETE",
      confidencePercent: confPct,
      isLowConfidence: false,
      isValidNumeric: false,
    };
  }

  // Non-numeric candidate: check for valid non-numeric marks vs garbled text
  const gradeStr = String(gradeRaw).trim();
  if (/^(?:inc|incomplete)$/i.test(gradeStr) || /^(?:inc|incomplete)$/i.test(cleanRemark)) {
    return {
      gradeDisplay: "Incomplete",
      remarkDisplay: "Incomplete",
      status: "incomplete",
      officialRemark: "INCOMPLETE",
      confidencePercent: confPct,
      isLowConfidence: false,
      isValidNumeric: false,
    };
  }
  if (/^(?:drp|dropped)$/i.test(gradeStr) || /^(?:drp|dropped)$/i.test(cleanRemark)) {
    return {
      gradeDisplay: "Dropped",
      remarkDisplay: "Dropped",
      status: "dropped",
      officialRemark: "DROPPED",
      confidencePercent: confPct,
      isLowConfidence: false,
      isValidNumeric: false,
    };
  }
  if (/^(?:transferred|transferred\s*out)$/i.test(gradeStr) || /^(?:transferred)$/i.test(cleanRemark)) {
    return {
      gradeDisplay: "Transferred",
      remarkDisplay: "Transferred",
      status: "transferred",
      officialRemark: "TRANSFERRED",
      confidencePercent: confPct,
      isLowConfidence: false,
      isValidNumeric: false,
    };
  }

  // Strict Digits-Only Sanitizer & Handwritten 8/7 Homoglyph Recovery
  const sanitized = sanitizeAndRecoverDepEdGrade({
    rawGrade: gradeRaw,
    q1: params.q1,
    q2: params.q2,
    siblingQuarter: params.siblingQuarter,
    confidencePercent: confPct,
    allowDecimal: params.allowDecimal,
    isGeneralAverage: params.isGeneralAverage,
  });

  // CASE 1: Grade was safely recovered (e.g. 8 -> 88, 16 -> 86, 19 -> 79)
  if (sanitized.wasRecovered && sanitized.grade !== null) {
    const recoveredNum = sanitized.grade;
    // Cap confidence slightly at 85% for recovered grades as instructed
    confPct = confPct !== undefined ? Math.min(confPct, 85) : 85;
    const isPassed = recoveredNum >= 75;
    return {
      gradeDisplay: String(recoveredNum),
      remarkDisplay: isPassed ? "PASSED" : "FAILED",
      status: isPassed ? "passed" : "failed",
      officialRemark: isPassed ? "PASSED" : "FAILED",
      numericGrade: recoveredNum,
      confidencePercent: confPct,
      isLowConfidence: false,
      isValidNumeric: true,
      wasRecovered: true,
      recoveryReason: sanitized.recoveryReason,
    };
  }

  // CASE 2: Invalid format (>3 digits, letters) or unrecovered out-of-range (<60 or >100)
  // NEVER classify an unrecovered out-of-range number (e.g. 8, 16, 32, 1234) as FAILED!
  if (sanitized.isInvalidFormat || sanitized.grade === null) {
    const badgeText = confPct !== undefined && confPct < 65 ? `Not Recognized (${confPct}%)` : "Not Recognized";
    return {
      gradeDisplay: gradeStr,
      remarkDisplay: badgeText,
      status: "not_recognized",
      officialRemark: "NOT RECOGNIZED",
      confidencePercent: confPct,
      isLowConfidence: true,
      isValidNumeric: false,
    };
  }

  // Valid numeric grade strictly in DepEd range (60 to 100)
  const parsedNum = sanitized.grade;

  // CASE B: Read with Low OCR Confidence (< 65%)
  const isLowConfidence = confPct !== undefined && confPct < 65;
  if (isLowConfidence) {
    const badgeText = `Not Recognized (${confPct}%)`;
    const gradeDisplay =
      (params.allowDecimal || params.isGeneralAverage) && parsedNum % 1 !== 0
        ? parsedNum.toFixed(1)
        : String(Math.round(parsedNum));
    return {
      gradeDisplay,
      remarkDisplay: badgeText,
      status: "not_recognized",
      officialRemark: "NOT RECOGNIZED",
      numericGrade: parsedNum,
      confidencePercent: confPct,
      isLowConfidence: true,
      isValidNumeric: true,
    };
  }

  // CASE C: Read With Sufficient Confidence (>= 65% or undefined) & Valid Numeric Grade (60–100)
  // Compute official DepEd remark dynamically: PASSED (>= 75) or FAILED (< 75)
  const isPassed = parsedNum >= 75.0;
  const gradeDisplay =
    (params.allowDecimal || params.isGeneralAverage) && parsedNum % 1 !== 0
      ? parsedNum.toFixed(1)
      : String(Math.round(parsedNum));
  return {
    gradeDisplay,
    remarkDisplay: isPassed ? "PASSED" : "FAILED",
    status: isPassed ? "passed" : "failed",
    officialRemark: isPassed ? "PASSED" : "FAILED",
    numericGrade: parsedNum,
    confidencePercent: confPct !== undefined ? confPct : 95,
    isLowConfidence: false,
    isValidNumeric: true,
  };
}

/**
 * Parses a quarter cell value into a clean number, or undefined if blank/unreadable/non-numeric.
 */
export function parseQuarterNumeric(val: number | string | undefined | null): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (isBlankOrMissingFinal(val)) return undefined;
  if (typeof val === "number") {
    if (isNaN(val)) return undefined;
    if (val >= 60 && val <= 100) return val;
  }
  const sanitized = sanitizeAndRecoverDepEdGrade({ rawGrade: val });
  if (sanitized.grade !== null) return sanitized.grade;
  const str = String(val).trim();
  const match = str.match(/^-?(\d+(?:\.\d+)?)$/);
  if (match) {
    const parsed = parseFloat(match[1]);
    if (!isNaN(parsed) && parsed >= 60 && parsed <= 100) return parsed;
  }
  return undefined;
}

/**
 * AUTHORITATIVE SEMESTER FINAL GRADE RESOLVER
 *
 * Bakit ito ginawa:
 * Sa Senior High School curriculum, magkaiba ang grado para sa First Semester at Second Semester.
 * Mahigpit nating pinipigilan ang "cross-semester contamination" — ibig sabihin,
 * hindi dapat mapunta ang sem1 grade sa sem2 o baligtad.
 * Sinisiguro ng function na ito na ang tamang semestral grade ang kinukuha.
 */
export function getAuthoritativeSemesterFinalGrade(
  g: GradeRecord | undefined | null,
  semesterContext?: string
): number | string | undefined {
  if (!g) return undefined;

  const sem = normalizeSemesterContext(g.semester) || normalizeSemesterContext(semesterContext);

  // 1. Explicit 1st Semester: kunin ang sem1_final_grade kung may laman
  if (sem === "1st Semester") {
    if (!isBlankOrMissingFinal(g.sem1_final_grade)) {
      return g.sem1_final_grade ?? undefined;
    }
    return isBlankOrMissingFinal(g.final) ? undefined : (g.final ?? undefined);
  }

  // 2. Explicit 2nd Semester: kunin ang sem2_final_grade kung may laman
  if (sem === "2nd Semester") {
    if (!isBlankOrMissingFinal(g.sem2_final_grade)) {
      return g.sem2_final_grade ?? undefined;
    }
    return isBlankOrMissingFinal(g.final) ? undefined : (g.final ?? undefined);
  }

  // 3. Fallback: kung walang explicit semester label pero isa lang ang populated, gamitin iyon
  if (!isBlankOrMissingFinal(g.sem1_final_grade) && isBlankOrMissingFinal(g.sem2_final_grade)) {
    return g.sem1_final_grade ?? undefined;
  }

  if (!isBlankOrMissingFinal(g.sem2_final_grade) && isBlankOrMissingFinal(g.sem1_final_grade)) {
    return g.sem2_final_grade ?? undefined;
  }

  return isBlankOrMissingFinal(g.final) ? undefined : (g.final ?? undefined);
}

/**
 * RAW ARITHMETIC SEMESTER FINAL GRADE COMPUTATION
 *
 * Kinakalkula ang exactong arithmetic average ng dalawang quarters: (qA + qB) / 2
 * Ipinapanatili ang eksaktong decimal marks (hal. 74.5, 91.5, 87.5) para sa transparency
 * at discrepancy analysis bago ilapat ang DepEd rounding.
 */
export function computeRawSemesterFinalGrade(
  qA: number | string | undefined | null,
  qB: number | string | undefined | null
): number | undefined {
  const numA = parseQuarterNumeric(qA);
  const numB = parseQuarterNumeric(qB);

  if (numA === undefined || numB === undefined) return undefined;

  const raw = (numA + numB) / 2;
  return Number(raw.toFixed(4));
}

/**
 * Standard DepEd whole-number rounding for display:
 * .50 and above rounds up; below .50 rounds down.
 */
export function roundDisplayedGrade(val: number | string | undefined | null): number | undefined {
  if (val === undefined || val === null) return undefined;
  const num = typeof val === "number" ? val : parseFloat(String(val).trim());
  if (isNaN(num)) return undefined;
  return Math.round(num);
}

/**
 * Formats a grade for regular student-facing SF9 display.
 * Displays the rounded whole-number grade where required.
 * Standard rounding: .50 and above rounds up; below .50 rounds down.
 * Does not display unnecessary decimal places in regular SF9 grade output.
 */
export function formatDisplayedGrade(grade: number | string | undefined | null): string {
  if (isBlankOrMissingFinal(grade)) return "—";
  const num = typeof grade === "number" ? grade : parseFloat(String(grade).trim());
  if (isNaN(num)) return String(grade);
  return String(Math.round(num));
}

/**
 * Formats a grade with full precision or specified decimal places.
 * Used for awardee evaluation, ranking, comparisons, and audit logs.
 */
export function formatPreciseGrade(grade: number | string | undefined | null, decimals: number = 2): string {
  if (isBlankOrMissingFinal(grade)) return "—";
  const num = typeof grade === "number" ? grade : parseFloat(String(grade).trim());
  if (isNaN(num)) return String(grade);
  return num.toFixed(decimals);
}

/**
 * DEPED OFFICIAL SEMESTER FINAL GRADE COMPUTATION (DO 8, s. 2015)
 *
 * Kinakalkula ang opisyal na semestral final grade ayon sa DepEd Order No. 8, s. 2015:
 * Whole-number half-up rounding: Math.round((qA + qB) / 2)
 * Halimbawa: 87.5 -> 88, 74.5 -> 75, 74.49 -> 74.
 *
 * Zero Grade Invention: Kung kulang o non-numeric ang alinmang quarter,
 * ibinabalik nito ang undefined upang hindi mag-imbento ng grado.
 */
export function computeOfficialSemesterFinalGrade(
  qA: number | string | undefined | null,
  qB: number | string | undefined | null
): number | undefined {
  const numA = parseQuarterNumeric(qA);
  const numB = parseQuarterNumeric(qB);

  if (numA === undefined || numB === undefined) return undefined;

  return Math.round((numA + numB) / 2);
}

/**
 * Backward compatibility alias para sa computeOfficialSemesterFinalGrade
 */
export function computeSemesterFinalGrade(
  qA: number | string | undefined | null,
  qB: number | string | undefined | null
): number | undefined {
  return computeOfficialSemesterFinalGrade(qA, qB);
}

/**
 * DEPED K-12 SHS GRADE STATUS RECALCULATOR & VERIFICATION FLAGS
 *
 * Ipinapatupad dito ang opisyal na DepEd K-12 Senior High School grading rules:
 * 1. Automatic Computation for Blank Finals:
 *    Kapag blank ang final grade ngunit kumpleto at valid ang quarterly marks, kinakalkula
 *    ang candidate final grade gamit ang official DepEd whole-number rounding at itinatabi
 *    ang raw calculated grade. Minamarkahan ito ng `is_auto_computed = true`.
 * 2. Non-Destructive Preservation & Discrepancy Detection:
 *    Kung may nakasulat/na-extract na printed final grade (hal. Earth Science printed 91 vs computed 86),
 *    HINDI ito io-overwrite! Kinukumpara ang printed laban sa computed. Kapag magkaiba,
 *    itinatala ang `has_calculation_discrepancy = true` at `needsVerification = true`.
 * 3. Passing Mark:
 *    Grade >= 75 ay "Passed". Grade < 75 ay "Failed".
 * 4. Borderline Verification (72 to 77):
 *    Kapag ang grado ay nasa [72, 77], automatic na tinatatakan ng `needsVerification = true`.
 * 5. Remedial Class Computation:
 *    Kung bagsak (< 75) at may remedial_class_mark, kinakalkula ang recomputed final:
 *    Math.round((failed_final + remedial_mark) / 2).
 */
export function recalculateSubjectGradeStatus(
  record: GradeRecord,
  semesterContext?: string
): GradeRecord {
  const updated: GradeRecord = { ...record };
  if (updated.confidence === undefined) {
    updated.confidence = updated.icr_confidence ?? 0.95;
  }

  const effectiveSem =
    normalizeSemesterContext(updated.semester) || normalizeSemesterContext(semesterContext);

  let numQ1 = parseQuarterNumeric(updated.q1);
  let numQ2 = parseQuarterNumeric(updated.q2);
  let numQ3 = parseQuarterNumeric(updated.q3);
  let numQ4 = parseQuarterNumeric(updated.q4);

  // Alamin kung may quarters na pwedeng kwentahin ayon sa semester
  let qA: number | string | undefined | null = undefined;
  let qB: number | string | undefined | null = undefined;

  if (effectiveSem === "2nd Semester") {
    // Second Semester: Quarters MUST strictly be Q3 and Q4.
    // If q1/q2 were populated from a 2nd semester table labeled "1 & 2", migrate them to Q3/Q4 and clear Q1/Q2
    if (numQ3 === undefined && numQ4 === undefined && (numQ1 !== undefined || numQ2 !== undefined)) {
      updated.q3 = updated.q1;
      updated.q4 = updated.q2;
      updated.q1 = undefined;
      updated.q2 = undefined;
      numQ3 = parseQuarterNumeric(updated.q3);
      numQ4 = parseQuarterNumeric(updated.q4);
    }
    // Strict isolation: clear any lingering Q1/Q2 marks on a 2nd Semester record
    updated.q1 = undefined;
    updated.q2 = undefined;
    updated.sem1_final_grade = undefined;

    qA = numQ3 !== undefined ? updated.q3 : undefined;
    qB = numQ4 !== undefined ? updated.q4 : undefined;
    if (!updated.semester) {
      updated.semester = "2nd Semester";
    }
  } else if (effectiveSem === "1st Semester") {
    // First Semester: Quarters MUST strictly be Q1 and Q2.
    // If q3/q4 were erroneously attached to a 1st semester record, migrate to Q1/Q2 and clear Q3/Q4
    if (numQ1 === undefined && numQ2 === undefined && (numQ3 !== undefined || numQ4 !== undefined)) {
      updated.q1 = updated.q3;
      updated.q2 = updated.q4;
      updated.q3 = undefined;
      updated.q4 = undefined;
      numQ1 = parseQuarterNumeric(updated.q1);
      numQ2 = parseQuarterNumeric(updated.q2);
    }
    // Strict isolation: clear any lingering Q3/Q4 marks on a 1st Semester record
    updated.q3 = undefined;
    updated.q4 = undefined;
    updated.sem2_final_grade = undefined;

    qA = numQ1 !== undefined ? updated.q1 : undefined;
    qB = numQ2 !== undefined ? updated.q2 : undefined;
    if (!updated.semester) {
      updated.semester = "1st Semester";
    }
  } else {
    // Unspecified semester: detect from populated valid quarter numbers
    if (numQ3 !== undefined && numQ4 !== undefined && (numQ1 === undefined || numQ2 === undefined)) {
      qA = updated.q3;
      qB = updated.q4;
      updated.semester = "2nd Semester";
      updated.q1 = undefined;
      updated.q2 = undefined;
      updated.sem1_final_grade = undefined;
    } else if (numQ1 !== undefined && numQ2 !== undefined && (numQ3 === undefined || numQ4 === undefined)) {
      qA = updated.q1;
      qB = updated.q2;
      updated.semester = "1st Semester";
      updated.q3 = undefined;
      updated.q4 = undefined;
      updated.sem2_final_grade = undefined;
    } else if (numQ1 !== undefined && numQ2 !== undefined) {
      qA = updated.q1;
      qB = updated.q2;
    } else if (numQ3 !== undefined && numQ4 !== undefined) {
      qA = updated.q3;
      qB = updated.q4;
    }
  }

  const rawGrade = computeRawSemesterFinalGrade(qA, qB);
  const officialGrade = computeOfficialSemesterFinalGrade(qA, qB);

  if (rawGrade !== undefined) {
    updated.precise_computed_grade = rawGrade;
    updated.raw_calculated_final = rawGrade;
    updated.computed_final_grade = rawGrade; // Preserve precise decimal
    updated.computation_formula = "arithmetic_quarter_mean: (qA + qB) / 2";
    if (!updated.grading_policy_version) {
      updated.grading_policy_version = "DO 8, s. 2015 / DO 36, s. 2016";
    }
  }
  if (officialGrade !== undefined) {
    updated.displayed_grade = officialGrade;
    updated.displayed_final_grade = officialGrade;
    updated.official_computed_final = officialGrade;
  }

  // Alamin ang authoritative semestral final grade
  const candidate = getAuthoritativeSemesterFinalGrade(updated, effectiveSem);
  const isCandidateBlank = isBlankOrMissingFinal(candidate);

  // CASE 1: BLANK / MISSING SEMESTER FINAL GRADE
  // STRICT DepEd & AVV RULE: NEVER auto-calculate final_grade, final, sem1_final_grade,
  // or sem2_final_grade when that cell is blank on the uploaded card. Only store values
  // explicitly written/printed on the document.
  if (isCandidateBlank) {
    const targetSem = normalizeSemesterContext(updated.semester) || effectiveSem;
    updated.final = null;
    updated.final_grade = null;
    if (targetSem === "1st Semester") {
      updated.sem1_final_grade = null;
    } else if (targetSem === "2nd Semester") {
      updated.sem2_final_grade = null;
    } else {
      updated.sem1_final_grade = null;
      updated.sem2_final_grade = null;
    }

    updated.displayed_grade = undefined;
    updated.displayed_final_grade = undefined;
    updated.official_computed_final = undefined;
    updated.is_auto_computed = false;
    updated.grade_source = "blank";
    updated.status = "Missing";
    updated.remarks = "Blank / Incomplete";
    updated.remark = "Blank / Incomplete";
    updated.needsVerification = true;
    updated.has_calculation_discrepancy = false;
    updated.calculation_notes =
      "Blank / Incomplete final grade cell on uploaded card - automatic calculation disabled. Requires teacher verification.";
    return updated;
  }

  // CASE 2: CANDIDATE FINAL GRADE ALREADY PRESENT (Extracted from OCR or manually edited)
  // Preserve original printed SF9 grade and original extracted OCR grade
  if (updated.printed_final_grade === undefined && candidate !== undefined) {
    updated.printed_final_grade = candidate;
  }
  if (updated.ocr_final_grade === undefined && (updated.grade_source === "ocr" || !updated.grade_source) && candidate !== undefined) {
    updated.ocr_final_grade = candidate;
  }

  // Synchronize across properties based on semester context
  const targetSem = normalizeSemesterContext(updated.semester) || effectiveSem;
  if (targetSem === "1st Semester") {
    updated.sem1_final_grade = candidate;
    updated.final = candidate;
    updated.final_grade = candidate;
  } else if (targetSem === "2nd Semester") {
    updated.sem2_final_grade = candidate;
    updated.final = candidate;
    updated.final_grade = candidate;
  } else {
    updated.final = candidate;
    updated.final_grade = candidate;
    if (updated.sem1_final_grade !== undefined && updated.sem2_final_grade === undefined) {
      updated.sem1_final_grade = candidate;
    } else if (updated.sem2_final_grade !== undefined && updated.sem1_final_grade === undefined) {
      updated.sem2_final_grade = candidate;
    }
  }

  if (!updated.grade_source) {
    updated.grade_source = updated.is_auto_computed ? "auto_computed" : "ocr";
  }
  updated.is_auto_computed = updated.is_auto_computed || false;

  // Check if numeric
  const candidateStr = String(candidate).trim();
  const numMatch = candidateStr.match(/^-?(\d+(?:\.\d+)?)$/);

  // Dynamic Grade Status Evaluation
  const dynamicStatus = evaluateDynamicGradeStatus({
    grade: candidate,
    rawRemark: updated.remarks || updated.remark || updated.action_taken,
    confidencePercent: updated.confidence,
  });

  if (numMatch) {
    const num = parseFloat(numMatch[1]);
    if (!isNaN(num)) {
      if (dynamicStatus.isLowConfidence) {
        updated.status = "Missing";
        updated.remarks = dynamicStatus.remarkDisplay;
        updated.remark = dynamicStatus.remarkDisplay;
      } else {
        updated.status = num >= 75 ? "Passed" : "Failed";
        updated.remarks = dynamicStatus.remarkDisplay;
        updated.remark = dynamicStatus.remarkDisplay;
      }
      updated.displayed_grade = Math.round(num);
      updated.displayed_final_grade = Math.round(num);

      if (rawGrade !== undefined) {
        updated.precise_computed_grade = rawGrade;
        updated.raw_calculated_final = rawGrade;
        updated.computed_final_grade = rawGrade;
      }

      // Kung bagsak (< 75), itala ang failed_final_grade at suriin kung may remedial_class_mark
      if (num < 75) {
        if (!updated.failed_final_grade) {
          updated.failed_final_grade = num;
        }
        if (
          updated.remedial_class_mark !== undefined &&
          updated.remedial_class_mark !== null &&
          String(updated.remedial_class_mark).trim() !== ""
        ) {
          const rMark =
            typeof updated.remedial_class_mark === "number"
              ? updated.remedial_class_mark
              : parseFloat(String(updated.remedial_class_mark));
          if (!isNaN(rMark)) {
            const recomputed = (num + rMark) / 2;
            updated.recomputed_final_grade = Number(recomputed.toFixed(2));
          }
        }
      }

      // Borderline final grade warning [72, 77] or low confidence
      let needsVerif = (num >= 72 && num <= 77) || dynamicStatus.isLowConfidence;

      // Also check quarterly marks for borderline warnings
      const quarters = [numQ1, numQ2, numQ3, numQ4];
      for (const q of quarters) {
        if (typeof q === "number" && q >= 72 && q <= 77) {
          needsVerif = true;
          break;
        }
      }

      // Discrepancy detection sa pagitan ng printed final at computed average ng quarters
      if (officialGrade !== undefined) {
        const printedRounded = Math.round(num);
        if (printedRounded !== officialGrade) {
          updated.has_calculation_discrepancy = true;
          needsVerif = true;
          updated.calculation_notes = `Discrepancy sa grado: Ang nakasulat na final grade ay ${candidateStr}, ngunit ang computed average ng quarters ay ${officialGrade}${rawGrade !== undefined ? ` (raw: ${rawGrade})` : ""}.`;
        } else {
          updated.has_calculation_discrepancy = false;
        }
      }

      updated.needsVerification = needsVerif;
      return updated;
    }
  }

  // DepEd non-numeric mark (e.g., INC, DRP, N/A) or low confidence / garbled
  updated.status = "Missing";
  updated.remarks = dynamicStatus.remarkDisplay;
  updated.remark = dynamicStatus.remarkDisplay;
  updated.needsVerification = true;
  if (officialGrade !== undefined) {
    updated.has_calculation_discrepancy = true;
    updated.calculation_notes = `Nakasulat na marka ay "${candidateStr}", ngunit may computed quarter average na ${officialGrade}${rawGrade !== undefined ? ` (raw: ${rawGrade})` : ""}. Kailangan itong i-verify ng guro.`;
  }
  return updated;
}

/**
 * Normalizes an array of grade records, updating status and synchronizing final fields.
 */
export function normalizeGradeRecords(
  grades: GradeRecord[] | undefined | null,
  semesterContext?: string
): GradeRecord[] {
  if (!Array.isArray(grades)) return [];
  return grades.map((g) => recalculateSubjectGradeStatus(g, semesterContext));
}

export interface SemesterAverageResult {
  rawAverage?: number;
  officialAverage?: number;
  preciseAverage?: number;
  displayedAverage?: number;
  subjectCount: number;
  completeness: "COMPLETE" | "INCOMPLETE" | "EMPTY";
  pendingSubjects?: string[];
  eligibleGrades: GradeRecord[];
  confidence?: number;
}

/**
 * Normalizes an honest confidence score (ratio 0-1 or percentage 0-100) into integer percentage 0-100.
 */
export function getConfidencePercentage(conf?: number | null): number {
  if (typeof conf !== "number" || isNaN(conf)) return 0;
  if (conf > 0 && conf <= 1) return Math.min(100, Math.max(0, Math.round(conf * 100)));
  return Math.min(100, Math.max(0, Math.round(conf)));
}

/**
 * Filter grades for a specific semester in SHS.
 */
export function getSemesterGrades(
  grades: GradeRecord[] | undefined | null,
  semester: "1st Semester" | "2nd Semester"
): GradeRecord[] {
  if (!Array.isArray(grades)) return [];

  return grades.filter((g) => {
    // Exclude empty rows, non-academic labels, attendance, core values, or dummy rows
    if (!g.subject || g.subject.trim() === "") return false;
    const subjLower = g.subject.toLowerCase();
    if (
      subjLower.includes("attendance") ||
      subjLower.includes("observed values") ||
      subjLower.includes("core values") ||
      subjLower.includes("general average")
    ) {
      return false;
    }

    const semNorm = normalizeSemesterContext(g.semester);
    const hasQ1Q2 =
      parseQuarterNumeric(g.q1) !== undefined ||
      parseQuarterNumeric(g.q2) !== undefined ||
      parseQuarterNumeric(g.sem1_final_grade) !== undefined;
    const hasQ3Q4 =
      parseQuarterNumeric(g.q3) !== undefined ||
      parseQuarterNumeric(g.q4) !== undefined ||
      parseQuarterNumeric(g.sem2_final_grade) !== undefined;

    if (semester === "1st Semester") {
      if (semNorm === "1st Semester") return true;
      if (semNorm === "2nd Semester") return false;
      return hasQ1Q2 && !hasQ3Q4;
    } else {
      if (semNorm === "2nd Semester") return true;
      if (semNorm === "1st Semester") return false;
      return hasQ3Q4 && !hasQ1Q2;
    }
  });
}

/**
 * DEPED SEMESTER GENERAL AVERAGE COMPUTATION
 *
 * Formula: General Average = Sum of Subject Final Grades / Number of Subjects
 *
 * Rules:
 * 1. Number of subjects is determined dynamically (never hardcode 9).
 * 2. If 0 eligible subjects exist (e.g. 2nd semester not yet scanned), returns completeness = "EMPTY".
 * 3. Completeness requirement: If any eligible subject has missing, blank, or non-numeric final grade,
 *    returns completeness = "INCOMPLETE", without finalizing the official general average.
 * 4. When complete, official general average is presented with full decimal precision (e.g. 85.94)
 *    and also provides the rounded whole-number display value (e.g. 86) for regular SF9 student card output.
 */
export function computeSemesterGeneralAverage(
  grades: GradeRecord[] | undefined | null,
  semester: "1st Semester" | "2nd Semester"
): SemesterAverageResult {
  const eligible = getSemesterGrades(grades, semester);

  if (eligible.length === 0) {
    return {
      subjectCount: 0,
      completeness: "EMPTY",
      eligibleGrades: [],
    };
  }

  const pendingSubjects: string[] = [];
  let sumOfficial = 0;
  let sumRaw = 0;
  const recalculatedEligible: GradeRecord[] = [];

  for (const rawG of eligible) {
    // Ensure grade candidate calculation runs if quarters are valid
    const g = recalculateSubjectGradeStatus(rawG, semester);
    recalculatedEligible.push(g);
    const finalVal = getAuthoritativeSemesterFinalGrade(g, semester);

    if (isBlankOrMissingFinal(finalVal)) {
      pendingSubjects.push(g.subject);
      continue;
    }

    const num = typeof finalVal === "number" ? finalVal : parseFloat(String(finalVal).trim());
    if (isNaN(num)) {
      // Non-numeric mark like "INC", "DRP"
      pendingSubjects.push(g.subject);
      continue;
    }

    // Authoritative Printed Grade preservation:
    // If an official printed final grade exists on the SF9 document, it remains authoritative.
    // An unverified computed discrepancy must never silently replace the official printed grade.
    const authoritativeFinal = g.printed_final_grade !== undefined && g.printed_final_grade !== null
      ? (typeof g.printed_final_grade === "number" ? g.printed_final_grade : parseFloat(String(g.printed_final_grade)))
      : num;

    const authoritativeNum = isNaN(authoritativeFinal) ? num : authoritativeFinal;

    // Use preciseComputedGrade when auto-computed without discrepancy,
    // but if an unverified discrepancy exists, the authoritative printed grade remains in place.
    const preciseVal = (g.has_calculation_discrepancy && g.needsVerification)
      ? authoritativeNum
      : (typeof g.precise_computed_grade === "number"
          ? g.precise_computed_grade
          : (typeof g.raw_calculated_final === "number" ? g.raw_calculated_final : authoritativeNum));

    sumOfficial += authoritativeNum;
    sumRaw += preciseVal;
  }

  const subjectCount = eligible.length;

  if (pendingSubjects.length > 0) {
    return {
      subjectCount,
      completeness: "INCOMPLETE",
      pendingSubjects,
      eligibleGrades: recalculatedEligible,
    };
  }

  const rawAvg = Number((sumRaw / subjectCount).toFixed(2));
  const preciseAvg = Number((sumRaw / subjectCount).toFixed(4));
  const displayedAvg = Math.round(rawAvg);
  const officialAvg = rawAvg;

  const confidences = recalculatedEligible
    .map((g) => (typeof g.confidence === "number" ? g.confidence : typeof g.icr_confidence === "number" ? g.icr_confidence : 0.95))
    .filter((c) => !isNaN(c));
  const avgConfidence =
    confidences.length > 0
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(4))
      : 0.95;

  return {
    rawAverage: rawAvg,
    officialAverage: officialAvg,
    preciseAverage: preciseAvg,
    displayedAverage: displayedAvg,
    subjectCount,
    completeness: "COMPLETE",
    pendingSubjects: [],
    eligibleGrades: recalculatedEligible,
    confidence: avgConfidence,
  };
}

/**
 * Evaluates whether an SF9 extraction has any blank Quarter grades, blank Final grades,
 * or blank Semester / Annual General Averages.
 */
export function hasBlankGradeError(fields?: ExtractedFields | null): boolean {
  if (!fields) return false;
  const grades = Array.isArray(fields.grades) ? fields.grades : [];
  if (grades.length === 0) return false;

  const hasBlankSubject = grades.some((g) => {
    const sem = normalizeSemesterContext(g.semester);
    if (sem === "2nd Semester") {
      if (isBlankOrMissingFinal(g.q3) || isBlankOrMissingFinal(g.q4)) return true;
    } else if (sem === "1st Semester") {
      if (isBlankOrMissingFinal(g.q1) || isBlankOrMissingFinal(g.q2)) return true;
    } else {
      const hasAnyQ = !isBlankOrMissingFinal(g.q1) || !isBlankOrMissingFinal(g.q2) || !isBlankOrMissingFinal(g.q3) || !isBlankOrMissingFinal(g.q4);
      if (hasAnyQ) {
        if (isBlankOrMissingFinal(g.q1) && isBlankOrMissingFinal(g.q3)) return true;
        if (isBlankOrMissingFinal(g.q2) && isBlankOrMissingFinal(g.q4)) return true;
      }
    }
    const finalVal = g.final ?? g.final_grade ?? (sem === "2nd Semester" ? g.sem2_final_grade : g.sem1_final_grade);
    return isBlankOrMissingFinal(finalVal) || finalVal === null;
  });

  const hasBlankGenAvg = isBlankOrMissingFinal(fields.general_average) || fields.general_average === null;

  return hasBlankSubject || hasBlankGenAvg;
}

/**
 * Updates ExtractedFields with calculated semester general averages metadata.
 * Strictly adheres to AVV Rule: NEVER auto-calculate general_average, sem1_general_average,
 * sem2_general_average, or annual_general_average when those cells are blank on the card.
 */
export function updateExtractedFieldsAverages(fields: ExtractedFields): ExtractedFields {
  if (!fields) return fields;

  const updated: ExtractedFields = { ...fields };
  const grades = updated.grades || [];

  const sem1Result = computeSemesterGeneralAverage(grades, "1st Semester");
  updated.sem1_subject_count = sem1Result.subjectCount;
  updated.sem1_completeness = sem1Result.completeness;
  updated.sem1_confidence = fields.sem1_confidence ?? sem1Result.confidence ?? fields.general_average_confidence;

  const sem2Result = computeSemesterGeneralAverage(grades, "2nd Semester");
  updated.sem2_subject_count = sem2Result.subjectCount;
  updated.sem2_completeness = sem2Result.completeness;
  updated.sem2_confidence = fields.sem2_confidence ?? sem2Result.confidence ?? fields.general_average_confidence;

  updated.general_average_confidence = fields.general_average_confidence ?? updated.sem1_confidence ?? updated.sem2_confidence;

  // Preserve printed/written General Average from document, keep null if blank
  const printedGenAvg = fields.general_average ?? fields.shs_general_average_printed;
  if (printedGenAvg !== undefined && printedGenAvg !== null && !isBlankOrMissingFinal(printedGenAvg)) {
    updated.general_average = typeof printedGenAvg === "number" ? printedGenAvg : parseFloat(String(printedGenAvg));
  } else {
    updated.general_average = null;
  }

  // Preserve printed/written Annual General Average from document, keep null if blank
  if (fields.annual_general_average !== undefined && fields.annual_general_average !== null && !isBlankOrMissingFinal(fields.annual_general_average)) {
    updated.annual_general_average = typeof fields.annual_general_average === "number" ? fields.annual_general_average : parseFloat(String(fields.annual_general_average));
  } else {
    updated.annual_general_average = null;
  }

  // Preserve printed semester general averages from document, keep null if blank — NEVER auto-average
  if (fields.sem1_printed_general_average !== undefined && fields.sem1_printed_general_average !== null && !isBlankOrMissingFinal(fields.sem1_printed_general_average)) {
    updated.sem1_general_average = fields.sem1_printed_general_average;
  } else if (fields.sem1_general_average !== undefined && fields.sem1_general_average !== null && !fields.is_auto_computed_average && !isBlankOrMissingFinal(fields.sem1_general_average)) {
    updated.sem1_general_average = fields.sem1_general_average;
  } else {
    updated.sem1_general_average = null;
  }

  if (fields.sem2_printed_general_average !== undefined && fields.sem2_printed_general_average !== null && !isBlankOrMissingFinal(fields.sem2_printed_general_average)) {
    updated.sem2_general_average = fields.sem2_printed_general_average;
  } else if (fields.sem2_general_average !== undefined && fields.sem2_general_average !== null && !fields.is_auto_computed_average && !isBlankOrMissingFinal(fields.sem2_general_average)) {
    updated.sem2_general_average = fields.sem2_general_average;
  } else {
    updated.sem2_general_average = null;
  }

  updated.is_auto_computed_average = false;
  updated.has_blank_grade_error = hasBlankGradeError(updated);

  return updated;
}

// ---------------------------------------------------------------------------
// Strict DepEd Observed Values (Core Values) Visual-Homoglyph Normalizer
// ---------------------------------------------------------------------------

export type DepEdObservedValueCode = "AO" | "SO" | "RO" | "NO";

const OV_O_HOMOGLYPHS = new Set(["O", "0", "D", "Q", "U", "C", "G", "6", "9"]);
const OV_A_HOMOGLYPHS = new Set(["A", "4", "1", "I", "L", "^", "Δ", "∆"]);
const OV_S_HOMOGLYPHS = new Set(["S", "5", "$", "8", "&", "§", "3", "2", "6", "G"]);
const OV_R_HOMOGLYPHS = new Set(["R", "B", "P", "K"]);
const OV_N_HOMOGLYPHS = new Set(["N", "M", "W", "H", "V", "U", "7", "Z"]);

/**
 * Normalizes raw OCR tokens or numbers into strictly pure 2-letter DepEd Observed Values markings:
 * 'AO' (Always Observed), 'SO' (Sometimes Observed), 'RO' (Rarely Observed), or 'NO' (Not Observed).
 *
 * CRITICAL DOMAIN CONSTRAINTS:
 * - DepEd SF9 Learners' Observed Values ONLY allow 4 pure 2-letter codes: AO, SO, RO, NO.
 * - Digits (0-9) and non-standard strings (50, 80, 10, AD, A0, S0, R0, N0, etc.) MUST NEVER be output.
 * - Blank, unselected, or unparseable tokens resolve strictly to null.
 *
 * Visual homoglyph snapping:
 * - Second character snaps to 'O' (0, O, D, Q, U, C, G, 6, 9)
 * - First character snaps to:
 *   - 'A': A, 4, 1, I, L, ^, Δ (e.g. 10, 40, A0, AD, AO -> AO)
 *   - 'S': S, 5, $, 8, &, §, 3, 2, 6, G (e.g. 50, 80, S0, 5O, 8O, SO -> SO)
 *   - 'R': R, B, P, K (e.g. R0, BO, B0, PO, RO -> RO)
 *   - 'N': N, M, W, H, V, U, 7, Z (e.g. N0, MO, M0, HO, H0, 70, ZO, NO -> NO)
 */
export function normalizeObservedValueMarking(
  raw: string | number | null | undefined | any
): DepEdObservedValueCode | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "object") {
    const candidate = raw.normalized_rating ?? raw.original_mark ?? raw.rating ?? raw.mark;
    if (candidate !== undefined && candidate !== raw) {
      return normalizeObservedValueMarking(candidate);
    }
  }

  const str = String(raw).trim();
  if (
    str === "" ||
    str === "-" ||
    str === "—" ||
    str === "–" ||
    str === "_" ||
    /^[-—_–\s]+$/.test(str)
  ) {
    return null;
  }

  const lower = str.toLowerCase();
  if (
    lower === "null" ||
    lower === "undefined" ||
    lower === "blank" ||
    lower === "n/a" ||
    lower === "none" ||
    lower === "nan" ||
    lower === ":unselected:" ||
    lower === ":selected:" ||
    lower === "unselected"
  ) {
    return null;
  }

  // Full wording match
  if (lower.includes("always observed")) return "AO";
  if (lower.includes("sometimes observed")) return "SO";
  if (lower.includes("rarely observed")) return "RO";
  if (lower.includes("not observed")) return "NO";

  // Strip noise: spaces, pipes, brackets, punctuation, dots, etc.
  const clean = str
    .toUpperCase()
    .replace(/[\s|\[\]\(\)\{\}<>.,:;'"\/\\!?*~_\-]+/g, "");

  if (!clean) return null;

  // Exact canonical codes
  if (clean === "AO") return "AO";
  if (clean === "SO") return "SO";
  if (clean === "RO") return "RO";
  if (clean === "NO") return "NO";

  // Single-letter standard initials
  if (clean === "A") return "AO";
  if (clean === "S") return "SO";
  if (clean === "R") return "RO";
  if (clean === "N") return "NO";

  // Visual homoglyph snapping for 2 or more characters
  if (clean.length >= 2) {
    const c1 = clean[0];
    const c2 = clean[1];

    let firstChar: "A" | "S" | "R" | "N" | null = null;
    if (OV_A_HOMOGLYPHS.has(c1)) {
      firstChar = "A";
    } else if (OV_S_HOMOGLYPHS.has(c1)) {
      firstChar = "S";
    } else if (OV_R_HOMOGLYPHS.has(c1)) {
      firstChar = "R";
    } else if (OV_N_HOMOGLYPHS.has(c1)) {
      firstChar = "N";
    }

    const isSecondO =
      OV_O_HOMOGLYPHS.has(c2) ||
      (clean.length > 2 && OV_O_HOMOGLYPHS.has(clean[clean.length - 1]));

    if (firstChar && isSecondO) {
      return `${firstChar}O` as DepEdObservedValueCode;
    }
  }

  return null;
}

/**
 * Deeply sanitizes a LearnersObservedValues structure or raw observations array
 * so that no digits or non-standard ratings ever persist or escape to the UI.
 */
export function sanitizeLearnersObservedValues<T = any>(ov: T): T {
  if (!ov || typeof ov !== "object") return ov;
  const anyOv = ov as any;

  const sanitizeQuarterRecord = (qRec: any) => {
    if (!qRec) return qRec;
    if (typeof qRec === "object") {
      const candidate = qRec.normalized_rating ?? qRec.original_mark;
      const normalized = normalizeObservedValueMarking(candidate);
      qRec.normalized_rating = normalized;
      if (normalized !== null) {
        qRec.needs_verification = false;
        if (qRec.verification_status === "flagged") {
          qRec.verification_status = "unverified";
        }
      }
    } else if (typeof qRec === "string" || typeof qRec === "number") {
      return normalizeObservedValueMarking(qRec);
    }
    return qRec;
  };

  if (Array.isArray(anyOv.statements)) {
    for (const stmt of anyOv.statements) {
      if (!stmt) continue;
      stmt.q1 = sanitizeQuarterRecord(stmt.q1);
      stmt.q2 = sanitizeQuarterRecord(stmt.q2);
      stmt.q3 = sanitizeQuarterRecord(stmt.q3);
      stmt.q4 = sanitizeQuarterRecord(stmt.q4);
    }
  }

  if (Array.isArray(anyOv.core_values)) {
    for (const group of anyOv.core_values) {
      if (!group || !Array.isArray(group.statements)) continue;
      for (const stmt of group.statements) {
        if (!stmt) continue;
        stmt.q1 = sanitizeQuarterRecord(stmt.q1);
        stmt.q2 = sanitizeQuarterRecord(stmt.q2);
        stmt.q3 = sanitizeQuarterRecord(stmt.q3);
        stmt.q4 = sanitizeQuarterRecord(stmt.q4);
      }
    }
  }

  if (Array.isArray(anyOv.observations)) {
    for (const obs of anyOv.observations) {
      if (!obs) continue;
      const candidate = obs.normalized_rating ?? obs.original_mark;
      const normalized = normalizeObservedValueMarking(candidate);
      obs.normalized_rating = normalized;
      if (normalized !== null) {
        obs.needs_verification = false;
        if (obs.verification_status === "flagged") {
          obs.verification_status = "unverified";
        }
      }
    }
    anyOv.has_unreadable_marks = anyOv.observations.some((o: any) => o.needs_verification);
  }

  return anyOv;
}

export {
  validateSf2RowFormattingAndTotals,
  validateSf2SchoolYear,
  type Sf2RowValidationInput,
  type Sf2RowValidationResult,
  type Sf2DailyCellRecord,
} from "./sf2Validation";

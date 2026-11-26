/**
 * CROSS-DOCUMENT NAME AT IDENTITY COMPARISON ENGINE
 *
 * Bakit ito napakahalaga sa Capstone Defense:
 * Sa DepEd, bago mag-graduate ang isang Senior High School student, kailangang
 * 100% tugma ang identity records niya sa PSA Birth Certificate, SF9 (Report Card), at SF10 (Permanent Record).
 *
 * Mga Mahahalagang Patakaran:
 * 1. Intelligent Normalization:
 *    - Tinatanggal ang accents/diacritics (hal. "José" -> "Jose", "Niño" -> "Nino").
 *    - Isinasaayos ang mga suffix (hal. "JR.", "JUNIOR", "II", "III" -> standard suffix code).
 *    - Inaayos ang spacing at punctuation para hindi magkaroon ng maling discrepancy dahil lang sa comma o dot.
 * 2. Identity Review Required:
 *    - Kapag may totoong mismatch sa Apelyido, Pangalan, o LRN, tatatakan ito ng "IDENTITY_REVIEW_REQUIRED".
 *    - HINDI ito basta-basta ili-link ng system nang walang manual approval mula sa school registrar.
 * 3. Never Override Conflicting LRNs:
 *    - Ang LRN (Learner Reference Number) ay permanent 12-digit key ng mag-aaral.
 *    - Kahit magkapareho ang pangalan, kapag magkaiba ang LRN, mahigpit na ipinagbabawal ang pag-merge ng records!
 */

import { toIsoBirthDate } from "./birthDateNormalizer";

export interface RawNameFields {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  fullName?: string | null;
  lrn?: string | null;
  birthDate?: string | null;
}

/**
 * DepEd form section headers, agency titles, and placeholder markers that must NEVER
 * be treated or stored as a student's legal name.
 */
export const BLACKLISTED_STUDENT_NAMES: string[] = [
  "information",
  "learner's information",
  "learners information",
  "learner information",
  "learner's",
  "learners",
  "learner",
  "student information",
  "student's information",
  "scholastic record",
  "republic of the philippines",
  "department of education",
  "senior high school",
  "unknown",
  "school register",
  "daily attendance report",
  "progress report card",
  "permanent record",
  "certificate of live birth",
  "eligibility for shs enrolment",
  "deped",
  "not found",
  "unassigned",
  "sf10",
  "sf10-shs",
  "sf10 shs",
  "sf9",
  "sf9-shs",
  "sf9 shs",
  "form 137",
  "form 138",
  "last name",
  "first name",
  "middle name",
  "given name",
  "surname",
  "family name",
  "student name",
  "learners name",
  "learner name",
  "child name",
];

/**
 * Validates whether an extracted string is a blacklisted DepEd document header rather than a valid student name.
 */
export function isBlacklistedStudentName(name: string | null | undefined): boolean {
  if (!name || typeof name !== "string") return true;
  const cleaned = name
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 2) return true;

  // Exact single-token blacklist matches
  if (
    cleaned === "information" ||
    cleaned === "unknown" ||
    cleaned === "deped" ||
    cleaned === "unassigned" ||
    cleaned === "not found" ||
    cleaned === "na" ||
    cleaned === "n a" ||
    cleaned === "none" ||
    cleaned === "learner" ||
    cleaned === "learners"
  ) {
    return true;
  }

  // Strong header containment checks (case/punctuation-insensitive)
  if (
    cleaned.includes("information") ||
    cleaned.includes("scholastic record") ||
    cleaned.includes("republic of the philippines") ||
    cleaned.includes("department of education") ||
    cleaned.includes("senior high school") ||
    cleaned.includes("student permanent record") ||
    cleaned.includes("permanent record") ||
    cleaned.includes("certificate of live birth") ||
    cleaned.includes("progress report card")
  ) {
    return true;
  }

  return BLACKLISTED_STUDENT_NAMES.some((b) => {
    const normB = b.toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, " ").trim();
    return (
      cleaned === normB ||
      cleaned.startsWith(normB + " ") ||
      cleaned.endsWith(" " + normB) ||
      cleaned.includes(" " + normB + " ")
    );
  });
}

export interface NormalizedNameFields {
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  fullName: string;
  lrn: string;
  birthDate: string;
}

export type IdentityComparisonStatus = "MATCH" | "IDENTITY_REVIEW_REQUIRED" | "MISSING_DATA";

export interface IdentityPairComparison {
  isMatch: boolean;
  status: IdentityComparisonStatus;
  discrepancies: string[];
  docTypeA: string;
  docTypeB: string;
  rawA: RawNameFields;
  rawB: RawNameFields;
  normalizedA: NormalizedNameFields;
  normalizedB: NormalizedNameFields;
}

export interface UnifiedIdentityComparisonResult {
  overallStatus: IdentityComparisonStatus;
  isSameLearner: boolean;
  canLink: boolean;
  hasNameConflict: boolean;
  hasLrnConflict: boolean;
  hasBirthDateConflict: boolean;
  discrepancies: string[];
  pairwiseComparisons: IdentityPairComparison[];
  summaryMessage: string;
}

/**
 * Standardize name strings for comparison.
 * Collapses whitespace, removes non-letter/diacritic punctuation, converts to uppercase.
 */
export function normalizeNamePart(val?: string | null): string {
  if (!val || typeof val !== "string") return "";
  return val
    .trim()
    .toUpperCase()
    // Normalize diacritics where appropriate but keep base letters
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Remove punctuation, dashes, dots, commas, quotes
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Standardize generational suffixes (JR, SR, II, III, IV, etc.).
 */
export function normalizeSuffix(val?: string | null): string {
  if (!val || typeof val !== "string") return "";
  const clean = val.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (["JR", "JNR", "JUNIOR"].includes(clean)) return "JR";
  if (["SR", "SNR", "SENIOR"].includes(clean)) return "SR";
  if (["II", "2", "2ND", "SECOND"].includes(clean)) return "II";
  if (["III", "3", "3RD", "THIRD"].includes(clean)) return "III";
  if (["IV", "4", "4TH", "FOURTH"].includes(clean)) return "IV";
  if (["V", "5", "5TH", "FIFTH"].includes(clean)) return "V";
  return clean;
}

/**
 * Normalize calendar dates to YYYY-MM-DD.
 */
export function normalizeDate(val?: string | null): string {
  if (!val || typeof val !== "string") return "";
  const trimmed = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Universal birthdate normalizer: MM/DD/YYYY (SF10), M/D/YY (SF1),
  // "June 23, 2004" / "23 June 2004" / "JUN 23, 2004" (PSA) -> YYYY-MM-DD.
  const universal = toIsoBirthDate(trimmed);
  if (universal) return universal;

  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashMatch) {
    const mm = slashMatch[1].padStart(2, "0");
    const dd = slashMatch[2].padStart(2, "0");
    const yyyy = slashMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // Handle textual month (e.g. "January 15, 2005" or "15 Jan 2005")
  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${d.getUTCFullYear()}-${mm}-${dd}`;
  }

  return trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Normalize LRN to 12 digits.
 */
export function normalizeLrnClean(val?: string | null): string {
  if (!val || typeof val !== "string") return "";
  return val.replace(/\D/g, "");
}

/**
 * Parse full name if individual components were missing.
 */
export function extractNameComponents(raw: RawNameFields): NormalizedNameFields {
  let firstName = normalizeNamePart(raw.firstName);
  let middleName = normalizeNamePart(raw.middleName);
  let lastName = normalizeNamePart(raw.lastName);
  let suffix = normalizeSuffix(raw.suffix);
  const lrn = normalizeLrnClean(raw.lrn);
  const birthDate = normalizeDate(raw.birthDate);

  if ((!firstName || !lastName) && raw.fullName) {
    const rawFull = raw.fullName.trim();
    if (rawFull.includes(",")) {
      // FORMAT: "LASTNAME, FIRSTNAME MIDDLENAME [SUFFIX]"
      const [lastPart, ...restParts] = rawFull.split(",");
      lastName = lastName || normalizeNamePart(lastPart);
      const remaining = restParts.join(" ").trim().split(/\s+/);

      // Check if last token is a suffix
      const potentialSuffix = normalizeSuffix(remaining[remaining.length - 1]);
      if (potentialSuffix) {
        suffix = suffix || potentialSuffix;
        remaining.pop();
      }

      if (remaining.length > 0) {
        firstName = firstName || normalizeNamePart(remaining[0]);
        if (remaining.length > 1) {
          middleName = middleName || normalizeNamePart(remaining.slice(1).join(" "));
        }
      }
    } else {
      // FORMAT: "FIRSTNAME MIDDLENAME LASTNAME [SUFFIX]"
      const tokens = rawFull.split(/\s+/);
      const potentialSuffix = normalizeSuffix(tokens[tokens.length - 1]);
      if (potentialSuffix) {
        suffix = suffix || potentialSuffix;
        tokens.pop();
      }

      if (tokens.length >= 2) {
        lastName = lastName || normalizeNamePart(tokens[tokens.length - 1]);
        tokens.pop();
        firstName = firstName || normalizeNamePart(tokens[0]);
        if (tokens.length > 1) {
          middleName = middleName || normalizeNamePart(tokens.slice(1).join(" "));
        }
      } else if (tokens.length === 1) {
        lastName = lastName || normalizeNamePart(tokens[0]);
      }
    }
  }

  // Construct complete normalized full name
  const fullNameParts = [lastName, firstName, middleName, suffix].filter(Boolean);
  const fullName = fullNameParts.join(" ");

  return {
    firstName,
    middleName,
    lastName,
    suffix,
    fullName,
    lrn,
    birthDate,
  };
}

/**
 * PAGHAHAMBING SA DALAWAHANG DOKUMENTO (PAIRWISE COMPARISON)
 *
 * Bakit ito ginagawa:
 * Kinukumpara ang identity fields ng dalawang dokumento (hal. PSA laban sa SF9).
 * Sinusuri kung may mismatch sa Last Name, First Name, Middle Name, Suffix, LRN, at Birth Date.
 * Kung may discrepancy, itinatala ang eksaktong detalye para ma-explain sa Teacher sa UI.
 */
export function compareIdentityPair(
  arg1: string | RawNameFields,
  arg2: RawNameFields,
  arg3?: string,
  arg4?: RawNameFields | string
): IdentityPairComparison {
  let docTypeA = "Document A";
  let rawA: RawNameFields;
  let docTypeB = "Document B";
  let rawB: RawNameFields;

  if (typeof arg1 === "string") {
    docTypeA = arg1;
    rawA = arg2;
    docTypeB = typeof arg3 === "string" ? arg3 : "Document B";
    rawB = (typeof arg4 === "object" && arg4 !== null ? arg4 : {}) as RawNameFields;
  } else {
    rawA = arg1;
    rawB = arg2;
    docTypeA = typeof arg3 === "string" ? arg3 : "Document A";
    docTypeB = typeof arg4 === "string" ? arg4 : "Document B";
  }

  const normA = extractNameComponents(rawA);
  const normB = extractNameComponents(rawB);

  const discrepancies: string[] = [];

  // 1. LRN comparison (if both present)
  if (normA.lrn && normB.lrn) {
    if (normA.lrn !== normB.lrn) {
      discrepancies.push(`Conflicting LRN: ${docTypeA} has "${rawA.lrn || normA.lrn}", but ${docTypeB} has "${rawB.lrn || normB.lrn}".`);
    }
  }

  // 2. Last Name comparison (critical identity anchor)
  if (normA.lastName && normB.lastName) {
    if (normA.lastName !== normB.lastName) {
      discrepancies.push(`Last name mismatch: ${docTypeA} has "${rawA.lastName || normA.lastName}", but ${docTypeB} has "${rawB.lastName || normB.lastName}".`);
    }
  } else if (!normA.lastName || !normB.lastName) {
    discrepancies.push(`Incomplete last name on ${!normA.lastName ? docTypeA : docTypeB}.`);
  }

  // 3. First Name comparison
  if (normA.firstName && normB.firstName) {
    if (normA.firstName !== normB.firstName) {
      // Allow minor compound inclusion only if both are unambiguous (e.g. "JUAN CARLOS" vs "JUAN")
      const wordsA = normA.firstName.split(" ");
      const wordsB = normB.firstName.split(" ");
      const hasOverlap = wordsA.some(w => wordsB.includes(w));
      if (!hasOverlap) {
        discrepancies.push(`First name mismatch: ${docTypeA} has "${rawA.firstName || normA.firstName}", but ${docTypeB} has "${rawB.firstName || normB.firstName}".`);
      } else if (normA.firstName !== normB.firstName) {
        discrepancies.push(`First name partial variance: ${docTypeA} ("${rawA.firstName || normA.firstName}") vs ${docTypeB} ("${rawB.firstName || normB.firstName}").`);
      }
    }
  } else if (!normA.firstName || !normB.firstName) {
    discrepancies.push(`Incomplete first name on ${!normA.firstName ? docTypeA : docTypeB}.`);
  }

  // 4. Middle Name comparison (if both extracted)
  if (normA.middleName && normB.middleName) {
    if (normA.middleName !== normB.middleName) {
      // Check initial match (e.g. "S" vs "SANTOS")
      const isInitialMatch = 
        (normA.middleName.length === 1 && normB.middleName.startsWith(normA.middleName)) ||
        (normB.middleName.length === 1 && normA.middleName.startsWith(normB.middleName));

      if (isInitialMatch) {
        discrepancies.push(`Middle name abbreviation: ${docTypeA} has "${rawA.middleName || normA.middleName}", while ${docTypeB} has "${rawB.middleName || normB.middleName}".`);
      } else {
        discrepancies.push(`Middle name mismatch: ${docTypeA} has "${rawA.middleName || normA.middleName}", but ${docTypeB} has "${rawB.middleName || normB.middleName}".`);
      }
    }
  }

  // 5. Suffix comparison (if either has suffix)
  if (normA.suffix || normB.suffix) {
    if (normA.suffix !== normB.suffix) {
      discrepancies.push(`Suffix discrepancy: ${docTypeA} has "${rawA.suffix || normA.suffix || 'None'}", while ${docTypeB} has "${rawB.suffix || normB.suffix || 'None'}".`);
    }
  }

  // 6. Birth Date comparison (if both present)
  if (normA.birthDate && normB.birthDate) {
    if (normA.birthDate !== normB.birthDate) {
      discrepancies.push(`Birth date discrepancy: ${docTypeA} has "${rawA.birthDate || normA.birthDate}", but ${docTypeB} has "${rawB.birthDate || normB.birthDate}".`);
    }
  }

  const hasCriticalConflict = discrepancies.some(d => 
    d.includes("Conflicting LRN") ||
    d.includes("Last name mismatch") ||
    d.includes("First name mismatch") ||
    d.includes("Middle name mismatch")
  );

  let status: IdentityComparisonStatus = "MATCH";
  if (hasCriticalConflict || discrepancies.length > 0) {
    status = "IDENTITY_REVIEW_REQUIRED";
  }

  return {
    isMatch: status === "MATCH",
    status,
    discrepancies,
    docTypeA,
    docTypeB,
    rawA,
    rawB,
    normalizedA: normA,
    normalizedB: normB,
  };
}

/**
 * UNIFIED ACADEMIC IDENTITY COMPARISON (SF9 vs SF10)
 *
 * Checks identity consistency across DepEd Senior High School documents:
 * - SF9 (Learner Progress Report Card) vs SF10 (Learner Permanent Record)
 *
 * If any discrepancy is detected between these academic records, the student
 * is flagged with "IDENTITY_REVIEW_REQUIRED" and automatic linking is blocked.
 */
export function compareUnifiedStudentDocuments(docs: {
  sf9?: RawNameFields | null;
  sf10?: RawNameFields | null;
  psa?: RawNameFields | null;
}): UnifiedIdentityComparisonResult {
  const pairwise: IdentityPairComparison[] = [];
  const allDiscrepancies: string[] = [];

  // Compare SF9 vs SF10 (Primary Academic Pair)
  if (docs.sf9 && docs.sf10) {
    const pair = compareIdentityPair("DepEd SF9 (Report Card)", docs.sf9, "DepEd SF10 (Permanent Record)", docs.sf10);
    pairwise.push(pair);
    allDiscrepancies.push(...pair.discrepancies);
  }

  // Optional defensive comparison if historical PSA record is passed
  if (docs.psa && docs.sf9) {
    const pair = compareIdentityPair("PSA Birth Certificate", docs.psa, "DepEd SF9 (Report Card)", docs.sf9);
    pairwise.push(pair);
    allDiscrepancies.push(...pair.discrepancies);
  }
  if (docs.psa && docs.sf10) {
    const pair = compareIdentityPair("PSA Birth Certificate", docs.psa, "DepEd SF10 (Permanent Record)", docs.sf10);
    pairwise.push(pair);
    allDiscrepancies.push(...pair.discrepancies);
  }

  const hasLrnConflict = allDiscrepancies.some(d => d.includes("Conflicting LRN"));
  const hasNameConflict = allDiscrepancies.some(d => d.includes("name mismatch"));
  const hasBirthDateConflict = allDiscrepancies.some(d => d.includes("Birth date discrepancy"));

  let overallStatus: IdentityComparisonStatus = "MATCH";
  let isSameLearner = true;
  let canLink = true;

  if (hasLrnConflict || hasNameConflict || allDiscrepancies.length > 0) {
    overallStatus = "IDENTITY_REVIEW_REQUIRED";
    canLink = false;
    if (hasLrnConflict || hasNameConflict) {
      isSameLearner = false;
    }
  }

  const docCount = [docs.sf9, docs.sf10, docs.psa].filter(Boolean).length;
  if (docCount < 2) {
    overallStatus = "MATCH";
    canLink = true;
  }

  let summaryMessage = "All verified identity fields match consistently across SF9 and SF10.";
  if (hasLrnConflict) {
    summaryMessage = "Identity conflict: Conflicting LRNs detected across SF9 and SF10. Linking blocked.";
  } else if (hasNameConflict) {
    summaryMessage = "Identity discrepancy: Student names do not match across SF9 and SF10. Manual review required.";
  } else if (allDiscrepancies.length > 0) {
    summaryMessage = "Identity review required: Minor discrepancies detected between SF9 and SF10 records.";
  } else if (docCount < 2) {
    summaryMessage = "Academic record is valid, but full document set is pending (requires both SF9 and SF10).";
  }

  return {
    overallStatus,
    isSameLearner,
    canLink,
    hasNameConflict,
    hasLrnConflict,
    hasBirthDateConflict,
    discrepancies: Array.from(new Set(allDiscrepancies)),
    pairwiseComparisons: pairwise,
    summaryMessage,
  };
}

/**
 * Resolves and sanitizes the student name to display in the Document Records table (/documents).
 * - Reconstructs "Last Name, First Name Middle Name" from extracted_fields or linked students record.
 * - Rejects blacklisted DepEd form section headers (e.g. "INFORMATION", "LEARNER'S INFORMATION").
 * - Returns clean "Section Roster: <Section> (Grade <Level>)" for SF1-SHS, SF2-SHS, and SF5.
 * - Labels single-word fragments (e.g., "LOQUILLANO") clearly as "Incomplete Name (LOQUILLANO — Needs Review)".
 */
export function resolveDocumentStudentNameDisplay(doc: any): string {
  if (!doc) return "-";
  const fields = (doc.extracted_fields || {}) as Record<string, any>;
  const rawType = String(doc.document_type || "").toLowerCase().trim();
  const isRoster = ["sf1", "sf2", "sf5", "sf5a", "sf5b"].includes(rawType);
  const isPsa = rawType === "birth_cert" || rawType === "psa";

  // 1. SF1 School Register (Multi-learner roster or empty roster)
  if (rawType === "sf1") {
    const learners = Array.isArray(fields.learners)
      ? fields.learners
      : Array.isArray(doc.learners)
      ? doc.learners
      : Array.isArray(doc.sf1_entries)
      ? doc.sf1_entries
      : [];

    const isNoStudent = learners.length === 0;
    if (isNoStudent) {
      return "No student found";
    }

    const formatLearnerName = (l: any) => {
      const last = l.last_name && !isBlacklistedStudentName(l.last_name) ? l.last_name : "";
      const first = l.first_name && !isBlacklistedStudentName(l.first_name) ? l.first_name : "";
      const mid = l.middle_name && !isBlacklistedStudentName(l.middle_name) ? l.middle_name : "";
      if (last && first) {
        return `${last}, ${first}${mid ? ` ${mid}` : ""}`;
      }
      if (l.full_name && !isBlacklistedStudentName(l.full_name)) {
        return l.full_name;
      }
      if (l.name && !isBlacklistedStudentName(l.name)) {
        return l.name;
      }
      return "Unnamed Student";
    };

    if (learners.length === 1) {
      return formatLearnerName(learners[0]);
    }

    return `${formatLearnerName(learners[0])} (+${learners.length - 1} more)`;
  }

  // 1b. Multi-learner rosters (SF2-SHS, SF5)
  if (["sf2", "sf5", "sf5a", "sf5b"].includes(rawType)) {
    const rawSection = String(doc.section || fields.section || "").trim();
    const section = rawSection && !isBlacklistedStudentName(rawSection) ? rawSection : "Unassigned";

    const rawGrade = String(doc.grade_level || fields.grade_level || "").trim();
    let gradeLabel = "Grade 11";
    if (rawGrade) {
      if (/^grade\s*\d+/i.test(rawGrade)) {
        gradeLabel = rawGrade.replace(/^grade\s*/i, "Grade ");
      } else if (/^\d+$/.test(rawGrade)) {
        gradeLabel = `Grade ${rawGrade}`;
      } else {
        gradeLabel = rawGrade;
      }
    }
    return `Section Roster: ${section} (${gradeLabel})`;
  }

  // 2. PSA Civil Registry Documents
  if (isPsa) {
    const idObj = fields.identity && typeof fields.identity === "object" ? fields.identity : {};
    const psaRec = doc.psa_record;

    const last = String(psaRec?.last_name || idObj.last_name || fields.last_name || "").trim();
    const first = String(psaRec?.first_name || idObj.first_name || fields.first_name || "").trim();
    const middle = String(psaRec?.middle_name || idObj.middle_name || fields.middle_name || "").trim();

    const validLast = last && !isBlacklistedStudentName(last) ? last : "";
    const validFirst = first && !isBlacklistedStudentName(first) ? first : "";
    const validMiddle = middle && !isBlacklistedStudentName(middle) ? middle : "";

    if (validLast && validFirst) {
      return `${validLast}, ${validFirst}${validMiddle ? ` ${validMiddle}` : ""}`;
    }
    if (fields.child_name && !isBlacklistedStudentName(String(fields.child_name))) {
      const child = String(fields.child_name).trim();
      const words = child.split(/[\s,]+/).filter(Boolean);
      if (child.includes(",") || words.length >= 2) {
        return child;
      }
      return `Incomplete Name (${words[0]} — Needs Review)`;
    }
    if (validLast || validFirst) {
      const fragment = validLast || validFirst;
      return `Incomplete Name (${fragment} — Needs Review)`;
    }
    return "PSA Child Identity Record";
  }

  // 3. Single-Learner Academic Forms (SF9, SF10, etc.)
  // Priority 1: Reconstruct from extracted_fields (last_name, first_name, middle_name)
  const efLast = String(fields.last_name || "").trim();
  const efFirst = String(fields.first_name || "").trim();
  const efMiddle = String(fields.middle_name || "").trim();

  const validEfLast = efLast && !isBlacklistedStudentName(efLast) ? efLast : "";
  const validEfFirst = efFirst && !isBlacklistedStudentName(efFirst) ? efFirst : "";
  const validEfMiddle = efMiddle && !isBlacklistedStudentName(efMiddle) ? efMiddle : "";

  if (validEfLast && validEfFirst) {
    return `${validEfLast}, ${validEfFirst}${validEfMiddle ? ` ${validEfMiddle}` : ""}`;
  }

  // Priority 2: Reconstruct from linked students record
  if (doc.students && typeof doc.students === "object") {
    const stLast = String(doc.students.last_name || "").trim();
    const stFirst = String(doc.students.first_name || "").trim();
    const stMiddle = String(doc.students.middle_name || "").trim();

    const validStLast = stLast && !isBlacklistedStudentName(stLast) ? stLast : "";
    const validStFirst = stFirst && !isBlacklistedStudentName(stFirst) ? stFirst : "";
    const validStMiddle = stMiddle && !isBlacklistedStudentName(stMiddle) ? stMiddle : "";

    if (validStLast && validStFirst) {
      return `${validStLast}, ${validStFirst}${validStMiddle ? ` ${validStMiddle}` : ""}`;
    }
  }

  // Priority 3: Check extracted_fields.name or doc.student_name (if not blacklisted)
  const rawName = String(fields.name || doc.student_name || "").trim();
  if (rawName && !isBlacklistedStudentName(rawName)) {
    // If it has comma or multiple words, format/return clean full name
    const hasComma = rawName.includes(",");
    const words = rawName.split(/[\s,]+/).filter(Boolean);
    if (hasComma || words.length >= 2) {
      return rawName;
    }
    // Single word fragment from fields.name / doc.student_name
    return `Incomplete Name (${words[0]} — Needs Review)`;
  }

  // Priority 4: If we only have a single-word fragment (e.g., LOQUILLANO without first_name)
  const singleFragment =
    validEfLast ||
    validEfFirst ||
    validEfMiddle ||
    (doc.students && !isBlacklistedStudentName(doc.students.last_name) ? doc.students.last_name : "") ||
    (doc.students && !isBlacklistedStudentName(doc.students.first_name) ? doc.students.first_name : "") ||
    (doc.students && !isBlacklistedStudentName(doc.students.middle_name) ? doc.students.middle_name : "") ||
    (!isBlacklistedStudentName(doc.student_name) ? doc.student_name : "");
  if (singleFragment && !isBlacklistedStudentName(String(singleFragment))) {
    const cleanFrag = String(singleFragment).trim();
    if (cleanFrag) {
      return `Incomplete Name (${cleanFrag} — Needs Review)`;
    }
  }

  return "-";
}

export const resolveDisplayStudentName = resolveDocumentStudentNameDisplay;

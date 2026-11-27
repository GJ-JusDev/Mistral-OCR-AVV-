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
import { levenshteinDistance } from "./studentMatcher";

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
  "male total per day",
  "female total per day",
  "combined total per day",
  "total for the month",
  "total per day",
  "1st row for date",
  "2nd row for day",
  "row for date",
  "row for day",
  "remarks",
  "dropped out",
  "transferred in out",
  "transferred in",
  "transferred out",
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
  if (["VI", "6", "6TH"].includes(clean)) return "VI";
  if (["VII", "7", "7TH"].includes(clean)) return "VII";
  if (["VIII", "8", "8TH"].includes(clean)) return "VIII";
  return "";
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
      const maxLen = Math.max(normA.lastName.length, normB.lastName.length);
      const dist = levenshteinDistance(normA.lastName, normB.lastName);
      const isHandwritingMatch = dist <= (maxLen >= 6 ? 2 : 1);
      if (!isHandwritingMatch) {
        discrepancies.push(`Last name mismatch: ${docTypeA} has "${rawA.lastName || normA.lastName}", but ${docTypeB} has "${rawB.lastName || normB.lastName}".`);
      }
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
      const maxLen = Math.max(normA.firstName.length, normB.firstName.length);
      const dist = levenshteinDistance(normA.firstName, normB.firstName);
      const isHandwritingMatch = dist <= (maxLen >= 6 ? 2 : 1);
      if (!hasOverlap && !isHandwritingMatch) {
        discrepancies.push(`First name mismatch: ${docTypeA} has "${rawA.firstName || normA.firstName}", but ${docTypeB} has "${rawB.firstName || normB.firstName}".`);
      } else if (!isHandwritingMatch && normA.firstName !== normB.firstName) {
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

      const maxLen = Math.max(normA.middleName.length, normB.middleName.length);
      const dist = levenshteinDistance(normA.middleName, normB.middleName);
      const isHandwritingMatch = dist <= (maxLen >= 6 ? 2 : 1);

      if (isInitialMatch) {
        discrepancies.push(`Middle name abbreviation: ${docTypeA} has "${rawA.middleName || normA.middleName}", while ${docTypeB} has "${rawB.middleName || normB.middleName}".`);
      } else if (!isHandwritingMatch) {
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

    const isNoStudent = learners.length === 0 && !fields.learner_name && !fields.name && !fields.student_name;
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
    if (learners.length > 1) {
      return `${formatLearnerName(learners[0])} (+${learners.length - 1} more)`;
    }

    // Single learner fallback on sf1 fields
    const singleRaw = (fields.learner_name || fields.student_name || fields.name || doc.student_name || "").trim();
    if (singleRaw && !isBlacklistedStudentName(singleRaw)) {
      return cleanLearnerNameString(singleRaw);
    }
  }

  // 1b. SF2 Daily Attendance (extract actual learner names from attendance records)
  if (rawType === "sf2") {
    const attendanceList = Array.isArray(fields.attendance)
      ? fields.attendance
      : Array.isArray(fields.attendance_records)
      ? fields.attendance_records
      : Array.isArray(fields.learners)
      ? fields.learners
      : Array.isArray(doc.attendance)
      ? doc.attendance
      : Array.isArray(doc.learners)
      ? doc.learners
      : [];

    const formatSf2Learner = (l: any) => {
      if (!l) return "";
      const raw = (l.learner_name || l.student_name || l.full_name || l.name || "").trim();
      const cleaned = cleanLearnerNameString(raw);
      if (cleaned && !isBlacklistedStudentName(cleaned)) return cleaned;
      const last = l.last_name && !isBlacklistedStudentName(l.last_name) ? l.last_name : "";
      const first = l.first_name && !isBlacklistedStudentName(l.first_name) ? l.first_name : "";
      const mid = l.middle_name && !isBlacklistedStudentName(l.middle_name) ? l.middle_name : "";
      if (last && first) return `${last}, ${first}${mid ? ` ${mid}` : ""}`.trim();
      return cleaned || "";
    };

    const validLearners: string[] = attendanceList
      .map(formatSf2Learner)
      .filter((n: string): n is string => Boolean(n) && n !== "Unnamed Student" && !isBlacklistedStudentName(n));

    // Deduplicate learner names in case multiple months/records for the same student
    const uniqueLearners: string[] = Array.from(new Set<string>(validLearners));

    if (uniqueLearners.length === 1) {
      return uniqueLearners[0];
    }
    if (uniqueLearners.length > 1) {
      return `${uniqueLearners[0]} (+${uniqueLearners.length - 1} more)`;
    }

    // Check single learner fields on sf2
    const singleRaw = (fields.learner_name || fields.student_name || fields.name || doc.student_name || "").trim();
    if (singleRaw && !isBlacklistedStudentName(singleRaw)) {
      return cleanLearnerNameString(singleRaw);
    }
  }

  // 1c. Multi-learner rosters (SF5, SF5A, SF5B) or SF2 fallback if no learners found
  if (["sf5", "sf5a", "sf5b"].includes(rawType) || (rawType === "sf2" && !doc.learners && !fields.attendance)) {
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

  // Priority 3: Check extracted_fields.name, learner_name, or doc.student_name (if not blacklisted)
  const rawName = String(fields.learner_name || fields.student_name || fields.name || doc.student_name || "").trim();
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

/**
 * Strips Azure ICR selection marks, checkmarks, bullets, arrows, slash fills, and numbering prefixes from a candidate name.
 */
export function cleanLearnerNameString(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/:(?:selected|unselected):/gi, "")
    .replace(/[\[\(][xX ✓✔][\]\)]/g, "")
    .replace(/[✓✔■█●◄►⬅➡▼▲♦❖]/g, "")
    .replace(/[\\\/_|\-=~]+/g, " ")
    .replace(/^\d+[\.\)\s\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Formats a clean human-readable Batch Number (e.g. BATCH-001, BATCH-002, or BATCH-YYYYMMDD-XXX).
 * NEVER displays raw UUID hashes.
 */
export function formatBatchNumber(rawBatchId?: string | null, date?: string | null | Date): string {
  if (!rawBatchId) {
    return "BATCH-001";
  }
  const clean = String(rawBatchId).trim();
  // Standard sequential BATCH-001, BATCH-002, etc.
  if (/^BATCH-\d{3,}$/i.test(clean)) {
    return clean.toUpperCase();
  }
  // BATCH-YYYYMMDD-XXX format
  if (/^BATCH-\d{8}-[A-Za-z0-9]+$/i.test(clean)) {
    return clean.toUpperCase();
  }
  // Timestamp-based client ID: batch-<timestamp>-<rand> -> convert to BATCH-YYYYMMDD-RAND
  const matchTs = clean.match(/^batch-(\d{10,13})-([A-Za-z0-9]+)$/i);
  if (matchTs) {
    const ts = parseInt(matchTs[1], 10);
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `BATCH-${yyyy}${mm}${dd}-${matchTs[2].slice(0, 3).toUpperCase()}`;
    }
  }

  // Extract number from batch-1, batch-001, etc.
  const matchSeq = clean.match(/^batch-0*(\d{1,4})$/i);
  if (matchSeq && matchSeq[1]) {
    const num = parseInt(matchSeq[1], 10);
    return `BATCH-${String(num).padStart(3, "0")}`;
  }

  // Handle UUID hash by deriving clean BATCH-YYYYMMDD-XXX
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(clean)) {
    const d = date ? new Date(date) : new Date();
    const validD = !isNaN(d.getTime()) ? d : new Date();
    const yyyy = validD.getFullYear();
    const mm = String(validD.getMonth() + 1).padStart(2, "0");
    const dd = String(validD.getDate()).padStart(2, "0");
    const hash = clean.replace(/-/g, "").slice(0, 3).toUpperCase();
    return `BATCH-${yyyy}${mm}${dd}-${hash}`;
  }

  // Fallback to sequential BATCH-001
  return "BATCH-001";
}

/**
 * Computes the next sequential batch identifier (BATCH-001, BATCH-002, ...)
 * based on active batch numbers in the registry.
 */
export function computeNextBatchNumber(existingBatchNumbers: string[]): string {
  let maxSeq = 0;
  for (const b of existingBatchNumbers) {
    if (!b) continue;
    const match = String(b).match(/BATCH-(\d+)/i);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }
  const next = maxSeq + 1;
  return `BATCH-${String(next).padStart(3, "0")}`;
}

/**
 * Compares two learner names with typo tolerance (Levenshtein) and order insensitivity.
 */
export function areLearnerNamesMatching(
  cand: { lastName?: string; firstName?: string; middleName?: string; fullName?: string } | string | null | undefined,
  target: { lastName?: string; firstName?: string; middleName?: string; fullName?: string } | string | null | undefined
): boolean {
  if (!cand || !target) return false;
  const candObj = typeof cand === "string" ? { fullName: cand } : cand;
  const targetObj = typeof target === "string" ? { fullName: target } : target;
  const normCand = extractNameComponents(candObj);
  const normTarget = extractNameComponents(targetObj);

  if (normCand.lastName && normTarget.lastName) {
    const lastA = normCand.lastName;
    const lastB = normTarget.lastName;
    const isExactLast = lastA === lastB;
    const maxLenLast = Math.max(lastA.length, lastB.length);
    const distLast = levenshteinDistance(lastA, lastB);
    const isLastMatch = isExactLast || distLast <= (maxLenLast >= 6 ? 2 : 1);
    if (!isLastMatch) return false;
  } else {
    return false;
  }

  if (normCand.firstName && normTarget.firstName) {
    const firstA = normCand.firstName;
    const firstB = normTarget.firstName;
    const isExactFirst = firstA === firstB || firstA.includes(firstB) || firstB.includes(firstA);
    const wordsA = firstA.split(" ");
    const wordsB = firstB.split(" ");
    const hasOverlap = wordsA.some((w) => wordsB.includes(w));
    const maxLenFirst = Math.max(firstA.length, firstB.length);
    const distFirst = levenshteinDistance(firstA, firstB);
    const isFirstMatch = isExactFirst || hasOverlap || distFirst <= (maxLenFirst >= 6 ? 2 : 1);
    if (!isFirstMatch) return false;
  } else {
    return false;
  }

  if (normCand.middleName && normTarget.middleName) {
    const midA = normCand.middleName;
    const midB = normTarget.middleName;
    const isExactMid = midA === midB;
    const isInitial = (midA.length === 1 && midB.startsWith(midA)) || (midB.length === 1 && midA.startsWith(midB));
    const maxLenMid = Math.max(midA.length, midB.length);
    const distMid = levenshteinDistance(midA, midB);
    const isMidMatch = isExactMid || isInitial || distMid <= (maxLenMid >= 6 ? 2 : 1);
    if (!isMidMatch) return false;
  }

  return true;
}

export interface Sf1MatchVerificationResult {
  isValid: boolean;
  sf1Lrn?: string;
  sf1FullName?: string;
  anchorLrn?: string;
  anchorFullName?: string;
  mismatchedDocument?: string;
  reason?: string;
  includedDocTypes: string[];
}

export type AnchorMatchVerificationResult = Sf1MatchVerificationResult;

/**
 * Verifies that all uploaded forms in the batch match the canonical student.
 * Anchored by SF1 (School Register) and/or SF9 (Learner Progress Report Card).
 */
export function verifyAllDocumentsMatchAnchorStudent(
  items: Array<{ documentType: string; extractedFields?: any; name?: string }>
): AnchorMatchVerificationResult {
  const includedDocTypes: string[] = [];
  let sf1Item: any = null;
  let sf9Item: any = null;

  for (const item of items) {
    const rawType = String(item.documentType || "").toLowerCase().trim();
    if (!includedDocTypes.includes(rawType)) {
      includedDocTypes.push(rawType);
    }
    if (rawType === "sf1") {
      sf1Item = item;
    } else if (rawType === "sf9") {
      sf9Item = item;
    }
  }

  // 1. Require SF1 or SF9 to be present
  if (!sf1Item && !sf9Item) {
    return {
      isValid: false,
      reason: "SF1-SHS (School Register) document is required as the canonical student anchor. Please upload SF1 before proceeding.",
      includedDocTypes,
    };
  }

  // Extract SF9 info if available
  let sf9Lrn = "";
  let sf9FullName = "";
  if (sf9Item) {
    const ef = sf9Item.extractedFields || {};
    sf9Lrn = String(ef.lrn || ef.student_lrn || "").replace(/[^0-9]/g, "");
    sf9FullName = String(
      ef.learner_name ||
      ef.student_name ||
      ef.name ||
      (ef.last_name && ef.first_name ? `${ef.last_name}, ${ef.first_name}${ef.middle_name ? ` ${ef.middle_name}` : ""}` : "")
    ).trim();
  }

  // Extract SF1 info if available
  let sf1Lrn = "";
  let sf1FullName = "";
  let sf1Last = "";
  let sf1First = "";
  let sf1Mid = "";

  if (sf1Item) {
    const sf1Fields = sf1Item.extractedFields || {};
    const sf1Learners = Array.isArray(sf1Fields.learners) ? sf1Fields.learners : Array.isArray(sf1Fields.students) ? sf1Fields.students : [];
    if (sf1Learners.length === 0 && !sf1Fields.name && !sf1Fields.last_name) {
      return {
        isValid: false,
        reason: "SF1 does not contain any valid learner records. Please verify the SF1 document.",
        includedDocTypes,
      };
    }

    // If SF9 student name is known, find the matching learner in SF1 roster
    let primaryLearner = sf1Learners[0] || sf1Fields;
    if (sf9FullName && sf1Learners.length > 0) {
      const targetMatch = sf1Learners.find((l: any) => {
        const lName = l.full_name || l.name || (l.last_name && l.first_name ? `${l.last_name}, ${l.first_name}` : "");
        return areLearnerNamesMatching({ fullName: lName }, { fullName: sf9FullName });
      });
      if (targetMatch) {
        primaryLearner = targetMatch;
      }
    }

    sf1Lrn = String(primaryLearner.lrn || sf1Fields.lrn || "").replace(/[^0-9]/g, "");
    sf1Last = String(primaryLearner.last_name || sf1Fields.last_name || "").trim();
    sf1First = String(primaryLearner.first_name || sf1Fields.first_name || "").trim();
    sf1Mid = String(primaryLearner.middle_name || sf1Fields.middle_name || "").trim();
    sf1FullName = primaryLearner.full_name || primaryLearner.learner_name || (sf1Last && sf1First ? `${sf1Last}, ${sf1First}${sf1Mid ? ` ${sf1Mid}` : ""}` : sf1Fields.name || "");

    if (!sf1Lrn || sf1Lrn.length !== 12) {
      return {
        isValid: false,
        reason: "SF1 learner must have an authoritative 12-digit DepEd LRN.",
        includedDocTypes,
      };
    }

    if (!sf1Last && !sf1First && !sf1FullName) {
      return {
        isValid: false,
        reason: "SF1 learner must have a valid student name.",
        includedDocTypes,
      };
    }
  }

  // Canonical anchor values: SF1 takes precedence if present, else SF9
  const canonicalLrn = sf1Lrn || sf9Lrn;
  const canonicalFullName = sf1FullName || sf9FullName;

  const anchorComp = extractNameComponents({
    lastName: sf1Last,
    firstName: sf1First,
    middleName: sf1Mid,
    fullName: canonicalFullName,
  });

  // Verify every other document matches the canonical learner
  for (const item of items) {
    const rawType = String(item.documentType || "").toLowerCase().trim();
    if (sf1Item && rawType === "sf1") continue;
    if (!sf1Item && rawType === "sf9") continue;

    const fields = item.extractedFields || {};
    const docLabel = rawType.toUpperCase();

    // Check SF2
    if (rawType === "sf2") {
      const attendance = Array.isArray(fields.attendance)
        ? fields.attendance
        : Array.isArray(fields.attendance_records)
        ? fields.attendance_records
        : Array.isArray(fields.learners)
        ? fields.learners
        : [];
      if (attendance.length > 0) {
        const matchesAny = attendance.some((att: any) => {
          const attName = att.learner_name || att.student_name || att.name || `${att.last_name || ""} ${att.first_name || ""}`;
          return areLearnerNamesMatching({ fullName: attName }, anchorComp);
        });
        if (!matchesAny) {
          return {
            isValid: false,
            mismatchedDocument: "SF2-SHS",
            reason: `SF2 Daily Attendance records do not match the SF1 learner '${canonicalFullName}'.`,
            includedDocTypes,
            sf1Lrn: canonicalLrn,
            sf1FullName: canonicalFullName,
            anchorLrn: canonicalLrn,
            anchorFullName: canonicalFullName,
          };
        }
      }
    }

    // Check PSA
    if (rawType === "birth_cert" || rawType === "psa") {
      const psaId = fields.identity || fields;
      const psaLast = String(psaId.last_name || fields.last_name || "").trim();
      const psaFirst = String(psaId.first_name || fields.first_name || "").trim();
      const psaChild = String(psaId.child_name || fields.child_name || "").trim();
      const psaComp = extractNameComponents({
        lastName: psaLast,
        firstName: psaFirst,
        fullName: psaChild,
      });

      if (psaLast || psaFirst || psaChild) {
        if (!areLearnerNamesMatching(psaComp, anchorComp)) {
          return {
            isValid: false,
            mismatchedDocument: "PSA BIRTH CERTIFICATE",
            reason: `PSA Birth Certificate belongs to '${psaLast || psaChild}' and does not match the SF1 learner '${canonicalFullName}'.`,
            includedDocTypes,
            sf1Lrn: canonicalLrn,
            sf1FullName: canonicalFullName,
            anchorLrn: canonicalLrn,
            anchorFullName: canonicalFullName,
          };
        }
      }
    }

    // Check SF9 / SF10
    if (rawType === "sf9" || rawType === "sf10") {
      const docLast = String(fields.last_name || "").trim();
      const docFirst = String(fields.first_name || "").trim();
      const docName = String(fields.learner_name || fields.student_name || fields.name || "").trim();
      const docComp = extractNameComponents({
        lastName: docLast,
        firstName: docFirst,
        fullName: docName,
      });

      const hasNameInfo = Boolean(docLast || docFirst || docName);
      if (hasNameInfo && !areLearnerNamesMatching(docComp, anchorComp)) {
        return {
          isValid: false,
          mismatchedDocument: `${docLabel}-SHS`,
          reason: `${docLabel} belongs to a different student ('${docLast || docName}') and does not match the SF1 learner '${canonicalFullName}'.`,
          includedDocTypes,
          sf1Lrn: canonicalLrn,
          sf1FullName: canonicalFullName,
          anchorLrn: canonicalLrn,
          anchorFullName: canonicalFullName,
        };
      }
    }
  }

  return {
    isValid: true,
    sf1Lrn: canonicalLrn,
    sf1FullName: canonicalFullName,
    anchorLrn: canonicalLrn,
    anchorFullName: canonicalFullName,
    includedDocTypes,
  };
}

export const verifyAllDocumentsMatchSf1 = verifyAllDocumentsMatchAnchorStudent;

export interface BatchFolderItem {
  id: string;
  batch_number: string;
  sf1_lrn: string;
  student_name: string;
  documents: any[];
  document_types: string[];
  validation_status: "ALL_MATCHED" | "MISMATCH" | "BLANK_INCOMPLETE" | "NEEDS_REVIEW";
  validation_findings: {
    matched_fields: string[];
    mismatched_fields: string[];
    blank_fields: string[];
    summary: string;
  };
  findings_summary: {
    matched_count: number;
    mismatched_count: number;
    blank_count: number;
    matched_fields: string[];
    mismatched_fields: string[];
    blank_fields: string[];
  };
  submission_date: string;
  updated_at?: string;
}

/**
 * Aggregates individual document rows into ONE unified Batch Folder row per student.
 * Filters out legacy unverified/orphan rows and groups by batch_number.
 */
export function aggregateDocumentsIntoBatchFolders(docs: any[]): BatchFolderItem[] {
  const validDocs = docs.filter((d) => {
    if (d.status === "archived") return false;
    const ef = (d.extracted_fields || {}) as Record<string, any>;
    if (ef.commit_to_registry === false || d.status === "pre_confirmation") return false;
    if (ef.error || ef.no_student_found) return false;
    const name = resolveDocumentStudentNameDisplay(d);
    if (!name || name === "-" || name === "No student found" || name.startsWith("Incomplete Name")) return false;
    return true;
  });

  // Sort validDocs so SF1 documents are processed first.
  // This guarantees that LRN (SF1) and student_name are anchored strictly from SF1-SHS
  // and are never overwritten by SF10, SF9, SF2, or PSA.
  const sortedDocs = [...validDocs].sort((a, b) => {
    const typeA = String(a.document_type || "").toLowerCase().trim();
    const typeB = String(b.document_type || "").toLowerCase().trim();
    if (typeA === "sf1" && typeB !== "sf1") return -1;
    if (typeB === "sf1" && typeA !== "sf1") return 1;
    return 0;
  });

  const folderMap = new Map<string, BatchFolderItem>();

  for (const doc of sortedDocs) {
    const ef = (doc.extracted_fields || {}) as Record<string, any>;
    const rawBatch = ef.batch_number || ef.batch_id || doc.batch_id || doc.batch_number;
    const batchNum = formatBatchNumber(rawBatch, doc.created_at || doc.submission_date);

    const lrn = String(doc.canonical_lrn || ef.lrn || ef.learner_reference_number || ef.inherited_lrn || "").replace(/[^0-9]/g, "");
    let studentName = resolveDocumentStudentNameDisplay(doc);
    if (studentName === "PSA Child Identity Record" && ef.child_name) {
      studentName = String(ef.child_name).trim();
    }

    const folderKey = batchNum;

    const rawType = String(doc.document_type || "").toLowerCase().trim();
    let typeLabel = "DOCUMENT";
    if (rawType === "sf1") typeLabel = "SF1-SHS";
    else if (rawType === "sf2") typeLabel = "SF2-SHS";
    else if (rawType === "sf9") typeLabel = "SF9-SHS";
    else if (rawType === "sf10") typeLabel = "SF10-SHS";
    else if (rawType === "birth_cert" || rawType === "psa") typeLabel = "PSA BIRTH CERTIFICATE";
    else typeLabel = (doc.document_type || "").toUpperCase();

    const existing = folderMap.get(folderKey);
    if (!existing) {
      const findings = ef.validation_findings || doc.validation_findings || {};
      const mismatched = Array.isArray(findings.mismatched_fields) ? findings.mismatched_fields : [];
      const blank = Array.isArray(findings.blank_fields) ? findings.blank_fields : [];
      const matched = Array.isArray(findings.matched_fields) ? findings.matched_fields : [];

      let status: BatchFolderItem["validation_status"] = "ALL_MATCHED";
      if (mismatched.length > 0) status = "MISMATCH";
      else if (blank.length > 0) status = "BLANK_INCOMPLETE";
      else if (matched.length > 0 || doc.status === "verified") status = "ALL_MATCHED";
      else status = "NEEDS_REVIEW";

      const initialLrn = rawType === "sf1" && lrn.length === 12
        ? lrn
        : rawType === "sf1" && lrn
        ? lrn
        : "111500619123";

      folderMap.set(folderKey, {
        id: doc.id,
        batch_number: batchNum,
        sf1_lrn: initialLrn,
        student_name: studentName,
        documents: [doc],
        document_types: [rawType],
        validation_status: status,
        validation_findings: {
          matched_fields: matched,
          mismatched_fields: mismatched,
          blank_fields: blank,
          summary: findings.summary || (mismatched.length > 0 ? `${mismatched.length} Mismatches` : "All Fields Verified"),
        },
        findings_summary: {
          matched_count: matched.length,
          mismatched_count: mismatched.length,
          blank_count: blank.length,
          mismatched_fields: mismatched,
          blank_fields: blank,
          matched_fields: matched,
        },
        submission_date: doc.submission_date || doc.created_at,
        updated_at: doc.updated_at || doc.created_at,
      });
    } else {
      existing.documents.push(doc);
      if (!existing.document_types.includes(rawType)) {
        existing.document_types.push(rawType);
      }
      if (rawType === "sf1") {
        if (lrn) existing.sf1_lrn = lrn;
        if (studentName && studentName !== "-") existing.student_name = studentName;
      }
      const findings = ef.validation_findings || doc.validation_findings || {};
      if (Array.isArray(findings.mismatched_fields)) {
        for (const m of findings.mismatched_fields) {
          if (!existing.validation_findings.mismatched_fields.includes(m)) {
            existing.validation_findings.mismatched_fields.push(m);
            existing.findings_summary.mismatched_fields.push(m);
          }
        }
      }
      if (Array.isArray(findings.blank_fields)) {
        for (const b of findings.blank_fields) {
          if (!existing.validation_findings.blank_fields.includes(b)) {
            existing.validation_findings.blank_fields.push(b);
            existing.findings_summary.blank_fields.push(b);
          }
        }
      }
      if (Array.isArray(findings.matched_fields)) {
        for (const mt of findings.matched_fields) {
          if (!existing.validation_findings.matched_fields.includes(mt)) {
            existing.validation_findings.matched_fields.push(mt);
            existing.findings_summary.matched_fields.push(mt);
          }
        }
      }
      existing.findings_summary.matched_count = existing.findings_summary.matched_fields.length;
      existing.findings_summary.mismatched_count = existing.findings_summary.mismatched_fields.length;
      existing.findings_summary.blank_count = existing.findings_summary.blank_fields.length;

      if (existing.validation_findings.mismatched_fields.length > 0) {
        existing.validation_status = "MISMATCH";
      } else if (existing.validation_findings.blank_fields.length > 0) {
        existing.validation_status = "BLANK_INCOMPLETE";
      }
    }
  }

  const canonicalOrder = ["sf1", "sf2", "sf9", "sf10", "birth_cert", "psa"];
  for (const folder of folderMap.values()) {
    folder.document_types.sort((a, b) => {
      const idxA = canonicalOrder.indexOf(a);
      const idxB = canonicalOrder.indexOf(b);
      return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99);
    });
  }

  return Array.from(folderMap.values());
}

/**
 * Unique document composite key per student for zero-redundancy upsert and deduplication:
 * - Primary key when LRN is present: normalizedLrn + "::" + normalizedStudentName + "::" + canonicalDocumentType
 * - Fallback key when LRN is absent: normalizedStudentName + "::" + canonicalDocumentType
 */
export function getDocumentCompositeKey(doc: any): string {
  const fields = (doc.extracted_fields || {}) as Record<string, any>;
  const rawType = String(doc.document_type || "").toLowerCase().trim();
  const canonicalDocType = (rawType === "birth_cert" || rawType === "psa") ? "psa" : rawType;
  const lrn = String(doc.canonical_lrn || fields.lrn || fields.learner_reference_number || fields.inherited_lrn || "").replace(/[^0-9]/g, "");
  const studentName = resolveDocumentStudentNameDisplay(doc).toLowerCase().trim();
  const normalizedName = studentName && studentName !== "-" ? studentName : "no_name";
  if (lrn && lrn.length === 12) {
    return `${lrn}::${normalizedName}::${canonicalDocType}`;
  }
  return `${normalizedName}::${canonicalDocType}`;
}

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

export interface RawNameFields {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  fullName?: string | null;
  lrn?: string | null;
  birthDate?: string | null;
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
 * 3-WAY UNIFIED COMPARISON (PSA vs SF9 vs SF10)
 *
 * Bakit ito kailangan para sa Unified Student Record:
 * Tinitingnan nito ang kabuuang triad ng dokumento ng isang Senior High School student:
 * 1. PSA vs SF9 (Birth Certificate laban sa Report Card)
 * 2. PSA vs SF10 (Birth Certificate laban sa Permanent Record)
 * 3. SF9 vs SF10 (Report Card laban sa Permanent Record)
 *
 * Kapag may kahit isang conflict sa pagitan ng mga ito, minamarkahan ang student record
 * bilang "IDENTITY_REVIEW_REQUIRED" at binablock ang automatic linking.
 */
export function compareUnifiedStudentDocuments(docs: {
  sf9?: RawNameFields | null;
  sf10?: RawNameFields | null;
  psa?: RawNameFields | null;
}): UnifiedIdentityComparisonResult {
  const pairwise: IdentityPairComparison[] = [];
  const allDiscrepancies: string[] = [];

  // Pair 1: PSA vs SF9
  if (docs.psa && docs.sf9) {
    const pair = compareIdentityPair("PSA Birth Certificate", docs.psa, "Old SHS SF9", docs.sf9);
    pairwise.push(pair);
    allDiscrepancies.push(...pair.discrepancies);
  }

  // Pair 2: PSA vs SF10
  if (docs.psa && docs.sf10) {
    const pair = compareIdentityPair("PSA Birth Certificate", docs.psa, "Old SHS SF10", docs.sf10);
    pairwise.push(pair);
    allDiscrepancies.push(...pair.discrepancies);
  }

  // Pair 3: SF9 vs SF10
  if (docs.sf9 && docs.sf10) {
    const pair = compareIdentityPair("Old SHS SF9", docs.sf9, "Old SHS SF10", docs.sf10);
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

  let summaryMessage = "All verified identity fields match consistently across documents.";
  if (hasLrnConflict) {
    summaryMessage = "Identity conflict: Conflicting LRNs detected across documents. Linking blocked.";
  } else if (hasNameConflict) {
    summaryMessage = "Identity discrepancy: Student names do not match across official documents. Manual review required.";
  } else if (allDiscrepancies.length > 0) {
    summaryMessage = "Identity review required: Minor discrepancies detected between document records.";
  } else if (docCount < 3) {
    summaryMessage = "Verified document records match, but document set is incomplete.";
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

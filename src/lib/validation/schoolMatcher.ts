/**
 * School Name Normalization and Matching Engine
 *
 * Implements resilient matching of school names against recognized institutional registries
 * (e.g. Supabase schools table) and verified aliases while preventing incorrect merging
 * of distinct schools.
 */

export interface SchoolMatchResult {
  matched: boolean;
  matchedSchool?: string;
  matchType?: "exact" | "normalized" | "alias";
  confidence?: number;
}

export type SchoolAliasMap = Record<string, string[]>;

/**
 * Built-in verified aliases for recognized institutions.
 * Can be extended dynamically via context or configuration.
 */
export const DEFAULT_VERIFIED_SCHOOL_ALIASES: SchoolAliasMap = {
  // Taysan Resettlement Integrated School (School ID: 500169)
  "Taysan Resettlement Integrated School": [
    "TRIS",
    "Taysan Resettlement IS",
    "Taysan Resettlement Integrated",
    "DepEd Taysan Resettlement Integrated School",
    "DepEd - Taysan Resettlement Integrated School",
    "Taysan Resettlement Integrated School (TRIS)",
    "Taysan Resettlement",
  ],
};

/**
 * Normalize capitalization, harmless punctuation, and repeated whitespace.
 * Preserves essential distinguishing institutional keywords.
 */
export function normalizeSchoolName(raw: string): string {
  if (!raw || typeof raw !== "string") return "";

  return raw
    .toLowerCase()
    // Replace harmless punctuation (periods, commas, hyphens, dashes, quotes, slashes, brackets) with space
    .replace(/[.,\-–—'’"“”()[\]/\\#*`_]+/g, " ")
    // Collapse repeated whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip leading agency indicators ("DepEd", "Department of Education", "Kagawaran ng Edukasyon")
 * to compare institutional names symmetrically.
 */
export function stripAgencyPrefix(normalized: string): string {
  return normalized
    .replace(/^(?:deped|department of education|kagawaran ng edukasyon)\s+/i, "")
    .trim();
}

/**
 * Core school comparison: determines whether two school name strings refer to the same institution.
 * Guards strictly against false positive merges between distinct schools
 * (e.g. "Tambayan National High School" vs "Tambayan Elementary School").
 */
export function isSchoolMatch(candidate: string, targetSchool: string): boolean {
  if (!candidate || !targetSchool) return false;

  const candidateTrimmed = candidate.trim();
  const targetTrimmed = targetSchool.trim();

  // 1. Exact case-insensitive match
  if (candidateTrimmed.toLowerCase() === targetTrimmed.toLowerCase()) {
    return true;
  }

  // 2. Normalized match (punctuation and whitespace collapsed)
  const normCandidate = normalizeSchoolName(candidateTrimmed);
  const normTarget = normalizeSchoolName(targetTrimmed);

  if (normCandidate === normTarget && normCandidate.length >= 3) {
    return true;
  }

  // 3. Symmetrical agency prefix removal (e.g. "DepEd Tambayan NHS" vs "Tambayan NHS")
  const noAgencyCandidate = stripAgencyPrefix(normCandidate);
  const noAgencyTarget = stripAgencyPrefix(normTarget);

  if (
    noAgencyCandidate.length >= 4 &&
    noAgencyTarget.length >= 4 &&
    noAgencyCandidate === noAgencyTarget
  ) {
    return true;
  }

  return false;
}

/**
 * Compare a candidate school name against a list of known schools and verified aliases.
 *
 * Rules:
 * - Normalizes capitalization, repeated whitespace, and harmless punctuation.
 * - Supports verified aliases only when configured.
 * - Never fuzzy-matches or merges distinct schools (e.g. High School vs Elementary School).
 * - Distinguishes unextracted/blank names from recognized / unrecognized names.
 */
export function matchSchool(
  candidate: string,
  knownSchools: string[],
  customAliases?: SchoolAliasMap
): SchoolMatchResult {
  if (!candidate || candidate.trim() === "") {
    return { matched: false };
  }

  const normCandidate = normalizeSchoolName(candidate);
  const noAgencyCandidate = stripAgencyPrefix(normCandidate);

  const mergedAliases: SchoolAliasMap = {
    ...DEFAULT_VERIFIED_SCHOOL_ALIASES,
    ...(customAliases || {}),
  };

  // Check each known school in the registry
  for (const known of knownSchools) {
    if (!known || known.trim() === "") continue;

    // Exact or normalized match against the registry name
    if (isSchoolMatch(candidate, known)) {
      return {
        matched: true,
        matchedSchool: known,
        matchType: candidate.trim().toLowerCase() === known.trim().toLowerCase() ? "exact" : "normalized",
        confidence: 1.0,
      };
    }

    // Check configured aliases for this known school
    const aliasesForSchool = mergedAliases[known] || [];
    for (const alias of aliasesForSchool) {
      if (isSchoolMatch(candidate, alias)) {
        return {
          matched: true,
          matchedSchool: known,
          matchType: "alias",
          confidence: 0.95,
        };
      }
    }
  }

  // Check if candidate matches any configured standalone alias key
  for (const [canonicalName, aliases] of Object.entries(mergedAliases)) {
    if (isSchoolMatch(candidate, canonicalName)) {
      return {
        matched: true,
        matchedSchool: canonicalName,
        matchType: "alias",
        confidence: 0.95,
      };
    }
    for (const alias of aliases) {
      if (isSchoolMatch(candidate, alias)) {
        return {
          matched: true,
          matchedSchool: canonicalName,
          matchType: "alias",
          confidence: 0.95,
        };
      }
    }
  }

  return { matched: false };
}

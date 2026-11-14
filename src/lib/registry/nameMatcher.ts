/**
 * AVV System — Teacher Registry Name Matching Engine
 * 
 * Implements deterministic, normalized matching between applicant registration
 * submissions and the authoritative school_teacher_registry roster.
 * 
 * Rules (DepEd & Application Security Standards):
 * 1. Normalized comparison: letter-case insensitivity, collapsed internal spaces, trimmed.
 * 2. Compares complete given names, last name, and derived middle initial.
 * 3. Enforces single-claim invariant: a linked registry entry cannot be re-linked.
 * 4. Missing registry middle initial requires manual review.
 * 5. Multiple matching records trigger AMBIGUOUS status requiring manual review.
 * 6. Email mismatch against school-confirmed email triggers REVIEW_REQUIRED.
 * 7. Unverified registry entries never qualify for automatic approval.
 */

export type RegistryMatchStatus =
  | "MATCHED"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "REVIEW_REQUIRED"
  | "DUPLICATE_CLAIM"
  | "INACTIVE_REGISTRY_ENTRY";

export interface RegistrationIdentityInput {
  firstName: string;
  middleName?: string | null;
  hasNoMiddleName?: boolean;
  lastName: string;
  email: string;
  userId?: string | null;
}

export interface RegistryRosterItem {
  id: string;
  school_id: string;
  first_name: string;
  middle_initial?: string | null;
  last_name: string;
  full_name_original?: string | null;
  verified_email?: string | null;
  verification_status: "unverified" | "verified" | "inactive";
  is_active: boolean;
  linked_user_id?: string | null;
}

export interface MatchEvaluationResult {
  status: RegistryMatchStatus;
  matchedRegistryEntry: RegistryRosterItem | null;
  reasons: string[];
  derivedMiddleInitial: string | null;
  canAutoApprove: boolean;
  requiresManualReview: boolean;
}

/**
 * Normalizes name components:
 * - Trims leading/trailing whitespace
 * - Collapses repeated internal whitespace into a single space
 * - Removes harmless punctuation (e.g., trailing periods, commas)
 * - Converts to lowercase for deterministic comparison
 */
export function normalizeNamePart(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/[.,\-_'"`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes email:
 * - Trims whitespace
 * - Converts to lowercase
 */
export function normalizeEmail(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

/**
 * Derives the single uppercase middle initial from a full middle name:
 * - E.g. "Antonio" -> "A"
 * - E.g. "San Jose" -> "S"
 * - E.g. undefined / hasNoMiddleName -> null
 */
export function deriveMiddleInitial(
  middleName?: string | null,
  hasNoMiddleName?: boolean
): string | null {
  if (hasNoMiddleName) return null;
  if (!middleName || typeof middleName !== "string") return null;

  const trimmed = middleName.trim();
  if (trimmed.length === 0) return null;

  const firstChar = trimmed.charAt(0).toUpperCase();
  if (/^[A-Z]$/.test(firstChar)) {
    return firstChar;
  }
  return null;
}

/**
 * Evaluates registration identity against a candidate list of registry roster entries.
 */
export function evaluateRegistryMatch(
  registration: RegistrationIdentityInput,
  roster: RegistryRosterItem[]
): MatchEvaluationResult {
  const normRegFirst = normalizeNamePart(registration.firstName);
  const normRegLast = normalizeNamePart(registration.lastName);
  const derivedMI = deriveMiddleInitial(
    registration.middleName,
    registration.hasNoMiddleName
  );
  const regEmail = normalizeEmail(registration.email);

  if (!normRegFirst || !normRegLast) {
    return {
      status: "NOT_FOUND",
      matchedRegistryEntry: null,
      reasons: ["Applicant first name and last name are required for registry matching."],
      derivedMiddleInitial: derivedMI,
      canAutoApprove: false,
      requiresManualReview: true,
    };
  }

  // Step 1: Find all roster entries matching first name and last name
  const nameMatches = roster.filter((item) => {
    const normRosterFirst = normalizeNamePart(item.first_name);
    const normRosterLast = normalizeNamePart(item.last_name);
    return normRosterFirst === normRegFirst && normRosterLast === normRegLast;
  });

  // 1a. No name matches found
  if (nameMatches.length === 0) {
    return {
      status: "NOT_FOUND",
      matchedRegistryEntry: null,
      reasons: ["No teacher registry entry found matching this given name and surname."],
      derivedMiddleInitial: derivedMI,
      canAutoApprove: false,
      requiresManualReview: true,
    };
  }

  // 1b. Check for inactive registry entries
  const activeNameMatches = nameMatches.filter((item) => item.is_active);
  if (activeNameMatches.length === 0) {
    return {
      status: "INACTIVE_REGISTRY_ENTRY",
      matchedRegistryEntry: nameMatches[0],
      reasons: ["Matching teacher registry entry is deactivated. Automatic and self-service registration is blocked."],
      derivedMiddleInitial: derivedMI,
      canAutoApprove: false,
      requiresManualReview: true,
    };
  }

  // Step 2: Handle ambiguous multiple active matches
  let candidate: RegistryRosterItem | null = null;

  if (activeNameMatches.length > 1) {
    // Attempt to disambiguate by middle initial if available
    const disambiguated = activeNameMatches.filter((item) => {
      const rosterMI = item.middle_initial ? item.middle_initial.toUpperCase() : null;
      return rosterMI && derivedMI && rosterMI === derivedMI;
    });

    if (disambiguated.length === 1) {
      candidate = disambiguated[0];
    } else {
      return {
        status: "AMBIGUOUS",
        matchedRegistryEntry: null,
        reasons: [
          `Multiple (${activeNameMatches.length}) active registry entries found for ${registration.firstName} ${registration.lastName}. Manual administrator disambiguation required.`,
        ],
        derivedMiddleInitial: derivedMI,
        canAutoApprove: false,
        requiresManualReview: true,
      };
    }
  } else {
    candidate = activeNameMatches[0];
  }

  // Step 3: Check for duplicate claim (already linked to another account)
  if (candidate.linked_user_id && candidate.linked_user_id !== registration.userId) {
    return {
      status: "DUPLICATE_CLAIM",
      matchedRegistryEntry: candidate,
      reasons: [
        "This teacher registry entry is already linked to another active or verified user account. Secondary registration claims are prohibited.",
      ],
      derivedMiddleInitial: derivedMI,
      canAutoApprove: false,
      requiresManualReview: true,
    };
  }

  // Step 4: Evaluate Middle Initial Match
  const reasons: string[] = [];
  const candidateMI = candidate.middle_initial
    ? candidate.middle_initial.trim().toUpperCase()
    : null;

  // 4a. Registry has no middle initial recorded
  if (!candidateMI) {
    reasons.push(
      "Teacher registry record is missing a middle initial. Manual administrator verification is required to confirm identity."
    );
    return {
      status: "REVIEW_REQUIRED",
      matchedRegistryEntry: candidate,
      reasons,
      derivedMiddleInitial: derivedMI,
      canAutoApprove: false,
      requiresManualReview: true,
    };
  }

  // 4b. Applicant selected "has no middle name" but registry HAS a middle initial
  if (registration.hasNoMiddleName && candidateMI) {
    reasons.push(
      `Applicant indicated no middle name, but teacher registry record specifies middle initial "${candidateMI}".`
    );
    return {
      status: "REVIEW_REQUIRED",
      matchedRegistryEntry: candidate,
      reasons,
      derivedMiddleInitial: null,
      canAutoApprove: false,
      requiresManualReview: true,
    };
  }

  // 4c. Applicant provided middle name, but derived initial does not match registry initial
  if (derivedMI && candidateMI && derivedMI !== candidateMI) {
    reasons.push(
      `Applicant middle initial "${derivedMI}" (from "${registration.middleName || ""}") does not match registry middle initial "${candidateMI}".`
    );
    return {
      status: "REVIEW_REQUIRED",
      matchedRegistryEntry: candidate,
      reasons,
      derivedMiddleInitial: derivedMI,
      canAutoApprove: false,
      requiresManualReview: true,
    };
  }

  // 4d. Applicant provided no middle name without checking "hasNoMiddleName"
  if (!registration.hasNoMiddleName && !derivedMI && candidateMI) {
    reasons.push(
      `Applicant did not provide a middle name, but registry specifies middle initial "${candidateMI}".`
    );
    return {
      status: "REVIEW_REQUIRED",
      matchedRegistryEntry: candidate,
      reasons,
      derivedMiddleInitial: null,
      canAutoApprove: false,
      requiresManualReview: true,
    };
  }

  // Step 5: Evaluate Confirmed Email Match (if present on registry)
  if (candidate.verified_email) {
    const candidateEmail = normalizeEmail(candidate.verified_email);
    if (candidateEmail && candidateEmail !== regEmail) {
      reasons.push(
        `Registered Gmail address ("${registration.email}") does not match the confirmed email on file in the school registry ("${candidate.verified_email}").`
      );
      return {
        status: "REVIEW_REQUIRED",
        matchedRegistryEntry: candidate,
        reasons,
        derivedMiddleInitial: derivedMI,
        canAutoApprove: false,
        requiresManualReview: true,
      };
    }
  }

  // Step 6: Full Identity Match Achieved
  // Check if candidate entry is verified by an administrator
  const isRegistryVerified = candidate.verification_status === "verified";
  if (!isRegistryVerified) {
    reasons.push(
      "Identity matched with teacher registry, but the registry entry is currently unverified. Administrator verification of registry roster is required before automatic approval can occur."
    );
  }

  return {
    status: "MATCHED",
    matchedRegistryEntry: candidate,
    reasons,
    derivedMiddleInitial: derivedMI,
    canAutoApprove: isRegistryVerified,
    requiresManualReview: !isRegistryVerified,
  };
}
